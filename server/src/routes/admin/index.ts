import { Hono } from 'hono';
import type { Env } from '../../env';
import { adminCodeRoutes } from './codes';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.route('/codes', adminCodeRoutes);
