import type { Env } from '../env';

export type RequestMetricSummary = {
  available: boolean;
  source: 'worker-kv' | 'disabled';
  hours: number;
  requestTotal: number;
  apiTotal: number;
  adminTotal: number;
  mediaTotal: number;
  api4xx: number;
  api5xx: number;
  notFound404: number;
  image404: number;
  averageLatencyMs: number | null;
  maxLatencyMs: number | null;
  byStatus: Record<string, number>;
  byRoute: Record<string, number>;
  lastHours: Array<{
    hour: string;
    requestTotal: number;
    api5xx: number;
    image404: number;
  }>;
  recentErrors: MonitorErrorEvent[];
  recentImage404: MonitorImage404Event[];
  lastUpdatedAt: string | null;
};

type MonitorErrorEvent = {
  ts: string;
  method: string;
  path: string;
  route: string;
  status: number;
  latencyMs: number;
  message?: string;
};

type MonitorImage404Event = {
  ts: string;
  method: string;
  path: string;
  route: string;
};

type MonitorBucket = {
  hour: string;
  firstTs: string;
  lastTs: string;
  requestTotal: number;
  apiTotal: number;
  adminTotal: number;
  mediaTotal: number;
  api4xx: number;
  api5xx: number;
  notFound404: number;
  image404: number;
  latencyTotalMs: number;
  latencyCount: number;
  maxLatencyMs: number;
  byStatus: Record<string, number>;
  byRoute: Record<string, number>;
  recentErrors: MonitorErrorEvent[];
  recentImage404: MonitorImage404Event[];
};

const METRIC_PREFIX = 'monitor:v1:hour:';
const METRIC_TTL_SECONDS = 60 * 60 * 72;
const MAX_ROUTE_KEYS = 80;
const MAX_RECENT_EVENTS = 40;
const HEALTHY_REQUEST_SAMPLE_RATE = 0.02;
const HEALTHY_MEDIA_SAMPLE_RATE = 0.01;
const CLIENT_ERROR_SAMPLE_RATE = 0.1;

