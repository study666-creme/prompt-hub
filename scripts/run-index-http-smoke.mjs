/**
 * 本地/线上 HTTP 冒烟：bundle URL 必须返回 JS，不能是 SPA 回退的 HTML。
 */
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5500';

async function get(path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return { ok: res.ok, status: res.status, ct, text };
}

const index = await get('/');
if (!index.ok) {
  console.error(`index-http-smoke: GET / failed (${index.status})`);
  process.exit(1);
}

const mustHave = [
  'core-pipeline.bundle.js',
  'feed-modules.bundle.js',
  'imagegen-tools.bundle.js',
  'account-modules.bundle.js',
  'app-extra.bundle.js'
];
const mustNot = [
  'dist/core-pipeline.bundle.js',
  'dist/feed-modules.bundle.js',
  'media-pipeline.js?v=',
  'membership.js?v=',
  'subscription.js?v=',
  'trial-tasks.js?v=',
  'points-system.js?v=',
  'community-gacha.js?v=',
  'pwa-install.js?v='
];

for (const token of mustHave) {
  if (!index.text.includes(token)) {
    console.error(`index-http-smoke: index missing ${token}`);
    process.exit(1);
  }
}
for (const token of mustNot) {
  if (index.text.includes(token)) {
    console.error(`index-http-smoke: index should not reference ${token}`);
    process.exit(1);
  }
}

const bundles = [
  ['/core-pipeline.bundle.js', 'MediaPipeline', 'window.MediaPipeline'],
  ['/feed-modules.bundle.js', 'FeedLayout', 'FeedLayout'],
  ['/imagegen-tools.bundle.js', 'PointsSystem', 'PointsSystem'],
  ['/account-modules.bundle.js', 'Membership', 'window.Membership'],
  ['/app-extra.bundle.js', 'CommunityGacha', 'CommunityGacha']
];

for (const [path, label, token] of bundles) {
  const res = await get(path);
  if (!res.ok) {
    console.error(`index-http-smoke: ${path} HTTP ${res.status}`);
    process.exit(1);
  }
  if (/text\/html/i.test(res.ct) || res.text.trimStart().startsWith('<!')) {
    console.error(`index-http-smoke: ${path} returned HTML (SPA fallback) — images will break`);
    process.exit(1);
  }
  if (!res.text.includes(token)) {
    console.error(`index-http-smoke: ${path} missing ${label}`);
    process.exit(1);
  }
  console.log(`index-http-smoke OK: ${path} (${res.ct.split(';')[0]})`);
}

console.log('index-http-smoke OK: all bundles are real JavaScript');
