      const finish = () => commitInlineDoc(docId, inp.value);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const p = getProject();
          const doc = p.docs.find((d) => d.id === docId);
          if (doc?._inlineNew) inp.value = '';
          else if (doc) inp.value = doc.title || '新文档';
          inp.blur();
        }
      });
      inp.addEventListener('blur', finish);
    });
    root.querySelectorAll('[data-inline-rename-fld]').forEach((inp) => {
      const folderId = inp.dataset.inlineRenameFld;
      const finish = () => commitInlineFolder(folderId, inp.value);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const p = getProject();
          const fld = p.folders.find((f) => f.id === folderId);
          if (fld?._inlineNew) inp.value = '';
          else if (fld) inp.value = fld.name || '新分类';
          inp.blur();
        }
      });
      inp.addEventListener('blur', finish);
    });
  }

  function renderDocRow(p, doc, depth) {
    const pad = 8 + depth * 14;
    const active = doc.id === p.activeDocId;
    const drag = (isViewOnly() && !allowsStudioDemoInteract()) ? 'false' : 'true';
    if (doc._inlineRename) {
      return `<div class="studio-doc-row${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" style="padding-left:${pad}px">
      <span class="studio-tree-toggle is-empty" aria-hidden="true"></span>
      <input type="text" class="studio-inline-input" data-inline-rename-doc="${esc(doc.id)}" placeholder="文档名称" maxlength="40" value="${esc(doc.title || '')}">
    </div>`;
    }
    return `<div class="studio-doc-row${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" draggable="${drag}" style="padding-left:${pad}px">
      <span class="studio-tree-toggle is-empty" aria-hidden="true"></span>
      <button type="button" class="studio-doc-item${active ? ' active' : ''}" data-doc-id="${esc(doc.id)}" data-folder-id="${esc(doc.folderId)}">${esc(doc.title || '新文档')}</button>
    </div>`;
  }

  function moveDocToFolder(docId, folderId) {
    if (!guardEdit()) return;
    const p = getProject();
    const doc = p.docs.find((d) => d.id === docId);
    const fld = p.folders.find((f) => f.id === folderId);
    if (!doc || !fld || doc.folderId === folderId) return;
    doc.folderId = folderId;
    p.activeFolderId = folderId;
    fld.collapsed = false;
    saveState();
    renderDocTree();
    setStatus(`文档已移动到「${fld.name}」`);
  }

  function bindDocTreeDragDrop(root, p) {
    root.querySelectorAll('.studio-doc-row[draggable="true"]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        dragDocId = row.dataset.docId;
        row.classList.add('doc-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', dragDocId);
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      row.addEventListener('dragend', () => {
        dragDocId = null;
        row.classList.remove('doc-dragging');
        root.querySelectorAll('.studio-doc-folder-row.doc-drop-target').forEach((el) => {
          el.classList.remove('doc-drop-target');
        });
      });
    });
    root.querySelectorAll('.studio-doc-folder-row').forEach((row) => {
      row.addEventListener('dragover', (e) => {
        if (!dragDocId && !e.dataTransfer?.types?.includes('text/plain')) return;
        e.preventDefault();
        row.classList.add('doc-drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('doc-drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('doc-drop-target');
        const docId = dragDocId || e.dataTransfer?.getData('text/plain');
        const folderId = row.dataset.folderId;
        if (docId && folderId) moveDocToFolder(docId, folderId);
        dragDocId = null;
      });
    });
  }

  function renderFolderNode(p, fld, depth) {
    const pad = 8 + depth * 14;
    const childFolders = getChildFolders(p, fld.id);
    const docs = p.docs.filter((d) => d.folderId === fld.id);
    const open = !fld.collapsed;
    const folderActive = fld.id === p.activeFolderId;
    let html = `<div class="studio-tree-branch" data-folder-id="${esc(fld.id)}">
      <div class="studio-doc-folder-row${folderActive ? ' active' : ''}" style="padding-left:${pad}px" data-folder-id="${esc(fld.id)}">
        <button type="button" class="studio-tree-toggle" data-toggle-folder="${esc(fld.id)}" aria-label="展开/收起">${open ? '▾' : '▸'}</button>`;
    if (fld._inlineRename) {
      html += `<input type="text" class="studio-inline-input" data-inline-rename-fld="${esc(fld.id)}" placeholder="分类名称" maxlength="20" value="${esc(fld.name || '')}">`;
    } else {
      html += `<button type="button" class="studio-doc-folder-btn" data-folder-id="${esc(fld.id)}">${esc(fld.name)}</button>`;
    }
    if (!isViewOnly()) {
      html += `<button type="button" class="studio-tree-add-doc" data-add-doc-in="${esc(fld.id)}" title="在此分类下新建文档" aria-label="新建文档">+</button>`;
    }
    html += `</div>`;
    if (open) {
      html += '<div class="studio-tree-children">';
      childFolders.forEach((cf) => {
        html += renderFolderNode(p, cf, depth + 1);
      });
      docs.forEach((d) => {
        html += renderDocRow(p, d, depth + 1);
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderDocTree() {
    const root = document.getElementById('studioDocTree');
    const p = getProject();
    if (!root || !p) return;
    normalizeProject(p);
    if (!p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    const roots = getChildFolders(p, null);
    let html = roots.map((fld) => renderFolderNode(p, fld, 0)).join('');
    root.innerHTML =
      html ||
      '<p class="panel-hint">点击右上角 + 新建文件夹；文件夹右侧 + 新建文档</p>';
    root.querySelectorAll('.studio-doc-folder-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.activeFolderId = btn.dataset.folderId;
        saveState();
        renderDocTree();
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        startInlineRenameFolder(btn.dataset.folderId);
      });
    });
    root.querySelectorAll('[data-add-doc-in]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startInlineNewDoc(btn.dataset.addDocIn);
      });
    });
    bindInlineRenameInputs(root);
    root.querySelectorAll('[data-toggle-folder]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fld = p.folders.find((f) => f.id === btn.dataset.toggleFolder);
        if (!fld) return;
        fld.collapsed = !fld.collapsed;
        saveState();
        renderDocTree();
      });
    });
    root.querySelectorAll('.studio-doc-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.activeDocId = btn.dataset.docId;
        if (btn.dataset.folderId) p.activeFolderId = btn.dataset.folderId;
        saveState();
        renderAll();
      });
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        startInlineRenameDoc(btn.dataset.docId);
      });
    });
    root.querySelectorAll('.studio-doc-folder-row').forEach((row) => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const folderId = row.dataset.folderId;
        showTreeMenu(
          e.clientX,
          e.clientY,
          [
            { action: 'new-doc', label: '新建文档' },
            { action: 'new-folder', label: '新建子文件夹' },
            { action: 'rename', label: '重命名' },
            { action: 'delete', label: '删除', danger: true }
          ],
          (action) => {
            if (action === 'new-doc') startInlineNewDoc(folderId);
            else if (action === 'new-folder') startInlineNewFolder(folderId);
            else if (action === 'rename') startInlineRenameFolder(folderId);
            else if (action === 'delete') void deleteFolderById(folderId);
          }
        );
      });
    });
    root.querySelectorAll('.studio-doc-row').forEach((row) => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const docId = row.dataset.docId;
        showTreeMenu(
          e.clientX,
          e.clientY,
          [
            { action: 'rename', label: '重命名' },
            { action: 'delete', label: '删除', danger: true }
          ],
          (action) => {
            if (action === 'rename') startInlineRenameDoc(docId);
            else if (action === 'delete') void deleteDocById(docId);
          }
        );
      });
    });
    bindDocTreeDragDrop(root, p);
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getHeroMentionTitles(doc) {
    if (!doc?.heroCardIds?.length) return [];
    return doc.heroCardIds
      .map((id) => getCard(id))
      .filter(Boolean)
      .map((c) => ({ id: c.id, title: (c.title || '').trim() }))
      .filter((t) => t.title.length >= 2)
      .sort((a, b) => b.title.length - a.title.length);
  }

  function updateCardChrome(cardId, title) {
    const safeTitle = title || '未命名';
    const layer = document.getElementById('studioFloatLayer');
    const floatHead = layer?.querySelector(`.studio-float-card[data-card-id="${cardId}"] .studio-float-head span`);
    if (floatHead) floatHead.textContent = safeTitle;
    if (detailCardId === cardId) {
      const head = document.getElementById('studioCardDetailTitle');
      if (head) head.textContent = safeTitle;
    }
    document.querySelectorAll(`.studio-hero-thumb[data-card-id="${cardId}"]`).forEach((el) => {
      el.title = `${safeTitle} · 点击唤出卡片`;
    });
  }

  function wrapMentionInTextNode(textNode, title, cardId) {
    const text = textNode.textContent || '';
    const idx = text.indexOf(title);
    if (idx === -1) return false;
    const parent = textNode.parentNode;
    if (!parent) return false;
    const before = text.slice(0, idx);
    const after = text.slice(idx + title.length);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    const span = document.createElement('span');
    span.className = 'studio-mention';
    span.dataset.mention = cardId;
    span.textContent = title;
    frag.appendChild(span);
    const afterNode = document.createTextNode(after);
    frag.appendChild(afterNode);
    parent.replaceChild(frag, textNode);
    if (after.includes(title)) wrapMentionInTextNode(afterNode, title, cardId);
    return true;
  }

  function applyHeroMentionsInEditor() {
    const editor = document.getElementById('studioEditor');
    const doc = getActiveDoc();
    if (!editor || !doc || isViewOnly() || mentionApplying) return;
    mentionApplying = true;
    try {
      editor.querySelectorAll('.studio-mention').forEach((span) => {
        span.replaceWith(document.createTextNode(span.textContent || ''));
      });
      editor.normalize();
      const titles = getHeroMentionTitles(doc);
      titles.forEach(({ id, title }) => {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((tn) => {
          if (tn.parentElement?.closest('.studio-mention')) return;
          if ((tn.textContent || '').includes(title)) wrapMentionInTextNode(tn, title, id);
        });
      });
      doc.bodyHtml = editor.innerHTML;
    } finally {
      mentionApplying = false;
    }
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function scheduleApplyHeroMentions() {
    clearTimeout(mentionApplyTimer);
    mentionApplyTimer = setTimeout(() => {
      applyHeroMentionsInEditor();
    }, 320);
  }

  function removeHeroCard(cardId) {
    if (!guardEdit()) return;
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    doc.heroCardIds = doc.heroCardIds.filter((id) => id !== cardId);
    if (Array.isArray(c.docs)) c.docs = c.docs.filter((id) => id !== doc.id);
    if (Array.isArray(doc.closedFloatIds)) {
      doc.closedFloatIds = doc.closedFloatIds.filter((id) => id !== cardId);
    }
    if (doc.floatPositions && doc.floatPositions[cardId]) {
      delete doc.floatPositions[cardId];
    }
    document
      .getElementById('studioFloatLayer')
      ?.querySelector(`.studio-float-card[data-card-id="${cardId}"]`)
      ?.remove();
    saveState();
    renderEditor();
  }

  function renderEditor() {
    const doc = getActiveDoc();
    const p = getProject();
    if (!doc) return;
    const titleEl = document.getElementById('studioDocTitle');
    const editor = document.getElementById('studioEditor');
    const meta = document.getElementById('studioDocMeta');
    const hero = document.getElementById('studioHeroThumbs');
    const heroHint = document.getElementById('studioHeroHint');
    if (heroHint) {
      heroHint.textContent = '关联图';
      heroHint.title = p.heroFieldLabel || DEFAULT_HERO_LABEL;
    }
    if (titleEl) titleEl.value = doc.title || '';
    if (meta) meta.textContent = `${p.name} · ${doc.heroCardIds.length} 张关联卡`;
    if (hero) {
      hero.innerHTML = doc.heroCardIds
        .map((id) => {
          const c = getCard(id);
          if (!c) return '';
          const initialSrc = c.image ? studioImageInitialSrc(c.image) : '';
          const inner = c.image
            ? `<img src="${initialSrc ? esc(initialSrc) : ''}" data-image-ref="${esc(c.image)}" alt=""${initialSrc ? ' data-loaded="1"' : ''}>`
            : `<div class="studio-hero-thumb-fallback" style="--card-hue:${c.hue || 210}"></div>`;
          return `<div class="studio-hero-thumb-wrap">
            <div class="studio-hero-thumb" data-card-id="${esc(id)}" title="${esc(c.title)} · 点击唤出卡片">${inner}</div>
            <button type="button" class="studio-hero-remove" data-remove-hero="${esc(id)}" aria-label="移出">×</button>
          </div>`;
        })
        .join('');
      void hydrateStudioCardImages(hero);
      hero.querySelectorAll('.studio-hero-thumb[data-card-id]').forEach((el) => {
        el.addEventListener('click', () => openFloatCardForHero(el.dataset.cardId));
      });
      hero.querySelectorAll('[data-remove-hero]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeHeroCard(btn.dataset.removeHero);
        });
      });
    }
    if (editor && editor.dataset.docId !== doc.id) {
      editor.dataset.docId = doc.id;
      editor.innerHTML = doc.bodyHtml || doc.body || '';
      scheduleApplyHeroMentions();
    }
    renderFloatCards(doc);
    scheduleApplyHeroMentions();
  }

  function openFloatCardForHero(cardId) {
    const doc = getActiveDoc();
    const c = getCard(cardId);
    if (!doc || !c) return;
    if (!Array.isArray(doc.closedFloatIds)) doc.closedFloatIds = [];
    doc.closedFloatIds = doc.closedFloatIds.filter((id) => id !== cardId);
    const layer = document.getElementById('studioFloatLayer');
    const existing = layer?.querySelector(`.studio-float-card[data-card-id="${cardId}"]`);
    if (existing) {
      existing.style.zIndex = String(++floatZ);
      return;
    }
    const idx = doc.heroCardIds.indexOf(cardId);
    const pos = doc.floatPositions?.[cardId] || { x: 420 + Math.max(0, idx) * 36, y: 80 + Math.max(0, idx) * 48 };
    spawnFloatCard(c, pos.x, pos.y);
    saveState();
  }

  function renderFloatCards(doc) {
    const layer = document.getElementById('studioFloatLayer');
    if (!layer || !doc) return;
    const closed = new Set(doc.closedFloatIds || []);
    layer.querySelectorAll('.studio-float-card').forEach((el) => {
      if (!doc.heroCardIds.includes(el.dataset.cardId)) el.remove();
    });
    doc.heroCardIds.forEach((id, idx) => {
      if (closed.has(id)) return;
      if (layer.querySelector(`.studio-float-card[data-card-id="${id}"]`)) return;
      const c = getCard(id);
      if (!c) return;
      const pos = doc.floatPositions?.[id] || { x: 420 + idx * 36, y: 80 + idx * 48 };
      spawnFloatCard(c, pos.x, pos.y);
    });
  }

  function spawnFloatCard(card, x, y) {
    const layer = document.getElementById('studioFloatLayer');
    const doc = getActiveDoc();
    if (!layer || !card) return;
    const el = document.createElement('div');
    el.className = 'studio-float-card';
    el.dataset.cardId = card.id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.zIndex = String(++floatZ);
    const floatSrc = card.image ? studioImageInitialSrc(card.image) : '';
    const thumb = card.image
      ? `<img src="${floatSrc ? esc(floatSrc) : ''}" data-image-ref="${esc(card.image)}" alt=""${floatSrc ? ' data-loaded="1"' : ''}>`
      : `<div class="studio-float-thumb-fallback" style="--card-hue:${card.hue || 210}"></div>`;
    el.innerHTML = `
      <div class="studio-float-head">
        <span>${esc(card.title)}</span>
        <button type="button" class="studio-float-close" aria-label="关闭">×</button>
      </div>
      <div class="studio-float-body">
        <div class="studio-float-thumb">${thumb}</div>
        <div class="studio-float-info">${esc(card.background || card.prompt || '暂无设定')}</div>
        <div class="studio-float-hint">双击查看完整设定与关联文档</div>
      </div>`;
    layer.appendChild(el);
    el.querySelector('.studio-float-close')?.addEventListener('click', () => {
      el.remove();
      if (doc) {
        if (!doc.closedFloatIds) doc.closedFloatIds = [];
        if (!doc.closedFloatIds.includes(card.id)) doc.closedFloatIds.push(card.id);
        saveState();
        maybeCompletePresetTour(doc);
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.studio-float-head')) return;
      e.preventDefault();
      el.classList.add('dragging');
      const ox = e.clientX - el.offsetLeft;
      const oy = e.clientY - el.offsetTop;
      const move = (ev) => {
        el.style.left = `${ev.clientX - ox}px`;
        el.style.top = `${ev.clientY - oy}px`;
      };
      const up = () => {
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (doc) {
          if (!doc.floatPositions) doc.floatPositions = {};
          doc.floatPositions[card.id] = { x: el.offsetLeft, y: el.offsetTop };
          saveState();
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    el.querySelector('.studio-float-body')?.addEventListener('dblclick', () => openCardDetailPanel(card.id));
    void hydrateStudioCardImages(el);
  }

  function docExcerpt(doc) {
    const raw = doc.bodyHtml || doc.body || '';
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '（文档暂无正文）';
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  }

  function warehouseCardHtml(c) {
    const hue = c.hue || 210;
    const media = c.image && String(c.image).trim()
      ? `<img class="card-img" src="" data-image-ref="${esc(c.image)}" alt="">`
      : `<div class="card-media-placeholder"></div>`;
    const tags = [cardFolderName(c)].filter((t) => t && t !== '未分类');
    return `
      <div class="card studio-wh-card" style="--card-hue:${hue}">
        <div class="card-media">${media}</div>
        <div class="card-body">
          <div class="card-head"><div class="card-title">${esc(c.title)}</div></div>
          <div class="card-desc">${esc(c.prompt || c.background || '暂无描述')}</div>
          <div class="card-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
      </div>`;
  }

  function closeCardDetailPanel() {
    const root = document.getElementById('studioCardDetail');
    if (!root) return;
    root.classList.add('hidden');
    detailCardId = null;
    document.body.style.overflow = '';
  }

  function jumpToDoc(docId) {
    const p = getProject();
    if (!p?.docs.some((d) => d.id === docId)) return;
    p.activeDocId = docId;
    saveState();
    closeCardDetailPanel();
    renderAll();
    setStatus('已跳转到关联文档');
  }

  function saveCardFromDetail() {
    if (!guardEdit()) return;
    if (!detailCardId) return;
    const c = getCard(detailCardId);
    const root = document.getElementById('studioCardDetailBody');
    if (!c || !root) return;
    c.title = root.querySelector('[data-field="title"]')?.value?.trim() || '未命名';
    c.prompt = root.querySelector('[data-field="prompt"]')?.value?.trim() || '';
    c.background = root.querySelector('[data-field="background"]')?.value?.trim() || '';
    c.character = root.querySelector('[data-field="character"]')?.value?.trim() || '';
    c.relations = root.querySelector('[data-field="relations"]')?.value?.trim() || '';
    if (!c.customFields) c.customFields = {};
    getProjectGlobalFields().forEach((f) => {
      const el = root.querySelector(`[data-custom-field="${CSS.escape(f.name)}"]`);
      if (el) c.customFields[f.name] = el.value.trim();
    });
    saveState();
    updateCardChrome(detailCardId, c.title);
    renderAssetFolders();
    renderEditor();
    scheduleApplyHeroMentions();
    setStatus('卡片设定已保存');
  }

  function buildCardDetailFieldsHtml(c, readonly) {
    const labels = getProjectFieldLabels();
    const ro = readonly ? ' readonly' : '';
    const coreMeta = {
      title: { type: 'text', cls: 'studio-card-title-input' },
      prompt: { type: 'textarea', cls: 'mono studio-prompt-view', rows: 6 },
      background: { type: 'textarea', rows: 3 },
      character: { type: 'textarea', rows: 3 },
      relations: { type: 'textarea', rows: 2 }
