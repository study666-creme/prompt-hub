/**
 * 会员订阅：3 天免费试用（每日 10 积分）· ¥1.9 续杯 14 天 · 积分领取方式二选一
 */
(function () {
  const LS_FIRST_OFFER = 'promptrepo_first_sub_used';
  const LS_FIRST_OFFER_MIGRATE = 'promptrepo_first_offer_migrate_v2';
  const LS_CREDIT_MODE = 'promptrepo_credit_grant_mode';

  let serverFirstSubOfferUsed;
  let serverTrial = { canClaimFree: false, trialFreeUsed: true, phoneVerified: false };
  let serverCreditMode = 'bundle';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function migrateStaleFirstOfferFlag() {
    try {
      if (localStorage.getItem(LS_FIRST_OFFER_MIGRATE)) return;
      localStorage.removeItem(LS_FIRST_OFFER);
      localStorage.setItem(LS_FIRST_OFFER_MIGRATE, '1');
      serverFirstSubOfferUsed = undefined;
    } catch (e) { /* ignore */ }
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

  const LUMP_BY_TIER = { basic: 100, standard: 310, pro: 1000 };
  const DAILY_AMOUNT = 10;

  const PLANS = [
    {
      id: 'basic',
      name: '基础版',
      tag: '入门',
      storage: '10 GB',
      genDiscount: '9折',
      features: [
        `积分：每日 ${DAILY_AMOUNT}（当日有效）或一次性 ${LUMP_BY_TIER.basic}（永久）`,
        '生图积分 9 折',
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
      genDiscount: '8折',
      features: [
        `积分：每日 ${DAILY_AMOUNT} 或一次性 ${LUMP_BY_TIER.standard}`,
        '生图积分 8 折',
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
      genDiscount: '7折',
      features: [
        `积分：每日 ${DAILY_AMOUNT} 或一次性 ${LUMP_BY_TIER.pro}`,
        '生图积分 7 折',
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
    serverTrial = { canClaimFree: false, trialFreeUsed: true, phoneVerified: false };
    refreshOfferUI();
  }

  function applyServerState(me) {
    if (!me || typeof me !== 'object') return;
    if (me.creditGrantMode === 'daily' || me.creditGrantMode === 'bundle') {
      serverCreditMode = me.creditGrantMode;
      try {
        localStorage.setItem(LS_CREDIT_MODE, serverCreditMode);
      } catch (e) { /* ignore */ }
    }
    if (me.trial) {
      serverTrial = {
        canClaimFree: !!me.trial.canClaimFree,
        trialFreeUsed: !!me.trialFreeUsed,
        phoneVerified: !!me.phoneVerified
      };
    } else {
      serverTrial.phoneVerified = !!me.phoneVerified;
      serverTrial.trialFreeUsed = !!me.trialFreeUsed;
    }
    refreshOfferUI();
  }

  function refreshOfferUI() {
    updateSubscribeNavBadge();
    renderTrialBar();
    renderCreditModePicker();
    renderFirstOfferBanner();
    const overlay = document.getElementById('subscribeOverlay');
    if (overlay?.classList.contains('active')) renderPlans();
  }

  function updateSubscribeNavBadge() {
    const badge = document.querySelector('.app-nav-subscribe-badge');
    if (!badge) return;
    if (isLoggedIn() && serverTrial.canClaimFree) {
      badge.textContent = '免费试用';
      return;
    }
    if (!hasUsedFirstOffer()) {
      badge.textContent = '¥1.9续杯';
      return;
    }
    badge.textContent = '会员';
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

  function renderTrialBar() {
    const el = document.getElementById('subscribeTrialBar');
    if (!el) return;
    const parts = [];
    if (isLoggedIn() && serverTrial.canClaimFree) {
      parts.push(`
        <div class="subscribe-trial-block">
          <p><strong>3 天免费试用</strong> · 每日 ${DAILY_AMOUNT} 积分（当日有效，需绑定手机）</p>
          <button type="button" class="btn btn-secondary btn-sm" id="subscribeTrialFreeBtn">领取试用</button>
        </div>`);
    }
    if (!hasUsedFirstOffer()) {
      parts.push(`
        <div class="subscribe-trial-block subscribe-trial-starter">
          <p><strong>¥1.9 续杯 14 天</strong> 基础会员 · 淘宝购码后在「图片生成」兑换 <code>STARTER-19-14D</code></p>
        </div>`);
    }
    if (!parts.length) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = parts.join('');
    el.querySelector('#subscribeTrialFreeBtn')?.addEventListener('click', onClaimFreeTrial);
  }

  async function onClaimFreeTrial() {
    if (!isLoggedIn()) {
      if (typeof showToast === 'function') showToast('请先登录');
      return;
    }
    if (!serverTrial.phoneVerified) {
      const msg =
        '请先绑定并验证手机号（Supabase 控制台开启 Phone Auth，或在账号设置中绑定）';
      if (typeof showToast === 'function') showToast(msg);
      else alert(msg);
      return;
    }
    const r = await window.PromptHubApi?.claimFreeTrial?.();
    if (r?.ok) {
      if (typeof showToast === 'function') showToast(r.data.message || '试用已开通');
      await window.PromptHubApi?.syncMe?.({ silent: true });
      refreshOfferUI();
      return;
    }
    const hint =
      r?.code === 'PHONE_REQUIRED'
        ? '（需先绑定手机）'
        : r?.code === 'TRIAL_USED'
          ? '（每人仅限一次）'
          : '';
    if (typeof showToast === 'function') showToast((r?.message || '领取失败') + hint);
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
          <span>每日 ${DAILY_AMOUNT} 积分</span>
          <small>当日有效，不用作废</small>
        </label>
        <label class="subscribe-credit-mode-opt${mode === 'bundle' ? ' active' : ''}">
          <input type="radio" name="creditGrantMode" value="bundle"${mode === 'bundle' ? ' checked' : ''}>
          <span>一次性到账</span>
          <small>基础 100 / 标准 310 / 专业 1000，永久有效</small>
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

  function renderFirstOfferBanner() {
    const el = document.getElementById('subscribeFirstOffer');
    if (!el) return;
    el.classList.add('hidden');
  }

  function renderPlans() {
    const grid = document.getElementById('subscribePlansGrid');
    if (!grid) return;
    renderTrialBar();
    renderCreditModePicker();
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
            ? `每日 ${DAILY_AMOUNT} 积分（当日有效）`
            : `一次性 ${LUMP_BY_TIER[planId] || 100} 积分（永久）`;
        const msg = `「${plan.name}」${BILLING_LABELS[billing]} ¥${price.price}，${modeLabel} — 在线支付筹备中，请用淘宝激活码在「图片生成」页兑换`;
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
    if (isLoggedIn()) void window.PromptHubApi?.syncMe?.({ silent: true });
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
    getCreditGrantMode,
    setCreditGrantModeLocal,
    setFirstOfferUsedFromServer,
    resetFirstOfferServerState,
    applyServerState,
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
