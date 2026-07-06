      }
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      const sentinel = document.createElement('div');
      sentinel.className = 'warehouse-scroll-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      sentinel.dataset.ready = isMobileViewport() || viewMode === 'list' ? '1' : '0';
      container.appendChild(sentinel);
      warehouseScrollSentinel = sentinel;
      warehousePageObserver?.disconnect();
      const root = warehouseScrollRoot();
      if (!root) return;
      warehousePageObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (sentinel.dataset.ready !== '1') return;
        loadNextWarehousePage();
      }, {
        root: root === document.body ? null : root,
        rootMargin: isMobileViewport() ? '180px 0px' : '320px 0px',
        threshold: 0
      });
      warehousePageObserver.observe(sentinel);
    }
    /** Masonry 绝对定位后 sentinel 会漂到顶部，需钉在最后一行卡片下方 */
    function repositionWarehouseScrollSentinel(container) {
      const sentinel = warehouseScrollSentinel;
      if (!sentinel || !container?.contains(sentinel)) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list' || isMobileViewport()) {
        sentinel.removeAttribute('style');
        return;
      }
      const cards = container.querySelectorAll('.card');
      if (!cards.length) return;
      let maxBottom = 0;
      cards.forEach((card) => {
        const top = parseFloat(card.style.top);
        const h = card.offsetHeight || 0;
        if (Number.isFinite(top)) maxBottom = Math.max(maxBottom, top + h);
        else maxBottom = Math.max(maxBottom, (card.offsetTop || 0) + h);
      });
      const gap = typeof getMasonryGap === 'function' ? getMasonryGap() : 16;
      const topPx = maxBottom + gap;
      sentinel.style.cssText = [
        'position:absolute',
        'left:0',
        'right:0',
        'width:100%',
        'height:40px',
        `top:${topPx}px`,
        'pointer-events:none',
        'visibility:hidden'
      ].join(';');
      sentinel.dataset.ready = '1';
      const needH = topPx + 40;
      const masonryH = parseFloat(container.style.height);
      if (!Number.isFinite(masonryH) || needH > masonryH) {
        container.style.height = `${needH}px`;
      }
      if (warehousePageObserver) {
        warehousePageObserver.unobserve(sentinel);
        warehousePageObserver.observe(sentinel);
      }
    }
    function bindWarehousePagedScroll() {
      const el = warehouseScrollRoot();
      if (!el) return;
      if (warehouseScrollBoundEl === el) return;
      if (warehouseScrollBoundEl) {
        warehouseScrollBoundEl.removeEventListener('scroll', onWarehouseScroll);
      }
      warehouseScrollBoundEl = el;
      el.addEventListener('scroll', onWarehouseScroll, { passive: true });
    }
    function onWarehouseScroll() {
      const wh = document.getElementById('cardsContainer');
      if (!wh) return;
      if (!warehouseScrollLoading && (page * warehousePageSize()) < allFilteredCards.length) {
        const root = warehouseScrollRoot();
        if (root) {
          const remain = root.scrollHeight - root.scrollTop - root.clientHeight;
          if (remain < 480) loadNextWarehousePage();
        }
      }
      if (warehouseScrollLoading) return;
      const cap = isMobileViewport()
        ? (window.MobileUI?.getPerf?.()?.cardEagerCap ?? 24)
        : Math.min(warehousePageSize(), 24);
      window.CardImageLoader?.boostWarehouseImages?.(wh, cap);
    }
    bindWarehousePagedScroll();

    document.getElementById('cardsContainer')?.addEventListener('click', (e) => {
      const editId = e.target.closest('[data-mobile-edit]')?.getAttribute('data-mobile-edit');
      if (editId) {
        e.stopPropagation();
        editCard(editId);
        return;
      }
      const copyId = e.target.closest('[data-mobile-copy]')?.getAttribute('data-mobile-copy')
        || e.target.closest('[data-card-copy]')?.getAttribute('data-card-copy');
      if (copyId) {
        e.stopPropagation();
        copyCardPromptById(copyId);
        return;
      }
      const fillId = e.target.closest('[data-mobile-fill]')?.getAttribute('data-mobile-fill');
      if (fillId) {
        e.stopPropagation();
        fillCardToImageGen(fillId);
      }
    });

    function enableGroupDrop() {
      document.querySelectorAll('.group-item').forEach(item => {
        item.addEventListener('dragenter', e => {
          if (!cardDragVisual) return;
          e.preventDefault();
          item.classList.add('group-drag-over');
        });
        item.addEventListener('dragleave', e => {
          if (!item.contains(e.relatedTarget)) item.classList.remove('group-drag-over');
        });
        item.addEventListener('dragover', e => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('drop', e => {
          e.preventDefault();
          item.classList.remove('group-drag-over');
          const raw = e.dataTransfer.getData('text/plain');
          let cardIds = []; try { cardIds = JSON.parse(raw); } catch (err) { cardIds = [raw]; }
          if (!Array.isArray(cardIds)) cardIds = [cardIds];
          const targetGroup = item.dataset.group;
          cardIds.forEach(id => {
            const c = cards.find(x => x.id === id);
            if (c) {
              c.group = (targetGroup === 'all' || targetGroup === 'uncategorized') ? null : targetGroup;
              c.updatedAt = Date.now();
            }
          });
          void (async () => {
            await saveAllData();
            renderGroups();
            preserveCardsContainerScroll(() => renderCards(true));
          })();
          if (batchMode) { selectedCardIds.clear(); cancelBatch(); }
          return;
        });
      });
    }

    function updateBatchCountLabel() {
      const el = document.getElementById('batchCountLabel');
      if (el) el.textContent = selectedCardIds.size ? `已选 ${selectedCardIds.size} 张` : '';
    }

    function syncBatchCheckboxUi() {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      container.querySelectorAll('.card[data-id]').forEach((card) => {
        const id = card.dataset.id;
        const on = selectedCardIds.has(id);
        card.classList.toggle('batch-selected', on);
        const cb = card.querySelector('.card-checkbox');
        if (cb) cb.classList.toggle('checked', on);
      });
      updateBatchCountLabel();
    }

    function setBatchModeUi(on) {
      const btn = document.getElementById('batchToggleBtn');
      btn?.classList.toggle('active', on);
      document.getElementById('batchBar')?.classList.toggle('active', on);
      const normalBar = document.getElementById('normalBar');
      if (normalBar) normalBar.style.display = on ? 'none' : 'flex';
      const container = document.getElementById('cardsContainer');
      if (container) container.classList.toggle('batch-mode', on);
    }

    function toggleBatchMode() {
      batchMode = !batchMode;
      selectedCardIds.clear();
      setBatchModeUi(batchMode);
      syncBatchCheckboxUi();
    }

    function cancelBatch() {
      batchMode = false;
      selectedCardIds.clear();
      setBatchModeUi(false);
      syncBatchCheckboxUi();
    }

    function toggleSelectCard(id, el) {
      if (!id) return;
      const cardEl = el?.closest?.('.card') || document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (selectedCardIds.has(id)) {
        selectedCardIds.delete(id);
        if (el) el.classList.remove('checked');
        cardEl?.classList.remove('batch-selected');
      } else {
        selectedCardIds.add(id);
        if (el) el.classList.add('checked');
        cardEl?.classList.add('batch-selected');
        pulseWarehouseCard(cardEl, 'press');
      }
      updateBatchCountLabel();
    }

    let batchProgressVisible = false;

    function showBatchProgress(title, done, total) {
      const ov = document.getElementById('batchProgressOverlay');
      const titleEl = document.getElementById('batchProgressTitle');
      const fill = document.getElementById('batchProgressFill');
      const meta = document.getElementById('batchProgressMeta');
      if (!ov) return;
      batchProgressVisible = true;
      ov.classList.remove('hidden');
      ov.setAttribute('aria-busy', 'true');
      if (titleEl) titleEl.textContent = title || '正在处理…';
      const t = Math.max(1, Number(total) || 1);
      const d = Math.min(t, Math.max(0, Number(done) || 0));
      const pct = Math.round((d / t) * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (meta) meta.textContent = `${d} / ${t}（${pct}%）`;
    }

    function hideBatchProgress() {
      if (!batchProgressVisible) return;
      batchProgressVisible = false;
      const ov = document.getElementById('batchProgressOverlay');
      ov?.classList.add('hidden');
      ov?.setAttribute('aria-busy', 'false');
    }

    async function runBatchWithProgress(title, items, worker) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return;
      showBatchProgress(title, 0, list.length);
      try {
        for (let i = 0; i < list.length; i += 1) {
          await worker(list[i], i);
          showBatchProgress(title, i + 1, list.length);
          if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        hideBatchProgress();
      }
    }

    async function rerenderWarehouseCardsKeepingScroll() {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      const st = container.scrollTop;
      const targetPage = Math.max(1, page);
      const sel = new Set(selectedCardIds);
      const wasBatch = batchMode;
      warehouseRenderedPages.clear();
      page = 1;
      await Promise.resolve(renderCards(true));
      for (let p = 2; p <= targetPage; p += 1) {
        page = p;
        warehouseRenderedPages.add(p);
        await Promise.resolve(renderCards(false));
      }
      if (wasBatch) {
        batchMode = true;
        selectedCardIds = sel;
        setBatchModeUi(true);
        syncBatchCheckboxUi();
      }
      container.scrollTop = st;
      requestAnimationFrame(() => {
        container.scrollTop = st;
        layoutMasonryGrid();
      });
    }

    function initBatchMarqueeSelect() {
      const container = document.getElementById('cardsContainer');
      if (!container || container.dataset.batchMarqueeBound) return;
      container.dataset.batchMarqueeBound = '1';
      let pending = null;
      let drag = null;
      let rectEl = null;
      const DRAG_THRESHOLD = 8;

      const hitTest = (x1, y1, x2, y2) => {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        const hits = [];
        container.querySelectorAll('.card[data-id]').forEach((card) => {
          const r = card.getBoundingClientRect();
          if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) return;
          hits.push(card.dataset.id);
        });
        return hits;
      };

      const clearMarquee = () => {
        rectEl?.remove();
        rectEl = null;
        drag = null;
        pending = null;
        container.classList.remove('batch-marquee-active');
      };

      const finishDrag = (e) => {
        if (!drag) return;
        const ids = hitTest(drag.x, drag.y, e.clientX, e.clientY);
        const add = !e.altKey;
        ids.forEach((id) => {
          if (add) selectedCardIds.add(id);
          else selectedCardIds.delete(id);
        });
        syncBatchCheckboxUi();
        clearMarquee();
      };

      container.addEventListener('mousedown', (e) => {
        if (!batchMode || e.button !== 0) return;
        if (e.target.closest('.card-checkbox, .card-copy-btn, .card-mobile-actions, button, a, input, textarea, select')) return;
        if (!e.target.closest('.cards-container')) return;
        pending = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('mousemove', (e) => {
        if (!pending && !drag) return;
        if (pending && !drag) {
          const dx = Math.abs(e.clientX - pending.x);
          const dy = Math.abs(e.clientY - pending.y);
          if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
          drag = { x: pending.x, y: pending.y };
          pending = null;
          container.classList.add('batch-marquee-active');
          rectEl = document.createElement('div');
          rectEl.className = 'batch-select-rect';
          document.body.appendChild(rectEl);
        }
        if (!drag || !rectEl) return;
        const left = Math.min(drag.x, e.clientX);
        const top = Math.min(drag.y, e.clientY);
        rectEl.style.left = `${left}px`;
        rectEl.style.top = `${top}px`;
        rectEl.style.width = `${Math.abs(e.clientX - drag.x)}px`;
        rectEl.style.height = `${Math.abs(e.clientY - drag.y)}px`;
      });

      window.addEventListener('mouseup', (e) => {
        if (drag) finishDrag(e);
        else pending = null;
      });
    }
    function batchMoveGroup() {
      if (!selectedCardIds.size) return;
      const groups = ['all', 'uncategorized', ...customGroups];
      customPrompt(`输入目标分组 (${groups.join('/')})`, '', (target) => {
        if (!target || !groups.includes(target)) return;
        const gv = target === 'all' || target === 'uncategorized' ? null : target;
        const now = Date.now();
        selectedCardIds.forEach((id) => {
          const c = cards.find((x) => x.id === id);
          if (c) {
            c.group = gv;
            c.updatedAt = now;
          }
        });
        showBatchProgress('正在移动分组…', 0, selectedCardIds.size);
        saveAllData();
        hideBatchProgress();
        cancelBatch();
        renderGroups();
        void rerenderWarehouseCardsKeepingScroll();
      }, null, groups);
    }
    function batchMoveWarehouse() {
      if (!selectedCardIds.size) return;
      const others = window.FeatureAssets?.getOtherWarehouses?.() || [];
      if (!others.length) { showToast('请先创建其他卡片库'); return; }
      const labels = others.map(w => w.name);
      customPrompt('输入目标卡片库名称', '', (name) => {
        const target = others.find(w => w.name === name);
        if (!target) return;
        const n = window.FeatureAssets?.moveCardsToWarehouse?.([...selectedCardIds], target.id);
        if (n) {
          showBatchProgress('正在移库…', n, n);
          saveAllData({ skipCloud: true });
          hideBatchProgress();
          showToast(`已将 ${n} 张卡片移到「${target.name}」`);
          cancelBatch();
          renderGroups();
          void rerenderWarehouseCardsKeepingScroll();
        }
      }, null, labels);
    }
    async function refreshCommunityAfterBatchPublish() {
      window.FeatureDraft?.maybeReconcileCommunityWithCards?.(cards, { force: true });
      if (document.getElementById('pageCommunity')?.classList.contains('active')) {
        void window.FeatureDraft?.refreshPublicCommunityFeed?.({ force: true }).then(() => {
          window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
        });
      }
      if (document.getElementById('pageCreations')?.classList.contains('active')) {
        void window.FeatureDraft?.renderCreations?.();
      }
    }

    async function batchPublishCommunity() {
      if (!selectedCardIds.size) return;
      if (!isUserLoggedIn()) {
        requireAuth('publish');
        return;
      }
      const ids = [...selectedCardIds];
      let ok = 0;
      let already = 0;
      let skipCollect = 0;
      let skipIneligible = 0;
      await runBatchWithProgress('正在开启社区公开…', ids, async (id) => {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        if (window.isCommunityCollectCard?.(card)) {
          skipCollect += 1;
          return;
        }
        if (card.publishedToCommunity) {
          already += 1;
          return;
        }
        if (!window.FeatureDraft?.isCommunityPublishEligible?.(card)) {
          skipIneligible += 1;
          return;
        }
        await window.FeatureDraft?.syncCardToCommunity?.(card, true, {
          silent: true,
          skipRender: true,
          skipPersist: true,
          keepPublishFlag: true
        });
        if (card.publishedToCommunity) ok += 1;
      });
      window.__promptHubCards = cards;
      if (ok > 0) {
        showBatchProgress('正在保存并同步社区…', 1, 2);
        await saveAllData({ skipCloud: true });
        if (window.SupabaseSync?.isLoggedIn?.()) {
          scheduleCloudPush();
          void window.FeatureDraft?.syncMyPostsToPublicFeed?.();
        }
        showBatchProgress('正在刷新社区 Feed…', 2, 2);
        await refreshCommunityAfterBatchPublish();
        hideBatchProgress();
      }
      cancelBatch();
      syncBatchCheckboxUi();
      const parts = [];
      if (ok) parts.push(`已公开 ${ok} 张`);
      if (already) parts.push(`${already} 张已是公开`);
      if (skipIneligible) parts.push(`${skipIneligible} 张不满足条件（提示词≥15字且需配图）`);
      if (skipCollect) parts.push(`${skipCollect} 张为社区收藏不可公开`);
      if (!parts.length) showToast('没有可公开的卡片');
      else showToast(parts.join('；'));
    }

    async function batchUnpublishCommunity() {
      if (!selectedCardIds.size) return;
      const ids = [...selectedCardIds];
      let n = 0;
      await runBatchWithProgress('正在关闭社区公开…', ids, async (id) => {
        const card = cards.find((c) => c.id === id);
        if (!card?.publishedToCommunity) return;
        await window.FeatureDraft?.unpublishCommunityByCardId?.(id, { silent: true });
        n += 1;
      });
      if (!n) {
        showToast('所选卡片均未公开到社区');
        return;
      }
      window.__promptHubCards = cards;
      showBatchProgress('正在保存…', 1, 1);
      await saveAllData({ skipCloud: true });
      if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush();
      await refreshCommunityAfterBatchPublish();
      hideBatchProgress();
      cancelBatch();
      syncBatchCheckboxUi();
      showToast(`已关闭 ${n} 张卡片的社区公开`);
    }

    function batchAddTag() {
      if (!selectedCardIds.size) return;
      const allTags = window.getSelectableCardTags?.(cards) || [];
      customPrompt('输入标签名（不含#）', '', (tag) => {
        if (!tag) return;
        if (window.isCommunityCollectTagName?.(tag)) {
          showToast('「社区收藏」标签仅收藏时自动添加');
          return;
        }
        const ids = [...selectedCardIds];
        showBatchProgress('正在添加标签…', 0, ids.length);
        ids.forEach((id, i) => {
          const c = cards.find((x) => x.id === id);
          if (c) {
            if (!c.tags) c.tags = [];
            if (!c.tags.includes(tag)) c.tags.push(tag);
          }
          showBatchProgress('正在添加标签…', i + 1, ids.length);
        });
        saveAllData();
        hideBatchProgress();
        cancelBatch();
        void rerenderWarehouseCardsKeepingScroll();
      }, null, allTags);
    }
    function batchDelete() {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        showToast('请先登录后再删除卡片');
        openAuthModal('login');
        return;
      }
      if (!selectedCardIds.size) return;
      customConfirm(`确定永久删除 ${selectedCardIds.size} 张卡片？此操作不可恢复。`, () => {
        void (async () => {
          const ids = [...selectedCardIds];
          await runBatchWithProgress('正在删除卡片…', ids, async (id) => {
            await deleteCardPermanently(id, false, { skipRender: true, silent: true });
          });
          cancelBatch();
          renderGroups();
          await rerenderWarehouseCardsKeepingScroll();
          showToast('已删除所选卡片');
        })();
      });
    }
    function removeWarehouseCardFromDom(id) {
      const container = document.getElementById('cardsContainer');
      if (!container) return;
      const cardEl = container.querySelector(`.card[data-id="${CSS.escape(String(id))}"]`);
      if (cardEl) {
        if (masonryInstance && typeof masonryInstance.remove === 'function') {
          masonryInstance.remove(cardEl);
          masonryInstance.layout();
        } else {
          cardEl.remove();
        }
      }
      allFilteredCards = allFilteredCards.filter((c) => c.id !== id);
      selectedCardIds.delete(id);
      if (allFilteredCards.length === 0 && page === 1) {
        container.classList.add('feed-grid-centered');
        container.innerHTML = '<div class="feature-empty warehouse-grid-empty"><p>📦 暂无卡片</p></div>';
        if (masonryInstance) {
          try { masonryInstance.destroy(); } catch (e) { /* ignore */ }
          masonryInstance = null;
        }
        return;
      }
      requestAnimationFrame(() => scheduleWarehouseMasonryLayout());
    }

    function deleteCardPermanently(id, confirm = true, opts = {}) {
      const card = cards.find(c => c.id === id);
      if (card?.image && window.SupabaseSync?.isStorageRef?.(card.image) && !window.SupabaseSync?.isLoggedIn?.()) {
        showToast('请先登录后再操作云端卡片');
        openAuthModal('login');
        return;
      }
      const doDelete = async () => {
        const card = cards.find(c => c.id === id);
        if (!card) return;
        recordCardDeletion(id);
        window.FeatureDraft?.onCardDeletedForGen?.(card);
        const cardPostId = card?.communityPostId;
        if (cardPostId) recordCommunityPostDeletion(cardPostId);
        cards = cards.filter(c => c.id !== id);
        window.__promptHubCards = cards;
        window.invalidateWarehouseCardsForImageGenCache?.();
        if (selectedCardId === id) {
          selectedCardId = null;
          if (!opts.skipRender) {
            resetNewCardForm();
            highlightSelectedCard(null);
          }
        }
        if (!opts.skipRender) {
          removeWarehouseCardFromDom(id);
          renderGroups();
          if (document.getElementById('pageCommunity')?.classList.contains('active')) {
            requestAnimationFrame(() => {
              window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true });
            });
          }
          if (document.getElementById('pageImageGen')?.classList.contains('active')) {
            window.FeatureDraft?.renderImageGenFeed?.({ preserveScroll: true });
          }
          if (!opts.silent) showToast('已删除卡片');
        }
        void (async () => {
          try {
            if (card?.image && window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync.isStorageRef(card.image)) {
              try {
                await window.SupabaseSync.deleteCardImageByUrl(card.image, {
                  allowGenerated: true,
                  excludeCardId: id,
                  force: true,
                  genJobId: card.genJobId
                });
              } catch (e) { /* ignore */ }
            }
            await window.FeatureDraft?.unpublishCommunityByCardId?.(id, { silent: true });
            await saveAllData();
            if (window.SupabaseSync?.isLoggedIn?.()) {
              try { await pushToCloud({ silent: true }); } catch (e) { scheduleCloudPush(); }
            }
          } catch (e) {
            console.warn('[deleteCard] background cleanup failed', e);
          }
        })();
      };
      if (confirm) {
        customConfirm('确定永久删除该卡片？此操作不可恢复。', () => { void doDelete(); });
        return;
      }
      return doDelete();
    }
    window.deleteCardPermanently = deleteCardPermanently;

    let editCardFillSeq = 0;
    let panelPreviewSeq = 0;
    let panelGalleryIndex = 0;
    let panelDraftGallery = [];
    let panelDraftUploads = {};

    function panelGalleryMax() {
      return window.PromptHubCardGallery?.MAX || 5;
    }

    function commitPanelDraftSlot() {
      if (!panelDraftGallery.length && imageData) {
        panelDraftGallery = [imageData];
        return;
      }
      if (!panelDraftGallery.length) return;
      panelDraftGallery[panelGalleryIndex] = imageData;
    }

    function syncPanelDraftFromCard(card) {
      panelDraftGallery = getEditPanelCardGallery(card).slice(0, panelGalleryMax());
      panelDraftUploads = {};
      panelGalleryIndex = 0;
    }

    function getPanelDraftGalleryForSave() {
      commitPanelDraftSlot();
      return panelDraftGallery.filter(Boolean).slice(0, panelGalleryMax());
    }

    function updatePanelAddImageBtn() {
      const btn = document.getElementById('panelAddImageBtn');
      if (!btn) return;
      commitPanelDraftSlot();
      const count = panelDraftGallery.filter(Boolean).length;
      const full = count >= panelGalleryMax();
      btn.disabled = full;
      btn.textContent = full ? `已满 ${panelGalleryMax()} 张` : (count > 0 ? `添加图片 (${count}/${panelGalleryMax()})` : '添加图片');
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e.target.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    async function setPanelDraftSlot(index, file, dataUrl) {
      const max = panelGalleryMax();
      commitPanelDraftSlot();
      while (panelDraftGallery.length <= index) panelDraftGallery.push(null);
      panelDraftGallery[index] = dataUrl;
      if (file) panelDraftUploads[index] = file;
      else delete panelDraftUploads[index];
      panelGalleryIndex = index;
      imageData = dataUrl;
      imageRemovalPending = false;
      pendingUploadFile = file || null;
      pendingUploadBytes = file?.size || estimateDataUrlBytes(dataUrl);
      cardOriginalReuploadRequired = false;
      const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
      syncPanelGalleryNav(card || { cardImages: panelDraftGallery, image: panelDraftGallery[0] || null });
      updatePanelAddImageBtn();
      await updatePreview();
      updateCardImageSizeHint({ bytes: pendingUploadBytes });
    }

    async function appendPanelImagesFromFiles(files) {
      if (!isEditPanelOpen()) return;
      const max = panelGalleryMax();
      commitPanelDraftSlot();
      const list = Array.from(files || []).filter((f) => f && f.type.startsWith('image/'));
      if (!list.length) return;
      let start = panelDraftGallery.filter(Boolean).length;
      if (!start && !panelDraftGallery.length) start = 0;
      else if (panelDraftGallery[panelGalleryIndex]) start = Math.max(start, panelGalleryIndex + 1);
      else start = panelGalleryIndex;
      let added = 0;
      for (const file of list) {
        if (panelDraftGallery.filter(Boolean).length >= max) break;
        let idx = panelDraftGallery.findIndex((x, i) => i >= start && !x);
        if (idx < 0) idx = panelDraftGallery.length;
        if (idx >= max) break;
        const dataUrl = await readFileAsDataUrl(file);
        await setPanelDraftSlot(idx, file, dataUrl);
        start = idx + 1;
        added += 1;
      }
      if (added > 1) showToast(`已添加 ${added} 张图片到当前卡片`);
      else if (added === 1 && panelDraftGallery.filter(Boolean).length > 1) {
        showToast(`当前卡片共 ${panelDraftGallery.filter(Boolean).length} 张图`);
      }
    }

    function getEditPanelCardGallery(card) {
      return window.EditPanelGallery?.getCardGallery?.(card)
        || (card?.image ? [card.image] : []);
    }

    function getEditPanelCardJobId(card) {
      return window.EditPanelGallery?.getCardJobId?.(card)
        || window.PromptHubCardGallery?.resolveGenJobIdFromCard?.(card)
        || (card?.genJobId ? String(card.genJobId).replace(/#\d+$/, '') : null);
    }

    function getEditPanelSlotJobId(card, galleryIndex) {
      const slotJobId = window.EditPanelGallery?.getSlotJobId?.(card, galleryIndex);
      if (slotJobId) return slotJobId;
      const baseJobId = getEditPanelCardJobId(card);
      return baseJobId && window.PromptHubCardGallery?.gallerySlotJobId?.(baseJobId, galleryIndex)
        || baseJobId
        || null;
    }

    function isPanelDisplayableImageUrl(url) {
      return window.EditPanelGallery?.isDisplayableImageUrl?.(url) ?? !!(url
        && /^(https?:|blob:|data:image\/)/i.test(String(url))
        && !String(url).includes('data:image/svg'));
    }

    async function resolveEditPanelGalleryPreview(ref, card, galleryIndex) {
      return window.EditPanelGallery?.resolvePreview?.(ref, card, galleryIndex, {
        cardId: card?.id || selectedCardId || null
      }) || '';
    }

    function syncPanelGalleryNav(card) {
      const nav = document.getElementById('panelGalleryNav');
      const counter = document.getElementById('panelGalleryCounter');
      const prevBtn = document.getElementById('panelGalleryPrev');
      const nextBtn = document.getElementById('panelGalleryNext');
      if (!nav || !counter) return;
      commitPanelDraftSlot();
      const gallery = panelDraftGallery.length
        ? panelDraftGallery.filter(Boolean)
        : getEditPanelCardGallery(card);
      if (!gallery.length || gallery.length <= 1) {
        nav.classList.add('hidden');
        if (!gallery.length) panelGalleryIndex = 0;
        updatePanelAddImageBtn();
        return;
      }
      panelGalleryIndex = Math.max(0, Math.min(panelGalleryIndex, gallery.length - 1));
      nav.classList.remove('hidden');
      counter.textContent = `${panelGalleryIndex + 1} / ${gallery.length}`;
      if (prevBtn) prevBtn.disabled = panelGalleryIndex <= 0;
      if (nextBtn) nextBtn.disabled = panelGalleryIndex >= gallery.length - 1;
      updatePanelAddImageBtn();
    }

    function stepPanelGallery(delta) {
      if (!isEditPanelOpen()) return;
      if (isNewCardMode && !panelDraftGallery.length && !imageData) return;
      if (!isNewCardMode && !selectedCardId) return;
      commitPanelDraftSlot();
      const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
      const gallery = panelDraftGallery.length ? panelDraftGallery : getEditPanelCardGallery(card);
      if (gallery.filter(Boolean).length <= 1) return;
      panelGalleryIndex = Math.max(0, Math.min(panelGalleryIndex + delta, gallery.length - 1));
      imageData = gallery[panelGalleryIndex] || null;
      pendingUploadFile = panelDraftUploads[panelGalleryIndex] || null;
      pendingUploadBytes = pendingUploadFile?.size || estimateDataUrlBytes(imageData);
      imageRemovalPending = !imageData;
      syncPanelGalleryNav(card);
      const dropArea = document.getElementById('dropArea');
      const img = document.getElementById('previewImage');
      dropArea?.classList.add('is-loading-preview');
      if (img) {
        img.removeAttribute('src');
        delete img.dataset.previewFullUrl;
      }
      const slotJobId = getEditPanelSlotJobId(card, panelGalleryIndex);
      const prefetchOpts = {
        assetId: selectedCardId,
        cardId: selectedCardId,
        jobId: slotJobId || undefined,
        galleryIndex: panelGalleryIndex
      };
      if (panelGalleryIndex > 0) {
        const nextIdx = panelGalleryIndex + 1;
        if (nextIdx < gallery.length && window.MediaPipeline?.resolveListUrl) {
          void window.MediaPipeline.resolveListUrl(gallery[nextIdx], {
            ...prefetchOpts,
            jobId: getEditPanelSlotJobId(card, nextIdx) || undefined,
            galleryIndex: nextIdx
          });
        }
      }
      if (panelGalleryIndex > 0 && window.MediaPipeline?.resolveListUrl) {
        void window.MediaPipeline.resolveListUrl(gallery[panelGalleryIndex - 1], {
          ...prefetchOpts,
          jobId: getEditPanelSlotJobId(card, panelGalleryIndex - 1) || undefined,
          galleryIndex: panelGalleryIndex - 1
        });
      }
      void updatePreview();
    }

    function clearPanelPreviewImage() {
      const img = document.getElementById('previewImage');
      const dropArea = document.getElementById('dropArea');
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.style.display = 'none';
      }
      dropArea?.classList.remove('is-loading-preview', 'has-image');
      dropArea?.classList.add('no-image');
    }

    function stashEditPanelDraft() {
      const prompt = (document.getElementById('floatingPromptText')?.value
        || document.getElementById('cardPrompt')?.value || '').trim();
      const title = (document.getElementById('cardTitle')?.value || '').trim();
      if (!imageData && !pendingUploadFile && !prompt && !title && !currentTags.length) {
        return;
      }
      editPanelStashedDraft = {
        cardId: selectedCardId,
        isNewCardMode: !!isNewCardMode,
        imageData,
        pendingUploadBytes,
        imageRemovalPending: !!imageRemovalPending,
        prompt,
        title,
        tags: [...currentTags],
        customFields: { ...currentCardCustomFields }
      };
    }

    function tryRestoreEditPanelDraft(cardId, isNew) {
      const d = editPanelStashedDraft;
      if (!d) return false;
      if (!!d.isNewCardMode !== !!isNew) return false;
      if (!isNew && String(d.cardId) !== String(cardId)) return false;
      document.getElementById('cardTitle').value = d.title || '';
      document.getElementById('cardPrompt').value = d.prompt || '';
      document.getElementById('floatingPromptText').value = d.prompt || '';
      imageData = d.imageData || null;
      imageRemovalPending = !!d.imageRemovalPending;
      pendingUploadFile = null;
      pendingUploadBytes = d.pendingUploadBytes || estimateDataUrlBytes(imageData);
      currentTags = [...(d.tags || [])];
      currentCardCustomFields = { ...(d.customFields || {}) };
      cardOriginalReuploadRequired = false;
      editPanelStashedDraft = null;
      renderTags();
      renderCustomFields();
      void updatePreview();
      updateCardImageSizeHint();
      return true;
    }

    function editCard(id) {
      const card = cards.find(c => c.id === id); if (!card) return;
      panelPreviewSeq += 1;
      panelGalleryIndex = 0;
      panelDraftGallery = [];
      panelDraftUploads = {};
      clearPanelPreviewImage();
      selectedCardId = id; isNewCardMode = false;
      highlightSelectedCard(id);
      openEditPanel();
      document.getElementById('panelTitle').textContent = '编辑卡片';
      window.FeatureDraft?.setPublishCheckbox?.(card);
      const seq = ++editCardFillSeq;
      const fillForm = () => {
