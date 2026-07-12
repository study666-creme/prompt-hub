  function formatMjActionCredits(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const fmt = window.PointsSystem?.formatCreditsDisplay;
    return fmt ? fmt(n) : String(n);
  }

  function buildMjActionsHtml(buttons, parentJobId, unitCost) {
    const parent = normalizeMjParentJobId(parentJobId);
    const list = filterMjPreviewButtons(buttons);
    if (!list.length || !parent) return '';
    const items = list
      .map((b, i) => {
        const rawAction = String(b.action || 'custom');
        const action = esc(rawAction);
        const baseLabel = String(b.label || '操作');
        const priceTag =
          isMjBillableAction(rawAction) && unitCost != null
            ? ` · ${formatMjActionCredits(unitCost)}积分`
            : '';
        const label = esc(`${baseLabel}${priceTag}`);
        const hint = esc(getMjActionHint(rawAction));
        const index = b.index != null ? Number(b.index) : '';
        const customId = b.customId ? esc(String(b.customId)) : '';
        return `<button type="button" class="btn btn-secondary btn-sm imagegen-mj-action-btn" data-mj-action="${action}" data-mj-parent="${esc(parent)}" data-mj-index="${index}" data-mj-custom="${customId}" data-mj-idx="${i}" title="${hint}" aria-label="${label}：${hint}">${label}</button>`;
      })
      .join('');
    return `<div class="imagegen-mj-actions" role="group" aria-label="Midjourney 操作">${items}</div>`;
  }

  function buildMjActionsBlock(buttons, parentJobId, previewCard) {
    const list = filterMjPreviewButtons(buttons);
    if (!list.length || !normalizeMjParentJobId(parentJobId)) return '';
    const unit = getMjActionUnitCost(previewCard);
    return buildMjActionsHtml(list, parentJobId, unit);
  }

  async function runImageGenMjAction(btn) {
    if (!btn || btn.disabled) return;
    if (!window.AuthGate?.requireAuth?.('imagegen')) return;
    const parentJobId = normalizeMjParentJobId(btn.dataset.mjParent);
    const action = btn.dataset.mjAction;
    if (!parentJobId || !action || action === 'custom') {
      toast('该操作暂不支持，请换其他按钮');
      return;
    }
    if (action === 'upscale' || /upsample|upscale/i.test(btn.dataset.mjCustom || '')) {
      toast('放大已关闭：四宫格已自动保存，请直接切换或下载');
      return;
    }
    const payload = {
      parentJobId,
      action,
      index: btn.dataset.mjIndex ? Number(btn.dataset.mjIndex) : undefined,
      customId: btn.dataset.mjCustom || undefined
    };
    if (!payload.index && !payload.customId && action === 'variation') {
      toast('请选择具体序号');
      return;
    }
    const previewBody = document.getElementById('imageGenPreviewBody');
    const previewCard = imageGenPreviewKind === 'warehouse' && imageGenPreviewId
      ? findWarehouseCardById(imageGenPreviewId)
      : null;
    const unitCost = getMjActionUnitCost(previewCard);
    if (isMjBillableAction(action) && unitCost != null) {
      const balance = window.PointsSystem?.getCredits?.() ?? 0;
      if (balance < unitCost) {
        toast(`积分不足（需要 ${formatMjActionCredits(unitCost)} 积分）`);
        return;
      }
    }
    if (action === 'inpaint') {
      const ok = confirm(
        '局部重绘：只修改选定区域并保留其余部分。\n\n当前版本点击后会直接提交任务（扣积分等同一次生图），暂不支持在预览里画选区。\n\n确定继续？'
      );
      if (!ok) return;
    }
    const model = previewCard?.model || getImageGenModel();
    const modelLabel = window.PointsSystem?.getImageGenModel?.(model)?.label || model;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const res = await window.PromptHubApi.mjAction(payload);
      if (!res.ok) {
        toast(friendlyGenErrorMessage(res.message) || '操作失败');
        return;
      }
      if (typeof res.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(res.data.creditsRemaining);
        window.PointsSystem?.updateCreditsUI?.();
      }
      const jobId = res.data?.jobId;
      const cost = res.data?.creditsCharged ?? 0;
      if (jobId) {
        const pendingId = genId('pending');
        const saveTarget = getImageGenSaveTarget();
        const pendingJob = {
          id: pendingId,
          prompt: previewBody?.dataset?.previewPrompt || `[MJ ${action}]`,
          model,
          modelLabel,
          resolution: previewCard?.resolution || '1k',
          quality: previewCard?.quality || 'standard',
          size: previewCard?.size || getImageGenSize?.() || '1:1',
          cost,
          jobId,
          targetGroup: saveTarget.targetGroup,
          targetTags: saveTarget.targetTags,
          startedAt: Date.now(),
          silentToast: true,
          mjAction: action
        };
        imageGenPendingJobs.unshift(pendingJob);
        trackSessionGenJob(jobId);
        persistPendingGenJobs();
        void pollGenerationJobUntilDone(jobId, pendingId, {
          prompt: pendingJob.prompt,
          model,
          resolution: pendingJob.resolution,
          quality: pendingJob.quality,
          size: pendingJob.size,
          cost,
          jobId,
          targetGroup: saveTarget.targetGroup,
          targetTags: saveTarget.targetTags,
          silentToast: true
        });
      }
      const actionName = String(prevText || '').split('·')[0].trim() || action;
      toast(
        cost > 0
          ? `已提交${actionName}（-${formatMjActionCredits(cost)} 积分），完成后追加到原卡片`
          : '已提交，完成后会自动存入原卡片'
      );
      scheduleGenJobsSync(400);
      void resumePendingGenerationJobs();
      renderImageGenFeed({ preserveScroll: true });
    } catch (e) {
      toast('操作失败，请稍后重试');
      console.warn('[mj-action]', e);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function syncImageGenQualityUI() {
    syncImageGenModelParamsUI();
  }

  function imageGenSizeOptionsForModel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    if (Array.isArray(entry?.aspectRatios) && entry.aspectRatios.length) {
      return [...entry.aspectRatios];
    }
    if (IMAGE_GEN_ASPECT_FALLBACK[id]) {
      return [...IMAGE_GEN_ASPECT_FALLBACK[id]];
    }
    if (entry?.uiFamily === 'banana' || id.startsWith('lingtu')) {
      const list = [...IMAGE_GEN_SIZE_BANANA];
      if (BANANA2_EXTENDED_MODELS.has(id)) list.push(...IMAGE_GEN_SIZE_BANANA2_EXTRA);
      return list;
    }
    if (id.startsWith('apimart-mj-') || entry?.uiFamily === 'midjourney') {
      return IMAGE_GEN_SIZE_MJ;
    }
    if (entry?.uiFamily === 'gim2' || id.startsWith('image2')) {
      return IMAGE_GEN_SIZE_GIM2;
    }
    return IMAGE_GEN_SIZE_BASIC;
  }

  function updateImageGenSizeSelect() {
    const sel = document.getElementById('imageGenSize');
    const modelSel = document.getElementById('imageGenModel');
    if (!sel) return;
    const current = sel.value || '1:1';
    const options = imageGenSizeOptionsForModel(modelSel?.value || getImageGenModel());
    if (!options.length) {
      sel.dataset.sizeOptions = '';
      sel.innerHTML = '';
      sel.value = '';
      return;
    }
    const key = options.join('|');
    if (sel.dataset.sizeOptions === key) return;
    sel.dataset.sizeOptions = key;
    sel.innerHTML = options
      .map((value) => `<option value="${esc(value)}">${esc(imageGenSizeOptionLabel(value))}</option>`)
      .join('');
    if (options.includes(current)) sel.value = current;
    else sel.value = options.includes('16:9') ? '16:9' : options.includes('1:1') ? '1:1' : options[0];
  }

  function readImageGenSaveTargetPrefs() {
    try {
      const raw = localStorage.getItem(IMAGE_GEN_SAVE_TARGET_LS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeImageGenSaveTargetPrefs(prefs) {
    try {
      localStorage.setItem(IMAGE_GEN_SAVE_TARGET_LS, JSON.stringify(prefs || {}));
    } catch (e) { /* ignore */ }
  }

  let imageGenSelectedTargetTags = [];

  function syncImageGenTagPickerValueLabel() {
    const valEl = document.getElementById('imageGenTagPickerValue');
    if (!valEl) return;
    const tags = imageGenSelectedTargetTags.filter(Boolean);
    if (!tags.length) {
      valEl.textContent = '未选择';
      valEl.classList.remove('has-tags');
      return;
    }
    valEl.classList.add('has-tags');
    valEl.textContent = tags.length <= 2 ? tags.join('、') : `${tags.slice(0, 2).join('、')} 等 ${tags.length} 个`;
  }

  function closeImageGenTagPickerPanel() {
    const panel = document.getElementById('imageGenTagPickerPanel');
    const trigger = document.getElementById('imageGenTagPickerTrigger');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function persistImageGenSaveTargetPrefs() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    writeImageGenSaveTargetPrefs({
      group: groupSel?.value || '',
      tags: [...imageGenSelectedTargetTags]
    });
  }

  function toggleImageGenTargetTag(tag) {
    const name = window.normalizeCardTagName?.(tag) || String(tag || '').trim();
    if (!name || window.isSystemCardTag?.(name)) return;
    const i = imageGenSelectedTargetTags.findIndex((t) => (window.normalizeCardTagName?.(t) || t) === name);
    if (i >= 0) imageGenSelectedTargetTags.splice(i, 1);
    else imageGenSelectedTargetTags.push(name);
    syncImageGenTagPickerValueLabel();
    persistImageGenSaveTargetPrefs();
    renderImageGenTagPickerOptions();
  }

  function renderImageGenTagPickerOptions() {
    const panel = document.getElementById('imageGenTagPickerPanel');
    if (!panel) return;
    const tags = window.getUserCreatedCardTags?.() || [];
    const selected = new Set(imageGenSelectedTargetTags.map((t) => window.normalizeCardTagName?.(t) || t));
    panel.innerHTML = '';
    if (!tags.length) {
      panel.innerHTML = '<p class="imagegen-tag-picker-empty">暂无自定义标签</p>';
      return;
    }
    tags.forEach((tag) => {
      const name = window.normalizeCardTagName?.(tag) || tag;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'imagegen-tag-picker-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected.has(name) ? 'true' : 'false');
      row.dataset.tag = name;
      const check = document.createElement('span');
      check.className = 'imagegen-tag-picker-check';
      check.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'imagegen-tag-picker-label';
      label.textContent = name;
      row.append(check, label);
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleImageGenTargetTag(name);
      });
      panel.appendChild(row);
    });
  }

  function updateImageGenSaveTargetSelects() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    const prefs = readImageGenSaveTargetPrefs();
    if (groupSel) {
      const prev = groupSel.value || prefs.group || '';
      const groups = window.getCustomGroupsList?.() || [];
      groupSel.innerHTML = '<option value="">未分类（默认）</option>';
      groups.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        groupSel.appendChild(opt);
      });
      if (prev && (prev === '' || groups.includes(prev))) groupSel.value = prev;
      else groupSel.value = '';
    }
    const prefTags = Array.isArray(prefs.tags)
      ? prefs.tags
        .map((t) => window.normalizeCardTagName?.(t) || t)
        .filter((t) => t && !window.isSystemCardTag?.(t))
      : [];
    const available = new Set(
      (window.getUserCreatedCardTags?.() || []).map((t) => window.normalizeCardTagName?.(t) || t)
    );
    imageGenSelectedTargetTags = prefTags.filter((t) => available.has(t));
    renderImageGenTagPickerOptions();
    syncImageGenTagPickerValueLabel();
  }

  function getImageGenSaveTarget() {
    const group = document.getElementById('imageGenTargetGroup')?.value?.trim() || '';
    const tags = imageGenSelectedTargetTags.filter((t) => t && !window.isSystemCardTag?.(t));
    return {
      targetGroup: group || null,
      targetTags: tags
    };
  }

  function bindImageGenSaveTarget() {
    const groupSel = document.getElementById('imageGenTargetGroup');
    const picker = document.getElementById('imageGenTagPicker');
    const trigger = document.getElementById('imageGenTagPickerTrigger');
    const panel = document.getElementById('imageGenTagPickerPanel');
    if (groupSel && !groupSel.dataset.bound) {
      groupSel.dataset.bound = '1';
      groupSel.addEventListener('change', persistImageGenSaveTargetPrefs);
    }
    if (!picker || !trigger || !panel || picker.dataset.bound) return;
    picker.dataset.bound = '1';
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      if (open) {
        renderImageGenTagPickerOptions();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        closeImageGenTagPickerPanel();
      }
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('.imagegen-tag-picker-option');
        if (row?.dataset?.tag) {
          e.preventDefault();
          toggleImageGenTargetTag(row.dataset.tag);
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target)) closeImageGenTagPickerPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeImageGenTagPickerPanel();
    });
  }

  function updateImageGenResolutionSelect() {
    const sel = document.getElementById('imageGenResolution');
    const modelSel = document.getElementById('imageGenModel');
    if (!sel) return;
    const current = sel.value || '1k';
    const model = imageGenModelCatalog.find((x) => x.id === modelSel?.value);
    const resolutions = model?.resolutions?.length ? model.resolutions : ['1k', '2k', '4k'];
    const key = resolutions.join('|');
    if (sel.dataset.resOptions !== key) {
      sel.dataset.resOptions = key;
      sel.innerHTML = resolutions
        .map((res) => `<option value="${esc(res)}">${esc(res.toUpperCase())}</option>`)
        .join('');
    }
    if (resolutions.includes(current)) sel.value = current;
    else sel.value = resolutions[0];
    updateImageGenSizeSelect();
  }

  function getImageGenAutoPublishDefault() {
    return window.getDefaultImageGenAutoPublish?.() !== false;
  }

  function syncImageGenAutoPublishUI() {
    const btn = document.getElementById('imageGenAutoPublishBtn');
    if (!btn) return;
    const globalOn = getImageGenAutoPublishDefault();
    const on = imageGenAutoPublishSession === null ? globalOn : imageGenAutoPublishSession;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function isImageGenAutoPublishChecked() {
    return document.getElementById('imageGenAutoPublishBtn')?.classList.contains('is-on') === true;
  }

  function bindImageGenAutoPublish() {
    const btn = document.getElementById('imageGenAutoPublishBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      imageGenAutoPublishSession = on;
    });
  }

  function getImageGenAutoSaveDefault() {
    return window.getDefaultImageGenAutoSaveWarehouse?.() !== false;
  }

  function syncImageGenAutoSaveUI() {
    const btn = document.getElementById('imageGenAutoSaveBtn');
    if (!btn) return;
    const globalOn = getImageGenAutoSaveDefault();
    const on = imageGenAutoSaveSession === null ? globalOn : imageGenAutoSaveSession;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function isImageGenAutoSaveChecked() {
    return document.getElementById('imageGenAutoSaveBtn')?.classList.contains('is-on') === true;
  }

  function bindImageGenAutoSave() {
    const btn = document.getElementById('imageGenAutoSaveBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      imageGenAutoSaveSession = on;
    });
  }

  function getImageGenGenPublicDefault() {
    return window.getDefaultImageGenAutoPublish?.() !== false;
  }

  function syncImageGenGenPublicFromPrompt() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn) return;
    if (imageGenGenPublicSession !== null) {
      btn.classList.toggle('is-on', imageGenGenPublicSession);
      btn.setAttribute('aria-pressed', imageGenGenPublicSession ? 'true' : 'false');
      return;
    }
    const prompt = document.getElementById('imageGenPrompt')?.value || '';
    const on = computeAutoCommunityToggle(prompt, getImageGenGenPublicDefault(), null);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncImageGenGenPublicUI() {
    syncImageGenGenPublicFromPrompt();
  }

  function isImageGenGenPublicChecked() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn) return getImageGenGenPublicDefault();
    return btn.classList.contains('is-on');
  }

  function bindImageGenGenPublic() {
    const btn = document.getElementById('imageGenGenPublicBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOn = !btn.classList.contains('is-on');
      imageGenGenPublicSession = willOn;
      btn.classList.toggle('is-on', willOn);
      btn.setAttribute('aria-pressed', willOn ? 'true' : 'false');
    });
  }

  function restoreImageGenSubmitLabel() {
    updateImageGenCostHint();
  }

  let imageGenCostHintSeq = 0;
  let imageGenCostDebounceTimer = null;
  let imageGenBatchRunning = false;

  function getImageGenBatchCount() {
    const n = Number(document.getElementById('imageGenCount')?.value || 1);
    return Math.min(5, Math.max(1, Math.floor(n) || 1));
  }

  function setImageGenBatchCount(n) {
    const v = Math.min(5, Math.max(1, Math.floor(Number(n)) || 1));
    const input = document.getElementById('imageGenCount');
    if (input) input.value = String(v);
    const label = document.getElementById('imageGenCountLabel');
    if (label) label.textContent = `${v} 张`;
    document.querySelectorAll('#imageGenCountMenu [data-count]').forEach((btn) => {
      const on = Number(btn.dataset.count) === v;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    syncImageGenBatchSplitUi();
    updateImageGenCostHint();
  }

  function closeImageGenCountMenu() {
    const menu = document.getElementById('imageGenCountMenu');
    const trigger = document.getElementById('imageGenCountTrigger');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function openImageGenCountMenu() {
    const menu = document.getElementById('imageGenCountMenu');
    const trigger = document.getElementById('imageGenCountTrigger');
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.minWidth = `${Math.max(rect.width, 72)}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    menu.style.top = 'auto';
    menu.style.zIndex = '200';
  }

  function bindImageGenCountPicker() {
    const trigger = document.getElementById('imageGenCountTrigger');
    const menu = document.getElementById('imageGenCountMenu');
    if (!trigger || !menu || trigger.dataset.bound === '1') return;
    trigger.dataset.bound = '1';
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openImageGenCountMenu();
      else closeImageGenCountMenu();
    });
    menu.querySelectorAll('[data-count]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setImageGenBatchCount(btn.dataset.count);
        closeImageGenCountMenu();
      });
    });
    document.addEventListener('click', closeImageGenCountMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeImageGenCountMenu();
    });
    window.addEventListener('resize', closeImageGenCountMenu);
    window.addEventListener('scroll', closeImageGenCountMenu, true);
  }

  function shouldImageGenBatchMergeCards() {
    if (isImageGenMidjourneyModel(getImageGenModel())) return false;
    return !isImageGenBatchSplitCards();
  }

  function getImageGenCardTitle() {
    return String(document.getElementById('imageGenCardTitle')?.value || '').trim().slice(0, 80);
  }

  function isImageGenBatchSplitCards() {
    return !!document.getElementById('imageGenBatchSplit')?.checked;
  }

  function syncImageGenBatchSplitUi() {
    const wrap = document.getElementById('imageGenBatchSplitWrap');
    const count = getImageGenBatchCount();
    const isBlend = getImageGenMjMode() === 'blend' && isImageGenMidjourneyModel(getImageGenModel());
    const isMj = isImageGenMidjourneyModel(getImageGenModel());
    if (wrap) {
      wrap.classList.toggle('is-hidden', count <= 1 || isBlend || isMj);
    }
  }

  function roundCreditsSafe(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 10) / 10;
  }

  function formatImageGenUnitPrice(detail, final, fmt) {
    if (window.PointsSystem?.formatImageGenUnitPrice) {
      return window.PointsSystem.formatImageGenUnitPrice(detail, final);
    }
    const unitLabel = (fmt || ((n) => String(n)))(final);
    return `${unitLabel} 积分/张`;
  }

  function syncImageGenPromoNotice(detail, final) {
    const msg = window.PointsSystem?.formatImageGenPromoNotice?.(detail, final) || '';
    ['imageGenPromoNotice', 'imageGenInspirePromoNotice'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
  }

  function applyImageGenCostDisplay(detail, final, quality, size) {
    const hint = document.getElementById('imageGenCostHint');
    const btn = document.getElementById('imageGenSubmit');
    const isBlend = getImageGenMjMode() === 'blend' && isImageGenMidjourneyModel(getImageGenModel());
    const count = isBlend ? 1 : getImageGenBatchCount();
    const fmt = window.PointsSystem?.formatCredits || ((n) => String(n));
    const unitPerSheet = `${fmt(final)} 积分/张`;
    const total = roundCreditsSafe(final * count);
    const totalLabel = fmt(total);
    const submitLabel = isBlend
      ? `开始混图 · ${unitPerSheet}`
      : count > 1
        ? `生成 ${count} 张 · ${totalLabel} 积分`
        : `生成图片 · ${unitPerSheet}`;
    if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = submitLabel;
    if (!hint) return;
    const modelLabel =
      detail?.modelLabel
      || imageGenModelCatalog.find((m) => m.id === getImageGenModel())?.label
      || imageGenModelLabel(detail?.modelId || getImageGenModel());
    const sizeLabel =
      document.getElementById('imageGenSize')?.selectedOptions?.[0]?.textContent?.trim() || size;
    const qualLabel =
      { standard: '低', high: '中', ultra: '高' }[quality] || quality;
    const parts = [modelLabel, qualLabel, sizeLabel];
    if (isBlend) {
      parts.push(`混图 · ${unitPerSheet}`);
    } else if (count > 1) {
      const isMj = isImageGenMidjourneyModel(getImageGenModel());
      parts.push(
        isMj || isImageGenBatchSplitCards()
          ? `${count} 张 · 共 ${totalLabel} 积分（${unitPerSheet}）`
          : `${count} 张 · 同卡入库 · 共 ${totalLabel} 积分`
      );
    } else {
      parts.push(unitPerSheet);
    }
    const refCount = getImageGenRefImages().length;
    if (refCount) {
      parts.push(`参考图 ${refCount} 张`);
    }
    hint.textContent = parts.join(' · ');
    syncImageGenPromoNotice(detail, final);
  }

  function catalogHasPricingFor(modelId, resolution, mjSpeed) {
    const m = imageGenModelCatalog.find((x) => x.id === modelId);
    if (!m) return false;
    if (m.pricingBySpeed) {
      const speed = mjSpeed === 'fast' || mjSpeed === 'turbo' ? mjSpeed : 'relax';
      if (m.costBySpeed?.[speed] && Number.isFinite(Number(m.costBySpeed[speed].final))) return true;
      if (m.creditsBySpeed?.[speed] != null) return true;
    }
    const res = normalizeImageGenResolution(resolution);
    if (m.costByResolution?.[res] && Number.isFinite(Number(m.costByResolution[res].final))) return true;
    if (m.pricingByResolution && m.creditsByResolution?.[res] != null) return true;
    if (Number.isFinite(Number(m.creditsFinal))) return true;
    return false;
  }

  function updateImageGenCostHintNow() {
    const btn = document.getElementById('imageGenSubmit');
    const hint = document.getElementById('imageGenCostHint');
    if (!imageGenModelCatalogReady) {
      if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = '生成图片 · 加载中…';
      if (hint) hint.textContent = '模型与计价加载中…';
      return;
    }
    const { model, resolution, quality, size } = getImageGenFormMeta();
    const mjSpeed = isImageGenMidjourneyModel(model) ? getImageGenMjSpeed() : null;
    const detail = window.PointsSystem?.getImageGenCostDetail?.(model, resolution, mjSpeed);
    const final = detail?.final;
    if (final == null || !Number.isFinite(Number(final))) {
      if (btn && !btn.disabled && !imageGenBatchRunning) btn.textContent = '生成图片 · — 积分';
      if (hint) hint.textContent = '计价加载中…';
      return;
    }
    applyImageGenCostDisplay(detail, final, quality, size);
    window.ImageGenPromptTools?.updateBatchCostLabel?.();
    if (catalogHasPricingFor(model, resolution, mjSpeed)) return;
    clearTimeout(imageGenCostDebounceTimer);
    imageGenCostDebounceTimer = setTimeout(() => {
      const speed = isImageGenMidjourneyModel(model) ? getImageGenMjSpeed() : null;
      void refreshImageGenCostFromApi(model, resolution, quality, size, speed);
    }, 1200);
  }

  let imageGenCostHintRaf = 0;
  function updateImageGenCostHint() {
    if (imageGenCostHintRaf) cancelAnimationFrame(imageGenCostHintRaf);
    imageGenCostHintRaf = requestAnimationFrame(() => {
      imageGenCostHintRaf = 0;
      updateImageGenCostHintNow();
    });
  }

  const GEN_COST_QUOTE_TIMEOUT_MS = window.matchMedia?.('(max-width: 900px)')?.matches ? 1200 : 1800;
  const REF_URL_RESOLVE_TIMEOUT_MS = 8000;

  async function quoteGenerationCost(resolution, quality, model, localFallback) {
    const fallback = Number(localFallback) || 10;
    if (!window.PointsSystem?.useApiForAccount?.()) {
      return { cost: fallback, fromApi: false };
    }
    try {
      const quote = await Promise.race([
        window.PromptHubApi.getGenerationCost(resolution, quality, model, localFallback?.speed ? { speed: localFallback.speed } : undefined),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('cost quote timeout')), GEN_COST_QUOTE_TIMEOUT_MS);
        })
      ]);
      if (quote.ok && quote.data?.final != null) {
        return { cost: quote.data.final, fromApi: true };
      }
    } catch (e) {
      console.warn('[imagegen] cost quote fallback', e);
    }
    return { cost: fallback, fromApi: false };
  }

  function resetImageGenSubmitState() {
    imageGenBatchRunning = false;
    window.ImageGenPromptTools?.resetBatchState?.();
    const btn = document.getElementById('imageGenSubmit');
    if (btn) {
      btn.disabled = false;
      restoreImageGenSubmitLabel();
    }
  }

  async function refreshImageGenCostFromApi(model, resolution, quality, size, mjSpeed) {
    if (!window.PointsSystem?.useApiForAccount?.()) return;
    const seq = ++imageGenCostHintSeq;
    const speedOpt = mjSpeed ? { speed: mjSpeed } : undefined;
    try {
      const quote = await Promise.race([
        window.PromptHubApi.getGenerationCost(resolution, quality, model, speedOpt),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('cost quote timeout')), GEN_COST_QUOTE_TIMEOUT_MS);
        })
      ]);
      if (seq !== imageGenCostHintSeq) return;
      if (!quote.ok || quote.data?.final == null) return;

      const local = window.PointsSystem?.getImageGenCostDetail?.(model, resolution);

      const detail = Object.assign({}, local || {}, {
        base: quote.data.listPrice ?? quote.data.base ?? local?.listPrice,
        final: quote.data.final,
        listPrice: quote.data.listPrice ?? local?.listPrice,
        promoPrice: quote.data.promoPrice ?? local?.promoPrice,
        appliedDiscount: quote.data.appliedDiscount ?? local?.appliedDiscount,
        modelDiscountLabel: quote.data.appliedDiscount === 'model'
          ? (quote.data.modelDiscountLabel ?? local?.modelDiscountLabel)
          : null,
        saved:
          quote.data.listPrice != null && quote.data.listPrice > quote.data.final
            ? quote.data.listPrice - quote.data.final
            : local?.saved,
        label: quote.data.appliedDiscount === 'member'
          ? (quote.data.discountLabel || local?.label)
          : null,
        modelLabel: quote.data.modelLabel || local?.modelLabel,
        fixed: quote.data.appliedDiscount === 'fixed'
      });
      applyImageGenCostDisplay(detail, quote.data.final, quality, size);
    } catch (e) { /* 保持本地估价 */ }
  }

  function updateImageGenPricingUI() {
    if (!imageGenModelCatalogReady) return;
    scheduleImageGenModelUiRefresh();
  }

  window.updateImageGenPricingUI = updateImageGenPricingUI;
  window.syncImageGenPromoNotice = syncImageGenPromoNotice;

  function getGenHistoryItems() {
    pruneCreations();
    const seen = new Set();
    const list = [];
    for (const c of creations) {
      if (!(c.prompt || '').trim()) continue;
      const key = c.jobId ? `job:${c.jobId}` : `id:${String(c.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(c);
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }

  function fillFormFromData({ prompt, refImage, refImages, model, resolution, quality, size, sourceId, sourceType, refAssetId, referenceAssets }) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const singleRef = refImage && isDisplayableImage(refImage) ? refImage : null;
    const assetId = refAssetId ? String(refAssetId) : '';
    if (refs.length) setImageGenRefs(refs, { assetId, referenceAssets });
    else if (singleRef) setImageGenRefs([singleRef], { assetId, referenceAssets });
    else clearImageGenRef();
    const modelEl = document.getElementById('imageGenModel');
    if (modelEl && model) modelEl.value = model;
    const resEl = document.getElementById('imageGenResolution');
    if (resEl && resolution) resEl.value = resolution;
    const qEl = document.getElementById('imageGenQuality');
    if (qEl && quality) qEl.value = quality;
    const szEl = document.getElementById('imageGenSize');
    if (szEl && size) szEl.value = size;
    updateImageGenPricingUI();
    if (sourceType === 'personal' && sourceId) imageGenActiveHistoryId = sourceId;
    syncImageGenGenPublicFromPrompt();
    renderImageGenFeed({ preserveScroll: true });
    toast('已填入生图框');
  }

  function fillFormPromptOnly(prompt) {
    const promptEl = document.getElementById('imageGenPrompt');
    if (promptEl) promptEl.value = prompt || '';
    syncImageGenGenPublicFromPrompt();
    toast('已填入提示词');
  }

  function fillFormRefOnly(refImage, refImages, opts) {
    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const single = refImage && isDisplayableImage(refImage) ? refImage : null;
    const assetId = opts?.assetId ? String(opts.assetId) : '';
    if (refs.length) setImageGenRefs(refs, { assetId, referenceAssets: opts?.referenceAssets });
    else if (single) setImageGenRefs([single], { assetId, referenceAssets: opts?.referenceAssets });
    else {
      toast('当前作品没有可填入的参考图');
      return;
    }
    toast('已填入参考图');
  }

  function applyHistoryToForm(item) {
    if (!item) return;
    const payload = {
      prompt: item.prompt,
      model: item.model,
      resolution: item.resolution,
      quality: item.quality,
      size: item.size,
      sourceId: item.id,
      sourceType: 'personal',
      referenceAssets: item.referenceAssets
    };
    if (item.hasRefImage) {
      if (item.refImages?.length) payload.refImages = item.refImages;
      else if (item.refImage) payload.refImage = item.refImage;
    }
    fillFormFromData(payload);
  }

  function fillFromCommunityPost(post, autoLike) {
    if (!post) return;
    if (autoLike) ensureLike(post.id);
    fillFormFromData({ prompt: post.prompt });
  }

  function likeCommunityPostOnly(postId) {
    const wasNew = ensureLike(postId);
    toast(wasNew ? '已点赞' : '你已经点过赞了');
  }

  function applyImageGenPrefill() {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PREFILL_KEY);
    try {
      const data = JSON.parse(raw);
      fillFormFromData({
