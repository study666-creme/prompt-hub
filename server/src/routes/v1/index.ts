import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireAuth } from '../../middleware/auth';
import { meRoutes } from './me';
import { redeemRoutes } from './redeem';
import { generateRoutes } from './generate';
import { communityRoutes } from './community';

export const v1 = new Hono<{ Bindings: Env }>();

v1.use('*', requireAuth);

v1.route('/me', meRoutes);
v1.route('/redeem', redeemRoutes);
v1.route('/generate', generateRoutes);
v1.route('/community', communityRoutes);
