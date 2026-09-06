/**
 * 本地/线上 HTTP 冒烟：pack URL 必须返回 JS（含浏览器 script 请求头），不能是 SPA 回退 HTML。
 */
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5500';
const scriptHdr = {
  'Sec-Fetch-Dest': 'script',
  'Sec-Fetch-Mode': 'no-cors',
  Referer: `${base.replace(/\/$/, '')}/`
};

async function get(path, asScript = false) {
  const res = await fetch(`${base}${path}`, {
    cache: 'no-store',
    headers: asScript ? scriptHdr : undefined
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return { ok: res.ok, status: res.status, ct, text };
}

const index = await get('/');
if (!index.ok) {
  console.error(`index-http-smoke: GET / failed (${index.status})`);
  process.exit(1);
}
const buildId = (index.text.match(/__APP_BUILD__\s*=\s*'([^']+)'/) || [])[1] || 'smoke';
if (
  !index.text.includes('__PROMPT_HUB_INDEX_BODY_PARTIAL__')
  && !index.text.includes('__PROMPT_HUB_DEPLOY_BODY__')
) {
  console.error('index-http-smoke: index body is neither split nor deployment-inlined');
  process.exit(1);
}

const adminLogin = await get('/admin-login.html');
if (!adminLogin.ok || !adminLogin.text.includes('id="adminLogin"') || adminLogin.text.includes('id="adminApp"')) {
  console.error('index-http-smoke: admin-login.html must be the standalone login page');
  process.exit(1);
}

const adminConsole = await get('/admin.html');
if (!adminConsole.ok || !adminConsole.text.includes('id="adminApp"') || adminConsole.text.includes('id="adminLogin"')) {
  console.error('index-http-smoke: admin.html must be the standalone console page');
  process.exit(1);
}

const mustHave = [
  'pack-prelude.js',
  'pack-foundation.js',
  'pack-core.js',
  'pack-viewer.js',
  'pack-appreciate.js',
  'pack-lightbox.js',
  'pack-feed.js',
  'pack-imagegen.js',
  'pack-account.js',
  'pack-media-client.js',
  'pack-extra.js',
  'edit-panel-gallery.js'
];
const mustNot = [
  '.bundle.js',
  'dist/pack-',
  'media-pipeline.js?v=',
  'membership.js?v=',
  'subscription.js?v=',
  'trial-tasks.js?v=',
  'points-system.js?v=',
  'community-gacha.js?v=',
  'pwa-install.js?v=',
  'cloud-sync-safety.js?v=',
  'modal-hub.js?v=',
  'mobile.js?v=',
  'image-trim.js?v=',
  'file-origin-guard.js?v=',
  'theme.js?v='
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

const packs = [
  ['/pack-prelude.js', 'ThemeSchedule', 'ThemeSchedule'],
  ['/pack-foundation.js', 'CloudSyncSafety', 'window.CloudSyncSafety'],
  ['/pack-core.js', 'MediaPipeline', 'window.MediaPipeline'],
  ['/pack-viewer.js', 'setViewerNav', 'window.setViewerNav'],
  ['/pack-appreciate.js', 'AppAppreciate', 'window.AppAppreciate'],
  ['/pack-lightbox.js', 'AppLightbox', 'window.AppLightbox'],
  ['/pack-feed.js', 'FeedLayout', 'FeedLayout'],
  ['/pack-imagegen.js', 'PointsSystem', 'PointsSystem'],
  ['/pack-account.js', 'Membership', 'window.Membership'],
  ['/pack-media-client.js', 'PromptHubMedia', 'PromptHubMedia'],
  ['/pack-extra.js', 'CommunityGacha', 'CommunityGacha']
];

const standaloneScripts = [
  ['/edit-panel-gallery.js', 'EditPanelGallery', 'global.EditPanelGallery'],
  ['/ripple-grid.js', 'RippleGrid module', 'export function initRippleGrid'],
  ['/admin.js', 'legacy split loader', '__PROMPT_HUB_LEGACY_SPLIT_LOADER__'],
  ['/asset-studio.js', 'legacy split loader', '__PROMPT_HUB_LEGACY_SPLIT_LOADER__'],
  ['/features-assets.js', 'legacy split loader', '__PROMPT_HUB_LEGACY_SPLIT_LOADER__'],
  ['/supabase-sync.js', 'split loader or deployment bundle', /__PROMPT_HUB_(?:LEGACY_SPLIT_LOADER|DEPLOY_BUNDLE)__/],
  ['/script.js', 'split loader or deployment bundle', /__PROMPT_HUB_(?:LEGACY_SPLIT_LOADER|DEPLOY_BUNDLE)__/],
  ['/features-draft.js', 'split loader or deployment bundle', /__PROMPT_HUB_(?:LEGACY_SPLIT_LOADER|DEPLOY_BUNDLE)__/]
];

const legacyChunks = [
  ['/legacy/admin/part-01.js', 'admin chunk', 'adminFetch'],
  ['/legacy/asset-studio/part-01.js', 'asset-studio chunk', 'buildStudioPresetProject'],
  ['/legacy/features-assets/part-01.js', 'features-assets chunk', 'getDemoPackages'],
  ['/legacy/supabase-sync/part-01.js', 'supabase-sync chunk', 'STORAGE_PREFIX'],
  ['/legacy/script/part-01.js', 'script chunk', 'DB_NAME'],
  ['/legacy/features-draft/part-01.js', 'features-draft chunk', 'LS_COMMUNITY']
];

const cssAssets = [
  ['/styles.css', 'CSS split manifest or deployment bundle', /__PROMPT_HUB_(?:CSS_SPLIT_MANIFEST|DEPLOY_BUNDLE)__/],
  ['/styles-features.css', 'CSS split manifest or deployment bundle', /__PROMPT_HUB_(?:CSS_SPLIT_MANIFEST|DEPLOY_BUNDLE)__/],
  ['/styles/base/part-01.css', 'base CSS chunk', 'feature-shell'],
  ['/styles/features/part-01.css', 'features CSS chunk', 'feature-shell']
];

const htmlPartials = [
  ['/partials/index-body/part-01.html', 'index body partial start', 'app-chrome'],
  ['/partials/index-body/part-04.html', 'index body partial end', 'mobileBottomNav']
];

for (const [path, label, token] of packs) {
  const checks = [
    { path, asScript: false, tag: 'plain' },
    { path, asScript: true, tag: 'script' },
    { path: `${path}?v=${encodeURIComponent(buildId)}`, asScript: true, tag: 'query-script' }
  ];
  for (const check of checks) {
    const tag = check.tag;
    const res = await get(check.path, check.asScript);
    if (!res.ok) {
      console.error(`index-http-smoke: ${path} (${tag}) HTTP ${res.status}`);
      process.exit(1);
    }
    if (/text\/html/i.test(res.ct) || res.text.trimStart().startsWith('<!')) {
      console.error(`index-http-smoke: ${path} (${tag}) returned HTML — images will break`);
      process.exit(1);
    }
    if (!res.text.includes(token)) {
      console.error(`index-http-smoke: ${path} (${tag}) missing ${label}`);
      process.exit(1);
    }
  }
  console.log(`index-http-smoke OK: ${path} (plain + script + query)`);
}

for (const [path, label, token] of standaloneScripts) {
  for (const check of [
    { path, asScript: true, tag: 'script' },
    { path: `${path}?v=${encodeURIComponent(buildId)}`, asScript: true, tag: 'query-script' }
  ]) {
    const res = await get(check.path, check.asScript);
    if (!res.ok) {
      console.error(`index-http-smoke: ${path} (${check.tag}) HTTP ${res.status}`);
      process.exit(1);
    }
    if (/text\/html/i.test(res.ct) || res.text.trimStart().startsWith('<!')) {
      console.error(`index-http-smoke: ${path} (${check.tag}) returned HTML`);
      process.exit(1);
    }
    const hasToken = token instanceof RegExp ? token.test(res.text) : res.text.includes(token);
    if (!hasToken) {
      console.error(`index-http-smoke: ${path} (${check.tag}) missing ${label}`);
      process.exit(1);
    }
  }
  console.log(`index-http-smoke OK: ${path} (script + query)`);
}

for (const [path, label, token] of legacyChunks) {
  for (const check of [
    { path, asScript: true, tag: 'script' },
    { path: `${path}?v=${encodeURIComponent(buildId)}`, asScript: true, tag: 'query-script' }
  ]) {
    const res = await get(check.path, check.asScript);
    if (!res.ok) {
      console.error(`index-http-smoke: ${path} (${check.tag}) HTTP ${res.status}`);
      process.exit(1);
    }
    if (/text\/html/i.test(res.ct) || res.text.trimStart().startsWith('<!')) {
      console.error(`index-http-smoke: ${path} (${check.tag}) returned HTML`);
      process.exit(1);
    }
    if (!res.text.includes(token)) {
      console.error(`index-http-smoke: ${path} (${check.tag}) missing ${label}`);
      process.exit(1);
    }
  }
  console.log(`index-http-smoke OK: ${path} (script + query)`);
}

for (const [path, label, token] of cssAssets) {
  for (const checkPath of [path, `${path}?v=${encodeURIComponent(buildId)}`]) {
    const res = await get(checkPath, false);
    if (!res.ok) {
      console.error(`index-http-smoke: ${checkPath} HTTP ${res.status}`);
      process.exit(1);
    }
    if (/text\/html/i.test(res.ct) || res.text.trimStart().startsWith('<!')) {
      console.error(`index-http-smoke: ${checkPath} returned HTML`);
      process.exit(1);
    }
    const hasToken = token instanceof RegExp ? token.test(res.text) : res.text.includes(token);
    if (!hasToken) {
      console.error(`index-http-smoke: ${checkPath} missing ${label}`);
      process.exit(1);
    }
  }
  console.log(`index-http-smoke OK: ${path} (plain + query)`);
}

for (const [path, label, token] of htmlPartials) {
  for (const checkPath of [path, `${path}?v=${encodeURIComponent(buildId)}`]) {
    const res = await get(checkPath, false);
    if (!res.ok) {
      console.error(`index-http-smoke: ${checkPath} HTTP ${res.status}`);
      process.exit(1);
    }
    if (res.text.trimStart().startsWith('<!')) {
      console.error(`index-http-smoke: ${checkPath} returned the app shell instead of ${label}`);
      process.exit(1);
    }
    if (res.text.includes('<script')) {
      console.error(`index-http-smoke: ${checkPath} unexpectedly contains script tags`);
      process.exit(1);
    }
    if (!res.text.includes(token)) {
      console.error(`index-http-smoke: ${checkPath} missing ${label}`);
      process.exit(1);
    }
  }
  console.log(`index-http-smoke OK: ${path} (plain + query)`);
}

const packSrcRe = /src="([^"]+\.js(?:\?v=[^"]+)?)"/g;
let m;
while ((m = packSrcRe.exec(index.text)) !== null) {
  const src = m[1];
  if (!src.startsWith('pack-')) continue;
  if (!src.endsWith(`?v=${buildId}`)) {
    console.error(`index-http-smoke: pack script must use current build query: ${src}`);
    process.exit(1);
  }
}

console.log('index-http-smoke OK: all packs are real JavaScript');
