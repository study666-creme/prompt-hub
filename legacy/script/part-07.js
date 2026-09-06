      const currentIds = new Set(cards.map((c) => String(c.id)));
      const jobIdsInCards = new Set(cards.filter((c) => c?.genJobId).map((c) => String(c.genJobId)));
      const tombstones = settings.deletedCardTombstones || {};

      let creations = [];
      try {
        creations = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]');
      } catch (e) { /* ignore */ }

      let cloudCreations = [];
      /* 恢复扫描勿拉 14MB user_data；本地 creations + API 任务史已够用 */

      let apiJobs = [];
      if (window.PromptHubApi?.listGenerationJobsHistory) {
        try {
          const res = await window.PromptHubApi.listGenerationJobsHistory({ days, limit });
          if (res?.ok && Array.isArray(res.data?.jobs)) apiJobs = res.data.jobs;
        } catch (e) {
          console.warn('[Recovery] jobs history', e);
        }
      }

      const urlRows = [];
      const pushUrl = (row) => {
        if (!row.url) return;
        const key = `${row.jobId || ''}:${row.url}`;
        if (urlRows.some((r) => `${r.jobId || ''}:${r.url}` === key)) return;
        urlRows.push(row);
      };

      for (const job of apiJobs) {
        if (job.status && job.status !== 'completed') continue;
        const urls = [job.imageUrl, ...(job.extraImageUrls || [])].filter(Boolean);
        urls.forEach((url, idx) => {
          pushUrl({
            source: 'api_job',
            jobId: job.id,
            apimartTaskId: job.apimartTaskId || null,
            status: job.status,
            provider: job.provider || null,
            url,
            prompt: (job.prompt || '').slice(0, 120),
            createdAt: job.createdAt,
            variant: idx
          });
        });
      }

      for (const c of [...creations, ...cloudCreations]) {
        if (!c?.image) continue;
        pushUrl({
          source: 'creation',
          jobId: c.jobId || null,
          cardId: c.sourceCardId || c.cardId || c.id,
          url: c.image,
          prompt: (c.prompt || '').slice(0, 120),
          createdAt: c.createdAt || c.updatedAt
        });
      }

      const recoverableUrls = urlRows.filter((row) => {
        const cid = row.cardId ? String(row.cardId) : '';
        const inLib = cid && currentIds.has(cid);
        const jobKnown = row.jobId && jobIdsInCards.has(String(row.jobId));
        return !inLib && !jobKnown;
      });

      const apimartHosts = /apimart\.ai|upload\.apimart|filesystem\.site/i;
      const apimartRows = recoverableUrls.filter((r) => apimartHosts.test(String(r.url)));

      const tombstoneJobHints = apiJobs.filter((j) => {
        const linked = creations.find((c) => String(c.jobId) === String(j.id));
        const cardId = linked?.sourceCardId || linked?.cardId;
        return cardId && tombstones[String(cardId)] && !currentIds.has(String(cardId));
      });

      const result = {
        build: window.__APP_BUILD__,
        days,
        apiJobs: apiJobs.length,
        urlCandidates: urlRows.length,
        recoverableUrls: recoverableUrls.length,
        apimartUrls: apimartRows.length,
        tombstoneJobHints: tombstoneJobHints.length,
        recoverableList: recoverableUrls,
        apimartList: apimartRows,
        apimartSample: apimartRows.slice(0, 12),
        recoverableSample: recoverableUrls.slice(0, 12),
        note: '结果已存 window.__lastApPlan；Storage 恢复用 restoreFromTombstoneStorageScan；Apimart 用 importApimartRecoveryFromPlan'
      };
      window.__lastApPlan = result;
      window.__lastAppPlan = result;
      console.log('[Recovery] apimart plan', {
        recoverableUrls: result.recoverableUrls,
        apimartUrls: result.apimartUrls
      }, '→ window.__lastApPlan');
      return result;
    }

    async function restoreCardsFromRecoveryPlan(entries, opts = {}) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) return { ok: false, reason: 'empty_plan' };
      await writeEmergencyBackup('pre_tombstone_restore');
      let restored = 0;
      let skipped = 0;
      const restoredIds = [];
      for (const entry of list) {
        const id = String(entry.id || entry.cardId || '');
        if (!id) { skipped += 1; continue; }
        if (cards.some((c) => String(c.id) === id)) { skipped += 1; continue; }
        const image = entry.image || entry.imageRef;
        if (!image) { skipped += 1; continue; }
        if (opts.storageOnly !== false && !window.SupabaseSync?.isStorageRef?.(image)) {
          skipped += 1;
          continue;
        }
        clearCardDeletionTombstone(id);
        window.SupabaseSync?.clearPathMissingForCard?.(id, image);
        const meta = entry.meta || cardMetaFromCommunityPosts(id) || cardMetaFromCreations(id, entry.jobId) || {};
        cards.push({
          id,
          title: entry.title || meta.title || (meta.prompt || '').slice(0, 40) || '',
          prompt: entry.prompt || meta.prompt || '',
          image: window.SupabaseSync?.isStorageRef?.(image)
            ? window.SupabaseSync.normalizeImageRef(image)
            : image,
          group: entry.group ?? meta.group ?? null,
          tags: Array.isArray(entry.tags) ? entry.tags : (meta.tags || []),
          customFields: entry.customFields || meta.customFields || {},
          genJobId: entry.jobId || meta.jobId || null,
          createdAt: entry.createdAt || meta.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        restored += 1;
        restoredIds.push(id);
      }
      window.__promptHubCards = cards;
      ensureGroupsFromCards();
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      requestFeedRefresh();
      if (opts.pushCloud === true && window.SupabaseSync?.isLoggedIn?.()) {
        await pushToCloud({ silent: true, skipSafety: false, deferImageUpload: true });
      }
      return { ok: true, restored, skipped, restoredIds, total: cards.length };
    }

    async function restoreFromTombstoneStorageScan(scanReport, opts = {}) {
      const report = scanReport || await inspectTombstoneStorageRecovery(opts);
      const pick = [
        ...(report.recoverablePrimary || []),
        ...(opts.includeGridOnly ? (report.recoverableGridOnly || []) : [])
      ];
      const entries = pick.map((row) => ({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        image: row.imageRef,
        meta: cardMetaFromCommunityPosts(row.id) || cardMetaFromCreations(row.id)
      })).filter((e) => e.image);
      return restoreCardsFromRecoveryPlan(entries, opts);
    }

    async function runFullRecoveryDiagnosis(opts = {}) {
      console.log('[Recovery] 开始完整诊断…（404 为探测缺失路径，属正常）');
      const base = await inspectCardLibraryRecovery();
      const tombScan = await inspectTombstoneStorageRecovery({
        max: opts.tombMax || 60,
        delayMs: opts.delayMs || 120
      });
      const apPlan = await planApimartRecovery({
        days: opts.days || 90,
        limit: opts.limit || 200
      });
      const out = { base, tombScan, apPlan };
      window.__lastRecoveryDiagnosis = out;
      console.table([
        { 项: '当前卡片', 值: base.currentUi },
        { 项: 'tombstones', 值: base.tombstones },
        { 项: 'Storage可救(主图)', 值: tombScan.summary?.recoverablePrimary ?? 0 },
        { 项: 'Storage仅grid', 值: tombScan.summary?.recoverableGridOnly ?? 0 },
        { 项: 'Storage黑图', 值: tombScan.summary?.black ?? 0 },
        { 项: 'Apimart可导入URL', 值: apPlan.recoverableUrls ?? 0 }
      ]);
      return out;
    }

    async function fetchRecoveryImageBlob(url, opts = {}) {
      if (!url) return null;
      const cardId = opts.cardId || opts.jobId || null;
      if (window.SupabaseSync?.isStorageRef?.(url)) {
        const blob = await window.SupabaseSync.downloadCardStorageBlob(
          window.SupabaseSync.normalizeImageRef(url),
          cardId
        );
        if (blob && await window.SupabaseSync.blobLooksLikeUsableImage(blob)) {
          return { blob, resolvedUrl: url };
        }
        return null;
      }
      if (!/^https?:\/\//i.test(url)) return null;
      let blob = null;
      if (window.PromptHubApi?.fetchMediaAsBlobUrl) {
        const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
        if (tmp) {
          try {
            const res = await fetch(tmp);
            if (res.ok) blob = await res.blob();
          } finally {
            try { URL.revokeObjectURL(tmp); } catch (e) { /* ignore */ }
          }
        }
      }
      if (!blob) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) blob = await res.blob();
        } catch (e) { /* ignore */ }
      }
      if (!blob || !(await window.SupabaseSync?.blobLooksLikeUsableImage?.(blob))) return null;
      return { blob, resolvedUrl: url };
    }

    async function resolveRecoveryRowUrl(row) {
      if (!row) return null;
      if (row.jobId && window.PromptHubApi?.getGenerationImageUrl) {
        try {
          const res = await window.PromptHubApi.getGenerationImageUrl(row.jobId);
          if (res?.ok && res.data?.url) return res.data.url;
        } catch (e) { /* ignore */ }
      }
      return row.url || null;
    }

    async function preflightApimartRecovery(plan, opts = {}) {
      const src = plan || window.__lastApPlan || window.__lastRecoveryDiagnosis?.apPlan;
      if (!src) return { ok: false, error: 'no_plan' };
      const rows = (opts.apimartOnly === true
        ? (src.apimartList || [])
        : (src.recoverableList || []))
        .filter((r) => !r.status || r.status === 'completed');
      const max = Math.min(30, Math.max(1, Number(opts.max) || 10));
      const batch = rows.slice(0, max);
      const good = [];
      const bad = [];
      for (const row of batch) {
        const resolved = await resolveRecoveryRowUrl(row);
        const got = await fetchRecoveryImageBlob(resolved, { jobId: row.jobId, cardId: row.cardId });
        if (got) good.push({ ...row, resolvedUrl: got.resolvedUrl });
        else bad.push({ ...row, resolvedUrl: resolved, reason: '404_or_black' });
        await new Promise((r) => setTimeout(r, 200));
      }
      window.__lastApimartPreflight = { good, bad, at: Date.now() };
      console.log('[Recovery] preflight', { good: good.length, bad: bad.length });
      return { ok: true, good, bad };
    }

    async function importApimartRecoveryFromPlan(plan, opts = {}) {
      const src = plan || window.__lastApPlan || window.__lastAppPlan || window.__lastRecoveryDiagnosis?.apPlan;
      if (!src) return { ok: false, error: 'no_plan' };
      let rows = (opts.apimartOnly === true
        ? (src.apimartList || [])
        : (src.recoverableList || src.recoverableSample || []))
        .filter((r) => !r.status || r.status === 'completed');
      if (opts.usePreflight === true && window.__lastApimartPreflight?.good?.length) {
        rows = window.__lastApimartPreflight.good;
      }
      const max = Math.min(30, Math.max(1, Number(opts.max) || 5));
      const batch = rows.slice(0, max);
      if (!batch.length) return { ok: false, error: 'no_rows' };
      const ok = window.confirm(
        `将验证并导入最多 ${batch.length} 张（先拉取图片、跳过 404/黑图，新 ID 不覆盖旧 Storage）。\n继续？`
      );
      if (!ok) return { ok: false, cancelled: true };
      await writeEmergencyBackup('pre_apimart_import');
      let imported = 0;
      let skipped = 0;
      const ids = [];
      const failures = [];
      for (const row of batch) {
        if (!row?.url && !row?.resolvedUrl) { skipped += 1; continue; }
        if (row.jobId && cards.some((c) => String(c.genJobId) === String(row.jobId))) {
          skipped += 1;
          continue;
        }
        try {
          const resolved = row.resolvedUrl || await resolveRecoveryRowUrl(row);
          const got = await fetchRecoveryImageBlob(resolved, { jobId: row.jobId, cardId: row.cardId });
          if (!got) {
            skipped += 1;
            failures.push({ jobId: row.jobId, url: resolved, reason: '404_or_black' });
            continue;
          }
          let imageRef = got.resolvedUrl;
          let presetCardId = null;
          if (window.SupabaseSync?.isLoggedIn?.()) {
            if (row.jobId && window.SupabaseSync.persistGenerationImage) {
              imageRef = await window.SupabaseSync.persistGenerationImage(row.jobId, got.blob);
            } else if (window.SupabaseSync.uploadCardImage) {
              presetCardId = generateId();
              imageRef = await window.SupabaseSync.uploadCardImage(presetCardId, got.blob, { original: false });
            }
          }
          const r = await window.addCardFromGenerated?.({
            cardId: presetCardId || undefined,
            prompt: row.prompt || '',
            image: imageRef,
            jobId: row.jobId || null,
            title: (row.prompt || '').slice(0, 40),
            silentToast: true,
            deferCloudPush: true
          });
          if (r?.ok) {
            imported += 1;
            if (r.cardId) ids.push(r.cardId);
          } else {
            skipped += 1;
            failures.push({ jobId: row.jobId, reason: r?.duplicate ? 'duplicate' : 'add_failed' });
          }
        } catch (e) {
          skipped += 1;
          failures.push({ jobId: row.jobId, reason: String(e?.message || e) });
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      renderGroups();
      renderCards(true);
      if (imported > 0) showToast(`已导入 ${imported} 张（跳过 ${skipped} 张无效/重复）`, 6000);
      return { ok: true, imported, skipped, ids, failures, total: cards.length };
    }

    window.runFullRecoveryDiagnosis = runFullRecoveryDiagnosis;
    window.importApimartRecoveryFromPlan = importApimartRecoveryFromPlan;
    window.preflightApimartRecovery = preflightApimartRecovery;

    /** 服务端一键恢复（推荐）：不经过浏览器拉 Apimart，避免 401/404 */
    async function runServerApimartImport(opts = {}) {
      if (!window.PromptHubApi?.recoverWarehouseFromJobs) {
        showToast('请先 Ctrl+Shift+R 强刷到最新版', 6000);
        return { ok: false, error: 'api_missing' };
      }
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        openAuthModal();
        return { ok: false, error: 'not_logged_in' };
      }
      const mode = opts.mode || 'import';
      const max = Math.min(80, Math.max(1, Number(opts.max) || (mode === 'repair' ? 30 : 20)));
      await writeEmergencyBackup('pre_server_recover');
      const modeLabel =
        mode === 'repair' ? '修复图片' : mode === 'extras' ? '导入多图' : '导入新卡';
      setCloudSyncPhase('syncing', `服务端${modeLabel}中…`);
      showToast(`正在服务端${modeLabel}（最多 ${max} 条）…`, 5000);
      try {
        const providerScope = opts.providerScope || (mode === 'import' ? 'grs' : 'all');
        const recoverBody = { max, mode, providerScope };
        if (opts.offset != null) recoverBody.offset = Math.max(0, Number(opts.offset) || 0);
        if (providerScope === 'apimart') {
          recoverBody.days = Math.min(365, Math.max(1, Number(opts.days) || 7));
        } else if (providerScope === 'grs' || opts.hours != null) {
          recoverBody.hours = Math.min(168, Math.max(1, Number(opts.hours) || 2));
        } else if (opts.days != null) {
          recoverBody.days = Math.min(365, Math.max(1, Number(opts.days)));
        } else if (mode !== 'import') {
          recoverBody.days = 365;
        }
        const res = await window.PromptHubApi.recoverWarehouseFromJobs(recoverBody);
        if (!res?.ok) {
          setCloudSyncPhase('error', res.message || res.code);
          showToast('操作失败：' + (res.message || res.code || '未知错误'), 9000);
          return res;
        }
        const d = res.data || {};
        window.SupabaseSync?.clearSignedUrlCache?.();
        await pullFromCloud();
        window.__promptHubCards = cards;
        renderGroups();
        renderCards(true);
        requestFeedRefresh();
        if (document.getElementById('pageImageGen')?.classList.contains('active')) {
          window.FeatureDraft?.renderImageGenFeed?.({ preserveScroll: true });
        }
        setCloudSyncPhase('saved');
        const msg =
          mode === 'repair'
            ? `已修复 ${d.repaired || 0} 张图片，跳过 ${d.skipped || 0} 张`
            : `已导入 ${d.imported || 0} 张，跳过 ${d.skipped || 0} 张`;
        showToast(
          d.hint
            ? `${msg}。${d.hint}`
            : `${msg}。若侧栏仍打不开，请再点一次该图或强刷`,
          10000
        );
        console.log('[Recovery] server', mode, d);
        return { ok: true, ...d };
      } catch (e) {
        setCloudSyncPhase('error', formatSyncError(e));
        showToast('导入失败：' + formatSyncError(e), 9000);
        return { ok: false, error: formatSyncError(e) };
      }
    }
    window.runServerApimartImport = runServerApimartImport;
    window.inspectTombstoneStorageRecovery = inspectTombstoneStorageRecovery;
    window.planApimartRecovery = planApimartRecovery;
    window.restoreCardsFromRecoveryPlan = restoreCardsFromRecoveryPlan;
    window.restoreFromTombstoneStorageScan = restoreFromTombstoneStorageScan;

    async function resetIdbForAccountSwitch(nextUid) {
      cards = [];
      customGroups = [];
      globalFields = [];
      window.__promptHubCards = [];
      await saveCardsToDB([], { ownerUid: '' });
      await clearIdbObjectStore('data_backups');
      await clearIdbObjectStore('card_image_backups');
      setIdbOwnerUid('');
      if (nextUid) setIdbOwnerUid(nextUid);
    }

    const RECENT_CARD_TOMBSTONE_RESCUE_MS = 72 * 60 * 60 * 1000;

    function tombstoneTimeMs(raw) {
      if (raw == null || raw === '') return 0;
      let n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        if (n < 10_000_000_000) n *= 1000;
        return n;
      }
      n = Date.parse(String(raw));
      return Number.isFinite(n) && n > 0 ? n : 0;
    }

    async function rescueEmptyCardLibraryFromRecentTombstones(uid) {
      if (!uid || cards.length > 0) return false;
      if (!db) await openDB();
      if (!db?.objectStoreNames?.contains('data_backups')) return false;
      const tombstones = settings.deletedCardTombstones || {};
      const now = Date.now();
      const recentIds = new Set(
        Object.entries(tombstones)
          .filter(([, ts]) => {
            const ms = tombstoneTimeMs(ts);
            return ms > 0 && now - ms <= RECENT_CARD_TOMBSTONE_RESCUE_MS;
          })
          .map(([id]) => String(id))
      );
      if (!recentIds.size) return false;

      const rows = await new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readonly');
        const req = tx.objectStore('data_backups').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      const candidates = rows
        .filter((row) => {
          const list = row?.payload?.cards;
          if (!Array.isArray(list) || !list.length) return false;
          if (!/pre_(db_clear|clear_workspace|pull)|auto_save|page_hide/.test(String(row.label || ''))) return false;
          const owner = row.ownerUid || row.payload?.ownerUid || '';
          if (owner && owner !== uid) return false;
          return list.some((card) => card?.id != null && recentIds.has(String(card.id)));
        })
        .sort((a, b) => {
          const ac = Array.isArray(a?.payload?.cards) ? a.payload.cards.length : 0;
          const bc = Array.isArray(b?.payload?.cards) ? b.payload.cards.length : 0;
          return bc - ac || (b.at || 0) - (a.at || 0);
        });
      const hit = candidates[0];
      if (!hit?.payload?.cards?.length) return false;

      const nextTombstones = { ...tombstones };
      let cleared = 0;
      for (const card of hit.payload.cards) {
        if (!card?.id) continue;
        const id = String(card.id);
        if (!recentIds.has(id)) continue;
        delete nextTombstones[id];
        cleared += 1;
      }
      if (!cleared) return false;

      settings.deletedCardTombstones = nextTombstones;
      applyDataPayload({
        ...hit.payload,
        settings: {
          ...(hit.payload.settings || {}),
          deletedCardTombstones: nextTombstones
        }
      });
      if (!cards.length) return false;

      window.__promptHubCards = cards;
      await saveCardsToDB(cards, { ownerUid: uid, forceRewrite: true });
      setIdbOwnerUid(uid);
      try {
        localStorage.setItem('promptrepo_settings', JSON.stringify(settings));
        localStorage.setItem(userStorageKey('settings', uid), JSON.stringify(settings));
      } catch (e) { /* ignore */ }
      const payload = getDataPayload();
      await snapshotLocalForUser(uid, { allowEmpty: true, force: true, payload });
      writeAutosavePayloadForUser(uid, payload, { force: true });
      console.warn('[sync] rescued empty card library from recent tombstones', {
        restored: cards.length,
        cleared,
        backup: hit.label,
        at: hit.at
      });
      if (window.MobileUI?.isMobileViewport?.()) {
        showToast(`已恢复 ${cards.length} 张本机卡片备份`, 6000);
      }
      return true;
    }

    async function restoreAccountPrivateData(uid) {
      if (!uid) return false;
      const tombstones = settings.deletedCardTombstones || {};
      const idbCards = await loadCardsFromDB({ ownerUid: uid });
      let autoPayload = null;
      let snapshotPayload = null;
      try {
        autoPayload = JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null');
      } catch (e) { /* ignore */ }
      if (!autoPayload?.cards?.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem('promptrepo_autosave_snapshot') || 'null');
          const lastUid = localStorage.getItem('promptrepo_last_uid');
          if (legacy?.cards?.length && lastUid === uid) {
            autoPayload = legacy;
            localStorage.setItem(userStorageKey('autosave', uid), JSON.stringify(legacy));
            localStorage.removeItem('promptrepo_autosave_snapshot');
          }
        } catch (e) { /* ignore */ }
      }
      try {
        const raw = localStorage.getItem(userStorageKey('snapshot', uid));
        if (raw) snapshotPayload = JSON.parse(raw);
      } catch (e) { /* ignore */ }

      const mergeLists = window.CloudSyncSafety?.mergeCardsList;
      let mergedCards = idbCards;
      if (mergeLists && autoPayload?.cards?.length) {
        mergedCards = mergeLists(mergedCards, autoPayload.cards, tombstones);
      }
      if (mergeLists && snapshotPayload?.cards?.length) {
        mergedCards = mergeLists(mergedCards, snapshotPayload.cards, tombstones);
      }

      let restored = false;
      if (mergedCards.length > 0) {
        cards = filterTombstonedCards(normalizeCardImages(mergedCards));
        restored = true;
        await saveCardsToDB(cards, { ownerUid: uid });
        setIdbOwnerUid(uid);
      }
      if (!restored) restored = await tryRestoreFromEmergencyBackup(uid);

      const metaPayload = autoPayload?.cards?.length ? autoPayload : snapshotPayload;
      if (metaPayload && typeof metaPayload === 'object') {
        if (Array.isArray(metaPayload.customGroups)) {
          customGroups = window.CloudSyncSafety?.mergeCustomGroupsList
            ? window.CloudSyncSafety.mergeCustomGroupsList(
              [],
              metaPayload.customGroups,
              cards,
              settings.deletedCustomGroupTombstones
            )
            : metaPayload.customGroups.slice();
          persistWarehouseGroups(getActiveWarehouseId());
        } else {
          try {
            loadWarehouseGroups(getActiveWarehouseId());
          } catch (e) { customGroups = []; }
        }
        if (Array.isArray(metaPayload.globalFields) && metaPayload.globalFields.length) {
          globalFields = metaPayload.globalFields;
        }
        if (metaPayload.settings && typeof metaPayload.settings === 'object') {
          settings = Object.assign(settings, metaPayload.settings);
        }
      } else {
        try {
          loadWarehouseGroups(getActiveWarehouseId());
        } catch (e) { customGroups = []; }
      }
      reconcileCustomGroupsFromCards();
      try {
        const f = localStorage.getItem(userStorageKey('fields', uid));
        if (f) globalFields = JSON.parse(f);
      } catch (e) { globalFields = []; }
      try {
        const s = localStorage.getItem(userStorageKey('settings', uid));
        if (s) settings = Object.assign(settings, JSON.parse(s));
      } catch (e) { /* ignore */ }
      if (!cards.length) {
        const rescued = await rescueEmptyCardLibraryFromRecentTombstones(uid);
        if (rescued) restored = true;
      }
      reconcileCustomGroupsFromCards();
      normalizeCardPins();
      window.__promptHubCards = cards;
      window.FeatureDraft?.reloadStores?.();
      window.FeatureDraft?.scheduleGenJobsSync?.(500);
      return restored;
    }

    async function loadLocalSnapshotForUser(uid) {
      const raw = localStorage.getItem(userStorageKey('snapshot', uid));
      if (!raw) return false;
      try {
        const snapshotPayload = JSON.parse(raw);
        const idbCards = await loadCardsFromDB({ ownerUid: uid });
        const tombstones = settings.deletedCardTombstones || {};
        let mergedCards = idbCards;
        if (window.CloudSyncSafety?.mergeCardsList && snapshotPayload?.cards?.length) {
          mergedCards = window.CloudSyncSafety.mergeCardsList(mergedCards, snapshotPayload.cards, tombstones);
        }
        if (!mergedCards.length && !snapshotPayload?.cards?.length) return false;
        applyDataPayload({
          ...snapshotPayload,
          cards: mergedCards.length ? mergedCards : snapshotPayload.cards
        });
        await saveCardsToDB(cards, { ownerUid: uid });
        setIdbOwnerUid(uid);
        return cards.length > 0;
      } catch (e) {
        return false;
      }
    }

    async function authSignOut() {
      try {
        const uid = window.SupabaseSync?.getUserId?.();
        if (uid) await snapshotLocalForUser(uid);
        cancelCloudSyncSchedulers();
        clearTimeout(bgCloudSyncTimer);
        localStorage.setItem('promptrepo_post_logout', '1');
        activeAccountId = null;
        cloudHydratedUid = null;
        window.Membership?.clearLocalState?.();
        window.PointsSystem?.resetServerCreditsState?.();
        window.PointsSystem?.updateCreditsUI?.();
        window.__userDisplayName = '';
        window.SubscriptionUI?.refreshOfferUI?.();
        flushPrivateWarehouseUI();
        window.FeatureDraft?.clearSensitiveLocalStateOnSignOut?.();
        switchAppPage('warehouse');
        await window.SupabaseSync.signOut();
        updateTagFilter();
        buildFilterMenu();
        syncFilterBtnState();
        if (isMobileViewport()) window.resetMobileEditPanelState?.();
        showToast('已退出登录');
      } catch (e) {
        showToast('退出失败');
      }
    }
    window.authSignIn = authSignIn;
    window.authSignUp = authSignUp;
    window.authSignOut = authSignOut;

    document.getElementById('authOverlay')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.getElementById('authOverlay')?.classList.contains('open')) {
        e.preventDefault();
        authSubmit();
      }
    });

    function requestFeedRefresh() {
      if (window.SyncOrchestrator?.requestFeedRefresh) {
        window.SyncOrchestrator.requestFeedRefresh();
        return;
      }
      window.FeatureDraft?.refreshFeedsAfterCardsSync?.();
    }

    function cancelCloudSyncSchedulers() {
      window.SyncOrchestrator?.cancelPending?.();
      clearTimeout(cloudPushTimer);
      cloudPushTimer = null;
    }

    function scheduleCrossDeviceGenRecovery() {
      if (!window.SupabaseSync?.isLoggedIn?.()) return;
      void window.FeatureDraft?.recoverRecentGenerationJobs?.({ crossDevice: true });
    }

    /** 后台 pull：走编排器防抖；需 await 完成时用 runDeferredCloudPull */
    function scheduleDeferredCloudPull(opts = {}) {
      if (window.SyncOrchestrator?.schedulePull) {
        window.SyncOrchestrator.schedulePull({
          immediate: opts.immediate === true,
          light: opts.light === true,
          silent: opts.silent !== false,
          force: opts.force === true
        });
        return;
      }
      void runDeferredCloudPull(opts);
    }
    window.scheduleDeferredCloudPull = scheduleDeferredCloudPull;

    const STALE_LOCAL_ONLY_CARD_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

    function cardTimestampMs(card) {
      for (const raw of [card?.updatedAt, card?.createdAt]) {
        if (raw == null || raw === '') continue;
        let n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
          if (n < 10_000_000_000) n *= 1000;
          return n;
        }
        n = Date.parse(String(raw));
        if (Number.isFinite(n) && n > 0) return n;
      }
      const idMatch = String(card?.id || '').match(/(?:^|_)(\d{12,})(?:_|$)/);
      if (idMatch) {
        const n = Number(idMatch[1].slice(0, 13));
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 0;
    }

    function pruneStaleLocalOnlyCardsAfterCloudPull(localPayload, cloudPayload, payload) {
      // Disabled after mobile reports showed cloud-diff pruning can remove a phone's
      // entire local library when that device holds the only surviving snapshot.
      return { payload, pruned: 0, prunedIds: [] };
      const localCards = Array.isArray(localPayload?.cards) ? localPayload.cards : [];
      const cloudCards = Array.isArray(cloudPayload?.cards) ? cloudPayload.cards : [];
      if (!localCards.length || !cloudCards.length || !Array.isArray(payload?.cards)) {
        return { payload, pruned: 0, prunedIds: [] };
      }
      const cloudIds = new Set(cloudCards.filter((c) => c?.id != null).map((c) => String(c.id)));
      if (!cloudIds.size) return { payload, pruned: 0, prunedIds: [] };
      const localById = new Map(localCards.filter((c) => c?.id != null).map((c) => [String(c.id), c]));
      const nextTombstones = { ...(payload.settings?.deletedCardTombstones || {}) };
      const now = Date.now();
      let pruned = 0;
      const prunedIds = [];
      const nextCards = payload.cards.filter((card) => {
        if (!card?.id) return false;
        const id = String(card.id);
        if (nextTombstones[id]) return false;
        if (cloudIds.has(id)) return true;
        const local = localById.get(id);
        if (!local) return true;
        const ts = cardTimestampMs(local);
        if (!Number.isFinite(ts) || ts <= 0) return true;
        if (now - ts <= STALE_LOCAL_ONLY_CARD_GRACE_MS) return true;
        nextTombstones[id] = now;
        pruned += 1;
        prunedIds.push(id);
        return false;
      });
      if (!pruned) return { payload, pruned: 0, prunedIds: [] };
      return {
        payload: {
          ...payload,
          cards: nextCards,
          settings: {
            ...(payload.settings || {}),
            deletedCardTombstones: nextTombstones
          }
        },
        pruned,
        prunedIds
      };
    }

    async function pullFromCloud(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) return false;
      if (cloudSyncing) await waitForCloudSyncIdle(120000);
      const cloud = await window.SupabaseSync.pullCloudData({
        force: opts?.force === true,
        ifStale: opts?.force !== true
      });
      if (window.SupabaseSync?.wasLastCloudPullSkipped?.()) {
        return 'skipped';
      }
      if (cloud == null || typeof cloud !== 'object') return false;
      const localPayload = getDataPayload();
      await writeEmergencyBackup('pre_pull');

      const cloudBytes = (() => {
        try { return JSON.stringify(cloud).length; } catch (e) { return 0; }
      })();
      let shouldReslimCloud = cloudBytes > 3_500_000
        && !sessionStorage.getItem('ph_cloud_reslim_done');

      const merged = window.CloudSyncSafety?.mergePayload
        ? window.CloudSyncSafety.mergePayload(localPayload, cloud)
        : cloud;
      const pullCheck = window.CloudSyncSafety?.validatePull?.(localPayload, cloud, merged);
      let finalPayload = pullCheck?.payload || merged;
      if (window.CloudSyncSafety?.preferLocalCardsImages) {
        finalPayload = window.CloudSyncSafety.preferLocalCardsImages(localPayload, finalPayload);
      }
      if (pullCheck && pullCheck.allow === false) {
        console.warn('[sync] pull blocked:', pullCheck.reason);
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) await snapshotLocalForUser(uid);
        const preserve = window.CloudSyncSafety?.pullPreserveLocalWarehouse?.(localPayload, finalPayload);
        const localCardN = window.CloudSyncSafety?.cardCount?.(localPayload)
          ?? (Array.isArray(localPayload?.cards) ? localPayload.cards.length : 0);
        if (preserve && localCardN > 0) {
          finalPayload = preserve;
          showToast('已合并云端社区等数据，卡片库保留本机图片（未用云端空图覆盖）', 9000);
        } else {
          const warnKey = 'ph_pull_block_' + uid;
          if (!sessionStorage.getItem(warnKey)) {
            sessionStorage.setItem(warnKey, '1');
            showToast(pullCheck.reason || '为保护本地数据，已跳过云端覆盖', 9000);
          }
          return false;
        }
      }
      const staleLocalOnly = pruneStaleLocalOnlyCardsAfterCloudPull(localPayload, cloud, finalPayload);
      finalPayload = staleLocalOnly.payload;
      if (staleLocalOnly.pruned > 0) {
        shouldReslimCloud = true;
        console.warn('[sync] pruned stale local-only cards after cloud pull', staleLocalOnly.pruned);
        if (window.MobileUI?.isMobileViewport?.()) {
          showToast(`已清理 ${staleLocalOnly.pruned} 张本机旧残留卡片`, 5000);
        }
      }

      if (Array.isArray(finalPayload.cards) && window.SupabaseSync?.getUserId) {
        const uid = window.SupabaseSync.getUserId();
        const needGuess = finalPayload.cards.filter((c) => c?.id && !c?.image).slice(0, 20);
        if (needGuess.length) {
          void (async () => {
            let patched = 0;
            for (const c of needGuess) {
              const guesses = [
                `${uid}/generated/${String(c.id).replace(/^wh_/, '')}.jpg`,
                `${uid}/generated/${String(c.id).replace(/^wh_/, '')}.webp`
              ];
              for (const p of guesses) {
                if (window.SupabaseSync?.isPathKnownMissing?.(p)) continue;
                try {
                  const ref = window.SupabaseSync?.toStorageRef?.(p) || `storage://card-images/${p}`;
                  const ok = await window.SupabaseSync.verifyStorageRef?.(ref, c.id, {
                    quick: true,
                    noDownload: true
                  });
                  if (ok) {
                    c.image = ref;
                    patched += 1;
                    break;
                  }
                } catch (e) { /* ignore */ }
              }
            }
            if (patched > 0) {
              cards = finalPayload.cards;
              window.__promptHubCards = cards;
              await saveAllData({ skipCloud: true });
              refreshWarehouseUI({ softCards: true });
            }
          })();
        }
      }
      if (Array.isArray(finalPayload.cards) && window.CloudSyncSafety?.dedupeWarehouseCards) {
        const beforeDedupe = finalPayload.cards.length;
        finalPayload.cards = window.CloudSyncSafety.dedupeWarehouseCards(finalPayload.cards);
        if (finalPayload.cards.length < beforeDedupe) {
          shouldReslimCloud = true;
        }
      }
      if (Array.isArray(finalPayload.creations)) {
        finalPayload.creations = filterTombstonedCreations(finalPayload.creations);
      }
      applyDataPayload(finalPayload);
      cards = window.FeatureDraft?.reconcileCommunityWithCards?.(cards) || cards;
      window.__promptHubCards = cards;
      window.FeatureDraft?.reconcileCreationsWarehouseLinks?.();
      requestFeedRefresh();
      window.FeatureDraft?.syncPublishToggleForOpenCard?.();
      await saveAllData({
        skipCloud: true,
        forceLocalPayloads: staleLocalOnly.pruned > 0
      });
      if (shouldReslimCloud && typeof pushToCloud === 'function') {
        try { sessionStorage.setItem('ph_cloud_reslim_done', '1'); } catch (e) { /* ignore */ }
        void pushToCloud({ silent: true, skipImageUpload: true, skipSafety: true }).catch((e) => {
          console.warn('[sync] cloud reslim push failed', e);
          try { sessionStorage.removeItem('ph_cloud_reslim_done'); } catch (e2) { /* ignore */ }
        });
      }
      return true;
    }

    async function runDeferredCloudPull(opts = {}) {
      const silent = opts.silent !== false;
      const light = opts.light === true;
      if (cloudSyncing) {
        await waitForCloudSyncIdle(120000);
      }
      if (light && opts?.force !== true && window.SupabaseSync?.pullCloudMeta) {
        try {
          const uid = window.SupabaseSync.getUserId?.();
          const remoteUpdated = uid ? await window.SupabaseSync.pullCloudMeta() : null;
          const localUpdated = uid ? window.SupabaseSync.getLocalCloudUpdatedAt?.(uid) : null;
          if (remoteUpdated && localUpdated && remoteUpdated === localUpdated) {
            lastBgCloudSyncAt = Date.now();
            window.__phLastBgCloudSyncAt = lastBgCloudSyncAt;
            if (!silent) setCloudSyncPhase(cards.length ? 'saved' : 'idle');
            return true;
          }
        } catch (e) { /* fall through to full pull */ }
      }
      setCloudSyncPhase('syncing', light ? '后台同步…' : '正在拉取云端…');
      try {
        const pullWork = pullFromCloud({ force: opts?.force === true });
        const timeoutMs = light ? 45000 : 90000;
        const pulled = await Promise.race([
          pullWork,
          new Promise((resolve) => setTimeout(() => resolve('__pull_timeout__'), timeoutMs))
        ]);
        if (pulled === '__pull_timeout__') {
          console.warn('[sync] pullFromCloud timeout', timeoutMs);
          setCloudSyncPhase('pending', '云端同步较慢，图片仍可从本机加载');
          return false;
        }
        if (pulled === 'skipped') {
          setCloudSyncPhase(cards.length ? 'saved' : 'idle');
          lastBgCloudSyncAt = Date.now();
          window.__phLastBgCloudSyncAt = lastBgCloudSyncAt;
          return true;
        }
        if (pulled === true) {
          const uid = window.SupabaseSync?.getUserId?.();
          if (uid) await snapshotLocalForUser(uid);
          refreshWarehouseUI({ softCards: warehouseUiHasRenderedCards() });
          requestFeedRefresh();
          if (!light) {
            void window.FeatureDraft?.resumePendingGenerationJobs?.().then((changed) => {
              if (changed) requestFeedRefresh();
            });
          }
        }
        setCloudSyncPhase(cards.length ? 'saved' : 'idle');
        lastBgCloudSyncAt = Date.now();
        window.__phLastBgCloudSyncAt = lastBgCloudSyncAt;
        return pulled === true;
      } catch (e) {
        if (!silent) showToast('拉取云端数据失败，已保留本地数据');
        else setCloudSyncPhase('error', '拉取失败，将重试');
        setCloudSyncPhase('error', formatSyncError(e));
        return false;
      }
    }

    function formatSyncError(e) {
      return window.SupabaseSync?.formatError?.(e) || e?.message || '请稍后重试';
    }

    window.pushToCloud = pushToCloud;

    async function pushToCloud(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) return { ok: false, reason: 'not_logged_in' };
      if (cloudSyncing) return { ok: false, busy: true };
      const myRun = ++cloudPushRunId;
      const stillCurrent = () => myRun === cloudPushRunId;
      const silent = opts.silent === true;
      if (silent && opts.skipSafety !== false) opts.skipSafety = true;
      if (silent && opts.strictImageCheck !== true && opts.skipImageUpload !== false) {
        opts.skipImageUpload = true;
      }
      cloudSyncing = true;
      if (!silent) setCloudSyncPhase('syncing', '正在保存到云端');
      const status = document.getElementById('statusMsg');
      const localImages = new Map(cards.map((c) => [String(c.id), c.image]));
      const isMobileNet = isMobileViewport();
      const timeoutMs = silent
        ? (isMobileNet ? 120000 : 70000)
        : (isMobileNet ? 180000 : 90000);
      const work = async () => {
        const payload = getDataPayload();
        const hasBase64 = payload.cards?.some(c => window.SupabaseSync.isDataUrl(c.image));
        const needsImagePass = window.SupabaseSync.payloadNeedsImageUpload?.(payload.cards, {
          includeRemoteHttp: opts.strictImageCheck === true
            || opts.uploadRemoteImages === true
            || !silent
        }) === true;
        if (hasBase64 && status) status.textContent = '正在上传图片到云端…';
        const pushOpts = {
          skipSafety: opts.skipSafety === true,
          allowWithoutCloudCheck: opts.allowWithoutCloudCheck === true,
          strictImageCheck: opts.strictImageCheck === true,
          concurrency: isMobileNet ? 2 : 4
        };
        let metaResult = null;
        try {
          metaResult = await window.SupabaseSync.pushCloudData(payload, {
            ...pushOpts,
            deferImageUpload: true
          });
        } catch (metaErr) {
          console.warn('[cloud] metadata push failed', metaErr);
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        let result = metaResult || { warnings: [] };
        if (silent && !needsImagePass) {
          if (result?.data && window.FeatureDraft?.applyCloudSlice) {
            window.FeatureDraft.applyCloudSlice(result.data);
          }
          if (Array.isArray(payload.cards)) {
            const uploadedById = new Map(payload.cards.map((c) => [String(c.id), c]));
            cards = cards.map((c) => {
              const up = uploadedById.get(String(c.id));
              if (!up) return c;
              const prev = localImages.get(String(c.id)) || c.image;
              if (window.CloudSyncSafety?.mergeCardPair) {
                return window.CloudSyncSafety.mergeCardPair({ ...c, image: prev }, up);
              }
              if (prev && !up.image) return { ...c, image: prev };
              return { ...c, ...up, image: up.image || prev || c.image };
            });
          }
          await saveAllData({ skipCloud: true });
          return result;
        }
        if (opts.skipImageUpload === true) {
          if (result?.data && window.FeatureDraft?.applyCloudSlice) {
            window.FeatureDraft.applyCloudSlice(result.data);
          }
          await saveAllData({ skipCloud: true });
          return result;
        }
        try {
          result = await window.SupabaseSync.pushCloudData(payload, pushOpts);
        } catch (imgErr) {
          console.warn('[cloud] image upload pass failed', imgErr);
          scheduleCloudPush({ urgent: true });
          if (!metaResult) throw imgErr;
          result = {
            warnings: ['图片仍在后台上传，请保持联网；其他设备可先看到卡片信息'],
            data: metaResult.data
          };
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (result?.data && window.FeatureDraft?.applyCloudSlice) {
          window.FeatureDraft.applyCloudSlice(result.data);
        }
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (Array.isArray(payload.cards)) {
          const uploadedById = new Map(payload.cards.map((c) => [String(c.id), c]));
          cards = cards.map((c) => {
            const up = uploadedById.get(String(c.id));
            if (!up) return c;
            const prev = localImages.get(String(c.id)) || c.image;
            if (window.CloudSyncSafety?.mergeCardPair) {
              return window.CloudSyncSafety.mergeCardPair({ ...c, image: prev }, up);
            }
            if (prev && !up.image) return { ...c, image: prev };
            return { ...c, ...up, image: up.image || prev || c.image };
          });
        }
        await saveAllData({ skipCloud: true });
        return result;
      };
      try {
        const result = await Promise.race([
          work(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('云端上传超时，已保留在本机')), timeoutMs);
          })
        ]);
        if (!stillCurrent()) return { ok: false, cancelled: true };
        if (result?.cancelled) return { ok: false, cancelled: true };
        if (result?.warnings?.length) {
          console.warn('[cloud] image warnings', result.warnings);
          if (silent) {
            setCloudSyncPhase('saved');
          } else {
            const msg = result.warnings[0].includes('后台上传')
              ? result.warnings[0]
