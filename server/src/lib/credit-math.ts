/** 积分最小精度：0.1（会员 95/90/85 折可区分，如 10→9.5/9.0/8.5） */
export const CREDIT_DECIMALS = 1;
export const MIN_CREDIT_CHARGE = 0.1;
export const CREDITS_PER_YUAN = 100;

export function roundCredits(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_CREDIT_CHARGE;
  const factor = 10 ** CREDIT_DECIMALS;
  return Math.round(n * factor) / factor;
}

export function clampCreditsValue(value: number, min = MIN_CREDIT_CHARGE, max = 99999): number {
  return roundCredits(Math.min(max, Math.max(min, value)));
}

/** 展示：9.5 → "9.5"，10 → "10" */
export function formatCreditsDisplay(value: number): string {
  const r = roundCredits(Number(value) || 0);
  if (!Number.isFinite(r) || r <= 0) return '0';
  return Number.isInteger(r) ? String(r) : r.toFixed(CREDIT_DECIMALS);
}

export function applyMemberCreditDiscount(base: number, multiplier: number): number {
  if (multiplier >= 1) return roundCredits(base);
  return clampCreditsValue(base * multiplier);
}

/** 卡藏统一汇率：上游人民币成本直接换算为站内积分。 */
export function creditsFromYuan(value: unknown): number | null {
  const yuan = Number(value);
  if (!Number.isFinite(yuan) || yuan < 0) return null;
  return roundCredits(yuan * CREDITS_PER_YUAN);
}

/** 卡藏图片售价已经包含上游加价；这里只按 1 元 = 100 积分直接换算。 */
export function imageRetailCreditsFromYuan(value: unknown): number | null {
  return creditsFromYuan(value);
}
