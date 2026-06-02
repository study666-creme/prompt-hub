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

  const DEMO_FEATURED_PACKAGE = {
    id: '__demo_featured_system__',
    title: '精选体系 · 完整世界观剧本包',
    tag: '精选体系',
    featured: true,
    packUi: 'heavy',
    isDemo: true,
    priceCents: 3999900,
    priceLabel: '¥39999',
    saleType: 'bulk',
    countLabel: '216 张设定卡 + 5 万字文档',
    description:
      '拥有完整剧本三万字加世界观文档两万字，重要人物设定卡14张，配角形象卡103张，怪物形象卡43张，场景卡56张，均已关联资产创作文档，导入即用，关系一目了然，设定剧情微调无障碍。提示词和图片均为自己创作，无任何版权风险，购买即拥有该图包卡片文档商用版权。如预览图无法下定决断，可联系本人商议更多信息。',
    license:
      '本包为平台结构演示，非真实售卖；展开可预览文件夹与目录组织方式，正式内容以作者交付为准。',
    commercialUseAllowed: true,
    authorName: 'Prompt Hub 演示',
    previewTree: [
      { name: '重要人物设定', cardCount: 14, previewCardIds: [] },
      { name: '配角形象', cardCount: 103, previewCardIds: [] },
      { name: '怪物形象', cardCount: 43, previewCardIds: [] },
      { name: '场景卡', cardCount: 56, previewCardIds: [] },
      { name: '完整剧本', cardCount: 1, previewCardIds: [] },
      { name: '世界观文档', cardCount: 1, previewCardIds: [] }
    ],
    previewThumbs: [{ label: '精选', hue: 28 }],
    previewImages: [],
    cardCount: 216,
    owned: false,
    isAuthor: false
  };

  function getDemoPackages() {
    return [normalizePackage(DEMO_FEATURED_PACKAGE)].filter(Boolean);
  }

  function getCurrentUserId() {
    try {
      return (
        window.SupabaseSync?.getUser?.()?.id ||
        window.SupabaseSync?.user?.id ||
        window.__authUserId ||
        null
      );
    } catch {
      return null;
    }
  }

  function resolvePackUi(pkg) {
    if (pkg?.packUi === 'heavy' || pkg?.packUi === 'light') return pkg.packUi;
    if (pkg?.isDemo || pkg?.featured || String(pkg?.tag || '').includes('精选体系')) return 'heavy';
    return 'light';
  }

  function sortMarketPackages(list) {
    const uid = getCurrentUserId();
    return [...(list || [])].sort((a, b) => {
      const aMine = uid && String(a.authorId) === String(uid);
      const bMine = uid && String(b.authorId) === String(uid);
      if (aMine !== bMine) return aMine ? -1 : 1;
      const ad = Date.parse(a.createdAt || '') || 0;
      const bd = Date.parse(b.createdAt || '') || 0;
      return bd - ad;
    });
  }

  function mergeMarketPackageList(items) {
    const demos = getDemoPackages();
    const rest = sortMarketPackages((items || []).filter((p) => p && p.id !== DEMO_FEATURED_PACKAGE.id));
    return [...rest, ...demos];
  }

  const PACK_CARD_MAX = 500;
  const PACK_FOLDER_PREVIEW_MAX = 5;

  function newPackFolderId() {
    return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function sanitizePackCardForPublish(c) {
    let image = c.image != null ? String(c.image) : null;
    if (image) {
      if (window.SupabaseSync?.isDataUrl?.(image)) image = null;
      else if (image.length > 8000) image = image.slice(0, 8000);
    }
    let prompt = String(c.prompt || '');
    if (prompt.length > 8000) prompt = prompt.slice(0, 8000);
    return {
      id: c.id,
      title: String(c.title || '').slice(0, 200),
      prompt,
      image,
      group: c.group || null,
      tags: Array.isArray(c.tags) ? c.tags.slice(0, 12) : []
    };
  }

  function buildPackFoldersFromLibraryGroups(warehouseId) {
    const groups = loadGroupsForWarehouse(warehouseId).filter((g) => g && g !== '未分类');
    if (!groups.length) {
      return [{ id: newPackFolderId(), name: '文件夹 1', cardIds: new Set(), previewIds: new Set() }];
    }
    return groups.map((name) => ({ id: newPackFolderId(), name, cardIds: new Set(), previewIds: new Set() }));
  }

  function syncPackFolderAssignments(packFolders, cards) {
    packFolders.forEach((f) => f.cardIds.clear());
    cards.forEach((c) => {
      const g = String(c.group || '').trim() || '未分类';
      const folder = packFolders.find((f) => f.name === g);
      if (folder) folder.cardIds.add(c.id);
    });
  }

  function assignCardToPackFolder(packFolders, cardId, folderId) {
    packFolders.forEach((f) => {
      f.cardIds.delete(cardId);
      f.previewIds.delete(cardId);
    });
    if (folderId) {
      const f = packFolders.find((x) => x.id === folderId);
      if (f) f.cardIds.add(cardId);
    }
  }

  function syncPackFolderNamesFromDom(packEditor, root) {
    if (!packEditor || !root) return;
    root.querySelectorAll('.asset-publish-custom-folder').forEach((row) => {
      const fid = row.dataset.folderId;
      const input = row.querySelector('.asset-publish-folder-rename');
      const f = packEditor.folders?.find((x) => x.id === fid);
      if (f && input) {
        const next = String(input.value || '').trim().slice(0, 40);
        if (next) f.name = next;
      }
    });
    root.querySelectorAll('.asset-publish-folder-rename-inline').forEach((input) => {
      const val = String(input.value || '').trim().slice(0, 40);
      const fid = input.dataset.folderId || '';
      const key = input.dataset.folderKey || '';
      if (packEditor.mode === 'custom' && fid && fid !== '_unassigned') {
        const f = packEditor.folders?.find((x) => x.id === fid);
        if (f && val) f.name = val;
      } else if (key && val) {
        packEditor.folderRenames = packEditor.folderRenames || {};
        packEditor.folderRenames[key] = val;
      }
    });
  }

  function resolvePackCardGroup(c, packEditor) {
    if (packEditor.mode === 'custom') {
      const folder = packEditor.folders?.find((f) => f.cardIds.has(c.id));
      return folder?.name || null;
    }
    const key = String(c.group || '').trim() || '未分类';
    const renamed = packEditor.folderRenames?.[key];
    if (renamed) return renamed === '未分类' ? null : renamed;
    return c.group || null;
  }

  function buildPreviewTreeForPack(cards, packFolders, mode, previewIds) {
    if (mode === 'custom' && packFolders?.length) {
      return packFolders
        .filter((f) => cards.some((c) => f.cardIds.has(c.id)))
        .map((f) => {
          const folderCards = cards.filter((c) => f.cardIds.has(c.id));
          return {
            name: f.name,
            cardCount: folderCards.length,
            previewCardIds: folderCards
              .filter((c) => f.previewIds.has(c.id))
              .slice(0, PACK_FOLDER_PREVIEW_MAX)
              .map((c) => c.id)
          };
        });
    }
    const grouped = groupCardsByFolder(cards, []);
    const pids = previewIds instanceof Set ? previewIds : new Set();
    return grouped
      .filter((g) => g.cards.length)
      .map((g) => ({
        name: g.name,
        cardCount: g.cards.length,
        previewCardIds: g.cards
          .filter((c) => pids.has(c.id))
          .slice(0, PACK_FOLDER_PREVIEW_MAX)
          .map((c) => c.id)
      }));
  }

  function collectPreviewCardIds(packFolders, previewIds, mode) {
    if (mode === 'custom' && packFolders?.length) {
      const ids = [];
      packFolders.forEach((f) => {
        [...f.previewIds].slice(0, PACK_FOLDER_PREVIEW_MAX).forEach((id) => {
          if (!ids.includes(id)) ids.push(id);
        });
      });
      return ids.slice(0, 60);
    }
    return [...previewIds].slice(0, 60);
  }

  function renderPackFolderToolbar(packEditor, warehouseId) {
    const mode = packEditor.mode || 'library';
    return `<div class="asset-publish-mode-bar">
      <span class="panel-hint">打包结构</span>
      <div class="asset-publish-mode-segment" role="radiogroup" aria-label="打包结构">
        <label class="asset-publish-mode-opt"><input type="radio" name="packLayoutMode" value="library"${mode === 'library' ? ' checked' : ''}><span>按卡片库分组</span></label>
        <label class="asset-publish-mode-opt"><input type="radio" name="packLayoutMode" value="custom"${mode === 'custom' ? ' checked' : ''}><span>自定义文件夹</span></label>
      </div>
      <span class="asset-publish-mode-actions${mode === 'custom' ? '' : ' hidden'}" id="assetPublishCustomActions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="import-groups">导入卡片库分组</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="add-folder">新建文件夹</button>
      </span>
      <span class="panel-hint">单包最多 ${PACK_CARD_MAX} 张 · 每文件夹最多 ${PACK_FOLDER_PREVIEW_MAX} 张公开预览</span>
    </div>`;
  }

  function renderPackCustomFolderList(packFolders) {
    if (!packFolders?.length) return '';
    return `<div class="asset-publish-custom-folders">${packFolders
      .map(
        (f) =>
          `<div class="asset-publish-custom-folder" data-folder-id="${esc(f.id)}">
        <input type="text" class="settings-input asset-publish-folder-rename" value="${esc(f.name)}" maxlength="40" placeholder="文件夹名">
        <span class="panel-hint">${f.cardIds.size} 张 · 预览 ${Math.min(f.previewIds.size, PACK_FOLDER_PREVIEW_MAX)}/${PACK_FOLDER_PREVIEW_MAX}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="pick-folder-cards" data-folder-id="${esc(f.id)}">选卡入夹</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="remove-folder" title="删除文件夹">删除</button>
      </div>`
      )
      .join('')}</div>`;
  }

  function normalizePackage(pkg) {
    if (!pkg) return null;
    const normalized = {
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
      previewCardIds: Array.isArray(pkg.previewCardIds) ? pkg.previewCardIds.map(String) : [],
      authorId: pkg.authorId,
      authorName: pkg.authorName || '',
      owned: !!pkg.owned,
      isAuthor: !!pkg.isAuthor,
      featured: !!pkg.featured || String(pkg.tag || '').includes('精选体系'),
      isDemo: !!pkg.isDemo,
      createdAt: pkg.createdAt || ''
    };
    normalized.packUi = pkg.packUi === 'heavy' || pkg.packUi === 'light' ? pkg.packUi : resolvePackUi(normalized);
    return normalized;
  }

  function renderCoverTag(pkg) {
    const tag = pkg.tag || '免费';
    const featured = pkg.featured;
    return featured
      ? `<span class="asset-market-card-tag asset-market-card-tag--featured">${esc(tag)}</span>`
      : `<span class="asset-market-card-tag">${esc(tag)}</span>`;
  }

  function renderStackCover(pkg) {
    const tagHtml = renderCoverTag(pkg);
    const imgs = (pkg.previewImages || []).filter((p) => p?.imageUrl).slice(0, 4);
    const hue = pkg.previewThumbs?.[0]?.hue || 200;
    if (!imgs.length) {
      return `<button type="button" class="asset-market-card-cover asset-stack-cover asset-stack-cover--empty asset-stack-cover--pack" data-action="preview-cover" data-pkg-id="${esc(pkg.id)}" style="--asset-hue:${hue}" aria-label="预览结构">
        <div class="asset-pack-shell" aria-hidden="true"></div>
        <span class="asset-stack-pack-shimmer" aria-hidden="true"></span>
        ${tagHtml}
      </button>`;
    }
    const layers = imgs
      .map(
        (p, i) =>
          `<img class="asset-stack-layer asset-stack-layer--${i}" src="${esc(p.imageUrl)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high" decoding="async"' : ' decoding="async"'} draggable="false">`
      )
      .join('');
    return `<button type="button" class="asset-market-card-cover asset-stack-cover asset-stack-cover--pack" data-action="preview-cover" data-pkg-id="${esc(pkg.id)}" style="--asset-hue:${hue}" aria-label="预览结构">
      <div class="asset-pack-shell" aria-hidden="true"></div>
      <span class="asset-stack-pack-shimmer" aria-hidden="true"></span>
      <div class="asset-stack-inner">${layers}</div>
      ${tagHtml}
    </button>`;
  }

  function renderHeavyDemoStackLayers(hue) {
    const hues = [hue, hue + 18, hue + 36, hue + 54];
    return `<div class="asset-stack-inner asset-stack-inner--heavy asset-stack-inner--demo-fan" aria-hidden="true">${hues
      .slice(0, 4)
      .map(
        (h, i) =>
          `<span class="asset-demo-fan-card asset-demo-fan-card--${i}" style="--card-hue:${h}"></span>`
      )
      .join('')}</div>`;
  }

  function renderHeavyDemoMosaic(pkg) {
    const nodes = (pkg.previewTree || []).slice(0, 6);
    const hues = [28, 46, 200, 168, 312, 18, 36, 260];
    const tiles = hues
      .slice(0, 8)
      .map(
        (hue, i) =>
          `<span class="asset-heavy-demo-tile asset-heavy-demo-tile--${i}" style="--tile-hue:${hue}" aria-hidden="true"></span>`
      )
      .join('');
    const stats = nodes
      .map(
        (node) =>
          `<span class="asset-heavy-stat asset-heavy-stat--tile">${esc(node.name)}${node.cardCount ? `<em>${node.cardCount}</em>` : ''}</span>`
      )
      .join('');
    return `<div class="asset-heavy-demo-mosaic" aria-hidden="true">
      <div class="asset-heavy-demo-tiles">${tiles}</div>
      <div class="asset-heavy-demo-veil" aria-hidden="true"></div>
      ${stats ? `<div class="asset-heavy-stats asset-heavy-stats--mosaic">${stats}</div>` : ''}
      <span class="asset-heavy-demo-badge">结构演示</span>
    </div>`;
  }

  function renderHeavyCover(pkg) {
    const tagHtml = renderCoverTag(pkg);
    const imgs = (pkg.previewImages || []).filter((p) => p?.imageUrl).slice(0, 4);
    const hue = pkg.previewThumbs?.[0]?.hue || 42;
    const demoFill = pkg.isDemo || (!imgs.length && (pkg.previewTree || []).length > 2);
    const mosaicHtml = demoFill ? renderHeavyDemoMosaic(pkg) : '';
    if (!imgs.length) {
      const stackHtml = demoFill ? renderHeavyDemoStackLayers(hue) : '';
      return `<button type="button" class="asset-market-card-cover asset-stack-cover asset-stack-cover--empty asset-stack-cover--pack asset-stack-cover--heavy${demoFill ? ' asset-stack-cover--heavy-demo' : ''}" data-action="preview-cover" data-pkg-id="${esc(pkg.id)}" style="--asset-hue:${hue}" aria-label="预览结构">
        <div class="asset-pack-shell" aria-hidden="true"></div>
        <span class="asset-stack-pack-shimmer" aria-hidden="true"></span>
        <span class="asset-pack-sweep" aria-hidden="true"></span>
        ${stackHtml}
        ${mosaicHtml}
        ${tagHtml}
      </button>`;
    }
    const layers = imgs
      .map(
        (p, i) =>
          `<img class="asset-stack-layer asset-stack-layer--${i}" src="${esc(p.imageUrl)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" draggable="false">`
      )
      .join('');
    return `<button type="button" class="asset-market-card-cover asset-stack-cover asset-stack-cover--pack asset-stack-cover--heavy" data-action="preview-cover" data-pkg-id="${esc(pkg.id)}" style="--asset-hue:${hue}" aria-label="预览结构">
      <div class="asset-pack-shell" aria-hidden="true"></div>
      <span class="asset-stack-pack-shimmer" aria-hidden="true"></span>
      <span class="asset-pack-sweep" aria-hidden="true"></span>
      <div class="asset-stack-inner asset-stack-inner--heavy">${layers}</div>
      ${mosaicHtml || (pkg.previewTree?.length ? `<div class="asset-heavy-stats" aria-hidden="true">${(pkg.previewTree || []).slice(0, 4).map((node) => `<span class="asset-heavy-stat">${esc(node.name)}${node.cardCount ? ` · ${node.cardCount}` : ''}</span>`).join('')}</div>` : '')}
      ${tagHtml}
    </button>`;
  }

  function renderMarketCard(pkg) {
    const packUi = resolvePackUi(pkg);
    const buyout = pkg.saleType === 'buyout';
    const owned = pkg.owned;
    const isFree = !pkg.priceCents;
    const buyLabel = pkg.isDemo
      ? '预览结构'
      : owned && pkg.isAuthor
        ? '编辑分组'
        : owned
          ? '导入'
          : isFree
            ? '免费领取'
            : buyout
              ? '买断'
              : '购买';
    const buyClass = pkg.isDemo
      ? 'btn btn-secondary btn-sm'
      : owned
        ? 'btn btn-secondary btn-sm'
        : 'btn btn-primary btn-sm';
    const uiClass = packUi === 'heavy' ? ' asset-market-card--heavy' : ' asset-market-card--light';
    const featuredClass = pkg.featured ? ' asset-market-card--featured' : '';
    const demoClass = pkg.isDemo ? ' asset-market-card--demo' : '';
    const cover = packUi === 'heavy' ? renderHeavyCover(pkg) : renderStackCover(pkg);
    const priceHtml = pkg.isDemo
      ? '<span class="asset-market-price asset-market-price--demo">演示<em>非售卖 · 仅结构预览</em></span>'
      : `<span class="asset-market-price">${esc(pkg.priceLabel)}${buyout ? ' <em>买断</em>' : ''}</span>`;
    return `
        <article class="asset-market-card${uiClass}${featuredClass}${demoClass}" data-pkg-id="${esc(pkg.id)}" data-pack-ui="${packUi}">
          ${cover}
          <div class="asset-market-card-body">
            <p class="asset-market-card-author">${esc(pkg.authorName || '作者')}</p>
            <h3 class="asset-market-card-title">${esc(pkg.title)}</h3>
            <p class="asset-market-card-meta">${esc(pkg.countLabel)}</p>
            <p class="asset-market-card-meta">${commercialBadge(pkg)}</p>
            <p class="asset-market-card-desc">${esc(pkg.desc)}</p>
            <div class="asset-market-card-foot">
              ${priceHtml}
              <div class="asset-market-card-actions">
                <button type="button" class="${buyClass}" data-action="buy">${buyLabel}</button>
              </div>
            </div>
          </div>
        </article>`;
  }

  function updatePackageCoverDom(pkg) {
    const card = document.querySelector(`.asset-market-card[data-pkg-id="${pkg.id}"]`);
    const cover = card?.querySelector('.asset-stack-cover--pack');
    if (!cover || !pkg) return;
    const imgs = (pkg.previewImages || []).filter((p) => p?.imageUrl).slice(0, 4);
    if (!imgs.length) return;
    const tagHtml = renderCoverTag(pkg);
    const hue = pkg.previewThumbs?.[0]?.hue || 200;
    const layers = imgs
      .map(
        (p, i) =>
          `<img class="asset-stack-layer asset-stack-layer--${i}" src="${esc(p.imageUrl)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" draggable="false">`
      )
      .join('');
    cover.classList.remove('asset-stack-cover--empty');
    cover.style.setProperty('--asset-hue', String(hue));
    const innerClass = card?.dataset?.packUi === 'heavy' ? 'asset-stack-inner asset-stack-inner--heavy' : 'asset-stack-inner';
    cover.innerHTML = `<div class="asset-pack-shell" aria-hidden="true"></div><span class="asset-stack-pack-shimmer" aria-hidden="true"></span><div class="${innerClass}">${layers}</div>${tagHtml}`;
  }

  async function hydrateMarketCovers(list) {
    if (!window.PromptHubApi?.getAssetPackageCovers || !list?.length) return;
    await Promise.all(
      list.map(async (pkg) => {
        if (pkg.isDemo || pkg.id === DEMO_FEATURED_PACKAGE.id) return;
        if ((pkg.previewImages || []).some((p) => p?.imageUrl)) return;
        try {
          const r = await window.PromptHubApi.getAssetPackageCovers(pkg.id);
          if (r?.ok && Array.isArray(r.data?.previewImages) && r.data.previewImages.length) {
            pkg.previewImages = r.data.previewImages;
            updatePackageCoverDom(pkg);
          }
        } catch (e) {
          /* ignore cover load errors */
        }
      })
    );
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
        marketPackages = mergeMarketPackageList(r.data.items.map(normalizePackage).filter(Boolean));
      } else if (/DB_MIGRATION|asset_packages/i.test(String(r.message || ''))) {
        marketPackages = getDemoPackages();
        toast('资产包功能需先在 Supabase 运行迁移 SQL', 6000);
      } else {
        marketPackages = mergeMarketPackageList(MOCK_PACKAGES.map(normalizePackage).filter(Boolean));
      }
    } catch (e) {
      marketPackages = mergeMarketPackageList(MOCK_PACKAGES.map(normalizePackage).filter(Boolean));
    } finally {
      marketLoading = false;
    }
    return marketPackages;
  }

  function findPackage(id) {
    if (id === DEMO_FEATURED_PACKAGE.id) return normalizePackage(DEMO_FEATURED_PACKAGE);
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
          ? '<div class="feature-empty"><p>暂无发布的资产包</p><p class="panel-hint">在「卡片资产」页点击「发布资产包」上架你的免费或付费包。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>'
          : '<div class="feature-empty"><p>暂无拥有的资产包</p><p class="panel-hint">在「卡片资产」领取免费包或购买后，会显示在这里。</p><button type="button" class="btn btn-secondary btn-sm" onclick="switchAppPage(\'assetmarket\')">去卡片资产</button></div>';
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
          ? '无法连接 api.prompt-hub.cn，请检查网络/VPN 后重试'
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
    cards.forEach((c) => {
      (Array.isArray(c.tags) ? c.tags : []).forEach((t) => {
        const s = String(t || '').trim();
        if (s) set.add(s);
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

  function onAppChange(app) {
    if (app === 'assetmarket') {
      window.resumeRippleBackground?.();
      void renderMarketplace();
    }
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
