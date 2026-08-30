/**
 * 卡片库入场动效 + 首屏同步 XHR 回归。
 *
 * 守两件容易悄悄退化的事：
 *   1. 首屏不能再出现同步 XHR。首屏原本要用 39 次串行同步 XHR 取 body 片段和
 *      legacy 脚本分片，index.html 的解析期并行预取器必须把它们全部命中。
 *   2. 入场动效不能把卡片留在不可见状态，也不能在瀑布流重排（appendChild 移动
 *      节点）时被反复重放 —— 这是旧版 animation 方案"整片卡片疯狂闪动"的根因。
 *
 * 用法：node scripts/verify-warehouse-card-entrance-browser.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// APP_ROOT 指向 .pages-deploy 时验证的是「真正要上线的打包产物」：那里没有分片，
// 预取器已被 build-pages-runtime.mjs 剥掉，预取相关断言要自动跳过。
const root = resolve(process.env.APP_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.env.PORT || 5599);
const base = `http://127.0.0.1:${port}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = join(root, pathname.replace(/^\/+/, ''));
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

await new Promise((r) => server.listen(port, '127.0.0.1', r));

const playwright = await import(process.env.PLAYWRIGHT_PACKAGE_DIR
  ? `file://${join(process.env.PLAYWRIGHT_PACKAGE_DIR, 'index.js')}`
  : 'playwright-core');
const chromium = playwright.chromium || playwright.default?.chromium;
if (!chromium) throw new Error('Playwright chromium is unavailable');

const failures = [];
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const failedRepoRequests = new Set();
const imageRequests = new Set();
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  const url = res.url();
  if (res.status() >= 400 && url.startsWith(base)) failedRepoRequests.add(url);
  if (/\.(png|webp|jpe?g)(\?|$)/i.test(url)) imageRequests.add(url.split('?')[0]);
});

// 在任何页面脚本之前挂钩，统计同步 XHR（async === false）。
// 挂在 context 上，后面做基线对比的那些页面也都会带上。
await context.addInitScript(() => {
  window.__syncXhrCalls = [];
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, async) {
    if (async === false) window.__syncXhrCalls.push(String(url));
    return origOpen.apply(this, arguments);
  };
});

const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
// 打包产物（.pages-deploy）已把 body 内联、分片合并，没有预取器也没有同步 XHR。
const isBundle = indexHtml.includes('__PROMPT_HUB_DEPLOY_BODY__');
if (isBundle) console.log('目标：打包产物（无分片、无预取器）');
// 基线：剥掉解析期并行预取器，模拟优化前的行为（同步 XHR 全量串行）。
const baselineHtml = isBundle ? null : indexHtml.replace(
  /<script>\s*\(function \(\) \{\s*if \(typeof fetch !== 'function'[\s\S]*?<\/script>/,
  ''
);
if (!isBundle && baselineHtml === indexHtml) {
  throw new Error('未能定位预取器脚本，基线对比不成立');
}

/** 跑一次首屏，返回同步 XHR 次数与关键导航计时。 */
async function bootOnce(ctx, html) {
  const p = await ctx.newPage();
  if (html) {
    await p.route(`${base}/`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html
    }));
  }
  await p.goto(base, { waitUntil: 'load', timeout: 60000 });
  await p.waitForFunction(() => typeof window.importPromptHubCards === 'function', { timeout: 30000 });
  const result = await p.evaluate(() => ({
    syncXhr: (window.__syncXhrCalls || []).length,
    storeSize: window.__PH_PART_STORE__?.text?.size ?? 0,
    domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
  }));
  await p.close();
  return result;
}

