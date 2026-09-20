/* 生图模型：定价 / 上架状态 / 排序 / MJ 分档（调用链路列已下线）
 *
 * 卡藏同步模型（pricingSource=upstream_realtime）的价格与名称默认跟随卡藏 API，
 * 但运营可以显式覆盖：填了值就以后台为准，清空输入即恢复同步值。行内会同时
 * 显示「目录值」作对照，被覆盖的行带标记和「恢复目录」按钮。
 */

import { $, adminConfirm, esc, showMsg, toast, setButtonBusy } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';

export const title = ['生图模型', '定价、排序与上下架配置（改名/改价对同步模型同样生效）'];

let rows = [];
let familyFilter = 'all';
let statusFilter = 'all';

const FAMILY_LABEL = { gim2: '全能模型2', banana: '香蕉', midjourney: 'MJ' };

function isRealtimeRow(row) {
  return row.pricingSource === 'upstream_realtime';
}

/** 该行是否被运营显式改过价/名（卡藏行才有这个区分）。 */
function isOverriddenRow(row) {
  if (!isRealtimeRow(row)) return true;
  const name = String(row.displayName || '').trim();
  const renamed = !!name && name !== String(row.catalogLabel || row.label || '').trim();
  return !!row.operatorOverride || renamed;
}

function isMjPricingRow(row) {
  return row.pricingBySpeed === true || String(row.id || '').startsWith('apimart-mj-');
}

function ensureMjCreditsBySpeed(row) {
  if (!isMjPricingRow(row)) return row;
  row.pricingBySpeed = true;
  if (!row.creditsBySpeed || typeof row.creditsBySpeed !== 'object') row.creditsBySpeed = {};
  const flat = Number(row.creditsPerCall);
  for (const speed of ['relax', 'fast', 'turbo']) {
    if (row.creditsBySpeed[speed] == null || row.creditsBySpeed[speed] === '') {
      if (Number.isFinite(flat) && flat > 0) row.creditsBySpeed[speed] = flat;
    }
  }
  return row;
}

function normalizeModelRow(row, index) {
  const status =
    row.status === 'maintenance' || row.status === 'offline' || row.status === 'active'
      ? row.status
      : row.enabled === false ? 'offline' : 'active';
  return {
    ...row,
    catalogLabel: row.catalogLabel || row.label || '',
    catalogCreditsPerCall: row.catalogCreditsPerCall ?? row.creditsPerCall,
    catalogCreditsByResolution: row.catalogCreditsByResolution || null,
    operatorOverride: row.operatorOverride !== false,
    displayName: row.displayName || row.displayLabel || row.label || '',
    status,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10,
    creditsPerCall: row.creditsPerCall,
    creditsByResolution: row.creditsByResolution || null,
    creditsBySpeed: row.creditsBySpeed || null,
    promoPrice: row.promoPrice != null && row.promoPrice !== '' ? Number(row.promoPrice) : null,
    promoByResolution: row.promoByResolution || null,
    promoBySpeed: row.promoBySpeed || null,
    pricingByResolution: row.pricingByResolution === true,
    pricingBySpeed: isMjPricingRow(row),
    uiFamily: row.uiFamily || 'gim2',
    fixedPrice: row.fixedPrice === true,
    refundOnViolation: row.refundOnViolation !== false
  };
}

function sortRows() {
  rows.sort((a, b) => a.sortOrder - b.sortOrder || String(a.label).localeCompare(String(b.label), 'zh-CN'));
}

function filteredRows() {
  return rows.filter((row) => {
    if (familyFilter !== 'all' && row.uiFamily !== familyFilter) return false;
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    return true;
  });
}

