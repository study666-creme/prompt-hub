import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNewApiVideoRequestBody, fetchNewApiVideoContent, fetchNewApiVideoTask, submitNewApiVideo } from './newapi-video';
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
        version: 'video.v1',
        model: 'sd2.0',
        operation: 'video_to_video',
        prompt: '镜头向前推进',
        duration_seconds: 8,
        aspect_ratio: '16:9',
        resolution: '720p',
        media_inputs: [
          { kind: 'image', role: 'reference', url: 'https://asset.test/a.jpg' },
          { kind: 'video', role: 'reference', url: 'https://asset.test/a.mp4' },
          { kind: 'audio', role: 'audio_reference', url: 'https://asset.test/a.mp3' }
        ],
        options: { async: true, n: 1 }
      });
      expect(body.duration).toBeUndefined();
      expect(body.referenceImages).toBeUndefined();
      return json({ id: 'task_public', status: 'queued', progress: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const task = await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'sd2.0',
      idempotencyKey: 'canvas:video-request-001',
      prompt: '镜头向前推进',
      duration: 8,
      ratio: '16:9',
      resolution: '720p',
      referenceImages: ['https://asset.test/a.jpg'],
      referenceVideos: ['https://asset.test/a.mp4'],
      referenceAudios: ['https://asset.test/a.mp3']
    });

    expect(task).toEqual({ id: 'task_public', status: 'queued', progress: 0, errorMessage: null, videoUrl: null });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Idempotency-Key': 'canvas:video-request-001'
    });
  });

  it('uses neutral Grok-compatible image fields and normalizes completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === 'POST') {
        const body = JSON.parse(String((init as RequestInit).body));
        expect(body.model).toBe('grok-video');
        expect(body.aspect_ratio).toBe('1:1');
        expect(body.media_inputs).toEqual([
          { kind: 'image', role: 'reference', url: 'https://asset.test/a.jpg' },
          { kind: 'image', role: 'reference', url: 'https://asset.test/b.jpg' }
        ]);
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

  it('retries briefly when completed content is not ready at the proxy yet', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? json({ error: { message: 'content warming up' } }, 425)
        : new Response('video-bytes', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }));

    const pending = fetchNewApiVideoContent('secret', 'https://newapi.test', 'task_content');
    await vi.runAllTimersAsync();
    const response = await pending;

    expect(calls).toBe(3);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('video-bytes');
    vi.useRealTimers();
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
        version: 'video.v1',
        model: 'minimax_h3',
        operation: 'image_to_video',
        prompt: '让画面中的主体自然运动',
        duration_seconds: 4,
        resolution: '768',
        aspect_ratio: '16:9',
        media_inputs: [
          { kind: 'image', role: 'reference', url: 'https://asset.test/reference.png' }
        ],
        options: { async: true, n: 1 }
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

  it('submits MiniMax H3 2K/4K through the native super-resolution workflow envelope', () => {
    const body = buildNewApiVideoRequestBody({
      upstreamModel: 'minimax_h3',
      prompt: '保持人物外观并自然运动',
      duration: 10,
      ratio: '16:9',
      resolution: '4K',
      referenceImages: ['https://asset.test/person.png'],
      catalogValues: { workflow_id: 'cf-multi-reference', size: '4K' },
      catalogParameters: [
        { name: 'seconds', path: 'seconds', label: '时长', type: 'integer', required: false },
        { name: 'size', path: 'size', label: '尺寸', type: 'string', required: false },
      ],
    });

    expect(body).toEqual({
      model: 'minimax_h3',
      prompt: '保持人物外观并自然运动',
      seconds: 10,
      workflow_id: 'cf-multi-reference',
      size: '4K',
      images: ['https://asset.test/person.png'],
    });
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('resolution');
    expect(body).not.toHaveProperty('aspect_ratio');
  });

  it('uses one protocol for legacy and native catalog wire dialects', () => {
    const field = (
      name: string,
      type: NewApiCatalogParameter['type'] = 'string',
      extra: Partial<NewApiCatalogParameter> = {}
    ): NewApiCatalogParameter => ({ name, path: name, label: name, type, required: false, ...extra });
    const base = (model: string): NewApiCatalogParameter[] => [
      field('model', 'string', { required: true, fixed: model }),
      field('prompt', 'string', { required: true })
    ];
    const cases = [
      {
        model: 'minimax_h3',
        parameters: [
          ...base('minimax_h3'),
          field('async', 'boolean', { fixed: true }),
          field('seconds', 'integer', { min: 4, max: 15 }),
          field('size', 'string', { options: ['768', '1080p'] }),
          field('images', 'array', { max_items: 9 }),
          field('reference_videos', 'array', { max_items: 3 }),
          field('reference_audios', 'array', { max_items: 3 })
        ]
      },
      {
        model: 'S-2.5-满血',
        parameters: [
          ...base('S-2.5-满血'),
          field('duration', 'integer', { min: 4, max: 30 }),
          field('ratio', 'string', { options: ['16:9', '9:16', '1:1'] }),
          field('resolution', 'string', { options: ['480p', '720p'] }),
          field('referenceImages', 'array', { max_items: 30 }),
          field('referenceVideos', 'array', { max_items: 10 }),
          field('referenceAudios', 'array', { max_items: 10 }),
          field('first_image'),
          field('last_image')
        ]
      },
      {
        model: 'kling-o3',
        parameters: [
          ...base('kling-o3'),
          field('seconds', 'integer', { options: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }),
          field('size', 'string', { options: ['1280x720', '720x1280'] }),
          field('aspect_ratio', 'string', { options: ['16:9', '9:16'] }),
          field('referenceImages', 'array', { path: 'reference_images', max_items: 6 }),
          field('referenceVideos', 'string', { path: 'input_video' }),
          field('generate_audio', 'boolean'),
          field('n', 'integer', { fixed: 1 })
        ]
      }
    ];

    for (const testCase of cases) {
      const body = buildNewApiVideoRequestBody({
        upstreamModel: testCase.model,
        prompt: 'animate',
        duration: 4,
        ratio: '16:9',
        resolution: testCase.model === 'minimax_h3' ? '768' : '720p',
        referenceImages: ['https://asset.test/image.png'],
        referenceVideos: ['https://asset.test/video.mp4'],
        referenceAudios: ['https://asset.test/audio.mp3'],
        startFrame: 'https://asset.test/first.png',
        endFrame: 'https://asset.test/last.png',
        catalogValues: { generate_audio: true },
        catalogParameters: testCase.parameters
      });
      expect(body).toMatchObject({
        version: 'video.v1',
        model: testCase.model,
        operation: 'video_to_video',
        prompt: 'animate',
        duration_seconds: 4,
        aspect_ratio: '16:9'
      });
      expect(body).not.toHaveProperty('seconds');
      expect(body).not.toHaveProperty('duration');
      expect(body).not.toHaveProperty('size');
      expect(body).not.toHaveProperty('referenceImages');
    }
  });

  it('keeps model controls in protocol options instead of catalog wire paths', () => {
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
      version: 'video.v1',
      model: 'native-video',
      operation: 'text_to_video',
      prompt: 'animate',
      duration_seconds: 6,
      resolution: '1280x720',
      aspect_ratio: '16:9',
      options: { async: true, n: 1, generate_audio: true }
    });
  });
});
