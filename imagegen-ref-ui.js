/**
 * 生图参考图 UI：上传、画廊、标注器、展示 URL 解析
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  function d() { return deps; }

  const MAX_REF_IMAGES = 16;

  function maxRefImages() {
    const n = Number(d().getMaxRefImages?.());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_REF_IMAGES;
  }
  const REF_INPUT_MAX_BYTES = 50 * 1024 * 1024;
  const REF_AUTO_COMPRESS_BYTES = 12 * 1024 * 1024;
  const REF_MAX_SIDE = 2560;
  const REF_THUMB_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect fill="#2a2a2e" width="100%" height="100%" rx="6"/></svg>'
  );
  const IMAGEGEN_REF_DROP_MIME = 'application/x-prompt-hub-image-ref';

  let imageGenRefImages = [];
  let imageGenRefResolveAssetId = '';
  let refAnnotatorIdx = -1;
  let refAnnotatorStrokes = [];
  let refAnnotatorDraft = null;
  let refAnnotatorColor = '#ef4444';
  let refAnnotatorTool = 'circle';
  let refAnnotatorBrushSize = 14;
  let refAnnotatorDrawing = false;
  let refAnnotatorBound = false;
  let refAnnotatorResizeObs = null;

  function canvasToJpegDataUrl(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片压缩失败'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    });
  }

  async function compressRefImageFromSource(source, maxSide) {
    return d().compressRefImageFromSource(source, maxSide);
  }

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

function loadRefImageElement(src, opts = {}) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (opts.crossOrigin) img.crossOrigin = opts.crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = src;
    });
  }

async function fetchRefImageBlob(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return await res.blob();
    } catch (e) { /* proxy */ }
    if (window.PromptHubApi?.fetchMediaAsBlobUrl && /^https?:\/\//i.test(url)) {
      const tmp = await window.PromptHubApi.fetchMediaAsBlobUrl(url);
      if (tmp) {
        try {
          const blob = await (await fetch(tmp)).blob();
          URL.revokeObjectURL(tmp);
          return blob;
        } catch (e) {
          URL.revokeObjectURL(tmp);
        }
      }
    }
    return null;
  }

