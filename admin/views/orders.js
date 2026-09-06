/* 订单：payment_orders 列表 + 状态筛选 + 历史订单（note 迁移前）+ 人工补单 */

import { $, esc, fullTime, showMsg, toast, adminConfirm, setButtonBusy } from '../modules/ui.js';
import { adminFetch, friendlyFetchError } from '../modules/api.js';
import { showUserDetail } from './users.js';

export const title = ['订单管理', '支付订单、人工补单与对账'];

const PAGE = 20;
let offset = 0;

export function init() {
  $('orderStateFilter')?.addEventListener('change', () => void load(true));
  $('orderKindFilter')?.addEventListener('change', () => void load(true));
  $('orderRefresh')?.addEventListener('click', () => void load(true));
  $('orderPrev')?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE);
    void load(false);
  });
  $('orderNext')?.addEventListener('click', () => {
    offset += PAGE;
    void load(false);
  });
  $('orderLoadLegacy')?.addEventListener('click', () => void loadLegacy());
  $('manualGrantBtn')?.addEventListener('click', () => void manualGrant());
}

export function load(reset = true) {
  if (reset) offset = 0;
  const tbody = $('ordersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="admin-loading"><td colspan="7">加载中…</td></tr>';
  const state = $('orderStateFilter')?.value || '';
  const kind = $('orderKindFilter')?.value || '';
  void (async () => {
    try {
      const data = await adminFetch(
        `/api/admin/orders?limit=${PAGE}&offset=${offset}${state ? '&state=' + encodeURIComponent(state) : ''}${kind ? '&kind=' + encodeURIComponent(kind) : ''}`
      );
      $('orderPageInfo').textContent = `第 ${offset + 1}–${offset + data.items.length} 条 / 共 ${data.total} 单`;
      const prev = $('orderPrev');
      const next = $('orderNext');
      if (prev) prev.disabled = offset <= 0;
      if (next) next.disabled = offset + data.items.length >= data.total;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="admin-hint">暂无订单（新订单将实时入表；历史订单请点「加载迁移前订单」）</td></tr>';
        return;
      }
      const stateBadge = (s) => {
        const map = {
          paid: ['ok', '已支付'],
          pending: ['info', '待支付'],
          processing: ['warn', '处理中'],
          failed: ['off', '失败'],
          refunded: ['warn', '已退款']
        };
        const [cls, label] = map[s] || ['info', s];
        return `<span class="admin-badge admin-badge--${cls}">${esc(label)}</span>`;
      };
      tbody.innerHTML = data.items
        .map((o) => `<tr>
          <td><code>${esc(o.order_no)}</code><br><span class="admin-hint">${esc(fullTime(o.created_at))}</span></td>
          <td>${esc(o.userName || '—')}<br><span class="admin-hint"><code>${esc(String(o.user_id || '').slice(0, 8))}…</code></span></td>
          <td>${esc(o.productTitle)}</td>
          <td>¥${esc(o.amountYuan)}</td>
          <td>${esc(o.payment_method === 'wxpay' ? '微信' : o.payment_method === 'alipay' ? '支付宝' : o.payment_method)}</td>
          <td>${stateBadge(o.state)}${o.paid_at ? `<br><span class="admin-hint">${esc(fullTime(o.paid_at))}</span>` : ''}</td>
          <td class="admin-actions-cell"><button type="button" class="admin-btn admin-btn--sm" data-order-user="${esc(o.user_id)}">用户</button></td>
        </tr>`)
        .join('');
      tbody.querySelectorAll('[data-order-user]').forEach((btn) => {
        btn.addEventListener('click', () => void showUserDetail(btn.getAttribute('data-order-user')));
      });
      showMsg($('ordersMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('ordersMsg'), friendlyFetchError(e), false);
    }
  })();
}

async function loadLegacy() {
  const box = $('legacyOrdersBox');
  const btn = $('orderLoadLegacy');
  if (!box) return;
  setButtonBusy(btn, true, '扫描中…');
  box.hidden = false;
  box.innerHTML = '<p class="admin-hint">正在扫描 activation_codes.note 中的历史订单…</p>';
  try {
    const data = await adminFetch('/api/admin/orders/legacy-notes', { timeoutMs: 60000 });
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<p class="admin-hint">没有找到迁移前的历史订单。</p>';
      return;
    }
    box.innerHTML = `
      <p class="admin-hint">迁移前订单 ${items.length} 条（只读，来自 activation_codes.note）：</p>
      <div class="admin-table-wrap">
        <table class="admin-table admin-table--compact">
          <thead><tr><th>订单号</th><th>用户</th><th>商品</th><th>金额</th><th>状态</th><th>创建时间</th></tr></thead>
          <tbody>${items.map((o) => `<tr>
            <td><code>${esc(o.orderNo)}</code></td>
            <td><code>${esc(String(o.userId || '').slice(0, 8))}…</code></td>
            <td>${esc(o.productKind === 'membership' ? `会员 ${o.membershipTier || ''}` : `积分 ${o.credits}`)}</td>
            <td>¥${esc(o.amountYuan)}</td>
            <td>${esc(o.state || 'pending')}</td>
            <td>${esc(fullTime(o.createdAt))}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) {
    box.innerHTML = '<p class="admin-msg admin-msg--err">' + esc(friendlyFetchError(e)) + '</p>';
  } finally {
    setButtonBusy(btn, false);
  }
}

async function manualGrant() {
  const userId = ($('manualGrantUserId')?.value || '').trim();
  const credits = Number($('manualGrantCredits')?.value);
  const reason = ($('manualGrantReason')?.value || '').trim();
  if (!userId || !Number.isFinite(credits) || credits <= 0 || !reason) {
    toast('请填写用户 ID、正整数积分与原因', false);
    return;
  }
  const ok = await adminConfirm({
    title: '人工补单',
    message: `为用户 ${userId} 补发 ${credits} 积分？\n\n原因：${reason}\n将通过 apply_credit_delta 写入流水，可审计。`,
    confirmLabel: '确认补发'
  });
  if (!ok) return;
  const btn = $('manualGrantBtn');
  setButtonBusy(btn, true, '补发中…');
  try {
    const res = await adminFetch('/api/admin/orders/manual-grant', {
      method: 'POST',
      body: { userId, credits: Math.floor(credits), reason },
      timeoutMs: 30000
    });
    toast(`已补发 ${credits} 积分，余额 ${res.balanceAfter}`, true);
    $('manualGrantUserId').value = '';
    $('manualGrantCredits').value = '';
    $('manualGrantReason').value = '';
  } catch (e) {
    toast('补发失败：' + friendlyFetchError(e), false);
  } finally {
    setButtonBusy(btn, false);
  }
}
