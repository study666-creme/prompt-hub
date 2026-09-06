    }
    window.setPanelSaveProgress = setPanelSaveProgress;

    function uploadEncodeModeLabel(opts = {}) {
      if (!opts.uploadOriginal && !opts.original) return '已压缩保存';
      if (opts.encodeMode === 'full_res_jpeg') return '原尺寸高清JPEG已存';
      return '原图已存';
    }

    function formatFileSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function estimateDataUrlBytes(dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string') return 0;
      const i = dataUrl.indexOf(',');
      if (i < 0) return 0;
      return Math.max(0, Math.floor(dataUrl.slice(i + 1).length * 0.75));
    }

    function syncCardUploadOriginalToggle() {
      const btn = document.getElementById('cardUploadOriginalToggle');
      if (!btn) return;
      const active = window.__cardUploadOriginal === true;
      btn.textContent = active ? '上传原图：开' : '上传原图：关';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-on', active);
    }

    function updateCardImageSizeHint(opts = {}) {
      const dl = document.getElementById('cardDownloadImageBtn');
      if (!dl) return;
      const hasImage = !!(imageData && !imageRemovalPending);
      dl.classList.toggle('hidden', !hasImage);
    }

    async function downloadPanelCardImage() {
      if (!imageData) {
        showToast('请先选择图片');
        return;
      }
      const dropArea = document.getElementById('dropArea');
      if (dropArea?.classList.contains('is-loading-preview')) {
        showToast('图片加载中，请稍后再下载');
        return;
      }
      const cardId = selectedCardId;
      const card = cardId ? cards.find((c) => c.id === cardId) : null;
      const previewImg = document.getElementById('previewImage');
      const slotJobId = getEditPanelSlotJobId(card, panelGalleryIndex);
      await window.downloadCardImageFile?.(imageData, cardId, null, {
        galleryIndex: panelGalleryIndex,
        jobId: slotJobId,
        previewImg
      });
    }
    window.downloadPanelCardImage = downloadPanelCardImage;

    function initCardUploadOriginalToggle() {
      const btn = document.getElementById('cardUploadOriginalToggle');
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      if (typeof window.__cardUploadOriginal !== 'boolean') {
        window.__cardUploadOriginal = settings.preserveOriginalCardImage === true
          || window.SupabaseSync?.preserveOriginalCardImageFromSettings?.() === true;
      }
      syncCardUploadOriginalToggle();
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const turningOn = !window.__cardUploadOriginal;
        window.__cardUploadOriginal = turningOn;
        settings.preserveOriginalCardImage = window.__cardUploadOriginal;
        if (turningOn
          && window.SupabaseSync?.isStorageRef?.(imageData)
          && !pendingUploadFile) {
          cardOriginalReuploadRequired = true;
        } else if (!turningOn) {
          cardOriginalReuploadRequired = false;
        }
        syncCardUploadOriginalToggle();
        updateCardImageSizeHint();
        try {
          localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
          const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
          if (uid) localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
        } catch (err) { /* ignore */ }
      });
      document.getElementById('cardDownloadImageBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void downloadPanelCardImage();
      });
      const panelGalPrev = document.getElementById('panelGalleryPrev');
      const panelGalNext = document.getElementById('panelGalleryNext');
      if (panelGalPrev && panelGalPrev.dataset.bound !== '1') {
        panelGalPrev.dataset.bound = '1';
        panelGalPrev.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          stepPanelGallery(-1);
        });
      }
      if (panelGalNext && panelGalNext.dataset.bound !== '1') {
        panelGalNext.dataset.bound = '1';
        panelGalNext.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          stepPanelGallery(1);
        });
      }
      const addImgBtn = document.getElementById('panelAddImageBtn');
      if (addImgBtn && addImgBtn.dataset.bound !== '1') {
        addImgBtn.dataset.bound = '1';
        addImgBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.getElementById('fileInput')?.click();
        });
      }
    }

    function updatePanelTrimToolVisibility() {
      const el = document.getElementById('panelImageTools');
      if (!el) return;
      el.classList.remove('hidden');
      const trimBtn = document.getElementById('trimBlackBorderBtn');
      if (trimBtn) {
        trimBtn.classList.toggle('hidden', settings.showTrimBlackBorderTool !== true || !imageData);
      }
      syncCardUploadOriginalToggle();
      updateCardImageSizeHint();
    }
    window.updatePanelTrimToolVisibility = updatePanelTrimToolVisibility;

    async function trimPanelImageBlackBorder() {
      if (!imageData || !window.ImageTrim?.trimBlackBorders) {
        showToast('暂无法裁切');
        return;
      }
      const btn = document.getElementById('trimBlackBorderBtn');
      if (btn) btn.disabled = true;
      try {
        let src = imageData;
        if (window.SupabaseSync?.isStorageRef?.(imageData)) {
          src = window.MediaPipeline?.resolvePreviewUrl
            ? await window.MediaPipeline.resolvePreviewUrl(imageData, { assetId: selectedCardId, cardId: selectedCardId })
            : await window.SupabaseSync.resolveDisplayUrl(imageData, { assetId: selectedCardId, preferFull: true, variant: 'full' });
        }
        if (!src || String(src).includes('data:image/svg')) {
          showToast('请先加载图片');
          return;
        }
        const result = await window.ImageTrim.trimBlackBorders(src);
        if (!result?.trimmed) {
          showToast('未检测到明显黑边');
          return;
        }
        imageData = result.dataUrl;
        imageRemovalPending = false;
        pendingUploadFile = null;
        pendingUploadBytes = estimateDataUrlBytes(imageData);
        await updatePreview();
        showToast('已裁除黑边');
      } catch (e) {
        showToast('裁切失败');
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    window.trimPanelImageBlackBorder = trimPanelImageBlackBorder;

    async function updatePreview() {
      const seq = ++panelPreviewSeq;
      const cardIdAtStart = selectedCardId;
      const imageAtStart = imageData;
      const galleryIndexAtStart = panelGalleryIndex;
      const cardAtStart = cardIdAtStart ? cards.find((c) => c.id === cardIdAtStart) : null;
      const img = document.getElementById('previewImage'), p = document.getElementById('dropPlaceholder');
      const removeBtn = document.getElementById('removeImageBtn'), dropArea = document.getElementById('dropArea');
      const editPanel = document.getElementById('editPanel');
      const loadPreview = shouldLoadPanelImagePreview();
      editPanel?.classList.toggle('edit-panel--no-image-preview', !loadPreview);
      const previewStale = () =>
        seq !== panelPreviewSeq
        || cardIdAtStart !== selectedCardId
        || imageAtStart !== imageData
        || galleryIndexAtStart !== panelGalleryIndex;
      const finishPreviewLoad = () => {
        if (previewStale()) return;
        dropArea?.classList.remove('is-loading-preview');
        const dl = document.getElementById('cardDownloadImageBtn');
        if (dl) dl.disabled = false;
      };
      const bindPreviewImgHandlers = () => {
        if (!img) return;
        img.onload = () => {
          if (!previewStale()) finishPreviewLoad();
        };
        img.onerror = () => {
          if (previewStale()) return;
          void (async () => {
            const slotJob = getEditPanelSlotJobId(cardAtStart, galleryIndexAtStart);
            if (slotJob && window.WarehouseThumb?.resolveForCard) {
              const gridRetry = await window.WarehouseThumb.resolveForCard(imageAtStart, {
                assetId: cardIdAtStart,
                cardId: cardIdAtStart,
                jobId: slotJob,
                galleryIndex: galleryIndexAtStart
              });
              if (!previewStale() && gridRetry && !gridRetry.includes('data:image/svg')) {
                img.src = gridRetry;
                return;
              }
            }
            dropArea?.classList.add('is-loading-preview');
          })();
        };
      };
      const dlBtn = document.getElementById('cardDownloadImageBtn');
      if (loadPreview) {
        let src = '';
        if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
          src = imageData;
        } else if (typeof imageData === 'string' && /^https?:\/\//i.test(imageData) && !window.SupabaseSync?.isInvalidMediaUrl?.(imageData)) {
          src = window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(imageData) ? '' : imageData;
        }
        const waiting = !src || src.includes('data:image/svg');
        dropArea?.classList.toggle('is-loading-preview', waiting);
        if (dlBtn) dlBtn.disabled = waiting;
        if (previewStale()) return;
        bindPreviewImgHandlers();
        if (src && !src.includes('data:image/svg')) {
          img.src = src;
        } else {
          img.removeAttribute('src');
        }
        img.style.display = 'block';
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const draftCard = {
            id: selectedCardId || 'draft',
            image: imageData,
            cardImages: panelDraftGallery.filter(Boolean).length ? panelDraftGallery.filter(Boolean) : null
          };
          void openCardImageLightbox(selectedCardId ? cards.find((c) => c.id === selectedCardId) || draftCard : draftCard);
        };
        p.style.display = 'none';
        removeBtn.style.display = 'flex';
        dropArea.classList.add('has-image');
        dropArea.classList.remove('no-image');
        delete img.dataset.previewFullUrl;
        let previewGridShown = false;
        const slotJobId = getEditPanelSlotJobId(cardAtStart, galleryIndexAtStart);
        const pipePreviewOpts = {
          assetId: cardIdAtStart,
          cardId: cardIdAtStart,
          jobId: slotJobId || undefined,
          galleryIndex: galleryIndexAtStart,
          useJobImageApi: false,
          allowGridFallback: false
        };
        if (waiting && cardIdAtStart) {
          let gridUrl = '';
          if (cardAtStart) {
            gridUrl = await resolveEditPanelGalleryPreview(imageAtStart, cardAtStart, galleryIndexAtStart);
          }
          if (!previewStale() && gridUrl && !gridUrl.includes('data:image/svg')) {
            img.src = gridUrl;
            previewGridShown = true;
            finishPreviewLoad();
          }
        }
        if (src && !src.includes('data:image/svg')) {
          if (!window.SupabaseSync?.isStorageRef?.(imageAtStart)) img.dataset.previewFullUrl = src;
          finishPreviewLoad();
        } else if (previewGridShown) {
          finishPreviewLoad();
        }
      } else {
        if (dlBtn) dlBtn.disabled = true;
        dropArea?.classList.remove('is-loading-preview');
        img.style.display = 'none';
        if (p) {
          p.style.display = 'block';
          p.textContent = '点击、拖拽或 Ctrl+V 粘贴图片';
        }
        removeBtn.style.display = 'none';
        dropArea.classList.add('no-image');
        dropArea.classList.remove('has-image');
      }
      updatePanelTrimToolVisibility();
    }

    function removeImage() {
      if (!imageData && !panelDraftGallery.length) return;
      commitPanelDraftSlot();
      if (panelDraftGallery.length > 1) {
        panelDraftGallery.splice(panelGalleryIndex, 1);
        const nextUploads = {};
        panelDraftGallery.forEach((_, i) => {
          const keys = Object.keys(panelDraftUploads).map(Number).sort((a, b) => a - b);
          if (keys[i] != null) nextUploads[i] = panelDraftUploads[keys[i]];
        });
        panelDraftUploads = nextUploads;
        panelGalleryIndex = Math.min(panelGalleryIndex, Math.max(panelDraftGallery.length - 1, 0));
        imageData = panelDraftGallery[panelGalleryIndex] || null;
        pendingUploadFile = panelDraftUploads[panelGalleryIndex] || null;
        pendingUploadBytes = pendingUploadFile?.size || estimateDataUrlBytes(imageData);
        imageRemovalPending = !imageData;
      } else {
        panelDraftGallery = [];
        panelDraftUploads = {};
        imageData = null;
        imageRemovalPending = true;
        pendingUploadFile = null;
        pendingUploadBytes = 0;
      }
      const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
      syncPanelGalleryNav(card || { cardImages: panelDraftGallery, image: panelDraftGallery[0] || null });
      updatePreview();
      showToast('已从编辑区去掉图片；点「保存」后才会真正删除', 4000);
    }
    function updatePanelOcrBoxVisibility() {
      const on = settings.autoPromptOcr === true;
      document.getElementById('panelOcrDrop')?.classList.toggle('hidden', !on);
    }
    window.updatePanelOcrBoxVisibility = updatePanelOcrBoxVisibility;

    async function handleOcrOnlyImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      if (!isEditPanelOpen() || settings.autoPromptOcr !== true) return;
      const inner = document.getElementById('panelOcrDropInner');
      const hint = document.getElementById('panelOcrDropHint');
      const status = document.getElementById('panelOcrDropStatus');
      inner?.classList.add('is-busy');
      hint?.classList.add('hidden');
      status?.classList.remove('hidden');
      const r = new FileReader();
      r.onload = async (e) => {
        try {
          const text = await recognizeImageText(e.target.result);
          if (text) {
            const promptEl = document.getElementById('cardPrompt');
            if (promptEl) {
              promptEl.value = text;
              if (floatingPromptActive) {
                const fp = document.getElementById('floatingPromptText');
                if (fp) fp.value = text;
              }
              window.FeatureDraft?.syncCardPublishFromPrompt?.(text);
            }
            showToast('已填入提示词');
          } else {
            showToast('未识别到文字');
          }
        } finally {
          inner?.classList.remove('is-busy');
          hint?.classList.remove('hidden');
          status?.classList.add('hidden');
        }
      };
      r.onerror = () => {
        inner?.classList.remove('is-busy');
        hint?.classList.remove('hidden');
        status?.classList.add('hidden');
        showToast('无法读取图片');
      };
      r.readAsDataURL(file);
    }

    function bindPanelOcrDrop() {
      const inner = document.getElementById('panelOcrDropInner');
      const input = document.getElementById('panelOcrFileInput');
      if (!inner || !input || inner.dataset.bound === '1') return;
      inner.dataset.bound = '1';
      inner.setAttribute('tabindex', '0');
      inner.addEventListener('click', (e) => {
        e.stopPropagation();
        input.click();
      });
      ['dragenter', 'dragover'].forEach((ev) => {
        inner.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          inner.classList.add('dragover');
        });
      });
      inner.addEventListener('dragleave', () => inner.classList.remove('dragover'));
      inner.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inner.classList.remove('dragover');
        handleOcrOnlyImage(e.dataTransfer.files[0]);
      });
      input.addEventListener('change', (e) => {
        handleOcrOnlyImage(e.target.files[0]);
        e.target.value = '';
      });
    }

    function isEditPanelOpen() {
      return !document.getElementById('editPanel')?.classList.contains('hidden');
    }
    function handleSingleImage(file, opts = {}) {
      if (!file || !file.type.startsWith('image/')) return;
      if (!isEditPanelOpen()) return;
      if (opts.append) {
        void appendPanelImagesFromFiles([file]);
        return;
      }
      imageRemovalPending = false;
      cardOriginalReuploadRequired = false;
      pendingUploadFile = file;
      pendingUploadBytes = file.size || 0;
      const r = new FileReader();
      r.onload = e => {
        const dataUrl = e.target.result;
        if (!panelDraftGallery.length) {
          panelDraftGallery = [dataUrl];
          panelGalleryIndex = 0;
        } else {
          commitPanelDraftSlot();
          panelDraftGallery[panelGalleryIndex] = dataUrl;
        }
        panelDraftUploads[panelGalleryIndex] = file;
        imageData = dataUrl;
        const card = selectedCardId ? cards.find((c) => c.id === selectedCardId) : null;
        syncPanelGalleryNav(card || { cardImages: panelDraftGallery, image: panelDraftGallery[0] || null });
        updatePreview();
        updateCardImageSizeHint({ bytes: pendingUploadBytes });
      };
      r.readAsDataURL(file);
    }
    const dropArea = document.getElementById('dropArea');
    dropArea.addEventListener('dragover', e => { e.preventDefault(); if (!isEditPanelOpen()) return; dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('dragover');
      if (!isEditPanelOpen()) return;
      const files = e.dataTransfer.files;
      if (files?.length > 1) {
        void appendPanelImagesFromFiles(files);
        return;
      }
      handleSingleImage(files[0]);
    });
    dropArea.addEventListener('click', (e) => {
      if (!isEditPanelOpen()) return;
      if (e.target.tagName !== 'IMG' && e.target.tagName !== 'BUTTON') document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', e => {
      const files = e.target.files;
      if (files?.length > 1) {
        void appendPanelImagesFromFiles(files);
      } else {
        handleSingleImage(files[0]);
      }
      e.target.value = '';
    });

    document.getElementById('cardPrompt')?.addEventListener('input', () => {
      if (!floatingPromptActive) {
        const fp = document.getElementById('floatingPromptText');
        if (fp) fp.value = document.getElementById('cardPrompt').value;
      }
    });

    document.addEventListener('paste', e => {
      const batchOpen = !document.getElementById('batchImportOverlay')?.classList.contains('hidden');
      if (batchOpen) {
        const items = e.clipboardData?.items;
        if (!items) return;
        const pasted = [];
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            const f = i.getAsFile();
            if (f) pasted.push(f);
          }
        }
        if (pasted.length) {
          e.preventDefault();
          void addBatchImportFiles(pasted);
        }
        return;
      }
      const ocrModal = document.getElementById('ocrModal');
      const editPanel = document.getElementById('editPanel');
      if (ocrModal.style.display === 'flex') {
        const items = e.clipboardData.items;
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            handleModalImage(i.getAsFile());
            break;
          }
        }
        return;
      }
      if (!editPanel.classList.contains('hidden')) {
        const ocrDrop = document.getElementById('panelOcrDrop');
        const ocrEnabled = settings.autoPromptOcr === true && ocrDrop && !ocrDrop.classList.contains('hidden');
        const ocrFocused = ocrDrop?.contains(document.activeElement);
        const items = e.clipboardData.items;
        for (let i of items) {
          if (i.type.indexOf('image') !== -1) {
            if (ocrEnabled && ocrFocused) handleOcrOnlyImage(i.getAsFile());
            else handleSingleImage(i.getAsFile());
            break;
          }
        }
      }
    });

    async function saveCard() {
      const statusEl = document.getElementById('statusMsg');
      const saveBtn = document.querySelector('.btn-footer-save');
      const prompt = readPanelPromptText();
      if (!prompt) { statusEl.textContent = '❌ 提示词不能为空'; return; }
      if (isNewCardMode) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          statusEl.textContent = '❌ ' + check.msg;
          promptLogin(check.msg);
          return;
        }
      }
      if (cardOriginalReuploadRequired
        && window.__cardUploadOriginal === true
        && window.SupabaseSync?.isStorageRef?.(imageData)
        && !pendingUploadFile) {
        statusEl.textContent = '❌ 请重新选择图片后再保存原图';
        showToast('已开启原图：请重新选择一次图片再保存');
        return;
      }
      const title = document.getElementById('cardTitle').value.trim();
      const customData = readPanelCustomFields();
      const snapCardId = (!isNewCardMode && selectedCardId) ? selectedCardId : generateId();
      const editingCard = !isNewCardMode ? cards.find(c => c.id === snapCardId) : null;
      commitPanelDraftSlot();
      const draftGallery = getPanelDraftGalleryForSave();
      const snap = {
        prompt,
        title,
        tags: [...currentTags],
        customFields: customData,
        isNewCard: isNewCardMode,
        cardId: snapCardId,
        previousImage: (!isNewCardMode && selectedCardId)
          ? (cards.find(c => c.id === selectedCardId)?.image || null)
          : null,
        imageValue: imageData,
        uploadFile: pendingUploadFile,
        uploadBytes: pendingUploadBytes,
        uploadOriginal: window.__cardUploadOriginal === true,
        wantPublish: window.FeatureDraft?.readPublishCheckbox?.() ?? false,
        imageRemovalPending: imageRemovalPending,
        galleryImages: draftGallery,
        galleryUploads: { ...panelDraftUploads },
        galleryPrimaryIndex: panelGalleryIndex,
        previousGallery: editingCard ? getEditPanelCardGallery(editingCard) : null
      };
      if (window.isCommunityCollectCard?.(editingCard) && snap.wantPublish) {
        statusEl.textContent = '❌ 社区收藏卡片不可发布到社区';
        showToast('社区收藏卡片不可发布到社区');
        return;
      }
      if (snap.wantPublish && !isUserLoggedIn()) {
        statusEl.textContent = '❌ 发布到社区需先登录';
        requireAuth('publish');
        return;
      }
      if (saveBtn) saveBtn.disabled = true;
      setPanelSaveProgress({ text: '准备保存…', percent: 8 });
      const wasNewCard = snap.isNewCard;
      const editingSameCard = !wasNewCard && selectedCardId === snap.cardId;
      try {
        const { savedCard, didPublishToCommunity } = await persistCardSnap(snap, { statusEl });
        if (editingSameCard) {
          imageData = savedCard?.image ?? imageData;
          pendingUploadFile = null;
          pendingUploadBytes = 0;
          imageRemovalPending = false;
          cardOriginalReuploadRequired = false;
        }
        if (window.SupabaseSync?.isLoggedIn?.()) {
          scheduleCloudPush();
          if (savedCard && didPublishToCommunity) {
            void window.FeatureDraft?.syncMyPostsToPublicFeed?.();
          }
        }
        if (!snap.wantPublish && document.getElementById('pageCommunity')?.classList.contains('active')) {
          void window.FeatureDraft?.refreshPublicCommunityFeed?.({ force: true }).then(() => {
            window.FeatureDraft?.renderCommunity?.({ skipFeedFetch: true, forceRepaint: true });
          });
        }
        updateTagFilter();
        renderGroups();
        renderCards(true);
        updateGuestLimitUI();
        statusEl.textContent = '';
        editPanelStashedDraft = null;
        setPanelSaveProgress({ text: '保存完成', percent: 100 });
        showToast('保存成功！');
        const uploadMeta = window.__lastCardUploadMeta;
        if (editingSameCard && uploadMeta && savedCard && String(uploadMeta.cardId) === String(savedCard.id)) {
          updateCardImageSizeHint({
            saved: true,
            bytes: uploadMeta.bytes,
            uploadOriginal: uploadMeta.original,
            encodeMode: uploadMeta.encodeMode
          });
          if (uploadMeta.encodeMode === 'full_res_jpeg') {
            showToast(`已按原尺寸转高清 JPEG 保存 · ${formatFileSize(uploadMeta.bytes)}`, 4500);
          }
        }
        if (wasNewCard && savedCard) {
          panelDraftGallery = getEditPanelCardGallery(savedCard);
          panelDraftUploads = {};
          if (currentGroup !== 'all' && currentGroup !== 'uncategorized' && savedCard.group !== currentGroup) {
            switchGroup('all');
          }
          resetNewCardForm();
          highlightSelectedCard(savedCard.id);
        } else if (savedCard && editingSameCard) {
          panelDraftGallery = getEditPanelCardGallery(savedCard);
          panelDraftUploads = {};
          window.FeatureDraft?.setPublishCheckbox?.(savedCard);
          highlightSelectedCard(savedCard.id);
          void updatePreview();
        } else if (savedCard) {
          highlightSelectedCard(savedCard.id);
        }
        if (isMobileViewport() && wasNewCard) {
          closeEditPanel({ skipHistory: true });
        }
      } catch (e) {
        const msg = window.SupabaseSync?.formatError?.(e) || e.message || '保存失败';
        statusEl.textContent = '❌ ' + msg;
        showToast(msg, 6000);
        return;
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        setTimeout(() => setPanelSaveProgress({ hidden: true }), 700);
      }
    }

    function copyCardPrompt(id) { const c = cards.find(x => x.id === id); if (c && c.prompt) { navigator.clipboard.writeText(c.prompt); showToast('提示词已复制'); } }
    function hasUnsavedCardDraft() {
      if (!isNewCardMode) return false;
      const prompt = (document.getElementById('floatingPromptText')?.value || document.getElementById('cardPrompt')?.value || '').trim();
      const title = (document.getElementById('cardTitle')?.value || '').trim();
      return !!(prompt || title || imageData || currentTags.length);
    }

    function closeEditPanel(opts) {
      if (!opts?.skipDraftGuard && isMobileViewport() && isNewCardMode && hasUnsavedCardDraft()) {
        const msg = '当前卡片尚未保存，关闭后内容会丢失。确定关闭吗？';
        const proceed = () => closeEditPanel({ ...opts, skipDraftGuard: true });
        const cancel = () => {
          if (opts?.fromPopstate && isMobileViewport() && !document.getElementById('editPanel')?.classList.contains('hidden')) {
            try {
              history.pushState({ phEditPanel: 1 }, '', location.href);
              mobileEditPanelHistory = true;
            } catch (e) { /* ignore */ }
          }
        };
        if (typeof window.customConfirm === 'function') {
          window.customConfirm(msg, proceed, cancel);
          return;
        }
        if (!confirm(msg)) {
          cancel();
          return;
        }
      }
      if (!isNewCardMode && selectedCardId && imageRemovalPending) {
        const card = cards.find((c) => c.id === selectedCardId);
        if (card) imageData = card.image || null;
      }
      stashEditPanelDraft();
      imageRemovalPending = false;
      closeTagSheet();
      window.FeatureDraft?.closeImageGenFilterSheet?.();
      document.getElementById('editPanel').classList.add('hidden');
      document.getElementById('fabNewBtn').classList.add('visible');
      document.body.classList.remove('panel-open');
      const hadHistory = mobileEditPanelHistory;
      mobileEditPanelHistory = false;
      if (hadHistory && !opts?.skipHistory && !opts?.fromPopstate) {
        try {
          history.back();
        } catch (e) { /* ignore */ }
      }
      scheduleLayoutMasonry();
    }
    window.closeEditPanel = closeEditPanel;
    window.resetMobileEditPanelState = function () {
      mobileEditPanelHistory = false;
      isNewCardMode = false;
      closeEditPanel({ skipHistory: true });
    };
    function openEditPanel() {
      if (globalViewActive) safeForceExitGlobalView(true);
      window.MobileUI?.closeDrawers?.();
      document.getElementById('editPanel').classList.remove('hidden');
      document.getElementById('fabNewBtn').classList.remove('visible');
      document.body.classList.add('panel-open');
      if (floatingPromptActive) {
        applyFloatingPromptSize();
        requestAnimationFrame(() => applyFloatingPromptPosition());
      }
      if (isMobileViewport() && !mobileEditPanelHistory) {
        try {
          history.pushState({ phEditPanel: 1 }, '', location.href);
          mobileEditPanelHistory = true;
        } catch (e) { /* ignore */ }
      }
      if (!isMobileViewport()) {
        const container = document.getElementById('cardsContainer');
        primeDesktopCardGrid(container);
        scheduleWarehouseMasonryLayout(true);
        requestAnimationFrame(() => {
          layoutMasonryGrid();
          requestAnimationFrame(layoutMasonryGrid);
        });
        setTimeout(() => layoutMasonryGrid(), 140);
      }
    }
    window.addEventListener('popstate', () => {
      if (!isMobileViewport()) return;
      if (document.body.classList.contains('panel-open')) {
        closeEditPanel({ fromPopstate: true, skipHistory: true });
      } else {
        mobileEditPanelHistory = false;
      }
    });

    window.AppLightbox?.init({
      getCards: () => cards,
      getSelectedCardId: () => selectedCardId,
      getWarehousePreviewCardId: () => warehousePreviewCardId,
      isGlobalViewActive: () => globalViewActive,
      cardHasDisplayImage,
      showToast: (msg, ms) => window.showToast(msg, ms),
      downloadCardImageFile: (...args) => window.downloadCardImageFile?.(...args),
      promptHubSaveImage: (...args) => window.promptHubSaveImage?.(...args),
      setDownloadTriggerBusy: (...args) => window.MediaDownload?.setDownloadTriggerBusy?.(...args),
      markQuickPreviewTask,
      openAppreciateViewer: (id) => window.openAppreciateViewer?.(id)
    });

    window.MediaDownload?.init({
      showToast: (msg, ms) => showToast(msg, ms),
      formatFileSize,
      getCardById: (id) => cards.find((c) => c.id === id)
    });

    window.AppAppreciate?.init({
      getCards: () => cards,
      cardHasDisplayImage,
      markQuickPreviewTask,
      getWarehousePreviewCardId: () => warehousePreviewCardId,
      setWarehousePreviewCardId: (id) => { warehousePreviewCardId = id; },
      isGlobalViewActive: () => globalViewActive,
      setGlobalViewActive,
      renderCards,
      scheduleLayoutMasonry,
      switchAppPage,
      closeEditPanel,
      isBatchMode: () => batchMode,
      cancelBatch
    });

    function cardsForActiveWarehouse(list) {
      if (window.FeatureAssets?.filterCardsByWarehouse) {
        return window.FeatureAssets.filterCardsByWarehouse(list || cards);
      }
      return list || cards;
    }

    function getActiveWarehouseId() {
      return window.FeatureAssets?.getActiveWarehouseId?.() || 'default';
    }

    window.currentGroup = currentGroup;

    function showContextMenu(x, y, items) {
      const menu = document.getElementById('contextMenu');
      menu.innerHTML = items.map(i => `<button>${i.label}</button>`).join('');
      menu.style.display = 'block'; menu.style.left = x + 'px'; menu.style.top = y + 'px';
      menu.querySelectorAll('button').forEach((btn, idx) => btn.addEventListener('click', () => { items[idx].action(); menu.style.display = 'none'; }));
      const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
      setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    }
    window.showContextMenu = showContextMenu;
    window.refreshWarehouseUI = refreshWarehouseUI;

    document.getElementById('sidebarArea').addEventListener('contextmenu', e => { if (e.target.closest('.group-item')) return; e.preventDefault(); });
    document.getElementById('mainContentArea').addEventListener('contextmenu', e => { if (e.target.closest('.card') || e.target.closest('.main-header')) return; e.preventDefault(); showContextMenu(e.clientX, e.clientY, [{ label: '新建卡片', action: () => createNewCard() }]); });
    document.getElementById('viewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || btn.classList.contains('active')) return;
      runCardsLayoutTransition(() => {
        document.querySelectorAll('#viewToggle button[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCards(true);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const viewer = document.getElementById('appreciateViewer');
      if (viewer?.classList.contains('active')) {
        safeCloseAppreciateViewer();
        return;
      }
      if (globalViewActive || document.body.classList.contains('community-appreciate')) safeExitGlobalView();
    });

    let modalImageData = null;
    function openOcrModal() { document.getElementById('ocrModal').style.display = 'flex'; modalImageData = null; document.getElementById('modalPlaceholder').style.display = 'block'; document.getElementById('modalPreview').style.display = 'none'; document.getElementById('ocrProgress').style.display = 'none'; document.getElementById('modalOcrResult').style.display = 'none'; document.getElementById('modalStatus').textContent = ''; }
    function closeOcrModal() { document.getElementById('ocrModal').style.display = 'none'; }
    function handleModalImage(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => {
        modalImageData = e.target.result;
        document.getElementById('modalPreview').src = modalImageData;
        document.getElementById('modalPreview').style.display = 'block';
        document.getElementById('modalPlaceholder').style.display = 'none';
        runModalOCR();
      };
      r.readAsDataURL(file);
    }
    async function recognizeImageText(dataUrl) {
      if (!dataUrl) return '';
      const engine = settings.engine || 'tesseract';
      if (engine === 'ocrspace' && settings.apiKey) {
        try {
          const fd = new FormData();
          fd.append('apikey', settings.apiKey);
          fd.append('base64Image', dataUrl);
          fd.append('language', 'chs');
          fd.append('isOverlayRequired', 'false');
          const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
          const d = await resp.json();
          if (d.ParsedResults?.length) return d.ParsedResults[0].ParsedText.trim();
        } catch (e) { /* ignore */ }
        return '';
      }
      try {
        await ensureTesseractScript();
        const result = await Tesseract.recognize(dataUrl, 'chi_sim+eng', { tessedit_pageseg_mode: '6' });
        return result.data.text.trim();
      } catch (e) {
        return '';
      }
    }

    window.runPanelImageOcr = recognizeImageText;

    async function runModalOCR() {
      if (!modalImageData) return;
      const status = document.getElementById('modalStatus');
      const progress = document.getElementById('ocrProgress');
      const progressBar = document.getElementById('ocrProgressBar');
      progress.style.display = 'block'; progressBar.style.width = '0%'; status.textContent = '';
      const engine = settings.engine || 'tesseract';
      let text = '';
      if (engine === 'ocrspace' && settings.apiKey) {
        progressBar.style.width = '30%';
        try {
          const fd = new FormData();
          fd.append('apikey', settings.apiKey);
          fd.append('base64Image', modalImageData);
          fd.append('language', 'chs');
          fd.append('isOverlayRequired', 'false');
          progressBar.style.width = '60%';
          const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
          progressBar.style.width = '90%';
          const d = await resp.json();
          if (d.ParsedResults?.length) text = d.ParsedResults[0].ParsedText.trim();
        } catch (e) { status.textContent = '接口失败'; }
      } else {
        try {
          await ensureTesseractScript();
          const result = await Tesseract.recognize(modalImageData, 'chi_sim+eng', {
            tessedit_pageseg_mode: '6',
            logger: m => {
              if (m.status === 'recognizing text' && m.progress) {
                progressBar.style.width = Math.round(m.progress * 100) + '%';
              }
            }
          });
          text = result.data.text.trim();
