import { describe, expect, it } from 'vitest';
import { extractAllImageUrls } from './apimart';

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
});
