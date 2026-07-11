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
  let studioImageModelCatalog = [];
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

  function syncStudioImageResolutionOptions() {
    const modelId = document.getElementById('studioImageModel')?.value || 'image2';
    const select = document.getElementById('studioImageResolution');
    if (!select) return;
    const model = studioImageModelCatalog.find((item) => item.id === modelId);
    const resolutions = Array.isArray(model?.resolutions) && model.resolutions.length
      ? model.resolutions.filter((value) => ['1k', '2k', '4k'].includes(value))
      : modelId === 'image2'
        ? ['1k']
        : modelId === 'image2-pro' || modelId === 'image2-hd'
          ? ['2k', '4k']
          : modelId.startsWith('apimart-mj-')
            ? ['1k']
            : ['1k', '2k', '4k'];
    const previous = select.value;
    select.innerHTML = resolutions
      .map((resolution) => `<option value="${resolution}">${resolution.toUpperCase()}</option>`)
      .join('');
    select.value = resolutions.includes(previous) ? previous : resolutions[0] || '1k';
  }

  async function loadStudioImageModelCatalog() {
    const select = document.getElementById('studioImageModel');
    if (!select || !window.PromptHubApi?.getGenerationModels) return;
    try {
      const response = await window.PromptHubApi.getGenerationModels();
      const models = (response?.data?.models || []).filter((model) =>
        ['gim2', 'banana', 'midjourney'].includes(model.uiFamily)
        && model.status !== 'offline'
      );
      if (!response?.ok || !models.length) return;
      studioImageModelCatalog = models;
      const previous = select.value;
      select.innerHTML = '';
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.label || model.id;
        option.disabled = model.selectable === false || model.status === 'maintenance';
        select.appendChild(option);
      }
      const preferred = models.find((model) => model.id === previous && model.selectable !== false)
        || models.find((model) => model.id === 'image2' && model.selectable !== false)
        || models.find((model) => model.selectable !== false);
      if (preferred) select.value = preferred.id;
      syncStudioImageResolutionOptions();
      updateStudioImageGenCostHint();
    } catch (e) {
      // 静态清单已与服务端兜底保持一致，网络恢复后下次打开会重新同步。
    }
  }

  function updateStudioImageGenCostHint() {
    syncStudioImageResolutionOptions();
    const model = document.getElementById('studioImageModel')?.value || 'image2';
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
