  }

  function accountKey() {
    return window.SupabaseSync?.getUserId?.() || 'guest';
  }

  function loadWarehouseStore() {
    const key = `${LS_WAREHOUSES}_${accountKey()}`;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.warehouses?.length) return parsed;
    } catch (e) { /* ignore */ }
    return {
      activeId: 'default',
      warehouses: [{ id: 'default', name: '默认库', isDefault: true }]
    };
  }

  function saveWarehouseStore(store) {
    const key = `${LS_WAREHOUSES}_${accountKey()}`;
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch (e) { /* ignore */ }
  }

  function getExtraWarehouseLimit() {
    const tier = window.Membership?.getMemberTier?.();
    if (tier && EXTRA_WAREHOUSE_BY_TIER[tier] != null) return EXTRA_WAREHOUSE_BY_TIER[tier];
    return EXTRA_WAREHOUSE_FREE;
  }

  function countExtraWarehouses(store) {
    return store.warehouses.filter((w) => !w.isDefault).length;
  }

  function migrateWarehouseStore(store) {
    if (!store?.warehouses?.length) return store;
    store.warehouses.forEach((w) => {
      if (w.isDefault && (w.name === '我的卡片库' || w.name === '我的卡片库 ')) w.name = '默认库';
    });
    return store;
  }

  function cardWarehouseId(card) {
    return card?.warehouseId || 'default';
  }

  function getActiveWarehouseId() {
    return migrateWarehouseStore(loadWarehouseStore()).activeId || 'default';
  }

  function getWarehouseById(id) {
    const store = migrateWarehouseStore(loadWarehouseStore());
    return store.warehouses.find((w) => w.id === id);
  }

  function filterCardsByWarehouse(cardList, warehouseId) {
    const wid = warehouseId || getActiveWarehouseId();
    return (cardList || []).filter((c) => cardWarehouseId(c) === wid);
  }

  function countWarehouseCards(warehouseId) {
    return filterCardsByWarehouse(window.__promptHubCards || [], warehouseId).length;
  }

  async function fetchMyPackages(kind) {
    if (!window.SupabaseSync?.isLoggedIn?.()) return [];
    const fn = kind === 'published'
      ? window.PromptHubApi?.listMyPublishedAssetPackages
      : window.PromptHubApi?.listMyOwnedAssetPackages;
    if (typeof fn !== 'function') return [];
    const r = await fn();
    if (!r?.ok || !Array.isArray(r.data?.items)) return [];
    return r.data.items.map(normalizePackage).filter(Boolean);
  }

  function renderMyHomePackageCard(pkg, kind) {
    const norm = normalizePackage(pkg);
    const packUi = resolvePackUi(norm);
    const buyout = norm.saleType === 'buyout';
    const uiClass = packUi === 'heavy' ? ' asset-market-card--heavy' : ' asset-market-card--light';
    const featuredClass = norm.featured ? ' asset-market-card--featured' : '';
    const cover = packUi === 'heavy' ? renderHeavyCover(norm) : renderStackCover(norm);
    const priceHtml = norm.isDemo
      ? '<span class="asset-market-price asset-market-price--demo">演示<em>非售卖 · 仅结构预览</em></span>'
      : `<span class="asset-market-price">${esc(norm.priceLabel)}${buyout ? ' <em>买断</em>' : ''}</span>`;
    const showImport = kind === 'owned' || norm.owned;
    const authorActions = norm.isAuthor
      ? `<button type="button" class="btn btn-secondary btn-sm" data-action="edit">编辑分组</button>
         <button type="button" class="btn btn-ghost btn-sm asset-pack-archive-btn" data-action="archive">下架</button>`
      : '';
    const actionsHtml = `<div class="asset-market-card-actions my-home-package-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-action="preview">查看</button>
              ${showImport ? '<button type="button" class="btn btn-secondary btn-sm" data-action="import">导入</button>' : ''}
              ${authorActions}
            </div>`;
    return `<article class="asset-market-card my-home-package-card${uiClass}${featuredClass}" data-pkg-id="${esc(norm.id)}" data-pack-ui="${packUi}">
        ${cover}
        <div class="asset-market-card-body">
          <p class="asset-market-card-author">${esc(norm.authorName || '作者')}</p>
          <h3 class="asset-market-card-title">${esc(norm.title)}</h3>
          <p class="asset-market-card-meta">${esc(norm.countLabel)}</p>
          <p class="asset-market-card-meta">${commercialBadge(norm)}</p>
          <p class="asset-market-card-desc">${esc(norm.desc)}</p>
          <div class="asset-market-card-foot my-home-package-foot">
            ${priceHtml}
            ${actionsHtml}
          </div>
        </div>
      </article>`;
  }

  async function renderMyHomePackages(container, kind) {
    if (!container) return;
    container.innerHTML = '<p class="panel-hint">加载中…</p>';
    const list = await fetchMyPackages(kind);
    if (!list.length) {
      container.innerHTML =
        kind === 'published'
          ? '<div class="feature-empty"><p>暂无发布的资产包</p><p class="panel-hint">在「开发中 → 卡片资产」点击「发布资产包」上架你的免费或付费包。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>'
          : '<div class="feature-empty"><p>暂无拥有的资产包</p><p class="panel-hint">在「开发中 → 卡片资产」领取免费包或购买后，会显示在这里。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>';
      return;
    }
    container.innerHTML = `<div class="asset-market-grid">${list
      .map((pkg) => renderMyHomePackageCard(pkg, kind))
      .join('')}</div>`;
    void hydrateMarketCovers(list);
    container.querySelectorAll('[data-action="preview"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void openPackagePreview({ ...normalizePackage(pkg), owned: kind === 'owned' || !!pkg.owned });
      });
    });
    container.querySelectorAll('[data-action="preview-cover"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void openPackagePreview(pkg);
      });
    });
    container.querySelectorAll('[data-action="import"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void openImportModal(pkg);
      });
    });
    container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void openEditPublishModal(pkg);
      });
    });
    container.querySelectorAll('[data-action="archive"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void archivePublishedPackage(pkg, container, kind);
      });
    });
  }

  async function archivePublishedPackageConfirmed(pkg, container, kind) {
    if (!window.PromptHubApi?.updateAssetPackage) {
      toast('API 未就绪');
      return;
    }
    const r = await window.PromptHubApi.updateAssetPackage(pkg.id, { status: 'archived' });
    if (!r?.ok) {
      const hint =
        r?.code === 'NETWORK_ERROR' || r?.code === 'API_UNREACHABLE'
          ? '无法连接 api.prompt-hubs.com，请检查网络/VPN 后重试'
          : r?.message || '下架失败';
      toast(hint, 5000);
      return;
    }
    toast('已下架');
    closePackagePreview();
    await refreshMarketPackages();
    const publishedPane = container || document.getElementById('myHomePublishedPackages');
    if (publishedPane) void renderMyHomePackages(publishedPane, kind || 'published');
    void renderMarketplace();
  }

  function archivePublishedPackage(pkg, container, kind) {
    const msg = `下架「${pkg.title}」？\n\n市场将不再展示；已领取用户仍保留。旧版空包可下架后重新发布带卡片的新包。`;
    const run = () => void archivePublishedPackageConfirmed(pkg, container, kind);
    if (typeof window.customConfirm === 'function') {
      window.customConfirm(msg, run, null, { danger: true, confirmLabel: '下架删除' });
      return;
    }
    if (window.confirm(msg)) void run();
  }

  function renderWarehouseSidebar() {
    const list = document.getElementById('warehouseList');
    if (!list) return;
    const store = migrateWarehouseStore(loadWarehouseStore());
    saveWarehouseStore(store);
    list.innerHTML = store.warehouses
      .map(
        (w) => {
          const n = countWarehouseCards(w.id);
          return `<button type="button" class="group-item warehouse-item${store.activeId === w.id ? ' active' : ''}" data-warehouse-id="${esc(w.id)}" title="${esc(w.name)}">${esc(w.name)} <span class="count">${n}</span></button>`;
        }
      )
      .join('');
    list.querySelectorAll('.warehouse-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.warehouseId;
        const s = migrateWarehouseStore(loadWarehouseStore());
        if (s.activeId === id) return;
        const prevId = s.activeId;
        s.activeId = id;
        saveWarehouseStore(s);
        if (typeof window.onWarehouseSwitched === 'function') window.onWarehouseSwitched(prevId, id);
        renderWarehouseSidebar();
        updateWarehouseTitle();
        if (typeof window.refreshWarehouseUI === 'function') {
          window.refreshWarehouseUI({ softCards: false });
        }
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const s = migrateWarehouseStore(loadWarehouseStore());
        const w = s.warehouses.find((x) => x.id === btn.dataset.warehouseId);
        if (!w) return;
        const promptFn = window.customPrompt;
        const finish = (name) => {
          if (!name?.trim()) return;
          w.name = name.trim().slice(0, 16);
          saveWarehouseStore(s);
          renderWarehouseSidebar();
          updateWarehouseTitle();
        };
        if (typeof promptFn === 'function') {
          promptFn(w.isDefault ? '默认库名称' : '卡片库名称', w.name, finish);
        } else {
          const name = window.prompt(w.isDefault ? '默认库名称' : '卡片库名称', w.name);
          finish(name);
        }
      });
      if (btn.dataset.warehouseId?.includes('default')) return;
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const whId = btn.dataset.warehouseId;
        const s = migrateWarehouseStore(loadWarehouseStore());
        const w = s.warehouses.find((x) => x.id === whId);
        if (!w || w.isDefault) return;
        const items = [
          {
            label: '重命名',
            action: () => {
              const promptFn = window.customPrompt;
              const finish = (name) => {
                if (!name?.trim()) return;
                w.name = name.trim().slice(0, 16);
                saveWarehouseStore(s);
                renderWarehouseSidebar();
                updateWarehouseTitle();
              };
              if (typeof promptFn === 'function') promptFn('卡片库名称', w.name, finish);
              else finish(window.prompt('卡片库名称', w.name));
            }
          },
          {
            label: '删除空库',
            action: () => {
              const n = countWarehouseCards(whId);
              if (n > 0) {
                toast(`库内还有 ${n} 张卡片，请先移回默认库或删除卡片`);
                return;
              }
              s.warehouses = s.warehouses.filter((x) => x.id !== whId);
              if (s.activeId === whId) s.activeId = 'default';
              saveWarehouseStore(s);
              renderWarehouseSidebar();
              updateWarehouseTitle();
              if (typeof window.refreshWarehouseUI === 'function') window.refreshWarehouseUI({ softCards: false });
              toast('已删除卡片库');
            }
          }
        ];
        if (typeof window.showContextMenu === 'function') window.showContextMenu(e.clientX, e.clientY, items);
      });
    });
  }

  function updateWarehouseTitle() {
    const w = getWarehouseById(getActiveWarehouseId());
    const titleEl = document.getElementById('currentGroupTitle');
    if (!titleEl || !w) return;
    const groupLabel =
      typeof window.currentGroup === 'string'
        ? window.currentGroup === 'all'
          ? '全部提示词'
          : window.currentGroup === 'uncategorized'
            ? '未分类'
            : window.currentGroup
        : '全部提示词';
    titleEl.textContent = w.isDefault ? groupLabel : `${w.name} · ${groupLabel}`;
  }

  function getOtherWarehouses() {
    const active = getActiveWarehouseId();
    return migrateWarehouseStore(loadWarehouseStore()).warehouses.filter((w) => w.id !== active);
  }

  function moveCardsToWarehouse(cardIds, warehouseId) {
    const target = getWarehouseById(warehouseId);
    if (!target || !Array.isArray(cardIds) || !cardIds.length) return 0;
    const list = window.__promptHubCards || [];
    let n = 0;
    cardIds.forEach((id) => {
      const c = list.find((x) => x.id === id);
      if (!c) return;
      c.warehouseId = target.id;
      n += 1;
    });
    if (n) {
      window.__promptHubCards = list;
      renderWarehouseSidebar();
      if (typeof window.persistPromptHubCards === 'function') void window.persistPromptHubCards({ skipCloud: true });
      else if (typeof window.refreshWarehouseUI === 'function') window.refreshWarehouseUI({ softCards: false });
    }
    return n;
  }

  function tryCreateWarehouse() {
    const limit = getExtraWarehouseLimit();
    const tier = window.Membership?.getMemberTier?.();
    const store = loadWarehouseStore();
    const extra = countExtraWarehouses(store);
    if (extra >= limit) {
      let hint = `已达额外卡片库上限（${limit} 个，不含默认库）。`;
      if (!tier) hint += ' 升级会员可创建更多。';
      else if (tier === 'lite' || tier === 'basic') hint += ' 标准版再 +1，专业版再 +1。';
      else if (tier === 'standard') hint += ' 升级专业版再 +1。';
      toast(hint, 5500);
      if (!tier && typeof window.openSubscribePanel === 'function') {
        setTimeout(() => window.openSubscribePanel(), 600);
      }
      return;
    }
    const promptFn = window.customPrompt;
    if (typeof promptFn !== 'function') {
      const name = window.prompt('新卡片库名称', '我的风格库');
      if (!name?.trim()) return;
      finishCreateWarehouse(name.trim(), store);
      return;
    }
    promptFn('输入新卡片库名称（2～16 字）', '我的风格库', (name) => {
      if (!name?.trim()) return;
      finishCreateWarehouse(name.trim().slice(0, 16), store);
    });
  }

  function listWarehousesForAccount() {
    return migrateWarehouseStore(loadWarehouseStore()).warehouses;
  }

  function getMainSiteCardsForWarehouse(warehouseId) {
    const wid = warehouseId || getActiveWarehouseId();
    const all = window.__promptHubCards || [];
    return all.filter((c) => cardWarehouseId(c) === wid);
  }

  function importCardsFromWarehouse(sourceId, targetId, opts) {
    const srcId = sourceId || getActiveWarehouseId();
    const tgtId = targetId;
    if (!srcId || !tgtId || srcId === tgtId) return 0;
    const all = window.__promptHubCards || [];
    const srcCards = all.filter((c) => cardWarehouseId(c) === srcId);
    if (!srcCards.length) return 0;
    const now = Date.now();
    const copyGroups = opts?.copyGroups !== false;
    srcCards.forEach((c, i) => {
      all.push({
        ...c,
        id: `card_${now}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        warehouseId: tgtId,
        group: copyGroups ? c.group || null : null,
        communityPostId: null,
        publishedToCommunity: false,
        createdAt: now,
        updatedAt: now
      });
    });
    if (copyGroups) {
      const groups = loadGroupsForWarehouse(srcId);
      try {
        localStorage.setItem(`promptrepo_groups_${accountKey()}_${tgtId}`, JSON.stringify(groups));
      } catch (e) { /* ignore */ }
    }
    window.__promptHubCards = all;
    if (typeof window.persistPromptHubCards === 'function') {
      void window.persistPromptHubCards({ skipCloud: false });
    } else if (typeof window.savePromptHubCardsNow === 'function') {
      void window.savePromptHubCardsNow();
    }
    return srcCards.length;
  }

  function openWarehouseImportDialog(newWhId, newWhName) {
    const others = listWarehousesForAccount().filter((w) => w.id !== newWhId && countWarehouseCards(w.id) > 0);
    if (!others.length) return;
    const overlay = document.getElementById('customModalOverlay');
    const modal = document.getElementById('customModal');
    if (!overlay || !modal) return;
    const options = others
      .map(
        (w) =>
          `<option value="${esc(w.id)}">${esc(w.name)}（${countWarehouseCards(w.id)} 张）</option>`
      )
      .join('');
    modal.innerHTML = `
      <h3>导入卡片</h3>
      <p class="custom-modal-body">新库「${esc(newWhName)}」已创建。可从其他卡片库复制卡片（生成新副本，不影响原库）。</p>
      <label class="asset-wh-import-label">来源库
        <select id="whImportSource" class="settings-input">${options}</select>
      </label>
      <label class="asset-wh-import-check"><input type="checkbox" id="whImportCopyGroups" checked> 保留原分组名</label>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="whImportSkip">稍后</button>
        <button type="button" class="btn btn-primary" id="whImportAll">导入全部</button>
      </div>`;
    overlay.classList.add('active');
    document.body.classList.add('custom-modal-open');
    const close = () => {
      if (typeof window.closeCustomModal === 'function') window.closeCustomModal();
      else {
        overlay.classList.remove('active');
        document.body.classList.remove('custom-modal-open');
      }
    };
    document.getElementById('whImportSkip')?.addEventListener('click', close);
    document.getElementById('whImportAll')?.addEventListener('click', () => {
      const src = document.getElementById('whImportSource')?.value;
      const copyGroups = document.getElementById('whImportCopyGroups')?.checked !== false;
      const n = importCardsFromWarehouse(src, newWhId, { copyGroups });
      close();
      if (n) {
        toast(`已从来源库导入 ${n} 张卡片`);
        renderWarehouseSidebar();
        updateWarehouseTitle();
        if (typeof window.refreshWarehouseUI === 'function') {
          window.refreshWarehouseUI({ softCards: false });
        }
      } else toast('来源库暂无卡片');
    });
  }

  function finishCreateWarehouse(name, store) {
    const id = `wh_${Date.now().toString(36)}`;
    const prevId = store.activeId;
    store.warehouses.push({ id, name, isDefault: false, createdAt: Date.now() });
    store.activeId = id;
    saveWarehouseStore(store);
    try {
      localStorage.setItem(`promptrepo_groups_${accountKey()}_${id}`, '[]');
    } catch (e) { /* ignore */ }
    if (typeof window.onWarehouseSwitched === 'function') window.onWarehouseSwitched(prevId, id);
    renderWarehouseSidebar();
    updateWarehouseTitle();
    if (typeof window.refreshWarehouseUI === 'function') window.refreshWarehouseUI({ softCards: false });
    toast(`已创建卡片库「${name}」`);
    openWarehouseImportDialog(id, name);
  }

  function bindMarketGridEvents(grid, list) {
    grid.querySelectorAll('.asset-market-card').forEach((card) => {
      const id = card.dataset.pkgId;
      const pkg = (list || marketPackages).find((p) => p.id === id) || findPackage(id);
      card.querySelector('[data-action="preview-cover"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pkg) void openPackagePreview(pkg);
      });
      card.querySelector('[data-action="buy"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pkg?.isDemo) {
          void openPackagePreview(pkg);
          return;
        }
        if (pkg && !pkg.owned) void claimPackage(pkg);
        else if (pkg?.owned && pkg.isAuthor) void openEditPublishModal(pkg);
        else if (pkg?.owned) void openImportModal(pkg);
      });
    });
  }

  function paintMarketGrid(list) {
    const grid = document.getElementById('assetMarketGrid');
    if (!grid || !list?.length) return false;
    grid.innerHTML = list.map((pkg) => renderMarketCard(pkg)).join('');
    bindMarketGridEvents(grid, list);
    void hydrateMarketCovers(list);
    return true;
  }

  async function renderMarketplace() {
    const grid = document.getElementById('assetMarketGrid');
    if (!grid) return;
    const publishBtn = document.getElementById('assetPublishOpenBtn');
    if (publishBtn && !publishBtn.dataset.boundPublish) {
      publishBtn.dataset.boundPublish = '1';
      publishBtn.addEventListener('click', () => {
        void openPublishModal().catch((e) => {
          console.error('[assets] publish open', e);
          toast('无法打开发布窗口');
        });
      });
    }
    if (marketPackages.length) {
      paintMarketGrid(marketPackages);
    } else {
      grid.innerHTML = '<p class="panel-hint">加载资产包…</p>';
    }
