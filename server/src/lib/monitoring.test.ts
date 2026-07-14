import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordRequestMetric } from './monitoring';

function metricsEnv() {
  const get = vi.fn(async () => null);
  const put = vi.fn(async () => undefined);
  return {
    env: { PROMPT_HUB_METRICS: { get, put } } as never,
    get,
    put
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request metric sampling', () => {
  it('keeps successful requests below the previous KV write rate', async () => {
    const skipped = metricsEnv();
    vi.spyOn(Math, 'random').mockReturnValue(0.006);
    await recordRequestMetric(
      skipped.env,
      new Request('https://api.example.test/api/v1/me'),
      new Response(null, { status: 200 }),
      12
    );
    expect(skipped.get).not.toHaveBeenCalled();
    expect(skipped.put).not.toHaveBeenCalled();

    vi.mocked(Math.random).mockReturnValue(0);
    const sampled = metricsEnv();
    await recordRequestMetric(
      sampled.env,
      new Request('https://api.example.test/api/v1/me'),
      new Response(null, { status: 200 }),
      12
    );
    expect(sampled.get).toHaveBeenCalledTimes(1);
    expect(sampled.put).toHaveBeenCalledTimes(1);
  });

  it('samples server errors instead of writing every failure', async () => {
    const skipped = metricsEnv();
    vi.spyOn(Math, 'random').mockReturnValue(0.11);
    await recordRequestMetric(
      skipped.env,
      new Request('https://api.example.test/api/v1/community/feed'),
      new Response(null, { status: 500 }),
      20
    );
    expect(skipped.put).not.toHaveBeenCalled();

    vi.mocked(Math.random).mockReturnValue(0.09);
    const sampled = metricsEnv();
    await recordRequestMetric(
      sampled.env,
      new Request('https://api.example.test/api/v1/community/feed'),
      new Response(null, { status: 500 }),
      20
    );
    expect(sampled.put).toHaveBeenCalledTimes(1);
  });

  it('backs off after KV rejects a metric write', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failed = metricsEnv();
    failed.put.mockRejectedValueOnce(new Error('quota exceeded'));

    await recordRequestMetric(
      failed.env,
      new Request('https://api.example.test/api/v1/me'),
      new Response(null, { status: 200 }),
      10
    );
    await recordRequestMetric(
      failed.env,
      new Request('https://api.example.test/api/v1/me'),
      new Response(null, { status: 200 }),
      10
    );

    expect(failed.get).toHaveBeenCalledTimes(1);
    expect(failed.put).toHaveBeenCalledTimes(1);
  });
});
