/**
 * Shared concurrency queues and performance caps for CardImageLoader.
 */
(function (global) {
  'use strict';

  function create() {
    const resolveQueue = [];
    const feedResolveQueue = [];
    const downloadQueue = [];
    let resolveActive = 0;
    let feedResolveActive = 0;
    let downloadActive = 0;

    function maxResolveCap() {
      return global.MobileUI?.getPerf?.()?.maxResolve ?? 10;
    }

    function feedMaxResolveCap() {
      return global.MobileUI?.getPerf?.()?.feedMaxResolve ?? 8;
    }

    function maxDownloadCap() {
      return global.MobileUI?.getPerf?.()?.maxDownload ?? 8;
    }

    function igFeedPatchMax() {
      return global.MobileUI?.getPerf?.()?.igFeedPatchMax ?? 12;
    }

    function igFeedBoostMax() {
      return global.MobileUI?.getPerf?.()?.igFeedBoostMax ?? 12;
    }

    function igFeedPrefetchMax() {
      return global.MobileUI?.getPerf?.()?.igFeedPrefetchCap ?? 12;
    }

    function warehousePrefetchCap() {
      const mp = global.MobileUI?.getPerf?.();
      if (mp?.warehousePrefetchCap) return Math.max(4, Number(mp.warehousePrefetchCap) || 8);
      return 24;
    }

    function warehouseInitialSignCap() {
      if (global.MobileUI?.isMobileViewport?.()) {
        return warehousePrefetchCap();
      }
      return 24;
    }

    function warehouseDesktopPatchCap() {
      return warehouseInitialSignCap();
    }

    function cardEagerCap() {
      return global.MobileUI?.getPerf?.()?.cardEagerCap ?? 16;
    }

    function cardFirstScreenCap() {
      return global.MobileUI?.getPerf?.()?.cardFirstScreenCap ?? 16;
    }

    function pumpDownloadQueue() {
      while (downloadActive < maxDownloadCap() && downloadQueue.length) {
        const job = downloadQueue.shift();
        downloadActive += 1;
        job().finally(() => {
          downloadActive -= 1;
          pumpDownloadQueue();
        });
      }
    }

    function enqueueDownload(fn) {
      return new Promise((resolve) => {
        downloadQueue.push(() => fn().then(resolve, resolve));
        pumpDownloadQueue();
      });
    }

    function runResolveQueue() {
      while (resolveActive < maxResolveCap() && resolveQueue.length) {
        const job = resolveQueue.shift();
        resolveActive += 1;
        job().finally(() => {
          resolveActive -= 1;
          runResolveQueue();
        });
      }
    }

    function enqueueResolve(fn) {
      return new Promise((resolve) => {
        resolveQueue.push(() => fn().then(resolve, resolve));
        runResolveQueue();
      });
    }

    function runFeedResolveQueue() {
      while (feedResolveActive < feedMaxResolveCap() && feedResolveQueue.length) {
        const job = feedResolveQueue.shift();
        feedResolveActive += 1;
        job().finally(() => {
          feedResolveActive -= 1;
          runFeedResolveQueue();
        });
      }
    }

    function enqueueFeedResolve(fn) {
      return new Promise((resolve) => {
        feedResolveQueue.push(() => fn().then(resolve, resolve));
        runFeedResolveQueue();
      });
    }

    return {
      cardEagerCap,
      cardFirstScreenCap,
      enqueueDownload,
      enqueueFeedResolve,
      enqueueResolve,
      feedMaxResolveCap,
      igFeedBoostMax,
      igFeedPatchMax,
      igFeedPrefetchMax,
      maxDownloadCap,
      maxResolveCap,
      warehouseDesktopPatchCap,
      warehouseInitialSignCap,
      warehousePrefetchCap
    };
  }

  global.CardImageLoaderQueues = { create };
})(typeof window !== 'undefined' ? window : globalThis);
