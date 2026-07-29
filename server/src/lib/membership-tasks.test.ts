import { describe, expect, it } from 'vitest';
import type { Profile } from './supabase';
import {
  buildTaskList,
  countGrowthTasksClaimed,
  isTaskProgressMet,
  taskRewardForKey
} from './membership-tasks';

const profile: Profile = {
  user_id: '11111111-1111-4111-8111-111111111111',
  credits: 0,
  membership_tier: null,
  membership_until: null,
  membership_queued_tier: null,
  membership_queued_until: null,
  first_sub_offer_used: false,
  storage_bytes: 0,
  credit_grant_mode: 'daily',
  daily_credits: 0,
  daily_credits_date: null,
  bundle_granted_until: null,
  trial_free_used: false,
  lifetime_credits_spent: 0,
  membership_task_flags: {}
};

describe('canvas create-node membership task', () => {
  it('uses the fixed one-day basic membership reward', () => {
    expect(taskRewardForKey('canvas_create_node')).toMatchObject({
      days: 1,
      credits: 0,
      title: '在画布创建一个节点'
    });
  });

  it('becomes ready only after the server-backed progress flag is present', () => {
    expect(isTaskProgressMet('canvas_create_node', {}, profile, false)).toBe(false);
    expect(isTaskProgressMet(
      'canvas_create_node',
      { canvas_node_created: true },
      profile,
      false
    )).toBe(true);
  });

  it('is visible before completion and counted only once after the atomic grant', () => {
    const pending = buildTaskList(profile, {}, new Set(), false).items
      .find(item => item.key === 'canvas_create_node');
    expect(pending).toMatchObject({ ready: false, claimed: false, rewardDays: 1 });

    const claimedKeys = new Set(['canvas_create_node']);
    const claimed = buildTaskList(
      profile,
      { canvas_node_created: true },
      claimedKeys,
      false
    ).items.find(item => item.key === 'canvas_create_node');
    expect(claimed).toMatchObject({ ready: false, claimed: true });
    expect(countGrowthTasksClaimed(claimedKeys)).toBe(1);
  });
});
