import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  billableNewApiTextCredits,
  fetchFreshNewApiTextModels,
  newApiTextRequestTarget
} from './newapi-text';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function textModel(id: string, order: number) {
  return {
    id,
    label: id,
    description: '文字创作模型。',
    modality: 'text',
    operation: 'chat',
    selectable: true,
    order,
    public: { id, label: id, description: '文字创作模型。' },
    parameters: [
      { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: id }
    ],
    pricing: { mode: 'fixed', unit: 'request', yuan: 0.002 }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('New API text model routing', () => {
  it('loads both public DeepSeek models from one live catalog and uses its per-request price', async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/api/model-catalog/admin/routes')) {
        return jsonResponse({ success: true, fetched_at: '2026-08-03T00:00:00.000Z', routes: {} });
      }
      return jsonResponse({
        success: true,
        fetched_at: '2026-08-03T00:00:00.000Z',
        version: 'deepseek-v4-test',
        pricing_version: 'deepseek-v4-price-test',
        models: [
          textModel('deepseek-v4-flash', 1),
          textModel('deepseek-v4-pro', 2)
        ]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchFreshNewApiTextModels({
      NEWAPI_API_KEY: 'unit-key',
      NEWAPI_API_BASE_URL: 'https://deepseek-routing-unit.test/v1',
      NEWAPI_CATALOG_ADMIN_SECRET: 'unit-admin-secret'
    }, ['deepseek-v4-flash', 'deepseek-v4-pro']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual(expect.arrayContaining([
      'https://deepseek-routing-unit.test/api/model-catalog?refresh=1',
      'https://deepseek-routing-unit.test/api/model-catalog/admin/routes'
    ]));
    expect(models.map(model => model.publicIdentity.model)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro'
    ]);
    expect(models.map(model => billableNewApiTextCredits(model.model, 500_000, 500_000)))
      .toEqual([0.2, 0.2]);
    expect(newApiTextRequestTarget({
      NEWAPI_API_KEY: 'unit-key',
      NEWAPI_API_BASE_URL: 'https://deepseek-routing-unit.test/v1'
    }, models[0])).toEqual({
      apiKey: 'unit-key',
      baseUrl: 'https://deepseek-routing-unit.test/v1',
      model: 'deepseek-v4-flash'
    });
  });
});
