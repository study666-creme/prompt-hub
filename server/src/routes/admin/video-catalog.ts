import { Hono } from 'hono';
import type { Env } from '../../env';
import { createAdminClient } from '../../lib/supabase';
import { fetchNewApiAdminRoutes, fetchNewApiModelCatalog } from '../../lib/newapi';
import {
  applyVideoOverride,
  invalidateVideoOverridesCache,
  loadVideoCatalogOverrides,
  type VideoCatalogOverride
} from '../../lib/video-catalog-settings';
import { writeAudit } from '../../middleware/admin-audit';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminVideoCatalogRoutes = new Hono<{ Bindings: Env }>();

adminVideoCatalogRoutes.use('*', requireAdminSecret);
adminVideoCatalogRoutes.use('*', rateLimit(60, 60_000));

/** 目录实时数据 + 后台覆盖合并后的视频模型面板数据。 */
adminVideoCatalogRoutes.get('/', async c => {
  const admin = createAdminClient(c.env);
  const [snapshot, routeSnapshot, overrides] = await Promise.all([
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL, { force: true }),
    fetchNewApiAdminRoutes(c.env.NEWAPI_API_BASE_URL, c.env.NEWAPI_CATALOG_ADMIN_SECRET),
    loadVideoCatalogOverrides(admin)
  ]);
  const videos = snapshot.models.filter(m => m.modality === 'video');
  const items = videos.map(m => {
    const override = overrides.models[m.id] ?? overrides.models[m.upstreamModel] ?? null;
    const applied = applyVideoOverride(
      overrides,
      { id: m.id, upstreamModel: m.upstreamModel },
      m.pricing as never
    );
    const routes = (routeSnapshot.routes[m.upstreamModel] || []).filter(r => r.enabled);
    return {
      id: m.id,
      upstreamModel: m.upstreamModel,
      label: m.label,
      catalogPricing: m.pricing,
      effectivePricing: applied.pricing,
      override,
      overridden: !!override,
      enabled: applied.enabled,
      routeCount: routes.length,
      routes: routes.map(r => ({ channelId: r.channelId, channelName: r.channelName || `渠道${r.channelId}` }))
    };
  });
  return c.json({
    ok: true,
    data: {
      catalogAvailable: snapshot.available,
      routeSnapshotAvailable: routeSnapshot.available,
      items,
      overrides: overrides.models
    }
  });
});

/** 保存覆盖（整体 PUT）。覆盖只会覆盖设置的字段；清空即恢复目录。 */
adminVideoCatalogRoutes.put('/', async c => {
  const admin = createAdminClient(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { overrides?: Record<string, VideoCatalogOverride> };
  const models: Record<string, VideoCatalogOverride> = {};
  const entries = body.overrides && typeof body.overrides === 'object' ? Object.entries(body.overrides) : [];
  for (const [id, o] of entries) {
    if (!o || typeof o !== 'object') continue;
    const clean: VideoCatalogOverride = { id: String(o.id || id) };
    if (o.unit === 'second' || o.unit === 'request') clean.unit = o.unit;
    const credits = Number(o.credits);
    if (o.credits != null && Number.isFinite(credits) && credits >= 0) clean.credits = credits;
    if (o.creditsByTier && typeof o.creditsByTier === 'object') {
      const tiers: Record<string, number> = {};
      for (const [name, v] of Object.entries(o.creditsByTier)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) tiers[name] = n;
      }
      if (Object.keys(tiers).length) clean.creditsByTier = tiers;
    }
    if (typeof o.enabled === 'boolean') clean.enabled = o.enabled;
    if (o.note) clean.note = String(o.note).slice(0, 300);
    clean.updatedAt = new Date().toISOString();
    models[String(id)] = clean;
  }
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: 'video_catalog_overrides', value: { models }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  invalidateVideoOverridesCache();
  await writeAudit(c, {
    action: 'video_catalog.save_overrides',
    targetType: 'video_catalog',
    detail: { count: Object.keys(models).length, ids: Object.keys(models) }
  });
  return c.json({ ok: true, data: { overrides: models } });
});
