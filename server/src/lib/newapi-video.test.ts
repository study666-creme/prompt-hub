import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNewApiVideoRequestBody, fetchNewApiVideoTask, submitNewApiVideo } from './newapi-video';
import type { NewApiCatalogParameter } from './newapi';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('newapi video upstream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits SD video with reviewed multi-reference fields', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toMatchObject({
        model: 'sd2.0',
        prompt: '镜头向前推进',
        duration: 8,
        ratio: '16:9',
        resolution: '720p',
        referenceImages: ['https://asset.test/a.jpg'],
        referenceVideos: ['https://asset.test/a.mp4'],
        referenceAudios: ['https://asset.test/a.mp3']
      });
      expect(body.aspect_ratio).toBeUndefined();
      return json({ id: 'task_public', status: 'queued', progress: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const task = await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'sd2.0',
      prompt: '镜头向前推进',
      duration: 8,
      ratio: '16:9',
      resolution: '720p',
      referenceImages: ['https://asset.test/a.jpg'],
      referenceVideos: ['https://asset.test/a.mp4'],
      referenceAudios: ['https://asset.test/a.mp3']
    });

    expect(task).toEqual({ id: 'task_public', status: 'queued', progress: 0, errorMessage: null, videoUrl: null });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('uses neutral Grok-compatible image fields and normalizes completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === 'POST') {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.model).toBe('grok-video');
        expect(body.aspect_ratio).toBe('1:1');
        expect(body.images).toEqual(['https://asset.test/a.jpg', 'https://asset.test/b.jpg']);
        return json({ request_id: 'request_1', status: 'processing' });
      }
      return json({ data: { id: 'request_1', status: 'completed', video: { url: 'https://video.test/out.mp4' } } });
    }));

    const submitted = await submitNewApiVideo('secret', undefined, {
      upstreamModel: 'grok-video',
      prompt: 'rotate',
      duration: 5,
      ratio: '1:1',
      resolution: '720p',
      referenceImages: ['https://asset.test/a.jpg', 'https://asset.test/b.jpg']
    });
    const completed = await fetchNewApiVideoTask('secret', undefined, submitted.id);

    expect(submitted.id).toBe('request_1');
    expect(completed).toMatchObject({ status: 'completed', videoUrl: 'https://video.test/out.mp4' });
  });

  it('submits MiniMax H3 with native fields and preserves reference images', async () => {
    const parameters: NewApiCatalogParameter[] = [
      { name: 'model', path: 'model', label: '模型', type: 'string', required: true, fixed: 'minimax_h3' },
      { name: 'prompt', path: 'prompt', label: '提示词', type: 'string', required: true },
      { name: 'async', path: 'async', label: '异步任务', type: 'boolean', required: false, fixed: true },
      { name: 'seconds', path: 'seconds', label: '时长', type: 'integer', required: false, min: 4, max: 15 },
      { name: 'size', path: 'size', label: '分辨率', type: 'string', required: false, options: ['768', '1080p'] },
      { name: 'images', path: 'images', label: '参考图片', type: 'array', required: false, max_items: 9 },
      { name: 'reference_videos', path: 'reference_videos', label: '参考视频', type: 'array', required: false, max_items: 3 },
      { name: 'reference_audios', path: 'reference_audios', label: '参考音频', type: 'array', required: false, max_items: 3 },
      { name: 'duration', path: 'duration', label: '兼容时长', type: 'integer', required: false, min: 4, max: 15 },
      { name: 'resolution', path: 'resolution', label: '兼容分辨率', type: 'string', required: false, options: ['768', '1080p'] },
      { name: 'referenceImages', path: 'referenceImages', label: '兼容参考图片', type: 'array', required: false, max_items: 9 }
    ];
    const fetchMock = vi.fn(async (_url, init) => {
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        model: 'minimax_h3',
        prompt: '让画面中的主体自然运动',
        async: true,
        seconds: 4,
        size: '768',
        images: ['https://asset.test/reference.png']
      });
      return json({ id: 'h3_task', status: 'queued' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const task = await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'minimax_h3',
      prompt: '让画面中的主体自然运动',
      duration: 4,
      ratio: '16:9',
      resolution: '768',
      referenceImages: ['https://asset.test/reference.png'],
      catalogParameters: parameters
    });

    expect(task).toMatchObject({ id: 'h3_task', status: 'queued' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('builds every published canvas video model from its declared wire fields', () => {
    const field = (
      name: string,
      type: NewApiCatalogParameter['type'] = 'string',
      extra: Partial<NewApiCatalogParameter> = {}
    ): NewApiCatalogParameter => ({ name, path: name, label: name, type, required: false, ...extra });
    const base = (model: string): NewApiCatalogParameter[] => [
      field('model', 'string', { required: true, fixed: model }),
      field('prompt', 'string', { required: true })
    ];
    const legacy = (model: string, fixedDuration = false): NewApiCatalogParameter[] => [
      ...base(model),
      field('duration', 'integer', fixedDuration ? { fixed: 15 } : { min: 4, max: 15 }),
      field('ratio', 'string', { options: ['16:9', '9:16'] }),
      field('resolution', 'string', { options: ['480p', '720p', '1080p'] }),
      field('referenceImages', 'array', { max_items: 9 }),
      field('referenceVideos', 'array', { max_items: 3 }),
      field('referenceAudios', 'array', { max_items: 3 })
    ];
    const native = (model: string, image: NewApiCatalogParameter, video?: NewApiCatalogParameter, audio?: NewApiCatalogParameter): NewApiCatalogParameter[] => [
      ...base(model),
      field('seconds', 'integer', { min: 4, max: 15 }),
      field('size', 'string', { options: ['1280x720', '720x1280'] }),
      image,
      ...(video ? [video] : []),
      ...(audio ? [audio] : [])
    ];
    const refs = {
      referenceImages: ['https://asset.test/image.png'],
      referenceVideos: ['https://asset.test/video.mp4'],
      referenceAudios: ['https://asset.test/audio.mp3']
    };
    const cases: Array<{
      model: string;
      duration?: number;
      resolution: string;
      parameters: NewApiCatalogParameter[];
      expected: Record<string, unknown>;
    }> = [
      {
        model: 'minimax_h3',
        resolution: '768',
        parameters: [
          ...base('minimax_h3'),
          field('async', 'boolean', { fixed: true }),
          field('seconds', 'integer', { min: 4, max: 15 }),
          field('size', 'string', { options: ['768', '1080p'] }),
          field('images', 'array', { max_items: 9 }),
          field('reference_videos', 'array', { max_items: 3 }),
          field('reference_audios', 'array', { max_items: 3 }),
          field('duration', 'integer'),
          field('resolution'),
          field('referenceImages', 'array')
        ],
        expected: { model: 'minimax_h3', prompt: 'animate', async: true, seconds: 4, size: '768', images: refs.referenceImages, reference_videos: refs.referenceVideos, reference_audios: refs.referenceAudios }
      },
      ...['S-2.0满血-933', 'S-2.0-720p-稳定', 'S-2.0mini-官转', 'S-2.0fast-官转'].map(model => ({
        model,
        resolution: '720p',
        parameters: legacy(model, model === 'S-2.0满血-933'),
        expected: { model, prompt: 'animate', duration: model === 'S-2.0满血-933' ? 15 : 4, ratio: '16:9', resolution: '720p', referenceImages: refs.referenceImages, referenceVideos: refs.referenceVideos, referenceAudios: refs.referenceAudios }
      })),
      ...['S-videos-t-431-pro-720-5', 'S-videos-t-431-fast-720-5'].map(model => ({
        model,
        resolution: '720p',
        parameters: [
          ...base(model),
          field('seconds', 'integer', { options: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
          field('resolution', 'string', { fixed: '720P' }),
          field('aspect_ratio', 'string', { options: ['16:9', '9:16'] }),
          field('reference_images', 'array', { max_items: 4 }),
          field('video_references', 'array', { max_items: 3 }),
          field('audio_reference', 'array', { max_items: 1 }),
          field('motion_has_audio', 'boolean', { default: true }),
          field('n', 'integer', { fixed: 1 })
        ],
        expected: { model, prompt: 'animate', seconds: 4, resolution: '720P', aspect_ratio: '16:9', reference_images: refs.referenceImages, video_references: refs.referenceVideos, audio_reference: refs.referenceAudios, n: 1 }
      })),
      {
        model: 'runway-gen4.5',
        duration: 5,
        resolution: '1280x720',
        parameters: [
          ...base('runway-gen4.5'),
          field('seconds', 'integer', { options: [5, 8, 10] }),
          field('size', 'string', { options: ['1280x720', '720x1280'] }),
          field('images', 'array', { max_items: 1 }),
          field('n', 'integer', { fixed: 1 })
        ],
        expected: { model: 'runway-gen4.5', prompt: 'animate', seconds: 5, size: '1280x720', images: refs.referenceImages, n: 1 }
      },
      {
        model: 'kling-o3',
        resolution: '1280x720',
        parameters: [...native('kling-o3', field('referenceImages', 'array', { path: 'reference_images', max_items: 6 }), field('referenceVideos', 'string', { path: 'input_video' })), field('n', 'integer', { fixed: 1 })],
        expected: { model: 'kling-o3', prompt: 'animate', seconds: 4, size: '1280x720', reference_images: refs.referenceImages, input_video: refs.referenceVideos[0], n: 1 }
      },
      {
        model: 'kling-o3-pro-v2v-reference',
        resolution: '1280x720',
        parameters: [...native('kling-o3-pro-v2v-reference', field('referenceImages', 'array', { path: 'images', max_items: 2 }), field('referenceVideos', 'string', { path: 'input_video' })), field('n', 'integer', { fixed: 1 })],
        expected: { model: 'kling-o3-pro-v2v-reference', prompt: 'animate', seconds: 4, size: '1280x720', images: refs.referenceImages, input_video: refs.referenceVideos[0], n: 1 }
      },
      {
        model: 'kling-v3',
        resolution: '1280x720',
        parameters: [...native('kling-v3', field('referenceImages', 'array', { path: 'images', max_items: 2 })), field('n', 'integer', { fixed: 1 })],
        expected: { model: 'kling-v3', prompt: 'animate', seconds: 4, size: '1280x720', images: refs.referenceImages, n: 1 }
      },
      {
        model: 'kling-v3-omni-v2v-create',
        resolution: '1280x720',
        parameters: [...native('kling-v3-omni-v2v-create', field('referenceImages', 'array', { path: 'style_references', max_items: 3 }), field('referenceVideos', 'string', { path: 'input_video' })), field('n', 'integer', { fixed: 1 })],
        expected: { model: 'kling-v3-omni-v2v-create', prompt: 'animate', seconds: 4, size: '1280x720', style_references: refs.referenceImages, input_video: refs.referenceVideos[0], n: 1 }
      },
      ...['veo-3.1', 'veo-3.1-fast', 'veo-3.1-lite'].map(model => ({
        model,
        duration: model === 'veo-3.1-fast' ? 8 : 4,
        resolution: '1280x720',
        parameters: [
          ...base(model),
          field('seconds', 'integer', model === 'veo-3.1-fast' ? { fixed: 8 } : { options: [4, 6, 8] }),
          field('size', 'string', { options: ['1280x720', '720x1280', '1920x1080', '1080x1920'] }),
          field('images', 'array', { max_items: model === 'veo-3.1-lite' ? 2 : 3 }),
          field('n', 'integer', { fixed: 1 })
        ],
        expected: { model, prompt: 'animate', seconds: model === 'veo-3.1-fast' ? 8 : 4, size: '1280x720', images: refs.referenceImages, n: 1 }
      })),
      ...['S-videos-f-933-pro-3', 'S-videos-f-933-fast-3'].map(model => ({
        model,
        resolution: '720p',
        parameters: [...legacy(model, true), field('n', 'integer', { fixed: 1 })],
        expected: { model, prompt: 'animate', duration: 15, ratio: '16:9', resolution: '720p', referenceImages: refs.referenceImages, referenceVideos: refs.referenceVideos, referenceAudios: refs.referenceAudios, n: 1 }
      }))
    ];

    expect(cases).toHaveLength(17);
    for (const testCase of cases) {
      expect(buildNewApiVideoRequestBody({
        upstreamModel: testCase.model,
        prompt: 'animate',
        duration: testCase.duration ?? 4,
        ratio: '16:9',
        resolution: testCase.resolution,
        ...refs,
        catalogParameters: testCase.parameters
      }), testCase.model).toEqual(testCase.expected);
    }
  });

  it('forwards declared model controls and nested fixed paths without emitting compatibility aliases', () => {
    const parameters: NewApiCatalogParameter[] = [
      { name: 'model', path: 'model', label: 'model', type: 'string', required: true, fixed: 'native-video' },
      { name: 'prompt', path: 'prompt', label: 'prompt', type: 'string', required: true },
      { name: 'seconds', path: 'seconds', label: 'seconds', type: 'integer', required: false },
      { name: 'duration', path: 'duration', label: 'duration compatibility', type: 'integer', required: false },
      { name: 'size', path: 'size', label: 'size', type: 'string', required: false },
      { name: 'resolution', path: 'resolution', label: 'resolution compatibility', type: 'string', required: false },
      { name: 'generate_audio', path: 'options.generate_audio', label: 'audio', type: 'boolean', required: false },
      { name: 'n', path: 'options.count', label: 'count', type: 'integer', required: false, fixed: 1 }
    ];

    expect(buildNewApiVideoRequestBody({
      upstreamModel: 'native-video',
      prompt: 'animate',
      duration: 6,
      ratio: '16:9',
      resolution: '1280x720',
      catalogValues: { generate_audio: true, duration: 6, resolution: '1280x720' },
      catalogParameters: parameters
    })).toEqual({
      model: 'native-video',
      prompt: 'animate',
      seconds: 6,
      size: '1280x720',
      options: { generate_audio: true, count: 1 }
    });
  });
});
