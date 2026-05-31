/**
 * 积分系统：激活码兑换、点赞里程碑奖励、生图扣费
 * 汇率：1 元 = 100 积分（POINTS_PER_YUAN）
 */
(function () {
  const LS_CREDITS = 'promptrepo_credits';
  const LS_REDEEMED = 'promptrepo_redeemed_codes';
  const LS_MILESTONES = 'promptrepo_like_milestones';
  const LS_USER_MILESTONE_COUNTS = 'promptrepo_user_milestone_counts';
  const LS_POINTS_SCALE_DONE = 'promptrepo_points_scale_v10';

  /** 1 元人民币对应积分 */
  const POINTS_PER_YUAN = 100;
  /** 单次扣费最低积分（1 积分 = ¥0.01） */
  const MIN_CHARGE_POINTS = 1;

  const IMAGE_GEN_MODELS = {
    quanneng2: {
      id: 'quanneng2',
      label: '全能模型2',
      pricing: 'resolution',
      memberDiscount: true
    },
    jimeng: {
      id: 'jimeng',
      label: '集梦 Seedream',
      pricing: 'fixed',
      fixedCredits: 40
    }
  };

  /** 登录后积分以 Supabase profiles 为准（/api/v1/me 同步） */
  let serverCreditsKnown = false;
  let creditsBreakdown = { permanent: 0, daily: 0, mode: 'bundle', note: '' };

  /** 每用户可领取次数上限（每档里程碑） */
  const LIKE_MILESTONE_REWARDS = [
    { threshold: 1000, credits: 1000, maxClaimsPerUser: 2 },
    { threshold: 100, credits: 100, maxClaimsPerUser: 5 }
  ];

  const RESOLUTION_COST = { '1k': 10, '2k': 20, '4k': 40 };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJson(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function getCredits() {
    if (useApiForAccount() && serverCreditsKnown) {
      const n = Number(loadJson(LS_CREDITS, 0));
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    const n = Number(loadJson(LS_CREDITS, 0));
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function setCredits(n) {
    saveJson(LS_CREDITS, Math.max(0, Math.floor(n)));
    updateCreditsUI();
  }

  /** 服务端同步后的可用积分（含当日会员日积分） */
  function setCreditsFromServer(n, breakdown) {
    serverCreditsKnown = true;
    if (breakdown && typeof breakdown === 'object') {
      creditsBreakdown = {
        permanent: Number(breakdown.permanent) || 0,
        daily: Number(breakdown.daily) || 0,
        mode: breakdown.mode === 'daily' ? 'daily' : 'bundle',
        note: breakdown.note || ''
      };
    }
    setCredits(n);
  }

  function resetServerCreditsState() {
    serverCreditsKnown = false;
  }

  function useApiForAccount() {
    return window.PromptHubApi?.isConfigured?.() && window.SupabaseSync?.isLoggedIn?.();
  }

  function addCredits(amount, reason) {
    if (!amount) return;
    setCredits(getCredits() + amount);
    if (reason && typeof showToast === 'function') showToast(reason);
  }

  function deductCredits(amount) {
    const cur = getCredits();
    if (cur < amount) return false;
    setCredits(cur - amount);
    return true;
  }

  function normalizeResolution(resolution) {
    const r = String(resolution || '1k').toLowerCase();
    return Object.prototype.hasOwnProperty.call(RESOLUTION_COST, r) ? r : '1k';
  }

  function getBaseResolutionCost(resolution) {
    return RESOLUTION_COST[normalizeResolution(resolution)];
  }

  function getMemberGenMultiplier() {
    return window.Membership?.getGenDiscountMultiplier?.() ?? 1;
  }

  function migrateLocalPointsScale() {
    try {
      if (localStorage.getItem(LS_POINTS_SCALE_DONE)) return;
      const raw = localStorage.getItem(LS_CREDITS);
      if (raw != null) {
        const n = Number(JSON.parse(raw));
        if (Number.isFinite(n) && n > 0) {
          localStorage.setItem(LS_CREDITS, JSON.stringify(Math.floor(n * 10)));
        }
      }
      localStorage.setItem(LS_POINTS_SCALE_DONE, '1');
    } catch (e) { /* ignore */ }
  }

  /** 会员折后积分（向下取整，至少 MIN_CHARGE_POINTS，与 server 一致） */
  function applyMemberDiscount(base, mult) {
    if (mult >= 1) return base;
    return Math.max(MIN_CHARGE_POINTS, Math.floor(base * mult));
  }

  function getImageGenModel(modelId) {
    const id = modelId || 'quanneng2';
    return IMAGE_GEN_MODELS[id] || IMAGE_GEN_MODELS.quanneng2;
  }

  function getImageGenCost(modelId, resolution) {
    return getImageGenCostDetail(modelId, resolution).final;
  }

  /** @returns {{ modelId, modelLabel, base, final, mult, label, saved, fixed }} */
  function getImageGenCostDetail(modelId, resolution) {
    const model = getImageGenModel(modelId);
    const res = normalizeResolution(resolution);

    const base =
      model.pricing === 'fixed' ? model.fixedCredits : getBaseResolutionCost(res);
    const mult = getMemberGenMultiplier();
    const final = applyMemberDiscount(base, mult);
    const label = window.Membership?.getGenDiscountLabel?.() || '';
    const saved = mult < 1 && final < base ? base - final : 0;
    return {
      modelId: model.id,
      modelLabel: model.label,
      base,
      final,
      mult,
      label,
      saved,
      fixed: model.pricing === 'fixed'
    };
  }

  /** @deprecated 使用 getImageGenCostDetail */
  function getResolutionCostDetail(resolution) {
    return getImageGenCostDetail('quanneng2', resolution);
  }

  function getResolutionCost(resolution) {
    return getImageGenCost('quanneng2', resolution);
  }

  function getRedeemedSet() {
    const arr = loadJson(LS_REDEEMED, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function saveRedeemed(set) {
    saveJson(LS_REDEEMED, [...set]);
  }

  async function redeemActivationCode(code) {
    const key = (code || '').trim().toUpperCase();
    if (!key) return { ok: false, msg: '请输入激活码' };

    if (!window.SupabaseSync?.isLoggedIn?.()) {
      return { ok: false, msg: '请先登录后再兑换' };
    }
    if (!window.PromptHubApi?.isConfigured?.()) {
      return { ok: false, msg: '后端 API 未连接，暂无法兑换（请检查网络或等待 api 域名生效）' };
    }

    const api = await window.PromptHubApi.redeem(key, {
      creditGrantMode: window.SubscriptionUI?.getCreditGrantMode?.() || 'daily'
    });
    if (api.ok) {
      if (typeof api.data.credits === 'number') {
        setCreditsFromServer(api.data.credits, {
          permanent: api.data.creditsPermanent,
          daily: api.data.dailyCredits,
          mode: api.data.creditGrantMode
        });
      }
      if (api.data.membershipTier && window.Membership?.applyServerState) {
        window.Membership.applyServerState({
          active: true,
          tier: api.data.membershipTier,
          until: api.data.membershipUntil,
          queuedTier: api.data.membershipQueuedTier || null,
          queuedUntil: api.data.membershipQueuedUntil || null
        });
      }
      updateCreditsUI();
      return { ok: true, msg: api.data.message || '兑换成功' };
    }
    const hint =
      api.code === 'INVALID_CODE'
        ? '（请使用淘宝发货的真实激活码，演示码已停用）'
        : api.code === 'DB_PERMISSION'
          ? '（请在 Supabase 执行 scripts/apply-grants-once.sql）'
          : api.code === 'NETWORK_ERROR'
            ? '（国内若打不开 workers.dev，需绑定 api.你的域名）'
            : api.code === 'API_NOT_CONFIGURED'
              ? '（未配置 API 地址）'
              : '';
    return { ok: false, msg: (api.message || '兑换失败') + hint };
  }

  function getClaimedMilestones(postId) {
    const all = loadJson(LS_MILESTONES, {});
    return Array.isArray(all[postId]) ? all[postId] : [];
  }

  function markMilestoneClaimed(postId, threshold) {
    const all = loadJson(LS_MILESTONES, {});
    const list = Array.isArray(all[postId]) ? all[postId] : [];
    if (!list.includes(threshold)) list.push(threshold);
    all[postId] = list;
    saveJson(LS_MILESTONES, all);
  }

  function getUserMilestoneCounts(userId) {
    const all = loadJson(LS_USER_MILESTONE_COUNTS, {});
    const row = all[userId];
    if (!row || typeof row !== 'object') return { 100: 0, 1000: 0 };
    return {
      100: Number(row[100]) || 0,
      1000: Number(row[1000]) || 0
    };
  }

  function incrementUserMilestoneCount(userId, threshold) {
    const all = loadJson(LS_USER_MILESTONE_COUNTS, {});
    const row = getUserMilestoneCounts(userId);
    row[threshold] = (row[threshold] || 0) + 1;
    all[userId] = row;
    saveJson(LS_USER_MILESTONE_COUNTS, all);
  }

  /** 自己的作品点赞达标时发放积分（每帖每档一次 + 每用户总次数上限） */
  async function onPostLikesUpdated(post, getActiveUser) {
    if (!post?.id || typeof getActiveUser !== 'function') return;
    const user = getActiveUser();
    if (!user?.id || user.id === 'guest' || post.authorId !== user.id) return;
    const likes = post.likes || 0;

    if (useApiForAccount()) {
      try {
        const api = await window.PromptHubApi.checkLikeMilestone(post.id, likes);
        if (api.ok && api.data?.granted) {
          if (typeof api.data.creditsRemaining === 'number') {
            setCreditsFromServer(api.data.creditsRemaining);
          }
          if (api.data.message && typeof showToast === 'function') {
            showToast(api.data.message);
          }
          return;
        }
        if (api.ok) return;
        if (api.code !== 'NETWORK_ERROR' && api.code !== 'API_NOT_CONFIGURED') return;
      } catch (e) { /* 回退本地 */ }
    }

    const claimedOnPost = getClaimedMilestones(post.id);
    const userCounts = getUserMilestoneCounts(user.id);

    for (const m of LIKE_MILESTONE_REWARDS) {
      if (likes < m.threshold) continue;
      if (claimedOnPost.includes(m.threshold)) continue;
      if (userCounts[m.threshold] >= m.maxClaimsPerUser) continue;
      markMilestoneClaimed(post.id, m.threshold);
      incrementUserMilestoneCount(user.id, m.threshold);
      addCredits(m.credits, `作品获 ${m.threshold} 赞，奖励 ${m.credits} 积分`);
      break;
    }
  }

  function updateCreditsUI() {
    const total = getCredits();
    document.querySelectorAll('[data-credits-display]').forEach(el => {
      el.textContent = String(total);
    });
    document.querySelectorAll('[data-credits-detail]').forEach(el => {
      if (creditsBreakdown.daily > 0) {
        el.textContent = `含今日 ${creditsBreakdown.daily}（当日有效）+ 永久 ${creditsBreakdown.permanent}`;
        el.classList.remove('hidden');
      } else if (creditsBreakdown.mode === 'daily' && creditsBreakdown.note) {
        el.textContent = creditsBreakdown.note;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
    if (typeof window.updateImageGenPricingUI === 'function') {
      window.updateImageGenPricingUI();
    }
  }

  async function refreshCreditsFromServer() {
    if (!useApiForAccount()) return;
    await window.PromptHubApi.syncMe({ silent: true });
  }

  function initCreditsUI() {
    migrateLocalPointsScale();
    updateCreditsUI();
    void refreshCreditsFromServer();
    document.getElementById('imageGenCreditsOpenBtn')?.addEventListener('click', () => {
      if (window.MobileUI?.isMobile?.()) openImageGenCreditsSheet();
      else if (typeof window.openRechargePanel === 'function') window.openRechargePanel();
      else openImageGenCreditsSheet();
    });
    document.getElementById('imageGenLedgerToggleBtn')?.addEventListener('click', () => {
      void showCreditLedger();
    });
  }

  function openImageGenCreditsSheet() {
    const overlay = document.getElementById('imageGenCreditsSheetOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.add('open');
    document.body.classList.add('imagegen-credits-sheet-open');
    void refreshCreditsFromServer();
    updateCreditsUI();
  }

  function closeImageGenCreditsSheet() {
    const overlay = document.getElementById('imageGenCreditsSheetOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.hidden = true;
    document.body.classList.remove('imagegen-credits-sheet-open');
    document.getElementById('creditLedgerPanelSheet')?.classList.add('hidden');
  }

  function formatLedgerTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  async function showCreditLedger() {
    const sheet = document.getElementById('imageGenCreditsSheetOverlay');
    const isMobileSheet = window.matchMedia('(max-width: 900px)').matches
      && sheet?.classList.contains('open');
    const panel = isMobileSheet
      ? document.getElementById('creditLedgerPanelSheet')
      : document.getElementById('creditLedgerPanel');
    if (!panel) return;
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      if (typeof showToast === 'function') showToast('请先登录后查看积分明细');
      return;
    }
    if (!panel.classList.contains('hidden') && panel.innerHTML && !panel.innerHTML.includes('加载中')) {
      panel.classList.add('hidden');
      return;
    }
    if (!window.PromptHubApi?.isConfigured?.()) {
      panel.classList.remove('hidden');
      panel.innerHTML = '<p class="credit-ledger-empty">未连接云端 API，当前为本地积分模式。</p>';
      return;
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<p class="credit-ledger-empty">加载中…</p>';
    const r = await window.PromptHubApi.getLedger(20);
    if (!r.ok) {
      panel.innerHTML = `<p class="credit-ledger-empty">${r.message || '加载失败'}</p>`;
      return;
    }
    const items = r.data?.items || [];
    if (!items.length) {
      panel.innerHTML = '<p class="credit-ledger-empty">暂无积分流水</p>';
      return;
    }
    panel.innerHTML = items.map(row => {
      const sign = row.delta >= 0 ? '+' : '';
      return `<div class="credit-ledger-row">
        <span class="credit-ledger-delta ${row.delta >= 0 ? 'plus' : 'minus'}">${sign}${row.delta}</span>
        <span class="credit-ledger-meta">${row.reasonLabel || row.reason} · 余额 ${row.balanceAfter}</span>
        <span class="credit-ledger-time">${formatLedgerTime(row.createdAt)}</span>
      </div>`;
    }).join('');
  }

  function toggleCreditLedger() {
    void showCreditLedger();
  }

  function showRechargePlaceholder() {
    if (typeof window.openRechargePanel === 'function') {
      window.openRechargePanel();
      return;
    }
    if (typeof window.openSubscribePanel === 'function') {
      window.openSubscribePanel();
      return;
    }
    const msg = '充值功能即将上线，敬请期待';
    if (typeof showToast === 'function') showToast(msg);
    else alert(msg);
  }

  window.PointsSystem = {
    getCredits,
    setCreditsFromServer,
    resetServerCreditsState,
    refreshCreditsFromServer,
    useApiForAccount,
    addCredits,
    deductCredits,
    getImageGenModel,
    getImageGenCost,
    getImageGenCostDetail,
    IMAGE_GEN_MODELS,
    getResolutionCost,
    getResolutionCostDetail,
    getBaseResolutionCost,
    normalizeResolution,
    redeemActivationCode,
    onPostLikesUpdated,
    updateCreditsUI,
    initCreditsUI,
    showRechargePlaceholder,
    POINTS_PER_YUAN,
    MIN_CHARGE_POINTS,
    RECHARGE_RATE: POINTS_PER_YUAN,
    LIKE_MILESTONE_REWARDS
  };

  window.showRechargePlaceholder = showRechargePlaceholder;
  window.showCreditLedger = showCreditLedger;
  window.openImageGenCreditsSheet = openImageGenCreditsSheet;
  window.closeImageGenCreditsSheet = closeImageGenCreditsSheet;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCreditsUI);
  } else {
    initCreditsUI();
  }
})();
