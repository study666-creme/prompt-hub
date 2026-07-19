/** 画面比例与像素映射；公开模型优先使用卡藏 API 实时参数。 */

export const IMAGE2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21'
] as const;

export const BANANA_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9'
] as const;

export const BANANA2_EXTRA_RATIOS = ['1:4', '4:1', '1:8', '8:1'] as const;

/** Flux 2.0 支持的 7 种宽高比 */
export const FLUX2_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const;

/** Flux Kontext 宽高比 */
export const FLUX_KONTEXT_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
  '9:21'
] as const;

/** 万相 2.7 常用比例 */
export const WAN27_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9'
] as const;

/** 常用五档（GrsAI 基础 / Apimart 备用 / ThinkAI 等） */
export const BASIC_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

/** Midjourney 常用宽高比 */
export const MJ_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;

/** official 特价：2K/4K low 均能保留至少一分钱毛差的比例 */
export const APIMART_OFFICIAL_BUDGET_RATIOS = [
  '3:1',
  '1:3',
  '21:9',
  '9:21',
  '2:1',
  '1:2',
  '16:9',
  '9:16'
] as const;

const OFFICIAL_BUDGET_MODEL_IDS = new Set([
  'image2-hd',
  'apimart-gpt-image-2-official-budget',
  'newapi-gpt-image-2-official-budget'
]);

/** 木瓜 gpt-image-2-pro 文档合法比例 */
export const MOOKO_PRO_ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'] as const;

const BANANA2_EXTENDED_MODEL_IDS = new Set([
  'lingtu-2',
  'nano-banana-2',
  'nano-banana-2-cl',
  'nano-banana-2-4k-cl'
]);

/** 按模型 ID 返回前台可选画面比例（勿全站统一长列表） */
export function aspectRatiosForModel(modelId: string): readonly string[] {
  const id = String(modelId || '')
    .trim()
    .toLowerCase();
  if (OFFICIAL_BUDGET_MODEL_IDS.has(id)) return APIMART_OFFICIAL_BUDGET_RATIOS;
  if (id === 'image2' || id === 'image2-economy' || id === 'image2-pro' || id === 'image2-4k-fast') {
    return IMAGE2_ASPECT_RATIOS;
  }
  if (BANANA2_EXTENDED_MODEL_IDS.has(id)) {
    return [...BANANA_ASPECT_RATIOS, ...BANANA2_EXTRA_RATIOS];
  }
  if (id.startsWith('lingtu')) return BANANA_ASPECT_RATIOS;
  if (id.startsWith('newapi-gpt-image-2')) return IMAGE2_ASPECT_RATIOS;
  if (id === 'apimart-gpt-image-2') return IMAGE2_ASPECT_RATIOS;
  if (id === 'apimart-seedream-5-lite' || id.includes('seedream')) return BASIC_ASPECT_RATIOS;
  if (id.startsWith('apimart-gemini') || id.includes('gemini-')) return BANANA_ASPECT_RATIOS;
  if (id.startsWith('apimart-mj-') || id.startsWith('mj-')) return MJ_ASPECT_RATIOS;
  if (id === 'gpt-image-2-vip' || id === 'gpt-image-2') return IMAGE2_ASPECT_RATIOS;
  if (id.includes('nano-banana')) return BANANA_ASPECT_RATIOS;
  if (id === 'mooko-gpt-image-2-pro') return MOOKO_PRO_ASPECT_RATIOS;
  if (id.includes('gpt-image-2')) return IMAGE2_ASPECT_RATIOS;
  return BASIC_ASPECT_RATIOS;
}

const GPT_IMAGE2_PIXEL: Record<'1k' | '2k' | '4k', Record<string, string>> = {
  '1k': {
    auto: '1024x1024',
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '5:4': '1280x1024',
    '4:5': '1024x1280',
    '16:9': '1536x864',
    '9:16': '864x1536',
    '2:1': '2048x1024',
    '1:2': '1024x2048',
    '3:1': '1536x512',
    '1:3': '512x1536',
    '21:9': '2016x864',
    '9:21': '864x2016'
  },
  '2k': {
    auto: '2048x2048',
    '1:1': '2048x2048',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '5:4': '2560x2048',
    '4:5': '2048x2560',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '2:1': '2688x1344',
    '1:2': '1344x2688',
    '3:1': '3072x1024',
    '1:3': '1024x3072',
    '21:9': '2688x1152',
    '9:21': '1152x2688'
  },
  '4k': {
    auto: '2880x2880',
    '1:1': '2880x2880',
    '3:2': '3520x2336',
    '2:3': '2336x3520',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '5:4': '3216x2576',
    '4:5': '2576x3216',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '2:1': '3840x1920',
    '1:2': '1920x3840',
    '3:1': '3840x1280',
    '1:3': '1280x3840',
    '21:9': '3840x1648',
    '9:21': '1648x3840'
  }
};

export function mapGptImage2PixelSize(
  resolution: string,
  ratio?: string
): string {
  const res = (['1k', '2k', '4k'].includes(resolution) ? resolution : '2k') as '1k' | '2k' | '4k';
  const r = String(ratio || '1:1').trim() || '1:1';
  return GPT_IMAGE2_PIXEL[res][r] || GPT_IMAGE2_PIXEL[res]['1:1'];
}

/** @deprecated 用 APIMART_OFFICIAL_BUDGET_RATIOS */
export const NO_SQUARE_ASPECT_RATIOS = APIMART_OFFICIAL_BUDGET_RATIOS;

/** 木瓜 gpt-image-2-pro：仅文档列出的比例 → 合法像素（其余比例映射到最近档） */
const MOOKO_PRO_PIXEL_2K: Record<string, string> = {
  auto: 'auto',
  '1:1': '2048x2048',
  '16:9': '2048x1152',
  '9:16': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1536x1024',
  '4:5': '1024x1536',
  '2:1': '2048x1152',
  '1:2': '1024x1536',
  '3:1': '2048x1152',
  '1:3': '1024x1536',
  '21:9': '2048x1152',
  '9:21': '1024x1536'
};

const MOOKO_PRO_PIXEL_4K: Record<string, string> = {
  auto: 'auto',
  '1:1': '2048x2048',
  '16:9': '3840x2160',
  '9:16': '2160x3840',
  '4:3': '3840x2160',
  '3:4': '2160x3840',
  '3:2': '3840x2160',
  '2:3': '2160x3840',
  '5:4': '3840x2160',
  '4:5': '2160x3840',
  '2:1': '3840x2160',
  '1:2': '2160x3840',
  '3:1': '3840x2160',
  '1:3': '2160x3840',
  '21:9': '3840x2160',
  '9:21': '2160x3840'
};

export function mapMookoProSize(resolution: string, ratio?: string): string {
  const is4k = String(resolution || '2k').toLowerCase() === '4k';
  const table = is4k ? MOOKO_PRO_PIXEL_4K : MOOKO_PRO_PIXEL_2K;
  const r = String(ratio || '1:1').trim() || '1:1';
  return table[r] || table['1:1'];
}