function formatCredits(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 卡藏目录当前同步值：改价输入框的 placeholder 与「恢复目录」都读它。 */
function catalogCreditsFor(row, resolution) {
  if (row.pricingBySpeed) return row.catalogCreditsPerCall;
  if (row.pricingByResolution) {
    const map = row.catalogCreditsByResolution || {};
    const key = resolution || (row.resolutions || ['1k'])[0] || '1k';
    return map[key];
  }
  return row.catalogCreditsPerCall;
}

function effectiveModelPromo(row, resolution, speed) {
  if (row.fixedPrice) return null;
  if (isMjPricingRow(row)) {
    const s = speed || 'relax';
    const v = row.promoBySpeed?.[s];
    return v != null && v !== '' ? Number(v) : null;
  }
  if (row.pricingByResolution) {
    const res = resolution || (row.resolutions || ['1k'])[0] || '1k';
    const v = row.promoByResolution?.[res];
    return v != null && v !== '' ? Number(v) : null;
  }
  const v = row.promoPrice;
  return v != null && v !== '' ? Number(v) : null;
}

/** 用户实付价：有活动价用活动价，否则用当前售价（运营价 ?? 目录同步价）。 */
function effectivePriceOf(row, resolution, speed) {
  const promo = effectiveModelPromo(row, resolution, speed);
  if (promo != null) return promo;
  if (isMjPricingRow(row)) return Number(row.creditsBySpeed?.[speed || 'relax']) || null;
  if (row.pricingByResolution) {
    const res = resolution || (row.resolutions || ['1k'])[0] || '1k';
    return Number(row.creditsByResolution?.[res]) || null;
  }
  const base = Number(row.creditsPerCall);
  return Number.isFinite(base) && base > 0 ? base : null;
}

function renderCreditsInputs(row) {
  ensureMjCreditsBySpeed(row);
  if (isMjPricingRow(row)) {
    if (!row.creditsBySpeed) row.creditsBySpeed = {};
    return ['relax', 'fast', 'turbo']
      .map((s) => `<label class="admin-res-price"><span>${s === 'relax' ? 'Relax' : s === 'fast' ? 'Fast' : 'Turbo'}</span><input type="number" class="admin-input-sm" data-field="credits-speed-${s}" min="0.1" max="99999" step="0.1" value="${row.creditsBySpeed[s] ?? ''}"></label>`)
      .join('');
  }
  if (row.pricingByResolution) {
    const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) => ['1k', '2k', '4k'].includes(r));
    if (!row.creditsByResolution) row.creditsByResolution = {};
    return resList
      .map((res) => `<label class="admin-res-price"><span>${res.toUpperCase()}</span><input type="number" class="admin-input-sm" data-field="credits-${res}" min="0.1" max="99999" step="0.1" value="${row.creditsByResolution[res] ?? ''}" placeholder="目录:${esc(String(catalogCreditsFor(row, res) ?? '—'))}"></label>`)
      .join('');
  }
  return `<input type="number" class="admin-input-sm" data-field="credits" min="0.1" max="99999" step="0.1" value="${row.creditsPerCall ?? ''}" placeholder="目录:${esc(String(catalogCreditsFor(row) ?? '—'))}">`;
}

function renderPromoInputs(row) {
  ensureMjCreditsBySpeed(row);
  if (isMjPricingRow(row)) {
    if (!row.promoBySpeed) row.promoBySpeed = {};
    return ['relax', 'fast', 'turbo']
      .map((s) => `<label class="admin-res-price"><span>${s === 'relax' ? 'Relax' : s === 'fast' ? 'Fast' : 'Turbo'}</span><input type="number" class="admin-input-sm" data-field="promo-speed-${s}" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoBySpeed[s] ?? ''}"></label>`)
      .join('');
  }
  if (row.pricingByResolution) {
    const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) => ['1k', '2k', '4k'].includes(r));
    if (!row.promoByResolution) row.promoByResolution = {};
    return resList
      .map((res) => `<label class="admin-res-price"><span>${res.toUpperCase()}</span><input type="number" class="admin-input-sm" data-field="promo-${res}" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoByResolution[res] ?? ''}"></label>`)
      .join('');
  }
  return `<input type="number" class="admin-input-sm" data-field="promo" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoPrice ?? ''}">`;
}

function renderEffectiveCell(row) {
  ensureMjCreditsBySpeed(row);
  // 有效价 = 运营价 ?? 目录同步价；被覆盖时标出来，避免「改了没生效」的误判。
  const overridden = isOverriddenRow(row);
  const badge = overridden && isRealtimeRow(row)
    ? ' <span class="admin-badge admin-badge--warn" title="价格/名称已按后台值生效，清空即恢复卡藏目录值">覆盖</span>'
    : '';
  if (isMjPricingRow(row)) {
    return ['relax', 'fast', 'turbo']
      .map((s) => {
        const price = effectivePriceOf(row, '1k', s);
        return price != null ? `${s} ${formatCredits(price)}` : `${s} —`;
      })
      .join('<br>') + badge;
  }
  if (row.pricingByResolution) {
    const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) => ['1k', '2k', '4k'].includes(r));
    return resList
      .map((res) => {
        const price = effectivePriceOf(row, res);
        return price != null ? `${res.toUpperCase()} ${formatCredits(price)}` : `${res.toUpperCase()} —`;
      })
      .join('<br>') + badge;
  }
  const price = effectivePriceOf(row);
  return (price != null ? formatCredits(price) : '—') + badge;
}

