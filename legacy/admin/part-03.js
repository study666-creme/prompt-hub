    setBucketRiskFilter(communityBucketRisk);
    renderBucketOrphansTable();
    updateCommunityBatchUi();
    updateBucketPaginationUi();
    showMsg($('communityMsg'), '', true);
  }

  async function loadBucketOrphansPage(opts) {
    if (!session) return;
    const forceRefresh = !!(opts && opts.forceRefresh);
    const reset = !opts || opts.reset !== false;
    if (reset) communityOffset = 0;
    setCommunityView(communityView);
    setBucketRiskFilter(communityBucketRisk);

    const tbody = $('communityTableBody');
    if (!tbody) return;
    if (forceRefresh || !communityBucketScanMeta) {
      tbody.innerHTML =
        '<tr class="admin-loading"><td colspan="4">正在扫描 R2（约 1～3 分钟，请保持本页打开）…</td></tr>';
      if (forceRefresh) communityBucketPollStarted = Date.now();
      else if (!communityBucketPollStarted) communityBucketPollStarted = Date.now();
    }

    const riskQ =
      communityBucketRisk && communityBucketRisk !== 'all'
        ? `&risk=${encodeURIComponent(communityBucketRisk)}`
        : '';
    const refreshQ = forceRefresh ? '&refresh=1' : '';
    const timeoutMs = communityBucketScanMeta && !forceRefresh ? 45000 : 180000;

    try {
      const data = await adminFetch(
        session,
        `/api/admin/community/bucket-orphans?limit=${bucketOrphanPageSize()}&offset=${communityOffset}${riskQ}${refreshQ}`,
        { timeoutMs }
      );

      if (data.scanStatus === 'scanning') {
        const waited = Math.max(0, Math.round((Date.now() - communityBucketPollStarted) / 1000));
        tbody.innerHTML = `<tr class="admin-loading"><td colspan="4">正在扫描 R2… 已等待 ${waited}s（完成后自动刷新）</td></tr>`;
        $('communityPageInfo').textContent = '桶内孤儿 · 扫描进行中…';
        stopBucketOrphanPoll();
        communityBucketPollTimer = setTimeout(
          () => void loadBucketOrphansPage({ reset: false, forceRefresh: false }),
          3000
        );
        return;
      }

      stopBucketOrphanPoll();
      communityBucketForceRefresh = false;
      communityBucketPollStarted = 0;

      if (data.scanStatus === 'error') {
        tbody.innerHTML = '';
        $('communityPageInfo').textContent = '桶内孤儿 · 扫描失败';
        showMsg($('communityMsg'), data.scanError || 'R2 孤儿扫描失败，请点「重新扫描」重试', false);
        return;
      }

      renderBucketOrphanPage(data);
    } catch (e) {
      stopBucketOrphanPoll();
      tbody.innerHTML = '';
      $('communityPageInfo').textContent = '桶内孤儿 · 加载失败';
      const msg = String(e?.message || '');
      showMsg(
        $('communityMsg'),
        /请求超时/i.test(msg)
          ? `${msg}。扫描较慢，请点「重新扫描」或稍后再试。`
          : friendlyFetchError(e),
        false
      );
    }
  }

  function renderBucketOrphansTable() {
    const tbody = $('communityTableBody');
    if (!tbody) return;
    if (!communityBucketItems.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="admin-hint">暂无桶内孤儿（首次加载需扫描全桶，约 1～3 分钟）</td></tr>';
      updateBucketOrphanBatchUi();
      return;
    }
    tbody.innerHTML = communityBucketItems
      .map(
        (o) => `<tr>
            <td>${communityThumbCell(o)}</td>
            <td><code class="admin-path" title="${esc(o.path)}">${esc(o.path.length > 42 ? o.path.slice(0, 40) + '…' : o.path)}</code>${o.variantHint ? `<br><span class="admin-hint">${esc(o.variantHint)}</span>` : ''}<br>${bucketOrphanRiskBadge(o)}</td>
            <td>${formatBytes(o.bytes || 0)}</td>
            <td class="admin-actions-cell">${bucketOrphanActionCell(o)}</td>
          </tr>`
      )
      .join('');
    updateBucketOrphanBatchUi();
  }

  function removeBucketOrphanGroups(deletedPaths) {
    communityBucketScanMeta = null;
    void loadBucketOrphansPage({ reset: false, forceRefresh: false });
  }

  async function handleCommunityRowAction(action, id, btn, extra) {
    if (!session || !id || communityRowBusy) return;
    const orphanGroup = action === 'orphan' || action === 'restore-orphan'
      ? communityBucketItems.find((g) => g.id === id)
      : null;
    const orphanPaths = orphanGroup?.paths || (extra ? [extra] : [id]);
    const copy = {
      restore: {
        title: '写回卡片库',
        message: '将该社区帖写回作者云端卡片库？（不会重新发布到社区）',
        progress: `正在写回 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/restore`,
        body: undefined,
        danger: false,
        done: (r) => (r.alreadyExists ? '卡片库已有该卡' : `已写回 · ${r.cardId || id}`)
      },
      unpublish: {
        title: '从社区隐藏',
        message: '仅从社区隐藏该帖？图片与卡片库记录保留。',
        progress: `正在隐藏 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/unpublish`,
        body: undefined,
        danger: false,
        done: () => '已从社区隐藏'
      },
      delete: {
        title: '永久删除',
        message: '永久删除该社区帖，并删除 Storage/R2 中的配图？\n\n不可恢复。',
        progress: `正在删除帖子 ${id.slice(0, 18)}…`,
        path: `/api/admin/community/posts/${encodeURIComponent(id)}/delete`,
        body: { deleteStorage: true },
        danger: true,
        done: (r) => `已删除 · 清图 ${r.storageRemoved || 0} 个`
      },
      orphan: {
        title: '删除孤儿文件',
        message: `删除 ${orphanPaths.length} 个 R2 文件？\n\n${orphanPaths.slice(0, 3).join('\n')}${orphanPaths.length > 3 ? '\n…' : ''}\n\n若缩略图像卡片库里的卡，请勿删。服务端会再次校验引用；仍被引用会拒绝。\n\n不可恢复。`,
        progress: `正在删除 ${orphanPaths.length} 个文件…`,
        path: '/api/admin/community/bucket-orphans/delete',
        body: { paths: orphanPaths },
        paths: orphanPaths,
        danger: true,
        done: (r) => `已删 ${r.removed || 0} 个文件（R2 ${r.r2Removed || 0}）`
      },
      'restore-orphan': {
        title: orphanGroup?.risk === 'relink' ? '修复图片关联' : '写回卡片库',
        message:
          orphanGroup?.recoverHint ||
          '将 R2 文件写回作者卡片库或修复 image 字段（不删图）',
        progress: '正在恢复…',
        path: '/api/admin/community/bucket-orphans/restore-card',
        body: {
          primaryPath: orphanGroup?.path,
          risk: orphanGroup?.risk,
          recoverPostId: orphanGroup?.recoverPostId,
          recoverCardId: orphanGroup?.recoverCardId,
          recoverUserId: orphanGroup?.recoverUserId
        },
        danger: false,
        done: (r) =>
          r.alreadyExists
            ? '卡片库已有该卡，已尝试修复图片指向'
            : r.action === 'relink'
              ? `已修复关联 · ${r.cardId || ''}`
              : `已写回卡片库 · ${r.cardId || ''}`
      }
    };
    const spec = copy[action];
    if (!spec) return;
    try {
      await runCommunityAdminTask({
        btn,
        confirmTitle: spec.title,
        confirmText: spec.message,
        confirmDanger: spec.danger,
        progressText: spec.progress,
        msgEl: $('communityMsg'),
        request: () =>
          adminFetch(session, spec.path, {
            method: 'POST',
            body: spec.body,
            timeoutMs: action === 'orphan' ? 60000 : 120000,
            retries: 1
          }),
        onSuccess: (r) => {
          communitySelected.delete(id);
          if (action === 'orphan') {
            removeBucketOrphanGroups(spec.paths || orphanPaths);
          } else if (action === 'restore-orphan') {
            communityBucketScanMeta = null;
            void loadBucketOrphansPage({ reset: false, forceRefresh: false });
          } else {
            void loadCommunity(false);
          }
          return spec.done(r);
        }
      });
    } catch (e) { /* toast handled */ }
  }

  function setupAdminConfirmModal() {
    if (document.body.dataset.adminConfirmBound === '1') return;
    document.body.dataset.adminConfirmBound = '1';
    $('adminConfirmOkBtn')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeAdminConfirm(true);
    });
    $('adminConfirmCancelBtn')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeAdminConfirm(false);
    });
    document.querySelectorAll('[data-confirm-cancel]').forEach((el) => {
      if (el.id === 'adminConfirmCancelBtn') return;
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeAdminConfirm(false);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirmOpen) closeAdminConfirm(false);
    });
  }

  function setupCommunityPanelActions() {
    const panel = $('panel-community');
    if (!panel || panel.dataset.actionsBound === '1') return;
    panel.dataset.actionsBound = '1';

    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-confirm-cancel]')) {
        closeAdminConfirm(false);
        return;
      }
      if (ev.target.closest('#adminConfirmOkBtn')) {
        closeAdminConfirm(true);
        return;
      }
      if (communityRowBusy) return;
      const restoreBtn = ev.target.closest('[data-restore-post]');
      if (restoreBtn) {
        void handleCommunityRowAction('restore', restoreBtn.getAttribute('data-restore-post'), restoreBtn);
        return;
      }
      const unpublishBtn = ev.target.closest('[data-unpublish-post]');
      if (unpublishBtn) {
        void handleCommunityRowAction('unpublish', unpublishBtn.getAttribute('data-unpublish-post'), unpublishBtn);
        return;
      }
      const deleteBtn = ev.target.closest('[data-delete-post]');
      if (deleteBtn) {
        void handleCommunityRowAction('delete', deleteBtn.getAttribute('data-delete-post'), deleteBtn);
        return;
      }
      const orphanBtn = ev.target.closest('[data-delete-orphan]');
      if (orphanBtn) {
        const groupId = orphanBtn.getAttribute('data-delete-orphan');
        if (groupId) void handleCommunityRowAction('orphan', groupId, orphanBtn);
        return;
      }
      const restoreOrphanBtn = ev.target.closest('[data-restore-orphan]');
      if (restoreOrphanBtn) {
        const groupId = restoreOrphanBtn.getAttribute('data-restore-orphan');
        if (groupId) void handleCommunityRowAction('restore-orphan', groupId, restoreOrphanBtn);
      }
    });

    panel.addEventListener('change', (ev) => {
      const target = ev.target;
      if (target.id === 'communitySelectAll') {
        const pageIds = communityPageItems.map((p) => p.id).filter(Boolean);
        if (target.checked) pageIds.forEach((id) => communitySelected.add(id));
        else pageIds.forEach((id) => communitySelected.delete(id));
        document.querySelectorAll('[data-community-select]').forEach((el) => {
          const id = el.getAttribute('data-community-select');
          if (id && pageIds.includes(id)) el.checked = target.checked;
        });
        updateCommunityBatchUi();
        return;
      }
      if (target.matches('[data-community-select]')) {
        const id = target.getAttribute('data-community-select');
        if (!id) return;
        if (target.checked) communitySelected.add(id);
        else communitySelected.delete(id);
        updateCommunityBatchUi();
      }
    });
  }

  async function loadCommunity(reset) {
    if (!session) return;
    if (reset) communityOffset = 0;
    setCommunityView(communityView);
    const tbody = $('communityTableBody');
    const statsEl = $('communityStats');
    if (!tbody) return;
    const colSpan = communityView === 'bucket-orphans' ? 4 : 9;
    tbody.innerHTML = `<tr class="admin-loading"><td colspan="${colSpan}">${communityView === 'bucket-orphans' ? '正在扫描全桶（约 1～3 分钟，请稍候）…' : '加载中…'}</td></tr>`;
    try {
      if (statsEl) {
        const st = await adminFetch(session, '/api/admin/community/stats');
        statsEl.innerHTML = `
          <div class="admin-stat admin-stat--blue"><span>在线帖</span><strong>${st.publishedCount ?? 0}</strong></div>
          <div class="admin-stat admin-stat--slate"><span>已隐藏（库内）</span><strong>${st.unpublishedCount ?? 0}</strong></div>
          <div class="admin-stat admin-stat--amber"><span>当前视图</span><strong>${communityView === 'bucket-orphans' ? '桶内孤儿' : '在线帖'}</strong></div>`;
      }

      if (communityView === 'bucket-orphans') {
        communityPageItems = [];
        await loadBucketOrphansPage({ reset, forceRefresh: communityBucketForceRefresh });
        return;
      }

      const q = ($('communitySearch')?.value || '').trim();
      const data = await adminFetch(
        session,
        `/api/admin/community/posts?limit=${PAGE}&offset=${communityOffset}${q ? '&q=' + encodeURIComponent(q) : ''}&view=published`
      );
      const items = data.items || [];
      communityPageItems = items;
      const viewLabel = data.view || communityView;
      $('communityPageInfo').textContent = `视图 ${viewLabel} · 第 ${communityOffset + 1}–${communityOffset + items.length} 条，约 ${data.total ?? items.length} 帖`;
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="admin-hint">暂无在线社区帖</td></tr>';
        updateCommunityBatchUi();
        return;
      }
      tbody.innerHTML = items
        .map(
          (p) => `<tr>
          <td class="admin-col-check"><input type="checkbox" data-community-select="${esc(p.id)}"${communitySelected.has(p.id) ? ' checked' : ''} aria-label="选择帖子"></td>
          <td>${communityThumbCell(p)}</td>
          <td>${communityImageStatusCell(p)}</td>
          <td>${esc(p.authorName || '用户')}<br><span class="admin-hint">${esc((p.authorId || '').slice(0, 8))}…</span></td>
          <td title="${esc(p.promptPreview || '')}">${esc((p.promptPreview || '').slice(0, 48))}${(p.promptPreview || '').length > 48 ? '…' : ''}</td>
          <td>${communityCardLibBadge(p)}${p.sourceCardId ? `<br><span class="admin-hint">${esc(String(p.sourceCardId).slice(0, 16))}…</span>` : ''}</td>
          <td>${p.likes ?? 0}</td>
          <td>${esc((p.createdAt || '').slice(0, 10))}</td>
          <td class="admin-actions-cell">
            ${p.cardInLibrary === false ? `<button type="button" class="admin-btn admin-btn--sm" data-restore-post="${esc(p.id)}" title="写回作者云端卡片库">写回</button> ` : ''}
            ${p.published ? `<button type="button" class="admin-btn admin-btn--sm" data-unpublish-post="${esc(p.id)}" title="仅从社区隐藏">隐藏</button> ` : ''}
            <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete-post="${esc(p.id)}" title="删记录并尝试删配图">删除</button>
          </td>
        </tr>`
        )
        .join('');
      updateCommunityBatchUi();
      showMsg($('communityMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      if (communityView === 'bucket-orphans') {
        $('communityPageInfo').textContent = '桶内孤儿 · 加载失败';
      }
      showMsg($('communityMsg'), friendlyFetchError(e), false);
    }
  }

  async function loadUsers(reset) {
    if (!session) return;
    if (reset) userOffset = 0;
    const q = ($('userSearch')?.value || '').trim();
    const tbody = $('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="admin-loading"><td colspan="7">加载中…</td></tr>';
    try {
      const data = await adminFetch(
        session,
        `/api/admin/users?limit=${PAGE}&offset=${userOffset}${q ? '&q=' + encodeURIComponent(q) : ''}`
      );
      $('userPageInfo').textContent = `第 ${userOffset + 1}–${userOffset + data.items.length} 条，约 ${data.total} 用户`;
      if (!data.items.length) {
        tbody.innerHTML = '<tr><td colspan="7">无数据</td></tr>';
        return;
      }
      tbody.innerHTML = data.items
        .map((u) => {
          const sq = u.storageQuota || {};
          const quotaCell = esc(sq.summaryLabel || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`);
          return `<tr>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.displayName || '—')}</td>
            <td>${u.creditsPermanent} + 日${u.dailyCredits}</td>
            <td>${u.membershipActive ? '<span class="admin-badge admin-badge--ok">' + esc(u.membershipTierLabel) + '</span>' : '<span class="admin-badge">免费</span>'}</td>
            <td>${esc(u.storageLabel)}</td>
            <td>${quotaCell}</td>
            <td><button type="button" class="admin-btn admin-btn--primary" data-user-id="${esc(u.userId)}">管理</button></td>
          </tr>`;
        })
        .join('');
      tbody.querySelectorAll('[data-user-id]').forEach((btn) => {
        btn.addEventListener('click', () => void showUserDetail(btn.getAttribute('data-user-id')));
      });
      showMsg($('userMsg'), '', true);
    } catch (e) {
      tbody.innerHTML = '';
      showMsg($('userMsg'), e.message, false);
    }
  }

  async function showUserDetail(userId) {
    const box = $('userModalBody');
    if (!box || !session) return;
    openModal();
    box.innerHTML = '<p class="admin-hint">加载中…</p>';
    try {
      const u = await adminFetch(session, '/api/admin/users/' + encodeURIComponent(userId));
      $('userModalTitle').textContent = u.displayName || u.email || '用户管理';
      const sq = u.storageQuota || {};
      const storageQuotaText = sq.summaryLabel
        || `${sq.usedLabel || u.storageLabel} / ${sq.quotaLabel || '—'}`;
      const reds = (u.recentRedemptions || [])
        .map((r) => `<li>${esc(r.code)} · ${esc(r.redeemed_at || '')}</li>`)
        .join('');
      box.innerHTML = `
        <div class="admin-detail-readonly">
          <dl>
            <dt>邮箱</dt><dd>${esc(u.email || '—')}</dd>
            <dt>昵称</dt><dd>${esc(u.displayName || '—')}</dd>
            <dt>用户 ID</dt><dd><code>${esc(u.userId)}</code></dd>
            <dt>云端卡片数</dt><dd>${u.cardCount ?? 0} 张（不按张数限）</dd>
            <dt>云存储</dt><dd>${esc(storageQuotaText)}</dd>
            <dt>登记字节</dt><dd>${esc(u.storageLabel)}</dd>
            <dt>累计消耗</dt><dd>${u.lifetimeCreditsSpent ?? 0} 积分</dd>
            <dt>云同步</dt><dd>${esc(u.cloudUpdatedAt || '—')}</dd>
          </dl>
          ${reds ? '<p><strong>最近兑换</strong></p><ul>' + reds + '</ul>' : ''}
        </div>
        <h3 style="margin:16px 0 10px;font-size:15px">调整积分 / 会员</h3>
        <div class="admin-form-grid">
          <div class="admin-field" style="margin:0">
            <label for="editCredits">永久积分</label>
            <input type="number" id="editCredits" min="0" step="0.1" value="${Number(u.creditsPermanent) || 0}">
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editDaily">当日积分</label>
            <input type="number" id="editDaily" min="0" step="0.1" value="${Number(u.dailyCredits) || 0}">
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editTier">会员档位</label>
            <select id="editTier">
              <option value="" ${!u.membershipTier ? 'selected' : ''}>免费</option>
              <option value="lite" ${u.membershipTier === 'lite' ? 'selected' : ''}>轻量</option>
              <option value="basic" ${u.membershipTier === 'basic' ? 'selected' : ''}>基础</option>
              <option value="standard" ${u.membershipTier === 'standard' ? 'selected' : ''}>标准</option>
              <option value="pro" ${u.membershipTier === 'pro' ? 'selected' : ''}>专业</option>
            </select>
          </div>
          <div class="admin-field" style="margin:0">
            <label for="editUntil">会员到期</label>
            <input type="datetime-local" id="editUntil" value="${esc(toDatetimeLocal(u.membershipUntil))}">
          </div>
        </div>
        <label class="admin-check" style="margin-top:10px"><input type="checkbox" id="editClearQueue"> 清除排队会员</label>
        <div class="admin-form-actions">
          <button type="button" class="admin-btn admin-btn--primary" id="saveUserBtn">保存修改</button>
          <button type="button" class="admin-btn" id="extend30Btn">会员 +30 天</button>
        </div>
        <h3 style="margin:20px 0 10px;font-size:15px;color:var(--danger)">删除账号</h3>
        <p class="admin-hint">会删除 Auth 账号、数据库资料及 card-images 下该用户文件，不可恢复。</p>
        <div class="admin-field">
          <label for="deleteConfirm">输入邮箱 <strong>${esc(u.email || '')}</strong> 确认删除</label>
          <input type="text" id="deleteConfirm" autocomplete="off" placeholder="完整邮箱">
        </div>
        <button type="button" class="admin-btn admin-btn--danger" id="deleteUserBtn">永久删除此用户</button>
      `;

      $('extend30Btn')?.addEventListener('click', () => {
        const untilInput = $('editUntil');
        const base = untilInput?.value ? new Date(untilInput.value) : new Date();
        if (Number.isNaN(base.getTime())) base.setTime(Date.now());
        base.setDate(base.getDate() + 30);
        if (untilInput) untilInput.value = toDatetimeLocal(base.toISOString());
        const tier = $('editTier');
        if (tier && !tier.value) tier.value = 'basic';
      });

      $('saveUserBtn')?.addEventListener('click', () => void saveUser(u));
      $('deleteUserBtn')?.addEventListener('click', () => void deleteUser(u));
    } catch (e) {
      box.innerHTML = '<p class="admin-msg admin-msg--err">' + esc(friendlyFetchError(e)) + '</p>';
    }
  }

  async function saveUser(u) {
