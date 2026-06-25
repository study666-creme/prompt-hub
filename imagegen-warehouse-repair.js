/**
 * 生图仓库卡片修复：MJ 字段补全、任务图回填、批量静默修复
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function warehouseCardImageNeedsRecovery(card, apiImageUrl) {
    if (!apiImageUrl) return false;
    if (!card?.image || !d().isDisplayableImage(card.image)) return true;
    if (/^https?:\/\//i.test(card.image)) return true;
    if (global.SupabaseSync?.isDataUrl?.(card.image)) return true;
    if (global.SupabaseSync?.isStorageRef?.(card.image)) {
      const path = global.SupabaseSync.storagePathFromRef?.(card.image);
      if (path && global.SupabaseSync.isPathKnownMissing?.(path)) return true;
    }
    return false;
  }

  async function repairMjWarehouseCardFields(card, fields) {
    if (!card?.id) return false;
    let changed = false;
    const gridUrls = Array.isArray(fields.mjGridUrls) ? fields.mjGridUrls.filter(Boolean) : [];
    if (gridUrls.length && (!Array.isArray(card.mjGridUrls) || card.mjGridUrls.length < gridUrls.length)) {
      card.mjGridUrls = gridUrls;
      changed = true;
    }
    if (fields.mjCompositeUrl && !card.mjCompositeUrl) {
      card.mjCompositeUrl = fields.mjCompositeUrl;
      changed = true;
    }
    if (Array.isArray(fields.mjButtons) && fields.mjButtons.length
      && (!Array.isArray(card.mjButtons) || !card.mjButtons.length)) {
      card.mjButtons = fields.mjButtons;
      changed = true;
    }
    if (!card.isMidjourney && gridUrls.length) {
      card.isMidjourney = true;
      changed = true;
    }
    if (!changed) return false;
    card.updatedAt = Date.now();
    const creations = d().getCreations() || [];
    const cre = creations.find(
      (c) => c.jobId === card.genJobId || c.id === card.genSourceId
    );
    if (cre) {
      if (gridUrls.length) cre.mjGridUrls = gridUrls;
      if (fields.mjCompositeUrl) cre.mjCompositeUrl = fields.mjCompositeUrl;
      if (fields.mjButtons?.length) cre.mjButtons = fields.mjButtons;
      cre.isMidjourney = true;
      d().persistCreations();
    }
    await d().persistPromptHubCards();
    return true;
  }

  async function repairWarehouseCardImageFromJob(card, imageUrl, jobId) {
    if (!card?.id || !imageUrl) return false;
    const tombKey = jobId || card.genJobId;
    if (tombKey && d().isGenerationJobDeleted(tombKey)) return false;
    if (jobId && card.genJobId && String(card.genJobId) !== String(jobId)) {
      console.warn('[imagegen] 跳过修复：卡片 genJobId 与任务不一致', card.id, card.genJobId, jobId);
      return false;
    }
    let stored = imageUrl;
    if (global.SupabaseSync?.persistGenerationImage) {
      try {
        stored = await global.SupabaseSync.persistGenerationImage(card.id, imageUrl, {
          jobId: jobId || card.genJobId || null
        });
      } catch (e) {
        console.warn('恢复生图：归档到 Storage 失败，使用任务链接', e);
      }
    }
    card.image = stored || imageUrl;
    card.updatedAt = Date.now();
    await d().persistPromptHubCards();
    return true;
  }

  let missingGenCardRepairInflight = null;

  async function repairMissingGenCardImagesQuiet() {
    if (!global.PromptHubApi?.getGenerationJob || !global.SupabaseSync?.isLoggedIn?.()) return false;
    if (missingGenCardRepairInflight) return missingGenCardRepairInflight;
    const list = d().getCards() || [];
    const tomb = global.getDeletedGenerationJobTombstones?.() || {};
    const targets = list.filter((c) => {
      if (!c?.id || !c?.genJobId) return false;
      const jobKey = String(c.genJobId);
      const base = jobKey.replace(/#\d+$/, '');
      if (tomb[jobKey] || (base && tomb[base])) return false;
      if (!c.image) return true;
      return !d().isUsableWarehouseImage(c);
    }).slice(0, 8);
    if (!targets.length) return false;
    missingGenCardRepairInflight = (async () => {
      let changed = false;
      for (const card of targets) {
        try {
          let src = null;
          const jobId = String(card.genJobId);
          const baseJobId = jobId.replace(/#\d+$/, '');
          const r = await global.PromptHubApi.getGenerationJob(baseJobId);
          if (r?.ok && r.data?.imageUrl) src = r.data.imageUrl;
          if (!src && typeof global.getCardImageBackup === 'function') {
            const backup = await global.getCardImageBackup(card.id);
            if (backup && d().isDisplayableImage(backup)) src = backup;
          }
          if (!src) continue;
          const ok = await repairWarehouseCardImageFromJob(card, src, jobId);
          if (ok) {
            changed = true;
            global.SupabaseSync?.clearPathMissingForCard?.(card.id, card.image);
            if (typeof global.saveCardImageBackup === 'function') {
              void global.saveCardImageBackup(card.id, src).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[repairMissingGenCardImages]', card.id, e);
        }
        await new Promise((res) => setTimeout(res, 160));
      }
      if (changed) {
        await d().persistPromptHubCards();
        d().refreshWarehouseUI();
        if (d().isPageImageGenActive()) {
          d().renderImageGenFeed({ preserveScroll: true });
        }
        d().queueUrgentCardsSync();
      }
      return changed;
    })().finally(() => {
      missingGenCardRepairInflight = null;
    });
    return missingGenCardRepairInflight;
  }

  function init(injected) {
    deps = injected || {};
    return {
      warehouseCardImageNeedsRecovery,
      repairMjWarehouseCardFields,
      repairWarehouseCardImageFromJob,
      repairMissingGenCardImagesQuiet
    };
  }

  global.ImageGenWarehouseRepair = { init };
})(typeof window !== 'undefined' ? window : globalThis);