function syncRowsFromDom() {
  const tbody = $('modelsTableBody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
    const row = rows.find((r) => r.id === tr.dataset.modelId);
    if (!row) return;
    tr.querySelectorAll('input, select').forEach((inp) => {
      const field = inp.dataset.field;
      if (!field) return;
      if (field === 'displayName') row.displayName = inp.value;
      if (field === 'status') row.status = inp.value;
      if (field === 'fixedPrice') row.fixedPrice = inp.checked;
      if (field === 'refundOnViolation') row.refundOnViolation = inp.checked;
      if (field === 'sortOrder') row.sortOrder = Number(inp.value) || row.sortOrder;
      if (field === 'promo') row.promoPrice = inp.value.trim() === '' ? null : Number(inp.value) || null;
      if (field === 'credits') row.creditsPerCall = Number(inp.value) || row.creditsPerCall;
      if (field.startsWith('promo-speed-')) {
        const speed = field.slice('promo-speed-'.length);
        if (!row.promoBySpeed) row.promoBySpeed = {};
        const raw = inp.value.trim();
        if (raw === '') delete row.promoBySpeed[speed];
        else if (Number.isFinite(Number(raw)) && Number(raw) > 0) row.promoBySpeed[speed] = Number(raw);
      }
      if (field.startsWith('promo-') && !field.startsWith('promo-speed-')) {
        const res = field.slice('promo-'.length);
        if (!row.promoByResolution) row.promoByResolution = {};
        const raw = inp.value.trim();
        if (raw === '') delete row.promoByResolution[res];
        else if (Number.isFinite(Number(raw)) && Number(raw) > 0) row.promoByResolution[res] = Number(raw);
      }
      if (field.startsWith('credits-speed-')) {
        const speed = field.slice('credits-speed-'.length);
        if (!row.creditsBySpeed) row.creditsBySpeed = {};
        const n = Number(inp.value);
        if (Number.isFinite(n) && n > 0) row.creditsBySpeed[speed] = n;
      }
      if (field.startsWith('credits-') && !field.startsWith('credits-speed-')) {
        const res = field.slice('credits-'.length);
        if (!row.creditsByResolution) row.creditsByResolution = {};
        const n = Number(inp.value);
        if (Number.isFinite(n) && n > 0) row.creditsByResolution[res] = n;
      }
    });
    ensureMjCreditsBySpeed(row);
  });
}

function renderTable() {
  const tbody = $('modelsTableBody');
  if (!tbody) return;
  const list = filteredRows();
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10">当前筛选无模型</td></tr>';
    return;
  }
  tbody.innerHTML = list
    .map((row) => {
      const familyLabel = FAMILY_LABEL[row.uiFamily] || row.uiFamily || '—';
      const statusOpts = [
        ['active', '上架'], ['maintenance', '维护中'], ['offline', '下架']
      ].map(([v, l]) => `<option value="${v}"${row.status === v ? ' selected' : ''}>${l}</option>`).join('');
      const refundCell = `<label class="admin-check" title="取消勾选=违规不返还积分"><input type="checkbox" data-field="refundOnViolation" ${row.refundOnViolation !== false ? 'checked' : ''}> 返还</label>`;
      // 名称：所有模型都可改；留空=用目录名。同步行把目录名写进 placeholder。
      const nameCell = `<input type="text" class="admin-input-sm" data-field="displayName" maxlength="48" value="${esc(row.displayName || '')}" placeholder="${esc(row.catalogLabel || row.label)}">
        ${isRealtimeRow(row) ? `<span class="admin-hint">目录名：${esc(row.catalogLabel || row.label)}</span>` : ''}`;
      const resetCell = isOverriddenRow(row) && isRealtimeRow(row)
        ? `<button type="button" class="admin-btn admin-btn--sm" data-reset-model="${esc(row.id)}" title="清空改名与改价，恢复卡藏目录值">恢复目录</button>`
        : '';
      return `<tr data-model-id="${esc(row.id)}">
        <td class="admin-model-sort">
          <div class="admin-model-sort__btns">
            <button type="button" class="admin-btn" data-move-up="${esc(row.id)}" title="上移">↑</button>
            <button type="button" class="admin-btn" data-move-down="${esc(row.id)}" title="下移">↓</button>
          </div>
          <input type="number" class="admin-input-sm" data-field="sortOrder" min="0" max="9999" value="${row.sortOrder}" title="数字越小越靠前">
        </td>
        <td>${esc(familyLabel)}</td>
        <td><code>${esc(row.id)}</code><br><span class="admin-hint">${esc(row.label)} · ${esc(row.description || '')}</span></td>
        <td>${nameCell}</td>
        <td><select class="admin-input-sm" data-field="status">${statusOpts}</select></td>
        <td>${refundCell}</td>
        <td>${esc((row.resolutions || []).join(' / ') || '—')}</td>
        <td>${renderCreditsInputs(row)}</td>
        <td>${renderPromoInputs(row)}</td>
        <td class="model-effective">${renderEffectiveCell(row)}<div class="admin-row" style="margin-top:4px">${resetCell}</div></td>
      </tr>`;
    })
    .join('');

  const refreshEffective = (row, tr) => {
    const eff = tr.querySelector('.model-effective');
    if (eff) eff.innerHTML = renderEffectiveCell(row);
  };
  tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
    const row = rows.find((r) => r.id === tr.dataset.modelId);
    if (!row) return;
    tr.querySelectorAll('input, select').forEach((inp) => {
      const handler = () => {
        const field = inp.dataset.field;
        if (field === 'sortOrder') {
          row.sortOrder = Number(inp.value) || row.sortOrder;
          sortRows();
          renderTable();
          return;
        }
        // 输入值先回写到行对象，再由保存时统一收集
        syncRowsFromDom();
        refreshEffective(row, tr);
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
  });
}

