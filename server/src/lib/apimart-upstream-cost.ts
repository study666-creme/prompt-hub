import {
  APIMART_IMAGE_MODEL_CATALOG,
  type ImageModelCatalogEntry
} from './image-models-catalog';

export type MjSpeedKey = 'relax' | 'fast' | 'turbo';
export type ImageResolutionKey = '1k' | '2k' | '4k';

export type UpstreamCostLine = {
  key: string;
  label: string;
  /** Apimart 定价页「我们的价格」USD/次 · https://apimart.ai/zh/pricing */
  usd: number;
  /** 成本积分 = USD × 7（内部换算，≈ 人民币元） */
  creditsCost: number;
  /** 成本人民币 ≈ USD × 7 */
  rmb: number;
};

/** 成本积分 / 人民币元 ≈ Apimart USD × 7 */
export function apimartUsdToCreditsCost(usd: number): number {
  const v = Number(usd);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 7 * 1000) / 1000;
}

export function apimartUsdToRmb(usd: number): number {
  return apimartUsdToCreditsCost(usd);
}

function costLine(key: string, label: string, usd: number): UpstreamCostLine {
  const creditsCost = apimartUsdToCreditsCost(usd);
  return { key, label, usd, creditsCost, rmb: creditsCost };
}

/** MJ Imagine 三档（Apimart 定价页 · imagine / imagine-fast / imagine-turbo） */
export const MJ_IMAGINE_USD_BY_SPEED: Record<MjSpeedKey, number> = {
  relax: 0.04504,
  fast: 0.05504,
  turbo: 0.1
};

/** MJ 混图三档（blend / blend-fast / blend-turbo · 与 Imagine 同价） */
export const MJ_BLEND_USD_BY_SPEED: Record<MjSpeedKey, number> = {
  relax: 0.04504,
  fast: 0.05504,
  turbo: 0.1
};

const MJ_SPEED_LABELS: Record<MjSpeedKey, string> = {
  relax: 'Relax',
  fast: 'Fast',
  turbo: 'Turbo'
};

const RESOLUTION_LABELS: Record<ImageResolutionKey, string> = {
  '1k': '1K',
  '2k': '2K',
  '4k': '4K'
};

export function formatRmbYuan(rmb: number): string {
  const v = Number(rmb);
  if (!Number.isFinite(v) || v <= 0) return '¥0';
  if (v >= 1) return `¥${v.toFixed(2)}`;
  if (v >= 0.1) return `¥${v.toFixed(2)}`;
  return `¥${v.toFixed(3)}`;
}

/**
 * 已接入模型的 Apimart USD（来源：apimart.ai/zh/pricing · 2026-06）
 */
export const APIMART_UPSTREAM_USD: Record<
  string,
  | { kind: 'flat'; usd: number; note?: string }
  | { kind: 'byResolution'; usd: Partial<Record<ImageResolutionKey, number>>; note?: string }
  | { kind: 'bySpeed'; usd: Partial<Record<MjSpeedKey, number>>; note?: string }
> = {
  'ithink-gpt-image-2-slow': { kind: 'flat', usd: 0.019, note: 'ThinkAI 经济' },
  'mooko-gpt-image-2-pro': {
    kind: 'byResolution',
    usd: { '2k': 0.714, '4k': 0.714 },
    note: '木瓜 · 站内约 5cr'
  },
  'apimart-gpt-image-2-official-budget': {
    kind: 'byResolution',
    usd: { '1k': 0.00488, '2k': 0.00968, '4k': 0.01592 },
    note: 'official · 1024/2048/2880 低质量档'
  },
  'apimart-gpt-image-2': {
    kind: 'byResolution',
    usd: { '1k': 0.006, '2k': 0.012, '4k': 0.018 },
    note: 'gpt-image-2 · 1K/2K/4K'
  },
  'apimart-seedream-5-lite': {
    kind: 'byResolution',
    usd: { '2k': 0.028, '4k': 0.028 },
    note: 'doubao-seedream-5-0-lite'
  },
  'apimart-gemini-2-5-flash-preview': { kind: 'flat', usd: 0.0125 },
  'apimart-gemini-3-1-flash-preview': {
    kind: 'byResolution',
    usd: { '1k': 0.03, '2k': 0.04, '4k': 0.06 }
  },
  'apimart-gemini-3-pro-preview': {
    kind: 'byResolution',
    usd: { '1k': 0.04, '2k': 0.04, '4k': 0.05 }
  },
  'apimart-gemini-2-5-flash-official': { kind: 'flat', usd: 0.0312 },
  'apimart-gemini-3-1-flash-official': {
    kind: 'byResolution',
    usd: { '1k': 0.0536, '2k': 0.0808, '4k': 0.1208 }
  },
  'apimart-gemini-3-pro-official': {
    kind: 'byResolution',
    usd: { '1k': 0.1072, '2k': 0.1072, '4k': 0.192 }
  },
  'apimart-wan2-7-image': { kind: 'flat', usd: 0.0216 },
  'apimart-wan2-7-image-pro': { kind: 'flat', usd: 0.0544 },
  'apimart-flux-kontext-pro': { kind: 'flat', usd: 0.02 },
  'apimart-flux-kontext-max': { kind: 'flat', usd: 0.04 },
  'apimart-flux-2-pro': { kind: 'byResolution', usd: { '1k': 0.025, '2k': 0.035 } },
  'apimart-flux-2-flex': { kind: 'byResolution', usd: { '1k': 0.07, '2k': 0.12 } },
  'apimart-mj-v81': { kind: 'bySpeed', usd: MJ_IMAGINE_USD_BY_SPEED, note: '文生图/图生图' },
  'apimart-mj-v7': { kind: 'bySpeed', usd: MJ_IMAGINE_USD_BY_SPEED, note: '文生图/图生图' },
  'apimart-mj-v61': { kind: 'bySpeed', usd: MJ_IMAGINE_USD_BY_SPEED, note: '文生图/图生图' },
  'apimart-mj-niji7': { kind: 'bySpeed', usd: MJ_IMAGINE_USD_BY_SPEED, note: '文生图/图生图' }
};

