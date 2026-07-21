/**
 * 会员订阅：轻量 + 三档 · 每日/一次性积分
 */
(function () {
  const LS_CREDIT_MODE = 'promptrepo_credit_grant_mode';
  /** 备案审查期间 true：页内不展示 ¥ 标价 */
  const FILING_REVIEW_MODE = false;
  /** 学习展示模式（保留兼容开关，正式环境关闭） */
  const STUDY_DISPLAY_MODE = false;
  /** 会员计费方式（暂只开放单月购买） */
  const MEMBERSHIP_BILLING_OPTIONS = ['single_month'];

  function purchaseBtnLabel() {
    return showPublicPrices() ? '立即购买' : '暂不可购买';
  }

  const CREDITS_PER_YUAN = 100;
  const CREDIT_PACKS = [
    { id: 'points-10', price: 10, credits: 1000 },
    { id: 'points-20', price: 20, credits: 2000 },
    { id: 'points-50', price: 50, credits: 5000 },
    { id: 'points-100', price: 100, credits: 10000 },
    { id: 'points-200', price: 200, credits: 20000 },
    { id: 'points-500', price: 500, credits: 50000 }
  ].map((pack) => ({
    ...pack,
    label: `${pack.credits} 积分`
  }));

  let pendingPaymentProduct = null;
  let paymentReturnFocus = null;

  function getPaymentProduct(productId, creditGrantMode) {
    const creditPack = CREDIT_PACKS.find((pack) => pack.id === productId);
    if (creditPack) {
      return {
        productId,
        creditGrantMode: null,
        kind: 'credits',
        title: '积分充值',
        name: `${creditPack.credits.toLocaleString('zh-CN')} 积分`,
        price: creditPack.price,
        arrival: `到账 ${creditPack.credits.toLocaleString('zh-CN')} 积分`,
        bonus: '1 元 = 100 积分'
      };
    }

    const planId = productId.match(/^member-(lite|basic|standard|pro)-month$/)?.[1];
    const plan = planId === 'lite' ? LITE_PLAN : PLANS.find((item) => item.id === planId);
    const price = planId ? PRICES[planId]?.single_month?.price : null;
    if (!plan || !Number.isFinite(Number(price))) return null;
    const grantMode = planId === 'lite' ? 'daily' : (creditGrantMode === 'bundle' ? 'bundle' : 'daily');
    return {
      productId,
      creditGrantMode: grantMode,
      kind: 'membership',
      title: '会员开通',
      name: `${plan.name} · 1 个月`,
      price: Number(price),
      arrival: grantMode === 'bundle' ? '会员积分一次性到账' : '会员积分每日领取',
      bonus: '支付成功后会员权益自动生效'
    };
  }

  function renderPaymentSummary(product) {
    const target = document.getElementById('paymentMethodSummary');
    const title = document.getElementById('paymentMethodTitle');
    if (title) title.textContent = product.title;
    if (!target) return;
    target.innerHTML = `
      <div class="payment-summary-product">
        <span>${esc(product.name)}</span>
        <strong>¥${esc(formatPriceNum(product.price))}</strong>
      </div>
      <div class="payment-summary-arrival">
        <span>${esc(product.arrival)}</span>
        <small>${esc(product.bonus)}</small>
      </div>`;
  }

  function openPaymentMethod(product) {
    const overlay = document.getElementById('paymentMethodOverlay');
    if (!overlay) return;
    pendingPaymentProduct = product;
    paymentReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renderPaymentSummary(product);
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('payment-method-open');
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      overlay.querySelector('[data-payment-method]')?.focus();
    });
  }

  function closePaymentMethod() {
    const overlay = document.getElementById('paymentMethodOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('payment-method-open');
    window.setTimeout(() => {
      if (!overlay.classList.contains('active')) overlay.hidden = true;
    }, 180);
    pendingPaymentProduct = null;
    paymentReturnFocus?.focus?.();
    paymentReturnFocus = null;
  }

  function startDirectPayment(productId, creditGrantMode) {
    if (!isLoggedIn()) {
      window.showToast?.('请先登录后购买');
      window.openLoginModal?.();
      return;
    }
    const product = getPaymentProduct(productId, creditGrantMode);
    if (!product) {
      window.showToast?.('暂时无法读取商品信息，请刷新后重试');
      return;
    }
    openPaymentMethod(product);
  }

  async function submitDirectPayment(paymentMethod) {
    const product = pendingPaymentProduct;
    if (!product || paymentMethod !== 'alipay') return;
    const overlay = document.getElementById('paymentMethodOverlay');
    const buttons = Array.from(overlay?.querySelectorAll('[data-payment-method]') || []);
    buttons.forEach((button) => {
      button.disabled = true;
      button.classList.toggle('is-loading', button.dataset.paymentMethod === paymentMethod);
    });
    const result = await window.PromptHubApi?.createPaymentCheckout?.(
      product.productId,
      paymentMethod,
      product.creditGrantMode || undefined
    );
    if (!result?.ok || !result.data?.checkoutUrl) {
      window.showToast?.(result?.message || '创建支付订单失败，请稍后重试');
      buttons.forEach((button) => {
        button.disabled = false;
        button.classList.remove('is-loading');
      });
      return;
    }
    let checkoutUrl;
    try {
      checkoutUrl = new URL(String(result.data.checkoutUrl), window.location.href);
    } catch (error) {
      checkoutUrl = null;
    }
    if (!checkoutUrl || !['http:', 'https:'].includes(checkoutUrl.protocol)) {
      window.showToast?.('支付渠道返回了不兼容的付款地址，请稍后重试');
      buttons.forEach((button) => {
        button.disabled = false;
        button.classList.remove('is-loading');
      });
      return;
    }
    window.location.assign(checkoutUrl.href);
  }

  const DAILY_BY_TIER = { lite: 10, basic: 13, standard: 32, pro: 64 };
  const LUMP_BY_TIER = { basic: 130, standard: 320, pro: 700 };

  let serverCreditMode = 'daily';

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function getCreditGrantMode() {
    const picked = document.querySelector(
      '#subscribeCreditMode input[name="creditGrantMode"]:checked'
    );
    if (picked?.value === 'daily' || picked?.value === 'bundle') return picked.value;
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
    summary: '在免费每日 5 积分基础上额外 +5（共 10 积分/天）· 300MB+2GB · 置顶 3 张 · 仅每日领取'
  };

  const PLANS = [
    {
      id: 'basic',
      name: '基础版',
      tag: '入门',
      storage: '300MB+5GB',
      features: [
        '生图优先队列',
        `额外每日 ${DAILY_BY_TIER.basic} 积分或一次性 ${LUMP_BY_TIER.basic} 积分`,
        '无限置顶',
        '资产创作工作台',
        '300MB 基础 + 额外 5GB 云存储',
        '全站云同步',
        '可另建 2 个自命名卡片库'
      ]
    },
    {
      id: 'standard',
      name: '标准版',
      tag: '推荐',
      storage: '300MB+10GB',
      features: [
        '更高生图队列优先级',
        `额外每日 ${DAILY_BY_TIER.standard} 积分或一次性 ${LUMP_BY_TIER.standard} 积分`,
        '无限置顶',
        '资产创作工作台',
        '300MB 基础 + 额外 10GB 云存储',
        '可另建 3 个自命名卡片库'
      ]
    },
    {
      id: 'pro',
      name: '专业版',
      tag: '专业',
      storage: '300MB+30GB',
      features: [
        '最高生图队列优先级',
        `额外每日 ${DAILY_BY_TIER.pro} 积分或一次性 ${LUMP_BY_TIER.pro} 积分`,
        '无限置顶',
        '资产创作工作台',
        '300MB 基础 + 额外 30GB 云存储',
        '可另建 4 个自命名卡片库'
      ]
    }
  ];

  const PRICES = {
    lite: {
      auto_month: { price: 6, original: 9, unit: '月' },
      single_month: { price: 6, original: 9, unit: '月' },
      auto_year: { price: 58, original: 108, unit: '年' },
      single_year: { price: 88, original: null, unit: '年' }
    },
    basic: {
      auto_month: { price: 12.9, original: 15.9, unit: '月' },
      single_month: { price: 12.9, original: 15.9, unit: '月' },
      auto_year: { price: 129, original: 190, unit: '年' },
      single_year: { price: 169, original: null, unit: '年' }
    },
    standard: {
      auto_month: { price: 31.9, original: 39.9, unit: '月' },
      single_month: { price: 31.9, original: 39.9, unit: '月' },
      auto_year: { price: 319, original: 479, unit: '年' },
      single_year: { price: 399, original: null, unit: '年' }
    },
    pro: {
      auto_month: { price: 63.9, original: 69.9, unit: '月' },
      single_month: { price: 63.9, original: 69.9, unit: '月' },
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

  let currentBilling = 'single_month';
  let currentMainTab = 'membership';

  function showPublicPrices() {
    return !FILING_REVIEW_MODE;
  }

  function formatPriceNum(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    return Number.isInteger(x) ? String(x) : String(x);
  }

  function priceHtml(amount, unit) {
    if (!showPublicPrices()) {
      return '<span class="subscribe-plan-amount subscribe-plan-contact">联系咨询</span>';
    }
    const unitHtml = unit ? `<span class="subscribe-plan-unit">/${esc(unit)}</span>` : '';
    return `<span class="subscribe-plan-amount">¥${formatPriceNum(amount)}</span>${unitHtml}`;
  }

  /** 会员价：原价 + 折后价 */
  function priceDisplayBlock(price, original, unit) {
    if (!showPublicPrices()) {
      return '<span class="subscribe-plan-amount subscribe-plan-contact">联系咨询</span>';
    }
    const hasDiscount = original && Number(original) > Number(price);
    const originHtml = hasDiscount
      ? `<span class="subscribe-plan-price-origin"><span class="subscribe-plan-price-origin-label">原价</span> ¥${formatPriceNum(original)}</span>`
      : '';
    const saleLabel = hasDiscount
      ? '<span class="subscribe-plan-sale-label">折后价</span>'
      : '';
    const unitHtml = unit ? `<span class="subscribe-plan-unit">/${esc(unit)}</span>` : '';
    const mainLine = `<span class="subscribe-plan-price-main">${saleLabel}<span class="subscribe-plan-amount">¥${formatPriceNum(price)}</span>${unitHtml}</span>`;
    return `${originHtml}${mainLine}`;
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

  function refreshStudyDisplayUi() {
    const banner = document.getElementById('subscribeStudyBanner');
    if (banner) banner.hidden = !STUDY_DISPLAY_MODE;
    document.body.classList.toggle('subscribe-study-mode', STUDY_DISPLAY_MODE);
  }

  function refreshFilingUi() {
    const hide = !showPublicPrices();
    document.querySelectorAll('.imagegen-credits-rate-inline, .imagegen-credits-rate').forEach((el) => {
      el.classList.toggle('hidden', hide);
    });
    document.querySelectorAll('.imagegen-credits-note').forEach((el) => {
      if (!hide) return;
      el.textContent = '积分用于生图等功能；激活码兑换请点「充值」。';
    });
    document.body.classList.toggle('shop-filing-mode', hide);
    refreshStudyDisplayUi();
  }

  function refreshOfferUI() {
    renderMembershipStatus();
    updateSubscribeNavBadge();
    renderCreditModePicker();
    renderMiniOfferBar();
    refreshFilingUi();
    const overlay = document.getElementById('subscribeOverlay');
    if (overlay?.classList.contains('active')) {
      if (currentMainTab === 'credits') renderCreditPacks();
      else renderPlans();
    }
  }

  const NAV_MEMBER_BTN_LABELS = {
    lite: '轻量版会员',
    basic: '基础版会员',
    standard: '标准版会员',
    pro: '专业版会员'
  };

  function renderMembershipStatus() {
    const info = window.Membership?.getMembershipDisplay?.();
    const metaEl = document.getElementById('appNavSubscribeMeta');
    const textEl = document.getElementById('appNavSubscribeText');
    const btnEl = document.querySelector('.app-nav-subscribe-btn');
    const badgeEl = document.getElementById('appNavSubscribeBadge');
    const panelEl = document.getElementById('subscribeMembershipStatus');
    const loggedIn = window.SupabaseSync?.isLoggedIn?.();
    const storageSummary = loggedIn ? window.Membership?.getStorageSummaryLabel?.() : '';
    const storageLine = loggedIn
      ? (storageSummary ? `云存储 ${storageSummary}` : '云存储额度加载中…')
      : '';
    const storageHtml = storageLine
      ? `<span class="subscribe-membership-storage">${esc(storageLine)}</span>`
      : '';
    if (!info) return;
    if (textEl) {
      textEl.textContent = info.active && info.tier
        ? (NAV_MEMBER_BTN_LABELS[info.tier] || '会员')
        : '会员';
    }
    if (btnEl) {
      btnEl.classList.toggle('is-member', !!info.active);
      ['lite', 'basic', 'standard', 'pro'].forEach((t) => btnEl.classList.remove(`is-member-${t}`));
      if (info.active && info.tier) btnEl.classList.add(`is-member-${info.tier}`);
    }
    if (badgeEl) badgeEl.hidden = !!info.active;
    if (metaEl) {
      if (info.active) {
        metaEl.hidden = true;
        metaEl.textContent = '';
        metaEl.className = 'app-nav-subscribe-meta';
      } else {
        metaEl.hidden = false;
        metaEl.textContent = info.summary;
        metaEl.className = 'app-nav-subscribe-meta';
      }
    }
    if (panelEl) {
      panelEl.hidden = false;
      if (info.active) {
        const tierCls = info.tier ? ` subscribe-tier-${info.tier}` : '';
        panelEl.innerHTML = `<div class="subscribe-membership-status is-active${tierCls}"><span class="subscribe-membership-tier">${esc(info.tierLabel)}</span><span class="subscribe-membership-until">${esc(info.untilLabel)}</span>${storageHtml}</div>`;
      } else {
        panelEl.innerHTML = `<div class="subscribe-membership-status"><span class="subscribe-membership-tier">普通用户</span><span class="subscribe-membership-until">免费 · 每日 5 积分</span>${storageHtml || '<span class="subscribe-membership-storage">云存储 300MB 基础额度</span>'}</div>`;
      }
    }
  }

  function updateSubscribeNavBadge() {
    const trialBadge = document.getElementById('appNavTaskBadge');
    const subBadge = document.getElementById('appNavSubscribeBadge');
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
      <p class="subscribe-credit-mode-label">选择会员积分领取方式（轻量会员固定每日领取）</p>
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
    const saveText = showPublicPrices() ? saveLabel(p.original, p.price) : '';
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
          ${saveBadge}
          ${priceDisplayBlock(p.price, p.original, p.unit)}
        </div>
      </div>
      <p class="subscribe-lite-meta">${esc(billingLabel)} · ${esc(LITE_PLAN.summary)}</p>
      <button type="button" class="btn btn-primary btn-sm subscribe-plan-btn subscribe-lite-buy" data-plan="lite" data-billing="${currentBilling}">${purchaseBtnLabel()}</button>
    </article>`;
    row.querySelector('.subscribe-plan-btn')?.addEventListener('click', () => {
      void startDirectPayment('member-lite-month', 'daily');
    });
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
        ? '1 元 = 100 积分 · 支付成功后自动到账'
        : '轻量特惠 + 三档会员 · 支持支付宝支付';
    }
    if (currentMainTab === 'credits') renderCreditPacks();
    else renderPlans();
  }

  function renderCreditPacks() {
    const grid = document.getElementById('subscribeCreditsGrid');
    if (!grid) return;
    grid.innerHTML = CREDIT_PACKS.map(p => {
      return `
      <article class="subscribe-shop-card">
        <div class="subscribe-shop-card-head">
          <span class="subscribe-shop-card-kicker">实付</span>
        </div>
        <div class="subscribe-shop-card-price">¥${p.price}</div>
        <p class="subscribe-shop-card-arrival">到账 <strong>${p.credits.toLocaleString('zh-CN')}</strong> 积分</p>
        <p class="subscribe-shop-card-meta">1 元 = ${CREDITS_PER_YUAN} 积分</p>
        <button type="button" class="btn btn-primary subscribe-shop-buy-btn" data-shop-buy="${esc(p.id)}">立即充值</button>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-shop-buy]').forEach(btn => {
      const pack = CREDIT_PACKS.find((x) => x.id === btn.dataset.shopBuy);
      btn.addEventListener('click', () => { if (pack) void startDirectPayment(pack.id); });
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
      const saveText = showPublicPrices() ? saveLabel(p.original, p.price) : '';
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
          ${priceDisplayBlock(p.price, p.original, p.unit)}
        </div>
        <ul class="subscribe-plan-features">${featHtml}</ul>
        <button type="button" class="btn btn-primary subscribe-plan-btn" data-plan="${plan.id}" data-billing="${currentBilling}">${purchaseBtnLabel()}</button>
      </article>`;
    }).join('');

    grid.querySelectorAll('.subscribe-plan-btn').forEach(btn => {
      const planId = btn.dataset.plan;
      const billing = btn.dataset.billing;
      const plan = PLANS.find((p) => p.id === planId);
      const billingLabel = BILLING_LABELS[billing] || '';
      btn.addEventListener('click', () => {
        if (!planId || billing !== 'single_month') return;
        void startDirectPayment(`member-${planId}-month`, getCreditGrantMode());
      });
    });
  }

  function setBilling(mode) {
    if (!MEMBERSHIP_BILLING_OPTIONS.includes(mode)) mode = MEMBERSHIP_BILLING_OPTIONS[0] || 'single_month';
    currentBilling = mode;
    document.querySelectorAll('[data-subscribe-billing]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subscribeBilling === mode);
    });
    renderPlans();
    updateSubscribeNavBadge();
  }

  function initBillingTabs() {
    const tabs = document.getElementById('subscribeBillingTabs');
    if (!tabs) return;
    tabs.querySelectorAll('[data-subscribe-billing]').forEach((btn) => {
      const mode = btn.dataset.subscribeBilling || '';
      const allowed = MEMBERSHIP_BILLING_OPTIONS.includes(mode);
      btn.hidden = !allowed;
      btn.classList.toggle('active', mode === currentBilling);
    });
    tabs.hidden = MEMBERSHIP_BILLING_OPTIONS.length <= 1;
    if (!MEMBERSHIP_BILLING_OPTIONS.includes(currentBilling)) {
      currentBilling = MEMBERSHIP_BILLING_OPTIONS[0] || 'single_month';
    }
  }

  function ensureModalOverlaysOnBody() {
    ['trialTasksOverlay', 'subscribeOverlay', 'paymentMethodOverlay'].forEach((id) => {
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
    closePaymentMethod();
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
    initBillingTabs();
    document.querySelectorAll('[data-subscribe-main]').forEach(btn => {
      btn.addEventListener('click', () => setMainTab(btn.dataset.subscribeMain));
    });
    document.querySelectorAll('[data-subscribe-billing]').forEach(btn => {
      btn.addEventListener('click', () => setBilling(btn.dataset.subscribeBilling));
    });
    const overlay = document.getElementById('subscribeOverlay');
    const paymentOverlay = document.getElementById('paymentMethodOverlay');
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
    paymentOverlay?.querySelector('.payment-method-sheet')?.addEventListener('click', (e) => e.stopPropagation());
    paymentOverlay?.addEventListener('click', (e) => {
      if (e.target === paymentOverlay) closePaymentMethod();
    });
    document.getElementById('paymentMethodCloseBtn')?.addEventListener('click', closePaymentMethod);
    paymentOverlay?.querySelectorAll('[data-payment-method]').forEach((button) => {
      button.addEventListener('click', () => void submitDirectPayment(button.dataset.paymentMethod));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (paymentOverlay?.classList.contains('active')) closePaymentMethod();
      else if (overlay?.classList.contains('active')) closeSubscribePanel();
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
    isFilingReviewMode: () => FILING_REVIEW_MODE,
    isStudyDisplayMode: () => STUDY_DISPLAY_MODE,
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
