import { describe, expect, it } from 'vitest';
import {
  completeEpayOrder,
  decodePaymentOrderNote,
  encodePaymentOrderNote,
  moneyToCents,
  signEpay,
  type StoredPaymentOrder
} from './epay';

type Row = { code: string; used_count: number; note: string };
type DurableOrderRow = { order_no: string; product_kind: 'collaboration_seat' };

class FakeQuery {
  private action: 'select' | 'update' = 'select';
  private values: Record<string, unknown> = {};
  private filters: Record<string, unknown> = {};
  private wantsRow = false;

  constructor(private readonly db: FakePaymentDb, private readonly table: string) {}

  select(): this {
    this.wantsRow = true;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.action = 'update';
    this.values = values;
    return this;
  }

  upsert(_values: Record<string, unknown>, _options?: Record<string, unknown>): this {
    if (this.table === 'payment_webhook_events') this.db.monitoringWrites += 1;
    return this;
  }

  eq(field: string, value: unknown): this {
    this.filters[field] = value;
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve(this.execute());
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: unknown; error: null } {
    if (this.table === 'credit_ledger') {
      const refId = String(this.filters.ref_id || '');
      return { data: this.db.ledger.has(refId) ? { id: 'ledger-1' } : null, error: null };
    }

    if (this.table === 'payment_orders') {
      const matches = this.filters.order_no === undefined
        || this.filters.order_no === this.db.durableOrder?.order_no;
      return {
        data: matches && this.wantsRow && this.db.durableOrder ? { ...this.db.durableOrder } : null,
        error: null
      };
    }

    if (this.table !== 'activation_codes') return { data: null, error: null };
    const matches = this.filters.code === undefined || this.filters.code === this.db.order.code;
    const usedMatches = this.filters.used_count === undefined || this.filters.used_count === this.db.order.used_count;
    if (!matches || !usedMatches) return { data: null, error: null };
    if (this.action === 'update') Object.assign(this.db.order, this.values);
    return { data: this.wantsRow ? { ...this.db.order } : null, error: null };
  }
}

class FakePaymentDb {
  readonly ledger = new Set<string>();
  rpcCalls = 0;
  seatGrantCalls = 0;
  durableSettlementCalls = 0;
  durableSeatGrants = 0;
  monitoringWrites = 0;
  durableSettled = false;
  lastSettlementParams: Record<string, unknown> | null = null;

  constructor(readonly order: Row, readonly durableOrder: DurableOrderRow | null = null) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls += 1;
    if (name === 'settle_canvas_seat_payment') {
      this.durableSettlementCalls += 1;
      this.lastSettlementParams = params;
      if (!this.durableSettled) {
        this.durableSettled = true;
        this.durableSeatGrants += 1;
      }
      return { error: null };
    }
    if (name === 'canvas_grant_collaboration_seats') {
      this.seatGrantCalls += 1;
      return { error: null };
    }
    this.ledger.add(String(params.p_ref_id || ''));
    return { error: null };
  }
}

function signedCallback(orderNo: string, key = 'secret', money = '10.00') {
  const params = {
    pid: '1000',
    type: 'wxpay',
    out_trade_no: orderNo,
    trade_no: 'provider-1',
    trade_status: 'TRADE_SUCCESS',
    money
  };
  return { ...params, sign: signEpay(params, key), sign_type: 'MD5' };
}

function pendingOrder(orderNo: string): Row {
  const order: StoredPaymentOrder = {
    user_id: '11111111-1111-4111-8111-111111111111',
    product_kind: 'credits',
    product_id: 'points-10',
    amount_cents: 1000,
    credits: 1000,
    membership_tier: null,
    membership_days: null,
    credit_grant_mode: null,
    payment_method: 'wxpay',
    created_at: '2026-07-22T00:00:00.000Z',
    return_url: 'https://canvas-cn.prompt-hubs.com/canvas/project-1',
    state: 'pending'
  };
  return { code: orderNo, used_count: 0, note: encodePaymentOrderNote(order) };
}

function pendingSeatOrder(orderNo: string): Row {
  const order: StoredPaymentOrder = {
    user_id: '11111111-1111-4111-8111-111111111111',
    product_kind: 'collaboration_seat',
    product_id: 'canvas-collaboration-seat-1',
    amount_cents: 1500,
    credits: 0,
    membership_tier: null,
    membership_days: null,
    collaboration_seats: 1,
    credit_grant_mode: null,
    payment_method: 'wxpay',
    created_at: '2026-07-26T00:00:00.000Z',
    return_url: 'https://canvas.prompt-hubs.com/canvas',
    state: 'pending'
  };
  return { code: orderNo, used_count: 0, note: encodePaymentOrderNote(order) };
}

