import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { roundCredits } from './credit-math';
import { deductUserCredits } from './membership-credits';
import { createAdminClient } from './supabase';

/**
 * 计费对账巡检：兜底“任务已受理/已完成但钱包没有对应扣费”的漏账。
 *
 * 背景：扣费发生在任务插入之后（视频走 awaiting_debit 异步链路、图片在
 * submit 前），任何一环中断都会留下“用户拿到了生成、钱包却没动”的窗口。
 * 用户侧几乎不可能发现少扣，所以必须由服务端主动巡检追回。
 *
 * 语义（宁可多扣可退、绝不少扣不追）：
 * - 仅处理 processing / completed 且 credits_charged > 0 的任务；
 * - processing 任务只有超过宽限期（默认 15 分钟，足以让队列/cron 正常链路
 *   完成扣费）才补扣；completed 立即核对；
 * - 以 credit_ledger 是否存在 (reason, ref_id) 记录为准——consume_user_credits
 *   的幂等键就是 (user_id, reason, ref_id)，补扣与正常扣共用同一键，天然防双扣；
 * - 补扣失败（余额不足等）不阻塞任务，但写 billingUnderchargeFlag 供运营追账，
 *   漏账绝不静默消失；
 * - 每轮有界（默认 20 条，最老优先），跨多轮收敛，避免单轮超时。
 */

const PROCESSING_GRACE_MS = 15 * 60 * 1000;

type ReconcileRow = {
  id: string;
  user_id: string;
  status: string;
  credits_charged: number | string;
  created_at: string;
  meta: Record<string, unknown> | null;
};

function underchargedAmount(row: ReconcileRow): number {
  return roundCredits(Math.max(0, Number(row.credits_charged) || 0));
}

function hasDebitLedgerEntry(meta: Record<string, unknown> | null): boolean {
  // The debit path writes debitSplit into job meta on success. A present split
  // (even 0/0 for a replayed zero-cost row) means the wallet RPC committed.
  if (meta && typeof meta === 'object' && 'debitSplit' in meta) return true;
  return false;
}

async function isLedgerDebited(
  admin: SupabaseClient,
  row: ReconcileRow,
  reason: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('credit_ledger')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('reason', reason)
    .eq('ref_id', row.id)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function flagUndercharge(
  admin: SupabaseClient,
  row: ReconcileRow,
  reason: string,
  note: string
): Promise<void> {
  const attempts = Number((row.meta?.billingUnderchargeAttempts as number) || 0) + 1;
  const { error } = await admin
    .from('generation_requests')
    .update({
      meta: {
        ...(row.meta || {}),
        billingUnderchargeFlag: true,
        billingUnderchargeReason: reason,
        billingUnderchargeNote: note.slice(0, 200),
        billingUnderchargeAttempts: attempts,
        billingUnderchargeLastAttemptAt: new Date().toISOString()
      }
    })
    .eq('id', row.id)
    .eq('user_id', row.user_id);
  if (error) throw error;
}

async function reconcileRow(
  admin: SupabaseClient,
  row: ReconcileRow,
  now: Date
): Promise<'debited' | 'flagged' | 'skipped'> {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const mediaType = String(meta.mediaType || '');
  const reason = mediaType === 'video' ? 'video_generation' : 'image_generation';
  const amount = underchargedAmount(row);
  if (amount <= 0) return 'skipped';
  // A row still inside its debit grace period may be charged by the normal
  // queue/cron path; reconciling it here would race that link. Wait it out.
  if (row.status === 'processing' && Date.now() - Date.parse(row.created_at) < PROCESSING_GRACE_MS) {
    return 'skipped';
  }

  // A settled debit is visible either through the job's debitSplit checkpoint
  // or through the authoritative ledger row. Check both so a checkpoint write
  // that was lost cannot cause a double debit.
  if (hasDebitLedgerEntry(meta)) return 'skipped';
  if (await isLedgerDebited(admin, row, reason)) return 'skipped';

  try {
    await deductUserCredits(admin, row.user_id, amount, reason, row.id, {
      product: meta.product,
      projectId: meta.projectId,
      nodeId: meta.nodeId,
      model: meta.model,
      reconciled: true,
      reconciledAt: now.toISOString()
    });
    return 'debited';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'reconcile debit failed');
    // insufficient_credits 是暂时的：用户余额不够补扣，但账必须记下来。
    await flagUndercharge(admin, row, reason, message).catch((flagError) => {
      console.error('[billing-reconcile] flag write failed', row.id, flagError);
    });
    console.warn('[billing-reconcile] undercharge recovery deferred', row.id, reason, message);
    return 'flagged';
  }
}

export async function drainUnderchargedGenerationWork(
  env: Env,
  opts?: { maxReconcile?: number; windowHours?: number }
): Promise<{ scanned: number; debited: number; flagged: number }> {
  const maxReconcile = Math.min(50, Math.max(1, Math.floor(opts?.maxReconcile ?? 20)));
  const windowHours = Math.max(1, Math.floor(opts?.windowHours ?? 48));
  const admin = createAdminClient(env);
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  const { data, error } = await admin
    .from('generation_requests')
    .select('id,user_id,status,credits_charged,created_at,meta')
    .in('status', ['processing', 'completed'])
    .gt('credits_charged', 0)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(maxReconcile * 4);
  if (error) {
    console.error('[billing-reconcile] list failed', error.message);
    return { scanned: 0, debited: 0, flagged: 0 };
  }

  const now = new Date();
  const rows = ((data || []) as ReconcileRow[]).slice(0, maxReconcile);
  const results = await Promise.allSettled(rows.map(row => reconcileRow(admin, row, now)));
  let debited = 0;
  let flagged = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value === 'debited') debited += 1;
      if (result.value === 'flagged') flagged += 1;
    } else {
      console.error('[billing-reconcile] row failed', rows[index]?.id, result.reason);
      flagged += 1;
    }
  });
  if (rows.length) {
    console.log('[billing-reconcile] tick', { scanned: rows.length, debited, flagged });
  }
  return { scanned: rows.length, debited, flagged };
}
