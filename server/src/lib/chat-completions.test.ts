import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitChatCompletions } from './chat-completions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat completions tool messages', () => {
  it('passes assistant tool calls and tool results back to the upstream model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 2 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await submitChatCompletions('server-secret', 'https://newapi.example.com', {
      model: 'upstream-model',
      messages: [
        { role: 'user', content: 'inspect the canvas' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'canvas_get_state', arguments: '{}' }
          }]
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"nodes":[]}' }
      ],
      tools: [{ type: 'function', function: { name: 'canvas_get_state', parameters: { type: 'object' } } }],
      toolChoice: 'auto'
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].tool_calls[0].function.name).toBe('canvas_get_state');
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"nodes":[]}' });
    expect(body.tool_choice).toBe('auto');
  });

  it('returns upstream function calls without requiring text content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'canvas_create_text_node', arguments: '{"text":"hello"}' } }]
        },
        finish_reason: 'tool_calls'
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await submitChatCompletions('server-secret', 'https://newapi.example.com', {
      messages: [{ role: 'user', content: 'create a note' }]
    });

    expect(result.content).toBe('');
    expect(result.toolCalls[0]?.function.name).toBe('canvas_create_text_node');
    expect(result.finishReason).toBe('tool_calls');
  });

  it('serializes object arguments returned by OpenAI-compatible Grok routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_grok',
            type: 'function',
            function: { name: 'canvas_get_state', arguments: { includeViewport: true } }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await submitChatCompletions('server-secret', 'https://newapi.example.com', {
      model: 'grok-4.5',
      messages: [{ role: 'user', content: 'inspect the canvas' }],
      tools: [{ type: 'function', function: { name: 'canvas_get_state', parameters: { type: 'object' } } }]
    });

    expect(result.toolCalls[0]?.function.arguments).toBe('{"includeViewport":true}');
  });
});
