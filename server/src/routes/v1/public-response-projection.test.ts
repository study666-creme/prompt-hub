import { describe, expect, it } from 'vitest';
import { publicChatCostPayload, publicChatQuotePayload } from './chat';
import { publicImageModelIdentity, publicWarehouseRecoveryPayload } from './generate';
import { publicPromptToolsInfoPayload } from './prompt-tools';
import { isPublicVideoContentResponse, projectPublicVideoPayload } from './video';

const PRIVATE_KEY_PATTERN = /(?:upstream|provider|reseller|channel|route|priority|weight|margin|markup|multiplier|costbase|pricingmodel|creditsvision|creditschat)/i;

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
}

describe('ordinary-user response projections', () => {
  it('publishes prompt tools as single reviewed products with final customer prices', () => {
    const payload = publicPromptToolsInfoPayload();
    expect(keysDeep(payload).some(key => PRIVATE_KEY_PATTERN.test(key))).toBe(false);
    expect(payload.reverse).toMatchObject({ model: 'vision-lite', creditsPerCall: 2 });
    expect(payload.fission).toMatchObject({ model: 'creative-fission', creditsPerPlanEstimate: 5 });
  });

  it('keeps chat quotes and charged cost limited to the final retail amount', () => {
    const quote = publicChatQuotePayload({
      model: 'private-upstream-route',
      modelLabel: 'Private Provider route 7',
      thinking: true,
      final: 3.2
    });
    expect(quote).toEqual({
      model: 'creative-model',
      modelLabel: '创作模型',
      thinking: true,
      final: 3.2
    });
    expect(publicChatCostPayload(2.4)).toEqual({ final: 2.4 });
  });

  it('falls back to a reviewed image identity for unknown stored model metadata', () => {
    expect(publicImageModelIdentity('private-upstream-model')).toEqual({
      model: 'image-model',
      modelLabel: '图片模型'
    });
    expect(publicImageModelIdentity('image2')).toMatchObject({ model: 'image2' });
  });

  it('hides warehouse recovery routing and infrastructure failure details', () => {
    const payload = publicWarehouseRecoveryPayload({
      imported: 0,
      repaired: 0,
      skipped: 1,
      failures: [{ jobId: 'job-1', reason: 'r2_upload_failed at provider route 7' }],
      cardIds: [],
      hint: 'private provider URL expired'
    });
    expect(payload).toMatchObject({
      imported: 0,
      repaired: 0,
      skipped: 1,
      failures: [{ jobId: 'job-1', reason: 'restore_failed' }],
      hint: '暂未找到可恢复图片，请稍后再试'
    });
  });

  it('does not serialize stored video routing metadata or raw failure text', () => {
    const payload = projectPublicVideoPayload(
      {
        id: 'video-job-1',
        status: 'failed',
        error_message: 'provider route 7 failed at https://private.example',
        credits_charged: 4.6,
        meta: {
          upstreamModel: 'private-video-model',
          routeChannelId: 7,
          credits: 4.6,
          progress: 42
        }
      },
      { model: 'private-upstream-video', modelLabel: 'Private Provider route 7' },
      88
    );

    expect(payload).toEqual({
      jobId: 'video-job-1',
      status: 'failed',
      model: 'video-model',
      modelLabel: '视频模型',
      progress: 42,
      videoUrl: null,
      errorMessage: '视频生成未完成，请调整参数后重试',
      creditsCharged: 4.6,
      creditsRemaining: 88
    });
    expect(keysDeep(payload).some(key => PRIVATE_KEY_PATTERN.test(key))).toBe(false);
  });

  it('publishes result uncertainty as a fixed non-retryable state without upstream details', () => {
    const payload = projectPublicVideoPayload(
      {
        id: 'video-job-uncertain',
        status: 'processing',
        error_message: 'private provider result lookup failed',
        credits_charged: 35,
        meta: {
          upstreamTaskId: 'private-task-id',
          routeChannelId: 7,
          credits: 35,
          progress: 30,
          videoSubmitState: 'submitted',
          videoResultState: 'result_uncertain',
          videoResultErrorCode: 'result_uncertain'
        }
      },
      { model: 'video-model', modelLabel: '视频模型' },
      65
    );

    expect(payload).toEqual({
      jobId: 'video-job-uncertain',
      status: 'submission_unknown',
      model: 'video-model',
      modelLabel: '视频模型',
      progress: 30,
      videoUrl: null,
      errorMessage: '任务结果暂时无法确认，请勿重复生成',
      creditsCharged: 35,
      creditsRemaining: 65
    });
    expect(keysDeep(payload).some(key => PRIVATE_KEY_PATTERN.test(key))).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('private');
    expect(JSON.stringify(payload)).not.toContain('result_uncertain');
  });

  it('does not proxy an upstream error document as video content', () => {
    expect(isPublicVideoContentResponse(false, 'application/json')).toBe(false);
    expect(isPublicVideoContentResponse(true, 'application/json')).toBe(false);
    expect(isPublicVideoContentResponse(true, 'video/mp4')).toBe(true);
    expect(isPublicVideoContentResponse(true, '')).toBe(true);
  });
});
