import { describe, expect, it } from 'vitest';
import type { NewApiCatalogModel, NewApiCatalogParameter } from '../../lib/newapi';
import {
  parseVideoRequestBody,
  resolveVideoRequest,
  validateVideoRequest,
  videoMediaBindings,
  videoRequestFingerprint
} from './video';

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

  it('preserves semantic Canvas image roles', () => {
    expect(parseVideoRequestBody({
      model: 'kling-o3-standard-v2v-reference',
      prompt: 'preserve the subject',
      styleImages: ['https://asset.test/style.jpg'],
      elementImages: ['https://asset.test/element.jpg']
    })).toMatchObject({
      styleImages: ['https://asset.test/style.jpg'],
      elementImages: ['https://asset.test/element.jpg']
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

  it('keeps the legacy fingerprint when semantic image roles are empty', async () => {
    const legacy = parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      referenceImages: ['https://asset.test/a.jpg']
    });
    const explicitEmptyRoles = parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      referenceImages: ['https://asset.test/a.jpg'],
      styleImages: [],
      elementImages: []
    });
    const withStyle = parseVideoRequestBody({
      model: 'grok-video',
      prompt: 'animate this image',
      duration: 6,
      referenceImages: ['https://asset.test/a.jpg'],
      styleImages: ['https://asset.test/style.jpg']
    });

    expect(await videoRequestFingerprint(legacy)).toBe('f982426ba904caa6c8925de5709c67c11e3f71ccc66c2ae934497ff579e5ee41');
    expect(await videoRequestFingerprint(explicitEmptyRoles)).toBe(await videoRequestFingerprint(legacy));
    expect(await videoRequestFingerprint(withStyle)).not.toBe(await videoRequestFingerprint(legacy));
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

describe('video media catalog bindings', () => {
  const aggregateConstraint = {
    fields: ['images', 'style_references', 'element_references', 'input_video'],
    maxTotalItems: 4
  };
  const parameters: NewApiCatalogParameter[] = [
    durationParameter({ options: [14] }),
    { name: 'referenceImages', path: 'images', label: 'frames', type: 'array', required: false, max_items: 2, aggregateConstraint },
    { name: 'style_references', path: 'style_references', label: 'styles', type: 'array', required: false, max_items: 3, aggregateConstraint },
    { name: 'element_references', path: 'element_references', label: 'elements', type: 'array', required: false, max_items: 3, aggregateConstraint },
    { name: 'referenceVideos', path: 'input_video', label: 'source video', type: 'string', required: false, aggregateConstraint }
  ];

  it('uses parameter paths even when a legacy name points at a style slot', () => {
    const model = videoModel([
      durationParameter({ options: [5] }),
      { name: 'referenceImages', path: 'style_references', label: 'styles', type: 'array', required: false, max_items: 3 }
    ]);

    expect(videoMediaBindings(model)).toMatchObject({
      styleImages: { path: 'style_references', type: 'array' }
    });
    expect(videoMediaBindings(model).referenceImages).toBeUndefined();
  });

  it('accepts four semantic references and rejects the fifth before debit', () => {
    const model = videoModel(parameters);
    const accepted = resolveVideoRequest(model, parseVideoRequestBody({
      model: model.id,
      prompt: 'preserve the subject',
      duration: 14,
      referenceImages: ['https://asset.test/frame.jpg'],
      styleImages: ['https://asset.test/style.jpg'],
      elementImages: ['https://asset.test/element.jpg'],
      referenceVideos: ['https://asset.test/source.mp4']
    }));
    expect(() => validateVideoRequest(model, accepted)).not.toThrow();

    const rejected = {
      ...accepted,
      elementImages: ['https://asset.test/element-a.jpg', 'https://asset.test/element-b.jpg']
    };
    expect(() => validateVideoRequest(model, rejected)).toThrowError(
      expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR', message: '参考素材最多可使用 4 个' })
    );
  });

  it('rejects unsafe and conflicting binding paths during request validation', () => {
    const request = parseVideoRequestBody({
      model: 'video-model',
      prompt: 'preserve the subject',
      duration: 5,
      referenceImages: ['https://asset.test/frame.jpg']
    });
    const unsafe = videoModel([
      durationParameter({ options: [5] }),
      { name: 'referenceImages', path: 'payload.__proto__.images', label: 'frames', type: 'array', required: false, max_items: 1 }
    ]);
    const conflicting = videoModel([
      durationParameter({ options: [5] }),
      { name: 'referenceImages', path: 'resolution.images', label: 'frames', type: 'array', required: false, max_items: 1 }
    ]);

    expect(() => validateVideoRequest(unsafe, resolveVideoRequest(unsafe, request))).toThrowError(
      expect.objectContaining({ status: 500, code: 'UPSTREAM_ERROR', message: '视频模型的素材字段配置无效' })
    );
    expect(() => validateVideoRequest(conflicting, resolveVideoRequest(conflicting, request))).toThrowError(
      expect.objectContaining({ status: 500, code: 'UPSTREAM_ERROR', message: '视频模型的素材字段配置冲突' })
    );
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
