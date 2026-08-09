import { describe, expect, it } from 'vitest';
import { isFastProviderSubmitRecoverable } from './fast-provider-drain';
import type { JobRow } from './generation-jobs';

const now = Date.parse('2026-08-06T01:40:00.000Z');

function job(provider: string, state: string, ageMs: number): JobRow {
  return {
    id: `job-${provider}-${state}`,
    user_id: 'user-unit',
    credits_charged: 2.2,
    status: 'processing',
    prompt: 'product photo',
    resolution: '1k',
    quality: 'medium',
    result_image_url: null,
    error_message: null,
    meta: {
      provider,
      upstreamModel: 'gpt-image-2-1k',
      fastSubmitState: state,
      fastSubmitStartedAt: new Date(now - ageMs).toISOString(),
      fastSubmitLeaseId: 'lease-unit'
    },
    created_at: new Date(now - ageMs).toISOString()
  };
}

describe('fast provider drain recovery', () => {
  it('waits one minute before replaying a running New API request', () => {
    expect(isFastProviderSubmitRecoverable(job('newapi', 'running', 59_999), now)).toBe(false);
    expect(isFastProviderSubmitRecoverable(job('newapi', 'running', 60_000), now)).toBe(true);
  });

  it('recovers an uncertain New API request through the same idempotency key', () => {
    expect(isFastProviderSubmitRecoverable(job('newapi', 'uncertain', 60_000), now)).toBe(true);
  });

  it('keeps the longer legacy recovery delay for providers without durable replay', () => {
    expect(isFastProviderSubmitRecoverable(job('apimart', 'running', 60_000), now)).toBe(false);
    expect(isFastProviderSubmitRecoverable(job('apimart', 'running', 15 * 60_000), now)).toBe(true);
  });

  it('does not replay a request that already has an upstream task id', () => {
    const row = job('newapi', 'running', 60_000);
    row.meta = { ...(row.meta as Record<string, unknown>), upstreamTaskId: 'task-complete' };
    expect(isFastProviderSubmitRecoverable(row, now)).toBe(false);
  });
});
