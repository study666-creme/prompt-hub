/**
 * 卡片资产市场 + 资产创作 + 多卡片库
 */
(function () {
  const LS_WAREHOUSES = 'promptrepo_warehouses_v1';

  let marketPackages = [];
  let marketLoading = false;

  /** 额外自命名库配额（不含默认库）：免费 1 · 轻量 1 · 基础 2 · 标准 3 · 专业 4 */
  const EXTRA_WAREHOUSE_BY_TIER = {
    lite: 1,
    basic: 2,
    standard: 3,
    pro: 4
  };
  const EXTRA_WAREHOUSE_FREE = 1;

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
      '拥有完整剧本三万字加世界观文档两万字，重要人物设定卡14张，配角形象卡103张，怪物形象卡43张，场景卡56张，均已关联卡片式创作文档，导入即用，关系一目了然，设定剧情微调无障碍。提示词和图片均为自己创作，无任何版权风险，购买即拥有该图包卡片文档商用版权。如预览图无法下定决断，可联系本人商议更多信息。',
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
