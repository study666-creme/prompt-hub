import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordGenerationMetric, recordRequestMetric, summarizeGenerationMetrics } from './monitoring';

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

describe('generation delivery metrics', () => {
  it('records distinct phase counters without sensitive fields', async () => {
    const store = new Map<string, unknown>();
    const get = vi.fn(async (key: string) => store.get(key) ?? null);
    const put = vi.fn(async (key: string, value: string) => {
      store.set(key, JSON.parse(value));
    });
    const env = { PROMPT_HUB_METRICS: { get, put } } as never;

    await recordGenerationMetric(env, 'upstream_completed', { elapsedMs: 3400 });
    await recordGenerationMetric(env, 'archive', { status: 'ok', elapsedMs: 5200 });
    await recordGenerationMetric(env, 'archive', { status: 'fail', elapsedMs: 900 });
    await recordGenerationMetric(env, 'image_404');

    const summary = await summarizeGenerationMetrics(env, 1);
    expect(summary.available).toBe(true);
    expect(summary.counts['upstream_completed']).toBe(1);
    expect(summary.counts.archive).toBe(1);
    expect(summary.counts['archive:fail']).toBe(1);
    expect(summary.counts.image_404).toBe(1);
    const archiveLatency = summary.latency.find((l) => l.phase === 'archive');
    expect(archiveLatency?.count).toBe(2);
    expect(archiveLatency?.averageMs).toBe(Math.round((5200 + 900) / 2));
    expect(archiveLatency?.maxMs).toBe(5200);
  });

  it('skips writes when metrics KV is missing', async () => {
    await recordGenerationMetric(undefined as never, 'archive', { elapsedMs: 10 });
    const summary = await summarizeGenerationMetrics(undefined as never, 1);
    expect(summary.available).toBe(false);
  });
});
