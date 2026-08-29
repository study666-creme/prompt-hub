/* Prompt-first warehouse interactions. Existing persistence and paid generation
 * remain behind the legacy globals; this file only owns the focused UI layer. */
(function () {
  'use strict';

  const MAX_REFS = 5;
  const FULL_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'];
  const BANANA_RATIOS = FULL_RATIOS.slice();
  const BASIC_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  const MJ_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  let mode = 'card';
  let files = [];
  let activeView = 'library';
  let focusActive = false;
  let catalogLoading = true;
  let catalogRefreshPromise = null;
  const mountedShells = new Map();
  const pickers = new Map();

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function setStatus(message, tone) {
    const el = byId('warehouseComposerDropHint');
    if (!el) return;
    el.textContent = message || '支持拖拽、点击上传或 Ctrl+V 粘贴图片';
    el.dataset.tone = tone || '';
  }

  function renderFiles() {
    const strip = byId('warehouseComposerRefStrip');
    if (!strip) return;
    strip.replaceChildren();
    strip.hidden = !files.length;
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'warehouse-composer-ref';
      const img = document.createElement('img');
      img.alt = file.name || `参考图 ${index + 1}`;
      img.loading = 'lazy';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'warehouse-composer-ref-remove';
      remove.setAttribute('aria-label', `移除参考图 ${index + 1}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => { files.splice(index, 1); renderFiles(); });
      item.append(img, remove);
      const reader = new FileReader();
      reader.onload = () => { img.src = String(reader.result || ''); };
      reader.readAsDataURL(file);
      strip.appendChild(item);
    });
    byId('warehouseComposerBox')?.classList.toggle('has-references', files.length > 0);
  }

  function addFiles(list) {
    const incoming = [...(list || [])].filter((file) => file && /^image\//i.test(file.type));
    if (!incoming.length) return;
    const available = Math.max(0, MAX_REFS - files.length);
    files = files.concat(incoming.slice(0, available));
    renderFiles();
    setStatus(incoming.length > available ? `最多添加 ${MAX_REFS} 张参考图` : `${files.length} 张参考图已准备`, incoming.length > available ? 'warning' : 'ready');
  }

  function copyFilesToInput(input, list) {
    if (!input || !list.length || typeof DataTransfer !== 'function') return false;
    try {
      const transfer = new DataTransfer();
      list.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (error) { return false; }
  }

  function catalog() {
    const globalCatalog = Array.isArray(window.__IMAGE_GEN_MODELS__) ? window.__IMAGE_GEN_MODELS__ : [];
    if (globalCatalog.length) return globalCatalog.filter((model) => model && model.id && model.id !== 'image2-free' && model.status !== 'offline');
    return [];
  }

  function entryFor(id) {
    return catalog().find((model) => String(model.id) === String(id)) || null;
  }

  function modelLabel(model) {
    return model?.label || model?.displayLabel || model?.catalogLabel || model?.id || '模型';
  }

  function modelFamilyLabel(model) {
    const family = String(model?.uiFamily || '').toLowerCase();
    if (family === 'gim2') return '全能模型2';
    if (family === 'banana') return '香蕉';
    if (family === 'midjourney') return 'Midjourney';
    return '其他模型';
  }

  function formatCredits(value) {
    const formatter = window.PointsSystem?.formatCredits;
    if (typeof formatter === 'function') return formatter(value);
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
  }

  function updateCostHint(detail, quotedFinal) {
    const hint = byId('warehouseComposerCostHint');
    if (!hint) return;
    if (mode !== 'image') {
      hint.hidden = true;
      hint.textContent = '';
      return;
    }
    hint.hidden = false;
    const model = byId('warehouseComposerModel')?.value || '';
    const resolution = byId('warehouseComposerResolution')?.value || '1k';
    const speed = byId('imageGenMjSpeedSelect')?.value || undefined;
    const localDetail = detail || window.PointsSystem?.getImageGenCostDetail?.(model, resolution, speed);
    const final = Number.isFinite(Number(quotedFinal)) ? Number(quotedFinal) : Number(localDetail?.final);
    hint.textContent = Number.isFinite(final) && final >= 0
      ? `预计消耗 ${formatCredits(final)} 积分/张`
      : '预计消耗：计价加载中…';
  }

  function updateCostHintFromForm() {
    updateCostHint();
  }

  function refreshComposerCatalog() {
    if (catalogRefreshPromise) return catalogRefreshPromise;
    catalogLoading = true;
    renderModelPicker();
    catalogRefreshPromise = Promise.resolve(window.FeatureDraft?.refreshImageGenModelCatalog?.({ force: true }))
      .catch(() => false)
      .finally(() => {
        catalogLoading = false;
        catalogRefreshPromise = null;
        renderModelPicker();
        renderRatioPicker();
        renderResolutionPicker();
      });
    return catalogRefreshPromise;
  }

  function ratiosFor(model) {
    const declared = Array.isArray(model?.aspectRatios) ? model.aspectRatios.filter(Boolean) : [];
    const family = String(model?.uiFamily || '').toLowerCase();
    if ((family === 'gim2' || family === 'banana') && declared.length < FULL_RATIOS.length) return family === 'banana' ? BANANA_RATIOS : FULL_RATIOS;
    if (declared.length) return [...new Set(declared)];
    if (family === 'midjourney' || /^mj-/i.test(model?.id || '')) return MJ_RATIOS;
    if (family === 'banana' || /^lingtu/i.test(model?.id || '')) return BANANA_RATIOS;
    if (family === 'gim2' || /^image2/i.test(model?.id || '')) return FULL_RATIOS;
    return BASIC_RATIOS;
  }

  function setHiddenOptions(select, values, preferred) {
    if (!select) return '';
    const list = [...new Set((values || []).filter(Boolean).map(String))];
    select.replaceChildren(...list.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      return option;
    }));
    const next = list.includes(String(preferred || '')) ? String(preferred) : (list[0] || '');
    select.value = next;
    return next;
  }

  function closePickers(except) {
    pickers.forEach((picker, key) => {
      if (key === except) return;
      picker.menu.hidden = true;
      picker.trigger.setAttribute('aria-expanded', 'false');
      picker.wrap.classList.remove('is-open');
    });
  }

  function makePicker(key, ids, renderItems, onSelect) {
    const wrap = byId(ids.wrap);
    const trigger = byId(ids.trigger);
    const menu = byId(ids.menu);
    const select = byId(ids.select);
    if (!wrap || !trigger || !menu || !select) return null;
    const picker = { wrap, trigger, menu, select, renderItems, onSelect };
    pickers.set(key, picker);
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closePickers(opening ? key : null);
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      wrap.classList.toggle('is-open', opening);
      if (opening) renderItems();
    });
    trigger.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape'].includes(event.key)) return;
      if (event.key === 'Escape') {
        closePickers();
        return;
      }
      event.preventDefault();
      if (menu.hidden) {
        closePickers(key);
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        renderItems();
      }
      const options = [...menu.querySelectorAll('[data-picker-value]:not([aria-disabled="true"])')];
      if (!options.length) return;
      const selectedIndex = options.findIndex((option) => option.classList.contains('is-selected'));
      const activeIndex = options.findIndex((option) => option.classList.contains('is-keyboard-active'));
      const current = activeIndex >= 0 ? activeIndex : selectedIndex;
      const offset = event.key === 'ArrowUp' ? -1 : 1;
      const nextIndex = current < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0) : (current + offset + options.length) % options.length;
      const next = options[nextIndex];
      if (event.key === 'Enter' || event.key === ' ') {
        const selected = options[activeIndex >= 0 ? activeIndex : Math.max(0, selectedIndex)];
        if (selected) {
          select.value = selected.dataset.pickerValue;
          onSelect(selected.dataset.pickerValue);
          closePickers();
        }
      } else if (next) {
        options.forEach((option) => option.classList.remove('is-keyboard-active'));
        next.classList.add('is-keyboard-active');
        next.scrollIntoView({ block: 'nearest' });
      }
    });
    menu.addEventListener('click', (event) => {
      const option = event.target.closest('[data-picker-value]');
      if (!option || option.disabled || option.getAttribute('aria-disabled') === 'true') return;
      const value = option.dataset.pickerValue;
      select.value = value;
      onSelect(value);
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
    });
    return picker;
  }

  function renderModelPicker() {
    const picker = pickers.get('model');
    if (!picker) return;
    const models = catalog();
    if (!models.length) {
      setHiddenOptions(picker.select, [], '');
      picker.trigger.querySelector('span').textContent = catalogLoading ? '正在同步模型…' : '模型目录暂不可用';
      picker.trigger.disabled = catalogLoading;
      picker.menu.innerHTML = `<div class="warehouse-picker-empty">${catalogLoading ? '正在读取当前 API 模型目录' : '未能读取模型目录，请稍后重试'}</div>`;
      return;
    }
    picker.trigger.disabled = false;
    const current = picker.select.value || models[0]?.id || '';
    const value = setHiddenOptions(picker.select, models.map((model) => model.id), current);
    const selected = entryFor(value) || models[0];
    picker.trigger.querySelector('span').textContent = modelLabel(selected) || '选择模型';
    const groups = new Map();
    models.forEach((model) => {
      const family = modelFamilyLabel(model);
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(model);
    });
    picker.menu.innerHTML = [...groups.entries()].map(([family, list]) => `<div class="warehouse-picker-group"><div class="warehouse-picker-group-title">${esc(family)}</div>${list.map((model) => { const unavailable = model.status === 'maintenance' || model.selectable === false; return `<button type="button" role="option" class="warehouse-picker-option${String(model.id) === String(value) ? ' is-selected' : ''}" data-picker-value="${esc(model.id)}"${unavailable ? ' aria-disabled="true"' : ''}><span>${esc(modelLabel(model))}</span>${unavailable ? '<small>维护中</small>' : ''}</button>`; }).join('')}</div>`).join('');
    updateCostHintFromForm();
  }

  function renderRatioPicker() {
    const picker = pickers.get('ratio');
    const model = entryFor(byId('warehouseComposerModel')?.value);
    if (!picker) return;
    const values = ratiosFor(model);
    const value = setHiddenOptions(picker.select, values, picker.select.value || '1:1');
    picker.trigger.querySelector('span').textContent = value || '1:1';
    picker.menu.innerHTML = values.map((ratio) => `<button type="button" role="option" class="warehouse-picker-option${ratio === value ? ' is-selected' : ''}" data-picker-value="${esc(ratio)}"><span class="warehouse-ratio-glyph" style="--ratio:${esc(ratio.replace(':', '/'))}"></span><span>${esc(ratio)}</span></button>`).join('');
    updateCostHintFromForm();
  }

  function renderResolutionPicker() {
    const picker = pickers.get('resolution');
    const model = entryFor(byId('warehouseComposerModel')?.value);
    if (!picker) return;
    const values = Array.isArray(model?.resolutions) && model.resolutions.length ? model.resolutions : ['1k', '2k', '4k'];
    const value = setHiddenOptions(picker.select, values, picker.select.value || values[0]);
    picker.trigger.querySelector('span').textContent = String(value || values[0]).toUpperCase();
    picker.menu.innerHTML = values.map((resolution) => `<button type="button" role="option" class="warehouse-picker-option${resolution === value ? ' is-selected' : ''}" data-picker-value="${esc(resolution)}"><span>${esc(String(resolution).toUpperCase())}</span></button>`).join('');
    updateCostHintFromForm();
  }

  function syncImageGenField(id, value) {
    const el = byId(id);
    if (!el || !value) return;
    if (![...el.options].some((option) => option.value === value)) return;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncComposerFields() {
    renderModelPicker();
    renderRatioPicker();
    renderResolutionPicker();
  }

  function setMode(next) {
    if (!['card', 'image'].includes(next)) return;
    mode = next;
    document.querySelectorAll('[data-composer-mode]').forEach((button) => {
      const active = button.dataset.composerMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const isImage = mode === 'image';
    byId('warehouseComposer')?.classList.toggle('is-image-mode', isImage);
    // 模型/比例/清晰度仅生图模式；分组/标签仅卡片模式
    ['warehouseComposerModelWrap', 'warehouseComposerRatioWrap', 'warehouseComposerResolutionWrap'].forEach((id) => { const el = byId(id); if (el) el.hidden = !isImage; });
    ['warehouseComposerGroupWrap', 'warehouseComposerTagWrap'].forEach((id) => { const el = byId(id); if (el) el.hidden = isImage; });
    if (!isImage) { renderComposerGroupPicker(); renderComposerTagPicker(); }
    const submit = byId('warehouseComposerSubmit');
    if (submit) submit.querySelector('span').textContent = isImage ? '生成图片' : '创建卡片';
    const extra = byId('warehouseComposerExtra');
    if (extra) extra.hidden = isImage;
    updateCostHint();
    const prompt = byId('warehouseComposerPrompt');
    if (prompt) prompt.placeholder = isImage ? '描述你想生成的画面…' : '写下你的提示词，或把图片拖到这里…';
    if (isImage) {
      syncComposerFields();
      void refreshComposerCatalog();
    }
  }

  function prepareCardEditor(prompt) {
    if (typeof window.createNewCard !== 'function') { toast('创建卡片功能暂未就绪，请稍后重试'); return false; }
    window.createNewCard({ forceOpenPanel: true });
    requestAnimationFrame(() => {
      const cardPrompt = byId('cardPrompt');
      if (cardPrompt) { cardPrompt.value = prompt; cardPrompt.dispatchEvent(new Event('input', { bubbles: true })); }
      if (files.length && !copyFilesToInput(byId('fileInput'), files)) setStatus('图片已保留，请在编辑面板中重新选择', 'warning');
      byId('cardPrompt')?.focus();
    });
    return true;
  }

  async function submitImage(prompt) {
    const model = byId('warehouseComposerModel')?.value;
    const ratio = byId('warehouseComposerRatio')?.value || '1:1';
    const resolution = byId('warehouseComposerResolution')?.value || '1k';
    if (!model) { toast('生图模型仍在加载，请稍后再试'); return; }
    syncImageGenField('imageGenModel', model);
    syncImageGenField('imageGenSize', ratio);
    syncImageGenField('imageGenResolution', resolution);
    const promptEl = byId('imageGenPrompt');
    if (promptEl) { promptEl.value = prompt; promptEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (files.length) copyFilesToInput(byId('imageGenRefInput'), files);
    if (typeof window.FeatureDraft?.runImageGenWithPrompt !== 'function') { toast('生图模块仍在加载，请稍后再试'); return; }
    setStatus('正在提交生图任务…', 'ready');
    const result = await window.FeatureDraft.runImageGenWithPrompt(prompt);
    if (result?.ok) { setStatus('已加入生成记录，可在下方“生成记录”查看', 'ready'); files = []; renderFiles(); return; }
    setStatus(result?.message || '生图提交未完成', 'warning');
  }

  async function submitCard(prompt) {
    if (typeof window.createPromptHubCardDirectly !== 'function') { toast('创建卡片功能仍在加载，请稍后重试'); return; }
    setStatus('正在保存卡片…', 'ready');
    try {
      const group = String(byId('warehouseComposerGroup')?.value || '').trim() || null;
      const tags = composerSelectedTags();
      const result = await window.createPromptHubCardDirectly({ prompt, files, group, tags });
      if (!result?.ok) return;
      const promptEl = byId('warehouseComposerPrompt');
      if (promptEl) promptEl.value = '';
      files = [];
      renderFiles();
      setStatus('卡片已保存到卡片库', 'ready');
      toast('卡片已保存到卡片库');
      activateWarehouseView('library', { focus: false });
    } catch (error) {
      setStatus(error?.message || '卡片保存失败', 'warning');
      toast(error?.message || '卡片保存失败');
    }
  }

  function submit() {
    const prompt = String(byId('warehouseComposerPrompt')?.value || '').trim();
    if (!prompt && mode === 'card') { toast('先写点提示词，再创建卡片'); byId('warehouseComposerPrompt')?.focus(); return; }
    if (!prompt && mode === 'image' && !files.length) { toast('请输入提示词或添加参考图'); byId('warehouseComposerPrompt')?.focus(); return; }
    if (mode === 'image') void submitImage(prompt);
    else void submitCard(prompt);
  }

  function setFeatureShellMounted(kind, mounted) {
    const sourceId = kind === 'community' ? 'pageCommunity' : 'pageCreations';
    const viewId = kind === 'community' ? 'warehouseCommunityView' : 'warehouseCreationsView';
    const source = byId(sourceId);
    const view = byId(viewId);
    if (!source || !view) return;
    const shell = mountedShells.get(kind) || source.querySelector(':scope > .feature-shell');
    if (!shell && mounted) return;
    if (mounted) {
      if (!mountedShells.has(kind)) mountedShells.set(kind, shell);
      view.appendChild(shell);
      // Keep the source page marked active for feature lifecycle checks while
      // hiding its empty flex slot; the shell is rendered inside the warehouse.
      source.classList.add('active', 'warehouse-inline-source');
    } else if (shell) {
      source.appendChild(shell);
      mountedShells.delete(kind);
      source.classList.remove('active', 'warehouse-inline-source');
    }
  }

  // The prompt-first home borrows the legacy card grid. During a focused
  // library view the grid is moved back below the original hero so the
  // existing warehouse layout (sidebar, toolbar, hero, cards) is restored as
  // one continuous page. Returning to the home rail moves it back into the
  // inline library slot.
  function syncLibraryPresentation(focused) {
    const cards = byId('cardsContainer');
    const library = byId('warehouseLibraryView');
    const main = byId('mainContentArea');
    if (!cards || !library || !main) return;
    if (focused) {
      if (cards.parentElement !== main) main.appendChild(cards);
      const headerGrow = document.querySelector('.app-page-warehouse .main-header .toolbar-cluster-grow');
      if (headerGrow) {
        const search = document.querySelector('.warehouse-search');
        const filter = document.querySelector('.filter-menu-wrap');
        const sort = byId('sortMenuWrap');
        const preview = byId('globalViewBtn');
        [search, filter, sort, preview].filter(Boolean).forEach((node) => headerGrow.appendChild(node));
      }
    } else if (cards.parentElement !== library) {
      library.appendChild(cards);
      const previewSlot = byId('warehouseLibraryPreviewSlot');
      const preview = byId('globalViewBtn');
      if (previewSlot && preview && preview.parentElement !== previewSlot) previewSlot.appendChild(preview);
      mountLibraryToolbar();
    }
  }

  function setFocusState(view, focused) {
    focusActive = focused;
    // 先打过渡类：让网格媒体框高度、卡片位移在聚焦/退出时平滑补间，
    // 再切换 display 类的硬结构（侧栏/头部本身有 420ms 折叠动画）。
    document.body.classList.add('warehouse-focus-transition');
    window.setTimeout(() => document.body.classList.remove('warehouse-focus-transition'), 560);
    // 网格内容淡入淡出：先快淡出，切换结构后再淡入，弱化生硬感。
    const grid = document.getElementById('cardsContainer');
    if (grid) {
      grid.classList.remove('warehouse-grid-crossfade');
      void grid.offsetWidth;
      grid.classList.add('warehouse-grid-crossfade');
      window.setTimeout(() => grid.classList.remove('warehouse-grid-crossfade'), 460);
    }
    document.body.classList.toggle('warehouse-content-focus', focused);
    ['library', 'community', 'creations'].forEach((name) => document.body.classList.toggle(`warehouse-content-focus--${name}`, focused && name === view));
    document.body.classList.toggle('warehouse-inline-community-active', view === 'community');
    syncLibraryPresentation(view === 'library' && focused);
    document.querySelectorAll('[data-warehouse-return]').forEach((button) => { button.hidden = !focused; });
    // 聚焦切换会更换卡片库滚动容器（网格 <-> main-content），分页监听与哨兵要跟着走。
    if (view === 'library') {
      window.requestAnimationFrame(() => {
        try {
          window.bindWarehousePagedScroll?.();
          const grid = document.getElementById('cardsContainer');
          if (grid) window.syncWarehouseScrollSentinel?.(grid);
        } catch (e) { /* 分页模块未就绪时忽略 */ }
      });
    }
  }

  function activateWarehouseView(view, opts = {}) {
    const next = ['library', 'community', 'creations'].includes(view) ? view : 'library';
    activeView = next;
    if (next !== 'community') setFeatureShellMounted('community', false);
    if (next !== 'creations') setFeatureShellMounted('creations', false);
    if (next === 'community') setFeatureShellMounted('community', true);
    if (next === 'creations') setFeatureShellMounted('creations', true);
    document.querySelectorAll('.warehouse-inline-view').forEach((section) => { section.hidden = section.dataset.warehouseView !== next; });
    document.querySelectorAll('[data-discover-target]').forEach((button) => {
      const selected = button.dataset.discoverTarget === next || (next === 'library' && button.dataset.discoverTarget === 'warehouse');
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    const focused = opts.focus === true || (opts.focus !== false && focusActive);
    setFocusState(next, focused);
    if (next === 'community') window.FeatureDraft?.activateCommunityPage?.();
    if (next === 'creations') window.FeatureDraft?.onAppChange?.('creations');
    if (focused) {
      const main = byId('mainContentArea');
      const stage = document.querySelector('.warehouse-content-stage');
      const hero = document.querySelector('.warehouse-hero');
      const grid = byId('cardsContainer');
      if (main) {
        // 等 composer 折叠动画落定，再把共享内容轨对齐到视口。
        // 聚焦卡片库时 stage/hero 都隐藏，锚定到卡片网格；community/creations 锚定到 stage。
        // 用相对 main 的坐标换算，避免隐藏元素把 scrollTop 误拉到 0 与滚轮打架。
        window.setTimeout(() => {
          const visible = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
          const anchor = [hero, stage, grid].find(visible) || grid;
          if (!anchor) return;
          const top = Math.max(0, main.scrollTop + anchor.getBoundingClientRect().top - main.getBoundingClientRect().top);
          main.scrollTo({ top, behavior: 'smooth' });
        }, 430);
      }
    }
  }

  function warehouseGroupOptions() {
    const options = [
      { value: 'all', label: '全部卡片', count: byId('allCount')?.textContent?.trim() || '0' },
      { value: 'uncategorized', label: '未分类', count: byId('uncategorizedCount')?.textContent?.trim() || '0' }
    ];
    document.querySelectorAll('#customGroupList .group-item[data-group]').forEach((item) => {
      const value = String(item.dataset.group || '').trim();
      if (!value || options.some((option) => option.value === value)) return;
      options.push({ value, label: value, count: item.querySelector('.count')?.textContent?.trim() || '0' });
    });
    return options;
  }

  function renderGroupPicker() {
    const picker = pickers.get('group');
    if (!picker) return;
    const options = warehouseGroupOptions();
    const current = options.some((option) => option.value === window.currentGroup) ? window.currentGroup : 'all';
    setHiddenOptions(picker.select, options.map((option) => option.value), current);
    const selected = options.find((option) => option.value === current) || options[0];
    picker.trigger.querySelector('span').textContent = selected?.label || '全部卡片';
    picker.menu.innerHTML = `<div class="warehouse-picker-group"><div class="warehouse-picker-group-title">文件分类</div>${options.map((option) => `<button type="button" role="option" class="warehouse-picker-option${option.value === current ? ' is-selected' : ''}" data-picker-value="${esc(option.value)}"><span>${esc(option.label)}</span><small>${esc(option.count)}</small></button>`).join('')}</div>`;
  }

  /* 创建卡片：分组选择（不含"全部/未分类"这类筛选伪分组，"不分组"为空值） */
  function composerGroupOptions() {
    return warehouseGroupOptions().filter((option) => option.value !== 'all' && option.value !== 'uncategorized');
  }

  function renderComposerGroupPicker() {
    const picker = pickers.get('composerGroup');
    if (!picker) return;
    const options = composerGroupOptions();
    const values = ['', ...options.map((option) => option.value)];
    const current = picker.select.value;
    const value = setHiddenOptions(picker.select, values, values.includes(current) ? current : '');
    const selected = value ? options.find((option) => option.value === value) : null;
    picker.trigger.querySelector('span').textContent = selected?.label || '不分组';
    const opts = [`<button type="button" role="option" class="warehouse-picker-option${!value ? ' is-selected' : ''}" data-picker-value=""><span>不分组</span></button>`]
      .concat(options.map((option) => `<button type="button" role="option" class="warehouse-picker-option${option.value === value ? ' is-selected' : ''}" data-picker-value="${esc(option.value)}"><span>${esc(option.label)}</span><small>${esc(option.count)}</small></button>`));
    picker.menu.innerHTML = `<div class="warehouse-picker-group"><div class="warehouse-picker-group-title">归入分组</div>${opts.join('')}</div>`;
  }

  /* 创建卡片：标签选择（取自现有卡片标签，可多选；存到隐藏的 state select 以逗号连接） */
  function composerSelectedTags() {
    return String(byId('warehouseComposerTag')?.value || '').split('||').map((t) => t.trim()).filter(Boolean);
  }

  function renderComposerTagPicker() {
    const picker = pickers.get('composerTag');
    if (!picker) return;
    const cards = Array.isArray(window.__promptHubCards) ? window.__promptHubCards : [];
    const tags = (window.getSelectableCardTags?.(cards) || []).map((t) => String(t).replace(/^#+/, '').trim()).filter(Boolean);
    const selected = composerSelectedTags();
    picker.trigger.querySelector('span').textContent = selected.length ? selected.map((t) => '#' + t).join(' ') : '无标签';
    picker.menu.innerHTML = tags.length
      ? `<div class="warehouse-picker-group"><div class="warehouse-picker-group-title">添加标签（可多选）</div>${tags.map((tag) => `<button type="button" role="option" class="warehouse-picker-option${selected.includes(tag) ? ' is-selected' : ''}" data-picker-value="${esc(tag)}"><span>#${esc(tag)}</span></button>`).join('')}</div>`
      : '<div class="warehouse-picker-empty">还没有可用标签，保存卡片后可在编辑面板添加</div>';
  }

  function toggleComposerTag(tag) {
    const select = byId('warehouseComposerTag');
    if (!select || !tag) return;
    const cur = composerSelectedTags();
    const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
    select.value = next.join('||');
    renderComposerTagPicker();
  }

  function mountLibraryToolbar() {
    const searchSlot = byId('warehouseLibrarySearchSlot');
    const filterSlot = byId('warehouseLibraryFilterSlot');
    const sortSlot = byId('warehouseLibrarySortSlot');
    const search = document.querySelector('.main-header .warehouse-search') || document.querySelector('.warehouse-search');
    const filter = document.querySelector('.main-header .filter-menu-wrap') || document.querySelector('.filter-menu-wrap');
    const sort = byId('sortMenuWrap');
    if (searchSlot && search) {
      search.classList.remove('desktop-only');
      searchSlot.appendChild(search);
    }
    if (filterSlot && filter) {
      filter.id = filter.id || 'warehouseLibraryFilterWrap';
      filterSlot.appendChild(filter);
    }
    if (sortSlot && sort) {
      sort.classList.remove('desktop-only');
      sortSlot.appendChild(sort);
    }
    const group = makePicker('group', { wrap: 'warehouseLibraryGroupWrap', trigger: 'warehouseLibraryGroupTrigger', menu: 'warehouseLibraryGroupMenu', select: 'warehouseLibraryGroup' }, renderGroupPicker, (value) => {
      if (typeof window.switchGroup === 'function') window.switchGroup(value);
      renderGroupPicker();
    });
    if (group) renderGroupPicker();
    const groupSources = [byId('defaultGroupList'), byId('customGroupList'), byId('allCount'), byId('uncategorizedCount')].filter(Boolean);
    if (groupSources.length && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(renderGroupPicker);
      groupSources.forEach((source) => observer.observe(source, { childList: true, characterData: true, subtree: true }));
    }
  }

  function bindDiscoverTabs() {
    document.querySelectorAll('[data-discover-target]').forEach((button) => button.addEventListener('click', () => {
      const target = button.dataset.discoverTarget === 'warehouse' ? 'library' : button.dataset.discoverTarget;
      activateWarehouseView(target, { focus: true });
    }));
    const countSource = byId('allCount');
    const countTarget = byId('warehouseDiscoverCount');
    const updateCount = () => { if (countTarget) countTarget.textContent = countSource?.textContent?.trim() || '0'; };
    updateCount();
    if (countSource && typeof MutationObserver !== 'undefined') new MutationObserver(updateCount).observe(countSource, { childList: true, characterData: true, subtree: true });
  }

  function bindContentFocus() {
    const main = byId('mainContentArea');
    if (!main) return;
    // 不再滚动自动切入/切出聚焦卡片库（用户反馈切换生硬、两界面割裂）。
    // 改为一个显眼的手动"展开/收起卡片库"按钮：默认收起，点击展开；再点或"返回"收起。
    // 两个界面在同一页面内一体平滑过渡（composer 折叠 + 网格 crossfade）。
    document.querySelectorAll('[data-warehouse-return]').forEach((button) => button.addEventListener('click', () => { setFocusState(activeView, false); main.scrollTo({ top: 0, behavior: 'smooth' }); }));
  }

  /* 显眼的"展开/收起卡片库"切换按钮：固定悬浮在主内容区顶部右侧（styles-warehouse.css），
   * 不放进会被聚焦态隐藏的 discover-nav，保证展开后仍可点击收起。 */
  function bindFocusToggleButton() {
    if (byId('warehouseFocusToggleBtn')) return;
    const main = byId('mainContentArea');
    if (!main) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'warehouseFocusToggleBtn';
    btn.className = 'warehouse-focus-toggle';
    const syncLabel = () => {
      const focused = document.body.classList.contains('warehouse-content-focus');
      btn.setAttribute('aria-pressed', focused ? 'true' : 'false');
      btn.innerHTML = focused
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg><span>收起卡片库</span>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg><span>展开卡片库</span>';
    };
    btn.addEventListener('click', () => {
      const mainEl = byId('mainContentArea');
      const focused = document.body.classList.contains('warehouse-content-focus');
      if (focused) {
        setFocusState(activeView, false);
        mainEl?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setFocusState(activeView, true);
      }
      window.setTimeout(syncLabel, 60);
    });
    (byId('mainContentArea') || document.body).appendChild(btn);
    // 聚焦态变化时同步按钮文案（比如滚轮/返回触发）
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(syncLabel).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    syncLabel();
  }

  function initCanvasPage() {
    const page = byId('pageCanvas');
    const frame = byId('canvasPageFrame');
    const open = byId('canvasOpenExternalBtn');
    if (!page || !frame || page.dataset.bound === '1') return;
    page.dataset.bound = '1';
    const load = () => {
      if (!page.classList.contains('active')) return;
      if (!frame.src) frame.src = typeof window.getPromptCanvasUrl === 'function' ? window.getPromptCanvasUrl() : 'https://canvas.prompt-hubs.com/canvas';
    };
    open?.addEventListener('click', () => { if (typeof window.openPromptCanvas === 'function') window.openPromptCanvas(); else window.open('https://canvas.prompt-hubs.com/canvas', '_blank', 'noopener,noreferrer'); });
    new MutationObserver(load).observe(page, { attributes: true, attributeFilter: ['class'] });
    load();
  }

  function bind() {
    const box = byId('warehouseComposerBox');
    if (!box || box.dataset.bound === '1') return;
    box.dataset.bound = '1';
    byId('warehouseComposerAttach')?.addEventListener('click', () => byId('warehouseComposerFile')?.click());
    byId('warehouseComposerFile')?.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
    byId('warehouseComposerPrompt')?.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); } });
    ['dragenter', 'dragover'].forEach((type) => box.addEventListener(type, (event) => { event.preventDefault(); box.classList.add('is-dragging'); }));
    ['dragleave', 'drop'].forEach((type) => box.addEventListener(type, (event) => { event.preventDefault(); box.classList.remove('is-dragging'); }));
    box.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files));
    box.addEventListener('paste', (event) => { const pasted = [...(event.clipboardData?.items || [])].map((item) => item.kind === 'file' ? item.getAsFile() : null).filter(Boolean); if (pasted.length) { event.preventDefault(); addFiles(pasted); } });
    document.querySelectorAll('[data-composer-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.composerMode)));
    makePicker('model', { wrap: 'warehouseComposerModelWrap', trigger: 'warehouseComposerModelTrigger', menu: 'warehouseComposerModelMenu', select: 'warehouseComposerModel' }, renderModelPicker, (value) => { syncImageGenField('imageGenModel', value); renderModelPicker(); renderRatioPicker(); renderResolutionPicker(); updateCostHintFromForm(); });
    makePicker('ratio', { wrap: 'warehouseComposerRatioWrap', trigger: 'warehouseComposerRatioTrigger', menu: 'warehouseComposerRatioMenu', select: 'warehouseComposerRatio' }, renderRatioPicker, (value) => { syncImageGenField('imageGenSize', value); renderRatioPicker(); updateCostHintFromForm(); });
    makePicker('resolution', { wrap: 'warehouseComposerResolutionWrap', trigger: 'warehouseComposerResolutionTrigger', menu: 'warehouseComposerResolutionMenu', select: 'warehouseComposerResolution' }, renderResolutionPicker, (value) => { syncImageGenField('imageGenResolution', value); renderResolutionPicker(); updateCostHintFromForm(); });
    makePicker('composerGroup', { wrap: 'warehouseComposerGroupWrap', trigger: 'warehouseComposerGroupTrigger', menu: 'warehouseComposerGroupMenu', select: 'warehouseComposerGroup' }, renderComposerGroupPicker, () => {});
    makePicker('composerTag', { wrap: 'warehouseComposerTagWrap', trigger: 'warehouseComposerTagTrigger', menu: 'warehouseComposerTagMenu', select: 'warehouseComposerTag' }, renderComposerTagPicker, () => {});
    byId('warehouseComposerSubmit')?.addEventListener('click', submit);
    byId('warehouseComposerExtra')?.addEventListener('click', () => prepareCardEditor(String(byId('warehouseComposerPrompt')?.value || '').trim()));
    document.addEventListener('click', () => closePickers());
    mountLibraryToolbar();
    bindDiscoverTabs();
    bindContentFocus();
    bindFocusToggleButton();
    initCanvasPage();
    renderModelPicker();
    renderRatioPicker();
    renderResolutionPicker();
    renderComposerGroupPicker();
    renderComposerTagPicker();
    // 标签多选：拦截菜单点击切换选中而不关闭菜单
    byId('warehouseComposerTagMenu')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-picker-value]');
      if (!option) return;
      event.stopPropagation();
      toggleComposerTag(option.dataset.pickerValue);
    }, true);
    // 分组/标签候选随卡片库变化刷新
    if (typeof MutationObserver !== 'undefined') {
      const refresh = () => { renderComposerGroupPicker(); renderComposerTagPicker(); };
      const customGroupList = byId('customGroupList');
      if (customGroupList) new MutationObserver(refresh).observe(customGroupList, { childList: true, subtree: true });
      const grid = byId('cardsContainer');
      if (grid) new MutationObserver(refresh).observe(grid, { childList: true });
    }
    const source = byId('imageGenModel');
    if (source && typeof MutationObserver !== 'undefined') new MutationObserver(() => { renderModelPicker(); renderRatioPicker(); renderResolutionPicker(); }).observe(source, { childList: true });
    window.addEventListener('ph-imagegen-catalog-updated', () => {
      catalogLoading = false;
      renderModelPicker();
      renderRatioPicker();
      renderResolutionPicker();
      updateCostHintFromForm();
    });
    setMode('card');
    const cards = byId('cardsContainer');
    const library = byId('warehouseLibraryView');
    if (cards && library && cards.parentElement !== library) library.appendChild(cards);
    void refreshComposerCatalog();
  }

  window.activateWarehouseView = activateWarehouseView;
  // 路由直接切到社区/我的主页时，把之前内联进卡片库的 feature-shell 移回原页面，
  // 否则原页面会空白（shell 还留在隐藏的 pageWarehouse 里）。
  window.restoreWarehouseInlineShells = () => {
    setFeatureShellMounted('community', false);
    setFeatureShellMounted('creations', false);
  };
  window.WarehouseComposer = { updateCostHint };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
