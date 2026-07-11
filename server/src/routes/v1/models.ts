import { Hono } from 'hono';
import type { Env } from '../../env';
import { fetchNewApiModelCatalog, publicNewApiCatalogModels } from '../../lib/newapi';

export const modelCatalogRoutes = new Hono<{ Bindings: Env }>();

modelCatalogRoutes.get('/', async c => {
  const snapshot = await fetchNewApiModelCatalog(c.env.NEWAPI_API_BASE_URL);
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    data: {
      catalogVersion: snapshot.version || null,
      pricingVersion: snapshot.pricingVersion || null,
      catalogStale: snapshot.stale,
      models: publicNewApiCatalogModels(snapshot)
    }
  });
});
