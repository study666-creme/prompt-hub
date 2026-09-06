/**
 * 部署前：immutable 长缓存契约。
 *
 * _headers 与 functions/_middleware.js 对版本化静态资源下发
 * `Cache-Control: public, max-age=31536000, immutable`。这套缓存成立的前提是
 * 「内容一变，?v= 必变」。如果有人改了文件却忘记跑 scripts/bump-build.ps1，
 * 浏览器会把旧内容按 immutable 锁最多一年，等于线上事故。
 *
 * 本脚本守住两条底线：
 *   1. 所有 immutable 资源在入口 HTML 里必须带 ?v=，且等于当前 __APP_BUILD__
 *      （抓住“部分引用忘了 bump”）。
 *   2. 与本地基线（scripts/.versioned-cache-baseline.json，gitignore）比对内容
 *      哈希：内容相对上次通过时变了，而引用版本没变 → 拦下，提示先 bump-build。
 *      基线只在全部通过后重写；run-predeploy-smoke 在每次 deploy 前都会重跑，
 *      因此基线始终对应“上一次校验通过（即将部署）”的状态。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', '.versioned-cache-baseline.json');

const ENTRY_HTML_FILES = [
  'index.html',
  'admin.html',
  'admin-login.html',
  'asset-studio.html'
];

// pack-*.js 的 immutable 由 functions/_middleware.js 下发（?v= 存在时），
// 不经过 _headers，这里单独列上，同样纳入基线校验。
const MIDDLEWARE_IMMUTABLE_RE = /^pack-[a-z0-9-]+\.js$/;

function fail(msg) {
  console.error(`verify-versioned-cache: ${msg}`);
  process.exit(1);
}

function sha256OfFile(rel) {
  return createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
}

/**
 * script.js / styles.css 这类文件在仓库里是「分片清单」，生产部署时由
 * scripts/build-pages-runtime.mjs 把分片内联合并成单文件。只哈希清单本身
 * 漏掉分片内容变化，所以对清单文件把引用的分片一并纳入哈希。
 */
function sha256OfShippedFile(rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  const h = createHash('sha256');
  h.update(text);
  if (/__PROMPT_HUB_LEGACY_SPLIT_LOADER__/.test(text)) {
    for (const m of text.matchAll(/"(legacy\/[^"]+)"/g)) {
      if (existsSync(join(root, m[1]))) {
        h.update(readFileSync(join(root, m[1])));
      }
    }
  }
  if (/__PROMPT_HUB_CSS_SPLIT_MANIFEST__/.test(text)) {
    for (const m of text.matchAll(/@import url\("(styles\/[^"?]+)\?/g)) {
      if (existsSync(join(root, m[1]))) {
        h.update(readFileSync(join(root, m[1])));
      }
    }
  }
  return h.digest('hex');
}

