import { describe, expect, it } from 'vitest';
import { buildMembershipExtensionPatch } from './membership-tasks';
import type { Profile } from './supabase';
import { appendPaymentResult, createEpayCheckout, PAYMENT_PRODUCTS, resolvePaymentReturnUrl, safePaymentReturnUrl } from './epay';
import { isRecoverablePurgedShopCode } from '../routes/v1/redeem';
import { checkoutSchema } from '../routes/v1/payments';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    user_id: 'user-1',
    credits: 0,
    daily_credits: 0,
    daily_credits_date: null,
    membership_tier: null,
    membership_until: null,
    membership_queued_tier: null,
    membership_queued_until: null,
    credit_grant_mode: 'daily',
    storage_bytes: 0,
    ...overrides
  } as Profile;
}

describe('membership payment extension patch', () => {
  const now = Date.parse('2026-07-18T00:00:00.000Z');
  const day = 86_400_000;

  it('activates a new membership for exactly 30 days', () => {
    const patch = buildMembershipExtensionPatch(profile(), 30, 'standard', {
      creditGrantMode: 'bundle',
      nowMs: now
    });
    expect(patch).toMatchObject({
      membership_tier: 'standard',
      membership_until: new Date(now + 30 * day).toISOString(),
      membership_queued_tier: null,
      membership_queued_until: null,
      credit_grant_mode: 'bundle'
    });
  });

  it('extends the same tier from its current expiry', () => {
    const currentUntil = now + 12 * day;
    const patch = buildMembershipExtensionPatch(profile({
      membership_tier: 'basic',
      membership_until: new Date(currentUntil).toISOString()
    }), 30, 'basic', { creditGrantMode: 'daily', nowMs: now });
    expect(patch.membership_until).toBe(new Date(currentUntil + 30 * day).toISOString());
  });

  it('starts an upgrade now and preserves the remaining lower-tier time', () => {
    const currentUntil = now + 12 * day;
    const patch = buildMembershipExtensionPatch(profile({
      membership_tier: 'basic',
      membership_until: new Date(currentUntil).toISOString()
    }), 30, 'pro', { creditGrantMode: 'daily', nowMs: now });
    expect(patch).toMatchObject({
      membership_tier: 'pro',
      membership_until: new Date(now + 30 * day).toISOString(),
      membership_queued_tier: 'basic',
      membership_queued_until: new Date(now + 42 * day).toISOString()
    });
  });

  it('queues a lower tier after the active membership chain', () => {
    const activeUntil = now + 10 * day;
    const queuedUntil = now + 18 * day;
    const patch = buildMembershipExtensionPatch(profile({
      membership_tier: 'pro',
      membership_until: new Date(activeUntil).toISOString(),
      membership_queued_tier: 'standard',
      membership_queued_until: new Date(queuedUntil).toISOString()
    }), 30, 'basic', { creditGrantMode: 'daily', nowMs: now });
    expect(patch).toMatchObject({
      membership_queued_tier: 'basic',
      membership_queued_until: new Date(queuedUntil + 30 * day).toISOString()
    });
  });
});

describe('payment checkout URL', () => {
  it('keeps every credit pack at exactly 100 credits per yuan', () => {
    const creditProducts = PAYMENT_PRODUCTS.filter(product => product.kind === 'credits');
    expect(creditProducts).toHaveLength(6);
    for (const product of creditProducts) {
      expect(product.credits).toBe(product.amountCents);
    }
  });

  it('uses the hosted cashier instead of returning an app-only payment scheme', async () => {
    const checkout = await createEpayCheckout({
      EPAY_MERCHANT_ID: '1000',
      EPAY_MERCHANT_KEY: 'secret',
      EPAY_API_BASE_URL: 'https://pay.example.com',
      EPAY_CALLBACK_BASE_URL: 'https://api.example.com',
      EPAY_PUBLIC_SITE_URL: 'https://site.example.com'
    } as never, {
      orderNo: 'PH123',
      method: 'alipay',
      amountCents: 1000,
      name: '站内积分充值'
    });
    const url = new URL(checkout);
    expect(url.pathname).toBe('/submit.php');
    expect(url.protocol).toBe('https:');
    expect(url.searchParams.get('type')).toBe('alipay');
    expect(url.searchParams.get('out_trade_no')).toBe('PH123');
    expect(url.searchParams.get('sign')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('accepts WeChat and sends the browser return through the signed callback route', async () => {
    const parsed = checkoutSchema.parse({
      productId: 'points-10',
      paymentMethod: 'wxpay',
      returnTarget: 'canvas',
      returnPath: '/canvas/project-1'
    });
    expect(parsed.paymentMethod).toBe('wxpay');
    expect(() => checkoutSchema.parse({
      productId: 'points-10',
      paymentMethod: 'wxpay',
      returnTarget: 'canvas',
      returnPath: 'https://invalid.example'
    })).toThrow();

    const checkout = await createEpayCheckout({
      EPAY_MERCHANT_ID: '1000',
      EPAY_MERCHANT_KEY: 'secret',
      EPAY_API_BASE_URL: 'https://pay.example.com',
      EPAY_CALLBACK_BASE_URL: 'https://api.example.com'
    } as never, {
      orderNo: 'PH-WX-1',
      method: 'wxpay',
      amountCents: 1000,
      name: '站内积分充值'
    });
    const url = new URL(checkout);
    expect(url.searchParams.get('type')).toBe('wxpay');
    expect(url.searchParams.get('return_url')).toBe('https://api.example.com/api/v1/webhooks/epay/return');
  });

  it('keeps canvas returns on the reviewed canvas origin', () => {
    const env = {
      PUBLIC_SITE_URL: 'https://prompt-hubs.com',
      EPAY_CANVAS_SITE_URL: 'https://canvas.prompt-hubs.com'
    } as never;
    const target = resolvePaymentReturnUrl(env, 'canvas', '/canvas/project-1');
    expect(target).toBe('https://canvas.prompt-hubs.com/canvas/project-1');
    expect(appendPaymentResult(target, 'processing')).toBe(
      'https://canvas.prompt-hubs.com/canvas/project-1?payment=processing'
    );
    expect(safePaymentReturnUrl(env, 'https://invalid.example/canvas')).toBe('https://prompt-hubs.com');
  });
});

describe('legacy shop-code recovery', () => {
  it('accepts an unused commercial code disabled by the old purge job', () => {
    expect(isRecoverablePurgedShopCode({
      code: 'CR500-ABCDEFGHJKLM',
      note: 'purged-20260531',
      active: false,
      used_count: 0,
      max_uses: 1
    })).toBe(true);
  });

  it('does not revive demo, used, or manually disabled codes', () => {
    expect(isRecoverablePurgedShopCode({ code: 'PH-DEMO', note: 'purged-20260531', active: false, used_count: 0, max_uses: 1 })).toBe(false);
    expect(isRecoverablePurgedShopCode({ code: 'CR500-ABCDEFGHJKLM', note: 'purged-20260531', active: false, used_count: 1, max_uses: 1 })).toBe(false);
    expect(isRecoverablePurgedShopCode({ code: 'CR500-ABCDEFGHJKLM', note: 'manual-disabled', active: false, used_count: 0, max_uses: 1 })).toBe(false);
  });
});