async function resolveRefImageForEdit(ref) {
    if (!ref || typeof ref !== 'string') return '';
    if (/^data:image\//i.test(ref) || ref.startsWith('blob:')) return ref;
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    if (window.SupabaseSync?.isStorageRef?.(normalized) && window.SupabaseSync?.isLoggedIn?.()) {
      const assetId = imageGenRefResolveAssetId || undefined;
      try {
        const blob = await window.SupabaseSync.downloadCardStorageBlob(normalized, assetId, {
          preferLargest: false
        });
        if (blob?.size) return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('参考图本地读取失败', e);
      }
    }
    const displayUrl = await resolveRefDisplayUrl(ref);
    if (displayUrl) {
      const blob = await fetchRefImageBlob(displayUrl);
      if (blob?.size) return URL.createObjectURL(blob);
      if (/^data:image\//i.test(displayUrl) || displayUrl.startsWith('blob:')) return displayUrl;
    }
    return '';
  }

async function prepareRefImageFromFile(file) {
    if (file.size > REF_INPUT_MAX_BYTES) {
      throw new Error(`单张参考图不能超过 ${Math.round(REF_INPUT_MAX_BYTES / 1024 / 1024)}MB`);
    }
    if (file.size <= REF_AUTO_COMPRESS_BYTES) {
      return { dataUrl: await readFileAsDataUrl(file), compressed: false };
    }
    const blobUrl = URL.createObjectURL(file);
    try {
      return { dataUrl: await d().compressRefImageFromSource(blobUrl, REF_MAX_SIDE), compressed: true };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

async function resolveRefDisplayUrl(ref, opts) {
    if (!ref || typeof ref !== 'string') return '';
    if (/^data:image\//i.test(ref) || ref.startsWith('blob:')) return ref;
    if (/^https?:\/\//i.test(ref)) {
      if (window.SupabaseSync?.isInvalidMediaUrl?.(ref)) {
        const fixed = window.SupabaseSync?.normalizeImageRef?.(ref);
        if (fixed && fixed !== ref) return resolveRefDisplayUrl(fixed, opts);
        return '';
      }
      return ref;
    }
    const normalized = window.SupabaseSync?.normalizeImageRef?.(ref) || ref;
    const isStorageLike = window.SupabaseSync?.isStorageRef?.(normalized)
      || (normalized.startsWith('storage://') && !/^https?:/i.test(normalized));
    if (!isStorageLike) return '';
    const assetId = opts?.assetId || imageGenRefResolveAssetId || undefined;
    const cached = window.MediaPipeline?.getPreviewCached?.(normalized, assetId)
      || window.MediaPipeline?.getListCached?.(normalized, assetId)
      || window.SupabaseSync?.getCachedDisplayUrl?.(normalized, { assetId, variant: 'full' })
      || window.SupabaseSync?.getCachedDisplayUrl?.(normalized, { assetId, variant: 'grid' });
    if (cached && /^https?:\/\//i.test(cached) && !cached.startsWith('storage://')) return cached;
    try {
      if (window.MediaPipeline?.resolvePreviewUrl) {
        const url = await window.MediaPipeline.resolvePreviewUrl(normalized, { assetId, tryAllPaths: true });
        return url && /^https?:\/\//i.test(url) && !url.startsWith('storage://') ? url : '';
      }
      const url = await window.SupabaseSync.resolveDisplayUrl(normalized, {
        assetId,
        variant: 'full',
        tryAllPaths: true
      });
      return url && /^https?:\/\//i.test(url) && !url.startsWith('storage://') ? url : '';
    } catch (e) {
      console.warn('参考图展示解析失败', e);
      return '';
    }
  }

function parseImageGenRefDropPayload(dt) {
    if (!dt) return null;
    const raw = dt.getData(IMAGEGEN_REF_DROP_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.imageRef) return parsed;
    } catch (e) { /* ignore */ }
    return null;
  }

function addImageGenRefFromFeed(payload) {
    const imageRef = String(payload?.imageRef || payload || '').trim();
    if (!imageRef || !d().isDisplayableImage(imageRef)) {
      d().toast('该缩略图无法作为参考图');
      return false;
    }
    if (imageGenRefImages.length >= maxRefImages()) {
      d().toast(`最多 ${maxRefImages()} 张参考图`);
      return false;
    }
    if (imageGenRefImages.some((r) => r === imageRef)) {
      d().toast('该图已在参考图列表中');
      return false;
    }
    imageGenRefImages.push(imageRef);
    const assetId = String(payload?.sourceCardId || '').trim();
    if (assetId && imageGenRefImages.length === 1) {
      imageGenRefResolveAssetId = assetId;
    }
    renderImageGenRefGallery();
    d().toast('已加入参考图');
    return true;
  }

async function addImageGenRefFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    let added = 0;
    let compressedCount = 0;
    for (const f of files) {
      if (imageGenRefImages.length >= maxRefImages()) {
        d().toast(`最多 ${maxRefImages()} 张参考图`);
        break;
      }
      try {
        const { dataUrl, compressed } = await prepareRefImageFromFile(f);
        imageGenRefImages.push(dataUrl);
        added++;
        if (compressed) compressedCount++;
      } catch (e) {
        d().toast(e?.message || `「${f.name || '图片'}」无法添加`);
      }
    }
    if (added) {
      renderImageGenRefGallery();
      if (compressedCount && added === compressedCount) {
        d().toast(added > 1 ? `已添加 ${added} 张参考图（均已自动压缩）` : '大图已自动压缩，可正常用于生图');
      } else if (added > 1) {
        d().toast(`已添加 ${added} 张参考图${compressedCount ? `（${compressedCount} 张已压缩）` : ''}`);
      } else {
        d().toast('已添加参考图');
      }
    }
  }

function removeImageGenRefAt(idx) {
    imageGenRefImages.splice(idx, 1);
    renderImageGenRefGallery();
  }

function refAnnotatorLineWidth(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const base = Math.min(canvas.width, canvas.height) / dpr;
    return Math.max(3, Math.round(base * 0.006));
  }

function drawRefAnnotatorBrush(ctx, stroke) {
    const pts = stroke.points || [];
    const size = stroke.size || 14;
    if (!pts.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      if (i === 1) ctx.lineTo(cur.x, cur.y);
      else ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.stroke();
  }

function drawRefAnnotatorCircle(ctx, stroke) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = refAnnotatorLineWidth(ctx.canvas);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(stroke.cx, stroke.cy, stroke.rx, stroke.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

function redrawRefAnnotatorCanvas() {
    const canvas = document.getElementById('refAnnotatorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = refAnnotatorDraft ? [...refAnnotatorStrokes, refAnnotatorDraft] : refAnnotatorStrokes;
    for (const s of all) {
      if (!s) continue;
      if (s.type === 'brush') drawRefAnnotatorBrush(ctx, s);
      else drawRefAnnotatorCircle(ctx, s);
    }
  }

function closeRefImageAnnotator() {
    const overlay = document.getElementById('refAnnotatorOverlay');
    if (overlay) overlay.hidden = true;
    refAnnotatorIdx = -1;
    refAnnotatorStrokes = [];
    refAnnotatorDraft = null;
    refAnnotatorDrawing = false;
    refAnnotatorResizeObs?.disconnect();
    refAnnotatorResizeObs = null;
  }

function paintRefAnnotatorStrokesToCtx(ctx, strokes, scaleX, scaleY) {
    const scale = (scaleX + scaleY) / 2;
    for (const s of strokes) {
      if (!s) continue;
      if (s.type === 'brush') {
        const pts = (s.points || []).map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
        drawRefAnnotatorBrush(ctx, {
          color: s.color,
          points: pts,
          size: (s.size || 14) * scale
        });
      } else {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(3, Math.round(Math.min(
          ctx.canvas.width,
          ctx.canvas.height
        ) * 0.006));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.ellipse(
          s.cx * scaleX,
          s.cy * scaleY,
          s.rx * scaleX,
          s.ry * scaleY,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
    }
  }

function bindRefImageAnnotatorOnce() {
    if (refAnnotatorBound) return;
    refAnnotatorBound = true;
    const overlay = document.getElementById('refAnnotatorOverlay');
    const canvas = document.getElementById('refAnnotatorCanvas');
    const frame = document.getElementById('refAnnotatorFrame');
    if (!overlay || !canvas || !frame) return;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeRefImageAnnotator();
    });
    document.getElementById('refAnnotatorClose')?.addEventListener('click', closeRefImageAnnotator);
    document.getElementById('refAnnotatorCancel')?.addEventListener('click', closeRefImageAnnotator);
    document.getElementById('refAnnotatorUndo')?.addEventListener('click', () => {
      refAnnotatorStrokes.pop();
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
    });
    document.getElementById('refAnnotatorClear')?.addEventListener('click', () => {
      refAnnotatorStrokes = [];
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
    });
    document.getElementById('refAnnotatorDone')?.addEventListener('click', () => {
      void (async () => {
        if (refAnnotatorIdx < 0) {
          closeRefImageAnnotator();
          return;
        }
        const ref = imageGenRefImages[refAnnotatorIdx];
        const canvas = document.getElementById('refAnnotatorCanvas');
        if (!canvas?.width || !canvas?.height) {
          d().toast('画布尚未就绪');
          closeRefImageAnnotator();
          return;
        }
        let canvasSource = '';
        let revokeAfter = false;
        try {
          canvasSource = await resolveRefImageForEdit(ref);
          if (!canvasSource) {
            d().toast('参考图尚未加载');
            return;
          }
          if (canvasSource.startsWith('blob:')) revokeAfter = true;
          const baseImg = await loadRefImageElement(canvasSource);
          const out = document.createElement('canvas');
          out.width = baseImg.naturalWidth || baseImg.width;
          out.height = baseImg.naturalHeight || baseImg.height;
          if (!out.width || !out.height) {
            d().toast('图片尺寸无效');
            return;
          }
          const ctx = out.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(baseImg, 0, 0, out.width, out.height);
          const scaleX = out.width / canvas.width;
          const scaleY = out.height / canvas.height;
          paintRefAnnotatorStrokesToCtx(ctx, refAnnotatorStrokes, scaleX, scaleY);
          const dataUrl = await canvasToJpegDataUrl(out, 0.92);
          imageGenRefImages[refAnnotatorIdx] = dataUrl;
          renderImageGenRefGallery();
          d().toast('标注已保存，生图时会带上标记区域');
        } catch (e) {
          console.warn('保存参考图标注失败', e);
          d().toast('保存标注失败');
        } finally {
          if (revokeAfter && canvasSource.startsWith('blob:')) URL.revokeObjectURL(canvasSource);
          closeRefImageAnnotator();
        }
      })();
    });
    document.querySelectorAll('#refAnnotatorColors .ref-annotator__color').forEach((btn) => {
      btn.addEventListener('click', () => {
        refAnnotatorColor = btn.getAttribute('data-color') || '#ef4444';
        document.querySelectorAll('#refAnnotatorColors .ref-annotator__color').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });
    document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        refAnnotatorTool = btn.getAttribute('data-tool') === 'brush' ? 'brush' : 'circle';
        document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        const brushWrap = document.getElementById('refAnnotatorBrushSizeWrap');
        if (brushWrap) brushWrap.hidden = refAnnotatorTool !== 'brush';
        canvas.style.cursor = refAnnotatorTool === 'brush' ? 'pointer' : 'crosshair';
        refAnnotatorDraft = null;
        redrawRefAnnotatorCanvas();
      });
    });
    document.getElementById('refAnnotatorBrushSize')?.addEventListener('input', (e) => {
      refAnnotatorBrushSize = Math.max(4, Number(e.target.value) || 14);
    });

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, rect.width);
      const sy = canvas.height / Math.max(1, rect.height);
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top) * sy
      };
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      refAnnotatorDrawing = true;
      const p = pointerPos(e);
      if (refAnnotatorTool === 'brush') {
        const size = refAnnotatorBrushSize * (window.devicePixelRatio || 1);
        refAnnotatorDraft = { type: 'brush', color: refAnnotatorColor, points: [p], size };
      } else {
        refAnnotatorDraft = {
          type: 'circle',
          color: refAnnotatorColor,
          cx: p.x,
          cy: p.y,
          rx: 1,
          ry: 1,
          x0: p.x,
          y0: p.y
        };
      }
      canvas.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
      if (!refAnnotatorDrawing || !refAnnotatorDraft) return;
      e.preventDefault();
      const p = pointerPos(e);
      const d = refAnnotatorDraft;
      if (d.type === 'brush') {
        const last = d.points[d.points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) {
          d.points.push(p);
        }
      } else {
        d.cx = (p.x + d.x0) / 2;
        d.cy = (p.y + d.y0) / 2;
        d.rx = Math.max(4, Math.abs(p.x - d.x0) / 2);
        d.ry = Math.max(4, Math.abs(p.y - d.y0) / 2);
      }
      redrawRefAnnotatorCanvas();
    }

    function onPointerUp(e) {
      if (!refAnnotatorDrawing || !refAnnotatorDraft) return;
      refAnnotatorDrawing = false;
      const d = refAnnotatorDraft;
      if (d.type === 'brush') {
        if (d.points.length >= 1) refAnnotatorStrokes.push({ ...d, points: d.points.slice() });
      } else if (d.rx > 6 || d.ry > 6) {
        refAnnotatorStrokes.push({ ...d });
      }
      refAnnotatorDraft = null;
      redrawRefAnnotatorCanvas();
      try { canvas.releasePointerCapture?.(e.pointerId); } catch (err) { /* ignore */ }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  }

function layoutRefAnnotatorCanvas() {
    const img = document.getElementById('refAnnotatorImg');
    const canvas = document.getElementById('refAnnotatorCanvas');
    if (!img || !canvas || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    redrawRefAnnotatorCanvas();
  }

async function openRefImageAnnotator(idx) {
    bindRefImageAnnotatorOnce();
    const ref = imageGenRefImages[idx];
    if (!ref) return;
    const url = await resolveRefDisplayUrl(ref);
    if (!url) {
      d().toast('参考图尚未加载完成');
      return;
    }
    const overlay = document.getElementById('refAnnotatorOverlay');
    const img = document.getElementById('refAnnotatorImg');
    const frame = document.getElementById('refAnnotatorFrame');
    if (!overlay || !img || !frame) return;
    refAnnotatorIdx = idx;
    refAnnotatorStrokes = [];
    refAnnotatorDraft = null;
    refAnnotatorTool = 'circle';
    document.querySelectorAll('#refAnnotatorModes .ref-annotator__mode').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tool') === 'circle');
    });
    const brushWrap = document.getElementById('refAnnotatorBrushSizeWrap');
    if (brushWrap) brushWrap.hidden = true;
    overlay.hidden = false;
    const relayout = () => requestAnimationFrame(() => layoutRefAnnotatorCanvas());
    img.onload = relayout;
    img.onerror = () => d().toast('参考图加载失败，请换一张或重新上传');
    if (/^https?:\/\//i.test(url)) img.crossOrigin = 'anonymous';
    else img.removeAttribute('crossorigin');
    img.src = url;
    if (img.complete && img.naturalWidth) relayout();
    refAnnotatorResizeObs?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      refAnnotatorResizeObs = new ResizeObserver(relayout);
      refAnnotatorResizeObs.observe(frame);
    }
  }

function renderImageGenRefGallery() {
    const gallery = document.getElementById('imageGenRefGallery');
    const box = document.getElementById('imageGenRefBox');
    if (!gallery || !box) return;
    if (!imageGenRefImages.length) {
      gallery.hidden = true;
      gallery.innerHTML = '';
      box.classList.remove('has-refs');
      window.ImageGenPromptTools?.updateRefToolState?.();
      return;
    }
    gallery.hidden = false;
    box.classList.add('has-refs');
    gallery.innerHTML = imageGenRefImages.map((src, i) => `
      <div class="imagegen-ref-thumb">
        <button type="button" class="imagegen-ref-preview-btn" data-ref-idx="${i}" title="点击标注 / 放大">
          <img src="${REF_THUMB_PLACEHOLDER}" data-ref-idx="${i}" alt="参考图 ${i + 1}">
        </button>
        <button type="button" class="imagegen-ref-rm" data-ref-idx="${i}" aria-label="移除">×</button>
      </div>
    `).join('');
    imageGenRefImages.forEach((src, i) => {
      void resolveRefDisplayUrl(src).then((url) => {
        const img = gallery.querySelector(`img[data-ref-idx="${i}"]`);
        if (!img || imageGenRefImages[i] !== src) return;
        if (url) img.src = url;
        else {
          img.alt = '参考图加载失败';
          img.classList.add('imagegen-ref-thumb--failed');
        }
      });
    });
    gallery.querySelectorAll('.imagegen-ref-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.refIdx);
        if (!Number.isFinite(idx) || !imageGenRefImages[idx]) return;
        void openRefImageAnnotator(idx);
      });
    });
    gallery.querySelectorAll('.imagegen-ref-rm').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeImageGenRefAt(Number(btn.dataset.refIdx));
      });
    });
    d().updateImageGenCostHint?.();
    window.ImageGenPromptTools?.updateRefToolState?.();
  }

  function setImageGenRefs(urls, opts = {}) {
    if (opts.assetId != null) imageGenRefResolveAssetId = opts.assetId ? String(opts.assetId) : '';
    if (typeof urls === 'string' && urls) {
      imageGenRefImages = [urls];
    } else {
      imageGenRefImages = Array.isArray(urls) ? urls.filter(Boolean).slice(0, maxRefImages()) : [];
    }
    renderImageGenRefGallery();
  }

