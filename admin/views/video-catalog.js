/* 视频目录控制：查看卡藏实时目录 + 后台覆盖（计价单位/价格/档位价/上下架） */

import { $, esc, showMsg, toast, adminConfirm, setButtonBusy } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['视频目录控制', '卡藏实时目录 + 后台覆盖：计价方式/价格/上下架（覆盖优先于目录）'];

let items = [];
let overrides = {};

function tierNamesOf(item) {
  const tiers = item?.catalogPricing?.tiers || [];
  const names = tiers.map(t => String(t?.name ?? '')).filter(Boolean);
  return names.length ? names : [];
}

function unitOf(pricing) {
  return String(pricing?.unit || 'request');
}

function creditsOf(pricing) {
  return pricing?.credits != null ? Number(pricing.credits) : '';
}

function renderEditor(item, idx) {
  const ov = overrides[item.id] || {};
  const names = tierNamesOf(item);
  const tierRows = names.map(n => `
    <label class="admin-res-price"><span>${esc(n)}</span>
      <input type="number" class="admin-input-sm" data-ov-tier="${esc(n)}" min="0.1" step="0.1" value="${ov.creditsByTier?.[n] ?? ''}" placeholder="目录:${esc(String(tierCredits(item, n) ?? '—'))}">
    </label>`).join('');
  const catalogUnit = unitOf(item.catalogPricing);
  const effUnit = unitOf(item.effectivePricing);
  const editor = document.getElementById('vcEditor');
  editor.hidden = false;
  editor.innerHTML = `
    <div class="admin-card" style="margin:0">
      <div class="admin-card-head">
        <h3 style="margin:0;font-size:15px">${esc(item.label)} <code>${esc(item.id)}</code></h3>
        <button type="button" class="admin-btn admin-btn--sm" id="vcCancelBtn">收起</button>
      </div>
      <p class="admin-hint">目录当前：unit=<code>${esc(catalogUnit)}</code> credits=<code>${esc(String(creditsOf(item.catalogPricing)))}</code> · 覆盖生效值：unit=<code>${esc(effUnit)}</code></p>
      <div class="admin-row" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div class="admin-field" style="width:140px;margin:0">
          <label for="vcUnit">计价方式</label>
          <select id="vcUnit" class="admin-input-sm">
            <option value="">跟随目录(${esc(catalogUnit)})</option>
            <option value="second" ${ov.unit === 'second' ? 'selected' : ''}>按秒（价格×时长）</option>
            <option value="request" ${ov.unit === 'request' ? 'selected' : ''}>按次（固定价）</option>
          </select>
        </div>
        <div class="admin-field" style="width:140px;margin:0">
          <label for="vcCredits">${ov.unit === 'second' || effUnit === 'second' ? '每秒积分' : '每次积分'}</label>
          <input type="number" id="vcCredits" class="admin-input-sm" min="0.1" step="0.1" value="${ov.credits ?? ''}" placeholder="目录:${esc(String(creditsOf(item.catalogPricing) ?? '—'))}">
        </div>
        <label class="admin-check" style="margin:0 0 6px"><input type="checkbox" id="vcOff" ${ov.enabled === false ? 'checked' : ''}> 后台下架（隐藏）</label>
      </div>
      ${tierRows ? `<div class="admin-field" style="margin-top:10px"><label>按档位覆盖积分（留空=不覆盖该档）</label><div class="admin-row" style="flex-wrap:wrap;gap:8px">${tierRows}</div></div>` : ''}
      <div class="admin-form-actions">
        <button type="button" class="admin-btn admin-btn--primary" id="vcSaveOneBtn" data-idx="${idx}">保存该模型覆盖</button>
        <button type="button" class="admin-btn" id="vcClearOneBtn" data-idx="${idx}">清除覆盖（恢复目录）</button>
      </div>
    </div>`;
  document.getElementById('vcCancelBtn')?.addEventListener('click', () => { editor.hidden = true; });
  document.getElementById('vcSaveOneBtn')?.addEventListener('click', (e) => void saveOne(Number(e.currentTarget.getAttribute('data-idx'))));
  document.getElementById('vcClearOneBtn')?.addEventListener('click', (e) => void clearOne(Number(e.currentTarget.getAttribute('data-idx'))));
}

