import { describe, expect, it } from 'vitest';
import {
  buildGrsaiSubmitRequest,
  extractTaskId,
  isNanoBananaUpstreamModel,
  parseGrsaiResponseBody,
  parseGrsaiTaskPoll,
  resolveGrsaiSubmitPath
} from './grsai';

describe('GrsAI routing', () => {
  it('routes banana models to nano-banana endpoint', () => {
    expect(resolveGrsaiSubmitPath('nano-banana-2')).toBe('/v1/draw/nano-banana');
    expect(resolveGrsaiSubmitPath('nano-banana-pro-vip')).toBe('/v1/draw/nano-banana');
    expect(isNanoBananaUpstreamModel('nano-banana')).toBe(true);
  });

  it('routes gpt-image to completions endpoint', () => {
    expect(resolveGrsaiSubmitPath('gpt-image-2')).toBe('/v1/draw/completions');
    expect(isNanoBananaUpstreamModel('gpt-image-2-vip')).toBe(false);
  });

  it('builds nano-banana body with imageSize and aspectRatio', () => {
    const req = buildGrsaiSubmitRequest({
      upstreamModel: 'nano-banana-2',
      prompt: 'test',
      resolution: '2k',
      size: '4:3'
    });
    expect(req.path).toBe('/v1/draw/nano-banana');
    expect(req.body).toMatchObject({
      model: 'nano-banana-2',
      imageSize: '2K',
      aspectRatio: '4:3',
      webHook: '-1'
    });
    expect(req.body).not.toHaveProperty('size');
  });

  it('builds completions body with size for gpt-image-2', () => {
    const req = buildGrsaiSubmitRequest({
      upstreamModel: 'gpt-image-2',
      prompt: 'test',
      resolution: '1k',
      size: '4:3'
    });
    expect(req.path).toBe('/v1/draw/completions');
    expect(req.body).toMatchObject({
      model: 'gpt-image-2',
      size: '4:3',
      webHook: '-1'
    });
    expect(req.body).not.toHaveProperty('imageSize');
  });
});

describe('GrsAI task id parsing', () => {
  it('reads id from wrapped data', () => {
    expect(
      extractTaskId({ code: 0, data: { id: '9-679710cf-a1b2-c3d4-e5f678901234', status: 'running' } })
    ).toBe('9-679710cf-a1b2-c3d4-e5f678901234');
  });

  it('reads id when business code is non-zero but task exists', () => {
    expect(
      extractTaskId({
        code: -1,
        msg: '不存在该模型',
        data: { id: '15-d4422986-abcd-ef01-234567890abc' }
      })
    ).toBe('15-d4422986-abcd-ef01-234567890abc');
  });

  it('parses violation status in Chinese', () => {
    const body = { code: 0, data: { status: '违规', id: '13-dde6a366-abcd' } };
    expect(extractTaskId(body)).toBe('13-dde6a366-abcd');
    expect(parseGrsaiTaskPoll(body).status).toBe('failed');
    expect(parseGrsaiTaskPoll(body).isViolation).toBe(true);
  });

  it('parses violation from result_type with refunded credits', () => {
    const body = {
      code: 0,
      data: {
        result_type: '违规',
        credits: '积分已返还',
        id: '3-17b1e601-abcd'
      }
    };
    const poll = parseGrsaiTaskPoll(body);
    expect(poll.status).toBe('failed');
    expect(poll.isViolation).toBe(true);
  });

  it('parses success status in Chinese with image url', () => {
    const body = {
      code: 0,
      data: {
        status: '成功',
        id: '3-1e173028-7080-4d01-b735-14c96f22foc0',
        image_url: 'https://cdn.example.com/out.png'
      }
    };
    const poll = parseGrsaiTaskPoll(body);
    expect(poll.status).toBe('completed');
    expect(poll.imageUrl).toBe('https://cdn.example.com/out.png');
  });

  it('parses succeeded with results array url', () => {
    const body = {
      id: '14-5f3cf761-a4bb-486a-8016-77f490998f80',
      status: 'succeeded',
      results: [{ url: 'https://cdn.example.com/a.png' }]
    };
    const poll = parseGrsaiTaskPoll(body);
    expect(poll.status).toBe('completed');
    expect(poll.imageUrl).toBe('https://cdn.example.com/a.png');
  });

  it('treats succeeded without url as pending (not failed)', () => {
    const body = {
      status: '成功',
      id: '14-c38254-abcd',
      result_data: '{"id":"14-c38254-abcd"}'
    };
    expect(parseGrsaiTaskPoll(body).status).toBe('pending');
  });

  it('finds image url nested inside result_data json string', () => {
    const body = {
      status: '成功',
      id: '7-6207c7e5-1f72-4661-bd86-e39826ea3e9e',
      result_data:
        '{"id":"7-6207c7e5","results":[{"url":"https://cdn.example.com/banana.png"}]}'
    };
    const poll = parseGrsaiTaskPoll(body);
    expect(poll.status).toBe('completed');
    expect(poll.imageUrl).toBe('https://cdn.example.com/banana.png');
  });

  it('parses user gpt-image succeeded with empty top-level url', () => {
    const body = {
      id: '9-30783fe7-aef4-49e1-a78f-d7e506af6ede',
      status: 'succeeded',
      url: '',
      results: [{ url: 'https://file5.aitohumanize.com/file/2fff962d497c4838b1d5295454858b21.png' }]
    };
    const poll = parseGrsaiTaskPoll(body);
    expect(poll.status).toBe('completed');
    expect(poll.imageUrl).toBe('https://file5.aitohumanize.com/file/2fff962d497c4838b1d5295454858b21.png');
  });
});
