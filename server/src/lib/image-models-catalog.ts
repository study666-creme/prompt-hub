export type ImageModelProvider = 'grsai' | 'apimart' | 'ithink' | 'mooko';

export type ImageModelUiFamily = 'gim2' | 'banana' | 'jimeng' | 'midjourney' | 'wan' | 'flux';

export type MjSpeedKey = 'relax' | 'fast' | 'turbo';

export type ImageModelCatalogEntry = {
  id: string;
  /** 生图线路：GrsAI 或 Apimart（前台为独立选项，可分别定价） */
  provider: ImageModelProvider;
  /** 前台下拉分组：全能2 / 香蕉 / 即梦（与 provider 无关） */
  uiFamily: ImageModelUiFamily;
  /** 提交上游 API 的 model 字段 */
  upstream: string;
  label: string;
  group: 'new' | 'classic';
  description: string;
  /** 上游参考成本（积分/次，只读展示；Apimart 可为 0） */
  upstreamPoints: number;
  refundOnViolation: boolean;
  resolutions: ('1k' | '2k' | '4k')[];
  defaultCredits: number;
  /** 按分辨率分别定价（Apimart GPT Image 2） */
  pricingByResolution?: boolean;
  defaultCreditsByResolution?: Partial<Record<'1k' | '2k' | '4k', number>>;
  /** MJ：按 relax / fast / turbo 分档定价 */
  pricingBySpeed?: boolean;
  defaultCreditsBySpeed?: Partial<Record<MjSpeedKey, number>>;
  /** GrsAI：自动跟随上游维护状态（模型页 + 提交反馈） */
  followUpstreamMaintenance?: boolean;
  /** 固定 low 质量，前台隐藏质量选项（Apimart official 特价） */
  fixedQualityLow?: boolean;
  sortOrder: number;
};

function withProvider(
  provider: ImageModelProvider,
  rows: Omit<ImageModelCatalogEntry, 'provider'>[]
): ImageModelCatalogEntry[] {
  return rows.map((row) => ({
    ...row,
    provider,
    followUpstreamMaintenance:
      provider === 'grsai' ? row.followUpstreamMaintenance ?? false : undefined
  }));
}

function gim2(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'gim2' };
}

function banana(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'banana' };
}

function jimeng(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'jimeng' };
}

function midjourney(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'midjourney' };
}

function wan(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'wan' };
}

function flux(row: Omit<ImageModelCatalogEntry, 'provider' | 'uiFamily'>): Omit<ImageModelCatalogEntry, 'provider'> {
  return { ...row, uiFamily: 'flux' };
}

/**
 * GrsAI 图像模型（https://grsai.com/zh/dashboard/models）
 */