function hasMetricsKv(env: Env) {
  return !!env.PROMPT_HUB_METRICS;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function hourId(date: Date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}`;
}

function hourKey(hour: string) {
  return `${METRIC_PREFIX}${hour}`;
}

function emptyBucket(hour: string, ts: string): MonitorBucket {
  return {
    hour,
    firstTs: ts,
    lastTs: ts,
    requestTotal: 0,
    apiTotal: 0,
    adminTotal: 0,
    mediaTotal: 0,
    api4xx: 0,
    api5xx: 0,
    notFound404: 0,
    image404: 0,
    latencyTotalMs: 0,
    latencyCount: 0,
    maxLatencyMs: 0,
    byStatus: {},
    byRoute: {},
    recentErrors: [],
    recentImage404: []
  };
}

function safeBucket(raw: unknown, hour: string, ts: string): MonitorBucket {
  const b = raw && typeof raw === 'object' ? (raw as Partial<MonitorBucket>) : {};
  return {
    ...emptyBucket(hour, ts),
    ...b,
    hour,
    firstTs: typeof b.firstTs === 'string' ? b.firstTs : ts,
    lastTs: typeof b.lastTs === 'string' ? b.lastTs : ts,
    byStatus: b.byStatus && typeof b.byStatus === 'object' ? b.byStatus : {},
    byRoute: b.byRoute && typeof b.byRoute === 'object' ? b.byRoute : {},
    recentErrors: Array.isArray(b.recentErrors) ? b.recentErrors.slice(0, MAX_RECENT_EVENTS) : [],
    recentImage404: Array.isArray(b.recentImage404) ? b.recentImage404.slice(0, MAX_RECENT_EVENTS) : []
  };
}

function inc(map: Record<string, number>, key: string, amount = 1) {
  map[key] = (Number(map[key]) || 0) + amount;
}

function incCapped(map: Record<string, number>, key: string, amount = 1) {
  if (Object.prototype.hasOwnProperty.call(map, key) || Object.keys(map).length < MAX_ROUTE_KEYS) {
    inc(map, key, amount);
  } else {
    inc(map, '_other', amount);
  }
}

function routeOf(pathname: string) {
  const p = pathname || '/';
  if (p === '/health') return '/health';
  if (p.startsWith('/api/admin/dashboard')) return '/api/admin/dashboard/*';
  if (p.startsWith('/api/admin/community')) return '/api/admin/community/*';
  if (p.startsWith('/api/admin/users')) return '/api/admin/users/*';
  if (p.startsWith('/api/admin/codes')) return '/api/admin/codes/*';
  if (p.startsWith('/api/admin/image-models')) return '/api/admin/image-models/*';
  if (p.startsWith('/api/admin')) return '/api/admin/*';
  if (p.startsWith('/api/v1/media/c/')) return '/api/v1/media/c/:enc';
  if (p.startsWith('/api/v1/media/i/')) return '/api/v1/media/i/:enc';
  if (p === '/api/v1/media/community/sign') return p;
  if (p === '/api/v1/media/community/sign-batch') return p;
  if (p === '/api/v1/media/sign-batch') return p;
  if (p === '/api/v1/media/warehouse-thumbs') return p;
  if (p.startsWith('/api/v1/media/generation/')) return '/api/v1/media/generation/:jobId/url';
  if (p.startsWith('/api/v1/generate/jobs/') && p.endsWith('/image')) return '/api/v1/generate/jobs/:jobId/image';
  if (p.startsWith('/api/v1/generate/jobs/')) return '/api/v1/generate/jobs/:jobId';
  if (p === '/api/v1/generate' || p === '/api/v1/generate/') return '/api/v1/generate';
  if (p.startsWith('/api/v1/generate')) return '/api/v1/generate/*';
  if (p.startsWith('/api/v1/community/feed')) return '/api/v1/community/feed';
  if (p.startsWith('/api/v1/community')) return '/api/v1/community/*';
  if (p.startsWith('/api/v1/me')) return '/api/v1/me/*';
  if (p.startsWith('/api/v1/chat')) return '/api/v1/chat/*';
  if (p.startsWith('/api/v1/asset-packages')) return '/api/v1/asset-packages/*';
  if (p.startsWith('/api/v1')) return '/api/v1/*';
  if (p.startsWith('/api/')) return '/api/*';
  return p.length > 96 ? `${p.slice(0, 92)}...` : p;
}

function isMediaPath(pathname: string, route: string) {
  return (
    pathname.startsWith('/api/v1/media/')
    || route === '/api/v1/generate/jobs/:jobId/image'
  );
}

function metricSampleRate(request: Request, status: number, path: string, isMedia: boolean) {
  if (status >= 500) return 1;
  if (status >= 400) return CLIENT_ERROR_SAMPLE_RATE;
  if (request.method === 'OPTIONS' || path === '/health') return 0;
  return isMedia ? HEALTHY_MEDIA_SAMPLE_RATE : HEALTHY_REQUEST_SAMPLE_RATE;
}

function disabledSummary(hours: number): RequestMetricSummary {
  return {
    available: false,
    source: 'disabled',
    hours,
    requestTotal: 0,
    apiTotal: 0,
    adminTotal: 0,
    mediaTotal: 0,
    api4xx: 0,
    api5xx: 0,
    notFound404: 0,
    image404: 0,
    averageLatencyMs: null,
    maxLatencyMs: null,
    byStatus: {},
    byRoute: {},
    lastHours: [],
    recentErrors: [],
    recentImage404: [],
    lastUpdatedAt: null
  };
}

function recentHours(count: number, now = new Date()) {
  const hours: string[] = [];
  const base = new Date(now);
  base.setUTCMinutes(0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    hours.push(hourId(new Date(base.getTime() - i * 60 * 60 * 1000)));
  }
  return hours;
}

function mergeRecord(target: Record<string, number>, source: Record<string, number>) {
  for (const [k, v] of Object.entries(source || {})) {
    inc(target, k, Number(v) || 0);
  }
}

function topRecord(record: Record<string, number>, limit: number) {
  return Object.fromEntries(
    Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
  );
}

export async function recordRequestMetric(
  env: Env,
  request: Request,
  response: Response,
  elapsedMs: number,
  opts?: { message?: string }
): Promise<void> {
  if (!hasMetricsKv(env)) return;
  try {
    const now = new Date();
    const ts = now.toISOString();
    const hour = hourId(now);
    const key = hourKey(hour);
    const url = new URL(request.url);
    const path = url.pathname || '/';
    const route = routeOf(path);
    const status = response.status || 0;
    const latency = Math.max(0, Math.round(elapsedMs || 0));
    const isApi = path.startsWith('/api/');
    const isAdmin = path.startsWith('/api/admin');
    const isMedia = isMediaPath(path, route);
    const isImage404 = status === 404 && isMedia;
    const sampleRate = metricSampleRate(request, status, path, isMedia);
    if (sampleRate <= 0 || (sampleRate < 1 && Math.random() >= sampleRate)) return;
    const sampleWeight = Math.max(1, Math.round(1 / sampleRate));

    const bucket = safeBucket(await env.PROMPT_HUB_METRICS!.get(key, 'json'), hour, ts);
    bucket.lastTs = ts;
    bucket.requestTotal += sampleWeight;
    if (isApi) bucket.apiTotal += sampleWeight;
    if (isAdmin) bucket.adminTotal += sampleWeight;
    if (isMedia) bucket.mediaTotal += sampleWeight;
    if (isApi && status >= 400 && status < 500) bucket.api4xx += sampleWeight;
    if (isApi && status >= 500) bucket.api5xx += sampleWeight;
    if (status === 404) bucket.notFound404 += sampleWeight;
    if (isImage404) bucket.image404 += sampleWeight;
    bucket.latencyTotalMs += latency * sampleWeight;
    bucket.latencyCount += sampleWeight;
    bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs || 0, latency);
    inc(bucket.byStatus, String(status || 'unknown'), sampleWeight);
    incCapped(bucket.byRoute, `${request.method} ${route}`, sampleWeight);

    if (status >= 500 || isImage404) {
      bucket.recentErrors.unshift({
        ts,
        method: request.method,
        path,
        route,
        status,
        latencyMs: latency,
        message: opts?.message?.slice(0, 180)
      });
      bucket.recentErrors = bucket.recentErrors.slice(0, MAX_RECENT_EVENTS);
    }

    if (isImage404) {
      bucket.recentImage404.unshift({
        ts,
        method: request.method,
        path,
        route
      });
      bucket.recentImage404 = bucket.recentImage404.slice(0, MAX_RECENT_EVENTS);
    }

    await env.PROMPT_HUB_METRICS!.put(key, JSON.stringify(bucket), {
      expirationTtl: METRIC_TTL_SECONDS
    });
  } catch (e) {
    console.warn('[monitoring] failed to record request metric', e);
  }
}

export async function summarizeRequestMetrics(env: Env, hours = 24): Promise<RequestMetricSummary> {
  const boundedHours = Math.min(72, Math.max(1, Math.floor(hours || 24)));
  if (!hasMetricsKv(env)) return disabledSummary(boundedHours);

  try {
    const ids = recentHours(boundedHours);
    const buckets = await Promise.all(
      ids.map(async (id) => safeBucket(await env.PROMPT_HUB_METRICS!.get(hourKey(id), 'json'), id, new Date().toISOString()))
    );
    const summary = disabledSummary(boundedHours);
    summary.available = true;
    summary.source = 'worker-kv';
    summary.lastHours = buckets.map((b) => ({
      hour: b.hour,
      requestTotal: b.requestTotal || 0,
      api5xx: b.api5xx || 0,
      image404: b.image404 || 0
    }));

    let latencyTotal = 0;
    let latencyCount = 0;
    let maxLatency: number | null = null;
    let lastUpdatedAt: string | null = null;
    const allErrors: MonitorErrorEvent[] = [];
    const allImage404: MonitorImage404Event[] = [];

    for (const b of buckets) {
      summary.requestTotal += b.requestTotal || 0;
      summary.apiTotal += b.apiTotal || 0;
      summary.adminTotal += b.adminTotal || 0;
      summary.mediaTotal += b.mediaTotal || 0;
      summary.api4xx += b.api4xx || 0;
      summary.api5xx += b.api5xx || 0;
      summary.notFound404 += b.notFound404 || 0;
      summary.image404 += b.image404 || 0;
      latencyTotal += b.latencyTotalMs || 0;
      latencyCount += b.latencyCount || 0;
      if (b.maxLatencyMs != null) maxLatency = Math.max(maxLatency || 0, b.maxLatencyMs || 0);
      if (b.lastTs && (!lastUpdatedAt || b.lastTs > lastUpdatedAt)) lastUpdatedAt = b.lastTs;
      mergeRecord(summary.byStatus, b.byStatus);
      mergeRecord(summary.byRoute, b.byRoute);
      allErrors.push(...(b.recentErrors || []));
      allImage404.push(...(b.recentImage404 || []));
    }

    summary.averageLatencyMs = latencyCount ? Math.round(latencyTotal / latencyCount) : null;
    summary.maxLatencyMs = maxLatency;
    summary.byStatus = topRecord(summary.byStatus, 20);
    summary.byRoute = topRecord(summary.byRoute, 30);
    summary.recentErrors = allErrors
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, MAX_RECENT_EVENTS);
    summary.recentImage404 = allImage404
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, MAX_RECENT_EVENTS);
    summary.lastUpdatedAt = lastUpdatedAt;
    return summary;
  } catch (e) {
    console.warn('[monitoring] failed to summarize request metrics', e);
    return disabledSummary(boundedHours);
  }
}
