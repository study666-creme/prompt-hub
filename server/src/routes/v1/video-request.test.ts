import { describe, expect, it } from 'vitest';
import { parseVideoRequestBody } from './video';

describe('video request aliases', () => {
  it('keeps the original canvas request fields', () => {
    expect(parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      ratio: '16:9',
      referenceImages: ['https://asset.test/a.jpg']
    })).toMatchObject({
      duration: 6,
      ratio: '16:9',
      referenceImages: ['https://asset.test/a.jpg']
    });
  });

  it('normalizes the current canvas request fields', () => {
    expect(parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      seconds: 10,
      aspect_ratio: '9:16',
      images: ['https://asset.test/a.jpg', 'https://asset.test/b.jpg']
    })).toMatchObject({
      duration: 10,
      ratio: '9:16',
      referenceImages: ['https://asset.test/a.jpg', 'https://asset.test/b.jpg']
    });
  });

  it('normalizes the single image alias', () => {
    expect(parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      image: 'https://asset.test/a.jpg'
    }).referenceImages).toEqual(['https://asset.test/a.jpg']);
  });

  it('rejects conflicting aliases', () => {
    expect(() => parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      seconds: 10
    })).toThrow();
    expect(() => parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      image: 'https://asset.test/a.jpg',
      images: ['https://asset.test/b.jpg']
    })).toThrow();
  });
});
