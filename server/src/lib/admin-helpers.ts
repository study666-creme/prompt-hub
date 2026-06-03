import type { Profile } from './supabase';
import { storagePayloadForProfile, storageQuotaLabelForProfile } from './storage-quota';

export function formatBytes(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function countCardsInUserData(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const cards = (data as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.length : 0;
}

/** @deprecated 已改为按 storage_bytes 配额；保留 null 表示不按张数限制 */
export function cardLimitForProfile(_profile: Profile): number | null {
  return null;
}

export function storageQuotaForProfile(profile: Profile) {
  return storagePayloadForProfile(profile);
}

export function storageQuotaSummaryForProfile(profile: Profile): string {
  return storageQuotaLabelForProfile(profile);
}

export function tierLabel(tier: Profile['membership_tier']): string {
  if (!tier) return '免费';
  if (tier === 'lite') return '轻量';
  if (tier === 'basic') return '基础';
  if (tier === 'standard') return '标准';
  if (tier === 'pro') return '专业';
  return tier;
}
