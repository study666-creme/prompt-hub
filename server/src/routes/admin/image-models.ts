import { Hono } from 'hono';
import type { Env } from '../../env';
import { jsonError } from '../../lib/errors';
import {
  adminModelRows,
  loadImageModelSettingsWithMeta,
  mergeImageModelSettings,
  saveImageModelSettings,
  invalidateImageModelSettingsCache,
  type ImageModelOverride,
  type ImageModelPricingSettings
} from '../../lib/image-model-settings';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  imageCatalogForNewApiSnapshot
} from '../../lib/newapi';
import { writeAudit } from '../../middleware/admin-audit';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';
import { createAdminClient } from '../../lib/supabase';

export const adminImageModelRoutes = new Hono<{ Bindings: Env }>();

adminImageModelRoutes.use('*', requireAdminSecret);
adminImageModelRoutes.use('*', rateLimit(120, 60_000));

async function currentAdminModelRows(env: Env, settings: ImageModelPricingSettings) {
  const [catalog, routeCatalog] = await Promise.all([
    fetchNewApiModelCatalog(env.NEWAPI_API_BASE_URL),
    fetchNewApiAdminRoutes(
      env.NEWAPI_API_BASE_URL,
      env.NEWAPI_CATALOG_ADMIN_SECRET
    )
  ]);
  const rows = adminModelRows(settings, imageCatalogForNewApiSnapshot(catalog)).map(row => ({
    ...row,
    routeCatalogAvailable: row.provider === 'apimart' || routeCatalog.available,
    routeCatalogError: row.provider === 'newapi' ? routeCatalog.error : null,
    upstreamRoutes: row.provider === 'newapi'
      ? routeCatalog.routes[row.upstream] || []
      : [{
          channelId: 0,
          channelName: 'Apimart MJ',
          status: 'active',
          enabled: true,
          groups: ['midjourney'],
          actualModel: row.upstream,
          priority: 0,
          weight: 0,
          upstreamHost: 'api.apimart.ai'
        }]
  }));
  return {
    catalog,
    routeCatalog,
    rows
  };
}

adminImageModelRoutes.get('/', async c => {
  try {
    const admin = createAdminClient(c.env);
    const { settings, persisted, tableReady, tableError } = await loadImageModelSettingsWithMeta(admin);
    const current = await currentAdminModelRows(c.env, settings);
    let settingsHint: string | null = null;
    if (!tableReady) {
      settingsHint =
        'site_settings 表不可用。请在 Supabase SQL 编辑器依次执行 migrations/20260602160000_site_settings_image_models.sql 与 20260602200000_site_settings_grants.sql';
    } else if (!persisted) {
      settingsHint =
        '表已就绪，尚未保存过定价。修改后请点击「保存全部定价」（保存成功后会消失此提示）。';
    } else if (tableError) {
      settingsHint = `读取配置异常：${tableError}`;
    }
    return c.json({
      ok: true,
      data: {
        settings,
        models: current.rows,
        routeCatalog: {
          available: current.routeCatalog.available,
          fetchedAt: current.routeCatalog.fetchedAt,
          error: current.routeCatalog.error
        },
        providers: [
          { id: 'newapi', label: '卡藏 API', doc: 'https://newapi.prompt-hubs.com/' },
          { id: 'apimart', label: 'MJ 线路', doc: 'https://api.apimart.ai' }
        ],
        catalogVersion: current.catalog.version || null,
        pricingVersion: current.catalog.pricingVersion || null,
        catalogStale: current.catalog.stale,
        settingsPersisted: persisted,
        settingsTableReady: tableReady,
        settingsHint
      }
    });
  } catch (err) {
    return jsonError(c, err);
  }
});

adminImageModelRoutes.put('/', async c => {
  try {
    return await saveImageModelsHandler(c);
  } catch (err) {
    return jsonError(c, err);
  }
});



async function saveImageModelsHandler(c: import('hono').Context<{ Bindings: Env }>) {
  const admin = createAdminClient(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Partial<ImageModelPricingSettings>;
  const { settings: current } = await loadImageModelSettingsWithMeta(admin);
  const next = mergeImageModelSettings({
    globalDiscountPercent: body.globalDiscountPercent ?? current.globalDiscountPercent,
    models:
      body.models && typeof body.models === 'object' ? body.models : current.models
  });
  const saved = await saveImageModelSettings(admin, next);
  invalidateImageModelSettingsCache();
  const { persisted, tableReady } = await loadImageModelSettingsWithMeta(admin);
  const currentRows = await currentAdminModelRows(c.env, saved);
  return c.json({
    ok: true,
    data: {
      settings: saved,
      models: currentRows.rows,
      settingsPersisted: persisted,
      settingsTableReady: tableReady
    }
  });
}
