/**
 * 生图结果写入卡片库（仓库）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};

  function d() { return deps; }

  function saveGeneratedToWarehouse(opts) {
    if (!opts?.image && !(opts?.prompt || '').trim()) {
      d().toast('暂无内容可保存');
      return Promise.resolve(false);
    }
    return Promise.resolve(global.addCardFromGenerated?.({
      prompt: opts.prompt,
      image: opts.image,
      sourceId: opts.sourceId,
      jobId: opts.jobId || null,
      title: opts.title,
      resolution: opts.resolution || null,
      model: opts.model || null,
      quality: opts.quality || null,
      size: opts.size || null,
      targetGroup: opts.targetGroup || null,
      targetTags: opts.targetTags || null,
      publishToCommunity: !!opts.publishToCommunity,
      fromInspirationDraw: !!opts.fromInspirationDraw,
      silentToast: !!opts.silentToast,
      isMidjourney: !!opts.isMidjourney,
      cardImages: Array.isArray(opts.cardImages) ? opts.cardImages.filter(Boolean).slice(0, 5) : null,
      mjGridUrls: Array.isArray(opts.mjGridUrls) ? opts.mjGridUrls : null,
      mjCompositeUrl: opts.mjCompositeUrl || null,
      mjButtons: Array.isArray(opts.mjButtons) ? opts.mjButtons : null,
      genBatchId: opts.genBatchId || null,
      genBatchJobIds: Array.isArray(opts.genBatchJobIds) ? opts.genBatchJobIds : null,
      refImage: opts.refImage || null,
      refImages: Array.isArray(opts.refImages) ? opts.refImages.filter(Boolean) : null,
      referenceAssets: Array.isArray(opts.referenceAssets) ? opts.referenceAssets.filter(Boolean) : null,
      deferCloudPush: !!opts.deferCloudPush,
      isRecovery: !!opts.isRecovery
    })).then((r) => r?.ok ?? false);
  }

  function init(injected) {
    deps = injected || {};
    return { saveGeneratedToWarehouse };
  }

  global.ImageGenWarehouseSave = { init };
})(typeof window !== 'undefined' ? window : globalThis);
