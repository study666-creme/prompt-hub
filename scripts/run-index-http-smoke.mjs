/**
 * 本地 HTTP 冒烟：确认 index 引用两个 bundle 且均可下载。
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

const indexChecks = [
  ['dist/core-pipeline.bundle.js', true],
  ['dist/feed-modules.bundle.js', true],
  ['media-pipeline.js?v=', false],
  ['feed-layout.js?v=', false],
  ['feed-images.js?v=', false],
  ['image-gen-feed.js?v=', false]
];

for (const [token, shouldInclude] of indexChecks) {
  const has = index.text.includes(token);
  if (has !== shouldInclude) {
    console.error(`index-http-smoke: index.html token "${token}" expected ${shouldInclude ? 'present' : 'absent'}`);
    process.exit(1);
  }
}

const core = await get('/dist/core-pipeline.bundle.js');
if (!core.ok || !core.text.includes('window.MediaPipeline')) {
  console.error(`index-http-smoke: core bundle invalid (${core.status})`);
  process.exit(1);
}

const feed = await get('/dist/feed-modules.bundle.js');
if (!feed.ok || !feed.text.includes('FeedLayout')) {
  console.error(`index-http-smoke: feed bundle invalid (${feed.status})`);
  process.exit(1);
}

console.log('index-http-smoke OK: index + core + feed bundles reachable');
