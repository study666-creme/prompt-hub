import { describe, expect, it } from 'vitest';
import type { NewApiCatalogModel, NewApiCatalogParameter } from '../../lib/newapi';
import { parseVideoRequestBody, resolveVideoRequest, validateVideoRequest, videoRequestFingerprint } from './video';

function videoModel(parameters: NewApiCatalogParameter[]): NewApiCatalogModel {
  return {
    id: 'video-model',
    upstreamModel: 'video-model',
    label: 'Video model',
    description: '',
    modality: 'video',
    operation: 'generate',
    order: 0,
    endpoint: { method: 'POST', path: '/v1/videos', contentType: 'application/json' },
    parameters,
    pricing: { mode: 'fixed', unit: 'request', credits: 1 }
  };
}

function durationParameter(input: Pick<NewApiCatalogParameter, 'fixed' | 'options' | 'min' | 'max'>): NewApiCatalogParameter {
  return {
    name: 'duration',
    path: 'duration',
    label: '时长',
    type: 'integer',
    required: false,
    ...input
  };
}

describe('video request aliases', () => {
  it('accepts and preserves a Canvas client request id', () => {
    expect(parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      clientRequestId: 'canvas:video.request_001-test',
      product: 'canvas',
      projectId: 'project-1',
      nodeId: 'node-1'
    })).toMatchObject({
      clientRequestId: 'canvas:video.request_001-test',
      product: 'canvas',
      projectId: 'project-1',
      nodeId: 'node-1'
    });
  });

  it('rejects invalid Canvas client request ids', () => {
    expect(() => parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      clientRequestId: 'canvas request 001'
    })).toThrow();
  });

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

  it('fingerprints the request parameters for idempotency conflict detection', async () => {
    const base = parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      referenceImages: ['https://asset.test/a.jpg']
    });
    const changed = parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 8,
      referenceImages: ['https://asset.test/a.jpg']
    });

    expect(await videoRequestFingerprint(base)).not.toBe(await videoRequestFingerprint(changed));
    expect(await videoRequestFingerprint(base)).toHaveLength(64);
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

describe('video duration catalog validation', () => {
  it('accepts the duration declared by a fixed catalog parameter', () => {
    const model = videoModel([durationParameter({ fixed: '8' })]);
    const input = resolveVideoRequest(
      model,
      parseVideoRequestBody({ model: model.id, prompt: 'animate this image', duration: 8 })
    );

    expect(() => validateVideoRequest(model, input)).not.toThrow();
  });

  it('uses a fixed catalog duration instead of a stale client value', () => {
    const model = videoModel([durationParameter({ fixed: 8 })]);
    const input = resolveVideoRequest(
      model,
      parseVideoRequestBody({ model: model.id, prompt: 'animate this image', duration: 4 })
    );

    expect(input.duration).toBe(8);
    expect(() => validateVideoRequest(model, input)).not.toThrow();
  });

  it('accepts every duration declared by catalog options', () => {
    const model = videoModel([durationParameter({ options: [4, '6', 8] })]);

    for (const duration of [4, 6, 8]) {
      const input = resolveVideoRequest(
        model,
        parseVideoRequestBody({ model: model.id, prompt: 'animate this image', duration })
      );
      expect(() => validateVideoRequest(model, input)).not.toThrow();
    }
  });

  it('rejects a duration outside catalog options', () => {
    const model = videoModel([durationParameter({ options: [4, 6, 8] })]);
    const input = resolveVideoRequest(
      model,
      parseVideoRequestBody({ model: model.id, prompt: 'animate this image', duration: 5 })
    );

    expect(() => validateVideoRequest(model, input)).toThrowError(
      expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR', message: '该模型仅支持 4、6、8 秒' })
    );
  });

  it('uses the first catalog option when duration is omitted', () => {
    const model = videoModel([durationParameter({ options: [6, 8] })]);
    const input = resolveVideoRequest(
      model,
      parseVideoRequestBody({ model: model.id, prompt: 'animate this image' })
    );

    expect(input.duration).toBe(6);
  });
});
