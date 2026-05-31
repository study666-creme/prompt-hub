/**
 * 卡片资产市场 + 资产创作 + 多卡片库
 */
(function () {
  const LS_WAREHOUSES = 'promptrepo_warehouses_v1';

  let marketPackages = [];
  let marketLoading = false;

  const EXTRA_WAREHOUSE_BY_TIER = {
    standard: 1,
    pro: 2
  };

  const MOCK_PACKAGES = [];

  function normalizePackage(pkg) {
    if (!pkg) return null;
    return {
      id: pkg.id,
      title: pkg.title || '',
      tag: pkg.tag || '免费',
      price: (Number(pkg.priceCents) || 0) / 100,
      priceCents: Number(pkg.priceCents) || 0,
      priceLabel: pkg.priceLabel || (pkg.priceCents ? `¥${(pkg.priceCents / 100).toFixed(2)}` : '免费'),
      saleType: pkg.saleType === 'buyout' ? 'buyout' : 'bulk',
      countLabel: pkg.countLabel || '',
      cardCount: Number(pkg.cardCount) || 0,
      desc: pkg.description || pkg.desc || '',
      license: pkg.license || '',
      commercialUseAllowed: pkg.commercialUseAllowed !== false,
      previewTree: Array.isArray(pkg.previewTree) ? pkg.previewTree : [],
      previewThumbs: Array.isArray(pkg.previewThumbs) ? pkg.previewThumbs : [],
      previewImages: Array.isArray(pkg.previewImages) ? pkg.previewImages : [],
      authorId: pkg.authorId,
      authorName: pkg.authorName || '',
      owned: !!pkg.owned,
      isAuthor: !!pkg.isAuthor
    };
  }

  function renderStackCover(pkg) {
    const tag = pkg.tag || '免费';
    const imgs = (pkg.previewImages || []).filter((p) => p?.imageUrl).slice(0, 4);
    const hue = pkg.previewThumbs?.[0]?.hue || 200;
    if (!imgs.length) {
      return `<div class="asset-market-card-cover asset-stack-cover asset-stack-cover--empty" style="--asset-hue:${hue}">
        <span class="asset-market-card-tag">${esc(tag)}</span>
      </div>`;
    }
    const layers = imgs
      .map(
        (p, i) =>
          `<img class="asset-stack-layer asset-stack-layer--${i}" src="${esc(p.imageUrl)}" alt="" loading="lazy" draggable="false">`
      )
      .join('');
    return `<div class="asset-market-card-cover asset-stack-cover">
      <div class="asset-stack-inner">${layers}</div>
      <span class="asset-market-card-tag">${esc(tag)}</span>
    </div>`;
  }

  function commercialBadge(pkg) {
    return pkg.commercialUseAllowed
      ? '<span class="asset-commercial-tag asset-commercial-tag--yes">可商用</span>'
      : '<span class="asset-commercial-tag asset-commercial-tag--no">仅个人使用</span>';
  }

  async function refreshMarketPackages() {
    if (!window.PromptHubApi?.listAssetPackages) {
      marketPackages = MOCK_PACKAGES.map(normalizePackage).filter(Boolean);
      return marketPackages;
    }
    marketLoading = true;
    try {
      const r = await window.PromptHubApi.listAssetPackages();
      if (r.ok && Array.isArray(r.data?.items)) {
        marketPackages = r.data.items.map(normalizePackage).filter(Boolean);
      } else if (/DB_MIGRATION|asset_packages/i.test(String(r.message || ''))) {
        marketPackages = [];
        toast('资产包功能需先在 Supabase 运行迁移 SQL', 6000);
      } else {
        marketPackages = MOCK_PACKAGES.map(normalizePackage).filter(Boolean);
      }
    } catch (e) {
      marketPackages = MOCK_PACKAGES.map(normalizePackage).filter(Boolean);
    } finally {
      marketLoading = false;
    }
    return marketPackages;
  }

  function findPackage(id) {
    return marketPackages.find((p) => p.id === id) || null;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, ms) {
    if (typeof window.showToast === 'function') window.showToast(msg, ms || 4000);
    else alert(msg);
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
    return EXTRA_WAREHOUSE_BY_TIER[tier] || 0;
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

  async function renderMyHomePackages(container, kind) {
    if (!container) return;
    container.innerHTML = '<p class="panel-hint">加载中…</p>';
    const list = await fetchMyPackages(kind);
    if (!list.length) {
      container.innerHTML =
        kind === 'published'
          ? '<div class="feature-empty"><p>暂无发布的资产包</p><p class="panel-hint">在「卡片资产」页点击「发布资产包」上架你的免费或付费包。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>'
          : '<div class="feature-empty"><p>暂无拥有的资产包</p><p class="panel-hint">在「卡片资产」领取免费包或购买后，会显示在这里。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>';
      return;
    }
    container.innerHTML = `<div class="my-home-package-grid">${list
      .map(
        (pkg) => `<article class="asset-market-card my-home-package-card" data-pkg-id="${esc(pkg.id)}">
        ${renderStackCover(pkg)}
        <div class="asset-market-card-body">
          <h3 class="asset-market-card-title">${esc(pkg.title)}</h3>
          <p class="asset-market-card-meta">${esc(pkg.countLabel)} · ${esc(pkg.priceLabel)}</p>
          <p class="asset-market-card-meta">${commercialBadge(pkg)}</p>
          <div class="asset-market-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="preview">查看</button>
            ${kind === 'owned' ? '<button type="button" class="btn btn-primary btn-sm" data-action="import">导入卡片库</button>' : ''}
            ${kind === 'published' ? '<button type="button" class="btn btn-ghost btn-sm asset-pack-archive-btn" data-action="archive">下架删除</button>' : ''}
          </div>
        </div>
      </article>`
      )
      .join('')}</div>`;
    container.querySelectorAll('[data-action="preview"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) openPackagePreview(pkg);
      });
    });
    container.querySelectorAll('[data-action="import"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        const pkg = list.find((p) => p.id === id);
        if (pkg) void openImportModal(pkg);
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

  async function archivePublishedPackage(pkg, container, kind) {
    const ok = window.confirm(`下架「${pkg.title}」？\n\n市场将不再展示；已领取用户仍保留。旧版空包可下架后重新发布带卡片的新包。`);
    if (!ok) return;
    if (!window.PromptHubApi?.updateAssetPackage) {
      toast('API 未就绪');
      return;
    }
    const r = await window.PromptHubApi.updateAssetPackage(pkg.id, { status: 'archived' });
    if (!r?.ok) {
      toast(r?.message || '下架失败');
      return;
    }
    toast('已下架');
    closePackagePreview();
    await refreshMarketPackages();
    const publishedPane = container || document.getElementById('myHomePublishedPackages');
    if (publishedPane) void renderMyHomePackages(publishedPane, kind || 'published');
    void renderMarketplace();
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
    if (!limit) {
      const hint =
        tier === 'lite' || tier === 'basic'
          ? '当前会员档不含额外卡片库。标准版可创建 1 个，专业版可创建 2 个。'
          : '创建额外卡片库需要标准版或专业版会员。';
      toast(hint, 5500);
      if (typeof window.openSubscribePanel === 'function') {
        setTimeout(() => window.openSubscribePanel(), 600);
      }
      return;
    }
    const store = loadWarehouseStore();
    const extra = countExtraWarehouses(store);
    if (extra >= limit) {
      toast(`已达上限：专业版最多 2 个额外库，标准版 1 个。当前已创建 ${extra} 个。`, 5000);
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
    toast(`已创建卡片库「${name}」，当前库为空，可将卡片移入或在此新建`);
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
    grid.innerHTML = '<p class="panel-hint">加载资产包…</p>';
    await refreshMarketPackages();
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
    grid.innerHTML = marketPackages.map((pkg) => {
      const buyout = pkg.saleType === 'buyout';
      const owned = pkg.owned;
      const isFree = !pkg.priceCents;
      const buyLabel = owned ? '已拥有' : isFree ? '免费领取' : buyout ? '买断' : '购买';
      const buyClass = owned ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';
      const buyDisabled = owned ? ' disabled' : '';
      return `
        <article class="asset-market-card" data-pkg-id="${esc(pkg.id)}">
          ${renderStackCover(pkg)}
          <div class="asset-market-card-body">
            <p class="asset-market-card-author">${esc(pkg.authorName || '作者')}</p>
            <h3 class="asset-market-card-title">${esc(pkg.title)}</h3>
            <p class="asset-market-card-meta">${esc(pkg.countLabel)}</p>
            <p class="asset-market-card-meta">${commercialBadge(pkg)}</p>
            <p class="asset-market-card-desc">${esc(pkg.desc)}</p>
            <p class="asset-market-card-license">${esc(pkg.license)}</p>
            <div class="asset-market-card-foot">
              <span class="asset-market-price">${esc(pkg.priceLabel)}${buyout ? ' <em>买断</em>' : ''}</span>
              <div class="asset-market-card-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-action="preview">预览结构</button>
                <button type="button" class="${buyClass}" data-action="buy"${buyDisabled}>${buyLabel}</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.asset-market-card').forEach((card) => {
      const id = card.dataset.pkgId;
      const pkg = findPackage(id);
      card.querySelector('[data-action="preview"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pkg) openPackagePreview(pkg);
      });
      card.querySelector('[data-action="buy"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pkg && !pkg.owned) void claimPackage(pkg);
      });
    });
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
    void openImportModal(pkg, { skipClaimCheck: true });
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
    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <h3 id="assetImportTitle">导入「${esc(pkg.title)}」</h3>
          <p class="panel-hint">将包内 ${esc(pkg.countLabel || `${pkg.cardCount || ''} 张`)} 复制到你的卡片库，或下载 JSON 自行导入。</p>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetImportClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <div class="asset-import-body">
        <label>导入到卡片库
          <select class="settings-input" id="assetImportWarehouse">${whOptions}</select>
        </label>
        <div class="asset-import-actions">
          <button type="button" class="btn btn-primary" id="assetImportDoBtn">导入到所选库</button>
          <button type="button" class="btn btn-secondary" id="assetImportJsonBtn">下载 JSON 文件</button>
        </div>
        <p class="panel-hint" id="assetImportStatus"></p>
      </div>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    const close = () => {
      overlay.classList.remove('active');
      overlay.classList.add('hidden');
      overlay.onclick = null;
    };
    document.getElementById('assetImportClose')?.addEventListener('click', close);
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    document.getElementById('assetImportJsonBtn')?.addEventListener('click', () => void downloadPackageJson(pkg));
    document.getElementById('assetImportDoBtn')?.addEventListener('click', () => {
      const wh = document.getElementById('assetImportWarehouse')?.value || 'default';
      void importPackageToWarehouse(pkg, wh);
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

  async function importPackageToWarehouse(pkg, warehouseId) {
    const btn = document.getElementById('assetImportDoBtn');
    const status = document.getElementById('assetImportStatus');
    if (btn) btn.disabled = true;
    if (status) status.textContent = '正在导入…';
    const r = await window.PromptHubApi.importAssetPackage(pkg.id, warehouseId);
    if (btn) btn.disabled = false;
    if (!r?.ok) {
      const msg = r?.message || '导入失败';
      if (status) status.textContent = msg;
      toast(msg);
      return;
    }
    const n = r.data?.imported || 0;
    if (status) status.textContent = `已导入 ${n} 张卡片`;
    toast(`已导入 ${n} 张卡片到所选库`);
    if (window.SupabaseSync?.pullCloudData) {
      await window.SupabaseSync.pullCloudData();
    }
    if (typeof window.refreshWarehouseUI === 'function') {
      window.refreshWarehouseUI({ softCards: false });
    }
    renderWarehouseSidebar();
  }

  function cardPickerThumb(card) {
    const img = card?.image;
    if (img && /^data:|^https?:\/\//i.test(img)) return img;
    if (img && window.SupabaseSync?.getCachedDisplayUrl) {
      const cached = window.SupabaseSync.getCachedDisplayUrl(img);
      if (cached) return cached;
    }
    return '';
  }

  async function resolveCardThumbs(cards) {
    const out = new Map();
    await Promise.all(
      cards.map(async (c) => {
        let url = cardPickerThumb(c);
        if (!url && c.image && window.SupabaseSync?.resolveDisplayUrl) {
          try {
            url = await window.SupabaseSync.resolveDisplayUrl(c.image);
          } catch (e) {
            url = '';
          }
        }
        out.set(c.id, url);
      })
    );
    return out;
  }

  function renderPublishCardPicker(warehouseId, selectedIds, previewIds, thumbMap) {
    const cards = getMainSiteCardsForWarehouse(warehouseId);
    if (!cards.length) {
      return '<p class="panel-hint">该库暂无卡片，请先在卡片库添加或切换其他库。</p>';
    }
    return `<div class="asset-publish-card-grid">${cards
      .map((c) => {
        const checked = selectedIds.has(c.id) ? ' checked' : '';
        const previewOn = previewIds.has(c.id) ? ' checked' : '';
        const disabledPreview = selectedIds.has(c.id) ? '' : ' disabled';
        const thumb = thumbMap.get(c.id) || '';
        const label = (c.title || c.prompt || '未命名').slice(0, 36);
        return `<div class="asset-publish-card-item" data-card-id="${esc(c.id)}">
          <input type="checkbox" class="asset-publish-card-check" data-role="include"${checked}>
          <div class="asset-publish-card-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<span class="asset-publish-card-noimg">无图</span>'}</div>
          <span class="asset-publish-card-label">${esc(label)}</span>
          <label class="asset-publish-preview-check"><input type="checkbox" data-role="preview"${previewOn}${disabledPreview}> 公开预览</label>
        </div>`;
      })
      .join('')}</div>`;
  }

  async function openPublishModal() {
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('发布资产包需先登录');
      window.openAuthModal?.();
      return;
    }
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
    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <h3 id="assetPublishTitle">发布资产包</h3>
          <p class="panel-hint">从卡片库勾选要打包的卡片，并标记公开预览图（市场封面层叠展示）。</p>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetPublishClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <form class="asset-publish-form" id="assetPublishForm">
        <label>标题 <input class="settings-input" name="title" maxlength="120" required placeholder="例如：精品人设包 30 张"></label>
        <label>简介 <textarea class="settings-input" name="description" rows="2" maxlength="2000" placeholder="说明包内有什么、适合什么用途"></textarea></label>
        <div class="asset-publish-row">
          <label>价格（元，0=免费） <input class="settings-input" name="priceYuan" type="number" min="0" step="0.01" value="0"></label>
          <label>标签 <input class="settings-input" name="tag" maxlength="40" placeholder="免费 / 套装"></label>
        </div>
        <label class="asset-publish-check">
          <input type="checkbox" name="commercialUseAllowed" checked>
          <span>购买者可商用</span>
        </label>
        <div class="asset-publish-cards-section">
          <div class="asset-publish-cards-head">
            <label>来源卡片库 <select class="settings-input" id="assetPublishWarehouse">${whOptions}</select></label>
            <span class="panel-hint" id="assetPublishCardCount">已选 0 张</span>
          </div>
          <div id="assetPublishCardPicker"><p class="panel-hint">加载卡片…</p></div>
        </div>
        <footer class="asset-preview-foot">
          <button type="submit" class="btn btn-primary">发布上架</button>
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
      const cards = getMainSiteCardsForWarehouse(wid);
      const thumbMap = await resolveCardThumbs(cards);
      if (pickerEl) {
        pickerEl.innerHTML = renderPublishCardPicker(wid, selectedIds, previewIds, thumbMap);
        bindPickerEvents();
      }
      if (countEl) countEl.textContent = `已选 ${selectedIds.size} 张`;
    }

    function bindPickerEvents() {
      pickerEl?.querySelectorAll('.asset-publish-card-item').forEach((row) => {
        const id = row.dataset.cardId;
        const include = row.querySelector('[data-role="include"]');
        const preview = row.querySelector('[data-role="preview"]');
        include?.addEventListener('change', () => {
          if (include.checked) selectedIds.add(id);
          else {
            selectedIds.delete(id);
            previewIds.delete(id);
          }
          if (preview) {
            preview.disabled = !include.checked;
            if (!include.checked) preview.checked = false;
          }
          if (countEl) countEl.textContent = `已选 ${selectedIds.size} 张`;
        });
        preview?.addEventListener('change', () => {
          if (preview.checked) previewIds.add(id);
          else previewIds.delete(id);
        });
      });
    }

    whSelect?.addEventListener('change', () => {
      selectedIds.clear();
      previewIds.clear();
      void refreshPicker();
    });

    await refreshPicker();

    document.getElementById('assetPublishForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitPublishForm(e.target, { selectedIds, previewIds, warehouseId: whSelect?.value || whId });
    });
    } catch (e) {
      console.error('[assets] openPublishModal failed', e);
      toast('打开发布窗口失败，请刷新页面后重试');
      closePublishModal();
    }
  }

  function closePublishModal() {
    const overlay = document.getElementById('assetPublishOverlay');
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
    const warehouseId = ctx?.warehouseId || getActiveWarehouseId();
    const warehouse = getWarehouseById(warehouseId);
    const allCards = getMainSiteCardsForWarehouse(warehouseId);
    const cards = allCards
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({
        id: c.id,
        title: c.title || '',
        prompt: c.prompt || '',
        image: c.image || null,
        group: c.group || null,
        tags: Array.isArray(c.tags) ? c.tags : []
      }));
    const previewCardIds = [...(ctx?.previewIds || [])].filter((id) => selectedIds.has(id));
    const priceYuan = Math.max(0, Number(fd.get('priceYuan')) || 0);
    const priceCents = Math.round(priceYuan * 100);
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
      cards
    };
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    const r = await window.PromptHubApi.publishAssetPackage(payload);
    if (btn) btn.disabled = false;
    if (!r?.ok) {
      toast(r?.message || '发布失败');
      return;
    }
    toast(`「${title}」已上架（${cards.length} 张）`);
    closePublishModal();
    await refreshMarketPackages();
    void renderMarketplace();
  }

  function renderPreviewTree(nodes, depth) {
    return (nodes || [])
      .map((node) => {
        if (node.children) {
          return `<li class="asset-tree-branch"><span class="asset-tree-folder">${esc(node.name)}</span><ul>${renderPreviewTree(node.children.map((c) => (typeof c === 'string' ? { name: c } : c)), depth + 1)}</ul></li>`;
        }
        return `<li class="asset-tree-leaf">${esc(node.name)}</li>`;
      })
      .join('');
  }

  function openPackagePreview(pkgOrId) {
    const pkg = typeof pkgOrId === 'object' ? normalizePackage(pkgOrId) : findPackage(pkgOrId);
    const overlay = document.getElementById('assetPreviewOverlay');
    const body = document.getElementById('assetPreviewBody');
    if (!pkg || !overlay || !body) return;
    const previewImgs = (pkg.previewImages || []).filter((p) => p?.imageUrl);
    const thumbs = previewImgs.length
      ? previewImgs
          .map(
            (t) =>
              `<div class="asset-preview-thumb asset-preview-thumb--img"><img src="${esc(t.imageUrl)}" alt="${esc(t.label)}" loading="lazy"><span>${esc(t.label)}</span></div>`
          )
          .join('')
      : (pkg.previewThumbs || [])
          .map(
            (t) =>
              `<div class="asset-preview-thumb" style="--asset-hue:${t.hue || 200}"><span>${esc(t.label)}</span><em>可预览</em></div>`
          )
          .join('');
    const buyout = pkg.saleType === 'buyout';
    const owned = pkg.owned;
    const isFree = !pkg.priceCents;
    const buyLabel = owned ? '已拥有' : isFree ? '免费领取' : buyout ? '买断' : '购买';
    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <p class="asset-preview-tag">${esc(pkg.tag)} · ${esc(pkg.countLabel)} · ${esc(pkg.authorName || '')}</p>
          <h3 id="assetPreviewTitle">${esc(pkg.title)}</h3>
          <p class="asset-preview-price">${esc(pkg.priceLabel)} ${commercialBadge(pkg)}</p>
        </div>
        <button type="button" class="modal-close-btn modal-close-btn--icon" id="assetPreviewClose" aria-label="关闭"><span aria-hidden="true">×</span></button>
      </header>
      <div class="asset-preview-layout">
        <section class="asset-preview-section">
          <h4>仓库结构（购买前可浏览）</h4>
          <ul class="asset-preview-tree">${renderPreviewTree(pkg.previewTree, 0)}</ul>
        </section>
        <section class="asset-preview-section">
          <h4>卖家开放预览的样图</h4>
          <div class="asset-preview-thumbs">${thumbs || '<p class="panel-hint">作者尚未上传预览图</p>'}</div>
        </section>
      </div>
      <footer class="asset-preview-foot">
        <p>${esc(pkg.license)}</p>
        <div class="asset-preview-foot-actions">
          ${owned ? '<button type="button" class="btn btn-secondary btn-sm" id="assetPreviewImportBtn">导入卡片库</button>' : ''}
          ${pkg.isAuthor ? '<button type="button" class="btn btn-ghost btn-sm" id="assetPreviewArchiveBtn">下架删除</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" id="assetPreviewBuyBtn"${owned ? ' disabled' : ''}>${buyLabel}</button>
        </div>
      </footer>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    document.getElementById('assetPreviewClose')?.addEventListener('click', closePackagePreview);
    overlay.onclick = (e) => {
      if (e.target === overlay) closePackagePreview();
    };
    document.getElementById('assetPreviewBuyBtn')?.addEventListener('click', () => {
      if (!owned) void claimPackage(pkg);
    });
    document.getElementById('assetPreviewImportBtn')?.addEventListener('click', () => {
      void openImportModal(pkg);
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
          <h2>资产创作</h2>
          <div class="asset-studio-launch-actions">
            <button type="button" class="btn btn-primary" id="assetStudioOpenBtn">进入创作工作台</button>
            <button type="button" class="btn btn-secondary" id="assetStudioExportBtn">打开并同步卡片库</button>
          </div>
        </header>
        <p class="community-inline-hint">全屏写作台：拖入卡片关联文档、悬浮查看设定、右侧可生图。与主站卡片库实时联动。</p>
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

  function onAppChange(app) {
    if (app === 'assetmarket') void renderMarketplace();
    if (app === 'warehouse') renderWarehouseSidebar();
  }

  function init() {
    const saved = localStorage.getItem('promptrepo_app_page');
    if (saved === 'assetstudio' && !/\/asset-studio\.html$/i.test(window.location.pathname || '')) {
      window.location.href = 'asset-studio.html';
      return;
    }
    bindUI();
    renderWarehouseSidebar();
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
    openPublishModal,
    closePublishModal,
    openImportModal,
    playOpenPackAnimation
  };
})();