function clearImageGenRef() {
    imageGenRefImages = [];
    imageGenRefResolveAssetId = '';
    renderImageGenRefGallery();
  }

function bindImageGenPromptTools() {
    const pasteBtn = document.getElementById('imageGenPromptPaste');
    const copyBtn = document.getElementById('imageGenPromptCopy');
    const clearBtn = document.getElementById('imageGenPromptClear');
    const promptEl = document.getElementById('imageGenPrompt');
    if (!pasteBtn || !clearBtn || !promptEl) return;
    if (pasteBtn.dataset.bound === '1') return;
    pasteBtn.dataset.bound = '1';
    if (copyBtn) copyBtn.dataset.bound = '1';
    clearBtn.dataset.bound = '1';

    pasteBtn.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.readText) {
          d().toast('当前浏览器不支持剪贴板粘贴');
          return;
        }
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
          d().toast('剪贴板为空');
          return;
        }
        promptEl.value = text.trim();
        promptEl.dispatchEvent(new Event('input', { bubbles: true }));
        promptEl.focus();
      } catch (e) {
        d().toast('无法读取剪贴板，请检查浏览器权限');
      }
    });

    copyBtn?.addEventListener('click', async () => {
      const text = promptEl.value.trim();
      if (!text) {
        d().toast('暂无可复制的提示词');
        return;
      }
      try {
        if (!navigator.clipboard?.writeText) {
          d().toast('当前浏览器不支持复制到剪贴板');
          return;
        }
        await navigator.clipboard?.writeText(text);
        d().toast('已复制提示词');
      } catch (e) {
        d().toast('复制失败，请检查浏览器剪贴板权限');
      }
    });

    clearBtn.addEventListener('click', () => {
      if (!promptEl.value.trim()) return;
      promptEl.value = '';
      promptEl.dispatchEvent(new Event('input', { bubbles: true }));
      promptEl.focus();
    });
  }

