    await refreshMarketPackages();
    if (!marketPackages.length) {
      marketPackages = getDemoPackages();
    }
    if (!marketPackages.length) {
      grid.innerHTML = `<div class="feature-empty"><p>暂无资产包</p><p class="panel-hint">登录后可发布你的第一个免费资产包。</p><button type="button" class="btn btn-primary btn-sm" id="assetPublishEmptyBtn">发布资产包</button></div>`;
      const emptyBtn = document.getElementById('assetPublishEmptyBtn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', () => {
          void openPublishModal().catch(() => toast('无法打开发布窗口'));
        });
      }
      return;
    }
    paintMarketGrid(marketPackages);
  }

  async function claimPackage(pkg) {
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('领取资产包需先登录');
      window.openAuthModal?.();
      return;
    }
    if (pkg.priceCents > 0) {
      toast('付费资产包即将开放，当前请先发布/领取免费包');
      return;
    }
    const r = await window.PromptHubApi.claimAssetPackage(pkg.id);
    if (!r?.ok) {
      toast(r?.message || '领取失败');
      return;
    }
    const already = !!r.data?.alreadyOwned;
    pkg.owned = true;
    await refreshMarketPackages();
    void renderMarketplace();
    if (!already) {
      await playOpenPackAnimation(pkg);
    }
    toast(r.data?.message || '已加入你的资产包');
  }

  function playOpenPackAnimation(pkg) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('assetOpenOverlay');
      if (!overlay) {
        resolve();
        return;
      }
      const imgs = (pkg.previewImages || []).filter((p) => p?.imageUrl).slice(0, 5);
      const cardsHtml = imgs.length
        ? imgs
            .map(
              (p, i) =>
                `<div class="asset-open-card asset-open-card--${i}" style="--open-i:${i}"><img src="${esc(p.imageUrl)}" alt="" draggable="false"></div>`
            )
            .join('')
        : `<div class="asset-open-card asset-open-card--0 asset-open-card--placeholder"><span>🎁</span></div>`;
      overlay.innerHTML = `<div class="asset-open-stage" role="presentation">
        <div class="asset-open-glow"></div>
        <div class="asset-open-cards">${cardsHtml}</div>
        <p class="asset-open-title">${esc(pkg.title)}</p>
        <p class="asset-open-sub">开包成功 · ${esc(pkg.countLabel || `${pkg.cardCount || ''} 张卡片`)}</p>
      </div>`;
      overlay.classList.remove('hidden');
      overlay.classList.add('active');
      setTimeout(() => {
        overlay.classList.remove('active');
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
        resolve();
      }, 2400);
    });
  }

  function updateImportSelectedHint(root) {
    const hint = root?.querySelector('#assetImportSelectedHint');
    if (!hint) return;
    const n = root.querySelectorAll('.asset-import-card-cb:checked').length;
    hint.textContent = n ? `已选 ${n} 张卡片` : '未选卡片时将导入全部';
  }

  function renderImportFolderNode(node) {
    return `<li class="asset-import-folder" data-folder="${esc(node.name)}">
        <button type="button" class="asset-import-folder-toggle" aria-expanded="false">
          <span class="asset-import-folder-chevron" aria-hidden="true">▶</span>
          <span class="asset-import-folder-name">${esc(node.name)}</span>
          <em>${node.cardCount} 张</em>
          <label class="asset-import-folder-select-all"><input type="checkbox" class="asset-import-folder-all-cb" data-folder="${esc(node.name)}"> 全选</label>
        </button>
        <div class="asset-import-folder-body hidden" data-folder-body>
          <p class="panel-hint asset-import-folder-loading hidden">加载中…</p>
          <div class="asset-import-card-grid" data-folder-cards></div>
          <p class="panel-hint asset-import-folder-empty hidden">该文件夹暂无可导入图片</p>
        </div>
      </li>`;
  }

  async function loadImportFolderCards(folderEl, pkg) {
    if (!folderEl || folderEl.dataset.loaded === '1') return;
    const folder = folderEl.dataset.folder;
    const loading = folderEl.querySelector('.asset-import-folder-loading');
    const grid = folderEl.querySelector('[data-folder-cards]');
    const empty = folderEl.querySelector('.asset-import-folder-empty');
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (grid) grid.innerHTML = '';

    const fn = window.PromptHubApi?.getAssetPackageFolderImages;
    if (typeof fn !== 'function') {
      if (loading) loading.classList.add('hidden');
      return;
    }
    const r = await fn(pkg.id, folder);
    if (loading) loading.classList.add('hidden');
    if (!r?.ok || !Array.isArray(r.data?.items)) {
      if (empty) {
        empty.textContent = r?.message || '加载失败';
        empty.classList.remove('hidden');
      }
      return;
    }
    const items = r.data.items.filter((it) => it?.cardId && it?.imageUrl);
    if (!items.length) {
      if (empty) {
        empty.textContent = '该文件夹暂无可导入图片';
        empty.classList.remove('hidden');
      }
      folderEl.dataset.loaded = '1';
      return;
    }
    if (grid) {
      grid.innerHTML = items
        .map(
          (it) =>
            `<label class="asset-import-card-pick" title="${esc(it.label || '卡片')}">
              <input type="checkbox" class="asset-import-card-cb" value="${esc(it.cardId)}" data-folder="${esc(folder)}">
              <img src="${esc(it.imageUrl)}" alt="" loading="lazy" draggable="false">
            </label>`
        )
        .join('');
    }
    folderEl.dataset.loaded = '1';
    updateImportSelectedHint(folderEl.closest('#assetImportBody'));
  }

  function bindImportFolderTree(root, pkg) {
    root?.querySelectorAll('.asset-import-folder-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.asset-import-folder-select-all')) return;
        const folderEl = btn.closest('.asset-import-folder');
        const body = folderEl?.querySelector('[data-folder-body]');
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body?.classList.toggle('hidden', expanded);
        const chev = btn.querySelector('.asset-import-folder-chevron');
        if (chev) chev.textContent = expanded ? '▶' : '▼';
        if (!expanded) void loadImportFolderCards(folderEl, pkg);
      });
    });
    root?.querySelectorAll('.asset-import-folder-all-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const folder = cb.dataset.folder;
        const folderEl = cb.closest('.asset-import-folder');
        folderEl?.querySelectorAll('.asset-import-card-cb').forEach((cardCb) => {
          if (cardCb.dataset.folder === folder) cardCb.checked = cb.checked;
        });
        updateImportSelectedHint(root);
      });
    });
    root?.querySelectorAll('.asset-import-card-cb').forEach((cb) => {
      cb.addEventListener('change', () => updateImportSelectedHint(root));
    });
  }

  function getImportPickedCardIds(body) {
    return [...(body?.querySelectorAll('.asset-import-card-cb:checked') || [])].map((el) => el.value).filter(Boolean);
  }

  async function openImportModal(pkg, opts) {
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('请先登录');
      window.openAuthModal?.();
      return;
    }
    const overlay = document.getElementById('assetImportOverlay');
    const body = document.getElementById('assetImportBody');
    if (!overlay || !body) return;
    const warehouses = listWarehousesForAccount();
    const whOptions = warehouses
      .map((w) => `<option value="${esc(w.id)}"${w.id === getActiveWarehouseId() ? ' selected' : ''}>${esc(w.name)}</option>`)
      .join('');
    const folders = getPreviewFolderNodes(normalizePackage(pkg));
    const folderTree = folders.length
      ? `<div class="asset-import-folder-pick">
        <p class="asset-import-section-label">展开文件夹，勾选要导入的卡片（不勾选 = 导入全部）</p>
        <ul class="asset-import-tree">${folders.map((f) => renderImportFolderNode(f)).join('')}</ul>
        <p class="panel-hint asset-import-selected-hint" id="assetImportSelectedHint">未选卡片时将导入全部</p>
      </div>`
      : '';
    const normPkg = normalizePackage(pkg);
    const authorEditHint = normPkg.isAuthor
      ? `<div class="asset-import-author-bar">
        <p class="panel-hint">你是发布者：要改文件夹名（如「官能生成」→「女性美学」），请点右侧按钮，保存后买家看到的目录会一起更新。</p>
        <button type="button" class="btn btn-secondary btn-sm" id="assetImportEditPackBtn">编辑分组名称</button>
      </div>`
      : '';
    body.innerHTML = `
      <header class="asset-preview-head asset-import-head">
        <div>
          <h3 id="assetImportTitle">保存「${esc(normPkg.title)}」到卡片库</h3>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetImportClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <div class="asset-import-body">
        ${authorEditHint}
        ${folderTree}
        <label class="asset-import-wh-row">导入到卡片库
          <select class="settings-input" id="assetImportWarehouse">${whOptions}</select>
        </label>
        <div class="asset-import-actions asset-import-actions--primary">
          <button type="button" class="btn btn-primary" id="assetImportDoBtn">导入选中卡片</button>
          <button type="button" class="btn btn-secondary" id="assetImportAllBtn">导入全部</button>
        </div>
        <div class="asset-import-actions asset-import-actions--secondary">
          <button type="button" class="btn btn-secondary btn-sm" id="assetImportJsonBtn">下载 JSON</button>
          <button type="button" class="btn btn-secondary btn-sm" id="assetImportBrowseBtn">浏览包内图片</button>
        </div>
        <p class="panel-hint" id="assetImportStatus"></p>
      </div>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    bindImportFolderTree(body, normalizePackage(pkg));
    const close = () => {
      overlay.classList.remove('active');
      overlay.classList.add('hidden');
      overlay.onclick = null;
    };
    document.getElementById('assetImportClose')?.addEventListener('click', close);
    document.getElementById('assetImportEditPackBtn')?.addEventListener('click', () => {
      close();
      void openEditPublishModal(normPkg);
    });
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    document.getElementById('assetImportBrowseBtn')?.addEventListener('click', () => {
      close();
      void openPackagePreview({ ...normalizePackage(pkg), owned: true });
    });
    document.getElementById('assetImportJsonBtn')?.addEventListener('click', () => void downloadPackageJson(pkg));
    document.getElementById('assetImportAllBtn')?.addEventListener('click', () => {
      const wh = document.getElementById('assetImportWarehouse')?.value || 'default';
      void importPackageToWarehouse(pkg, wh, null, null);
    });
    document.getElementById('assetImportDoBtn')?.addEventListener('click', () => {
      const wh = document.getElementById('assetImportWarehouse')?.value || 'default';
      const cardIds = getImportPickedCardIds(body);
      void importPackageToWarehouse(pkg, wh, null, cardIds.length ? cardIds : null);
    });
  }

  async function downloadPackageJson(pkg) {
    const status = document.getElementById('assetImportStatus');
    if (status) status.textContent = '准备下载…';
    const r = await window.PromptHubApi.downloadAssetPackageJson(pkg.id);
    if (!r?.ok || !r.blob) {
      if (status) status.textContent = r?.message || '下载失败';
      toast(r?.message || '下载失败');
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.filename || `asset-pack-${pkg.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (status) status.textContent = 'JSON 已下载，可在卡片库使用导入功能';
    toast('JSON 已下载');
  }

  async function importPackageToWarehouse(pkg, warehouseId, folders, cardIds) {
    const btn = document.getElementById('assetImportDoBtn');
    const btnAll = document.getElementById('assetImportAllBtn');
    const status = document.getElementById('assetImportStatus');
    if (btn) btn.disabled = true;
    if (btnAll) btnAll.disabled = true;
    if (status) status.textContent = '正在导入…';
    const r = await window.PromptHubApi.importAssetPackage(pkg.id, warehouseId, folders, cardIds);
    if (btn) btn.disabled = false;
    if (btnAll) btnAll.disabled = false;
    if (!r?.ok) {
      const msg = r?.message || '导入失败';
      if (status) status.textContent = msg;
      toast(msg);
      return;
    }
    const n = r.data?.imported || 0;
    const groups = Array.isArray(r.data?.groups) ? r.data.groups : [];
    if (groups.length && window.mergeWarehouseGroupsFromList) {
      window.mergeWarehouseGroupsFromList(groups, warehouseId);
    }
    if (status) status.textContent = `已导入 ${n} 张卡片${groups.length ? `，已创建 ${groups.length} 个文件夹` : ''}`;
    toast(`已导入 ${n} 张卡片到所选库`);
    if (window.SupabaseSync?.pullCloudData) {
      await window.SupabaseSync.pullCloudData({ ifStale: true });
    }
    if (typeof window.refreshWarehouseUI === 'function') {
      window.refreshWarehouseUI({ softCards: false });
    }
    renderWarehouseSidebar();
  }

  function cardPickerThumb(card) {
    const img = card?.image;
    if (!img) return '';
    if (/^data:|^https?:\/\//i.test(img)) return img;
    const cached = window.MediaPipeline?.getListCached?.(img, card?.id)
      || window.SupabaseSync?.getCachedDisplayUrl?.(img, { variant: 'grid' });
    if (cached) return cached;
    return window.MediaPipeline?.safeImgSrc?.(img) || '';
  }

  async function resolveCardThumbs(cards) {
    const out = new Map();
    await Promise.all(
      cards.map(async (c) => {
        let url = cardPickerThumb(c);
        if (!url && c.image) {
          try {
            url = window.MediaPipeline?.resolveListUrl
              ? await window.MediaPipeline.resolveListUrl(c.image, { assetId: c.id, cardId: c.id })
              : await window.SupabaseSync.resolveDisplayUrl(c.image, { variant: 'grid', listOnly: true, allowFullFallback: false });
          } catch (e) {
            url = '';
          }
        }
        out.set(c.id, url);
      })
    );
    return out;
  }

  function loadGroupsForWarehouse(warehouseId) {
    const uid = accountKey();
    const wid = warehouseId || getActiveWarehouseId();
    const keys = [
      uid ? `promptrepo_groups_${uid}_${wid}` : '',
      `promptrepo_groups_${wid}`,
      uid ? `promptrepo_groups_${uid}` : ''
    ].filter(Boolean);
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map((g) => String(g)).filter(Boolean);
        }
      } catch (e) { /* ignore */ }
    }
    return [];
  }

  function collectCardTags(cards) {
    const set = new Set();
    const collectTag = window.COMMUNITY_COLLECT_TAG || '社区收藏';
    cards.forEach((c) => {
      (Array.isArray(c.tags) ? c.tags : []).forEach((t) => {
        const s = String(t || '').trim();
        if (s && s !== collectTag) set.add(s);
      });
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function groupCardsByFolder(cards, customGroups) {
    const map = new Map();
    const ordered = [];
    (customGroups || []).forEach((g) => {
      if (!map.has(g)) {
        map.set(g, []);
        ordered.push(g);
      }
    });
    cards.forEach((c) => {
      const g = String(c.group || '').trim() || '未分类';
      if (!map.has(g)) {
        map.set(g, []);
        ordered.push(g);
      }
      map.get(g).push(c);
    });
    const uncIdx = ordered.indexOf('未分类');
    if (uncIdx >= 0 && uncIdx < ordered.length - 1) {
      ordered.splice(uncIdx, 1);
      ordered.push('未分类');
    }
    return ordered.map((name) => ({ name, cards: map.get(name) || [] }));
  }

  function cardMatchesPublishFilters(card, filterTags, tagSearch) {
    const tags = Array.isArray(card.tags) ? card.tags.map((t) => String(t).toLowerCase()) : [];
    if (filterTags.size) {
      let ok = false;
      filterTags.forEach((ft) => {
        const needle = String(ft).toLowerCase();
        if (tags.some((t) => t === needle || t.includes(needle))) ok = true;
      });
      if (!ok) return false;
    }
    if (tagSearch) {
      const hay = [card.title, card.prompt, card.group, ...(Array.isArray(card.tags) ? card.tags : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(tagSearch)) return false;
    }
    return true;
  }

  function renderPublishCardRow(c, selectedIds, previewIds, thumbMap, packEditor, folderCtx) {
    const checked = selectedIds.has(c.id) ? ' checked' : '';
    const folderPreviewIds = folderCtx?.previewIds || previewIds;
    const previewOn = folderPreviewIds.has(c.id) ? ' checked' : '';
    const disabledPreview = selectedIds.has(c.id) ? '' : ' disabled';
    const previewLimit = folderCtx?.previewLimit || PACK_FOLDER_PREVIEW_MAX;
    const previewFull = folderPreviewIds.size >= previewLimit && !folderPreviewIds.has(c.id);
    const thumb = thumbMap.get(c.id) || '';
    const label = (c.title || c.prompt || '未命名').slice(0, 36);
    const tagHint =
      Array.isArray(c.tags) && c.tags.length
        ? `<span class="asset-publish-card-tags">${c.tags
            .slice(0, 3)
            .map((t) => esc(t))
            .join(' · ')}</span>`
        : '';
    const folderAssign =
      packEditor?.mode === 'custom' && packEditor.folders?.length
        ? `<select class="settings-input asset-publish-folder-assign" data-role="folder-assign">
        <option value="">未归入</option>
        ${packEditor.folders
          .map((f) => {
            const sel = f.cardIds.has(c.id) ? ' selected' : '';
            return `<option value="${esc(f.id)}"${sel}>${esc(f.name)}</option>`;
          })
          .join('')}
      </select>`
        : '';
    return `<div class="asset-publish-card-item" data-card-id="${esc(c.id)}">
          <input type="checkbox" class="asset-publish-card-check" data-role="include"${checked}>
          <div class="asset-publish-card-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<span class="asset-publish-card-noimg">无图</span>'}</div>
          <span class="asset-publish-card-label">${esc(label)}</span>
          ${tagHint}
          ${folderAssign}
          <label class="asset-publish-preview-check"><input type="checkbox" data-role="preview"${previewOn}${disabledPreview}${previewFull ? ' disabled' : ''}> 公开预览</label>
        </div>`;
  }

  function renderPublishCardPicker(warehouseId, selectedIds, previewIds, thumbMap, pickerState, packEditor, cardsOverride) {
    const state = pickerState || {};
    const expandedFolders =
      state.expandedFolders instanceof Set ? state.expandedFolders : new Set(state.expandedFolders || []);
    const filterTags = state.filterTags instanceof Set ? state.filterTags : new Set(state.filterTags || []);
    const tagSearch = String(state.tagSearch || '').trim().toLowerCase();
    const cards = cardsOverride?.length ? cardsOverride : getMainSiteCardsForWarehouse(warehouseId);
    if (!cards.length) {
      return '<p class="panel-hint">该库暂无卡片，请先在卡片库添加或切换其他库。</p>';
    }
    const allTags = collectCardTags(cards);
    const isCustom = packEditor?.mode === 'custom';
    let folders;
    if (isCustom && packEditor?.folders?.length) {
      const assigned = new Set();
      packEditor.folders.forEach((f) => f.cardIds.forEach((id) => assigned.add(id)));
      folders = packEditor.folders.map((f) => ({
        id: f.id,
        name: f.name,
        cards: cards.filter((c) => f.cardIds.has(c.id)),
        previewIds: f.previewIds
      }));
      const unassigned = cards.filter((c) => !assigned.has(c.id));
      if (unassigned.length) {
        folders.push({ id: '_unassigned', name: '未归入', cards: unassigned, previewIds: new Set() });
      }
    } else {
      folders = groupCardsByFolder(cards, loadGroupsForWarehouse(warehouseId)).map((f) => ({
        id: f.name,
        name: f.name,
        cards: f.cards,
        previewIds: previewIds
      }));
    }
    if (!expandedFolders.size) {
      folders.forEach((f) => expandedFolders.add(f.name));
    }

    const tagChips = allTags.length
      ? `<div class="asset-publish-tag-filters">
        <span class="panel-hint">标签筛选（可多选）</span>
        <div class="asset-publish-tag-chips">${allTags
          .map((t) => {
            const on = filterTags.has(t) ? ' asset-publish-tag-chip--on' : '';
            return `<button type="button" class="asset-publish-tag-chip${on}" data-tag="${esc(t)}">${esc(t)}</button>`;
          })
          .join('')}</div>
      </div>`
      : '';

    const searchRow = `<label class="asset-publish-tag-search">搜索
    <input type="search" class="settings-input" id="assetPublishTagSearch" placeholder="标题 / 标签 / 文件夹" value="${esc(state.tagSearch || '')}">
  </label>`;

    const folderHtml = folders
      .map(({ id, name, cards: folderCards, previewIds: folderPreviewIds }) => {
        const visible = folderCards.filter((c) => cardMatchesPublishFilters(c, filterTags, tagSearch));
        if (!visible.length) return '';
        const expanded = expandedFolders.has(name);
        const chevron = expanded ? '▼' : '▶';
        const bodyClass = expanded ? '' : ' asset-publish-folder-body--collapsed';
        const allVisibleSelected = visible.every((c) => selectedIds.has(c.id));
