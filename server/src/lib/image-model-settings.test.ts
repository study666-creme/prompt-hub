import { describe, expect, it } from 'vitest';
import { IMAGE_MODEL_CATALOG } from './image-models-catalog';
import { listResolvedImageModels, resolveImageModelConfig } from './image-model-settings';

describe('dynamic image model catalog ids', () => {
  it('matches catalog entries case-insensitively after live catalog projection', () => {
    const base = IMAGE_MODEL_CATALOG.find(model => model.id === 'image2')!;
    const dynamic = { ...base, id: 'image2-A', label: 'Live Image 2 A' };
    const settings = { globalDiscountPercent: 100, models: {} };

    expect(resolveImageModelConfig(dynamic.id, settings, [dynamic])?.id).toBe(dynamic.id);
    expect(listResolvedImageModels(settings, { publicList: true, catalogEntries: [dynamic] })).toHaveLength(1);
  });
});
