    const hint = document.getElementById('studioChatCostHint');
    if (!hint) return;
    const { model, thinking } = getStudioChatOptions();
    const table = CHAT_COST_HINTS[model] || CHAT_COST_HINTS['deepseek-v4-flash'];
    const outKey = thinking ? table.outputThink : table.output;
    const modelLabel = model === 'deepseek-v4-pro' ? 'Pro' : 'Flash';
    hint.textContent = `${modelLabel}${thinking ? ' · 思考模式' : ''} · 1000 积分约输入 ${table.input} / 输出 ${outKey} token · 按实际用量计费`;
    void refreshStudioChatCostFromApi();
  }

  async function refreshStudioChatCostFromApi() {
    const hint = document.getElementById('studioChatCostHint');
    if (!hint || !window.PromptHubApi?.studioChatQuote) return;
    const { model, thinking } = getStudioChatOptions();
    try {
      const quote = await window.PromptHubApi.studioChatQuote({ model, thinking });
      if (!quote?.ok || !quote.data) return;
      const d = quote.data;
      const disc = d.discountLabel ? ` · 会员${d.discountLabel}` : '';
      hint.textContent = `${d.modelLabel || model}${thinking ? ' · 思考' : ''} · 预估单次约 ${d.final} 积分${disc} · 按实际 token 计费`;
    } catch (e) { /* 保留本地提示 */ }
  }

  async function onStudioChatSend() {
    if (studioChatBusy) return;
    const input = document.getElementById('studioChatInput');
    const text = input?.value?.trim();
    if (!text) return;
    if (!guardEdit('请先登录后使用 AI 对话')) return;
    if (!window.PromptHubApi?.studioChat) {
      setStatus('对话 API 未加载，请刷新页面');
      return;
    }
    appendChatMessage('studio-chat-msg user', `<p>${esc(text)}</p>`);
    input.value = '';
    const msgs = getChatMessages();
    msgs.push({ role: 'user', content: text });
    persistChatMessages();
    const loadingEl = appendChatMessage('studio-chat-msg assistant loading', '<p>思考中…</p>');
    studioChatBusy = true;
    document.getElementById('studioChatSend')?.setAttribute('disabled', 'true');
    try {
      const p = getProject();
      const thread = getActiveChatThread();
      const attachContext = p.chatAttachDoc !== false;
      const noPreset = thread.usePreset === false;
      const ctx = attachContext ? buildStudioDocContext() : '';
      const { model, thinking } = getStudioChatOptions();
      const res = await window.PromptHubApi.studioChat({
        messages: msgs.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        context: ctx || undefined,
        attachContext,
        noPreset,
        model,
        thinking
      });
      loadingEl?.remove();
      if (!res?.ok) {
        msgs.pop();
        persistChatMessages();
        appendChatMessage(
          'studio-chat-msg assistant',
          `<p class="panel-hint">${esc(res?.message || '对话失败，请检查登录与会员状态')}</p>`
        );
        setStatus(res?.message || '对话失败');
        return;
      }
      const reply = String(res.data?.reply || '').trim();
      if (!reply) {
        msgs.pop();
        persistChatMessages();
        appendChatMessage('studio-chat-msg assistant', '<p class="panel-hint">未收到回复，请重试</p>');
        return;
      }
      msgs.push({ role: 'assistant', content: reply });
      persistChatMessages();
      if (typeof res.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(res.data.creditsRemaining);
      }
      updateStudioCreditsBadge();
      const charged = res.data?.creditsCharged;
      const block = appendChatMessage(
        'studio-chat-msg assistant',
        `<pre class="studio-chat-context">${esc(reply)}</pre>
        <div class="studio-chat-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-copy-context>复制</button>
          <button type="button" class="btn btn-secondary btn-sm" data-fill-image>填入生图</button>
        </div>${charged ? `<p class="panel-hint studio-chat-charged">消耗 ${charged} 积分</p>` : ''}`
      );
      bindChatActionButtons(block);
    } catch (e) {
      loadingEl?.remove();
      const msgsErr = getChatMessages();
      if (msgsErr.length && msgsErr[msgsErr.length - 1].role === 'user') msgsErr.pop();
      persistChatMessages();
      appendChatMessage(
        'studio-chat-msg assistant',
        `<p class="panel-hint">${esc(e?.message || '网络错误')}</p>`
      );
      setStatus(e?.message || '对话失败');
    } finally {
      studioChatBusy = false;
      document.getElementById('studioChatSend')?.removeAttribute('disabled');
    }
  }

  function fillStudioImageFromDoc() {
    const doc = getActiveDoc();
    const ta = document.getElementById('studioImagePrompt');
    if (!ta || !doc) return;
    const heroes = (doc.heroCardIds || []).map((id) => getCard(id)).filter(Boolean);
    const heroPrompt = heroes.map((c) => c.prompt).filter(Boolean).join('，');
    const body = (doc.bodyHtml || doc.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    ta.value = (heroPrompt || body || doc.title || '').slice(0, 4000);
    setStatus('已从文档填入提示词');
  }

  async function pollStudioImageJob(jobId) {
    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await window.PromptHubApi?.getGenerationJob?.(jobId);
      if (!res?.ok) continue;
      const data = res.data || {};
      if (data.status === 'completed' && (data.imageUrl || data.image)) {
        return data.imageUrl || data.image;
      }
      if (data.status === 'failed') throw new Error(data.error || data.message || '生图失败');
    }
    throw new Error('生图耗时较长，请稍后在主站「图片生成」查看');
  }

  async function runStudioImageGen() {
    if (!guardEdit('请先登录后生图')) return;
    const promptEl = document.getElementById('studioImagePrompt');
    const btn = document.getElementById('studioImageSubmit');
    const hint = document.getElementById('studioImageHint');
    const prompt = promptEl?.value?.trim();
    if (!prompt || prompt.length < 4) {
      setStatus('请输入至少 4 个字的提示词');
      return;
    }
    const model = document.getElementById('studioImageModel')?.value || 'image2';
    const resolution = document.getElementById('studioImageResolution')?.value || '1k';
    const size = document.getElementById('studioImageSize')?.value || '1:1';
    const quality = 'standard';
    updateStudioImageGenCostHint();
    let cost = studioImageGenCost;
    let balance = window.PointsSystem?.getCredits?.() ?? 0;
    const useApi = window.PointsSystem?.useApiForAccount?.();
    if (useApi) {
      await window.PointsSystem?.refreshCreditsFromServer?.();
      balance = window.PointsSystem?.getCredits?.() ?? 0;
      const quote = await window.PromptHubApi?.getGenerationCost?.(resolution, quality, model);
      if (quote?.ok && quote.data?.final != null) {
        cost = quote.data.final;
        studioImageGenCost = cost;
      }
    }
    if (balance < cost) {
      setStatus(`积分不足（需要 ${cost}，当前 ${balance}）`);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中…';
    }
    if (hint) hint.textContent = `提交中… 预计消耗 ${cost} 积分`;
    setStudioImageGenPending(true);
    const addBtn = document.getElementById('studioImageAddCard');
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = '保存到主站卡片库';
    }
    try {
      const refUrls = await resolveStudioRefUrlsForApi();
      if (!useApi && !window.PointsSystem?.deductCredits?.(cost)) {
        throw new Error('积分扣除失败');
      }
      const gen = await window.PromptHubApi?.generateImage?.({
        prompt,
        model,
        resolution,
        quality,
        size,
        refImageUrls: refUrls.length ? refUrls : undefined
      });
      if (!gen?.ok) throw new Error(gen?.message || '生图提交失败');
      if (typeof gen.data?.creditsRemaining === 'number') {
        window.PointsSystem?.setCreditsFromServer?.(gen.data.creditsRemaining);
      }
      updateStudioCreditsBadge();
      const jobId = gen.data?.jobId;
      if (!jobId) throw new Error('未返回任务 ID');
      if (hint) hint.textContent = '生成中，请稍候…';
      const imageUrl = await pollStudioImageJob(jobId);
      studioLastGenImage = imageUrl;
      studioLastGenPrompt = prompt;
      studioLastGenJobId = jobId;
      setStudioImageGenPending(false);
      const wrap = document.getElementById('studioImageResult');
      const img = document.getElementById('studioImagePreview');
      if (img && imageUrl) {
        img.src = imageUrl;
        wrap?.classList.remove('hidden');
        document.getElementById('studioImageIdle')?.classList.add('hidden');
        scrollStudioImageResultIntoView();
      }
      const saved = await saveStudioGenToLibraries({ prompt, image: imageUrl, jobId });
      if (addBtn) {
        addBtn.textContent = saved.ok ? '已保存到主站卡片库' : '保存失败';
        addBtn.disabled = !!saved.ok;
      }
      if (hint) {
        hint.textContent = saved.ok
          ? `已生成并保存到主站卡片库 · 消耗约 ${gen.data?.creditsCharged ?? cost} 积分`
          : `生成完成 · 消耗约 ${gen.data?.creditsCharged ?? cost} 积分`;
      }
      setStatus(saved.ok ? '已保存到主站卡片库，返回主站刷新即可看到' : '生图完成，但写入主站卡片库失败');
    } catch (e) {
      setStudioImageGenPending(false);
      document.getElementById('studioImageIdle')?.classList.remove('hidden');
      await window.PointsSystem?.refreshCreditsFromServer?.();
      updateStudioCreditsBadge();
      if (hint) hint.textContent = '积分与主站共用 · 生成后自动保存到主站卡片库';
      setStatus(e?.message || '生图失败');
    } finally {
      if (btn) {
        btn.disabled = false;
        restoreStudioImageSubmitLabel();
      }
    }
  }

  async function downloadImageFile(url, filename) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setStatus('图片已开始下载');
    } catch (e) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = filename || `prompt-hub-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('若未自动下载，请在新标签页右键保存');
    }
  }

  function downloadStudioGenImage() {
    const url = studioLastGenImage || document.getElementById('studioImagePreview')?.src || '';
    if (!url) {
      setStatus('请先生成图片');
      return;
    }
    void downloadImageFile(url, `asset-studio-${Date.now()}.png`);
  }

  function addStudioGenToLibrary() {
    if (!guardEdit()) return;
    if (!studioLastGenImage) {
      setStatus('请先生成图片');
      return;
    }
    void (async () => {
      const saved = await saveStudioGenToLibraries({
        prompt: studioLastGenPrompt,
        image: studioLastGenImage,
        jobId: studioLastGenJobId || null
      });
      const addBtn = document.getElementById('studioImageAddCard');
      if (addBtn && saved.ok) {
        addBtn.textContent = '已保存到主站卡片库';
        addBtn.disabled = true;
      }
      setStatus(saved.ok ? '已保存到主站卡片库' : '保存失败，请重试');
    })();
  }

  function mergeImportFromMain(silent) {
    try {
      const raw = localStorage.getItem(LS_IMPORT);
      if (!raw) return 0;
      let payload = JSON.parse(raw);
      let list = [];
      let groups = [];
      if (Array.isArray(payload)) {
        list = payload;
      } else if (payload && typeof payload === 'object') {
        list = Array.isArray(payload.cards) ? payload.cards : [];
        groups = Array.isArray(payload.groups) ? payload.groups : [];
      }
      if (!list.length) {
        localStorage.removeItem(LS_IMPORT);
        return 0;
      }
      if (groups.length) getProject().cardGroups = groups.slice();
      let added = 0;
      const cards = getProjectCards();
      list.forEach((c) => {
        if (!c?.id || cards.some((x) => x.id === c.id)) return;
        cards.push(normalizeImportedCard(c));
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

  function clearStudioLibrary() {
    const p = getProject();
    p.cards = [];
    p.cardGroups = [];
    const doc = getActiveDoc();
    if (doc) {
      doc.heroCardIds = [];
      doc.floatPositions = {};
      doc.closedFloatIds = [];
    }
    document.getElementById('studioFloatLayer')?.replaceChildren();
    saveState();
    renderAll();
    setStatus('已清空本项目卡片库，可重新导入');
  }

  async function deleteCurrentProject() {
    if (!guardEdit()) return;
    if (state.projects.length <= 1) {
      setStatus('至少保留一个项目');
      return;
    }
    const p = getProject();
    const ok = await studioConfirm(
      '删除项目',
      `确定删除「${p.name}」及其全部文档与卡片库？此操作不可撤销。`
    );
    if (!ok) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    state.projectId = state.projects[0].id;
    closeCardDetailPanel();
    saveState();
    renderAll();
    setStatus('项目已删除');
  }

  function openFieldSettings() {
    const p = getProject();
    ensureProjectAssets(p);
    const overlay = document.getElementById('studioSettingsOverlay');
    const heroInput = document.getElementById('studioHeroLabelInput');
    const attachChk = document.getElementById('studioChatAttachDoc');
    if (attachChk) attachChk.checked = p.chatAttachDoc !== false;
    if (heroInput) heroInput.value = p.heroFieldLabel || DEFAULT_HERO_LABEL;
    renderCoreFieldLabelInputs();
    renderStudioFieldList();
    overlay?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeFieldSettings() {
    document.getElementById('studioSettingsOverlay')?.classList.add('hidden');
    if (!document.getElementById('studioCardDetail')?.classList.contains('hidden')) return;
    document.body.style.overflow = '';
  }

  function renderCoreFieldLabelInputs() {
    const root = document.getElementById('studioCoreFieldLabels');
    const labels = getProjectFieldLabels();
    if (!root) return;
    const keyNames = {
      title: '标题',
      prompt: '提示词',
      background: '背景',
      character: '人物',
      relations: '关系'
    };
    const order = getCoreFieldOrder();
    root.innerHTML = order
      .map(
        (key, idx) => `<div class="studio-field-order-row" data-core-key="${esc(key)}">
        <div class="studio-field-order-btns">
          <button type="button" data-move-core="up" data-key="${esc(key)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button type="button" data-move-core="down" data-key="${esc(key)}" ${idx === order.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </div>
        <span>${keyNames[key] || key}</span>
        <input type="text" class="settings-input" data-core-label="${key}" value="${esc(labels[key] || DEFAULT_FIELD_LABELS[key])}" maxlength="24">
      </div>`
      )
      .join('');
    bindCoreFieldOrderButtons(root);
  }

  function moveCoreField(key, dir) {
    const p = getProject();
    const order = getCoreFieldOrder();
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= order.length) return;
    [order[idx], order[next]] = [order[next], order[idx]];
    p.coreFieldOrder = order;
    renderCoreFieldLabelInputs();
  }

  function moveGlobalField(id, dir) {
    const p = getProject();
    const fields = p.globalFields;
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= fields.length) return;
    [fields[idx], fields[next]] = [fields[next], fields[idx]];
    renderStudioFieldList();
  }

  function bindCoreFieldOrderButtons(root) {
    root.querySelectorAll('[data-move-core]').forEach((btn) => {
      btn.addEventListener('click', () => {
        moveCoreField(btn.dataset.key, btn.dataset.moveCore);
      });
    });
  }

  function renderStudioFieldList() {
    const list = document.getElementById('studioFieldList');
    const empty = document.getElementById('studioFieldListEmpty');
    const fields = getProjectGlobalFields();
    const typeLabel = { text: '文本', textarea: '多行' };
    if (!list) return;
    if (!fields.length) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    list.innerHTML = fields
      .map(
        (f, idx) => `<div class="studio-field-list-item" data-field-id="${esc(f.id)}">
          <div class="studio-field-order-btns">
            <button type="button" data-move-field="up" data-id="${esc(f.id)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
            <button type="button" data-move-field="down" data-id="${esc(f.id)}" ${idx === fields.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          </div>
          <span class="studio-field-list-item-name">${esc(f.name)}</span>
          <span class="studio-field-list-item-type">${typeLabel[f.type] || f.type}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-del-field="${esc(f.id)}">删除</button>
        </div>`
      )
      .join('');
    list.querySelectorAll('[data-del-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = getProject();
        p.globalFields = p.globalFields.filter((f) => f.id !== btn.dataset.delField);
        renderStudioFieldList();
      });
    });
    list.querySelectorAll('[data-move-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        moveGlobalField(btn.dataset.id, btn.dataset.moveField);
      });
    });
  }

  function saveFieldSettings() {
    if (!guardEdit()) return;
    const p = getProject();
    const heroInput = document.getElementById('studioHeroLabelInput');
    if (heroInput?.value?.trim()) p.heroFieldLabel = heroInput.value.trim().slice(0, 80);
    document.querySelectorAll('[data-core-label]').forEach((inp) => {
      const key = inp.dataset.coreLabel;
      if (key && inp.value.trim()) p.fieldLabels[key] = inp.value.trim().slice(0, 24);
    });
    const order = [];
    document.querySelectorAll('#studioCoreFieldLabels [data-core-key]').forEach((row) => {
      if (row.dataset.coreKey) order.push(row.dataset.coreKey);
    });
    if (order.length) p.coreFieldOrder = order;
    saveState();
    renderEditor();
    const reopenId = detailCardId;
    closeFieldSettings();
    if (reopenId) openCardDetailPanel(reopenId);
    setStatus('字段设置已保存');
  }

  function addStudioGlobalField() {
    if (!guardEdit()) return;
    const nameEl = document.getElementById('studioNewFieldName');
    const typeEl = document.getElementById('studioNewFieldType');
    const n = nameEl?.value?.trim();
    if (!n) {
      setStatus('请输入字段名称');
      return;
    }
    const p = getProject();
    if (p.globalFields.some((f) => f.name === n)) {
      setStatus('字段名称已存在');
      return;
    }
    p.globalFields.push({ id: generateId(), name: n.slice(0, 24), type: typeEl?.value || 'text' });
    if (nameEl) nameEl.value = '';
    renderStudioFieldList();
  }

  function purgeLegacyStudioStorage() {
    ['promptrepo_studio_demo_v1', 'promptrepo_studio_v2'].forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) { /* ignore */ }
    });
  }

  function exportCardsFromMainSite() {
    try {
      const raw = window.__promptHubCards || window.opener?.__promptHubCards;
      if (!Array.isArray(raw) || !raw.length) return 0;
      let groups = [];
      try {
        const uid = window.SupabaseSync?.getUserId?.() || localStorage.getItem('promptrepo_last_uid') || '';
        const key = uid ? `promptrepo_groups_${uid}` : 'promptrepo_groups';
        const g = localStorage.getItem(key) || localStorage.getItem('promptrepo_groups');
        if (g) groups = JSON.parse(g);
      } catch (e) { /* ignore */ }
      const list = raw.slice(0, 200).map((c) => ({
        id: c.id,
        title: c.title,
        prompt: c.prompt,
        image: c.image,
        group: c.group,
        tags: c.tags
      }));
      localStorage.setItem(LS_IMPORT, JSON.stringify({ cards: list, groups: Array.isArray(groups) ? groups : [] }));
      return list.length;
    } catch (e) {
      return 0;
    }
  }

  function tryImportFromMain() {
    openImportPicker();
  }

  function loadPanelWidths() {
    const shell = document.getElementById('studioShell');
    if (!shell) return;
