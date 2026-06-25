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
    });
    delete s.cards;
    delete s.cardGroups;
  }

  function ensureProjectAssets(p) {
    if (!Array.isArray(p.cards)) p.cards = [];
    if (!Array.isArray(p.cardGroups)) p.cardGroups = [];
    if (!Array.isArray(p.globalFields)) p.globalFields = [];
    if (!Array.isArray(p.coreFieldOrder) || !p.coreFieldOrder.length) {
      p.coreFieldOrder = CORE_FIELD_KEYS.slice();
    } else {
      p.coreFieldOrder = p.coreFieldOrder.filter((k) => CORE_FIELD_KEYS.includes(k));
      CORE_FIELD_KEYS.forEach((k) => {
        if (!p.coreFieldOrder.includes(k)) p.coreFieldOrder.push(k);
      });
    }
    if (!p.fieldLabels || typeof p.fieldLabels !== 'object') {
      p.fieldLabels = { ...DEFAULT_FIELD_LABELS };
    } else {
      CORE_FIELD_KEYS.forEach((k) => {
        if (!p.fieldLabels[k]) p.fieldLabels[k] = DEFAULT_FIELD_LABELS[k];
      });
    }
    if (!p.heroFieldLabel) p.heroFieldLabel = DEFAULT_HERO_LABEL;
    if (typeof p.chatAttachDoc !== 'boolean') p.chatAttachDoc = true;
    ensureChatThreads(p);
  }

  function ensureChatThreads(p) {
    if (!Array.isArray(p.chatThreads) || !p.chatThreads.length) {
      p.chatThreads = [
        {
          id: 'chat_default',
          title: '对话 1',
          messages: [],
          createdAt: Date.now(),
          usePreset: true
        }
      ];
    }
    p.chatThreads.forEach((t) => {
      if (!Array.isArray(t.messages)) t.messages = [];
      if (typeof t.usePreset !== 'boolean') t.usePreset = true;
      if (!t.title) t.title = '对话';
    });
    if (!p.activeChatId || !p.chatThreads.some((t) => t.id === p.activeChatId)) {
      p.activeChatId = p.chatThreads[0].id;
    }
  }

  function getActiveChatThread() {
    const p = getProject();
    ensureProjectAssets(p);
    return p.chatThreads.find((t) => t.id === p.activeChatId) || p.chatThreads[0];
  }

  function getChatMessages() {
    return getActiveChatThread().messages;
  }

  function persistChatMessages() {
    saveState();
  }

  function renderChatLogFromThread() {
    const log = document.getElementById('studioChatLog');
    if (!log) return;
    const msgs = getChatMessages();
    log.innerHTML = '';
    msgs.forEach((m) => {
      if (m.role === 'user') {
        appendChatMessage('studio-chat-msg user', `<p>${esc(m.content)}</p>`);
        return;
      }
      if (m.role !== 'assistant') return;
      const block = appendChatMessage(
        'studio-chat-msg assistant',
        `<pre class="studio-chat-context">${esc(m.content)}</pre>
        <div class="studio-chat-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-copy-context>复制</button>
          <button type="button" class="btn btn-secondary btn-sm" data-fill-image>填入生图</button>
        </div>`
      );
      bindChatActionButtons(block);
    });
    log.scrollTop = log.scrollHeight;
  }

  function renderChatThreadSelect() {
    const sel = document.getElementById('studioChatThreadSelect');
    const p = getProject();
    if (!sel || !p) return;
    ensureChatThreads(p);
    const prev = p.activeChatId;
    sel.innerHTML = p.chatThreads
      .map(
        (t) =>
          `<option value="${esc(t.id)}"${t.id === p.activeChatId ? ' selected' : ''}>${esc(t.title || '对话')}</option>`
      )
      .join('');
    if (prev !== p.activeChatId) sel.value = p.activeChatId;
  }

  function switchChatThread(threadId) {
    const p = getProject();
    if (!p.chatThreads.some((t) => t.id === threadId)) return;
    p.activeChatId = threadId;
    saveState();
    renderChatThreadSelect();
    renderChatLogFromThread();
  }

  function createNewChatThread() {
    if (!guardEdit()) return;
    const p = getProject();
    ensureChatThreads(p);
    const id = `chat_${Date.now().toString(36)}`;
    const title = `对话 ${p.chatThreads.length + 1}`;
    p.chatThreads.push({
      id,
      title,
      messages: [],
      createdAt: Date.now(),
      usePreset: false
    });
    p.activeChatId = id;
    saveState();
    renderChatThreadSelect();
    renderChatLogFromThread();
    setStatus('已创建新对话，可自行设定助手风格');
  }

  function normalizeAllProjects(s) {
    (s.projects || []).forEach((p) => {
      normalizeProject(p);
      ensureProjectAssets(p);
    });
  }

  function normalizeProject(p) {
    if (!Array.isArray(p.folders) || !p.folders.length) {
      p.folders = [{ id: 'fld_default', name: '默认', parentId: null, collapsed: false }];
    }
    if (!Array.isArray(p.docs)) p.docs = [];
    p.folders.forEach((f) => {
      if (f.parentId === undefined) f.parentId = null;
      if (typeof f.collapsed !== 'boolean') f.collapsed = false;
    });
    p.docs.forEach((d) => {
      if (!Array.isArray(d.closedFloatIds)) d.closedFloatIds = [];
    });
  }

  function getChildFolders(p, parentId) {
    const pid = parentId || null;
    return p.folders.filter((f) => (f.parentId || null) === pid);
  }

  function collectFolderSubtree(p, folderId) {
    const ids = [folderId];
    getChildFolders(p, folderId).forEach((f) => {
      ids.push(...collectFolderSubtree(p, f.id));
    });
    return ids;
  }

  function getProject() {
    return state.projects.find((p) => p.id === state.projectId) || state.projects[0];
  }

  function getProjectCards() {
    const p = getProject();
    ensureProjectAssets(p);
    return p.cards;
  }

  function getProjectGlobalFields() {
    const p = getProject();
    ensureProjectAssets(p);
    return p.globalFields;
  }

  function getProjectFieldLabels() {
    const p = getProject();
    ensureProjectAssets(p);
    return p.fieldLabels;
  }

  function getCoreFieldOrder() {
    const p = getProject();
    ensureProjectAssets(p);
    return p.coreFieldOrder.slice();
  }

  function generateId() {
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function saveState() {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(state));
      setStatus('本地已自动保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { /* ignore */ }
  }

  function getActiveDoc() {
    const p = getProject();
    return p.docs.find((d) => d.id === p.activeDocId) || p.docs[0];
  }

  function getCard(id) {
    return getProjectCards().find((c) => c.id === id);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let studioChatBusy = false;
  let studioRefImages = [];
  let studioImageGenCost = 10;
  let studioImageCostTimer = null;
  const STUDIO_MAX_REF_IMAGES = 16;
  let studioModalResolver = null;

  function closeStudioModal(value) {
    const overlay = document.getElementById('studioModalOverlay');
    overlay?.classList.remove('active');
    document.body.classList.remove('studio-modal-open');
    const resolve = studioModalResolver;
    studioModalResolver = null;
    if (resolve) resolve(value);
  }
  window.__studioCloseModal = () => closeStudioModal(null);

  function showStudioModal(title, content, opts = {}) {
    const { prompt = false, defaultValue = '', confirmText = '确定', cancelText = '取消' } = opts;
    return new Promise((resolve) => {
      const overlay = document.getElementById('studioModalOverlay');
      const modal = document.getElementById('studioModal');
      if (!overlay || !modal) {
        resolve(null);
        return;
      }
      studioModalResolver = resolve;
      const inputHtml = prompt
        ? `<input type="text" class="studio-modal-input" id="studioModalInput" maxlength="80" autocomplete="off">`
        : '';
      modal.innerHTML = `
        <h3>${esc(title)}</h3>
        ${content ? `<p class="studio-modal-body">${esc(content)}</p>` : ''}
        ${inputHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-sm" id="studioModalConfirm">${esc(confirmText)}</button>
          <button type="button" class="btn btn-secondary btn-sm" id="studioModalCancel">${esc(cancelText)}</button>
        </div>`;
      overlay.classList.add('active');
      document.body.classList.add('studio-modal-open');
      modal.querySelector('#studioModalCancel')?.addEventListener('click', () => closeStudioModal(prompt ? null : false));
      const confirmBtn = modal.querySelector('#studioModalConfirm');
      const submit = () => {
        if (prompt) {
          const val = modal.querySelector('#studioModalInput')?.value?.trim();
          closeStudioModal(val || null);
        } else {
          closeStudioModal(true);
        }
      };
      confirmBtn?.addEventListener('click', submit);
      if (prompt) {
        const inp = modal.querySelector('#studioModalInput');
        if (inp) {
          inp.value = defaultValue || '';
          inp.focus();
          inp.select();
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          });
        }
      }
    });
  }

  async function studioPrompt(title, label, defaultValue) {
    return showStudioModal(title, label, { prompt: true, defaultValue: defaultValue || '' });
  }

  async function studioConfirm(title, message) {
    return !!(await showStudioModal(title, message));
  }

  function restoreStudioImageSubmitLabel() {
    const btn = document.getElementById('studioImageSubmit');
    if (btn && !btn.disabled) btn.textContent = `生成图片 · ${studioImageGenCost} 积分`;
  }

  function updateStudioImageGenCostHint() {
    const model = document.getElementById('studioImageModel')?.value || 'quanneng2';
    const resolution = document.getElementById('studioImageResolution')?.value || '1k';
    const detail = window.PointsSystem?.getImageGenCostDetail?.(model, resolution);
    studioImageGenCost = detail?.final ?? window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
    restoreStudioImageSubmitLabel();
    clearTimeout(studioImageCostTimer);
    studioImageCostTimer = setTimeout(() => void refreshStudioImageGenCostFromApi(model, resolution), 800);
  }

  async function refreshStudioImageGenCostFromApi(model, resolution) {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    try {
      const quote = await window.PromptHubApi?.getGenerationCost?.(resolution, 'standard', model);
      if (quote?.ok && quote.data?.final != null) {
        studioImageGenCost = quote.data.final;
        restoreStudioImageSubmitLabel();
      }
    } catch (e) { /* ignore */ }
  }

  function setStudioImageGenPending(active) {
    document.getElementById('studioImageIdle')?.classList.toggle('hidden', !!active);
    document.getElementById('studioImagePending')?.classList.toggle('hidden', !active);
    if (active) document.getElementById('studioImageResult')?.classList.add('hidden');
  }

  function scrollStudioImageResultIntoView() {
    const sc = document.getElementById('studioImageScroll');
    const area = document.getElementById('studioImagePreviewArea');
    if (!sc || !area) return;
    requestAnimationFrame(() => {
      sc.scrollTop = Math.max(0, area.offsetTop - 4);
    });
  }

  function readStudioFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  async function addStudioRefFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type?.startsWith('image/'));
    if (!files.length) return;
    for (const f of files) {
      if (studioRefImages.length >= STUDIO_MAX_REF_IMAGES) {
        setStatus(`最多 ${STUDIO_MAX_REF_IMAGES} 张参考图`);
        break;
      }
      if (f.size > 12 * 1024 * 1024) continue;
      try {
        studioRefImages.push(await readStudioFileAsDataUrl(f));
      } catch (e) { /* ignore */ }
    }
    renderStudioRefGallery();
  }

  function renderStudioRefGallery() {
    const gallery = document.getElementById('studioImageRefGallery');
    const box = document.getElementById('studioImageRefBox');
    if (!gallery || !box) return;
    if (!studioRefImages.length) {
      gallery.hidden = true;
      gallery.innerHTML = '';
      box.classList.remove('has-refs');
      return;
    }
    gallery.hidden = false;
    box.classList.add('has-refs');
    gallery.innerHTML = studioRefImages
      .map(
        (src, i) => `
      <div class="imagegen-ref-thumb">
        <button type="button" class="imagegen-ref-preview-btn" data-ref-idx="${i}" title="预览">
          <img src="${esc(src)}" alt="参考图 ${i + 1}">
        </button>
        <button type="button" class="imagegen-ref-rm" data-ref-idx="${i}" aria-label="移除">×</button>
      </div>`
      )
      .join('');
    gallery.querySelectorAll('.imagegen-ref-rm').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        studioRefImages.splice(Number(btn.dataset.refIdx), 1);
        renderStudioRefGallery();
      });
    });
  }

  function isUsableStudioRefUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^https?:\/\//i.test(url)) return true;
    if (window.SupabaseSync?.isDataUrl?.(url)) return true;
    if (window.SupabaseSync?.isStorageRef?.(url) || url.startsWith('storage://')) return true;
    return false;
  }

  async function resolveStudioRefUrlsForApi() {
    if (!studioRefImages.length) return [];
    const urls = [];
    for (const src of studioRefImages) {
      try {
        let apiUrl = null;
        if (/^https?:\/\//i.test(src)) apiUrl = src;
        else if (window.SupabaseSync?.isStorageRef?.(src) || String(src).startsWith('storage://')) {
          apiUrl = window.SupabaseSync?.normalizeImageRef?.(src) || src;
        } else if (window.SupabaseSync?.isDataUrl?.(src) || String(src).startsWith('blob:')) {
          if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.uploadImageGenRef) {
            try {
              const stored = await window.SupabaseSync.uploadImageGenRef(`studio_ref_${Date.now()}`, src);
              if (stored) apiUrl = stored;
            } catch (uploadErr) {
              console.warn('studio ref upload failed', uploadErr);
            }
          }
          if (!apiUrl && window.SupabaseSync?.isDataUrl?.(src)) apiUrl = src;
        }
        if (isUsableStudioRefUrl(apiUrl)) {
          urls.push(apiUrl);
        }
      } catch (e) {
        console.warn('studio ref resolve failed', e);
        if (isUsableStudioRefUrl(src)) urls.push(src);
        else if (window.SupabaseSync?.isDataUrl?.(src)) urls.push(src);
      }
    }
    return urls;
  }

  function bindStudioImageRefUpload() {
    const drop = document.getElementById('studioImageRefDrop');
    const box = document.getElementById('studioImageRefBox');
    const input = document.getElementById('studioImageRefInput');
    if (!drop || !input || !box || drop.dataset.bound === '1') return;
    drop.dataset.bound = '1';
    drop.addEventListener('click', (e) => {
      if (e.target.closest('.imagegen-ref-rm')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) void addStudioRefFiles(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        box.classList.add('drag-over');
      });
    });
    drop.addEventListener('dragleave', () => box.classList.remove('drag-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) void addStudioRefFiles(e.dataTransfer.files);
    });
    if (!document.body.dataset.studioRefPasteBound) {
      document.body.dataset.studioRefPasteBound = '1';
      document.addEventListener('paste', (e) => {
        const pane = document.querySelector('[data-ai-pane="image"]');
        if (!pane?.classList.contains('active')) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          void addStudioRefFiles(files);
        }
      });
    }
  }

  function ensureProjectHasDoc(p) {
    if (p.docs.length) return;
    const fld = p.folders[0] || { id: `fld_${Date.now()}`, name: '默认', parentId: null, collapsed: false };
    if (!p.folders.length) p.folders.push(fld);
    const doc = {
      id: `doc_${Date.now().toString(36)}`,
      folderId: fld.id,
      title: '新文档',
      heroCardIds: [],
      closedFloatIds: [],
      body: '',
      bodyHtml: '',
      floatPositions: {}
    };
    p.docs.push(doc);
    p.activeDocId = doc.id;
    p.activeFolderId = fld.id;
  }

  async function deleteFolderById(folderId) {
    if (!guardEdit()) return;
    const p = getProject();
    const rootFolders = getChildFolders(p, null);
    const isRoot = !(p.folders.find((f) => f.id === folderId)?.parentId);
    if (isRoot && rootFolders.length <= 1) {
      setStatus('至少保留一个顶级分类');
      return;
    }
    const fld = p.folders.find((f) => f.id === folderId);
    if (!fld) return;
    const subtree = collectFolderSubtree(p, folderId);
    const docCount = p.docs.filter((d) => subtree.includes(d.folderId)).length;
    const ok = await studioConfirm(
      '删除文件夹',
      `确定删除「${fld.name}」${docCount ? `及其 ${docCount} 篇文档` : ''}？此操作不可撤销。`
    );
    if (!ok) return;
    p.docs = p.docs.filter((d) => !subtree.includes(d.folderId));
    p.folders = p.folders.filter((f) => !subtree.includes(f.id));
    if (!p.folders.some((f) => f.id === p.activeFolderId)) {
      p.activeFolderId = getChildFolders(p, null)[0]?.id || p.folders[0]?.id;
    }
    if (!p.docs.some((d) => d.id === p.activeDocId)) {
      p.activeDocId = p.docs[0]?.id || null;
      ensureProjectHasDoc(p);
    }
    saveState();
    renderAll();
  }

  async function deleteDocById(docId) {
    if (!guardEdit()) return;
    const p = getProject();
    const doc = p.docs.find((d) => d.id === docId);
    if (!doc) return;
    const ok = await studioConfirm('删除文档', `确定删除「${doc.title || '未命名文档'}」？此操作不可撤销。`);
    if (!ok) return;
    p.docs = p.docs.filter((d) => d.id !== docId);
    getProjectCards().forEach((c) => {
      if (Array.isArray(c.docs)) c.docs = c.docs.filter((id) => id !== docId);
    });
    if (p.activeDocId === docId) {
      p.activeDocId = p.docs[0]?.id || null;
      ensureProjectHasDoc(p);
    }
    saveState();
    renderAll();
  }

  function studioImageInitialSrc(image) {
    const ref = String(image || '').trim();
    if (!ref) return '';
    if (/^assets\//i.test(ref) || /^https?:\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('blob:')) {
      return ref;
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
      const finish = () => commitInlineDoc(docId, inp.value);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const p = getProject();
          const doc = p.docs.find((d) => d.id === docId);
          if (doc?._inlineNew) inp.value = '';
          else if (doc) inp.value = doc.title || '新文档';
          inp.blur();
        }
      });
      inp.addEventListener('blur', finish);
    });
    root.querySelectorAll('[data-inline-rename-fld]').forEach((inp) => {
      const folderId = inp.dataset.inlineRenameFld;
      const finish = () => commitInlineFolder(folderId, inp.value);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const p = getProject();
          const fld = p.folders.find((f) => f.id === folderId);
          if (fld?._inlineNew) inp.value = '';
          else if (fld) inp.value = fld.name || '新分类';
          inp.blur();
        }
      });
      inp.addEventListener('blur', finish);
    });
  }

  function renderDocRow(p, doc, depth) {
    const pad = 8 + depth * 14;
    const active = doc.id === p.activeDocId;
    const drag = (isViewOnly() && !allowsStudioDemoInteract()) ? 'false' : 'true';
    if (doc._inlineRename) {
      return `<div class="studio-doc-row${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" style="padding-left:${pad}px">
      <span class="studio-tree-toggle is-empty" aria-hidden="true"></span>
      <input type="text" class="studio-inline-input" data-inline-rename-doc="${esc(doc.id)}" placeholder="文档名称" maxlength="40" value="${esc(doc.title || '')}">
    </div>`;
    }
    return `<div class="studio-doc-row${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" draggable="${drag}" style="padding-left:${pad}px">
      <span class="studio-tree-toggle is-empty" aria-hidden="true"></span>
      <button type="button" class="studio-doc-item${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" data-folder-id="${esc(doc.folderId)}">${esc(doc.title || '新文档')}</button>
    </div>`;
  }

  function moveDocToFolder(docId, folderId) {
    if (!guardEdit()) return;
    const p = getProject();
    const doc = p.docs.find((d) => d.id === docId);
    const fld = p.folders.find((f) => f.id === folderId);
    if (!doc || !fld || doc.folderId === folderId) return;
    doc.folderId = folderId;
    p.activeFolderId = folderId;
    fld.collapsed = false;
    saveState();
    renderDocTree();
    setStatus(`文档已移动到「${fld.name}」`);
  }

  function bindDocTreeDragDrop(root, p) {
    root.querySelectorAll('.studio-doc-row[draggable="true"]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        dragDocId = row.dataset.docId;
        row.classList.add('doc-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', dragDocId);
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      row.addEventListener('dragend', () => {
        dragDocId = null;
        row.classList.remove('doc-dragging');
        root.querySelectorAll('.studio-doc-folder-row.doc-drop-target').forEach((el) => {
          el.classList.remove('doc-drop-target');
        });
      });
    });
    root.querySelectorAll('.studio-doc-folder-row').forEach((row) => {
      row.addEventListener('dragover', (e) => {
        if (!dragDocId && !e.dataTransfer?.types?.includes('text/plain')) return;
        e.preventDefault();
        row.classList.add('doc-drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('doc-drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('doc-drop-target');
        const docId = dragDocId || e.dataTransfer?.getData('text/plain');
        const folderId = row.dataset.folderId;
        if (docId && folderId) moveDocToFolder(docId, folderId);
        dragDocId = null;
      });
    });
  }

  function renderFolderNode(p, fld, depth) {
    const pad = 8 + depth * 14;
    const childFolders = getChildFolders(p, fld.id);
    const docs = p.docs.filter((d) => d.folderId === fld.id);
    const open = !fld.collapsed;
    const folderActive = fld.id === p.activeFolderId;
    let html = `<div class="studio-tree-branch" data-folder-id="${esc(fld.id)}">
      <div class="studio-doc-folder-row${folderActive ? ' active' : ''}" style="padding-left:${pad}px" data-folder-id="${esc(fld.id)}">
        <button type="button" class="studio-tree-toggle" data-toggle-folder="${esc(fld.id)}" aria-label="展开/收起">${open ? '▾' : '▸'}</button>`;
    if (fld._inlineRename) {
      html += `<input type="text" class="studio-inline-input" data-inline-rename-fld="${esc(fld.id)}" placeholder="分类名称" maxlength="20" value="${esc(fld.name || '')}">`;
    } else {
      html += `<button type="button" class="studio-doc-folder-btn" data-folder-id="${esc(fld.id)}">${esc(fld.name)}</button>`;
    }
    if (!isViewOnly()) {
      html += `<button type="button" class="studio-tree-add-doc" data-add-doc-in="${esc(fld.id)}" title="在此分类下新建文档" aria-label="新建文档">+</button>`;
    }
    html += `</div>`;
    if (open) {
      html += '<div class="studio-tree-children">';
      childFolders.forEach((cf) => {
        html += renderFolderNode(p, cf, depth + 1);
      });
      docs.forEach((d) => {
        html += renderDocRow(p, d, depth + 1);
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderDocTree() {
    const root = document.getElementById('studioDocTree');
    const p = getProject();
    if (!root || !p) return;
    normalizeProject(p);
    if (!p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    const roots = getChildFolders(p, null);
    let html = roots.map((fld) => renderFolderNode(p, fld, 0)).join('');
    root.innerHTML =
      html ||
      '<p class="panel-hint">点击右上角 + 新建文件夹；文件夹右侧 + 新建文档</p>';
    root.querySelectorAll('.studio-doc-folder-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.activeFolderId = btn.dataset.folderId;
        saveState();
        renderDocTree();
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        startInlineRenameFolder(btn.dataset.folderId);
      });
    });
    root.querySelectorAll('[data-add-doc-in]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startInlineNewDoc(btn.dataset.addDocIn);
      });
    });
    bindInlineRenameInputs(root);
    root.querySelectorAll('[data-toggle-folder]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fld = p.folders.find((f) => f.id === btn.dataset.toggleFolder);
        if (!fld) return;
        fld.collapsed = !fld.collapsed;
        saveState();
        renderDocTree();
      });
    });
    root.querySelectorAll('.studio-doc-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.activeDocId = btn.dataset.docId;
        if (btn.dataset.folderId) p.activeFolderId = btn.dataset.folderId;
        saveState();
        renderAll();
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        startInlineRenameDoc(btn.dataset.docId);
      });
    });
    root.querySelectorAll('.studio-doc-folder-row').forEach((row) => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const folderId = row.dataset.folderId;
        showTreeMenu(
          e.clientX,
          e.clientY,
          [
            { action: 'new-doc', label: '新建文档' },
            { action: 'new-folder', label: '新建子文件夹' },
            { action: 'rename', label: '重命名' },
            { action: 'delete', label: '删除', danger: true }
          ],
          (action) => {
            if (action === 'new-doc') startInlineNewDoc(folderId);
            else if (action === 'new-folder') startInlineNewFolder(folderId);
            else if (action === 'rename') startInlineRenameFolder(folderId);
            else if (action === 'delete') void deleteFolderById(folderId);
          }
        );
      });
    });
    root.querySelectorAll('.studio-doc-row').forEach((row) => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const docId = row.dataset.docId;
        showTreeMenu(
          e.clientX,
          e.clientY,
          [
            { action: 'rename', label: '重命名' },
            { action: 'delete', label: '删除', danger: true }
          ],
          (action) => {
            if (action === 'rename') startInlineRenameDoc(docId);
            else if (action === 'delete') void deleteDocById(docId);
          }
        );
      });
    });
    bindDocTreeDragDrop(root, p);
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getHeroMentionTitles(doc) {
    if (!doc?.heroCardIds?.length) return [];
    return doc.heroCardIds
      .map((id) => getCard(id))
      .filter(Boolean)
      .map((c) => ({ id: c.id, title: (c.title || '').trim() }))
      .filter((t) => t.title.length >= 2)
      .sort((a, b) => b.title.length - a.title.length);
  }

  function updateCardChrome(cardId, title) {
    const safeTitle = title || '未命名';
    const layer = document.getElementById('studioFloatLayer');
    const floatHead = layer?.querySelector(`.studio-float-card[data-card-id="${cardId}"] .studio-float-head span`);
    if (floatHead) floatHead.textContent = safeTitle;
    if (detailCardId === cardId) {
      const head = document.getElementById('studioCardDetailTitle');
      if (head) head.textContent = safeTitle;
    }
    document.querySelectorAll(`.studio-hero-thumb[data-card-id="${cardId}"]`).forEach((el) => {
      el.title = `${safeTitle} · 点击唤出卡片`;
    });
  }

  function wrapMentionInTextNode(textNode, title, cardId) {
    const text = textNode.textContent || '';
    const idx = text.indexOf(title);
    if (idx === -1) return false;
    const parent = textNode.parentNode;
    if (!parent) return false;
    const before = text.slice(0, idx);
    const after = text.slice(idx + title.length);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    const span = document.createElement('span');
    span.className = 'studio-mention';
    span.dataset.mention = cardId;
    span.textContent = title;
    frag.appendChild(span);
    const afterNode = document.createTextNode(after);
    frag.appendChild(afterNode);
    parent.replaceChild(frag, textNode);
    if (after.includes(title)) wrapMentionInTextNode(afterNode, title, cardId);
    return true;
  }

  function applyHeroMentionsInEditor() {
    const editor = document.getElementById('studioEditor');
    const doc = getActiveDoc();
    if (!editor || !doc || isViewOnly() || mentionApplying) return;
    mentionApplying = true;
    try {
      editor.querySelectorAll('.studio-mention').forEach((span) => {
        span.replaceWith(document.createTextNode(span.textContent || ''));
      });
      editor.normalize();
      const titles = getHeroMentionTitles(doc);
      titles.forEach(({ id, title }) => {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((tn) => {
          if (tn.parentElement?.closest('.studio-mention')) return;
          if ((tn.textContent || '').includes(title)) wrapMentionInTextNode(tn, title, id);
        });
      });
      doc.bodyHtml = editor.innerHTML;
    } finally {
      mentionApplying = false;
    }
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function scheduleApplyHeroMentions() {
    clearTimeout(mentionApplyTimer);
    mentionApplyTimer = setTimeout(() => {
      applyHeroMentionsInEditor();
    }, 320);
  }

  function removeHeroCard(cardId) {
    if (!guardEdit()) return;
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    doc.heroCardIds = doc.heroCardIds.filter((id) => id !== cardId);
    if (Array.isArray(c.docs)) c.docs = c.docs.filter((id) => id !== doc.id);
    if (Array.isArray(doc.closedFloatIds)) {
      doc.closedFloatIds = doc.closedFloatIds.filter((id) => id !== cardId);
    }
    if (doc.floatPositions && doc.floatPositions[cardId]) {
      delete doc.floatPositions[cardId];
    }
    document
      .getElementById('studioFloatLayer')
      ?.querySelector(`.studio-float-card[data-card-id="${cardId}"]`)
      ?.remove();
    saveState();
    renderEditor();
  }

  function renderEditor() {
    const doc = getActiveDoc();
    const p = getProject();
    if (!doc) return;
    const titleEl = document.getElementById('studioDocTitle');
    const editor = document.getElementById('studioEditor');
    const meta = document.getElementById('studioDocMeta');
    const hero = document.getElementById('studioHeroThumbs');
    const heroHint = document.getElementById('studioHeroHint');
    if (heroHint) {
      heroHint.textContent = '关联图';
      heroHint.title = p.heroFieldLabel || DEFAULT_HERO_LABEL;
    }
    if (titleEl) titleEl.value = doc.title || '';
    if (meta) meta.textContent = `${p.name} · ${doc.heroCardIds.length} 张关联卡`;
    if (hero) {
      hero.innerHTML = doc.heroCardIds
        .map((id) => {
          const c = getCard(id);
          if (!c) return '';
          const initialSrc = c.image ? studioImageInitialSrc(c.image) : '';
          const inner = c.image
            ? `<img src="${initialSrc ? esc(initialSrc) : ''}" data-image-ref="${esc(c.image)}" alt=""${initialSrc ? ' data-loaded="1"' : ''}>`
            : `<div class="studio-hero-thumb-fallback" style="--card-hue:${c.hue || 210}"></div>`;
          return `<div class="studio-hero-thumb-wrap">
            <div class="studio-hero-thumb" data-card-id="${esc(id)}" title="${esc(c.title)} · 点击唤出卡片">${inner}</div>
            <button type="button" class="studio-hero-remove" data-remove-hero="${esc(id)}" aria-label="移出">×</button>
          </div>`;
        })
        .join('');
      void hydrateStudioCardImages(hero);
      hero.querySelectorAll('.studio-hero-thumb[data-card-id]').forEach((el) => {
        el.addEventListener('click', () => openFloatCardForHero(el.dataset.cardId));
      });
      hero.querySelectorAll('[data-remove-hero]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeHeroCard(btn.dataset.removeHero);
        });
      });
    }
    if (editor && editor.dataset.docId !== doc.id) {
      editor.dataset.docId = doc.id;
      editor.innerHTML = doc.bodyHtml || doc.body || '';
      scheduleApplyHeroMentions();
    }
    renderFloatCards(doc);
    scheduleApplyHeroMentions();
  }

  function openFloatCardForHero(cardId) {
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    if (!Array.isArray(doc.closedFloatIds)) doc.closedFloatIds = [];
    doc.closedFloatIds = doc.closedFloatIds.filter((id) => id !== cardId);
    const layer = document.getElementById('studioFloatLayer');
    const existing = layer?.querySelector(`.studio-float-card[data-card-id="${cardId}"]`);
    if (existing) {
      existing.style.zIndex = String(++floatZ);
      return;
    }
    const idx = doc.heroCardIds.indexOf(cardId);
    const pos = doc.floatPositions?.[cardId] || { x: 420 + Math.max(0, idx) * 36, y: 80 + Math.max(0, idx) * 48 };
    spawnFloatCard(c, pos.x, pos.y);
    saveState();
  }

  function renderFloatCards(doc) {
    const layer = document.getElementById('studioFloatLayer');
    if (!layer || !doc) return;
    const closed = new Set(doc.closedFloatIds || []);
    layer.querySelectorAll('.studio-float-card').forEach((el) => {
      if (!doc.heroCardIds.includes(el.dataset.cardId)) el.remove();
    });
    doc.heroCardIds.forEach((id, idx) => {
      if (closed.has(id)) return;
      if (layer.querySelector(`.studio-float-card[data-card-id="${id}"]`)) return;
      const c = getCard(id);
      if (!c) return;
      const pos = doc.floatPositions?.[id] || { x: 420 + idx * 36, y: 80 + idx * 48 };
      spawnFloatCard(c, pos.x, pos.y);
    });
  }

  function spawnFloatCard(card, x, y) {
    const layer = document.getElementById('studioFloatLayer');
    const doc = getActiveDoc();
    if (!layer || !card) return;
    const el = document.createElement('div');
    el.className = 'studio-float-card';
    el.dataset.cardId = card.id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.zIndex = String(++floatZ);
    const floatSrc = card.image ? studioImageInitialSrc(card.image) : '';
    const thumb = card.image
      ? `<img src="${floatSrc ? esc(floatSrc) : ''}" data-image-ref="${esc(card.image)}" alt=""${floatSrc ? ' data-loaded="1"' : ''}>`
      : `<div class="studio-float-thumb-fallback" style="--card-hue:${card.hue || 210}"></div>`;
    el.innerHTML = `
      <div class="studio-float-head">
        <span>${esc(card.title)}</span>
        <button type="button" class="studio-float-close" aria-label="关闭">×</button>
      </div>
      <div class="studio-float-body">
        <div class="studio-float-thumb">${thumb}</div>
        <div class="studio-float-info">${esc(card.background || card.prompt || '暂无设定')}</div>
        <div class="studio-float-hint">双击查看完整设定与关联文档</div>
      </div>`;
    layer.appendChild(el);
    el.querySelector('.studio-float-close')?.addEventListener('click', () => {
      el.remove();
      if (doc) {
        if (!doc.closedFloatIds) doc.closedFloatIds = [];
        if (!doc.closedFloatIds.includes(card.id)) doc.closedFloatIds.push(card.id);
        saveState();
        maybeCompletePresetTour(doc);
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.studio-float-head')) return;
      e.preventDefault();
      el.classList.add('dragging');
      const ox = e.clientX - el.offsetLeft;
      const oy = e.clientY - el.offsetTop;
      const move = (ev) => {
        el.style.left = `${ev.clientX - ox}px`;
        el.style.top = `${ev.clientY - oy}px`;
      };
      const up = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (doc) {
          if (!doc.floatPositions) doc.floatPositions = {};
          doc.floatPositions[card.id] = { x: el.offsetLeft, y: el.offsetTop };
          saveState();
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    el.querySelector('.studio-float-body')?.addEventListener('dblclick', () => openCardDetailPanel(card.id));
    void hydrateStudioCardImages(el);
  }

  function docExcerpt(doc) {
    const raw = doc.bodyHtml || doc.body || '';
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '（文档暂无正文）';
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  }

  function warehouseCardHtml(c) {
    const hue = c.hue || 210;
    const media = c.image && String(c.image).trim()
      ? `<img class="card-img" src="" data-image-ref="${esc(c.image)}" alt="">`
      : `<div class="card-media-placeholder"></div>`;
    const tags = [cardFolderName(c)].filter((t) => t && t !== '未分类');
    return `
      <div class="card studio-wh-card" style="--card-hue:${hue}">
        <div class="card-media">${media}</div>
        <div class="card-body">
          <div class="card-head"><div class="card-title">${esc(c.title)}</div></div>
          <div class="card-desc">${esc(c.prompt || c.background || '暂无描述')}</div>
          <div class="card-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>`;
  }

  function closeCardDetailPanel() {
    const root = document.getElementById('studioCardDetail');
    if (!root) return;
    root.classList.add('hidden');
    detailCardId = null;
    document.body.style.overflow = '';
  }

  function jumpToDoc(docId) {
    const p = getProject();
    if (!p?.docs.some((d) => d.id === docId)) return;
    p.activeDocId = docId;
    saveState();
    closeCardDetailPanel();
    renderAll();
    setStatus('已跳转到关联文档');
  }

  function saveCardFromDetail() {
    if (!guardEdit()) return;
    if (!detailCardId) return;
    const c = getCard(detailCardId);
    const root = document.getElementById('studioCardDetailBody');
    if (!c || !root) return;
    c.title = root.querySelector('[data-field="title"]')?.value?.trim() || '未命名';
    c.prompt = root.querySelector('[data-field="prompt"]')?.value?.trim() || '';
    c.background = root.querySelector('[data-field="background"]')?.value?.trim() || '';
    c.character = root.querySelector('[data-field="character"]')?.value?.trim() || '';
    c.relations = root.querySelector('[data-field="relations"]')?.value?.trim() || '';
    if (!c.customFields) c.customFields = {};
    getProjectGlobalFields().forEach((f) => {
      const el = root.querySelector(`[data-custom-field="${CSS.escape(f.name)}"]`);
      if (el) c.customFields[f.name] = el.value.trim();
    });
    saveState();
    updateCardChrome(detailCardId, c.title);
    renderAssetFolders();
    renderEditor();
    scheduleApplyHeroMentions();
    setStatus('卡片设定已保存');
  }

  function buildCardDetailFieldsHtml(c, readonly) {
    const labels = getProjectFieldLabels();
    const ro = readonly ? ' readonly' : '';
    const coreMeta = {
      title: { type: 'text', cls: 'studio-card-title-input' },
      prompt: { type: 'textarea', cls: 'mono studio-prompt-view', rows: 6 },
      background: { type: 'textarea', rows: 3 },
      character: { type: 'textarea', rows: 3 },
      relations: { type: 'textarea', rows: 2 }
    };
    const values = {
      title: c.title || '',
      prompt: c.prompt || '',
      background: c.background || '',
      character: c.character || '',
      relations: c.relations || ''
    };
    let html = '';
    html += getCoreFieldOrder()
      .map((key) => {
        const meta = coreMeta[key];
        if (!meta) return '';
        const f = { key, ...meta, label: labels[key] || DEFAULT_FIELD_LABELS[key], value: values[key] || '' };
        const id = `studioField_${f.key}`;
        const input =
          f.type === 'text'
            ? `<input type="text" id="${id}" class="${f.cls || ''}" data-field="${f.key}" value="${esc(f.value)}"${ro}>`
            : `<textarea id="${id}" class="${f.cls || ''}" data-field="${f.key}" rows="${f.rows || 3}"${ro}>${esc(f.value)}</textarea>`;
        return `<div class="studio-info-section${f.key === 'prompt' ? ' studio-info-section--prompt' : ''}">
          <label for="${id}">${esc(f.label)}</label>
          ${input}
        </div>`;
      })
      .join('');
    getProjectGlobalFields().forEach((f) => {
      const val = esc((c.customFields && c.customFields[f.name]) || '');
      const id = `studioCustom_${f.id}`;
      const input =
        f.type === 'textarea'
          ? `<textarea id="${id}" data-custom-field="${esc(f.name)}" rows="3"${ro}>${val}</textarea>`
          : `<input type="text" id="${id}" data-custom-field="${esc(f.name)}" value="${val}"${ro}>`;
      html += `<div class="studio-info-section">
        <label for="${id}">${esc(f.name)}</label>
        ${input}
      </div>`;
    });
    return html;
  }

  function bindCardDetailFieldSettings(root) {
    root?.querySelectorAll('[data-action="open-field-settings"]').forEach((btn) => {
      btn.addEventListener('click', () => openFieldSettings());
    });
  }

  function openCardDetailPanel(cardId) {
    const c = getCard(cardId);
    const root = document.getElementById('studioCardDetail');
    const body = document.getElementById('studioCardDetailBody');
    const titleEl = document.getElementById('studioCardDetailTitle');
    if (!c || !root || !body) return;
    detailCardId = cardId;
    const p = getProject();
    const linkedDocs = (c.docs || []).map((id) => p.docs.find((d) => d.id === id)).filter(Boolean);
    if (titleEl) titleEl.textContent = c.title || '卡片详情';
    const docLinksHtml = linkedDocs.length
      ? linkedDocs
          .map(
            (d) => `
        <div class="studio-doc-link-item">
          <span>${esc(d.title)} — ${esc(docExcerpt(d))}</span>
          <button type="button" data-goto-doc="${esc(d.id)}">打开文档</button>
        </div>`
          )
          .join('')
      : '<p class="panel-hint" style="margin:0">暂无关联文档。拖入写作区首字段后会自动关联当前文档。</p>';
    const readonly = isViewOnly();
    body.innerHTML = `
      <div class="studio-card-detail-compose">
        <div class="studio-card-float studio-card-float--visual">
          ${cardDetailThumbHtml(c)}
          <p class="studio-card-float-caption">参考图 · 来自卡片库</p>
        </div>
        <div class="studio-card-bridge" aria-hidden="true">
          <div class="studio-card-bridge-line"></div>
          <div class="studio-card-bridge-node studio-card-bridge-node--a"></div>
          <div class="studio-card-bridge-link" title="卡片与设定文档关联"></div>
          <div class="studio-card-bridge-node studio-card-bridge-node--b"></div>
        </div>
        <div class="studio-card-float studio-card-float--info">
          <div class="studio-card-float-head">
            <div>
              <span class="studio-card-float-kicker">设定文档</span>
              <p class="studio-card-float-hint">拖入写作区后，此处字段会随卡片一起被 AI 与生图引用</p>
            </div>
            ${readonly ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-action="open-field-settings">字段设置</button>'}
          </div>
          <div class="studio-card-detail-info">
            ${buildCardDetailFieldsHtml(c, readonly)}
            <div class="studio-doc-links">
              <h3>关联文档</h3>
              ${docLinksHtml}
            </div>
          </div>
        </div>
      </div>`;
    const saveBtn = document.getElementById('studioCardSaveBtn');
    const fieldBtn = document.getElementById('studioCardFieldSettingsBtn');
    if (saveBtn) saveBtn.style.display = readonly ? 'none' : '';
    if (fieldBtn) fieldBtn.style.display = readonly ? 'none' : '';
    bindCardDetailFieldSettings(body);
    body.querySelectorAll('[data-goto-doc]').forEach((btn) => {
      btn.addEventListener('click', () => jumpToDoc(btn.dataset.gotoDoc));
    });
    body.querySelector('[data-field="title"]')?.addEventListener('input', (e) => {
      const title = e.target.value.trim() || '未命名';
      updateCardChrome(cardId, title);
    });
    root.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    void hydrateStudioCardImages(body.querySelector('.studio-card-float--visual'));
  }

  function bindCardDrag(nodes) {
    nodes.forEach((node) => {
      let press = null;
      node.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        press = { x: e.clientX, y: e.clientY };
      });
      node.addEventListener('dragstart', (e) => {
        press = null;
        if (isViewOnly() && !allowsStudioDemoInteract()) {
          e.preventDefault();
          return;
        }
        dragCardId = node.dataset.cardId;
        e.dataTransfer.setData('text/plain', dragCardId);
        e.dataTransfer.effectAllowed = 'copy';
      });
      node.addEventListener('dragend', () => {
        dragCardId = null;
      });
      node.addEventListener('click', (e) => {
        if (!press) return;
        const dx = Math.abs(e.clientX - press.x);
        const dy = Math.abs(e.clientY - press.y);
        press = null;
        if (dx > 6 || dy > 6) return;
        e.preventDefault();
        openCardDetailPanel(node.dataset.cardId);
      });
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openCardDetailPanel(node.dataset.cardId);
        }
      });
    });
  }

  function addCardToDoc(cardId) {
    if (!guardEdit('请先登录后拖入卡片关联文档')) return;
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    if (!doc.heroCardIds.includes(cardId)) {
      doc.heroCardIds.push(cardId);
      if (!c.docs.includes(doc.id)) c.docs.push(doc.id);
      if (!Array.isArray(doc.closedFloatIds)) doc.closedFloatIds = [];
      doc.closedFloatIds = doc.closedFloatIds.filter((id) => id !== cardId);
    }
    if (!doc.bodyHtml && !doc.body) doc.bodyHtml = '';
    saveState();
    renderAll();
    openFloatCardForHero(cardId);
    try {
      localStorage.setItem('promptrepo_task_asset_studio_link', '1');
    } catch (e) { /* ignore */ }
    if (window.PromptHubApi?.syncMembershipTasks) {
      void window.PromptHubApi.syncMembershipTasks({ assetStudioLinkCard: true });
    }
  }

  function getActiveFolderId() {
    const p = getProject();
    if (!p) return '';
    if (p.activeFolderId && p.folders.some((f) => f.id === p.activeFolderId)) return p.activeFolderId;
    return getChildFolders(p, null)[0]?.id || p.folders[0]?.id || '';
  }

  async function renameFolderById(folderId) {
    if (!guardEdit()) return;
    const p = getProject();
    const fld = p.folders.find((f) => f.id === folderId);
    if (!fld) return;
    const name = await studioPrompt('重命名分类', '分类名称', fld.name);
    if (!name?.trim()) return;
    fld.name = name.trim().slice(0, 20);
    saveState();
    renderDocTree();
  }

  async function renameDocById(docId) {
    if (!guardEdit()) return;
    const p = getProject();
    const doc = p.docs.find((d) => d.id === docId);
    if (!doc) return;
    const name = await studioPrompt('重命名文档', '文档名称', doc.title || '新文档');
    if (!name?.trim()) return;
    doc.title = name.trim().slice(0, 40);
    saveState();
    renderDocTree();
    renderEditor();
  }

  function readMainSiteGroups() {
    try {
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
      const key = uid ? `promptrepo_groups_${uid}` : 'promptrepo_groups';
      const g = localStorage.getItem(key) || localStorage.getItem('promptrepo_groups');
      return g ? JSON.parse(g) : [];
    } catch (e) {
      return [];
    }
  }

  async function openMainCardsDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('PromptRepoDB', 3);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function loadMainSiteCardsList() {
    try {
      const db = await openMainCardsDb();
      const rows = await new Promise((resolve) => {
        const tx = db.transaction(['cards'], 'readonly');
        const req = tx.objectStore('cards').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
      const idbOwner = localStorage.getItem('promptrepo_idb_owner_uid') || '';
      if (uid && idbOwner && idbOwner !== uid && idbOwner !== 'guest') return [];
      return rows;
    } catch (e) {
      return [];
    }
  }

  async function saveMainSiteCardsList(cardsArray) {
    const db = await openMainCardsDb();
    const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['cards'], 'readwrite');
      const store = tx.objectStore('cards');
      store.clear();
      cardsArray.forEach((c) => store.put(c));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    if (uid) localStorage.setItem('promptrepo_idb_owner_uid', uid);
  }

  function mainSiteStorageKey(name) {
    const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
    return uid ? `promptrepo_${name}_${uid}` : `promptrepo_${name}`;
  }

  async function mergeCardIntoMainAutosave(card) {
    try {
      const keys = [
        mainSiteStorageKey('autosave'),
        mainSiteStorageKey('snapshot'),
        'promptrepo_autosave_snapshot'
      ];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const payload = JSON.parse(raw);
        const cards = Array.isArray(payload.cards) ? payload.cards : [];
        if (cards.some((c) => c.id === card.id || (card.genJobId && c.genJobId === card.genJobId))) return;
        cards.unshift(card);
        payload.cards = cards;
        localStorage.setItem(key, JSON.stringify(payload));
        break;
      }
    } catch (e) { /* ignore */ }
  }

  function studioMainCardId() {
    return `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async function addCardToMainWarehouse(opts) {
    const { prompt, image, title, jobId } = opts || {};
    if (!image && !(prompt || '').trim()) return { ok: false };
    const mainCards = await loadMainSiteCardsList();
    if (jobId && mainCards.some((c) => c.genJobId === jobId)) {
      const existing = mainCards.find((c) => c.genJobId === jobId);
      return { ok: true, duplicate: true, cardId: existing?.id, card: existing };
    }
    const cardId = studioMainCardId();
    let storedImage = image || null;
    if (storedImage && window.SupabaseSync?.persistGenerationImage) {
      try {
        storedImage = await window.SupabaseSync.persistGenerationImage(cardId, storedImage);
      } catch (e) { /* 保留原始链接 */ }
    }
    const promptText = (prompt || '').trim();
    const card = {
      id: cardId,
      title: (title || promptText.slice(0, 24) || '生图').trim(),
      prompt: promptText,
      image: storedImage,
      group: null,
      tags: ['图片生成'],
      customFields: {},
      genJobId: jobId || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    mainCards.unshift(card);
    await saveMainSiteCardsList(mainCards);
    await mergeCardIntoMainAutosave(card);
    if (window.SupabaseSync?.isLoggedIn?.() && window.SupabaseSync?.pushCloudData) {
      try {
        await window.SupabaseSync.pushCloudData(
          {
            cards: mainCards,
            customGroups: readMainSiteGroups(),
            globalFields: [],
            settings: {}
          },
          { skipSafety: true, allowWithoutCloudCheck: true }
        );
      } catch (e) { /* 本地已保存 */ }
    }
    return { ok: true, cardId: card.id, card };
  }

  async function saveStudioGenToLibraries(opts) {
    const res = await addCardToMainWarehouse(opts);
    if (!res.ok) return res;
    const normalized = normalizeImportedCard(res.card);
    const cards = getProjectCards();
    const exists = cards.some(
      (c) => c.id === normalized.id || (opts.jobId && c.id === res.cardId)
    );
    if (!exists) {
      cards.unshift(normalized);
      saveState();
      renderAssetFolders();
    }
    return res;
  }

  async function readCardsFromPromptHubIdb() {
    return loadMainSiteCardsList();
  }

  function readCardsFromLocalAutosave() {
    try {
      const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
      const keys = uid
        ? [`promptrepo_autosave_${uid}`, `promptrepo_snapshot_${uid}`]
        : ['promptrepo_autosave_snapshot'];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const payload = JSON.parse(raw);
        const cards = payload?.cards || payload?.payload?.cards;
        if (Array.isArray(cards) && cards.length) return cards;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  async function fetchMainSiteCardsPayload() {
    let list = window.__promptHubCards;
    if ((!Array.isArray(list) || !list.length) && window.opener && !window.opener.closed) {
      list = window.opener.__promptHubCards;
    }
    if (Array.isArray(list) && list.length) {
      return { cards: list, groups: readMainSiteGroups() };
    }
    const idbRows = await readCardsFromPromptHubIdb();
    if (idbRows.length) return { cards: idbRows, groups: readMainSiteGroups() };
    const autosave = readCardsFromLocalAutosave();
    if (autosave.length) return { cards: autosave, groups: readMainSiteGroups() };
    return { cards: [], groups: [] };
  }

  function stageMainSiteImport(payload) {
    const list = (payload.cards || []).slice(0, 200).map((c) => ({
      id: c.id,
      title: c.title,
      prompt: c.prompt,
      image: c.image,
      group: c.group,
      tags: c.tags,
      background: c.background,
      character: c.character,
      relations: c.relations,
      customFields: c.customFields
    }));
    if (!list.length) return 0;
    try {
      localStorage.setItem(LS_IMPORT, JSON.stringify({
        cards: list,
        groups: Array.isArray(payload.groups) ? payload.groups : []
      }));
      return list.length;
    } catch (e) {
      return 0;
    }
  }

  async function importCardsFromMainSiteDirect() {
    const payload = await fetchMainSiteCardsPayload();
    if (!payload.cards.length) return 0;
    stageMainSiteImport(payload);
    return mergeImportFromMain(false);
  }

  let studioLastGenImage = '';
  let studioLastGenPrompt = '';
  let studioLastGenJobId = '';

  function updateStudioCreditsBadge() {
    const el = document.getElementById('studioCreditsBadge');
    if (!el) return;
    const n = window.PointsSystem?.getCredits?.() ?? 0;
    el.innerHTML = `积分 <strong>${n}</strong>`;
  }

  function formatStudioLedgerTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  async function toggleStudioCreditLedger() {
    const panel = document.getElementById('studioCreditLedgerPanel');
    if (!panel) return;
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      setStatus('请先登录后查看积分明细');
      return;
    }
    if (!window.PromptHubApi?.isConfigured?.()) {
      panel.classList.remove('hidden');
      panel.innerHTML = '<p class="credit-ledger-empty">未连接云端 API，当前为本地积分模式。</p>';
      return;
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<p class="credit-ledger-empty">加载中…</p>';
    const r = await window.PromptHubApi.getLedger(20);
    if (!r.ok) {
      panel.innerHTML = `<p class="credit-ledger-empty">${esc(r.message || '加载失败')}</p>`;
      return;
    }
    const items = r.data?.items || [];
    if (!items.length) {
      panel.innerHTML = '<p class="credit-ledger-empty">暂无积分流水</p>';
      return;
    }
    panel.innerHTML = items
      .map((row) => {
        const sign = row.delta >= 0 ? '+' : '';
        return `<div class="credit-ledger-row">
        <span class="credit-ledger-delta ${row.delta >= 0 ? 'plus' : 'minus'}">${sign}${row.delta}</span>
        <span class="credit-ledger-meta">${esc(row.reasonLabel || row.reason)} · 余额 ${row.balanceAfter}</span>
        <span class="credit-ledger-time">${formatStudioLedgerTime(row.createdAt)}</span>
      </div>`;
      })
      .join('');
  }

  function buildStudioDocContext(extra) {
    const doc = getActiveDoc();
    if (!doc) return extra || '';
    const heroes = (doc.heroCardIds || []).map((id) => getCard(id)).filter(Boolean);
    const bodyText = (doc.bodyHtml || doc.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = [`【文档】${doc.title || '未命名'}`];
    if (heroes.length) {
      parts.push('【关联卡片】');
      heroes.forEach((c) => {
        parts.push(`- ${c.title}：${(c.prompt || c.background || '').slice(0, 200)}`);
      });
    }
    if (bodyText) parts.push(`【正文】${bodyText.slice(0, 900)}`);
    if (extra) parts.push(`【补充】${extra}`);
    return parts.join('\n');
  }

  function appendChatMessage(className, html) {
    const log = document.getElementById('studioChatLog');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function bindChatActionButtons(root) {
    if (!root) return;
    root.querySelector('[data-copy-context]')?.addEventListener('click', () => {
      const text = root.querySelector('.studio-chat-context')?.textContent || '';
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => setStatus('上下文已复制'),
        () => setStatus('复制失败')
      );
    });
    root.querySelector('[data-fill-image]')?.addEventListener('click', () => {
      const text = root.querySelector('.studio-chat-context')?.textContent || '';
      const ta = document.getElementById('studioImagePrompt');
      if (ta && text) {
        ta.value = text.slice(0, 4000);
        document.querySelector('[data-ai-tab="image"]')?.click();
        setStatus('已填入生图面板');
      }
    });
  }

  function onStudioChatContext() {
    const ctx = buildStudioDocContext();
    if (!ctx) {
      setStatus('当前无文档内容');
      return;
    }
    const block = appendChatMessage(
      'studio-chat-msg assistant',
      `<p>当前文档上下文（发送消息时会自动附带）：</p><pre class="studio-chat-context">${esc(ctx)}</pre>
      <div class="studio-chat-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-copy-context>复制</button>
        <button type="button" class="btn btn-secondary btn-sm" data-fill-image>填入生图</button>
      </div>`
    );
    bindChatActionButtons(block);
  }

  const CHAT_COST_HINTS = {
    'deepseek-v4-flash': { input: '769万', output: '385万', outputThink: '333万' },
    'deepseek-v4-pro': { input: '64.1万', output: '32.1万', outputThink: '27.8万' }
  };

  function getStudioChatOptions() {
    const model = document.getElementById('studioChatModel')?.value || 'deepseek-v4-flash';
    const thinking = !!document.getElementById('studioChatThinking')?.checked;
    return { model, thinking };
  }

  function updateStudioChatCostHint() {
    const hint = document.getElementById('studioChatCostHint');
    if (!hint) return;
    const { model, thinking } = getStudioChatOptions();
    const table = CHAT_COST_HINTS[model] || CHAT_COST_HINTS['deepseek-v4-flash'];
    const outKey = thinking ? table.outputThink : table.output;
    const modelLabel = model === 'deepseek-v4-pro' ? 'Pro' : 'Flash';
    hint.textContent = `${modelLabel}${thinking ? ' · 思考模式' : ''} · 1000 积分约输入 ${table.input} / 输出 ${outKey} token · 按实际用量计费`;
    void refreshStudioChatCostFromApi();
  }

  async function refreshStudioChatCostFromApi() {
    const hint = document.getElementById('studioChatCostHint');
    if (!hint || !window.PromptHubApi?.studioChatQuote) return;
    const { model, thinking } = getStudioChatOptions();
    try {
      const quote = await window.PromptHubApi.studioChatQuote({ model, thinking });
      if (!quote?.ok || !quote.data) return;
      const d = quote.data;
      const disc = d.discountLabel ? ` · 会员${d.discountLabel}` : '';
      hint.textContent = `${d.modelLabel || model}${thinking ? ' · 思考' : ''} · 预估单次约 ${d.final} 积分${disc} · 按实际 token 计费`;
    } catch (e) { /* 保留本地提示 */ }
  }

  async function onStudioChatSend() {
    if (studioChatBusy) return;
    const input = document.getElementById('studioChatInput');
    const text = input?.value?.trim();
    if (!text) return;
    if (!guardEdit('请先登录后使用 AI 对话')) return;
    if (!window.PromptHubApi?.studioChat) {
      setStatus('对话 API 未加载，请刷新页面');
      return;
    }
    appendChatMessage('studio-chat-msg user', `<p>${esc(text)}</p>`);
    input.value = '';
    const msgs = getChatMessages();
    msgs.push({ role: 'user', content: text });
    persistChatMessages();
    const loadingEl = appendChatMessage('studio-chat-msg assistant loading', '<p>思考中…</p>');
    studioChatBusy = true;
    document.getElementById('studioChatSend')?.setAttribute('disabled', 'true');
    try {
      const p = getProject();
      const thread = getActiveChatThread();
      const attachContext = p.chatAttachDoc !== false;
      const noPreset = thread.usePreset === false;
      const ctx = attachContext ? buildStudioDocContext() : '';
      const { model, thinking } = getStudioChatOptions();
      const res = await window.PromptHubApi.studioChat({
        messages: msgs.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        context: ctx || undefined,
        attachContext,
        noPreset,
        model,
        thinking
      });
      loadingEl?.remove();
      if (!res?.ok) {
        msgs.pop();
        persistChatMessages();
        appendChatMessage(
          'studio-chat-msg assistant',
          `<p class="panel-hint">${esc(res?.message || '对话失败，请检查登录与会员状态')}</p>`
        );
        setStatus(res?.message || '对话失败');
        return;
      }
      const reply = String(res.data?.reply || '').trim();
      if (!reply) {
        msgs.pop();
        persistChatMessages();
        appendChatMessage('studio-chat-msg assistant', '<p class="panel-hint">未收到回复，请重试</p>');
        return;
      }
      msgs.push({ role: 'assistant', content: reply });
      persistChatMessages();
      if (typeof res.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(res.data.creditsRemaining);
      }
      updateStudioCreditsBadge();
      const charged = res.data?.creditsCharged;
      const block = appendChatMessage(
        'studio-chat-msg assistant',
        `<pre class="studio-chat-context">${esc(reply)}</pre>
        <div class="studio-chat-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-copy-context>复制</button>
          <button type="button" class="btn btn-secondary btn-sm" data-fill-image>填入生图</button>
        </div>${charged ? `<p class="panel-hint studio-chat-charged">消耗 ${charged} 积分</p>` : ''}`
      );
      bindChatActionButtons(block);
    } catch (e) {
      loadingEl?.remove();
      const msgsErr = getChatMessages();
      if (msgsErr.length && msgsErr[msgsErr.length - 1].role === 'user') msgsErr.pop();
      persistChatMessages();
      appendChatMessage(
        'studio-chat-msg assistant',
        `<p class="panel-hint">${esc(e?.message || '网络错误')}</p>`
      );
      setStatus(e?.message || '对话失败');
    } finally {
      studioChatBusy = false;
      document.getElementById('studioChatSend')?.removeAttribute('disabled');
    }
  }

  function fillStudioImageFromDoc() {
    const doc = getActiveDoc();
    const ta = document.getElementById('studioImagePrompt');
    if (!ta || !doc) return;
    const heroes = (doc.heroCardIds || []).map((id) => getCard(id)).filter(Boolean);
    const heroPrompt = heroes.map((c) => c.prompt).filter(Boolean).join('，');
    const body = (doc.bodyHtml || doc.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    ta.value = (heroPrompt || body || doc.title || '').slice(0, 4000);
    setStatus('已从文档填入提示词');
  }

  async function pollStudioImageJob(jobId) {
    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await window.PromptHubApi?.getGenerationJob?.(jobId);
      if (!res?.ok) continue;
      const data = res.data || {};
      if (data.status === 'completed' && (data.imageUrl || data.image)) {
        return data.imageUrl || data.image;
      }
      if (data.status === 'failed') throw new Error(data.error || data.message || '生图失败');
    }
    throw new Error('生图耗时较长，请稍后在主站「图片生成」查看');
  }

  async function runStudioImageGen() {
    if (!guardEdit('请先登录后生图')) return;
    const promptEl = document.getElementById('studioImagePrompt');
    const btn = document.getElementById('studioImageSubmit');
    const hint = document.getElementById('studioImageHint');
    const prompt = promptEl?.value?.trim();
    if (!prompt || prompt.length < 4) {
      setStatus('请输入至少 4 个字的提示词');
      return;
    }
    const model = document.getElementById('studioImageModel')?.value || 'quanneng2';
    const resolution = document.getElementById('studioImageResolution')?.value || '1k';
    const size = document.getElementById('studioImageSize')?.value || '1:1';
    const quality = 'standard';
    updateStudioImageGenCostHint();
    let cost = studioImageGenCost;
    let balance = window.PointsSystem?.getCredits?.() ?? 0;
    const useApi = window.PointsSystem?.useApiForAccount?.();
    if (useApi) {
      await window.PointsSystem?.refreshCreditsFromServer?.();
      balance = window.PointsSystem?.getCredits?.() ?? 0;
      const quote = await window.PromptHubApi?.getGenerationCost?.(resolution, quality, model);
      if (quote?.ok && quote.data?.final != null) {
        cost = quote.data.final;
        studioImageGenCost = cost;
      }
    }
    if (balance < cost) {
      setStatus(`积分不足（需要 ${cost}，当前 ${balance}）`);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中…';
    }
    if (hint) hint.textContent = `提交中… 预计消耗 ${cost} 积分`;
    setStudioImageGenPending(true);
    const addBtn = document.getElementById('studioImageAddCard');
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '保存到主站卡片库';
    }
    try {
      const refUrls = await resolveStudioRefUrlsForApi();
      if (!useApi && !window.PointsSystem?.deductCredits?.(cost)) {
        throw new Error('积分扣除失败');
      }
      const gen = await window.PromptHubApi?.generateImage?.({
        prompt,
        model,
        resolution,
        quality,
        size,
        refImageUrls: refUrls.length ? refUrls : undefined
      });
      if (!gen?.ok) throw new Error(gen?.message || '生图提交失败');
      if (typeof gen.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(gen.data.creditsRemaining);
      }
      updateStudioCreditsBadge();
      const jobId = gen.data?.jobId;
      if (!jobId) throw new Error('未返回任务 ID');
      if (hint) hint.textContent = '生成中，请稍候…';
      const imageUrl = await pollStudioImageJob(jobId);
      studioLastGenImage = imageUrl;
      studioLastGenPrompt = prompt;
      studioLastGenJobId = jobId;
      setStudioImageGenPending(false);
      const wrap = document.getElementById('studioImageResult');
      const img = document.getElementById('studioImagePreview');
      if (img && imageUrl) {
        img.src = imageUrl;
        wrap?.classList.remove('hidden');
        document.getElementById('studioImageIdle')?.classList.add('hidden');
        scrollStudioImageResultIntoView();
      }
      const saved = await saveStudioGenToLibraries({ prompt, image: imageUrl, jobId });
      if (addBtn) {
        addBtn.textContent = saved.ok ? '已保存到主站卡片库' : '保存失败';
        addBtn.disabled = !!saved.ok;
      }
      if (hint) {
        hint.textContent = saved.ok
          ? `已生成并保存到主站卡片库 · 消耗约 ${gen.data?.creditsCharged ?? cost} 积分`
          : `生成完成 · 消耗约 ${gen.data?.creditsCharged ?? cost} 积分`;
      }
      setStatus(saved.ok ? '已保存到主站卡片库，返回主站刷新即可看到' : '生图完成，但写入主站卡片库失败');
    } catch (e) {
      setStudioImageGenPending(false);
      document.getElementById('studioImageIdle')?.classList.remove('hidden');
      await window.PointsSystem?.refreshCreditsFromServer?.();
      updateStudioCreditsBadge();
      if (hint) hint.textContent = '积分与主站共用 · 生成后自动保存到主站卡片库';
      setStatus(e?.message || '生图失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        restoreStudioImageSubmitLabel();
      }
    }
  }

  async function downloadImageFile(url, filename) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setStatus('图片已开始下载');
    } catch (e) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('若未自动下载，请在新标签页右键保存');
    }
  }

  function downloadStudioGenImage() {
    const url = studioLastGenImage || document.getElementById('studioImagePreview')?.src || '';
    if (!url) {
      setStatus('请先生成图片');
      return;
    }
    void downloadImageFile(url, `asset-studio-${Date.now()}.png`);
  }

  function addStudioGenToLibrary() {
    if (!guardEdit()) return;
    if (!studioLastGenImage) {
      setStatus('请先生成图片');
      return;
    }
    void (async () => {
      const saved = await saveStudioGenToLibraries({
        prompt: studioLastGenPrompt,
        image: studioLastGenImage,
        jobId: studioLastGenJobId || null
      });
      const addBtn = document.getElementById('studioImageAddCard');
      if (addBtn && saved.ok) {
        addBtn.textContent = '已保存到主站卡片库';
        addBtn.disabled = true;
      }
      setStatus(saved.ok ? '已保存到主站卡片库' : '保存失败，请重试');
    })();
  }

  function mergeImportFromMain(silent) {
    try {
      const raw = localStorage.getItem(LS_IMPORT);
      if (!raw) return 0;
      let payload = JSON.parse(raw);
      let list = [];
      let groups = [];
      if (Array.isArray(payload)) {
        list = payload;
      } else if (payload && typeof payload === 'object') {
        list = Array.isArray(payload.cards) ? payload.cards : [];
        groups = Array.isArray(payload.groups) ? payload.groups : [];
      }
      if (!list.length) {
        localStorage.removeItem(LS_IMPORT);
        return 0;
      }
      if (groups.length) getProject().cardGroups = groups.slice();
      let added = 0;
      const cards = getProjectCards();
      list.forEach((c) => {
        if (!c?.id || cards.some((x) => x.id === c.id)) return;
        cards.push(normalizeImportedCard(c));
        added += 1;
      });
      localStorage.removeItem(LS_IMPORT);
      if (added) {
        saveState();
        renderAll();
        if (!silent) setStatus(`已从主站导入 ${added} 张卡片`);
      }
      return added;
    } catch (e) {
      return 0;
    }
  }

  function clearStudioLibrary() {
    const p = getProject();
    p.cards = [];
    p.cardGroups = [];
    const doc = getActiveDoc();
    if (doc) {
      doc.heroCardIds = [];
      doc.floatPositions = {};
      doc.closedFloatIds = [];
    }
    document.getElementById('studioFloatLayer')?.replaceChildren();
    saveState();
    renderAll();
    setStatus('已清空本项目卡片库，可重新导入');
  }

  async function deleteCurrentProject() {
    if (!guardEdit()) return;
    if (state.projects.length <= 1) {
      setStatus('至少保留一个项目');
      return;
    }
    const p = getProject();
    const ok = await studioConfirm(
      '删除项目',
      `确定删除「${p.name}」及其全部文档与卡片库？此操作不可撤销。`
    );
    if (!ok) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    state.projectId = state.projects[0].id;
    closeCardDetailPanel();
    saveState();
    renderAll();
    setStatus('项目已删除');
  }

  function openFieldSettings() {
    const p = getProject();
    ensureProjectAssets(p);
    const overlay = document.getElementById('studioSettingsOverlay');
    const heroInput = document.getElementById('studioHeroLabelInput');
    const attachChk = document.getElementById('studioChatAttachDoc');
    if (attachChk) attachChk.checked = p.chatAttachDoc !== false;
    if (heroInput) heroInput.value = p.heroFieldLabel || DEFAULT_HERO_LABEL;
    renderCoreFieldLabelInputs();
    renderStudioFieldList();
    overlay?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeFieldSettings() {
    document.getElementById('studioSettingsOverlay')?.classList.add('hidden');
    if (!document.getElementById('studioCardDetail')?.classList.contains('hidden')) return;
    document.body.style.overflow = '';
  }

  function renderCoreFieldLabelInputs() {
    const root = document.getElementById('studioCoreFieldLabels');
    const labels = getProjectFieldLabels();
    if (!root) return;
    const keyNames = {
      title: '标题',
      prompt: '提示词',
      background: '背景',
      character: '人物',
      relations: '关系'
    };
    const order = getCoreFieldOrder();
    root.innerHTML = order
      .map(
        (key, idx) => `<div class="studio-field-order-row" data-core-key="${esc(key)}">
        <div class="studio-field-order-btns">
          <button type="button" data-move-core="up" data-key="${esc(key)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button type="button" data-move-core="down" data-key="${esc(key)}" ${idx === order.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </div>
        <span>${keyNames[key] || key}</span>
        <input type="text" class="settings-input" data-core-label="${key}" value="${esc(labels[key] || DEFAULT_FIELD_LABELS[key])}" maxlength="24">
      </div>`
      )
      .join('');
    bindCoreFieldOrderButtons(root);
  }

  function moveCoreField(key, dir) {
    const p = getProject();
    const order = getCoreFieldOrder();
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= order.length) return;
    [order[idx], order[next]] = [order[next], order[idx]];
    p.coreFieldOrder = order;
    renderCoreFieldLabelInputs();
  }

  function moveGlobalField(id, dir) {
    const p = getProject();
    const fields = p.globalFields;
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= fields.length) return;
    [fields[idx], fields[next]] = [fields[next], fields[idx]];
    renderStudioFieldList();
  }

  function bindCoreFieldOrderButtons(root) {
    root.querySelectorAll('[data-move-core]').forEach((btn) => {
      btn.addEventListener('click', () => {
        moveCoreField(btn.dataset.key, btn.dataset.moveCore);
      });
    });
  }

  function renderStudioFieldList() {
    const list = document.getElementById('studioFieldList');
    const empty = document.getElementById('studioFieldListEmpty');
    const fields = getProjectGlobalFields();
    const typeLabel = { text: '文本', textarea: '多行' };
    if (!list) return;
    if (!fields.length) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    list.innerHTML = fields
      .map(
        (f, idx) => `<div class="studio-field-list-item" data-field-id="${esc(f.id)}">
          <div class="studio-field-order-btns">
            <button type="button" data-move-field="up" data-id="${esc(f.id)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
            <button type="button" data-move-field="down" data-id="${esc(f.id)}" ${idx === fields.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          </div>
          <span class="studio-field-list-item-name">${esc(f.name)}</span>
          <span class="studio-field-list-item-type">${typeLabel[f.type] || f.type}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-del-field="${esc(f.id)}">删除</button>
        </div>`
      )
      .join('');
    list.querySelectorAll('[data-del-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = getProject();
        p.globalFields = p.globalFields.filter((f) => f.id !== btn.dataset.delField);
        renderStudioFieldList();
      });
    });
    list.querySelectorAll('[data-move-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        moveGlobalField(btn.dataset.id, btn.dataset.moveField);
      });
    });
  }

  function saveFieldSettings() {
    if (!guardEdit()) return;
    const p = getProject();
    const heroInput = document.getElementById('studioHeroLabelInput');
    if (heroInput?.value?.trim()) p.heroFieldLabel = heroInput.value.trim().slice(0, 80);
    document.querySelectorAll('[data-core-label]').forEach((inp) => {
      const key = inp.dataset.coreLabel;
      if (key && inp.value.trim()) p.fieldLabels[key] = inp.value.trim().slice(0, 24);
    });
    const order = [];
    document.querySelectorAll('#studioCoreFieldLabels [data-core-key]').forEach((row) => {
      if (row.dataset.coreKey) order.push(row.dataset.coreKey);
    });
    if (order.length) p.coreFieldOrder = order;
    saveState();
    renderEditor();
    const reopenId = detailCardId;
    closeFieldSettings();
    if (reopenId) openCardDetailPanel(reopenId);
    setStatus('字段设置已保存');
  }

  function addStudioGlobalField() {
    if (!guardEdit()) return;
    const nameEl = document.getElementById('studioNewFieldName');
    const typeEl = document.getElementById('studioNewFieldType');
    const n = nameEl?.value?.trim();
    if (!n) {
      setStatus('请输入字段名称');
      return;
    }
    const p = getProject();
    if (p.globalFields.some((f) => f.name === n)) {
      setStatus('字段名称已存在');
      return;
    }
    p.globalFields.push({ id: generateId(), name: n.slice(0, 24), type: typeEl?.value || 'text' });
    if (nameEl) nameEl.value = '';
    renderStudioFieldList();
  }

  function purgeLegacyStudioStorage() {
    ['promptrepo_studio_demo_v1', 'promptrepo_studio_v2'].forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) { /* ignore */ }
    });
  }

  function exportCardsFromMainSite() {
    try {
      const raw = window.__promptHubCards || window.opener?.__promptHubCards;
      if (!Array.isArray(raw) || !raw.length) return 0;
      let groups = [];
      try {
        const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
        const key = uid ? `promptrepo_groups_${uid}` : 'promptrepo_groups';
        const g = localStorage.getItem(key) || localStorage.getItem('promptrepo_groups');
        if (g) groups = JSON.parse(g);
      } catch (e) { /* ignore */ }
      const list = raw.slice(0, 200).map((c) => ({
        id: c.id,
        title: c.title,
        prompt: c.prompt,
        image: c.image,
        group: c.group,
        tags: c.tags
      }));
      localStorage.setItem(LS_IMPORT, JSON.stringify({ cards: list, groups: Array.isArray(groups) ? groups : [] }));
      return list.length;
    } catch (e) {
      return 0;
    }
  }

  function tryImportFromMain() {
    openImportPicker();
  }

  function loadPanelWidths() {
    const shell = document.getElementById('studioShell');
    if (!shell) return;
    let saved = null;
    try {
      const raw = localStorage.getItem(LS_PANEL_WIDTHS);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    ['assets', 'docs', 'ai'].forEach((key) => {
      const val = Number(saved?.[key]) || PANEL_WIDTH_DEFAULTS[key];
      const lim = PANEL_WIDTH_LIMITS[key];
      const w = Math.min(lim.max, Math.max(lim.min, val));
      shell.style.setProperty(`--studio-w-${key}`, `${w}px`);
    });
  }

  function savePanelWidths(shell) {
    if (!shell) return;
    const data = {
      assets: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-assets'), 10) || PANEL_WIDTH_DEFAULTS.assets,
      docs: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-docs'), 10) || PANEL_WIDTH_DEFAULTS.docs,
      ai: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-ai'), 10) || PANEL_WIDTH_DEFAULTS.ai
    };
    try {
      localStorage.setItem(LS_PANEL_WIDTHS, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function bindPanelResizers() {
    const shell = document.getElementById('studioShell');
    if (!shell) return;
    loadPanelWidths();
    shell.querySelectorAll('.studio-resizer').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (isViewOnly()) return;
        e.preventDefault();
        const which = handle.dataset.resize;
        if (!which) return;
        const startX = e.clientX;
        const startW = parseInt(getComputedStyle(shell).getPropertyValue(`--studio-w-${which}`), 10)
          || PANEL_WIDTH_DEFAULTS[which];
        const lim = PANEL_WIDTH_LIMITS[which];
        document.body.classList.add('studio-resizing');
        const move = (ev) => {
          const delta = ev.clientX - startX;
          let next = startW;
          if (which === 'ai') next = startW - delta;
          else next = startW + delta;
          next = Math.min(lim.max, Math.max(lim.min, next));
          shell.style.setProperty(`--studio-w-${which}`, `${next}px`);
        };
        const up = () => {
          document.body.classList.remove('studio-resizing');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          savePanelWidths(shell);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
  }

  function bindDropZones() {
    const hero = document.getElementById('studioHeroDrop');
    const chat = document.getElementById('studioChatLog');
    [hero, chat].forEach((zone) => {
      if (!zone) return;
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (zone === hero) hero.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => hero?.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        hero?.classList.remove('drag-over');
        if (isViewOnly() && !allowsStudioDemoInteract()) {
          guardEdit();
          return;
        }
        const id = e.dataTransfer.getData('text/plain') || dragCardId;
        if (!id) return;
        if (zone === hero) addCardToDoc(id);
        else {
          const c = getCard(id);
          if (c) {
            const log = document.getElementById('studioChatLog');
            const p = document.createElement('p');
            p.className = 'studio-chat-msg user';
            p.textContent = `[拖入卡片] ${c.title}：${c.prompt || c.background || ''}`;
            log?.appendChild(p);
          }
        }
      });
    });
  }

  function bindEditor() {
    const editor = document.getElementById('studioEditor');
    const titleEl = document.getElementById('studioDocTitle');
    editor?.addEventListener('input', () => {
      if (isViewOnly() || mentionApplying) return;
      const doc = getActiveDoc();
      if (doc) {
        doc.bodyHtml = editor.innerHTML;
        saveState();
        scheduleApplyHeroMentions();
      }
    });
    editor?.addEventListener('click', (e) => {
      const m = e.target.closest('.studio-mention');
      if (m?.dataset?.mention) openCardDetailPanel(m.dataset.mention);
    });
    titleEl?.addEventListener('change', () => {
      if (isViewOnly()) return;
      const doc = getActiveDoc();
      if (doc) {
        doc.title = titleEl.value.trim() || '未命名文档';
        saveState();
        renderDocTree();
      }
    });
  }

  function bindChrome() {
    document.getElementById('studioProjectSelect')?.addEventListener('change', (e) => {
      state.projectId = e.target.value;
      saveState();
      renderAll();
    });
    document.getElementById('studioNewProjectBtn')?.addEventListener('click', () => {
      if (!guardEdit()) return;
      void (async () => {
        const name = await studioPrompt('新建项目', '项目名称', '新项目');
        if (!name?.trim()) return;
        const id = `proj_${Date.now().toString(36)}`;
        state.projects.push({
          id,
          name: name.trim().slice(0, 24),
          folders: [{ id: `fld_${Date.now()}`, name: '默认', parentId: null, collapsed: false }],
          docs: [],
          cards: [],
          cardGroups: [],
          globalFields: [],
          fieldLabels: { ...DEFAULT_FIELD_LABELS },
          heroFieldLabel: DEFAULT_HERO_LABEL,
          coreFieldOrder: CORE_FIELD_KEYS.slice()
        });
        state.projectId = id;
        ensureProjectHasDoc(getProject());
        saveState();
        renderAll();
        setStatus('新项目已创建，请为本项目导入卡片库');
      })();
    });
    document.getElementById('studioDeleteProjectBtn')?.addEventListener('click', () => {
      void deleteCurrentProject();
    });
    document.getElementById('studioFieldSettingsBtn')?.addEventListener('click', openFieldSettings);
    document.getElementById('studioSettingsClose')?.addEventListener('click', closeFieldSettings);
    document.getElementById('studioSettingsBackdrop')?.addEventListener('click', closeFieldSettings);
    document.getElementById('studioSettingsSaveBtn')?.addEventListener('click', saveFieldSettings);
    document.getElementById('studioAddFieldBtn')?.addEventListener('click', addStudioGlobalField);
    document.getElementById('studioThemeToggleBtn')?.addEventListener('click', () => {
      window.toggleAppTheme?.();
    });
    document.getElementById('studioRechargeBtn')?.addEventListener('click', () => {
      if (document.getElementById('subscribeOverlay')) {
        window.openRechargePanel?.() || window.showRechargePlaceholder?.();
        return;
      }
      window.location.href = 'index.html?panel=recharge';
    });
    document.getElementById('studioLedgerBtn')?.addEventListener('click', () => void toggleStudioCreditLedger());
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('studioCreditLedgerPanel');
      if (!panel || panel.classList.contains('hidden')) return;
      if (e.target.closest('.studio-credits-wrap')) return;
      panel.classList.add('hidden');
    });
    document.getElementById('studioDocAddBtn')?.addEventListener('click', () => {
      if (!guardEdit()) return;
      startInlineNewFolder(null);
    });
    document.getElementById('studioImportClose')?.addEventListener('click', closeImportPicker);
    document.getElementById('studioAssetFolders')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.studio-import-cta, #studioImportCta');
      if (!btn) return;
      e.preventDefault();
      void openImportPicker();
    });
    document.getElementById('studioGuideOk')?.addEventListener('click', closeStudioGuide);
    document.getElementById('studioChatThreadSelect')?.addEventListener('change', (e) => {
      switchChatThread(e.target.value);
    });
    document.getElementById('studioChatNewThread')?.addEventListener('click', createNewChatThread);
    document.getElementById('studioCardDetailClose')?.addEventListener('click', closeCardDetailPanel);
    document.getElementById('studioCardDetailBackdrop')?.addEventListener('click', closeCardDetailPanel);
    document.getElementById('studioCardFieldSettingsBtn')?.addEventListener('click', openFieldSettings);
    document.getElementById('studioCardSaveBtn')?.addEventListener('click', saveCardFromDetail);
    document.getElementById('studioCardCopyPrompt')?.addEventListener('click', () => {
      const c = detailCardId ? getCard(detailCardId) : null;
      const ta = document.querySelector('#studioCardDetailBody [data-field="prompt"]');
      const text = ta?.value?.trim() || c?.prompt || '';
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => setStatus('提示词已复制'),
        () => setStatus('复制失败，请手动选中复制')
      );
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const settings = document.getElementById('studioSettingsOverlay');
      if (settings && !settings.classList.contains('hidden')) {
        closeFieldSettings();
        return;
      }
      const detail = document.getElementById('studioCardDetail');
      if (detail && !detail.classList.contains('hidden')) closeCardDetailPanel();
    });
    document.getElementById('studioAiCollapse')?.addEventListener('click', () => {
      document.getElementById('studioShell')?.classList.toggle('ai-collapsed');
    });
    document.getElementById('studioAssetFilter')?.addEventListener('input', renderAssetFolders);
    const filterBtn = document.getElementById('studioFilterBtn');
    const filterDd = document.getElementById('studioFilterDropdown');
    filterBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!filterDd) return;
      filterDd.classList.toggle('hidden');
      if (!filterDd.classList.contains('hidden')) buildStudioFilterMenu();
    });
    document.addEventListener('click', (e) => {
      if (!filterDd || filterDd.classList.contains('hidden')) return;
      if (e.target.closest('#studioFilterBtn, #studioFilterDropdown')) return;
      filterDd.classList.add('hidden');
    });
    document.querySelectorAll('[data-asset-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.assetTab = tab.dataset.assetTab;
        document.querySelectorAll('[data-asset-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        renderAssetFolders();
      });
    });
    document.querySelectorAll('[data-ai-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.aiTab;
        document.querySelectorAll('[data-ai-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('[data-ai-pane]').forEach((p) => p.classList.toggle('active', p.dataset.aiPane === name));
      });
    });
    document.getElementById('studioChatSend')?.addEventListener('click', () => void onStudioChatSend());
    document.getElementById('studioChatContextBtn')?.addEventListener('click', onStudioChatContext);
    document.getElementById('studioChatModel')?.addEventListener('change', updateStudioChatCostHint);
    document.getElementById('studioChatThinking')?.addEventListener('change', updateStudioChatCostHint);
    updateStudioChatCostHint();
    document.getElementById('studioChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onStudioChatSend();
      }
    });
    ['studioImageModel', 'studioImageResolution'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', updateStudioImageGenCostHint);
    });
    document.getElementById('studioImageSubmit')?.addEventListener('click', () => void runStudioImageGen());
    document.getElementById('studioImageFillDoc')?.addEventListener('click', fillStudioImageFromDoc);
    document.getElementById('studioImageAddCard')?.addEventListener('click', addStudioGenToLibrary);
    document.getElementById('studioImageDownload')?.addEventListener('click', downloadStudioGenImage);
    document.getElementById('studioVideoCopyBtn')?.addEventListener('click', () => {
      const text = document.getElementById('studioVideoPrompt')?.value?.trim();
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => setStatus('分镜描述已复制'),
        () => setStatus('复制失败')
      );
    });
  }

  function renderAll() {
    renderProjects();
    renderAssetFolders();
    renderDocTree();
    renderChatThreadSelect();
    renderChatLogFromThread();
    buildStudioFilterMenu();
    applyViewOnlyMode();
    const editor = document.getElementById('studioEditor');
    if (editor) editor.dataset.docId = '';
    renderEditor();
  }

  async function init() {
    purgeLegacyStudioStorage();
    loadFilters();
    buildStudioFilterMenu();
    const p = getProject();
    if (p && !p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    bindPanelResizers();
    bindChrome();
    bindDropZones();
    bindEditor();
    bindStudioImageRefUpload();
    updateStudioImageGenCostHint();
    if (!document.body.dataset.studioTreeMenuBound) {
      document.body.dataset.studioTreeMenuBound = '1';
      document.addEventListener('click', hideTreeMenu);
      document.addEventListener('scroll', hideTreeMenu, true);
    }
    const imgScroll = document.getElementById('studioImageScroll');
    imgScroll?.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    applyViewOnlyMode();
    updateStudioCreditsBadge();
    maybeShowStudioGuide();
    renderAll();
    if (/[?&]import=1(?:&|$)/.test(location.search || '')) {
      try {
        history.replaceState(null, '', location.pathname);
      } catch (e) { /* ignore */ }
      requestAnimationFrame(() => openImportPicker());
    }
    void (async () => {
      try {
        await withTimeout(
          (async () => {
            if (window.SupabaseSync?.init) await window.SupabaseSync.init();
            if (window.PointsSystem?.refreshCreditsFromServer) {
              await window.PointsSystem.refreshCreditsFromServer();
            }
          })(),
          4000
        );
      } catch (e) { /* ignore */ }
      applyViewOnlyMode();
      updateStudioCreditsBadge();
      const root = document.getElementById('studioAssetFolders');
      if (root) observeStudioCardImages(root);
      prefetchStudioProjectThumbs();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void init(); });
  else void init();
})();
