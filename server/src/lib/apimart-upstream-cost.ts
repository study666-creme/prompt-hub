import type { ImageModelCatalogEntry } from './image-models-catalog';

export type MjSpeedKey = 'relax' | 'fast' | 'turbo';

export type UpstreamCostLine = {
  key: string;
  label: string;
  usd: number;
  creditsCost: number;
  rmb: number;
};

/** Apimart 美元成本按 1 USD ≈ 7 CNY 估算。 */
export function apimartUsdToRmb(usd: number): number {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 7 * 1000) / 1000;
}

function costLine(key: string, label: string, usd: number): UpstreamCostLine {
  const rmb = apimartUsdToRmb(usd);
  return { key, label, usd, rmb, creditsCost: Math.round(rmb * 1000) / 10 };
}

/** MJ Imagine / Blend 三档成本。 */
export const MJ_IMAGINE_USD_BY_SPEED: Record<MjSpeedKey, number> = {
  relax: 0.04504,
  fast: 0.05504,
  turbo: 0.1
};

const MJ_SPEED_LABELS: Record<MjSpeedKey, string> = {
  relax: 'Relax',
  fast: 'Fast',
  turbo: 'Turbo'
};

export function normalizeMjSpeed(raw?: string | null): MjSpeedKey {
  const speed = String(raw || '').trim().toLowerCase();
  return speed === 'fast' || speed === 'turbo' ? speed : 'relax';
}

function formatRmbYuan(rmb: number): string {
  const value = Number(rmb);
  if (!Number.isFinite(value) || value <= 0) return '¥0';
  return value >= 0.1 ? `¥${value.toFixed(2)}` : `¥${value.toFixed(3)}`;
}

export function buildUpstreamCostLines(catalog: ImageModelCatalogEntry): UpstreamCostLine[] {
  if (catalog.provider === 'newapi' && catalog.upstreamPoints > 0) {
    const rmb = catalog.upstreamPoints;
    return [{
      key: 'realtime',
      label: '卡藏 API 实时价',
      usd: 0,
      creditsCost: Math.round(rmb * 1000) / 10,
      rmb
    }];
  }
  if (catalog.provider !== 'apimart' || catalog.uiFamily !== 'midjourney') return [];

  const speeds = ['relax', 'fast', 'turbo'] as MjSpeedKey[];
  const imagine = speeds.map((speed) =>
    costLine(`imagine-${speed}`, `Imagine ${MJ_SPEED_LABELS[speed]}`, MJ_IMAGINE_USD_BY_SPEED[speed])
  );
  const blend = speeds.map((speed) =>
    costLine(`blend-${speed}`, `混图 ${MJ_SPEED_LABELS[speed]}`, MJ_IMAGINE_USD_BY_SPEED[speed])
  );
  return [...imagine, ...blend];
}

export function formatUpstreamCostCell(
  _provider: ImageModelCatalogEntry['provider'],
  lines: UpstreamCostLine[]
): string {
  if (!lines.length) return '—';
  return lines.map((line) => `${line.label}: ${formatRmbYuan(line.rmb)}`).join('\n');
}
