    let saved = null;
    try {
      const raw = localStorage.getItem(LS_PANEL_WIDTHS);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    ['assets', 'docs', 'ai'].forEach((key) => {
      const val = Number(saved?.[key]) || PANEL_WIDTH_DEFAULTS[key];
      const lim = PANEL_WIDTH_LIMITS[key];
      const w = Math.min(lim.max, Math.max(lim.min, val));
      shell.style.setProperty(`--studio-w-${key}`, `${w}px`);
    });
  }

  function savePanelWidths(shell) {
    if (!shell) return;
    const data = {
      assets: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-assets'), 10) || PANEL_WIDTH_DEFAULTS.assets,
      docs: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-docs'), 10) || PANEL_WIDTH_DEFAULTS.docs,
      ai: parseInt(getComputedStyle(shell).getPropertyValue('--studio-w-ai'), 10) || PANEL_WIDTH_DEFAULTS.ai
    };
    try {
      localStorage.setItem(LS_PANEL_WIDTHS, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function bindPanelResizers() {
    const shell = document.getElementById('studioShell');
    if (!shell) return;
    loadPanelWidths();
    shell.querySelectorAll('.studio-resizer').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (isViewOnly()) return;
        e.preventDefault();
        const which = handle.dataset.resize;
        if (!which) return;
        const startX = e.clientX;
        const startW = parseInt(getComputedStyle(shell).getPropertyValue(`--studio-w-${which}`), 10)
          || PANEL_WIDTH_DEFAULTS[which];
        const lim = PANEL_WIDTH_LIMITS[which];
        document.body.classList.add('studio-resizing');
        const move = (ev) => {
          const delta = ev.clientX - startX;
          let next = startW;
          if (which === 'ai') next = startW - delta;
          else next = startW + delta;
          next = Math.min(lim.max, Math.max(lim.min, next));
          shell.style.setProperty(`--studio-w-${which}`, `${next}px`);
        };
        const up = () => {
          document.body.classList.remove('studio-resizing');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          savePanelWidths(shell);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
  }

  function bindDropZones() {
    const hero = document.getElementById('studioHeroDrop');
    const chat = document.getElementById('studioChatLog');
    [hero, chat].forEach((zone) => {
      if (!zone) return;
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (zone === hero) hero.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => hero?.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        hero?.classList.remove('drag-over');
        if (isViewOnly() && !allowsStudioDemoInteract()) {
          guardEdit();
          return;
        }
        const id = e.dataTransfer.getData('text/plain') || dragCardId;
        if (!id) return;
        if (zone === hero) addCardToDoc(id);
        else {
          const c = getCard(id);
          if (c) {
            const log = document.getElementById('studioChatLog');
            const p = document.createElement('p');
            p.className = 'studio-chat-msg user';
            p.textContent = `[拖入卡片] ${c.title}：${c.prompt || c.background || ''}`;
            log?.appendChild(p);
          }
        }
      });
    });
  }

  function bindEditor() {
    const editor = document.getElementById('studioEditor');
    const titleEl = document.getElementById('studioDocTitle');
    editor?.addEventListener('input', () => {
      if (isViewOnly() || mentionApplying) return;
      const doc = getActiveDoc();
      if (doc) {
        doc.bodyHtml = editor.innerHTML;
        saveState();
        scheduleApplyHeroMentions();
      }
    });
    editor?.addEventListener('click', (e) => {
      const m = e.target.closest('.studio-mention');
      if (m?.dataset?.mention) openCardDetailPanel(m.dataset.mention);
    });
    titleEl?.addEventListener('change', () => {
      if (isViewOnly()) return;
      const doc = getActiveDoc();
      if (doc) {
        doc.title = titleEl.value.trim() || '未命名文档';
        saveState();
        renderDocTree();
      }
    });
  }

  function bindChrome() {
    document.getElementById('studioProjectSelect')?.addEventListener('change', (e) => {
      state.projectId = e.target.value;
      saveState();
      renderAll();
    });
    document.getElementById('studioNewProjectBtn')?.addEventListener('click', () => {
      if (!guardEdit()) return;
      void (async () => {
        const name = await studioPrompt('新建项目', '项目名称', '新项目');
        if (!name?.trim()) return;
        const id = `proj_${Date.now().toString(36)}`;
        state.projects.push({
          id,
          name: name.trim().slice(0, 24),
          folders: [{ id: `fld_${Date.now()}`, name: '默认', parentId: null, collapsed: false }],
          docs: [],
          cards: [],
          cardGroups: [],
          globalFields: [],
          fieldLabels: { ...DEFAULT_FIELD_LABELS },
          heroFieldLabel: DEFAULT_HERO_LABEL,
          coreFieldOrder: CORE_FIELD_KEYS.slice()
        });
        state.projectId = id;
        ensureProjectHasDoc(getProject());
        saveState();
        renderAll();
        setStatus('新项目已创建，请为本项目导入卡片库');
      })();
    });
    document.getElementById('studioDeleteProjectBtn')?.addEventListener('click', () => {
      void deleteCurrentProject();
    });
    document.getElementById('studioFieldSettingsBtn')?.addEventListener('click', openFieldSettings);
    document.getElementById('studioSettingsClose')?.addEventListener('click', closeFieldSettings);
    document.getElementById('studioSettingsBackdrop')?.addEventListener('click', closeFieldSettings);
    document.getElementById('studioSettingsSaveBtn')?.addEventListener('click', saveFieldSettings);
    document.getElementById('studioAddFieldBtn')?.addEventListener('click', addStudioGlobalField);
    document.getElementById('studioThemeToggleBtn')?.addEventListener('click', () => {
      window.toggleAppTheme?.();
    });
    document.getElementById('studioRechargeBtn')?.addEventListener('click', () => {
      if (document.getElementById('subscribeOverlay')) {
        window.openRechargePanel?.() || window.showRechargePlaceholder?.();
        return;
      }
      window.location.href = 'index.html?panel=recharge';
    });
    document.getElementById('studioLedgerBtn')?.addEventListener('click', () => void toggleStudioCreditLedger());
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('studioCreditLedgerPanel');
      if (!panel || panel.classList.contains('hidden')) return;
      if (e.target.closest('.studio-credits-wrap')) return;
      panel.classList.add('hidden');
    });
    document.getElementById('studioDocAddBtn')?.addEventListener('click', () => {
      if (!guardEdit()) return;
      startInlineNewFolder(null);
    });
    document.getElementById('studioImportClose')?.addEventListener('click', closeImportPicker);
    document.getElementById('studioAssetFolders')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.studio-import-cta, #studioImportCta');
      if (!btn) return;
      e.preventDefault();
      void openImportPicker();
    });
    document.getElementById('studioGuideOk')?.addEventListener('click', closeStudioGuide);
    document.getElementById('studioChatThreadSelect')?.addEventListener('change', (e) => {
      switchChatThread(e.target.value);
    });
    document.getElementById('studioChatNewThread')?.addEventListener('click', createNewChatThread);
    document.getElementById('studioCardDetailClose')?.addEventListener('click', closeCardDetailPanel);
    document.getElementById('studioCardDetailBackdrop')?.addEventListener('click', closeCardDetailPanel);
    document.getElementById('studioCardFieldSettingsBtn')?.addEventListener('click', openFieldSettings);
    document.getElementById('studioCardSaveBtn')?.addEventListener('click', saveCardFromDetail);
    document.getElementById('studioCardCopyPrompt')?.addEventListener('click', () => {
      const c = detailCardId ? getCard(detailCardId) : null;
      const ta = document.querySelector('#studioCardDetailBody [data-field="prompt"]');
      const text = ta?.value?.trim() || c?.prompt || '';
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => setStatus('提示词已复制'),
        () => setStatus('复制失败，请手动选中复制')
      );
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const settings = document.getElementById('studioSettingsOverlay');
      if (settings && !settings.classList.contains('hidden')) {
        closeFieldSettings();
        return;
      }
      const detail = document.getElementById('studioCardDetail');
      if (detail && !detail.classList.contains('hidden')) closeCardDetailPanel();
    });
    document.getElementById('studioAiCollapse')?.addEventListener('click', () => {
      document.getElementById('studioShell')?.classList.toggle('ai-collapsed');
    });
    document.getElementById('studioAssetFilter')?.addEventListener('input', renderAssetFolders);
    const filterBtn = document.getElementById('studioFilterBtn');
    const filterDd = document.getElementById('studioFilterDropdown');
    filterBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!filterDd) return;
      filterDd.classList.toggle('hidden');
      if (!filterDd.classList.contains('hidden')) buildStudioFilterMenu();
    });
    document.addEventListener('click', (e) => {
      if (!filterDd || filterDd.classList.contains('hidden')) return;
      if (e.target.closest('#studioFilterBtn, #studioFilterDropdown')) return;
      filterDd.classList.add('hidden');
    });
    document.querySelectorAll('[data-asset-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.assetTab = tab.dataset.assetTab;
        document.querySelectorAll('[data-asset-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        renderAssetFolders();
      });
    });
    document.querySelectorAll('[data-ai-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.aiTab;
        document.querySelectorAll('[data-ai-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('[data-ai-pane]').forEach((p) => p.classList.toggle('active', p.dataset.aiPane === name));
      });
    });
    document.getElementById('studioChatSend')?.addEventListener('click', () => void onStudioChatSend());
    document.getElementById('studioChatContextBtn')?.addEventListener('click', onStudioChatContext);
    document.getElementById('studioChatModel')?.addEventListener('change', updateStudioChatCostHint);
    document.getElementById('studioChatThinking')?.addEventListener('change', updateStudioChatCostHint);
    updateStudioChatCostHint();
    document.getElementById('studioChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onStudioChatSend();
      }
    });
    ['studioImageModel', 'studioImageResolution'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', updateStudioImageGenCostHint);
    });
    document.getElementById('studioImageSubmit')?.addEventListener('click', () => void runStudioImageGen());
    document.getElementById('studioImageFillDoc')?.addEventListener('click', fillStudioImageFromDoc);
    document.getElementById('studioImageAddCard')?.addEventListener('click', addStudioGenToLibrary);
    document.getElementById('studioImageDownload')?.addEventListener('click', downloadStudioGenImage);
    document.getElementById('studioVideoCopyBtn')?.addEventListener('click', () => {
      const text = document.getElementById('studioVideoPrompt')?.value?.trim();
      if (!text) return;
      navigator.clipboard?.writeText(text).then(
        () => setStatus('分镜描述已复制'),
        () => setStatus('复制失败')
      );
    });
  }

  function renderAll() {
    renderProjects();
    renderAssetFolders();
    renderDocTree();
    renderChatThreadSelect();
    renderChatLogFromThread();
    buildStudioFilterMenu();
    applyViewOnlyMode();
    const editor = document.getElementById('studioEditor');
    if (editor) editor.dataset.docId = '';
    renderEditor();
  }

  async function init() {
    purgeLegacyStudioStorage();
    loadFilters();
    buildStudioFilterMenu();
    const p = getProject();
    if (p && !p.activeDocId && p.docs[0]) p.activeDocId = p.docs[0].id;
    bindPanelResizers();
    bindChrome();
    bindDropZones();
    bindEditor();
    bindStudioImageRefUpload();
    updateStudioImageGenCostHint();
    if (!document.body.dataset.studioTreeMenuBound) {
      document.body.dataset.studioTreeMenuBound = '1';
      document.addEventListener('click', hideTreeMenu);
      document.addEventListener('scroll', hideTreeMenu, true);
    }
    const imgScroll = document.getElementById('studioImageScroll');
    imgScroll?.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    applyViewOnlyMode();
    updateStudioCreditsBadge();
    maybeShowStudioGuide();
    renderAll();
    if (/[?&]import=1(?:&|$)/.test(location.search || '')) {
      try {
        history.replaceState(null, '', location.pathname);
      } catch (e) { /* ignore */ }
      requestAnimationFrame(() => openImportPicker());
    }
    void (async () => {
      try {
        await withTimeout(
          (async () => {
            if (window.SupabaseSync?.init) await window.SupabaseSync.init();
            if (window.PointsSystem?.refreshCreditsFromServer) {
              await window.PointsSystem.refreshCreditsFromServer();
            }
          })(),
          4000
        );
      } catch (e) { /* ignore */ }
      applyViewOnlyMode();
      updateStudioCreditsBadge();
      const root = document.getElementById('studioAssetFolders');
      if (root) observeStudioCardImages(root);
      prefetchStudioProjectThumbs();
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void init(); });
  else void init();
})();