export const GRSAI_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('grsai', [
  gim2({
    id: 'gpt-image-2-vip',
    upstream: 'gpt-image-2-vip',
    label: 'GPT Image 2 VIP',
    group: 'classic',
    description: 'OpenAI VIP 优化版',
    upstreamPoints: 1300,
    refundOnViolation: true,
    resolutions: ['2k', '4k'],
    defaultCredits: 14,
    sortOrder: 1
  }),
  gim2({
    id: 'gpt-image-2',
    upstream: 'gpt-image-2',
    label: 'GPT Image 2',
    group: 'classic',
    description: 'OpenAI 基础版',
    upstreamPoints: 600,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 10,
    sortOrder: 2
  }),
  banana({
    id: 'nano-banana-pro',
    upstream: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    group: 'classic',
    description: '专业通用，细节更丰富',
    upstreamPoints: 1800,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 18,
    sortOrder: 3
  }),
  banana({
    id: 'nano-banana-2',
    upstream: 'nano-banana-2',
    label: 'Nano Banana 2',
    group: 'classic',
    description: '日常均衡版',
    upstreamPoints: 1200,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 12,
    sortOrder: 4
  }),
  banana({
    id: 'nano-banana-pro-vt',
    upstream: 'nano-banana-pro-vt',
    label: 'Nano Banana Pro VT',
    group: 'classic',
    description: '二次元 / VTuber 优化',
    upstreamPoints: 1800,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 18,
    sortOrder: 5
  }),
  banana({
    id: 'nano-banana-fast',
    upstream: 'nano-banana-fast',
    label: 'Nano Banana Fast',
    group: 'classic',
    description: '快速草稿，批量出图',
    upstreamPoints: 440,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 8,
    sortOrder: 6
  }),
  banana({
    id: 'nano-banana-2-cl',
    upstream: 'nano-banana-2-cl',
    label: 'Nano Banana 2 · 创意',
    group: 'classic',
    description: '创意版（官方支持 1K / 2K）',
    upstreamPoints: 1600,
    refundOnViolation: true,
    resolutions: ['1k', '2k'],
    defaultCredits: 16,
    sortOrder: 7
  }),
  banana({
    id: 'nano-banana-pro-cl',
    upstream: 'nano-banana-pro-cl',
    label: 'Nano Banana Pro · 创意',
    group: 'classic',
    description: '专业创意，复杂场景',
    upstreamPoints: 6000,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 50,
    sortOrder: 8
  }),
  banana({
    id: 'nano-banana-pro-vip',
    upstream: 'nano-banana-pro-vip',
    label: 'Nano Banana Pro VIP',
    group: 'new',
    description: 'VIP 专业版（官方 1K / 2K）',
    upstreamPoints: 10000,
    refundOnViolation: true,
    resolutions: ['1k', '2k'],
    defaultCredits: 80,
    sortOrder: 9
  }),
  banana({
    id: 'nano-banana-2-4k-cl',
    upstream: 'nano-banana-2-4k-cl',
    label: 'Nano Banana 2 · 4K 创意',
    group: 'new',
    description: '原生 4K 创意版',
    upstreamPoints: 6000,
    refundOnViolation: true,
    resolutions: ['4k'],
    defaultCredits: 30,
    sortOrder: 10
  }),
  banana({
    id: 'nano-banana',
    upstream: 'nano-banana',
    label: 'Nano Banana',
    group: 'new',
    description: '入门通用版',
    upstreamPoints: 1400,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    defaultCredits: 14,
    sortOrder: 11
  }),
  banana({
    id: 'nano-banana-pro-4k-vip',
    upstream: 'nano-banana-pro-4k-vip',
    label: 'Nano Banana Pro · 4K VIP',
    group: 'new',
    description: '旗舰 4K VIP',
    upstreamPoints: 16000,
    refundOnViolation: true,
    resolutions: ['4k'],
    defaultCredits: 120,
    sortOrder: 12
  })
]);

/** ThinkAI（thinkai.tv / token.ithinkai.cn）慢速经济线路 */
export const ITHINK_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('ithink', [
  gim2({
    id: 'ithink-gpt-image-2-slow',
    upstream: 'gpt-image-2',
    label: 'GPT Image 2 · 经济',
    group: 'classic',
    description: 'ThinkAI 经济线路 · 仅 1K · 五档比例 · 上游约 $0.019/张',
    upstreamPoints: 2,
    refundOnViolation: true,
    resolutions: ['1k'],
    fixedQualityLow: true,
    defaultCredits: 2,
    sortOrder: 102
  })
]);