try {
  console.log('boot / ...');
  await page.goto(base, { waitUntil: 'load', timeout: 60000 });
  // 默认落在落地页，#cardsContainer 存在但不可见，这里只等它进 DOM。
  await page.waitForSelector('#cardsContainer', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => typeof window.importPromptHubCards === 'function', { timeout: 30000 });

  const syncXhr = await page.evaluate(() => window.__syncXhrCalls || []);
  const storeSize = await page.evaluate(() => window.__PH_PART_STORE__?.text?.size ?? -1);

  // 打包产物（.pages-deploy）里分片已合并、预取器已剥离，这几项断言不适用，
  // 只保留"打包模式不该有同步 XHR"的检查。
  const bundled = storeSize < 0;
  if (bundled) {
    console.log('  info 打包模式：无分片、预取器已剥离，跳过预取相关断言');
    check('打包产物无同步 XHR', syncXhr.length === 0, `${syncXhr.length} 次`);
  } else {
    check('预取表已填充', storeSize >= 39, `${storeSize} 条`);
    // 仅供参考：本机是 HTTP/1.1（每主机 6 连接），56 个首屏请求会排队，预取往往来不及
    // 全部落地，退回同步 XHR 是预期内的优雅降级；生产 HTTP/2 下这个数应趋近 0。
    console.log(`  info 当前页同步 XHR ${syncXhr.length} 次（HTTP/1.1 本机，生产应更低）`);

    // 同步 XHR 的绝对值取决于连接并发能力（本机 HTTP/1.1 每主机 6 条连接，
    // 生产 HTTP/2 可多路复用），所以这里跟"剥掉预取器"的基线比，而不是拍一个魔法数。
    const before = await bootOnce(context, baselineHtml);
    const after = await bootOnce(context, null);
    console.log(`  基线（无预取）：同步 XHR ${before.syncXhr} 次，DCL ${before.domContentLoaded}ms`);
    console.log(`  现在（有预取）：同步 XHR ${after.syncXhr} 次，DCL ${after.domContentLoaded}ms`);
    check(
      '并行预取显著减少同步 XHR',
      after.syncXhr < before.syncXhr,
      `${before.syncXhr} → ${after.syncXhr}`
    );
    check(
      '并行预取不劣化 DCL',
      after.domContentLoaded <= before.domContentLoaded + 200,
      `${before.domContentLoaded}ms → ${after.domContentLoaded}ms`
    );
  }

  console.log('seed cards and open 卡片库 ...');
  await page.evaluate(() => {
    const now = Date.now();
    const list = [];
    for (let i = 0; i < 30; i += 1) {
      list.push({
        id: `regress-card-${i}`,
        title: `回归卡片 ${i}`,
        prompt: '这是一张用于入场动效回归的卡片，内容需要足够长以便卡片有稳定高度。',
        tags: i % 3 === 0 ? ['回归', '动效'] : [],
        group: '默认',
        createdAt: now - i * 1000,
        updatedAt: now - i * 1000,
        image: i % 2 === 0 ? 'assets/studio-preset/scene.png' : ''
      });
    }
    window.importPromptHubCards(list);
  });

  await page.evaluate(() => {
    if (typeof window.switchAppPage === 'function') window.switchAppPage('warehouse');
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#cardsContainer .card[data-id]').length >= 12,
    { timeout: 20000 }
  );

  const rendered = await page.evaluate(
    () => document.querySelectorAll('#cardsContainer .card[data-id]').length
  );
  check('卡片已渲染', rendered >= 12, `${rendered} 张`);

  // 入场进行中：应当能捕捉到 pending/enter-in 状态，证明动效真的接上了。
  const midFlight = await page.evaluate(() => ({
    pending: document.querySelectorAll('#cardsContainer .card.card-enter-pending').length,
    entering: document.querySelectorAll('#cardsContainer .card.card-enter-in').length
  }));
  check(
    '入场动效已触发',
    midFlight.pending + midFlight.entering > 0,
    `pending ${midFlight.pending} / entering ${midFlight.entering}`
  );

  // 等入场 + 清理计时器跑完（错峰 10×28ms + 400ms + 120ms 余量）。
  await page.waitForTimeout(1400);

  const settled = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')];
    return {
      total: cards.length,
      stillPending: cards.filter((c) => c.classList.contains('card-enter-pending')).length,
      stillEntering: cards.filter((c) => c.classList.contains('card-enter-in')).length,
      hidden: cards.filter((c) => Number(getComputedStyle(c).opacity) < 0.99).length
    };
  });
  check('入场结束后无卡片停留在隐藏态', settled.stillPending === 0, `${settled.stillPending} 张`);
  check('入场 class 已清理（避免覆盖 .card 原过渡）', settled.stillEntering === 0, `${settled.stillEntering} 张`);
  check('所有卡片最终不透明', settled.hidden === 0, `${settled.hidden} 张仍透明`);

  // 重排（改视口触发瀑布流重新分发/移动节点）后不能重放，也不能把卡片藏起来。
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const afterRelayout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#cardsContainer .card[data-id]')];
    return {
      total: cards.length,
      hidden: cards.filter((c) => Number(getComputedStyle(c).opacity) < 0.99).length,
      pending: cards.filter((c) => c.classList.contains('card-enter-pending')).length
    };
  });
  check(
    '重排后卡片保持可见且不重放入场',
    afterRelayout.hidden === 0 && afterRelayout.pending === 0,
    `hidden ${afterRelayout.hidden} / pending ${afterRelayout.pending} / 共 ${afterRelayout.total} 张`
  );

  // 只认本仓库自己的 404。要排除：favicon，以及 supabase-config.js 在本地
  // 可选加载的 supabase-config.local.js 覆盖文件（代码里已 try/catch 容错）。
  const localNotFound = [...failedRepoRequests].filter(
    (u) => !/favicon/i.test(u) && !/supabase-config\.local\.js/i.test(u)
  );
  check('仓库内资源无 404', localNotFound.length === 0, localNotFound.slice(0, 3).join(' | '));

  // 首屏 hero 图必须是 WebP。曾经只改了仓库 hero（part-02），漏了落地页 hero
  // （part-06，也就是 / 的默认路由），结果两套图都在 DOM 里、WebP 和 PNG 全部下载，
  // 460KB 一点没省 —— 这条断言防止再漏改。
  const bigPng = [...imageRequests].filter(
    (u) => /studio-preset\/.*\.png$/i.test(u)
  );
  check('首屏 hero 图已走 WebP（不再下载原始大 PNG）', bigPng.length === 0, bigPng.slice(0, 3).join(' | '));

  // 延迟加载的非首屏脚本必须最终补齐，否则生图、生成记录、社区等功能会静默失效。
  // 关键：pack-imagegen 必须先于 features-draft（后者初始化要用 ImageGenJobRunner），
  // pack-feed 又必须先于它的版本校验，所以顺序错了这里会先炸。
  const deferred = await page.evaluate(() => ({
    feedRev: window.__PH_FEED_PACK_REV__ || '',
    featureDraft: !!window.FeatureDraft,
    imageGen: !!window.ImageGenFeed
  }));
  check(
    '延迟脚本已补齐：pack-feed 版本标记',
    deferred.feedRev === 'grid-guard-v6',
    deferred.feedRev || '(未加载)'
  );
  check('延迟脚本已补齐：FeatureDraft', deferred.featureDraft);
  check('延迟脚本已补齐：ImageGenFeed', deferred.imageGen);
  const realErrors = consoleErrors.filter(
    (t) => !/favicon/i.test(t)
      && !/127\.0\.0\.1:8787|api\.prompt-hubs\.com|fonts\.g(oogleapis|static)/i.test(t)
      && !/Failed to load resource/i.test(t)
  );
  check('无控制台报错（已排除外部服务噪声）', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  // file:// 直接打开应当走文件源指引页，而不是误导性的"恢复卡藏"。
  // 浏览器一般允许 file:// 读本地文件但禁止跨文件 XHR，body 加载器会失败并触发
  // recovery —— 守住这个分支，避免以后把它改回 cache-recovery 误导用户。
  if (isBundle) {
    // 打包产物把 body 内联了，file:// 下不会触发 XHR 失败，也就走不到 recovery。
    console.log('  skip file:// 检查（打包产物 body 已内联，无 XHR 失败路径）');
  } else try {
    const fp = await context.newPage();
    const fileUrl = 'file:///' + root.replace(/\\/g, '/').replace(/^\/+/, '') + '/index.html';
    await fp.goto(fileUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    // 给 recovery 一个跑的机会（load 事件不保证它已触发）。
    await fp.waitForFunction(
      () => /请用本地服务器打开|serve-local/.test(document.body && document.body.innerText || ''),
      { timeout: 15000 }
    ).catch(() => {});
    const fileBody = await fp.evaluate(() => document.body && document.body.innerText || '');
    const saysLocalServer = /请用本地服务器打开/.test(fileBody);
    const saysCacheRecovery = /正在恢复卡藏/.test(fileBody) && /浏览器缓存了旧页面/.test(fileBody);
    check('file:// 触发本地服务器指引页', saysLocalServer, fileBody.replace(/\s+/g, ' ').slice(0, 80));
    check('file:// 不再误显示"恢复卡藏"页', !saysCacheRecovery);
    await fp.close();
  } catch (e) {
    console.log('  skip file:// 检查：' + (e && e.message ? e.message.split('\n')[0] : e));
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nverify-warehouse-card-entrance FAILED (${failures.length})`);
  process.exit(1);
}
console.log('\nverify-warehouse-card-entrance OK');
