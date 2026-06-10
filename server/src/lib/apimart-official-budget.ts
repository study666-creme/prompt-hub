import { APIMART_OFFICIAL_BUDGET_RATIOS } from './image-size-options';

export { APIMART_OFFICIAL_BUDGET_RATIOS };

export function isApimartOfficialBudgetUpstream(upstream: string): boolean {
  return upstream.trim().toLowerCase() === 'gpt-image-2-official';
}

function normalizeOfficialResolution(resolution?: string): '1k' | '2k' | '4k' {
  const r = String(resolution || '1k').toLowerCase();
  if (r === '4k') return '4k';
  if (r === '2k') return '2k';
  return '1k';
}

/** 特价线可选比例（无 1:1） */
export function mapApimartOfficialBudgetRatio(ratio?: string): string {
  const r = String(ratio || '16:9').trim() || '16:9';
  if (r === '1:1') return '16:9';
  return (APIMART_OFFICIAL_BUDGET_RATIOS as readonly string[]).includes(r) ? r : '16:9';
}

/**
 * gpt-image-2-official 文档：size=比例字符串，resolution=1k|2k|4k，quality=low。
 * 勿传像素 size（会落错价档，例如 4K 被计成 ~$0.015 而非 ~$0.0127）。
 */
export function buildApimartOfficialBudgetRequestBody(params: {
  prompt: string;
  resolution: string;
  size?: string;
  refImageUrls?: string[];
}): Record<string, unknown> {
  const refs = params.refImageUrls?.length ? params.refImageUrls : undefined;
  return {
    model: 'gpt-image-2-official',
    prompt: params.prompt,
    size: mapApimartOfficialBudgetRatio(params.size),
    resolution: normalizeOfficialResolution(params.resolution),
    quality: 'low',
    n: 1,
    ...(refs ? { image_urls: refs } : {})
  };
}
