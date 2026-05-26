import { describe, expect, it } from 'vitest';
import { LIKE_MILESTONE_REWARDS } from './like-milestone';

describe('like milestone config', () => {
  it('checks higher threshold first', () => {
    expect(LIKE_MILESTONE_REWARDS[0].threshold).toBe(1000);
    expect(LIKE_MILESTONE_REWARDS[1].threshold).toBe(100);
  });

  it('per-user claim caps', () => {
    expect(LIKE_MILESTONE_REWARDS.find(m => m.threshold === 100)?.maxClaimsPerUser).toBe(5);
    expect(LIKE_MILESTONE_REWARDS.find(m => m.threshold === 1000)?.maxClaimsPerUser).toBe(2);
  });
});
