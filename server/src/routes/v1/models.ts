import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../env';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  publicNewApiCatalogModels,
  publicNewApiRoutedCatalogModels
} from '../../lib/newapi';
import { applyVideoOverride, loadVideoCatalogOverrides } from '../../lib/video-catalog-settings';
import { createAdminClient } from '../../lib/supabase';

export const modelCatalogRoutes = new Hono<{ Bindings: Env }>();

type PublicCatalogModel = {
  id: string;
  modality?: string;
  pricing?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * 应用后台目录覆盖到公开模型列表：视频模型的价格/计价方式/上下架由
 * site_settings.video_catalog_overrides 控制（覆盖优先于卡藏目录）。
 */
async function applyVideoOverridesToList(
  c: Context<{ Bindings: Env }>,
  models: PublicCatalogModel[]
): Promise<PublicCatalogModel[]> {
  // 覆盖层是运营增强，读不到时退回目录原值，绝不阻断公开目录
  let overrides: Awaited<ReturnType<typeof loadVideoCatalogOverrides>> = { models: {} };
  try {
    overrides = await loadVideoCatalogOverrides(createAdminClient(c.env));
  } catch {
    return models;
  }
  return models
    .map(m => {
      if (m.modality !== 'video') return m;
      const r = applyVideoOverride(
        overrides,
        { id: m.id, upstreamModel: String((m as { upstreamModel?: string }).upstreamModel || m.id) },
        (m.pricing ?? {}) as never
      );
      if (!r.enabled) return null;
      return { ...m, pricing: r.pricing };
    })
    .filter((m): m is PublicCatalogModel => m !== null);
}

export async function publicModelCatalogHandler(c: Context<{ Bindings: Env }>) {
  const [snapshot, routes] = await Promise.all([
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL),
    fetchNewApiAdminRoutes(c.env.NEWAPI_API_BASE_URL, c.env.NEWAPI_CATALOG_ADMIN_SECRET)
  ]);
  let models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
  models = await applyVideoOverridesToList(c, models as PublicCatalogModel[]) as typeof models;
  c.header(
    'Cache-Control',
    models.length ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=120' : 'no-store'
  );
  return c.json({
    success: true,
    version: snapshot.version || null,
    pricing_version: snapshot.pricingVersion || null,
    stale: snapshot.stale,
    models: models.map(model => ({ ...model, selectable: true }))
  });
}

modelCatalogRoutes.get('/', async c => {
  const [snapshot, routes] = await Promise.all([
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL),
    fetchNewApiAdminRoutes(c.env.NEWAPI_API_BASE_URL, c.env.NEWAPI_CATALOG_ADMIN_SECRET)
  ]);
  let models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
  models = await applyVideoOverridesToList(c, models as PublicCatalogModel[]) as typeof models;
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    data: {
      catalogVersion: snapshot.version || null,
      pricingVersion: snapshot.pricingVersion || null,
      catalogStale: snapshot.stale,
      models
    }
  });
});
