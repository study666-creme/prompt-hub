import type { Env } from '../env';
import { ApiError } from './errors';

/**
 * 运营紧急开关：`CANVAS_GENERATION_DISABLED=true` 时拒绝画布（product=canvas）的新生成提交。
 * 只拦截提交：已受理任务的查询、clientRequestId 重放与观察路由不受影响，
 * 已扣费任务必须保持可恢复。Prompt Hub 自有入口（不携带 product=canvas）不受此开关影响。
 */
export function assertCanvasGenerationEnabled(
  env: Pick<Env, 'CANVAS_GENERATION_DISABLED'>,
  product: unknown
): void {
  if (product !== 'canvas') return;
  const disabled = String(env.CANVAS_GENERATION_DISABLED ?? '').trim().toLowerCase() === 'true';
  if (!disabled) return;
  throw new ApiError(503, 'GENERATION_DISABLED', '画布生成功能维护中，暂时无法提交新任务');
}
