        .join('<br>');
    }
    if (row.provider === 'grsai' && row.upstreamPoints) {
      return esc(String(row.upstreamPoints));
    }
    return '—';
  }

  function renderModelRouteCell(row) {
    const providerBadge = MODEL_PROVIDER_BADGE[row.provider] || '<span class="admin-badge">未知入口</span>';
    const apiModel = String(row.upstream || row.id || '').trim();
    const routes = Array.isArray(row.upstreamRoutes) ? row.upstreamRoutes : [];
    const head = `<div>${providerBadge}</div><div class="admin-model-route-head"><span class="admin-hint">卡藏</span> <code>${esc(row.id)}</code><br><span class="admin-hint">API 模型</span> <code>${esc(apiModel || '—')}</code></div>`;
    if (!routes.length) {
      const unavailable = row.routeCatalogAvailable === false;
      const label = unavailable ? '渠道目录暂不可用' : '没有配置调用渠道';
      const detail = unavailable && row.routeCatalogError
        ? `<span class="admin-model-route__meta admin-hint">${esc(row.routeCatalogError)}</span>`
        : '';
      return `${head}<div class="admin-model-route"><span class="admin-badge admin-badge--${unavailable ? 'warn' : 'off'}">${label}</span>${detail}</div>`;
    }
    return head + routes.map((route) => {
      const status = route.status === 'active'
        ? ['启用', 'ok']
        : route.status === 'auto_disabled'
          ? ['自动停用', 'warn']
          : ['停用', 'off'];
      const groups = Array.isArray(route.groups) ? route.groups.filter(Boolean).join(' / ') : '';
      const routing = [
        route.upstreamHost,
        groups ? `分组 ${groups}` : '',
        `优先级 ${Number(route.priority) || 0}`,
        `权重 ${Number(route.weight) || 0}`
      ].filter(Boolean).join(' · ');
      return `<div class="admin-model-route${route.enabled ? '' : ' is-disabled'}">
        <div class="admin-model-route__title"><strong>${esc(route.channelName || `线路 #${route.channelId || '—'}`)}</strong><span class="admin-badge admin-badge--${status[1]}">${status[0]}</span></div>
        <span class="admin-hint">真实调用</span> <code>${esc(route.actualModel || apiModel || '—')}</code>
        <span class="admin-model-route__meta admin-hint">${esc(routing)}</span>
      </div>`;
    }).join('');
  }

  function renderModelsTable() {
    const tbody = $('modelsTableBody');
    if (!tbody) return;
    const rows = filteredModelRows();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="13">当前筛选无模型</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const familyLabel = MODEL_UI_FAMILY_LABEL[row.uiFamily] || row.uiFamily || '—';
        const statusOpts = MODEL_STATUS_OPTS.map(
          (o) =>
            `<option value="${o.value}"${row.status === o.value ? ' selected' : ''}>${o.label}</option>`
        ).join('');
        const refundCell = `<label class="admin-check" title="取消勾选=违规不返还积分"><input type="checkbox" data-field="refundOnViolation" ${row.refundOnViolation !== false ? 'checked' : ''}> 返还</label>`;
        return `<tr data-model-id="${esc(row.id)}">
          <td class="admin-model-sort">
            <div class="admin-model-sort__btns">
              <button type="button" class="admin-btn" data-move-up="${esc(row.id)}" title="上移">↑</button>
              <button type="button" class="admin-btn" data-move-down="${esc(row.id)}" title="下移">↓</button>
            </div>
            <input type="number" class="admin-input-sm" data-field="sortOrder" min="0" max="9999" value="${row.sortOrder}" title="数字越小越靠前">
          </td>
          <td>${esc(familyLabel)}</td>
          <td class="admin-model-route-cell">${renderModelRouteCell(row)}</td>
          <td><code>${esc(row.id)}</code><br><span class="admin-hint">${esc(row.label)} · ${esc(row.description || '')}</span></td>
          <td>${row.pricingSource === 'upstream_realtime'
            ? `<strong>${esc(row.label)}</strong><br><span class="admin-hint">名称自动同步</span>`
            : `<input type="text" class="admin-input-sm" data-field="displayName" maxlength="48" value="${esc(row.displayName)}" placeholder="${esc(row.label)}">`}</td>
          <td><select class="admin-input-sm" data-field="status">${statusOpts}</select></td>
          <td class="admin-upstream-cost">${renderUpstreamCostCell(row)}</td>
          <td>${refundCell}</td>
          <td>${esc((row.resolutions || []).join(' / ') || '—')}</td>
          <td>${renderModelCreditsInputs(row)}</td>
          <td>${renderModelPromoInputs(row)}</td>
          <td class="model-effective">${renderModelEffectiveCell(row)}</td>
          <td>${row.pricingSource === 'upstream_realtime'
            ? '<span class="admin-badge admin-badge--ok">实时固定</span>'
            : `<label class="admin-check"><input type="checkbox" data-field="fixedPrice" ${row.fixedPrice ? 'checked' : ''}> 固定</label>`}</td>
        </tr>`;
      })
      .join('');
    tbody.querySelectorAll('[data-move-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveModelRow(btn.getAttribute('data-move-up'), -1));
    });
    tbody.querySelectorAll('[data-move-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveModelRow(btn.getAttribute('data-move-down'), 1));
    });
    tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
      const row = imageModelRows.find((r) => r.id === tr.dataset.modelId);
      if (!row) return;
      tr.querySelectorAll('input, select').forEach((inp) => {
        const handler = () => {
          if (inp.dataset.field === 'displayName') row.displayName = inp.value;
          if (inp.dataset.field === 'status') row.status = inp.value;
          if (inp.dataset.field === 'fixedPrice') row.fixedPrice = inp.checked;
          if (inp.dataset.field === 'refundOnViolation') row.refundOnViolation = inp.checked;
          if (inp.dataset.field === 'sortOrder') {
            row.sortOrder = Number(inp.value) || row.sortOrder;
            sortModelRowsInPlace();
            renderModelsTable();
            return;
          }
          if (inp.dataset.field === 'credits') row.creditsPerCall = Number(inp.value) || row.creditsPerCall;
          if (inp.dataset.field === 'promo') {
            const raw = inp.value.trim();
            row.promoPrice = raw === '' ? null : Number(raw) || null;
          }
          if (inp.dataset.field?.startsWith('promo-speed-')) {
            const speed = inp.dataset.field.slice('promo-speed-'.length);
            if (!row.promoBySpeed) row.promoBySpeed = {};
            const raw = inp.value.trim();
            if (raw === '') delete row.promoBySpeed[speed];
            else row.promoBySpeed[speed] = Number(raw) || row.promoBySpeed[speed];
          }
          if (inp.dataset.field?.startsWith('promo-') && !inp.dataset.field.startsWith('promo-speed-')) {
            const res = inp.dataset.field.slice('promo-'.length);
            if (!row.promoByResolution) row.promoByResolution = {};
            const raw = inp.value.trim();
            if (raw === '') delete row.promoByResolution[res];
            else row.promoByResolution[res] = Number(raw) || row.promoByResolution[res];
          }
          if (inp.dataset.field?.startsWith('credits-speed-')) {
            const speed = inp.dataset.field.slice('credits-speed-'.length);
            if (!row.creditsBySpeed) row.creditsBySpeed = {};
            row.creditsBySpeed[speed] = Number(inp.value) || row.creditsBySpeed[speed];
          }
          if (inp.dataset.field?.startsWith('credits-')) {
            const res = inp.dataset.field.slice('credits-'.length);
            if (res === 'speed-relax' || res === 'speed-fast' || res === 'speed-turbo') return;
            if (!row.creditsByResolution) row.creditsByResolution = {};
            row.creditsByResolution[res] = Number(inp.value) || row.creditsByResolution[res];
          }
          const eff = tr.querySelector('.model-effective');
          if (eff) eff.innerHTML = renderModelEffectiveCell(row);
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
    });
  }

  async function loadImageModels() {
    if (!session) return;
    const tbody = $('modelsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="13">加载中…</td></tr>';
    try {
      const data = await adminFetch(session, '/api/admin/image-models');
      imageModelSettings = data.settings || { globalDiscountPercent: 100, models: {} };
      imageModelRows = (data.models || []).map((row, i) => ensureMjCreditsBySpeed(normalizeModelRow(row, i)));
      sortModelRowsInPlace();
      const warn = $('modelsPersistWarn');
      if (warn) {
        const hint = data.settingsHint || '';
        if (hint) {
          warn.textContent = hint;
          warn.hidden = false;
          warn.className = data.settingsTableReady
            ? 'admin-msg admin-msg--warn'
            : 'admin-msg admin-msg--err';
        } else {
          warn.hidden = true;
          warn.textContent = '';
        }
      }
      renderModelsTable();
      showMsg(
        $('modelsMsg'),
        data.settingsPersisted ? '' : data.settingsTableReady ? '尚未保存过，改完请点保存' : '',
        true
      );
    } catch (e) {
      if (tbody) tbody.innerHTML = '';
      showMsg($('modelsMsg'), friendlyFetchError(e), false);
    }
  }

  function canvasStageBadge(stage) {
    const map = {
      created: ['已创建', 'info'],
      waiting_service: ['等待服务', 'info'],
      service_processing: ['生成中', 'warn'],
      waiting_result: ['等待结果', 'warn'],
      saving_result: ['保存结果', 'warn'],
      completed: ['已完成', 'ok'],
      failed: ['失败', 'off']
    };
    const item = map[stage] || [stage || '未知', 'info'];
    return `<span class="admin-badge admin-badge--${item[1]}">${esc(item[0])}</span>`;
  }

  function canvasPricingText(pricing) {
    if (!pricing) return '—';
    const tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
    if (tiers.length) {
      return tiers.map((tier) => {
        const condition = Object.entries(tier.when || {}).map(([key, value]) => `${key}=${value}`).join(' · ');
        return `${condition || '默认'}：${Number(tier.credits || 0).toLocaleString('zh-CN')} 积分`;
      }).join('<br>');
    }
    const credits = Number(pricing.credits);
    return Number.isFinite(credits) ? `${credits.toLocaleString('zh-CN')} 积分/${pricing.unit === 'image' ? '张' : '次'}` : '—';
  }

  function canvasParameterText(parameters) {
    const items = Array.isArray(parameters) ? parameters : [];
    return items
      .filter((item) => !['model', 'prompt'].includes(item.name))
      .map((item) => {
        if (item.name === 'images') return `参考图 ≤ ${item.max_items || '—'}`;
        if (item.name === 'image') return '单参考图';
        const values = Array.isArray(item.options) && item.options.length
          ? item.options.join(' / ')
          : Object.prototype.hasOwnProperty.call(item, 'fixed')
            ? `固定 ${item.fixed}`
            : Object.prototype.hasOwnProperty.call(item, 'default')
              ? `默认 ${item.default}`
              : item.max != null
                ? `${item.min || 0}–${item.max}`
                : '';
        return `${item.label || item.name}${values ? `：${values}` : ''}`;
      })
      .join('<br>') || '—';
  }

  async function loadCanvasOperations() {
    if (!session) return;
    const modelBody = $('canvasModelMapBody');
    const jobsBody = $('canvasJobsBody');
    const logsBody = $('canvasServiceLogsBody');
    if (modelBody) modelBody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
    if (jobsBody) jobsBody.innerHTML = '<tr><td colspan="8">加载中…</td></tr>';
    if (logsBody) logsBody.innerHTML = '<tr><td colspan="7">加载中…</td></tr>';
    try {
      const data = await adminFetch(session, '/api/admin/canvas?limit=100', { timeoutMs: 20000 });
      const catalog = data.catalog || {};
      const models = Array.isArray(catalog.models) ? catalog.models : [];
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const serviceLogs = data.serviceLogs || {};
      const logs = Array.isArray(serviceLogs.items) ? serviceLogs.items : [];

      const catalogMeta = $('canvasCatalogMeta');
      if (catalogMeta) {
        catalogMeta.textContent = `目录 ${catalog.version || '—'} · 价格 ${catalog.pricingVersion || '—'}${catalog.stale ? ' · 缓存数据' : ' · 实时'}`;
      }
      if (modelBody) {
        modelBody.innerHTML = models.length ? models.map((model) => `<tr>
          <td><strong>${esc(model.label || model.id)}</strong></td>
          <td><code>${esc(model.id)}</code></td>
          <td><code>${esc(model.actualModel || '—')}</code></td>
          <td><code>${esc(model.endpoint || '—')}</code></td>
          <td>${canvasPricingText(model.pricing)}</td>
          <td>${canvasParameterText(model.parameters)}</td>
        </tr>`).join('') : '<tr><td colspan="6">暂无可用图片模型</td></tr>';
      }

      if (jobsBody) {
        jobsBody.innerHTML = jobs.length ? jobs.map((job) => `<tr>
          <td>${monitorTime(job.createdAt)}</td>
          <td>${esc(job.userName || '未命名')}<br><code>${esc(String(job.userId || '').slice(0, 8))}</code></td>
          <td><strong>${esc(job.publicModelLabel || job.publicModel || '—')}</strong><br><span class="admin-hint">${esc(job.prompt || '')}</span></td>
          <td>${esc([job.size, job.resolution, job.quality, job.referenceCount ? `${job.referenceCount} 张参考图` : ''].filter(Boolean).join(' · ') || '—')}</td>
          <td>${canvasStageBadge(job.stage)}</td>
          <td>${esc(job.credits ?? '—')}</td>
          <td>${job.serviceRequestId ? `<code>${esc(job.serviceRequestId)}</code>` : job.serviceTaskId ? `<code>${esc(job.serviceTaskId)}</code>` : '—'}</td>
          <td>${job.error ? `<span class="admin-badge admin-badge--off">${esc(job.error)}</span>` : '—'}</td>
        </tr>`).join('') : '<tr><td colspan="8">暂无画布任务</td></tr>';
      }

      const serviceMeta = $('canvasServiceLogMeta');
      if (serviceMeta) serviceMeta.textContent = serviceLogs.available ? `已读取 ${logs.length} 条当前服务密钥日志` : `日志不可用：${serviceLogs.error || '未知错误'}`;
      const serviceLink = $('canvasServiceConsoleLink');
      if (serviceLink && serviceLogs.consoleUrl) serviceLink.href = serviceLogs.consoleUrl;
      if (logsBody) {
        logsBody.innerHTML = logs.length ? logs.map((log) => `<tr>
          <td>${monitorTime(log.createdAt)}</td>
          <td><code>${esc(log.model || '—')}</code></td>
          <td>${esc(log.channel || '—')}</td>
          <td>${log.status === 'success' ? '<span class="admin-badge admin-badge--ok">成功</span>' : log.status === 'failed' ? '<span class="admin-badge admin-badge--off">失败</span>' : '<span class="admin-badge admin-badge--info">其他</span>'}</td>
          <td>${Number(log.durationSeconds || 0).toLocaleString('zh-CN')} 秒</td>
          <td><code>${esc(log.requestId || '—')}</code></td>
          <td>${esc(log.detail || '—')}</td>
        </tr>`).join('') : `<tr><td colspan="7">${esc(serviceLogs.error || '暂无服务日志')}</td></tr>`;
      }

      const completed = jobs.filter((job) => job.status === 'completed').length;
      const failed = jobs.filter((job) => job.status === 'failed').length;
      const processing = jobs.filter((job) => job.status === 'processing').length;
      const stats = $('canvasOpsStats');
      if (stats) stats.innerHTML = `
        <div class="admin-stat admin-stat--blue"><span>图片模型</span><strong>${models.length}</strong></div>
        <div class="admin-stat admin-stat--amber"><span>处理中</span><strong>${processing}</strong></div>
        <div class="admin-stat admin-stat--green"><span>已完成</span><strong>${completed}</strong></div>
        <div class="admin-stat admin-stat--rose"><span>失败</span><strong>${failed}</strong></div>
      `;
      showMsg($('canvasOpsMsg'), '', true);
    } catch (e) {
      if (modelBody) modelBody.innerHTML = '';
      if (jobsBody) jobsBody.innerHTML = '';
      if (logsBody) logsBody.innerHTML = '';
      showMsg($('canvasOpsMsg'), friendlyFetchError(e), false);
    }
  }

  async function saveImageModels() {
    if (!session) return;
    const btn = $('modelsSaveBtn');
    syncModelRowsFromDom();
    sortModelRowsInPlace();
    const models = {};
    imageModelRows.forEach((row, index) => {
      ensureMjCreditsBySpeed(row);
      const displayName = String(row.displayName || '').trim();
      const patch = {
        status: row.status || 'active',
        sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10
      };
      if (row.pricingSource === 'upstream_realtime') {
        // 实时模型只保存上下架、排序与退款策略，价格和名称始终跟随卡藏 API。
      } else if (row.pricingByResolution && row.creditsByResolution) {
        patch.creditsByResolution = {};
        for (const [res, val] of Object.entries(row.creditsByResolution)) {
          if (val != null && val !== '') patch.creditsByResolution[res] = Number(val) || 0;
        }
        if (row.promoByResolution && Object.keys(row.promoByResolution).length) {
          patch.promoByResolution = {};
          for (const [res, val] of Object.entries(row.promoByResolution)) {
            if (val != null && val !== '') patch.promoByResolution[res] = Number(val);
          }
        }
      } else if (isMjPricingRow(row)) {
        patch.creditsBySpeed = {};
        const speeds = ['relax', 'fast', 'turbo'];
        const fallback = Number(row.creditsPerCall) || 8;
        for (const speed of speeds) {
          const raw = row.creditsBySpeed?.[speed];
          const n = Number(raw);
          patch.creditsBySpeed[speed] = Number.isFinite(n) && n > 0 ? n : fallback;
        }
        if (row.promoBySpeed && Object.keys(row.promoBySpeed).length) {
          patch.promoBySpeed = {};
          for (const [speed, val] of Object.entries(row.promoBySpeed)) {
            if (val != null && val !== '') patch.promoBySpeed[speed] = Number(val);
          }
        }
      } else {
        patch.creditsPerCall = Number(row.creditsPerCall) || 10;
        if (row.promoPrice != null && row.promoPrice !== '') {
          patch.promoPrice = Number(row.promoPrice);
        }
      }
      if (row.pricingSource !== 'upstream_realtime') {
        patch.fixedPrice = !!row.fixedPrice;
        if (displayName) patch.displayName = displayName;
      }
      patch.refundOnViolation = row.refundOnViolation !== false;
      models[row.id] = patch;
    });
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = '保存中…';
      }
      const body = { models };
      let data;
      try {
        data = await adminFetch(session, '/api/admin/image-models', { method: 'PUT', body });
      } catch (putErr) {
        if (!/failed to fetch|networkerror|load failed/i.test(String(putErr?.message || ''))) {
          throw putErr;
        }
        data = await adminFetch(session, '/api/admin/image-models/save', { method: 'POST', body });
      }
      imageModelSettings = data.settings;
      imageModelRows = (data.models || imageModelRows).map((row, i) =>
        ensureMjCreditsBySpeed(normalizeModelRow(row, i))
      );
      sortModelRowsInPlace();
      const warn = $('modelsPersistWarn');
      if (warn) {
        if (data.settingsPersisted === false) {
          warn.textContent =
            '保存请求已发出，但数据库仍未读到配置。请在 MemFire SQL 编辑器执行 site_settings 迁移后重试。';
          warn.hidden = false;
        } else {
          warn.hidden = true;
        }
      }
      renderModelsTable();
      showMsg($('modelsMsg'), '定价、排序与防亏本规则已保存', true);
      toast('生图模型配置已保存', true);
    } catch (e) {
      showMsg($('modelsMsg'), friendlyFetchError(e), false);
      toast(friendlyFetchError(e), false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存全部定价';
      }
    }
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function submitAdminLogin() {
    const btn = $('loginBtn');
    const secret = $('adminSecret')?.value?.trim();
    if (!secret) {
      showMsg($('loginMsg'), '请填写访问密钥', false);
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = '验证中…';
    }
    session = { secret, apiBase: resolveApiBase() };
    try {
      await adminFetch(session, '/api/admin/dashboard/infra', { timeoutMs: 20000 });
      saveSession(session);
      updateAdminApiChip();
      const sub = $('adminPageSubtitle');
      if (sub) sub.textContent = `API：${apiBase(session)} · 用户、存储、运行环境一览`;
      showApp(true);
      showMsg($('loginMsg'), '', true);
      document.querySelector('.admin-tab[data-tab="overview"]')?.click();
    } catch (e) {
      session = null;
      clearSession();
      showApp(false);
      showMsg($('loginMsg'), friendlyFetchError(e), false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.textContent = '登录';
      }
    }
  }

  async function validateStoredSession() {
    if (!session?.secret) return;
    try {
      await adminFetch(session, '/api/admin/dashboard/infra', { timeoutMs: 12000 });
      showApp(true);
    } catch (e) {
      const msg = String(e?.message || e || '');
      const authFailed =
        e?.status === 401 ||
        e?.code === 'UNAUTHORIZED' ||
        /UNAUTHORIZED|管理员密钥无效/i.test(msg);
      if (!authFailed) {
        showApp(true);
        toast('API 暂时不可用，登录状态已保留。' + friendlyFetchError(e), false, 9000);
        return;
      }
      clearSession();
      session = null;
      showApp(false);
      showMsg($('loginMsg'), '登录已过期，请重新输入密钥', false);
    }
  }

  function init() {
    try {
    syncAdminBuildLabels();
    bindTabs();
    setupAdminConfirmModal();
    setupCommunityPanelActions();
    showApp(!!session?.secret);
    updateAdminApiChip();

    $('adminRefreshBtn')?.addEventListener('click', () => {
      const btn = $('adminRefreshBtn');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('is-busy');
      }
      Promise.resolve(refreshCurrentTab()).finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-busy');
        }
        toast('已刷新', true, 1800);
      });
    });
    $('dashStorageRefresh')?.addEventListener('click', () => void loadDashboardStorage());

    $('loginBtn')?.addEventListener('click', () => { void submitAdminLogin(); });
    $('adminSecret')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submitAdminLogin();
      }
    });

    $('adminShowSecret')?.addEventListener('change', (e) => {
      const input = $('adminSecret');
      if (input) input.type = e.target.checked ? 'text' : 'password';
    });

    $('logoutBtn')?.addEventListener('click', () => {
      clearSession();
      session = null;
      showApp(false);
    });

    $('userSearchBtn')?.addEventListener('click', () => void loadUsers(true));
    $('userSearchClear')?.addEventListener('click', () => {
      const input = $('userSearch');
      if (input) input.value = '';
      void loadUsers(true);
    });
    $('userSearch')?.addEventListener('focus', () => {
      const input = $('userSearch');
      if (input?.value && /@/.test(input.value)) input.value = '';
    });
    let searchTimer = 0;
    $('userSearch')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void loadUsers(true), 400);
    });
    $('userSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void loadUsers(true);
    });
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    $('userPrev')?.addEventListener('click', () => {
      userOffset = Math.max(0, userOffset - PAGE);
      void loadUsers(false);
    });
    $('userNext')?.addEventListener('click', () => {
      userOffset += PAGE;
      void loadUsers(false);
    });

    $('codeSearchBtn')?.addEventListener('click', () => void loadCodes(true));
    $('codeFilterActive')?.addEventListener('change', () => void loadCodes(true));
    $('codePrev')?.addEventListener('click', () => {
      codeOffset = Math.max(0, codeOffset - PAGE);
      void loadCodes(false);
    });
    $('codeNext')?.addEventListener('click', () => {
      codeOffset += PAGE;
      void loadCodes(false);
    });
    $('createCodeBtn')?.addEventListener('click', () => void createCodes());
    $('modelsSaveBtn')?.addEventListener('click', () => void saveImageModels());
    document.getElementById('panel-models')?.addEventListener('click', (e) => {
      const famBtn = e.target.closest('[data-model-family]');
      if (famBtn) {
        modelFamilyFilter = famBtn.getAttribute('data-model-family') || 'all';
        $('modelFamilyTabs')?.querySelectorAll('[data-model-family]').forEach((b) => {
          b.classList.toggle('is-active', b === famBtn);
        });
        renderModelsTable();
        return;
      }
      const statusBtn = e.target.closest('[data-model-status]');
      if (statusBtn) {
        modelStatusFilter = statusBtn.getAttribute('data-model-status') || 'all';
        $('modelStatusTabs')?.querySelectorAll('[data-model-status]').forEach((b) => {
          b.classList.toggle('is-active', b === statusBtn);
        });
        renderModelsTable();
      }
    });

    $('communitySearchBtn')?.addEventListener('click', () => void loadCommunity(true));
    $('communitySearchClear')?.addEventListener('click', () => {
      const input = $('communitySearch');
      if (input) input.value = '';
      void loadCommunity(true);
    });
    $('communitySearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void loadCommunity(true);
    });
    $('communityPrev')?.addEventListener('click', () => {
      if (communityView === 'bucket-orphans') {
        communityOffset = Math.max(0, communityOffset - bucketOrphanPageSize());
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      } else {
        communityOffset = Math.max(0, communityOffset - PAGE);
        void loadCommunity(false);
      }
    });
    $('communityNext')?.addEventListener('click', () => {
      if (communityView === 'bucket-orphans') {
        communityOffset += bucketOrphanPageSize();
        void loadBucketOrphansPage({ reset: false, forceRefresh: false });
      } else {
        communityOffset += PAGE;
        void loadCommunity(false);
      }
    });
    $('communityBucketPageGoBtn')?.addEventListener('click', () => {
      jumpBucketOrphanPage($('communityBucketPageInput')?.value);
    });
    $('communityBucketPageInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') jumpBucketOrphanPage(e.target.value);
    });
    $('communityBucketPageSize')?.addEventListener('change', (e) => {
      communityBucketPageSize = Number(e.target.value) || 50;
      communityOffset = 0;
      if (communityView === 'bucket-orphans') void loadBucketOrphansPage({ reset: false, forceRefresh: false });
    });
    $('communityPurgeBtn')?.addEventListener('click', () =>
      void runCommunityPurge($('communityPurgeBtn'), null, $('communityMsg'))
    );
    $('communityPurgePreviewBtn')?.addEventListener('click', async () => {
      if (!session) return;
      const btn = $('communityPurgePreviewBtn');
      try {
        await runCommunityAdminTask({
          btn,
          confirmTitle: '预览清理',
          confirmText: '将扫描所有在线帖（约 1～2 分钟），统计会被「清理无效帖」下架的数量，不修改任何数据。继续？',
          progressText: '正在扫描待清理帖…',
          msgEl: $('communityMsg'),
          request: () =>
            adminFetch(session, '/api/admin/community/purge-ghosts/preview', { timeoutMs: 180000 }),
          onSuccess: (r) =>
            `预览：将下架 ${r.total || 0} 条（删卡孤儿 ${r.orphans || 0}，无图/无效 ${r.missing || 0}，重复 ${r.duplicates || 0}）。「卡片库无」${r.libraryMissing ?? '—'} 条请用「写回卡片库」，清理不会写回。`
        });
      } catch (e) { /* toast handled */ }
    });
    $('communityBatchUnpublishBtn')?.addEventListener('click', () => void runBatchCommunityAction('unpublish'));
    $('communityBatchDeleteBtn')?.addEventListener('click', () => void runBatchCommunityAction('delete'));
    document.querySelectorAll('[data-community-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        communityView = btn.getAttribute('data-community-view') || 'published';
        communitySelected.clear();
        stopBucketOrphanPoll();
        if (communityView !== 'bucket-orphans') {
          communityBucketScanMeta = null;
