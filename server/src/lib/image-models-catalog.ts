export type ImageModelProvider = 'apimart' | 'newapi';

export type ImageModelUiFamily = 'gim2' | 'banana' | 'jimeng' | 'midjourney' | 'wan' | 'flux';

export type MjSpeedKey = 'relax' | 'fast' | 'turbo';

export type ImageModelCatalogEntry = {
  id: string;
  provider: ImageModelProvider;
  uiFamily: ImageModelUiFamily;
  /** 提交上游 API 的 model 字段 */
  upstream: string;
  label: string;
  group: 'new' | 'classic';
  description: string;
  /** 上游人民币成本，仅用于后台只读展示 */
  upstreamPoints: number;
  refundOnViolation: boolean;
  resolutions: ('1k' | '2k' | '4k')[];
  defaultCredits: number;
  pricingByResolution?: boolean;
  defaultCreditsByResolution?: Partial<Record<'1k' | '2k' | '4k', number>>;
  pricingBySpeed?: boolean;
  defaultCreditsBySpeed?: Partial<Record<MjSpeedKey, number>>;
  fixedQualityLow?: boolean;
  sortOrder: number;
};

type CatalogWithoutProvider = Omit<ImageModelCatalogEntry, 'provider'>;
type CatalogWithoutFamily = Omit<CatalogWithoutProvider, 'uiFamily'>;

function withFamily(
  uiFamily: ImageModelUiFamily,
  row: CatalogWithoutFamily
): CatalogWithoutProvider {
  return { ...row, uiFamily };
}

function gim2(row: CatalogWithoutFamily): CatalogWithoutProvider {
  return withFamily('gim2', row);
}

function banana(row: CatalogWithoutFamily): CatalogWithoutProvider {
  return withFamily('banana', row);
}

function midjourney(row: CatalogWithoutFamily): CatalogWithoutProvider {
  return withFamily('midjourney', row);
}

function newApi(row: CatalogWithoutProvider): ImageModelCatalogEntry {
  return { ...row, provider: 'newapi' };
}

function apimart(row: CatalogWithoutProvider): ImageModelCatalogEntry {
  return { ...row, provider: 'apimart' };
}

/**
 * 卡藏 API 线路的故障兜底目录。正常运行时由 /api/model-catalog 实时覆盖。
 */