function moveRow(modelId, delta) {
  sortRows();
  const idx = rows.findIndex((r) => r.id === modelId);
  if (idx < 0) return;
  const next = idx + delta;
  if (next < 0 || next >= rows.length) return;
  const tmp = rows[idx].sortOrder;
  rows[idx].sortOrder = rows[next].sortOrder;
  rows[next].sortOrder = tmp;
  sortRows();
  renderTable();
}

export function init() {
  $('modelsSaveBtn')?.addEventListener('click', () => void save());
  $('panel-models')?.addEventListener('click', (e) => {
    const reset = e.target.closest('[data-reset-model]');
    if (reset) return void resetModelRow(reset.getAttribute('data-reset-model'));
    const up = e.target.closest('[data-move-up]');
    if (up) return moveRow(up.getAttribute('data-move-up'), -1);
    const down = e.target.closest('[data-move-down]');
    if (down) return moveRow(down.getAttribute('data-move-down'), 1);
    const famBtn = e.target.closest('[data-model-family]');
    if (famBtn) {
      familyFilter = famBtn.getAttribute('data-model-family') || 'all';
      $('modelFamilyTabs')?.querySelectorAll('[data-model-family]').forEach((b) => b.classList.toggle('is-active', b === famBtn));
      renderTable();
      return;
    }
    const statusBtn = e.target.closest('[data-model-status]');
    if (statusBtn) {
      statusFilter = statusBtn.getAttribute('data-model-status') || 'all';
      $('modelStatusTabs')?.querySelectorAll('[data-model-status]').forEach((b) => b.classList.toggle('is-active', b === statusBtn));
      renderTable();
    }
  });
}

