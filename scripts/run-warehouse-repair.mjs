#!/usr/bin/env node
/**
 * 卡片库 R2 回填：Supabase 有原图、R2 缺失时上传到 R2
 *
 * 用法：
 *   node scripts/run-warehouse-repair.mjs
 *   node scripts/run-warehouse-repair.mjs --dry-run
 *   node scripts/run-warehouse-repair.mjs --max 200
 *   node scripts/run-warehouse-repair.mjs --offset 200 --max 200   # 续跑下一批
 *   node scripts/run-warehouse-repair.mjs --all                    # 扫完全部 848 张
 *
 * 配置：scripts/admin.local.env（SUPABASE_* + R2_*）
 * 必填：AUDIT_USER_ID（目标账号 UUID；不要写进公开仓库）
 *
 * 若出现 Connect Timeout：多为网络连不上 Cloudflare R2，请开 VPN 后重试，或用 --offset 续跑。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from '../server/node_modules/sharp/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const BUCKET = 'card-images';
const FETCH_TIMEOUT_MS = 35000;
const FETCH_RETRIES = 4;

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
const API_BASE = String(env.API_BASE_URL || 'https://api.prompt-hubs.com').replace(/\/$/, '');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const scanAll = args.includes('--all');
const maxIdx = args.indexOf('--max');
const offsetIdx = args.indexOf('--offset');
const primaryIdx = args.indexOf('--primary');
const primaryPathArg = primaryIdx >= 0 ? String(args[primaryIdx + 1] || '').replace(/^\//, '') : '';
const maxCards = scanAll
  ? 99999
  : maxIdx >= 0
    ? Math.max(1, Number(args[maxIdx + 1]) || 80)
    : 80;
const startOffset = offsetIdx >= 0 ? Math.max(0, Number(args[offsetIdx + 1]) || 0) : 0;
const useApi = args.includes('--api');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（scripts/admin.local.env）');
  process.exit(1);
}
if (!USER_ID) {
  console.error('缺少 AUDIT_USER_ID（通过环境变量或 scripts/admin.local.env 设置）');
  process.exit(1);
}
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('缺少 R2 凭证（R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY）');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRetry(url, opts = {}, label = 'fetch') {
  let lastErr;
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...opts,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      return res;
    } catch (e) {
      lastErr = e;
      const wait = 1500 * (attempt + 1);
      if (attempt + 1 < FETCH_RETRIES) {
        console.warn(`[retry] ${label} 第 ${attempt + 1} 次失败，${wait}ms 后重试…`, String(e.cause?.code || e.message || e).slice(0, 80));
        await sleep(wait);
      }
    }
  }
  throw lastErr;
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
  try {
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
    const res = await fetchRetry(url, {
      method: 'HEAD',
      headers: { ...headers, Authorization: authorization }
    }, `R2 HEAD ${key}`);
    if (!res.ok) return 0;
    return Number(res.headers.get('content-length') || 0);
  } catch (e) {
    console.warn('[r2Head skip]', key, String(e.cause?.code || e.message || e).slice(0, 100));
    return -1;
  }
}

async function r2Get(key) {
  try {
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const objectPath = `/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const url = `https://${host}${objectPath}`;
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const headers = { Host: host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const authorization = awsV4Sign({
      method: 'GET',
      url,
      headers,
      payloadHash,
      accessKey: R2_ACCESS_KEY_ID,
      secretKey: R2_SECRET_ACCESS_KEY
    });
    const res = await fetchRetry(url, {
      method: 'GET',
      headers: { ...headers, Authorization: authorization }
    }, `R2 GET ${key}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch (e) {
    console.warn('[r2Get skip]', key, String(e.cause?.code || e.message || e).slice(0, 100));
    return null;
  }
}

async function r2Put(key, body, contentType) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const objectPath = `/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = `https://${host}${objectPath}`;
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers = {
    Host: host,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const authorization = awsV4Sign({
    method: 'PUT',
    url,
    headers,
    payloadHash,
    accessKey: R2_ACCESS_KEY_ID,
    secretKey: R2_SECRET_ACCESS_KEY
  });
  const res = await fetchRetry(url, {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body
  }, `R2 PUT ${key}`);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} ${res.status} ${t.slice(0, 120)}`);
  }
}

function storagePathFromRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  if (s.startsWith('storage://')) return s.slice('storage://'.length).replace(/^card-images\//, '');
  if (s.includes('/card-images/')) return s.split('/card-images/').pop()?.replace(/^\//, '') || null;
  return null;
}

function sanitizeCardFileBase(cardId) {
  return String(cardId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function primaryPaths(card, uid) {
  const out = [];
  const add = (p) => {
    const k = String(p || '').replace(/^\//, '');
    if (k && !out.includes(k)) out.push(k);
  };
  const fromRef = storagePathFromRef(card.image);
  if (fromRef) add(fromRef.replace(/_grid\.(jpe?g|webp|png)$/i, '.jpg'));
  const base = sanitizeCardFileBase(card.id);
  add(`${uid}/${base}.jpg`);
  add(`${uid}/${base}.webp`);
  add(`${uid}/${card.id}.jpg`);
  return out;
}

function gridPathFromPrimary(p) {
  return String(p || '').replace(/\.(jpe?g|webp|png)$/i, '_grid.jpg');
}

const GRID_MIN_BYTES = 2048;
const GRID_MAX_BYTES = 220 * 1024;

async function createGridJpeg(source) {
  for (const quality of [78, 68, 58]) {
    const out = await sharp(source)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length >= GRID_MIN_BYTES && out.length <= GRID_MAX_BYTES) return out;
  }
  return null;
}

async function backfillGridForPrimary(primaryKey, dryRunFlag) {
  const gridKey = gridPathFromPrimary(primaryKey);
  if (!gridKey || gridKey === primaryKey) return false;
  const gSize = await r2Head(gridKey);
  if (gSize >= GRID_MIN_BYTES) return false;
  if (dryRunFlag) {
    console.log('[dry-run] 将回填 grid →', gridKey);
    return true;
  }
  let buf = await downloadFromSupabase(gridKey);
  if (!buf) {
    const primary = await r2Get(primaryKey) || await downloadFromSupabase(primaryKey);
    if (!primary) return false;
    buf = await createGridJpeg(primary);
  }
  if (!buf || buf.length < GRID_MIN_BYTES || buf.length > GRID_MAX_BYTES) return false;
  await r2Put(gridKey, buf, 'image/jpeg');
  console.log('  ↳ grid', gridKey, buf.length);
  return true;
}

function contentTypeFor(key) {
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.webp$/i.test(key)) return 'image/webp';
  return 'image/jpeg';
}

async function downloadFromSupabase(key) {
  try {
    const enc = key.split('/').map(encodeURIComponent).join('/');
    const res = await fetchRetry(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc}`, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }
    }, `Supabase GET ${key}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 512 ? buf : null;
  } catch (e) {
    console.warn('[supabase skip]', key, String(e.message || e).slice(0, 80));
    return null;
  }
}

async function fetchUserCards(uid) {
  const res = await fetchRetry(`${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${uid}&select=data`, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Accept: 'application/json'
    }
  }, 'user_data');
  if (!res.ok) throw new Error(`user_data ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const data = rows[0]?.data;
  const cards = data?.cards || data?.prompts || [];
  return Array.isArray(cards) ? cards : [];
}

async function callApiRepair(token) {
  const res = await fetchRetry(`${API_BASE}/api/v1/generate/recover-warehouse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mode: 'repair', max: maxCards, days: 365, offset: 0 })
  }, 'API repair');
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function runBatch(cards, startOffset, batchMax, dryRunFlag) {
  let scanned = 0;
  let backfilled = 0;
  let gridsBackfilled = 0;
  let skippedOk = 0;
  let noSource = 0;
  let networkSkip = 0;
  const failures = [];
  let cardIndex = 0;

  for (const card of cards) {
    if (!card?.image && !card?.id) continue;
    if (cardIndex < startOffset) {
      cardIndex += 1;
      continue;
    }
    if (scanned >= batchMax) break;
    scanned += 1;
    cardIndex += 1;

    if (scanned % 25 === 0) {
      console.log(`…进度 ${scanned}/${batchMax}（库内第 ${cardIndex}/${cards.length} 张）`);
    }

    const paths = primaryPaths(card, USER_ID);
    let bestKey = null;
    let bestSize = 0;
    let r2AlreadyOk = false;
    let hadNetworkErr = false;
    let primaryOnR2 = null;

    for (const key of paths) {
      const r2Size = await r2Head(key);
      if (r2Size === -1) {
        hadNetworkErr = true;
        continue;
      }
      if (r2Size >= 512) {
        r2AlreadyOk = true;
        primaryOnR2 = key;
        break;
      }
      const sup = await downloadFromSupabase(key);
      if (sup && sup.length > bestSize) {
        bestSize = sup.length;
        bestKey = key;
      }
      await sleep(80);
    }

    if (r2AlreadyOk) {
      if (primaryOnR2 && (await backfillGridForPrimary(primaryOnR2, dryRunFlag))) {
        gridsBackfilled += 1;
      }
      skippedOk += 1;
      continue;
    }
    if (hadNetworkErr && !bestKey) {
      networkSkip += 1;
      failures.push({ cardId: card.id, reason: 'r2_network_timeout' });
      continue;
    }
    if (!bestKey) {
      noSource += 1;
      continue;
    }

    if (dryRunFlag) {
      console.log('[dry-run] 将回填', card.id, '→', bestKey, `(${bestSize} bytes)`);
      backfilled += 1;
      continue;
    }

    try {
      const buf = await downloadFromSupabase(bestKey);
      if (!buf) {
        noSource += 1;
        continue;
      }
      await r2Put(bestKey, buf, contentTypeFor(bestKey));
      console.log('✓', card.id, bestKey, buf.length);
      backfilled += 1;
      if (await backfillGridForPrimary(bestKey, dryRunFlag)) gridsBackfilled += 1;
    } catch (e) {
      failures.push({ cardId: card.id, key: bestKey, err: String(e.message || e) });
    }
  }

  const nextOffset = startOffset + scanned;
  return {
    scanned,
    backfilled,
    gridsBackfilled,
    skippedOk,
    noSource,
    networkSkip,
    failures,
    nextOffset: nextOffset < cards.length ? nextOffset : null
  };
}

async function main() {
  console.log('=== 卡片库 R2 回填 ===');
  console.log('用户:', USER_ID);
  console.log('模式:', dryRun ? 'dry-run' : 'upload', useApi ? '+ API repair' : '', scanAll ? '+ 全自动' : '');

  if (primaryPathArg) {
    if (!primaryPathArg.startsWith(`${USER_ID}/`)) {
      throw new Error('primary path does not belong to AUDIT_USER_ID');
    }
    const repaired = await backfillGridForPrimary(primaryPathArg, dryRun);
    console.log('单路径:', { primary: primaryPathArg, repaired });
    if (!repaired) process.exitCode = 2;
    return;
  }

  const cards = await fetchUserCards(USER_ID);
  console.log('卡片总数:', cards.length);

  const batchSize = scanAll ? 200 : maxCards;
  let offset = startOffset;
  let totals = { scanned: 0, backfilled: 0, gridsBackfilled: 0, skippedOk: 0, noSource: 0, networkSkip: 0, failures: 0 };

  do {
    console.log('\n--- 批次 ---', { offset, batchSize });
    const r = await runBatch(cards, offset, batchSize, dryRun);
    totals.scanned += r.scanned;
    totals.backfilled += r.backfilled;
    totals.gridsBackfilled += r.gridsBackfilled;
    totals.skippedOk += r.skippedOk;
    totals.noSource += r.noSource;
    totals.networkSkip += r.networkSkip;
    totals.failures += r.failures.length;
    console.log('本批:', {
      scanned: r.scanned,
      backfilled: r.backfilled,
      gridsBackfilled: r.gridsBackfilled,
      skippedOk: r.skippedOk,
      noSource: r.noSource,
      networkSkip: r.networkSkip,
      failures: r.failures.length
    });
    if (r.failures.length) console.log('失败样例:', r.failures.slice(0, 3));
    if (!scanAll) {
      if (r.nextOffset != null) {
        console.log('\n续跑命令:');
        console.log(`  node scripts/run-warehouse-repair.mjs --offset ${r.nextOffset} --max ${batchSize}${dryRun ? ' --dry-run' : ''}`);
      }
      break;
    }
    if (r.nextOffset == null) break;
    offset = r.nextOffset;
    await sleep(1500);
  } while (scanAll);

  console.log('\n=== 合计 ===');
  console.log(totals);

  const token = String(env.USER_ACCESS_TOKEN || '').trim();
  if (useApi && token) {
    console.log('\n调用 API repair…');
    const { status, json } = await callApiRepair(token);
    console.log('API', status, JSON.stringify(json?.data || json, null, 2).slice(0, 800));
  } else if (useApi) {
    console.log('\n跳过 API repair：admin.local.env 未设置 USER_ACCESS_TOKEN');
  }

  console.log('\n提示：浏览器登录后也可执行 window.runWarehouseBulkRepair() 生成 _grid 缩略图');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
