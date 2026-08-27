import { describe, expect, it } from 'vitest';
import {
  buildImagineBody,
  isMidjourneyUpstream,
  isMidjourneyModelId,
  mjVersionFromUpstream,
  parseMjImagineUrls
} from './midjourney-models';

describe('Midjourney generation helpers', () => {
  it('builds the documented APIMart request with fixed Relax speed', () => {
    const spec = mjVersionFromUpstream('mj-v81');
    expect(spec).toEqual({ version: '8.1' });
    expect(buildImagineBody(spec!, 'night city', {
      size: '16:9',
      refImageUrls: ['https://image.test/reference.png'],
      mj: {
        speed: 'turbo',
        quality: '1',
        stylize: 200,
        chaos: 10,
        weird: 15,
        negativePrompt: 'blurry',
        raw: true
      }
    })).toEqual({
      prompt: 'night city',
      version: '8.1',
      speed: 'relax',
      size: '16:9',
      image_urls: ['https://image.test/reference.png'],
      stylize: 200,
      chaos: 10,
      weird: 15,
      negative_prompt: 'blurry',
      quality: '1',
      raw: true
    });
  });

  it('recognizes current and legacy public ids', () => {
    expect(isMidjourneyModelId('mj-v81')).toBe(true);
    expect(isMidjourneyModelId('apimart-mj-v81')).toBe(true);
    expect(isMidjourneyModelId('Midjourney v8.2 高速')).toBe(true);
    expect(isMidjourneyUpstream('Midjourney v8.2 高速')).toBe(true);
    expect(isMidjourneyModelId('image2')).toBe(false);
  });

  it('orders one grid cover followed by four individual images', () => {
    const urls = [
      'https://image.test/grid.png',
      'https://image.test/tile-1.png',
      'https://image.test/tile-2.png',
      'https://image.test/tile-3.png',
      'https://image.test/tile-4.png'
    ];
    const parsed = parseMjImagineUrls(urls);

    expect(parsed.composite).toBe(urls[0]);
    expect(parsed.tiles).toEqual(urls.slice(1));
    expect(parsed.gallery).toEqual(urls);
  });
});
