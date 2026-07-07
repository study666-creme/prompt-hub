      cards,
      packEditor.folders,
      packEditor.mode,
      ctx?.previewIds || new Set()
    );
    const priceYuan = Math.max(0, Number(fd.get('priceYuan')) || 0);
    const packUi = String(fd.get('packUi') || 'light') === 'heavy' ? 'heavy' : 'light';
    const payload = {
      title,
      description: String(fd.get('description') || '').trim(),
      tag: String(fd.get('tag') || (priceYuan ? '套装' : '免费')).trim(),
      priceCents: Math.round(priceYuan * 100),
      saleType: 'bulk',
      commercialUseAllowed: fd.get('commercialUseAllowed') === 'on',
      previewCardIds,
      previewTree,
      packUi,
      cards
    };
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const r = await window.PromptHubApi.updateAssetPackage(editId, payload);
    if (btn) btn.disabled = false;
    if (!r?.ok) {
      toast(r?.message || '保存失败');
      return;
    }
    toast(`「${title}」已更新（${cards.length} 张 · 预览 ${previewCardIds.length} 张）`);
    closePublishModal();
    closePackagePreview();
    await refreshMarketPackages();
    void renderMarketplace();
  }

  async function openEditPublishModal(pkg) {
    if (!pkg?.isAuthor || pkg.isDemo) {
      toast('仅可编辑自己发布的资产包');
      return;
    }
    if (!window.PromptHubApi?.getAssetPackageContent) {
      toast('API 未就绪');
      return;
    }
    const contentR = await window.PromptHubApi.getAssetPackageContent(pkg.id);
    if (!contentR?.ok || !Array.isArray(contentR.data?.cards)) {
      toast(contentR?.message || '无法加载包内卡片');
      return;
    }
    const packCards = contentR.data.cards.map((c) => ({
      id: c.id,
      title: c.title || '',
      prompt: c.prompt || '',
      image: c.image || '',
      group: c.group || null,
      tags: c.tags || []
    }));
    const norm = findPackage(pkg.id) || normalizePackage(pkg);
    const previewCardIds = norm.previewCardIds || [];
    await openPublishModal({
      editPackageId: pkg.id,
      initial: {
        title: norm.title,
        description: norm.desc,
        tag: norm.tag,
        priceYuan: (norm.priceCents || 0) / 100,
        commercialUseAllowed: norm.commercialUseAllowed,
        packUi: norm.packUi || 'light'
      },
      packCards,
      previewCardIds
    });
  }

  function openAssetPreviewLightbox(src, opts) {
    if (!src) return;
    const allowSave = !!opts?.allowSave;
    const allowCollect = !!opts?.allowCollect;
    const assetPack = {
      allowSave,
      allowCollect,
      packageId: opts?.packageId,
      cardId: opts?.cardId,
      packageTitle: opts?.packageTitle || ''
    };
    if (typeof window.openLightbox === 'function') {
      window.openLightbox(src, { assetPack });
    } else window.open(src, '_blank');
  }

  async function collectLightboxPackCard() {
    const ctx = window.__packLightboxCollect;
    if (!ctx?.packageId || !ctx?.cardId) {
      toast('无法收藏此图片');
      return;
    }
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('请先登录');
      window.openAuthModal?.();
      return;
    }
    const wh = getActiveWarehouseId();
    const collectBtn = document.getElementById('lightboxCollectBtn');
    if (collectBtn) collectBtn.disabled = true;
    await importPackageToWarehouse(
      { id: ctx.packageId, title: ctx.packageTitle || '资产包' },
      wh,
      null,
      [ctx.cardId]
    );
    if (collectBtn) collectBtn.disabled = false;
  }

  function getPreviewFolderNodes(pkg) {
    const tree = Array.isArray(pkg?.previewTree) ? pkg.previewTree : [];
    return tree
      .map((node) => {
        if (!node || typeof node !== 'object') return null;
        const name = String(node.name || '').trim();
        if (!name) return null;
        const legacy = Array.isArray(node.children) ? node.children.length : 0;
        return {
          name,
          cardCount: Number(node.cardCount) || legacy || 0,
          previewCount: Array.isArray(node.previewCardIds) ? node.previewCardIds.length : 0
        };
      })
      .filter(Boolean);
  }

  function renderPreviewFolderList(nodes, owned) {
    if (!nodes.length) return '<li class="panel-hint">暂无目录信息</li>';
    return nodes
      .map(
        (node) => `<li class="asset-preview-folder" data-folder="${esc(node.name)}">
        <button type="button" class="asset-preview-folder-toggle" aria-expanded="false">
          <span class="asset-preview-folder-chevron" aria-hidden="true">▶</span>
          <span class="asset-preview-folder-name">${esc(node.name)}</span>
          <em>${node.cardCount} 张</em>
          <span class="asset-preview-folder-hint">${owned ? '点击展开浏览' : '展开查看公开预览（最多 5 张）'}</span>
        </button>
        <div class="asset-preview-folder-body hidden" data-folder-body>
          <p class="panel-hint asset-preview-folder-loading hidden">加载中…</p>
          <div class="asset-tree-previews" data-folder-thumbs></div>
          <p class="panel-hint asset-preview-folder-empty hidden">该文件夹暂无可预览图片</p>
        </div>
      </li>`
      )
      .join('');
  }

  async function loadPreviewFolderImages(folderEl, pkg, owned) {
    if (!folderEl || folderEl.dataset.loaded === '1') return;
    const folder = folderEl.dataset.folder;
    const body = folderEl.querySelector('[data-folder-body]');
    const loading = folderEl.querySelector('.asset-preview-folder-loading');
    const thumbs = folderEl.querySelector('[data-folder-thumbs]');
    const empty = folderEl.querySelector('.asset-preview-folder-empty');
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (thumbs) thumbs.innerHTML = '';

    if (pkg.isDemo) {
      if (loading) loading.classList.add('hidden');
      if (empty) {
        empty.textContent = '演示包：正式预览图与文档在购买后交付';
        empty.classList.remove('hidden');
      }
      folderEl.dataset.loaded = '1';
      return;
    }

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
    const items = r.data.items.filter((it) => it?.imageUrl);
    if (!items.length) {
      if (empty) {
        empty.textContent = owned
          ? '该文件夹暂无图片'
          : '作者未在本文件夹开放预览图';
        empty.classList.remove('hidden');
      }
      folderEl.dataset.loaded = '1';
      return;
    }
    const fullAccess = !!r.data.fullAccess;
    if (thumbs) {
      thumbs.innerHTML = items
        .map(
          (it) =>
            `<button type="button" class="asset-tree-preview-thumb asset-tree-preview-thumb--btn" data-preview-url="${esc(it.imageUrl)}" data-card-id="${esc(it.cardId)}" title="${esc(it.label)}">
              <img src="${esc(it.imageUrl)}" alt="" loading="lazy" draggable="false">
            </button>`
        )
        .join('');
      thumbs.querySelectorAll('[data-preview-url]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openAssetPreviewLightbox(btn.dataset.previewUrl, {
            allowSave: fullAccess && owned,
            allowCollect: fullAccess && owned,
            packageId: pkg.id,
            cardId: btn.dataset.cardId,
            packageTitle: pkg.title
          });
        });
      });
    }
    folderEl.dataset.loaded = '1';
  }

  function bindPreviewFolderTree(root, pkg, owned) {
    root?.querySelectorAll('.asset-preview-folder-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const folderEl = btn.closest('.asset-preview-folder');
        const body = folderEl?.querySelector('[data-folder-body]');
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body?.classList.toggle('hidden', expanded);
        const chev = btn.querySelector('.asset-preview-folder-chevron');
        if (chev) chev.textContent = expanded ? '▶' : '▼';
        if (!expanded) void loadPreviewFolderImages(folderEl, pkg, owned);
      });
    });
  }

  async function openPackagePreview(pkgOrId) {
    const pkg = typeof pkgOrId === 'object' ? normalizePackage(pkgOrId) : findPackage(pkgOrId);
    const overlay = document.getElementById('assetPreviewOverlay');
    const body = document.getElementById('assetPreviewBody');
    if (!pkg || !overlay || !body) return;
    const owned = !!pkg.owned;
    const folders = getPreviewFolderNodes(pkg);
    const buyout = pkg.saleType === 'buyout';
    const isFree = !pkg.priceCents;
    const buyLabel = pkg.isDemo ? '关闭' : owned ? '已拥有' : isFree ? '免费领取' : buyout ? '买断' : '购买';

    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <p class="asset-preview-tag">${esc(pkg.tag)} · ${esc(pkg.countLabel)} · ${esc(pkg.authorName || '')}</p>
          <h3 id="assetPreviewTitle">${esc(pkg.title)}</h3>
          <p class="asset-preview-price">${pkg.isDemo ? '演示包 · 非售卖' : esc(pkg.priceLabel)} ${commercialBadge(pkg)}</p>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetPreviewClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <div class="asset-preview-layout asset-preview-layout--tree-only">
        <section class="asset-preview-section">
          <h4>${owned ? '包内目录（已拥有 · 展开文件夹浏览全部图片）' : '目录结构（展开查看公开预览，点击放大）'}</h4>
          ${owned ? '<p class="panel-hint asset-preview-owned-hint">展开文件夹 → 点击图片可放大并下载；「选择性导入」可勾选单张或整组导入卡片库。</p>' : ''}
          <ul class="asset-preview-tree asset-preview-tree--folders">${renderPreviewFolderList(folders, owned)}</ul>
        </section>
      </div>
      <footer class="asset-preview-foot">
        <p>${esc(pkg.license || pkg.desc || '')}</p>
        <div class="asset-preview-foot-actions">
          ${owned ? '<button type="button" class="btn btn-secondary btn-sm" id="assetPreviewImportBtn">选择性导入</button>' : ''}
          ${pkg.isAuthor ? '<button type="button" class="btn btn-secondary btn-sm" id="assetPreviewEditBtn">编辑分组名称</button>' : ''}
          ${pkg.isAuthor ? '<button type="button" class="btn btn-ghost btn-sm" id="assetPreviewArchiveBtn">下架删除</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" id="assetPreviewBuyBtn"${owned && !pkg.isDemo ? ' disabled' : ''}>${buyLabel}</button>
        </div>
      </footer>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    bindPreviewFolderTree(body, pkg, owned);
    document.getElementById('assetPreviewClose')?.addEventListener('click', closePackagePreview);
    overlay.onclick = (e) => {
      if (e.target === overlay) closePackagePreview();
    };
    document.getElementById('assetPreviewBuyBtn')?.addEventListener('click', () => {
      if (pkg.isDemo) {
        closePackagePreview();
        return;
      }
      if (!owned) void claimPackage(pkg);
    });
    document.getElementById('assetPreviewImportBtn')?.addEventListener('click', () => {
      closePackagePreview();
      void openImportModal(pkg);
    });
    document.getElementById('assetPreviewEditBtn')?.addEventListener('click', () => {
      void openEditPublishModal(pkg);
    });
    document.getElementById('assetPreviewArchiveBtn')?.addEventListener('click', () => {
      void archivePublishedPackage(pkg);
    });
  }

  function closePackagePreview() {
    const overlay = document.getElementById('assetPreviewOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.classList.add('hidden');
    overlay.onclick = null;
  }

  function renderStudio() {
    const root = document.getElementById('assetStudioRoot');
    if (!root) return;
    const cardN = (window.__promptHubCards || []).length;
    root.innerHTML = `
      <div class="asset-studio-launch">
        <header class="feature-header asset-studio-launch-head">
          <h2>卡片式创作</h2>
          <div class="asset-studio-launch-actions">
            <button type="button" class="btn btn-primary" id="assetStudioOpenBtn">进入创作工作台</button>
            <button type="button" class="btn btn-secondary" id="assetStudioExportBtn">打开并同步卡片库</button>
          </div>
        </header>
        <p class="community-inline-hint">基于卡片资产创作脚本，一键导入无限画布生成节点，点击生成视频。</p>
        <ul class="asset-studio-launch-list">
          <li>左侧卡片库按主站<strong>分组文件夹</strong>展示，支持筛选与详情编辑</li>
          <li>文档分类可自建文件夹，拖入首字段建立卡片 ↔ 文档关联</li>
          <li>右侧生图对接主站积分与 API；对话区可汇总当前文档上下文</li>
        </ul>
        <p class="panel-hint">当前主站卡片库约 <strong>${cardN}</strong> 张；进入工作台后可一键导入。</p>
      </div>`;
    document.getElementById('assetStudioOpenBtn')?.addEventListener('click', () => {
      window.location.href = 'asset-studio.html';
    });
    document.getElementById('assetStudioExportBtn')?.addEventListener('click', () => {
      exportCardsForStudio({ silent: true });
      window.location.href = 'asset-studio.html?import=1';
    });
  }

  function exportCardsForStudio(opts) {
    const silent = opts && opts.silent;
    const raw = window.__promptHubCards || [];
    let groups = [];
    try {
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
      const key = uid ? `promptrepo_groups_${uid}` : 'promptrepo_groups';
      const g = localStorage.getItem(key) || localStorage.getItem('promptrepo_groups');
      if (g) groups = JSON.parse(g);
    } catch (e) { groups = []; }
    if (!Array.isArray(groups)) groups = [];
    const list = raw.slice(0, 200).map((c) => ({
      id: c.id,
      title: c.title,
      prompt: c.prompt,
      image: c.image,
      group: c.group,
      tags: c.tags
    }));
    try {
      localStorage.setItem('promptrepo_studio_import_cards', JSON.stringify({ cards: list, groups }));
      if (!silent) {
        toast(list.length ? `已准备 ${list.length} 张卡片，请点击工作台「导入卡片库」` : '卡片库为空');
      }
    } catch (e) {
      if (!silent) toast('导出失败，请直接打开工作台');
    }
  }

  function bindUI() {
    document.getElementById('sidebarWarehouseAddBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      tryCreateWarehouse();
    });
    const bindPublish = (el) => {
      if (!el || el.dataset.boundPublish) return;
      el.dataset.boundPublish = '1';
      el.addEventListener('click', () => {
        void openPublishModal().catch((e) => {
          console.error('[assets] publish open', e);
          toast('无法打开发布窗口');
        });
      });
    };
    bindPublish(document.getElementById('assetPublishOpenBtn'));
    document.getElementById('lightboxCollectBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void collectLightboxPackCard();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePackagePreview();
        closePublishModal();
        const imp = document.getElementById('assetImportOverlay');
        if (imp) {
          imp.classList.remove('active');
          imp.classList.add('hidden');
        }
      }
    });
  }

  function onAppChange(app, devlabPanel) {
    const panel =
      devlabPanel
      || (app === 'devlab' ? (localStorage.getItem('promptrepo_devlab_panel') || 'assetmarket') : app);
    if (panel === 'assetmarket' || app === 'assetmarket') {
      window.resumeRippleBackground?.();
      void renderMarketplace();
    }
    if (panel === 'assetstudio' || app === 'assetstudio') {
      renderStudio();
    }
    if (app === 'warehouse') renderWarehouseSidebar();
  }

  function init() {
    const saved = localStorage.getItem('promptrepo_app_page');
    if (saved === 'assetstudio' || saved === 'assetmarket') {
      localStorage.setItem('promptrepo_app_page', 'devlab');
      localStorage.setItem('promptrepo_devlab_panel', saved === 'assetstudio' ? 'assetstudio' : 'assetmarket');
    }
    bindUI();
    renderWarehouseSidebar();
    void refreshMarketPackages();
  }

  window.FeatureAssets = {
    init,
    onAppChange,
    renderMarketplace,
    renderStudio,
    renderWarehouseSidebar,
    tryCreateWarehouse,
    getExtraWarehouseLimit,
    exportCardsForStudio,
    MOCK_PACKAGES,
    refreshMarketPackages,
    getActiveWarehouseId,
    getWarehouseById,
    filterCardsByWarehouse,
    cardWarehouseId,
    countWarehouseCards,
    getOtherWarehouses,
    moveCardsToWarehouse,
    updateWarehouseTitle,
    listWarehousesForAccount,
    getMainSiteCardsForWarehouse,
    loadWarehouseStore,
    renderMyHomePackages,
    openPackagePreview,
    closePackagePreview,
    openEditPublishModal,
    openPublishModal,
    closePublishModal,
    openImportModal,
    playOpenPackAnimation
  };
})();
