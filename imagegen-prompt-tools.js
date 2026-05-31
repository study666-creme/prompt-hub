/**
 * 生图页：灵感抽卡 / 优化提示词 / 反推提示词
 */
(function () {
  let batchRunning = false;
  let reversePreviewUrl = '';
  let batchCostSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function setPrompt(text) {
    const ta = $('imageGenPrompt');
    if (!ta) return;
    ta.value = text || '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    window.FeatureDraft?.syncCardPublishFromPrompt?.();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSelectedInspirationPrompts() {
    const list = $('imageGenInspireList');
    if (!list) return [];
    return [...list.querySelectorAll('.imagegen-inspire-row')].filter((row) => {
      return row.querySelector('input[type=checkbox]')?.checked;
    }).map((row) => row.dataset.prompt || '').filter(Boolean);
  }

  async function getUnitImageGenCost() {
    const model = $('imageGenModel')?.value || 'quanneng2';
    const resolution = $('imageGenResolution')?.value || '1k';
    const quality = $('imageGenQuality')?.value || 'standard';
    let cost = window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
    if (window.PointsSystem?.useApiForAccount?.()) {
      try {
        const quote = await window.PromptHubApi.getGenerationCost(resolution, quality, model);
        if (quote.ok && quote.data?.final != null) cost = quote.data.final;
      } catch (e) { /* 本地估价 */ }
    }
    return cost;
  }

  async function updateBatchCostLabel() {
    const btn = $('imageGenInspireBatchBtn');
    if (!btn || batchRunning) return;
    const seq = ++batchCostSeq;
    const selected = getSelectedInspirationPrompts();
    const count = selected.length || Number($('imageGenInspireCount')?.value || 3);
    const unit = await getUnitImageGenCost();
    if (seq !== batchCostSeq) return;
    const n = selected.length || count;
    const total = unit * n;
    btn.textContent = n > 0
      ? `排队生图 ${n} 张 · 约 ${total} 积分（${unit} 积分/张）`
      : `排队生图 · ${unit} 积分/张`;
  }

  function renderInspirationList(prompts) {
    const list = $('imageGenInspireList');
    if (!list) return;
    list.innerHTML = '';
    prompts.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'imagegen-inspire-row';
      row.innerHTML =
        `<label class="imagegen-inspire-check"><input type="checkbox" checked data-idx="${idx}"><span>${escapeHtml(p.slice(0, 120))}${p.length > 120 ? '…' : ''}</span></label>` +
        `<button type="button" class="btn btn-ghost btn-sm" data-use-idx="${idx}">填入</button>`;
      row.dataset.prompt = p;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-use-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.imagegen-inspire-row');
        if (row?.dataset.prompt) setPrompt(row.dataset.prompt);
      });
    });
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => void updateBatchCostLabel());
    });
    void updateBatchCostLabel();
  }

  function onDrawInspiration() {
    const type = $('imageGenInspireType')?.value || 'viral';
    const count = Number($('imageGenInspireCount')?.value || 3);
    const prompts = window.ImageGenPromptKit?.generateInspirationPrompts?.(type, count) || [];
    renderInspirationList(prompts);
    if (prompts[0]) setPrompt(prompts[0]);
    toast(`已生成 ${prompts.length} 条灵感（抽卡免费；生图按张扣积分）`);
  }

  async function onQueueBatch() {
    if (batchRunning) {
      toast('批量任务进行中，请稍候');
      return;
    }
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const prompts = getSelectedInspirationPrompts();
    if (!prompts.length) {
      toast('请先抽卡并勾选要生成的提示词');
      return;
    }
    const run = window.FeatureDraft?.runImageGenWithPrompt;
    if (typeof run !== 'function') {
      toast('生图模块未就绪，请刷新页面');
      return;
    }
    const unit = await getUnitImageGenCost();
    const totalNeed = unit * prompts.length;
    const balance = window.PointsSystem?.getCredits?.() ?? 0;
    if (balance < unit) {
      toast(`积分不足（每张 ${unit}，当前 ${balance}）`);
      return;
    }
    if (balance < totalNeed) {
      toast(`积分约够 ${Math.floor(balance / unit)} 张，将按顺序提交直到不足（${unit} 积分/张）`);
    }

    batchRunning = true;
    const btn = $('imageGenInspireBatchBtn');
    if (btn) btn.disabled = true;
    let ok = 0;
    let charged = 0;
    for (let i = 0; i < prompts.length; i += 1) {
      if (btn) btn.textContent = `提交中 ${i + 1}/${prompts.length}…`;
      setPrompt(prompts[i]);
      const res = await run(prompts[i], { silentToast: true, batch: true });
      if (res?.ok) {
        ok += 1;
        charged += res.creditsCharged || unit;
      } else if (res?.reason === 'credits') {
        break;
      }
      await sleep(350);
    }
    await window.PointsSystem?.refreshCreditsFromServer?.();
    window.PointsSystem?.updateCreditsUI?.();
    batchRunning = false;
    if (btn) btn.disabled = false;
    void updateBatchCostLabel();
    toast(`已提交 ${ok}/${prompts.length} 张生图，已扣约 ${charged} 积分（${unit} 积分/张）`);
    if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
      window.MobileUI.setImageGenView('feed');
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function ensurePromptApi(method) {
    if (typeof window.PromptHubApi?.[method] === 'function') return true;
    toast('脚本版本过旧，请按 Ctrl+Shift+R 强刷后再试');
    return false;
  }

  async function onOptimizePrompt() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    if (!ensurePromptApi('promptToolsOptimize')) return;
    const raw = $('imageGenPrompt')?.value?.trim();
    if (!raw) {
      toast('请先填写要优化的提示词');
      return;
    }
    if (!window.PointsSystem?.useApiForAccount?.()) {
      toast('优化提示词需登录并连接 API（消耗少量积分）');
      return;
    }
    const target = $('imageGenOptimizeTarget')?.value || 'general';
    const btn = $('imageGenOptimizeBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '优化中…';
    }
    try {
      const r = await window.PromptHubApi.promptToolsOptimize({ prompt: raw, target });
      if (!r.ok) throw new Error(r.message || '优化失败');
      setPrompt(r.data?.prompt || raw);
      if (typeof r.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(r.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      const modelHint = r.data?.modelLabel || r.data?.model || 'DeepSeek Flash';
      toast(`已优化（${modelHint} · -${r.data?.creditsCharged ?? '?'} 积分）`);
    } catch (e) {
      toast(e.message || '优化失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '优化提示词';
      }
    }
  }

  async function compressImageDataUrl(dataUrl, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const side = maxSide || 1280;
        let w = img.width;
        let h = img.height;
        if (w > side || h > side) {
          if (w >= h) {
            h = Math.round((h * side) / w);
            w = side;
          } else {
            w = Math.round((w * side) / h);
            h = side;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法处理图片'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = dataUrl;
    });
  }

  function setReversePreview(url) {
    reversePreviewUrl = url || '';
    const img = $('imageGenReversePreview');
    const idle = $('imageGenReverseIdle');
    if (img) {
      img.src = reversePreviewUrl;
      img.hidden = !reversePreviewUrl;
    }
    if (idle) idle.hidden = !!reversePreviewUrl;
  }

  async function onReversePickFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setReversePreview(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  async function onReverseFromRef() {
    const refs = window.FeatureDraft?.getImageGenRefImages?.() || [];
    const first = refs[0] || null;
    if (!first) {
      toast('请先在上方「参考图」添加一张图片');
      return;
    }
    setReversePreview(first);
    toast('已载入当前参考图');
  }

  async function onReversePrompt() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    if (!ensurePromptApi('promptToolsReverse')) return;
    if (!reversePreviewUrl) {
      toast('请先上传或载入要反推的图片');
      return;
    }
    if (!window.PointsSystem?.useApiForAccount?.()) {
      toast('反推提示词需登录并连接 API（2 积分/次）');
      return;
    }
    const btn = $('imageGenReverseBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '反推中…';
    }
    try {
      const compressed = await compressImageDataUrl(reversePreviewUrl, 1280);
      const r = await window.PromptHubApi.promptToolsReverse({ imageBase64: compressed });
      if (!r.ok) throw new Error(r.message || '反推失败');
      setPrompt(r.data?.prompt || '');
      if (typeof r.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(r.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      const modelHint = r.data?.modelLabel || r.data?.model || 'gpt-4o-mini';
      toast(`已反推（${modelHint} · -${r.data?.creditsCharged ?? 2} 积分）`);
    } catch (e) {
      toast(e.message || '反推失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '反推提示词';
      }
    }
  }

  function switchToolboxTab(tab) {
    document.querySelectorAll('[data-imagegen-tool-tab]').forEach((btn) => {
      const on = btn.dataset.imagegenToolTab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-imagegen-tool-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.imagegenToolPane !== tab;
    });
  }

  function bindToolbox() {
    const toggle = $('imageGenToolboxToggle');
    const body = $('imageGenToolboxBody');
    if (toggle && body && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        const open = body.hidden;
        body.hidden = !open;
        toggle.textContent = open ? '收起' : '展开';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    document.querySelectorAll('[data-imagegen-tool-tab]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => switchToolboxTab(btn.dataset.imagegenToolTab));
    });

    $('imageGenInspireDrawBtn')?.addEventListener('click', onDrawInspiration);
    $('imageGenInspireBatchBtn')?.addEventListener('click', () => void onQueueBatch());
    $('imageGenOptimizeBtn')?.addEventListener('click', () => void onOptimizePrompt());
    $('imageGenReverseBtn')?.addEventListener('click', () => void onReversePrompt());
    $('imageGenReverseFromRefBtn')?.addEventListener('click', () => void onReverseFromRef());
    $('imageGenInspireCount')?.addEventListener('change', () => void updateBatchCostLabel());
    ['imageGenModel', 'imageGenResolution', 'imageGenQuality'].forEach((id) => {
      $(id)?.addEventListener('change', () => void updateBatchCostLabel());
    });

    const fileInput = $('imageGenReverseFile');
    $('imageGenReversePickBtn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) void onReversePickFile(f);
    });

    const typeSel = $('imageGenInspireType');
    if (typeSel && window.ImageGenPromptKit?.listTypes && !typeSel.dataset.filled) {
      typeSel.dataset.filled = '1';
      typeSel.innerHTML = '';
      window.ImageGenPromptKit.listTypes().forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label}（${t.hint}）`;
        typeSel.appendChild(opt);
      });
      typeSel.value = 'viral';
    }
  }

  function initImageGenPromptTools() {
    bindToolbox();
    void updateBatchCostLabel();
  }

  window.ImageGenPromptTools = {
    init: initImageGenPromptTools,
    updateBatchCostLabel
  };
})();
