import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import {
  fetchNewApiAdminRoutes,
  fetchNewApiExecutableCatalog,
  publicNewApiCatalogModels,
  publicNewApiRoutedCatalogModels
} from '../../lib/newapi';

export const modelCatalogRoutes = new Hono<{ Bindings: Env }>();

export async function publicModelCatalogHandler(c: Context<{ Bindings: Env }>) {
  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '模型服务暂未配置');
  let snapshot;
  try {
    snapshot = await fetchNewApiExecutableCatalog(apiKey, c.env.NEWAPI_API_BASE_URL);
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认模型可用性，请稍后重试');
  }
  const routes = await fetchNewApiAdminRoutes(
    c.env.NEWAPI_API_BASE_URL,
    c.env.NEWAPI_CATALOG_ADMIN_SECRET
  );
  const models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
  c.header('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=120');
  return c.json({
    success: true,
    models: models.map(model => ({ ...model, selectable: true }))
  });
}

modelCatalogRoutes.get('/', async c => {
  const apiKey = c.env.NEWAPI_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', '模型服务暂未配置');
  const force = c.req.query('refresh') === '1';
  let snapshot;
  try {
    snapshot = await fetchNewApiExecutableCatalog(apiKey, c.env.NEWAPI_API_BASE_URL, {
      force,
      requireFresh: force
    });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '暂时无法确认模型可用性，请稍后重试');
  }
  const routes = await fetchNewApiAdminRoutes(
    c.env.NEWAPI_API_BASE_URL,
    c.env.NEWAPI_CATALOG_ADMIN_SECRET
  );
  const models = routes.available
    ? await publicNewApiRoutedCatalogModels(snapshot, routes)
    : publicNewApiCatalogModels(snapshot);
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    data: {
      models
    }
  });
});
