import { describe, expect, it } from 'vitest';
import {
  generationJobImageRefAtIndex,
  parseGenerationRequestBody,
  publicGenerationErrorDetail,
  publicGenerationFailureCode
} from './generate';

describe('generation image gallery indexing', () => {
  const four = [0, 1, 2, 3].map((index) => 'storage://card-images/user/generated/four-' + index + '.png');
  const five = [0, 1, 2, 3, 4].map((index) => 'storage://card-images/user/generated/five-' + index + '.png');

  it('selects every API-station MJ image by its requested index', () => {
    const meta = { isMidjourney: true, mjGalleryUrls: four };
    expect(four.map((_, index) => generationJobImageRefAtIndex(four[0], meta, index))).toEqual(four);
  });

  it('preserves the cover-first legacy five-image ordering', () => {
    const meta = { isMidjourney: true, mjGalleryUrls: five, mjGridUrls: five.slice(1) };
    expect(five.map((_, index) => generationJobImageRefAtIndex(five[0], meta, index))).toEqual(five);
  });

  it('does not duplicate the primary image when a requested MJ index is missing', () => {
    expect(generationJobImageRefAtIndex(four[0], { isMidjourney: true, mjGalleryUrls: four }, 4)).toBeNull();
  });
});

describe('image generation request aliases', () => {
  it('normalizes the Canvas Midjourney payload before generic quality validation', () => {
    const parsed = parseGenerationRequestBody({
      model: 'mj-v81',
      prompt: 'cinematic city at night',
      size: 'auto',
      quality: '1',
      stylize: 250,
      chaos: 12,
      weird: 30,
      tile: false,
      raw: true,
      draft: false,
      hd: false,
      speed: 'turbo',
      n: 8
    });

    expect(parsed).toMatchObject({
      model: 'mj-v81',
      quality: 'standard',
      count: 1,
      mjParams: {
        quality: '1',
        stylize: 250,
        chaos: 12,
        weird: 30,
        tile: false,
        raw: true,
        draft: false,
        hd: false,
        speed: 'relax'
      }
    });
  });

  it('normalizes old APIMart MJ ids and reference field names', () => {
    const parsed = parseGenerationRequestBody({
      model: 'apimart-mj-niji7',
      prompt: 'anime character sheet',
      quality: '0.5',
      image_urls: ['https://image.test/reference.png'],
      negative_prompt: 'blurry',
      n: 1
    });

    expect(parsed.model).toBe('mj-niji7');
    expect(parsed.count).toBe(1);
    expect(parsed.refImageUrls).toEqual(['https://image.test/reference.png']);
    expect(parsed.mjParams).toMatchObject({
      quality: '0.5',
      negativePrompt: 'blurry',
      speed: 'relax'
    });
  });

  it('keeps non-MJ count and quality semantics unchanged', () => {
    const parsed = parseGenerationRequestBody({
      model: 'image2',
      prompt: 'product photo',
      quality: 'high',
      n: 3
    });

    expect(parsed.quality).toBe('high');
    expect(parsed.count).toBe(3);
    expect(parsed.mjParams).toBeUndefined();
  });

  it('preserves the canonical case of public image model ids', () => {
    const parsed = parseGenerationRequestBody({
      model: 'image2-A',
      prompt: 'clean product photograph',
      resolution: '4k',
      quality: 'high'
    });

    expect(parsed.model).toBe('image2-A');
    expect(parsed.resolution).toBe('4k');
    expect(parsed.quality).toBe('high');
  });

  it('accepts image.v1 without changing the legacy parsed shape', () => {
    const parsed = parseGenerationRequestBody({
      version: 'image.v1',
      model: 'image2',
      operation: 'image_to_image',
      prompt: 'make the product scene brighter',
      resolution: '1k',
      aspect_ratio: '16:9',
      quality: 'standard',
      count: 1,
      media_inputs: [
        { kind: 'image', role: 'reference', url: 'https://image.test/reference.png' }
      ]
    });

    expect(parsed).toMatchObject({
      model: 'image2',
      prompt: 'make the product scene brighter',
      resolution: '1k',
      size: '16:9',
      quality: 'standard',
      count: 1,
      refImageUrls: ['https://image.test/reference.png']
    });
  });

  it('projects image.v1 options into MJ parameters', () => {
    const parsed = parseGenerationRequestBody({
      version: 'image.v1',
      model: 'mj-v82',
      operation: 'text_to_image',
      prompt: 'cinematic city',
      aspect_ratio: '16:9',
      options: { raw: true, stylize: 250 }
    });

    expect(parsed).toMatchObject({
      model: 'mj-v82',
      quality: 'standard',
      count: 1,
      mjParams: { raw: true, stylize: 250, speed: 'relax' }
    });
  });
});

describe('public image generation failure codes', () => {
  it('classifies failures without returning raw provider details', () => {
    expect(publicGenerationFailureCode('TypeError: fetch failed')).toBe('UPSTREAM_CONNECTION_FAILED');
    expect(publicGenerationFailureCode('invalid model image2-A')).toBe('UPSTREAM_MODEL_REJECTED');
    expect(publicGenerationFailureCode('status 422: quality is required')).toBe('UPSTREAM_VALIDATION_FAILED');
    expect(publicGenerationFailureCode('upstream_image_archive_failed')).toBe('IMAGE_ARCHIVE_FAILED');
    expect(publicGenerationFailureCode('upstream_submission_unknown')).toBe('SUBMISSION_UNCONFIRMED');
  });

  it('explains that an unconfirmed paid submission was not automatically retried', () => {
    expect(publicGenerationErrorDetail('upstream_submission_unknown')).toBe(
      'SUBMISSION_UNCONFIRMED · 任务提交结果未能确认，系统已停止自动重试，积分已全额退回；请稍后重新提交'
    );
  });

  it('reports quota failures before generic 403 authentication failures', () => {
    const raw = 'HTTP 403 [insufficient_user_quota]: 请求被拒绝';
    expect(publicGenerationFailureCode(raw)).toBe('UPSTREAM_BALANCE_LOW');
    expect(publicGenerationErrorDetail(raw)).toBe(
      'HTTP 403 · UPSTREAM_BALANCE_LOW · 生图服务额度不足，请联系站长；您的积分已全额退回'
    );
  });

  it('does not mislabel a generic 403 rejection as parameter validation', () => {
    const raw = 'HTTP 403: 请求被拒绝';
    expect(publicGenerationFailureCode(raw)).toBe('UPSTREAM_AUTH_FAILED');
    expect(publicGenerationErrorDetail(raw)).toContain(
      'HTTP 403 · UPSTREAM_AUTH_FAILED · 生图服务认证或访问权限失败'
    );
    expect(publicGenerationErrorDetail(raw)).not.toContain('参数校验失败');
  });

  it('keeps an actionable validation reason while redacting structural secrets', () => {
    const raw = 'HTTP 422 [invalid_request]: quality 仅支持 standard；provider=GrsAI base_url=https://secret.example/v1 bearer sk-secret123456 cost=0.01';
    const detail = publicGenerationErrorDetail(raw);
    expect(detail).toContain('HTTP 422 · UPSTREAM_VALIDATION_FAILED · 参数校验失败');
    expect(detail).toContain('quality 仅支持 standard');
    expect(detail).not.toMatch(/GrsAI|secret\.example|sk-secret|0\.01|base_url|provider/i);
  });
});
