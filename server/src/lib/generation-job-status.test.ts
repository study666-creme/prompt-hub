import { describe, expect, it } from 'vitest';
import { normalizeGenerationPollResult } from './generation-jobs';

describe('generation completion status contract', () => {
  it.each(['1k', '2k', '4k'])('keeps %s jobs recoverable until an image exists', (resolution) => {
    const result = normalizeGenerationPollResult({
      status: 'completed' as const,
      imageUrl: null,
      errorMessage: null,
      refunded: false,
      resolution
    });

    expect(result.status).toBe('processing');
    expect(result.imageUrl).toBeNull();
    expect(result.progressNote).toBe('图片已生成，正在同步到图库');
  });

  it('preserves completed when the image reference is deliverable', () => {
    const result = normalizeGenerationPollResult({
      status: 'completed' as const,
      imageUrl: 'storage://card-images/user-1/generated/job.png',
      errorMessage: null,
      refunded: false
    });

    expect(result.status).toBe('completed');
    expect(result.imageUrl).toContain('storage://');
  });
});