export const NEWAPI_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  newApi(gim2({
    id: 'image2-economy',
    upstream: 'gpt-image-2-chat',
    label: '全能模型2 · 经济 1K',
    group: 'new',
    description: '低价文字生图，固定 1K，不支持参考图与尺寸设置',
    upstreamPoints: 0.025,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 2.5,
    sortOrder: 89
  })),
  newApi(gim2({
    id: 'image2',
    upstream: 'gpt-image-2',
    label: '全能模型2 · 1K',
    group: 'new',
    description: '标准生图模型，固定 1K',
    upstreamPoints: 0.055,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 5.5,
    sortOrder: 90
  })),
  newApi(gim2({
    id: 'image2-pro',
    upstream: 'gpt-image-2-ext',
    label: '全能模型2 · 高质量 2K/4K',
    group: 'new',
    description: '扩展版，2K/4K 分档，支持多比例',
    upstreamPoints: 0.15,
    refundOnViolation: true,
    resolutions: ['2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '2k': 15, '4k': 20 },
    defaultCredits: 15,
    sortOrder: 91
  })),
  newApi(gim2({
    id: 'image2-hd',
    upstream: 'image2k4k',
    label: '全能模型2 · 经济 2K/4K',
    group: 'new',
    description: '固定 low，2K/4K 分档，仅开放安全比例',
    upstreamPoints: 0,
    refundOnViolation: true,
    resolutions: ['2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '2k': 5.5, '4k': 9 },
    defaultCredits: 5.5,
    fixedQualityLow: true,
    sortOrder: 92
  })),
  newApi(banana({
    id: 'lingtu-fast',
    upstream: 'nano-banana-fast',
    label: '香蕉 · 极速 1K',
    group: 'new',
    description: '快速生图模型，固定 1K',
    upstreamPoints: 0.04,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 4,
    sortOrder: 93
  })),
  newApi(banana({
    id: 'lingtu-2',
    upstream: 'nano-banana-2',
    label: '香蕉 · 2代 1K/2K/4K',
    group: 'new',
    description: '通用生图模型，支持 1K/2K/4K',
    upstreamPoints: 0.09,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 9,
    sortOrder: 94
  })),
  newApi(banana({
    id: 'lingtu-pro',
    upstream: 'nano-banana-pro',
    label: '香蕉 · 专业 1K/2K/4K',
    group: 'new',
    description: '高质量通用生图模型，支持 1K/2K/4K',
    upstreamPoints: 0.13,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 13,
    sortOrder: 95
  })),
  newApi(banana({
    id: 'lingtu',
    upstream: 'nano-banana',
    label: '香蕉 · 标准 1K/2K/4K',
    group: 'new',
    description: '通用生图模型，支持 1K/2K/4K',
    upstreamPoints: 0.11,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 11,
    sortOrder: 96
  }))
];

/** MJ 继续使用 Apimart，并保留后台手动速度分档定价。 */
export const APIMART_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  apimart(midjourney({
    id: 'apimart-mj-v81',
    upstream: 'mj-v8.1',
    label: 'MJ v8.1',
    group: 'new',
    description: '最新主版本 · 写实/概念通用 · 细节与光影最佳',
    upstreamPoints: 0.1,
    refundOnViolation: true,
    resolutions: ['1k'],
    pricingBySpeed: true,
    defaultCreditsBySpeed: { relax: 8, fast: 10, turbo: 12 },
    defaultCredits: 8,
    sortOrder: 110
  })),
  apimart(midjourney({
    id: 'apimart-mj-v7',
    upstream: 'mj-v7',
    label: 'MJ v7',
    group: 'classic',
    description: '上一代主力 · 复杂构图稳定 · 风格均衡',
    upstreamPoints: 0.1,
    refundOnViolation: true,
    resolutions: ['1k'],
    pricingBySpeed: true,
    defaultCreditsBySpeed: { relax: 8, fast: 10, turbo: 12 },
    defaultCredits: 8,
    sortOrder: 111
  })),
  apimart(midjourney({
    id: 'apimart-mj-v61',
    upstream: 'mj-v6.1',
    label: 'MJ v6.1',
    group: 'classic',
    description: '经典 v6 · 风格稳定 · 适合批量出图',
    upstreamPoints: 0.1,
    refundOnViolation: true,
    resolutions: ['1k'],
    pricingBySpeed: true,
    defaultCreditsBySpeed: { relax: 8, fast: 10, turbo: 12 },
    defaultCredits: 8,
    sortOrder: 112
  })),
  apimart(midjourney({
    id: 'apimart-mj-niji7',
    upstream: 'mj-niji7',
    label: 'MJ Niji 7',
    group: 'new',
    description: '动漫/二次元专版 · 角色与插画表现力强',
    upstreamPoints: 0.1,
    refundOnViolation: true,
    resolutions: ['1k'],
    pricingBySpeed: true,
    defaultCreditsBySpeed: { relax: 8, fast: 10, turbo: 12 },
    defaultCredits: 8,
    sortOrder: 113
  }))
];

/** 当前可配置、可报价和可提交的完整图片目录。 */
export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  ...NEWAPI_IMAGE_MODEL_CATALOG,
  ...APIMART_IMAGE_MODEL_CATALOG
];

export function isPublicNewApiImageEntry(entry: ImageModelCatalogEntry): boolean {
  return entry.provider === 'newapi' && (entry.uiFamily === 'gim2' || entry.uiFamily === 'banana');
}

export function isRetainedPublicImageEntry(entry: ImageModelCatalogEntry): boolean {
  return isPublicNewApiImageEntry(entry)
    || (entry.provider === 'apimart' && entry.uiFamily === 'midjourney');
}

export function imageModelUiFamily(modelId: string): ImageModelUiFamily {
  const entry = getCatalogEntry(modelId);
  if (entry?.uiFamily) return entry.uiFamily;
  const id = String(modelId || '').toLowerCase();
  if (id.startsWith('apimart-mj-')) return 'midjourney';
  if (id.includes('seedream') || id === 'jimeng') return 'jimeng';
  if (id.includes('banana')) return 'banana';
  return 'gim2';
}

