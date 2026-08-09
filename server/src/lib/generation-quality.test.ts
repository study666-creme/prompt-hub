import { describe, expect, it } from 'vitest';
import { databaseGenerationQuality, requestedGenerationQuality, type JobRow } from './generation-jobs';
import { fastSubmitParamsFromJob } from './fast-provider-submit';

function job(quality: string, requestedQuality?: string): JobRow {
  return {
    id: 'quality-test-job',
    user_id: 'quality-test-user',
    credits_charged: 2.2,
    status: 'processing',
    prompt: 'product photo',
    resolution: '1k',
    quality,
    result_image_url: null,
    error_message: null,
    meta: {
      provider: 'newapi',
      upstreamModel: 'gpt-image-2-chat',
      ...(requestedQuality ? { requestedQuality } : {})
    },
    created_at: '2026-08-06T00:00:00.000Z'
  };
}

describe('generation quality database compatibility', () => {
  it('stores new low and medium tiers through the legacy standard value', () => {
    expect(databaseGenerationQuality('low')).toBe('standard');
    expect(databaseGenerationQuality('medium')).toBe('standard');
    expect(databaseGenerationQuality('standard')).toBe('standard');
    expect(databaseGenerationQuality('high')).toBe('high');
    expect(databaseGenerationQuality('ultra')).toBe('ultra');
  });

  it('preserves the exact requested tier for upstream submission and public projection', () => {
    const row = job('standard', 'medium');
    expect(requestedGenerationQuality(row)).toBe('medium');
    expect(fastSubmitParamsFromJob(row).quality).toBe('medium');
  });

  it('keeps historical rows readable before requestedQuality existed', () => {
    expect(requestedGenerationQuality(job('high'))).toBe('high');
  });
});
