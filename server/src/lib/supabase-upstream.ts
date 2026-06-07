import type { Env } from '../env';

const ICP_HINT =
  '阿里云拦截：实例未备案或域名未绑定，Cloudflare Worker 访问 Supabase 返回备案页（非 JSON）。' +
  '需完成 ICP 备案并在 RDS Supabase 绑定已备案域名开启 HTTPS，或改迁 MemFire（见 docs/MEMFIRE-MIGRATION.md）。';

const SSRF_1003_HINT =
  'Cloudflare Worker 不能 fetch 裸 IP。请用灰云 DNS（sb.prompt-hub.cn）并设 SUPABASE_URL=http://sb.prompt-hub.cn。';

export function isIcpBlockBody(text: string): boolean {
  return /ICP Filing|beian-block|Non-compliance ICP/i.test(text);
}

export async function diagnoseSupabaseUpstream(env: Env): Promise<string | undefined> {
  const base = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return undefined;
  try {
    const res = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const text = await res.text();
    if (isIcpBlockBody(text)) return ICP_HINT;
    if (text.includes('1003')) return SSRF_1003_HINT;
  } catch {
    /* ignore */
  }
  return undefined;
}

export const SUPABASE_ICP_HINT = ICP_HINT;
