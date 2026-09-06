import { describe, expect, it, vi } from 'vitest';

import { encodePaymentOrderNote, type StoredPaymentOrder } from './epay';
import { collectPaymentOrderMonitor } from './payment-monitoring';

const NOW = Date.parse('2026-07-27T00:00:00.000Z');

function paymentOrder(
  state: NonNullable<StoredPaymentOrder['state']>,
  createdAt: string,
): StoredPaymentOrder {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    product_kind: 'credits',
    product_id: 'points-10',
    amount_cents: 1_000,
    credits: 1_000,
    membership_tier: null,
    membership_days: null,
    credit_grant_mode: null,
    payment_method: 'wxpay',
    created_at: createdAt,
    state,
  };
}

function monitoringAdmin(result: { data: unknown[] | null; error: unknown }) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.like = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn().mockResolvedValue(result);
  return {
    admin: { from: vi.fn(() => query) },
    query,
  };
}

describe('payment order monitoring', () => {
  it('counts order states and identifies only pending or processing orders older than ten minutes', async () => {
    const pendingAt = '2026-07-26T23:45:00.000Z';
    const processingAt = '2026-07-26T23:49:00.000Z';
    const paidAt = '2026-07-26T22:00:00.000Z';
    const failedAt = '2026-07-26T21:00:00.000Z';
    const { admin, query } = monitoringAdmin({
      data: [
        { code: 'PAYPENDING', used_count: 0, note: encodePaymentOrderNote(paymentOrder('pending', pendingAt)), created_at: pendingAt },
        { code: 'PAYPROCESSING', used_count: 1, note: encodePaymentOrderNote(paymentOrder('processing', processingAt)), created_at: processingAt },
        { code: 'PAYPAID', used_count: 1, note: encodePaymentOrderNote(paymentOrder('paid', paidAt)), created_at: paidAt },
        { code: 'PAYFAILED', used_count: 1, note: encodePaymentOrderNote(paymentOrder('failed', failedAt)), created_at: failedAt },
        { code: 'NOTPAYMENT', used_count: 0, note: 'unrelated', created_at: pendingAt },
      ],
      error: null,
    });

    const summary = await collectPaymentOrderMonitor(admin as never, NOW, 50);

    expect(summary).toMatchObject({
      available: true,
      total: 4,
      pending: 1,
      processing: 1,
      paid: 1,
      failed: 1,
      stale: 2,
    });
    expect(summary.staleOrders).toEqual([
      { orderNo: 'PAYPENDING', state: 'pending', createdAt: pendingAt },
      { orderNo: 'PAYPROCESSING', state: 'processing', createdAt: processingAt },
    ]);
    expect(query.like).toHaveBeenCalledWith('note', 'payment-order:%');
    expect(query.limit).toHaveBeenCalledWith(50);
  });

  it('reports an unavailable monitor without throwing when the database query fails', async () => {
    const { admin } = monitoringAdmin({ data: null, error: new Error('database unavailable') });

    await expect(collectPaymentOrderMonitor(admin as never, NOW)).resolves.toMatchObject({
      available: false,
      total: 0,
      stale: 0,
      error: 'database unavailable',
    });
  });
});
