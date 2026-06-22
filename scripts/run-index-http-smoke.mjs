/**
 * 本地 HTTP 冒烟：确认 index 引用 bundle 且 bundle 可下载。
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

if (!index.text.includes('dist/core-pipeline.bundle.js')) {
  console.error('index-http-smoke: index.html missing dist/core-pipeline.bundle.js script');
  process.exit(1);
}
if (index.text.includes('media-pipeline.js?v=')) {
  console.error('index-http-smoke: index still loads separate media-pipeline.js');
  process.exit(1);
}

const bundle = await get('/dist/core-pipeline.bundle.js');
if (!bundle.ok || !bundle.text.includes('window.MediaPipeline')) {
  console.error(`index-http-smoke: bundle fetch failed or invalid (${bundle.status})`);
  process.exit(1);
}

console.log('index-http-smoke OK: index + bundle reachable');