function readEntryHtml(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

// ---------- 1. immutable 路径清单（以 _headers 为唯一事实来源） ----------
const headersText = readFileSync(join(root, '_headers'), 'utf8');
const immutablePaths = new Set();

// 结构化解析：规则路径行顶格，其下缩进的是键值对；块内出现 immutable 即记入。
const immutableFromHeaders = [];
{
  const lines = headersText.split('\n');
  let currentPath = null;
  for (const rawLine of lines) {
    const stripped = rawLine.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const isRule = rawLine === rawLine.trimStart() && stripped.startsWith('/');
    if (isRule) {
      currentPath = stripped.replace(/^\//, '');
      continue;
    }
    if (currentPath && /^Cache-Control:/i.test(stripped)) {
      if (/immutable/i.test(stripped)) {
        immutableFromHeaders.push(currentPath);
      }
      currentPath = null;
    }
  }
}
for (const p of immutableFromHeaders) immutablePaths.add(p);

// vendor/supabase.min.js 这类精确路径直接用；目录通配暂不支持（当前规则都是精确文件）。
for (const p of immutablePaths) {
  if (p.includes('*')) {
    fail(`_headers 的 immutable 规则请写精确文件名（当前通配规则不支持审计）: /${p}`);
  }
}

// ---------- 2. 入口 HTML 的版本化引用 ----------
const indexHtml = readEntryHtml('index.html');
const buildMatch = indexHtml.match(/__APP_BUILD__\s*=\s*'([^']+)'/);
if (!buildMatch) fail('index.html 中找不到 __APP_BUILD__');
const currentBuild = buildMatch[1];

/** @type {Map<string, string>} rel path -> referenced ?v= */
const staticRefs = new Map();
/** @type {Set<string>} 运行时用 __APP_BUILD__ 拼 URL 的文件（延迟队列 / scriptSrcWithBuild） */
const runtimeVersioned = new Set();

for (const rel of ENTRY_HTML_FILES) {
  const html = readEntryHtml(rel);
  const refRe = /(?:src|href)=["']([^"'?#]+\.(?:js|css))\?v=([^"']+)["']/g;
  let m;
  while ((m = refRe.exec(html)) !== null) {
    const path = m[1].replace(/^\//, '');
    if (staticRefs.has(path) && staticRefs.get(path) !== m[2]) {
      fail(`${rel} 中 ${path} 被引用了两个不同版本（${staticRefs.get(path)} / ${m[2]}）`);
    }
    staticRefs.set(path, m[2]);
  }
  const bareRefRe = /(?:src|href)=["']([^"'?#=]+\.(?:js|css))["']/g;
  while ((m = bareRefRe.exec(html)) !== null) {
    const path = m[1].replace(/^\//, '');
    if (immutablePaths.has(path) || MIDDLEWARE_IMMUTABLE_RE.test(path)) {
      fail(`${rel} 引用了 immutable 资源 ${path} 但没有带 ?v=（会被长缓存锁死）`);
    }
  }
}

// 延迟加载队列：index.html 内联 loader 用当前 __APP_BUILD__ 拼 ?v=。
{
  const block = indexHtml.match(
    /\/\* __PH_DEFERRED_PACKS_START__ \*\/([\s\S]*?)\/\* __PH_DEFERRED_PACKS_END__ \*\//
  );
  if (block) {
    for (const q of block[1].matchAll(/'([^']+\.js)'/g)) {
      runtimeVersioned.add(q[1].replace(/^\//, ''));
    }
  }
}
// legacy 源里的 scriptSrcWithBuild('X') 也是运行时版本化（分片会被打进 pack，
// 但清单文件本身会作为入口部署）。
function collectRuntimeVersionedFromLegacy() {
  const dirs = [join(root, 'legacy'), join(root, 'styles')];
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(?:js|css)$/.test(e.name)) files.push(full);
    }
  };
  dirs.forEach(walk);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/scriptSrcWithBuild\(\s*['"]([^'"]+)['"]/g)) {
      runtimeVersioned.add(m[1].replace(/^\//, ''));
    }
  }
}
collectRuntimeVersionedFromLegacy();

// ---------- 3. 逐文件校验 ----------
const targets = new Set(immutablePaths);
// pack-*.js 由 middleware 下发 immutable，把静态引用到的 pack 也纳入。
for (const path of staticRefs.keys()) {
  if (MIDDLEWARE_IMMUTABLE_RE.test(path)) targets.add(path);
}

let baseline = {};
if (existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    fail(`基线文件损坏，请删除 ${baselinePath} 后重跑（会重新建立基线）`);
  }
}

const newBaseline = {};
let checked = 0;
let warned = 0;
for (const path of [...targets].sort()) {
  if (!existsSync(join(root, path))) {
    if (immutablePaths.has(path)) {
      fail(`immutable 资源 ${path} 在 _headers 里声明但磁盘上不存在`);
    }
    continue;
  }
  const hash = sha256OfShippedFile(path);
  const refV = staticRefs.get(path);
  const isRuntime = runtimeVersioned.has(path);
  if (!refV && !isRuntime) {
    console.warn(`verify-versioned-cache: 警告 immutable 资源 ${path} 未被任何入口引用（规则疑似失效，确认后删除）`);
    warned++;
  }
  if (refV && refV !== currentBuild) {
    fail(`${path} 引用版本 ${refV} ≠ 当前构建 ${currentBuild}（跑 scripts/bump-build.ps1 修正）`);
  }
  const prev = baseline[path];
  if (prev && prev.hash !== hash && prev.v === (refV ?? currentBuild)) {
    fail(
      `${path} 内容已变化但引用版本仍是 ${prev.v}；immutable 缓存会把旧内容锁一年。` +
        ' 先跑 scripts/bump-build.ps1 再部署。'
    );
  }
  newBaseline[path] = { hash, v: refV || currentBuild };
  checked++;
}

writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + '\n');
console.log(
  `verify-versioned-cache OK: ${checked} 个版本化资源${warned ? `，${warned} 条警告` : ''}`
);
