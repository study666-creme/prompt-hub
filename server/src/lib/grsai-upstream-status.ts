import { GRSAI_IMAGE_MODEL_CATALOG } from './image-models-catalog';
import type { ImageModelPricingSettings, ResolvedImageModel } from './image-model-settings';
import { getCatalogEntry } from './image-models-catalog';

export type GrsaiUpstreamAvailability = 'active' | 'maintenance';

const PAGE_URL = 'https://grsai.com/zh/dashboard/models';
const PAGE_CACHE_MS = 5 * 60 * 1000;
const REACTIVE_MAINTENANCE_MS = 25 * 60 * 1000;
const REACTIVE_ACTIVE_MS = 8 * 60 * 1000;

let pageCache: {
  at: number;
  statuses: Record<string, GrsaiUpstreamAvailability>;
} | null = null;

let pageSyncInflight: Promise<void> | null = null;

const reactive = new Map<
  string,
  { status: GrsaiUpstreamAvailability; until: number; source: string }
>();

/** GrsAI 返回或页面文案：模型维护中 */
export function isGrsaiMaintenanceMessage(msg: string): boolean {
  const s = String(msg || '');
  return /维护中|正在维护|under\s*maintenance|maintenance\s*mode|暂不可用|暂停服务|模型维护|服务维护|not\s*available/i.test(
    s
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 解析 GrsAI 公开模型页 HTML（无需登录） */
export function parseGrsaiModelStatusesFromHtml(html: string): Record<string, GrsaiUpstreamAvailability> {
  const out: Record<string, GrsaiUpstreamAvailability> = {};
  const models = [...GRSAI_IMAGE_MODEL_CATALOG].sort(
    (a, b) => b.upstream.length - a.upstream.length
  );
  for (const model of models) {
    const id = escapeRegExp(model.upstream);
    const re = new RegExp(`${id}(?![a-z0-9-])[\\s\\S]{0,500}`, 'i');
    const chunk = html.match(re)?.[0] || '';
    if (!chunk) continue;
    if (/维护中|正在维护|under\s*maintenance/i.test(chunk)) {
      out[model.upstream] = 'maintenance';
    } else if (/可用|available/i.test(chunk)) {
      out[model.upstream] = 'active';
    }
  }
  return out;
}

export function noteGrsaiSubmitOutcome(
  upstreamModel: string,
  outcome: 'success' | 'maintenance'
): void {
  const key = upstreamModel.toLowerCase();
  const now = Date.now();
  if (outcome === 'success') {
    reactive.set(key, {
      status: 'active',
      until: now + REACTIVE_ACTIVE_MS,
      source: 'submit_ok'
    });
    return;
  }
  reactive.set(key, {
    status: 'maintenance',
    until: now + REACTIVE_MAINTENANCE_MS,
    source: 'submit_fail'
  });
}

function readReactive(upstreamModel: string): GrsaiUpstreamAvailability | null {
  const hit = reactive.get(upstreamModel.toLowerCase());
  if (!hit || hit.until < Date.now()) {
    reactive.delete(upstreamModel.toLowerCase());
    return null;
  }
  return hit.status;
}

export function getGrsaiUpstreamStatus(upstreamModel: string): GrsaiUpstreamAvailability | null {
  const key = upstreamModel.toLowerCase();
  const reactiveStatus = readReactive(key);
  if (reactiveStatus === 'maintenance') return 'maintenance';

  if (pageCache && Date.now() - pageCache.at < PAGE_CACHE_MS) {
    const pageStatus = pageCache.statuses[key];
    if (pageStatus === 'maintenance') return 'maintenance';
    if (pageStatus === 'active') return reactiveStatus ?? 'active';
  }

  return reactiveStatus;
}

/** 拉取 GrsAI 模型页并更新缓存（GET /models 时后台触发，5 分钟节流） */
export async function syncGrsaiUpstreamStatusesFromPublicPage(): Promise<void> {
  if (pageCache && Date.now() - pageCache.at < PAGE_CACHE_MS) return;
  if (pageSyncInflight) return pageSyncInflight;

  pageSyncInflight = (async () => {
    try {
      const res = await fetch(PAGE_URL, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'PromptHub-UpstreamSync/1.0'
        },
        signal: AbortSignal.timeout(12_000)
      });
      if (!res.ok) {
        console.warn('[grsai-status] public page fetch failed', res.status);
        return;
      }
      const html = await res.text();
      const statuses = parseGrsaiModelStatusesFromHtml(html);
      pageCache = { at: Date.now(), statuses };
    } catch (e) {
      console.warn('[grsai-status] public page sync error', e);
    } finally {
      pageSyncInflight = null;
    }
  })();

  return pageSyncInflight;
}

const UPSTREAM_MAINTENANCE_NOTICE =
  'GrsAI 上游维护中（已自动同步），请稍后再试或换用备用线路';

/** 在后台手动维护/下架之外，叠加 GrsAI 上游状态 */
export function overlayGrsaiUpstreamStatus(
  resolved: ResolvedImageModel,
  settings: ImageModelPricingSettings
): ResolvedImageModel {
  if (resolved.provider !== 'grsai') return resolved;
  const catalog = getCatalogEntry(resolved.id);
  if (catalog?.followUpstreamMaintenance === false) return resolved;

  const override = settings.models[resolved.id] || {};
  if (override.status === 'offline' || override.status === 'maintenance') {
    return resolved;
  }

  const upstream = getGrsaiUpstreamStatus(resolved.upstream);
  if (upstream !== 'maintenance') return resolved;

  return {
    ...resolved,
    status: 'maintenance',
    enabled: false,
    statusNotice: UPSTREAM_MAINTENANCE_NOTICE
  };
}

export function upstreamMaintenanceNotice(): string {
  return UPSTREAM_MAINTENANCE_NOTICE;
}
