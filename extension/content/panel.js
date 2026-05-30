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
        void loadImageFile(file, true);
        return;
      }
      const html = e.dataTransfer?.getData('text/html') || '';
      const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      if (src) void loadImageFromUrl(src, true);
    });
  }

  function bindPasteHandlers() {
    const onPasteImage = (e) => {
      if (!panelHovered && !nodeInPanel(document.activeElement)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.indexOf('image') !== -1) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) void loadImageFile(file, true);
          return;
        }
      }
    };
    window.addEventListener('paste', onPasteImage, true);
    wrap.addEventListener('paste', onPasteImage, true);
  }

  function renderMain() {
    wrap.innerHTML = `
      <div class="ph-ext-head" id="phExtHead">
        <span class="ph-ext-title">Prompt Hub 存卡</span>
        <button type="button" class="ph-ext-hide" id="phExtMin" title="收起">−</button>
      </div>
      <div class="ph-ext-body" id="phExtBody">
        <div class="ph-ext-drop" id="phExtDrop" tabindex="0">点击此处后 Ctrl+V 粘贴截图<br><small>或拖入图片 · 自动保存</small></div>
        <textarea class="ph-ext-prompt" id="phExtPrompt" placeholder="提示词（悬停段落或划选文字可复制）"></textarea>
        <div class="ph-ext-actions">
          <button type="button" class="ph-ext-save" id="phExtSave">保存到仓库</button>
          <button type="button" class="ph-ext-clear" id="phExtClear" title="清空">清空</button>
        </div>
        <div class="ph-ext-status"></div>
        <p class="ph-ext-legal">仅保存您主动操作的内容 · 请遵守网站使用条款</p>
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

    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!imageBase64 && !promptEl.value.trim()) return;
      if (!confirm('确定清空当前图片和提示词？')) return;
      resetForm();
    });

    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      void doSave(false);
    });

    bindImageDrop(drop);
    bindPasteHandlers();
    drop.addEventListener('click', () => drop.focus());

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
    const drop = wrap.querySelector('#phExtDrop');
    const promptEl = wrap.querySelector('#phExtPrompt');
    if (drop) {
      drop.innerHTML = '点击此处后 Ctrl+V 粘贴截图<br><small>或拖入图片 · 自动保存</small>';
    }
    if (promptEl) promptEl.value = '';
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

  async function doSave(fromDrop) {
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
    setStatus(fromDrop ? '图片保存中…' : '保存中…');
    chrome.runtime.sendMessage({
      type: 'PH_SAVE_CARD',
      prompt,
      title: prompt.slice(0, 48) || imageName.replace(/\.[^.]+$/, '') || '网页摘录',
      imageBase64,
      sourceUrl: location.href
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
