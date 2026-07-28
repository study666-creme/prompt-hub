import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const { createAdminClientMock, createEpayCheckoutMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createEpayCheckoutMock: vi.fn()
}));

vi.mock('../../lib/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/supabase')>(),
  createAdminClient: createAdminClientMock
}));

vi.mock('../../lib/epay', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/epay')>(),
  createEpayCheckout: createEpayCheckoutMock
}));

import {
  CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
  CUSTOM_CREDIT_PRODUCT_ID,
  decodePaymentOrderNote,
  encodePaymentOrderNote,
  type StoredPaymentOrder
} from '../../lib/epay';
import { paymentProductsHandler, paymentRoutes } from './payments';

const userId = '11111111-1111-4111-8111-111111111111';
const env = { ENVIRONMENT: 'development', CORS_ORIGINS: '' } as Env;

function productsApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/products', paymentProductsHandler);
  return app;
}

function checkoutApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, phoneVerified: false });
    await next();
  });
  app.route('/payments', paymentRoutes);
  app.onError((error, context) => jsonError(context, error));
  return app;
}

function checkout(body: Record<string, unknown>, bindings: Env = env) {
  return checkoutApp().request('http://localhost/payments/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, bindings);
}

function resolvedQuery(data: unknown, error: unknown = null) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return query;
}

