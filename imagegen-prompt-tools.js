/**
 * 生图页：灵感抽卡 / 优化 / 反推 / 图片裂变
 */
(function () {
  let batchRunning = false;
  let inspireDrawQuota = null;
  let fissionPlanCreditsHint = 5;
  let batchCostSeq = 0;
  let toolboxBound = false;
  let currentImageGenMode = 'gen';
  let activeRefTool = '';
  /** 排队提交间隔：避免上游 Apimart 限流导致失败 */
  const BATCH_SUBMIT_GAP_MS = 1000;
  const BATCH_SUBMIT_JITTER_MS = 600;

  function getFirstRefImage() {
    const refs = window.FeatureDraft?.getImageGenRefImages?.() || [];
    return refs[0] || '';
  }

  function updateRefToolState() {
    const ref = getFirstRefImage();
    const reverseStatus = $('imageGenReverseRefStatus');
    const fissionStatus = $('imageGenFissionRefStatus');
    const reverseBtn = $('imageGenReverseBtn');
    const fissionBtn = $('imageGenFissionAnalyzeBtn');
    const label = ref ? '已就绪：将使用参考图第一张' : '请先在上方添加参考图';
    if (reverseStatus) reverseStatus.textContent = label;
    if (fissionStatus) fissionStatus.textContent = label;
    if (reverseBtn && reverseBtn.textContent === '反推提示词') reverseBtn.disabled = !ref;
    if (fissionBtn && !fissionBtn.disabled && fissionBtn.textContent === fissionAnalyzeBtnLabel()) {
      fissionBtn.disabled = !ref;
    } else if (fissionBtn && fissionBtn.textContent === fissionAnalyzeBtnLabel()) {
      fissionBtn.disabled = !ref;
    }
  }

  function makeBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function summarizeBatchResults(results, total, unitLabel) {
    const okN = results.filter((r) => r.ok).length;
    const failN = results.filter((r) => !r.ok).length;
    const failLines = results
      .filter((r) => !r.ok)
      .map((r) => {
        const label = r.batchIndex && total > 1 ? `第 ${r.batchIndex}/${total} 张` : `#${r.batchIndex || '?'}`;
        const reason = (r.message || '提交失败').slice(0, 48);
        return `${label}：${reason}`;
      });
    let msg = `${unitLabel}已提交 ${okN}/${total} 张`;
    if (failN) {
      msg += `，${failN} 张失败（见仓库顶部红色卡片）`;
      if (failLines.length === 1) msg += `：${failLines[0]}`;
    }
    return msg;
  }

  async function runPromptBatch({ prompts, btn, btnPrefix, runExtra, unitLabel }) {
    const batchId = makeBatchId();
    const total = prompts.length;
    const results = [];
    let charged = 0;
    for (let i = 0; i < prompts.length; i += 1) {
      const batchIndex = i + 1;
      if (btn) btn.textContent = `${btnPrefix} ${batchIndex}/${total}…`;
      setPrompt(prompts[i]);
      const res = await runExtra(prompts[i], {
        silentToast: true,
        batch: true,
        batchId,
        batchIndex,
        batchTotal: total
      });
      results.push({
        ok: !!res?.ok,
        batchIndex,
        message: res?.message || (res?.ok ? '' : '提交失败')
      });
      if (res?.ok) charged += res.creditsCharged || 0;
      else if (res?.reason === 'credits') break;
      await batchSubmitSleep();
    }
    return { results, charged, total, batchId };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    window.toast?.(msg);
  }

  function setPrompt(text) {
    const val = text || '';
    const genTa = $('imageGenPrompt');
    const inspireTa = $('imageGenInspirePrompt');
    if (genTa) {
      genTa.value = val;
      genTa.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (inspireTa) inspireTa.value = val;
    window.FeatureDraft?.syncCardPublishFromPrompt?.();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSelectedPromptsFromList(listId) {
    const list = $(listId);
    if (!list) return [];
    return [...list.querySelectorAll('.imagegen-inspire-row')].filter((row) => {
      return row.querySelector('input[type=checkbox]')?.checked;
    }).map((row) => row.dataset.prompt || '').filter(Boolean);
  }

  function getSelectedInspirationPrompts() {
    return getSelectedPromptsFromList('imageGenInspireList');
  }

  function getSelectedFissionPrompts() {
    return getSelectedPromptsFromList('imageGenFissionList');
  }

  let optimizeCreditsHint = '约 1 积分';

  async function refreshOptimizePricingHint() {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    try {
      const r = await window.PromptHubApi.promptToolsInfo();
      const est = r.data?.optimize?.creditsPerCall;
      if (r.ok && est) {
        const raw = String(est);
        optimizeCreditsHint = raw.includes('积分') && raw.length <= 12
          ? raw
          : '约 1～2 积分';
        document.querySelectorAll('#imageGenOptimizeCostHint, .imagegen-optimize-btn-cost').forEach((el) => {
          el.textContent = optimizeCreditsHint;
        });
      }
    } catch (e) { /* 本地默认 */ }
  }

  function optimizeBtnLabel() {
    return `优化提示词 · ${optimizeCreditsHint}`;
  }

  function fissionAnalyzeBtnLabel() {
    return `分析裂变方案 · 约 ${fissionPlanCreditsHint} 积分`;
  }

  async function refreshFissionPricingHint() {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    try {
      const r = await window.PromptHubApi.promptToolsInfo();
      const est = r.data?.fission?.creditsPerPlanEstimate;
      if (r.ok && typeof est === 'number' && est > 0) {
        fissionPlanCreditsHint = est;
        const btn = $('imageGenFissionAnalyzeBtn');
        if (btn && !btn.disabled) btn.textContent = fissionAnalyzeBtnLabel();
      }
    } catch (e) { /* 本地默认 */ }
  }

  const COST_QUOTE_TIMEOUT_MS = 12000;

  async function getUnitImageGenCost() {
    const model = $('imageGenModel')?.value || 'quanneng2';
    const resolution = $('imageGenResolution')?.value || '1k';
    const quality = $('imageGenQuality')?.value || 'standard';
    let cost = window.PointsSystem?.getImageGenCost?.(model, resolution) ?? 10;
    if (window.PointsSystem?.useApiForAccount?.()) {
      try {
        const quote = await Promise.race([
          window.PromptHubApi.getGenerationCost(resolution, quality, model),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('cost quote timeout')), COST_QUOTE_TIMEOUT_MS);
          })
        ]);
        if (quote.ok && quote.data?.final != null) cost = quote.data.final;
      } catch (e) { /* 本地估价 */ }
    }
    return cost;
  }

  function resetBatchState() {
    batchRunning = false;
    ['imageGenInspireBatchBtn', 'imageGenFissionBatchBtn'].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = false;
    });
    void updateBatchCostLabel();
  }

  async function updateBatchCostLabel() {
    const inspireBtn = $('imageGenInspireBatchBtn');
    const fissionBtn = $('imageGenFissionBatchBtn');
    if (batchRunning) return;
    const seq = ++batchCostSeq;
    const unit = await getUnitImageGenCost();
    if (seq !== batchCostSeq) return;

    if (inspireBtn) {
      const selected = getSelectedInspirationPrompts();
      const count = selected.length || Number($('imageGenInspireCount')?.value || 3);
      const n = selected.length || count;
      const total = unit * n;
      inspireBtn.textContent = n > 0
        ? `排队生图 ${n} 张 · 约 ${total} 积分（${unit} 积分/张）`
        : `排队生图 · ${unit} 积分/张`;
    }

    if (fissionBtn) {
      const selected = getSelectedFissionPrompts();
      const n = selected.length;
      const total = unit * n;
      fissionBtn.disabled = false;
      fissionBtn.textContent = n > 0
        ? `排队裂变生图 ${n} 张 · 约 ${total} 积分（${unit} 积分/张）`
        : '排队裂变生图 · 先分析并勾选变体';
    }
  }

  function renderPromptChecklist(listId, prompts, onFirstPick) {
    const list = $(listId);
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
    if (prompts[0] && onFirstPick) onFirstPick(prompts[0]);
    void updateBatchCostLabel();
  }

  function renderInspirationList(prompts) {
    renderPromptChecklist('imageGenInspireList', prompts, (p) => setPrompt(p));
  }

  function markInspirationDrawUsed() {
    try {
      localStorage.setItem('promptrepo_inspire_draw_used', '1');
    } catch (e) { /* ignore */ }
    window.TrialTasks?.syncTaskProgress?.(true);
  }

  function applyInspireDrawQuota(quota) {
    if (!quota || typeof quota !== 'object') return;
    inspireDrawQuota = {
      unlimited: !!quota.unlimited,
      limit: quota.limit == null ? null : Number(quota.limit),
      used: Math.max(0, Number(quota.used) || 0),
      remaining: quota.remaining == null ? null : Math.max(0, Number(quota.remaining) || 0),
      tier: quota.tier || 'free',
      label: String(quota.label || '')
    };
    updateInspireDrawQuotaUI();
  }

  function updateInspireDrawQuotaUI() {
    const hint = $('imageGenInspireQuotaHint');
    const drawBtn = $('imageGenInspireDrawBtn');
    if (!window.SupabaseSync?.isLoggedIn?.()) {
      if (hint) hint.textContent = '登录后可用灵感抽卡（普通 10 次/天 · 轻量 30 次/天 · 基础及以上无限）';
      if (drawBtn) drawBtn.disabled = false;
      return;
    }
    if (!inspireDrawQuota) {
      if (hint) hint.textContent = '普通用户 10 次/天 · 轻量会员 30 次/天 · 基础及以上无限';
      return;
    }
    if (hint) {
      hint.textContent = inspireDrawQuota.unlimited
        ? `${inspireDrawQuota.label || '基础会员及以上 · 无限'}（仅「随机抽卡」计次）`
        : `${inspireDrawQuota.label || '今日剩余'}（仅「随机抽卡」计次）`;
    }
    if (drawBtn && !inspireDrawQuota.unlimited && inspireDrawQuota.remaining === 0) {
      drawBtn.disabled = true;
    } else if (drawBtn) {
      drawBtn.disabled = false;
    }
  }

  async function onDrawInspiration() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const btn = $('imageGenInspireDrawBtn');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
      if (!window.PromptHubApi?.consumeInspirationDraw) {
        toast('API 未就绪，请刷新页面');
        return;
      }
      const r = await window.PromptHubApi.consumeInspirationDraw();
      if (!r?.ok) {
        toast(r?.message || '抽卡失败，请稍后再试', 5000);
        updateInspireDrawQuotaUI();
        return;
      }
      if (r.data?.quota) applyInspireDrawQuota(r.data.quota);
      markInspirationDrawUsed();
      const types = getSelectedInspireTypes();
      const style = getSelectedInspireStyle();
      const count = Number($('imageGenInspireCount')?.value || 3);
      const prompts = window.ImageGenPromptKit?.generateInspirationPrompts?.(types, count, style) || [];
      renderInspirationList(prompts);
      if (prompts[0]) setPrompt(prompts[0]);
      const typeLabels = types.map((id) => window.ImageGenPromptKit?.CONTENT_TEMPLATES?.[id]?.label || id).join('、');
      const styleSel = $('imageGenInspireStyle');
      const styleLabel = styleSel?.selectedOptions?.[0]?.textContent?.split('（')[0] || '不指定';
      toast(`已生成 ${prompts.length} 条（内容：${typeLabels || '爆款'}；画风：${styleLabel}）`);
    } finally {
      updateInspireDrawQuotaUI();
    }
  }

  const INSPIRE_PRIMARY_TYPES = [
    'viral', 'premium', 'character', 'scene', 'product', 'guofeng', 'cyber', 'epic'
  ];

  function preserveFormScroll(fn) {
    const scrollEl = document.querySelector('.imagegen-form-scroll');
    const st = scrollEl?.scrollTop ?? 0;
    fn();
    if (!scrollEl) return;
    scrollEl.scrollTop = st;
    requestAnimationFrame(() => { scrollEl.scrollTop = st; });
  }

  function getSelectedInspireTypes() {
    const roots = [$('imageGenInspireTypeChips'), $('imageGenInspireTypeChipsExtra')];
    const ids = roots.flatMap((root) => {
      if (!root) return [];
      return [...root.querySelectorAll('.imagegen-inspire-chip[aria-pressed="true"]')].map(
        (chip) => chip.dataset.inspireType || ''
      );
    }).filter(Boolean);
    return ids.length ? ids : ['viral'];
  }

  function getSelectedInspireStyle() {
    return $('imageGenInspireStyle')?.value || 'auto';
  }

  function setInspireChipActive(chip, on) {
    if (!chip) return;
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.classList.toggle('is-active', on);
  }

  function renderInspireChipButtons(container, items, defaultIds) {
    if (!container || !items?.length) return;
    const defaults = new Set(defaultIds || []);
    container.innerHTML = items
      .map((t) => {
        const on = defaults.has(t.id);
        return `<button type="button" class="imagegen-inspire-chip${on ? ' is-active' : ''}" data-inspire-type="${escapeHtml(t.id)}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(t.label)}</button>`;
      })
      .join('');
  }

  function bindInspireChipRoot(root) {
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('click', (e) => {
      const chip = e.target.closest('.imagegen-inspire-chip');
      if (!chip || !root.contains(chip)) return;
      e.preventDefault();
      preserveFormScroll(() => {
        const on = chip.getAttribute('aria-pressed') === 'true';
        setInspireChipActive(chip, !on);
      });
    });
  }

  function renderInspireTypeChips() {
    const all = window.ImageGenPromptKit?.listContentTypes?.() || [];
    if (!all.length) return;
    const primaryIds = new Set(INSPIRE_PRIMARY_TYPES);
    const primary = INSPIRE_PRIMARY_TYPES.map((id) => all.find((t) => t.id === id)).filter(Boolean);
    const extra = all.filter((t) => !primaryIds.has(t.id));
    renderInspireChipButtons($('imageGenInspireTypeChips'), primary, ['viral']);
    renderInspireChipButtons($('imageGenInspireTypeChipsExtra'), extra, []);
    bindInspireChipRoot($('imageGenInspireTypeChips'));
    bindInspireChipRoot($('imageGenInspireTypeChipsExtra'));
    const toggle = $('imageGenInspireTypesToggle');
    const extraEl = $('imageGenInspireTypeChipsExtra');
    if (toggle && extraEl && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.hidden = !extra.length;
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const willOpen = extraEl.hasAttribute('hidden');
        if (willOpen) {
          extraEl.removeAttribute('hidden');
          toggle.setAttribute('aria-expanded', 'true');
          toggle.textContent = '收起词条';
        } else {
          extraEl.setAttribute('hidden', '');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = '更多词条';
        }
      });
    }
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
    markInspirationDrawUsed();
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
    try {
      const { results, charged, total } = await runPromptBatch({
        prompts,
        btn,
        btnPrefix: '提交中',
        unitLabel: '排队生图',
        runExtra: (p, opts) => {
          const refs = window.FeatureDraft?.getImageGenRefImages?.() || [];
          return run(p, {
            ...opts,
            fromInspirationDraw: true,
            refImages: refs.length ? refs : undefined
          });
        }
      });
      await window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
      toast(`${summarizeBatchResults(results, total, '排队生图')}，约 ${charged || results.filter((r) => r.ok).length * unit} 积分`);
      if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
        window.MobileUI.setImageGenView('feed');
      }
    } catch (e) {
      console.error('[imagegen] inspire batch failed', e);
      toast('排队生图失败，请刷新页面后重试');
    } finally {
      batchRunning = false;
      if (btn) btn.disabled = false;
      void updateBatchCostLabel();
    }
  }

  async function onQueueFissionBatch() {
    if (batchRunning) {
      toast('批量任务进行中，请稍候');
      return;
    }
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const prompts = getSelectedFissionPrompts();
    if (!prompts.length) {
      toast('请先分析裂变方案并勾选要生成的变体');
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
    const btn = $('imageGenFissionBatchBtn');
    if (btn) btn.disabled = true;
    try {
      const { results, charged, total } = await runPromptBatch({
        prompts,
        btn,
        btnPrefix: '裂变提交中',
        unitLabel: '裂变生图',
        runExtra: (p, opts) => run(p, { ...opts, skipRefImages: true })
      });
      await window.PointsSystem?.refreshCreditsFromServer?.();
      window.PointsSystem?.updateCreditsUI?.();
      toast(`${summarizeBatchResults(results, total, '裂变生图')}，约 ${charged} 积分（方案分析另计）`);
      if (window.MobileUI?.isMobile?.() && window.MobileUI?.setImageGenView) {
        window.MobileUI.setImageGenView('feed');
      }
    } catch (e) {
      console.error('[imagegen] fission batch failed', e);
      toast('裂变排队生图失败，请刷新页面后重试');
    } finally {
      batchRunning = false;
      if (btn) btn.disabled = false;
      void updateBatchCostLabel();
    }
  }

  function ensureRefToolVisible(tool) {
    switchRefTool(tool);
  }

  async function onFissionAnalyze() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    if (!ensurePromptApi('promptToolsFission')) return;
    const refImage = getFirstRefImage();
    if (!refImage) {
      toast('请先在上方参考图添加一张图片');
      return;
    }
    if (!window.PointsSystem?.useApiForAccount?.()) {
      toast('图片裂变需登录并连接 API');
      return;
    }
    const count = Number($('imageGenFissionCount')?.value || 4);
    const btn = $('imageGenFissionAnalyzeBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '分析中…';
    }
    try {
      const compressed = await compressImageDataUrl(refImage, 1280);
      const styleId = $('imageGenFissionStyle')?.value || 'inherit';
      let styleTag = '';
      if (styleId && styleId !== 'inherit' && styleId !== 'none') {
        styleTag = window.ImageGenPromptKit?.getArtStyleTag?.(styleId) || '';
      }
      const payload = { imageBase64: compressed, count };
      if (styleTag) payload.styleTag = styleTag;
      const r = await window.PromptHubApi.promptToolsFission(payload);
      if (!r.ok) throw new Error(r.message || '裂变分析失败');
      const prompts = r.data?.prompts || [];
      if (!prompts.length) throw new Error('未生成变体提示词');
      renderPromptChecklist('imageGenFissionList', prompts, (p) => setPrompt(p));
      if (typeof r.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(r.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      const dna = (r.data?.dna || '').trim();
      const dnaEl = $('imageGenFissionDna');
      if (dnaEl) {
        dnaEl.textContent = dna ? `美学 DNA：${dna}` : '';
        dnaEl.hidden = !dna;
      }
      const charged = r.data?.creditsCharged ?? fissionPlanCreditsHint;
      toast(`已生成 ${prompts.length} 条裂变方案（-${charged} 积分）`);
    } catch (e) {
      toast(e.message || '裂变分析失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = fissionAnalyzeBtnLabel();
      }
      updateRefToolState();
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function batchSubmitSleep() {
    return sleep(BATCH_SUBMIT_GAP_MS + Math.floor(Math.random() * BATCH_SUBMIT_JITTER_MS));
  }

  function ensurePromptApi(method) {
    if (typeof window.PromptHubApi?.[method] === 'function') return true;
    toast('脚本版本过旧，请按 Ctrl+Shift+R 强刷后再试');
    return false;
  }

  async function onOptimizePrompt() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    if (!ensurePromptApi('promptToolsOptimize')) return;
    const raw = ($('imageGenPrompt')?.value || $('imageGenInspirePrompt')?.value || '').trim();
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
        btn.textContent = optimizeBtnLabel();
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

  async function onReversePrompt() {
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    if (!ensurePromptApi('promptToolsReverse')) return;
    const refImage = getFirstRefImage();
    if (!refImage) {
      toast('请先在上方参考图添加一张图片');
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
      const compressed = await compressImageDataUrl(refImage, 1280);
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
      updateRefToolState();
    }
  }

  function switchRefTool(tool) {
    const next = activeRefTool === tool ? '' : (tool || '');
    activeRefTool = next;
    document.querySelectorAll('[data-ref-tool]').forEach((btn) => {
      const on = btn.dataset.refTool === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-ref-tool-panel]').forEach((pane) => {
      pane.hidden = pane.dataset.refToolPanel !== next;
    });
  }

  function updateImageGenModeFooter(_mode) {
    /* 生成 / 批量按钮已移入各模式面板内 */
  }

  function switchImageGenMode(mode) {
    const next = mode === 'inspire' ? 'inspire' : 'gen';
    currentImageGenMode = next;
    document.body.dataset.imagegenMode = next;
    document.querySelectorAll('[data-imagegen-mode]').forEach((btn) => {
      const on = btn.dataset.imagegenMode === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-imagegen-mode-panel]').forEach((pane) => {
      const on = pane.dataset.imagegenModePanel === next;
      pane.classList.toggle('active', on);
      pane.hidden = !on;
    });
    const layout = $('imageGenLayout');
    layout?.classList.toggle('imagegen-layout--inspire-mode', next === 'inspire');
    layout?.classList.toggle('imagegen-layout--gen-mode', next === 'gen');
    const genHero = $('imageGenGenHero');
    const inspireHero = $('imageGenInspireHero');
    if (genHero) genHero.hidden = next !== 'gen';
    if (inspireHero) inspireHero.hidden = next !== 'inspire';
    const veil = $('imageGenInspireVeil');
    const genVeil = $('imageGenGenVeil');
    if (veil) veil.setAttribute('aria-hidden', next === 'inspire' ? 'false' : 'true');
    if (genVeil) genVeil.setAttribute('aria-hidden', next === 'gen' ? 'false' : 'true');
    const ledger = $('creditLedgerPanel');
    if (ledger) ledger.classList.add('hidden');
    $('imageGenDockGen')?.toggleAttribute('hidden', next !== 'gen');
    $('imageGenDockInspire')?.toggleAttribute('hidden', next !== 'inspire');
    $('imageGenInspirePromptSection')?.toggleAttribute('hidden', next !== 'inspire');
    updateImageGenModeFooter(next);
    void updateBatchCostLabel();
  }

  function bindToolbox() {
    if (toolboxBound) return;
    toolboxBound = true;

    document.querySelectorAll('[data-imagegen-mode]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => switchImageGenMode(btn.dataset.imagegenMode));
    });

    const optimizeToggle = $('imageGenOptimizeToggle');
    const optimizePop = $('imageGenOptimizePop');
    if (optimizeToggle && optimizePop && !optimizeToggle.dataset.bound) {
      optimizeToggle.dataset.bound = '1';
      optimizeToggle.addEventListener('click', () => {
        const open = optimizePop.hidden;
        optimizePop.hidden = !open;
        optimizeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    $('imageGenReverseToolBtn')?.addEventListener('click', () => switchRefTool('reverse'));
    $('imageGenFissionToolBtn')?.addEventListener('click', () => switchRefTool('fission'));

    $('imageGenInspireDrawBtn')?.addEventListener('click', onDrawInspiration);
    $('imageGenInspireBatchBtn')?.addEventListener('click', () => void onQueueBatch());
    $('imageGenInspireSubmit')?.addEventListener('click', () => {
      const prompt = $('imageGenInspirePrompt')?.value?.trim();
      if (!prompt) {
        toast('请先填写或抽卡获得提示词');
        return;
      }
      void window.FeatureDraft?.runImageGenWithPrompt?.(prompt, { fromInspirationDraw: true, submitBtnId: 'imageGenInspireSubmit' });
    });
    $('imageGenOptimizeBtn')?.addEventListener('click', () => void onOptimizePrompt());
    $('imageGenReverseBtn')?.addEventListener('click', () => void onReversePrompt());
    $('imageGenFissionAnalyzeBtn')?.addEventListener('click', () => void onFissionAnalyze());
    $('imageGenFissionBatchBtn')?.addEventListener('click', () => void onQueueFissionBatch());
    $('imageGenInspireCount')?.addEventListener('change', () => void updateBatchCostLabel());
    $('imageGenFissionCount')?.addEventListener('change', () => void updateBatchCostLabel());
    ['imageGenModel', 'imageGenResolution', 'imageGenQuality'].forEach((id) => {
      $(id)?.addEventListener('change', () => void updateBatchCostLabel());
    });

    $('imageGenInspirePrompt')?.addEventListener('input', () => {
      const inspireTa = $('imageGenInspirePrompt');
      const genTa = $('imageGenPrompt');
      if (inspireTa && genTa && genTa.value !== inspireTa.value) {
        genTa.value = inspireTa.value;
        genTa.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const typeChips = $('imageGenInspireTypeChips');
    if (typeChips && window.ImageGenPromptKit?.listContentTypes && !typeChips.dataset.filled) {
      typeChips.dataset.filled = '1';
      renderInspireTypeChips();
    }

    const styleSel = $('imageGenInspireStyle');
    if (styleSel && window.ImageGenPromptKit?.listArtStyles && !styleSel.dataset.filled) {
      styleSel.dataset.filled = '1';
      styleSel.innerHTML = '';
      window.ImageGenPromptKit.listArtStyles().forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label;
        styleSel.appendChild(opt);
      });
      styleSel.value = 'auto';
    }

    const fissionStyleSel = $('imageGenFissionStyle');
    if (fissionStyleSel && window.ImageGenPromptKit?.listArtStyles && !fissionStyleSel.dataset.filled) {
      fissionStyleSel.dataset.filled = '1';
      fissionStyleSel.innerHTML = '';
      const inherit = document.createElement('option');
      inherit.value = 'inherit';
      inherit.textContent = '继承源图（默认）';
      fissionStyleSel.appendChild(inherit);
      window.ImageGenPromptKit.listArtStyles().forEach((t) => {
        if (t.id === 'auto') return;
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label}（${t.hint}）`;
        fissionStyleSel.appendChild(opt);
      });
      fissionStyleSel.value = 'inherit';
    }

    switchImageGenMode('gen');
    updateRefToolState();
  }

  function initImageGenPromptTools() {
    resetBatchState();
    bindToolbox();
    updateRefToolState();
    updateInspireDrawQuotaUI();
    void refreshFissionPricingHint();
    void refreshOptimizePricingHint();
    void updateBatchCostLabel();
  }

  window.ImageGenPromptTools = {
    init: initImageGenPromptTools,
    switchMode: switchImageGenMode,
    updateBatchCostLabel,
    resetBatchState,
    applyQuota: applyInspireDrawQuota,
    updateQuotaUI: updateInspireDrawQuotaUI,
    updateRefToolState
  };
})();
