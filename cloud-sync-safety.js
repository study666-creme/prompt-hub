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

  function filterTombstonedCreations(list, tombstones) {
    if (!tombstones || typeof tombstones !== 'object') return list || [];
    return (list || []).filter((c) => c && c.id != null && !tombstones[String(c.id)]);
  }

  function imagePresenceScore(image) {
    if (!image || typeof image !== 'string') return 0;
    if (image.startsWith('data:image/')) return 5;
    if (/^https?:\/\//i.test(image)) return 4;
    if (image.startsWith('blob:')) return 3;
    if (image.startsWith('storage://')) return 2;
    return 0;
  }

  function mergeImageField(base, a, b) {
    const hasA = !!(a && String(a).trim());
    const hasB = !!(b && String(b).trim());
    if (hasA && !hasB) {
      base.image = a;
      return base;
    }
    if (!hasA && hasB) {
      base.image = b;
      return base;
    }
    if (!hasA && !hasB) {
      base.image = null;
      return base;
    }
    const sa = imagePresenceScore(a);
    const sb = imagePresenceScore(b);
    if (sa > sb) base.image = a;
    else if (sb > sa) base.image = b;
    else base.image = a;
    return base;
  }

  /** 同 id 合并：文字取较新 updatedAt，图片优先保留「更有内容」的一方 */
  function mergePublishFlag(local, cloud, localTs, cloudTs) {
    if (local?.publishedToCommunity === false) return false;
    if (local?.publishedToCommunity === true) {
      if (cloud?.publishedToCommunity === false && cloudTs > localTs) return false;
      return true;
    }
    if (cloud?.publishedToCommunity === true) return true;
    if (cloud?.publishedToCommunity === false) return false;
    return false;
  }

  function cardGroupValue(c) {
    const g = c?.group;
    return g != null && g !== '' ? String(g) : '';
  }

  function mergeCardGroup(local, cloud, localTs, cloudTs) {
    const lg = cardGroupValue(local);
    const cg = cardGroupValue(cloud);
    if (lg && !cg) return lg;
    if (cg && !lg) return cg;
    if (lg && cg) return localTs >= cloudTs ? lg : cg;
    return null;
  }

  function mergeCardPair(local, cloud) {
    if (!local) return cloud;
    if (!cloud) return local;
    const localTs = local.updatedAt || local.createdAt || 0;
    const cloudTs = cloud.updatedAt || cloud.createdAt || 0;
    const base = cloudTs > localTs ? { ...local, ...cloud } : { ...cloud, ...local };
    const merged = mergeImageField(base, local.image, cloud.image);
    merged.group = mergeCardGroup(local, cloud, localTs, cloudTs);
    if (local.warehouseId && !cloud.warehouseId) merged.warehouseId = local.warehouseId;
    else if (cloud.warehouseId && !local.warehouseId) merged.warehouseId = cloud.warehouseId;
    else if (local.warehouseId && cloud.warehouseId && localTs !== cloudTs) {
      merged.warehouseId = localTs >= cloudTs ? local.warehouseId : cloud.warehouseId;
    }
    if (Array.isArray(local.tags) && local.tags.length && (!cloud.tags || !cloud.tags.length)) {
      merged.tags = local.tags;
    }
    merged.publishedToCommunity = mergePublishFlag(local, cloud, localTs, cloudTs);
    if (merged.publishedToCommunity) {
      merged.communityPostId = local.communityPostId || cloud.communityPostId || null;
    } else if (local.communityPostId && cloud.communityPostId && local.communityPostId !== cloud.communityPostId) {
      merged.communityPostId = cloudTs > localTs ? cloud.communityPostId : local.communityPostId;
    } else {
      merged.communityPostId = null;
    }
    return merged;
  }

  function mergeCreationPair(local, cloud) {
    if (!local) return cloud;
    if (!cloud) return local;
    const localTs = local.updatedAt || local.createdAt || 0;
    const cloudTs = cloud.updatedAt || cloud.createdAt || 0;
    const base = cloudTs > localTs ? { ...local, ...cloud } : { ...cloud, ...local };
    return mergeImageField(base, local.image, cloud.image);
  }

  function mergeCommunityPair(local, cloud) {
    return mergeCardPair(local, cloud);
  }

  function communityPostMergeKey(p) {
    if (!p || typeof p !== 'object') return '';
    if (p.sourceCardId) return `card:${p.sourceCardId}`;
    if (p.sourceCreationId) return `cre:${p.sourceCreationId}`;
    if (p.id != null) return `id:${p.id}`;
    return '';
  }

  function mergeCommunityPostsList(localList, cloudList) {
    const map = new Map();
    for (const item of [...(cloudList || []), ...(localList || [])]) {
      if (!item || item.isMock) continue;
      const key = communityPostMergeKey(item);
      if (!key) continue;
      const prev = map.get(key);
      map.set(key, prev ? mergeCommunityPair(prev, item) : item);
    }
    return [...map.values()];
  }

  function byIdMergeWithPair(localList, cloudList, mergePair, tombstones) {
    const map = new Map();
    for (const item of filterTombstonedCreations(cloudList, tombstones)) {
      if (item && item.id != null) map.set(String(item.id), item);
    }
    for (const item of localList || []) {
      if (!item || item.id == null) continue;
      const id = String(item.id);
      if (tombstones && tombstones[id]) {
        map.delete(id);
        continue;
      }
      const cloudItem = map.get(id);
      map.set(id, cloudItem ? mergePair(item, cloudItem) : item);
    }
    if (tombstones) {
      for (const id of Object.keys(tombstones)) map.delete(id);
    }
    return [...map.values()];
  }

  function cardWarehouseDedupeKey(card) {
    const job = card?.genJobId;
    if (job) return `job:${String(job)}`;
    const src = card?.genSourceId;
    if (src) return `src:${String(src)}`;
    return '';
  }

  function pickBetterWarehouseCard(a, b) {
    const score = (c) => {
      let s = 0;
      if (c?.image) s += 8;
      if ((c.prompt || '').trim().length > 10) s += 2;
      s += Math.min(4, (c.updatedAt || c.createdAt || 0) / 1e14);
      return s;
    };
    return score(b) > score(a) ? b : a;
  }

  /** 同一生图任务 / 同一 creation 只保留一张卡片，避免双端刷新后重复入库 */
  function dedupeWarehouseCards(cards) {
    const list = Array.isArray(cards) ? cards.filter((c) => c && c.id != null) : [];
    const byKey = new Map();
    const plain = [];
    for (const c of list) {
      const key = cardWarehouseDedupeKey(c);
      if (!key) {
        plain.push(c);
        continue;
      }
      const prev = byKey.get(key);
      byKey.set(key, prev ? pickBetterWarehouseCard(prev, c) : c);
    }
    return [...plain, ...byKey.values()];
  }

  function mergeCardsList(localList, cloudList, tombstones) {
    return dedupeWarehouseCards(byIdMergeWithPair(localList, cloudList, mergeCardPair, tombstones));
  }

  function byIdMerge(localList, cloudList, prefer, tombstones) {
    const map = new Map();
    for (const item of filterTombstonedCreations(cloudList, tombstones)) {
      if (item && item.id != null) map.set(String(item.id), item);
    }
    for (const item of localList || []) {
      if (!item || item.id == null) continue;
      const id = String(item.id);
      if (tombstones && tombstones[id]) continue;
      if (prefer === 'local' || !map.has(id)) map.set(id, item);
      else map.set(id, item);
    }
    return [...map.values()];
  }

  function mergeTombstoneMaps(a, b) {
    return { ...(b || {}), ...(a || {}) };
  }

  function mergePayload(local, cloud) {
    if (!cloud || typeof cloud !== 'object') {
      return { ...local, schemaVersion: SCHEMA_VERSION };
    }
    const cardTombstones = mergeTombstoneMaps(
      local.settings?.deletedCardTombstones,
      cloud.settings?.deletedCardTombstones
    );
    const creationTombstones = mergeTombstoneMaps(
      local.settings?.deletedCreationTombstones,
      cloud.settings?.deletedCreationTombstones
    );
    const jobTombstones = mergeTombstoneMaps(
      local.settings?.deletedGenerationJobTombstones,
      cloud.settings?.deletedGenerationJobTombstones
    );
    const postTombstones = mergeTombstoneMaps(
      local.settings?.deletedCommunityPostTombstones,
      cloud.settings?.deletedCommunityPostTombstones
    );
    const merged = {
      schemaVersion: SCHEMA_VERSION,
      cards: mergeCardsList(local.cards, cloud.cards, cardTombstones),
      customGroups:
        Array.isArray(local.customGroups) && local.customGroups.length
          ? local.customGroups
          : cloud.customGroups || [],
      globalFields:
        Array.isArray(local.globalFields) && local.globalFields.length
          ? local.globalFields
          : cloud.globalFields || [],
      settings: {
        ...(cloud.settings || {}),
        ...(local.settings || {}),
        deletedCardTombstones: cardTombstones,
        deletedCreationTombstones: creationTombstones,
        deletedGenerationJobTombstones: jobTombstones,
        deletedCommunityPostTombstones: postTombstones
      },
      account: local.account || cloud.account || null,
      communityPosts: mergeCommunityPostsList(
        (local.communityPosts || []).filter(p => !p.isMock),
        (cloud.communityPosts || []).filter(p => !p.isMock)
      ),
      creations: byIdMergeWithPair(
        local.creations,
        cloud.creations,
        mergeCreationPair,
        creationTombstones
      ),
      communityLikes: [...new Set([...(cloud.communityLikes || []), ...(local.communityLikes || [])])],
      communityFavorites: [
        ...new Set([...(cloud.communityFavorites || []), ...(local.communityFavorites || [])])
      ],
      follows: [...new Set([...(cloud.follows || []), ...(local.follows || [])])],
      communityEvents: byIdMergeWithPair(
        local.communityEvents || [],
        cloud.communityEvents || [],
        (a, b) => ({ ...b, ...a })
      ),
      notifications: byIdMergeWithPair(
        local.notifications || [],
        cloud.notifications || [],
        (a, b) => ({ ...b, ...a, read: !!(a.read || b.read) })
      )
    };
    return merged;
  }

  function cardIdSet(payload) {
    const ids = new Set();
    for (const c of payload?.cards || []) {
      if (c?.id != null) ids.add(String(c.id));
    }
    return ids;
  }

  function countImageRegression(local, merged) {
    const localMap = new Map();
    for (const c of local?.cards || []) {
      if (c?.id != null) localMap.set(String(c.id), c);
    }
    let n = 0;
    for (const c of merged?.cards || []) {
      if (c?.id == null) continue;
      const prev = localMap.get(String(c.id));
      if (!prev?.image || !c) continue;
      if (prev.image && !c.image) n += 1;
      else if (prev.image && c.image && imagePresenceScore(prev.image) > imagePresenceScore(c.image)) {
        n += 1;
      }
    }
    return n;
  }

  /** 合并结果中卡片 id 与本地一致时，避免云端空图覆盖本地有效图 */
  function preferLocalCardsImages(local, payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const localMap = new Map();
    for (const c of local?.cards || []) {
      if (c?.id != null) localMap.set(String(c.id), c);
    }
    if (!localMap.size || !Array.isArray(payload.cards)) return payload;
    const cards = payload.cards.map((c) => {
      if (!c || c.id == null) return c;
      const localCard = localMap.get(String(c.id));
      if (!localCard) return c;
      let out = c;
      if (localCard.image) {
        if (!c.image) out = { ...out, image: localCard.image };
        else {
          const sl = imagePresenceScore(localCard.image);
          const sc = imagePresenceScore(c.image);
          if (sl > sc) out = { ...out, image: localCard.image };
        }
      }
      const lg = cardGroupValue(localCard);
      const cg = cardGroupValue(out);
      if (lg && !cg) out = { ...out, group: lg };
      if (localCard.warehouseId && !out.warehouseId) out = { ...out, warehouseId: localCard.warehouseId };
      return out;
    });
    return { ...payload, cards };
  }

  /**
   * 拉取被安全策略拦截时：保留本机卡片库，仍合并社区/创作/设置等
   */
  function pullPreserveLocalWarehouse(local, merged) {
    if (!merged || typeof merged !== 'object') return null;
    if (cardCount(local) === 0) return preferLocalCardsImages(local, merged);
    return preferLocalCardsImages(local, {
      ...merged,
      cards: Array.isArray(local.cards) ? local.cards.map((c) => ({ ...c })) : []
    });
  }

  function countUnexplainedCardLoss(local, cloud, merged) {
    const tomb = merged?.settings?.deletedCardTombstones || {};
    const mergedIds = cardIdSet(merged);
    const seen = new Set();
    let lost = 0;
    for (const c of [...(local?.cards || []), ...(cloud?.cards || [])]) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!mergedIds.has(id) && !tomb[id]) lost += 1;
    }
    return lost;
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

    const merged = mergePayload(local, cloud || {});

    if (localComm === 0 && cloudComm > 0) {
      return { allow: true, merged: preferLocalCardsImages(local, merged) };
    }
    if (localCre === 0 && cloudCre > 0) {
      return { allow: true, merged: preferLocalCardsImages(local, merged) };
    }
    const mergedCards = cardCount(merged);
    const unexplained = countUnexplainedCardLoss(local, cloud, merged);
    if (unexplained > 0) {
      return {
        allow: false,
        reason: `合并后将丢失 ${unexplained} 张无删除记录的卡片，已阻止上传`
      };
    }
    if (Math.max(localCards, cloudCards) >= 3 && mergedCards < Math.max(localCards, cloudCards)) {
      const localOnlyLoss = localCards - mergedCards;
      if (localOnlyLoss >= 2 && localCards > cloudCards) {
        return {
          allow: false,
          reason: `上传将丢失 ${localOnlyLoss} 张本地卡片，已取消同步`
        };
      }
    }

    return { allow: true, merged: preferLocalCardsImages(local, merged) };
  }

  /**
   * 拉取云端前校验：禁止无删除记录的大幅缩库
   * @returns {{ allow: boolean, reason?: string, payload?: object }}
   */
  function validatePull(local, cloud, merged) {
    const localN = cardCount(local);
    const cloudN = cardCount(cloud);
    const mergedN = cardCount(merged);
    const unexplained = countUnexplainedCardLoss(local, cloud, merged);

    if (localN > 0 && cloudN === 0 && mergedN < localN) {
      return {
        allow: false,
        reason: `云端为空但本地有 ${localN} 张卡片，已保留本地`,
        payload: merged
      };
    }
    const localIds = cardIdSet(local);
    const mergedIds = cardIdSet(merged);
    let localIdsMissing = 0;
    for (const id of localIds) {
      if (!mergedIds.has(id)) localIdsMissing += 1;
    }
    const imageRegress = countImageRegression(local, merged);

    if (unexplained >= 1 && (unexplained >= 2 || (localN >= 4 && mergedN < localN * 0.75))) {
      if (localIdsMissing === 0 && mergedN >= localN) {
        return {
          allow: true,
          payload: preferLocalCardsImages(local, merged)
        };
      }
      return {
        allow: false,
        reason: `云端合并将丢失 ${unexplained} 张卡片（无删除记录），已保留本地`,
        payload: preferLocalCardsImages(local, merged)
      };
    }
    if (imageRegress > 0 && localN > 0 && localIdsMissing === 0) {
      return {
        allow: true,
        payload: preferLocalCardsImages(local, merged)
      };
    }
    return { allow: true, payload: preferLocalCardsImages(local, merged) };
  }

  function mergeCreationsList(localList, cloudList, tombstones) {
    return byIdMergeWithPair(localList, cloudList, mergeCreationPair, tombstones || {});
  }

  window.CloudSyncSafety = {
    SCHEMA_VERSION,
    validatePush,
    validatePull,
    mergePayload,
    mergeCardPair,
    mergeCardsList,
    dedupeWarehouseCards,
    mergeCommunityPostsList,
    mergeCreationsList,
    imagePresenceScore,
    preferLocalCardsImages,
    pullPreserveLocalWarehouse,
    cardCount,
    communityCount
  };
})();
