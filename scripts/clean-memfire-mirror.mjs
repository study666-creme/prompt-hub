#!/usr/bin/env node
/**
 * 清理 MemFire Storage 的 card-images 镜像桶（r2-only 切换后的历史双写副本）。
 *
 * 用法：
 *   node scripts/clean-memfire-mirror.mjs                 # dry-run：只扫描并导出清单，不删除
 *   node scripts/clean-memfire-mirror.mjs --delete --yes  # 按清单批量删除（不可逆）
 *
 * 配置：scripts/admin.local.env（SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）
 * 清单：backups/memfire-mirror-manifest-<时间戳>.csv（path,size,created_at）
 */
import fs from 'fs';
import path from 'path';
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
const BUCKET = 'card-images';
const LIST_PAGE = 1000;
const DELETE_BATCH = 100;
const MAX_FILES = 200_000;

const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const confirmed = args.includes('--yes');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（scripts/admin.local.env）');
  process.exit(1);
}
if (doDelete && !confirmed) {
  console.error('删除必须同时带 --delete --yes，避免误触发');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  'Content-Type': 'application/json'
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 递归列出桶内全部对象（与 admin-storage.ts 的 walk 同构） */
async function listAll() {
  const files = [];
  async function walk(prefix) {
    let offset = 0;
    while (true) {
      const data = await api('POST', `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        prefix,
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (!Array.isArray(data) || !data.length) break;
      for (const item of data) {
        const childPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          files.push({
            path: childPath,
            size: Number(item.metadata?.size) || 0,
            createdAt: item.created_at || ''
          });
          if (files.length >= MAX_FILES) {
            throw new Error(`对象数超过安全上限 ${MAX_FILES}，请先人工确认桶内容`);
          }
        } else {
          await walk(childPath);
        }
      }
      if (data.length < LIST_PAGE) break;
      offset += LIST_PAGE;
    }
  }
  await walk('');
  return files;
}

function fmtBytes(n) {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(2)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(2)} KB`;
  return `${n} B`;
}

const started = new Date().toISOString().replace(/[:.]/g, '-');
const files = await listAll();
const totalBytes = files.reduce((s, f) => s + f.size, 0);
const byUser = new Map();
for (const f of files) {
  const u = f.path.split('/')[0] || '(root)';
  const row = byUser.get(u) || { bytes: 0, count: 0 };
  row.bytes += f.size;
  row.count += 1;
  byUser.set(u, row);
}

console.log(`桶 ${BUCKET}：${files.length} 个对象，合计 ${fmtBytes(totalBytes)}（${totalBytes} bytes）`);
console.log(`按用户前缀 Top 10：`);
for (const [u, r] of [...byUser.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)) {
  console.log(`  ${u}  ${r.count} 个  ${fmtBytes(r.bytes)}`);
}

const manifestDir = path.join(root, 'backups');
fs.mkdirSync(manifestDir, { recursive: true });
const manifestPath = path.join(manifestDir, `memfire-mirror-manifest-${started}.csv`);
fs.writeFileSync(manifestPath, ['path,size,created_at', ...files.map(f => `"${f.path}",${f.size},${f.createdAt}`)].join('\n'));
console.log(`清单已写入：${manifestPath}`);

if (!doDelete) {
  console.log('dry-run 完成。确认 R2 已有全部对象后，运行：node scripts/clean-memfire-mirror.mjs --delete --yes');
  process.exit(0);
}

console.log(`开始删除 ${files.length} 个对象（每批 ${DELETE_BATCH}）…`);
let deleted = 0;
for (let i = 0; i < files.length; i += DELETE_BATCH) {
  const batch = files.slice(i, i + DELETE_BATCH).map(f => f.path);
  await api('DELETE', `${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { prefixes: batch });
  deleted += batch.length;
  if (deleted % 2000 === 0 || deleted === files.length) {
    console.log(`  已删除 ${deleted}/${files.length}`);
  }
}

const remaining = await listAll();
console.log(`删除完成：${deleted} 个。复查剩余对象：${remaining.length} 个，${fmtBytes(remaining.reduce((s, f) => s + f.size, 0))}`);
if (remaining.length) {
  console.error('仍有剩余对象，请检查上方错误日志后重跑');
  process.exit(2);
}
console.log('MemFire card-images 桶已清空。');
