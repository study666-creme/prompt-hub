import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { createAdminClient } from './supabase';
import { decodePaymentOrderNote, recordEpayCallbackEvent } from './epay';

export type PaymentOrderMonitor = {
  available: boolean;
  total: number;
  pending: number;
  processing: number;
  paid: number;
  failed: number;
  stale: number;
  staleOrders: Array<{ orderNo: string; state: string; createdAt: string | null }>;
  error?: string;
};

const STALE_AFTER_MS = 10 * 60 * 1000;

function emptyMonitor(): PaymentOrderMonitor {
  return {
    available: true,
    total: 0,
    pending: 0,
    processing: 0,
    paid: 0,
    failed: 0,
    stale: 0,
    staleOrders: []
  };
}
export async function collectPaymentOrderMonitor(
  admin: SupabaseClient,
  now = Date.now(),
  limit = 500
): Promise<PaymentOrderMonitor> {
  const out = emptyMonitor();
  try {
    const { data, error } = await admin
      .from('activation_codes')
      .select('code,used_count,note,created_at')
      .like('note', 'payment-order:%')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    for (const row of data ?? []) {
      const order = decodePaymentOrderNote(row.note);
      if (!order) continue;
      out.total += 1;
      const state = String(order.state || (Number(row.used_count) ? 'processing' : 'pending'));
      if (state === 'pending') out.pending += 1;
      else if (state === 'processing') out.processing += 1;
      else if (state === 'paid') out.paid += 1;
      else if (state === 'failed') out.failed += 1;

      const createdAt = typeof order.created_at === 'string'
        ? order.created_at
        : typeof row.created_at === 'string' ? row.created_at : null;
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      if ((state === 'pending' || state === 'processing') && Number.isFinite(createdMs) && createdMs < now - STALE_AFTER_MS) {
        out.stale += 1;
        if (out.staleOrders.length < 20) {
          out.staleOrders.push({ orderNo: String(row.code || ''), state, createdAt });
        }
      }
    }
    return out;
  } catch (error) {
    return {
      ...out,
      available: false,
      error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
    };
  }
}

/**
 * Cron-side check. It never grants credits without a verified notification;
 * it records stale orders so an operator can reconcile them with EPay.
 */
export async function monitorPendingPaymentOrders(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const admin = createAdminClient(env);
    const summary = await collectPaymentOrderMonitor(admin);
    if (!summary.available || summary.stale === 0) return;
    console.error('[payment] stale pending orders detected', {
      count: summary.stale,
      orders: summary.staleOrders.map(order => order.orderNo)
    });
    for (const order of summary.staleOrders) {
      await recordEpayCallbackEvent(admin, {
        out_trade_no: order.orderNo,
        trade_status: order.state
      }, 'failed', new Error('stale_payment_order')).catch(() => undefined);
    }
  } catch (error) {
    console.error('[payment] stale order monitor failed', error instanceof Error ? error.message : String(error));
  }
}
