/**
 * 灯箱/欣赏器 DOM 与缩放（须在 script.js 之前；滚轮换图由 script 注册 __viewerWheelNavigate）
 */
(function () {
  let imageZoom = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, img: null };
  let viewerNav = { items: [], index: -1 };
  let viewerWheelNavAt = 0;
  const VIEWER_WHEEL_NAV_GAP_MS = 420;

  function getAppreciateViewerFrame() {
    return document.getElementById('appreciateViewerFrame')
      || document.querySelector('#appreciateViewerMedia .viewer-image-frame');
  }

  function getLightboxFrame() {
    return document.getElementById('lightboxFrame');
  }

  function getLightboxMinDisplaySize() {
    const grid = document.getElementById('communityGrid');
    const selected = grid?.querySelector('.community-post-card.selected');
    const media = selected?.querySelector('.card-media');
    if (media) {
      const r = media.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) return { minW: r.width, minH: r.height };
    }
    const colRaw = grid && getComputedStyle(grid).getPropertyValue('--feed-col-width').trim();
    const colW = parseFloat(colRaw) || selected?.offsetWidth || 0;
    if (colW > 8) return { minW: colW, minH: colW * 1.25 };
    return { minW: 240, minH: 300 };
  }

  function fitLightboxDisplaySize(img) {
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    const { minW, minH } = getLightboxMinDisplaySize();
    const maxW = Math.min(window.innerWidth * 0.96, 960);
    const maxH = window.innerHeight * 0.94 - 100;
    const ar = img.naturalWidth / img.naturalHeight;
    let w = maxW;
    let h = w / ar;
    if (h > maxH) {
      h = maxH;
      w = h * ar;
    }
    if (w < minW) {
      w = Math.min(minW, maxW);
      h = w / ar;
    }
    if (h < minH && h < maxH) {
      h = Math.min(minH, maxH);
      w = h * ar;
      if (w > maxW) {
        w = maxW;
        h = w / ar;
      }
    }
    img.style.width = `${Math.round(w)}px`;
    img.style.height = `${Math.round(h)}px`;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.objectFit = 'contain';
  }

  function setViewerFrameLoading(frame, loading) {
    if (!frame) return;
    frame.classList.toggle('is-loading', !!loading);
    frame.classList.remove('viewer-glow-active');
    frame.querySelector('.viewer-image-shine-wrap')?.classList.remove('viewer-glow-active', 'media-shine-reveal', 'viewer-shine-active');
  }

  function finishViewerFrameReveal(frame) {
    if (!frame) return;
    frame.classList.remove('is-loading', 'viewer-glow-active');
    const shineWrap = frame.querySelector('.viewer-image-shine-wrap');
    if (!shineWrap) return;
    shineWrap.classList.remove('viewer-glow-active');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shineWrap.classList.remove('media-shine-reveal');
    void shineWrap.offsetWidth;
    shineWrap.classList.add('media-shine-reveal');
    shineWrap.classList.add('viewer-shine-active');
  }

  function layoutViewerBorderSvg(frame) {
    const border = frame?.querySelector('.viewer-frame-border');
    const wrap = frame?.querySelector('.viewer-image-shine-wrap');
    const svg = border?.querySelector('.viewer-border-svg');
    if (!border || !wrap || !svg) return;
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;
    if (w < 8 || h < 8) return;
    const pad = 1.5;
    const r = 12;
    const attrs = {
      x: pad,
      y: pad,
      width: Math.max(0, w - pad * 2),
      height: Math.max(0, h - pad * 2),
      rx: r,
      ry: r
    };
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    ['track', 'sweep'].forEach((kind) => {
      const rect = svg.querySelector(`.viewer-border-${kind}`);
      if (!rect) return;
      Object.entries(attrs).forEach(([key, val]) => rect.setAttribute(key, String(val)));
    });
    const sweep = svg.querySelector('.viewer-border-sweep');
    if (!sweep) return;
    const perimeter = 2 * (attrs.width + attrs.height - 4 * r) + 2 * Math.PI * r;
    const dashLen = Math.max(40, Math.min(110, perimeter * 0.07));
    sweep.style.strokeDasharray = `${dashLen} ${Math.max(perimeter, dashLen + 1)}`;
    sweep.style.strokeDashoffset = '0';
  }

  function applyViewerAdaptiveGlow(frame, img) {
    const border = frame?.querySelector('.viewer-frame-border');
    if (!border || !img?.naturalWidth) return;
    let r = 160;
    let g = 195;
    let b = 255;
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      const pick = (x, y) => {
        const i = (y * size + x) * 4;
        const a = data[i + 3];
        if (a < 24) return;
        sr += data[i];
        sg += data[i + 1];
        sb += data[i + 2];
        n += 1;
      };
      for (let x = 0; x < size; x += 1) {
        pick(x, 0);
        pick(x, size - 1);
      }
      for (let y = 1; y < size - 1; y += 1) {
        pick(0, y);
        pick(size - 1, y);
      }
      if (n > 0) {
        r = Math.round(sr / n);
        g = Math.round(sg / n);
        b = Math.round(sb / n);
      }
    } catch (e) { /* CORS */ }
    const mix = (c) => Math.min(255, Math.round(c * 0.72 + 255 * 0.28));
    border.style.setProperty('--viewer-edge-r', String(r));
    border.style.setProperty('--viewer-edge-g', String(g));
    border.style.setProperty('--viewer-edge-b', String(b));
    border.style.setProperty('--viewer-edge-light-r', String(mix(r)));
    border.style.setProperty('--viewer-edge-light-g', String(mix(g)));
    border.style.setProperty('--viewer-edge-light-b', String(mix(b)));
    frame.classList.add('viewer-edge-glow-ready');
    layoutViewerBorderSvg(frame);
  }

  function setAppreciateViewerLoading(loading) {
    setViewerFrameLoading(getAppreciateViewerFrame(), loading);
    document.getElementById('appreciateViewerMedia')?.classList.remove('media-shine-reveal', 'viewer-glow-active');
  }

  function finishAppreciateViewerReveal() {
    finishViewerFrameReveal(getAppreciateViewerFrame());
  }

  function setViewerNav(items, currentKey) {
    viewerNav.items = Array.isArray(items) ? items : [];
    viewerNav.index = viewerNav.items.findIndex((it) => it.key === currentKey);
  }

  function lightboxWheelNavEnabled() {
    return !!window.__lightboxImageGenNav
      || !!window.__viewerGlobalViewActive
      || !!window.__appreciateCardGallery?.urls?.length;
  }

  function navigateViewerByWheel(delta) {
    if (!viewerNav.items.length || viewerNav.index < 0) return false;
    const next = viewerNav.index + (delta > 0 ? 1 : -1);
    if (next < 0 || next >= viewerNav.items.length) return false;
    const item = viewerNav.items[next];
    viewerNav.index = next;
    if (typeof window.__viewerWheelNavigate === 'function') {
      return window.__viewerWheelNavigate(item) === true;
    }
    return false;
  }

  function navigateViewerByWheelThrottled(delta) {
    const now = performance.now();
    if (now - viewerWheelNavAt < VIEWER_WHEEL_NAV_GAP_MS) return false;
    if (!navigateViewerByWheel(delta)) return false;
    viewerWheelNavAt = now;
    return true;
  }

  function onViewerShellWheel(e) {
    const t = e.target;
    const onLightbox = !!t?.closest?.('#imageLightbox');
    const onAppreciate = !!t?.closest?.('#appreciateViewer');
    if (onLightbox && !lightboxWheelNavEnabled()) return;
    if (onAppreciate && !window.__appreciateCardGallery?.urls?.length && !isGlobalViewActive()) return;
    if (t?.id === 'appreciateViewerImg' || t?.id === 'lightboxImage') return;
    if (!viewerNav.items.length) return;
    if (onLightbox && !lightboxWheelNavEnabled()) return;
    e.preventDefault();
    navigateViewerByWheelThrottled(e.deltaY);
  }

  function isGlobalViewActive() {
    return !!window.__viewerGlobalViewActive
      || document.body.classList.contains('global-view');
  }

  function bindViewerShellWheelNav() {
    ['appreciateViewer', 'imageLightbox'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.viewerWheelBound) return;
      el.dataset.viewerWheelBound = '1';
      el.addEventListener('wheel', onViewerShellWheel, { passive: false });
    });
  }

  function applyImageZoom() {
    const img = imageZoom.img;
    if (!img) return;
    img.style.transform = `scale(${imageZoom.scale}) translate(${imageZoom.tx}px, ${imageZoom.ty}px)`;
    img.style.cursor = imageZoom.dragging ? 'grabbing' : 'grab';
  }

  function resetImageZoom(img) {
    imageZoom.scale = 1;
    imageZoom.tx = 0;
    imageZoom.ty = 0;
    imageZoom.dragging = false;
    imageZoom.img = img || null;
    applyImageZoom();
  }

  function attachImageZoom(img) {
    if (!img) return;
    imageZoom.img = img;
    img.style.transformOrigin = 'center center';
    img.onwheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      imageZoom.scale = Math.min(Math.max(0.5, imageZoom.scale + (e.deltaY > 0 ? -0.1 : 0.1)), 4);
      applyImageZoom();
    };
    img.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      imageZoom.dragging = true;
      imageZoom.startX = e.clientX - imageZoom.tx;
      imageZoom.startY = e.clientY - imageZoom.ty;
      applyImageZoom();
    };
    img.onclick = (e) => e.stopPropagation();
    img.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetImageZoom(img);
    };
  }

  document.addEventListener('mouseup', () => {
    if (!imageZoom.dragging) return;
    imageZoom.dragging = false;
    applyImageZoom();
  });
  document.addEventListener('mousemove', (e) => {
    if (!imageZoom.dragging || !imageZoom.img) return;
    imageZoom.tx = e.clientX - imageZoom.startX;
    imageZoom.ty = e.clientY - imageZoom.startY;
    applyImageZoom();
  });

  bindViewerShellWheelNav();

  window.getAppreciateViewerFrame = getAppreciateViewerFrame;
  window.getLightboxFrame = getLightboxFrame;
  window.getLightboxMinDisplaySize = getLightboxMinDisplaySize;
  window.fitLightboxDisplaySize = fitLightboxDisplaySize;
  window.setViewerFrameLoading = setViewerFrameLoading;
  window.finishViewerFrameReveal = finishViewerFrameReveal;
  window.layoutViewerBorderSvg = layoutViewerBorderSvg;
  window.applyViewerAdaptiveGlow = applyViewerAdaptiveGlow;
  window.setAppreciateViewerLoading = setAppreciateViewerLoading;
  window.finishAppreciateViewerReveal = finishAppreciateViewerReveal;
  window.setViewerNav = setViewerNav;
  window.getViewerNav = () => viewerNav;
  window.attachImageZoom = attachImageZoom;
  window.resetImageZoom = resetImageZoom;
})();
