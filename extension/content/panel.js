(function () {
  if (window.__PH_EXT_PANEL__) return;
  window.__PH_EXT_PANEL__ = true;

  const MAX_SELECTION = 8000;
  const BLOCK_TAGS = new Set([
    'P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'ARTICLE', 'SECTION', 'DIV', 'SPAN'
  ]);
  let imageBase64 = null;
  let imageName = '';
  let saving = false;
  let copyBtn = null;
  let hoverCopyBtn = null;
  let hoverBlockText = '';
  let panelHovered = false;
  let hoverTimer = null;
  let allTags = [];
  const currentTags = new Set();

  const root = document.createElement('div');
  root.className = 'ph-ext-root';
  root.id = 'ph-ext-root';
  document.documentElement.appendChild(root);

  const shadow = root.attachShadow({ mode: 'closed' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('content/panel.css');
  shadow.appendChild(style);

  const floatLayer = document.createElement('div');
  floatLayer.className = 'ph-ext-float-layer';
  shadow.appendChild(floatLayer);

  const wrap = document.createElement('div');
  wrap.className = 'ph-ext-panel';
  shadow.appendChild(wrap);

  root.addEventListener('mouseenter', () => { panelHovered = true; });
  root.addEventListener('mouseleave', () => { panelHovered = false; });

  function nodeInPanel(node) {
    if (!node || !node.getRootNode) return false;
    const r = node.getRootNode();
    return r === shadow || r === root;
  }

  function pageHasEditablePasteTarget() {
    const el = document.activeElement;
    if (!el || nodeInPanel(el)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      return !el.readOnly && !el.disabled;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function normalizeTag(raw) {
    const t = String(raw || '').trim().replace(/^#+/, '');
    if (!t) return '';
    return `#${t.slice(0, 40)}`;
  }

  function setStatus(text, isErr) {
    const el = wrap.querySelector('.ph-ext-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isErr ? '#ff6b6b' : '#98989d';
  }

  function renderDisclaimer() {
    wrap.innerHTML = `
      <div class="ph-ext-disclaimer">
        <p><strong>使用须知</strong></p>
        <p>本工具仅用于您<strong>手动选择/悬停复制</strong>的文字、或<strong>拖入/粘贴</strong>的图片，保存到您自己的 Prompt Hub 账号。</p>
        <p>请确保内容合法、有权使用，并遵守所浏览网站的服务条款。</p>
        <button type="button" id="phExtAccept">我已阅读并同意</button>
      </div>`;
    wrap.querySelector('#phExtAccept').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PH_ACCEPT_DISCLAIMER' }, () => renderMain());
    });
  }

  function renderTagChips() {
    const box = wrap.querySelector('#phExtTagChips');
    if (!box) return;
    box.innerHTML = '';
    if (!currentTags.size) {
      box.innerHTML = '<span class="ph-ext-tags-empty">未选标签</span>';
      return;
    }
    for (const tag of currentTags) {
      const chip = document.createElement('span');
      chip.className = 'ph-ext-tag-chip';
      chip.innerHTML = `${tag}<button type="button" data-tag="${tag}" title="移除">×</button>`;
      chip.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        currentTags.delete(tag);
        renderTagChips();
        renderTagOptions();
      });
      box.appendChild(chip);
    }
  }

  function renderTagOptions() {
    const list = wrap.querySelector('#phExtTagList');
    if (!list) return;
    list.innerHTML = '';
    const merged = [...new Set([...allTags, ...currentTags])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (!merged.length) {
      list.innerHTML = '<span class="ph-ext-tags-empty">仓库暂无标签，可在上方新建</span>';
      return;
    }
    for (const tag of merged) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ph-ext-tag-opt' + (currentTags.has(tag) ? ' selected' : '');
      btn.textContent = tag;
      btn.addEventListener('click', () => {
        if (currentTags.has(tag)) currentTags.delete(tag);
        else currentTags.add(tag);
        renderTagChips();
        renderTagOptions();
      });
      list.appendChild(btn);
    }
  }

  function toggleTagSheet(show) {
    const sheet = wrap.querySelector('#phExtTagSheet');
    if (!sheet) return;
    if (show) {
      sheet.classList.remove('hidden');
      renderTagOptions();
    } else {
      sheet.classList.add('hidden');
    }
  }

  function fetchAllTags() {
    chrome.runtime.sendMessage({ type: 'PH_GET_TAGS' }, (res) => {
      if (res?.ok && Array.isArray(res.data?.tags)) {
        allTags = res.data.tags;
        renderTagOptions();
      }
    });
  }

  function bindImageDrop(drop) {
    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('dragover');
      });
    });
    drop.addEventListener('dragleave', (e) => {
      if (e.target === drop) drop.classList.remove('dragover');
    });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        void loadImageFile(file, false);
        return;
      }
      const html = e.dataTransfer?.getData('text/html') || '';
      const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      if (src) void loadImageFromUrl(src, false);
    });
  }

  function bindPasteHandlers() {
    window.addEventListener('paste', onPasteImage, true);
  }

  function onPasteImage(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let imageItem = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') !== -1) {
        imageItem = items[i];
        break;
      }
    }
    if (!imageItem) return;

    const inPanel = nodeInPanel(document.activeElement) || panelHovered;
    if (!inPanel && pageHasEditablePasteTarget()) return;

    e.preventDefault();
    e.stopPropagation();
    const file = imageItem.getAsFile();
    if (!file) return;

    if (inPanel) {
      void loadImageFile(file, false);
      setStatus('已粘贴图片（点保存提交）');
    } else {
      void globalPasteSave(file);
    }
  }

  async function globalPasteSave(file) {
    await loadImageFile(file, false);
    setStatus('检测到截图，正在保存…');
    await doSave(true);
  }

  function closePanel() {
    chrome.runtime.sendMessage({ type: 'PH_CLOSE_PANEL' }, () => {
      root.remove();
      window.__PH_EXT_PANEL__ = false;
    });
  }

  function renderMain() {
    wrap.innerHTML = `
      <div class="ph-ext-head" id="phExtHead">
        <span class="ph-ext-title">Prompt Hub 存卡</span>
        <div class="ph-ext-head-btns">
          <button type="button" class="ph-ext-hide" id="phExtMin" title="收起">−</button>
          <button type="button" class="ph-ext-close" id="phExtClose" title="关闭面板">×</button>
        </div>
      </div>
      <div class="ph-ext-body" id="phExtBody">
        <div class="ph-ext-drop" id="phExtDrop" tabindex="0">拖入图片或 Ctrl+V 粘贴<br><small>面板内仅预览 · 点保存才提交</small></div>
        <textarea class="ph-ext-prompt" id="phExtPrompt" placeholder="提示词（悬停段落或划选文字可复制）"></textarea>
        <div class="ph-ext-tags-wrap">
          <div class="ph-ext-tags-label">
            <span>标签</span>
            <button type="button" class="ph-ext-pick-tags" id="phExtPickTags">选择标签</button>
          </div>
          <div class="ph-ext-tags" id="phExtTagChips"></div>
        </div>
        <div class="ph-ext-actions">
          <button type="button" class="ph-ext-save" id="phExtSave">保存到仓库</button>
          <button type="button" class="ph-ext-clear" id="phExtClear" title="清空">清空</button>
        </div>
        <div class="ph-ext-status"></div>
        <p class="ph-ext-legal">页面无输入框时 Ctrl+V 截图可直接保存 · 请遵守网站使用条款</p>
        <div class="ph-ext-tag-sheet hidden" id="phExtTagSheet">
          <div class="ph-ext-tag-sheet-head">
            <input type="text" class="ph-ext-tag-new" id="phExtTagNew" placeholder="新建标签（无需 #）" maxlength="40">
            <button type="button" class="ph-ext-tag-add" id="phExtTagAdd">添加</button>
          </div>
          <div class="ph-ext-tag-list" id="phExtTagList"></div>
        </div>
      </div>`;

    const drop = wrap.querySelector('#phExtDrop');
    const promptEl = wrap.querySelector('#phExtPrompt');
    const saveBtn = wrap.querySelector('#phExtSave');
    const clearBtn = wrap.querySelector('#phExtClear');
    const body = wrap.querySelector('#phExtBody');
    const head = wrap.querySelector('#phExtHead');

    wrap.querySelector('#phExtMin').addEventListener('click', () => {
      body.hidden = !body.hidden;
    });
    wrap.querySelector('#phExtClose').addEventListener('click', closePanel);

    wrap.querySelector('#phExtPickTags').addEventListener('click', (e) => {
      e.stopPropagation();
      const sheet = wrap.querySelector('#phExtTagSheet');
      toggleTagSheet(sheet.classList.contains('hidden'));
    });

    wrap.querySelector('#phExtTagAdd').addEventListener('click', () => {
      const input = wrap.querySelector('#phExtTagNew');
      const tag = normalizeTag(input?.value || '');
      if (!tag) return;
      if (!allTags.includes(tag)) allTags.push(tag);
      currentTags.add(tag);
      if (input) input.value = '';
      renderTagChips();
      renderTagOptions();
    });

    wrap.querySelector('#phExtTagNew').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        wrap.querySelector('#phExtTagAdd').click();
      }
    });

    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!imageBase64 && !promptEl.value.trim() && !currentTags.size) return;
      if (!confirm('确定清空当前内容？')) return;
      resetForm();
    });

    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      void doSave(false);
    });

    bindImageDrop(drop);
    bindPasteHandlers();
    drop.addEventListener('click', () => drop.focus());
    renderTagChips();
    fetchAllTags();

    let dragOffset = { x: 0, y: 0 };
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = root.getBoundingClientRect();
      dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const onMove = (ev) => {
        root.style.left = `${Math.max(8, ev.clientX - dragOffset.x)}px`;
        root.style.top = `${Math.max(8, ev.clientY - dragOffset.y)}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function resetForm() {
    imageBase64 = null;
    imageName = '';
    currentTags.clear();
    const drop = wrap.querySelector('#phExtDrop');
    const promptEl = wrap.querySelector('#phExtPrompt');
    if (drop) {
      drop.innerHTML = '拖入图片或 Ctrl+V 粘贴<br><small>面板内仅预览 · 点保存才提交</small>';
    }
    if (promptEl) promptEl.value = '';
    renderTagChips();
    toggleTagSheet(false);
    setStatus('');
  }

  function appendPrompt(text) {
    const promptEl = wrap.querySelector('#phExtPrompt');
    if (!promptEl || !text) return;
    const cur = promptEl.value.trim();
    promptEl.value = cur ? `${cur}\n\n${text}` : text;
    promptEl.focus();
    setStatus('已填入提示词');
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  async function loadImageFromUrl(url, autoSave) {
    try {
      setStatus('正在读取图片…');
      const res = await fetch(url);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('不是有效图片');
      await loadImageFile(new File([blob], 'web-image.jpg', { type: blob.type }), autoSave);
    } catch (e) {
      setStatus('无法读取该图片（可能受网站保护）', true);
    }
  }

  async function loadImageFile(file, autoSave) {
    if (file.size > 5 * 1024 * 1024) {
      setStatus('图片过大（最大 5MB）', true);
      return;
    }
    try {
      imageBase64 = await readFileAsDataUrl(file);
      imageName = file.name || 'pasted-image.png';
      const drop = wrap.querySelector('#phExtDrop');
      if (drop) {
        drop.innerHTML = '';
        const img = document.createElement('img');
        img.src = imageBase64;
        img.alt = '';
        drop.appendChild(img);
      }
      if (autoSave) await doSave(true);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function doSave(fromAuto) {
    if (saving) return;
    const promptEl = wrap.querySelector('#phExtPrompt');
    const prompt = (promptEl?.value || '').trim();
    if (!prompt && !imageBase64) {
      setStatus('请填写提示词或添加图片', true);
      return;
    }
    saving = true;
    const saveBtn = wrap.querySelector('#phExtSave');
    if (saveBtn) saveBtn.disabled = true;
    setStatus(fromAuto ? '截图保存中…' : '保存中…');
    chrome.runtime.sendMessage({
      type: 'PH_SAVE_CARD',
      prompt,
      title: prompt.slice(0, 48) || imageName.replace(/\.[^.]+$/, '') || '网页摘录',
      imageBase64,
      sourceUrl: location.href,
      tags: [...currentTags]
    }, (res) => {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message || '扩展通信失败', true);
        return;
      }
      if (!res?.ok) {
        let msg = res?.message || '保存失败';
        if (res?.code === 'UNAUTHORIZED') {
          msg = '请先登录：打开 prompt-hub.cn 并保持登录';
        } else if (res?.code === 'DB_PERMISSION') {
          msg = '数据库权限未开：请在 Supabase 执行 20260530100000_user_data_service_role.sql';
        }
        setStatus(msg, true);
        return;
      }
      setStatus(res.data?.message || '已保存');
      resetForm();
      fetchAllTags();
    });
  }

  function ensureCopyBtn() {
    if (copyBtn) return copyBtn;
    copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ph-ext-copy-btn hidden';
    copyBtn.textContent = '复制到提示词';
    floatLayer.appendChild(copyBtn);
    copyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sel = window.getSelection();
      const text = (sel?.toString() || '').trim();
      if (text) {
        appendPrompt(text);
        sel?.removeAllRanges();
      }
      hideCopyBtn();
    });
    return copyBtn;
  }

  function ensureHoverCopyBtn() {
    if (hoverCopyBtn) return hoverCopyBtn;
    hoverCopyBtn = document.createElement('button');
    hoverCopyBtn.type = 'button';
    hoverCopyBtn.className = 'ph-ext-copy-btn hover-mode hidden';
    hoverCopyBtn.textContent = '复制段落';
    floatLayer.appendChild(hoverCopyBtn);
    hoverCopyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    hoverCopyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hoverBlockText) appendPrompt(hoverBlockText);
      hideHoverCopyBtn();
    });
    return hoverCopyBtn;
  }

  function hideCopyBtn() {
    if (copyBtn) copyBtn.classList.add('hidden');
  }

  function hideHoverCopyBtn() {
    hoverBlockText = '';
    if (hoverCopyBtn) hoverCopyBtn.classList.add('hidden');
  }

  function findTextBlock(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeType === 1 && !nodeInPanel(node)) {
        const tag = node.tagName;
        if (BLOCK_TAGS.has(tag)) {
          const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
          if (text.length >= 12 && text.length <= MAX_SELECTION) {
            return { text, rect: node.getBoundingClientRect() };
          }
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function onSelectionMaybeShow() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideCopyBtn();
      return;
    }
    if (nodeInPanel(sel.anchorNode)) {
      hideCopyBtn();
      return;
    }
    const text = sel.toString().trim();
    if (text.length > MAX_SELECTION) {
      hideCopyBtn();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      hideCopyBtn();
      return;
    }
    const btn = ensureCopyBtn();
    btn.style.left = `${Math.min(window.innerWidth - 130, rect.left)}px`;
    btn.style.top = `${Math.max(8, rect.top - 36)}px`;
    btn.classList.remove('hidden');
    hideHoverCopyBtn();
  }

  document.addEventListener('mouseup', () => {
    setTimeout(onSelectionMaybeShow, 10);
  });

  document.addEventListener('mousemove', (e) => {
    if (nodeInPanel(e.target)) {
      hideHoverCopyBtn();
      return;
    }
    if (window.getSelection()?.toString()?.trim()) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const block = findTextBlock(e.target);
      if (!block || block.rect.width < 20) {
        hideHoverCopyBtn();
        return;
      }
      hoverBlockText = block.text;
      const btn = ensureHoverCopyBtn();
      btn.style.left = `${Math.min(window.innerWidth - 100, e.clientX + 8)}px`;
      btn.style.top = `${Math.max(8, e.clientY - 28)}px`;
      btn.classList.remove('hidden');
    }, 350);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideCopyBtn();
      hideHoverCopyBtn();
      toggleTagSheet(false);
    }
  });
  document.addEventListener('scroll', () => {
    hideCopyBtn();
    hideHoverCopyBtn();
  }, true);

  chrome.runtime.sendMessage({ type: 'PH_GET_PANEL' }, (res) => {
    if (res?.disclaimerOk) renderMain();
    else renderDisclaimer();
  });
})();
