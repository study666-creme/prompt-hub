import { ApiError } from './errors';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.deepseek.com').replace(/\/$/, '');
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
};

export type ChatCompletionResult = {
  content: string;
  usage: ChatCompletionUsage | null;
};

/** OpenAI 兼容的 /v1/chat/completions（DeepSeek 官方等） */
export async function submitChatCompletions(
  apiKey: string,
  baseUrl: string | undefined,
  params: { messages: ChatMessage[]; model?: string; thinking?: boolean }
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: params.model || 'deepseek-v4-flash',
    messages: params.messages,
    temperature: 0.7,
    max_tokens: 2048,
    stream: false
  };
  if (params.thinking) {
    body.thinking = { type: 'enabled' };
  }

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
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const content = choices[0]?.message?.content;
  if (!content || !String(content).trim()) {
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

  return { content: String(content).trim(), usage };
}