/** 木瓜AI（api.mooko.ai /v1/images）仅 Pro · 2K/4K，对齐 gpt-img.mooko.ai */
export const MOOKO_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('mooko', [
  gim2({
    id: 'mooko-gpt-image-2-pro',
    upstream: 'gpt-image-2-pro',
    label: 'GPT Image 2 Pro · 慢速',
    group: 'new',
    description: '慢速线路 · Images API · gpt-image-2-pro · 仅 2K/4K',
    upstreamPoints: 5,
    refundOnViolation: true,
    resolutions: ['2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '2k': 5, '4k': 5 },
    defaultCredits: 5,
    sortOrder: 104
  })
]);

/** Apimart 备用线路 */
export const APIMART_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('apimart', [
  gim2({
    id: 'apimart-gpt-image-2-official-budget',
    upstream: 'gpt-image-2-official',
    label: 'GPT Image 2 · 特价',
    group: 'new',
    description: '备用线路 · official 低价档 · 固定低质量 · 无正方形比例',
    upstreamPoints: 0,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 3, '2k': 4, '4k': 9 },
    defaultCredits: 3,
    fixedQualityLow: true,
    sortOrder: 100
  }),
  gim2({
    id: 'apimart-gpt-image-2',
    upstream: 'gpt-image-2',
    label: 'GPT Image 2',
    group: 'classic',
    description: '备用线路 · gpt-image-2 四档价（非 official 181 档）；比例+分辨率决定出图尺寸',
    upstreamPoints: 0,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 10, '2k': 20, '4k': 40 },
    defaultCredits: 10,
    sortOrder: 101
  }),
  jimeng({
    id: 'apimart-seedream-5-lite',
    upstream: 'doubao-seedream-5-0-lite',
    label: '即梦 5.0 Lite',
    group: 'new',
    description: '备用线路 · 字节 Seedream 5.0（2K/4K 分开定价）',
    upstreamPoints: 0,
    refundOnViolation: true,
    resolutions: ['2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '2k': 14, '4k': 28 },
    defaultCredits: 14,
    sortOrder: 102
  }),
  banana({
    id: 'apimart-gemini-2-5-flash-preview',
    upstream: 'gemini-2.5-flash-image-preview',
    label: 'Nano Banana Fast · 备用',
    group: 'classic',
    description: 'Gemini 2.5 Flash · 快速草稿',
    upstreamPoints: 0.088,
    refundOnViolation: true,
    resolutions: ['1k'],
    fixedQualityLow: true,
    defaultCredits: 2,
    sortOrder: 103
  }),
  banana({
    id: 'apimart-gemini-3-1-flash-preview',
    upstream: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 · 备用',
    group: 'classic',
    description: 'Gemini 3.1 Flash · 均衡',
    upstreamPoints: 0.21,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 4, '2k': 5, '4k': 7 },
    fixedQualityLow: true,
    defaultCredits: 4,
    sortOrder: 104
  }),
  banana({
    id: 'apimart-gemini-3-pro-preview',
    upstream: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro · 备用',
    group: 'classic',
    description: 'Gemini 3 Pro（Nano Banana Pro）',
    upstreamPoints: 0.28,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 5, '2k': 5, '4k': 6 },
    fixedQualityLow: true,
    defaultCredits: 5,
    sortOrder: 105
  }),
  banana({
    id: 'apimart-gemini-2-5-flash-official',
    upstream: 'gemini-2.5-flash-image-preview-official',
    label: 'Nano Banana Fast · 官方',
    group: 'new',
    description: 'Gemini 2.5 Flash 官方渠道',
    upstreamPoints: 0.218,
    refundOnViolation: true,
    resolutions: ['1k'],
    fixedQualityLow: true,
    defaultCredits: 4,
    sortOrder: 106
  }),
  banana({
    id: 'apimart-gemini-3-1-flash-official',
    upstream: 'gemini-3.1-flash-image-preview-official',
    label: 'Nano Banana 2 · 官方',
    group: 'new',
    description: 'Gemini 3.1 Flash 官方渠道 · 按分辨率分档',
    upstreamPoints: 0.375,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 6, '2k': 8, '4k': 11 },
    fixedQualityLow: true,
    defaultCredits: 6,
    sortOrder: 107
  }),
  banana({
    id: 'apimart-gemini-3-pro-official',
    upstream: 'gemini-3-pro-image-preview-official',
    label: 'Nano Banana Pro · 官方',
    group: 'new',
    description: 'Gemini 3 Pro 官方渠道',
    upstreamPoints: 0.75,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 10, '2k': 10, '4k': 14 },
    fixedQualityLow: true,
    defaultCredits: 10,
    sortOrder: 108
  }),
  wan({
    id: 'apimart-wan2-7-image',
    upstream: 'wan2.7-image',
    label: '万相 2.7',
    group: 'new',
    description: '万相 2.7 标准版 · 最高 2K · 文生图/编辑',
    upstreamPoints: 0.15,
    refundOnViolation: true,
    resolutions: ['1k', '2k'],
    fixedQualityLow: true,
    defaultCredits: 3,
    sortOrder: 109
  }),
  wan({
    id: 'apimart-wan2-7-image-pro',
    upstream: 'wan2.7-image-pro',
    label: '万相 2.7 Pro',
    group: 'new',
    description: '万相 2.7 专业版 · 文生图最高 4K',
    upstreamPoints: 0.35,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    fixedQualityLow: true,
    defaultCredits: 6,
    sortOrder: 110
  }),
  flux({
    id: 'apimart-flux-kontext-pro',
    upstream: 'flux-kontext-pro',
    label: 'Flux Kontext Pro',
    group: 'new',
    description: '文生图/单图编辑 · 固定价',
    upstreamPoints: 0.14,
    refundOnViolation: true,
    resolutions: ['1k'],
    fixedQualityLow: true,
    defaultCredits: 4,
    sortOrder: 120
  }),
  flux({
    id: 'apimart-flux-kontext-max',
    upstream: 'flux-kontext-max',
    label: 'Flux Kontext Max',
    group: 'new',
    description: 'Kontext 高质量版',
    upstreamPoints: 0.28,
    refundOnViolation: true,
    resolutions: ['1k'],
    fixedQualityLow: true,
    defaultCredits: 6,
    sortOrder: 121
  }),
  flux({
    id: 'apimart-flux-2-pro',
    upstream: 'flux-2-pro',
    label: 'Flux 2 Pro',
    group: 'new',
    description: 'Flux 2.0 Pro · 按 1K/2K 分档',
    upstreamPoints: 0.175,
    refundOnViolation: true,
    resolutions: ['1k', '2k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 5, '2k': 7 },
    fixedQualityLow: true,
    defaultCredits: 5,
    sortOrder: 122
  }),
  flux({
    id: 'apimart-flux-2-flex',
    upstream: 'flux-2-flex',
    label: 'Flux 2 Flex',
    group: 'new',
    description: 'Flux 2.0 Flex · 快速迭代 · 按 1K/2K 分档',
    upstreamPoints: 0.49,
    refundOnViolation: true,
    resolutions: ['1k', '2k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 7, '2k': 10 },
    fixedQualityLow: true,
    defaultCredits: 7,
    sortOrder: 123
  }),
  midjourney({
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
  }),
  midjourney({
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
  }),
  midjourney({
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
  }),
  midjourney({
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
  })
]);

