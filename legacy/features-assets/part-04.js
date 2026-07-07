        const someSelected = visible.some((c) => selectedIds.has(c.id));
        const folderCheck = allVisibleSelected ? ' checked' : '';
        const folderInd = someSelected && !allVisibleSelected ? ' data-indeterminate="1"' : '';
        const previewHint =
          isCustom && folderPreviewIds instanceof Set
            ? `<span class="asset-publish-folder-preview-hint">文件夹预览 ${Math.min(folderPreviewIds.size, PACK_FOLDER_PREVIEW_MAX)}/${PACK_FOLDER_PREVIEW_MAX}</span>`
            : '';
        const folderNameCell =
          id === '_unassigned'
            ? `<span class="asset-publish-folder-name">${esc(name)}</span>`
            : `<input type="text" class="settings-input asset-publish-folder-rename-inline" data-folder-key="${esc(name)}" data-folder-id="${esc(id || name)}" value="${esc(name)}" maxlength="40" aria-label="文件夹名">`;
        return `<section class="asset-publish-folder" data-folder="${esc(name)}"${id ? ` data-folder-id="${esc(id)}"` : ''}>
      <div class="asset-publish-folder-head">
        <button type="button" class="asset-publish-folder-toggle" data-action="toggle" aria-expanded="${expanded}">${chevron}</button>
        ${folderNameCell}
        <span class="asset-publish-folder-count">${visible.length} 张</span>
        ${previewHint}
        <label class="asset-publish-folder-all"><input type="checkbox" data-action="select-folder"${folderCheck}${folderInd}> 全选本组</label>
      </div>
      <div class="asset-publish-folder-body${bodyClass}">
        <div class="asset-publish-card-grid">${visible
          .map((c) =>
            renderPublishCardRow(c, selectedIds, previewIds, thumbMap, packEditor, {
              previewIds: isCustom ? folderPreviewIds : previewIds,
              previewLimit: isCustom ? PACK_FOLDER_PREVIEW_MAX : 60
            })
          )
          .join('')}</div>
      </div>
    </section>`;
      })
      .filter(Boolean)
      .join('');

    if (!folderHtml) {
      return `${tagChips}${searchRow}<p class="panel-hint">没有符合筛选条件的卡片，请清除标签或搜索。</p>`;
    }

    const assignTarget = pickerState.assignTargetFolderId
      ? packEditor.folders.find((f) => f.id === pickerState.assignTargetFolderId)
      : null;
    const assignBanner = assignTarget
      ? `<div class="asset-publish-assign-banner">正在为「${esc(assignTarget.name)}」选卡：勾选卡片即可归入该文件夹。
        <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-assign">完成</button></div>`
      : '';

    return `${renderPackFolderToolbar(packEditor, warehouseId)}${isCustom ? renderPackCustomFolderList(packEditor.folders) : ''}${assignBanner}${tagChips}${searchRow}<div class="asset-publish-tree">${folderHtml}</div>`;
  }

  async function openPublishModal(opts) {
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('发布资产包需先登录');
      window.openAuthModal?.();
      return;
    }
    const editOpts = opts && typeof opts === 'object' ? opts : null;
    const editPackageId = editOpts?.editPackageId || null;
    const packCardsOverride = editOpts?.packCards || null;
    const overlay = document.getElementById('assetPublishOverlay');
    const body = document.getElementById('assetPublishBody');
    if (!overlay || !body) {
      toast('发布窗口未加载，请刷新页面');
      return;
    }
    try {
    const warehouses = listWarehousesForAccount();
    const whId = getActiveWarehouseId();
    const whOptions = warehouses.map((w) => `<option value="${esc(w.id)}"${w.id === whId ? ' selected' : ''}>${esc(w.name)}</option>`).join('');
    const selectedIds = new Set();
    const previewIds = new Set();
    const packEditor = {
      mode: 'library',
      folders: buildPackFoldersFromLibraryGroups(whId),
      folderRenames: {}
    };
    if (packCardsOverride?.length) {
      packEditor.mode = 'custom';
      const groupNames = [...new Set(packCardsOverride.map((c) => String(c.group || '').trim() || '未分类'))];
      packEditor.folders = groupNames.map((name) => ({
        id: newPackFolderId(),
        name,
        cardIds: new Set(packCardsOverride.filter((c) => (String(c.group || '').trim() || '未分类') === name).map((c) => c.id)),
        previewIds: new Set()
      }));
      packCardsOverride.forEach((c) => selectedIds.add(c.id));
      (editOpts?.previewCardIds || []).forEach((id) => {
        previewIds.add(id);
        packEditor.folders.forEach((f) => {
          if (f.cardIds.has(id)) f.previewIds.add(id);
        });
      });
    }
    const pickerState = { expandedFolders: new Set(), filterTags: new Set(), tagSearch: '', assignTargetFolderId: null };
    let searchDebounce = null;
    const init = editOpts?.initial || {};
    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <h3 id="assetPublishTitle">${editPackageId ? '编辑资产包' : '发布资产包'}</h3>
          <p class="panel-hint">勾选卡片打包；可「按卡片库分组」或「自定义文件夹」组织结构。文件夹名可直接修改（编辑已发布包时保存即生效）。</p>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetPublishClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <form class="asset-publish-form" id="assetPublishForm">
        <label>标题 <input class="settings-input" name="title" maxlength="120" required placeholder="例如：精品人设包 30 张" value="${esc(init.title || '')}"></label>
        <label>简介 <textarea class="settings-input" name="description" rows="2" maxlength="2000" placeholder="说明包内有什么、适合什么用途">${esc(init.description || '')}</textarea></label>
        <div class="asset-publish-row">
          <label>价格（元，0=免费） <input class="settings-input" name="priceYuan" type="number" min="0" step="0.01" value="${esc(init.priceYuan != null ? init.priceYuan : 0)}"></label>
          <label>标签 <input class="settings-input" name="tag" maxlength="40" placeholder="免费 / 套装" value="${esc(init.tag || '')}"></label>
        </div>
        <label class="custom-checkbox asset-publish-check">
          <input type="checkbox" name="commercialUseAllowed"${init.commercialUseAllowed !== false ? ' checked' : ''}>
          <span class="checkmark"></span>
          <span>购买者可商用</span>
        </label>
        <fieldset class="asset-publish-ui-picker">
          <legend class="panel-hint">市场展示样式</legend>
          <div class="asset-publish-ui-options">
            <label class="asset-publish-ui-opt">
              <input type="radio" name="packUi" value="light"${init.packUi !== 'heavy' ? ' checked' : ''}>
              <span class="asset-publish-ui-opt-body">
                <strong>轻卡包</strong>
                <em>竖版紧凑 · 默认</em>
              </span>
            </label>
            <label class="asset-publish-ui-opt">
              <input type="radio" name="packUi" value="heavy"${init.packUi === 'heavy' ? ' checked' : ''}>
              <span class="asset-publish-ui-opt-body">
                <strong>重卡包</strong>
                <em>加宽卡片 · 横幅封面 · 适合体系包</em>
              </span>
            </label>
          </div>
        </fieldset>
        <div class="asset-publish-cards-section">
          <div class="asset-publish-cards-head">
            <label>来源卡片库 <select class="settings-input" id="assetPublishWarehouse"${packCardsOverride ? ' disabled' : ''}>${whOptions}</select></label>
            <span class="panel-hint" id="assetPublishCardCount">已选 ${selectedIds.size} 张</span>
          </div>
          <div id="assetPublishCardPicker"><p class="panel-hint">加载卡片…</p></div>
        </div>
        <footer class="asset-preview-foot">
          <button type="submit" class="btn btn-primary">${editPackageId ? '保存修改' : '发布上架'}</button>
        </footer>
      </form>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    document.getElementById('assetPublishClose')?.addEventListener('click', closePublishModal);
    overlay.onclick = (e) => {
      if (e.target === overlay) closePublishModal();
    };

    const pickerEl = document.getElementById('assetPublishCardPicker');
    const countEl = document.getElementById('assetPublishCardCount');
    const whSelect = document.getElementById('assetPublishWarehouse');

    async function refreshPicker() {
      const wid = whSelect?.value || whId;
      const scrollEl =
        pickerEl?.closest('.asset-publish-panel') ||
        document.querySelector('#assetPublishOverlay .asset-preview-panel') ||
        pickerEl;
      const scrollTop = scrollEl?.scrollTop ?? 0;
      const cards = packCardsOverride?.length
        ? packCardsOverride
        : getMainSiteCardsForWarehouse(wid);
      const thumbMap = await resolveCardThumbs(cards);
      const searchFocused = document.activeElement?.id === 'assetPublishTagSearch';
      const selStart = searchFocused ? document.activeElement.selectionStart : null;
      if (pickerEl) {
        pickerEl.innerHTML = renderPublishCardPicker(wid, selectedIds, previewIds, thumbMap, pickerState, packEditor, cards);
        bindPickerEvents();
        if (searchFocused) {
          const el = pickerEl.querySelector('#assetPublishTagSearch');
          if (el) {
            el.focus();
            if (typeof selStart === 'number') {
              try {
                el.setSelectionRange(selStart, selStart);
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
      if (countEl) {
        const over = selectedIds.size > PACK_CARD_MAX ? ` · 超出上限 ${PACK_CARD_MAX}` : '';
        countEl.textContent = `已选 ${selectedIds.size} 张${over}`;
        countEl.classList.toggle('asset-publish-count-over', selectedIds.size > PACK_CARD_MAX);
      }
      if (scrollEl) {
        scrollEl.scrollTop = scrollTop;
        requestAnimationFrame(() => {
          scrollEl.scrollTop = scrollTop;
        });
      }
    }

    function bindPackEditorEventsOnce() {
      if (pickerEl?.dataset?.packEditorBound === '1') return;
      if (pickerEl) pickerEl.dataset.packEditorBound = '1';
      pickerEl?.addEventListener('change', (e) => {
        const t = e.target;
        if (t?.name === 'packLayoutMode') {
          packEditor.mode = t.value === 'custom' ? 'custom' : 'library';
          document.getElementById('assetPublishCustomActions')?.classList.toggle('hidden', packEditor.mode !== 'custom');
          if (packEditor.mode === 'custom') {
            syncPackFolderAssignments(packEditor.folders, getMainSiteCardsForWarehouse(whSelect?.value || whId));
          }
          void refreshPicker();
          return;
        }
        if (t?.matches?.('.asset-publish-folder-rename')) {
          const row = t.closest('.asset-publish-custom-folder');
          const fid = row?.dataset?.folderId;
          const f = packEditor.folders.find((x) => x.id === fid);
          if (f) f.name = String(t.value || f.name).trim().slice(0, 40) || f.name;
        }
        if (t?.matches?.('.asset-publish-folder-rename-inline')) {
          const val = String(t.value || '').trim().slice(0, 40);
          const fid = t.dataset.folderId || '';
          const key = t.dataset.folderKey || '';
          if (packEditor.mode === 'custom' && fid && fid !== '_unassigned') {
            const f = packEditor.folders.find((x) => x.id === fid);
            if (f && val) f.name = val;
          } else if (key && val) {
            packEditor.folderRenames = packEditor.folderRenames || {};
            packEditor.folderRenames[key] = val;
          }
        }
      });
      pickerEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="import-groups"], [data-action="add-folder"], [data-action="remove-folder"], [data-action="pick-folder-cards"], [data-action="cancel-assign"]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'cancel-assign') {
          pickerState.assignTargetFolderId = null;
          void refreshPicker();
          return;
        }
        if (action === 'pick-folder-cards') {
          const fid = btn.dataset.folderId;
          const f = packEditor.folders.find((x) => x.id === fid);
          if (!f) return;
          pickerState.assignTargetFolderId = fid;
          if (!pickerState.expandedFolders.has('未归入')) pickerState.expandedFolders.add('未归入');
          void refreshPicker();
          return;
        }
        if (action === 'import-groups') {
          const wid = whSelect?.value || whId;
          packEditor.folders = buildPackFoldersFromLibraryGroups(wid);
          syncPackFolderAssignments(packEditor.folders, getMainSiteCardsForWarehouse(wid));
          void refreshPicker();
        } else if (action === 'add-folder') {
          packEditor.folders.push({
            id: newPackFolderId(),
            name: `文件夹 ${packEditor.folders.length + 1}`,
            cardIds: new Set(),
            previewIds: new Set()
          });
          void refreshPicker();
        } else if (action === 'remove-folder') {
          const row = btn.closest('.asset-publish-custom-folder');
          const fid = row?.dataset?.folderId;
          if (!fid || packEditor.folders.length <= 1) {
            toast('至少保留一个文件夹');
            return;
          }
          const f = packEditor.folders.find((x) => x.id === fid);
          if (f) {
            f.cardIds.forEach((id) => previewIds.delete(id));
            packEditor.folders = packEditor.folders.filter((x) => x.id !== fid);
          }
          void refreshPicker();
        }
      });
    }

    function bindPickerEvents() {
      pickerEl?.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const folder = btn.closest('.asset-publish-folder')?.dataset?.folder;
          if (!folder) return;
          if (pickerState.expandedFolders.has(folder)) pickerState.expandedFolders.delete(folder);
          else pickerState.expandedFolders.add(folder);
          void refreshPicker();
        });
      });
      pickerEl?.querySelectorAll('.asset-publish-tag-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.dataset.tag;
          if (!tag) return;
          if (pickerState.filterTags.has(tag)) pickerState.filterTags.delete(tag);
          else pickerState.filterTags.add(tag);
          void refreshPicker();
        });
      });
      const searchInput = pickerEl?.querySelector('#assetPublishTagSearch');
      searchInput?.addEventListener('input', () => {
        pickerState.tagSearch = searchInput.value;
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => void refreshPicker(), 180);
      });
      pickerEl?.querySelectorAll('[data-action="select-folder"]').forEach((input) => {
        const folderEl = input.closest('.asset-publish-folder');
        const folderName = folderEl?.dataset?.folder;
        if (!folderName) return;
        if (input.dataset.indeterminate === '1') {
          input.indeterminate = true;
        }
        input.addEventListener('change', () => {
          const folderCards = [...(folderEl?.querySelectorAll('.asset-publish-card-item') || [])].map(
            (r) => r.dataset.cardId
          );
          if (input.checked) folderCards.forEach((id) => selectedIds.add(id));
          else
            folderCards.forEach((id) => {
              selectedIds.delete(id);
              previewIds.delete(id);
            });
          if (countEl) countEl.textContent = `已选 ${selectedIds.size} 张`;
          void refreshPicker();
        });
      });
      pickerEl?.querySelectorAll('.asset-publish-card-item').forEach((row) => {
        const id = row.dataset.cardId;
        const include = row.querySelector('[data-role="include"]');
        const preview = row.querySelector('[data-role="preview"]');
        const folderAssign = row.querySelector('[data-role="folder-assign"]');
        const folderEl = row.closest('.asset-publish-folder');
        const folderId = folderEl?.dataset?.folderId;
        const packFolder =
          packEditor.mode === 'custom' && folderId && folderId !== '_unassigned'
            ? packEditor.folders.find((f) => f.id === folderId)
            : null;
        folderAssign?.addEventListener('change', () => {
          assignCardToPackFolder(packEditor.folders, id, folderAssign.value || null);
          void refreshPicker();
        });
        include?.addEventListener('change', () => {
          if (include.checked) {
            selectedIds.add(id);
            if (pickerState.assignTargetFolderId && packEditor.mode === 'custom') {
              assignCardToPackFolder(packEditor.folders, id, pickerState.assignTargetFolderId);
            }
          } else {
            selectedIds.delete(id);
            previewIds.delete(id);
            if (packFolder) packFolder.previewIds.delete(id);
          }
          if (preview) {
            preview.disabled = !include.checked;
            if (!include.checked) preview.checked = false;
          }
          if (countEl) {
            const over = selectedIds.size > PACK_CARD_MAX ? ` · 超出上限 ${PACK_CARD_MAX}` : '';
            countEl.textContent = `已选 ${selectedIds.size} 张${over}`;
            countEl.classList.toggle('asset-publish-count-over', selectedIds.size > PACK_CARD_MAX);
          }
          if (pickerState.assignTargetFolderId) void refreshPicker();
        });
        preview?.addEventListener('change', () => {
          if (packEditor.mode === 'custom' && packFolder) {
            if (preview.checked) {
              if (packFolder.previewIds.size >= PACK_FOLDER_PREVIEW_MAX) {
                preview.checked = false;
                toast(`每个文件夹最多 ${PACK_FOLDER_PREVIEW_MAX} 张预览图`);
                return;
              }
              packFolder.previewIds.add(id);
            } else packFolder.previewIds.delete(id);
          } else if (preview.checked) previewIds.add(id);
          else previewIds.delete(id);
          const folderSection = row.closest('.asset-publish-folder');
          const hint = folderSection?.querySelector('.asset-publish-folder-preview-hint');
          if (hint && packFolder) {
            hint.textContent = `文件夹预览 ${Math.min(packFolder.previewIds.size, PACK_FOLDER_PREVIEW_MAX)}/${PACK_FOLDER_PREVIEW_MAX}`;
          }
          const customRow = document.querySelector(`.asset-publish-custom-folder[data-folder-id="${packFolder?.id || ''}"] .panel-hint`);
          if (customRow && packFolder) {
            customRow.textContent = `${packFolder.cardIds.size} 张 · 预览 ${Math.min(packFolder.previewIds.size, PACK_FOLDER_PREVIEW_MAX)}/${PACK_FOLDER_PREVIEW_MAX}`;
          }
        });
      });
    }

    whSelect?.addEventListener('change', () => {
      selectedIds.clear();
      previewIds.clear();
      pickerState.expandedFolders.clear();
      pickerState.filterTags.clear();
      pickerState.tagSearch = '';
      void refreshPicker();
    });

    bindPackEditorEventsOnce();
    await refreshPicker();

    document.getElementById('assetPublishForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const ctx = {
        selectedIds,
        previewIds,
        warehouseId: whSelect?.value || whId,
        packEditor,
        editPackageId,
        packCards: packCardsOverride
      };
      if (editPackageId) void submitEditPublishForm(e.target, ctx);
      else void submitPublishForm(e.target, ctx);
    });
    } catch (e) {
      console.error('[assets] openPublishModal failed', e);
      toast('打开发布窗口失败，请刷新页面后重试');
      closePublishModal();
    }
  }

  function closePublishModal() {
    const overlay = document.getElementById('assetPublishOverlay');
    const pickerEl = document.getElementById('assetPublishCardPicker');
    if (pickerEl) delete pickerEl.dataset.packEditorBound;
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
    overlay.onclick = null;
  }

  async function submitPublishForm(form, ctx) {
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    if (title.length < 2) {
      toast('标题至少 2 个字');
      return;
    }
    const selectedIds = ctx?.selectedIds || new Set();
    if (!selectedIds.size) {
      toast('请至少选择一张卡片');
      return;
    }
    if (selectedIds.size > PACK_CARD_MAX) {
      toast(`单包最多 ${PACK_CARD_MAX} 张，当前已选 ${selectedIds.size} 张，请减少勾选`);
      return;
    }
    const packEditor = ctx?.packEditor || { mode: 'library', folders: [], folderRenames: {} };
    syncPackFolderNamesFromDom(packEditor, document.getElementById('assetPublishCardPicker'));
    const warehouseId = ctx?.warehouseId || getActiveWarehouseId();
    const warehouse = getWarehouseById(warehouseId);
    const allCards = getMainSiteCardsForWarehouse(warehouseId);
    const cards = allCards
      .filter((c) => selectedIds.has(c.id))
      .map((c) => sanitizePackCardForPublish({ ...c, group: resolvePackCardGroup(c, packEditor) }));
    const previewCardIds = collectPreviewCardIds(
      packEditor.folders,
      ctx?.previewIds || new Set(),
      packEditor.mode
    ).filter((id) => selectedIds.has(id));
    const previewTree = buildPreviewTreeForPack(
      cards,
      packEditor.folders,
      packEditor.mode,
      ctx?.previewIds || new Set()
    );
    const priceYuan = Math.max(0, Number(fd.get('priceYuan')) || 0);
    const priceCents = Math.round(priceYuan * 100);
    const packUi = String(fd.get('packUi') || 'light') === 'heavy' ? 'heavy' : 'light';
    const payload = {
      title,
      description: String(fd.get('description') || '').trim(),
      tag: String(fd.get('tag') || (priceCents ? '套装' : '免费')).trim(),
      priceCents,
      saleType: 'bulk',
      commercialUseAllowed: fd.get('commercialUseAllowed') === 'on',
      sourceWarehouseId: warehouseId,
      sourceWarehouseName: warehouse?.name || '默认库',
      previewCardIds,
      previewTree,
      packUi,
      cards
    };
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const r = await window.PromptHubApi.publishAssetPackage(payload);
    if (btn) btn.disabled = false;
    if (!r?.ok) {
      toast(r?.message || r?.error?.message || '发布失败');
      return;
    }
    toast(`「${title}」已上架（${cards.length} 张）`);
    closePublishModal();
    await refreshMarketPackages();
    void renderMarketplace();
  }

  async function submitEditPublishForm(form, ctx) {
    const fd = new FormData(form);
    const editId = ctx?.editPackageId;
    if (!editId) return submitPublishForm(form, ctx);
    const title = String(fd.get('title') || '').trim();
    if (title.length < 2) {
      toast('标题至少 2 个字');
      return;
    }
    const packEditor = ctx?.packEditor || { mode: 'library', folders: [], folderRenames: {} };
    syncPackFolderNamesFromDom(packEditor, document.getElementById('assetPublishCardPicker'));
    const packCards = Array.isArray(ctx?.packCards) ? ctx.packCards : [];
    const selectedIds = ctx?.selectedIds || new Set();
    const cards = packCards
      .filter((c) => selectedIds.has(c.id))
      .map((c) => sanitizePackCardForPublish({ ...c, group: resolvePackCardGroup(c, packEditor) }));
    if (!cards.length) {
      toast('请至少保留一张卡片');
      return;
    }
    const previewCardIds = collectPreviewCardIds(
      packEditor.folders,
      ctx?.previewIds || new Set(),
      packEditor.mode
    ).filter((id) => selectedIds.has(id));
    const previewTree = buildPreviewTreeForPack(
