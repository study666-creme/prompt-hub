/**
 * Performance Optimization Patch
 * Optimizes card loading speed and data safety
 */
(function () {
  console.log('[Perf] Applying performance optimizations');

  // ========== 1. Virtual Scrolling for Cards ==========
  
  const CARD_BATCH_SIZE = 20;
  let visibleCardRange = { start: 0, end: CARD_BATCH_SIZE };
  
  function setupVirtualScrolling() {
    const container = document.getElementById('cardsContainer');
    if (!container) return;
    
    let scrollTimer = null;
    container.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        updateVisibleCards();
      }, 150);
    }, { passive: true });
  }
  
  function updateVisibleCards() {
    const container = document.getElementById('cardsContainer');
    if (!container) return;
    
    const cards = container.querySelectorAll('.card');
    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + container.clientHeight;
    
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const cardTop = rect.top + viewportTop;
      const cardBottom = cardTop + rect.height;
      
      const isVisible = cardBottom >= viewportTop - 500 && cardTop <= viewportBottom + 500;
      
      if (isVisible) {
        card.classList.remove('card-offscreen');
        const img = card.querySelector('img[data-image-ref]');
        if (img && !img.dataset.loaded) {
          loadCardImage(img);
        }
      } else {
        card.classList.add('card-offscreen');
      }
    });
  }
  
  async function loadCardImage(img) {
    if (!img || img.dataset.loaded) return;
    img.dataset.loaded = '1';
    
    const ref = img.getAttribute('data-image-ref');
    if (!ref) return;
    
    if (window.SupabaseSync?.resolveDisplayUrl) {
      try {
        const url = await window.SupabaseSync.resolveDisplayUrl(ref);
        if (url && url.startsWith('http')) {
          img.src = url;
        }
      } catch (e) {
        console.warn('[Perf] Image load failed', e);
      }
    }
  }

  // ========== 2. Debounced Masonry Layout ==========
  
  let layoutDebounceTimer = null;
  const originalLayoutMasonry = window.layoutMasonryGrid;
  
  if (originalLayoutMasonry) {
    window.layoutMasonryGrid = function () {
      clearTimeout(layoutDebounceTimer);
      layoutDebounceTimer = setTimeout(() => {
        originalLayoutMasonry.call(this);
      }, 100);
    };
  }

  // ========== 3. IndexedDB Backup Enhancement ==========
  
  const BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  let lastBackupTime = 0;
  
  async function autoBackup() {
    const now = Date.now();
    if (now - lastBackupTime < BACKUP_INTERVAL) return;
    
    try {
      if (typeof window.writeEmergencyBackup === 'function') {
        await window.writeEmergencyBackup('auto_' + now);
        lastBackupTime = now;
        console.log('[Perf] Auto backup completed');
      }
    } catch (e) {
      console.warn('[Perf] Auto backup failed', e);
    }
  }
  
  // Trigger backup on significant changes
  const originalSaveAllData = window.saveAllData;
  if (originalSaveAllData) {
    window.saveAllData = async function (opts) {
      await originalSaveAllData.call(this, opts);
      setTimeout(() => autoBackup(), 1000);
    };
  }

  // ========== 4. Data Validation ==========
  
  function validateCard(card) {
    if (!card || typeof card !== 'object') return false;
    if (!card.id) return false;
    if (typeof card.prompt !== 'string') return false;
    return true;
  }
  
  function sanitizeCards(cards) {
    if (!Array.isArray(cards)) return [];
    return cards.filter(validateCard).map(card => ({
      ...card,
      id: String(card.id),
      prompt: String(card.prompt || ''),
      title: String(card.title || ''),
      tags: Array.isArray(card.tags) ? card.tags : [],
      customFields: typeof card.customFields === 'object' ? card.customFields : {}
    }));
  }
  
  window.sanitizeCards = sanitizeCards;

  // ========== 5. Image Preloading Strategy ==========
  
  const imagePreloadQueue = [];
  let preloadingActive = false;
  
  function queueImagePreload(imageRef) {
    if (!imageRef || imagePreloadQueue.includes(imageRef)) return;
    imagePreloadQueue.push(imageRef);
    processPreloadQueue();
  }
  
  async function processPreloadQueue() {
    if (preloadingActive || !imagePreloadQueue.length) return;
    preloadingActive = true;
    
    const batch = imagePreloadQueue.splice(0, 5);
    
    await Promise.all(batch.map(async (ref) => {
      try {
        if (window.SupabaseSync?.resolveDisplayUrl) {
          await window.SupabaseSync.resolveDisplayUrl(ref);
        }
      } catch (e) {
        // Ignore errors
      }
    }));
    
    preloadingActive = false;
    
    if (imagePreloadQueue.length > 0) {
      setTimeout(() => processPreloadQueue(), 100);
    }
  }
  
  window.queueImagePreload = queueImagePreload;

  // ========== 6. Memory Management ==========
  
  function cleanupOldBackups() {
    const MAX_BACKUPS = 10;
    const db = window.db;
    if (!db) return;
    
    try {
      const tx = db.transaction(['data_backups'], 'readwrite');
      const store = tx.objectStore('data_backups');
      const req = store.getAll();
      
      req.onsuccess = () => {
        const backups = req.result || [];
        if (backups.length <= MAX_BACKUPS) return;
        
        backups.sort((a, b) => (b.at || 0) - (a.at || 0));
        const toDelete = backups.slice(MAX_BACKUPS);
        
        toDelete.forEach(backup => {
          store.delete(backup.id);
        });
        
        console.log(`[Perf] Cleaned up ${toDelete.length} old backups`);
      };
    } catch (e) {
      console.warn('[Perf] Backup cleanup failed', e);
    }
  }
  
  // Run cleanup on startup
  setTimeout(() => cleanupOldBackups(), 5000);

  // ========== 7. Cloud Sync Optimization ==========
  
  let syncQueue = [];
  let syncInProgress = false;
  
  function queueCloudSync() {
    if (!window.SupabaseSync?.isLoggedIn?.()) return;
    
    syncQueue.push(Date.now());
    processSyncQueue();
  }
  
  async function processSyncQueue() {
    if (syncInProgress || syncQueue.length === 0) return;
    
    syncInProgress = true;
    syncQueue = [];
    
    try {
      if (typeof window.pushToCloud === 'function') {
        await window.pushToCloud({ skipSafety: false });
        console.log('[Perf] Cloud sync completed');
      }
    } catch (e) {
      console.warn('[Perf] Cloud sync failed', e);
    } finally {
      syncInProgress = false;
      
      if (syncQueue.length > 0) {
        setTimeout(() => processSyncQueue(), 2000);
      }
    }
  }
  
  window.queueCloudSync = queueCloudSync;

  // ========== 8. Initialize Optimizations ==========
  
  function init() {
    setupVirtualScrolling();
    
    // Preload visible card images
    setTimeout(() => {
      const container = document.getElementById('cardsContainer');
      if (container) {
        const imgs = container.querySelectorAll('img[data-image-ref]');
        imgs.forEach((img, index) => {
          if (index < 10) {
            const ref = img.getAttribute('data-image-ref');
            if (ref) queueImagePreload(ref);
          }
        });
      }
    }, 1000);
    
    // Periodic cleanup
    setInterval(() => cleanupOldBackups(), 30 * 60 * 1000);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  console.log('[Perf] Performance optimizations loaded');
})();