function tierCredits(item, name) {
  const t = (item.catalogPricing?.tiers || []).find(t => String(t?.name ?? '') === name);
  return t?.credits ?? null;
}

function collectEditor(item) {
  const o = {};
  const unit = document.getElementById('vcUnit')?.value;
  if (unit) o.unit = unit;
  const credits = document.getElementById('vcCredits')?.value;
  if (credits !== '' && Number.isFinite(Number(credits))) o.credits = Number(credits);
  const tiers = {};
  document.querySelectorAll('[data-ov-tier]').forEach(inp => {
    const n = Number(inp.value);
    if (inp.value !== '' && Number.isFinite(n) && n > 0) tiers[inp.getAttribute('data-ov-tier')] = n;
  });
  if (Object.keys(tiers).length) o.creditsByTier = tiers;
  if (document.getElementById('vcOff')?.checked) o.enabled = false;
  return o;
}

async function saveOne(idx) {
  const item = items[idx];
  if (!item) return;
  const o = collectEditor(item);
  if (!Object.keys(o).length) { toast('没有要保存的覆盖', false); return; }
  o.id = item.id;
  overrides[item.id] = o;
  await persist();
}

async function clearOne(idx) {
  const item = items[idx];
  if (!item || !overrides[item.id]) { toast('该模型无覆盖', false); return; }
  const ok = await adminConfirm({ title: '清除覆盖', message: `清除 ${item.label} 的后台覆盖，恢复目录原价？` });
  if (!ok) return;
  delete overrides[item.id];
  await persist();
}

async function persist() {
  const btn = document.getElementById('vcSaveOneBtn');
  setButtonBusy(btn, true, '保存中…');
  try {
    await adminFetch('/api/admin/video-catalog', { method: 'PUT', body: { overrides } });
    toast('视频目录覆盖已保存（30 秒内全站生效）', true);
    void load();
  } catch (e) {
    toast(friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}

function renderList() {
  const box = $('vcList');
  if (!box) return;
  if (!items.length) {
    box.innerHTML = '<p class="admin-hint">卡藏目录暂无视频模型。</p>';
    return;
  }
  box.innerHTML = items.map((item, idx) => {
    const ov = overrides[item.id];
    const eff = item.effectivePricing || {};
    const unit = unitOf(eff);
    const off = item.enabled === false || ov?.enabled === false;
    const routeInfo = item.routeCount ? `${item.routeCount} 条线路` : '无可用线路';
    const priceText = (eff.tiers || []).length
      ? (eff.tiers || []).map(t => `${esc(String(t?.name ?? ''))}=${Number(t?.credits ?? 0)}`).join(' / ')
      : String(eff.credits ?? '—');
    return `<tr class="${off ? 'is-off' : ''}">
      <td>${off ? '<span class="admin-badge admin-badge--off">已下架</span>' : '<span class="admin-badge admin-badge--ok">在售</span>'}</td>
      <td><strong>${esc(item.label)}</strong><br><code>${esc(item.id)}</code></td>
      <td>${esc(unit === 'second' ? '按秒' : '按次')}${ov ? ' <span class="admin-badge admin-badge--warn">覆盖</span>' : ''}<br><span class="admin-hint">目录:${esc(unitOf(item.catalogPricing) === 'second' ? '按秒' : '按次')}</span></td>
      <td>${priceText}</td>
      <td>${esc(routeInfo)}</td>
      <td class="admin-actions-cell"><button type="button" class="admin-btn admin-btn--sm" data-vc-edit="${idx}">调整</button></td>
    </tr>`;
  }).join('');
}

export function init() {
  $('vcList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vc-edit]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-vc-edit'));
    renderEditor(items[idx], idx);
    document.getElementById('vcEditor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

export function load() {
  const box = $('vcList');
  if (box) box.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
  void (async () => {
    try {
      const d = await adminFetch('/api/admin/video-catalog', { timeoutMs: 60000 });
      items = d.items || [];
      overrides = d.overrides || {};
      renderList();
      showMsg($('vcMsg'), d.routeSnapshotAvailable ? '' : '渠道列表拉取失败：仅展示目录数据，覆盖保存不受影响', d.routeSnapshotAvailable);
    } catch (e) {
      if (box) box.innerHTML = '';
      showMsg($('vcMsg'), friendlyFetchError(e), false);
    }
  })();
}
