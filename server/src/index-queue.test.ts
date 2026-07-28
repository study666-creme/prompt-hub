import { describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  process: vi.fn(),
  processVideo: vi.fn()
}));

vi.mock('./lib/fast-provider-queue', () => ({
  processFastProviderQueueMessage: queueMocks.process
}));

vi.mock('./lib/video-provider-queue', () => ({
  processVideoQueueMessage: queueMocks.processVideo
}));

import worker from './index';

describe('image generation queue consumer', () => {
  it('processes one five-message batch concurrently and acknowledges each item once', async () => {
    let active = 0;
    let maxActive = 0;
    queueMocks.process.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      return 'processed';
    });

    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `message-${index + 1}`,
      body: { jobId: `job-${index + 1}`, userId: 'user-1' },
      ack: vi.fn(),
      retry: vi.fn()
    }));

    await worker.queue({ messages } as never, {} as never);

    expect(queueMocks.process).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(5);
    for (const message of messages) {
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.retry).not.toHaveBeenCalled();
    }
  });

  it('routes video messages to the isolated video state machine', async () => {
    queueMocks.processVideo.mockResolvedValue('processed');
    const message = {
      id: 'video-message-1',
      body: { kind: 'video', jobId: 'video-job-1', userId: 'user-1' },
      ack: vi.fn(),
      retry: vi.fn()
    };

    await worker.queue({ messages: [message] } as never, {} as never);

    expect(queueMocks.processVideo).toHaveBeenCalledWith({}, message.body);
    expect(queueMocks.process).not.toHaveBeenCalledWith({}, message.body);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});
