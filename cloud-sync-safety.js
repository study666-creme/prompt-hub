/**
 * 云同步安全：防止空数据覆盖、合并多端写入
 */
(function () {
  const SCHEMA_VERSION = 2;

  function cardCount(payload) {
    return Array.isArray(payload?.cards) ? payload.cards.length : 0;
  }

  function communityCount(payload) {
    const list = payload?.communityPosts;
    return Array.isArray(list) ? list.filter(p => p && !p.isMock).length : 0;
  }

  function creationsCount(payload) {
    return Array.isArray(payload?.creations) ? payload.creations.length : 0;
  }

  function byIdMerge(localList, cloudList, prefer) {
    const map = new Map();
    for (const item of cloudList || []) {
      if (item && item.id != null) map.set(String(item.id), item);
    }
    for (const item of localList || []) {
      if (!item || item.id == null) continue;
      const id = String(item.id);
      if (prefer === 'local' || !map.has(id)) map.set(id, item);
      else map.set(id, item);
    }
    return [...map.values()];
  }

  function mergePayload(local, cloud) {
    if (!cloud || typeof cloud !== 'object') {
      return { ...local, schemaVersion: SCHEMA_VERSION };
    }
    const merged = {
      schemaVersion: SCHEMA_VERSION,
      cards: byIdMerge(local.cards, cloud.cards, 'local'),
      customGroups:
        Array.isArray(local.customGroups) && local.customGroups.length
          ? local.customGroups
          : cloud.customGroups || [],
      globalFields:
        Array.isArray(local.globalFields) && local.globalFields.length
          ? local.globalFields
          : cloud.globalFields || [],
      settings: { ...(cloud.settings || {}), ...(local.settings || {}) },
      account: local.account || cloud.account || null,
      communityPosts: byIdMerge(
        (local.communityPosts || []).filter(p => !p.isMock),
        (cloud.communityPosts || []).filter(p => !p.isMock),
        'local'
      ),
      creations: byIdMerge(local.creations, cloud.creations, 'local'),
      communityLikes: [...new Set([...(cloud.communityLikes || []), ...(local.communityLikes || [])])],
      communityFavorites: [
        ...new Set([...(cloud.communityFavorites || []), ...(local.communityFavorites || [])])
      ]
    };
    return merged;
  }

  /**
   * @returns {{ allow: boolean, reason?: string, merged?: object }}
   */
  function validatePush(local, cloud) {
    const localCards = cardCount(local);
    const cloudCards = cardCount(cloud);
    const localComm = communityCount(local);
    const cloudComm = communityCount(cloud);
    const localCre = creationsCount(local);
    const cloudCre = creationsCount(cloud);

    if (localCards === 0 && cloudCards > 0) {
      return {
        allow: false,
        reason: `云端有 ${cloudCards} 张卡片，本地为空，已阻止上传以免覆盖云端数据`
      };
    }
    if (localComm === 0 && cloudComm > 0) {
      return {
        allow: false,
        reason: `云端有 ${cloudComm} 条社区记录，本地为空，已阻止上传`
      };
    }
    if (localCre === 0 && cloudCre > 0) {
      return {
        allow: false,
        reason: `云端有 ${cloudCre} 条创作记录，本地为空，已阻止上传`
      };
    }

    const merged = mergePayload(local, cloud || {});
    return { allow: true, merged };
  }

  window.CloudSyncSafety = {
    SCHEMA_VERSION,
    validatePush,
    mergePayload,
    cardCount,
    communityCount
  };
})();