function bindImageGenUpload() {
    const drop = document.getElementById('imageGenRefDrop');
    const box = document.getElementById('imageGenRefBox');
    const input = document.getElementById('imageGenRefInput');
    if (!drop || !input || !box) return;
    if (drop.dataset.bound === '1') return;
    drop.dataset.bound = '1';

    const bindDragZone = (el) => {
      ['dragenter', 'dragover'].forEach(ev => {
        el.addEventListener(ev, e => {
          if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
          e.preventDefault();
          e.stopPropagation();
          box.classList.add('drag-over');
        });
      });
      el.addEventListener('dragleave', e => {
        if (!box.contains(e.relatedTarget)) box.classList.remove('drag-over');
      });
      el.addEventListener('drop', e => {
        if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
        e.preventDefault();
        e.stopPropagation();
        box.classList.remove('drag-over');
        const feedRef = parseImageGenRefDropPayload(e.dataTransfer);
        if (feedRef) {
          addImageGenRefFromFeed(feedRef);
          return;
        }
        if (e.dataTransfer?.files?.length) addImageGenRefFiles(e.dataTransfer.files);
      });
    };

    drop.addEventListener('click', e => {
      if (e.target.closest('.imagegen-ref-rm') || e.target.closest('.imagegen-ref-preview-btn')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) addImageGenRefFiles(input.files);
      input.value = '';
    });
    bindDragZone(drop);
    bindDragZone(box);

    if (!document.body.dataset.imageGenPasteBound) {
      document.body.dataset.imageGenPasteBound = '1';
      document.addEventListener('paste', e => {
        if (!document.getElementById('pageImageGen')?.classList.contains('active')) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          addImageGenRefFiles(files);
        }
      });
    }
  }
  function getImageGenRefImages() {
    return imageGenRefImages;
  }

  function getImageGenPrimaryRef() {
    return imageGenRefImages[0] || null;
  }

  function init(injected) {
    deps = injected || {};
    return {
      getImageGenRefImages,
      getImageGenPrimaryRef,
      setImageGenRefs,
      clearImageGenRef,
      resolveRefDisplayUrl,
      addImageGenRefFromFeed,
      bindImageGenUpload,
      bindImageGenPromptTools,
      renderImageGenRefGallery
    };
  }

  global.ImageGenRefUI = { init };
})(typeof window !== 'undefined' ? window : globalThis);
