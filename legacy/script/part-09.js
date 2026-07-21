      updatePanelOcrBoxVisibility();
      applyEfficiencyMode();
      initFilterMenu();
      initSortMenu();
      bindWarehouseSearchInputs();
      initBatchMarqueeSelect();
      bindPanelOcrDrop();
      initCardUploadOriginalToggle();
      initAppNav();
      initDevLabNav();
      initAppNavCollapse();
      initWarehouseHero();
      if (window.AppRouter?.resolveBootApp?.() === 'devlab') {
        void ensureFeatureAssets().then(() => switchDevLabPanel(getDevLabPanel())).catch((e) => {
          console.warn('[assets] boot load failed', e);
        });
      } else {
        deferAfterPagePaint(() => {
          void ensureFeatureAssets().catch((e) => console.warn('[assets] idle load failed', e));
        }, 3500);
      }
      finishAppBootstrap();
      scheduleBackgroundEffectAfterBoot(window.AppRouter?.resolveBootApp?.() || 'landing');
      refreshAuthMethodUI();
      refreshAppBuildLabel();
      void initSupabaseAuth();
      if (window.location.hash.includes('type=recovery') && window.SupabaseSync?.isConfigured?.()) {
        setTimeout(() => openAuthModal('reset'), 400);
      }
      if (/[?&]panel=recharge(?:&|$)/.test(location.search || '')) {
        setTimeout(() => window.openRechargePanel?.(), 600);
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
      }
      bindQuickPreviewButtons();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void window.SupabaseSync?.healSessionOnResume?.();
          scheduleCrossDeviceGenRecovery();
          scheduleBackgroundCloudSync();
          return;
        }
        if (document.visibilityState === 'hidden') {
          const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
          if (uid) void snapshotLocalForUser(uid);
          else if (cards.length) void writeEmergencyBackup('page_hide');
        }
      });
      window.addEventListener('pagehide', () => {
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid && cards.length) {
          void snapshotLocalForUser(uid);
          scheduleCloudPush({ urgent: true });
        }
      });
      applyFloatingState();
      if (typeof ResizeObserver !== 'undefined') {
        let masonryResizeTimer = null;
        const onWarehouseResize = () => {
          if (!document.getElementById('pageWarehouse')?.classList.contains('active')) return;
          clearTimeout(masonryResizeTimer);
          const delay = document.body.classList.contains('panel-open') ? 48 : 200;
          masonryResizeTimer = setTimeout(() => {
            if (isMobileViewport()) scheduleLayoutMasonry();
            else layoutMasonryGrid();
          }, delay);
        };
        const masonryResizeObs = new ResizeObserver(onWarehouseResize);
        const mainArea = document.getElementById('mainContentArea');
        const editPanelEl = document.getElementById('editPanel');
        if (mainArea) masonryResizeObs.observe(mainArea);
        if (editPanelEl) masonryResizeObs.observe(editPanelEl);
      }
    })();

    window.__promptHubCards = cards;
    window.__promptHubIsNewCard = () => isNewCardMode;
    window.__promptHubGetEditingCard = () => {
      if (isNewCardMode || !selectedCardId) return null;
      return cards.find((c) => c.id === selectedCardId) || null;
    };

    /** 社区恢复等外部写入卡片列表时，必须同步 script.js 内的 cards */
    window.importPromptHubCards = function importPromptHubCards(list) {
      if (!Array.isArray(list)) return;
      cards = list;
      window.__promptHubCards = cards;
      window.invalidateWarehouseCardsForImageGenCache?.();
    };

    function scheduleLocalSnapshot(uid) {
      if (!uid) return;
      clearTimeout(localSnapshotTimer);
      localSnapshotTimer = setTimeout(() => {
        void snapshotLocalForUser(uid, { allowEmpty: true, throttle: true });
      }, 600);
    }

    async function saveAllData(opts = {}) {
      if (Array.isArray(window.__promptHubCards) && window.__promptHubCards.length > cards.length) {
        cards = window.__promptHubCards;
      }
      window.__promptHubCards = cards;
      cards = filterTombstonedCards(cards);
      window.__promptHubCards = cards;
      window.invalidateWarehouseCardsForImageGenCache?.();
      await saveCardsToDB(cards, { ownerUid: currentIdbOwnerUid() });
      const now = Date.now();
      if (cards.length > 0 && now - lastEmergencyBackupAt > 45000) {
        void writeEmergencyBackup('auto_save');
      }
      settings.floatingPrompt = floatingPromptActive;
      if (typeof window.getAppTheme === 'function') settings.theme = window.getAppTheme();
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
      } catch (e) { /* ignore */ }
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
      if (uid && window.SupabaseSync?.isLoggedIn?.()) {
        const localPayload = getDataPayload();
        const localPayloadWriteOpts = opts.forceLocalPayloads
          ? { allowEmpty: true, force: true, payload: localPayload }
          : { allowEmpty: true, throttle: true, payload: localPayload };
        await snapshotLocalForUser(uid, localPayloadWriteOpts);
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        writeAutosavePayloadForUser(
          uid,
          localPayload,
          opts.forceLocalPayloads ? { force: true } : { throttle: true }
        );
      }
      if (uid) {
        persistWarehouseGroups(getActiveWarehouseId());
        localStorage.setItem(userStorageKey('fields', uid), JSON.stringify(globalFields));
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        scheduleLocalSnapshot(uid);
      }
      if (fileHandle) {
        try {
          const w = await fileHandle.createWritable();
          await w.write(JSON.stringify(buildBackupPayload(), null, 2));
          await w.close();
        } catch (e) { /* ignore */ }
      }
      if (!opts.skipCloud) {
        if (window.SyncOrchestrator?.notifyCardsChanged) {
          window.SyncOrchestrator.notifyCardsChanged(opts.urgent ? { urgent: true } : {});
        } else {
          scheduleCloudPush();
        }
      }
      window.FeatureDraft?.invalidateCommunityReconcileCache?.();
    }

    window.savePromptHubCardsNow = async function savePromptHubCardsNow(opts = {}) {
      if (Array.isArray(window.__promptHubCards) && window.__promptHubCards.length >= cards.length) {
        cards = window.__promptHubCards;
      }
      await saveAllData(opts);
      renderGroups();
      renderCards(true);
    };
    window.persistPromptHubCards = window.savePromptHubCardsNow;

    function renderGroups() {
      ensureGroupsFromCards();
      const visible = warehouseVisibleCards(cards);
      document.getElementById('allCount').textContent = visible.length;
      document.getElementById('uncategorizedCount').textContent = visible.filter(c => !c.group).length;
      document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
      const activeEl = document.querySelector(`.group-item[data-group="${currentGroup}"]`);
      if (activeEl) activeEl.classList.add('active');
      const customContainer = document.getElementById('customGroupList');
      customContainer.innerHTML = '';
      customGroups.forEach(group => {
        const cnt = visible.filter(c => c.group === group).length;
        const item = document.createElement('div');
        item.className = `group-item custom-group ${currentGroup === group ? 'active' : ''}`;
        item.dataset.group = group;
        item.title = '双击或右键重命名';
        item.innerHTML = `${group} <span class="count">${cnt}</span>`;
        item.addEventListener('click', () => switchGroup(group));
        item.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          inlineRenameGroup(group);
        });
        item.addEventListener('contextmenu', e => {
          e.preventDefault();
          showContextMenu(e.clientX, e.clientY, [
            { label: '重命名', action: () => inlineRenameGroup(group) },
            { label: '删除分组', action: () => deleteGroup(group) }
          ]);
        });
        customContainer.appendChild(item);
      });
      document.querySelectorAll('#defaultGroupList .group-item').forEach(item => {
        item.onclick = () => switchGroup(item.dataset.group);
      });
      enableGroupDrop();
    }

    function switchGroup(g) {
      currentGroup = g;
      window.currentGroup = g;
      window.FeatureAssets?.updateWarehouseTitle?.();
      document.getElementById('searchInput').value = '';
      renderGroups(); renderCards(true);
    }

    function inlineAddGroup(event) {
      event.stopPropagation();
      const container = document.getElementById('customGroupList');
      const existing = container.querySelector('.inline-edit-group');
      if (existing) {
        existing.querySelector('.group-name-input')?.focus();
        return;
      }
      const div = document.createElement('div');
      div.className = 'inline-edit-group';
      div.innerHTML = '<input type="text" class="group-name-input" placeholder="输入分组名" maxlength="40">';
      const input = div.querySelector('.group-name-input');
      let done = false;
      const remove = () => div.remove();
      const commit = () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        remove();
        if (!name) return;
        if (customGroups.includes(name)) { showToast('分组已存在'); return; }
        clearDeletedCustomGroup(name);
        customGroups.push(name);
        saveAllData();
        renderGroups();
        showToast('分组已创建');
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); done = true; remove(); }
      });
      input.addEventListener('blur', commit);
      container.prepend(div);
      input.focus();
    }

    function renameGroup(oldName, newName) {
      const oldN = String(oldName || '').trim();
      const newN = String(newName || '').trim();
      if (!oldN || !newN || oldN === newN) return false;
      if (!customGroups.includes(oldN)) return false;
      if (customGroups.includes(newN)) {
        showToast('分组已存在');
        return false;
      }
      clearDeletedCustomGroup(newN);
      customGroups[customGroups.indexOf(oldN)] = newN;
      cards.forEach((c) => {
        if (c.group === oldN) c.group = newN;
      });
      if (currentGroup === oldN) {
        currentGroup = newN;
        window.currentGroup = newN;
      }
      window.__promptHubCards = cards;
      persistWarehouseGroups();
      saveAllData();
      renderGroups();
      renderCards(true);
      showToast('分组已重命名');
      return true;
    }
    window.renameGroup = renameGroup;

    function inlineRenameGroup(groupName) {
      const container = document.getElementById('customGroupList');
      if (!container) return;
      const item = [...container.querySelectorAll('.group-item.custom-group')].find(
        (el) => el.dataset.group === groupName
      );
      if (!item || item.querySelector('.group-name-input')) return;
      const oldName = groupName;
      item.classList.add('inline-edit-group');
      item.innerHTML = '<input type="text" class="group-name-input" maxlength="40">';
      const input = item.querySelector('.group-name-input');
      input.value = oldName;
      let done = false;
      const restore = () => {
        item.classList.remove('inline-edit-group');
        renderGroups();
      };
      const commit = () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!name || name === oldName) {
          restore();
          return;
        }
        if (!renameGroup(oldName, name)) restore();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          done = true;
          restore();
        }
      });
      input.addEventListener('blur', commit);
      input.focus();
      input.select();
    }
    window.inlineRenameGroup = inlineRenameGroup;

    function deleteGroup(g) {
      customConfirm(`确定删除分组"${g}"？卡片将变为未分类。`, () => {
        recordDeletedCustomGroup(g);
        customGroups = customGroups.filter(x => x !== g);
        const clearGroupOnCard = (c) => {
          if (c && String(c.group || '').trim() === g) c.group = null;
        };
        cards.forEach(clearGroupOnCard);
        if (Array.isArray(window.__promptHubCards)) window.__promptHubCards.forEach(clearGroupOnCard);
        if (currentGroup === g) {
          currentGroup = 'all';
          window.currentGroup = 'all';
        }
        persistWarehouseGroups(getActiveWarehouseId());
        void saveAllData({ urgent: true }).then(() => {
          renderGroups();
          renderCards(true);
          showToast(`已删除分组「${g}」`);
        });
      });
    }

    // 修复卡片渲染：无标题时不显示标题行，无图片时不生成图片区域
    function formatCardTime(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
      if (diff < 86400000) return `大约 ${Math.floor(diff / 3600000)} 小时前`;
      if (diff < 172800000) return '昨天';
      if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function looksLikeCodeSnippet(text) {
      return /^\s*(--|\/\*|CREATE|SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/im.test(text || '');
    }

    function getCardDisplayTitle(card) {
      return (card.title || '').trim();
    }

    function cardHasDisplayImage(card) {
      const cover = window.PromptHubCardGallery?.getCardFeedCoverImage?.(card)
        || window.PromptHubCardGallery?.getCardCoverImage?.(card)
        || card?.image;
      if (!cover) return window.FeatureDraft?.isUsableWarehouseImage?.(card) ?? false;
      return window.FeatureDraft?.isDisplayableImage?.(cover) ?? !!cover;
    }

    /** 仓库列表缩略：gallery 第一张单图 + 已缓存/可签 URL */
    function getWarehouseCardListThumb(card, opts = {}) {
      const meta = window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(card, opts);
      if (!meta) return { show: false };
      if (!meta.hasImage) return { show: false };
      return {
        show: true,
        src: meta.cachedUrl || '',
        coverImage: meta.ref,
        coverJobId: meta.slotJobId || meta.thumbMeta?.slotJobId || meta.jobId || '',
        thumbMeta: meta.thumbMeta,
        immediate: !!meta.cachedUrl
      };
    }

    /** 卡片库是否渲染图片区：有可加载缩略图时才显示 */
    function warehouseCardShouldRenderMediaSlot(card) {
      return getWarehouseCardListThumb(card).show;
    }

    function shouldLoadPanelImagePreview() {
      if (!imageData) return false;
      if (pendingUploadFile) return true;
      if (typeof imageData === 'string' && imageData.startsWith('data:image/') && !imageData.includes('data:image/svg')) {
        return true;
      }
      if (isNewCardMode) return true;
      const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
      if (!card) return true;
      return cardHasDisplayImage(card);
    }

    function getCardDisplayDesc(card, opts) {
      const prompt = (card.prompt || '').trim();
      if (!prompt) return '暂无提示词内容';
      if (looksLikeCodeSnippet(prompt)) return '点击编辑查看完整内容';
      const textOnly = opts?.textOnly || !cardHasDisplayImage(card);
      if (textOnly && prompt.length > 120) return prompt.slice(0, 280) + (prompt.length > 280 ? '…' : '');
      return prompt;
    }

    function buildCardTagsHtml(tags) {
      const list = tags || [];
      const max = 2;
      const shown = list.slice(0, max);
      const extra = list.length - max;
      let html = shown.map(t => `<span class="tag" onclick="event.stopPropagation();searchByTag('${escapeJsString(t)}')">${escapeHtml(t)}</span>`).join('');
      if (extra > 0) html += `<span class="tag tag-more">+${extra}</span>`;
      return html;
    }

    function syncWarehouseSearchFields(fromEl) {
      const desktop = document.getElementById('searchInput');
      const mobile = document.getElementById('searchInputMobile');
      if (!desktop && !mobile) return;
      const val = fromEl?.value ?? desktop?.value ?? mobile?.value ?? '';
      if (desktop) desktop.value = val;
      if (mobile) mobile.value = val;
    }

    function commitWarehouseSearch(fromEl) {
      syncWarehouseSearchFields(fromEl);
      renderCards(true);
      window.closeMobileSearch?.();
      if (fromEl?.blur) fromEl.blur();
      else document.getElementById('searchInput')?.blur();
    }
    window.commitWarehouseSearch = commitWarehouseSearch;

    function bindWarehouseSearchInputs() {
      const bind = (el) => {
        if (!el || el.dataset.searchBound) return;
        el.dataset.searchBound = '1';
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          commitWarehouseSearch(el);
        });
        if (el.type === 'search') {
          el.addEventListener('search', (e) => {
            e.preventDefault();
            commitWarehouseSearch(el);
          });
        }
      };
      bind(document.getElementById('searchInput'));
      bind(document.getElementById('searchInputMobile'));
    }

    function snapshotLoadedWarehouseImages(container) {
      const map = new Map();
      if (!container) return map;
      container.querySelectorAll('.card[data-id] img.card-img').forEach((img) => {
        const cardId = img.closest('.card')?.dataset?.id;
        const src = img.currentSrc || img.src || '';
        if (!cardId || !src || src.includes('data:image/svg')) return;
        const ok = window.SupabaseSync?.isGridDisplayUrl?.(src)
          || window.SupabaseSync?.isValidSignedDisplayUrl?.(src)
          || /^https?:\/\//i.test(src);
        if (ok) map.set(cardId, src);
      });
      return map;
    }

    function restoreLoadedWarehouseImages(container, map) {
      if (!container || !map?.size) return;
      map.forEach((src, cardId) => {
        const card = container.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
        const img = card?.querySelector('img.card-img');
        if (!img) return;
        const cur = img.currentSrc || img.src || '';
        if (cur && !cur.includes('data:image/svg') && cur === src) return;
        if (window.CardImageLoader?.applyUrlToImg?.(img, src)) {
          const media = img.closest('.card-media');
          media?.classList.remove('is-loading', 'card-media--await');
          if (typeof finishCardMediaShine === 'function') finishCardMediaShine(media);
        }
      });
    }

    function warehousePageDomNeedsFullRender(container, pageCards) {
      if (!container || !pageCards?.length) return false;
      const domCards = container.querySelectorAll('.card[data-id]');
      if (!domCards.length) return false;
      let broken = 0;
      domCards.forEach((el) => {
        const card = cards.find((c) => c.id === el.dataset.id);
        if (!card || !warehouseCardShouldRenderMediaSlot(card)) return;
        if (el.classList.contains('card--text-only') || !el.querySelector('.card-img')) broken += 1;
      });
      return broken > 0;
    }

    function softHydrateWarehouseContainer(container, pageCards) {
      if (!container) return;
      hydrateWarehouseGridImages(container, Array.isArray(pageCards) ? pageCards : []);
    }

    function warehouseListSignature(list, ctx) {
      const pageSlice = (list || []).slice(0, warehousePageSize());
      const head = pageSlice.map((c) => {
        const galleryHead = window.PromptHubCardGallery?.normalizeCardGallery?.(c)?.[0] || '';
        return `${c.id}\u001f${c.updatedAt || 0}\u001f${String(c.image || '').slice(0, 48)}\u001f${String(galleryHead || '').slice(0, 48)}`;
      }).join('\u001e');
      const filterKey = [
        ctx.group || 'all',
        ctx.search || '',
        ctx.sort || '',
        String(ctx.page || 1),
        ctx.batch ? '1' : '0',
        (ctx.filters || []).slice().sort().join(',')
      ].join('|');
      return `${filterKey}::${head}`;
    }

    function listThumbFromWarehouseMeta(meta) {
      if (!meta?.hasImage) return { show: false };
      return {
        show: true,
        src: meta.cachedUrl || '',
        coverImage: meta.ref,
        coverJobId: meta.slotJobId || meta.thumbMeta?.slotJobId || meta.jobId || '',
        thumbMeta: meta.thumbMeta,
        immediate: !!meta.cachedUrl
      };
    }

    function estimateWarehouseMobileCardHeight(card, showImage) {
      const title = getCardDisplayTitle(card) || '';
      const desc = getCardDisplayDesc(card, { textOnly: !showImage }) || '';
      const tagCount = Array.isArray(card?.tags) ? card.tags.length : 0;
      const textLines = Math.min(7, Math.ceil((title.length + desc.length) / 18));
      const media = showImage ? 150 : 0;
      const tags = tagCount ? 24 : 0;
      return media + 92 + (textLines * 18) + tags;
    }

    function ensureWarehouseMobileColumns(container) {
      if (!container) return [];
      let cols = [...container.querySelectorAll(':scope > .warehouse-mobile-col')];
      if (cols.length !== 2) {
        cols.forEach((col) => col.remove());
        cols = [0, 1].map((idx) => {
          const col = document.createElement('div');
          col.className = 'warehouse-mobile-col';
          col.dataset.col = String(idx);
          container.appendChild(col);
          return col;
        });
      }
      container.classList.add('warehouse-mobile-columns');
      return cols;
    }

    function warehouseMobileColumnLoads(cols) {
      return cols.map((col) => [...col.querySelectorAll('.card[data-id]')].reduce((sum, card) => {
        const real = card.offsetHeight || 0;
        const estimate = Number(card.dataset.mobileEstimate) || 180;
        return sum + (real > 20 ? real : estimate) + 10;
      }, 0));
    }

    function distributeWarehouseMobileCards(container, cardEls) {
      if (!container || !cardEls?.length) return;
      const cols = ensureWarehouseMobileColumns(container);
      if (cols.length !== 2) {
        cardEls.forEach((card) => container.appendChild(card));
        return;
      }
      const loads = warehouseMobileColumnLoads(cols);
      let pinnedCount = [...container.querySelectorAll('.warehouse-mobile-col .card.is-pinned')].length;
      cardEls.forEach((card) => {
        const forcedCol = card.classList.contains('is-pinned')
          ? (pinnedCount++ % 2)
          : (loads[0] <= loads[1] ? 0 : 1);
        cols[forcedCol].appendChild(card);
        const estimate = Number(card.dataset.mobileEstimate) || (card.offsetHeight || 180);
        loads[forcedCol] += estimate + 10;
      });
    }

    function repairWarehouseMobileColumns(container) {
      if (!container || !isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') {
        container.classList.remove('warehouse-mobile-columns');
        const directTarget = document.createDocumentFragment();
        container.querySelectorAll(':scope > .warehouse-mobile-col > .card').forEach((card) => {
          directTarget.appendChild(card);
        });
        container.querySelectorAll(':scope > .warehouse-mobile-col').forEach((col) => col.remove());
        container.appendChild(directTarget);
        return;
      }
      const directCards = [...container.querySelectorAll(':scope > .card[data-id]')];
      const cols = [...container.querySelectorAll(':scope > .warehouse-mobile-col')];
      if (!directCards.length && cols.length === 2) {
        container.classList.add('warehouse-mobile-columns');
        return;
      }
      if (!directCards.length) return;
      const sentinel = container.querySelector(':scope > .warehouse-scroll-sentinel');
      if (sentinel) sentinel.remove();
      distributeWarehouseMobileCards(container, directCards);
      if (sentinel) container.appendChild(sentinel);
    }

    async function renderCards(reset = false) {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      const mobileGrid = isMobileViewport();
      const searchEl = document.getElementById('searchInputMobile') || document.getElementById('searchInput');
      const search = (searchEl?.value || '').toLowerCase();
      sortMode = document.getElementById('sortSelect')?.value || sortMode || 'updated-desc';

      if (reset) {
        page = 1;
        allFilteredCards = [];
        warehouseRenderedPages.clear();
        warehouseRenderedPages.add(1);
      } else if (!warehouseRenderedPages.has(page)) {
        warehouseRenderedPages.add(page);
      }
      if (reset || allFilteredCards.length === 0) {
        allFilteredCards = getWarehouseFilteredSortedList(search);
      }

      const whSig = warehouseListSignature(allFilteredCards, {
        group: currentGroup,
        search,
        sort: sortMode,
        page,
        batch: batchMode,
        filters: [...activeFilters]
      });

      const pageSize = warehousePageSize();
      const start = (page - 1) * pageSize;
      const pageCards = allFilteredCards.slice(start, start + pageSize);
      const isAppend = !reset && page > 1;
      const warehouseActive = document.getElementById('pageWarehouse')?.classList.contains('active');

      if (
        reset
        && page === 1
        && !isAppend
        && warehouseActive
        && container.dataset.whSig === whSig
        && container.querySelector('.card[data-id]')
        && !warehousePageDomNeedsFullRender(container, pageCards)
      ) {
        container.className = 'cards-container' + (mobileGrid ? ' mobile-grid' : '');
        if (viewMode === 'list') container.classList.add('list-view');
        if (batchMode) container.classList.add('batch-mode');
        softHydrateWarehouseContainer(container, pageCards);
        updateBatchCountLabel();
        bindWarehousePagedScroll();
        if (mobileGrid) {
          repairWarehouseMobileColumns(container);
          syncWarehouseScrollSentinel(container);
          enforceMobileCardGrid();
          requestAnimationFrame(() => window.MobileUI?.boostActivePageImages?.());
        } else if (viewMode !== 'list') {
          requestAnimationFrame(() => {
            scheduleWarehouseMasonryLayout(true);
            syncWarehouseScrollSentinel(container);
            repositionWarehouseScrollSentinel(container);
          });
        } else {
          syncWarehouseScrollSentinel(container);
        }
        return;
      }

      const preservedWarehouseImgs = reset && mobileGrid && page === 1
        ? snapshotLoadedWarehouseImages(container)
        : new Map();

      if (reset) {
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
        container.innerHTML = '';
        delete container?.dataset?.masonryLoadBound;
        window.CardImageLoader?.disconnect?.();
        window.SupabaseSync?.clearSessionGridFetchFailures?.();
        container.classList.remove('cards-grid-primed', 'masonry-ready', 'cards-grid-priming');
      }
      container.className = 'cards-container' + (mobileGrid ? ' mobile-grid' : '');
      if (viewMode === 'list') {
        container.classList.add('list-view');
        container.classList.remove('cards-grid-priming', 'masonry-ready');
        if (masonryInstance) { masonryInstance.destroy(); masonryInstance = null; }
      }
      if (batchMode) container.classList.add('batch-mode');
      if (page === 1 && pageCards.length === 0) {
        if (masonryInstance) {
          try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
          masonryInstance = null;
        }
        delete container?.dataset?.masonryLoadBound;
        container.classList.remove('cards-grid-primed', 'masonry-ready', 'cards-grid-priming');
        container.classList.add('feed-grid-centered');
        container.innerHTML = '<div class="feature-empty warehouse-grid-empty"><p>📦 暂无卡片</p></div>';
        delete container.dataset.whSig;
        return;
      }
      container.classList.remove('feed-grid-centered');
      const perfCap = window.MobileUI?.getPerf?.()?.warehousePrefetchCap ?? 24;
      const prefetchCap = Math.min(perfCap, pageSize);
      const preparedRows = warehouseActive && window.PromptHubCardGallery?.prepareWarehousePageThumbs
        ? window.PromptHubCardGallery.prepareWarehousePageThumbs(pageCards, {
          ensure: page === 1 && !isAppend,
          ensureMax: Math.min(prefetchCap, pageCards.length || prefetchCap)
        })
        : pageCards.map((card) => ({ card, meta: null }));
      const fragment = document.createDocumentFragment();
      const eagerImgCount = mobileGrid
        ? Math.min(window.MobileUI?.getPerf?.()?.cardFirstScreenCap ?? 8, pageCards.length)
        : Math.min(24, pageCards.length);
      preparedRows.forEach(({ card, meta }, idx) => {
        if (container.querySelector(`.card[data-id="${CSS.escape(card.id)}"]`)) return;
        const listThumb = meta ? listThumbFromWarehouseMeta(meta) : getWarehouseCardListThumb(card, { skipEnsure: true });
        const coverMeta = listThumb.thumbMeta;
        const div = document.createElement('div');
        div.className = `card ${card.id === selectedCardId ? 'selected' : ''}${card.pinnedAt ? ' is-pinned' : ''}`;
        if (!mobileGrid && isAppend && viewMode !== 'list') {
          div.classList.add('card-enter-soft');
          const enterDelay = Math.min((idx % 12) * 0.025, 0.24);
          div.style.animationDelay = `${enterDelay.toFixed(3)}s`;
          const clearSoftEnter = (event) => {
            if (event.target !== div) return;
            div.classList.remove('card-enter-soft');
            div.style.animationDelay = '';
            div.removeEventListener('animationend', clearSoftEnter);
          };
          div.addEventListener('animationend', clearSoftEnter);
          window.setTimeout(() => {
            if (!div.isConnected) return;
            div.classList.remove('card-enter-soft');
            div.style.animationDelay = '';
            div.removeEventListener('animationend', clearSoftEnter);
          }, 900 + Math.round(enterDelay * 1000));
        } else if (!mobileGrid && pageCards.length <= 8 && reset) {
          div.classList.add('card-enter');
          div.style.animationDelay = `${Math.min(idx * 0.045, 0.36)}s`;
        }
        div.dataset.id = card.id;
        if (window.isCommunityCollectCard?.(card)) {
          div.dataset.communityCollect = '1';
          const collectMeta = getCommunityCollectImageResolveOpts(card);
          if (collectMeta?.authorId) div.dataset.authorId = collectMeta.authorId;
          if (collectMeta?.assetId) div.dataset.sourceCardId = collectMeta.assetId;
        }
        div.draggable = !globalViewActive;
        if (!mobileGrid) {
          div.style.position = 'relative';
        }
        const checked = selectedCardIds.has(card.id);
        if (checked) div.classList.add('batch-selected');
        const showImage = listThumb.show || !!(meta?.hasImage);
        if (showImage) div.classList.add('card--visual');
        else div.classList.add('card--text-only');
        div.dataset.mobileEstimate = String(estimateWarehouseMobileCardHeight(card, showImage));
        let coverImage = listThumb.coverImage || coverMeta?.ref || card.image || '';
        if (showImage && !coverImage && card.genJobId && window.PromptHubCardGallery?.ensureFeedCoverFromGallery) {
          window.PromptHubCardGallery.ensureFeedCoverFromGallery(card, { persist: false, backfill: false });
          coverImage = card.image
            || window.PromptHubCardGallery.getCardFeedCoverImage?.(card)
            || listThumb.coverImage
            || coverMeta?.ref
            || '';
        }
        const coverJobId = listThumb.coverJobId
          || coverMeta?.slotJobId
          || (card.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : '');
        const coverJobAttr = coverJobId ? ` data-job-id="${escapeHtml(coverJobId)}"` : '';
        const allowFullFallback = viewMode !== 'list' && showImage;
        const imgSrc = showImage ? (listThumb.src || cardImgInitialSrc(coverImage, card.id, {
          jobId: coverJobId,
          allowFullFallback
        })) : '';
        const isCollectCard = window.isCommunityCollectCard?.(card);
        const collectMeta = isCollectCard ? getCommunityCollectImageResolveOpts(card) : null;
        const needsAsyncThumb = showImage && !listThumb.immediate && !listThumb.src;
        const mediaLoadingCls = needsAsyncThumb ? ' is-loading' : '';
        const shineAt = '';
        const titleTrim = getCardDisplayTitle(card);
        const timeLabel = formatCardTime(card.createdAt || card.updatedAt);
        const tagsHtml = buildCardTagsHtml(card.tags);
        const pinBadge = card.pinnedAt
          ? '<span class="card-pin-badge" title="置顶" aria-label="置顶"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></span>'
          : '';
        const imgOnload = "if(typeof finishCardMediaShine==='function')finishCardMediaShine(this.closest('.card-media'))";
        const fetchPri = !isAppend && idx < 3 ? ' fetchpriority="high"' : '';
        const collectImgAttrs = isCollectCard && collectMeta?.authorId
          ? ` data-author-id="${escapeHtml(collectMeta.authorId)}" data-source-card-id="${escapeHtml(collectMeta.assetId || '')}"`
          : '';
        const fullFallbackAttr = allowFullFallback ? ' data-allow-full-fallback="1"' : '';
        const galleryCount = window.PromptHubCardGallery?.normalizeCardGallery?.(card)?.length || 0;
        const galleryBadge = galleryCount > 1
          ? `<span class="card-gallery-count" title="本卡 ${galleryCount} 张图">${galleryCount}</span>`
          : '';
        const mediaHtml = showImage
          ? `<div class="card-media${mediaLoadingCls}"${shineAt}>${galleryBadge}<img class="card-img" src="${escapeHtml(imgSrc)}"${cardImgDataAttr(coverImage)} data-image-ref="${escapeHtml(coverImage)}"${coverJobAttr}${collectImgAttrs}${fullFallbackAttr} loading="${!isAppend && idx < eagerImgCount ? 'eager' : 'lazy'}" decoding="async"${fetchPri} draggable="false" alt="" onload="${imgOnload}"></div>`
          : '';
        const headHtml = titleTrim
          ? `<div class="card-head"><div class="card-title">${escapeHtml(titleTrim)}</div>${timeLabel ? `<time class="card-time">${escapeHtml(timeLabel)}</time>` : ''}</div>`
          : (timeLabel ? `<div class="card-head card-head--meta-only"><time class="card-time">${escapeHtml(timeLabel)}</time></div>` : '');
        const mobileActions = window.MobileUI?.isMobile?.()
          ? `<div class="card-mobile-actions mobile-only">
              <button type="button" class="card-mobile-btn" data-mobile-edit="${escapeHtml(card.id)}">编辑</button>
              <button type="button" class="card-mobile-btn" data-mobile-copy="${escapeHtml(card.id)}">复制</button>
              <button type="button" class="card-mobile-btn" data-mobile-fill="${escapeHtml(card.id)}">填入生图</button>
            </div>`
          : '';
        const copyBtnHtml = !window.MobileUI?.isMobile?.()
          ? `<button type="button" class="card-copy-btn" data-card-copy="${escapeHtml(card.id)}" title="复制提示词" aria-label="复制提示词"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`
          : '';
        div.innerHTML = `
          <div class="card-checkbox ${checked ? 'checked' : ''}" onclick="event.stopPropagation(); toggleSelectCard('${card.id}', this)"></div>
          ${pinBadge}
          ${mediaHtml}
          <div class="card-body">
            ${headHtml}
            <div class="card-desc">${escapeHtml(getCardDisplayDesc(card, { textOnly: !showImage }))}</div>
            ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
            ${mobileActions}
          </div>
          ${copyBtnHtml}`;
        div.addEventListener('click', (e) => {
          if (e.target.closest('.card-copy-btn')) return;
          if (e.target.closest('.card-mobile-actions')) return;
          if (globalViewActive) {
            e.preventDefault();
            window.openAppreciateViewer?.(card.id);
            return;
          }
          if (e.target.closest('.card-checkbox')) return;
          rippleWarehouseCard(div, e.clientX, e.clientY);
          if (batchMode) {
            const cb = div.querySelector('.card-checkbox');
            toggleSelectCard(card.id, cb);
            return;
          }
          pulseWarehouseCard(div, 'press');
          if (mobileGrid) {
            if (e.target.closest('.card-img') && settings.imageClickZoom && cardHasDisplayImage(card)) {
              void openCardImageLightbox(card);
              return;
            }
            editCard(card.id);
            return;
          }
          editCard(card.id);
        });
        const img = div.querySelector('.card-img');
        if (img && card.image) {
          const zoomOnClick = !!settings.imageClickZoom;
          img.style.cursor = zoomOnClick ? 'zoom-in' : 'pointer';
          img.addEventListener('click', e => {
            e.stopPropagation();
            if (globalViewActive) {
              window.openAppreciateViewer?.(card.id);
              return;
            }
            if (batchMode) {
              const cb = div.querySelector('.card-checkbox');
              toggleSelectCard(card.id, cb);
              return;
            }
            if (zoomOnClick) void openCardImageLightbox(card);
            else if (!mobileGrid) editCard(card.id);
          });
        }
        div.addEventListener('dragstart', e => {
          if (globalViewActive) { e.preventDefault(); return; }
          const cardIds = getDragCardIds(div);
          e.dataTransfer.setData('text/plain', JSON.stringify(cardIds));
          e.dataTransfer.effectAllowed = 'move';
          startCardDragVisual(div, e, cardIds);
        });
        div.addEventListener('dragend', () => endCardDragVisual());
        div.addEventListener('contextmenu', e => {
          e.preventDefault();
          const pinLabel = card.pinnedAt ? '取消置顶' : '置顶';
          const items = [
            { label: pinLabel, action: () => toggleCardPinById(card.id) },
            { label: '删除', action: () => deleteCardPermanently(card.id) }
          ];
          const others = window.FeatureAssets?.getOtherWarehouses?.() || [];
          others.forEach((w) => {
            items.unshift({
              label: `移到「${w.name}」`,
              action: () => {
                const n = window.FeatureAssets?.moveCardsToWarehouse?.([card.id], w.id);
                if (n) {
                  showToast(`已移到「${w.name}」`);
                  renderGroups();
                  renderCards(true);
                }
              }
            });
          });
          showContextMenu(e.clientX, e.clientY, items);
        });
        fragment.appendChild(div);
      });
      const appendedCards = [...fragment.querySelectorAll('.card')];
      if (mobileGrid && viewMode !== 'list') {
        distributeWarehouseMobileCards(container, appendedCards);
      } else {
        container.classList.remove('warehouse-mobile-columns');
        container.querySelectorAll(':scope > .warehouse-mobile-col').forEach((col) => col.remove());
        container.appendChild(fragment);
      }
      if (page === 1 && !isAppend) container.dataset.whSig = whSig;
      restoreLoadedWarehouseImages(container, preservedWarehouseImgs);
      bindCardGridImageErrors(container);
      bindCardGridImageRelayout(container);
      if (warehouseActive) {
        hydrateWarehouseGridImages(container, pageCards);
      }
      if (!mobileGrid && viewMode !== 'list') {
        syncWarehouseScrollSentinel(container);
        if (isAppend && appendedCards.length) {
          primeDesktopCardGrid(container);
          preserveCardsContainerScroll(() => layoutMasonryGrid());
        } else {
          resetWarehouseGridLayout(container);
          requestAnimationFrame(layoutMasonryGrid);
        }
      } else if (mobileGrid) {
        enforceMobileCardGrid();
      }
      if (viewMode === 'list' && masonryInstance) {
        masonryInstance.destroy();
        masonryInstance = null;
      }
      updateBatchCountLabel();
      bindWarehousePagedScroll();
      if (mobileGrid || viewMode === 'list') {
        syncWarehouseScrollSentinel(container);
      }
      if (mobileGrid) {
        container.classList.add('cards-grid-primed');
        enforceMobileCardGrid();
        requestAnimationFrame(() => {
          window.MobileUI?.boostActivePageImages?.();
          window.MobileUI?.scheduleMobileImageBoostBurst?.();
        });
      }
    }

    let warehouseScrollBoundEl = null;
    let warehousePageObserver = null;
    let warehouseScrollSentinel = null;
    let warehouseScrollLoading = false;
    function isUsableWarehouseScrollRoot(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.height < 120 || rect.width < 120) return false;
      const st = getComputedStyle(el);
      return /(auto|scroll|overlay)/.test(st.overflowY || '') || el.scrollHeight > el.clientHeight + 2;
    }
    const warehouseScrollRoot = () => {
      if (!isMobileViewport()) return document.getElementById('cardsContainer');
      const appMain = document.querySelector('.app-main');
      if (isUsableWarehouseScrollRoot(appMain)) return appMain;
      return document.scrollingElement || document.documentElement;
    };
    function loadNextWarehousePage() {
      if (warehouseScrollLoading) return;
      if ((page * warehousePageSize()) >= allFilteredCards.length) return;
      const nextPage = page + 1;
      if (warehouseRenderedPages.has(nextPage)) return;
      warehouseScrollLoading = true;
      warehousePageObserver?.disconnect();
      page = nextPage;
      void Promise.resolve(renderCards()).finally(() => {
        warehouseScrollLoading = false;
        const container = document.getElementById('cardsContainer');
        if (container) syncWarehouseScrollSentinel(container);
      });
    }
    function syncWarehouseScrollSentinel(container) {
      if (!container) return;
      container.querySelectorAll('.warehouse-scroll-sentinel').forEach((el) => el.remove());
      if ((page * warehousePageSize()) >= allFilteredCards.length) {
        warehousePageObserver?.disconnect();
        warehouseScrollSentinel = null;
        return;