/** 全站模型目录（GrsAI + Apimart 并列，后台可分别定价） */
export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  ...GRSAI_IMAGE_MODEL_CATALOG,
  ...APIMART_IMAGE_MODEL_CATALOG,
  ...ITHINK_IMAGE_MODEL_CATALOG,
  ...MOOKO_IMAGE_MODEL_CATALOG
];

export function imageModelUiFamily(modelId: string): ImageModelUiFamily {
  const entry = getCatalogEntry(modelId);
  if (entry?.uiFamily) return entry.uiFamily;
  const id = String(modelId || '').toLowerCase();
  if (id.startsWith('apimart-mj-')) return 'midjourney';
  if (id.startsWith('apimart-wan') || id.includes('wan2.7')) return 'wan';
  if (id.startsWith('apimart-flux') || id.startsWith('flux-')) return 'flux';
  if (id.includes('seedream') || id === 'jimeng') return 'jimeng';
  if (id.includes('nano-banana')) return 'banana';
  return 'gim2';
}

export function providerLabel(provider: ImageModelProvider): string {
  if (provider === 'apimart') return '备用线路';
  if (provider === 'ithink') return '经济线路';
  if (provider === 'mooko') return '慢速线路';
  return '常规线路';
}

/** 前台模型说明：去掉上游品牌名与 MJ 速度冗余文案 */
export function sanitizePublicModelDescription(description: string | null | undefined): string {
  if (!description) return '';
  let s = String(description).trim();
  s = s.replace(/^(Apimart|GrsAI|ThinkAI|Mooko|木瓜)\s*[·•]\s*/gi, '');
  s = s.replace(/\bApimart\s*[·•]\s*/gi, '');
  s = s.replace(/\s*[·•]\s*出图速度可选\s*relax\s*\/\s*fast\s*\/\s*turbo/gi, '');
  return s.replace(/\s*[·•]\s*$/g, '').trim();
}

const LEGACY_MODEL_MAP: Record<string, string> = {
  quanneng2: 'gpt-image-2',
  jimeng: 'nano-banana-pro'
};

export function normalizeImageModelId(raw?: string | null): string {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  if (!id) return 'gpt-image-2';
  if (id.startsWith('apimart-') || id.startsWith('ithink-') || id.startsWith('mooko-')) return id;
  if (id in LEGACY_MODEL_MAP) return LEGACY_MODEL_MAP[id];
  return id;
}

export function getCatalogEntry(modelId: string): ImageModelCatalogEntry | null {
  const id = normalizeImageModelId(modelId);
  return IMAGE_MODEL_CATALOG.find((m) => m.id === id) || null;
}

export function catalogById(): Map<string, ImageModelCatalogEntry> {
  return new Map(IMAGE_MODEL_CATALOG.map((m) => [m.id, m]));
}
