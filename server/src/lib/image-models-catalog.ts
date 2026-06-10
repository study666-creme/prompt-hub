export type ImageModelProvider = 'grsai' | 'apimart' | 'ithink' | 'mooko';

export type ImageModelUiFamily = 'gim2' | 'banana' | 'jimeng';

export type ImageModelCatalogEntry = {
  id: string;
  /** 生图线路：GrsAI 或 Apimart（前台为独立选项，可分别定价） */
  provider: ImageModelProvider;
  /** 前台下拉分组：G-im2 / 香蕉 / 即梦（与 provider 无关） */
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
      provider === 'grsai' ? row.followUpstreamMaintenance ?? true : undefined
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
    resolutions: ['1k', '2k', '4k'],
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
    upstreamPoints: 3000,
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
    label: 'GPT Image 2 · 慢速',
    group: 'classic',
    description: 'ThinkAI 慢速线路 · 仅 1K · 上游约 2 分/张',
    upstreamPoints: 2,
    refundOnViolation: true,
    resolutions: ['1k'],
    defaultCredits: 2,
    sortOrder: 103
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
