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

  it('keeps four standalone images as tiles when the primary hint is the first image', () => {
    const urls = [
      'https://image.test/result-a.png',
      'https://image.test/result-b.png',
      'https://image.test/result-c.png',
      'https://image.test/result-d.png'
    ];
    const parsed = parseMjImagineUrls(urls, urls[0]);

    expect(parsed.composite).toBeNull();
    expect(parsed.tiles).toEqual(urls);
    expect(parsed.gallery).toEqual(urls);
  });

  it('parses archived storage references without losing four-image gallery metadata', () => {
    const refs = [0, 1, 2, 3].map((index) => 'storage://card-images/user/generated/job-extra-' + index + '.png');
    const parsed = parseMjImagineUrls(refs);

    expect(parsed.composite).toBeNull();
    expect(parsed.primary).toBe(refs[0]);
    expect(parsed.tiles).toEqual(refs);
    expect(parsed.gallery).toEqual(refs);
  });
});
