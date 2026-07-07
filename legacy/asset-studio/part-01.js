/**
 * 资产创作工作台 · 独立页（联动主站卡片库）
 */
(function () {
  const LS_STATE = 'promptrepo_studio_v3';
  const LS_IMPORT = 'promptrepo_studio_import_cards';
  const LS_FILTERS = 'promptrepo_studio_filters';
  const LS_PANEL_WIDTHS = 'promptrepo_studio_panel_widths';
  const LS_GUIDE = 'promptrepo_studio_hero_guide_seen';
  const LS_PRESET_DISMISSED = 'promptrepo_studio_preset_dismissed_v1';
  const PRESET_PROJECT_ID = 'proj_studio_preset';
  const PRESET_DOC_ID = 'doc_studio_preset_story';
  const PRESET_CONTENT_VERSION = 2;
  const PRESET_CARD_IDS = ['preset_scene', 'preset_hero', 'preset_heroine', 'preset_villain'];
  const PRESET_IMAGES = {
    scene: 'assets/studio-preset/scene.png',
    hero: 'assets/studio-preset/linche.png',
    heroine: 'assets/studio-preset/shenmei.png',
    villain: 'assets/studio-preset/peishen.png'
  };

  const PRESET_STORY_BODY =
    '雾气从霜结圣所的拱门里涌出。沈湄跪在六角石台上合十祈祷，她在等凛澈——北境花艺师，也是她在这条地下拳线上唯一能信任的人。\n\n' +
    '凛澈从柱影间走出，灯笼里的蓝花在寒气里微微发亮。「裴深已经封锁了墓园入口。」他压低声音。远处，裴深靠在路牌旁，笑意冷得像刃：「沈湄，别急着走。你遗忘灯笼里的那段记忆，换不换令妹的下落？」\n\n' +
    '沈湄指节发白，却没有退。凛澈侧身挡在她前面，目光扫过整座霜结圣所——冲突，从这里开始。';

  function buildStudioPresetProject() {
    const docId = PRESET_DOC_ID;
    const cards = [
      {
        id: 'preset_scene',
        title: '霜结圣所',
        group: '场景',
        hue: 198,
        image: PRESET_IMAGES.scene,
        prompt: 'ancient stone arena, runic pillars, frost floor, golden banners, misty arch portal, cinematic fantasy',
        background: '北境边陲的圆形竞技场，霜纹铺地，符文柱与悬旗环绕，适合对决与仪式开场。',
        character: '六角石台、拱门天光、手持跟拍、冷雾氛围。',
        relations: '关联文档《圣所前夜·试写》',
        docs: [docId],
        tags: ['演示']
      },
      {
        id: 'preset_hero',
        title: '凛澈',
        group: '人设',
        hue: 210,
        image: PRESET_IMAGES.hero,
        prompt: 'young man, dual tone hair, white coat blue flowers, lantern, ruined town night, anime illustration',
        background: '北境雾港花艺师，掌风步法，以「遗忘灯笼」封存记忆碎片。',
        character: '17岁，左颊旧疤，白蓝长衣，手提发光花灯笼。',
        relations: '与沈湄并肩；被裴深以记忆与亲人下落要挟。',
        docs: [docId],
        tags: ['演示']
      },
      {
        id: 'preset_heroine',
        title: '沈湄',
        group: '人设',
        hue: 280,
        image: PRESET_IMAGES.heroine,
        prompt: 'young woman kneeling prayer, underground fight arena, wet floor, dark straps armor, cinematic',
        background: '地下拳场情报线人，外表柔韧，实则意志极坚。',
        character: '高束发，臂铠与短裙战装，肤上带水光与尘渍。',
        relations: '信任凛澈；妹妹下落成谜，被裴深盯上。',
        docs: [docId],
        tags: ['演示']
      },
      {
        id: 'preset_villain',
        title: '裴深',
        group: '人设',
        hue: 12,
        image: PRESET_IMAGES.villain,
        prompt: 'antagonist man, steampunk alley, signpost, muscular, bandaged torso, cold smirk, cinematic',
        background: '灰港地下财团执行官，擅长交易、恐吓与双面布局。',
        character: '深色系风衣与金属护肩，路牌阴影下常带讥诮笑意。',
        relations: '与凛澈有旧案；以沈湄妹妹与记忆为筹码。',
        docs: [docId],
        tags: ['演示']
      }
    ];
    return {
      id: PRESET_PROJECT_ID,
      name: '功能演示',
      presetVersion: PRESET_CONTENT_VERSION,
      folders: [
        { id: 'fld_preset_char', name: '人设', parentId: null, collapsed: false },
        { id: 'fld_preset_scene', name: '场景', parentId: null, collapsed: false }
      ],
      docs: [
        {
          id: docId,
          folderId: 'fld_preset_char',
          title: '圣所前夜·试写',
          heroCardIds: PRESET_CARD_IDS.slice(),
          closedFloatIds: [],
          body: PRESET_STORY_BODY,
          bodyHtml: '',
          floatPositions: {
            preset_scene: { x: 380, y: 72 },
            preset_hero: { x: 520, y: 120 },
            preset_heroine: { x: 660, y: 88 },
            preset_villain: { x: 800, y: 140 }
          }
        }
      ],
      activeDocId: docId,
      cards,
      cardGroups: ['人设', '场景'],
      globalFields: [],
      fieldLabels: { ...DEFAULT_FIELD_LABELS },
      heroFieldLabel: DEFAULT_HERO_LABEL,
      coreFieldOrder: CORE_FIELD_KEYS.slice()
    };
  }

  function isLegacyPresetStory(body) {
    const text = String(body || '');
    return text.includes('霓虹雨巷') || text.includes('林岚') || text.includes('苏清') || text.includes('反派枭');
  }

  function upgradeStudioPresetIfNeeded(project) {
    if (!project || project.id !== PRESET_PROJECT_ID) return false;
    if ((project.presetVersion || 0) >= PRESET_CONTENT_VERSION) return false;
    const fresh = buildStudioPresetProject();
    project.presetVersion = PRESET_CONTENT_VERSION;
    project.cards = fresh.cards.map((c) => ({ ...c }));
    project.cardGroups = fresh.cardGroups.slice();
    const doc = project.docs?.find((d) => d.id === PRESET_DOC_ID);
    const freshDoc = fresh.docs[0];
    if (doc && freshDoc) {
      const plain = (doc.bodyHtml || doc.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const freshPlain = (freshDoc.body || '').replace(/\s+/g, ' ').trim();
      const keepUserEdits = plain && !isLegacyPresetStory(plain) && plain !== freshPlain;
      if (!keepUserEdits) {
        doc.title = freshDoc.title;
        doc.body = freshDoc.body;
        doc.bodyHtml = '';
        doc.heroCardIds = freshDoc.heroCardIds.slice();
        if (!doc.floatPositions || !Object.keys(doc.floatPositions).length) {
          doc.floatPositions = { ...freshDoc.floatPositions };
        }
      }
    }
    return true;
  }

  const PANEL_WIDTH_DEFAULTS = { assets: 240, docs: 220, ai: 320 };
  const PANEL_WIDTH_LIMITS = {
    assets: { min: 160, max: 420 },
    docs: { min: 140, max: 360 },
    ai: { min: 260, max: 520 }
  };

  const DEFAULT_FIELD_LABELS = {
    title: '标题',
    prompt: '提示词',
    background: '背景 / 设定',
    character: '人物 / 外观',
    relations: '关系 / 备注'
  };

  const DEFAULT_HERO_LABEL =
    '关联图：拖入与本篇相关的卡片（人设 / 场景 / 配角）';

  const CORE_FIELD_KEYS = ['title', 'prompt', 'background', 'character', 'relations'];

  function isPresetDismissed() {
    try {
      return localStorage.getItem(LS_PRESET_DISMISSED) === '1';
    } catch (e) {
      return false;
    }
  }

  function markPresetDismissed() {
    try {
      localStorage.setItem(LS_PRESET_DISMISSED, '1');
    } catch (e) { /* ignore */ }
  }

  function maybeCompletePresetTour(doc) {
    if (!doc || doc.id !== PRESET_DOC_ID || isPresetDismissed()) return;
    const closed = new Set(doc.closedFloatIds || []);
    if (PRESET_CARD_IDS.every((id) => closed.has(id))) markPresetDismissed();
  }

  function ensureStudioPresetProject(s, opts) {
    if (isPresetDismissed()) return;
    if (!Array.isArray(s.projects)) s.projects = [];
    const existing = s.projects.find((p) => p.id === PRESET_PROJECT_ID);
    if (existing) {
      if (upgradeStudioPresetIfNeeded(existing)) {
        try {
          localStorage.setItem(LS_STATE, JSON.stringify(s));
        } catch (e) { /* ignore */ }
      }
      return;
    }
    s.projects.unshift(buildStudioPresetProject());
    if (opts?.selectPreset) s.projectId = PRESET_PROJECT_ID;
  }

  let state = loadState();
  let dragCardId = null;
  let dragDocId = null;
  let floatZ = 50;
  let detailCardId = null;
  let activeFilters = new Set();
  let mentionApplyTimer = null;
  let mentionApplying = false;

  function canUseAssetStudio() {
    return window.SupabaseSync?.isLoggedIn?.() === true;
  }

  function isPresetDemoProject() {
    return getProject()?.id === PRESET_PROJECT_ID;
  }

  /** 演示项目允许未登录用户拖卡片体验完整流程（仅本地，不上传） */
  function allowsStudioDemoInteract() {
    return isPresetDemoProject();
  }

  function isViewOnly() {
    return !canUseAssetStudio();
  }

  function guardEdit(msg) {
    if (canUseAssetStudio() || allowsStudioDemoInteract()) return true;
    setStatus(msg || '请先登录后使用资产创作（当前为只读预览）');
    return false;
  }

  function loadFilters() {
    try {
      const raw = localStorage.getItem(LS_FILTERS);
      if (raw) activeFilters = new Set(JSON.parse(raw));
    } catch (e) {
      activeFilters = new Set();
    }
  }

  function saveFilters() {
    try {
      localStorage.setItem(LS_FILTERS, JSON.stringify([...activeFilters]));
    } catch (e) { /* ignore */ }
  }

  function studioCardKind(card) {
    if (window.FeatureDraft?.getWarehouseCardKind) {
      return window.FeatureDraft.getWarehouseCardKind(card);
    }
    const img = card?.image;
    if (!img || !String(img).trim()) return 'text';
    return window.FeatureDraft?.isUsableWarehouseImage?.(card) ? 'visual' : 'text';
  }

  function cardMatchesFilters(card) {
    if (activeFilters.size === 0) return true;
    const kind = studioCardKind(card);
    return [...activeFilters].some((f) => {
      if (f === 'image') return kind === 'visual';
      if (f === 'text') return kind === 'text';
      if (f.startsWith('tag:')) return (card.tags || []).includes(f.slice(4));
      return false;
    });
  }

  function getStudioFilterOptions() {
    const base = [
      { value: 'image', label: '有图片' },
      { value: 'text', label: '纯文字' }
    ];
    const tags = [...new Set(getProjectCards().flatMap((c) => c.tags || []))]
      .filter(Boolean)
      .map((t) => ({ value: `tag:${t}`, label: `#${t}` }));
    return base.concat(tags);
  }

  function syncStudioFilterBtn() {
    const btn = document.getElementById('studioFilterBtn');
    if (btn) btn.classList.toggle('active', activeFilters.size > 0);
  }

  function buildStudioFilterMenu() {
    const dd = document.getElementById('studioFilterDropdown');
    if (!dd) return;
    const valid = new Set(getStudioFilterOptions().map((o) => o.value));
    activeFilters.forEach((f) => {
      if (!valid.has(f)) activeFilters.delete(f);
    });
    dd.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'studio-filter-head';
    head.innerHTML = '<span>筛选（可多选）</span><button type="button" class="studio-filter-clear">清除</button>';
    head.querySelector('.studio-filter-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      activeFilters.clear();
      saveFilters();
      syncStudioFilterBtn();
      buildStudioFilterMenu();
      renderAssetFolders();
    });
    dd.appendChild(head);
    getStudioFilterOptions().forEach((opt) => {
      const row = document.createElement('label');
      row.className = 'studio-filter-item';
      const checked = activeFilters.has(opt.value) ? ' checked' : '';
      row.innerHTML = `<input type="checkbox"${checked}><span>${esc(opt.label)}</span>`;
      const input = row.querySelector('input');
      input?.addEventListener('change', () => {
        if (input.checked) activeFilters.add(opt.value);
        else activeFilters.delete(opt.value);
        saveFilters();
        syncStudioFilterBtn();
        renderAssetFolders();
      });
      dd.appendChild(row);
    });
    syncStudioFilterBtn();
  }

  function applyViewOnlyMode() {
    const banner = document.getElementById('studioViewOnlyBanner');
    if (banner) banner.classList.toggle('hidden', canUseAssetStudio());
    const editor = document.getElementById('studioEditor');
    const demoMode = allowsStudioDemoInteract();
    if (editor) editor.contentEditable = canUseAssetStudio() ? 'true' : (demoMode ? 'true' : 'false');
    ['studioNewProjectBtn', 'studioDocAddBtn', 'studioCardSaveBtn', 'studioDeleteProjectBtn', 'studioFieldSettingsBtn', 'studioChatNewThread'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = isViewOnly() && !demoMode;
    });
    const hero = document.getElementById('studioHeroDrop');
    const readonly = isViewOnly() && !demoMode;
    if (hero) {
      hero.classList.toggle('studio-readonly', readonly);
      hero.classList.toggle('studio-demo-drop', demoMode);
    }
    const main = document.getElementById('studioMain');
    if (main) {
      main.classList.toggle('studio-readonly', readonly);
      main.classList.toggle('studio-demo-active', demoMode);
    }
  }

  function applyStudioImgLoaded(img, url) {
    if (!img || !url) return;
    img.src = url;
    img.dataset.loaded = '1';
    img.closest('.studio-asset-card')?.classList.remove('no-thumb');
    img.closest('.card-media')?.classList.add('has-img');
    img.closest('.studio-float-thumb')?.classList.add('has-img');
  }

  let studioThumbPrefetchDone = false;
  let studioImgObserver = null;
  const studioResolveQueue = [];
  let studioResolveActive = 0;
  const STUDIO_MAX_RESOLVE = 6;

  function studioCardIdFromImg(img) {
    return (
      img.closest('.studio-asset-card')?.dataset?.cardId ||
      img.closest('.studio-float-card')?.dataset?.cardId ||
      detailCardId
    );
  }

  function runStudioResolveQueue() {
    while (studioResolveActive < STUDIO_MAX_RESOLVE && studioResolveQueue.length) {
      const job = studioResolveQueue.shift();
      studioResolveActive += 1;
      job().finally(() => {
        studioResolveActive -= 1;
        runStudioResolveQueue();
      });
    }
  }

  function enqueueStudioResolve(fn) {
    return new Promise((resolve) => {
      studioResolveQueue.push(() => fn().then(resolve, resolve));
      runStudioResolveQueue();
    });
  }

  function patchStudioImagesFromCache(root) {
    if (!root) return;
    if (window.MediaPipeline?.patchContainerFromCache) {
      window.MediaPipeline.patchContainerFromCache(root, { visibleFirst: true, max: 24 });
    }
    if (!window.SupabaseSync?.getCachedDisplayUrl && !window.MediaPipeline?.getListCached) return;
    root.querySelectorAll('img[data-image-ref]').forEach((img) => {
      if (img.dataset.loaded === '1') return;
      const ref = img.getAttribute('data-image-ref');
      if (!ref) return;
      if (/^https?:\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('blob:')) {
        applyStudioImgLoaded(img, ref);
        return;
      }
      const cardId = studioCardIdFromImg(img);
      const cached = window.MediaPipeline?.getListCached?.(ref, cardId)
        || window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant: 'grid' });
      if (cached) applyStudioImgLoaded(img, cached);
    });
  }

  async function loadOneStudioImg(img) {
    if (!img || img.dataset.loaded === '1') return;
    const ref = img.getAttribute('data-image-ref');
    if (!ref) return;
    const cardId = studioCardIdFromImg(img);
    if (/^https?:\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('blob:')) {
      applyStudioImgLoaded(img, ref);
      return;
    }
    const cached = window.MediaPipeline?.getListCached?.(ref, cardId)
      || window.SupabaseSync?.getCachedDisplayUrl?.(ref, { assetId: cardId, variant: 'grid' });
    if (cached) {
      applyStudioImgLoaded(img, cached);
      return;
    }
    const resolveList = window.MediaPipeline?.resolveListUrl
      || ((image, o) => window.SupabaseSync?.resolveDisplayUrl?.(image, { ...o, variant: 'grid', listOnly: true }));
    if (!resolveList) return;
    await enqueueStudioResolve(async () => {
      if (img.dataset.loaded === '1') return;
      try {
        const url = await resolveList(ref, { assetId: cardId, cardId });
        if (url) applyStudioImgLoaded(img, url);
      } catch (e) { /* ignore */ }
    });
  }

  function ensureStudioImgObserver() {
    if (studioImgObserver) return studioImgObserver;
    studioImgObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          studioImgObserver.unobserve(img);
          void loadOneStudioImg(img);
        });
      },
      { root: null, rootMargin: '100px', threshold: 0.02 }
    );
    return studioImgObserver;
  }

  function observeStudioCardImages(root, opts) {
    if (!root) return;
    patchStudioImagesFromCache(root);
    const eager = opts?.eager === true;
    root.querySelectorAll('img[data-image-ref]').forEach((img) => {
      if (img.dataset.loaded === '1') return;
      if (eager) {
        void loadOneStudioImg(img);
        return;
      }
      ensureStudioImgObserver().observe(img);
    });
  }

  function hydrateStudioCardImages(root, opts) {
    if (!root) return;
    const pending = root.querySelectorAll('img[data-image-ref]:not([data-loaded="1"])').length;
    observeStudioCardImages(root, { eager: pending <= 8 || opts?.eager });
  }

  function prefetchStudioProjectThumbs() {
    if (studioThumbPrefetchDone) return;
    if (!window.MediaPipeline?.prefetchList && !window.SupabaseSync?.prefetchCardsImages) return;
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    const cards = getProjectCards().filter((c) => c.image && String(c.image).trim());
    if (!cards.length) return;
    studioThumbPrefetchDone = true;
    const run = () => {
      const prefetch = window.MediaPipeline?.prefetchList
        ? window.MediaPipeline.prefetchList(cards.slice(0, 32), 2200)
        : window.SupabaseSync.prefetchCardsImages(cards.slice(0, 32), 2200);
      void prefetch.then(() => {
        const root = document.getElementById('studioAssetFolders');
        if (root) observeStudioCardImages(root);
      });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 800);
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(resolve, ms))
    ]);
  }

  function setStatus(msg) {
    const el = document.getElementById('studioStatusBadge');
    if (el) el.textContent = msg || '本地已自动保存';
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) {
        const s = JSON.parse(raw);
        normalizeAllProjects(s);
        migrateLegacyState(s);
        ensureStudioPresetProject(s);
        return s;
      }
    } catch (e) { /* ignore */ }
    const s = {
      projectId: PRESET_PROJECT_ID,
      projects: [],
      assetTab: 'warehouse'
    };
    ensureStudioPresetProject(s, { selectPreset: true });
    if (!s.projects.length) {
      s.projects.push({
        id: 'proj_default',
        name: '我的项目',
        folders: [{ id: 'fld_default', name: '默认', parentId: null, collapsed: false }],
        docs: [
          {
            id: 'doc_welcome',
            folderId: 'fld_default',
            title: '新文档',
            heroCardIds: [],
            closedFloatIds: [],
            body: '',
            bodyHtml: '',
            floatPositions: {}
          }
        ],
        activeDocId: 'doc_welcome',
        cards: [],
        cardGroups: [],
        globalFields: [],
        fieldLabels: { ...DEFAULT_FIELD_LABELS },
        heroFieldLabel: DEFAULT_HERO_LABEL,
        coreFieldOrder: CORE_FIELD_KEYS.slice()
      });
      s.projectId = 'proj_default';
    }
    migrateLegacyState(s);
    return s;
  }

  function migrateLegacyState(s) {
    const legacyCards = Array.isArray(s.cards) ? s.cards : [];
    const legacyGroups = Array.isArray(s.cardGroups) ? s.cardGroups : [];
    (s.projects || []).forEach((p, idx) => {
      if (!Array.isArray(p.cards)) p.cards = idx === 0 ? legacyCards.slice() : [];
      if (!Array.isArray(p.cardGroups)) p.cardGroups = idx === 0 ? legacyGroups.slice() : [];
      ensureProjectAssets(p);