describe('EasyPay order settlement', () => {
  it('parses provider money without accepting hidden fractional cents', () => {
    expect(moneyToCents('15')).toBe(1500);
    expect(moneyToCents('15.0')).toBe(1500);
    expect(moneyToCents('15.00')).toBe(1500);
    expect(moneyToCents('15.001')).toBe(-1);
    expect(moneyToCents('not-money')).toBe(-1);
  });

  it('does not persist monitoring events for an invalid signature', async () => {
    const db = new FakePaymentDb(pendingOrder('PAY-WX-SIGNATURE'));
    const params = signedCallback(db.order.code);

    await expect(completeEpayOrder(db as never, { ...params, sign: 'invalid' }, {
      merchantId: '1000',
      merchantKey: 'secret'
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    expect(db.monitoringWrites).toBe(0);
    expect(db.rpcCalls).toBe(0);
  });

  it('credits a repeated successful WeChat callback exactly once', async () => {
    const db = new FakePaymentDb(pendingOrder('PAY-WX-1'));
    const params = signedCallback(db.order.code);

    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });
    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });

    expect(db.rpcCalls).toBe(1);
    expect(db.ledger.has(db.order.code)).toBe(true);
    expect(decodePaymentOrderNote(db.order.note)).toMatchObject({
      state: 'paid',
      provider_trade_no: 'provider-1'
    });
  });

  it('rejects a mismatched amount before granting credits', async () => {
    const db = new FakePaymentDb(pendingOrder('PAY-WX-2'));
    const params = signedCallback(db.order.code);
    const tampered = { ...params, money: '20.00' };
    tampered.sign = signEpay(tampered, 'secret');

    await expect(completeEpayOrder(db as never, tampered, { merchantId: '1000', merchantKey: 'secret' })).rejects.toThrow('支付金额不匹配');
    expect(db.rpcCalls).toBe(0);
    expect(decodePaymentOrderNote(db.order.note)?.state).toBe('pending');
  });

  it('leaves a processing order for manual review instead of granting again', async () => {
    const db = new FakePaymentDb(pendingOrder('PAY-WX-3'));
    const order = decodePaymentOrderNote(db.order.note);
    db.order.used_count = 1;
    db.order.note = encodePaymentOrderNote({
      ...order!,
      state: 'processing',
      processing_at: '2026-07-22T00:01:00.000Z'
    });

    await expect(
      completeEpayOrder(db as never, signedCallback(db.order.code), {
        merchantId: '1000',
        merchantKey: 'secret'
      })
    ).rejects.toMatchObject({ code: 'ORDER_PROCESSING' });

    expect(db.rpcCalls).toBe(0);
    expect(db.order.used_count).toBe(1);
    expect(decodePaymentOrderNote(db.order.note)).toMatchObject({
      state: 'processing',
      processing_at: '2026-07-22T00:01:00.000Z'
    });
  });

  it('grants a paid Canvas collaboration seat exactly once', async () => {
    const db = new FakePaymentDb(pendingSeatOrder('PAYSEAT1'));
    const params = signedCallback(db.order.code, 'secret', '15.00');

    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });
    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });

    expect(db.seatGrantCalls).toBe(1);
    expect(decodePaymentOrderNote(db.order.note)).toMatchObject({
      product_kind: 'collaboration_seat',
      collaboration_seats: 1,
      state: 'paid',
      provider_trade_no: 'provider-1'
    });
  });

  it('routes a durable seat order through the transactional settlement RPC', async () => {
    const durableOrder = { order_no: 'PAYSEATDURABLE1', product_kind: 'collaboration_seat' } as const;
    const db = new FakePaymentDb(pendingOrder('PAY-UNUSED'), durableOrder);
    const params = signedCallback(durableOrder.order_no, 'secret', '15.00');

    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });
    await completeEpayOrder(db as never, params, { merchantId: '1000', merchantKey: 'secret' });

    expect(db.durableSettlementCalls).toBe(2);
    expect(db.durableSeatGrants).toBe(1);
    expect(db.seatGrantCalls).toBe(0);
    expect(db.lastSettlementParams).toMatchObject({
      p_order_no: durableOrder.order_no,
      p_provider_trade_no: 'provider-1',
      p_payment_method: 'wxpay',
      p_amount_cents: 1500,
      p_event_id: 'epay:settled:provider-1'
    });
    expect(db.lastSettlementParams).not.toHaveProperty('sign');
  });
});
