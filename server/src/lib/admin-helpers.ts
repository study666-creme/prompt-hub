import type { Profile } from './supabase';
import { isMembershipActive } from './supabase';

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

/** 与前端 membership.js 一致：免费 100 张，会员不限张数；storage_bytes 为云端登记用量 */
export function cardLimitForProfile(profile: Profile): number | null {
  if (isMembershipActive(profile)) return null;
  return 100;
}

export function tierLabel(tier: Profile['membership_tier']): string {
  if (!tier) return '免费';
  if (tier === 'lite') return '轻量';
  if (tier === 'basic') return '基础';
  if (tier === 'standard') return '标准';
  if (tier === 'pro') return '专业';
  return tier;
}
