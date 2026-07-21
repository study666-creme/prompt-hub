import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../env';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiModelCatalog,
  publicNewApiCatalogModels,
  publicNewApiRoutedCatalogModels
} from '../../lib/newapi';

export const modelCatalogRoutes = new Hono<{ Bindings: Env }>();

export async function publicModelCatalogHandler(c: Context<{ Bindings: Env }>) {
  const [snapshot, routes] = await Promise.all([
    fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL),
    fetchNewApiAdminRoutes(c.env.NEWAPI_API_BASE_URL, c.env.NEWAPI_CATALOG_ADMIN_SECRET)
  ]);
  const models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
  c.header('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=120');
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
  const models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
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
