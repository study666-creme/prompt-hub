/**
 * 会员状态、档位与置顶配额（本地 + 云同步 account 字段）
 */
(function () {
  const LS_MEMBERSHIP = 'promptrepo_membership';
  const PIN_LIMIT_FREE = 2;
  const PIN_LIMIT_LITE = 3;
  const FREE_CARD_LIMIT = 100;

  /** 会员生图积分折扣（乘数） */
  const GEN_DISCOUNT_BY_TIER = {
    basic: 0.9,
    standard: 0.8,
    pro: 0.7
  };

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

  function accountKey() {
    const uid = window.SupabaseSync?.getUserId?.();
    return uid || 'guest';
  }

  function readRow() {
    const all = loadJson(LS_MEMBERSHIP, {});
    const row = all[accountKey()];
    if (!row || typeof row !== 'object') {
      return { active: false, until: null, tier: null, queuedTier: null, queuedUntil: null };
    }
    return {
      active: !!row.active,
      until: row.until || null,
      tier: row.tier || null,
      queuedTier: row.queuedTier || null,
      queuedUntil: row.queuedUntil || null
    };
  }

  function writeRow(row) {
    const all = loadJson(LS_MEMBERSHIP, {});
    all[accountKey()] = row;
    saveJson(LS_MEMBERSHIP, all);
  }

  function isMember() {
    const row = readRow();
    if (!row.active) return false;
    if (row.until && Date.now() > row.until) {
      if (row.queuedUntil && Date.now() < row.queuedUntil && row.queuedTier) {
        writeRow({
          active: true,
          until: row.queuedUntil,
          tier: row.queuedTier,
          queuedTier: null,
          queuedUntil: null
        });
        return true;
      }
      writeRow({ active: false, until: null, tier: null, queuedTier: null, queuedUntil: null });
      return false;
    }
    return true;
  }

  function getMemberTier() {
    if (!isMember()) return null;
    const tier = readRow().tier;
    if (tier === 'lite' || tier === 'basic' || tier === 'standard' || tier === 'pro') return tier;
    return 'basic';
  }

  function getGenDiscountMultiplier() {
    const tier = getMemberTier();
    if (!tier || tier === 'lite') return 1;
    return GEN_DISCOUNT_BY_TIER[tier] ?? 1;
  }

  function getGenDiscountLabel() {
    const tier = getMemberTier();
    if (!tier || tier === 'lite') return '';
    const map = { basic: '9折', standard: '8折', pro: '7折' };
    return map[tier] || '';
  }

  function getPinLimit() {
    const tier = getMemberTier();
    if (!tier) return PIN_LIMIT_FREE;
    if (tier === 'lite') return PIN_LIMIT_LITE;
    return Infinity;
  }

  function isUnlimitedPins() {
    const tier = getMemberTier();
    return tier === 'basic' || tier === 'standard' || tier === 'pro';
  }

  function getFreeCardLimit() {
    return isMember() ? Infinity : FREE_CARD_LIMIT;
  }

  function activateByCode() {
    return null;
  }

  function isMemberCode() {
    return false;
  }

  function getAccountPayload() {
    const row = readRow();
    return {
      isMember: isMember(),
      until: row.until || null,
      tier: getMemberTier()
    };
  }

  function syncFromPayload(account) {
    if (!account || typeof account !== 'object') return;
    if (account.isMember) {
      writeRow({
        active: true,
        until: account.until || null,
        tier: account.tier || 'basic'
      });
    }
  }

  function getMembershipDisplay() {
    if (!isMember()) {
      return {
        active: false,
        tierLabel: '普通用户',
        untilLabel: '每日 5 积分 · 100 张卡片',
        summary: '免费 · 每日 5 积分'
      };
    }
    const row = readRow();
    const tierLabels = {
      lite: '轻量会员',
      basic: '基础会员',
      standard: '标准会员',
      pro: '专业会员'
    };
    const tierLabel = tierLabels[row.tier] || '基础会员';
    let untilLabel = '长期有效';
    if (row.until) {
      const d = new Date(row.until);
      untilLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 到期`;
    }
    if (row.queuedTier && row.queuedUntil) {
      const qLabels = { lite: '轻量', basic: '基础', standard: '标准', pro: '专业' };
      const qd = new Date(row.queuedUntil);
      untilLabel += ` · 之后接续${qLabels[row.queuedTier] || '会员'}至 ${qd.getMonth() + 1}/${qd.getDate()}`;
    }
    return {
      active: true,
      tier: row.tier || 'basic',
      tierLabel,
      untilLabel,
      summary: `${tierLabel} · ${untilLabel}`
    };
  }

  /** 与 GET /api/v1/me 的 membership 字段对齐 */
  function applyServerState(membership) {
    if (!membership || typeof membership !== 'object') return;
    if (membership.active && membership.tier) {
      const untilMs = membership.until
        ? new Date(membership.until).getTime()
        : null;
      writeRow({
        active: true,
        until: untilMs,
        tier: membership.tier,
        queuedTier: membership.queuedTier || null,
        queuedUntil: membership.queuedUntil ? new Date(membership.queuedUntil).getTime() : null
      });
      if (typeof window.updateImageGenPricingUI === 'function') {
        window.updateImageGenPricingUI();
      }
      window.SubscriptionUI?.refreshOfferUI?.();
      if (typeof window.AuthGate?.updateGuestLimitUI === 'function') {
        window.AuthGate.updateGuestLimitUI();
      }
      window.ImageGenPromptTools?.updateQuotaUI?.();
      return;
    }
    writeRow({ active: false, until: null, tier: null, queuedTier: null, queuedUntil: null });
    if (typeof window.updateImageGenPricingUI === 'function') {
      window.updateImageGenPricingUI();
    }
    window.SubscriptionUI?.refreshOfferUI?.();
    if (typeof window.AuthGate?.updateGuestLimitUI === 'function') {
      window.AuthGate.updateGuestLimitUI();
    }
    window.ImageGenPromptTools?.updateQuotaUI?.();
  }

  function onAccountSwitch() {}

  function clearLocalState() {
    try {
      localStorage.removeItem(LS_MEMBERSHIP);
    } catch (e) { /* ignore */ }
    if (typeof window.updateImageGenPricingUI === 'function') {
      window.updateImageGenPricingUI();
    }
    window.SubscriptionUI?.refreshOfferUI?.();
  }

  window.Membership = {
    PIN_LIMIT_FREE,
    PIN_LIMIT_LITE,
    FREE_CARD_LIMIT,
    GEN_DISCOUNT_BY_TIER,
    isMember,
    getMemberTier,
    getGenDiscountMultiplier,
    getGenDiscountLabel,
    getPinLimit,
    isUnlimitedPins,
    getFreeCardLimit,
    activateByCode,
    isMemberCode,
    getAccountPayload,
    syncFromPayload,
    applyServerState,
    getMembershipDisplay,
    onAccountSwitch,
    clearLocalState
  };
})();
