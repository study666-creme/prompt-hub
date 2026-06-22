/**
 * 本地 HTTP 冒烟：确认 index 引用三个 bundle 且均可下载。
 */
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5500';

async function get(path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const index = await get('/');
if (!index.ok) {
  console.error(`index-http-smoke: GET / failed (${index.status}) — start serve-local.ps1 first`);
  process.exit(1);
}

const mustHave = [
  'dist/core-pipeline.bundle.js',
  'dist/feed-modules.bundle.js',
  'dist/imagegen-tools.bundle.js'
];
const mustNot = [
  'media-pipeline.js?v=',
  'feed-layout.js?v=',
  'imagegen-prompt-kit.js?v=',
  'imagegen-prompt-tools.js?v='
];

for (const token of mustHave) {
  if (!index.text.includes(token)) {
    console.error(`index-http-smoke: missing ${token}`);
    process.exit(1);
  }
}
for (const token of mustNot) {
  if (index.text.includes(token)) {
    console.error(`index-http-smoke: should not load ${token}`);
    process.exit(1);
  }
}

const bundles = [
  ['/dist/core-pipeline.bundle.js', 'MediaPipeline'],
  ['/dist/feed-modules.bundle.js', 'FeedLayout'],
  ['/dist/imagegen-tools.bundle.js', 'ImageGenPromptKit']
];

for (const [path, token] of bundles) {
  const res = await get(path);
  if (!res.ok || !res.text.includes(token)) {
    console.error(`index-http-smoke: invalid ${path} (${res.status})`);
    process.exit(1);
  }
}

console.log('index-http-smoke OK: index + 3 bundles reachable');
