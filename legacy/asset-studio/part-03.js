    }
    return '';
  }

  function cardThumbHtml(card) {
    const hue = card.hue || 210;
    const hasImg = !!(card.image && String(card.image).trim());
    const initialSrc = hasImg ? studioImageInitialSrc(card.image) : '';
    const imgPart = hasImg
      ? `<img src="${initialSrc ? esc(initialSrc) : ''}" alt="" data-image-ref="${esc(card.image)}" loading="lazy"${initialSrc ? ' data-loaded="1"' : ''}>`
      : `<span class="studio-asset-card-fallback" aria-hidden="true">${esc((card.title || '?').slice(0, 1))}</span>`;
    const noThumb = !hasImg || !initialSrc ? ' no-thumb' : '';
    const drag = (isViewOnly() && !allowsStudioDemoInteract()) ? 'false' : 'true';
    const promptHint = (card.prompt || '').trim();
    const tip = promptHint
      ? `${card.title || '未命名'} · 点击查看提示词`
      : `${card.title || '未命名'} · 点击查看详情`;
    return `<div class="studio-asset-card studio-asset-card--thumb${noThumb}" draggable="${drag}" data-card-id="${esc(card.id)}" style="--card-hue:${hue}" title="${esc(tip)}" role="button" tabindex="0">${imgPart}</div>`;
  }

  function cardDetailThumbHtml(c) {
    const hasImg = !!(c.image && String(c.image).trim());
    if (hasImg) {
      const initialSrc = studioImageInitialSrc(c.image);
      return `<div class="studio-detail-thumb${initialSrc ? ' has-img' : ''}"><img src="${initialSrc ? esc(initialSrc) : ''}" data-image-ref="${esc(c.image)}" alt=""${initialSrc ? ' data-loaded="1"' : ''}></div>`;
    }
    return `<div class="studio-detail-thumb studio-detail-thumb--fallback" style="--card-hue:${c.hue || 210}"><span>${esc((c.title || '?').slice(0, 1))}</span></div>`;
  }

  function renderProjects() {
    const sel = document.getElementById('studioProjectSelect');
    if (!sel) return;
    sel.innerHTML = state.projects
      .map(
        (p) =>
          `<option value="${esc(p.id)}"${p.id === state.projectId ? ' selected' : ''}>${esc(p.name)}</option>`
      )
      .join('');
  }

  function cardFolderName(card) {
    const g = card?.group;
    if (g == null || g === '') return '未分类';
    return String(g);
  }

  function normalizeImportedCard(c) {
    const group = c.group == null || c.group === '' ? null : String(c.group);
    return {
      id: c.id,
      title: (c.title || '').trim() || '未命名',
      group,
      hue: (String(c.id).charCodeAt(0) * 17) % 360,
      prompt: c.prompt || '',
      background: c.background || '',
      character: c.character || '',
      relations: c.relations || '',
      customFields: c.customFields && typeof c.customFields === 'object' ? { ...c.customFields } : {},
      docs: Array.isArray(c.docs) ? c.docs.slice() : [],
      tags: Array.isArray(c.tags) ? c.tags.slice() : [],
      image: typeof c.image === 'string' && c.image.trim() ? c.image.trim() : ''
    };
  }

  function syncAssetPanelChrome() {
    const empty = !getProjectCards().length && state.assetTab === 'warehouse';
    document.getElementById('studioAssetFilter')?.classList.toggle('hidden', empty);
    document.getElementById('studioFilterBtn')?.classList.toggle('hidden', empty);
  }

  function renderAssetEmptyCta(root) {
    root.innerHTML = `
      <div class="studio-import-empty">
        <p class="studio-import-empty-icon" aria-hidden="true">📂</p>
        <p class="studio-import-empty-title">尚未导入卡片库</p>
        <p class="panel-hint">分类将与主站卡片库<strong>分组文件夹</strong>一致（未分组归入「未分类」）</p>
        <button type="button" class="btn btn-primary studio-import-cta" id="studioImportCta">点击导入卡片库</button>
        <p class="panel-hint studio-import-empty-tip">同一浏览器下会自动读取主站卡片库，无需先导出</p>
      </div>`;
  }

  let mainSiteCardsCache = null;
  let mainSiteCardsLoadPromise = null;

  function readMainSiteCardsAll() {
    if (mainSiteCardsCache?.length) return mainSiteCardsCache;
    if (Array.isArray(window.__promptHubCards) && window.__promptHubCards.length) {
      mainSiteCardsCache = window.__promptHubCards;
      return mainSiteCardsCache;
    }
    if (Array.isArray(window.opener?.__promptHubCards) && window.opener.__promptHubCards.length) {
      mainSiteCardsCache = window.opener.__promptHubCards;
      return mainSiteCardsCache;
    }
    try {
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
      const keys = uid
        ? [`promptrepo_autosave_${uid}`, `promptrepo_snapshot_${uid}`]
        : ['promptrepo_autosave_snapshot'];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (Array.isArray(data?.cards) && data.cards.length) {
          mainSiteCardsCache = data.cards;
          return mainSiteCardsCache;
        }
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  async function ensureMainSiteCardsLoaded() {
    const cached = readMainSiteCardsAll();
    if (cached.length) return cached;
    if (mainSiteCardsLoadPromise) return mainSiteCardsLoadPromise;
    mainSiteCardsLoadPromise = (async () => {
      const idbRows = await loadMainSiteCardsList();
      if (idbRows.length) {
        mainSiteCardsCache = idbRows;
        return idbRows;
      }
      const autosave = readCardsFromLocalAutosave();
      if (autosave.length) {
        mainSiteCardsCache = autosave;
        return autosave;
      }
      mainSiteCardsCache = [];
      return [];
    })();
    try {
      return await mainSiteCardsLoadPromise;
    } finally {
      mainSiteCardsLoadPromise = null;
    }
  }

  function readCommunityPostsForCover() {
    try {
      const raw = localStorage.getItem('promptrepo_community_posts');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((p) => p?.image && !p.isMock) : [];
    } catch (e) {
      return [];
    }
  }

  function cardWarehouseIdLocal(card) {
    return card?.warehouseId || 'default';
  }

  function listMainSiteWarehouses() {
    if (window.FeatureAssets?.listWarehousesForAccount) {
      return window.FeatureAssets.listWarehousesForAccount();
    }
    try {
      const uid = window.SupabaseSync?.getUserId?.() || 'guest';
      const raw = localStorage.getItem(`promptrepo_warehouses_v1_${uid}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.warehouses?.length) return parsed.warehouses;
    } catch (e) { /* ignore */ }
    return [{ id: 'default', name: '默认库', isDefault: true }];
  }

  function cardsForWarehouse(warehouseId) {
    const wid = warehouseId || 'default';
    if (window.FeatureAssets?.getMainSiteCardsForWarehouse) {
      return window.FeatureAssets.getMainSiteCardsForWarehouse(wid);
    }
    return readMainSiteCardsAll().filter((c) => cardWarehouseIdLocal(c) === wid);
  }

  function groupsForWarehouse(warehouseId) {
    try {
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || 'guest';
      const raw = localStorage.getItem(`promptrepo_groups_${uid}_${warehouseId || 'default'}`);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function resolveCardDisplayUrl(imageRef, cardId) {
    if (!imageRef || typeof imageRef !== 'string') return '';
    const cached = window.MediaPipeline?.getListCached?.(imageRef, cardId)
      || window.SupabaseSync?.getCachedDisplayUrl?.(imageRef, { assetId: cardId, variant: 'grid' });
    if (cached && !cached.startsWith('data:image/svg')) return cached;
    const safe = window.MediaPipeline?.safeImgSrc?.(imageRef);
    if (safe && !safe.startsWith('data:image/svg')) return safe;
    if (/^https?:\/\//i.test(imageRef) || imageRef.startsWith('data:')) return imageRef;
    return '';
  }

  async function pickCoverImageUrl(cards, communityPosts) {
    const withImg = (cards || []).filter((c) => c?.image);
    if (withImg.length && window.MediaPipeline?.prefetchList) {
      await window.MediaPipeline.prefetchList(withImg.slice(0, 8), 6000);
    } else if (withImg.length && window.SupabaseSync?.prefetchCardsImages) {
      await window.SupabaseSync.prefetchCardsImages(withImg.slice(0, 8), 6000);
    }
    for (const c of withImg.slice(0, 16)) {
      const hit = resolveCardDisplayUrl(c.image, c.id);
      if (hit && !hit.includes('data:image/svg')) return hit;
      if (window.MediaPipeline?.resolveListUrl) {
        try {
          const signed = await window.MediaPipeline.resolveListUrl(c.image, { assetId: c.id, cardId: c.id });
          if (signed && !String(signed).includes('data:image/svg')) return signed;
        } catch (e) { /* ignore */ }
      } else if (window.SupabaseSync?.resolveDisplayUrl) {
        try {
          const signed = await window.SupabaseSync.resolveDisplayUrl(c.image, {
            assetId: c.id,
            variant: 'grid',
            listOnly: true,
            allowFullFallback: false
          });
          if (signed && !String(signed).includes('data:image/svg')) return signed;
        } catch (e) { /* ignore */ }
      }
    }
    for (const p of (communityPosts || []).slice(0, 6)) {
      if (!p?.image) continue;
      const hit = resolveCardDisplayUrl(p.image);
      if (hit && !hit.includes('data:image/svg')) return hit;
    }
    return null;
  }

  function closeImportPicker() {
    const overlay = document.getElementById('studioImportOverlay');
    overlay?.classList.add('hidden');
    overlay?.classList.remove('active');
  }
  window.__studioCloseImportPicker = closeImportPicker;

  async function renderImportPickerCovers(warehouses) {
    const root = document.getElementById('studioImportCovers');
    if (!root) return;
    const list = warehouses.length ? warehouses : [{ id: 'default', name: '默认库', isDefault: true }];
    const count = list.length;
    root.className = `studio-import-cards-row count-${Math.min(count, 4)}`;
    const community = readCommunityPostsForCover();
    root.innerHTML = list
      .map((w) => {
        const n = cardsForWarehouse(w.id).length;
        return `<button type="button" class="studio-library-pick-card" data-wh-id="${esc(w.id)}" aria-label="导入 ${esc(w.name)}">
          <span class="studio-library-pick-bg" data-cover-for="${esc(w.id)}"></span>
          <span class="studio-library-pick-overlay" aria-hidden="true"></span>
          <span class="studio-library-pick-label">
            <span class="studio-library-pick-name">${esc(w.name)}</span>
            <span class="studio-library-pick-meta">${n} 张卡片</span>
          </span>
        </button>`;
      })
      .join('');
    root.querySelectorAll('.studio-library-pick-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        void importFromMainWarehouse(btn.dataset.whId);
      });
    });
    await Promise.all(
      list.map(async (w) => {
        const bg = root.querySelector(`[data-cover-for="${w.id}"]`);
        if (!bg) return;
        const url = await pickCoverImageUrl(cardsForWarehouse(w.id), community);
        if (!url) return;
        bg.style.backgroundImage = `url("${String(url).replace(/"/g, '%22')}")`;
        bg.closest('.studio-library-pick-card')?.classList.add('has-cover');
      })
    );
  }

  async function openImportPicker() {
    if (!guardEdit('请先登录后导入卡片库')) return;
    try {
      setStatus('正在读取主站卡片库…');
      await ensureMainSiteCardsLoaded();
      const warehouses = listMainSiteWarehouses();
      const hasAny = warehouses.some((w) => cardsForWarehouse(w.id).length > 0);
      if (!hasAny && !readMainSiteCardsAll().length) {
        window.alert(
          '未找到可导入的卡片。\n\n请确认：\n1. 已在同一浏览器打开过主站卡片库\n2. 主站里至少有一张卡片'
        );
        setStatus('未找到主站卡片库');
        return;
      }
      const overlay = document.getElementById('studioImportOverlay');
      overlay?.classList.remove('hidden');
      overlay?.classList.add('active');
      setStatus('');
      void renderImportPickerCovers(warehouses);
    } catch (e) {
      console.warn('[studio] openImportPicker', e);
      setStatus('打开导入失败，请重试');
    }
  }

  async function importFromMainWarehouse(warehouseId) {
    if (!guardEdit()) return;
    const cards = cardsForWarehouse(warehouseId);
    if (!cards.length) {
      setStatus('该卡片库暂无卡片');
      return;
    }
    const groups = groupsForWarehouse(warehouseId);
    const p = getProject();
    p.cards = cards.slice(0, 200).map((c) => normalizeImportedCard(c));
    p.cardGroups = groups.slice();
    const doc = getActiveDoc();
    if (doc) {
      doc.heroCardIds = [];
      doc.floatPositions = {};
      doc.closedFloatIds = [];
    }
    document.getElementById('studioFloatLayer')?.replaceChildren();
    saveState();
    closeImportPicker();
    renderAll();
    const wh = listMainSiteWarehouses().find((w) => w.id === warehouseId);
    setStatus(`已从「${wh?.name || '卡片库'}」导入 ${p.cards.length} 张卡片`);
    maybeShowStudioGuide();
  }

  function maybeShowStudioGuide() {
    try {
      if (localStorage.getItem(LS_GUIDE) === '1') return;
    } catch (e) { /* ignore */ }
    document.getElementById('studioGuideOverlay')?.classList.remove('hidden');
  }

  function closeStudioGuide() {
    const skip = document.getElementById('studioGuideSkip')?.checked;
    if (skip) {
      try {
        localStorage.setItem(LS_GUIDE, '1');
      } catch (e) { /* ignore */ }
    }
    document.getElementById('studioGuideOverlay')?.classList.add('hidden');
  }

  function sortFolderNames(names) {
    const order = Array.isArray(getProject().cardGroups) ? getProject().cardGroups : [];
    return names.sort((a, b) => {
      if (a === '未分类') return -1;
      if (b === '未分类') return 1;
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
  }

  function renderAssetFolders() {
    const root = document.getElementById('studioAssetFolders');
    if (!root) return;
    syncAssetPanelChrome();
    if (state.assetTab === 'market') {
      root.innerHTML = '<p class="panel-hint">资产包功能即将上线</p>';
      return;
    }
    if (!getProjectCards().length) {
      renderAssetEmptyCta(root);
      return;
    }
    const filter = (document.getElementById('studioAssetFilter')?.value || '').trim().toLowerCase();
    const pool = getProjectCards();
    const byFolder = {};
    pool.forEach((c) => {
      if (filter && !`${c.title} ${cardFolderName(c)} ${c.prompt || ''}`.toLowerCase().includes(filter)) return;
      if (!cardMatchesFilters(c)) return;
      const f = cardFolderName(c);
      if (!byFolder[f]) byFolder[f] = [];
      byFolder[f].push(c);
    });
    const names = sortFolderNames(Object.keys(byFolder));
    if (!names.length) {
      root.innerHTML = '<p class="panel-hint">无匹配卡片</p>';
      return;
    }
    root.innerHTML = names
      .map(
        (name) => `
      <div class="studio-folder open" data-folder="${esc(name)}">
        <div class="studio-folder-head"><span class="studio-folder-chevron">▶</span><span>${esc(name)}</span><span style="margin-left:auto;color:var(--text-muted);font-size:10px">${byFolder[name].length}</span></div>
        <div class="studio-folder-body"><p class="panel-hint panel-hint--thumb-hint">单击缩略图查看提示词 · 可拖入写作区</p><div class="studio-card-grid">${byFolder[name].map((c) => cardThumbHtml(c)).join('')}</div></div>
      </div>`
      )
      .join('');
    root.querySelectorAll('.studio-folder-head').forEach((head) => {
      head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });
    bindCardDrag(root.querySelectorAll('.studio-asset-card'));
    observeStudioCardImages(root);
  }

  function hideTreeMenu() {
    document.getElementById('studioTreeMenu')?.classList.add('hidden');
  }

  function showTreeMenu(x, y, items, onPick) {
    const menu = document.getElementById('studioTreeMenu');
    if (!menu) return;
    menu.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="${it.danger ? 'danger' : ''}" data-tree-action="${esc(it.action)}">${esc(it.label)}</button>`
      )
      .join('');
    menu.classList.remove('hidden');
    const pad = 8;
    menu.style.left = `${Math.min(x, window.innerWidth - 160 - pad)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - pad)}px`;
    menu.querySelectorAll('[data-tree-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        hideTreeMenu();
        onPick(btn.dataset.treeAction);
      });
    });
  }

  function focusInlineRename(selector) {
    requestAnimationFrame(() => {
      const inp = document.querySelector(selector);
      if (!inp) return;
      inp.focus();
      inp.select();
    });
  }

  function startInlineNewDoc(folderId) {
    if (!guardEdit()) return;
    const p = getProject();
    const fld = p.folders.find((f) => f.id === folderId);
    if (!fld) return;
    const id = `doc_${Date.now().toString(36)}`;
    p.docs.push({
      id,
      folderId: fld.id,
      title: '',
      heroCardIds: [],
      closedFloatIds: [],
      body: '',
      bodyHtml: '',
      floatPositions: {},
      _inlineRename: true,
      _inlineNew: true
    });
    p.activeDocId = id;
    p.activeFolderId = fld.id;
    fld.collapsed = false;
    saveState();
    renderDocTree();
    focusInlineRename(`[data-inline-rename-doc="${id}"]`);
  }

  function startInlineNewFolder(parentId) {
    if (!guardEdit()) return;
    const p = getProject();
    const id = `fld_${Date.now()}`;
    p.folders.push({
      id,
      name: '',
      parentId: parentId || null,
      collapsed: false,
      _inlineRename: true,
      _inlineNew: true
    });
    p.activeFolderId = id;
    if (parentId) {
      const parent = p.folders.find((f) => f.id === parentId);
      if (parent) parent.collapsed = false;
    }
    saveState();
    renderDocTree();
    focusInlineRename(`[data-inline-rename-fld="${id}"]`);
  }

  function commitInlineDoc(docId, name) {
    const p = getProject();
    const doc = p.docs.find((d) => d.id === docId);
    if (!doc) return;
    const trimmed = (name || '').trim();
    const wasNew = !!doc._inlineNew;
    delete doc._inlineRename;
    delete doc._inlineNew;
    if (wasNew && !trimmed) {
      p.docs = p.docs.filter((d) => d.id !== docId);
      if (p.activeDocId === docId) p.activeDocId = p.docs[0]?.id || '';
      saveState();
      renderDocTree();
      renderEditor();
      return;
    }
    if (!trimmed) {
      doc.title = doc._inlinePrevTitle || doc.title || '新文档';
    } else {
      doc.title = trimmed.slice(0, 40);
    }
    delete doc._inlinePrevTitle;
    saveState();
    renderDocTree();
    if (p.activeDocId === docId) renderEditor();
  }

  function commitInlineFolder(folderId, name) {
    const p = getProject();
    const fld = p.folders.find((f) => f.id === folderId);
    if (!fld) return;
    const trimmed = (name || '').trim();
    const wasNew = !!fld._inlineNew;
    const prev = fld._inlinePrevName;
    delete fld._inlineRename;
    delete fld._inlineNew;
    delete fld._inlinePrevName;
    if (wasNew && !trimmed) {
      const hasKids =
        getChildFolders(p, folderId).length > 0 || p.docs.some((d) => d.folderId === folderId);
      if (!hasKids) {
        p.folders = p.folders.filter((f) => f.id !== folderId);
        if (p.activeFolderId === folderId) p.activeFolderId = getActiveFolderId();
      } else {
        fld.name = '新分类';
      }
    } else if (!trimmed) {
      fld.name = prev || fld.name || '未命名';
    } else {
      fld.name = trimmed.slice(0, 20);
    }
    saveState();
    renderDocTree();
  }

  function startInlineRenameDoc(docId) {
    if (!guardEdit()) return;
    const doc = getProject().docs.find((d) => d.id === docId);
    if (!doc) return;
    doc._inlinePrevTitle = doc.title || '新文档';
    doc._inlineRename = true;
    saveState();
    renderDocTree();
    focusInlineRename(`[data-inline-rename-doc="${docId}"]`);
  }

  function startInlineRenameFolder(folderId) {
    if (!guardEdit()) return;
    const fld = getProject().folders.find((f) => f.id === folderId);
    if (!fld) return;
    fld._inlinePrevName = fld.name;
    fld._inlineRename = true;
    saveState();
    renderDocTree();
    focusInlineRename(`[data-inline-rename-fld="${folderId}"]`);
  }

  function bindInlineRenameInputs(root) {
    root.querySelectorAll('[data-inline-rename-doc]').forEach((inp) => {
      const docId = inp.dataset.inlineRenameDoc;
