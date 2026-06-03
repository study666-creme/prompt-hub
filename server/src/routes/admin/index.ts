import { Hono } from 'hono';
import type { Env } from '../../env';
import { applyCorsHeaders } from '../../lib/cors-headers';
import { adminCodeRoutes } from './codes';
import { adminCommunityRoutes } from './community';
import { adminDashboardRoutes } from './dashboard';
import { adminImageModelRoutes } from './image-models';
import { adminUserRoutes } from './users';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    applyCorsHeaders(c);
    return c.body(null, 204);
  }
  await next();
  applyCorsHeaders(c);
});

adminRoutes.route('/dashboard', adminDashboardRoutes);
adminRoutes.route('/community', adminCommunityRoutes);
adminRoutes.route('/users', adminUserRoutes);
adminRoutes.route('/codes', adminCodeRoutes);
adminRoutes.route('/image-models', adminImageModelRoutes);
