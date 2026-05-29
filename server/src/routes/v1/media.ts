import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../env';
import { ApiError } from '../../lib/errors';
import { storagePathFromRef } from '../../lib/image-archive';
import { createAdminClient } from '../../lib/supabase';
import { rateLimit } from '../../middleware/rate-limit';

const BUCKET = 'card-images';
const SIGNED_SEC = 3600;
/** 社区公开浏览：用户目录下任意层级图片（含 generated/） */
function isAllowedCommunityPath(path: string): boolean {
  const key = path.replace(/^\//, '');
  if (!key || key.includes('..')) return false;
  return /^[^/]+\/.+\.(jpe?g|png|webp)$/i.test(key);
}

const ALLOWED_FETCH_HOSTS = [
  'apimart.ai',
  'api.apimart.ai',
  'filesystem.site',
  'supabase.co'
];

function assertOwnPath(userId: string, path: string): void {
  const norm = path.replace(/^\//, '');
  if (!norm.startsWith(`${userId}/`)) {
    throw new ApiError(403, 'FORBIDDEN', '无权访问该图片');
  }
}

function isAllowedRemoteUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_FETCH_HOSTS.some(
      h => u.hostname === h || u.hostname.endsWith('.' + h)
    );
  } catch {
    return false;
  }
}

export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.use('*', rateLimit(180, 60_000));

/** 仅原图短时签名（不用 Storage transform，避免未开通图像处理时整站 500） */
async function createSignedUrlSafe(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
  _thumbW?: number
) {
  const clean = path.replace(/^\//, '');
  return admin.storage.from(BUCKET).createSignedUrl(clean, SIGNED_SEC);
}

function sanitizeCardFileBase(cardId: string): string {
  return String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function communityPathCandidates(
  ref: string,
  authorId?: string,
  cardId?: string
): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    const key = p.replace(/^\//, '');
    if (key && isAllowedCommunityPath(key) && !out.includes(key)) out.push(key);
  };
  const fromRef = storagePathFromRef(ref);
  if (fromRef) add(fromRef);
  const aid = (authorId || '').trim();
  const cid = (cardId || '').trim();
  if (aid && cid) {
    const base = sanitizeCardFileBase(cid);
    add(`${aid}/${base}.jpg`);
    add(`${aid}/${cid}.jpg`);
    add(`${aid}/${base}.webp`);
    add(`${aid}/${base}.png`);
  }
  return out;
}

/** 游客/未登录：社区流图片短时签名（只读，限路径格式） */
export async function communityMediaSignHandler(c: Context<{ Bindings: Env }>) {
  const ref = (c.req.query('ref') || '').trim();
  const authorId = (c.req.query('authorId') || '').trim();
  const cardId = (c.req.query('cardId') || '').trim();
  const paths = communityPathCandidates(ref, authorId, cardId);
  if (!paths.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的图片引用');
  }
  const admin = createAdminClient(c.env);
  const thumbW = Math.min(1200, Math.max(0, Number(c.req.query('w') || 640)));
  let lastErr: unknown = null;
  for (const path of paths) {
    const { data, error } = await createSignedUrlSafe(admin, path, thumbW);
    if (!error && data?.signedUrl) {
      return c.json({
        ok: true,
        data: { url: data.signedUrl, expiresIn: SIGNED_SEC }
      });
    }
    lastErr = error;
  }
  const msg = String((lastErr as Error)?.message || '签名 URL 生成失败').slice(0, 120);
  if (/not found|object not found|does not exist/i.test(msg)) {
    throw new ApiError(404, 'NOT_FOUND', 'Object not found');
  }
  throw new ApiError(500, 'SIGN_FAILED', msg);
}

/** 将 storage:// 转为短时签名 URL（img 可直接加载） */
mediaRoutes.get('/sign', async c => {
  const user = c.get('user');
  const ref = (c.req.query('ref') || '').trim();
  const path = storagePathFromRef(ref);
  if (!path) {
    throw new ApiError(400, 'VALIDATION_ERROR', '无效的图片引用');
  }
  assertOwnPath(user.id, path);

  const admin = createAdminClient(c.env);
  const thumbW = Math.min(1200, Math.max(0, Number(c.req.query('w') || 0)));
  const { data, error } = await createSignedUrlSafe(admin, path, thumbW);
  if (error || !data?.signedUrl) {
    throw new ApiError(500, 'SIGN_FAILED', '签名 URL 生成失败');
  }

  return c.json({
    ok: true,
    data: { url: data.signedUrl, expiresIn: SIGNED_SEC }
  });
});

/** 从已完成生图任务取可展示 URL（优先 storage 签名） */
mediaRoutes.get('/generation/:jobId/url', async c => {
  const user = c.get('user');
  const jobId = c.req.param('jobId');
  const admin = createAdminClient(c.env);

  const { data: job, error } = await admin
    .from('generation_requests')
    .select('result_image_url, status, user_id')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !job || job.user_id !== user.id) {
    throw new ApiError(404, 'NOT_FOUND', '任务不存在');
  }
  if (job.status !== 'completed' || !job.result_image_url) {
    throw new ApiError(400, 'NOT_READY', '图片尚未生成完成');
  }

  const raw = job.result_image_url;
  const path = storagePathFromRef(raw);
  if (path) {
    assertOwnPath(user.id, path);
    const { data, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_SEC);
    if (signErr || !data?.signedUrl) {
      throw new ApiError(500, 'SIGN_FAILED', '签名失败');
    }
    return c.json({ ok: true, data: { url: data.signedUrl } });
  }

  if (typeof raw === 'string' && raw.startsWith('https://') && isAllowedRemoteUrl(raw)) {
    return c.json({ ok: true, data: { url: raw } });
  }

  throw new ApiError(400, 'INVALID_IMAGE', '无法解析图片地址');
});

/** 代理上游图片（需登录；供 fetch 转 blob，或 img 加 ?access_token= 暂不使用） */
mediaRoutes.get('/fetch', async c => {
  const user = c.get('user');
  void user;
  const url = (c.req.query('url') || '').trim();
  if (!url || !isAllowedRemoteUrl(url)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '不允许的图片地址');
  }

  const res = await fetch(url, { headers: { Accept: 'image/*' } });
  if (!res.ok) {
    throw new ApiError(502, 'UPSTREAM_ERROR', `拉取图片失败 (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const body = await res.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
});
