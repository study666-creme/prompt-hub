import { describe, expect, it } from 'vitest';
import {
  assertQuotedGenerationCost,
  assertSupportedImageParameters,
  isCanvasOriginMeta,
  parseImageGenerationRequestBody,
  publicGenerationRequestLookupPayload,
  resolveSupportedImageCount
} from './generate';

describe('recent creations canvas-origin filter', () => {
  it('keeps hub jobs that never carry canvas markers', () => {
    expect(isCanvasOriginMeta({})).toBe(false);
    expect(isCanvasOriginMeta({ provider: 'grsai', upstreamModel: 'gpt-image-2' })).toBe(false);
  });

  it('excludes jobs submitted from a canvas node', () => {
    expect(isCanvasOriginMeta({ projectId: 'project-1' })).toBe(true);
    expect(isCanvasOriginMeta({ nodeId: 'node-1' })).toBe(true);
    expect(isCanvasOriginMeta({ projectId: 'project-1', nodeId: 'node-1' })).toBe(true);
  });

  it('ignores blank or non-string markers instead of hiding hub jobs', () => {
    expect(isCanvasOriginMeta({ projectId: '   ' })).toBe(false);
    expect(isCanvasOriginMeta({ nodeId: '' })).toBe(false);
    expect(isCanvasOriginMeta({ projectId: 7 as never })).toBe(false);
  });
});

describe('image generation request idempotency key', () => {
  const base = { model: 'image2', prompt: 'draw a cat' };

  it('accepts and preserves a Canvas client request id', () => {
    expect(parseImageGenerationRequestBody({
      ...base,
      clientRequestId: 'canvas:image.request_001-test',
      product: 'canvas',
      projectId: 'project-1',
      nodeId: 'node-1'
    })).toMatchObject({
      clientRequestId: 'canvas:image.request_001-test',
      product: 'canvas',
      projectId: 'project-1',
      nodeId: 'node-1'
    });
  });

  it('keeps the key optional for existing clients', () => {
    expect(parseImageGenerationRequestBody(base).clientRequestId).toBeUndefined();
  });

  it('preserves the displayed credit quote for pre-debit verification', () => {
    expect(parseImageGenerationRequestBody({ ...base, quotedCredits: 5.5 }).quotedCredits).toBe(5.5);
  });

  it('preserves the free image model instead of redirecting it to the paid model', () => {
    expect(parseImageGenerationRequestBody({ ...base, model: 'image2-free' }).model).toBe('image2-free');
  });

  it('treats legacy resolution-valued quality as the resolution', () => {
    const parsed = parseImageGenerationRequestBody({ ...base, resolution: '1k', quality: '2k' });
    expect(parsed.resolution).toBe('2k');
    expect(parsed.quality).toBe('standard');
  });

  it('rejects keys outside the Canvas length or character contract', () => {
    expect(() => parseImageGenerationRequestBody({ ...base, clientRequestId: 'short' })).toThrow();
    expect(() => parseImageGenerationRequestBody({ ...base, clientRequestId: 'canvas request 001' })).toThrow();
    expect(() => parseImageGenerationRequestBody({ ...base, clientRequestId: 'canvas/request/001' })).toThrow();
  });

  it('only accepts multiple images when the model declares n/count', () => {
    expect(resolveSupportedImageCount(1, null)).toBe(1);
    expect(() => resolveSupportedImageCount(2, null)).toThrow();
    expect(() => resolveSupportedImageCount(2, {
      parameters: [{ name: 'quality', path: 'quality' }]
    } as never)).toThrow();
    expect(resolveSupportedImageCount(4, {
      parameters: [{ name: 'count', path: 'count', min: 1, max: 8 }]
    } as never)).toBe(4);
  });

  it('accepts up to 14 banana references despite stale missing or zero catalog limits', () => {
    const model = {
      id: 'lingtu-pro',
      upstream: 'nano-banana-pro',
      uiFamily: 'banana'
    } as never;
    const references = Array.from({ length: 14 }, (_, index) => `https://ref.test/${index}.png`);
    const request = parseImageGenerationRequestBody({
      ...base,
      model: 'lingtu-pro',
      refImageUrls: references
    });

    expect(() => assertSupportedImageParameters(model, request, {
      parameters: [{ name: 'images', path: 'images', max_items: 0 }]
    } as never)).not.toThrow();
    expect(() => assertSupportedImageParameters(model, request, {
      parameters: []
    } as never)).not.toThrow();
  });

  it('rejects a fifteenth banana reference before billing', () => {
    const request = parseImageGenerationRequestBody({
      ...base,
      model: 'lingtu-pro',
      refImageUrls: Array.from({ length: 15 }, (_, index) => `https://ref.test/${index}.png`)
    });
    expect(() => assertSupportedImageParameters({
      id: 'lingtu-pro',
      upstream: 'nano-banana-pro',
      uiFamily: 'banana'
    } as never, request, null)).toThrow('最多支持 14 张参考图');
  });

  it('accepts the same displayed and current price at credit precision', () => {
    expect(() => assertQuotedGenerationCost(5.54, 5.5)).not.toThrow();
    expect(() => assertQuotedGenerationCost(undefined, 5.5)).not.toThrow();
  });

  it('rejects a changed price before job creation or debit', () => {
    try {
      assertQuotedGenerationCost(5.5, 6);
      throw new Error('expected quote conflict');
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        code: 'CONFLICT',
        message: '价格已更新，本次未扣积分，请重新确认后生成'
      });
    }
  });
});

describe('generation request recovery projection', () => {
  it('returns the same public uncertainty for a video lookup without exposing upstream details', () => {
    const payload = publicGenerationRequestLookupPayload({
      id: 'video-job-uncertain',
      user_id: 'user-1',
      status: 'processing',
      credits_charged: 35,
      result_image_url: null,
      error_message: 'private upstream message',
      created_at: '2026-07-28T00:00:00.000Z',
      meta: {
        mediaType: 'video',
        progress: 30,
        upstreamTaskId: 'private-task-id',
        routeChannelId: 7,
        videoSubmitState: 'submitted',
        videoResultState: 'result_uncertain',
        videoResultErrorCode: 'result_uncertain'
      }
    });

    expect(payload).toEqual({
      jobId: 'video-job-uncertain',
      status: 'submission_unknown',
      progress: 30,
      errorMessage: '任务结果暂时无法确认，请勿重复生成'
    });
    expect(JSON.stringify(payload)).not.toContain('private');
    expect(JSON.stringify(payload)).not.toContain('routeChannelId');
  });
});