export function normalizeMjSpeed(raw?: string | null): MjSpeedKey {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'fast' || s === 'turbo') return s;
  return 'relax';
}

export function buildMjBlendCostLines(): UpstreamCostLine[] {
  return (['relax', 'fast', 'turbo'] as MjSpeedKey[]).map((speed) => {
    const usd = MJ_BLEND_USD_BY_SPEED[speed];
    return costLine(`blend-${speed}`, MJ_SPEED_LABELS[speed], usd);
  });
}

export function buildUpstreamCostLines(catalog: ImageModelCatalogEntry): UpstreamCostLine[] {
  const spec = APIMART_UPSTREAM_USD[catalog.id];
  if (spec?.kind === 'flat') {
    return [costLine('flat', spec.note || '单次', spec.usd)];
  }
  if (spec?.kind === 'byResolution') {
    return (catalog.resolutions || ['1k']).map((res) => {
      const usd = spec.usd[res as ImageResolutionKey] ?? 0;
      return costLine(res, RESOLUTION_LABELS[res as ImageResolutionKey] || res.toUpperCase(), usd);
    });
  }
  if (spec?.kind === 'bySpeed') {
    const imagine = (['relax', 'fast', 'turbo'] as MjSpeedKey[]).map((speed) => {
      const usd = spec.usd[speed] ?? MJ_IMAGINE_USD_BY_SPEED[speed];
      return costLine(`imagine-${speed}`, MJ_SPEED_LABELS[speed], usd);
    });
    const blend = buildMjBlendCostLines().map((line) => ({
      ...line,
      label: `混图 ${line.label}`
    }));
    return [...imagine, ...blend];
  }

  if ((catalog.provider === 'apimart' || catalog.provider === 'newapi') && catalog.upstreamPoints > 0) {
    return [costLine('flat', '单次', catalog.upstreamPoints)];
  }
  return [];
}

export function formatUpstreamCostCell(
  provider: ImageModelCatalogEntry['provider'],
  lines: UpstreamCostLine[]
): string {
  if (provider === 'grsai') return '—';
  if (!lines.length) return '—';
  return lines.map((l) => `${l.label}: ${formatRmbYuan(l.rmb)}`).join('\n');
}

/** 管理后台：Apimart 全量成本对照表 */
export function apimartCostReferenceRows(): Array<{
  id: string;
  label: string;
  uiFamily: string;
  uiFamilyKey: string;
  functionLabel: string;
  lines: UpstreamCostLine[];
}> {
  const UI_FAMILY_LABEL: Record<string, string> = {
    gim2: '全能2',
    banana: '香蕉',
    jimeng: '即梦',
    midjourney: 'MJ',
    wan: '万相',
    flux: 'Flux'
  };
  const rows = APIMART_IMAGE_MODEL_CATALOG.map((catalog) => {
    const spec = APIMART_UPSTREAM_USD[catalog.id];
    const functionLabel =
      spec?.kind === 'bySpeed'
        ? '文生图/图生图'
        : catalog.uiFamily === 'jimeng'
          ? '文生图'
          : catalog.uiFamily === 'wan' || catalog.uiFamily === 'flux'
            ? '文生图/编辑'
            : '文生图';
    const imagineLines =
      spec?.kind === 'bySpeed'
        ? (['relax', 'fast', 'turbo'] as MjSpeedKey[]).map((speed) => {
            const usd = spec.usd[speed] ?? MJ_IMAGINE_USD_BY_SPEED[speed];
            return costLine(`imagine-${speed}`, MJ_SPEED_LABELS[speed], usd);
          })
        : buildUpstreamCostLines(catalog);
    return {
      id: catalog.id,
      label: catalog.label,
      uiFamily: UI_FAMILY_LABEL[catalog.uiFamily] || catalog.uiFamily,
      uiFamilyKey: catalog.uiFamily,
      functionLabel,
      lines: imagineLines
    };
  }).filter((r) => r.lines.length > 0);

  rows.push({
    id: 'apimart-mj-blend',
    label: '混图（2～5 张参考图）',
    uiFamily: UI_FAMILY_LABEL.midjourney,
    uiFamilyKey: 'midjourney',
    functionLabel: '混图',
    lines: buildMjBlendCostLines()
  });

  return rows;
}
