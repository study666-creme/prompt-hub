import { ApiError } from './errors';

// 同步对话（stream:false）正常数十秒内返回；挂死的连接 90s 强制中断，让用户
// 拿到干净的 502 而不是边缘节点 100s 之后的 524。超时与断连同路径（未扣费
// 即报错），不会造成重复计费。
const CHAT_COMPLETIONS_TIMEOUT_MS = 90_000;

function apiBase(envBase?: string): string {
  const value = String(envBase || '').trim();
  if (!value) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '文字服务暂未配置');
  return value.replace(/\/$/, '');
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

/** OpenAI 兼容的 /v1/chat/completions。调用方必须显式提供目录解析后的模型。 */
export async function submitChatCompletions(
  apiKey: string,
  baseUrl: string | undefined,
  params: {
    messages: ChatMessage[];
    model: string;
    thinking?: boolean;
    reasoningEffort?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Array<Record<string, unknown>>;
    toolChoice?: unknown;
    /** 透传给上游的幂等键；有 clientRequestId 时携带，网络重试防重复消费 */
    idempotencyKey?: string;
  }
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: params.model,
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
      'Content-Type': 'application/json',
      ...(params.idempotencyKey
        ? { 'Idempotency-Key': params.idempotencyKey, 'X-Client-Request-Id': params.idempotencyKey }
        : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CHAT_COMPLETIONS_TIMEOUT_MS)
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
