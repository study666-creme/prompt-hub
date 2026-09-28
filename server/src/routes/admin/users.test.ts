import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  writeAudit: vi.fn(async () => {})
}));

vi.mock('../../lib/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/supabase')>(),
  createAdminClient: mocks.createAdminClient
}));

vi.mock('../../middleware/admin-audit', async importOriginal => ({
  ...await importOriginal<typeof import('../../middleware/admin-audit')>(),
  writeAudit: mocks.writeAudit
}));

import { adminUserRoutes } from './users';

const userId = 'ab5c77dc-570e-4af7-ac38-2d311be96244';
const env = {
  ADMIN_API_SECRET: 'test-secret',
  ENVIRONMENT: 'development',
  CORS_ORIGINS: ''
} as unknown as Env;

function app() {
  const result = new Hono<{ Bindings: Env }>();
  result.route('/api/admin/users', adminUserRoutes);
  result.onError((error, context) => jsonError(context, error));
  return result;
}

function post(password: unknown, options: { secret?: string; userId?: string } = {}) {
  return app().request(
    `/api/admin/users/${options.userId ?? userId}/password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': options.secret ?? 'test-secret'
      },
      body: JSON.stringify({ password })
    },
    env
  );
}

beforeEach(() => {
  mocks.createAdminClient.mockReset();
  mocks.getUserById.mockReset();
  mocks.updateUserById.mockReset();
  mocks.writeAudit.mockClear();
  mocks.getUserById.mockResolvedValue({
    data: { user: { id: userId, email: '2705367723@qq.com' } },
    error: null
  });
  mocks.updateUserById.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.createAdminClient.mockReturnValue({
    auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } }
  });
});

describe('POST /api/admin/users/:userId/password', () => {
  it('改密走 Supabase Auth 管理接口，并且审计里不出现明文密码', async () => {
    const response = await post('qaqa15964');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: { userId, email: '2705367723@qq.com', passwordChanged: true }
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(userId, { password: 'qaqa15964' });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    const audit = mocks.writeAudit.mock.calls[0][1] as unknown;
    expect(JSON.stringify(audit)).not.toContain('qaqa15964');
    expect(audit).toMatchObject({ action: 'user.password', targetId: userId });
  });

  it('拒绝过短或过长的密码，且不触达上游', async () => {
    expect((await post('short')).status).toBe(400);
    expect((await post('x'.repeat(73))).status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('用户不存在时返回 404', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'User not found' } });

    const response = await post('qaqa15964');

    expect(response.status).toBe(404);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('上游改密失败时返回 502 并带上原因', async () => {
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: { message: 'Password is too weak' } });

    const response = await post('qaqa15964');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Password is too weak' }
    });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('没有管理员密钥时拒绝访问', async () => {
    const response = await post('qaqa15964', { secret: 'wrong-secret' });

    expect(response.status).toBe(401);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
});
