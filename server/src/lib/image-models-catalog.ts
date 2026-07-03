export type ImageModelProvider = 'grsai' | 'apimart';

export type ImageModelUiFamily = 'gim2' | 'banana' | 'jimeng' | 'midjourney';

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

/**
 * GrsAI 图像模型（https://grsai.com/zh/dashboard/models）
 */
export const GRSAI_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('grsai', [
  gim2({
    id: 'gpt-image-2-vip',
    upstream: 'gpt-image-2-vip',
    label: 'GPT Image 2 VIP',
    group: 'classic',
    description: '细节强化，更高品质',
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
    description: '日常通用，均衡出图',
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

/** Apimart 备用线路 */
export const APIMART_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('apimart', [
  gim2({
    id: 'apimart-gpt-image-2-official-budget',
    upstream: 'gpt-image-2-official',
    label: 'GPT Image 2 · 特价',
    group: 'new',
    description: '低价档 · 固定低质量 · 无正方形比例',
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
    description: '四档价 · 比例与分辨率决定出图尺寸',
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
    description: '即梦 5.0 Lite · 2K/4K 分开定价',
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
    label: 'Nano Banana Fast',
    group: 'classic',
    description: '快速草稿',
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
    label: 'Nano Banana 2',
    group: 'classic',
    description: '日常均衡',
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
    label: 'Nano Banana Pro',
    group: 'classic',
    description: '专业通用，细节更丰富',
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
    description: '官方渠道 · 快速草稿',
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
    description: '官方渠道 · 按分辨率分档',
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
    description: '官方渠道 · 专业通用',
    upstreamPoints: 0.75,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 10, '2k': 10, '4k': 14 },
    fixedQualityLow: true,
    defaultCredits: 10,
    sortOrder: 108
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

/** 全站模型目录（仅 GrsAI + Apimart） */
export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  ...GRSAI_IMAGE_MODEL_CATALOG,
  ...APIMART_IMAGE_MODEL_CATALOG
];

export function imageModelUiFamily(modelId: string): ImageModelUiFamily {
  const entry = getCatalogEntry(modelId);
  if (entry?.uiFamily) return entry.uiFamily;
  const id = String(modelId || '').toLowerCase();
  if (id.startsWith('apimart-mj-')) return 'midjourney';
  if (id.includes('seedream') || id === 'jimeng') return 'jimeng';
  if (id.includes('nano-banana')) return 'banana';
  return 'gim2';
}

export function providerLabel(_provider: ImageModelProvider): string {
  return '';
}

/** 前台模型说明：去掉上游品牌名与 MJ 速度冗余文案；空则不在 UI 展示 */
export function sanitizePublicModelDescription(description: string | null | undefined): string {
  if (!description) return '';
  let s = String(description).trim();
  s = s.replace(/^(Apimart|GrsAI|ThinkAI|Mooko|木瓜|OpenAI|Gemini|备用线路)\s*[·•]\s*/gi, '');
  s = s.replace(/\b(Apimart|OpenAI|Gemini|gpt-image-2|official|备用线路)\b\s*[·•]?\s*/gi, '');
  s = s.replace(/\s*[·•]\s*出图速度可选\s*relax\s*\/\s*fast\s*\/\s*turbo/gi, '');
  s = s.replace(/\s*[·•]\s*$/g, '').trim();
  if (/^(OpenAI|Gemini|gpt-image|备用线路)/i.test(s)) return '';
  return s;
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
  if (id.startsWith('apimart-')) return id;
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
