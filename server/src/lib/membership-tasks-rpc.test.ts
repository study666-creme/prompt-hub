import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from './supabase';

const mocks = vi.hoisted(() => ({
  syncMembershipCredits: vi.fn()
}));

vi.mock('./membership-credits', async importOriginal => ({
  ...await importOriginal<typeof import('./membership-credits')>(),
  syncMembershipCredits: mocks.syncMembershipCredits
}));

import { recordCanvasNodeCreated } from './membership-tasks';

const profile = {
  user_id: '11111111-1111-4111-8111-111111111111',
  credits: 0,
  membership_tier: 'basic',
  membership_until: '2026-07-28T00:00:00.000Z',
  membership_queued_tier: null,
  membership_queued_until: null,
  first_sub_offer_used: false,
  storage_bytes: 0,
  credit_grant_mode: 'daily',
  daily_credits: 13,
  daily_credits_date: '2026-07-27',
  bundle_granted_until: null,
  trial_free_used: false,
  lifetime_credits_spent: 0,
  membership_task_flags: { canvas_node_created: true }
} satisfies Profile;

describe('recordCanvasNodeCreated', () => {
  beforeEach(() => {
    mocks.syncMembershipCredits.mockReset().mockResolvedValue(profile);
  });

  it.each([
    [true, true],
    [false, false]
  ])('returns granted=%s from the atomic RPC response', async (rpcValue, expected) => {
    const rpc = vi.fn().mockResolvedValue({ data: { granted: rpcValue }, error: null });
    const result = await recordCanvasNodeCreated({ rpc } as never, profile.user_id);

    expect(rpc).toHaveBeenCalledWith('grant_canvas_create_node_reward', {
      p_user_id: profile.user_id
    });
    expect(mocks.syncMembershipCredits).toHaveBeenCalledWith(
      expect.objectContaining({ rpc }),
      profile.user_id
    );
    expect(result).toEqual({ granted: expected, profile });
  });

  it('does not hide database errors as a successful replay', async () => {
    const error = new Error('grant_canvas_create_node_reward is missing');
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    await expect(recordCanvasNodeCreated({ rpc } as never, profile.user_id)).rejects.toBe(error);
    expect(mocks.syncMembershipCredits).not.toHaveBeenCalled();
  });
});
