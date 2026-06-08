import { describe, expect, it } from 'vitest';
import {
  buildMookoApiRequest,
  isMookoPlaceholderTaskId,
  parseMookoImagePayload
} from './mooko';

describe('mooko image payload', () => {
  it('parses OpenAI-style b64_json responses', () => {
    const payload = {
      created: 1740000000,
      data: [{ b64_json: 'aGVsbG8gd29ybGQgd29ybGQgd29ybGQgd29ybGQgd29ybGQ=' }]
    };
    const parsed = parseMookoImagePayload(payload);
    expect(parsed.taskId).toBeNull();
    expect(parsed.imageUrls[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('parses url responses and request_id', () => {
    const payload = {
      request_id: '202606080512046356073738268d9d6sQDALbhX',
      data: [{ url: 'https://gimg.mooko.ai/out/test.png' }]
    };
    const parsed = parseMookoImagePayload(payload);
    expect(parsed.taskId).toBe('202606080512046356073738268d9d6sQDALbhX');
    expect(parsed.imageUrls[0]).toBe('https://gimg.mooko.ai/out/test.png');
  });

  it('parses relative gimg url and task_id', () => {
    const payload = {
      created: 1777013921,
      task_id: 'task_abc',
      data: [{ url: '/p/img/img_abc/0?exp=1&sig=2' }]
    };
    const parsed = parseMookoImagePayload(payload);
    expect(parsed.taskId).toBe('task_abc');
    expect(parsed.imageUrls[0]).toBe('https://gimg.mooko.ai/p/img/img_abc/0?exp=1&sig=2');
  });

  it('detects placeholder task ids', () => {
    expect(isMookoPlaceholderTaskId('mooko-550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isMookoPlaceholderTaskId('202606080512046356073738268d9d6sQDALbhX')).toBe(false);
  });
});

describe('buildMookoApiRequest', () => {
  it('builds gpt-image-2 1K generations per Apifox doc', () => {
    const req = buildMookoApiRequest({
      upstreamModel: 'gpt-image-2',
      prompt: 'test',
      resolution: '1k',
      quality: 'high',
      size: '16:9'
    });
    expect(req.path).toBe('/v1/images/generations');
    expect(req.body).toEqual({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      size: '1792x1024'
    });
  });

  it('builds gpt-image-2-pro 2K generations with output_format', () => {
    const req = buildMookoApiRequest({
      upstreamModel: 'gpt-image-2-pro',
      prompt: 'test',
      resolution: '2k',
      quality: 'high',
      size: '1:1'
    });
    expect(req.path).toBe('/v1/images/generations');
    expect(req.body.model).toBe('gpt-image-2-pro');
    expect(req.body.size).toBe('2048x2048');
    expect(req.body.output_format).toBe('png');
    expect(req.body.quality).toBe('high');
    expect(req.body).not.toHaveProperty('upscale');
  });

  it('builds gpt-image-2-pro 4K with jpeg output_format', () => {
    const req = buildMookoApiRequest({
      upstreamModel: 'gpt-image-2-pro',
      prompt: 'test',
      resolution: '4k',
      quality: 'standard',
      size: '16:9'
    });
    expect(req.body.size).toBe('3840x2160');
    expect(req.body.output_format).toBe('jpeg');
  });

  it('routes pro reference images to /v1/images/edits with image field', () => {
    const req = buildMookoApiRequest({
      upstreamModel: 'gpt-image-2-pro',
      prompt: 'edit',
      resolution: '2k',
      quality: 'high',
      size: '1:1',
      refImageUrls: ['https://example.com/a.jpg']
    });
    expect(req.path).toBe('/v1/images/edits');
    expect(req.body.image).toEqual(['https://example.com/a.jpg']);
    expect(req.body).not.toHaveProperty('reference_images');
  });

  it('uses reference_images on gpt-image-2 generations', () => {
    const req = buildMookoApiRequest({
      upstreamModel: 'gpt-image-2',
      prompt: 'test',
      resolution: '1k',
      quality: 'standard',
      size: '1:1',
      refImageUrls: ['data:image/png;base64,abc']
    });
    expect(req.path).toBe('/v1/images/generations');
    expect(req.body.reference_images).toEqual(['data:image/png;base64,abc']);
  });
});
