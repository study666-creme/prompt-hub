import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../env';

const catalog = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  fetchRoutes: vi.fn(),
  publicModels: vi.fn(),
  routedModels: vi.fn()
}));

vi.mock('../../lib/newapi', () => ({
  fetchNewApiModelCatalog: catalog.fetchModels,
  fetchNewApiAdminRoutes: catalog.fetchRoutes,
  publicNewApiCatalogModels: catalog.publicModels,
  publicNewApiRoutedCatalogModels: catalog.routedModels
}));

import { publicModelCatalogHandler } from './models';

describe('public model catalog cache control', () => {
  it('does not cache an empty stale catalog into the model marketplace', async () => {
    catalog.fetchModels.mockResolvedValue({
      available: false,
      stale: true,
      version: '',
      pricingVersion: '',
      models: [],
      rules: [],
      imageCatalogEntries: []
    });
    catalog.fetchRoutes.mockResolvedValue({ available: false, fetchedAt: '', routes: {}, error: 'unavailable' });
    catalog.publicModels.mockReturnValue([]);

    const app = new Hono<{ Bindings: Env }>();
    app.get('/', publicModelCatalogHandler);
    const response = await app.request('https://catalog.test/', undefined, {
      NEWAPI_API_BASE_URL: 'https://newapi.test'
    } as Env);

    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ stale: true, models: [] });
  });
});
