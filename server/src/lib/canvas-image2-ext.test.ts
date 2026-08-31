import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeImageModelId } from './image-models-catalog';
import { fetchNewApiModelCatalog, imageCatalogForNewApiSnapshot } from './newapi';
import { resolveImageModelConfig } from './image-model-settings';

const EMPTY_SETTINGS = { globalDiscountPercent: 100, models: {} };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * 卡藏（Canvas）通过 prompt-hub /api/v1/generate 提交新目录模型 id
 * （例如 gpt-image-2-ext）。Worker 必须能把新 public id 解析成内部
 * 目录条目（image2-pro，upstream gpt-image-2-ext），否则画布报
 * “所选模型不可用”。该用例使用与 /api/model-catalog 相同的模型形态。
 */
describe('canvas image2-ext alias resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes the canvas public id to the internal image2-pro line', () => {
    expect(normalizeImageModelId('gpt-image-2-ext')).toBe('image2-pro');
  });

  it('resolves a live-shaped gpt-image-2-ext snapshot entry through the worker pipeline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      version: 'catalog-canvas-ext',
      pricing_version: 'pricing-canvas-ext',
      models: [
        {
          id: 'gpt-image-2-ext',
          label: '全能模型2-稳定1k/2k/4k',
          modality: 'image',
          family: 'gim2',
          selectable: true,
          order: 22,
          tags: 'image,image2',
          integrations: { prompt_hub: { id: 'newapi-gpt-image-2-ext', fixed_quality_low: false } },
          parameters: [
            { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'gpt-image-2-ext' },
            { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
            { name: 'resolution', path: 'resolution', label: '分辨率', type: 'string', required: false, options: ['1k', '2k', '4k'] },
            { name: 'size', path: 'size', label: '画面比例', type: 'string', required: false, options: ['auto', '1:1', '16:9'] },
            { name: 'n', path: 'n', label: '生成张数', type: 'integer', required: false, fixed: 1 }
          ],
          pricing: {
            mode: 'tiered',
            unit: 'image',
            yuan: 0.08,
            credits: 8,
            tiers: [
              { when: { resolution: '1k' }, yuan: 0.08, credits: 8 },
              { when: { resolution: '2k' }, yuan: 0.15, credits: 15 },
              { when: { resolution: '4k' }, yuan: 0.2, credits: 20 }
            ]
          }
        }
      ]
    })));

    const snapshot = await fetchNewApiModelCatalog('https://newapi.prompt-hubs.com', { force: true });
    const entries = imageCatalogForNewApiSnapshot(snapshot);
    const resolved = resolveImageModelConfig('gpt-image-2-ext', EMPTY_SETTINGS, entries);

    expect(snapshot.available).toBe(true);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe('image2-pro');
    expect(resolved!.upstream).toBe('gpt-image-2-ext');
    expect(resolved!.provider).toBe('newapi');
    expect(resolved!.resolutions).toEqual(['1k', '2k', '4k']);
  });
});
