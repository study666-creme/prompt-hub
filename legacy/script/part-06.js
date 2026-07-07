      const submitBtn = document.getElementById('authSubmitBtn');
      const pwdLabel = document.getElementById('authPasswordLabel');
      const methodTabs = document.getElementById('authMethodTabs');

      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authMode === mode);
      });

      tabs?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
      methodTabs?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset' || !window.SupabaseSync?.isPhoneAuthEnabled?.());
      document.getElementById('authEmailPanel')?.classList.remove('hidden');
      document.getElementById('authPhonePanel')?.classList.add('hidden');
      authChannel = 'email';
      document.querySelectorAll('.auth-method-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.authChannel === 'email');
      });
      confirmWrap?.classList.toggle('hidden', mode !== 'register');
      displayNameWrap?.classList.toggle('hidden', mode !== 'register');
      newPwdWrap?.classList.toggle('hidden', mode !== 'reset');
      pwdField?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
      rememberWrap?.classList.toggle('hidden', mode !== 'login');
      forgotLink?.classList.toggle('hidden', mode !== 'login');
      backLink?.classList.toggle('hidden', mode === 'login');
      document.getElementById('authEmailLinks')?.classList.remove('hidden');
      document.getElementById('authSocial')?.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');

      if (mode === 'login') {
        title.textContent = '登录账号';
        desc.textContent = '登录后卡片、分组会同步到云端，换设备也能用。';
        submitBtn.textContent = '登录';
        pwdLabel.textContent = '密码';
        document.getElementById('authPassword')?.setAttribute('autocomplete', 'current-password');
      } else if (mode === 'register') {
        title.textContent = '注册账号';
        desc.textContent = '创建账号后即可在多设备同步你的提示词库。';
        submitBtn.textContent = '注册';
        pwdLabel.textContent = '设置密码';
        document.getElementById('authPassword')?.setAttribute('autocomplete', 'new-password');
      } else if (mode === 'forgot') {
        title.textContent = '找回密码';
        desc.textContent = '输入注册邮箱，我们将发送重置链接（请查收邮件，含垃圾箱）。';
        submitBtn.textContent = '发送重置邮件';
      } else if (mode === 'reset') {
        title.textContent = '设置新密码';
        desc.textContent = '请设置新的登录密码（至少 6 位）。';
        submitBtn.textContent = '更新密码';
        methodTabs?.classList.add('hidden');
        document.getElementById('authSocial')?.classList.add('hidden');
      }
      setAuthStatus('');
    }
    window.switchAuthMode = switchAuthMode;

    function toggleAuthPassword() {
      const input = document.getElementById('authPassword');
      const btn = document.getElementById('authPwdToggle');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      if (btn) btn.textContent = show ? '🙈' : '👁';
    }
    window.toggleAuthPassword = toggleAuthPassword;

    function openAuthModal(mode) {
      if (!window.SupabaseSync?.isConfigured?.()) {
        showToast('请先在 supabase-config.js 填入项目地址和密钥');
        return;
      }
      refreshAuthMethodUI();
      setAuthStatus('');
      setAuthBusy(false);
      authChannel = 'email';
      if (window.location.hash.includes('type=recovery')) {
        switchAuthMode('reset');
      } else {
        switchAuthMode(mode || 'login');
      }
      document.getElementById('authOverlay')?.classList.add('open');
      document.getElementById('authEmail')?.focus();
    }
    function closeAuthModal() {
      document.getElementById('authOverlay')?.classList.remove('open');
      if (window.location.hash.includes('type=recovery')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;

    function setAuthStatus(msg, type) {
      const el = document.getElementById('authStatus');
      if (!el) return;
      el.textContent = msg || '';
      el.className = 'auth-status' + (type ? ' ' + type : '');
    }

    function authErrorMessage(e) {
      if (!e) return '登录失败，请稍后重试';
      if (window.SupabaseSync?.formatAuthError) {
        return window.SupabaseSync.formatAuthError(e);
      }
      return '登录失败，请检查邮箱和密码后重试';
    }

    async function authSignIn() {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value;
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('登录中…');
        localStorage.removeItem('promptrepo_post_logout');
        await window.SupabaseSync.signIn(email, password);
        await completeAuthSession({ silent: false, migrateGuest: true });
        if (!window.SupabaseSync?.isLoggedIn?.()) {
          setAuthStatus('登录未完成，请关闭弹窗后按 Ctrl+F5 强刷再试', 'error');
          return;
        }
        closeAuthModal();
        showToast('登录成功');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function authSignUp() {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value;
      const confirm = document.getElementById('authPasswordConfirm')?.value;
      const nickRaw = document.getElementById('authDisplayName')?.value?.trim() || '';
      if (!email || !password) { setAuthStatus('请填写邮箱和密码', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      if (password.length < 6) { setAuthStatus('密码至少 6 位', 'error'); return; }
      if (password !== confirm) { setAuthStatus('两次输入的密码不一致', 'error'); return; }
      if (nickRaw && !/^[\u4e00-\u9fa5a-zA-Z0-9_\-]{2,20}$/.test(nickRaw)) {
        setAuthStatus('昵称需 2～20 字，仅支持中文、字母、数字、下划线或连字符', 'error');
        return;
      }
      try {
        setAuthBusy(true);
        setAuthStatus('注册中…');
        const data = await window.SupabaseSync.signUp(email, password);
        if (data.session) {
          closeAuthModal();
          await completeAuthSession({ silent: false, migrateGuest: true });
          if (nickRaw && window.PromptHubApi?.setDisplayName) {
            const nr = await window.PromptHubApi.setDisplayName(nickRaw);
            if (!nr.ok) showToast(nr.message || '昵称设置失败，已自动生成昵称');
          }
          showToast('注册成功，已自动登录');
        } else {
          setAuthStatus('注册成功！请查收邮件点击确认链接后再登录（若未开启邮箱验证可直接登录）', 'ok');
          switchAuthMode('login');
        }
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    async function authForgotPassword() {
      const email = document.getElementById('authEmail')?.value?.trim();
      if (!email) { setAuthStatus('请先填写注册邮箱', 'error'); return; }
      if (!isValidEmail(email)) { setAuthStatus('邮箱格式不正确', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('发送中…');
        await window.SupabaseSync.resetPassword(email);
        setAuthStatus('重置邮件已发送，请查收邮箱（含垃圾箱）', 'ok');
      } catch (e) {
        setAuthStatus(
          '暂无法通过邮件重置密码，请联系管理员协助重置（QQ 群或微信客服）',
          'error'
        );
      } finally {
        setAuthBusy(false);
      }
    }

    async function authResetPassword() {
      const pwd = document.getElementById('authNewPassword')?.value;
      if (!pwd || pwd.length < 6) { setAuthStatus('新密码至少 6 位', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('更新中…');
        await window.SupabaseSync.updatePassword(pwd);
        closeAuthModal();
        showToast('密码已更新，请使用新密码登录');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    function startOtpCooldown(seconds) {
      const btn = document.getElementById('authSendOtpBtn');
      if (!btn) return;
      let left = seconds;
      btn.disabled = true;
      btn.textContent = left + 's';
      clearInterval(otpCooldownTimer);
      otpCooldownTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(otpCooldownTimer);
          otpCooldownTimer = null;
          btn.disabled = false;
          btn.textContent = '获取验证码';
        } else {
          btn.textContent = left + 's';
        }
      }, 1000);
    }

    async function authSendPhoneOtp() {
      const phone = document.getElementById('authPhone')?.value?.trim();
      if (!phone) { setAuthStatus('请输入手机号', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('发送中…');
        await window.SupabaseSync.sendPhoneOtp(phone);
        setAuthStatus('验证码已发送，请查收短信', 'ok');
        startOtpCooldown(60);
        document.getElementById('authOtp')?.focus();
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }
    window.authSendPhoneOtp = authSendPhoneOtp;

    async function authPhoneVerify() {
      const phone = document.getElementById('authPhone')?.value?.trim();
      const otp = document.getElementById('authOtp')?.value?.trim();
      if (!phone) { setAuthStatus('请输入手机号', 'error'); return; }
      if (!otp) { setAuthStatus('请输入验证码', 'error'); return; }
      try {
        setAuthBusy(true);
        setAuthStatus('验证中…');
        localStorage.removeItem('promptrepo_post_logout');
        await window.SupabaseSync.verifyPhoneOtp(phone, otp);
        await completeAuthSession({ silent: false, migrateGuest: true });
        if (!window.SupabaseSync?.isLoggedIn?.()) {
          setAuthStatus('登录未完成，请关闭弹窗后按 Ctrl+F5 强刷再试', 'error');
          return;
        }
        closeAuthModal();
        showToast('登录成功');
      } catch (e) {
        setAuthStatus(authErrorMessage(e), 'error');
      } finally {
        setAuthBusy(false);
      }
    }

    function authWeChatLogin() {
      if (window.SupabaseSync?.isWeChatAuthEnabled?.()) {
        const url = window.WECHAT_OAUTH_URL;
        const redirect = encodeURIComponent(window.location.href.split('#')[0]);
        window.location.href = url + (url.includes('?') ? '&' : '?') + 'redirect=' + redirect;
        return;
      }
      setAuthStatus('微信登录需配置开放平台与 OAuth 地址，详见项目 docs/SUPABASE-AUTH.md', 'ok');
    }
    window.authWeChatLogin = authWeChatLogin;

    async function authSubmit() {
      if (authBusy) return;
      if (authChannel === 'phone') {
        await authPhoneVerify();
        return;
      }
      if (authMode === 'login') await authSignIn();
      else if (authMode === 'register') await authSignUp();
      else if (authMode === 'forgot') await authForgotPassword();
      else if (authMode === 'reset') await authResetPassword();
    }
    window.authSubmit = authSubmit;

    async function snapshotLocalForUser(uid, opts = {}) {
      if (!uid) return;
      if (shouldSkipThrottledLocalPayload('snapshot', uid, LOCAL_SNAPSHOT_MIN_INTERVAL_MS, opts)) {
        if (opts.payload) rememberLocalPayloadMeta('snapshot', uid, opts.payload);
        return;
      }
      const payload = opts.payload || getDataPayload();
      const cardN = Array.isArray(payload.cards) ? payload.cards.length : 0;
      const groupN = Array.isArray(payload.customGroups) ? payload.customGroups.length : 0;
      if (!opts.allowEmpty && cardN === 0 && groupN === 0) {
        try {
          const prev = JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null');
          if (Array.isArray(prev?.cards) && prev.cards.length > 0) return;
        } catch (e) { /* ignore */ }
      }
      try {
        localStorage.setItem(userStorageKey('snapshot', uid), JSON.stringify(payload));
        markLocalPayloadWritten('snapshot', uid);
        rememberLocalPayloadMeta('snapshot', uid, payload);
      } catch (e) { /* quota */ }
    }

    function writeAutosavePayloadForUser(uid, payload, opts = {}) {
      if (!uid || !payload) return;
      if (shouldSkipThrottledLocalPayload('autosave', uid, LOCAL_AUTOSAVE_MIN_INTERVAL_MS, opts)) {
        rememberLocalPayloadMeta('autosave', uid, payload);
        return;
      }
      try {
        localStorage.setItem(userStorageKey('autosave', uid), JSON.stringify(payload));
        markLocalPayloadWritten('autosave', uid);
        rememberLocalPayloadMeta('autosave', uid, payload);
      } catch (e) { /* quota */ }
    }

    async function clearIdbObjectStore(storeName) {
      if (!db) await openDB();
      if (!db?.objectStoreNames?.contains(storeName)) return;
      return new Promise((resolve) => {
        const tx = db.transaction([storeName], 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    async function clearWorkspace() {
      cancelCloudSyncSchedulers();
      if (cards.length > 0 || customGroups.length > 0) {
        await writeEmergencyBackup('pre_clear_workspace');
        const uid = window.SupabaseSync?.getUserId?.() || activeAccountId;
        if (uid) await snapshotLocalForUser(uid);
      }
      cards = [];
      customGroups = [];
      globalFields = [];
      selectedCardIds.clear();
      selectedCardId = null;
      window.__promptHubCards = [];
      window.CardImageLoader?.disconnect?.();
      window.FeatureDraft?.clearSensitiveLocalStateOnSignOut?.();
      await saveCardsToDB([], { ownerUid: '' });
      await clearIdbObjectStore('data_backups');
      await clearIdbObjectStore('card_image_backups');
      setIdbOwnerUid('');
      localStorage.removeItem('promptrepo_groups');
      localStorage.removeItem('promptrepo_fields');
      localStorage.removeItem('promptrepo_settings');
      localStorage.removeItem('promptrepo_autosave_snapshot');
      try {
        sessionStorage.removeItem('promptrepo_pending_guest_migrate');
      } catch (e) { /* ignore */ }
    }

    /** 退出后清私人卡片库；社区/创作本地缓存一并清空，由全站 API 重新加载 */
    async function purgeSignedOutLocalData() {
      flushPrivateWarehouseUI();
      await clearWorkspace();
      window.FeatureDraft?.clearAllLocalFeatureData?.();
      window.FeatureDraft?.renderCommunity?.({ immediate: true, skipFeedFetch: true });
      void window.FeatureDraft?.renderCreations?.();
    }

    function flushPrivateWarehouseUI() {
      cards = [];
      customGroups = [];
      globalFields = [];
      selectedCardIds.clear();
      selectedCardId = null;
      isNewCardMode = false;
      window.__promptHubCards = [];
      window.CardImageLoader?.disconnect?.();
      const box = document.getElementById('cardsContainer');
      if (box) {
        box.innerHTML = '<div class="feature-empty" style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--text-muted)"><p>请先登录查看你的卡片库</p><button type="button" class="btn btn-primary" style="margin-top:12px" onclick="openAuthModal(\'login\')">登录</button></div>';
      }
      renderGroups();
      renderWarehouseGridIfNeeded(true);
      window.FeatureDraft?.renderCommunity?.();
    }

    function hadLoggedInAccountLocally() {
      return !!localStorage.getItem('promptrepo_last_uid');
    }

    async function bootstrapWhenLoggedOut() {
      const postLogout = localStorage.getItem('promptrepo_post_logout') === '1';
      window.Membership?.clearLocalState?.();
      window.SubscriptionUI?.refreshOfferUI?.();
      if (postLogout || hadLoggedInAccountLocally()) {
        if (postLogout) localStorage.removeItem('promptrepo_post_logout');
        await purgeSignedOutLocalData();
        cards = [];
        customGroups = [];
        window.__promptHubCards = [];
      } else {
        await loadGuestWorkspace();
        window.FeatureDraft?.reloadStores?.();
        window.FeatureDraft?.scheduleGenJobsSync?.(500);
      }
      window.__promptHubCards = cards;
      renderGroups();
      renderWarehouseGridIfNeeded(true);
      updateGuestLimitUI();
      window.FeatureDraft?.renderCommunity?.();
    }

    function finishAppBootstrap() {
      restoreDesktopCardColumns();
      renderGroups();
      const page = window.AppRouter?.resolveBootApp?.()
        || localStorage.getItem('promptrepo_app_page')
        || 'community';
      switchAppPage(page, { replace: true });
      window.reconcileAuthUI?.();
      if (window.MobileUI.isMobile()) {
        const mobileTab = page === 'community' ? 'community' : page === 'imagegen' ? 'imagegen' : 'cards';
        document.querySelectorAll('.mobile-tab').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.mobileTab === mobileTab);
        });
      }
      if (cards.length > 0) {
        window.FeatureDraft?.reconcileCommunityWithCards?.(cards);
      }
      const refreshFeeds = () => requestFeedRefresh();
      if (window.MobileUI?.isMobile?.() && page !== 'community') {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(refreshFeeds, { timeout: 8000 });
        else setTimeout(refreshFeeds, 2500);
      } else {
        refreshFeeds();
      }
      if (window.SupabaseSync?.isLoggedIn?.()) {
        const runRepair = () => void repairGeneratedCardImagesQuiet();
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(runRepair, { timeout: 12000 });
        } else {
          setTimeout(runRepair, 4000);
        }
      }
    }
    function bindQuickPreviewButtons() {
      document.getElementById('appreciateViewerGenBtn')?.addEventListener('click', () => {
        const card = cards.find((c) => c.id === warehousePreviewCardId);
        if (!card) return;
        markQuickPreviewTask({ warehouseGotoGen: true });
        safeCloseAppreciateViewer();
        safeForceExitGlobalView(true);
        void window.FeatureDraft?.fillCardToImageGen?.(card);
      });
    }
    window.finishAppBootstrap = finishAppBootstrap;

    async function tryRestoreFromEmergencyBackup(uid) {
      if (!uid || !db) await openDB();
      if (!uid || !db?.objectStoreNames?.contains('data_backups')) return false;
      return new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readonly');
        const req = tx.objectStore('data_backups').getAll();
        req.onsuccess = () => {
          const list = (req.result || []).sort((a, b) => (b.at || 0) - (a.at || 0));
          const hit = list.find((row) => {
            if (!row?.payload?.cards?.length) return false;
            if (!/pre_(db_clear|clear_workspace|pull)|auto_save|page_hide/.test(String(row.label || ''))) return false;
            const owner = row.ownerUid || row.payload?.ownerUid || '';
            return owner === uid;
          });
          if (!hit?.payload) {
            resolve(false);
            return;
          }
          applyDataPayload(hit.payload);
          void saveCardsToDB(cards, { ownerUid: uid }).then(() => resolve(true));
        };
        req.onerror = () => resolve(false);
      });
    }

    function groupNamesFromCards(list) {
      const names = new Set();
      const tomb = settings.deletedCustomGroupTombstones || {};
      (list || []).forEach((c) => {
        const g = String(c?.group || '').trim();
        if (g && g !== '未分类' && !tomb[g]) names.add(g);
      });
      return [...names];
    }

    function recordDeletedCustomGroup(name) {
      const g = String(name || '').trim();
      if (!g) return;
      if (!settings.deletedCustomGroupTombstones) settings.deletedCustomGroupTombstones = {};
      settings.deletedCustomGroupTombstones[g] = Date.now();
    }

    function clearDeletedCustomGroup(name) {
      const g = String(name || '').trim();
      if (!g || !settings.deletedCustomGroupTombstones?.[g]) return;
      delete settings.deletedCustomGroupTombstones[g];
    }

    function sanitizeCardGroupsAgainstTombstones(list) {
      if (window.CloudSyncSafety?.sanitizeCardGroupsAgainstTombstones) {
        return window.CloudSyncSafety.sanitizeCardGroupsAgainstTombstones(
          list,
          settings.deletedCustomGroupTombstones
        );
      }
      const tomb = settings.deletedCustomGroupTombstones || {};
      if (!Array.isArray(list) || !Object.keys(tomb).length) return list;
      return list.map((c) => {
        if (!c?.group || !tomb[String(c.group).trim()]) return c;
        return { ...c, group: null };
      });
    }

    function reconcileCustomGroupsFromCards() {
      const tomb = settings.deletedCustomGroupTombstones || {};
      const names = groupNamesFromCards(cardsForActiveWarehouse(filterTombstonedCards(cards)));
      const merged = window.CloudSyncSafety?.mergeCustomGroupsList
        ? window.CloudSyncSafety.mergeCustomGroupsList(customGroups, [], names, tomb)
        : [...new Set([...(customGroups || []), ...names].filter((g) => !tomb[g]))];
      const prev = customGroups || [];
      const changed = merged.length !== prev.length || merged.some((g, i) => g !== prev[i]);
      if (!changed) return false;
      customGroups = merged;
      persistWarehouseGroups(getActiveWarehouseId());
      return true;
    }

    function ensureGroupsFromCards() {
      if (customGroups.length) return reconcileCustomGroupsFromCards();
      const names = groupNamesFromCards(cardsForActiveWarehouse(filterTombstonedCards(cards)));
      if (!names.length) return false;
      return mergeWarehouseGroupsFromList(names);
    }

    async function readEmergencyBackupRows(uid) {
      if (!db) await openDB();
      if (!db?.objectStoreNames?.contains('data_backups')) return [];
      return new Promise((resolve) => {
        const tx = db.transaction(['data_backups'], 'readonly');
        const req = tx.objectStore('data_backups').getAll();
        req.onsuccess = () => {
          const list = (req.result || [])
            .filter((row) => {
              if (!row?.payload?.cards?.length) return false;
              if (!uid) return true;
              const owner = row.ownerUid || row.payload?.ownerUid || '';
              return !owner || owner === uid;
            })
            .sort((a, b) => (b.at || 0) - (a.at || 0))
            .map((row) => ({
              label: row.label,
              at: row.at,
              cards: row.payload.cards.length,
              groups: Array.isArray(row.payload.customGroups) ? row.payload.customGroups.length : 0,
              payload: row.payload
            }));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      });
    }

    async function inspectCardLibraryRecovery() {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || localStorage.getItem('promptrepo_last_uid') || '';
      let autosaveN = 0;
      let snapshotN = 0;
      let autosaveGroups = 0;
      let snapshotGroups = 0;
      try {
        const auto = JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null');
        autosaveN = auto?.cards?.length || 0;
        autosaveGroups = auto?.customGroups?.length || 0;
      } catch (e) { /* ignore */ }
      try {
        const snap = JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null');
        snapshotN = snap?.cards?.length || 0;
        snapshotGroups = snap?.customGroups?.length || 0;
      } catch (e) { /* ignore */ }
      const idbAll = await loadCardsFromDB({ ignoreOwner: true });
      const idbOwned = uid ? await loadCardsFromDB({ ownerUid: uid }) : idbAll;
      const emergency = await readEmergencyBackupRows(uid);
      let cloudN = 0;
      let cloudGroups = 0;
      if (window.SupabaseSync?.isLoggedIn?.()) {
        try {
          const meta = await window.SupabaseSync.pullCloudMeta?.();
          const localUpdated = window.SupabaseSync.getLocalCloudUpdatedAt?.(uid);
          cloudN = meta && localUpdated && meta === localUpdated ? cards.length : -1;
          cloudGroups = customGroups.length;
        } catch (e) { /* ignore */ }
      }
      const tombN = Object.keys(settings.deletedCardTombstones || {}).length;
      const groupsInCards = groupNamesFromCards(cards).length;
      return {
        build: window.__APP_BUILD__,
        uid,
        currentUi: cards.length,
        idbOwned: idbOwned.length,
        idbAll: idbAll.length,
        autosave: autosaveN,
        autosaveGroups,
        snapshot: snapshotN,
        snapshotGroups,
        cloud: cloudN,
        cloudGroups,
        tombstones: tombN,
        groupsInCards,
        customGroupsNow: customGroups.length,
        emergencyBackups: emergency.map((row) => ({
          label: row.label,
          at: new Date(row.at).toLocaleString(),
          cards: row.cards,
          groups: row.groups
        }))
      };
    }

    async function restoreBestCardLibraryBackup(opts = {}) {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || localStorage.getItem('promptrepo_last_uid') || '';
      const currentN = cards.length;
      const candidates = [];
      const pushCandidate = (source, payload) => {
        if (!payload?.cards?.length) return;
        candidates.push({
          source,
          cards: payload.cards.length,
          groups: Array.isArray(payload.customGroups) ? payload.customGroups.length : 0,
          payload
        });
      };
      try {
        pushCandidate('autosave', JSON.parse(localStorage.getItem(userStorageKey('autosave', uid)) || 'null'));
      } catch (e) { /* ignore */ }
      try {
        pushCandidate('snapshot', JSON.parse(localStorage.getItem(userStorageKey('snapshot', uid)) || 'null'));
      } catch (e) { /* ignore */ }
      const idbAll = await loadCardsFromDB({ ignoreOwner: true });
      if (idbAll.length) {
        pushCandidate('indexeddb', { cards: idbAll, customGroups });
      }
      const emergency = await readEmergencyBackupRows(uid);
      emergency.forEach((row) => pushCandidate(`emergency:${row.label}`, row.payload));
      if (!candidates.length) {
        return { ok: false, reason: 'no_backup_found', current: currentN };
      }
      candidates.sort((a, b) => b.cards - a.cards || b.groups - a.groups);
      const best = candidates[0];
      if (!opts.force && best.cards <= currentN) {
        return {
          ok: false,
          reason: 'no_better_backup',
          current: currentN,
          best: { source: best.source, cards: best.cards, groups: best.groups },
          candidates: candidates.slice(0, 6).map((c) => ({ source: c.source, cards: c.cards, groups: c.groups }))
        };
      }
      await writeEmergencyBackup('pre_manual_restore');
      applyDataPayload(best.payload);
      ensureGroupsFromCards();
      window.__promptHubCards = cards;
      await saveAllData({ skipCloud: true });
      renderGroups();
      renderCards(true);
      requestFeedRefresh();
      return {
        ok: true,
        restoredFrom: best.source,
        cards: cards.length,
        groups: customGroups.length,
        previous: currentN
      };
    }

    window.inspectCardLibraryRecovery = inspectCardLibraryRecovery;
    window.restoreBestCardLibraryBackup = restoreBestCardLibraryBackup;

    function cardMetaFromCommunityPosts(cardId) {
      const posts = window.FeatureDraft?.getCommunityPosts?.()
        || (() => {
          try {
            return JSON.parse(localStorage.getItem('promptrepo_community_posts') || '[]');
          } catch (e) {
            return [];
          }
        })();
      const post = (posts || []).find((p) => String(p?.sourceCardId || p?.cardId || '') === String(cardId));
      if (!post) return null;
      return {
        title: post.title || '',
        prompt: post.prompt || post.content || '',
        group: post.group || null,
        tags: Array.isArray(post.tags) ? post.tags.slice() : [],
        image: post.image || post.coverImage || null
      };
    }

    function cardMetaFromCreations(cardId, jobId) {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]');
      } catch (e) { /* ignore */ }
      const byCard = list.find((c) => String(c?.sourceCardId || c?.cardId || c?.id || '') === String(cardId));
      if (byCard) {
        return {
          title: byCard.title || '',
          prompt: byCard.prompt || '',
          group: byCard.group || null,
          tags: Array.isArray(byCard.tags) ? byCard.tags.slice() : [],
          image: byCard.image || null,
          jobId: byCard.jobId || jobId || null
        };
      }
      if (jobId) {
        const byJob = list.find((c) => String(c?.jobId || '') === String(jobId));
        if (byJob) {
          return {
            title: byJob.title || '',
            prompt: byJob.prompt || '',
            group: byJob.group || null,
            tags: Array.isArray(byJob.tags) ? byJob.tags.slice() : [],
            image: byJob.image || null,
            jobId: byJob.jobId || jobId
          };
        }
      }
      return null;
    }

    async function classifyStorageBlob(blob) {
      if (!blob || (blob.size || 0) < 512) return 'missing';
      const ok = await window.SupabaseSync?.blobLooksLikeUsableImage?.(blob);
      return ok ? 'ok' : 'black';
    }

    async function probeCardStoragePaths(cardId, opts = {}) {
      const uid = window.SupabaseSync?.getUserId?.() || activeAccountId || '';
      const hintImage = opts.hintImage || null;
      const paths = new Set();
      if (hintImage && window.SupabaseSync?.isStorageRef?.(hintImage)) {
        window.SupabaseSync.listImagePathCandidates(
          window.SupabaseSync.normalizeImageRef(hintImage),
          cardId,
          uid
        ).forEach((p) => paths.add(p.replace(/^\//, '')));
      }
      const primary = window.SupabaseSync?.cardImageStoragePath?.(cardId, uid);
      const grid = window.SupabaseSync?.gridImageStoragePath?.(cardId, uid);
      if (primary) paths.add(primary.replace(/^\//, ''));
      if (grid) paths.add(grid.replace(/^\//, ''));
      paths.add(`${uid}/generated/${String(cardId).replace(/^wh_/, '')}.jpg`);
      paths.add(`${uid}/generated/${String(cardId).replace(/^wh_/, '')}_grid.jpg`);

      let primaryState = 'missing';
      let gridState = 'missing';
      let primaryPath = null;
      let gridPath = null;
      let primaryBytes = 0;
      let gridBytes = 0;

      for (const p of paths) {
        if (!p || !window.SupabaseSync?.storagePathOwnedByCurrentUser?.(p)) continue;
        const isGrid = /_grid\.(jpe?g|webp|png)$/i.test(p);
        const blob = await window.SupabaseSync?.downloadOwnedStorageBlob?.(p, {
          ignoreMissingCache: true,
          cardId
        });
        const state = await classifyStorageBlob(blob);
        if (isGrid) {
          if (state !== 'missing' && (gridState === 'missing' || state === 'ok')) {
            gridState = state;
            gridPath = p;
            gridBytes = blob?.size || 0;
          }
        } else if (state !== 'missing' && (primaryState === 'missing' || state === 'ok')) {
          primaryState = state;
          primaryPath = p;
          primaryBytes = blob?.size || 0;
        }
      }

      if (primary && primaryState === 'missing') {
        const pb = await window.SupabaseSync?.downloadOwnedStorageBlob?.(primary.replace(/^\//, ''), {
          ignoreMissingCache: true,
          cardId
        });
        primaryState = await classifyStorageBlob(pb);
        if (primaryState !== 'missing') {
          primaryPath = primary.replace(/^\//, '');
          primaryBytes = pb?.size || 0;
        }
      }
      if (grid && gridState === 'missing') {
        const gb = await window.SupabaseSync?.downloadOwnedStorageBlob?.(grid.replace(/^\//, ''), {
          ignoreMissingCache: true,
          cardId
        });
        gridState = await classifyStorageBlob(gb);
        if (gridState !== 'missing') {
          gridPath = grid.replace(/^\//, '');
          gridBytes = gb?.size || 0;
        }
      }

      let verdict = 'missing';
      if (primaryState === 'ok') verdict = 'recoverable_primary';
      else if (gridState === 'ok') verdict = 'recoverable_grid_only';
      else if (primaryState === 'black' || gridState === 'black') verdict = 'black';

      const imageRef = primaryPath
        ? window.SupabaseSync.toStorageRef(primaryPath)
        : (gridPath ? window.SupabaseSync.toStorageRef(gridPath) : null);

      return {
        cardId: String(cardId),
        verdict,
        primaryState,
        gridState,
        primaryPath,
        gridPath,
        primaryBytes,
        gridBytes,
        imageRef
      };
    }

    async function inspectTombstoneStorageRecovery(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        return { ok: false, error: '请先登录' };
      }
      const max = Math.min(500, Math.max(1, Number(opts.max) || 60));
      const delayMs = Math.max(0, Number(opts.delayMs) || 120);
      const uid = window.SupabaseSync.getUserId();
      const tombstones = { ...(settings.deletedCardTombstones || {}) };
      const currentIds = new Set(cards.map((c) => String(c.id)));
      const ids = Object.keys(tombstones).filter((id) => !currentIds.has(String(id)));
      const report = {
        build: window.__APP_BUILD__,
        uid,
        tombstones: ids.length,
        scanned: 0,
        recoverablePrimary: [],
        recoverableGridOnly: [],
        black: [],
        missing: [],
        samples: []
      };
      for (let i = 0; i < Math.min(max, ids.length); i += 1) {
        const id = ids[i];
        try {
          const meta = cardMetaFromCommunityPosts(id) || cardMetaFromCreations(id);
          window.SupabaseSync?.clearPathMissingForCard?.(id, meta?.image || null);
          const probe = await probeCardStoragePaths(id, { hintImage: meta?.image });
          report.scanned += 1;
          const row = {
            id,
            title: (meta?.title || meta?.prompt || id).toString().slice(0, 48),
            prompt: (meta?.prompt || '').toString().slice(0, 120),
            tombAt: tombstones[id] ? new Date(tombstones[id]).toLocaleString() : '',
            ...probe
          };
          if (probe.verdict === 'recoverable_primary') report.recoverablePrimary.push(row);
          else if (probe.verdict === 'recoverable_grid_only') report.recoverableGridOnly.push(row);
          else if (probe.verdict === 'black') report.black.push(row);
          else report.missing.push(row);
          if (i < 8) report.samples.push(row);
          if ((i + 1) % 10 === 0) {
            console.log('[Recovery] tombstone scan progress', i + 1, '/', Math.min(max, ids.length));
          }
        } catch (e) {
          report.missing.push({ id, title: id, verdict: 'error', error: String(e?.message || e) });
        }
        if (delayMs && i < ids.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      report.summary = {
        recoverablePrimary: report.recoverablePrimary.length,
        recoverableGridOnly: report.recoverableGridOnly.length,
        black: report.black.length,
        missing: report.missing.length,
        remaining: Math.max(0, ids.length - report.scanned)
      };
      window.__lastTombScan = report;
      window.__lastTombstoneScan = report;
      console.log('[Recovery] tombstone storage scan done', report.summary, '→ window.__lastTombScan');
      return report;
    }

    async function planApimartRecovery(opts = {}) {
      if (!window.SupabaseSync?.isLoggedIn?.()) {
        return { ok: false, error: '请先登录' };
      }
      const days = Math.min(365, Math.max(1, Number(opts.days) || 90));
      const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
