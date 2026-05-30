import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireAuth } from '../../middleware/auth';
import { meRoutes } from './me';
import { redeemRoutes } from './redeem';
import { generateRoutes } from './generate';
import { communityFeedHandler, communityRoutes } from './community';
import { membershipRoutes } from './membership';
import { membershipTaskRoutes } from './membership-tasks';
import { communityMediaSignHandler, mediaRoutes } from './media';
import { extensionRoutes } from './extension';
import { rateLimit } from '../../middleware/rate-limit';

export const v1 = new Hono<{ Bindings: Env }>();

/** 社区公开图：游客可浏览，无需登录 */
v1.get('/media/community/sign', rateLimit(400, 60_000), communityMediaSignHandler);

/** 全站社区 Feed：游客与所有用户可见 */
v1.get('/community/feed', rateLimit(180, 60_000), communityFeedHandler);

v1.use('*', requireAuth);

v1.route('/me', meRoutes);
v1.route('/membership', membershipRoutes);
v1.route('/membership/tasks', membershipTaskRoutes);
v1.route('/media', mediaRoutes);
v1.route('/redeem', redeemRoutes);
v1.route('/generate', generateRoutes);
v1.route('/community', communityRoutes);
v1.route('/extension', extensionRoutes);
