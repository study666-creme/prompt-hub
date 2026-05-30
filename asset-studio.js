/**
 * 资产创作工作台 · 独立页（联动主站卡片库）
 */
(function () {
  const LS_STATE = 'promptrepo_studio_demo_v1';
  const LS_IMPORT = 'promptrepo_studio_import_cards';

  const DEMO_CARDS = [
    {
      id: 'c_hero',
      title: '主角·林岚',
      folder: '人设',
      hue: 320,
      prompt: 'young woman, silver hair, cyber coat, confident gaze',
      background: '前星港特种侦察员，性格外冷内热。目标：找回失踪的妹妹。',
      character: '女，24岁，银发齐肩，深色战术风衣，左肩旧伤疤痕。',
      relations: '与配角「老K」亦师亦友。',
      docs: ['doc_script_01']
    },
    {
      id: 'c_scene',
      title: '霓虹雨巷',
      folder: '场景',
      hue: 200,
      prompt: 'neon alley, rain, cyan magenta lights, wet pavement',
      background: '第三区下层集市入口，常作为追逐戏开场。',
      character: '狭窄巷道、霓虹招牌、积水反光，适合手持跟拍。',
      relations: '关联文档「第一场·追逐」。',
      docs: ['doc_script_01']
    },
    {
      id: 'c_support',
      title: '配角·老K',
      folder: '人设',
      hue: 45,
      prompt: 'middle-aged man, mechanic arm, worn jacket, smirk',
      background: '地下改装铺老板，掌握旧时代星港管线图。',
      character: '中年男性，机械义臂，旧皮夹克，嘴角常带讥诮。',
      relations: '提供线索，后期可能背叛或牺牲（待定）。',
      docs: ['doc_script_01']
    },
    {
      id: 'c_prop',
      title: '脉冲手枪',
      folder: '道具',
      hue: 0,
      prompt: 'compact energy pistol, glowing core, sci-fi',
      background: '制式警用 sidearm 改装版。',
      character: '紧凑能量手枪，核心发光，科幻质感。',
      relations: '',
      docs: []
    }
  ];

  const DEMO_MARKET = [
    { id: 'm1', title: '赛博画风包', folder: '已购资产', hue: 340 },
    { id: 'm2', title: '星港纪元·场景', folder: '已购资产', hue: 195 }
  ];

  let state = loadState();
  let dragCardId = null;
  let floatZ = 50;
  let detailCardId = null;

  function setStatus(msg) {
    const el = document.getElementById('studioStatusBadge');
    if (el) el.textContent = msg || '本地已自动保存';
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {
      projectId: 'proj_short',
      projects: [
        {
          id: 'proj_short',
          name: '小短片',
          folders: [
            { id: 'fld_char', name: '人设' },
            { id: 'fld_scene', name: '场景' }
          ],
          docs: [
            {
              id: 'doc_script_01',
              folderId: 'fld_char',
              title: '第一场·追逐',
              heroCardIds: [],
              body: '',
              floatPositions: {}
            }
          ]
        }
      ],
      cards: DEMO_CARDS.map((c) => ({ ...c })),
      assetTab: 'warehouse'
    };
  }

  function getProject() {
    return state.projects.find((p) => p.id === state.projectId) || state.projects[0];
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
    return state.cards.find((c) => c.id === id);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cardThumbHtml(card) {
    const img = card.image ? `<img src="${esc(card.image)}" alt="">` : '';
    return `<div class="studio-asset-card" draggable="true" data-card-id="${esc(card.id)}" style="--card-hue:${card.hue || 210}" title="${esc(card.title)}">${img}<span>${esc(card.title)}</span></div>`;
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

  function renderAssetFolders() {
    const root = document.getElementById('studioAssetFolders');
    if (!root) return;
    const filter = (document.getElementById('studioAssetFilter')?.value || '').trim().toLowerCase();
    const pool = state.assetTab === 'market' ? DEMO_MARKET : state.cards;
    const byFolder = {};
    pool.forEach((c) => {
      if (filter && !`${c.title} ${c.folder} ${c.prompt || ''}`.toLowerCase().includes(filter)) return;
      const f = c.folder || '未分类';
      if (!byFolder[f]) byFolder[f] = [];
      byFolder[f].push(c);
    });
    const names = Object.keys(byFolder).sort();
    if (!names.length) {
      root.innerHTML = '<p class="panel-hint">无匹配卡片</p>';
      return;
    }
    root.innerHTML = names
      .map(
        (name) => `
      <div class="studio-folder open" data-folder="${esc(name)}">
        <div class="studio-folder-head"><span class="studio-folder-chevron">▶</span><span>${esc(name)}</span><span style="margin-left:auto;color:var(--text-muted);font-size:10px">${byFolder[name].length}</span></div>
        <div class="studio-folder-body"><div class="studio-card-grid">${byFolder[name].map((c) => cardThumbHtml(c)).join('')}</div></div>
      </div>`
      )
      .join('');
    root.querySelectorAll('.studio-folder-head').forEach((head) => {
      head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });
    bindCardDrag(root.querySelectorAll('.studio-asset-card'));
  }

  function renderDocTree() {
    const root = document.getElementById('studioDocTree');
    const p = getProject();
    if (!root || !p) return;
    if (!p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    let html = '';
    p.folders.forEach((fld) => {
      html += `<div class="studio-doc-folder-label">${esc(fld.name)}</div>`;
      p.docs
        .filter((d) => d.folderId === fld.id)
        .forEach((d) => {
          html += `<button type="button" class="studio-doc-item${d.id === p.activeDocId ? ' active' : ''}" data-doc-id="${esc(d.id)}">${esc(d.title)}</button>`;
        });
    });
    root.innerHTML = html || '<p class="panel-hint">点击 +文 新建文档</p>';
    root.querySelectorAll('.studio-doc-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.activeDocId = btn.dataset.docId;
        saveState();
        renderAll();
      });
    });
  }

  function defaultScriptBody() {
    return `<p>【第一场·追逐】<br>雨夜的<span data-mention="c_scene" class="studio-mention">霓虹雨巷</span>，<span data-mention="c_hero" class="studio-mention">主角·林岚</span>被无人机追踪。她在巷口遇见<span data-mention="c_support" class="studio-mention">配角·老K</span>，后者扔给她一把改装脉冲手枪。</p><p>林岚：（喘息）他们来了。<br>老K：走上层管线，别回头。</p>`;
  }

  function renderEditor() {
    const doc = getActiveDoc();
    const p = getProject();
    if (!doc) return;
    const titleEl = document.getElementById('studioDocTitle');
    const editor = document.getElementById('studioEditor');
    const meta = document.getElementById('studioDocMeta');
    const hero = document.getElementById('studioHeroThumbs');
    if (titleEl) titleEl.value = doc.title || '';
    if (meta) meta.textContent = `${p.name} · ${doc.heroCardIds.length} 张关联卡`;
    if (hero) {
      hero.innerHTML = doc.heroCardIds
        .map((id) => {
          const c = getCard(id);
          if (!c) return '';
          const inner = c.image
            ? `<img src="${esc(c.image)}" alt="">`
            : `<div style="width:100%;height:100%;background:linear-gradient(145deg,hsl(${c.hue} 40% 30%),hsl(${c.hue + 40} 45% 40%))"></div>`;
          return `<div class="studio-hero-thumb" title="${esc(c.title)}">${inner}</div>`;
        })
        .join('');
    }
    if (editor && editor.dataset.docId !== doc.id) {
      editor.dataset.docId = doc.id;
      editor.innerHTML = doc.bodyHtml || doc.body || defaultScriptBody();
    }
    renderFloatCards(doc);
  }

  function renderFloatCards(doc) {
    const layer = document.getElementById('studioFloatLayer');
    if (!layer || !doc) return;
    layer.innerHTML = '';
    doc.heroCardIds.forEach((id, idx) => {
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
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.zIndex = String(++floatZ);
    const thumb = card.image
      ? `<img src="${esc(card.image)}" alt="">`
      : `<div style="width:100%;height:100%;background:linear-gradient(145deg,hsl(${card.hue} 40% 28%),hsl(${card.hue + 40} 45% 38%))"></div>`;
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
    el.querySelector('.studio-float-close')?.addEventListener('click', () => el.remove());
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
  }

  function docExcerpt(doc) {
    const raw = doc.bodyHtml || doc.body || '';
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '（文档暂无正文）';
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  }

  function warehouseCardHtml(c) {
    const hue = c.hue || 210;
    const media = c.image
      ? `<img class="card-img" src="${esc(c.image)}" alt="">`
      : `<div class="card-media-placeholder"></div>`;
    const tags = [c.folder].filter(Boolean);
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
    if (!detailCardId) return;
    const c = getCard(detailCardId);
    const root = document.getElementById('studioCardDetailBody');
    if (!c || !root) return;
    c.background = root.querySelector('[data-field="background"]')?.value?.trim() || '';
    c.character = root.querySelector('[data-field="character"]')?.value?.trim() || '';
    c.relations = root.querySelector('[data-field="relations"]')?.value?.trim() || '';
    c.prompt = root.querySelector('[data-field="prompt"]')?.value?.trim() || '';
    saveState();
    renderAssetFolders();
    renderEditor();
    setStatus('卡片设定已保存');
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
    body.innerHTML = `
      <div class="studio-card-detail-visual">${warehouseCardHtml(c)}</div>
      <div class="studio-card-detail-info">
        <div class="studio-info-section">
          <label for="studioFieldBg">背景 / 设定</label>
          <textarea id="studioFieldBg" data-field="background" rows="3">${esc(c.background || '')}</textarea>
        </div>
        <div class="studio-info-section">
          <label for="studioFieldChar">人物 / 外观</label>
          <textarea id="studioFieldChar" data-field="character" rows="3">${esc(c.character || '')}</textarea>
        </div>
        <div class="studio-info-section">
          <label for="studioFieldRel">关系 / 备注</label>
          <textarea id="studioFieldRel" data-field="relations" rows="2">${esc(c.relations || '')}</textarea>
        </div>
        <div class="studio-info-section">
          <label for="studioFieldPrompt">提示词</label>
          <textarea id="studioFieldPrompt" class="mono" data-field="prompt" rows="4">${esc(c.prompt || '')}</textarea>
        </div>
        <div class="studio-doc-links">
          <h3>关联文档</h3>
          ${docLinksHtml}
        </div>
      </div>`;
    body.querySelectorAll('[data-goto-doc]').forEach((btn) => {
      btn.addEventListener('click', () => jumpToDoc(btn.dataset.gotoDoc));
    });
    root.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function bindCardDrag(nodes) {
    nodes.forEach((node) => {
      node.addEventListener('dragstart', (e) => {
        dragCardId = node.dataset.cardId;
        e.dataTransfer.setData('text/plain', dragCardId);
        e.dataTransfer.effectAllowed = 'copy';
      });
      node.addEventListener('dragend', () => {
        dragCardId = null;
      });
      node.addEventListener('dblclick', (e) => {
        e.preventDefault();
        openCardDetailPanel(node.dataset.cardId);
      });
    });
  }

  function addCardToDoc(cardId) {
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    if (!doc.heroCardIds.includes(cardId)) {
      doc.heroCardIds.push(cardId);
      if (!c.docs.includes(doc.id)) c.docs.push(doc.id);
    }
    if (!doc.bodyHtml && !doc.body) doc.bodyHtml = defaultScriptBody();
    saveState();
    renderAll();
  }

  function mergeImportFromMain(silent) {
    try {
      const raw = localStorage.getItem(LS_IMPORT);
      if (!raw) return 0;
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) {
        localStorage.removeItem(LS_IMPORT);
        return 0;
      }
      let added = 0;
      list.forEach((c) => {
        if (!c?.id || state.cards.some((x) => x.id === c.id)) return;
        state.cards.push({
          id: c.id,
          title: c.title || '未命名',
          folder: c.group || c.tags?.[0] || '导入',
          hue: (String(c.id).charCodeAt(0) * 17) % 360,
          prompt: c.prompt || '',
          background: '',
          character: '',
          relations: '',
          docs: [],
          image: typeof c.image === 'string' && c.image.startsWith('http') ? c.image : ''
        });
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

  function tryImportFromMain() {
    const n = mergeImportFromMain(false);
    if (n) return;
    const useDemo = window.confirm('暂无待导入卡片。是否加载演示卡片库（主角 / 场景 / 配角）？');
    if (!useDemo) return;
    state.cards = DEMO_CARDS.map((c) => ({ ...c }));
    const doc = getActiveDoc();
    if (doc) {
      doc.heroCardIds = ['c_hero', 'c_scene', 'c_support'];
      doc.bodyHtml = defaultScriptBody();
    }
    saveState();
    renderAll();
    setStatus('已加载演示卡片库');
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
      const doc = getActiveDoc();
      if (doc) {
        doc.bodyHtml = editor.innerHTML;
        saveState();
      }
    });
    editor?.addEventListener('click', (e) => {
      const m = e.target.closest('.studio-mention');
      if (m?.dataset?.mention) openCardDetailPanel(m.dataset.mention);
    });
    titleEl?.addEventListener('change', () => {
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
      const name = window.prompt('项目名称', '新项目');
      if (!name?.trim()) return;
      const id = `proj_${Date.now().toString(36)}`;
      state.projects.push({
        id,
        name: name.trim().slice(0, 24),
        folders: [{ id: `fld_${Date.now()}`, name: '默认' }],
        docs: []
      });
      state.projectId = id;
      saveState();
      renderAll();
    });
    document.getElementById('studioImportBtn')?.addEventListener('click', tryImportFromMain);
    document.getElementById('studioCardDetailClose')?.addEventListener('click', closeCardDetailPanel);
    document.getElementById('studioCardDetailBackdrop')?.addEventListener('click', closeCardDetailPanel);
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
      const detail = document.getElementById('studioCardDetail');
      if (detail && !detail.classList.contains('hidden')) closeCardDetailPanel();
    });
    document.getElementById('studioFullscreenBtn')?.addEventListener('click', () => {
      document.getElementById('studioShell')?.classList.toggle('doc-fullscreen');
    });
    document.getElementById('studioAiCollapse')?.addEventListener('click', () => {
      document.getElementById('studioShell')?.classList.toggle('ai-collapsed');
    });
    document.getElementById('studioAssetFilter')?.addEventListener('input', renderAssetFolders);
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
    document.getElementById('studioNewFolderBtn')?.addEventListener('click', () => {
      const name = window.prompt('分类名称', '新分类');
      if (!name?.trim()) return;
      getProject().folders.push({ id: `fld_${Date.now()}`, name: name.trim().slice(0, 16) });
      saveState();
      renderDocTree();
    });
    document.getElementById('studioNewDocBtn')?.addEventListener('click', () => {
      const p = getProject();
      const fld = p.folders[0];
      if (!fld) return;
      const id = `doc_${Date.now().toString(36)}`;
      p.docs.push({
        id,
        folderId: fld.id,
        title: '新文档',
        heroCardIds: [],
        body: '',
        bodyHtml: '',
        floatPositions: {}
      });
      p.activeDocId = id;
      saveState();
      renderAll();
    });
    document.getElementById('studioChatSend')?.addEventListener('click', () => {
      const input = document.getElementById('studioChatInput');
      const log = document.getElementById('studioChatLog');
      const text = input?.value?.trim();
      if (!text || !log) return;
      const u = document.createElement('p');
      u.className = 'studio-chat-msg user';
      u.textContent = text;
      log.appendChild(u);
      const a = document.createElement('p');
      a.className = 'studio-chat-msg';
      a.textContent = '（Demo）已收到。正式版将接入大模型与生图/生视频。';
      log.appendChild(a);
      input.value = '';
      log.scrollTop = log.scrollHeight;
    });
  }

  function renderAll() {
    renderProjects();
    renderAssetFolders();
    renderDocTree();
    const editor = document.getElementById('studioEditor');
    if (editor) editor.dataset.docId = '';
    renderEditor();
  }

  function init() {
    const p = getProject();
    if (p && !p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    const doc = getActiveDoc();
    if (doc && !doc.heroCardIds.length && state.cards.some((c) => c.id === 'c_hero')) {
      doc.heroCardIds = ['c_hero', 'c_scene', 'c_support'];
      doc.bodyHtml = doc.bodyHtml || defaultScriptBody();
    }
    const imported = mergeImportFromMain(true);
    if (imported) setStatus(`已自动导入 ${imported} 张主站卡片`);
    bindChrome();
    bindDropZones();
    bindEditor();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
