/**
 * 验收：生图仓库列表应只签/拉 grid，不拉 full 原图。
 * 用法：node scripts/verify-warehouse-bandwidth.mjs
 * 需 scripts/admin.local.env（SUPABASE_URL + SERVICE_ROLE_KEY）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'scripts', 'admin.local.env');
const envText = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const API = 'https://api.prompt-hubs.com';
const TEST_EMAIL = '2705367723@qq.com';
const TEST_UID = 'ab5c77dc-570e-4af7-ac38-2d311be96244';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

function gridPathFromPrimary(path) {
  const clean = String(path || '').replace(/^\//, '');
  if (!clean || /_grid\.(jpe?g|webp|png)$/i.test(clean)) return null;
  const m = clean.match(/^(.+\/)([^/]+)\.(jpe?g|webp|png)$/i);
  if (!m) return null;
  return `${m[1]}${m[2]}_grid.jpg`;
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function getUserJwt() {
  const link = await sb('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL })
  });
  const otp = link?.email_otp;
  if (!otp) throw new Error('generate_link 无 email_otp');
  const verify = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL, token: otp })
  });
  const data = await verify.json();
  if (!verify.ok || !data.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.access_token;
}

async function findGeneratedPrimary() {
  const { data: row } = await sb(
    `/rest/v1/user_data?user_id=eq.${TEST_UID}&select=data&limit=1`
  );
  const cards = row?.[0]?.data?.cards || [];
  for (const c of cards) {
    const img = String(c?.image || '');
    if (!img) continue;
    const fromRef = img.replace(/^storage:\/\/card-images\//, '').replace(/^\//, '');
    if (fromRef.includes('/generated/') && !/_grid\./i.test(fromRef)) return fromRef;
  }
  const jobs = await sb(
    `/rest/v1/generation_requests?user_id=eq.${TEST_UID}&status=eq.completed&select=result_image_url&order=created_at.desc&limit=5`
  );
  for (const j of jobs || []) {
    const raw = String(j?.result_image_url || '');
    const p = raw.replace(/^storage:\/\/card-images\//, '').replace(/^\//, '');
    if (p.includes('/generated/') && !/_grid\./i.test(p)) return p;
  }
  throw new Error('未找到 generated 图片路径');
}

async function signRef(jwt, ref) {
  const q = encodeURIComponent(ref);
  const res = await fetch(`${API}/api/v1/media/sign?ref=${q}`, {
    headers: { Authorization: `Bearer ${jwt}` }
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(`sign failed: ${JSON.stringify(json).slice(0, 200)}`);
  return json.data.url;
}

async function headSize(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`GET ${res.status} ${url.slice(0, 80)}`);
  const buf = await res.arrayBuffer();
  return buf.byteLength;
}

async function main() {
  console.log('1) 登录测试账号…');
  const jwt = await getUserJwt();
  console.log('   JWT OK');

  console.log('2) 找 generated 原图…');
  const primary = await findGeneratedPrimary();
  const grid = gridPathFromPrimary(primary);
  console.log(`   primary: ${primary}`);
  console.log(`   grid:    ${grid}`);

  console.log('3) 签 primary ref（应返回 grid CDN URL）…');
  const ref = `storage://card-images/${primary}`;
  const signedUrl = await signRef(jwt, ref);
  const signedPath = decodeURIComponent(
    (signedUrl.match(/\/media\/i\/([^?]+)/) || [])[1] || ''
      .replace(/-/g, '+').replace(/_/g, '/')
  );
  let decodedPath = '';
  try {
    decodedPath = Buffer.from(signedPath, 'base64').toString('utf8');
  } catch { /* ignore */ }
  const isGridUrl = /_grid\.(jpe?g|webp|png)/i.test(decodedPath) || /_grid/i.test(signedUrl);
  console.log(`   signed path: ${decodedPath || '(decode fail)'}`);
  console.log(`   grid in token: ${isGridUrl ? 'YES' : 'NO'}`);

  console.log('4) 下载 signed URL 测体积…');
  const signedBytes = await headSize(signedUrl);
  console.log(`   signed: ${(signedBytes / 1024).toFixed(1)} KB`);

  console.log('5) 批量签 12 张生图 grid 估首屏…');
  const jobs = await sb(
    `/rest/v1/generation_requests?user_id=eq.${TEST_UID}&status=eq.completed&select=result_image_url&order=created_at.desc&limit=12`
  );
  const paths = (jobs || []).map((j) => {
    const p = String(j?.result_image_url || '').replace(/^storage:\/\/card-images\//, '').replace(/^\//, '');
    return p.includes('/generated/') && !/_grid\./i.test(p) ? p : null;
  }).filter(Boolean);
  let total = signedBytes;
  let max = signedBytes;
  let gridOk = isGridUrl ? 1 : 0;
  for (const p of paths.slice(0, 11)) {
    const u = await signRef(jwt, `storage://card-images/${p}`);
    const n = await headSize(u);
    total += n;
    if (n > max) max = n;
    if (/_grid/i.test(u)) gridOk += 1;
  }
  const nImg = Math.min(paths.length, 11) + 1;
  console.log(`   ${nImg} 张合计: ${(total / 1024 / 1024).toFixed(2)} MB · 最大单张 ${(max / 1024).toFixed(1)} KB`);

  const fullUrlRes = await fetch(
    `${API}/api/v1/media/sign?ref=${encodeURIComponent(ref)}&variant=full`,
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const fullJson = await fullUrlRes.json();
  const fullUrl = fullJson?.data?.url;
  if (fullUrl) {
    const fullBytes = await headSize(fullUrl);
    console.log(`   full (variant=full): ${(fullBytes / 1024).toFixed(1)} KB`);
  }

  const pass = isGridUrl && signedBytes <= 350 * 1024 && total <= 2.5 * 1024 * 1024 && max <= 350 * 1024;
  console.log('\n结果:', pass ? 'PASS' : 'FAIL');
  if (!isGridUrl) console.error('- 签名 URL 未指向 _grid');
  if (signedBytes > 350 * 1024) console.error('- grid 体积 > 350KB');
  if (total > 2.5 * 1024 * 1024) console.error('- 12 张合计 > 2.5MB');
  if (max > 350 * 1024) console.error('- 存在超大单张');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
