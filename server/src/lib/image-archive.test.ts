import { describe, expect, it } from 'vitest';
import { isDataImageUrl, isStorageRef } from './image-archive';

describe('image-archive helpers', () => {
  it('detects data image urls', () => {
    expect(isDataImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isDataImageUrl('https://gimg.mooko.ai/x.png')).toBe(false);
    expect(isDataImageUrl('storage://card-images/u/gen.png')).toBe(false);
  });

  it('detects storage refs', () => {
    expect(isStorageRef('storage://card-images/u/generated/j1.png')).toBe(true);
    expect(isStorageRef('data:image/png;base64,x')).toBe(false);
  });
});
