import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  processImage: vi.fn(),
  processVideo: vi.fn()
}));

vi.mock('./lib/fast-provider-queue', () => ({
  processFastProviderQueueMessage: queueMocks.processImage
}));

vi.mock('./lib/video-provider-queue', () => ({
  processVideoQueueMessage: queueMocks.processVideo
}));

import worker from './index';

describe('generation queue consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMocks.processImage.mockResolvedValue('processed');
    queueMocks.processVideo.mockResolvedValue('processed');
  });

  it('routes video messages to the isolated video state machine', async () => {
    const message = {
      id: 'video-message-1',
      body: { kind: 'video', jobId: 'video-job-1', userId: 'user-1' },
      ack: vi.fn(),
      retry: vi.fn()
    };

    await worker.queue({ messages: [message] } as never, {} as never);

    expect(queueMocks.processVideo).toHaveBeenCalledWith({}, message.body);
    expect(queueMocks.processImage).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('keeps untagged image messages on the existing image consumer', async () => {
    const message = {
      id: 'image-message-1',
      body: { jobId: 'image-job-1', userId: 'user-1' },
      ack: vi.fn(),
      retry: vi.fn()
    };

    await worker.queue({ messages: [message] } as never, {} as never);

    expect(queueMocks.processImage).toHaveBeenCalledWith({}, message.body);
    expect(queueMocks.processVideo).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});
