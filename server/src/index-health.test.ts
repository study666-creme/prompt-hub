import { describe, expect, it, vi } from 'vitest';

const { recordRequestMetricMock } = vi.hoisted(() => ({
  recordRequestMetricMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('./lib/monitoring', async importOriginal => ({
  ...await importOriginal<typeof import('./lib/monitoring')>(),
  recordRequestMetric: recordRequestMetricMock
}));

import worker, { publicBuildSha } from './index';

describe('Worker build identity', () => {
  it('publishes the reviewed build SHA through /health', async () => {
    const waitUntil = vi.fn();
    const response = await worker.fetch(
      new Request('https://api.test/health'),
      {
        BUILD_SHA: '0B60923569A63675AAD32DDA2470F95598351593',
        CORS_ORIGINS: '',
        ENVIRONMENT: 'test',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: ''
      } as never,
      { waitUntil } as never
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.buildSha).toBe('0b60923569a63675aad32dda2470f95598351593');
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('does not expose arbitrary runtime strings as a commit id', () => {
    expect(publicBuildSha('dirty local build')).toBe('unversioned');
    expect(publicBuildSha(undefined)).toBe('unversioned');
  });
});
