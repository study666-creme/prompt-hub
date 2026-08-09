import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const mocks = vi.hoisted(() => ({
  supabaseUpload: vi.fn()
}));

vi.mock('./supabase', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({ upload: mocks.supabaseUpload })
    }
  })
}));

import { uploadCardImage } from './r2-storage';

describe('r2-first uploads', () => {
  beforeEach(() => {
    mocks.supabaseUpload.mockReset();
  });

  it('keeps a successful R2 archive when the compatibility upload is too large', async () => {
    const r2Put = vi.fn(async () => undefined);
    mocks.supabaseUpload.mockResolvedValue({ error: { message: 'object exceeds file size limit' } });
    const env = {
      ENVIRONMENT: 'test',
      CORS_ORIGINS: '',
      SUPABASE_URL: 'https://storage.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      MEDIA_STORAGE_MODE: 'r2-first',
      CARD_IMAGES_R2: { put: r2Put }
    } as unknown as Env;

    await expect(
      uploadCardImage(env, 'user/generated/job.png', new ArrayBuffer(1024), 'image/png')
    ).resolves.toBeUndefined();
    expect(r2Put).toHaveBeenCalledOnce();
    expect(mocks.supabaseUpload).toHaveBeenCalledOnce();
  });

  it('still fails when the primary R2 archive fails', async () => {
    const env = {
      ENVIRONMENT: 'test',
      CORS_ORIGINS: '',
      SUPABASE_URL: 'https://storage.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      MEDIA_STORAGE_MODE: 'r2-first',
      CARD_IMAGES_R2: { put: vi.fn(async () => { throw new Error('r2 unavailable'); }) }
    } as unknown as Env;

    await expect(
      uploadCardImage(env, 'user/generated/job.png', new ArrayBuffer(1024), 'image/png')
    ).rejects.toThrow();
    expect(mocks.supabaseUpload).not.toHaveBeenCalled();
  });
});
