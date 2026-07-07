        if (!url) return null;
        try {
          const res = await fetch(url);
          if (res.ok) return await res.blob();
        } catch (e) { /* ignore */ }
        if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
          try {
            const blobUrl = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
            if (blobUrl) {
              const res = await fetch(blobUrl);
              if (res.ok) {
                const blob = await res.blob();
                try { URL.revokeObjectURL(blobUrl); } catch (e2) { /* ignore */ }
                return blob;
              }
            }
          } catch (e) { /* ignore */ }
        }
        return null;
      }
      if (imageRef && window.SupabaseSync?.isLoggedIn?.()) {
        image = pickStorageRef(imageRef);
        if (!image) {
          for (const alt of altStorageRefs()) {
            image = pickStorageRef(alt);
            if (image) break;
          }
        }
        if (!image && !opts.skipBlobCopy) {
        try {
          let source = await blobFromRef(imageRef);
          if (!source && post.authorId && post.sourceCardId) {
            for (const alt of altStorageRefs()) {
              source = await blobFromRef(alt);
              if (source) break;
            }
          }
          if (source && window.SupabaseSync.uploadCardImage) {
            image = await window.SupabaseSync.uploadCardImage(cardId, source);
          }
        } catch (e) {
          console.warn('[addCardFromCommunity] image copy failed', e);
        }
        }
      }
      const newCard = {
        id: cardId,
        title: (post.title || '社区收藏') + '',
        prompt: post.prompt,
        image: image || null,
        group: null,
        tags: [COLLECT_TAG],
        customFields: {},
        favoritedFromPostId: post.id,
        communitySourceAuthorId: String(post.authorId || ''),
        communitySourceCardId: post.sourceCardId ? String(post.sourceCardId) : '',
        publishedToCommunity: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      cards.push(newCard);
      if (image && !String(image).startsWith('storage://') && window.SupabaseSync?.ensureCardImageOnCloud) {
        try {
          const up = await window.SupabaseSync.ensureCardImageOnCloud(newCard);
          if (up?.image) newCard.image = up.image;
        } catch (e) { /* ignore */ }
      }
      await saveAllData({ skipCloud: true });
      if (window.SupabaseSync?.isLoggedIn?.()) {
        scheduleCloudPush();
      }
      const refreshCards = () => {
        renderGroups();
        renderCards(true);
      };
      if (opts.deferRender) {
        setTimeout(refreshCards, 0);
      } else {
        refreshCards();
      }
      return { ok: true, imageCopied: !!image };
    };

    window.addCardFromGenerated = async function (payload) {
      const { prompt, image, title, sourceId, jobId } = payload || {};
      const CG = window.PromptHubCardGallery;
      const galleryInput = Array.isArray(payload?.cardImages)
        ? payload.cardImages.filter(Boolean).slice(0, CG?.MAX || 5)
        : null;
      const primaryImage = galleryInput?.length ? galleryInput[0] : image;
      const payloadRefImages = [];
      const addPayloadRef = (ref) => {
        const value = String(ref || '').trim();
        if (!value) return;
        const ok = window.FeatureDraft?.isDisplayableImage?.(value)
          ?? window.EditPanelGallery?.isDisplayableImageUrl?.(value)
          ?? /^(data:image\/|https?:\/\/|blob:|storage:\/\/)/i.test(value);
        if (!ok || payloadRefImages.includes(value)) return;
        payloadRefImages.push(value);
      };
      if (Array.isArray(payload?.refImages)) payload.refImages.forEach(addPayloadRef);
      addPayloadRef(payload?.refImage);
      const payloadRefImage = payloadRefImages[0] || null;
      const applyGeneratedRefs = (cardTarget) => {
        if (!cardTarget || !payloadRefImage) return false;
        cardTarget.refImage = payloadRefImage;
        cardTarget.refImages = payloadRefImages.length ? [...payloadRefImages] : null;
        cardTarget.hasRefImage = true;
        return true;
      };
      if (!primaryImage && !(prompt || '').trim()) {
        showToast('无内容可保存');
        return { ok: false };
      }
      if (jobId) {
        const jobTomb = window.getDeletedGenerationJobTombstones?.() || {};
        const jobKey = String(jobId);
        const jobBase = jobKey.replace(/#\d+$/, '');
        if (jobTomb[jobKey] || (jobBase && jobTomb[jobBase])) {
          return { ok: false, duplicate: true, skipped: true };
        }
      }
      if (jobId && cards.some(c => {
        const base = String(jobId).replace(/#\d+$/, '');
        const existing = String(c.genJobId || '').replace(/#\d+$/, '');
        return existing && existing === base;
      })) {
        const existing = cards.find(c => String(c.genJobId || '').replace(/#\d+$/, '') === String(jobId).replace(/#\d+$/, ''));
        if (existing && galleryInput?.length && CG) {
          const merged = CG.mergeCardGalleryImages(CG.normalizeCardGallery(existing), galleryInput);
          existing.cardImages = merged;
          CG.syncCardGalleryFields(existing);
          if (Array.isArray(payload.mjButtons) && payload.mjButtons.length) existing.mjButtons = payload.mjButtons;
          if (payload.mjCompositeUrl) existing.mjCompositeUrl = payload.mjCompositeUrl;
          for (let i = 0; i < merged.length; i += 1) {
            const src = galleryInput[i] || merged[i];
            if (!src || merged[i] !== src) continue;
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.archiveGeneratedCardImage) {
              try {
                const slotJob = i === 0 ? jobId : `${String(jobId).replace(/#\d+$/, '')}#${i + 1}`;
                const archived = await window.SupabaseSync.archiveGeneratedCardImage(existing.id, src, { jobId: slotJob });
                if (archived && archived !== src) merged[i] = archived;
              } catch (e) { /* ignore */ }
            }
          }
          existing.cardImages = merged;
          CG.syncCardGalleryFields(existing);
          applyGeneratedRefs(existing);
          if (!payload.isRecovery) existing.updatedAt = Date.now();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
          window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
          return { ok: true, cardId: existing.id, merged: true };
        }
        if (existing && primaryImage) {
          const needsRepair = !existing.image
            || /^https?:\/\//i.test(existing.image)
            || (window.SupabaseSync?.isDataUrl?.(existing.image))
            || (window.SupabaseSync?.isStorageRef?.(existing.image)
              && window.SupabaseSync.storagePathFromRef?.(existing.image)
              && window.SupabaseSync.isPathKnownMissing?.(window.SupabaseSync.storagePathFromRef(existing.image)));
          if (needsRepair) {
            let stored = primaryImage;
            if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.archiveGeneratedCardImage) {
              try {
                stored = await window.SupabaseSync.archiveGeneratedCardImage(existing.id, primaryImage, {
                  jobId: jobId || existing.genJobId || null
                }) || primaryImage;
              } catch (e) {
                console.warn('[addCardFromGenerated] duplicate repair archive failed', e);
              }
            }
            existing.image = stored;
            applyGeneratedRefs(existing);
            if (!payload.isRecovery) existing.updatedAt = Date.now();
            await saveAllData({ skipCloud: true });
            renderGroups();
            renderCards(true);
            if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
            window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
            return { ok: true, cardId: existing.id, repaired: true };
          }
        }
        if (existing && primaryImage && !existing.image) {
          existing.image = primaryImage;
          applyGeneratedRefs(existing);
          if (!payload.isRecovery) existing.updatedAt = Date.now();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
          window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
          return { ok: true, cardId: existing.id, repaired: true };
        }
        if (applyGeneratedRefs(existing)) {
          if (!payload.isRecovery) existing.updatedAt = Date.now();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
        }
        window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
        return { ok: false, duplicate: true, cardId: existing?.id };
      }
      if (sourceId && cards.some(c => c.genSourceId === sourceId)) {
        const existing = cards.find(c => c.genSourceId === sourceId);
        if (applyGeneratedRefs(existing)) {
          if (!payload.isRecovery) existing.updatedAt = Date.now();
          await saveAllData({ skipCloud: true });
          renderGroups();
          renderCards(true);
          if (window.SupabaseSync?.isLoggedIn?.()) scheduleCloudPush({ urgent: true });
        }
        window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
        return { ok: false, duplicate: true, cardId: existing?.id };
      }
      if (!isUserLoggedIn()) {
        const check = canGuestCreateCard();
        if (!check.ok) {
          promptLogin(check.msg);
          return { ok: false };
        }
      }
      const promptText = (prompt || '').trim();
      const tags = [window.GEN_AUTO_TAG || '图片生成'];
      if (payload.fromInspirationDraw) tags.push(window.INSPIRE_DRAW_TAG || '灵感抽卡');
      const extraTags = Array.isArray(payload.targetTags) ? payload.targetTags : [];
      for (const raw of extraTags) {
        const t = String(raw || '').replace(/^#+/, '').trim();
        if (!t || window.isSystemCardTag?.(t) || tags.includes(t)) continue;
        tags.push(t);
      }
      const targetGroup = typeof payload.targetGroup === 'string' ? payload.targetGroup.trim() : '';
      const card = {
        id: payload.cardId || generateId(),
        title: (title || '').trim(),
        prompt: promptText,
        image: primaryImage || null,
        group: targetGroup || null,
        tags,
        customFields: {},
        genSourceId: sourceId || null,
        genJobId: jobId || null,
        genBatchId: payload.genBatchId || null,
        genBatchJobIds: Array.isArray(payload.genBatchJobIds) ? payload.genBatchJobIds.filter(Boolean) : null,
        resolution: payload.resolution || null,
        model: payload.model || null,
        genQuality: payload.quality || null,
        refImage: payloadRefImage,
        refImages: payloadRefImages.length ? [...payloadRefImages] : null,
        hasRefImage: !!payloadRefImage,
        isMidjourney: !!payload.isMidjourney,
        cardImages: galleryInput?.length ? galleryInput : null,
        mjGridUrls: Array.isArray(payload.mjGridUrls) ? payload.mjGridUrls.filter(Boolean) : null,
        mjCompositeUrl: payload.mjCompositeUrl || null,
        mjButtons: Array.isArray(payload.mjButtons) ? payload.mjButtons : null,
        genSize: payload.size || null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (CG?.syncCardGalleryFields) CG.syncCardGalleryFields(card);
      cards.push(card);
      const imagesToArchive = CG?.normalizeCardGallery(card) || (primaryImage ? [primaryImage] : []);
      const copyStorage = payload.copyStorage === true;
      for (let i = 0; i < imagesToArchive.length; i += 1) {
        const src = imagesToArchive[i];
        if (!src) continue;
        if (i === 0) void saveCardImageBackup(card.id, src).catch(() => {});
        if (!window.SupabaseSync?.isLoggedIn?.()) continue;
        try {
          if (copyStorage && window.SupabaseSync?.uploadCardImage && i === 0) {
            const archived = await window.SupabaseSync.uploadCardImage(card.id, src);
            if (archived) {
              card.image = archived;
              if (Array.isArray(card.cardImages) && card.cardImages[i]) card.cardImages[i] = archived;
            }
            continue;
          }
          if (copyStorage && window.SupabaseSync?.archiveGeneratedCardImage && i > 0) {
            const slotJob = jobId ? `${String(jobId).replace(/#\d+$/, '')}#${i + 1}` : null;
            const archived = await window.SupabaseSync.archiveGeneratedCardImage(card.id, src, {
              jobId: slotJob,
              copyToOwnPath: true
            });
            if (archived) {
              if (Array.isArray(card.cardImages) && card.cardImages[i]) card.cardImages[i] = archived;
              if (i === 0) card.image = archived;
            }
            continue;
          }
          if (window.SupabaseSync?.archiveGeneratedCardImage) {
            const slotJob = jobId ? (i === 0 ? jobId : `${String(jobId).replace(/#\d+$/, '')}#${i + 1}`) : null;
            const archived = await window.SupabaseSync.archiveGeneratedCardImage(card.id, src, {
              jobId: slotJob
            });
            if (archived && archived !== src) {
              if (Array.isArray(card.cardImages) && card.cardImages[i]) card.cardImages[i] = archived;
              if (i === 0) card.image = archived;
            }
          }
        } catch (e) {
          console.warn('[addCardFromGenerated] gallery archive failed', i, e);
        }
      }
      if (CG?.syncCardGalleryFields) CG.syncCardGalleryFields(card);
      if (payload.publishToCommunity && window.FeatureDraft?.syncCardToCommunity) {
        if (window.FeatureDraft?.isCommunityPublishEligible?.(card)) {
          await window.FeatureDraft.syncCardToCommunity(card, true);
          card.publishedToCommunity = true;
        } else {
          card.publishedToCommunity = false;
        }
      }
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      updateGuestLimitUI();
      if (window.SupabaseSync?.isLoggedIn?.()) {
        scheduleCloudPush({ urgent: true });
      }
      if (!payload.silentToast) {
        const published = payload.publishToCommunity && window.FeatureDraft?.isCommunityPublishEligible?.(card);
        showToast(published ? '已保存到仓库并公开到社区' : '已保存到卡片仓库');
      }
      window.FeatureDraft?.prunePendingGenJobsFromWarehouse?.();
      return { ok: true, cardId: card.id };
    };

    let genCardImageRepairInflight = null;
    let genCardImageRepairLastAt = 0;
    let warehouseBulkRepairInflight = null;

    /** 卡片库老图批量修复：从生图任务重新归档 + 生成 _grid（LabGen 对齐 · 项 1） */
    async function runWarehouseBulkRepair(opts = {}) {
      if (!window.PromptHubApi?.recoverWarehouseFromJobs) {
        showToast('请先 Ctrl+Shift+R 强刷到最新版', 6000);
        return { ok: false, error: 'api_missing' };
      }
      if (!window.SupabaseSync?.isLoggedIn?.()) return { ok: false, error: 'not_logged_in' };
      if (warehouseBulkRepairInflight) return warehouseBulkRepairInflight;

      const batchMax = Math.min(20, Math.max(1, Number(opts.max) || 16));
      const maxRounds = Math.min(40, Math.max(1, Number(opts.maxRounds) || 20));
      const silent = opts.silent === true;
      const roundDelayMs = Math.min(5000, Math.max(800, Number(opts.roundDelayMs) || 1200));
      let liveBatchMax = batchMax;

      warehouseBulkRepairInflight = (async () => {
        window.__phBulkRepairActive = true;
        let offset = 0;
        let totalRepaired = 0;
        let totalCandidates = 0;
        let stagnant = 0;
        let totalCards = 0;

        window.SupabaseSync?.bootstrapWarehouseMediaCache?.({ clearAllMissing: true });
        window.SupabaseSync?.clearSignedUrlCache?.();
        window.SupabaseSync?.clearListImageMissMarks?.();
        if (!silent) console.info('[warehouse-repair] start', { batchMax: liveBatchMax, maxRounds, roundDelayMs });

        if (!silent) {
          setCloudSyncPhase('syncing', '正在修复卡片库图片…');
          showToast('正在批量修复卡片库图片（老卡从云端重新归档）…', 6000);
        }

        async function callRepair() {
          return window.PromptHubApi.recoverWarehouseFromJobs({
            mode: 'repair',
            max: liveBatchMax,
            days: 365,
            offset,
            providerScope: 'all'
          });
        }

        for (let round = 0; round < maxRounds; round += 1) {
          let res = await callRepair();
          if (!res?.ok && (res?.code === 'NETWORK_ERROR' || res?.status === 503 || res?.status === 524)) {
            liveBatchMax = Math.max(8, Math.floor(liveBatchMax / 2));
            if (!silent) {
              console.warn('[warehouse-repair] 503/超时（非 CORS 配置问题），降为', liveBatchMax, '张/批，8s 后重试…');
            }
            await new Promise((r) => setTimeout(r, 8000));
            res = await callRepair();
          }
          if (!res?.ok) {
            if (!silent) {
              setCloudSyncPhase('error', res.message || res.code);
              showToast(
                '修复失败：' + (res.message || res.code || '未知错误') + '（可改用终端 run-warehouse-repair.mjs）',
                9000
              );
            }
            break;
          }
          const d = res.data || {};
          const n = Number(d.repaired) || 0;
          totalRepaired += n;
          totalCandidates = Number(d.totalCandidates) || totalCandidates;
          totalCards = Number(d.totalCards) || totalCards;
          const nextOff = d.nextOffset;
          if (!silent) {
            console.info('[warehouse-repair] round', round + 1, {
              repaired: n,
              totalRepaired,
              totalCandidates,
              offset,
              nextOffset: nextOff,
              totalCards,
              failures: (d.failures || res.failures || []).slice(0, 3)
            });
          }
          if (n > 0) {
            stagnant = 0;
            offset = nextOff != null ? nextOff : offset;
            window.SupabaseSync?.clearSignedUrlCache?.();
            window.SupabaseSync?.clearListImageMissMarks?.();
            await pullFromCloud();
            window.__promptHubCards = cards;
            renderGroups();
            if (page > 1 && typeof rerenderWarehouseCardsKeepingScroll === 'function') {
              await rerenderWarehouseCardsKeepingScroll();
            } else {
              renderCards(true);
            }
            if (!silent) setCloudSyncPhase('syncing', `已修复 ${totalRepaired} 张…`);
          } else if (nextOff != null) {
            stagnant = 0;
            offset = nextOff;
          } else {
            break;
          }
          await new Promise((r) => setTimeout(r, roundDelayMs));
        }

        if (totalRepaired > 0) {
          setCloudSyncPhase('saved');
          if (!silent) {
            showToast(`卡片库图片修复完成：共 ${totalRepaired} 张。请稍等缩略图加载`, 10000);
          }
        } else if (!silent) {
          setCloudSyncPhase('saved');
          showToast('暂无可自动修复的图片（可能 R2/Supabase 里原图也不存在，需跑 sync-supabase-to-r2）', 9000);
        }
        if (!silent) console.info('[warehouse-repair] done', { totalRepaired, totalCandidates });
        return { ok: true, repaired: totalRepaired, totalCandidates };
      })().finally(() => {
        window.__phBulkRepairActive = false;
        warehouseBulkRepairInflight = null;
      });

      return warehouseBulkRepairInflight;
    }
    window.runWarehouseBulkRepair = runWarehouseBulkRepair;

    /** 诊断卡片库顶部灰块：判断是「加载失败」还是「图片真丢了」 */
    async function diagnoseGreyWarehouseCards(n = 12) {
      const limit = Math.min(24, Math.max(1, Number(n) || 12));
      const list = [...cards].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, limit);
      const rows = [];
      for (const c of list) {
        const meta = window.PromptHubCardGallery?.getWarehouseListThumbMeta?.(c, { skipEnsure: true });
        const baseJob = String(c.genJobId || '').replace(/#\d+$/, '');
        let apiOk = '—';
        if (baseJob && window.PromptHubApi?.getGenerationImageUrl) {
          try {
            const r = await window.PromptHubApi.getGenerationImageUrl(baseJob);
            apiOk = r?.ok && r.data?.url ? '有' : (r?.code || r?.status || '无');
          } catch (e) {
            apiOk = 'err';
          }
        }
        const img = c.image || '';
        let imgKind = '空';
        if (img && window.SupabaseSync?.isStorageRef?.(img)) imgKind = 'storage';
        else if (/^https?:\/\//i.test(img)) {
          imgKind = window.SupabaseSync?.isEphemeralUpstreamImageUrl?.(img) ? '临时链' : 'https';
        } else if (img) imgKind = 'other';
        rows.push({
          时间: new Date(c.createdAt || 0).toLocaleDateString(),
          genJobId: baseJob ? '有' : '无',
          图片引用: imgKind,
          缩略: meta?.cachedUrl ? '已缓存' : (meta?.hasImage ? '灰块/待载' : '纯文字'),
          云端API: apiOk
        });
      }
      console.table(rows);
      console.info('[diagnose] genJobId=有 且 云端API=有 → 多半可修复，跑 runWarehouseBulkRepair');
      console.info('[diagnose] genJobId=无 且 图片引用=空/临时链 且 云端API=无 → 可能永久丢失');
      return { rows };
    }
    window.diagnoseGreyWarehouseCards = diagnoseGreyWarehouseCards;

    /** 合并重复卡片（同 genJobId / 同「自动恢复」提示词）并写回云端 */
    async function pruneDuplicateWarehouseCards(opts = {}) {
      const dedupe = window.CloudSyncSafety?.dedupeWarehouseCards;
      if (!dedupe) return { ok: false, error: 'dedupe_missing' };
      const before = cards.length;
      const next = dedupe(cards);
      const removed = before - next.length;
      if (removed <= 0) {
        if (!opts.silent) showToast('未发现可合并的重复卡片', 5000);
        return { ok: true, removed: 0, total: before };
      }
      cards = next;
      window.__promptHubCards = cards;
      window.invalidateWarehouseCardsForImageGenCache?.();
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      if (window.SupabaseSync?.isLoggedIn?.()) {
        await scheduleCloudPush({ urgent: true });
      }
      if (!opts.silent) showToast(`已合并 ${removed} 张重复卡片（剩余 ${next.length} 张）`, 8000);
      return { ok: true, removed, total: next.length };
    }
    window.pruneDuplicateWarehouseCards = pruneDuplicateWarehouseCards;

    async function repairGeneratedCardImagesQuiet() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      try {
        if (localStorage.getItem('ph_wh_auto_repair') !== '1') return;
      } catch (e) {
        return;
      }
      if (genCardImageRepairInflight) return genCardImageRepairInflight;
      const now = Date.now();
      if (now - genCardImageRepairLastAt < 600000) return;
      genCardImageRepairLastAt = now;
      genCardImageRepairInflight = (async () => {
        await runWarehouseBulkRepair({ max: 24, maxRounds: 1, silent: true, roundDelayMs: 2000 });
      })().finally(() => { genCardImageRepairInflight = null; });
      return genCardImageRepairInflight;
    }
    window.repairGeneratedCardImagesQuiet = repairGeneratedCardImagesQuiet;
    window.repairMjWarehousePreviewsQuiet = async () => {
      const r = await window.FeatureDraft?.repairMjWarehousePreviewsQuiet?.();
      return r;
    };

    function showCustomModal(title, content, onConfirm, onCancel, isPrompt = false, suggestions = [], opts = {}) {
      const overlay = document.getElementById('customModalOverlay');
      const modal = document.getElementById('customModal');
      let inputHtml = '';
      if (isPrompt) inputHtml = '<input type="text" id="customModalInput" placeholder="">';
      let suggestionsHtml = '';
      if (suggestions.length) {
        suggestionsHtml = '<div class="suggestions">' + suggestions.map(s => `<span onclick="document.getElementById('customModalInput').value='${escapeJsString(s)}'; document.getElementById('customModalConfirm').focus();">${escapeHtml(s)}</span>`).join('') + '</div>';
      }
      const bodyHtml = escapeHtml(String(content || '')).replace(/\n/g, '<br>');
      const confirmLabel = opts.confirmLabel || '确定';
      const confirmClass = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
      modal.innerHTML = `<h3>${escapeHtml(title)}</h3><p class="custom-modal-body">${bodyHtml}</p>${inputHtml}${suggestionsHtml}<div class="modal-actions"><button type="button" class="${confirmClass}" id="customModalConfirm">${escapeHtml(confirmLabel)}</button><button type="button" class="btn btn-secondary" id="customModalCancel">取消</button></div>`;
      overlay.classList.add('active');
      document.body.classList.add('custom-modal-open');
      document.getElementById('customModalCancel').onclick = () => { closeCustomModal(); if(onCancel) onCancel(); };
      document.getElementById('customModalConfirm').onclick = () => { const value = isPrompt ? document.getElementById('customModalInput')?.value : true; closeCustomModal(); if(onConfirm) onConfirm(value); };
      if (isPrompt) document.getElementById('customModalInput').focus();
    }
    function closeCustomModal() {
      document.getElementById('customModalOverlay')?.classList.remove('active');
      document.body.classList.remove('custom-modal-open');
    }
    window.closeCustomModal = closeCustomModal;
    function customConfirm(msg, onConfirm, onCancel, opts) {
      showCustomModal('确认', msg, onConfirm, onCancel, false, [], opts || {});
    }
    window.customConfirm = customConfirm;
    function customPrompt(msg, defaultText, onConfirm, onCancel, suggestions = []) {
      showCustomModal('输入', msg, (val) => onConfirm(val), onCancel, true, suggestions);
      if (defaultText) setTimeout(() => { const inp = document.getElementById('customModalInput'); if(inp) inp.value = defaultText; }, 50);
    }

    function saveActiveFilters() {
      localStorage.setItem('promptrepo_filters', JSON.stringify([...activeFilters]));
    }

    function getFilterOptions() {
      const base = [
        { value: 'image', label: '有图片' },
        { value: 'text', label: '纯文字' }
      ];
      const tags = (window.getSelectableCardTags?.(cards) || []).map(t => ({
        value: 'tag:' + String(t).replace(/^#+/, ''),
        label: '#' + String(t).replace(/^#+/, '')
      }));
      return base.concat(tags);
    }

    function resolveWarehouseCardKind(card) {
      if (window.FeatureDraft?.getWarehouseCardKind) {
        return window.FeatureDraft.getWarehouseCardKind(card);
      }
      return cardHasDisplayImage(card) ? 'visual' : 'text';
    }

    function cardMatchesFilters(card) {
      if (activeFilters.size === 0) return true;
      const kind = resolveWarehouseCardKind(card);
      return [...activeFilters].some(f => {
        const key = normalizeWarehouseFilterValue(f);
        if (key === 'image') return kind === 'visual';
        if (key === 'text') return kind === 'text';
        if (key.startsWith('tag:')) {
          const needle = key.slice(4);
          return (card.tags || []).some(t => String(t).replace(/^#+/, '') === needle);
        }
        return false;
      });
    }

    function updateTagFilter() {
      buildFilterMenu();
      syncFilterBtnState();
    }

    function clearWarehouseFilters(opts = {}) {
      if (activeFilters.size === 0 && !opts.force) return;
      activeFilters.clear();
      saveActiveFilters();
      syncFilterBtnState();
      document.getElementById('searchInput') && (document.getElementById('searchInput').value = '');
      const mobileSearch = document.getElementById('searchInputMobile');
      if (mobileSearch) mobileSearch.value = '';
      renderCards(true);
      buildFilterMenu();
      if (opts.toast !== false) showToast('已清除筛选');
    }
    window.clearWarehouseFilters = clearWarehouseFilters;

    function syncFilterBtnState() {
      const n = activeFilters.size;
      document.getElementById('filterBtn')?.classList.toggle('active', n > 0);
      document.getElementById('warehouseFilterClearBtn')?.classList.toggle('hidden', n === 0);
    }

    function portalDropdownToBody(dd, homeParent) {
      if (!dd) return;
      if (!dd.dataset.portalHomeId && homeParent?.id) {
        dd.dataset.portalHomeId = homeParent.id;
      }
      if (dd.parentElement !== document.body) {
        document.body.appendChild(dd);
      }
    }

    function restoreDropdownPortal(dd) {
      if (!dd?.dataset.portalHomeId) return;
      const home = document.getElementById(dd.dataset.portalHomeId);
      if (home && dd.parentElement === document.body) {
        home.appendChild(dd);
      }
    }

    function positionAnchoredDropdown(dd, btn, minWidth) {
      if (!dd || !btn) return;
      const r = btn.getBoundingClientRect();
      const width = Math.max(minWidth || 132, Math.round(r.width));
      let left = Math.round(r.left);
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      dd.style.position = 'fixed';
      dd.style.top = `${Math.round(r.bottom + 6)}px`;
      dd.style.left = `${left}px`;
      dd.style.right = 'auto';
      dd.style.width = `${width}px`;
      dd.style.minWidth = `${width}px`;
      dd.style.zIndex = '13050';
    }

    function positionFilterDropdown() {
      const dd = document.getElementById('filterDropdown');
      const btn = document.getElementById('filterBtn');
      if (!dd || !btn) return;
      portalDropdownToBody(dd, document.querySelector('.filter-menu-wrap'));
      positionAnchoredDropdown(dd, btn, 220);
    }

    function positionSortDropdown() {
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (!dd || !btn) return;
      portalDropdownToBody(dd, document.getElementById('sortMenuWrap'));
      positionAnchoredDropdown(dd, btn, 132);
    }

    function resetSortDropdownPosition() {
      const dd = document.getElementById('sortDropdown');
      if (!dd) return;
      dd.style.position = '';
      dd.style.top = '';
      dd.style.left = '';
      dd.style.right = '';
      dd.style.width = '';
      dd.style.minWidth = '';
      dd.style.zIndex = '';
      restoreDropdownPortal(dd);
    }

    function resetFilterDropdownPosition() {
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      dd.style.position = '';
      dd.style.top = '';
      dd.style.right = '';
      dd.style.left = '';
      dd.style.width = '';
      dd.style.minWidth = '';
      dd.style.zIndex = '';
      restoreDropdownPortal(dd);
    }

    function buildFilterMenu() {
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      activeFilters = normalizeActiveFilters(activeFilters);
      const valid = new Set(getFilterOptions().map(o => o.value));
      activeFilters.forEach(f => { if (!valid.has(f)) activeFilters.delete(f); });
      dd.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'filter-dropdown-head';
      head.innerHTML = '<span>筛选（可多选）</span><button type="button" class="filter-clear-btn">清除</button>';
      head.querySelector('.filter-clear-btn').onclick = (e) => {
        e.stopPropagation();
        clearWarehouseFilters({ toast: false });
      };
      dd.appendChild(head);
      getFilterOptions().forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-option' + (activeFilters.has(opt.value) ? ' active' : '');
        btn.innerHTML = '<span class="filter-check"></span><span class="filter-label">' + escapeHtml(opt.label) + '</span>';
        btn.onclick = (e) => {
          e.stopPropagation();
          if (activeFilters.has(opt.value)) activeFilters.delete(opt.value);
          else {
            if (opt.value === 'text') activeFilters.delete('image');
            if (opt.value === 'image') activeFilters.delete('text');
            activeFilters.add(opt.value);
          }
          saveActiveFilters();
          syncFilterBtnState();
          renderCards(true);
          btn.classList.toggle('active', activeFilters.has(opt.value));
        };
        dd.appendChild(btn);
      });
      if (!getFilterOptions().length) {
        const empty = document.createElement('div');
        empty.className = 'filter-empty';
        empty.textContent = '暂无筛选项';
        dd.appendChild(empty);
      }
    }

    function toggleFilterMenu(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const dd = document.getElementById('filterDropdown');
      if (!dd) return;
      const willOpen = !dd.classList.contains('open');
      buildFilterMenu();
      if (willOpen) {
        positionFilterDropdown();
        dd.classList.add('open');
        closeSortMenu();
      } else {
        dd.classList.remove('open');
        resetFilterDropdownPosition();
      }
    }
    window.toggleFilterMenu = toggleFilterMenu;

    function initFilterMenu() {
      const btn = document.getElementById('filterBtn');
      const dd = document.getElementById('filterDropdown');
      const clearBtn = document.getElementById('warehouseFilterClearBtn');
      if (!btn || !dd) return;
      btn.addEventListener('click', (e) => toggleFilterMenu(e));
      clearBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearWarehouseFilters();
      });
      dd.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-menu-wrap')) {
          dd.classList.remove('open');
          resetFilterDropdownPosition();
        }
        if (!e.target.closest('.sort-menu-wrap')) {
          closeSortMenu();
        }
      });
      window.addEventListener('resize', () => {
        if (dd.classList.contains('open')) positionFilterDropdown();
        if (!document.getElementById('sortDropdown')?.hidden) positionSortDropdown();
      });
      window.addEventListener('scroll', () => {
        if (dd.classList.contains('open')) positionFilterDropdown();
        if (!document.getElementById('sortDropdown')?.hidden) positionSortDropdown();
      }, true);
    }

    const SORT_OPTIONS = [
      { value: 'default', label: '默认' },
      { value: 'created-desc', label: '最近生成' },
      { value: 'updated-desc', label: '最近更新' },
      { value: 'updated-asc', label: '最远' },
      { value: 'random', label: '随机' }
    ];

    function getSortLabel(value) {
      return SORT_OPTIONS.find(o => o.value === value)?.label || '默认';
    }

    function setSortMode(value, opts = {}) {
      const v = SORT_OPTIONS.some(o => o.value === value) ? value : 'updated-desc';
      if (v === 'random') cardRandomSig = '';
      sortMode = v;
      try { localStorage.setItem(CARD_SORT_KEY, v); } catch (e) { /* ignore */ }
      const hidden = document.getElementById('sortSelect');
      if (hidden) hidden.value = v;
      const label = document.getElementById('sortMenuLabel');
      if (label) label.textContent = getSortLabel(v);
      document.querySelectorAll('#sortDropdown .sort-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === v);
        btn.setAttribute('aria-selected', btn.dataset.value === v ? 'true' : 'false');
      });
      if (opts.render !== false) renderCards(true);
    }

    function buildSortMenu() {
      const dd = document.getElementById('sortDropdown');
      if (!dd) return;
      dd.innerHTML = '';
      SORT_OPTIONS.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sort-option' + (sortMode === opt.value ? ' active' : '');
        btn.dataset.value = opt.value;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', sortMode === opt.value ? 'true' : 'false');
        btn.textContent = opt.label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          setSortMode(opt.value);
          closeSortMenu();
        });
        dd.appendChild(btn);
      });
    }

    function closeSortMenu() {
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (dd) {
        dd.hidden = true;
        resetSortDropdownPosition();
      }
      btn?.setAttribute('aria-expanded', 'false');
    }

    function toggleSortMenu(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const dd = document.getElementById('sortDropdown');
      const btn = document.getElementById('sortMenuBtn');
      if (!dd || !btn) return;
      const willOpen = dd.hidden;
      buildSortMenu();
      if (willOpen) {
        dd.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        positionSortDropdown();
        document.getElementById('filterDropdown')?.classList.remove('open');
        resetFilterDropdownPosition();
      } else {
        closeSortMenu();
      }
    }

    function initSortMenu() {
      const btn = document.getElementById('sortMenuBtn');
      const dd = document.getElementById('sortDropdown');
      if (!btn || !dd) return;
      let saved = sortMode;
      try {
        const ls = localStorage.getItem(CARD_SORT_KEY);
        if (ls && SORT_OPTIONS.some((o) => o.value === ls)) saved = ls;
      } catch (e) { /* ignore */ }
      if (!saved || saved === 'default') saved = 'updated-desc';
      setSortMode(saved, { render: false });
      buildSortMenu();
      btn.addEventListener('click', toggleSortMenu);
      dd.addEventListener('click', (e) => e.stopPropagation());
    }

    function searchByTag(tag) {
      activeFilters.add('tag:' + tag);
      saveActiveFilters();
      syncFilterBtnState();
      document.getElementById('searchInput').value = '';
      renderCards(true);
      showToast('已加入筛选 #' + tag);
    }

    function getMasonryGap() {
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-gap')) || 16;
    }

    function getCardsInnerWidth() {
      const container = document.getElementById('cardsContainer');
      if (!container) return 0;
      const style = getComputedStyle(container);
      return container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }

    let layoutMasonryTimer = null;

    function getDesktopCardColumnWidth() {
      const gap = getMasonryGap();
      const innerW = getCardsInnerWidth();
      if (innerW < 280) return 0;
      const cols = Math.max(1, cardColumns);
      return Math.max(120, Math.floor((innerW - gap * (cols - 1)) / cols));
    }

    function primeDesktopCardGrid(container) {
      if (!container || isMobileViewport()) return;
      const viewMode = document.querySelector('#viewToggle .active')?.dataset.view || 'grid';
      if (viewMode === 'list') return;
      const colWidth = getDesktopCardColumnWidth();
      if (!colWidth) return;
      let sizer = container.querySelector('.grid-sizer');
      if (!sizer) {
        sizer = document.createElement('div');
        sizer.className = 'grid-sizer';
        container.insertBefore(sizer, container.firstChild);
      }
      sizer.style.width = colWidth + 'px';
