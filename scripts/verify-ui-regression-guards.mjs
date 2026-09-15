import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 界面回归护栏：
 * 1. 内嵌无限画布（2026-09-06 大合并 e875103 曾整块删掉 pageCanvas，
 *    当时没有任何检查会失败，直到用户在界面上发现）。
 * 2. 生图页日光模式对比度（分段控件变量曾写死白色文字）。
 * 3. 社区瀑布流按真实高度再平衡（图片落地后列高失衡 → 整列留白）。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const partials = readdirSync(join(root, 'partials', 'index-body'))
  .filter((name) => /^part-\d+\.html$/.test(name))
  .sort()
  .map((name) => read(`partials/index-body/${name}`))
  .join('');

const router = read('app-router.js');
const feedLayout = read('feed-layout.js');
const scriptPart03 = read('legacy/script/part-03.js');
const scriptPart04 = read('legacy/script/part-04.js');
const scriptPart09 = read('legacy/script/part-09.js');
const featuresDraftPart04 = read('legacy/features-draft/part-04.js');
const featuresDraftPart05 = read('legacy/features-draft/part-05.js');
const featuresCss = readdirSync(join(root, 'styles', 'features'))
  .filter((name) => /^part-\d+\.css$/.test(name))
  .sort()
  .map((name) => read(`styles/features/${name}`))
  .join('');

const failures = [];
const require_ = (haystack, token, label) => {
  if (!haystack.includes(token)) failures.push(`${label}: missing ${token}`);
};

require_(partials, 'id="pageCanvas"', 'partials');
require_(partials, 'id="canvasPageFrame"', 'partials');
require_(partials, 'id="canvasOpenExternalBtn"', 'partials');
require_(partials, 'data-app="canvas"', 'partials');

if (/app-nav-item app-nav-external[^>]*openPromptCanvas\(\)/.test(partials)) {
  failures.push('partials: 画布导航仍是纯外链按钮，站内内嵌页入口丢失');
}

require_(router, "canvas: ['/canvas']", 'app-router.js');
require_(router, "canvas: '/canvas/'", 'app-router.js');
require_(scriptPart03, "canvas: 'pageCanvas'", 'legacy/script/part-03.js');
require_(scriptPart04, 'function initCanvasPage()', 'legacy/script/part-04.js');
require_(scriptPart04, "frame.setAttribute('src'", 'legacy/script/part-04.js');
require_(scriptPart09, 'initCanvasPage();', 'legacy/script/part-09.js');

require_(featuresCss, '.app-page-canvas.active', 'styles/features');
require_(featuresCss, '.canvas-page-frame-wrap iframe', 'styles/features');

// 主题 token 白字回归：生图右侧分段控件与提示行在日光模式下必须是深色文字
require_(featuresCss, '[data-theme="light"] #pageImageGen .imagegen-side', 'styles/features');
require_(featuresCss, '--imagegen-segment-text-active: #1c1c1e;', 'styles/features');
const lightHint = featuresCss.match(/\[data-theme="light"\] #pageImageGen \.imagegen-feed-hint \{([^}]*)\}/);
if (!lightHint || !/color: rgba\(60, 60, 67/.test(lightHint[1])) {
  failures.push('styles/features: 生图提示行缺日光模式深色覆盖，浅色面板上不可见');
}

// 瀑布流再平衡：图片真实高度落地后必须还有一次「测量驱动」的重排
require_(feedLayout, 'function scheduleMeasuredRebalance(containerId)', 'feed-layout.js');
require_(feedLayout, 'function needsMeasuredRebalance(container)', 'feed-layout.js');
require_(feedLayout, 'measuredRebalanceBudget[containerId] = MEASURED_REBALANCE_BUDGET;', 'feed-layout.js');
require_(feedLayout, 'scheduleMeasuredRebalance(containerId)', 'feed-layout.js');
require_(featuresDraftPart04, 'function isFeedUserScrolling()', 'legacy/features-draft/part-04.js');
require_(featuresDraftPart05, 'feedUserScrollingActive: isFeedUserScrolling', 'legacy/features-draft/part-05.js');
require_(featuresDraftPart05, 'captureFeedScrollAnchor,', 'legacy/features-draft/part-05.js');
require_(featuresDraftPart05, 'restoreFeedScrollAnchor,', 'legacy/features-draft/part-05.js');

// 背景动画降频而非整帧停住（我的主页曾留一张静止网格，看起来像卡死）
require_(scriptPart04, 'setFrameRate?.(rippleFrameRateFor(activeApp))', 'legacy/script/part-04.js');
require_(read('ripple-grid.js'), 'setFrameRate(fps)', 'ripple-grid.js');

if (failures.length) {
  console.error('verify-ui-regression-guards FAIL:\n -', failures.join('\n - '));
  process.exit(1);
}
console.log('verify-ui-regression-guards OK (canvas embed, light-theme tokens, feed rebalance, ripple throttle)');
