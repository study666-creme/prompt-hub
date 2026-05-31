import { ApiError } from './errors';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function submitApimartChat(
  apiKey: string,
  baseUrl: string | undefined,
  params: { messages: ChatMessage[]; model?: string }
): Promise<string> {
  const res = await fetch(`${apiBase(baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model || 'gpt-4o-mini',
      messages: params.messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false
    })
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

  const choices =
    json && typeof json === 'object' && Array.isArray((json as { choices?: unknown }).choices)
      ? (json as { choices: Array<{ message?: { content?: string } }> }).choices
      : [];
  const content = choices[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '对话接口未返回内容');
  }
  return String(content).trim();
}
