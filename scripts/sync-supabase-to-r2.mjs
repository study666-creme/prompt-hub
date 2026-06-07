#!/usr/bin/env node
/**
 * Supabase card-images → Cloudflare R2 同步（或仅下载备份）
 *
 * 用法：
 *   node scripts/sync-supabase-to-r2.mjs
 *   node scripts/sync-supabase-to-r2.mjs --download-only --out backups/card-images
 *
 * 配置：scripts/admin.local.env（勿提交 git）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

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

const SUPABASE_URL = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const BUCKET = 'card-images';
const R2_ACCOUNT_ID = String(env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = String(env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = String(env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = String(env.R2_BUCKET || 'prompt-hub-card-images').trim();

const args = process.argv.slice(2);
const downloadOnly = args.includes('--download-only');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? path.resolve(root, args[outIdx + 1] || 'backups/card-images') : null;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，请写入 scripts/admin.local.env');
  process.exit(1);
}

if (!downloadOnly && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('上传 R2 需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  console.error('仅下载：node scripts/sync-supabase-to-r2.mjs --download-only --out backups/card-images');
  process.exit(1);
}

function awsV4Sign({ method, url, headers, payloadHash, accessKey, secretKey, region = 'auto', service = 's3' }) {
  const u = new URL(url);
  const amzDate = headers['x-amz-date'];
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k.toLowerCase()}:${String(headers[k]).trim()}\n`)
    .join('');
  const signedHeaders = Object.keys(headers)
    .sort()
    .map((k) => k.toLowerCase())
    .join(';');
  const canonicalRequest = [
    method,
    u.pathname,
    u.search ? u.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate };
}

async function r2PutObject(key, body, contentType) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const objectPath = `/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = `https://${host}${objectPath}`;
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = {
    Host: host,
    'Content-Type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const { authorization } = awsV4Sign({
    method: 'PUT',
    url,
    headers,
    payloadHash,
    accessKey: R2_ACCESS_KEY_ID,
    secretKey: R2_SECRET_ACCESS_KEY
  });
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} ${res.status} ${t.slice(0, 200)}`);
  }
}

async function r2HeadObject(key) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const objectPath = `/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = `https://${host}${objectPath}`;
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = {
    Host: host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const { authorization } = awsV4Sign({
    method: 'HEAD',
    url,
    headers,
    payloadHash,
    accessKey: R2_ACCESS_KEY_ID,
    secretKey: R2_SECRET_ACCESS_KEY
  });
  const res = await fetch(url, { method: 'HEAD', headers: { ...headers, Authorization: authorization } });
  return res.ok;
}

async function listFolder(prefix = '') {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 })
  });
  if (!res.ok) throw new Error(`list ${prefix || '(root)'} ${res.status} ${await res.text()}`);
  return res.json();
}

async function walkStorage(prefix = '', keys = []) {
  const batch = await listFolder(prefix);
  if (!Array.isArray(batch)) return keys;
  for (const item of batch) {
    const child = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      keys.push(child);
    } else {
      await walkStorage(child, keys);
    }
  }
  return keys;
}

async function downloadObject(key, tries = 3) {
  const enc = key.split('/').map(encodeURIComponent).join('/');
  let lastErr;
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc}`, {
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }
      });
      if (!res.ok) throw new Error(`download ${key} ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (a + 1 < tries) await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
  throw lastErr;
}

function contentTypeFor(key) {
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.webp$/i.test(key)) return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  console.log('扫描 Supabase Storage', BUCKET, '...');
  const keys = [...new Set((await walkStorage('', [])).map((k) => k.replace(/^\//, '')).filter(Boolean))];
  console.log('发现对象:', keys.length);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let downloaded = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if ((i + 1) % 10 === 0 || i === 0) console.log(`[${i + 1}/${keys.length}] ${key}`);

    try {
      if (downloadOnly || outDir) {
        const buf = await downloadObject(key);
        if (outDir) {
          const dest = path.join(outDir, key);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
        }
        downloaded += 1;
        if (downloadOnly) continue;
      }

      if (!downloadOnly) {
        const exists = await r2HeadObject(key).catch(() => false);
        if (exists) {
          skipped += 1;
          continue;
        }
        const buf = outDir && fs.existsSync(path.join(outDir, key))
          ? fs.readFileSync(path.join(outDir, key))
          : await downloadObject(key);
        await r2PutObject(key, buf, contentTypeFor(key));
        uploaded += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn('FAIL', key, e?.message || e);
    }
  }

  console.log('\n完成');
  console.log({ total: keys.length, downloaded, uploaded, skipped, failed, downloadOnly, outDir });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
