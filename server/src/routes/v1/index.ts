import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireAuth } from '../../middleware/auth';
import { meRoutes } from './me';
import { redeemRoutes } from './redeem';
import { generateRoutes } from './generate';
import { communityFeedHandler, communityRoutes } from './community';
import { membershipRoutes } from './membership';
import { membershipTaskRoutes } from './membership-tasks';
import { communityMediaSignBatchHandler, communityMediaSignHandler, mediaRoutes, privateCachedMediaHandler, publicCachedMediaHandler } from './media';
import { extensionRoutes } from './extension';
import { chatRoutes } from './chat';
import { promptToolsRoutes } from './prompt-tools';
import { assetPackagesPublicRoutes, assetPackagesRoutes } from './asset-packages';
import { rateLimit } from '../../middleware/rate-limit';

export const v1 = new Hono<{ Bindings: Env }>();

/** 社区公开图：CDN 缓存代理（游客 img 直链，不走 supabase.co） */
v1.get('/media/c/:enc', rateLimit(1200, 60_000), publicCachedMediaHandler);
/** 私有图：带 token 的 CDN 缓存代理 */
v1.get('/media/i/:enc', rateLimit(1200, 60_000), privateCachedMediaHandler);
/** 社区 sign：返回 CDN URL */
v1.get('/media/community/sign', rateLimit(400, 60_000), communityMediaSignHandler);
/** 社区 Feed 批量 sign（游客可用，首屏一次签多张） */
v1.post('/media/community/sign-batch', rateLimit(300, 60_000), communityMediaSignBatchHandler);

/** 全站社区 Feed：游客与所有用户可见 */
v1.get('/community/feed', rateLimit(180, 60_000), communityFeedHandler);

/** 卡片资产包市场：游客可浏览列表 */
v1.route('/asset-packages', assetPackagesPublicRoutes);

v1.use('*', requireAuth);

v1.route('/asset-packages', assetPackagesRoutes);

v1.route('/me', meRoutes);
v1.route('/membership', membershipRoutes);
v1.route('/membership/tasks', membershipTaskRoutes);
v1.route('/media', mediaRoutes);
v1.route('/redeem', redeemRoutes);
v1.route('/generate', generateRoutes);
v1.route('/chat', chatRoutes);
v1.route('/prompt-tools', promptToolsRoutes);
v1.route('/community', communityRoutes);
v1.route('/extension', extensionRoutes);
