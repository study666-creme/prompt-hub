const PRIVATE_TEXT_PATTERN = /(?:\b(?:apimart|grsai|thinkai|ithink|mooko|new\s*api)\b|卡藏\s*api|上游|供应商|供货商|渠道|通道|线路|路由|采购|进货|成本|毛利|利润|倍率|加价|结算价|内部价|实时价|优先级|权重|故障转移|failover|upstream|provider|reseller|channel|route|priority|weight|margin|markup|multiplier|base\s*url)/i;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const URL_OR_DOMAIN_PATTERN = /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|cn|dev|app|cloud)(?:\/\S*)?/gi;

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(URL_OR_DOMAIN_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizePublicModelLabel(value: unknown, fallback = '模型'): string {
  const safeFallback = cleanText(fallback).slice(0, 80);
  const retained = cleanText(value)
    .split(/[|｜;；\n]+/)
    .map(part => part.trim())
    .filter(part => part && !PRIVATE_TEXT_PATTERN.test(part));
  const safe = retained.join('；').replace(/\s*[·•]\s*$/g, '').trim();
  return (safe || safeFallback || '模型').slice(0, 80);
}

export function sanitizePublicModelId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  if (!PUBLIC_ID_PATTERN.test(id)) return null;
  if (id.startsWith('_sf-') || PRIVATE_TEXT_PATTERN.test(id)) return null;
  return id;
}
