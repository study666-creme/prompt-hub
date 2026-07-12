import { ApiError } from './errors';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.deepseek.com').replace(/\/$/, '');
}

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
};

export type ChatCompletionResult = {
  content: string;
  usage: ChatCompletionUsage | null;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
};

export function normalizeToolArguments(value: unknown): string {
  if (value == null || value === '') return '{}';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '{}';
    }
  }
  return String(value);
}

/** OpenAI 兼容的 /v1/chat/completions（DeepSeek 官方等） */
export async function submitChatCompletions(
  apiKey: string,
  baseUrl: string | undefined,
  params: {
    messages: ChatMessage[];
    model?: string;
    thinking?: boolean;
    reasoningEffort?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Array<Record<string, unknown>>;
    toolChoice?: unknown;
  }
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: params.model || 'deepseek-v4-flash',
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 2048,
    stream: false
  };
  if (params.reasoningEffort) {
    body.reasoning_effort = params.reasoningEffort;
  } else if (params.thinking) {
    body.thinking = { type: 'enabled' };
  }
  if (params.tools?.length) body.tools = params.tools;
  if (params.toolChoice != null) body.tool_choice = params.toolChoice;

  const res = await fetch(`${apiBase(baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new ApiError(
      res.status >= 500 ? 502 : res.status,
      'UPSTREAM_ERROR',
      err?.error?.message || `对话接口失败 (${res.status})`
    );
  }

  const payload = json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: unknown };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const content = String(choices[0]?.message?.content || '').trim();
  const toolCalls = (choices[0]?.message?.tool_calls || [])
    .map(call => ({
      id: String(call.id || ''),
      type: 'function' as const,
      function: {
        name: String(call.function?.name || ''),
        arguments: normalizeToolArguments(call.function?.arguments)
      }
    }))
    .filter(call => call.id && call.function.name);
  if (!content && !toolCalls.length) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '对话接口未返回内容');
  }

  const usageRaw = payload.usage;
  const usage =
    usageRaw &&
    typeof usageRaw.prompt_tokens === 'number' &&
    typeof usageRaw.completion_tokens === 'number'
      ? {
          prompt_tokens: usageRaw.prompt_tokens,
          completion_tokens: usageRaw.completion_tokens,
          total_tokens: usageRaw.total_tokens
        }
      : null;

  return { content, usage, toolCalls, finishReason: choices[0]?.finish_reason || null };
}
