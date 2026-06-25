import { describe, expect, it } from 'vitest';
import { buildApimartRequestBody, extractAllImageUrls, isApimartContentViolationMessage } from './apimart';

describe('buildApimartRequestBody', () => {
  it('builds wan2.7 text-to-image body', () => {
    const body = buildApimartRequestBody({
      upstreamModel: 'wan2.7-image',
      prompt: 'test',
      resolution: '2k',
      quality: 'high',
      size: '16:9'
    });
    expect(body).toEqual({
      model: 'wan2.7-image',
      prompt: 'test',
      size: '16:9',
      resolution: '2K',
      n: 1,
      thinking_mode: true
    });
  });

  it('builds flux-kontext without quality/resolution', () => {
    const body = buildApimartRequestBody({
      upstreamModel: 'flux-kontext-pro',
      prompt: 'blue cat',
      resolution: '1k',
      quality: 'high',
      size: '1:1'
    });
    expect(body).toEqual({
      model: 'flux-kontext-pro',
      prompt: 'blue cat',
      size: '1:1',
      n: 1
    });
  });

  it('builds flux-2-pro with resolution tier', () => {
    const body = buildApimartRequestBody({
      upstreamModel: 'flux-2-pro',
      prompt: 'landscape',
      resolution: '2k',
      quality: 'high',
      size: '16:9'
    });
    expect(body).toEqual({
      model: 'flux-2-pro',
      prompt: 'landscape',
      size: '16:9',
      resolution: '2K',
      n: 1
    });
  });

  it('builds gemini banana with resolution tier', () => {
    const body = buildApimartRequestBody({
      upstreamModel: 'gemini-3-pro-image-preview',
      prompt: 'moonlit bamboo',
      resolution: '2k',
      quality: 'high',
      size: '16:9'
    });
    expect(body).toEqual({
      model: 'gemini-3-pro-image-preview',
      prompt: 'moonlit bamboo',
      size: '16:9',
      resolution: '2K',
      n: 1
    });
  });
});

describe('isApimartContentViolationMessage', () => {
  it('detects Apimart prohibited content message', () => {
    expect(
      isApimartContentViolationMessage(
        'Please try a new call. Your current call may be flagged as containing prohibited words or images.'
      )
    ).toBe(true);
  });
});

describe('extractAllImageUrls', () => {
  it('collects every url in Apimart result.images[].url[]', () => {
    const payload = {
      data: {
        status: 'completed',
        result: {
          images: [
            {
              url: [
                'https://upload.apimart.ai/f/image/task_abc_0.png',
                'https://upload.apimart.ai/f/image/task_abc_1.png'
              ],
              expires_at: 1776835126
            }
          ]
        }
      }
    };
    expect(extractAllImageUrls(payload)).toEqual([
      'https://upload.apimart.ai/f/image/task_abc_0.png',
      'https://upload.apimart.ai/f/image/task_abc_1.png'
    ]);
  });

  it('collects multiple image objects', () => {
    const payload = {
      data: {
        result: {
          images: [
            { url: ['https://example.com/a.png'] },
            { url: ['https://example.com/b.png'] }
          ]
        }
      }
    };
    expect(extractAllImageUrls(payload)).toEqual([
      'https://example.com/a.png',
      'https://example.com/b.png'
    ]);
  });

  it('dedupes identical urls', () => {
    const payload = {
      data: {
        image_url: 'https://example.com/same.png',
        result: { images: [{ url: ['https://example.com/same.png'] }] }
      }
    };
    expect(extractAllImageUrls(payload)).toEqual(['https://example.com/same.png']);
  });

  it('prioritizes grid_image_url before image_urls tiles', () => {
    const payload = {
      data: {
        grid_image_url: 'https://cdn.apimart.ai/mj_xxxx.png',
        image_urls: [
          'https://cdn.apimart.ai/mj_xxxx_0.png',
          'https://cdn.apimart.ai/mj_xxxx_1.png',
          'https://cdn.apimart.ai/mj_xxxx_2.png',
          'https://cdn.apimart.ai/mj_xxxx_3.png'
        ]
      }
    };
    expect(extractAllImageUrls(payload)).toEqual([
      'https://cdn.apimart.ai/mj_xxxx.png',
      'https://cdn.apimart.ai/mj_xxxx_0.png',
      'https://cdn.apimart.ai/mj_xxxx_1.png',
      'https://cdn.apimart.ai/mj_xxxx_2.png',
      'https://cdn.apimart.ai/mj_xxxx_3.png'
    ]);
  });
});
