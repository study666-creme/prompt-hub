    if (!session) return;
    const tier = $('editTier')?.value ?? '';
    const body = {
      credits: Number($('editCredits')?.value),
      dailyCredits: Number($('editDaily')?.value)
    };
    if (tier === '') {
      body.clearMembership = true;
    } else {
      body.membershipTier = tier;
      const until = fromDatetimeLocal($('editUntil')?.value || '');
      if (until) body.membershipUntil = until;
    }
    if ($('editClearQueue')?.checked) body.clearQueuedMembership = true;

    try {
      $('saveUserBtn').disabled = true;
      await adminFetch(session, '/api/admin/users/' + encodeURIComponent(u.userId), {
        method: 'PATCH',
        body
      });
      toast('已保存', true);
      void loadUsers(false);
      void loadDashboard();
      void showUserDetail(u.userId);
    } catch (e) {
      toast(friendlyFetchError(e), false);
    } finally {
      const btn = $('saveUserBtn');
      if (btn) btn.disabled = false;
    }
  }

  async function deleteUser(u) {
    if (!session) return;
    const typed = ($('deleteConfirm')?.value || '').trim();
    if (!u.email || typed !== u.email) {
      toast('请输入完整邮箱以确认删除', false);
      return;
    }
    if (!window.confirm('确定永久删除 ' + u.email + ' ？此操作不可撤销。')) return;

    try {
      $('deleteUserBtn').disabled = true;
      const res = await adminFetch(session, '/api/admin/users/' + encodeURIComponent(u.userId), {
        method: 'DELETE'
      });
      toast('已删除，清理图片 ' + (res.storageFilesRemoved || 0) + ' 个', true);
      closeModal();
      void loadUsers(true);
      void loadDashboard();
    } catch (e) {
      toast(friendlyFetchError(e), false);
      $('deleteUserBtn').disabled = false;
    }
  }

  async function loadCodes(reset) {
    if (!session) return;
    if (reset) codeOffset = 0;
    setCodeCategoryFilter(codeCategory);
    const q = ($('codeSearch')?.value || '').trim().toUpperCase();
    const active = $('codeFilterActive')?.value || '';
    const tbody = $('codeTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">加载中…</td></tr>';
    try {
      let path = `/api/admin/codes?limit=${PAGE}&offset=${codeOffset}`;
      if (q) path += '&q=' + encodeURIComponent(q);
      if (active) path += '&active=' + active;
      if (codeCategory && codeCategory !== 'all') path += '&category=' + encodeURIComponent(codeCategory);
      const data = await adminFetch(session, path);
      $('codePageInfo').textContent = `第 ${codeOffset + 1}–${codeOffset + data.items.length} 条，约 ${data.total} 个码`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="6">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((row) => {
          const tierLabel =
            row.membership_tier === 'lite'
              ? '轻量'
              : row.membership_tier === 'basic'
                ? '基础'
                : row.membership_tier === 'standard'
                  ? '标准'
                  : row.membership_tier === 'pro'
                    ? '专业'
                    : row.membership_tier || '';
          const offerLabel =
            row.offer_kind === 'mini_3d'
              ? '¥0.99/3天'
              : row.offer_kind === 'starter_14d'
                ? '¥1.9/14天'
                : '';
          const extra =
            row.membership_tier && row.membership_days
              ? ` + ${row.membership_days}天${tierLabel}`
              : row.membership_days
                ? ` + ${row.membership_days}天会员`
                : '';
          const offerExtra = offerLabel ? ` · ${offerLabel}` : '';
          return `<tr>
            <td><code>${esc(row.code)}</code></td>
            <td>${row.credits}${extra}${offerExtra}</td>
            <td>${row.used_count}/${row.max_uses}</td>
            <td>${row.active ? '<span class="admin-badge admin-badge--ok">启用</span>' : '<span class="admin-badge admin-badge--off">停用</span>'}</td>
            <td>${esc(row.note || '—')}</td>
            <td>
              <button type="button" class="admin-btn" data-toggle-code="${esc(row.code)}" data-active="${row.active ? '0' : '1'}">${row.active ? '停用' : '启用'}</button>
            </td>
          </tr>`;
        })
        .join('');
      tbody.querySelectorAll('[data-toggle-code]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const code = btn.getAttribute('data-toggle-code');
          const active = btn.getAttribute('data-active') === '1';
          try {
            await adminFetch(session, '/api/admin/codes/' + encodeURIComponent(code), {
              method: 'PATCH',
              body: { active }
            });
            void loadCodes(false);
            showMsg($('codeMsg'), '已更新 ' + code, true);
            toast('激活码已更新', true);
          } catch (e) {
            showMsg($('codeMsg'), e.message, false);
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('codeMsg'), e.message, false);
    }
  }

  async function createCodes() {
    if (!session) return;
    const body = {
      count: Number($('codeCount')?.value) || 1,
      credits: Number($('codeCredits')?.value) || 0,
      maxUses: Number($('codeMaxUses')?.value) || 1,
      prefix: ($('codePrefix')?.value || 'PH').trim(),
      note: ($('codeNote')?.value || '').trim() || undefined,
      membershipTier: $('codeTier')?.value || undefined,
      membershipDays: Number($('codeDays')?.value) || undefined
    };
    if (body.membershipTier === '') delete body.membershipTier;
    if (!body.membershipDays) delete body.membershipDays;
    try {
      const data = await adminFetch(session, '/api/admin/codes', { method: 'POST', body });
      $('codeOutput').textContent = (data.codes || []).join('\n');
      showMsg($('codeMsg'), `已生成 ${data.created} 个码`, true);
      toast(`已生成 ${data.created} 个激活码`, true);
      void loadCodes(true);
      void loadDashboard();
    } catch (e) {
      showMsg($('codeMsg'), e.message, false);
    }
  }

  let imageModelSettings = null;
  let imageModelRows = [];
  let apimartCostReference = [];
  let apimartCostFamilyFilter = 'all';
  let grsaiCostReference = [];
  let grsaiCostFamilyFilter = 'all';
  let modelFamilyFilter = 'all';
  let modelProviderFilter = 'all';
  let modelStatusFilter = 'all';

  const MODEL_UI_FAMILY_LABEL = {
    gim2: '全能2',
    banana: '香蕉',
    jimeng: '即梦',
    midjourney: 'MJ',
    wan: '万相',
    flux: 'Flux'
  };

  const MODEL_PROVIDER_BADGE = {
    grsai: '<span class="admin-badge admin-badge--ok">常规</span>',
    apimart: '<span class="admin-badge admin-badge--warn">备用</span>',
    ithink: '<span class="admin-badge">经济</span>',
    mooko: '<span class="admin-badge">慢速</span>'
  };

  function formatAdminRmbYuan(rmb) {
    const v = Number(rmb);
    if (!Number.isFinite(v) || v <= 0) return '¥0';
    if (v >= 1) return `¥${v.toFixed(2)}`;
    if (v >= 0.1) return `¥${v.toFixed(2)}`;
    return `¥${v.toFixed(3)}`;
  }

  function buildCostReferenceFromModelRows(rows) {
    return rows
      .filter((r) => r.provider === 'apimart' && Array.isArray(r.upstreamCostLines) && r.upstreamCostLines.length)
      .map((r) => ({
        id: r.id,
        label: r.label,
        uiFamily: MODEL_UI_FAMILY_LABEL[r.uiFamily] || r.uiFamily || '—',
        uiFamilyKey: r.uiFamily || 'other',
        functionLabel: r.pricingBySpeed ? '文生图/图生图' : '文生图',
        lines: r.upstreamCostLines
      }));
  }

  function filteredApimartCostReference() {
    if (apimartCostFamilyFilter === 'all') return apimartCostReference;
    return apimartCostReference.filter((row) => row.uiFamilyKey === apimartCostFamilyFilter);
  }

  function filteredGrsaiCostReference() {
    if (grsaiCostFamilyFilter === 'all') return grsaiCostReference;
    return grsaiCostReference.filter((row) => row.uiFamilyKey === grsaiCostFamilyFilter);
  }

  function renderGrsaiCostReference() {
    const tbody = $('grsaiCostTableBody');
    if (!tbody) return;
    const rows = filteredGrsaiCostReference();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">当前筛选无成本数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .flatMap((row) =>
        (row.lines || []).map((line) =>
          `<tr>
            <td>${esc(row.uiFamily)}</td>
            <td><code>${esc(row.id)}</code><br>${esc(row.label)}</td>
            <td>${esc(row.functionLabel)}</td>
            <td>${esc(line.label)}</td>
            <td>${esc(String(line.points))}</td>
            <td><strong>${esc(formatAdminRmbYuan(line.rmb))}</strong></td>
          </tr>`
        )
      )
      .join('');
  }

  function renderApimartCostReference() {
    const tbody = $('apimartCostTableBody');
    if (!tbody) return;
    const rows = filteredApimartCostReference();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5">当前筛选无成本数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .flatMap((row) =>
        (row.lines || []).map((line) =>
          `<tr>
            <td>${esc(row.uiFamily)}</td>
            <td><code>${esc(row.id)}</code><br>${esc(row.label)}</td>
            <td>${esc(row.functionLabel)}</td>
            <td>${esc(line.label)}</td>
            <td><strong>${esc(formatAdminRmbYuan(line.rmb ?? line.creditsCost))}</strong></td>
          </tr>`
        )
      )
      .join('');
  }

  function filteredModelRows() {
    return imageModelRows.filter((row) => {
      if (modelFamilyFilter !== 'all' && row.uiFamily !== modelFamilyFilter) return false;
      if (modelProviderFilter !== 'all' && row.provider !== modelProviderFilter) return false;
      if (modelStatusFilter !== 'all' && row.status !== modelStatusFilter) return false;
      return true;
    });
  }

  function effectiveModelPromo(row, resolution, speed) {
    if (row.fixedPrice) return null;
    if (isMjPricingRow(row)) {
      const s = speed || 'relax';
      const v = row.promoBySpeed?.[s];
      return v != null && v !== '' ? Number(v) : null;
    }
    if (row.pricingByResolution) {
      const res = resolution || (row.resolutions || ['1k'])[0] || '1k';
      const v = row.promoByResolution?.[res];
      return v != null && v !== '' ? Number(v) : null;
    }
    const v = row.promoPrice;
    return v != null && v !== '' ? Number(v) : null;
  }

  function formatAdminCredits(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function isMjPricingRow(row) {
    return row.pricingBySpeed === true || String(row.id || '').startsWith('apimart-mj-');
  }

  function ensureMjCreditsBySpeed(row) {
    if (!isMjPricingRow(row)) return row;
    row.pricingBySpeed = true;
    if (!row.creditsBySpeed || typeof row.creditsBySpeed !== 'object') {
      row.creditsBySpeed = {};
    }
    const flat = Number(row.creditsPerCall);
    for (const speed of ['relax', 'fast', 'turbo']) {
      if (row.creditsBySpeed[speed] == null || row.creditsBySpeed[speed] === '') {
        if (Number.isFinite(flat) && flat > 0) row.creditsBySpeed[speed] = flat;
      }
    }
    return row;
  }

  function syncModelRowsFromDom() {
    const tbody = $('modelsTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-model-id]').forEach((tr) => {
      const row = imageModelRows.find((r) => r.id === tr.dataset.modelId);
      if (!row) return;
      tr.querySelectorAll('input, select').forEach((inp) => {
        const field = inp.dataset.field;
        if (!field) return;
        if (field === 'displayName') row.displayName = inp.value;
        if (field === 'status') row.status = inp.value;
        if (field === 'fixedPrice') row.fixedPrice = inp.checked;
        if (field === 'refundOnViolation') row.refundOnViolation = inp.checked;
        if (field === 'memberCap') {
          const v = inp.value.trim();
          row.memberDiscountCapPercent = v === '' ? null : Number(v) || null;
        }
        if (field === 'sortOrder') row.sortOrder = Number(inp.value) || row.sortOrder;
        if (field === 'promo') row.promoPrice = inp.value.trim() === '' ? null : Number(inp.value) || null;
        if (field === 'credits') row.creditsPerCall = Number(inp.value) || row.creditsPerCall;
        if (field.startsWith('promo-speed-')) {
          const speed = field.slice('promo-speed-'.length);
          if (!row.promoBySpeed) row.promoBySpeed = {};
          const raw = inp.value.trim();
          if (raw === '') delete row.promoBySpeed[speed];
          else {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) row.promoBySpeed[speed] = n;
          }
        }
        if (field.startsWith('promo-') && !field.startsWith('promo-speed-')) {
          const res = field.slice('promo-'.length);
          if (!row.promoByResolution) row.promoByResolution = {};
          const raw = inp.value.trim();
          if (raw === '') delete row.promoByResolution[res];
          else {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) row.promoByResolution[res] = n;
          }
        }
        if (field.startsWith('credits-speed-')) {
          const speed = field.slice('credits-speed-'.length);
          if (!row.creditsBySpeed) row.creditsBySpeed = {};
          const n = Number(inp.value);
          if (Number.isFinite(n) && n > 0) row.creditsBySpeed[speed] = n;
        }
        if (field.startsWith('credits-') && !field.startsWith('credits-speed-')) {
          const res = field.slice('credits-'.length);
          if (!row.creditsByResolution) row.creditsByResolution = {};
          const n = Number(inp.value);
          if (Number.isFinite(n) && n > 0) row.creditsByResolution[res] = n;
        }
      });
      ensureMjCreditsBySpeed(row);
    });
  }

  function renderModelCreditsInputs(row) {
    ensureMjCreditsBySpeed(row);
    if (isMjPricingRow(row)) {
      const speeds = [
        { key: 'relax', label: 'Relax' },
        { key: 'fast', label: 'Fast' },
        { key: 'turbo', label: 'Turbo' }
      ];
      if (!row.creditsBySpeed) row.creditsBySpeed = {};
      return speeds
        .map(
          (s) =>
            `<label class="admin-res-price"><span>${s.label}</span><input type="number" class="admin-input-sm" data-field="credits-speed-${s.key}" min="0.1" max="99999" step="0.1" value="${row.creditsBySpeed[s.key] ?? ''}"></label>`
        )
        .join('');
    }
    if (row.pricingByResolution) {
      const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) =>
        ['1k', '2k', '4k'].includes(r)
      );
      if (!row.creditsByResolution) row.creditsByResolution = {};
      return resList
        .map(
          (res) =>
            `<label class="admin-res-price"><span>${res.toUpperCase()}</span><input type="number" class="admin-input-sm" data-field="credits-${res}" min="0.1" max="99999" step="0.1" value="${row.creditsByResolution[res] ?? ''}"></label>`
        )
        .join('');
    }
    return `<input type="number" class="admin-input-sm" data-field="credits" min="0.1" max="99999" step="0.1" value="${row.creditsPerCall}">`;
  }

  function renderModelPromoInputs(row) {
    ensureMjCreditsBySpeed(row);
    if (isMjPricingRow(row)) {
      const speeds = [
        { key: 'relax', label: 'Relax' },
        { key: 'fast', label: 'Fast' },
        { key: 'turbo', label: 'Turbo' }
      ];
      if (!row.promoBySpeed) row.promoBySpeed = {};
      return speeds
        .map(
          (s) =>
            `<label class="admin-res-price"><span>${s.label}</span><input type="number" class="admin-input-sm" data-field="promo-speed-${s.key}" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoBySpeed[s.key] ?? ''}"></label>`
        )
        .join('');
    }
    if (row.pricingByResolution) {
      const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) =>
        ['1k', '2k', '4k'].includes(r)
      );
      if (!row.promoByResolution) row.promoByResolution = {};
      return resList
        .map(
          (res) =>
            `<label class="admin-res-price"><span>${res.toUpperCase()}</span><input type="number" class="admin-input-sm" data-field="promo-${res}" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoByResolution[res] ?? ''}"></label>`
        )
        .join('');
    }
    return `<input type="number" class="admin-input-sm" data-field="promo" min="0.1" max="99999" step="0.1" placeholder="无" value="${row.promoPrice ?? ''}">`;
  }

  function renderModelEffectiveCell(row) {
    ensureMjCreditsBySpeed(row);
    if (isMjPricingRow(row)) {
      return ['relax', 'fast', 'turbo']
        .map((s) => {
          const promo = effectiveModelPromo(row, '1k', s);
          return promo != null ? `${s} ${formatAdminCredits(promo)}` : `${s} —`;
        })
        .join('<br>');
    }
    if (row.pricingByResolution) {
      const resList = (row.resolutions || ['1k', '2k', '4k']).filter((r) =>
        ['1k', '2k', '4k'].includes(r)
      );
      return resList
        .map((res) => {
          const promo = effectiveModelPromo(row, res);
          return promo != null ? `${res.toUpperCase()} ${formatAdminCredits(promo)}` : `${res.toUpperCase()} —`;
        })
        .join('<br>');
    }
    const promo = effectiveModelPromo(row);
    return promo != null ? formatAdminCredits(promo) : '—';
  }

  const MODEL_STATUS_OPTS = [
    { value: 'active', label: '上架' },
    { value: 'maintenance', label: '维护中' },
    { value: 'offline', label: '下架' }
  ];

  function normalizeModelRow(row, index) {
    const status =
      row.status === 'maintenance' || row.status === 'offline' || row.status === 'active'
        ? row.status
        : row.enabled === false
          ? 'offline'
          : 'active';
    return {
      ...row,
      displayName: row.displayName || row.displayLabel || row.label || '',
      status,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10,
      creditsPerCall: row.creditsPerCall,
      creditsByResolution: row.creditsByResolution || null,
      creditsBySpeed: row.creditsBySpeed || null,
      promoPrice: row.promoPrice != null && row.promoPrice !== '' ? Number(row.promoPrice) : null,
      promoByResolution: row.promoByResolution || null,
      promoBySpeed: row.promoBySpeed || null,
      pricingByResolution: row.pricingByResolution === true,
      pricingBySpeed: isMjPricingRow(row),
      uiFamily: row.uiFamily || 'gim2',
      fixedPrice: row.fixedPrice === true,
      memberDiscountCapPercent:
        row.memberDiscountCapPercent != null && row.memberDiscountCapPercent !== ''
          ? Number(row.memberDiscountCapPercent)
          : null,
      refundOnViolation: row.refundOnViolation !== false
    };
  }

  function sortModelRowsInPlace() {
    imageModelRows.sort(
      (a, b) => a.sortOrder - b.sortOrder || String(a.label).localeCompare(String(b.label), 'zh-CN')
    );
  }

  function moveModelRow(modelId, delta) {
    sortModelRowsInPlace();
    const idx = imageModelRows.findIndex((r) => r.id === modelId);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= imageModelRows.length) return;
    const tmp = imageModelRows[idx].sortOrder;
    imageModelRows[idx].sortOrder = imageModelRows[next].sortOrder;
    imageModelRows[next].sortOrder = tmp;
    sortModelRowsInPlace();
    renderModelsTable();
  }

  function renderUpstreamCostCell(row) {
    if (row.upstreamCostText) {
      return String(row.upstreamCostText)
        .split('\n')
        .map((line) => esc(line))
