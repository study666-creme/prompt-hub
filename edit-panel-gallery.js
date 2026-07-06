/**
 * Edit panel gallery helpers.
 *
 * Keep slot/job/image resolution outside script.js so the card editor can evolve
 * without growing the main warehouse file.
 */
(function (global) {
  'use strict';

  function getCardGallery(card) {
    if (!card) return [];
    return global.PromptHubCardGallery?.normalizeCardGallery?.(card)
      || (card.image ? [card.image] : []);
  }

  function getCardJobId(card) {
    return global.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
      || (card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null);
  }

  function getSlotJobId(card, galleryIndex) {
    const baseJobId = getCardJobId(card);
    if (!baseJobId) return null;
    return global.PromptHubCardGallery?.gallerySlotJobId?.(baseJobId, galleryIndex)
      || baseJobId;
  }

  function isDisplayableImageUrl(url) {
    return !!(url
      && /^(https?:|blob:|data:image\/)/i.test(String(url))
      && !String(url).includes('data:image/svg'));
  }

  async function resolvePreview(ref, card, galleryIndex, opts = {}) {
    if (!ref) return '';
    if (isDisplayableImageUrl(ref) && !global.SupabaseSync?.isEphemeralUpstreamImageUrl?.(ref)) {
      return ref;
    }
    const cardId = card?.id || opts.cardId || null;
    const slotJobId = getSlotJobId(card, galleryIndex);
    const resolveOpts = {
      assetId: cardId,
      cardId,
      jobId: slotJobId || undefined,
      galleryIndex,
      preferFull: false,
      useJobImageApi: false,
      allowGridFallback: false
    };
    try {
      const listUrl = await global.MediaPipeline?.resolveListUrl?.(ref, {
        ...resolveOpts,
        tryAllPaths: true
      });
      if (isDisplayableImageUrl(listUrl)) return listUrl;
    } catch (e) { /* fallback below */ }
    try {
      const signed = await global.SupabaseSync?.resolveDisplayUrl?.(ref, {
        ...resolveOpts,
        variant: global.SupabaseSync?.VARIANT_GRID || 'grid',
        listOnly: true,
        allowFullFallback: false,
        tryAllPaths: true
      });
      if (isDisplayableImageUrl(signed)) return signed;
    } catch (e) { /* fallback below */ }
    if (slotJobId && global.WarehouseThumb?.resolveForCard) {
      try {
        const wh = await global.WarehouseThumb.resolveForCard(ref, {
          assetId: cardId,
          cardId,
          jobId: slotJobId,
          galleryIndex
        });
        if (isDisplayableImageUrl(wh)) return wh;
      } catch (e) { /* ignore */ }
    }
    return '';
  }

  global.EditPanelGallery = {
    getCardGallery,
    getCardJobId,
    getSlotJobId,
    isDisplayableImageUrl,
    resolvePreview
  };
})(typeof window !== 'undefined' ? window : globalThis);
