import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { createAdminClient } from '../lib/supabase';

/** 8-char fingerprint so audit rows show WHICH secret was used without storing it. */
export function adminSecretFingerprint(secret: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < secret.length; i++) {
    h1 ^= secret.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return 'fp_' + h1.toString(16).padStart(8, '0');
}

export type AuditEntry = {
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: unknown;
};

/**
 * Record one admin action. Fire-and-forget: audit failure must never block
 * the operation itself, but it is logged for ops.
 */
export async function writeAudit(
  c: Context<{ Bindings: Env }>,
  entry: AuditEntry
): Promise<void> {
  try {
    const secret = c.env.ADMIN_API_SECRET?.trim() || '';
    const admin = createAdminClient(c.env);
    const { error } = await admin.from('admin_audit_logs').insert({
      actor_fingerprint: secret ? adminSecretFingerprint(secret) : 'unknown',
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      detail: entry.detail ?? null,
      ip:
        c.req.header('CF-Connecting-IP') ||
        c.req.header('X-Forwarded-For') ||
        null,
      user_agent: c.req.header('User-Agent') || null
    });
    if (error) console.warn('[admin-audit] insert failed:', error.message);
  } catch (e) {
    console.warn('[admin-audit] insert threw:', e instanceof Error ? e.message : String(e));
  }
}
