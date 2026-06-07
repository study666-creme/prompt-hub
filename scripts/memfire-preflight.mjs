#!/usr/bin/env node
/**
 * 迁移前后检查：Storage 对象数、关键表行数、可选 /health
 *
 * 用法：
 *   node scripts/memfire-preflight.mjs
 *   node scripts/memfire-preflight.mjs --api https://api.prompt-hub.cn
 *
 * admin.local.env：
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（旧，可选）
 *   MEMFIRE_URL + MEMFIRE_SERVICE_ROLE_KEY（新）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'card-images';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...process.env, ...loadEnvFile(path.join(__dirname, 'admin.local.env')) };
const apiIdx = process.argv.indexOf('--api');
const apiBase = apiIdx >= 0 ? process.argv[apiIdx + 1] : '';

async function countStorage(label, baseUrl, key) {
  if (!baseUrl || !key) {
    console.log(`[${label}] 跳过（未配置 URL/KEY）`);
    return null;
  }
  async function walk(prefix = '', n = 0) {
    const res = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 })
    });
    if (!res.ok) throw new Error(`${label} list ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) return n;
    for (const item of batch) {
      const child = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) n += 1;
      else n = await walk(child, n);
    }
    return n;
  }
  const count = await walk();
  console.log(`[${label}] Storage ${BUCKET} 对象约: ${count}`);
  return count;
}

async function sqlCount(label, baseUrl, key, sql) {
  if (!baseUrl || !key) return;
  const res = await fetch(`${baseUrl}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'params=single-object'
    },
    body: JSON.stringify({})
  }).catch(() => null);
  void res;
  const q = encodeURIComponent(sql);
  const res2 = await fetch(`${baseUrl}/rest/v1/profiles?select=user_id&limit=1`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, Prefer: 'count=exact' }
  }).catch(() => null);
  if (res2?.ok) {
    const range = res2.headers.get('content-range') || '';
    const m = range.match(/\/(\d+)$/);
    if (m) console.log(`[${label}] profiles 约: ${m[1]}`);
    return;
  }
  console.log(`[${label}] REST 计数跳过（用 SQL 编辑器手动查 auth.users / profiles）`);
}

async function checkHealth() {
  if (!apiBase) return;
  const url = `${apiBase.replace(/\/$/, '')}/health`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) {
    console.log(`[API] ${url} 失败 ${res?.status || 'network'}`);
    return;
  }
  const j = await res.json().catch(() => ({}));
  console.log(`[API] ${url}`, JSON.stringify(j));
}

async function main() {
  console.log('=== MemFire 迁移预检 ===\n');
  const oldUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const oldKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const newUrl = String(env.MEMFIRE_URL || '').replace(/\/$/, '');
  const newKey = String(env.MEMFIRE_SERVICE_ROLE_KEY || '').trim();

  const oldN = await countStorage('Supabase', oldUrl, oldKey);
  const newN = await countStorage('MemFire', newUrl, newKey);

  if (oldN != null && newN != null) {
    const diff = oldN - newN;
    if (diff === 0) console.log('\n✓ Storage 数量一致');
    else if (diff > 0) console.log(`\n⚠ MemFire 少 ${diff} 个对象，可再跑 memfire-upload-storage.mjs`);
    else console.log(`\n⚠ MemFire 比 Supabase 多 ${-diff} 个（可能重复上传，一般无害）`);
  }

  await sqlCount('MemFire', newUrl, newKey);
  await checkHealth();
  console.log('\n完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
