import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchNewApiPricingRules,
  fetchNewApiTaskOnce,
  newApiCreditsForModel,
  submitNewApiImageJob
} from './newapi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('newapi image upstream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts yuan pricing to whole credits', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      auto_groups: ['default'],
      group_ratio: { default: 1 },
      data: [
        { model_name: 'gpt-image-2-ext-1k', quota_type: 1, model_price: 0.055, tags: 'image' },
        { model_name: 'gpt-image-2-official-4k', quota_type: 1, model_price: 0.09, tags: 'image' },
        { model_name: 'nano-banana-2', quota_type: 1, model_price: 0.09, tags: 'image' },
        { model_name: 'chat-only', quota_type: 1, model_price: 0.01, tags: 'chat' }
      ]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const rules = await fetchNewApiPricingRules('https://pricing-unit.test/v1', { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const pricingCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(pricingCall[0])).toBe('https://pricing-unit.test/api/pricing');
    expect(newApiCreditsForModel(rules, 'gpt-image-2-ext-1k')).toBe(6);
    expect(newApiCreditsForModel(rules, 'gpt-image-2-official', '4k')).toBe(9);
    expect(newApiCreditsForModel(rules, 'nano-banana-2')).toBe(9);
    expect(newApiCreditsForModel(rules, 'chat-only')).toBeNull();
  });

  it('extracts an immediate image response from compatible generation API', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body || '{}')) as Record<string, unknown>;
      expect(body.model).toBe('gpt-image-2');
      expect(body.prompt).toBe('apple');
      expect(body.resolution).toBe('1k');
      expect(body.quality).toBe('low');
      expect(body.image_urls).toEqual(['https://ref.test/a.png']);
      return jsonResponse({ data: [{ url: 'https://image.test/out.png' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitNewApiImageJob('unit-key', 'https://newapi-unit.test', {
      upstreamModel: 'gpt-image-2',
      prompt: 'apple',
      resolution: '1k',
      quality: 'standard',
      fixedQualityLow: true,
      refImageUrls: ['https://ref.test/a.png']
    });

    const submitCall = fetchMock.mock.calls[0] as unknown[];
    expect(String(submitCall[0])).toBe('https://newapi-unit.test/v1/images/generations');
    expect((submitCall[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer unit-key',
      'Content-Type': 'application/json'
    });
    expect(result.taskId).toMatch(/^newapi-/);
    expect(result.imageUrl).toBe('https://image.test/out.png');
  });

  it('normalizes completed task polling responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: {
        status: 'succeeded',
        images: [{ url: 'https://image.test/task.png' }]
      }
    })));

    const result = await fetchNewApiTaskOnce('unit-key', 'https://newapi-unit.test', 'task-1');

    expect(result.status).toBe('completed');
    expect(result.imageUrl).toBe('https://image.test/task.png');
    expect(result.imageUrls).toEqual(['https://image.test/task.png']);
  });
});
