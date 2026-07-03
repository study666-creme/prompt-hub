/**
 * 会员状态、档位与置顶配额（本地 + 云同步 account 字段）
 */
(function () {
  const LS_MEMBERSHIP = 'promptrepo_membership';
  const PIN_LIMIT_FREE = 2;
  const PIN_LIMIT_LITE = 3;
  /** 登录用户基础云存储 300MB（与 server storage-quota.ts 一致） */
  const FREE_BASE_STORAGE_BYTES = 300 * 1024 * 1024;
  const TIER_EXTRA_STORAGE_BYTES = {
    lite: 2 * 1024 * 1024 * 1024,
    basic: 5 * 1024 * 1024 * 1024,
    standard: 10 * 1024 * 1024 * 1024,
    pro: 30 * 1024 * 1024 * 1024
  };
  let storageState = {
    usedBytes: 0,
    quotaBytes: FREE_BASE_STORAGE_BYTES,
    remainingBytes: FREE_BASE_STORAGE_BYTES,
    summaryLabel: '',
    percentUsed: 0
  };

  /** 会员生图积分折扣（乘数） */
  const GEN_DISCOUNT_BY_TIER = {
    basic: 0.95,
    standard: 0.9,
    pro: 0.85
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

  /** 生图页「最近生成」条数上限（超出时删最旧，即使未满 7 天） */
  const RECENT_CREATIONS_LIMIT = {
    free: 100,
    lite: 150,
    basic: 200,
    standard: 300,
    pro: 400
  };

  function getRecentCreationsLimit() {
    const tier = getMemberTier();
    if (tier === 'pro') return RECENT_CREATIONS_LIMIT.pro;
    if (tier === 'standard') return RECENT_CREATIONS_LIMIT.standard;
    if (tier === 'basic') return RECENT_CREATIONS_LIMIT.basic;
    if (tier === 'lite') return RECENT_CREATIONS_LIMIT.lite;
    return RECENT_CREATIONS_LIMIT.free;
  }

  function getGenDiscountMultiplier() {
    return 1;
  }

  function getGenDiscountLabel() {
    return '';
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

  function formatStorageShort(bytes) {
    const v = Math.max(0, Number(bytes) || 0);
    if (v < 1024 * 1024) return `${Math.round(v / 1024)} KB`;
    if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(v >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatStorageQuotaDisplay(bytes) {
    const v = Math.max(0, Number(bytes) || 0);
    if (v >= 50 * 1024 * 1024) {
      return `${Math.round(v / (1024 * 1024)).toLocaleString('zh-CN')} MB`;
    }
    return formatStorageShort(v);
  }

  function refreshQuotaFromTier() {
    const q = computeQuotaBytesLocal();
    storageState.quotaBytes = q;
    storageState.remainingBytes = Math.max(0, q - (storageState.usedBytes || 0));
    storageState.summaryLabel = '';
    storageState.percentUsed = q
      ? Math.min(100, Math.round(((storageState.usedBytes || 0) / q) * 1000) / 10)
      : 0;
  }

  function computeQuotaBytesLocal() {
    let q = FREE_BASE_STORAGE_BYTES;
    const tier = getMemberTier();
    if (tier && TIER_EXTRA_STORAGE_BYTES[tier]) q += TIER_EXTRA_STORAGE_BYTES[tier];
    return q;
  }

  function applyStorageState(storage) {
    if (!storage || typeof storage !== 'object') return;
    const tierQuota = computeQuotaBytesLocal();
    storageState = {
      usedBytes: Math.max(0, Number(storage.usedBytes) || 0),
      quotaBytes: Math.max(tierQuota, FREE_BASE_STORAGE_BYTES, Number(storage.quotaBytes) || 0),
      remainingBytes: Math.max(0, Number(storage.remainingBytes) || 0),
      summaryLabel: '',
      percentUsed: Number(storage.percentUsed) || 0
    };
    if (!storageState.remainingBytes && storageState.quotaBytes) {
      storageState.remainingBytes = Math.max(0, storageState.quotaBytes - storageState.usedBytes);
    }
    if (typeof window.AuthGate?.updateGuestLimitUI === 'function') {
      window.AuthGate.updateGuestLimitUI();
    }
  }

  function getStorageUsedBytes() {
    return storageState.usedBytes || 0;
  }

  function getStorageQuotaBytes() {
    return storageState.quotaBytes || computeQuotaBytesLocal();
  }

  function getStorageRemainingBytes() {
    return Math.max(0, getStorageQuotaBytes() - getStorageUsedBytes());
  }

  function canAddStorageBytes(delta) {
    const add = Math.max(0, Number(delta) || 0);
    if (!add) return true;
    return getStorageUsedBytes() + add <= getStorageQuotaBytes();
  }

  function getStorageSummaryLabel() {
    return `${formatStorageShort(getStorageUsedBytes())} / ${formatStorageQuotaDisplay(getStorageQuotaBytes())}`;
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
        untilLabel: '每日 5 积分 · 云存储 300MB',
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
      refreshQuotaFromTier();
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
    storageState = {
      usedBytes: storageState.usedBytes,
      quotaBytes: FREE_BASE_STORAGE_BYTES,
      remainingBytes: Math.max(0, FREE_BASE_STORAGE_BYTES - (storageState.usedBytes || 0)),
      summaryLabel: '',
      percentUsed: 0
    };
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
    FREE_BASE_STORAGE_BYTES,
    TIER_EXTRA_STORAGE_BYTES,
    GEN_DISCOUNT_BY_TIER,
    isMember,
    getMemberTier,
    getRecentCreationsLimit,
    RECENT_CREATIONS_LIMIT,
    getGenDiscountMultiplier,
    getGenDiscountLabel,
    getPinLimit,
    isUnlimitedPins,
    applyStorageState,
    getStorageUsedBytes,
    getStorageQuotaBytes,
    getStorageRemainingBytes,
    getStorageSummaryLabel,
    canAddStorageBytes,
    formatStorageShort,
    formatStorageQuotaDisplay,
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
