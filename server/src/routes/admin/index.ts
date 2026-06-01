import { Hono } from 'hono';
import type { Env } from '../../env';
import { adminCodeRoutes } from './codes';
import { adminDashboardRoutes } from './dashboard';
import { adminUserRoutes } from './users';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.route('/dashboard', adminDashboardRoutes);
adminRoutes.route('/users', adminUserRoutes);
adminRoutes.route('/codes', adminCodeRoutes);
