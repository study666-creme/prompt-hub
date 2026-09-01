import type { Context } from 'hono';
import { ApiError } from './errors';

/**
 * 请求体大小预检：在 `c.req.json()` 把整个 body 读进内存之前，用
 * Content-Length 直接拒绝超限请求。没有这道闸，参考图类接口在 zod 校验
 * 之前就会把最大 ~96MB 的 body 完整 parse 一遍，一个合法登录用户就足以
 * 撞穿 isolate 的 128MB 内存墙。
 *
 * Content-Length 缺失或不可信时放行（Workers 平台对 HTTP/1.1 POST 的
 * Content-Length 是可靠的；分块传输没有该头时由 schema 的逐字段上限兜底）。
 */
export function assertRequestBodySizeLimit(
  c: Context,
  maxBytes: number
): void {
  const raw = String(c.req.header('content-length') || '').trim();
  if (!raw) return;
  const declared = Number(raw);
  if (!Number.isFinite(declared) || declared <= 0) return;
  if (declared > maxBytes) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `请求体过大（${Math.round(declared / (1024 * 1024))}MB，上限 ${Math.round(maxBytes / (1024 * 1024))}MB），请减少或压缩参考图`
    );
  }
}