export function load() {
  const tbody = $('modelsTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10">加载中…</td></tr>';
  void (async () => {
    try {
      const data = await adminFetch('/api/admin/image-models');
      rows = (data.models || []).map((row, i) => ensureMjCreditsBySpeed(normalizeModelRow(row, i)));
      sortRows();
      const warn = $('modelsPersistWarn');
      if (warn) {
        const hint = data.settingsHint || '';
        if (hint) {
          warn.textContent = hint;
          warn.hidden = false;
          warn.className = data.settingsTableReady ? 'admin-msg admin-msg--warn' : 'admin-msg admin-msg--err';
        } else {
          warn.hidden = true;
          warn.textContent = '';
        }
      }
      renderTable();
      showMsg($('modelsMsg'), data.settingsPersisted ? '' : (data.settingsTableReady ? '尚未保存过，改完请点保存' : ''), true);
    } catch (e) {
      if (tbody) tbody.innerHTML = '';
      showMsg($('modelsMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function save() {
  const btn = $('modelsSaveBtn');
  syncRowsFromDom();
  sortRows();
  const models = {};
  rows.forEach((row, index) => {
    ensureMjCreditsBySpeed(row);
    const displayName = String(row.displayName || '').trim();
    const patch = {
      status: row.status || 'active',
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10
    };
    // 所有模型（含卡藏同步模型）都保存名称与价格：留空 = 跟随卡藏目录，
    // 填了值 = 后台覆盖优先。清空输入即恢复目录值。
    if (row.pricingByResolution) {
      patch.creditsByResolution = {};
      for (const [res, val] of Object.entries(row.creditsByResolution || {})) {
        if (val != null && val !== '') patch.creditsByResolution[res] = Number(val) || 0;
      }
      if (row.promoByResolution && Object.keys(row.promoByResolution).length) {
        patch.promoByResolution = {};
        for (const [res, val] of Object.entries(row.promoByResolution)) {
          if (val != null && val !== '') patch.promoByResolution[res] = Number(val);
        }
      }
    } else if (isMjPricingRow(row)) {
      patch.creditsBySpeed = {};
      const fallback = Number(row.creditsPerCall) || 8;
      for (const speed of ['relax', 'fast', 'turbo']) {
        const raw = row.creditsBySpeed?.[speed];
        const n = Number(raw);
        patch.creditsBySpeed[speed] = Number.isFinite(n) && n > 0 ? n : fallback;
      }
      if (row.promoBySpeed && Object.keys(row.promoBySpeed).length) {
        patch.promoBySpeed = {};
        for (const [speed, val] of Object.entries(row.promoBySpeed)) {
          if (val != null && val !== '') patch.promoBySpeed[speed] = Number(val);
        }
      }
    } else {
      // 同步模型清空输入时不能回写默认价，否则「恢复目录」会固化成当前同步值。
      if (row.creditsPerCall != null && row.creditsPerCall !== '') {
        patch.creditsPerCall = Number(row.creditsPerCall) || 0;
      }
      if (row.promoPrice != null && row.promoPrice !== '') patch.promoPrice = Number(row.promoPrice);
    }
    patch.fixedPrice = !!row.fixedPrice;
    if (displayName) patch.displayName = displayName;
    patch.refundOnViolation = row.refundOnViolation !== false;
    models[row.id] = patch;
  });
  setButtonBusy(btn, true, '保存中…');
  try {
    const data = await adminFetch('/api/admin/image-models', { method: 'PUT', body: { models } });
    rows = (data.models || rows).map((row, i) => ensureMjCreditsBySpeed(normalizeModelRow(row, i)));
    sortRows();
    renderTable();
    showMsg($('modelsMsg'), '定价、排序与防亏本规则已保存', true);
    toast('生图模型配置已保存', true);
  } catch (e) {
    showMsg($('modelsMsg'), friendlyFetchError(e), false);
    toast(friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false, '保存上架与 MJ 定价');
  }
}

/** 恢复目录值：清掉该行的改名与改价覆盖，保存后价格名称回到卡藏同步值。 */
async function resetModelRow(modelId) {
  const row = rows.find((r) => r.id === modelId);
  if (!row) return;
  const ok = await adminConfirm({
    title: '恢复目录值',
    message: `清空「${row.catalogLabel || row.label}」的后台改名与改价，恢复卡藏目录值？`,
    confirmLabel: '恢复'
  });
  if (!ok) return;
  row.displayName = '';
  row.creditsPerCall = row.catalogCreditsPerCall ?? row.creditsPerCall;
  if (row.pricingByResolution && row.catalogCreditsByResolution) {
    row.creditsByResolution = { ...row.catalogCreditsByResolution };
  }
  row.promoPrice = null;
  row.promoByResolution = null;
  row.promoBySpeed = null;
  const models = {};
  rows.forEach((r, index) => {
    const patch = {
      status: r.status || 'active',
      sortOrder: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : (index + 1) * 10,
      refundOnViolation: r.refundOnViolation !== false
    };
    if (r.id === modelId) {
      patch.displayName = '';
      patch.creditsPerCall = 0;
      patch.creditsByResolution = {};
      patch.promoPrice = 0;
      patch.promoByResolution = {};
      patch.promoBySpeed = {};
    }
    models[r.id] = patch;
  });
  try {
    const data = await adminFetch('/api/admin/image-models', { method: 'PUT', body: { models } });
    rows = (data.models || rows).map((r, i) => ensureMjCreditsBySpeed(normalizeModelRow(r, i)));
    sortRows();
    renderTable();
    toast('已恢复卡藏目录值', true);
  } catch (e) {
    toast(friendlyFetchError(e), false);
  }
}
