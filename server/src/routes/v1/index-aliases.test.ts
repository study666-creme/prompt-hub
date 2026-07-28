import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import { v1 } from './index';

const env = { ENVIRONMENT: 'development', CORS_ORIGINS: '' } as Env;

describe('v1 compatibility aliases', () => {
  it('keeps the public wallet product catalog identical to payments', async () => {
    const [paymentsResponse, walletResponse] = await Promise.all([
      v1.request('http://localhost/payments/products', {}, env),
      v1.request('http://localhost/wallet/products', {}, env)
    ]);

    expect(paymentsResponse.status).toBe(200);
    expect(walletResponse.status).toBe(200);
    expect(await walletResponse.json()).toEqual(await paymentsResponse.json());
  });
});
