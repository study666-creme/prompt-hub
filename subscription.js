/**
 * 会员订阅：轻量 + 三档 · 每日/一次性积分
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

  const DAILY_BY_TIER = { lite: 10, basic: 13, standard: 32, pro: 64 };
  const LUMP_BY_TIER = { basic: 130, standard: 320, pro: 700 };

  let serverCreditMode = 'daily';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function getCreditGrantMode() {
    try {
      const saved = localStorage.getItem(LS_CREDIT_MODE);
      if (saved === 'daily' || saved === 'bundle') return saved;
    } catch (e) { /* ignore */ }
    return serverCreditMode || 'daily';
  }

  function setCreditGrantModeLocal(mode) {
    serverCreditMode = mode === 'daily' ? 'daily' : 'bundle';
    try {
      localStorage.setItem(LS_CREDIT_MODE, serverCreditMode);
    } catch (e) { /* ignore */ }
    renderCreditModePicker();
  }

  const LITE_PLAN = {
    id: 'lite',
    name: '轻量会员包',
    tag: '特惠',
    summary: '在免费每日 5 积分基础上额外 +5（共 10 积分/天）· 2 GB · 置顶 3 张 · 仅每日领取'
  };

  const PLANS = [
    {
      id: 'basic',
      name: '基础版',
      tag: '入门',
      storage: '5 GB',
      genDiscount: '9折',
      features: [
        '生图优先队列 · 积分 9 折',
        `额外每日 ${DAILY_BY_TIER.basic} 积分或一次性 ${LUMP_BY_TIER.basic} 积分`,
        '无限置顶',
        '资产创作工作台',
        '5 GB 云存储',
        '全站云同步'
      ]
    },
    {
      id: 'standard',
      name: '标准版',
      tag: '推荐',
      storage: '10 GB',
      genDiscount: '8折',
      features: [
        '生图优先队列 · 积分 8 折',
        `额外每日 ${DAILY_BY_TIER.standard} 积分或一次性 ${LUMP_BY_TIER.standard} 积分`,
        '无限置顶',
        '资产创作工作台',
        '10 GB 云存储',
        '优先生图队列',
        '可另建 1 个自命名卡片库'
      ]
    },
    {
      id: 'pro',
      name: '专业版',
      tag: '专业',
      storage: '30 GB',
      genDiscount: '7折',
      features: [
        '最高优先级 · 积分 7 折',
        `额外每日 ${DAILY_BY_TIER.pro} 积分或一次性 ${LUMP_BY_TIER.pro} 积分`,
        '无限置顶',
        '资产创作工作台',
        '30 GB 云存储',
        '最高生图优先级',
        '可另建 2 个自命名卡片库'
      ]
    }
  ];

  const PRICES = {
    lite: {
      auto_month: { price: 6, original: 9, unit: '月' },
      single_month: { price: 9, original: null, unit: '月' },
      auto_year: { price: 58, original: 108, unit: '年' },
      single_year: { price: 88, original: null, unit: '年' }
    },
    basic: {
      auto_month: { price: 12.9, original: 15.9, unit: '月' },
      single_month: { price: 15.9, original: null, unit: '月' },
      auto_year: { price: 129, original: 190, unit: '年' },
      single_year: { price: 169, original: null, unit: '年' }
    },
    standard: {
      auto_month: { price: 31.9, original: 39.9, unit: '月' },
      single_month: { price: 39.9, original: null, unit: '月' },
      auto_year: { price: 319, original: 479, unit: '年' },
      single_year: { price: 399, original: null, unit: '年' }
    },
    pro: {
      auto_month: { price: 63.9, original: 69.9, unit: '月' },
      single_month: { price: 69.9, original: null, unit: '月' },
      auto_year: { price: 639, original: 839, unit: '年' },
      single_year: { price: 699, original: null, unit: '年' }
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
      metaEl.className = 'app-nav-subscribe-meta';
      if (info.active) {
        metaEl.classList.add('is-member');
        if (info.tier) metaEl.classList.add(`is-member-${info.tier}`);
      }
    }
    if (panelEl) {
      panelEl.hidden = false;
      if (info.active) {
        panelEl.innerHTML = `<div class="subscribe-membership-status is-active"><span class="subscribe-membership-tier">${esc(info.tierLabel)}</span><span class="subscribe-membership-until">${esc(info.untilLabel)}</span></div>`;
      } else {
        panelEl.innerHTML = `<div class="subscribe-membership-status"><span class="subscribe-membership-tier">普通用户</span><span class="subscribe-membership-until">免费 · 每日 5 积分 · 100 张卡片存储</span></div>`;
      }
    }
  }

  function updateSubscribeNavBadge() {
    const trialBadge = document.querySelector('.app-nav-trial-badge');
    const subBadge = document.querySelector('.app-nav-subscribe-badge');
    if (trialBadge) trialBadge.textContent = '任务';
    if (subBadge) subBadge.textContent = '特惠';
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
    const isMember = window.Membership?.isMember?.();
    const tier = window.Membership?.getMemberTier?.();
    const canPick = isMember && tier && tier !== 'lite';
    el.classList.remove('hidden');
    el.innerHTML = `
      <p class="subscribe-credit-mode-label">兑换会员卡密前先选领取方式（同一码通用，轻量会员固定每日）</p>
      <div class="subscribe-credit-mode-options">
        <label class="subscribe-credit-mode-opt${mode === 'daily' ? ' active' : ''}">
          <input type="radio" name="creditGrantMode" value="daily" ${mode === 'daily' ? 'checked' : ''}>
          <span>每日领取</span>
          <small>任务中心按日领（基础 ${DAILY_BY_TIER.basic} / 标准 ${DAILY_BY_TIER.standard} / 专业 ${DAILY_BY_TIER.pro}）</small>
        </label>
        <label class="subscribe-credit-mode-opt${mode === 'bundle' ? ' active' : ''}">
          <input type="radio" name="creditGrantMode" value="bundle" ${mode === 'bundle' ? 'checked' : ''}>
          <span>一次性领取</span>
          <small>开通当期一次性到账（${LUMP_BY_TIER.basic} / ${LUMP_BY_TIER.standard} / ${LUMP_BY_TIER.pro} 积分）</small>
        </label>
      </div>
      ${!canPick && isMember && tier === 'lite' ? '<p class="subscribe-credit-mode-hint">轻量会员：在免费每日 5 积分基础上额外 +5（共 10 积分/天），仅支持每日领取</p>' : ''}`;
    el.querySelectorAll('input[name="creditGrantMode"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        const next = input.value === 'bundle' ? 'bundle' : 'daily';
        setCreditGrantModeLocal(next);
        if (isLoggedIn() && canPick) {
          const r = await window.PromptHubApi?.setCreditGrantMode?.(next);
          if (r?.ok) {
            window.showToast?.(r.data?.message || '已更新积分领取方式');
            if (r.data) window.SubscriptionUI?.applyServerState?.(r.data);
          } else if (r?.message) {
            window.showToast?.(r.message);
          }
        }
      });
    });
  }

  function renderLitePlanRow() {
    const row = document.getElementById('subscribeLitePlanRow');
    if (!row) return;
    const billingLabel = BILLING_LABELS[currentBilling] || '';
    const p = getDisplayPrice('lite', currentBilling);
    if (!p) {
      row.innerHTML = '';
      return;
    }
    const originalHtml = p.original
      ? `<span class="subscribe-plan-original">¥${p.original}</span>`
      : '';
    const saveText = saveLabel(p.original, p.price);
    const saveBadge = saveText
      ? `<span class="subscribe-plan-save">${esc(saveText)}</span>`
      : '';
    row.innerHTML = `<article class="subscribe-plan-card subscribe-lite-plan subscribe-lite-compact" data-plan="lite">
      <div class="subscribe-lite-compact-top">
        <div class="subscribe-lite-compact-main">
          <span class="subscribe-plan-tag subscribe-plan-tag-deal">🔥 ${esc(LITE_PLAN.tag)}</span>
          <h4 class="subscribe-lite-title">${esc(LITE_PLAN.name)}</h4>
        </div>
        <div class="subscribe-lite-compact-price">
          ${originalHtml}
          ${saveBadge}
          <span class="subscribe-plan-amount">¥${p.price}</span>
          <span class="subscribe-plan-unit">/${esc(p.unit)}</span>
        </div>
      </div>
      <p class="subscribe-lite-meta">${esc(billingLabel)} · ${esc(LITE_PLAN.summary)}</p>
      <button type="button" class="btn btn-primary btn-sm subscribe-plan-btn subscribe-lite-buy" data-plan="lite" data-billing="${currentBilling}">购买</button>
    </article>`;
    row.querySelector('.subscribe-plan-btn')?.addEventListener('click', () => openShop());
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
        : '轻量特惠 + 三档会员 · 连续包月更省';
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
    renderLitePlanRow();
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
      const creditHint = `每日 ${DAILY_BY_TIER[plan.id]} 或一次性 ${LUMP_BY_TIER[plan.id]}`;
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
    LITE_PLAN,
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
