/**
 * Community Layout Hotfix - 2025-01-20
 * Fixes:
 * 1. Community sidebar details blank
 * 2. Community Masonry gaps
 * 3. Card library first screen loading order
 */
(function () {
  console.log("[Hotfix] Community layout hotfix loading...");

  function fixCommunitySideBodyCSS() {
    const style = document.createElement("style");
    style.id = "hotfix-community-side-body";
    style.textContent = `
      .community-side-body {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
      }
      
      .community-side-img-btn.is-loading {
        background: var(--bg-hover) !important;
        min-height: 120px !important;
        max-height: min(40vh, 280px) !important;
      }
      
      .community-side-img-btn.is-loading .community-side-img {
        opacity: 0.3 !important;
        visibility: visible !important;
      }
      
      .community-side-prompt,
      .community-side-author,
      .community-side-stats,
      .community-side-actions {
        flex-shrink: 0 !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      
      .community-side-img-btn {
        flex-shrink: 0 !important;
        display: block !important;
        width: fit-content !important;
        max-width: 100% !important;
        margin: 0 auto 12px !important;
      }
    `;
    
    const old = document.getElementById("hotfix-community-side-body");
    if (old) old.remove();
    
    document.head.appendChild(style);
    console.log("[Hotfix] Sidebar CSS fix applied");
  }
  
  function patchFinishCardMediaShine() {
    if (typeof window.finishCardMediaShine !== "function") {
      console.warn("[Hotfix] finishCardMediaShine not found");
      return;
    }
    
    const original = window.finishCardMediaShine;
    window.finishCardMediaShine = function (media) {
      original.call(this, media);
      
      if (media && media.classList && media.classList.contains("community-side-img-btn")) {
        media.classList.remove("is-loading");
        media.classList.add("media-revealed");
      }
    };
    
    console.log("[Hotfix] finishCardMediaShine patched");
  }
  
  function watchCommunitySidePanel() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          const panel = mutation.target;
          if (panel.id === "communitySidePanel" && !panel.classList.contains("hidden")) {
            setTimeout(() => {
              const body = document.getElementById("communitySideBody");
              if (body && body.innerHTML.trim()) {
                body.style.opacity = "1";
                body.style.visibility = "visible";
                body.style.display = "flex";
                
                const imgBtn = body.querySelector(".community-side-img-btn");
                if (imgBtn) {
                  imgBtn.style.display = "block";
                  imgBtn.style.visibility = "visible";
                }
                
                console.log("[Hotfix] Sidebar content visibility fixed");
              }
            }, 100);
          }
        }
      });
    });
    
    const panel = document.getElementById("communitySidePanel");
    if (panel) {
      observer.observe(panel, { attributes: true });
      console.log("[Hotfix] Sidebar observer started");
    }
  }

  function patchCommunityMasonryConfig() {
    if (typeof window.layoutCommunityMasonry !== "function") {
      console.warn("[Hotfix] layoutCommunityMasonry not found");
      return;
    }
    
    const original = window.layoutCommunityMasonry;
    window.layoutCommunityMasonry = function (containerId) {
      const result = original.call(this, containerId);
      const container = document.getElementById(containerId);
      if (!container) return result;
      if (container.classList.contains("community-feed-grid") || container.classList.contains("community-feed-columns")) return result;
      const instance =
        containerId === "userProfileGrid" ? window.profileMasonry :
        containerId === "creationsGrid" ? window.creationsMasonry :
        window.communityMasonry;
      if (instance && instance.options) {
        if (instance.options.horizontalOrder !== true) {
          instance.options.horizontalOrder = true;
          instance.layout();
          console.log(`[Hotfix] ${containerId} Masonry horizontalOrder fixed`);
        }
      }
      return result;
    };
    
    console.log("[Hotfix] layoutCommunityMasonry patched");
  }
  
  function enhanceCommunityImageRelayout() {
    function observeCommunityImages() {
      const containers = ["communityGrid", "creationsGrid"];
      
      containers.forEach((containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const observer = new MutationObserver(() => {
          const imgs = container.querySelectorAll(".card-img[data-image-ref]");
          imgs.forEach((img) => {
            if (img.dataset.relayoutBound) return;
            img.dataset.relayoutBound = "1";
            
            const relayout = () => {
              const root = document.getElementById(containerId);
              if (root?.classList.contains("community-feed-columns") || root?.classList.contains("community-feed-grid")) return;
              if (typeof window.scheduleCommunityLayout === "function") {
                window.scheduleCommunityLayout(containerId, { immediate: true });
              }
            };
            
            img.addEventListener("load", relayout, { once: true });
            img.addEventListener("error", relayout, { once: true });
            
            if (img.complete && img.naturalWidth > 0) {
              relayout();
            }
          });
        });
        
        observer.observe(container, { childList: true, subtree: true });
        console.log(`[Hotfix] ${containerId} image relayout observer started`);
      });
    }
    
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", observeCommunityImages);
    } else {
      observeCommunityImages();
    }
  }
  
  function watchSidePanelResize() {
    const panel = document.getElementById("communitySidePanel");
    if (!panel) return;
    
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          setTimeout(() => {
            const grid = document.getElementById("communityGrid");
            if (grid?.classList.contains("community-feed-columns")) return;
            if (typeof window.layoutCommunityMasonry === "function") {
              window.layoutCommunityMasonry("communityGrid");
              console.log("[Hotfix] Sidebar toggle triggered Masonry relayout");
            }
          }, 350);
        }
      });
    });
    
    observer.observe(panel, { attributes: true });
    console.log("[Hotfix] Sidebar resize observer started");
  }

  function patchWarehouseMasonryConfig() {
    const observer = new MutationObserver(() => {
      const container = document.getElementById("cardsContainer");
      if (!container || !window.masonryInstance) return;
      
      if (window.masonryInstance.options && window.masonryInstance.options.horizontalOrder !== true) {
        window.masonryInstance.options.horizontalOrder = true;
        window.masonryInstance.layout();
        console.log("[Hotfix] Warehouse Masonry horizontalOrder fixed");
      }
    });
    
    const container = document.getElementById("cardsContainer");
    if (container) {
      observer.observe(container, { childList: true });
      console.log("[Hotfix] Warehouse Masonry observer started");
    }
  }
  
  function optimizeWarehouseImageLoading() {
    if (window.CardImageLoader && window.CardImageLoader.observeContainer) {
      const original = window.CardImageLoader.observeContainer;
      
      window.CardImageLoader.observeContainer = function (container) {
        if (container && container.id === "cardsContainer") {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                const img = entry.target;
                if (typeof window.CardImageLoader.loadImage === "function") {
                  window.CardImageLoader.loadImage(img);
                }
              }
            });
          }, {
            root: null,
            rootMargin: "50px",
            threshold: 0.01
          });
          
          container.querySelectorAll("img[data-image-ref]").forEach((img) => {
            observer.observe(img);
          });
          
          console.log("[Hotfix] Warehouse image loading rootMargin optimized to 50px");
          return;
        }
        
        return original.call(this, container);
      };
    }
  }
  
  function batchWarehouseMasonryLayout() {
    let layoutTimer = null;
    let pendingCount = 0;
    const BATCH_SIZE = 6;
    
    function triggerBatchLayout() {
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => {
        if (window.masonryInstance) {
          window.masonryInstance.layout();
          pendingCount = 0;
          console.log("[Hotfix] Batch Masonry relayout executed");
        }
      }, 120);
    }
    
    const container = document.getElementById("cardsContainer");
    if (!container) return;
    
    const observer = new MutationObserver(() => {
      const imgs = container.querySelectorAll(".card-img[data-image-ref]");
      imgs.forEach((img) => {
        if (img.dataset.batchLayoutBound) return;
        img.dataset.batchLayoutBound = "1";
        
        const onLoad = () => {
          pendingCount++;
          if (pendingCount >= BATCH_SIZE) {
            triggerBatchLayout();
          } else {
            clearTimeout(layoutTimer);
            layoutTimer = setTimeout(triggerBatchLayout, 200);
          }
        };
        
        img.addEventListener("load", onLoad, { once: true });
        img.addEventListener("error", onLoad, { once: true });
      });
    });
    
    observer.observe(container, { childList: true, subtree: true });
    console.log("[Hotfix] Warehouse batch relayout observer started");
  }

  function init() {
    fixCommunitySideBodyCSS();
    patchFinishCardMediaShine();
    watchCommunitySidePanel();
    
    patchCommunityMasonryConfig();
    enhanceCommunityImageRelayout();
    watchSidePanelResize();
    
    patchWarehouseMasonryConfig();
    optimizeWarehouseImageLoading();
    batchWarehouseMasonryLayout();
    
    console.log("[Hotfix] Community layout hotfix fully loaded");
    
    window.fixCommunityLayout = function () {
      console.log("[Hotfix] Manual layout fix triggered...");
      
      const body = document.getElementById("communitySideBody");
      if (body) {
        body.style.opacity = "1";
        body.style.visibility = "visible";
        body.style.display = "flex";
      }
      
      ["communityGrid", "creationsGrid", "cardsContainer"].forEach((id) => {
        const container = document.getElementById(id);
        if (container) {
          if (id === "cardsContainer" && window.masonryInstance) {
            window.masonryInstance.layout();
          } else if (typeof window.layoutCommunityMasonry === "function") {
            window.layoutCommunityMasonry(id);
          }
        }
      });
      
      console.log("[Hotfix] Layout fix completed");
    };
  }
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();