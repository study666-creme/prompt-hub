import type { Profile } from './supabase';
import { membershipGenMultiplier } from './supabase';
import {
  computeImageGenerationCost,
  loadImageModelSettings,
  listResolvedImageModels,
  normalizeImageModelId,
  type ImageModelPricingSettings
} from './image-model-settings';

import { MIN_CREDIT_CHARGE } from './credit-math';

export const MIN_GENERATION_CHARGE = MIN_CREDIT_CHARGE;

/** @deprecated 旧前端兼容；新模型见 /api/v1/generate/models */
export const IMAGE_MODELS = {
  quanneng2: { id: 'quanneng2', label: 'GPT Image 2', upstream: 'gpt-image-2', pricing: 'fixed' as const },
  jimeng: { id: 'jimeng', label: 'Nano Banana Pro', upstream: 'nano-banana-pro', pricing: 'fixed' as const }
} as const;

export type ImageModelId = string;

export function resolveImageModel(model?: string) {
  return { id: normalizeImageModelId(model), label: normalizeImageModelId(model) };
}

export function baseResolutionCost(_resolution: string): number {
  return 10;
}

export async function loadPricingState(admin: import('@supabase/supabase-js').SupabaseClient) {
  return loadImageModelSettings(admin);
}

export function computeGenerationCostFromSettings(
  settings: ImageModelPricingSettings,
  modelId: string,
  resolution: string,
  tier: Profile['membership_tier'],
  active: boolean
) {
  return computeImageGenerationCost(settings, modelId, resolution, tier, active);
}

export function computeGenerationCost(
  modelId: string,
  resolution: string,
  tier: Profile['membership_tier'],
  active: boolean
) {
  return computeImageGenerationCost(
    { globalDiscountPercent: 100, models: {} },
    modelId,
    resolution,
    tier,
    active
  );
}

export function mapQualityForGptImage(quality: string): string {
  if (quality === 'high' || quality === 'ultra') return 'high';
  if (quality === 'standard') return 'medium';
  return 'auto';
}

export function mapResolutionForSeedream(resolution: string): string {
  const map: Record<string, string> = { '1k': '2K', '2k': '2K', '4k': '4K' };
  return map[resolution] ?? '2K';
}

export { listResolvedImageModels, normalizeImageModelId, membershipGenMultiplier };
