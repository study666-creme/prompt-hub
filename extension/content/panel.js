(function () {
  if (window.__PH_EXT_PANEL__) return;
  window.__PH_EXT_PANEL__ = true;

  const MAX_SELECTION = 8000;
  let imageBase64 = null;
  let imageName = '';
  let saving = false;
  let copyBtn = null;

  const root = document.createElement('div');
  root.className = 'ph-ext-root';
  root.id = 'ph-ext-root';
  document.documentElement.appendChild(root);

  const shadow = root.attachShadow({ mode: 'closed' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('content/panel.css');
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'ph-ext-panel';
  shadow.appendChild(wrap);

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
        <p>本工具仅用于您<strong>手动选择</strong>的文字/拖入的图片，保存到您自己的 Prompt Hub 账号。</p>
        <p>请确保内容合法、有权使用，并遵守所浏览网站的服务条款。我们不会自动抓取整页内容。</p>
        <button type="button" id="phExtAccept">我已阅读并同意</button>
      </div>`;
    wrap.querySelector('#phExtAccept').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PH_ACCEPT_DISCLAIMER' }, () => renderMain());
    });
  }

  function renderMain() {
    wrap.innerHTML = `
      <div class="ph-ext-head" id="phExtHead">
        <span class="ph-ext-title">Prompt Hub 存卡</span>
        <button type="button" class="ph-ext-hide" id="phExtMin" title="收起">−</button>
      </div>
      <div class="ph-ext-body" id="phExtBody">
        <div class="ph-ext-drop" id="phExtDrop">拖入图片到此处<br>松手后自动保存</div>
        <textarea class="ph-ext-prompt" id="phExtPrompt" placeholder="提示词（可划选网页文字后点「复制到提示词」）"></textarea>
        <div class="ph-ext-actions">
          <button type="button" class="ph-ext-save" id="phExtSave">保存到仓库</button>
          <button type="button" class="ph-ext-clear" id="phExtClear" title="清空">清空</button>
        </div>
        <div class="ph-ext-status"></div>
        <p class="ph-ext-legal">仅保存您主动选择/拖入的内容 · 请遵守网站使用条款</p>
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
      if (!imageBase64 && !promptEl.value.trim()) return;
      if (!confirm('确定清空当前图片和提示词？')) return;
      resetForm();
    });

    saveBtn.addEventListener('click', () => void doSave(false));

    ['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('dragover');
      });
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        void loadImageFile(file, true);
      }
    });

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
    if (drop) drop.innerHTML = '拖入图片到此处<br>松手后自动保存';
    if (promptEl) promptEl.value = '';
    setStatus('');
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  async function loadImageFile(file, autoSave) {
    if (file.size > 5 * 1024 * 1024) {
      setStatus('图片过大（最大 5MB）', true);
      return;
    }
    try {
      imageBase64 = await readFileAsDataUrl(file);
      imageName = file.name || 'image';
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
    setStatus(fromDrop ? '拖入保存中…' : '保存中…');
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
        setStatus(res?.message || '保存失败', true);
        if (res?.code === 'UNAUTHORIZED') {
          setStatus('请先登录：打开 prompt-hub.cn 并保持登录', true);
        }
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
    document.documentElement.appendChild(copyBtn);
    copyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    copyBtn.addEventListener('click', () => {
      const sel = window.getSelection();
      const text = (sel?.toString() || '').trim();
      if (!text) return;
      const promptEl = wrap.querySelector('#phExtPrompt');
      if (promptEl) {
        const cur = promptEl.value.trim();
        promptEl.value = cur ? `${cur}\n\n${text}` : text;
        promptEl.focus();
      }
      hideCopyBtn();
      sel?.removeAllRanges();
    });
    return copyBtn;
  }

  function hideCopyBtn() {
    if (copyBtn) copyBtn.classList.add('hidden');
  }

  function selectionInPanel(sel) {
    const node = sel?.anchorNode;
    if (!node || !node.getRootNode) return false;
    const r = node.getRootNode();
    return r === shadow || r === root;
  }

  function onSelectionMaybeShow() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      hideCopyBtn();
      return;
    }
    if (selectionInPanel(sel)) {
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
    btn.style.left = `${Math.min(window.innerWidth - 120, rect.left + window.scrollX)}px`;
    btn.style.top = `${Math.max(8, rect.top + window.scrollY - 32)}px`;
    btn.classList.remove('hidden');
  }

  document.addEventListener('mouseup', () => {
    setTimeout(onSelectionMaybeShow, 10);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCopyBtn();
  });
  document.addEventListener('scroll', hideCopyBtn, true);

  chrome.runtime.sendMessage({ type: 'PH_GET_PANEL' }, (res) => {
    if (res?.disclaimerOk) renderMain();
    else renderDisclaimer();
  });
})();
