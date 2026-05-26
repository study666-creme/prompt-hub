/**
 * 会员状态、档位与置顶配额（本地 + 云同步 account 字段）
 */
(function () {
  const LS_MEMBERSHIP = 'promptrepo_membership';
  const PIN_LIMIT_FREE = 2;
  const PIN_LIMIT_MEMBER = Infinity;

  /** tier: basic | standard | pro */
  const MEMBER_CODES = {
    'MEMBER-VIP': { tier: 'pro', days: null },
    'MEMBER-PRO': { tier: 'pro', days: null },
    'MEMBER-STD': { tier: 'standard', days: null },
    'MEMBER-BASIC': { tier: 'basic', days: null },
    'MEMBER-30D': { tier: 'basic', days: 30 }
  };

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
    if (!row || typeof row !== 'object') return { active: false, until: null, tier: null };
    return {
      active: !!row.active,
      until: row.until || null,
      tier: row.tier || null
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
      writeRow({ active: false, until: null, tier: null });
      return false;
    }
    return true;
  }

  function getMemberTier() {
    if (!isMember()) return null;
    const tier = readRow().tier;
    if (tier === 'basic' || tier === 'standard' || tier === 'pro') return tier;
    return 'basic';
  }

  function getGenDiscountMultiplier() {
    const tier = getMemberTier();
    if (!tier) return 1;
    return GEN_DISCOUNT_BY_TIER[tier] ?? 1;
  }

  function getGenDiscountLabel() {
    const tier = getMemberTier();
    if (!tier) return '';
    const map = { basic: '9折', standard: '8折', pro: '7折' };
    return map[tier] || '';
  }

  function getPinLimit() {
    return isMember() ? PIN_LIMIT_MEMBER : PIN_LIMIT_FREE;
  }

  function isUnlimitedPins() {
    return isMember();
  }

  function activateByCode(code) {
    const key = (code || '').trim().toUpperCase();
    const spec = MEMBER_CODES[key];
    if (!spec) return null;
    const until = spec.days == null ? null : Date.now() + spec.days * 86400000;
    writeRow({ active: true, until, tier: spec.tier });
    const tierName = { basic: '基础', standard: '标准', pro: '专业' }[spec.tier] || '会员';
    return {
      ok: true,
      msg: spec.days == null
        ? `已开通${tierName}会员（演示）`
        : `已开通${tierName}会员 ${spec.days} 天`
    };
  }

  function isMemberCode(code) {
    const key = (code || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(MEMBER_CODES, key);
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
        tier: membership.tier
      });
      if (typeof window.updateImageGenPricingUI === 'function') {
        window.updateImageGenPricingUI();
      }
      return;
    }
    writeRow({ active: false, until: null, tier: null });
    if (typeof window.updateImageGenPricingUI === 'function') {
      window.updateImageGenPricingUI();
    }
  }

  function onAccountSwitch() {}

  window.Membership = {
    PIN_LIMIT_FREE,
    PIN_LIMIT_MEMBER,
    GEN_DISCOUNT_BY_TIER,
    isMember,
    getMemberTier,
    getGenDiscountMultiplier,
    getGenDiscountLabel,
    getPinLimit,
    isUnlimitedPins,
    activateByCode,
    isMemberCode,
    getAccountPayload,
    syncFromPayload,
    applyServerState,
    onAccountSwitch
  };
})();
