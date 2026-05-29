/**
 * Data Safety Enhancement
 * Adds robust data validation, conflict resolution, and recovery mechanisms
 */
(function () {
  console.log('[Safety] Applying data safety enhancements');

  // ========== 1. Data Integrity Checks ==========
  
  function validateDataStructure(data) {
    const errors = [];
    
    if (!data || typeof data !== 'object') {
      errors.push('Invalid data structure');
      return { valid: false, errors };
    }
    
    // Validate cards
    if (!Array.isArray(data.cards)) {
      errors.push('Cards must be an array');
    } else {
      data.cards.forEach((card, index) => {
        if (!card.id) errors.push(`Card ${index} missing id`);
        if (typeof card.prompt !== 'string') errors.push(`Card ${index} invalid prompt`);
      });
    }
    
    // Validate groups
    if (data.customGroups && !Array.isArray(data.customGroups)) {
      errors.push('customGroups must be an array');
    }
    
    // Validate settings
    if (data.settings && typeof data.settings !== 'object') {
      errors.push('settings must be an object');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  window.validateDataStructure = validateDataStructure;

  // ========== 2. Conflict Resolution ==========
  
  function resolveCardConflict(localCard, cloudCard) {
    if (!localCard) return cloudCard;
    if (!cloudCard) return localCard;
    
    const localTime = localCard.updatedAt || localCard.createdAt || 0;
    const cloudTime = cloudCard.updatedAt || cloudCard.createdAt || 0;
    
    // Use the newer version
    if (cloudTime > localTime) {
      // But preserve local image if cloud has none
      if (localCard.image && !cloudCard.image) {
        return { ...cloudCard, image: localCard.image };
      }
      return cloudCard;
    }
    
    return localCard;
  }
  
  function mergeDataSafely(local, cloud) {
    const merged = {
      cards: [],
      customGroups: [...(local.customGroups || []), ...(cloud.customGroups || [])],
      globalFields: [...(local.globalFields || []), ...(cloud.globalFields || [])],
      settings: { ...(cloud.settings || {}), ...(local.settings || {}) }
    };
    
    // Deduplicate groups
    merged.customGroups = [...new Set(merged.customGroups)];
    
    // Merge cards by ID
    const cardMap = new Map();
    
    (local.cards || []).forEach(card => {
      if (card && card.id) {
        cardMap.set(card.id, card);
      }
    });
    
    (cloud.cards || []).forEach(card => {
      if (!card || !card.id) return;
      
      const existing = cardMap.get(card.id);
      if (existing) {
        cardMap.set(card.id, resolveCardConflict(existing, card));
      } else {
        cardMap.set(card.id, card);
      }
    });
    
    merged.cards = Array.from(cardMap.values());
    
    return merged;
  }
  
  window.mergeDataSafely = mergeDataSafely;

  // ========== 3. Automatic Recovery ==========
  
  async function createRecoveryPoint(label) {
    try {
      const data = window.getDataPayload?.();
      if (!data) return false;
      
      const validation = validateDataStructure(data);
      if (!validation.valid) {
        console.warn('[Safety] Invalid data structure:', validation.errors);
        return false;
      }
      
      const key = `ph_recovery_${label}_${Date.now()}`;
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now(),
        label
      }));
      
      // Keep only last 5 recovery points
      cleanupRecoveryPoints();
      
      console.log(`[Safety] Recovery point created: ${label}`);
      return true;
    } catch (e) {
      console.error('[Safety] Failed to create recovery point:', e);
      return false;
    }
  }
  
  function cleanupRecoveryPoints() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ph_recovery_')) {
          keys.push(key);
        }
      }
      
      if (keys.length <= 5) return;
      
      // Sort by timestamp (newest first)
      keys.sort((a, b) => {
        const aTime = parseInt(a.split('_').pop()) || 0;
        const bTime = parseInt(b.split('_').pop()) || 0;
        return bTime - aTime;
      });
      
      // Remove old ones
      keys.slice(5).forEach(key => {
        localStorage.removeItem(key);
      });
    } catch (e) {
      console.warn('[Safety] Cleanup failed:', e);
    }
  }
  
  function listRecoveryPoints() {
    const points = [];
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('ph_recovery_')) continue;
        
        try {
          const data = JSON.parse(localStorage.getItem(key));
          points.push({
            key,
            label: data.label,
            timestamp: data.timestamp,
            date: new Date(data.timestamp).toLocaleString('zh-CN')
          });
        } catch (e) {
          // Skip invalid entries
        }
      }
    } catch (e) {
      console.warn('[Safety] Failed to list recovery points:', e);
    }
    
    return points.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  async function restoreFromRecoveryPoint(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      
      const recovery = JSON.parse(raw);
      const validation = validateDataStructure(recovery.data);
      
      if (!validation.valid) {
        console.error('[Safety] Recovery point data is invalid:', validation.errors);
        return false;
      }
      
      // Create backup before restore
      await createRecoveryPoint('before_restore');
      
      // Apply recovered data
      if (typeof window.applyDataPayload === 'function') {
        window.applyDataPayload(recovery.data);
      }
      
      // Save to storage
      if (typeof window.saveAllData === 'function') {
        await window.saveAllData({ skipCloud: true });
      }
      
      console.log('[Safety] Restored from recovery point:', recovery.label);
      return true;
    } catch (e) {
      console.error('[Safety] Restore failed:', e);
      return false;
    }
  }
  
  window.createRecoveryPoint = createRecoveryPoint;
  window.listRecoveryPoints = listRecoveryPoints;
  window.restoreFromRecoveryPoint = restoreFromRecoveryPoint;

  // ========== 4. Data Corruption Detection ==========
  
  function detectDataCorruption(data) {
    const issues = [];
    
    if (!data || typeof data !== 'object') {
      issues.push({ severity: 'critical', message: 'Data is not an object' });
      return issues;
    }
    
    // Check for duplicate card IDs
    if (Array.isArray(data.cards)) {
      const ids = new Set();
      data.cards.forEach((card, index) => {
        if (!card || !card.id) {
          issues.push({ severity: 'error', message: `Card ${index} has no ID` });
        } else if (ids.has(card.id)) {
          issues.push({ severity: 'error', message: `Duplicate card ID: ${card.id}` });
        } else {
          ids.add(card.id);
        }
      });
    }
    
    // Check for orphaned references
    if (Array.isArray(data.cards)) {
      const groupSet = new Set(data.customGroups || []);
      data.cards.forEach((card, index) => {
        if (card.group && !groupSet.has(card.group)) {
          issues.push({ 
            severity: 'warning', 
            message: `Card ${index} references non-existent group: ${card.group}` 
          });
        }
      });
    }
    
    return issues;
  }
  
  window.detectDataCorruption = detectDataCorruption;

  // ========== 5. Safe Save Wrapper ==========
  
  const originalSaveAllData = window.saveAllData;
  
  if (originalSaveAllData) {
    window.saveAllData = async function (opts) {
      try {
        // Create recovery point before save
        if (!opts?.skipRecovery) {
          await createRecoveryPoint('auto_before_save');
        }
        
        // Validate data before save
        const data = window.getDataPayload?.();
        if (data) {
          const validation = validateDataStructure(data);
          if (!validation.valid) {
            console.error('[Safety] Cannot save invalid data:', validation.errors);
            throw new Error('Data validation failed: ' + validation.errors.join(', '));
          }
          
          const corruption = detectDataCorruption(data);
          const critical = corruption.filter(i => i.severity === 'critical');
          if (critical.length > 0) {
            console.error('[Safety] Critical data corruption detected:', critical);
            throw new Error('Critical data corruption: ' + critical[0].message);
          }
        }
        
        // Proceed with save
        await originalSaveAllData.call(this, opts);
        
      } catch (e) {
        console.error('[Safety] Save failed:', e);
        throw e;
      }
    };
  }

  // ========== 6. Cloud Sync Safety ==========
  
  const originalPushToCloud = window.pushToCloud;
  
  if (originalPushToCloud) {
    window.pushToCloud = async function (opts) {
      try {
        // Create recovery point before cloud sync
        await createRecoveryPoint('before_cloud_push');
        
        // Proceed with cloud push
        return await originalPushToCloud.call(this, opts);
        
      } catch (e) {
        console.error('[Safety] Cloud push failed:', e);
        
        // Try to restore from recovery point
        const points = listRecoveryPoints();
        if (points.length > 0) {
          console.log('[Safety] Recovery points available:', points.length);
        }
        
        throw e;
      }
    };
  }

  // ========== 7. Periodic Health Check ==========
  
  function performHealthCheck() {
    try {
      const data = window.getDataPayload?.();
      if (!data) return;
      
      const validation = validateDataStructure(data);
      const corruption = detectDataCorruption(data);
      
      if (!validation.valid || corruption.some(i => i.severity === 'critical')) {
        console.warn('[Safety] Health check failed');
        console.warn('Validation:', validation);
        console.warn('Corruption:', corruption);
        
        // Create emergency recovery point
        createRecoveryPoint('health_check_failed');
      } else {
        console.log('[Safety] Health check passed');
      }
    } catch (e) {
      console.error('[Safety] Health check error:', e);
    }
  }
  
  // Run health check every 10 minutes
  setInterval(performHealthCheck, 10 * 60 * 1000);
  
  // Run initial health check after 5 seconds
  setTimeout(performHealthCheck, 5000);

  // ========== 8. Export Recovery Tools ==========
  
  window.DataSafety = {
    validateDataStructure,
    mergeDataSafely,
    createRecoveryPoint,
    listRecoveryPoints,
    restoreFromRecoveryPoint,
    detectDataCorruption,
    performHealthCheck
  };
  
  console.log('[Safety] Data safety enhancements loaded');
  console.log('[Safety] Use DataSafety.listRecoveryPoints() to view recovery points');
})();