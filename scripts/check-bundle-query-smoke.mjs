/**
 * 带 ?v= 查询串请求 bundle（与浏览器 index.html 一致），须仍为 JS 非 HTML。
 */
const base = process.env.SMOKE_BASE || 'https://prompt-hubs.com';
const build = process.env.SMOKE_BUILD || '20260623d';

const bundles = [
  'foundation.bundle.js',
  'core-pipeline.bundle.js',
  'feed-modules.bundle.js',
  'imagegen-tools.bundle.js',
  'account-modules.bundle.js',
  'app-extra.bundle.js'
];

let failed = 0;
for (const name of bundles) {
  const path = `/${name}?v=${build}`;
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  const isHtml = /text\/html/i.test(ct) || text.trimStart().startsWith('<!');
  if (!res.ok || isHtml) {
    failed++;
    console.error(`FAIL ${path} status=${res.status} ct=${ct} html=${isHtml}`);
    continue;
  }
  console.log(`OK ${path} (${ct.split(';')[0]})`);
}

if (failed) process.exit(1);
console.log('bundle-query-smoke OK');
