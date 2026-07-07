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
