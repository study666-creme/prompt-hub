#!/usr/bin/env node
/**
 * 卡片库图片诊断：统计 metadata + R2 是否存在对应路径
 * 用法：node scripts/audit-card-images.mjs
 * 配置：scripts/admin.local.env（SUPABASE_* + R2_*）
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

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
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...process.env, ...loadEnvFile(path.join(__dirname, 'admin.local.env')) };
const SUPABASE_URL = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const R2_ACCOUNT_ID = String(env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = String(env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = String(env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = String(env.R2_BUCKET || 'prompt-hub-card-images').trim();
const USER_ID = String(env.AUDIT_USER_ID || '').trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（scripts/admin.local.env）');
  process.exit(1);
}
if (!USER_ID) {
  console.error('缺少 AUDIT_USER_ID（通过环境变量或 scripts/admin.local.env 设置）');
  process.exit(1);
}

function awsV4Sign({ method, url, headers, payloadHash, accessKey, secretKey }) {
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
  const canonicalRequest = [method, u.pathname, u.search ? u.search.slice(1) : '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function r2Head(key) {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const objectPath = `/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = `https://${host}${objectPath}`;
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = { Host: host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = awsV4Sign({
    method: 'HEAD',
    url,
    headers,
    payloadHash,
    accessKey: R2_ACCESS_KEY_ID,
    secretKey: R2_SECRET_ACCESS_KEY
  });
  const res = await fetch(url, { method: 'HEAD', headers: { ...headers, Authorization: authorization } });
  if (!res.ok) return false;
  const len = Number(res.headers.get('content-length') || 0);
  return len >= 512;
}

function storagePathFromRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  if (s.startsWith('storage://')) return s.slice('storage://'.length).replace(/^card-images\//, '');
  if (s.includes('/card-images/')) return s.split('/card-images/').pop()?.replace(/^\//, '') || null;
  return null;
}

function gridPathFromPrimary(p) {
  return p.replace(/\.(jpe?g|webp|png)$/i, '_grid.jpg');
}

function cardImageStoragePath(cardId, uid) {
  const base = String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${uid}/${base}.jpg`;
}

function normalizeGallery(card) {
  let imgs = Array.isArray(card.cardImages) ? card.cardImages.filter(Boolean) : [];
  if (!imgs.length && Array.isArray(card.mjGridUrls)) imgs = card.mjGridUrls.filter(Boolean);
  if (!imgs.length && card.image) imgs = [card.image];
  return imgs.slice(0, 5);
}

function resolveGenJobId(card) {
  if (card.genJobId) return String(card.genJobId).replace(/#\d+$/, '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const t of card.tags || []) {
    if (uuid.test(String(t || '').trim())) return String(t).trim();
  }
  return null;
}

function classifyCard(card) {
  const img = String(card.image || '');
  const gallery = normalizeGallery(card);
  const jobId = resolveGenJobId(card);
  if (img.includes('storage://') || img.includes('/generated/')) return 'image_storage';
  if (gallery.some((u) => String(u).includes('storage://') || String(u).includes('/generated/'))) return 'gallery_storage';
  if (jobId) return 'gen_job_only';
  if (gallery.length) return 'gallery_other';
  if (img.startsWith('http') || img.startsWith('data:')) return 'direct_url';
  return 'no_image_ref';
}

async function collectPaths(card, uid) {
  const paths = new Set();
  const add = (p) => {
    const k = String(p || '').replace(/^\//, '');
    if (k) paths.add(k);
  };
  for (const ref of normalizeGallery(card)) {
    const p = storagePathFromRef(ref);
    if (p) {
      add(p);
      add(gridPathFromPrimary(p));
    }
  }
  const imgPath = storagePathFromRef(card.image);
  if (imgPath) {
    add(imgPath);
    add(gridPathFromPrimary(imgPath));
  }
  add(cardImageStoragePath(card.id, uid));
  add(gridPathFromPrimary(cardImageStoragePath(card.id, uid)));
  add(`${uid}/generated/${String(card.id).replace(/^wh_/, '')}.jpg`);
  add(`${uid}/generated/${String(card.id).replace(/^wh_/, '')}_grid.jpg`);
  return [...paths];
}

async function fetchUserCards(uid) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${uid}&select=data`, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Accept: 'application/json'
    }
  });
  if (!res.ok) throw new Error(`user_data ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const data = rows[0]?.data;
  if (!data) throw new Error('user_data 空');
  const cards = data.cards || data.prompts || [];
  return Array.isArray(cards) ? cards : [];
}

async function main() {
  console.log('拉取 user_data…', USER_ID);
  const cards = await fetchUserCards(USER_ID);
  console.log('卡片总数:', cards.length);

  const buckets = {};
  for (const c of cards) {
    const k = classifyCard(c);
    buckets[k] = (buckets[k] || 0) + 1;
  }
  console.log('\n=== metadata 分类 ===');
  console.log(buckets);

  const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
  if (!hasR2) {
    console.log('\n（未配置 R2，跳过路径存在检查）');
    return;
  }

  let r2Ok = 0;
  let r2Miss = 0;
  const missSamples = [];

  for (const c of cards) {
    const paths = await collectPaths(c, USER_ID);
    let anyOk = false;
    let gridOk = false;
    for (const p of paths) {
      const ok = await r2Head(p);
      if (ok) {
        anyOk = true;
        if (/_grid\.(jpe?g|webp|png)$/i.test(p)) gridOk = true;
      }
    }
    if (anyOk) r2Ok += 1;
    else {
      r2Miss += 1;
      if (missSamples.length < 8) {
        missSamples.push({
          id: c.id,
          title: (c.title || c.prompt || '').slice(0, 40),
          class: classifyCard(c),
          image: c.image || null,
          galleryLen: normalizeGallery(c).length,
          genJobId: resolveGenJobId(c),
          triedPaths: paths.slice(0, 4)
        });
      }
    }
  }

  console.log('\n=== R2 路径探测（任一候选存在即算有图）===');
  console.log({ r2Ok, r2Miss, r2MissPct: `${((r2Miss / cards.length) * 100).toFixed(1)}%` });
  if (missSamples.length) {
    console.log('\n无 R2 命中样例（前 8 张）:');
    console.log(JSON.stringify(missSamples, null, 2));
  }

  const recCard = cards.find((c) => c.id === 'rec_mq9fygli_7kqxji');
  if (recCard) {
    console.log('\n=== rec_mq9fygli_7kqxji 详情 ===');
    console.log({
      image: recCard.image,
      genJobId: resolveGenJobId(recCard),
      gallery: normalizeGallery(recCard),
      class: classifyCard(recCard),
      paths: await collectPaths(recCard, USER_ID)
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
