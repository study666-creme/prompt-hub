/**
 * 会员订阅方案（UI 草案，支付待接入）
 */
(function () {
  const LS_FIRST_OFFER = 'promptrepo_first_sub_used';
  const LS_FIRST_OFFER_MIGRATE = 'promptrepo_first_offer_migrate_v2';
  /** 登录后由 /me 同步；undefined = 尚未同步 */
  let serverFirstSubOfferUsed;

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  /** 清除旧版「点演示订阅」误写入的 localStorage */
  function migrateStaleFirstOfferFlag() {
    try {
      if (localStorage.getItem(LS_FIRST_OFFER_MIGRATE)) return;
      localStorage.removeItem(LS_FIRST_OFFER);
      localStorage.setItem(LS_FIRST_OFFER_MIGRATE, '1');
      serverFirstSubOfferUsed = undefined;
    } catch (e) { /* ignore */ }
  }

  const PLANS = [
    {
      id: 'basic',
      name: '基础版',
      tag: '入门',
      credits: 100,
      storage: '10 GB',
      genDiscount: '9折',
      features: ['每月 100 积分', '生图积分 9 折', '无限置顶', '10 GB 云存储', '全站云同步']
    },
    {
      id: 'standard',
      name: '标准版',
      tag: '推荐',
      credits: 310,
      storage: '30 GB',
      genDiscount: '8折',
      features: ['每月 310 积分', '生图积分 8 折', '无限置顶', '30 GB 云存储', '优先生图队列']
    },
    {
      id: 'pro',
      name: '专业版',
      tag: '专业',
      credits: 1000,
      storage: '100 GB',
      genDiscount: '7折',
      features: ['每月 1000 积分', '生图积分 7 折', '无限置顶', '100 GB 云存储', '最高优先级']
    }
  ];

  const PRICES = {
    basic: {
      auto_month: { price: 9.9, original: 19.9, unit: '月', firstPrice: 1.9 },
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

  function hasUsedFirstOffer() {
    if (serverFirstSubOfferUsed !== undefined) return serverFirstSubOfferUsed;
    if (isLoggedIn()) return false;
    return localStorage.getItem(LS_FIRST_OFFER) === '1';
  }

  function setFirstOfferUsedFromServer(used) {
    serverFirstSubOfferUsed = !!used;
    if (used) localStorage.setItem(LS_FIRST_OFFER, '1');
    else localStorage.removeItem(LS_FIRST_OFFER);
    refreshOfferUI();
  }

  function resetFirstOfferServerState() {
    serverFirstSubOfferUsed = undefined;
    refreshOfferUI();
  }

  function refreshOfferUI() {
    updateSubscribeNavBadge();
    const overlay = document.getElementById('subscribeOverlay');
    if (overlay?.classList.contains('active')) renderPlans();
  }

  function updateSubscribeNavBadge() {
    const badge = document.querySelector('.app-nav-subscribe-badge');
    if (!badge) return;
    badge.textContent = !hasUsedFirstOffer() ? '一折起' : '五折起';
  }

  function getDisplayPrice(planId, billing) {
    const p = PRICES[planId]?.[billing];
    if (!p) return null;
    if (planId === 'basic' && billing === 'auto_month' && !hasUsedFirstOffer() && p.firstPrice != null) {
      return { ...p, price: p.firstPrice, isFirstOffer: true };
    }
    return { ...p, isFirstOffer: false };
  }

  function saveLabel(original, price, isFirstOffer) {
    if (isFirstOffer) return '一折起';
    if (!original || original <= price) return '';
    const pct = Math.round((1 - price / original) * 100);
    if (pct < 5) return '';
    if (pct >= 85) return '一折起';
    if (pct >= 45 && pct <= 55) return '约五折';
    return `省 ${pct}%`;
  }

  function renderFirstOfferBanner() {
    const el = document.getElementById('subscribeFirstOffer');
    if (!el) return;
    if (hasUsedFirstOffer()) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <p class="subscribe-first-offer-title">首开基础版连续包月 <strong>¥1.9</strong></p>
      <p class="subscribe-first-offer-sub">原价 ¥19.9 / 月 · 约一折，仅限首次开通</p>`;
  }

  function renderPlans() {
    const grid = document.getElementById('subscribePlansGrid');
    if (!grid) return;
    renderFirstOfferBanner();
    const billingLabel = BILLING_LABELS[currentBilling] || '';
    grid.innerHTML = PLANS.map(plan => {
      const p = getDisplayPrice(plan.id, currentBilling);
      if (!p) return '';
      const originalHtml = p.original
        ? `<span class="subscribe-plan-original">¥${p.original}</span>`
        : '';
      const saveText = saveLabel(p.original, p.price, p.isFirstOffer);
      const saveBadge = saveText
        ? `<span class="subscribe-plan-save">${esc(saveText)}</span>`
        : '';
      const firstNote = p.isFirstOffer
        ? '<p class="subscribe-plan-first-note">首开连续包月 · 一折起</p>'
        : '';
      const featHtml = plan.features.map(f => `<li>${esc(f)}</li>`).join('');
      return `<article class="subscribe-plan-card${plan.id === 'standard' ? ' featured' : ''}" data-plan="${plan.id}">
        <div class="subscribe-plan-head">
          <span class="subscribe-plan-tag">${esc(plan.tag)}</span>
          ${saveBadge}
          <h4>${esc(plan.name)}</h4>
          <p class="subscribe-plan-billing-type">${esc(billingLabel)}</p>
        </div>
        <div class="subscribe-plan-price">
          ${originalHtml}
          <span class="subscribe-plan-amount">¥${p.price}</span>
          <span class="subscribe-plan-unit">/${esc(p.unit)}</span>
        </div>
        ${firstNote}
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
        const msg = `「${plan.name}」${BILLING_LABELS[billing]} ¥${price.price} — 在线支付筹备中，请先在「图片生成」页用淘宝激活码兑换积分或会员`;
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

  function openSubscribePanel() {
    const el = document.getElementById('subscribeOverlay');
    if (!el) return;
    el.classList.add('active');
    document.body.classList.add('subscribe-open');
    renderPlans();
    updateSubscribeNavBadge();
  }

  function closeSubscribePanel() {
    document.getElementById('subscribeOverlay')?.classList.remove('active');
    document.body.classList.remove('subscribe-open');
  }

  function bind() {
    document.querySelectorAll('[data-subscribe-billing]').forEach(btn => {
      btn.addEventListener('click', () => setBilling(btn.dataset.subscribeBilling));
    });
    document.getElementById('subscribeOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'subscribeOverlay') closeSubscribePanel();
    });
  }

  window.SubscriptionUI = {
    open: openSubscribePanel,
    close: closeSubscribePanel,
    PLANS,
    hasUsedFirstOffer,
    setFirstOfferUsedFromServer,
    resetFirstOfferServerState,
    updateSubscribeNavBadge,
    refreshOfferUI
  };
  window.openSubscribePanel = openSubscribePanel;
  window.closeSubscribePanel = closeSubscribePanel;
  window.openRechargePanel = openSubscribePanel;

  migrateStaleFirstOfferFlag();

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
