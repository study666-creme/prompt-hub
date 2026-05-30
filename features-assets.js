/**
 * 卡片资产市场 + 资产创作 + 多卡片库占位（第一步演示）
 */
(function () {
  const LS_WAREHOUSES = 'promptrepo_warehouses_v1';
  const LS_OWNED_PACKAGES = 'promptrepo_owned_packages';
  const LS_PUBLISHED_PACKAGES = 'promptrepo_published_packages';

  const EXTRA_WAREHOUSE_BY_TIER = {
    standard: 1,
    pro: 2
  };

  const MOCK_PACKAGES = [
    {
      id: 'pkg_cyber_assassin',
      title: '赛博刺客画风精品图包',
      tag: '可批量购买',
      price: 3.9,
      priceLabel: '¥3.9',
      saleType: 'bulk',
      countLabel: '约 320 张图 + 提示词',
      desc: '统一赛博刺客视觉风格，含角色、场景、武器特写与可直接复用的英文/中文提示词。适合批量出图、短视频分镜与游戏概念参考。',
      license: '购买者可将图、提示词用于任意商业用途（演示文案，正式版以购买页为准）。',
      previewTree: [
        { name: '角色', children: ['刺客女甲 · 12 张可预览', '潜行装束 · 8 张可预览', '其余 86 张 · 购买后可见'] },
        { name: '场景', children: ['霓虹 alley · 6 张可预览', '其余 120 张 · 购买后可见'] },
        { name: '提示词库', children: ['风格基底 ×1', '镜头/光效模板 ×24', '其余购买后解锁'] }
      ],
      previewThumbs: [
        { label: '刺客女甲', hue: 340 },
        { label: '霓虹 alley', hue: 200 },
        { label: '武器特写', hue: 15 },
        { label: '潜行装束', hue: 280 }
      ]
    },
    {
      id: 'pkg_character_50',
      title: '精品人设图五十张 + 设定文档',
      tag: '套装',
      price: 99,
      priceLabel: '¥99',
      saleType: 'bulk',
      countLabel: '50 张人设图 + 文档',
      desc: '五十位原创人设成品图，附人设小传、性格标签、配色与推荐提示词模板。适合视觉小说、直播皮、OC 展示与二创起点。',
      license: '购买者可将图、文档、提示词用于任意商业用途。',
      previewTree: [
        { name: '人设图', children: ['A 组 10 张可预览', 'B 组 10 张可预览', '其余 30 张 · 购买后可见'] },
        { name: '文档', children: ['人设索引.pdf（预览 3 页）', '性格/关系表（预览）', '完整版购买后下载'] }
      ],
      previewThumbs: [
        { label: '人设 A01', hue: 45 },
        { label: '人设 A08', hue: 120 },
        { label: '人设 B03', hue: 300 },
        { label: '文档预览', hue: 210 }
      ]
    },
    {
      id: 'pkg_world_starport',
      title: '原创世界观「星港纪元」完整版权包',
      tag: '仅买断',
      price: 5999,
      priceLabel: '¥5,999',
      saleType: 'buyout',
      countLabel: '400+ 精品图 + 世界观文档',
      desc: '包含星港纪元完整世界观、人设库、场景库、势力关系与参考故事大纲。一次性买断图包版权，卖家不再向他人授权（演示说明）。',
      license: '买断后购买者独占商用版权（演示文案；正式版需签署授权协议）。',
      previewTree: [
        { name: '世界观', children: ['设定总览（预览）', '年表与势力（预览）', '完整文档购买后交付'] },
        { name: '人设', children: ['主角团 6 张可预览', '其余 180+ 张购买后可见'] },
        { name: '场景', children: ['星港主站 · 8 张可预览', '其余 200+ 张购买后可见'] },
        { name: '参考故事', children: ['短篇大纲 3 则（预览）', '完整故事库购买后可见'] }
      ],
      previewThumbs: [
        { label: '星港主站', hue: 195 },
        { label: '主角团', hue: 30 },
        { label: '势力徽记', hue: 260 },
        { label: '设定预览', hue: 160 }
      ]
    }
  ];

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

  function packagesStorageKey(kind) {
    const base = kind === 'published' ? LS_PUBLISHED_PACKAGES : LS_OWNED_PACKAGES;
    return `${base}_${accountKey()}`;
  }

  function loadPackageIds(kind) {
    try {
      const raw = localStorage.getItem(packagesStorageKey(kind));
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function savePackageIds(kind, ids) {
    try {
      localStorage.setItem(packagesStorageKey(kind), JSON.stringify([...new Set(ids.map(String))]));
    } catch (e) { /* ignore */ }
  }

  function recordOwnedPackage(pkgId) {
    const ids = loadPackageIds('owned');
    if (!ids.includes(pkgId)) {
      ids.push(pkgId);
      savePackageIds('owned', ids);
    }
  }

  function recordPublishedPackage(pkgId) {
    const ids = loadPackageIds('published');
    if (!ids.includes(pkgId)) {
      ids.push(pkgId);
      savePackageIds('published', ids);
    }
  }

  function renderMyHomePackages(container, kind) {
    if (!container) return;
    const ids = loadPackageIds(kind);
    const list = ids.map((id) => MOCK_PACKAGES.find((p) => p.id === id)).filter(Boolean);
    if (!list.length) {
      container.innerHTML =
        kind === 'published'
          ? '<div class="feature-empty"><p>暂无发布的资产包</p><p class="panel-hint">在「卡片资产」购买或发布资产包后，会显示在这里。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>'
          : '<div class="feature-empty"><p>暂无拥有的资产包</p><p class="panel-hint">在「卡片资产」购买资产包后，会显示在这里。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>';
      return;
    }
    container.innerHTML = `<div class="my-home-package-grid">${list
      .map(
        (pkg) => `<article class="asset-market-card my-home-package-card" data-pkg-id="${esc(pkg.id)}">
        <div class="asset-market-card-cover" style="--asset-hue:${pkg.previewThumbs[0]?.hue || 200}"><span class="asset-market-card-tag">${esc(pkg.tag)}</span></div>
        <div class="asset-market-card-body">
          <h3 class="asset-market-card-title">${esc(pkg.title)}</h3>
          <p class="asset-market-card-meta">${esc(pkg.countLabel)}</p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="preview">查看</button>
        </div>
      </article>`
      )
      .join('')}</div>`;
    container.querySelectorAll('[data-action="preview"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-pkg-id]')?.dataset?.pkgId;
        if (id) openPackagePreview(id);
      });
    });
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

  function renderMarketplace() {
    const grid = document.getElementById('assetMarketGrid');
    if (!grid) return;
    grid.innerHTML = MOCK_PACKAGES.map((pkg) => {
      const buyout = pkg.saleType === 'buyout';
      return `
        <article class="asset-market-card" data-pkg-id="${esc(pkg.id)}">
          <div class="asset-market-card-cover" style="--asset-hue:${pkg.previewThumbs[0]?.hue || 200}">
            <span class="asset-market-card-tag">${esc(pkg.tag)}</span>
          </div>
          <div class="asset-market-card-body">
            <h3 class="asset-market-card-title">${esc(pkg.title)}</h3>
            <p class="asset-market-card-meta">${esc(pkg.countLabel)}</p>
            <p class="asset-market-card-desc">${esc(pkg.desc)}</p>
            <p class="asset-market-card-license">${esc(pkg.license)}</p>
            <div class="asset-market-card-foot">
              <span class="asset-market-price">${esc(pkg.priceLabel)}${buyout ? ' <em>买断</em>' : ''}</span>
              <div class="asset-market-card-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-action="preview">预览结构</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="publish-demo">发布（演示）</button>
                <button type="button" class="btn btn-primary btn-sm" data-action="buy">${buyout ? '买断（演示）' : '购买（演示）'}</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.asset-market-card').forEach((card) => {
      const id = card.dataset.pkgId;
      card.querySelector('[data-action="preview"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPackagePreview(id);
      });
      card.querySelector('[data-action="buy"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        fakePurchase(id);
      });
      card.querySelector('[data-action="publish-demo"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        fakePublish(id);
      });
    });
  }

  function fakePublish(id) {
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      toast('发布资产包需先登录');
      window.openAuthModal?.();
      return;
    }
    const pkg = MOCK_PACKAGES.find((p) => p.id === id);
    if (!pkg) return;
    recordPublishedPackage(id);
    toast(`「${pkg.title}」已加入你发布的资产包（演示）`, 5000);
  }

  function fakePurchase(id) {
    const pkg = MOCK_PACKAGES.find((p) => p.id === id);
    if (!pkg) return;
    recordOwnedPackage(id);
    toast(`「${pkg.title}」已加入你的资产包（演示，未扣款）`, 5000);
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

  function openPackagePreview(id) {
    const pkg = MOCK_PACKAGES.find((p) => p.id === id);
    const overlay = document.getElementById('assetPreviewOverlay');
    const body = document.getElementById('assetPreviewBody');
    if (!pkg || !overlay || !body) return;
    const thumbs = pkg.previewThumbs
      .map(
        (t) =>
          `<div class="asset-preview-thumb" style="--asset-hue:${t.hue}"><span>${esc(t.label)}</span><em>可预览</em></div>`
      )
      .join('');
    body.innerHTML = `
      <header class="asset-preview-head">
        <div>
          <p class="asset-preview-tag">${esc(pkg.tag)} · ${esc(pkg.countLabel)}</p>
          <h3 id="assetPreviewTitle">${esc(pkg.title)}</h3>
          <p class="asset-preview-price">${esc(pkg.priceLabel)}</p>
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
          <div class="asset-preview-thumbs">${thumbs}</div>
          <p class="panel-hint">其余内容购买后解锁；正式版将支持真实缩略图与文档预览。</p>
        </section>
      </div>
      <footer class="asset-preview-foot">
        <p>${esc(pkg.license)}</p>
        <button type="button" class="btn btn-primary btn-sm" id="assetPreviewBuyBtn">${pkg.saleType === 'buyout' ? '买断（演示）' : '购买（演示）'}</button>
      </footer>`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    document.getElementById('assetPreviewClose')?.addEventListener('click', closePackagePreview);
    overlay.onclick = (e) => {
      if (e.target === overlay) closePackagePreview();
    };
    document.getElementById('assetPreviewBuyBtn')?.addEventListener('click', () => {
      fakePurchase(id);
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePackagePreview();
    });
  }

  function onAppChange(app) {
    if (app === 'assetmarket') renderMarketplace();
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
    getActiveWarehouseId,
    getWarehouseById,
    filterCardsByWarehouse,
    cardWarehouseId,
    countWarehouseCards,
    getOtherWarehouses,
    moveCardsToWarehouse,
    updateWarehouseTitle,
    recordOwnedPackage,
    recordPublishedPackage,
    listWarehousesForAccount,
    getMainSiteCardsForWarehouse,
    loadWarehouseStore,
    renderMyHomePackages,
    openPackagePreview,
    closePackagePreview
  };
})();
