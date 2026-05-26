import type { Profile } from './supabase';
import { membershipGenMultiplier } from './supabase';

export const MIN_GENERATION_CHARGE = 1;

export const IMAGE_MODELS = {
  quanneng2: {
    id: 'quanneng2',
    label: '全能模型2',
    upstream: 'gpt-image-2',
    pricing: 'resolution' as const
  },
  jimeng: {
    id: 'jimeng',
    label: '集梦 Seedream',
    upstream: 'doubao-seedream-5-0-lite',
    pricing: 'fixed' as const,
    fixedCredits: 40
  }
} as const;

export type ImageModelId = keyof typeof IMAGE_MODELS;

const RESOLUTION_COST: Record<string, number> = { '1k': 10, '2k': 20, '4k': 40 };

export function resolveImageModel(model?: string): (typeof IMAGE_MODELS)[ImageModelId] {
  if (model && model in IMAGE_MODELS) {
    return IMAGE_MODELS[model as ImageModelId];
  }
  return IMAGE_MODELS.quanneng2;
}

export function baseResolutionCost(resolution: string): number {
  return RESOLUTION_COST[resolution] ?? 10;
}

export function computeGenerationCost(
  modelId: string,
  resolution: string,
  tier: Profile['membership_tier'],
  active: boolean
): { base: number; final: number; discountLabel: string | null; modelLabel: string } {
  const model = resolveImageModel(modelId);
  const base =
    model.pricing === 'fixed' ? model.fixedCredits : baseResolutionCost(resolution);
  const mult = active && tier ? membershipGenMultiplier(tier) : 1;
  const final =
    mult < 1 ? Math.max(MIN_GENERATION_CHARGE, Math.floor(base * mult)) : base;
  const discountLabel =
    mult < 1 && tier
      ? ({ basic: '9折', standard: '8折', pro: '7折' } as const)[tier]
      : null;

  return { base, final, discountLabel, modelLabel: model.label };
}

export function mapQualityForGptImage(quality: string): string {
  if (quality === 'high' || quality === 'ultra') return 'high';
  if (quality === 'standard') return 'medium';
  return 'auto';
}

export function mapResolutionForSeedream(resolution: string): string {
  const map: Record<string, string> = { '1k': '1K', '2k': '2K', '4k': '4K' };
  return map[resolution] ?? '2K';
}