export function providerLabel(_provider: ImageModelProvider): string {
  return '';
}

/** 前台模型说明不暴露内部供应商名。 */
export function sanitizePublicModelDescription(description: string | null | undefined): string {
  if (!description) return '';
  let value = String(description).trim();
  value = value.replace(/^(Apimart|GrsAI|ThinkAI|Mooko|木瓜|OpenAI|Gemini|备用线路)\s*[·•]\s*/gi, '');
  value = value.replace(/\b(Apimart|OpenAI|Gemini|gpt-image-2|official|备用线路)\b\s*[·•]?\s*/gi, '');
  value = value.replace(/\s*[·•]\s*出图速度可选\s*relax\s*\/\s*fast\s*\/\s*turbo/gi, '');
  value = value.replace(/\s*[·•]\s*$/g, '').trim();
  if (/^(OpenAI|Gemini|gpt-image|备用线路)/i.test(value)) return '';
  return value;
}

const LEGACY_MODEL_MAP: Record<string, string> = {
  quanneng2: 'image2',
  'gpt-image-2-chat': 'image2-economy',
  'gpt-image-2': 'image2',
  'gpt-image-2-vip': 'image2-pro',
  jimeng: 'lingtu-pro',
  'nano-banana-fast': 'lingtu-fast',
  'nano-banana-2': 'lingtu-2',
  'nano-banana-pro': 'lingtu-pro',
  'nano-banana-pro-vt': 'lingtu-pro',
  'nano-banana-pro-vip': 'lingtu-pro',
  'nano-banana-pro-cl': 'lingtu-pro',
  'nano-banana-2-cl': 'lingtu-2',
  'nano-banana-2-4k-cl': 'lingtu-2',
  'nano-banana': 'lingtu',
  'newapi-gpt-image-2': 'image2',
  'newapi-gpt-image-2-chat': 'image2-economy',
  'gpt-image-2-ext-1k': 'image2',
  'gpt-image-2-ext-2k': 'image2-pro',
  'gpt-image-2-ext-4k': 'image2-pro',
  'newapi-gpt-image-2-ext': 'image2-pro',
  'newapi-gpt-image-2-ext-1k': 'image2',
  'newapi-gpt-image-2-ext-2k': 'image2-pro',
  'newapi-gpt-image-2-ext-4k': 'image2-pro',
  'gpt-image-2-official': 'image2-hd',
  'gpt-image-2-official-1k': 'image2-hd',
  'gpt-image-2-official-2k': 'image2-hd',
  'gpt-image-2-official-4k': 'image2-hd',
  'newapi-gpt-image-2-official-budget': 'image2-hd',
  image2k4k: 'image2-hd',
  'newapi-nano-banana-fast': 'lingtu-fast',
  'newapi-nano-banana-2': 'lingtu-2',
  'newapi-nano-banana-pro': 'lingtu-pro',
  'newapi-nano-banana': 'lingtu',
  'apimart-gpt-image-2-official-budget': 'image2-hd',
  'apimart-gpt-image-2': 'image2',
  'apimart-seedream-5-lite': 'image2',
  'apimart-gemini-2-5-flash-preview': 'lingtu-fast',
  'apimart-gemini-2-5-flash-official': 'lingtu-fast',
  'apimart-gemini-3-1-flash-preview': 'lingtu-2',
  'apimart-gemini-3-1-flash-official': 'lingtu-2',
  'apimart-gemini-3-pro-preview': 'lingtu-pro',
  'apimart-gemini-3-pro-official': 'lingtu-pro',
  'ithink-gpt-image-2-slow': 'image2',
  'mooko-gpt-image-2-pro': 'image2-pro'
};

export function normalizeImageModelId(raw?: string | null): string {
  const id = String(raw || '').trim().toLowerCase();
  if (!id) return 'image2';
  return LEGACY_MODEL_MAP[id] || id;
}

export function getCatalogEntry(modelId: string): ImageModelCatalogEntry | null {
  const id = normalizeImageModelId(modelId);
  return IMAGE_MODEL_CATALOG.find((model) => model.id === id) || null;
}

export function catalogById(): Map<string, ImageModelCatalogEntry> {
  return new Map(IMAGE_MODEL_CATALOG.map((model) => [model.id, model]));
}
