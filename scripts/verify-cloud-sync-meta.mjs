/**
 * 验收：user_data 增量同步 — meta 请求应远小于全量 data
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(join(root, 'scripts', 'admin.local.env'), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const SUPABASE_URL = env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_EMAIL = '2705367723@qq.com';
const TEST_UID = 'ab5c77dc-570e-4af7-ac38-2d311be96244';

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

async function getUserJwt() {
  const link = await sb('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL })
  }).catch(() => null);
  // use fetch with POST
}

async function main() {
  const metaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_data?select=updated_at&user_id=eq.${TEST_UID}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const metaBuf = await metaRes.arrayBuffer();
  const metaJson = JSON.parse(new TextDecoder().decode(metaBuf));

  const fullRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_data?select=data,updated_at&user_id=eq.${TEST_UID}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const fullBuf = await fullRes.arrayBuffer();

  console.log('meta bytes:', metaBuf.byteLength, 'updated_at:', metaJson?.[0]?.updated_at);
  console.log('full bytes:', fullBuf.byteLength, `(${(fullBuf.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  const pass = metaBuf.byteLength < 2048 && fullBuf.byteLength > 100000;
  console.log('\n结果:', pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
