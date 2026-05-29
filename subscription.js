/**
 * 会员订阅：三档每日/一次性积分 · 任务中心另入口
 */
(function () {
  const LS_CREDIT_MODE = 'promptrepo_credit_grant_mode';

  const DAILY_BY_TIER = { basic: 10, standard: 20, pro: 40 };
  const LUMP_BY_TIER = { basic: 100, standard: 310, pro: 620 };

  let serverCreditMode = 'bundle';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function getCreditGrantMode() {
    if (serverCreditMode === 'daily' || serverCreditMode === 'bundle') {
      return serverCreditMode;
    }
    try {
      const v = localStorage.getItem(LS_CREDIT_MODE);
      return v === 'daily' ? 'daily' : 'bundle';
    } catch (e) {
      return 'bundle';
    }
  }

  function setCreditGrantModeLocal(mode) {
    serverCreditMode = mode === 'daily' ? 'daily' : 'bundle';
    try {
      localStorage.setItem(LS_CREDIT_MODE, serverCreditMode);
    } catch (e) { /* ignore */ }
    renderCreditModePicker();
  }

  const PLANS = [
    {
      id: 'basic',
      name: '基础版',
      tag: '入门',
      storage: '10 GB',
      genDiscount: '五折起',
      features: [
        `连续包月/包年订阅价约五折（见下方标价）`,
        `每日 ${DAILY_BY_TIER.basic} 积分（当日有效）或一次性 ${LUMP_BY_TIER.basic}`,
        '会员生图享积分折扣',
        '无限置顶',
        '10 GB 云存储',
        '全站云同步'
      ]
    },
    {
      id: 'standard',
      name: '标准版',
      tag: '推荐',
      storage: '30 GB',
      genDiscount: '五折起',
      features: [
        `连续包月/包年订阅价约五折（见下方标价）`,
        `每日 ${DAILY_BY_TIER.standard} 积分或一次性 ${LUMP_BY_TIER.standard}`,
        '会员生图享更高折扣',
        '无限置顶',
        '30 GB 云存储',
        '优先生图队列'
      ]
    },
    {
      id: 'pro',
      name: '专业版',
      tag: '专业',
      storage: '100 GB',
      genDiscount: '五折起',
      features: [
        `连续包月/包年订阅价约五折（见下方标价）`,
        `每日 ${DAILY_BY_TIER.pro} 积分或一次性 ${LUMP_BY_TIER.pro}`,
        '会员生图享最高折扣',
        '无限置顶',
        '100 GB 云存储',
        '最高优先级'
      ]
    }
  ];

  const PRICES = {
    basic: {
      auto_month: { price: 9.9, original: 19.9, unit: '月' },
      single_month: { price: 19.9, original: null, unit: '月' },
      auto_year: { price: 99, original: 199, unit: '年' },
      single_year: { price: 149, original: null, unit: '年' }
    },
    standard: {
      auto_month: { price: 29.9, original: 59.9, unit: '月' },
      single_month: { price: 39.9, original: null, unit: '月' },
      auto_year: { price: 299, original: 599, unit: '年' },
      single_year: { price: 399, original: null, unit: '年' }
    },
    pro: {
      auto_month: { price: 69.9, original: 139.9, unit: '月' },
      single_month: { price: 89.9, original: null, unit: '月' },
      auto_year: { price: 699, original: 1399, unit: '年' },
      single_year: { price: 899, original: null, unit: '年' }
    }
  };

  const BILLING_LABELS = {
    auto_month: '连续包月',
    single_month: '单月购买',
    auto_year: '连续包年',
    single_year: '单年购买'
  };

  let currentBilling = 'auto_month';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyServerState(me) {
    if (!me || typeof me !== 'object') return;
    if (me.creditGrantMode === 'daily' || me.creditGrantMode === 'bundle') {
      serverCreditMode = me.creditGrantMode;
      try {
        localStorage.setItem(LS_CREDIT_MODE, serverCreditMode);
      } catch (e) { /* ignore */ }
    }
    refreshOfferUI();
  }

  function refreshOfferUI() {
    renderMembershipStatus();
    updateSubscribeNavBadge();
    renderCreditModePicker();
    renderMiniOfferBar();
    const overlay = document.getElementById('subscribeOverlay');
    if (overlay?.classList.contains('active')) renderPlans();
  }

  function renderMembershipStatus() {
    const info = window.Membership?.getMembershipDisplay?.();
    const metaEl = document.getElementById('appNavSubscribeMeta');
    const panelEl = document.getElementById('subscribeMembershipStatus');
    if (!info) return;
    if (metaEl) {
      metaEl.textContent = info.active ? info.summary : info.summary;
      metaEl.classList.toggle('is-member', info.active);
    }
    if (panelEl) {
      panelEl.hidden = false;
      if (info.active) {
        panelEl.innerHTML = `<div class="subscribe-membership-status is-active"><span class="subscribe-membership-tier">${esc(info.tierLabel)}</span><span class="subscribe-membership-until">${esc(info.untilLabel)}</span></div>`;
      } else {
        panelEl.innerHTML = `<div class="subscribe-membership-status"><span class="subscribe-membership-tier">免费用户</span><span class="subscribe-membership-until">完成任务可领取基础会员天数</span></div>`;
      }
    }
  }

  function updateSubscribeNavBadge() {
    const trialBadge = document.querySelector('.app-nav-trial-badge');
    const subBadge = document.querySelector('.app-nav-subscribe-badge');
    const isMember = window.Membership?.isMember?.();
    if (trialBadge) trialBadge.textContent = '任务';
    if (subBadge) subBadge.textContent = '五折';
  }

  function renderMiniOfferBar() {
    const el = document.getElementById('subscribeMiniOffer');
    if (!el) return;
    el.innerHTML = '';
    el.hidden = true;
  }

  function getDisplayPrice(planId, billing) {
    const p = PRICES[planId]?.[billing];
    if (!p) return null;
    return { ...p, isFirstOffer: false };
  }

  function saveLabel(original, price) {
    if (!original || original <= price) return '';
    const pct = Math.round((1 - price / original) * 100);
    if (pct < 5) return '';
    if (pct >= 85) return '一折起';
    if (pct >= 45 && pct <= 55) return '约五折';
    return `省 ${pct}%`;
  }

  function renderCreditModePicker() {
    const el = document.getElementById('subscribeCreditMode');
    if (!el) return;
    const mode = getCreditGrantMode();
    el.classList.remove('hidden');
    el.innerHTML = `
      <p class="subscribe-credit-mode-label">会员积分领取方式（开通/兑换时生效，可随时切换）</p>
      <div class="subscribe-credit-mode-options" role="radiogroup">
        <label class="subscribe-credit-mode-opt${mode === 'daily' ? ' active' : ''}">
          <input type="radio" name="creditGrantMode" value="daily"${mode === 'daily' ? ' checked' : ''}>
          <span>每日积分（按档位）</span>
          <small>基础 ${DAILY_BY_TIER.basic} / 标准 ${DAILY_BY_TIER.standard} / 专业 ${DAILY_BY_TIER.pro}，当日有效</small>
        </label>
        <label class="subscribe-credit-mode-opt${mode === 'bundle' ? ' active' : ''}">
          <input type="radio" name="creditGrantMode" value="bundle"${mode === 'bundle' ? ' checked' : ''}>
          <span>一次性到账</span>
          <small>基础 ${LUMP_BY_TIER.basic} / 标准 ${LUMP_BY_TIER.standard} / 专业 ${LUMP_BY_TIER.pro}，永久有效</small>
        </label>
      </div>`;
    el.querySelectorAll('input[name="creditGrantMode"]').forEach(input => {
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        setCreditGrantModeLocal(input.value);
        if (!isLoggedIn()) return;
        const r = await window.PromptHubApi?.setCreditGrantMode?.(input.value);
        if (r?.ok) {
          await window.PromptHubApi?.syncMe?.({ silent: true });
          if (typeof showToast === 'function') showToast(r.data.message || '已更新');
        } else if (r?.code === 'NOT_MEMBER') {
          /* 未开通会员时仅本地记住偏好 */
        } else if (typeof showToast === 'function') {
          showToast(r?.message || '更新失败');
        }
      });
    });
  }

  function renderPlans() {
    const grid = document.getElementById('subscribePlansGrid');
    if (!grid) return;
    renderCreditModePicker();
    renderMiniOfferBar();
    const billingLabel = BILLING_LABELS[currentBilling] || '';
    const mode = getCreditGrantMode();
    grid.innerHTML = PLANS.map(plan => {
      const p = getDisplayPrice(plan.id, currentBilling);
      if (!p) return '';
      const originalHtml = p.original
        ? `<span class="subscribe-plan-original">¥${p.original}</span>`
        : '';
      const saveText = saveLabel(p.original, p.price);
      const saveBadge = saveText
        ? `<span class="subscribe-plan-save">${esc(saveText)}</span>`
        : '';
      const featHtml = plan.features.map(f => `<li>${esc(f)}</li>`).join('');
      const creditHint =
        mode === 'daily'
          ? `每日 ${DAILY_BY_TIER[plan.id]} 积分`
          : `一次性 ${LUMP_BY_TIER[plan.id]} 积分`;
      return `<article class="subscribe-plan-card${plan.id === 'standard' ? ' featured' : ''}" data-plan="${plan.id}">
        <div class="subscribe-plan-head">
          <span class="subscribe-plan-tag">${esc(plan.tag)}</span>
          ${saveBadge}
          <h4>${esc(plan.name)}</h4>
          <p class="subscribe-plan-billing-type">${esc(billingLabel)} · ${esc(creditHint)}</p>
        </div>
        <div class="subscribe-plan-price">
          ${originalHtml}
          <span class="subscribe-plan-amount">¥${p.price}</span>
          <span class="subscribe-plan-unit">/${esc(p.unit)}</span>
        </div>
        <ul class="subscribe-plan-features">${featHtml}</ul>
        <button type="button" class="btn btn-primary subscribe-plan-btn" data-plan="${plan.id}" data-billing="${currentBilling}">立即订阅</button>
      </article>`;
    }).join('');

    grid.querySelectorAll('.subscribe-plan-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = btn.dataset.plan;
        const billing = btn.dataset.billing;
        const plan = PLANS.find(x => x.id === planId);
        const price = getDisplayPrice(planId, billing);
        if (!plan || !price) return;
        const modeLabel =
          getCreditGrantMode() === 'daily'
            ? `每日 ${DAILY_BY_TIER[planId]} 积分（当日有效）`
            : `一次性 ${LUMP_BY_TIER[planId]} 积分（永久）`;
        const msg = `「${plan.name}」${BILLING_LABELS[billing]} ¥${price.price}（约五折），${modeLabel} — 在线支付筹备中，开通后将自动到账`;
        if (typeof showToast === 'function') showToast(msg);
        else alert(msg);
      });
    });
  }

  function setBilling(mode) {
    currentBilling = mode;
    document.querySelectorAll('[data-subscribe-billing]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subscribeBilling === mode);
    });
    renderPlans();
    updateSubscribeNavBadge();
  }

  function ensureModalOverlaysOnBody() {
    ['trialTasksOverlay', 'subscribeOverlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== document.body) document.body.appendChild(el);
    });
  }

  function openSubscribePanel() {
    window.MobileUI?.closeDrawers?.();
    ensureModalOverlaysOnBody();
    const el = document.getElementById('subscribeOverlay');
    if (!el) return;
    if (window.AppModalHub) window.AppModalHub.open('subscribeOverlay');
    else {
      el.hidden = false;
      el.classList.add('active');
      document.body.classList.add('subscribe-open');
    }
    if (isLoggedIn()) void window.PromptHubApi?.syncMe?.({ silent: true });
    renderPlans();
    updateSubscribeNavBadge();
  }

  function unlockPageInteraction() {
    window.AppModalHub?.unlockAll?.();
  }

  function closeSubscribePanel() {
    if (window.AppModalHub) {
      window.AppModalHub.close('subscribeOverlay');
      return;
    }
    const el = document.getElementById('subscribeOverlay');
    if (el) {
      el.classList.remove('active');
      el.hidden = true;
    }
    document.body.classList.remove('subscribe-open', 'app-modal-open');
  }

  function bind() {
    ensureModalOverlaysOnBody();
    document.querySelectorAll('[data-subscribe-billing]').forEach(btn => {
      btn.addEventListener('click', () => setBilling(btn.dataset.subscribeBilling));
    });
    const overlay = document.getElementById('subscribeOverlay');
    const panel = overlay?.querySelector('.subscribe-panel:not(.trial-tasks-panel)');
    panel?.addEventListener('click', (e) => e.stopPropagation());
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeSubscribePanel();
    });
    document.getElementById('subscribeCloseBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSubscribePanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay?.classList.contains('active')) closeSubscribePanel();
      else if (document.getElementById('trialTasksOverlay')?.classList.contains('active')) {
        window.closeTrialTasksPanel?.();
      }
    });
  }

  function setFirstOfferUsedFromServer() { /* 已停售 ¥1.9 续杯 */ }
  function resetFirstOfferServerState() { refreshOfferUI(); }

  window.SubscriptionUI = {
    open: openSubscribePanel,
    close: closeSubscribePanel,
    PLANS,
    getCreditGrantMode,
    setCreditGrantModeLocal,
    setFirstOfferUsedFromServer,
    resetFirstOfferServerState,
    applyServerState,
    updateSubscribeNavBadge,
    refreshOfferUI,
    DAILY_BY_TIER,
    LUMP_BY_TIER
  };
  window.openSubscribePanel = openSubscribePanel;
  window.closeSubscribePanel = closeSubscribePanel;
  window.unlockPageInteraction = unlockPageInteraction;
  window.openRechargePanel = openSubscribePanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bind();
      refreshOfferUI();
    });
  } else {
    bind();
    refreshOfferUI();
  }
})();
