/**
 * 免费试用会员 · 任务中心
 */
(function () {
  const LS_PWA_FLAG = 'promptrepo_pwa_task_flag';
  const LS_ASSET_STUDIO_LINK = 'promptrepo_task_asset_studio_link';
  const LS_INSPIRE_DRAW = 'promptrepo_inspire_draw_used';
  const LS_GACHA_COLLECT = 'promptrepo_gacha_collect_used';
  const LS_PENDING_INVITE = 'promptrepo_pending_invite';
  let syncDebounceTimer = null;
  let syncInflight = null;
  let panelBound = false;
  let lastTaskSyncAt = 0;
  const TASK_SYNC_MIN_GAP_MS = 180000;
  let tasksLoadSerial = null;
  let cachedTaskList = null;

  function applyClaimResultToAccount(data) {
    if (data?.membership && window.Membership?.applyServerState) {
      window.Membership.applyServerState(data.membership);
    }
    if (typeof data?.creditsSpendable === 'number' && window.PointsSystem?.setCreditsFromServer) {
      window.PointsSystem.setCreditsFromServer(data.creditsSpendable, {
        permanent: data.creditsPermanent,
        daily: data.dailyCredits,
        mode: data.creditGrantMode,
        note: data.dailyCreditsNote
      });
    }
    window.PointsSystem?.updateCreditsUI?.();
    window.SubscriptionUI?.refreshOfferUI?.();
  }

  function markTaskClaimedOptimistic(taskKey) {
    if (!cachedTaskList) return;
    const hub = { ...(cachedTaskList.hub || {}) };
    if (hub.dailyBonus?.key === taskKey) {
      hub.dailyBonus = { ...hub.dailyBonus, claimed: true, ready: false };
    }
    if (hub.memberDaily?.key === taskKey) {
      hub.memberDaily = { ...hub.memberDaily, claimed: true, ready: false };
    }
    cachedTaskList = {
      ...cachedTaskList,
      hub,
      items: (cachedTaskList.items || []).map((t) =>
        t.key === taskKey ? { ...t, claimed: true, ready: false } : t
      )
    };
    renderTasks(cachedTaskList);
  }

  function isLoggedIn() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function countPendingTaskClaims(data) {
    if (!data || data.error) return { total: 0, memberDaily: false };
    let total = 0;
    if (data.hub?.dailyBonus?.ready && !data.hub?.dailyBonus?.claimed) total += 1;
    if (data.hub?.memberDaily?.ready && !data.hub?.memberDaily?.claimed) total += 1;
    for (const t of data.items || []) {
      if (t.ready && !t.claimed) total += 1;
    }
    return {
      total,
      memberDaily: !!(data.hub?.memberDaily?.ready && !data.hub?.memberDaily?.claimed)
    };
  }

  function updateTaskNavBadges(data) {
    const { total, memberDaily } = countPendingTaskClaims(data);
    const trialBadge = document.getElementById('appNavTaskBadge');
    const subBadge = document.getElementById('appNavSubscribeBadge');
    if (trialBadge) {
      trialBadge.textContent = total > 0 ? String(total) : '任务';
      trialBadge.classList.toggle('nav-badge-pending', total > 0);
    }
    if (subBadge) {
      subBadge.textContent = memberDaily ? '领取' : '五折';
      subBadge.classList.toggle('nav-badge-pending', memberDaily);
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatErrText(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      if (typeof v.message === 'string') return v.message;
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }

  function isHomescreenLaunch() {
    try {
      if (window.navigator.standalone === true) return true;
      const mq = window.matchMedia?.bind(window);
      if (mq) {
        if (mq('(display-mode: standalone)').matches) return true;
        if (mq('(display-mode: fullscreen)').matches) return true;
        if (mq('(display-mode: minimal-ui)').matches) return true;
      }
      if (/[?&]launch=homescreen\b/.test(location.search || '')) return true;
      if (/android-app:\/\//.test(document.referrer || '')) return true;
      if (localStorage.getItem(LS_PWA_FLAG) === '1') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function countSelfCreatedCards(cardList) {
    const collectTag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
    if (!Array.isArray(cardList)) return 0;
    return cardList.filter((c) => {
      if (!c || typeof c !== 'object') return false;
      if (c.favoritedFromPostId || c.communitySourceId) return false;
      if ((c.tags || []).includes(collectTag)) return false;
      if (c.customFields?.assetPackageId) return false;
      return true;
    }).length;
  }

  function collectSyncPayload() {
    const cards =
      window.__promptHubCards ||
      (typeof cards !== 'undefined' ? cards : []) ||
      [];
    let communityPosts = [];
    try {
      const raw = window.FeatureDraft?.getCommunityPostsForTasks?.() || [];
      communityPosts = raw.slice(0, 40).map((p) => ({
        prompt: String(p.prompt || p.title || '').slice(0, 800),
        title: String(p.title || '').slice(0, 200),
        image: p.image ? String(p.image).slice(0, 512) : null
      }));
    } catch (e) { /* ignore */ }
    const qp = window.__phQuickPreviewTask || {};
    let assetStudioLinkCard = false;
    let inspirationDrawUsed = false;
    let communityGachaCollectUsed = false;
    try {
      assetStudioLinkCard = localStorage.getItem(LS_ASSET_STUDIO_LINK) === '1';
      inspirationDrawUsed = localStorage.getItem(LS_INSPIRE_DRAW) === '1';
      communityGachaCollectUsed = localStorage.getItem(LS_GACHA_COLLECT) === '1';
    } catch (e) { /* ignore */ }
    return {
      cardsCount: countSelfCreatedCards(cards),
      communityPosts,
      pwaInstalled: isHomescreenLaunch(),
      quickPreviewWarehouseUsed: !!qp.warehouseUsed,
      quickPreviewWarehouseGotoGen: !!qp.warehouseGotoGen,
      quickPreviewCommunityUsed: !!qp.communityUsed,
      quickPreviewCommunityFavorited: !!qp.communityFavorited,
      assetStudioLinkCard,
      inspirationDrawUsed,
      communityGachaCollectUsed
    };
  }

  async function syncTaskProgress(force) {
    if (!isLoggedIn() || !window.PromptHubApi?.syncMembershipTasks) return null;
    if (window.PromptHubApi?.isApiUnreachable?.() || window.PromptHubApi?.isApiRateLimited?.()) return null;
    if (!force && Date.now() - lastTaskSyncAt < TASK_SYNC_MIN_GAP_MS) return null;
    if (syncInflight) return syncInflight;
    syncInflight = (async () => {
      try {
        const r = await window.PromptHubApi.syncMembershipTasks(collectSyncPayload());
        if (r?.ok) lastTaskSyncAt = Date.now();
        else if (r?.status === 429 || r?.code === 'RATE_LIMITED') {
          lastTaskSyncAt = Date.now() - TASK_SYNC_MIN_GAP_MS + 300000;
        }
        return r;
      } finally {
        syncInflight = null;
      }
    })();
    return syncInflight;
  }

  function scheduleSyncTaskProgress(force) {
    clearTimeout(syncDebounceTimer);
    if (force && Date.now() - lastTaskSyncAt < TASK_SYNC_MIN_GAP_MS) return;
    syncDebounceTimer = setTimeout(() => {
      void syncTaskProgress(!!force);
    }, force ? 400 : 3500);
  }

  async function diagnoseApiConnection() {
    const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
    const pageHref = typeof location !== 'undefined' ? location.href : '';
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      return {
        ok: false,
        hint:
          '当前是本地文件打开（地址栏以 file:// 开头），浏览器禁止访问 API。请用 https://prompt-hubs.com 打开本站。'
      };
    }
    const api = String(window.API_BASE_URL || '').replace(/\/$/, '');
    if (!api) {
      return {
        ok: false,
        hint: `未配置 API。当前页面：${pageOrigin || pageHref || '未知'}，请用 https://prompt-hubs.com 打开。`
      };
    }
    try {
      const r = await fetch(`${api}/health`, { method: 'GET', cache: 'no-store' });
      if (r.ok) return { ok: true, hint: '' };
      return {
        ok: false,
        hint: `API 返回 ${r.status}。页面来源：${pageOrigin || pageHref}`
      };
    } catch (e) {
      return {
        ok: false,
        hint:
          `浏览器拦住了对 ${api} 的请求（页面来源：${pageOrigin || '未知'}）。请确认用 https://prompt-hubs.com 打开；Edge 请关闭「跟踪防护」；或换 Chrome 并关闭广告拦截。`
      };
    }
  }

  function taskErrorText(v, fallback) {
    const t = formatErrText(v);
    if (!t || t === '[object Object]') return fallback || '任务加载失败，请稍后重试';
    return t;
  }

  async function loadTasks() {
    if (!isLoggedIn()) return { items: [], lifetimeCreditsSpent: 0, error: null };
    if (!window.PromptHubApi?.isConfigured?.()) {
      const host = typeof location !== 'undefined' ? location.hostname : '';
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: `当前页面（${host}）未配置 API。请用 https://prompt-hubs.com 打开，或在 api-domain.config.js 设置 CUSTOM_API_HOST。`
      };
    }
    let r;
    try {
      r = await window.PromptHubApi?.getMembershipTasks?.();
    } catch (e) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: taskErrorText(e, '任务接口请求异常'),
        retryable: true
      };
    }
    if (!r) {
      return { items: [], lifetimeCreditsSpent: 0, error: 'API 客户端未就绪', retryable: true };
    }
    if (r?.ok && r.data && Array.isArray(r.data.items)) {
      cachedTaskList = { ...r.data, error: null };
      return cachedTaskList;
    }
    if (r?.ok && r.data && !Array.isArray(r.data.items)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: formatErrText(r.data.error) || formatErrText(r.data.message) || '任务数据格式异常',
        retryable: true
      };
    }
    const msg =
      taskErrorText(r?.message, '') ||
      taskErrorText(r?.code, '') ||
      (r?.status ? `服务器错误 (${r.status})` : '') ||
      '任务列表加载失败';
    const detailHint = taskErrorText(r?.details, '');
    if (r?.code === 'TASKS_LOAD_FAILED' || r?.code === 'INTERNAL_ERROR') {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: msg || '任务接口服务器错误',
        errorDetail: detailHint || (r?.status ? `HTTP ${r.status}，请在 server 目录执行 npm run deploy 后重试` : ''),
        retryable: true
      };
    }
    if (r?.code === 'MIGRATION_REQUIRED' || /membership_task_claims_grants|membership_tasks\.sql/i.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error:
          '数据库任务表未就绪。请打开 Supabase → SQL Editor，依次运行 20260528120000_membership_tasks.sql 与 20260528120200_membership_task_claims_grants.sql'
      };
    }
    if (r?.code === 'NOT_FOUND' || /接口不存在/.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error:
          '会员任务接口未部署：请在 server 目录执行 npm run deploy（需已登录 Cloudflare）'
      };
    }
    if (r?.code === 'RATE_LIMITED' || /过于频繁|rate limit|too many/i.test(msg)) {
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: '请求过于频繁，请约 1 分钟后再试',
        retryable: true
      };
    }
    if (r?.code === 'UNAUTHORIZED' || /登录已过期|请先登录/.test(msg)) {
      return { items: [], lifetimeCreditsSpent: 0, error: 'session_expired', errorDetail: msg };
    }
    if (r?.code === 'NETWORK_ERROR' || /无法连接|failed to fetch|network|超时/i.test(msg)) {
      const diag = await diagnoseApiConnection();
      const api = String(window.API_BASE_URL || 'api.prompt-hubs.com').replace(/\/$/, '');
      const extra = diag.hint ? ` ${diag.hint}` : '';
      return {
        items: [],
        lifetimeCreditsSpent: 0,
        error: `连不上 ${api}。${extra}`.trim(),
        retryable: true
      };
    }
    return {
      items: [],
      lifetimeCreditsSpent: 0,
      error: msg,
      errorDetail: formatErrText(r?.details) || (r?.status ? `HTTP ${r.status}` : ''),
      retryable: true
    };
  }

    function isPhoneVerified(data) {
    return data?.hub?.phoneVerified === true || data?.phoneVerified === true;
  }

  let trialPhoneOtpCooldownTimer = null;
  const TRIAL_PHONE_UNAVAILABLE = '手机验证功能暂未开放，敬请期待';

  function isTrialPhoneBindEnabled() {
    return window.AUTH_PHONE_ENABLED === true;
  }

  function taskKeyNeedsPhone(taskKey) {
    return String(taskKey || '') === 'redeem_invite_code';
  }

  function phoneRequiredTip() {
    if (!isTrialPhoneBindEnabled()) {
      if (typeof showToast === 'function') showToast(TRIAL_PHONE_UNAVAILABLE, 5000);
      return;
    }
    if (typeof showToast === 'function') {
      showToast('填写邀请码须先绑定手机号', 5000);
    }
    openTrialPhoneBindForm();
  }

  function setTrialPhoneBindStatus(msg, kind) {
    const el = document.getElementById('trialHubPhoneBindStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }

  function openTrialPhoneBindForm() {
    if (!isTrialPhoneBindEnabled()) {
      setTrialPhoneBindStatus(TRIAL_PHONE_UNAVAILABLE, 'error');
      return;
    }
    const form = document.getElementById('trialHubPhoneBindForm');
    if (form) {
      form.classList.remove('hidden');
      document.getElementById('trialHubPhone')?.focus();
    }
  }

  function startTrialPhoneOtpCooldown(seconds) {
    const btn = document.getElementById('trialHubPhoneSendOtp');
    if (!btn) return;
    let left = seconds;
    btn.disabled = true;
    btn.textContent = left + 's';
    clearInterval(trialPhoneOtpCooldownTimer);
    trialPhoneOtpCooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(trialPhoneOtpCooldownTimer);
        trialPhoneOtpCooldownTimer = null;
        btn.disabled = false;
        btn.textContent = '获取验证码';
      } else {
        btn.textContent = left + 's';
      }
    }, 1000);
  }

  async function trialSendPhoneOtp() {
    if (!isLoggedIn()) {
      if (typeof openAuthModal === 'function') openAuthModal('login');
      return;
    }
    if (!isTrialPhoneBindEnabled()) {
      setTrialPhoneBindStatus(TRIAL_PHONE_UNAVAILABLE, 'error');
      return;
    }
    const phone = document.getElementById('trialHubPhone')?.value?.trim();
    if (!phone) {
      setTrialPhoneBindStatus('请输入 11 位手机号', 'error');
      return;
    }
    const btn = document.getElementById('trialHubPhoneSendOtp');
    try {
      if (btn) btn.disabled = true;
      setTrialPhoneBindStatus('发送中…');
      if (window.SupabaseSync?.sendPhoneOtpForBind) {
        await window.SupabaseSync.sendPhoneOtpForBind(phone);
      } else {
        await window.SupabaseSync.sendPhoneOtp(phone);
      }
      setTrialPhoneBindStatus('验证码已发送，请查收短信', 'ok');
      startTrialPhoneOtpCooldown(60);
      document.getElementById('trialHubPhoneOtp')?.focus();
    } catch (e) {
      setTrialPhoneBindStatus(e?.message || '发送失败', 'error');
      if (btn) btn.disabled = false;
    }
  }

  async function trialVerifyPhoneBind() {
    if (!isLoggedIn()) {
      if (typeof openAuthModal === 'function') openAuthModal('login');
      return;
    }
    if (!isTrialPhoneBindEnabled()) {
      setTrialPhoneBindStatus(TRIAL_PHONE_UNAVAILABLE, 'error');
      return;
    }
    const phone = document.getElementById('trialHubPhone')?.value?.trim();
    const otp = document.getElementById('trialHubPhoneOtp')?.value?.trim();
    if (!phone || !otp) {
      setTrialPhoneBindStatus('请输入手机号与 6 位验证码', 'error');
      return;
    }
    const btn = document.getElementById('trialHubPhoneVerify');
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '验证中…';
      }
      setTrialPhoneBindStatus('验证中…');
      if (window.SupabaseSync?.verifyPhoneOtpForBind) {
        await window.SupabaseSync.verifyPhoneOtpForBind(phone, otp);
      } else {
        await window.SupabaseSync.verifyPhoneOtp(phone, otp);
      }
      setTrialPhoneBindStatus('手机号已绑定', 'ok');
      if (typeof showToast === 'function') showToast('手机号绑定成功', 4000);
      void refreshTasksPanel();
    } catch (e) {
      setTrialPhoneBindStatus(e?.message || '验证失败', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '确认绑定';
      }
    }
  }

  function captureInviteFromUrl() {
    try {
      const inv = new URLSearchParams(location.search).get('invite');
      if (inv && inv.trim()) {
        localStorage.setItem(LS_PENDING_INVITE, inv.trim().toUpperCase());
      }
    } catch (e) { /* ignore */ }
  }

  function taskItemsWithoutDaily(items) {
    return (items || []).filter((t) => !String(t.key || '').startsWith('daily_bonus_'));
  }

  function renderTaskHub(hub) {
    const el = document.getElementById('trialTasksHub');
    if (!el) return;
    if (!hub) {
      el.innerHTML = '';
      return;
    }
    const phoneOk = hub.phoneVerified === true;
    const phoneBindEnabled = isTrialPhoneBindEnabled();
    const phoneNote = phoneOk
      ? ''
      : phoneBindEnabled
        ? `<div class="trial-hub-phone-block">
          <p class="trial-hub-note trial-hub-note-warn">填写邀请码须先绑定手机号</p>
          <button type="button" class="btn btn-primary btn-sm" id="trialHubPhoneBindOpen">绑定手机号</button>
          <div class="trial-hub-phone-form hidden" id="trialHubPhoneBindForm">
            <div class="trial-hub-phone-row-inputs">
              <input type="tel" class="trial-hub-phone-input" id="trialHubPhone" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel">
              <button type="button" class="btn btn-secondary btn-sm" id="trialHubPhoneSendOtp">获取验证码</button>
            </div>
            <div class="trial-hub-phone-row-inputs">
              <input type="text" class="trial-hub-phone-input" id="trialHubPhoneOtp" inputmode="numeric" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code">
              <button type="button" class="btn btn-primary btn-sm" id="trialHubPhoneVerify">确认绑定</button>
            </div>
            <p class="trial-hub-phone-status" id="trialHubPhoneBindStatus" aria-live="polite"></p>
          </div>
        </div>`
        : `<div class="trial-hub-phone-block">
          <p class="trial-hub-note trial-hub-note-warn">${esc(TRIAL_PHONE_UNAVAILABLE)}</p>
        </div>`;
    const dailyBtn = hub.dailyBonus?.claimed
      ? '<span class="trial-task-done">今日已领</span>'
      : '<button type="button" class="btn btn-primary btn-sm" id="trialHubDailyBtn">领取 5 积分</button>';
    const streakTip = hub.dailyBonus?.claimed
      ? `已连续签到 ${hub.signStreak || 0} 天 · 再领 ${hub.daysToStreakBonus || 7} 天额外 +10 积分`
      : `领取即签到 · 已连续 ${hub.signStreak || 0} 天 · 满 7 天额外 +10 积分`;
    const memberDaily = hub.memberDaily;
    const memberDailyRow = memberDaily
      ? `<div class="trial-hub-row">
          <div class="trial-hub-row-main">
            <strong>会员每日积分</strong>
            <p class="trial-hub-desc">按当前会员档位领取 ${memberDaily.amount || 0} 积分 · 可与上方每日 5 积分叠加 · 当日有效</p>
          </div>
          <div class="trial-hub-row-action">${
            memberDaily.claimed
              ? '<span class="trial-task-done">今日已领</span>'
              : `<button type="button" class="btn btn-primary btn-sm" id="trialHubMemberDailyBtn">领取 ${memberDaily.amount || 0} 积分</button>`
          }</div>
        </div>`
      : '';
    const inviteFilled = hub.referred === true;
    let pendingInvite = '';
    try {
      pendingInvite = localStorage.getItem(LS_PENDING_INVITE) || '';
    } catch (e) { /* ignore */ }
    const inviteInput = inviteFilled
      ? '<span class="trial-task-done">已填写邀请码</span>'
      : `<div class="trial-hub-invite-form">
          <input type="text" class="trial-hub-invite-input" id="trialHubInviteInput" placeholder="填写好友邀请码" value="${esc(pendingInvite)}" maxlength="32" autocomplete="off">
          <button type="button" class="btn btn-primary btn-sm" id="trialHubInviteSubmit">兑换</button>
        </div>
        ${phoneOk ? '' : phoneBindEnabled ? '<p class="trial-hub-desc">兑换前须先绑定手机号（见上方）</p>' : '<p class="trial-hub-desc">邀请码兑换待手机验证开放后可用</p>'}`;

    el.innerHTML = `
      <section class="trial-hub-block">
        <h4 class="trial-hub-title">每日福利</h4>
        <p class="trial-hub-desc">资产创作工作台<strong>限免</strong>开放（登录即可用，AI 对话与生图按积分计费）。</p>
        ${phoneNote}
        <div class="trial-hub-row">
          <div class="trial-hub-row-main">
            <strong>每日 5 积分</strong>
            <p class="trial-hub-desc">${esc(streakTip)} · 积分仅限当天使用</p>
          </div>
          <div class="trial-hub-row-action">${dailyBtn}</div>
        </div>
        ${memberDailyRow}
        <div class="trial-hub-row trial-hub-community-row">
          <div class="trial-hub-row-main">
            <strong>加入社群 · 领 100 积分</strong>
            <p class="trial-hub-desc trial-hub-desc-oneline">入群后联系管理员领取 100 积分。</p>
          </div>
        </div>
        <div class="trial-hub-link-row trial-hub-qq-row">
          <span class="trial-hub-label">QQ 群号</span>
          <code class="trial-hub-code">222653426</code>
          <button type="button" class="btn btn-ghost btn-sm" id="trialHubCopyQq">复制群号</button>
        </div>
      </section>
      <section class="trial-hub-block">
        <h4 class="trial-hub-title">邀请好友</h4>
        <p class="trial-hub-desc">好友注册并填写你的邀请码，双方各得 1 天基础会员 + 50 积分（须绑定手机号）</p>
        <div class="trial-hub-link-row">
          <span class="trial-hub-label">网站</span>
          <code class="trial-hub-code" id="trialHubSiteLink">${esc(hub.inviteLink || hub.siteUrl || '')}</code>
          <button type="button" class="btn btn-ghost btn-sm" id="trialHubCopyLink">复制链接</button>
        </div>
        <div class="trial-hub-link-row">
          <span class="trial-hub-label">我的邀请码</span>
          <code class="trial-hub-code" id="trialHubInviteCode">${esc(hub.inviteCode || '—')}</code>
          <button type="button" class="btn btn-ghost btn-sm" id="trialHubCopyCode">复制</button>
        </div>
        <div class="trial-hub-invite-task">
          <span class="trial-hub-label">填写邀请码</span>
          ${inviteInput}
        </div>
      </section>`;

    document.getElementById('trialHubDailyBtn')?.addEventListener('click', () => {
      void onClaim(hub.dailyBonus.key, document.getElementById('trialHubDailyBtn'));
    });
    document.getElementById('trialHubMemberDailyBtn')?.addEventListener('click', () => {
      void onClaim(hub.memberDaily.key, document.getElementById('trialHubMemberDailyBtn'));
    });
    document.getElementById('trialHubCopyLink')?.addEventListener('click', () => {
      void copyText(hub.inviteLink || hub.siteUrl || '', '已复制邀请链接');
    });
    document.getElementById('trialHubCopyCode')?.addEventListener('click', () => {
      void copyText(hub.inviteCode || '', '已复制邀请码');
    });
    document.getElementById('trialHubCopyQq')?.addEventListener('click', () => {
      if (typeof copyCommunityQqId === 'function') copyCommunityQqId();
      else void copyText('222653426', 'QQ 群号已复制');
    });
    document.getElementById('trialHubInviteSubmit')?.addEventListener('click', () => {
      if (!phoneOk) return phoneRequiredTip();
      const code = document.getElementById('trialHubInviteInput')?.value?.trim();
      void onRedeemInvite(code);
    });
    document.getElementById('trialHubPhoneBindOpen')?.addEventListener('click', () => {
      openTrialPhoneBindForm();
    });
    document.getElementById('trialHubPhoneSendOtp')?.addEventListener('click', () => {
      void trialSendPhoneOtp();
    });
    document.getElementById('trialHubPhoneVerify')?.addEventListener('click', () => {
      void trialVerifyPhoneBind();
    });
    document.getElementById('trialHubInviteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('trialHubInviteSubmit')?.click();
      }
    });
  }

  async function copyText(text, okMsg) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (typeof showToast === 'function') showToast(okMsg || '已复制');
    } catch (e) {
      if (typeof showToast === 'function') showToast('复制失败，请手动复制');
    }
  }

  async function onRedeemInvite(code) {
    if (!code) {
      if (typeof showToast === 'function') showToast('请输入邀请码');
      return;
    }
    const btn = document.getElementById('trialHubInviteSubmit');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '兑换中…';
    }
    const r = await window.PromptHubApi?.redeemInviteCode?.(code);
    if (r?.ok) {
      try {
        localStorage.removeItem(LS_PENDING_INVITE);
      } catch (e) { /* ignore */ }
      applyClaimResultToAccount(r.data || {});
      if (typeof showToast === 'function') showToast(r.data?.message || '邀请兑换成功', 6000);
      void refreshTasksPanel();
      return;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '兑换';
    }
    if (typeof showToast === 'function') {
      showToast(taskErrorText(r?.message, '邀请码兑换失败'));
    }
  }

  async function refreshTasksPanel() {
    const data = await loadTasks();
    cachedTaskList = data;
    renderTasks(data);
  }

  function sortTaskItems(items) {
    return [...items].sort((a, b) => {
      const rank = (t) => {
        if (t.claimed) return 3;
        if (t.kind === 'promo' || t.key === 'mini_99_membership') return 2;
        if (t.ready) return 0;
        return 1;
      };
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return String(a.key || '').localeCompare(String(b.key || ''));
    });
  }

  function renderTasks(data) {
    const list = document.getElementById('trialTasksList');
    const phoneHint = document.getElementById('trialTasksPhoneHint');
    if (phoneHint) {
      phoneHint.classList.toggle('hidden', true);
    }
    renderTaskHub(isLoggedIn() ? data?.hub : null);
    if (!list) return;
    const items = sortTaskItems(taskItemsWithoutDaily(data?.items || []));
    if (data?.error === 'session_expired') {
      list.innerHTML = `<p class="trial-tasks-empty">登录状态正在恢复中…若仍无法使用，请点「重新登录」（无需先退出，直接登录即可）。</p>
        <p class="trial-tasks-hint"><button type="button" class="btn btn-primary btn-sm" id="trialTasksReloginBtn">重新登录</button></p>`;
      document.getElementById('trialTasksReloginBtn')?.addEventListener('click', () => {
        void window.SupabaseSync?.healSessionOnResume?.().then((ok) => {
          if (ok) void openTrialTasksPanel();
          else {
            closeTrialTasksPanel();
            if (typeof openAuthModal === 'function') openAuthModal('login');
          }
        });
      }, { once: true });
      return;
    }
    if (data?.error) {
      const errText = taskErrorText(data.error, '任务加载失败，请稍后重试');
      const detail = data.errorDetail ? `<p class="trial-tasks-hint">${esc(formatErrText(data.errorDetail))}</p>` : '';
      const retryBtn = data.retryable
        ? '<p class="trial-tasks-hint"><button type="button" class="btn btn-secondary btn-sm" id="trialTasksRetryBtn">重试</button></p>'
        : '<p class="trial-tasks-hint">若提示迁移：在 Supabase SQL 编辑器执行 <code>20260528120000_membership_tasks.sql</code>。</p>';
      list.innerHTML = `<p class="trial-tasks-empty">${esc(errText)}</p>${detail}${retryBtn}`;
      document.getElementById('trialTasksRetryBtn')?.addEventListener('click', () => {
        void openTrialTasksPanel();
      });
      return;
    }
    if (!items.length) {
      list.innerHTML =
        '<p class="trial-tasks-empty">暂无任务数据，请稍后刷新或联系管理员检查后端。</p>';
      return;
    }
    list.innerHTML = items
      .map((task) => {
        const tierLabel = {
          lite: '轻量版',
          basic: '基础版',
          standard: '标准版',
          pro: '专业版'
        };
        const reward = [
          task.rewardDays
            ? `${task.rewardDays} 天${tierLabel[task.rewardTier] || '基础版'}会员（直接到账）`
            : '',
          task.rewardCredits ? `${task.rewardCredits} 积分` : ''
        ]
          .filter(Boolean)
          .join(' + ');
        const claimLabel =
          task.rewardDays && task.rewardCredits
            ? '领取奖励'
            : task.rewardCredits && !task.rewardDays
              ? '领取积分'
              : '领取会员';
        const btn = task.claimed
          ? '<span class="trial-task-done">已领取</span>'
          : task.kind === 'promo'
            ? `<button type="button" class="btn btn-secondary btn-sm trial-task-promo" data-promo="${esc(task.key)}">去兑换</button>`
            : task.ready
              ? `<button type="button" class="btn btn-primary btn-sm trial-task-claim" data-task-key="${esc(task.key)}">${claimLabel}</button>`
              : '<span class="trial-task-pending">未完成</span>';
        const progress = task.progress
          ? `<span class="trial-task-progress">${esc(task.progress)}</span>`
          : '';
        return `<article class="trial-task-card${task.claimed ? ' is-claimed' : ''}${task.ready ? ' is-ready' : ''}">
          <div class="trial-task-main">
            <h4>${esc(task.title)}</h4>
            <p>${esc(task.description)}</p>
            <p class="trial-task-reward">奖励：${esc(reward || '会员时长')}</p>
            ${progress}
          </div>
          <div class="trial-task-action">${btn}</div>
        </article>`;
      })
      .join('');

    list.querySelectorAll('.trial-task-claim').forEach((btn) => {
      btn.addEventListener('click', () => void onClaim(btn.dataset.taskKey, btn));
    });
    list.querySelectorAll('.trial-task-promo').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeTrialTasksPanel();
        if (typeof switchAppPage === 'function') switchAppPage('imagegen');
        if (typeof showToast === 'function') {
          showToast('请前往生图页「兑换」，输入淘宝购买的激活码', 5000);
        }
      });
    });
    updateTaskNavBadges(data);
  }

  async function onClaim(taskKey, btnEl) {
    if (!taskKey) return;
    if (!isLoggedIn()) {
      if (typeof showToast === 'function') showToast('请先登录');
      if (typeof openAuthModal === 'function') openAuthModal('login');
      return;
    }
    if (taskKeyNeedsPhone(taskKey) && cachedTaskList && !isPhoneVerified(cachedTaskList)) {
      phoneRequiredTip();
      return;
    }
    const btn = btnEl || document.querySelector(`.trial-task-claim[data-task-key="${taskKey}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '领取中…';
    }
    const r = await window.PromptHubApi?.claimMembershipTask?.(taskKey);
    if (r?.ok) {
      const msg = r.data?.message || '领取成功！会员天数已到账';
      applyClaimResultToAccount(r.data || {});
      markTaskClaimedOptimistic(taskKey);
      if (btn) btn.outerHTML = '<span class="trial-task-done">已领取</span>';
      if (typeof window.showAchievementToast === 'function') {
        window.showAchievementToast(`🎉 ${msg}`);
      } else if (typeof showToast === 'function') {
        showToast(`🎉 ${msg}`, 5200);
      }
      void window.PromptHubApi?.syncMe?.({ silent: true });
      void loadTasks().then((data) => {
        cachedTaskList = data;
        renderTasks(data);
      });
      return;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.taskKey?.startsWith('daily_bonus_') ? '领取积分' : '领取奖励';
    }
    if (typeof showToast === 'function') {
      let tip =
        taskErrorText(r?.message) ||
        taskErrorText(r?.details) ||
        (r?.code === 'PHONE_REQUIRED'
          ? '领取任务奖励前须先绑定手机号'
          : r?.code === 'NOT_READY'
          ? '请先打开任务中心刷新进度后再领取（电脑登录会自动标记）'
          : r?.code === 'MIGRATION_REQUIRED'
            ? '数据库缺少领取权限：请在 Supabase SQL Editor 运行 20260528120200_membership_task_claims_grants.sql'
            : r?.code === 'CLAIM_FAILED'
              ? `领取失败：${taskErrorText(r?.details, r?.message || '服务器错误')}`
              : '领取失败');
      if (/permission denied.*membership_task_claims/i.test(tip)) {
        tip = '数据库缺少领取权限：请在 Supabase SQL Editor 运行 20260528120200_membership_task_claims_grants.sql';
      }
      showToast(tip);
    }
  }

  function markPwaInstalled() {
    try {
      localStorage.setItem(LS_PWA_FLAG, '1');
    } catch (e) { /* ignore */ }
    if (isLoggedIn()) void syncTaskProgress(true);
  }

  function onAuthReady() {
    if (isHomescreenLaunch()) markPwaInstalled();
    else if (localStorage.getItem(LS_PWA_FLAG) === '1') void syncTaskProgress(true);
    if (isLoggedIn()) {
      void loadTasks().then((data) => {
        cachedTaskList = data;
        updateTaskNavBadges(data);
      });
    }
  }

  function closeTrialTasksPanel() {
    if (window.AppModalHub) {
      window.AppModalHub.close('trialTasksOverlay');
      return;
    }
    const el = document.getElementById('trialTasksOverlay');
    if (el) {
      el.classList.remove('active');
      el.hidden = true;
    }
    document.body.classList.remove('trial-tasks-open', 'app-modal-open');
  }

  async function openTrialTasksPanel() {
    window.MobileUI?.closeDrawers?.();
    const el = document.getElementById('trialTasksOverlay');
    if (!el) return;
    if (window.AppModalHub) window.AppModalHub.open('trialTasksOverlay');
    else {
      el.hidden = false;
      el.classList.add('active');
      document.body.classList.add('trial-tasks-open');
    }
    if (!isLoggedIn()) {
      renderTasks({ items: [] });
      document.getElementById('trialTasksLoginHint')?.classList.remove('hidden');
      return;
    }
    document.getElementById('trialTasksLoginHint')?.classList.add('hidden');
    if (window.TrialTasksUI?.isHomescreenLaunch?.()) {
      window.TrialTasksUI?.markPwaInstalled?.();
    }
    const list = document.getElementById('trialTasksList');
    if (list) list.innerHTML = '<p class="trial-tasks-empty">任务加载中…</p>';
    if (tasksLoadSerial) return tasksLoadSerial;
    tasksLoadSerial = (async () => {
      try {
        const data = await loadTasks();
        renderTasks(data);
        if (!data?.error && Date.now() - lastTaskSyncAt >= TASK_SYNC_MIN_GAP_MS) {
          void syncTaskProgress(true).then(async (sr) => {
            if (sr?.ok) renderTasks(await loadTasks());
          });
        }
      } catch (e) {
        renderTasks({
          items: [],
          lifetimeCreditsSpent: 0,
          error: taskErrorText(e, '任务加载失败'),
          retryable: true
        });
      } finally {
        tasksLoadSerial = null;
      }
    })();
    return tasksLoadSerial;
  }

  function bindTrialTasksPanel() {
    if (panelBound) return;
    panelBound = true;
    const overlay = document.getElementById('trialTasksOverlay');
    const panel = overlay?.querySelector('.trial-tasks-panel');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeTrialTasksPanel();
    });
    panel?.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('trialTasksCloseBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTrialTasksPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlay?.classList.contains('active')) closeTrialTasksPanel();
    });
  }

  function initPwaDetection() {
    if (isHomescreenLaunch()) markPwaInstalled();
    window.addEventListener('appinstalled', markPwaInstalled);
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
        if (isHomescreenLaunch()) markPwaInstalled();
      });
    } catch (e) { /* ignore */ }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isHomescreenLaunch()) markPwaInstalled();
    });
  }

  window.TrialTasksUI = {
    open: openTrialTasksPanel,
    close: closeTrialTasksPanel,
    syncTaskProgress: scheduleSyncTaskProgress,
    markPwaInstalled,
    onAuthReady,
    isHomescreenLaunch
  };
  window.openTrialTasksPanel = openTrialTasksPanel;
  window.closeTrialTasksPanel = closeTrialTasksPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      captureInviteFromUrl();
      bindTrialTasksPanel();
      initPwaDetection();
    });
  } else {
    captureInviteFromUrl();
    bindTrialTasksPanel();
    initPwaDetection();
  }
})();
