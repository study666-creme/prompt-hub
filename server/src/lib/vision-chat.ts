import { ApiError } from './errors';

function apiBase(envBase?: string): string {
  return (envBase || 'https://api.apimart.ai').replace(/\/$/, '');
}

type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export async function submitVisionChat(
  apiKey: string,
  baseUrl: string | undefined,
  params: {
    system: string;
    userText: string;
    imageUrl: string;
    model?: string;
    maxTokens?: number;
  }
): Promise<string> {
  const userContent: VisionContentPart[] = [
    { type: 'text', text: params.userText },
    { type: 'image_url', image_url: { url: params.imageUrl } }
  ];

  const res = await fetch(`${apiBase(baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: userContent }
      ],
      temperature: 0.4,
      max_tokens: params.maxTokens ?? 1200
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
      err?.error?.message || `视觉理解接口失败 (${res.status})`
    );
  }

  const choices =
    json && typeof json === 'object' && Array.isArray((json as { choices?: unknown }).choices)
      ? (json as { choices: Array<{ message?: { content?: string } }> }).choices
      : [];
  const content = choices[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new ApiError(502, 'UPSTREAM_ERROR', '视觉理解接口未返回内容');
  }
  return String(content).trim();
}
