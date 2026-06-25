import {
  GRSAI_IMAGE_MODEL_CATALOG,
  type ImageModelCatalogEntry
} from './image-models-catalog';

/** GrsAI 充值基准：¥49 = 750,000 积分（见 grsai.com 充值页） */
export const GRSAI_RECHARGE_CNY = 49;
export const GRSAI_RECHARGE_POINTS = 750_000;

export type GrsaiCostLine = {
  key: string;
  label: string;
  /** GrsAI 上游积分/次 */
  points: number;
  /** 成本人民币 ≈ points × 49 ÷ 750000 */
  rmb: number;
};

export function grsaiPointsToRmb(points: number): number {
  const v = Number(points);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round((v * GRSAI_RECHARGE_CNY * 1000) / GRSAI_RECHARGE_POINTS) / 1000;
}

export function formatGrsaiRmbYuan(rmb: number): string {
  const v = Number(rmb);
  if (!Number.isFinite(v) || v <= 0) return '¥0';
  if (v >= 1) return `¥${v.toFixed(2)}`;
  if (v >= 0.1) return `¥${v.toFixed(2)}`;
  return `¥${v.toFixed(3)}`;
}

function resolutionTierLabel(catalog: ImageModelCatalogEntry): string {
  const res = catalog.resolutions || ['1k'];
  if (res.length <= 1) return res[0]?.toUpperCase() || '单次';
  return res.map((r) => r.toUpperCase()).join('/');
}

function grsaiCostLine(key: string, label: string, points: number): GrsaiCostLine {
  return { key, label, points, rmb: grsaiPointsToRmb(points) };
}

export function buildGrsaiUpstreamCostLines(catalog: ImageModelCatalogEntry): GrsaiCostLine[] {
  const points = Number(catalog.upstreamPoints) || 0;
  if (points <= 0) return [];
  return [grsaiCostLine('flat', resolutionTierLabel(catalog), points)];
}

export function formatGrsaiUpstreamCostCell(lines: GrsaiCostLine[]): string {
  if (!lines.length) return '—';
  return lines.map((l) => `${l.label}: ${formatGrsaiRmbYuan(l.rmb)}（${l.points} 积分）`).join('\n');
}

/** 管理后台：GrsAI 接入模型成本对照表 */
export function grsaiCostReferenceRows(): Array<{
  id: string;
  label: string;
  uiFamily: string;
  uiFamilyKey: string;
  functionLabel: string;
  lines: GrsaiCostLine[];
}> {
  const UI_FAMILY_LABEL: Record<string, string> = {
    gim2: '全能2',
    banana: '香蕉',
    jimeng: '即梦',
    midjourney: 'MJ',
    wan: '万相',
    flux: 'Flux'
  };
  return GRSAI_IMAGE_MODEL_CATALOG.map((catalog) => ({
    id: catalog.id,
    label: catalog.label,
    uiFamily: UI_FAMILY_LABEL[catalog.uiFamily] || catalog.uiFamily,
    uiFamilyKey: catalog.uiFamily,
    functionLabel: '文生图/图生图',
    lines: buildGrsaiUpstreamCostLines(catalog)
  })).filter((r) => r.lines.length > 0);
}
