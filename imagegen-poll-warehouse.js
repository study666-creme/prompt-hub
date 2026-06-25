/**
 * 轮询完成后的仓库入库：主图、附赠图、Midjourney 四宫格
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function findWarehouseCardForJob(jobId) {
    if (!jobId) return null;
    const key = String(jobId).replace(/#\d+$/, '');
    return (global.__promptHubCards || []).find((c) => {
      if (!c?.genJobId) return false;
      const cardKey = String(c.genJobId).replace(/#\d+$/, '');
      return c.genJobId === jobId || cardKey === key;
    }) || null;
  }

  function hasWarehouseCardForJob(jobId) {
    if (!jobId) return false;
    const card = findWarehouseCardForJob(jobId);
    if (!card?.image) return false;
    if (!d().isDisplayableImage(card.image)) return false;
    return true;
  }

  function getPollExtraImageUrls(poll, primaryUrl) {
    const main = primaryUrl || poll?.data?.imageUrl;
    if (!main) return [];
    const raw = Array.isArray(poll?.data?.extraImageUrls) ? poll.data.extraImageUrls : [];
    return raw.filter((u) => u && u !== main);
  }

  function isGenCreationSlotSaved(baseJobId, slotIndex) {
    if (!baseJobId) return false;
    const slotId = slotIndex <= 1 ? String(baseJobId) : `${baseJobId}#${slotIndex}`;
    return hasWarehouseCardForJob(slotId);
  }

  function allGenCreationSlotsSaved(baseJobId, extraCount) {
    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) return false;
    for (let i = 0; i < extraCount; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) return false;
    }
    return true;
  }

  /** Midjourney 入库：可选四张各存一张卡片 */
  async function saveMjToWarehouse({
    prompt,
    model,
    resolution,
    quality,
    size,
    cost,
    jobId,
    silentToast,
    isRecovery,
    fromInspirationDraw,
    pendingId,
    targetGroup,
    targetTags,
    primary,
    gridUrls,
    composite,
    buttons
  }) {
    const tiles = (gridUrls || []).filter(Boolean).slice(0, 4);
    const mainImage = primary || tiles[0];
    if (!mainImage) return false;
    const saveAll = d().isImageGenMjSaveAllTiles?.() && tiles.length > 1;
    const base = {
      prompt,
      model,
      resolution,
      quality,
      size,
      cost,
      jobId,
      isRecovery,
      fromInspirationDraw,
      pendingId,
      targetGroup,
      targetTags,
      isMidjourney: true
    };

    if (saveAll) {
      for (let i = 0; i < tiles.length; i += 1) {
        await d().finishImageGenRun({
          ...base,
          image: tiles[i],
          imageIndex: i + 1,
          silentToast: true,
          mjGridUrls: i === 0 ? tiles : null,
          mjCompositeUrl: i === 0 ? composite : null,
          mjButtons: i === 0 ? buttons : null,
          mjSplitSave: true
        });
      }
      if (!silentToast) {
        d().toast(`Midjourney ${tiles.length} 张已分别存入仓库，点预览可对首张放大/变体`);
      }
      return true;
    }

    await d().finishImageGenRun({
      ...base,
      image: mainImage,
      imageIndex: 1,
      silentToast: true,
      extraImages: [],
      mjGridUrls: tiles.length ? tiles : [mainImage],
      mjCompositeUrl: composite,
      mjButtons: buttons
    });
    if (!silentToast) {
      const n = tiles.length;
      d().toast(
        n >= 4
          ? 'Midjourney 已入库（预览可切换四张），勾选「四张分别存入」可各存一张'
          : `Midjourney 已入库 ${n} 张图，点预览继续操作`
      );
    }
    return true;
  }

  /** 入库主图 + 同任务附赠图；已有主图时只补缺失的附赠槽位 */
  async function ensureGenJobCreationsFromPoll(poll, ctx, pendingId) {
    if (poll?.data?.status !== 'completed' || !poll.data.imageUrl) return false;
    const baseJobId = ctx?.jobId || poll.data.jobId;
    const imageUrl = poll.data.imageUrl;
    const extras = getPollExtraImageUrls(poll, imageUrl);
    const isMj = poll.data.isMidjourney || d().isImageGenMidjourneyModel?.(ctx?.model);

    if (isMj) {
      const parsed = d().resolveMjPollImages(poll);
      const gridUrls = parsed.tiles.length ? parsed.tiles : parsed.primary ? [parsed.primary] : [];
      const primary = parsed.primary || imageUrl;
      if (!primary) return false;
      if (baseJobId && hasWarehouseCardForJob(baseJobId)) {
        const card = findWarehouseCardForJob(baseJobId);
        if (card && gridUrls.length > 1
          && (!Array.isArray(card.mjGridUrls) || card.mjGridUrls.length < gridUrls.length)) {
          await d().repairMjWarehouseCardFields(card, {
            mjGridUrls: gridUrls,
            mjCompositeUrl: parsed.composite,
            mjButtons: poll.data.mjButtons
          });
        }
        if (d().isImageGenMjSaveAllTiles?.() && gridUrls.length > 1) {
          for (let i = 2; i <= gridUrls.length; i += 1) {
            const slotId = `${baseJobId}#${i}`;
            if (!hasWarehouseCardForJob(slotId)) {
              await d().finishImageGenRun({
                ...ctx,
                image: gridUrls[i - 1],
                imageIndex: i,
                cost: ctx.cost,
                jobId: baseJobId,
                silentToast: true,
                isRecovery: !!ctx.isRecovery,
                isMidjourney: true,
                mjSplitSave: true
              });
            }
          }
        }
        if (pendingId) d().removePendingJob(pendingId);
        d().clearSessionGenJob(baseJobId);
        d().renderImageGenFeed({ preserveScroll: true });
        return true;
      }
      if (baseJobId && findWarehouseCardForJob(baseJobId) && !hasWarehouseCardForJob(baseJobId)) {
        await d().repairWarehouseCardImageFromJob(findWarehouseCardForJob(baseJobId), primary, baseJobId);
      }
      await saveMjToWarehouse({
        ...ctx,
        primary,
        gridUrls,
        composite: parsed.composite,
        buttons: poll.data.mjButtons,
        jobId: baseJobId,
        silentToast: !!ctx.silentToast,
        isRecovery: !!ctx.isRecovery,
        pendingId
      });
      return true;
    }

    if (baseJobId && allGenCreationSlotsSaved(baseJobId, extras.length)) {
      const mainCard = findWarehouseCardForJob(baseJobId);
      if (mainCard && d().warehouseCardImageNeedsRecovery(mainCard, imageUrl)) {
        await d().repairWarehouseCardImageFromJob(mainCard, imageUrl, baseJobId);
      }
      for (let ei = 0; ei < extras.length; ei += 1) {
        const slotId = `${baseJobId}#${ei + 2}`;
        const slotCard = findWarehouseCardForJob(slotId);
        if (slotCard && d().warehouseCardImageNeedsRecovery(slotCard, extras[ei])) {
          await d().repairWarehouseCardImageFromJob(slotCard, extras[ei], slotId);
        }
      }
      if (pendingId) d().removePendingJob(pendingId);
      d().clearSessionGenJob(baseJobId);
      d().renderImageGenFeed({ preserveScroll: true });
      return true;
    }

    if (!baseJobId || !isGenCreationSlotSaved(baseJobId, 1)) {
      await d().finishImageGenRun({
        ...ctx,
        image: imageUrl,
        extraImages: extras,
        cost: ctx.cost,
        jobId: baseJobId,
        silentToast: !!ctx.silentToast,
        isRecovery: !!ctx.isRecovery,
        pendingId
      });
      if (extras.length && !ctx.silentToast) {
        d().toast(`本次上游共 ${extras.length + 1} 张图，已全部存入仓库（仅扣 1 次积分）`);
      }
      return true;
    }

    for (let i = 0; i < extras.length; i += 1) {
      if (!isGenCreationSlotSaved(baseJobId, i + 2)) {
        await d().finishImageGenRun({
          ...ctx,
          image: extras[i],
          extraImages: [],
          cost: ctx.cost,
          jobId: baseJobId,
          silentToast: true,
          isRecovery: !!ctx.isRecovery,
          pendingId: null,
          imageIndex: i + 2
        });
      }
    }
    if (pendingId) d().removePendingJob(pendingId);
    d().renderImageGenFeed({ preserveScroll: true });
    if (extras.length && !ctx.silentToast) {
      d().toast(`已补全同任务附赠图 ${extras.length} 张`);
    }
    return true;
  }

  function init(injected) {
    deps = injected || {};
    return {
      getPollExtraImageUrls,
      isGenCreationSlotSaved,
      allGenCreationSlotsSaved,
      saveMjToWarehouse,
      ensureGenJobCreationsFromPoll
    };
  }

  global.ImageGenPollWarehouse = { init };
})(typeof window !== 'undefined' ? window : globalThis);
