(function (global) {
  const DEFAULT_THRESHOLD = 26;
  const ANALYSIS_MAX = 640;
  const MIN_REMOVED_PX = 4;
  const ROW_NONBLACK_RATIO = 0.012;

  function isDark(r, g, b, threshold) {
    return r <= threshold && g <= threshold && b <= threshold;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });
  }

  async function trimBlackBorders(source, opts) {
    const threshold = (opts && opts.threshold != null) ? opts.threshold : DEFAULT_THRESHOLD;
    const img = typeof source === 'string' ? await loadImage(source) : source;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) {
      return { dataUrl: typeof source === 'string' ? source : '', trimmed: false };
    }

    const scale = Math.min(1, ANALYSIS_MAX / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;

    function rowHasContent(y) {
      let nonDark = 0;
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        if (!isDark(data[i], data[i + 1], data[i + 2], threshold)) nonDark++;
      }
      return nonDark / sw >= ROW_NONBLACK_RATIO;
    }

    function colHasContent(x, top, bottom) {
      let nonDark = 0;
      const rows = bottom - top + 1;
      for (let y = top; y <= bottom; y++) {
        const i = (y * sw + x) * 4;
        if (!isDark(data[i], data[i + 1], data[i + 2], threshold)) nonDark++;
      }
      return nonDark / rows >= ROW_NONBLACK_RATIO;
    }

    let top = 0;
    while (top < sh && !rowHasContent(top)) top++;
    let bottom = sh - 1;
    while (bottom > top && !rowHasContent(bottom)) bottom--;
    let left = 0;
    while (left < sw && !colHasContent(left, top, bottom)) left++;
    let right = sw - 1;
    while (right > left && !colHasContent(right, top, bottom)) right--;

    if (top >= bottom || left >= right) {
      return { dataUrl: typeof source === 'string' ? source : '', trimmed: false };
    }

    const inv = 1 / scale;
    const x0 = Math.max(0, Math.floor(left * inv));
    const y0 = Math.max(0, Math.floor(top * inv));
    const x1 = Math.min(w, Math.ceil((right + 1) * inv));
    const y1 = Math.min(h, Math.ceil((bottom + 1) * inv));
    const cropW = x1 - x0;
    const cropH = y1 - y0;
    if (cropW < 8 || cropH < 8) {
      return { dataUrl: typeof source === 'string' ? source : '', trimmed: false };
    }

    const removed = x0 + y0 + (w - x1) + (h - y1);
    if (removed < MIN_REMOVED_PX) {
      return { dataUrl: typeof source === 'string' ? source : '', trimmed: false };
    }

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    out.getContext('2d').drawImage(img, x0, y0, cropW, cropH, 0, 0, cropW, cropH);
    const usePng = typeof source === 'string' && /^data:image\/png/i.test(source);
    const mime = usePng ? 'image/png' : 'image/jpeg';
    const dataUrl = out.toDataURL(mime, usePng ? undefined : 0.92);
    return { dataUrl, trimmed: true, bounds: { x0, y0, x1, y1 } };
  }

  global.ImageTrim = { trimBlackBorders };
})(typeof window !== 'undefined' ? window : self);
