/**
 * 会员订阅：三档每日/一次性积分 · 任务中心另入口
 */
(function () {
  const LS_CREDIT_MODE = 'promptrepo_credit_grant_mode';
  const SHOP_URL = 'https://pay.ldxp.cn/shop/1NLSZGJS';

  const CREDIT_PACKS = [
    { id: 'cr10k', label: '10000 积分', credits: 10000, price: 95, bonusDays: 40 },
    { id: 'cr5k', label: '5000 积分', credits: 5000, price: 48, bonusDays: 18 },
    { id: 'cr3k', label: '3000 积分', credits: 3000, price: 29.5, bonusDays: 10 },
    { id: 'cr1k', label: '1000 积分', credits: 1000, price: 9.8, bonusDays: 3 },
    { id: 'cr500', label: '500 积分', credits: 500, price: 4.9, bonusDays: 1 },
    { id: 'cr100', label: '100 积分', credits: 100, price: 0.99, bonusDays: 0 }
  ];

  const DAILY_BY_TIER = { basic: 10, standard: 20, pro: 40 };

  let serverCreditMode = 'daily';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function getCreditGrantMode() {
    return 'daily';
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
        `每日 ${DAILY_BY_TIER.basic} 积分（任务中心领取，当日有效）`,
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
        `每日 ${DAILY_BY_TIER.standard} 积分（任务中心领取，当日有效）`,
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
        `每日 ${DAILY_BY_TIER.pro} 积分（任务中心领取，当日有效）`,
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
  let currentMainTab = 'membership';

  function openShop() {
    window.open(SHOP_URL, '_blank', 'noopener,noreferrer');
  }

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
    if (overlay?.classList.contains('active')) {
      if (currentMainTab === 'credits') renderCreditPacks();
      else renderPlans();
    }
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
    el.classList.remove('hidden');
    el.innerHTML = '<p class="subscribe-credit-mode-label">会员每日积分请在侧栏「免费试用 · 任务中心」领取（按档位，当日有效）</p>';
  }

  function setMainTab(tab) {
    currentMainTab = tab === 'credits' ? 'credits' : 'membership';
    document.querySelectorAll('[data-subscribe-main]').forEach(btn => {
      const on = btn.dataset.subscribeMain === currentMainTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('subscribeCreditsSection')?.classList.toggle('hidden', currentMainTab !== 'credits');
    document.getElementById('subscribeMembershipSection')?.classList.toggle('hidden', currentMainTab !== 'membership');
    const title = document.getElementById('subscribePanelTitle');
    const sub = document.getElementById('subscribePanelSub');
    if (title) title.textContent = currentMainTab === 'credits' ? '积分充值' : '会员订阅';
    if (sub) {
      sub.textContent = currentMainTab === 'credits'
        ? '1 元 = 100 积分 · 购买后在小店复制激活码，在上方兑换'
        : '三档会员 · 连续包月/包年约五折';
    }
    if (currentMainTab === 'credits') renderCreditPacks();
    else renderPlans();
  }

  function renderCreditPacks() {
    const grid = document.getElementById('subscribeCreditsGrid');
    if (!grid) return;
    grid.innerHTML = CREDIT_PACKS.map(p => {
      const bonus = p.bonusDays > 0
        ? ` · 赠送 ${p.bonusDays} 天基础会员（每日积分模式）`
        : '';
      return `
      <article class="subscribe-shop-card">
        <div class="subscribe-shop-card-head">
          <h4 class="subscribe-shop-card-title">${esc(p.label)}</h4>
          <span class="subscribe-shop-card-price">¥${p.price}</span>
        </div>
        <p class="subscribe-shop-card-meta">到账 ${p.credits.toLocaleString('zh-CN')} 积分${bonus}</p>
        <button type="button" class="btn btn-primary subscribe-shop-buy-btn" data-shop-buy="${esc(p.id)}">去小店购买</button>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-shop-buy]').forEach(btn => {
      btn.addEventListener('click', () => openShop());
    });
  }

  function renderPlans() {
    const grid = document.getElementById('subscribePlansGrid');
    if (!grid) return;
    renderCreditModePicker();
    renderMiniOfferBar();
    const billingLabel = BILLING_LABELS[currentBilling] || '';
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
      const creditHint = `每日 ${DAILY_BY_TIER[plan.id]} 积分（任务中心领取）`;
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
        <button type="button" class="btn btn-primary subscribe-plan-btn" data-plan="${plan.id}" data-billing="${currentBilling}">去小店购买</button>
      </article>`;
    }).join('');

    grid.querySelectorAll('.subscribe-plan-btn').forEach(btn => {
      btn.addEventListener('click', () => openShop());
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

  function openSubscribePanel(opts) {
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
    setMainTab(opts?.tab === 'credits' ? 'credits' : 'membership');
    updateSubscribeNavBadge();
  }

  function openRechargePanel() {
    if (typeof window.closeImageGenCreditsSheet === 'function') {
      window.closeImageGenCreditsSheet();
    }
    openSubscribePanel({ tab: 'credits' });
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
    document.querySelectorAll('[data-subscribe-main]').forEach(btn => {
      btn.addEventListener('click', () => setMainTab(btn.dataset.subscribeMain));
    });
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
    DAILY_BY_TIER
  };
  window.openSubscribePanel = openSubscribePanel;
  window.closeSubscribePanel = closeSubscribePanel;
  window.unlockPageInteraction = unlockPageInteraction;
  window.openRechargePanel = openRechargePanel;

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
