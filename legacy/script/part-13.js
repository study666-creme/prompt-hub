        } catch (e) { status.textContent = 'Tesseract 失败'; }
      }
      progressBar.style.width = '100%';
      setTimeout(() => { progress.style.display = 'none'; }, 300);
      if (text) {
        document.getElementById('modalOcrText').value = text;
        document.getElementById('modalOcrResult').style.display = 'block';
      } else {
        status.textContent = '未识别到文字';
      }
    }
    function useOcrResult(action) {
      const text = document.getElementById('modalOcrText').value.trim();
      if (!text) return;
      if (action === 'fill') {
        if (floatingPromptActive) {
          document.getElementById('floatingPromptText').value = text;
          document.getElementById('cardPrompt').value = text;
        } else {
          document.getElementById('cardPrompt').value = text;
          document.getElementById('floatingPromptText').value = text;
        }
        closeOcrModal();
        window.FeatureDraft?.syncCardPublishFromPrompt?.(text);
        showToast('文字已填入提示词框');
      }
    }
    const modalDrop = document.getElementById('modalDropArea');
    modalDrop.addEventListener('click', () => document.getElementById('modalFileInput').click());
    modalDrop.addEventListener('dragover', e => { e.preventDefault(); modalDrop.classList.add('dragover'); });
    modalDrop.addEventListener('dragleave', () => modalDrop.classList.remove('dragover'));
    modalDrop.addEventListener('drop', e => { e.preventDefault(); modalDrop.classList.remove('dragover'); handleModalImage(e.dataTransfer.files[0]); });
    document.getElementById('modalFileInput').addEventListener('change', e => handleModalImage(e.target.files[0]));

    function onOcrEngineChange() {
      const engine = document.getElementById('ocrEngineSelect')?.value;
      document.getElementById('ocrApiKeyWrap')?.classList.toggle('hidden', engine !== 'ocrspace');
    }
    window.onOcrEngineChange = onOcrEngineChange;

    function toggleAppSettingsHelp(forceOpen) {
      const section = document.getElementById('appSettingsHelpSection');
      const btn = document.querySelector('.settings-footer-help-btn');
      if (!section) return;
      const open = forceOpen === true ? true : (forceOpen === false ? false : section.classList.contains('hidden'));
      section.classList.toggle('hidden', !open);
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        requestAnimationFrame(() => {
          section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }
    function openAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.add('active');
      const help = document.getElementById('appSettingsHelpSection');
      if (help) help.classList.add('hidden');
      const helpBtn = document.querySelector('.settings-footer-help-btn');
      if (helpBtn) helpBtn.setAttribute('aria-expanded', 'false');
      const autoDay = document.getElementById('autoDayNightToggle');
      if (autoDay) autoDay.checked = settings.autoDayNight === true;
      const eff = document.getElementById('efficiencyModeToggle');
      if (eff) eff.checked = settings.efficiencyMode === true;
      const imgPub = document.getElementById('defaultImageGenAutoPublishToggle');
      if (imgPub) imgPub.checked = settings.defaultImageGenAutoPublish !== false;
      const notifyOn = document.getElementById('communityNotificationsToggle');
      if (notifyOn) notifyOn.checked = settings.communityNotificationsEnabled !== false;
      const notifyBadge = document.getElementById('communityNotifyBadgeToggle');
      if (notifyBadge) notifyBadge.checked = settings.communityNotifyBadge !== false;
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '';
    }
    function closeAppSettings() {
      document.getElementById('appSettingsOverlay')?.classList.remove('active');
    }
    async function saveAppSettings() {
      const autoEl = document.getElementById('autoDayNightToggle');
      const autoOn = autoEl ? autoEl.checked : false;
      const imgPubEl = document.getElementById('defaultImageGenAutoPublishToggle');
      settings.defaultImageGenAutoPublish = imgPubEl ? imgPubEl.checked : true;
      const notifyOnEl = document.getElementById('communityNotificationsToggle');
      settings.communityNotificationsEnabled = notifyOnEl ? notifyOnEl.checked : true;
      const notifyBadgeEl = document.getElementById('communityNotifyBadgeToggle');
      settings.communityNotifyBadge = notifyBadgeEl ? notifyBadgeEl.checked : true;
      const effEl = document.getElementById('efficiencyModeToggle');
      settings.efficiencyMode = effEl ? effEl.checked : false;
      applyEfficiencyMode();
      const wasAuto = settings.autoDayNight === true;
      settings.autoDayNight = autoOn;
      if (autoOn && !wasAuto) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.clearThemeManualOverride?.();
      } else if (autoOn) {
        settings.themeManualOverride = false;
        window.ThemeSchedule?.applyAutoThemeIfNeeded?.();
      }
      await saveAllData();
      if (autoOn !== wasAuto) {
        window.ThemeSchedule?.onAutoDayNightSettingChanged?.(autoOn);
      }
      const status = document.getElementById('appSettingsStatus');
      if (status) status.textContent = '已保存';
      showToast('全局设置已保存');
      window.FeatureDraft?.updateNotifyBadge?.();
      setTimeout(() => { if (status) status.textContent = ''; }, 2000);
    }
    window.toggleAppSettingsHelp = toggleAppSettingsHelp;
    window.openAppSettings = openAppSettings;
    window.closeAppSettings = closeAppSettings;
    window.saveAppSettings = saveAppSettings;

    function updateLocalFileBindingHint() {
      const el = document.getElementById('localFileBindingHint');
      if (!el) return;
      if (!fileHandle) {
        el.hidden = true;
        el.textContent = '';
        return;
      }
      const name = String(fileHandle.name || '未命名.json').trim();
      el.hidden = false;
      el.textContent = `已绑定本地文件：${name}（改卡片会自动写入；刷新页面后需重新「打开本地 JSON」）`;
    }

    function openWarehouseSettings() {
      document.getElementById('settingsOverlay')?.classList.add('active');
      document.getElementById('ocrEngineSelect').value = settings.engine || 'tesseract';
      document.getElementById('ocrApiKey').value = settings.apiKey || '';
      document.getElementById('imageClickZoomToggle').checked = settings.imageClickZoom;
      const autoOcrToggle = document.getElementById('autoPromptOcrToggle');
      if (autoOcrToggle) autoOcrToggle.checked = settings.autoPromptOcr === true;
      updatePanelOcrBoxVisibility();
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      if (pubToggle) pubToggle.checked = settings.defaultPublishCommunity !== false;
      const trimToggle = document.getElementById('showTrimBlackBorderToggle');
      if (trimToggle) trimToggle.checked = settings.showTrimBlackBorderTool === true;
      const origToggle = document.getElementById('preserveOriginalCardImageToggle');
      if (origToggle) origToggle.checked = settings.preserveOriginalCardImage === true;
      updatePanelTrimToolVisibility();
      window.PointsSystem?.updateCreditsUI?.();
      document.getElementById('settingsStatus').textContent = '';
      updateLocalFileBindingHint();
      onOcrEngineChange();
      renderFieldList();
    }
    function closeWarehouseSettings() {
      document.getElementById('settingsOverlay')?.classList.remove('active');
    }
    window.openWarehouseSettings = openWarehouseSettings;
    window.closeWarehouseSettings = closeWarehouseSettings;
    window.openSettings = openWarehouseSettings;
    window.closeSettings = closeWarehouseSettings;

    function saveSettings() {
      settings.engine = document.getElementById('ocrEngineSelect').value;
      settings.apiKey = document.getElementById('ocrApiKey').value.trim();
      settings.imageClickZoom = document.getElementById('imageClickZoomToggle').checked;
      const autoOcrToggle = document.getElementById('autoPromptOcrToggle');
      settings.autoPromptOcr = autoOcrToggle ? autoOcrToggle.checked : false;
      updatePanelOcrBoxVisibility();
      const pubToggle = document.getElementById('defaultPublishCommunityToggle');
      settings.defaultPublishCommunity = pubToggle ? pubToggle.checked : true;
      const trimToggle = document.getElementById('showTrimBlackBorderToggle');
      settings.showTrimBlackBorderTool = trimToggle ? trimToggle.checked : false;
      const origToggle = document.getElementById('preserveOriginalCardImageToggle');
      settings.preserveOriginalCardImage = origToggle ? origToggle.checked : false;
      updatePanelTrimToolVisibility();
      saveAllData();
      const status = document.getElementById('settingsStatus');
      if (status) status.textContent = '设置已保存';
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
      renderCards(true);
      if (!document.getElementById('editPanel')?.classList.contains('hidden') && imageData) void updatePreview();
      showToast('设置已保存');
    }
    window.saveSettings = saveSettings;

    function openExtensionCollectPanel() {
      document.getElementById('extensionCollectOverlay')?.classList.add('active');
    }
    function closeExtensionCollectPanel() {
      document.getElementById('extensionCollectOverlay')?.classList.remove('active');
    }
    function openHelpPanel() {
      openAppSettings();
      toggleAppSettingsHelp(true);
    }
    function closeHelpPanel() {
      document.getElementById('helpOverlay')?.classList.remove('active');
    }
    function openContactPanel() {
      document.getElementById('contactOverlay')?.classList.add('active');
    }
    function closeContactPanel() {
      document.getElementById('contactOverlay')?.classList.remove('active');
    }
    function copyWechatId() {
      const id = document.getElementById('contactWechatId')?.textContent?.trim()
        || document.getElementById('subscribeWechatId')?.textContent?.trim()
        || 'bz4jx3jp2li1';
      navigator.clipboard.writeText(id).then(() => showToast('微信号已复制')).catch(() => showToast('复制失败'));
    }
    function openCommunityPanel() {
      document.getElementById('communityOverlay')?.classList.add('active');
    }
    function closeCommunityPanel() {
      document.getElementById('communityOverlay')?.classList.remove('active');
    }
    function copyCommunityQqId() {
      const id = document.getElementById('communityQqId')?.textContent?.trim() || '222653426';
      navigator.clipboard.writeText(id).then(() => showToast('QQ 群号已复制')).catch(() => showToast('复制失败'));
    }
    window.openExtensionCollectPanel = openExtensionCollectPanel;
    window.closeExtensionCollectPanel = closeExtensionCollectPanel;
    window.openHelpPanel = openHelpPanel;
    window.closeHelpPanel = closeHelpPanel;
    window.openContactPanel = openContactPanel;
    window.closeContactPanel = closeContactPanel;
    window.copyWechatId = copyWechatId;
    window.openCommunityPanel = openCommunityPanel;
    window.closeCommunityPanel = closeCommunityPanel;
    window.copyCommunityQqId = copyCommunityQqId;

    function addGlobalField() {
      const n = document.getElementById('newFieldName').value.trim();
      if (!n) { showToast('请输入字段名称'); return; }
      if (globalFields.some(f => f.name === n)) { showToast('字段名称已存在'); return; }
      globalFields.push({ id: generateId(), name: n, type: document.getElementById('newFieldType').value });
      saveAllData();
      document.getElementById('newFieldName').value = '';
      renderFieldList();
    }
    window.addGlobalField = addGlobalField;

    function renderFieldList() {
      const list = document.getElementById('fieldList');
      const empty = document.getElementById('fieldListEmpty');
      if (!list) return;
      const typeLabel = { text: '文本', textarea: '多行' };
      if (!globalFields.length) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }
      empty?.classList.add('hidden');
      list.innerHTML = globalFields.map(f => `
        <div class="settings-field-item">
          <span class="settings-field-item-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <span class="settings-field-item-type">${typeLabel[f.type] || f.type}</span>
          <button type="button" class="btn btn-ghost settings-field-item-del" onclick="deleteGlobalField('${escapeJsString(f.id)}')">删除</button>
        </div>
      `).join('');
    }

    function deleteGlobalField(id) {
      globalFields = globalFields.filter(f => f.id !== id);
      saveAllData();
      renderFieldList();
    }
    window.deleteGlobalField = deleteGlobalField;
    function backupFileName() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `prompt-hub-backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    }

    function exportBackup() {
      const payload = buildBackupPayload();
      const b = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = backupFileName();
      a.click();
      URL.revokeObjectURL(a.href);
      const status = document.getElementById('settingsStatus');
      if (status) status.textContent = `✅ 已导出 ${payload.cards.length} 张卡片`;
      showToast('备份已下载');
    }
    window.exportBackup = exportBackup;

    function importBackup(event) {
      const f = event.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = e => {
        try {
          const d = JSON.parse(e.target.result);
          if (!Array.isArray(d.cards)) {
            alert('无效的备份文件');
            return;
          }
          const when = d.exportedAt ? new Date(d.exportedAt).toLocaleString() : '未知时间';
          const msg = `将用备份（${when}，${d.cards.length} 张卡片）覆盖当前数据，确定恢复？`;
          if (!confirm(msg)) return;
          if (!applyBackupPayload(d)) {
            alert('恢复失败');
            return;
          }
          saveAllData();
          renderGroups();
          renderCards(true);
          createNewCard();
          const status = document.getElementById('settingsStatus');
          if (status) status.textContent = '✅ 备份已恢复';
          showToast('已恢复备份');
        } catch (err) {
          alert('无法读取备份文件');
        }
      };
      r.readAsText(f);
      event.target.value = '';
    }
    window.importBackup = importBackup;

    async function saveToFile() {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: backupFileName(),
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        fileHandle = h;
        const w = await h.createWritable();
        await w.write(JSON.stringify(buildBackupPayload(), null, 2));
        await w.close();
        updateLocalFileBindingHint();
        document.getElementById('settingsStatus').textContent = '✅ 已绑定本地 JSON 文件';
      } catch (e) {
        if (e.name !== 'AbortError') alert('保存失败');
      }
    }
    window.saveToFile = saveToFile;

    async function loadFromFile() {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        fileHandle = h;
        const f = await h.getFile();
        const d = JSON.parse(await f.text());
        if (!Array.isArray(d.cards)) {
          alert('无效的备份文件');
          return;
        }
        if (!confirm(`从文件恢复 ${d.cards.length} 张卡片，将覆盖当前数据，确定？`)) return;
        applyBackupPayload(d);
        await saveAllData();
        renderGroups();
        renderCards(true);
        createNewCard();
        updateLocalFileBindingHint();
        document.getElementById('settingsStatus').textContent = '✅ 已从本地 JSON 恢复';
      } catch (e) {
        if (e.name !== 'AbortError') alert('打开文件失败');
      }
    }
    window.loadFromFile = loadFromFile;

    function clearAllData() {
      customConfirm('确定清除所有本地卡片、分组与字段？此操作不可恢复，建议先备份导出。', () => {
        cards = [];
        customGroups = [];
        globalFields = [];
        saveAllData();
        renderGroups();
        renderCards(true);
        createNewCard();
        const status = document.getElementById('settingsStatus');
        if (status) status.textContent = '已清除本地数据';
      });
    }
    window.clearAllData = clearAllData;
    
    function escapeHtml(str) { return String(str).replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }
    function escapeJsString(str) { return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, ''); }
    window.escapeHtml = escapeHtml;
    window.escapeJsString = escapeJsString;
    window.batchPublishCommunity = batchPublishCommunity;
    window.batchUnpublishCommunity = batchUnpublishCommunity;
    

