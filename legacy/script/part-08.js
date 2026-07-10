              : '文字已同步；部分图片未上传：' + result.warnings[0];
            setCloudSyncPhase('error', result.warnings[0]);
            showToast(msg, 8000);
          }
          return { ok: true, warnings: result.warnings };
        }
        setCloudSyncPhase('saved');
        return { ok: true };
      } catch (e) {
        cloudPushRunId++;
        const msg = String(e?.message || '');
        if (msg.includes('云端上传超时')) {
          setCloudSyncPhase('pending', '图片后台上传中…');
          scheduleCloudPush({ urgent: true });
          if (!silent) {
            showToast('卡片已在本机，图片正在后台上传', 6000);
          }
          return { ok: true, warnings: ['上传超时，后台重试中'] };
        }
        if (silent) {
          setCloudSyncPhase('pending', '将在后台重试保存');
          scheduleCloudPush({ urgent: true });
          return { ok: false, error: e };
        }
        setCloudSyncPhase('error', formatSyncError(e));
        throw e;
      } finally {
        cloudSyncing = false;
        if (status && !status.textContent.startsWith('❌')) status.textContent = '';
      }
    }

    function scheduleCloudPush(opts = {}) {
      if (window.SyncOrchestrator?.schedulePush) {
        window.SyncOrchestrator.schedulePush(opts);
        return;
      }
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      clearTimeout(cloudPushTimer);
      const delay = opts.urgent === true ? 350 : 90000;
      cloudPushTimer = setTimeout(() => {
        if (!opts.urgent && document.hidden) {
          scheduleCloudPush(opts);
          return;
        }
        pushToCloud({ silent: true, skipSafety: true, skipImageUpload: opts.urgent !== true }).catch((e) => {
          console.warn('[cloud] silent push failed', e);
        });
      }, delay);
    }
    window.scheduleCloudPush = scheduleCloudPush;

    function waitForCloudSyncIdle(maxMs = 90000) {
      return new Promise((resolve) => {
        if (!cloudSyncing) {
          resolve(true);
          return;
        }
        const start = Date.now();
        const tick = () => {
          if (!cloudSyncing || Date.now() - start > maxMs) {
            resolve(!cloudSyncing);
            return;
          }
          setTimeout(tick, 250);
        };
        tick();
      });
    }
    window.waitForCloudSyncIdle = waitForCloudSyncIdle;

    async function hydrateWorkspaceFromLocal(uid) {
      const hadSnapshot = await loadLocalSnapshotForUser(uid);
      if (!hadSnapshot) {
        cards = await loadCardsFromDB();
      }
      try {
        loadWarehouseGroups(getActiveWarehouseId());
      } catch (e) { customGroups = []; }
      try {
        const f = localStorage.getItem(userStorageKey('fields', uid)) || localStorage.getItem('promptrepo_fields');
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem(userStorageKey('settings', uid)) || localStorage.getItem('promptrepo_settings');
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      normalizeCardPins();
      let galleryMigrated = false;
      if (window.PromptHubCardGallery?.migrateMjSplitCardsQuiet?.(cards)) {
        galleryMigrated = true;
      }
      if (window.PromptHubCardGallery?.repairAllFeedCoversQuiet?.(cards)) {
        galleryMigrated = true;
      }
      if (galleryMigrated) {
        window.invalidateWarehouseCardsForImageGenCache?.();
        void saveAllData({ skipCloud: true });
      }
      return hadSnapshot || cards.length > 0;
    }

    window.persistCardGalleryUpdate = async function persistCardGalleryUpdate(cardId, gallery) {
      const card = cards.find((c) => c.id === cardId);
      if (!card || !window.PromptHubCardGallery) return false;
      card.cardImages = (gallery || []).filter(Boolean).slice(0, window.PromptHubCardGallery.MAX);
      window.PromptHubCardGallery.syncCardGalleryFields(card);
      const baseJobId = card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null;
      if (baseJobId && window.SupabaseSync?.archiveGeneratedCardImage) {
        for (let i = 0; i < card.cardImages.length; i += 1) {
          const src = card.cardImages[i];
          if (!src) continue;
          if (window.SupabaseSync.isStorageRef?.(src)) continue;
          try {
            const slotJob = window.PromptHubCardGallery.gallerySlotJobId(baseJobId, i);
            const archived = await window.SupabaseSync.archiveGeneratedCardImage(card.id, src, {
              jobId: slotJob
            });
            if (archived && archived !== src) card.cardImages[i] = archived;
          } catch (e) {
            console.warn('[persistCardGalleryUpdate] archive slot failed', i, e);
          }
        }
        window.PromptHubCardGallery.syncCardGalleryFields(card);
      }
      card.updatedAt = Date.now();
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
      return true;
    };

    function scheduleDeferredImageAudit() {
      if (window.MobileUI?.isMobileViewport?.()) return;
      const uid = window.SupabaseSync?.getUserId?.() || 'guest';
      const key = 'ph_img_audit_' + uid;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      const run = () => void runCardImageIntegrityAudit();
      const auditDelay = isMobileViewport()
        ? 120000
        : (window.SupabaseSync?.isLegacyImageRestorePhase?.() ? 1500 : 60000);
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: auditDelay + 60000 });
      } else {
        setTimeout(run, auditDelay);
      }
    }

    /** 已禁用：登录后自动删卡曾误删大量卡片（见 purgeGhostDataFromSettings） */

    function hydrateWarehouseGridImages(container, pageCards, opts = {}) {
      if (!container) return;
      window.SupabaseSync?.bootstrapWarehouseMediaCache?.({ clearAllMissing: true });
      const mobile = isMobileViewport();
      const perfCap = window.MobileUI?.getPerf?.()?.warehousePrefetchCap ?? 24;
      const cap = mobile
        ? Math.min(perfCap, (pageCards || []).length || perfCap)
        : Math.min(warehousePageSize(), (pageCards || []).length || warehousePageSize());
      const list = (pageCards || []).slice(0, cap);
      const afterBind = () => {
        const boostCap = mobile ? cap : Math.min(Math.max(cap, 32), 48);
        window.CardImageLoader?.boostWarehouseImages?.(container, boostCap);
        requestAnimationFrame(() => {
          if (!window.CardImageLoader?.loadImg) return;
          const rootRect = container.getBoundingClientRect();
          const nearPx = mobile ? 900 : 1100;
          const fallbackCap = mobile ? Math.min(cap, 12) : Math.min(Math.max(cap, 24), 36);
          let queued = 0;
          [...container.querySelectorAll('img.card-img[data-image-ref]')]
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .forEach((img) => {
              if (queued >= fallbackCap) return;
              if (img.dataset.feedLoadingUrl || img.dataset.feedLoadingKey) return;
              if (img.complete && img.naturalWidth > 8) return;
              const rect = img.getBoundingClientRect();
              const near = rect.bottom > rootRect.top - nearPx && rect.top < rootRect.bottom + nearPx;
              if (!near) return;
              const src = img.currentSrc || img.src || '';
              if (!src || src.includes('data:image/svg')) {
                queued += 1;
                window.CardImageLoader.loadImg(img);
              }
            });
        });
      };
      if (window.CardImageLoader?.bindWarehouse) {
        void window.CardImageLoader.bindWarehouse(container, list).finally(afterBind);
      } else {
        window.MediaPipeline?.patchContainerFromCache?.(container, { visibleFirst: true, max: cap });
        window.CardImageLoader?.observeContainer?.(container);
        afterBind();
      }
      if (!mobile && !container.classList.contains('masonry-ready')) {
        scheduleWarehouseMasonryLayout();
      }
    }

    async function runCardImageIntegrityAudit() {
      if (!window.SupabaseSync?.auditBrokenCardImages || !window.SupabaseSync?.isLoggedIn?.()) return;
      if (!cards.length) return;
      if (window.MobileUI?.isMobileViewport?.()) return;
      try {
        const { repaired } = await window.SupabaseSync.auditBrokenCardImages(cards, {
          capMs: 8000,
          skipStorageList: true,
          maxScan: 12
        });
        if (repaired.length) {
          await saveAllData({ skipCloud: true });
          scheduleCloudPush({ urgent: true });
          showToast(`已自动修复 ${repaired.length} 张卡片图片`);
          refreshWarehouseUI({ softCards: true });
        }
      } catch (e) {
        console.warn('[cards] image audit failed', e);
      }
    }

    async function handleCloudAfterLogin(opts = {}) {
      const silent = opts.silent === true;
      const force = opts.force === true;
      if (isPostLogoutBlocked()) return;
      const uid = window.SupabaseSync?.getUserId?.();
      if (!uid) return;
      const idbOwner = getIdbOwnerUid();
      const idbMismatch = !!(idbOwner && idbOwner !== uid);

      let syncPromise = Promise.resolve();
      if (window.PromptHubApi?.isConfigured?.() && !window.PromptHubApi?.isApiUnreachable?.()) {
        syncPromise = window.PromptHubApi.syncMe({ silent }).catch(() => ({}));
      } else if (window.SupabaseSync?.isLoggedIn?.()) {
        window.SubscriptionUI?.refreshOfferUI?.();
      }
      void       window.FeatureDraft?.warmImageGenModelCatalog?.();
      void window.FeatureDraft?.prefetchImageGenModelCatalog?.();

      if (!force && !idbMismatch && cloudHydratedUid === uid && cards.length > 0) {
        activeAccountId = uid;
        void syncPromise.catch(() => {});
        refreshWarehouseUI({ softCards: true });
        if (Date.now() - lastBgCloudSyncAt > 45000) {
          const deferBgSync = () => {
            scheduleCrossDeviceGenRecovery();
            void scheduleDeferredCloudPull({ silent: true, light: true });
          };
          const onImageGenMobile = (localStorage.getItem('promptrepo_app_page') === 'imagegen'
            || document.getElementById('pageImageGen')?.classList.contains('active'))
            && isMobileViewport()
            && document.body.classList.contains('imagegen-mobile-view-form');
          if (onImageGenMobile) {
            if (typeof requestIdleCallback === 'function') {
              requestIdleCallback(deferBgSync, { timeout: 15000 });
            } else {
              setTimeout(deferBgSync, 8000);
            }
          } else {
            deferBgSync();
          }
        }
        return;
      }

      const prevUid = activeAccountId;
      if (prevUid && prevUid !== uid) {
        try {
          await snapshotLocalForUser(prevUid);
        } catch (e) { /* ignore */ }
      }

      const uidChanged = !!(prevUid && prevUid !== uid);
      const accountSwitch = uidChanged || idbMismatch;
      activeAccountId = uid;
      localStorage.setItem('promptrepo_last_uid', uid);
      localStorage.removeItem('promptrepo_post_logout');
      window.Membership?.onAccountSwitch?.();
      cancelCloudSyncSchedulers();

      if (accountSwitch) {
        cards = [];
        customGroups = [];
        globalFields = [];
        window.__promptHubCards = [];
        window.FeatureDraft?.clearAllLocalFeatureData?.();
        await resetIdbForAccountSwitch(uid);
        localStorage.removeItem('promptrepo_autosave_snapshot');
        try {
          sessionStorage.removeItem('promptrepo_pending_guest_migrate');
        } catch (e) { /* ignore */ }
      }

      let loaded = false;
      let paintedFromLocal = false;

      setCloudSyncPhase('syncing', '正在加载本地数据…');
      await restoreAccountPrivateData(uid);
      if (cards.length > 0) {
        refreshWarehouseUI();
        paintedFromLocal = true;
        setCloudSyncPhase('saved', '本地数据已就绪，云端后台同步中…');
      }
      let guestPayload = null;
      const allowGuestMigrate = sessionStorage.getItem('promptrepo_guest_session') === '1';
      if (opts.migrateGuest && allowGuestMigrate && !uidChanged && cards.length === 0) {
        try {
          const raw = sessionStorage.getItem('promptrepo_pending_guest_migrate');
          if (raw) guestPayload = JSON.parse(raw);
        } catch (e) { guestPayload = null; }
      }

      const shouldPull = cloudHydratedUid !== uid || accountSwitch || force || opts.migrateGuest;
      if (shouldPull) {
        if (paintedFromLocal && cards.length > 0 && !force) {
          cloudHydratedUid = uid;
          window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
          requestFeedRefresh();
          void scheduleDeferredCloudPull({ silent: true, force: true });
          scheduleCrossDeviceGenRecovery();
          void syncPromise.catch(() => {});
          scheduleDeferredImageAudit();
          return;
        }
        try {
          if (!paintedFromLocal) setCloudSyncPhase('syncing', '正在拉取云端…');
          const pullResult = await Promise.race([
            pullFromCloud().then(() => 'ok').catch(() => 'fail'),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 45000))
          ]);
          loaded = pullResult === 'ok';
          if (pullResult === 'timeout') {
            setCloudSyncPhase('pending', '云端较慢，已保留本地数据');
            void pullFromCloud().then((ok) => {
              if (ok) {
                refreshWarehouseUI({ softCards: warehouseUiHasRenderedCards() });
                requestFeedRefresh();
                setCloudSyncPhase('saved');
              }
            }).catch(() => {});
          }
        } catch (e) {
        }
      }

      if (loaded && cards.length === 0) {
        await restoreAccountPrivateData(uid);
      }

      if ((accountSwitch || force) && !loaded && cards.length === 0) {
        await restoreAccountPrivateData(uid);
      }

      if (!loaded && !cards.length) {
        const hadSnapshot = cards.length > 0 || await restoreAccountPrivateData(uid);
        if (!hadSnapshot && guestPayload?.cards?.length) {
          applyDataPayload(guestPayload);
          await saveCardsToDB(cards, { ownerUid: uid });
          try {
            await pushToCloud({ silent: true, skipImageUpload: true });
            if (!silent) showToast(`已将 ${guestPayload.cards.length} 张本地卡片同步到云端`);
          } catch (e) {
            if (!silent) showToast('本地卡片已恢复，云端同步失败：' + formatSyncError(e));
          }
          try {
            sessionStorage.removeItem('promptrepo_pending_guest_migrate');
          } catch (e) { /* ignore */ }
        } else if (hadSnapshot && (cards.length > 0 || customGroups.length > 0)) {
          try {
            await pushToCloud({ silent: true, skipImageUpload: true });
            if (!silent) showToast('已恢复本账号本地备份并同步到云端');
          } catch (e) {
            if (!silent) showToast('本地已恢复，云端同步失败：' + formatSyncError(e));
          }
        } else if (!silent && !accountSwitch && !cloudHydratedUid) {
          showToast('新账号空白开始（不会导入其他账号的数据）');
        }
      } else if (loaded) {
        await snapshotLocalForUser(uid, { allowEmpty: true });
        await saveCardsToDB(cards, { ownerUid: uid });
        refreshWarehouseUI();
        if (!silent && (!cloudHydratedUid || accountSwitch || force)) {
          showToast('已从云端加载本账号数据');
        }
      } else if (cards.length && !silent && (!cloudHydratedUid || accountSwitch)) {
        await snapshotLocalForUser(uid, { allowEmpty: true });
      }

      cloudHydratedUid = uid;
      window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      requestFeedRefresh();
      window.TrialTasksUI?.onAuthReady?.();
      void syncPromise.catch(() => {});
      scheduleDeferredImageAudit();
      refreshWarehouseUI({
        softCards: !loaded && paintedFromLocal && silent && !accountSwitch && !force
      });
      setCloudSyncPhase(cards.length ? 'saved' : 'idle');
      lastBgCloudSyncAt = Date.now();
      scheduleCrossDeviceGenRecovery();
      try {
        sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      } catch (e) { /* ignore */ }
    }

    function isMobileViewport() {
      return window.MobileUI?.isMobileViewport?.() ?? window.matchMedia('(max-width: 900px)').matches;
    }

    function warehouseUiHasRenderedCards() {
      return !!document.getElementById('cardsContainer')?.querySelector('.card[data-id]');
    }

    function refreshWarehouseUI(opts = {}) {
      window.currentGroup = currentGroup;
      window.FeatureAssets?.updateWarehouseTitle?.();
      const soft = opts.softCards === true;
      updateTagFilter();
      buildFilterMenu();
      syncFilterBtnState();
      renderGroups();
      if (soft && document.getElementById('pageWarehouse')?.classList.contains('active')) {
        requestAnimationFrame(() => {
          if (isMobileViewport()) enforceMobileCardGrid();
          else layoutMasonryGrid();
        });
      } else if (!document.getElementById('pageWarehouse')?.classList.contains('active')) {
        /* 在生图/社区等页：只更新分组标签，勿 prefetch 卡片库 24 张图 */
      } else {
        renderCards(true);
      }
      updateGuestLimitUI();
      if (!isMobileViewport() && !selectedCardId && isNewCardMode) {
        createNewCard();
      }
      applyFloatingState();
    }

    function copyCardPromptById(cardId) {
      const card = cards.find(c => c.id === cardId);
      const text = (card?.prompt || '').trim();
      if (!text) {
        showToast('暂无提示词');
        return;
      }
      navigator.clipboard.writeText(text).then(() => showToast('已复制提示词'));
    }

    function fillCardToImageGen(cardId) {
      const card = cards.find(c => c.id === cardId);
      if (!card?.prompt) {
        showToast('暂无提示词');
        return;
      }
      if (typeof switchAppPage === 'function') switchAppPage('imagegen');
      window.FeatureDraft?.fillFormPromptOnly?.(card.prompt);
      window.MobileUI?.setImageGenView?.('form');
    }
    window.copyCardPromptById = copyCardPromptById;
    window.fillCardToImageGen = fillCardToImageGen;

    async function backupVisibleCardImages() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return 0;
      let n = 0;
      for (const c of cards) {
        if (!c?.id) continue;
        if (c.image && window.SupabaseSync.isDataUrl(c.image)) {
          await saveCardImageBackup(c.id, c.image);
          n += 1;
          continue;
        }
        const existing = await getCardImageBackup(c.id);
        if (existing) continue;
        const img = document.querySelector(`.card[data-id="${CSS.escape(String(c.id))}"] .card-img`);
        if (!img?.src || !/^https?:\/\//i.test(img.src) || img.naturalWidth < 8) continue;
        try {
          const res = await fetch(img.src, { mode: 'cors' });
          if (!res.ok) continue;
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
            await saveCardImageBackup(c.id, dataUrl);
            n += 1;
          }
        } catch (e) { /* ignore */ }
      }
      return n;
    }

    async function syncCloudNow(opts = {}) {
      const quiet = opts.quiet === true;
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        if (!quiet) openAuthModal();
        return;
      }
      if (cloudSyncing) {
        if (!quiet) showToast('保存进行中，请稍候…', 2500);
        return;
      }
      const status = document.getElementById('statusMsg');
      setCloudSyncPhase('syncing', quiet ? '正在同步云端…' : '正在与云端对齐');
      if (!quiet) showToast('正在与云端对齐…', 2000);
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (!cards.length && uid) {
          await restoreAccountPrivateData(uid);
          window.__promptHubCards = cards;
          if (cards.length) {
            renderGroups();
            renderCards(true);
            showToast(`已从本地备份恢复 ${cards.length} 张卡片`, 3500);
          }
        }
        if (cards.length) {
          await Promise.race([
            backupVisibleCardImages(),
            new Promise((r) => setTimeout(r, 4000))
          ]);
          if (window.SupabaseSync?.repairMissingCardImages) {
            if (status) status.textContent = '正在补传缺失图片…';
            const repair = await window.SupabaseSync.repairMissingCardImages(cards, {
              capMs: 60000,
              fullCheck: true
            });
            if (repair.fixed > 0) {
              window.__promptHubCards = cards;
              await saveAllData({ skipCloud: true });
              renderCards(true);
            }
            if (repair.failed?.length) {
              console.warn('[sync] image repair', repair.failed);
            }
          }
        }
        let pulled = false;
        let pushResult = null;
        try {
          pushResult = await pushToCloud({ strictImageCheck: true });
          if (pushResult?.busy) {
            showToast('同步进行中，请稍后再试', 3500);
            return;
          }
        } catch (e) {
          console.warn('[sync] push before pull failed', e);
        }
        try {
          pulled = await pullFromCloud();
          if (pulled) {
            renderGroups();
            renderCards(true);
            updateTagFilter();
            requestFeedRefresh();
          }
        } catch (e) {
          console.warn('[sync] pull after push failed', e);
        }
        if (pulled) {
          try {
            await pushToCloud({ silent: true, skipSafety: true });
          } catch (e) {
            console.warn('[sync] merge push after pull failed', e);
          }
        }
        const result = pushResult || { ok: true };
        const repairWarn = result?.warnings?.length ? result.warnings.slice(0, 2).join('；') : '';
        if (!quiet && !cards.length) {
          showToast(
            repairWarn
              ? '卡片库为空，无法同步；' + repairWarn
              : '卡片库为空。请先在电脑登录恢复，或设置里导入备份',
            9000
          );
        } else if (!quiet && repairWarn) {
          showToast((pulled ? '已合并云端；' : '') + '部分图片未上传：' + repairWarn, 8000);
        } else if (!quiet) {
          if (pulled) {
            showToast(`已与云端对齐（${cards.length} 张卡片）`);
          } else {
            showToast(`已上传到云端（${cards.length} 张卡片）`);
          }
        } else {
          setCloudSyncPhase('saved');
        }
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        if (!quiet) showToast('对齐失败：' + formatSyncError(e), 8000);
      } finally {
        if (status && !status.textContent.startsWith('❌')) status.textContent = '';
      }
    }
    window.syncCloudNow = syncCloudNow;
    window.runDeferredCloudPull = runDeferredCloudPull;
    window.__phLastBgCloudSyncAt = lastBgCloudSyncAt;
    window.SyncOrchestrator?.init?.({
      pushToCloud,
      pullFromCloud: runDeferredCloudPull,
      refreshFeeds: () => window.FeatureDraft?.refreshFeedsAfterCardsSync?.()
    });

    async function syncCloudNowFromSettings() {
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在与云端对齐…';
      try {
        await syncCloudNow();
      } finally {
        if (st && !String(st.textContent).includes('失败')) st.textContent = '';
      }
    }
    window.syncCloudNowFromSettings = syncCloudNowFromSettings;

    async function repairMissingCardImagesFromSettings() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return;
      }
      if (cloudSyncing) {
        showToast('云端保存进行中，请稍候…', 3000);
        return;
      }
      if (!cards.length) {
        showToast('卡片库为空', 3000);
        return;
      }
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在补传缺失图片…';
      setCloudSyncPhase('syncing', '补传图片中');
      try {
        const result = await window.SupabaseSync.repairMissingCardImages(cards, {
          capMs: 120000,
          fullCheck: true
        });
        if (result.fixed > 0) {
          window.__promptHubCards = cards;
          window.FeatureDraft?.invalidateCommunityReconcileCache?.();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          void pushToCloud({ silent: true }).catch((e) => {
            setCloudSyncPhase('error', formatSyncError(e));
          });
        }
        if (result.failed?.length) {
          const sample = result.failed
            .filter((f) => f.id !== '_timeout')
            .slice(0, 2)
            .map((f) => f.title || f.id)
            .join('、');
          const extra = result.failed.length > 2 ? ` 等 ${result.failed.length} 张` : '';
          showToast(
            result.fixed > 0
              ? `已补传 ${result.fixed} 张；仍有失败：${sample}${extra}`
              : `补传失败：${sample}${extra}（请重新编辑卡片添加图片）`,
            9000
          );
          if (st) st.textContent = '部分图片未能补传';
        } else if (result.fixed > 0) {
          showToast(`已补传 ${result.fixed} 张图片到云端`, 5000);
          if (st) st.textContent = `已补传 ${result.fixed} 张`;
          setCloudSyncPhase('saved');
        } else {
          showToast('没有需要从本机补传的图片', 4000);
          if (st) st.textContent = '云端图片已齐全';
          setCloudSyncPhase('saved');
        }
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('补传失败：' + formatSyncError(e), 8000);
        if (st) st.textContent = '补传失败';
      }
    }
    window.repairMissingCardImagesFromSettings = repairMissingCardImagesFromSettings;

    async function purgeGhostDataFromSettings() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return;
      }
      const st = document.getElementById('settingsStatus');
      if (st) st.textContent = '正在扫描…';
      setCloudSyncPhase('syncing', '扫描中');
      try {
        const candidates = [];
        for (const c of [...cards]) {
          if (!c?.id || !c.image || !window.SupabaseSync?.isStorageRef?.(c.image)) continue;
          window.SupabaseSync?.clearPathMissingForCard?.(c.id, c.image);
          let ok = false;
          try {
            ok = await window.SupabaseSync?.verifyStorageRef?.(c.image, c.id, { quick: false });
          } catch (e) { /* ignore */ }
          if (ok) continue;
          const blob = await window.SupabaseSync?.downloadCardStorageBlob?.(c.image, c.id);
          if (blob && (blob.size || 0) >= 512) continue;
          let hasBackup = false;
          if (typeof getCardImageBackup === 'function') {
            const backup = await getCardImageBackup(c.id);
            hasBackup = !!(backup && String(backup).startsWith('data:'));
          }
          if (!hasBackup) candidates.push(c);
        }
        if (!candidates.length) {
          const ghostOnly = window.FeatureDraft?.purgeGhostCommunityData?.() || { removedPosts: 0 };
          if (ghostOnly.removedPosts) {
            window.FeatureDraft?.invalidateCommunityReconcileCache?.();
            await saveAllData({ skipCloud: true });
            window.FeatureDraft?.renderCommunity?.();
          }
          setCloudSyncPhase('saved');
          const msg = ghostOnly.removedPosts
            ? `已清理 ${ghostOnly.removedPosts} 条社区残留（未删卡片）`
            : '未发现可删的无效卡片';
          showToast(msg, 6000);
          if (st) st.textContent = msg;
          return;
        }
        const sample = candidates.slice(0, 3).map((c) => c.title || c.id).join('、');
        const extra = candidates.length > 3 ? ` 等 ${candidates.length} 张` : '';
        const ok = window.confirm(
          `将永久删除 ${candidates.length} 张卡片（Storage 已确认无图且无本地备份）。\n`
          + `示例：${sample}${extra}\n\n`
          + '此操作不可撤销，且不会自动同步云端。确定继续？'
        );
        if (!ok) {
          setCloudSyncPhase('saved');
          if (st) st.textContent = `已取消（扫描到 ${candidates.length} 张候选）`;
          showToast(`已取消删除（${candidates.length} 张候选仍保留）`, 5000);
          return;
        }
        let removedCards = 0;
        for (const c of candidates) {
          recordCardDeletion(c.id);
          await window.FeatureDraft?.unpublishCommunityByCardId?.(c.id, { silent: true });
          cards = cards.filter((x) => x.id !== c.id);
          removedCards += 1;
        }
        const ghost = window.FeatureDraft?.purgeGhostCommunityData?.() || { removedPosts: 0 };
        window.__promptHubCards = cards;
        window.FeatureDraft?.invalidateCommunityReconcileCache?.();
        await saveAllData({ skipCloud: true });
        renderGroups();
        renderCards(true);
        window.FeatureDraft?.renderCommunity?.();
        setCloudSyncPhase('saved');
        const msg = `已从本地删除 ${removedCards} 张无效卡片`
          + (ghost.removedPosts ? `、${ghost.removedPosts} 条社区残留` : '')
          + '（未自动上传云端，请确认后再点「与云端对齐」）';
        showToast(msg, 9000);
        if (st) st.textContent = msg;
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('清理失败：' + formatSyncError(e), 8000);
        if (st) st.textContent = '清理失败';
      }
    }
    window.purgeGhostDataFromSettings = purgeGhostDataFromSettings;

    let communityHydrateInflight = false;

    async function requestCloudHydrate() {
      if (!window.SupabaseSync?.isLoggedIn?.() || cloudSyncing || communityHydrateInflight) return;
      communityHydrateInflight = true;
      setCloudSyncPhase('syncing', '正在加载社区数据');
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (!cards.length && uid) await restoreAccountPrivateData(uid);
        await pullFromCloud();
        window.__promptHubCards = cards;
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
        requestFeedRefresh();
        renderGroups();
        renderCards(true);
        setCloudSyncPhase('saved');
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        console.warn('[sync] requestCloudHydrate failed', e);
      } finally {
        communityHydrateInflight = false;
      }
    }
    window.requestCloudHydrate = requestCloudHydrate;

    function scheduleBackgroundCloudSync() {
      if (isPostLogoutBlocked()) return;
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      const minGap = isMobileViewport() ? 45000 : 180000;
      if (Date.now() - lastBgCloudSyncAt < minGap) return;
      clearTimeout(bgCloudSyncTimer);
      bgCloudSyncTimer = setTimeout(async () => {
        if (!window.SupabaseSync?.isLoggedIn?.() || cloudSyncing) return;
        lastBgCloudSyncAt = Date.now();
        try {
          if (!cards.length) {
            const uid = window.SupabaseSync?.getUserId?.();
            if (uid) await restoreAccountPrivateData(uid);
          }
          scheduleCrossDeviceGenRecovery();
          scheduleDeferredCloudPull({ silent: true });
        } catch (e) {
          console.warn('[sync] background sync failed', e);
        }
      }, 2500);
    }

    async function initSupabaseAuth() {
      if (!window.SupabaseSync?.isConfigured?.()) {
        updateAuthUI(null);
        await bootstrapWhenLoggedOut();
        return;
      }
      await window.SupabaseSync.init(async (session, event) => {
        updateAuthUI(session);
        if (event === 'PASSWORD_RECOVERY') {
          openAuthModal('reset');
        }

        const runAuthSideEffects = async () => {
          if (session?.user) {
            if (event === 'SIGNED_IN') {
              const guestMigrate = sessionStorage.getItem('promptrepo_guest_session') === '1';
              await completeAuthSession({ silent: false, migrateGuest: guestMigrate });
            } else if (event === 'INITIAL_SESSION') {
              await completeAuthSession({ silent: true });
            }
          } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
            activeAccountId = null;
            cloudHydratedUid = null;
            window.SubscriptionUI?.resetFirstOfferServerState?.();
            window.Membership?.onAccountSwitch?.();
            if (event === 'SIGNED_OUT') {
              localStorage.setItem('promptrepo_post_logout', '1');
              window.Membership?.clearLocalState?.();
              window.SubscriptionUI?.refreshOfferUI?.();
              await purgeSignedOutLocalData();
              updateAuthUI(null);
              renderGroups();
              renderCards(true);
              updateGuestLimitUI();
              switchAppPage('warehouse');
              if (isMobileViewport()) window.resetMobileEditPanelState?.();
            } else if (event === 'INITIAL_SESSION' && !session?.user) {
              await bootstrapWhenLoggedOut();
            }
          }
        };

        // 异步 auth，避免 INITIAL_SESSION 拉云端阻塞首屏
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
          setTimeout(() => { void runAuthSideEffects(); }, 0);
        } else {
          await runAuthSideEffects();
        }
      });
      setTimeout(() => window.reconcileAuthUI?.(), 0);
      setTimeout(() => window.reconcileAuthUI?.(), 1500);
      return true;
    }

    async function loadGuestWorkspace() {
      cards = await loadCardsFromDB({ ownerUid: 'guest' });
      if (!cards.length && getIdbOwnerUid() && getIdbOwnerUid() !== 'guest') {
        cards = [];
      }
      try {
        const g = localStorage.getItem('promptrepo_groups');
        if (g) customGroups = JSON.parse(g);
      } catch (e) { customGroups = []; }
      try {
        const f = localStorage.getItem('promptrepo_fields');
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem('promptrepo_settings');
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      floatingPromptActive = false;
      settings.floatingPrompt = false;
      applyEfficiencyMode();
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      normalizeCardPins();
      if (cards.length > 0) {
        try {
          sessionStorage.setItem('promptrepo_guest_session', '1');
          sessionStorage.setItem('promptrepo_pending_guest_migrate', JSON.stringify(getDataPayload()));
        } catch (e) { /* ignore */ }
      }
    }

    (async function init() {
      await openDB();
      cards = [];
      customGroups = [];
      globalFields = [];
      settings = Object.assign({ engine: 'tesseract', apiKey: '', imageClickZoom: false, floatingPrompt: false, autoPromptOcr: false, defaultPublishCommunity: true, defaultImageGenAutoPublish: true, efficiencyMode: false }, {});
      floatingPromptActive = false;
      try {
        const s = localStorage.getItem('promptrepo_settings');
