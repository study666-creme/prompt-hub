/* 画布模型管理：上架 / 稳定·特惠分区 / 显示名 / 定价
 *
 * 内嵌页面走同源反代 /canvas-admin/*（见根目录 _worker.js）。
 * 上游 canvas-api 的 /admin/model-overrides 带 `x-frame-options: DENY`，
 * 直连 iframe 会被浏览器拒绝渲染（表现就是一片空白），反代剥掉了该响应头，
 * 并把页面内写死的 /api/v1/admin/* 改写回 /canvas-admin/api/v1/admin/*。
 *
 * 反代之后 iframe 与主后台同源，画布管理密钥（sessionStorage）可以复用，
 * 于是这里能接管内嵌页的密钥框与「加载」按钮：密钥填一次，之后进页面自动出数据。
 */

import { $ } from '../modules/ui.js';

export const title = ['画布模型', '画布侧模型上架、稳定/特惠分区、显示名与定价（改完即生效）'];

const FRAME_SRC = '/canvas-admin/admin/model-overrides';
// 与内嵌页面（canvas-api/admin/model-overrides）使用同一个 sessionStorage 键
const SECRET_KEY = 'canvas_model_overrides_secret_v1';
const FRAME_TIMEOUT_MS = 10000;

let frameBound = false;
let secretBound = false;
let timeoutTimer = 0;

function setStatus(text, state) {
  const el = $('canvasModelsStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', state === 'error');
  el.classList.toggle('is-ok', state === 'ok');
}

function readSecret() {
  try {
    return sessionStorage.getItem(SECRET_KEY) || '';
  } catch {
    return '';
  }
}

function writeSecret(value) {
  try {
    if (value) sessionStorage.setItem(SECRET_KEY, value);
    else sessionStorage.removeItem(SECRET_KEY);
  } catch {
    /* 隐私模式下写不进去：本次会话仍可用，只是下次要重新填 */
  }
}

function frameEl() {
  return $('canvasModelsFrame');
}

/** 同源前提下取内嵌页文档；页面还没渲染出内容时返回 null。 */
function frameDoc() {
  const frame = frameEl();
  if (!frame || !frame.src) return null;
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body || !doc.body.childElementCount) return null;
    return doc;
  } catch {
    return null;
  }
}

function hideFallback() {
  const el = $('canvasModelsFallback');
  if (el) el.hidden = true;
}

function showFallback(message) {
  const el = $('canvasModelsFallback');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = message;
}

function clearTimeoutTimer() {
  if (timeoutTimer) {
    window.clearTimeout(timeoutTimer);
    timeoutTimer = 0;
  }
}

/** 把内嵌页自己的 #msg 文案同步到外层状态栏。 */
function syncStatusFromFrame() {
  const doc = frameDoc();
  const msg = doc && doc.getElementById('msg');
  if (!msg) return;
  const text = String(msg.textContent || '').trim();
  if (!text) return;
  setStatus(text, msg.classList.contains('err') ? 'error' : 'ok');
}

/** 内嵌页载入后：回填密钥并自动点一次「加载」。 */
function autoLoad() {
  clearTimeoutTimer();
  const doc = frameDoc();
  if (!doc) {
    scheduleTimeoutCheck();
    return;
  }
  const secretInput = doc.getElementById('secret');
  const loadBtn = doc.getElementById('load');
  if (!secretInput || !loadBtn) {
    // 上游页面结构变了：不再尝试接管，交给用户手动操作，避免误判成"空白"。
    hideFallback();
    setStatus('内嵌页已载入，请在其中直接操作');
    return;
  }
  hideFallback();

  const value = readSecret();
  const input = $('canvasModelsSecret');
  if (input && !input.value) input.value = value;
  if (!value) {
    setStatus('填好密钥后点「连接并载入」');
    return;
  }
  secretInput.value = value;
  setStatus('载入中…');
  loadBtn.click();
  window.setTimeout(syncStatusFromFrame, 1200);
  window.setTimeout(syncStatusFromFrame, 3200);
}

function scheduleTimeoutCheck() {
  clearTimeoutTimer();
  timeoutTimer = window.setTimeout(() => {
    if (frameDoc()) return;
    setStatus('内嵌页面未能载入', 'error');
    showFallback(
      '内嵌页面加载超时或失败。'
      + '<button type="button" class="admin-btn admin-btn--sm" id="canvasModelsRetryBtn">重试</button>'
      + ' 或点右上角「新窗口打开」直接访问画布模型后台。'
    );
    $('canvasModelsRetryBtn')?.addEventListener('click', reloadFrame);
  }, FRAME_TIMEOUT_MS);
}

function reloadFrame() {
  const frame = frameEl();
  if (!frame) return;
  hideFallback();
  setStatus('载入中…');
  try {
    if (frame.src) {
      frame.contentWindow.location.reload();
      return;
    }
  } catch {
    /* 拿不到 contentWindow 时退回重设 src */
  }
  frame.src = FRAME_SRC;
}

function connect() {
  const input = $('canvasModelsSecret');
  const value = input ? input.value.trim() : '';
  if (!value) {
    setStatus('请先填写画布管理密钥', 'error');
    if (input) input.focus();
    return;
  }
  writeSecret(value);
  reloadFrame();
}

function bindFrame() {
  if (frameBound) return;
  frameBound = true;
  const frame = frameEl();
  if (!frame) return;
  frame.addEventListener('load', () => autoLoad());
}

function bindSecretInput() {
  if (secretBound) return;
  secretBound = true;
  const input = $('canvasModelsSecret');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        connect();
      }
    });
    input.addEventListener('change', () => writeSecret(input.value.trim()));
  }
  $('canvasModelsConnectBtn')?.addEventListener('click', connect);
  $('canvasModelsReloadBtn')?.addEventListener('click', reloadFrame);
}

export function init() {
  bindFrame();
  bindSecretInput();
}

export function load() {
  bindFrame();
  bindSecretInput();
  const input = $('canvasModelsSecret');
  const value = readSecret();
  if (input && !input.value) input.value = value;
  const frame = frameEl();
  if (frame && !frame.src) {
    setStatus(value ? '载入中…' : '填好密钥后点「连接并载入」');
    frame.src = FRAME_SRC;
  } else {
    syncStatusFromFrame();
  }
}
