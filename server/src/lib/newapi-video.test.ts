import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNewApiVideoTask, submitNewApiVideo } from './newapi-video';

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
});
