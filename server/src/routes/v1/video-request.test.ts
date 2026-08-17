import { describe, expect, it } from 'vitest';
import type { NewApiCatalogModel, NewApiCatalogParameter } from '../../lib/newapi';
import { buildNewApiVideoRequestBody } from '../../lib/newapi-video';
import { parseVideoRequestBody, validateVideoRequest } from './video';

function videoModel(parameters: NewApiCatalogParameter[]): NewApiCatalogModel {
  return {
    id: 'video-model',
    upstreamModel: 'video-model',
    label: 'Video model',
    description: '',
    modality: 'video',
    operation: 'generate',
    order: 1,
    endpoint: { method: 'POST', path: '/api/v1/video', contentType: 'application/json' },
    parameters,
    pricing: { mode: 'fixed', unit: 'request', yuan: 0.01, credits: 1, quantityParameter: null }
  };
}

function field(
  name: string,
  type: NewApiCatalogParameter['type'] = 'string',
  extra: Partial<NewApiCatalogParameter> = {}
): NewApiCatalogParameter {
  return { name, path: name, label: name, type, required: false, ...extra };
}

describe('video request aliases', () => {
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

  it('normalizes native size and typed reference-role aliases', () => {
    const parsed = parseVideoRequestBody({
      model: 'kling-o3-pro-v2v-reference',
      prompt: 'restyle',
      seconds: 4,
      size: '1280x720',
      images: ['https://asset.test/frame.jpg'],
      style_references: ['https://asset.test/style.jpg'],
      element_references: ['https://asset.test/element.jpg'],
      input_video: 'https://asset.test/source.mp4'
    });

    expect(parsed).toMatchObject({
      duration: 4,
      resolution: '1280x720',
      referenceImages: ['https://asset.test/frame.jpg'],
      styleImages: ['https://asset.test/style.jpg'],
      elementImages: ['https://asset.test/element.jpg'],
      referenceVideos: ['https://asset.test/source.mp4']
    });
  });

  it('accepts S-2.5 current media limits and first/last frame aliases', () => {
    const referenceImages = Array.from({ length: 30 }, (_, index) => `https://asset.test/image-${index}.jpg`);
    const referenceVideos = Array.from({ length: 10 }, (_, index) => `https://asset.test/video-${index}.mp4`);
    const referenceAudios = Array.from({ length: 10 }, (_, index) => `https://asset.test/audio-${index}.mp3`);
    const parsed = parseVideoRequestBody({
      model: 'S-2.5-满血',
      prompt: 'animate',
      duration: 30,
      ratio: '1:1',
      resolution: '720p',
      referenceImages,
      referenceVideos,
      referenceAudios,
      first_image: 'https://asset.test/first.jpg',
      last_image: 'https://asset.test/last.jpg'
    });
    const parameters = [
      field('model', 'string', { fixed: 'S-2.5-满血' }),
      field('prompt'),
      field('duration', 'integer', { min: 4, max: 30 }),
      field('ratio', 'string', { options: ['16:9', '9:16', '1:1'] }),
      field('resolution', 'string', { options: ['480p', '720p'] }),
      field('referenceImages', 'array', { max_items: 30 }),
      field('referenceVideos', 'array', { max_items: 10 }),
      field('referenceAudios', 'array', { max_items: 10 }),
      field('first_image'),
      field('last_image')
    ];
    const model = videoModel(parameters);

    expect(parsed).toMatchObject({
      duration: 30,
      ratio: '1:1',
      resolution: '720p',
      referenceImages,
      referenceVideos,
      referenceAudios,
      startFrame: 'https://asset.test/first.jpg',
      endFrame: 'https://asset.test/last.jpg'
    });
    expect(() => validateVideoRequest(model, parsed)).not.toThrow();
    expect(buildNewApiVideoRequestBody({
      upstreamModel: parsed.model,
      prompt: parsed.prompt,
      duration: parsed.duration,
      ratio: parsed.ratio,
      resolution: parsed.resolution,
      referenceImages: parsed.referenceImages,
      referenceVideos: parsed.referenceVideos,
      referenceAudios: parsed.referenceAudios,
      startFrame: parsed.startFrame,
      endFrame: parsed.endFrame,
      catalogValues: parsed.catalogValues,
      catalogParameters: parameters
    })).toEqual({
      model: 'S-2.5-满血',
      prompt: 'animate',
      duration: 30,
      ratio: '1:1',
      resolution: '720p',
      referenceImages,
      referenceVideos,
      referenceAudios,
      first_image: 'https://asset.test/first.jpg',
      last_image: 'https://asset.test/last.jpg'
    });
  });

  it('carries typed canvas references through the catalog wire contract', () => {
    const parsed = parseVideoRequestBody({
      model: 'kling-o3-pro-v2v-reference',
      prompt: 'restyle',
      seconds: 4,
      size: '1280x720',
      images: ['https://asset.test/frame.jpg'],
      style_references: ['https://asset.test/style.jpg'],
      element_references: ['https://asset.test/element.jpg'],
      input_video: 'https://asset.test/source.mp4'
    });
    const parameters = [
      field('model', 'string', { fixed: 'kling-o3-pro-v2v-reference' }),
      field('prompt'),
      field('seconds', 'integer'),
      field('size'),
      field('referenceImages', 'array', { path: 'images', max_items: 2 }),
      field('style_references', 'array', { max_items: 1 }),
      field('element_references', 'array', { max_items: 1 }),
      field('referenceVideos', 'string', { path: 'input_video' }),
      field('n', 'integer', { fixed: 1 })
    ];

    expect(buildNewApiVideoRequestBody({
      upstreamModel: parsed.model,
      prompt: parsed.prompt,
      duration: parsed.duration,
      ratio: parsed.ratio,
      resolution: parsed.resolution,
      referenceImages: parsed.referenceImages,
      styleImages: parsed.styleImages,
      elementImages: parsed.elementImages,
      referenceVideos: parsed.referenceVideos,
      referenceAudios: parsed.referenceAudios,
      catalogValues: parsed.catalogValues,
      catalogParameters: parameters
    })).toEqual({
      model: 'kling-o3-pro-v2v-reference',
      prompt: 'restyle',
      seconds: 4,
      size: '1280x720',
      images: ['https://asset.test/frame.jpg'],
      style_references: ['https://asset.test/style.jpg'],
      element_references: ['https://asset.test/element.jpg'],
      input_video: 'https://asset.test/source.mp4',
      n: 1
    });
  });

  it('rejects conflicting native and compatibility size fields', () => {
    expect(() => parseVideoRequestBody({
      model: 'runway-gen4.5',
      prompt: 'animate',
      size: '1280x720',
      resolution: '720p'
    })).toThrow();
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
    expect(() => parseVideoRequestBody({
      model: 'S-2.5-满血',
      prompt: 'animate',
      start_frame: 'https://asset.test/a.jpg',
      first_image: 'https://asset.test/b.jpg'
    })).toThrow();
  });

  it('validates native seconds, size, and image declarations', () => {
    const model = videoModel([
      field('seconds', 'integer', { options: [5, 8, 10] }),
      field('size', 'string', { options: ['1280x720', '720x1280'] }),
      field('images', 'array', { max_items: 1 })
    ]);
    const valid = parseVideoRequestBody({
      model: 'runway-gen4.5',
      prompt: 'animate',
      duration: 5,
      resolution: '1280x720',
      referenceImages: ['https://asset.test/a.jpg']
    });

    expect(() => validateVideoRequest(model, valid)).not.toThrow();
    expect(() => validateVideoRequest(model, { ...valid, duration: 6 })).toThrow('不支持 6 秒时长');
    expect(() => validateVideoRequest(model, { ...valid, resolution: '720p' })).toThrow('不支持 720p 分辨率');
    expect(() => validateVideoRequest(model, { ...valid, referenceImages: ['https://asset.test/a.jpg', 'https://asset.test/b.jpg'] })).toThrow('最多支持 1 个参考图片');
  });

  it('accepts fixed values case-insensitively and enforces scalar media limits', () => {
    const model = videoModel([
      field('seconds', 'integer', { min: 4, max: 15 }),
      field('resolution', 'string', { fixed: '720P' }),
      field('aspect_ratio', 'string', { options: ['16:9', '9:16'] }),
      field('referenceVideos', 'string', { path: 'input_video' })
    ]);
    const valid = parseVideoRequestBody({
      model: 'kling-o3-pro-v2v-reference',
      prompt: 'restyle',
      seconds: 4,
      aspect_ratio: '16:9',
      resolution: '720p',
      referenceVideos: ['https://asset.test/source.mp4']
    });

    expect(() => validateVideoRequest(model, valid)).not.toThrow();
    expect(() => validateVideoRequest(model, {
      ...valid,
      referenceVideos: ['https://asset.test/source-a.mp4', 'https://asset.test/source-b.mp4']
    })).toThrow('最多支持 1 个参考视频');
  });
});
