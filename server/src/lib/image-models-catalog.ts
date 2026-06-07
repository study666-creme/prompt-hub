export type ImageModelProvider = 'grsai' | 'apimart' | 'ithink';

export type ImageModelCatalogEntry = {
  id: string;
  /** 生图线路：GrsAI 或 Apimart（前台为独立选项，可分别定价） */
  provider: ImageModelProvider;
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

/**
 * GrsAI 图像模型（https://grsai.com/zh/dashboard/models）
 */
export const GRSAI_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('grsai', [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  }
]);

/** ThinkAI（thinkai.tv / token.ithinkai.cn）慢速经济线路 */
export const ITHINK_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('ithink', [
  {
    id: 'ithink-gpt-image-2-slow',
    upstream: 'gpt-image-2',
    label: 'GPT Image 2 · 慢速',
    group: 'classic',
    description: 'ThinkAI 慢速线路 · 上游约 2 分/张',
    upstreamPoints: 2,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 2, '2k': 3, '4k': 5 },
    defaultCredits: 2,
    sortOrder: 103
  }
]);

/** Apimart 备用线路 */
export const APIMART_IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = withProvider('apimart', [
  {
    id: 'apimart-gpt-image-2',
    upstream: 'gpt-image-2',
    label: 'GPT Image 2',
    group: 'classic',
    description: '备用线路 · OpenAI Image 2（1K/2K/4K 分开定价）',
    upstreamPoints: 0,
    refundOnViolation: true,
    resolutions: ['1k', '2k', '4k'],
    pricingByResolution: true,
    defaultCreditsByResolution: { '1k': 10, '2k': 20, '4k': 40 },
    defaultCredits: 10,
    sortOrder: 101
  },
  {
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
  }
]);

/** 全站模型目录（GrsAI + Apimart 并列，后台可分别定价） */
export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  ...GRSAI_IMAGE_MODEL_CATALOG,
  ...APIMART_IMAGE_MODEL_CATALOG,
  ...ITHINK_IMAGE_MODEL_CATALOG
];

export function providerLabel(provider: ImageModelProvider): string {
  if (provider === 'apimart') return '备用线路';
  if (provider === 'ithink') return '经济线路';
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
  if (id.startsWith('apimart-') || id.startsWith('ithink-')) return id;
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
