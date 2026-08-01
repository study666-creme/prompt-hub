import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNewApiVideoTask, submitNewApiVideo, validateNewApiVideoMediaBindings } from './newapi-video';

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

    expect(task).toEqual({
      id: 'task_public',
      status: 'queued',
      progress: 0,
      errorCode: null,
      errorMessage: null,
      videoUrl: null
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('uses catalog paths for frame, style, element, and single-video roles', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toMatchObject({
        images: ['https://asset.test/frame.jpg'],
        style_references: ['https://asset.test/style.jpg'],
        element_references: ['https://asset.test/element.jpg'],
        input_video: 'https://asset.test/source.mp4'
      });
      expect(body.image).toBeUndefined();
      expect(body.referenceImages).toBeUndefined();
      expect(body.referenceVideos).toBeUndefined();
      return json({ id: 'task-semantic-references', status: 'queued', progress: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'kling-o3-standard-v2v-reference',
      prompt: 'preserve the subject',
      duration: 14,
      ratio: '16:9',
      resolution: '720p',
      referenceImages: ['https://asset.test/frame.jpg'],
      styleImages: ['https://asset.test/style.jpg'],
      elementImages: ['https://asset.test/element.jpg'],
      referenceVideos: ['https://asset.test/source.mp4'],
      mediaBindings: {
        referenceImages: { path: 'images', type: 'array' },
        styleImages: { path: 'style_references', type: 'array' },
        elementImages: { path: 'element_references', type: 'array' },
        referenceVideos: { path: 'input_video', type: 'string' }
      }
    });
  });

  it('validates every persisted binding path before media is present', () => {
    expect(() => validateNewApiVideoMediaBindings({
      upstreamModel: 'video-model',
      prompt: 'test',
      duration: 5,
      ratio: '16:9',
      resolution: '720p',
      mediaBindings: {
        styleImages: { path: 'payload.__proto__.style_references', type: 'array' }
      }
    })).toThrowError(expect.objectContaining({
      status: 500,
      code: 'UPSTREAM_ERROR',
      message: '视频模型的素材字段配置无效'
    }));

    expect(() => validateNewApiVideoMediaBindings({
      upstreamModel: 'video-model',
      prompt: 'test',
      duration: 5,
      ratio: '16:9',
      resolution: '720p',
      mediaBindings: {
        referenceImages: { path: 'resolution', type: 'string' }
      }
    })).toThrowError(expect.objectContaining({
      status: 500,
      code: 'UPSTREAM_ERROR',
      message: '视频模型的素材字段配置冲突'
    }));
  });

  it('forwards a durable submission idempotency key only when provided', async () => {
    const fetchMock = vi.fn(async (_url, _init) => json({ id: 'task_idempotent', status: 'queued', progress: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await submitNewApiVideo('secret', 'https://newapi.test', {
      idempotencyKey: 'prompt-hub-video:job-123',
      upstreamModel: 'grok-video',
      prompt: 'slow camera move',
      duration: 6,
      ratio: '16:9',
      resolution: '720p'
    });
    await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'grok-video',
      prompt: 'slow camera move',
      duration: 6,
      ratio: '16:9',
      resolution: '720p'
    });

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'prompt-hub-video:job-123'
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('Idempotency-Key');
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
      return json({
        data: {
          id: 'request_1',
          status: 'completed',
          billed_duration_seconds: 4,
          audio: { url: 'https://video.test/sound.mp3' },
          video: { url: 'https://video.test/out.mp4' }
        }
      });
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
    expect(completed).toMatchObject({
      status: 'completed',
      videoUrl: 'https://video.test/out.mp4',
      billedDurationSeconds: 4
    });
  });

  it('forwards canonical size and first/last frame fields for New API to adapt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toMatchObject({
        size: '1280x720',
        first_image: 'https://asset.test/first.jpg',
        last_image: 'https://asset.test/last.jpg'
      });
      return json({ id: 'task-frames', status: 'queued' });
    }));

    await submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'frame-video',
      prompt: 'transition',
      duration: 5,
      ratio: '16:9',
      resolution: '720p',
      size: '1280x720',
      firstImage: 'https://asset.test/first.jpg',
      lastImage: 'https://asset.test/last.jpg'
    });
  });

  it('rejects an inline URL without a durable public task id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      status: 'completed',
      video_url: 'https://video.test/inline.mp4'
    })));

    await expect(submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'video-model',
      prompt: 'slow camera move',
      duration: 5,
      ratio: '16:9',
      resolution: '720p'
    })).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_ERROR',
      message: '视频接口没有返回任务 ID'
    });
  });

  it.each(['unknown', 'result_uncertain', 'outcome_unknown'])(
    'preserves a result uncertainty reported as %s',
    async status => {
      vi.stubGlobal('fetch', vi.fn(async () => json({
        id: 'task-uncertain',
        status,
        progress: 30,
        error: {
          code: 'result_uncertain',
          message: '任务结果暂时无法确认，请勿重复提交；额度保持预扣，正在等待核对'
        }
      })));

      await expect(fetchNewApiVideoTask('secret', 'https://newapi.test', 'task-uncertain')).resolves.toMatchObject({
        id: 'task-uncertain',
        status: 'unknown',
        progress: 30,
        errorCode: 'result_uncertain',
        errorMessage: '任务结果暂时无法确认，请勿重复提交；额度保持预扣，正在等待核对',
        videoUrl: null
      });
    }
  );

  it.each([
    { status: 'unknown', code: 'result_uncertain' },
    { status: 'failed', code: 'result_uncertain' }
  ])('preserves an uncertain initial submit reported as $status + $code', async ({ status, code }) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      id: 'task-submit-uncertain',
      status,
      progress: 30,
      error: {
        code,
        message: 'the accepted task outcome is still being reconciled'
      }
    })));

    await expect(submitNewApiVideo('secret', 'https://newapi.test', {
      upstreamModel: 'video-model',
      prompt: 'slow camera move',
      duration: 5,
      ratio: '16:9',
      resolution: '720p'
    })).resolves.toEqual({
      id: 'task-submit-uncertain',
      status: 'unknown',
      progress: 30,
      errorCode: 'result_uncertain',
      errorMessage: 'the accepted task outcome is still being reconciled',
      videoUrl: null
    });
  });

  it('preserves explicit result uncertainty when a lookup uses a generic failed 502 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      status: 'failed',
      progress: 30,
      error: {
        code: 'result_uncertain',
        message: 'the accepted task outcome is still being reconciled'
      }
    }, 502)));

    await expect(fetchNewApiVideoTask('secret', 'https://newapi.test', 'task-uncertain-502')).resolves.toEqual({
      id: 'task-uncertain-502',
      status: 'unknown',
      progress: 30,
      errorCode: 'result_uncertain',
      errorMessage: 'the accepted task outcome is still being reconciled',
      videoUrl: null
    });
  });
});
