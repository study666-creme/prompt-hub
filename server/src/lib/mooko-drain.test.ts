import { describe, expect, it } from 'vitest';
import {
  countRunningMookoSubmits,
  maxConcurrentMookoSubmits,
  pickQueuedMookoJobs
} from './mooko-drain';
import type { JobRow } from './generation-jobs';

function mookoJob(id: string, state: string): JobRow {
  return {
    id,
    user_id: 'u1',
    prompt: 'test',
    status: 'processing',
    resolution: '2k',
    quality: 'high',
    size_label: '1:1',
    credits_charged: 5,
    result_image_url: null,
    error_message: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    meta: { provider: 'mooko', mookoSubmitState: state }
  };
}

describe('mooko-drain concurrency helpers', () => {
  it('defaults max concurrent to 8', () => {
    expect(maxConcurrentMookoSubmits({} as never)).toBe(8);
  });

  it('clamps env override between 1 and 16', () => {
    expect(maxConcurrentMookoSubmits({ MOOKO_MAX_CONCURRENT_SUBMITS: '20' } as never)).toBe(16);
    expect(maxConcurrentMookoSubmits({ MOOKO_MAX_CONCURRENT_SUBMITS: '0' } as never)).toBe(1);
  });

  it('counts running and picks queued slots', () => {
    const jobs = [
      mookoJob('a', 'running'),
      mookoJob('b', 'running'),
      mookoJob('c', 'queued'),
      mookoJob('d', 'queued'),
      mookoJob('e', 'queued')
    ];
    expect(countRunningMookoSubmits(jobs)).toBe(2);
    expect(pickQueuedMookoJobs(jobs, 2).map((j) => j.id)).toEqual(['c', 'd']);
  });
});
