        if (seq !== editCardFillSeq) return;
        if (tryRestoreEditPanelDraft(id, false)) {
          window.FeatureDraft?.setPublishCheckbox?.(card);
          updateDeleteClearButton();
          updatePinToggleUI();
          return;
        }
        document.getElementById('cardTitle').value = card.title || '';
        document.getElementById('cardPrompt').value = card.prompt || '';
        document.getElementById('floatingPromptText').value = card.prompt || '';
        const gallery = getEditPanelCardGallery(card);
        panelDraftGallery = gallery.slice();
        panelDraftUploads = {};
        imageData = gallery[panelGalleryIndex] || card.image || null;
        imageRemovalPending = false;
        pendingUploadFile = null;
        pendingUploadBytes = 0;
        cardOriginalReuploadRequired = false;
        currentTags = [...(card.tags || [])]; tempCustomFields = [];
        currentCardCustomFields = card.customFields ? { ...card.customFields } : {};
        window.FeatureDraft?.setPublishCheckbox?.(card);
        renderTags(); renderCustomFields();
        updateDeleteClearButton();
        updatePinToggleUI();
        syncPanelGalleryNav(card);
        void updatePreview();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fillForm);
      else fillForm();
    }
    window.editCardById = editCard;

    function resetNewCardForm() {
      editPanelStashedDraft = null;
      selectedCardId = null;
      isNewCardMode = true;
      panelDraftGallery = [];
      panelDraftUploads = {};
      document.getElementById('panelTitle').textContent = '新建卡片';
      document.getElementById('cardTitle').value = '';
      document.getElementById('cardPrompt').value = '';
      document.getElementById('cardPrompt').disabled = false;
      document.getElementById('cardPrompt').placeholder = '';
      document.getElementById('floatingPromptText').value = '';
      imageData = null;
      imageRemovalPending = false;
      pendingUploadFile = null;
      pendingUploadBytes = 0;
      currentTags = [];
      tempCustomFields = [];
      currentCardCustomFields = {};
      window.FeatureDraft?.clearPublishDraft?.();
      window.FeatureDraft?.setPublishCheckbox?.(null);
      cardOriginalReuploadRequired = false;
      document.getElementById('panelGalleryNav')?.classList.add('hidden');
      panelGalleryIndex = 0;
      updatePanelAddImageBtn();
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
      const modalFileInput = document.getElementById('modalFileInput');
      if (modalFileInput) modalFileInput.value = '';
      const statusEl = document.getElementById('statusMsg');
      if (statusEl) statusEl.textContent = '';
      clearPanelPreviewImage();
      renderTags();
      renderCustomFields();
      updatePreview();
      updateDeleteClearButton();
      updatePinToggleUI();
      updatePanelTrimToolVisibility();
    }

    function createNewCard(opts) {
      const check = canGuestCreateCard();
      if (!check.ok) {
        promptLogin(check.msg);
        return;
      }
      pulseFabButton();
      resetNewCardForm();
      highlightSelectedCard(null);
      const mobile = isMobileViewport();
      const shouldOpenPanel = !(mobile && opts?.silentMobile);
      if (shouldOpenPanel) {
        openEditPanel();
        if (tryRestoreEditPanelDraft(null, true)) {
          window.FeatureDraft?.setPublishCheckbox?.(null);
          updateDeleteClearButton();
          updatePinToggleUI();
        }
      }
    }

    const TRASH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    function updateDeleteClearButton() {
      const btn = document.getElementById('actionDeleteClearBtn');
      const mobileTop = document.getElementById('actionDeleteClearBtnMobileTop');
      if (isNewCardMode) {
        if (btn) {
          btn.style.display = 'none';
        }
        if (mobileTop) {
          mobileTop.style.display = 'inline-flex';
          mobileTop.title = '清空表单';
          mobileTop.setAttribute('aria-label', '清空表单');
          mobileTop.className = 'btn btn-ghost btn-sm mobile-only panel-header-clear-btn';
          mobileTop.textContent = '清空';
          mobileTop.onclick = () => clearCardForm();
        }
      } else {
        if (mobileTop) {
          mobileTop.style.display = 'inline-flex';
          mobileTop.title = '删除卡片';
          mobileTop.setAttribute('aria-label', '删除卡片');
          mobileTop.className = 'btn btn-ghost btn-sm mobile-only panel-header-delete-btn';
          mobileTop.textContent = '删除';
          mobileTop.onclick = () => {
            if (selectedCardId) deleteCardPermanently(selectedCardId, true);
          };
        }
        if (btn) {
          btn.style.display = 'inline-flex';
          btn.title = '删除卡片';
          btn.className = 'btn-icon-danger desktop-only';
          btn.innerHTML = TRASH_SVG;
          btn.onclick = () => {
            if (selectedCardId) deleteCardPermanently(selectedCardId, true);
          };
        }
      }
    }

    function clearCardForm() {
      createNewCard(isMobileViewport() ? { silentMobile: true } : undefined);
    }

    function readPanelCustomFields() {
      const customData = {};
      globalFields.forEach(f => {
        const el = document.querySelector(`[data-field-name="${f.name}"]`);
        customData[f.name] = el ? el.value : '';
      });
      document.querySelectorAll('[data-field-name]').forEach(el => {
        const name = el.dataset.fieldName;
        if (!globalFields.some(f => f.name === name)) {
          customData[name] = el.value;
        }
      });
      return customData;
    }

    function readPanelPromptText() {
      return floatingPromptActive
        ? document.getElementById('floatingPromptText').value.trim()
        : document.getElementById('cardPrompt').value.trim();
    }

    function newBatchItemId() {
      return 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(r.error || new Error('read failed'));
        r.readAsDataURL(file);
      });
    }

    function revokeBatchImportThumb(item) {
      if (!item?.thumbUrl) return;
      try { URL.revokeObjectURL(item.thumbUrl); } catch (e) { /* ignore */ }
      item.thumbUrl = '';
    }

    function clearBatchImportItems() {
      batchImportItems.forEach(revokeBatchImportThumb);
      batchImportItems = [];
      const input = document.getElementById('batchImportFileInput');
      if (input) input.value = '';
    }

    function syncBatchImportPromptFields() {
      const unifiedEl = document.getElementById('batchImportUnifiedPrompt');
      const grid = document.getElementById('batchImportGrid');
      if (!unifiedEl || !grid) return;
      const unifiedText = unifiedEl.value.trim();
      const hasIndividual = batchImportItems.some((it) => String(it.prompt || '').trim());
      grid.querySelectorAll('.batch-import-cell-prompt').forEach((el) => {
        const id = el.dataset.batchId;
        const row = batchImportItems.find((it) => it.id === id);
        if (unifiedText) {
          el.disabled = true;
          el.value = '';
          if (row) row.prompt = '';
          el.placeholder = '已使用统一提示词';
        } else {
          el.disabled = false;
          el.placeholder = '该图提示词';
          if (row) el.value = row.prompt || '';
        }
      });
      if (hasIndividual && !unifiedText) {
        unifiedEl.disabled = true;
        unifiedEl.placeholder = '已填写单独提示词，不可填统一提示词';
      } else {
        unifiedEl.disabled = false;
        unifiedEl.placeholder = batchImportItems.length
          ? '填写后所有图片共用此提示词'
          : '统一提示词（可选）';
      }
    }

    function renderBatchImportGrid() {
      const grid = document.getElementById('batchImportGrid');
      const saveBtn = document.getElementById('batchImportSaveBtn');
      if (!grid) return;
      grid.replaceChildren();
      if (!batchImportItems.length) {
        const empty = document.createElement('p');
        empty.className = 'batch-import-empty';
        empty.textContent = '尚未添加图片，可拖拽或点击上方区域选择';
        grid.appendChild(empty);
      } else {
        batchImportItems.forEach((item, idx) => {
          const cell = document.createElement('div');
          cell.className = 'batch-import-cell';
          cell.dataset.batchId = item.id;
          const head = document.createElement('div');
          head.className = 'batch-import-cell-head';
          const label = document.createElement('span');
          label.className = 'batch-import-cell-label';
          label.textContent = `第 ${idx + 1} 张`;
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'batch-import-cell-remove';
          rm.title = '移除';
          rm.setAttribute('aria-label', '移除');
          rm.textContent = '×';
          rm.addEventListener('click', () => {
            revokeBatchImportThumb(item);
            batchImportItems = batchImportItems.filter((it) => it.id !== item.id);
            renderBatchImportGrid();
          });
          head.appendChild(label);
          head.appendChild(rm);
          const img = document.createElement('img');
          img.className = 'batch-import-cell-thumb';
          img.src = item.thumbUrl;
          img.alt = `第 ${idx + 1} 张`;
          const ta = document.createElement('textarea');
          ta.className = 'batch-import-cell-prompt';
          ta.dataset.batchId = item.id;
          ta.rows = 3;
          ta.placeholder = '该图提示词';
          ta.value = item.prompt || '';
          ta.addEventListener('input', () => {
            item.prompt = ta.value;
            syncBatchImportPromptFields();
          });
          cell.appendChild(head);
          cell.appendChild(img);
          cell.appendChild(ta);
          grid.appendChild(cell);
        });
      }
      if (saveBtn) {
        const n = batchImportItems.length;
        saveBtn.textContent = n > 0 ? `创建 ${n} 张卡片` : '创建卡片';
        saveBtn.disabled = n === 0;
      }
      syncBatchImportPromptFields();
    }

    function batchImportFileKey(file) {
      if (!file) return '';
      return `${file.name}|${file.size}|${file.lastModified}`;
    }

    function clearBatchImportDraft() {
      clearBatchImportItems();
      const unifiedEl = document.getElementById('batchImportUnifiedPrompt');
      const statusEl = document.getElementById('batchImportStatus');
      if (unifiedEl) {
        unifiedEl.value = '';
        unifiedEl.disabled = false;
        unifiedEl.placeholder = '统一提示词（可选）';
      }
      if (statusEl) statusEl.textContent = '';
      renderBatchImportGrid();
    }
    window.clearBatchImportDraft = clearBatchImportDraft;

    function openBatchImportModal(opts) {
      clearBatchImportItems();
      const unifiedEl = document.getElementById('batchImportUnifiedPrompt');
      const statusEl = document.getElementById('batchImportStatus');
      if (unifiedEl) {
        unifiedEl.value = '';
        unifiedEl.disabled = false;
        unifiedEl.placeholder = '统一提示词（可选）';
      }
      if (statusEl) statusEl.textContent = '';
      renderBatchImportGrid();
      document.getElementById('batchImportOverlay')?.classList.remove('hidden');
      document.body.classList.add('batch-import-open');
      const preset = opts?.files || (opts instanceof FileList ? opts : null);
      if (preset?.length) void addBatchImportFiles(preset);
    }
    window.openBatchImportModal = openBatchImportModal;

    function closeBatchImportModal() {
      document.getElementById('batchImportOverlay')?.classList.add('hidden');
      document.body.classList.remove('batch-import-open');
      clearBatchImportItems();
      renderBatchImportGrid();
      const statusEl = document.getElementById('batchImportStatus');
      if (statusEl) statusEl.textContent = '';
    }
    window.closeBatchImportModal = closeBatchImportModal;

    async function addBatchImportFiles(fileList) {
      const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
      if (!files.length) return;
      const room = BATCH_IMPORT_MAX - batchImportItems.length;
      if (room <= 0) {
        showToast(`单次最多 ${BATCH_IMPORT_MAX} 张`);
        return;
      }
      const existing = new Set(batchImportItems.map((it) => batchImportFileKey(it.file)));
      const fresh = files.filter((f) => !existing.has(batchImportFileKey(f)));
      const dupCount = files.length - fresh.length;
      if (!fresh.length) {
        if (dupCount) showToast('这些图片已在列表中');
        return;
      }
      const slice = fresh.slice(0, room);
      if (fresh.length > room || files.length > room) {
        showToast(`已添加 ${slice.length} 张（单次最多 ${BATCH_IMPORT_MAX} 张）`);
      } else if (dupCount) {
        showToast(`已跳过 ${dupCount} 张重复图片`);
      }
      for (const file of slice) {
        batchImportItems.push({
          id: newBatchItemId(),
          file,
          thumbUrl: URL.createObjectURL(file),
          prompt: ''
        });
      }
      renderBatchImportGrid();
    }

    function initBatchImportModal() {
      const drop = document.getElementById('batchImportDrop');
      const input = document.getElementById('batchImportFileInput');
      const unifiedEl = document.getElementById('batchImportUnifiedPrompt');
      if (!drop || !input) return;
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('dragover');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('dragover');
        void addBatchImportFiles(e.dataTransfer.files);
      });
      drop.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        input.click();
      });
      input.addEventListener('change', (e) => {
        void addBatchImportFiles(e.target.files);
        e.target.value = '';
      });
      unifiedEl?.addEventListener('input', syncBatchImportPromptFields);
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('batchImportOverlay')?.classList.contains('hidden')) return;
        closeBatchImportModal();
      });
    }
    initBatchImportModal();

    async function persistCardGalleryFromSnap(cardId, snap, savedCard, coverImage) {
      const gallery = Array.isArray(snap.galleryImages) ? snap.galleryImages.filter(Boolean).slice(0, panelGalleryMax()) : [];
      if (!gallery.length) return;
      const CG = window.PromptHubCardGallery;
      const previous = Array.isArray(snap.previousGallery) ? snap.previousGallery : [];
      const uploads = snap.galleryUploads || {};
      const finalGallery = [];
      for (let i = 0; i < gallery.length; i += 1) {
        let ref = gallery[i];
        const upload = uploads[i] || (i === snap.galleryPrimaryIndex ? snap.uploadFile : null);
        if (i === 0 && coverImage) {
          ref = coverImage;
        } else if (window.SupabaseSync?.isLoggedIn?.()) {
          if (upload || (ref && !window.SupabaseSync.isStorageRef?.(ref))) {
            const slotJobId = `${cardId}#${i + 1}`;
            ref = await window.SupabaseSync.archiveGeneratedCardImage(cardId, ref || upload, { jobId: slotJobId });
          } else if (ref && window.SupabaseSync.isStorageRef?.(ref)) {
            ref = await window.SupabaseSync.resolveCardImageForSave(
              cardId,
              ref,
              previous[i] || null,
              { original: snap.uploadOriginal }
            );
          }
        }
        if (ref) finalGallery.push(ref);
      }
      if (!finalGallery.length) return;
      savedCard.cardImages = finalGallery.length > 1 ? finalGallery : null;
      CG?.syncCardGalleryFields?.(savedCard);
      savedCard.updatedAt = Date.now();
    }

    async function persistCardSnap(snap, opts = {}) {
      const statusEl = opts.statusEl || document.getElementById('statusMsg');
      const onProgress = opts.onProgress || ((p) => setPanelSaveProgress(p));
      const uploadSource = snap.uploadFile || (
        snap.imageValue && !window.SupabaseSync?.isStorageRef?.(snap.imageValue)
          ? snap.imageValue
          : null
      );
      const needsFreshUpload = !!uploadSource;
      const pendingRemovalOnly = snap.imageRemovalPending && !uploadSource && !snap.imageValue;
      const localUploadBytes = snap.uploadFile?.size
        || snap.uploadBytes
        || estimateDataUrlBytes(snap.imageValue);
      let finalImage = pendingRemovalOnly ? null : snap.imageValue;
      if (window.SupabaseSync?.isLoggedIn?.()) {
        if (snap.imageValue && window.SupabaseSync.isDataUrl(snap.imageValue)) {
          onProgress({ text: '备份本地图片…', percent: 12, indeterminate: true });
          await saveCardImageBackup(snap.cardId, snap.imageValue);
        }
        if (pendingRemovalOnly) {
          onProgress({ text: '删除云端图片…', percent: 40, indeterminate: true });
          finalImage = await window.SupabaseSync.resolveCardImageForSave(
            snap.cardId,
            null,
            snap.previousImage,
            { original: snap.uploadOriginal }
          );
        } else if (needsFreshUpload) {
          const estBytes = Math.max(localUploadBytes || 0, snap.uploadFile?.size || 0);
          if (estBytes > 0 && window.Membership?.canAddStorageBytes && !window.Membership.canAddStorageBytes(estBytes)) {
            const summary = window.Membership.getStorageSummaryLabel?.() || '';
            throw new Error(`云存储已满（${summary}）。请删除旧图或升级会员。`);
          }
          const prepText = snap.uploadOriginal
            ? (localUploadBytes > 50 * 1024 * 1024
              ? `准备上传（原尺寸JPEG）· ${formatFileSize(localUploadBytes)}`
              : `准备上传原图 · ${formatFileSize(localUploadBytes)}`)
            : `准备上传 · ${formatFileSize(localUploadBytes)}`;
          onProgress({ text: prepText, percent: 15 });
          if (statusEl) statusEl.textContent = prepText;
          finalImage = await window.SupabaseSync.uploadCardImage(
            snap.cardId,
            uploadSource,
            {
              original: snap.uploadOriginal,
              onProgress: (ratio, loaded, total) => {
                const pct = 15 + Math.round(Math.max(0, Math.min(1, ratio)) * 62);
                const loadedText = total ? formatFileSize(loaded) : '';
                const totalText = total ? formatFileSize(total) : formatFileSize(localUploadBytes);
                const text = `上传中 ${Math.round(ratio * 100)}% · ${loadedText || '…'}/${totalText}`;
                onProgress({ text, percent: pct });
                if (statusEl) statusEl.textContent = text;
              }
            }
          );
          if (snap.previousImage
            && snap.previousImage !== finalImage
            && window.SupabaseSync.isStorageRef(snap.previousImage)) {
            await window.SupabaseSync.deleteCardImageByUrl(snap.previousImage, {
              allowGenerated: true,
              excludeCardId: snap.cardId,
              force: true
            });
          }
          await clearCardImageBackup(snap.cardId);
        } else if (snap.imageValue) {
          onProgress({ text: '校验云端图片…', percent: 35, indeterminate: true });
          finalImage = await window.SupabaseSync.resolveCardImageForSave(
            snap.cardId,
            snap.imageValue,
            snap.previousImage,
            { original: snap.uploadOriginal }
          );
          if (finalImage && window.SupabaseSync.isStorageRef(finalImage)) {
            await clearCardImageBackup(snap.cardId);
          }
        }
      }
      onProgress({ text: '写入卡片…', percent: 82 });
      if (finalImage && window.SupabaseSync?.prefetchDisplayUrls) {
        void window.SupabaseSync.prefetchDisplayUrls([finalImage]);
      }
      let savedCard;
      let didPublishToCommunity = false;
      if (!snap.isNewCard) {
        const card = cards.find(c => c.id === snap.cardId);
        if (card) {
          card.title = snap.title;
          card.prompt = snap.prompt;
          card.image = snap.imageRemovalPending ? null : finalImage;
          const userTags = snap.tags.filter(t => t !== window.COMMUNITY_COLLECT_TAG);
          card.tags = window.isCommunityCollectCard?.(card)
            ? [window.COMMUNITY_COLLECT_TAG, ...userTags.filter(t => t !== window.COMMUNITY_COLLECT_TAG)]
            : [...snap.tags];
          card.customFields = snap.customFields;
          card.updatedAt = Date.now();
          if (window.isCommunityCollectCard?.(card)) {
            card.publishedToCommunity = false;
          }
          savedCard = card;
        }
      } else {
        savedCard = {
          id: snap.cardId,
          title: snap.title,
          prompt: snap.prompt,
          image: snap.imageRemovalPending ? null : finalImage,
          group: (currentGroup !== 'all' && currentGroup !== 'uncategorized') ? currentGroup : null,
          tags: [...snap.tags],
          customFields: snap.customFields,
          warehouseId: getActiveWarehouseId(),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        cards.push(savedCard);
      }
      if (savedCard) {
        const cardForPublish = {
          ...savedCard,
          image: snap.imageRemovalPending ? null : finalImage
        };
        const publishIntent = snap.wantPublish === true && !window.isCommunityCollectCard?.(cardForPublish);
        const canPublish = publishIntent && window.FeatureDraft?.isCommunityPublishEligible?.(cardForPublish);
        savedCard.publishedToCommunity = canPublish === true;
        didPublishToCommunity = canPublish === true;
        if (Array.isArray(snap.galleryImages) && snap.galleryImages.filter(Boolean).length > 0) {
          await persistCardGalleryFromSnap(snap.cardId, snap, savedCard, finalImage);
        } else if (!snap.isNewCard && snap.imageRemovalPending) {
          savedCard.cardImages = null;
          window.PromptHubCardGallery?.syncCardGalleryFields?.(savedCard);
        }
        const uploadMetaEarly = window.__lastCardUploadMeta;
        if (uploadMetaEarly && String(uploadMetaEarly.cardId) === String(savedCard.id)) {
          savedCard.imageUploadOriginal = uploadMetaEarly.original === true;
          savedCard.imageStoredBytes = uploadMetaEarly.bytes || 0;
          savedCard.imageEncodeMode = uploadMetaEarly.encodeMode || 'raw';
        }
        window.FeatureDraft?.clearPublishDraft?.(savedCard.id);
      }
      window.__promptHubCards = cards;
      if (!opts.skipReconcile) {
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      }
      if (savedCard && window.FeatureDraft?.applyCardPublishState && !opts.skipPublishApply) {
        await window.FeatureDraft.applyCardPublishState(savedCard, didPublishToCommunity);
      }
      if (!opts.deferSave) {
        onProgress({ text: '保存到本地…', percent: 95, indeterminate: true });
        await saveAllData({ skipCloud: true });
      }
      return { savedCard, didPublishToCommunity, finalImage };
    }

    async function saveBatchImport() {
      const statusEl = document.getElementById('batchImportStatus');
      const saveBtn = document.getElementById('batchImportSaveBtn');
      if (saveBtn?.disabled && batchImportItems.length === 0) return;
      if (!batchImportItems.length) {
        showToast('请先添加图片');
        return;
      }
      const unifiedPrompt = document.getElementById('batchImportUnifiedPrompt')?.value.trim() || '';
      const hasIndividual = batchImportItems.some((it) => String(it.prompt || '').trim());
      if (unifiedPrompt && hasIndividual) {
        if (statusEl) statusEl.textContent = '统一提示词与单独提示词不能同时填写';
        showToast('统一提示词与单独提示词不能同时填写');
        return;
      }
      if (!unifiedPrompt && !hasIndividual) {
        if (statusEl) statusEl.textContent = '请填写统一提示词或为每张图填写提示词';
        showToast('请填写统一提示词或为每张图填写提示词');
        return;
      }
      const missing = batchImportItems.filter((it) => !(unifiedPrompt || String(it.prompt || '').trim()));
      if (missing.length) {
        if (statusEl) statusEl.textContent = `还有 ${missing.length} 张图未填写提示词`;
        showToast(`还有 ${missing.length} 张图未填写提示词`);
        return;
      }
      if (!isUserLoggedIn()) {
        const need = batchImportItems.length;
        if (cards.length + need > GUEST_CARD_LIMIT) {
          const msg = `未登录最多 ${GUEST_CARD_LIMIT} 张，当前 ${cards.length} 张，无法再导入 ${need} 张`;
          if (statusEl) statusEl.textContent = msg;
          promptLogin(msg);
          return;
        }
      }
      const items = batchImportItems.map((it) => ({
        id: it.id,
        file: it.file,
        thumbUrl: it.thumbUrl,
        prompt: String(it.prompt || '')
      }));
      const total = items.length;
      if (saveBtn) saveBtn.disabled = true;
      const savedCards = [];
      let failCount = 0;
      let lastErr = '';
      try {
        showBatchProgress('批量创建卡片', 0, total);
        for (let i = 0; i < total; i++) {
          const item = items[i];
          const prompt = unifiedPrompt || item.prompt.trim();
          showBatchProgress(`创建第 ${i + 1}/${total} 张`, i, total);
          try {
            let imageValue = null;
            if (!window.SupabaseSync?.isLoggedIn?.()) {
              imageValue = await readFileAsDataUrl(item.file);
            }
            const snap = {
              prompt,
              title: '',
              tags: [],
              customFields: {},
              isNewCard: true,
              cardId: generateId(),
              previousImage: null,
              imageValue,
              uploadFile: window.SupabaseSync?.isLoggedIn?.() ? item.file : null,
              uploadBytes: item.file?.size || 0,
              uploadOriginal: window.__cardUploadOriginal === true,
              wantPublish: false,
              imageRemovalPending: false
            };
            const { savedCard } = await persistCardSnap(snap, {
              deferSave: true,
              skipReconcile: true,
              skipPublishApply: true
            });
            if (savedCard) {
              savedCards.push(savedCard);
              await saveAllData({ skipCloud: true });
            }
            revokeBatchImportThumb(item);
            batchImportItems = batchImportItems.filter((it) => it.id !== item.id);
            showBatchProgress(`创建第 ${i + 1}/${total} 张`, i + 1, total);
          } catch (itemErr) {
            failCount += 1;
            lastErr = window.SupabaseSync?.formatError?.(itemErr) || itemErr.message || '创建失败';
            console.warn('[batch] item failed', item.id, itemErr);
          }
        }
        if (savedCards.length) {
          window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
          updateTagFilter();
          renderGroups();
          renderCards(true);
          updateGuestLimitUI();
          if (savedCards.length) highlightSelectedCard(savedCards[savedCards.length - 1].id);
        }
        if (savedCards.length === total || (savedCards.length > 0 && batchImportItems.length === 0)) {
          closeBatchImportModal();
          showToast(`已批量创建 ${savedCards.length} 张卡片`);
        } else if (savedCards.length) {
          renderBatchImportGrid();
          if (statusEl) statusEl.textContent = `成功 ${savedCards.length} 张，失败 ${failCount} 张${lastErr ? '：' + lastErr : ''}`;
          showToast(`成功 ${savedCards.length} 张，失败 ${failCount} 张`, 8000);
        } else {
          if (statusEl) statusEl.textContent = lastErr || '批量创建失败';
          showToast(lastErr || '批量创建失败', 6000);
        }
      } catch (e) {
        const msg = window.SupabaseSync?.formatError?.(e) || e.message || '批量创建失败';
        if (statusEl) statusEl.textContent = msg;
        showToast(msg, 6000);
      } finally {
        hideBatchProgress();
        if (saveBtn) saveBtn.disabled = batchImportItems.length === 0;
      }
    }
    window.saveBatchImport = saveBatchImport;

    function renderTags() {
      const wrap = document.getElementById('tagChipsWrap');
      if (!wrap) return;
      wrap.innerHTML = '';
      const collectTag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
      currentTags.forEach(t => {
        const chip = document.createElement('span');
        const locked = t === collectTag;
        chip.className = 'tag-chip' + (locked ? ' tag-chip-locked' : '');
        chip.innerHTML = locked
          ? `#${escapeHtml(t)}`
          : `#${escapeHtml(t)} <span class="remove-tag" onclick="removeTag('${escapeJsString(t)}')">×</span>`;
        wrap.appendChild(chip);
      });
      const picker = document.getElementById('tagInlinePicker');
      if (picker && !picker.hidden) renderTagInlineList();
    }

    function addTag() {
      const raw = document.getElementById('tagInput').value.trim();
      if (!raw) return;
      const t = raw.replace(/^#/, '');
      if (window.isCommunityCollectTagName?.(t)) {
        showToast('「社区收藏」标签仅收藏时自动添加');
        return;
      }
      if (t && !currentTags.includes(t)) { currentTags.push(t); renderTags(); }
      document.getElementById('tagInput').value = '';
    }
    function removeTag(t) {
      if (window.isCommunityCollectTagName?.(t)) {
        showToast('「社区收藏」标签不可移除');
        return;
      }
      currentTags = currentTags.filter(x => x !== t);
      renderTags();
    }
    
    let tagInlineOutsideBound = false;

    function applyTagFromSheet(tag) {
      if (window.isCommunityCollectTagName?.(tag)) {
        showToast('「社区收藏」标签仅收藏时自动添加');
        return;
      }
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        renderTags();
      }
    }

    function tagInlineOutsideClose(e) {
      if (e.target.closest('#tagContainer')) return;
      closeTagSheet();
    }

    function tagInlineEscClose(e) {
      if (e.key === 'Escape') closeTagSheet();
    }

    function bindTagInlineOutsideClose() {
      if (tagInlineOutsideBound) return;
      tagInlineOutsideBound = true;
      document.addEventListener('pointerdown', tagInlineOutsideClose, true);
      document.addEventListener('keydown', tagInlineEscClose);
    }

    function unbindTagInlineOutsideClose() {
      if (!tagInlineOutsideBound) return;
      tagInlineOutsideBound = false;
      document.removeEventListener('pointerdown', tagInlineOutsideClose, true);
      document.removeEventListener('keydown', tagInlineEscClose);
    }

    function closeTagSheet() {
      const picker = document.getElementById('tagInlinePicker');
      const btn = document.getElementById('tagPickBtn');
      const list = document.getElementById('tagInlineList');
      if (picker) picker.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (list) list.innerHTML = '';
      unbindTagInlineOutsideClose();
    }

    function renderTagInlineList() {
      const list = document.getElementById('tagInlineList');
      if (!list) return;
      const all = window.getSelectableCardTags?.(cards) || [];
      list.innerHTML = '';
      if (!all.length) {
        list.innerHTML = '<div class="tag-inline-empty">暂无任何标签</div>';
        return;
      }
      all.forEach(tag => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'tag-inline-option' + (currentTags.includes(tag) ? ' is-selected' : '');
        opt.textContent = '#' + tag;
        opt.disabled = currentTags.includes(tag);
        opt.addEventListener('click', () => {
          applyTagFromSheet(tag);
          showToast('已添加标签');
          opt.classList.add('is-selected');
          opt.disabled = true;
        });
        list.appendChild(opt);
      });
    }

    function showExistingTags() {
      const picker = document.getElementById('tagInlinePicker');
      const btn = document.getElementById('tagPickBtn');
      if (!picker || !btn) return;
      if (!picker.hidden) {
        closeTagSheet();
        return;
      }
      renderTagInlineList();
      picker.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      bindTagInlineOutsideClose();
    }
    window.showExistingTags = showExistingTags;
    window.closeTagSheet = closeTagSheet;
    
    document.getElementById('tagInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    document.getElementById('tagPickBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      showExistingTags();
    });

    function renderCustomFields() {
      const container = document.getElementById('customFieldsContainer');
      let html = '';
      globalFields.forEach(f => {
        const val = currentCardCustomFields[f.name] || '';
        html += `<label>${f.name}</label>`;
        html += f.type === 'textarea' ? `<textarea class="custom-field-input" data-field-name="${f.name}">${val}</textarea>` : `<input type="text" class="custom-field-input" data-field-name="${f.name}" value="${val}">`;
      });
      const globalNames = globalFields.map(f => f.name);
      Object.keys(currentCardCustomFields).forEach(name => {
        if (!globalNames.includes(name) && !tempCustomFields.some(tf => tf.name === name)) {
          html += `<label>${name} <span style="color:var(--danger); cursor:pointer;" onclick="deleteCardField('${name}')">×</span></label>`;
          const val = currentCardCustomFields[name] || '';
          html += `<textarea class="temp-field" data-field-name="${name}">${val}</textarea>`;
        }
      });
      tempCustomFields.forEach((tf, idx) => {
        html += `<label>${tf.name} <span style="color:var(--danger); cursor:pointer;" onclick="removeTempField(${idx})">×</span></label>`;
        html += tf.type === 'textarea' ? `<textarea class="temp-field" data-temp-idx="${idx}" data-field-name="${tf.name}">${tf.value || ''}</textarea>` : `<input type="text" class="temp-field" data-temp-idx="${idx}" data-field-name="${tf.name}" value="${tf.value || ''}">`;
      });
      html += `<div class="panel-temp-field-row">
        <input type="text" id="tempFieldName" placeholder="字段名">
        <div class="panel-temp-field-actions">
          <select id="tempFieldType"><option value="text">文本</option><option value="textarea">多行文本</option></select>
          <label class="custom-checkbox panel-temp-fixed-label"><input type="checkbox" id="tempFieldFixed"><span class="checkmark"></span><span class="custom-checkbox-text">固定</span></label>
          <button type="button" class="btn btn-secondary panel-temp-add-btn" onclick="addTempField()" aria-label="添加字段">+</button>
        </div>
      </div>`;
      container.innerHTML = html;
    }

    function deleteCardField(name) {
      delete currentCardCustomFields[name];
      renderCustomFields();
    }

    function addTempField() {
      const n = document.getElementById('tempFieldName').value.trim(); if (!n) return;
      const t = document.getElementById('tempFieldType').value;
      const f = document.getElementById('tempFieldFixed').checked;
      if (f) {
        globalFields.push({ id: generateId(), name: n, type: t });
        saveAllData();
        renderCustomFields();
        if (document.getElementById('settingsOverlay').classList.contains('active')) renderFieldList();
      } else {
        tempCustomFields.push({ name: n, type: t, value: '' });
        renderCustomFields();
      }
      document.getElementById('tempFieldName').value = '';
    }

    function removeTempField(idx) { tempCustomFields.splice(idx, 1); renderCustomFields(); }

    function setPanelSaveProgress(opts = {}) {
      const wrap = document.getElementById('panelSaveProgress');
      const fill = document.getElementById('panelSaveProgressFill');
      const label = document.getElementById('panelSaveProgressLabel');
      if (!wrap) return;
      if (opts.hidden) {
        wrap.classList.add('hidden');
        fill?.classList.remove('is-indeterminate');
        if (fill) fill.style.width = '0%';
        return;
      }
      wrap.classList.remove('hidden');
      if (label && opts.text) label.textContent = opts.text;
      if (!fill) return;
      if (opts.indeterminate) {
        fill.classList.add('is-indeterminate');
        fill.style.width = '';
        return;
      }
      fill.classList.remove('is-indeterminate');
      fill.style.width = `${Math.max(0, Math.min(100, Number(opts.percent) || 0))}%`;