describe('payment routes', () => {
  beforeEach(() => {
    createAdminClientMock.mockReset();
    createEpayCheckoutMock.mockReset();
  });

  it('publishes credit packages from CNY 10 and custom top-ups from CNY 5', async () => {
    const response = await productsApp().request('http://localhost/products', {}, env);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: true;
      data: Array<{ kind: string; id: string; amount: number; credits?: number }>;
      customCreditTopUp: {
        productId: string;
        minAmount: number;
        maxAmount: number;
        creditsPerYuan: number;
      };
    };
    const creditProducts = body.data.filter(product => product.kind === 'credits');

    expect(body.ok).toBe(true);
    expect(Math.min(...creditProducts.map(product => product.amount))).toBe(10);
    expect(creditProducts).toContainEqual({
      kind: 'credits',
      id: 'points-10',
      amount: 10,
      credits: 1000
    });
    expect(body.customCreditTopUp).toMatchObject({
      productId: CUSTOM_CREDIT_PRODUCT_ID,
      minAmount: 5,
      creditsPerYuan: 100
    });
  });

  it('keeps the Canvas seat product hidden until its database grant path is enabled', async () => {
    const disabled = await productsApp().request('http://localhost/products', {}, env);
    const disabledBody = await disabled.json() as { data: Array<{ id: string }> };
    expect(disabledBody.data.some(product => product.id === CANVAS_COLLABORATION_SEAT_PRODUCT_ID)).toBe(false);

    const enabledEnv = { ...env, CANVAS_COLLABORATION_SEAT_PRODUCT_ENABLED: '1' };
    const enabled = await productsApp().request('http://localhost/products', {}, enabledEnv);
    await expect(enabled.json()).resolves.toMatchObject({
      data: expect.arrayContaining([{
        kind: 'collaboration_seat',
        id: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
        amount: 15,
        seats: 1
      }])
    });
  });

  it('rejects a forged seat checkout while the product flag is disabled', async () => {
    const response = await checkout({
      productId: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
      paymentMethod: 'wxpay',
      returnTarget: 'canvas'
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PRODUCT_NOT_FOUND' }
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(createEpayCheckoutMock).not.toHaveBeenCalled();
  });

  it('creates a CNY 15 Canvas seat order only when the feature is enabled', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn(() => ({ insert: insertMock }));
    createAdminClientMock.mockReturnValue({ from: fromMock });
    createEpayCheckoutMock.mockResolvedValue('https://pay.example.test/checkout');
    const enabledEnv = { ...env, CANVAS_COLLABORATION_SEAT_PRODUCT_ENABLED: 'true' };

    const response = await checkout({
      productId: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
      paymentMethod: 'alipay',
      returnTarget: 'canvas'
    }, enabledEnv);

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith('payment_orders');
    const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      user_id: userId,
      product_kind: 'collaboration_seat',
      product_id: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
      amount_cents: 1500,
      quantity: 1,
      unit_amount_cents: 1500,
      payment_method: 'alipay',
      status: 'pending'
    });
    expect(createEpayCheckoutMock).toHaveBeenCalledWith(enabledEnv, expect.objectContaining({
      method: 'alipay',
      amountCents: 1500,
      name: 'Canvas 协作席位'
    }));
  });

  it.each([
    ['below the minimum', 4.99],
    ['more than two decimal places', 5.001]
  ])('rejects a custom amount %s before creating an order', async (_case, customAmount) => {
    const response = await checkout({
      productId: CUSTOM_CREDIT_PRODUCT_ID,
      customAmount,
      paymentMethod: 'wxpay',
      returnTarget: 'canvas'
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' }
    });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(createEpayCheckoutMock).not.toHaveBeenCalled();
  });

  it('creates a pending order for the minimum custom top-up', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn(() => ({ insert: insertMock }));
    createAdminClientMock.mockReturnValue({ from: fromMock });
    createEpayCheckoutMock.mockResolvedValue('https://pay.example.test/checkout');

    const response = await checkout({
      productId: CUSTOM_CREDIT_PRODUCT_ID,
      customAmount: 5,
      paymentMethod: 'wxpay',
      returnTarget: 'canvas'
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: true;
      data: { orderNo: string; checkoutUrl: string };
    };
    expect(body).toMatchObject({
      ok: true,
      data: { checkoutUrl: 'https://pay.example.test/checkout' }
    });
    expect(body.data.orderNo).toMatch(/^PAY[A-Z0-9]+$/);
    expect(fromMock).toHaveBeenCalledWith('activation_codes');
    expect(insertMock).toHaveBeenCalledOnce();

    const inserted = insertMock.mock.calls[0][0] as {
      code: string;
      credits: number;
      active: boolean;
      note: string;
    };
    expect(inserted).toMatchObject({
      code: body.data.orderNo,
      credits: 0,
      active: false
    });
    expect(decodePaymentOrderNote(inserted.note)).toMatchObject({
      user_id: userId,
      product_kind: 'credits',
      product_id: CUSTOM_CREDIT_PRODUCT_ID,
      amount_cents: 500,
      credits: 500,
      payment_method: 'wxpay',
      state: 'pending'
    });
    expect(createEpayCheckoutMock).toHaveBeenCalledWith(env, expect.objectContaining({
      orderNo: body.data.orderNo,
      method: 'wxpay',
      amountCents: 500
    }));
  });

  it.each([
    ['pending', 'pending', null],
    ['paid', 'paid', '2026-07-26T00:01:00.000Z'],
    ['refunded', 'refunded', '2026-07-26T00:01:00.000Z']
  ])('returns a durable Canvas seat order with %s status', async (storedStatus, publicStatus, paidAt) => {
    const orderNo = `PAYSEATQUERY${storedStatus.toUpperCase()}`;
    const durableQuery = resolvedQuery({
      order_no: orderNo,
      user_id: userId,
      status: storedStatus,
      product_kind: 'collaboration_seat',
      product_id: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
      amount_cents: 1500,
      paid_at: paidAt,
      created_at: '2026-07-26T00:00:00.000Z'
    });
    const fromMock = vi.fn((table: string) => {
      if (table === 'payment_orders') return durableQuery;
      throw new Error(`unexpected table query: ${table}`);
    });
    createAdminClientMock.mockReturnValue({ from: fromMock });

    const response = await checkoutApp().request(
      `http://localhost/payments/orders/${orderNo}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        orderNo,
        status: publicStatus,
        productKind: 'collaboration_seat',
        productId: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
        amount: 15,
        paidAt,
        createdAt: '2026-07-26T00:00:00.000Z'
      }
    });
    expect(durableQuery.eq).toHaveBeenNthCalledWith(1, 'order_no', orderNo);
    expect(durableQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', userId);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it('does not expose an order that is absent from the current user scope', async () => {
    const orderNo = 'PAYSEATOTHERUSER';
    const durableQuery = resolvedQuery(null);
    const otherUserOrder: StoredPaymentOrder = {
      user_id: '22222222-2222-4222-8222-222222222222',
      product_kind: 'collaboration_seat',
      product_id: CANVAS_COLLABORATION_SEAT_PRODUCT_ID,
      amount_cents: 1500,
      credits: 0,
      membership_tier: null,
      membership_days: null,
      collaboration_seats: 1,
      credit_grant_mode: null,
      payment_method: 'wxpay',
      created_at: '2026-07-26T00:00:00.000Z',
      state: 'paid'
    };
    const legacyQuery = resolvedQuery({
      code: orderNo,
      used_count: 1,
      note: encodePaymentOrderNote(otherUserOrder),
      created_at: otherUserOrder.created_at
    });
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => table === 'payment_orders' ? durableQuery : legacyQuery)
    });

    const response = await checkoutApp().request(
      `http://localhost/payments/orders/${orderNo}`,
      {},
      env
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'ORDER_NOT_FOUND' }
    });
    expect(durableQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', userId);
  });

  it('keeps a processing order unchanged for manual review', async () => {
    const orderNo = 'PAYPROCESSING1';
    const order: StoredPaymentOrder = {
      user_id: userId,
      product_kind: 'credits',
      product_id: CUSTOM_CREDIT_PRODUCT_ID,
      amount_cents: 500,
      credits: 500,
      membership_tier: null,
      membership_days: null,
      credit_grant_mode: null,
      payment_method: 'wxpay',
      created_at: '2026-07-01T00:00:00.000Z',
      state: 'processing',
      processing_at: '2026-07-01T00:01:00.000Z'
    };
    const updateMock = vi.fn();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          code: orderNo,
          used_count: 1,
          note: encodePaymentOrderNote(order),
          created_at: order.created_at
        },
        error: null
      }),
      update: updateMock
    };
    createAdminClientMock.mockReturnValue({ from: vi.fn(() => query) });

    const response = await checkoutApp().request(
      `http://localhost/payments/orders/${orderNo}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        orderNo,
        status: 'processing',
        productId: CUSTOM_CREDIT_PRODUCT_ID,
        amount: 5
      }
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(createEpayCheckoutMock).not.toHaveBeenCalled();
  });
});

