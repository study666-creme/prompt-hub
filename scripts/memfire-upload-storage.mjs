#!/usr/bin/env node
/**
 * Supabase card-images（或本地 backups）→ MemFire Storage
 *
 * 用法：
 *   node scripts/memfire-upload-storage.mjs
 *   node scripts/memfire-upload-storage.mjs --from-local backups/card-images
 *   node scripts/memfire-upload-storage.mjs --dry-run
 *
 * 配置：scripts/admin.local.env
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（源，--from-local 时可省略下载源）
 *   MEMFIRE_URL + MEMFIRE_SERVICE_ROLE_KEY（目标，必填）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const BUCKET = 'card-images';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const localEnv = loadEnvFile(path.join(__dirname, 'admin.local.env'));
const env = { ...process.env, ...localEnv };

const SRC_URL = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const SRC_KEY = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DST_URL = String(env.MEMFIRE_URL || env.SUPABASE_URL_TARGET || '').replace(/\/$/, '');
const DST_KEY = String(env.MEMFIRE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY_TARGET || '').trim();

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromLocalIdx = args.indexOf('--from-local');
const localRoot = fromLocalIdx >= 0
  ? path.resolve(root, args[fromLocalIdx + 1] || 'backups/card-images')
  : null;

if (!DST_URL || !DST_KEY) {
  console.error('缺少 MEMFIRE_URL 或 MEMFIRE_SERVICE_ROLE_KEY，请写入 scripts/admin.local.env');
  process.exit(1);
}
if (!localRoot && (!SRC_URL || !SRC_KEY)) {
  console.error('从 Supabase 拉取需要 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  console.error('或：node scripts/memfire-upload-storage.mjs --from-local backups/card-images');
  process.exit(1);
}

function contentTypeFor(key) {
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.webp$/i.test(key)) return 'image/webp';
  if (/\.gif$/i.test(key)) return 'image/gif';
  return 'image/jpeg';
}

async function listFolder(baseUrl, key, prefix = '') {
  const res = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 })
  });
  if (!res.ok) throw new Error(`list ${prefix || '(root)'} ${res.status} ${await res.text()}`);
  return res.json();
}

async function walkStorage(baseUrl, serviceKey, prefix = '', keys = []) {
  const batch = await listFolder(baseUrl, serviceKey, prefix);
  if (!Array.isArray(batch)) return keys;
  for (const item of batch) {
    const child = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) keys.push(child);
    else await walkStorage(baseUrl, serviceKey, child, keys);
  }
  return keys;
}

async function downloadFromSupabase(key) {
  const enc = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${SRC_URL}/storage/v1/object/${BUCKET}/${enc}`, {
    headers: { Authorization: `Bearer ${SRC_KEY}`, apikey: SRC_KEY }
  });
  if (!res.ok) throw new Error(`download ${key} ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function readLocal(key) {
  const p = path.join(localRoot, key);
  if (!fs.existsSync(p)) throw new Error(`local missing ${p}`);
  return fs.readFileSync(p);
}

function walkLocal(dir, prefix = '', keys = []) {
  if (!fs.existsSync(dir)) return keys;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) walkLocal(full, rel, keys);
    else keys.push(rel.replace(/\\/g, '/'));
  }
  return keys;
}

async function existsOnMemfire(key) {
  const enc = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${DST_URL}/storage/v1/object/${BUCKET}/${enc}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${DST_KEY}`, apikey: DST_KEY }
  });
  return res.ok;
}

async function uploadToMemfire(key, body) {
  const enc = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${DST_URL}/storage/v1/object/${BUCKET}/${enc}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DST_KEY}`,
      apikey: DST_KEY,
      'Content-Type': contentTypeFor(key),
      'x-upsert': 'true'
    },
    body
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`upload ${key} ${res.status} ${t.slice(0, 300)}`);
  }
}

async function main() {
  let keys;
  if (localRoot) {
    console.log('从本地目录读取:', localRoot);
    keys = walkLocal(localRoot);
  } else {
    console.log('从 Supabase 扫描', BUCKET);
    keys = [...new Set((await walkStorage(SRC_URL, SRC_KEY, '', [])).map((k) => k.replace(/^\//, '')).filter(Boolean))];
  }
  console.log('对象数:', keys.length);
  if (dryRun) {
    console.log('dry-run，前 5 个:', keys.slice(0, 5));
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if ((i + 1) % 25 === 0 || i === 0) console.log(`[${i + 1}/${keys.length}] ${key}`);
    try {
      if (await existsOnMemfire(key)) {
        skipped += 1;
        continue;
      }
      const buf = localRoot ? readLocal(key) : await downloadFromSupabase(key);
      await uploadToMemfire(key, buf);
      uploaded += 1;
    } catch (e) {
      failed += 1;
      console.warn('FAIL', key, e?.message || e);
    }
  }

  console.log('\n完成', { total: keys.length, uploaded, skipped, failed, dest: DST_URL });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
