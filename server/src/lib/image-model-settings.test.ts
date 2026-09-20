import { describe, expect, it } from 'vitest';
import { IMAGE_MODEL_CATALOG } from './image-models-catalog';
import {
  adminModelRows,
  explicitOperatorCredits,
  hasExplicitPriceOverride,
  listResolvedImageModels,
  mergeImageModelSettings,
  resolveImageModelConfig
} from './image-model-settings';

describe('dynamic image model catalog ids', () => {
  it('matches catalog entries case-insensitively after live catalog projection', () => {
    const base = IMAGE_MODEL_CATALOG.find(model => model.id === 'image2')!;
    const dynamic = { ...base, id: 'image2-A', label: 'Live Image 2 A' };
    const settings = { globalDiscountPercent: 100, models: {} };

    expect(resolveImageModelConfig(dynamic.id, settings, [dynamic])?.id).toBe(dynamic.id);
    expect(listResolvedImageModels(settings, { publicList: true, catalogEntries: [dynamic] })).toHaveLength(1);
  });
});

describe('operator price overrides on synced (newapi) models', () => {
  // 卡藏实时目录里才有、静态兜底目录里没有的模型：以前它的覆盖会被
  // mergeImageModelSettings 静默丢掉，运营改了价保存后回头看还是原价。
  const liveOnly = {
    ...IMAGE_MODEL_CATALOG.find(model => model.id === 'image2')!,
    id: 'gpt-image-2.5-flare',
    label: 'GPT-Image-2.5-flare',
    provider: 'newapi' as const,
    resolutions: ['1k' as const],
    defaultCredits: 12,
    pricingByResolution: false
  };
  const catalog = [liveOnly];

  it('keeps an override for a model that only exists in the live catalog', () => {
    const merged = mergeImageModelSettings(
      { models: { 'gpt-image-2.5-flare': { displayName: '我的模型', creditsPerCall: 7 } } },
      catalog
    );
    expect(merged.models['gpt-image-2.5-flare']).toMatchObject({
      displayName: '我的模型',
      creditsPerCall: 7
    });
  });

  it('treats a cleared price as "follow the catalog" instead of pinning the synced value', () => {
    const merged = mergeImageModelSettings(
      { models: { 'gpt-image-2.5-flare': { displayName: '', creditsPerCall: 0 } } },
      catalog
    );
    expect(merged.models['gpt-image-2.5-flare']?.creditsPerCall).toBeUndefined();
    expect(merged.models['gpt-image-2.5-flare']?.displayName).toBeUndefined();
  });

  it('reports the synced value separately from the operator value', () => {
    const settings = mergeImageModelSettings(
      { models: { 'gpt-image-2.5-flare': { creditsPerCall: 7 } } },
      catalog
    );
    const rows = adminModelRows(settings, catalog);
    const row = rows.find(entry => entry.id === 'gpt-image-2.5-flare')!;
    expect(row.pricingSource).toBe('upstream_realtime');
    expect(row.operatorOverride).toBe(true);
    expect(row.creditsPerCall).toBe(7);
    expect(row.catalogCreditsPerCall).toBe(12);

    const untouched = adminModelRows({ globalDiscountPercent: 100, models: {} }, catalog)
      .find(entry => entry.id === 'gpt-image-2.5-flare')!;
    expect(untouched.operatorOverride).toBe(false);
    expect(untouched.creditsPerCall).toBe(12);
    expect(untouched.catalogCreditsPerCall).toBe(12);
  });

  it('exposes the operator price so billing can prefer it over the upstream sync', () => {
    const settings = mergeImageModelSettings(
      { models: { 'gpt-image-2.5-flare': { creditsPerCall: 7 } } },
      catalog
    );
    const model = { id: 'gpt-image-2.5-flare', pricingByResolution: false, pricingBySpeed: false };
    expect(explicitOperatorCredits(settings, model, '1k')).toBe(7);
    expect(explicitOperatorCredits({ globalDiscountPercent: 100, models: {} }, model, '1k')).toBeNull();
    expect(hasExplicitPriceOverride(settings.models['gpt-image-2.5-flare'], liveOnly)).toBe(true);
    expect(hasExplicitPriceOverride(undefined, liveOnly)).toBe(false);
  });

  it('keeps a per-resolution override keyed by the requested resolution', () => {
    const byResolution = {
      ...liveOnly,
      id: 'gpt-image-2.5-pro',
      resolutions: ['1k' as const, '2k' as const, '4k' as const],
      pricingByResolution: true,
      defaultCreditsByResolution: { '1k': 7, '2k': 15, '4k': 20 }
    };
    const settings = mergeImageModelSettings(
      { models: { 'gpt-image-2.5-pro': { creditsByResolution: { '2k': 9 } } } },
      [byResolution]
    );
    const model = { id: 'gpt-image-2.5-pro', pricingByResolution: true, pricingBySpeed: false };
    expect(explicitOperatorCredits(settings, model, '2k')).toBe(9);
    expect(explicitOperatorCredits(settings, model, '4k')).toBeNull();
  });
});
