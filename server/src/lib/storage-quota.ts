import type { Profile } from './supabase';
import { isMembershipActive } from './supabase';

/** 所有登录用户基础云存储（300 MB） */
export const FREE_BASE_STORAGE_BYTES = 300 * 1024 * 1024;

/** 会员在 300MB 基础上额外容量（与 subscription.js 宣传一致） */
export const TIER_EXTRA_STORAGE_BYTES: Record<
  NonNullable<Profile['membership_tier']>,
  number
> = {
  lite: 2 * 1024 * 1024 * 1024,
  basic: 5 * 1024 * 1024 * 1024,
  standard: 10 * 1024 * 1024 * 1024,
  pro: 30 * 1024 * 1024 * 1024
};

export function storageQuotaBytesForProfile(profile: Profile): number {
  let quota = FREE_BASE_STORAGE_BYTES;
  if (isMembershipActive(profile) && profile.membership_tier) {
    quota += TIER_EXTRA_STORAGE_BYTES[profile.membership_tier] ?? 0;
  }
  return quota;
}

export function storageQuotaLabelForProfile(profile: Profile): string {
  const quota = storageQuotaBytesForProfile(profile);
  const used = Math.max(0, Number(profile.storage_bytes) || 0);
  const tier = isMembershipActive(profile) ? profile.membership_tier : null;
  if (!tier) {
    return `${formatStorageMb(used)} / ${formatStorageMb(quota)}（免费 300MB）`;
  }
  const extra = TIER_EXTRA_STORAGE_BYTES[tier] ?? 0;
  return `${formatStorageMb(used)} / ${formatStorageMb(quota)}（300MB+${formatStorageGb(extra)}）`;
}

export function formatStorageMb(bytes: number): string {
  const v = Math.max(0, Number(bytes) || 0);
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(v >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatStorageGb(bytes: number): string {
  const gb = Math.max(0, Number(bytes) || 0) / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb % 1 === 0 ? gb : gb.toFixed(1)}GB` : `${(gb * 1024).toFixed(0)}MB`;
}

export function storagePolicySummary(): Array<{ tier: string; quotaLabel: string }> {
  return [
    { tier: '免费用户', quotaLabel: '300 MB' },
    { tier: '轻量会员', quotaLabel: '300 MB + 2 GB' },
    { tier: '基础会员', quotaLabel: '300 MB + 5 GB' },
    { tier: '标准会员', quotaLabel: '300 MB + 10 GB' },
    { tier: '专业会员', quotaLabel: '300 MB + 30 GB' }
  ];
}

export function storagePayloadForProfile(profile: Profile) {
  const usedBytes = Math.max(0, Number(profile.storage_bytes) || 0);
  const quotaBytes = storageQuotaBytesForProfile(profile);
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  return {
    usedBytes,
    quotaBytes,
    remainingBytes,
    usedLabel: formatStorageMb(usedBytes),
    quotaLabel: formatStorageMb(quotaBytes),
    remainingLabel: formatStorageMb(remainingBytes),
    summaryLabel: storageQuotaLabelForProfile(profile),
    percentUsed: quotaBytes
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
      : 0
  };
}

export function assertStorageDelta(profile: Profile, delta: number): void {
  const add = Math.max(0, Math.floor(Number(delta) || 0));
  if (add <= 0) return;
  const used = Math.max(0, Number(profile.storage_bytes) || 0);
  const quota = storageQuotaBytesForProfile(profile);
  if (used + add > quota) {
    const need = formatStorageMb(used + add - quota);
    throw new Error(
      `云存储空间不足（已用 ${formatStorageMb(used)} / ${formatStorageMb(quota)}，还差约 ${need}）。可删除旧图或升级会员。`
    );
  }
}
