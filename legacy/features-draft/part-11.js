
  async function fetchImageGenModelCatalogFromNetwork() {
    if (!window.PromptHubApi?.getGenerationModels) return false;
    try {
      const r = await window.PromptHubApi.getGenerationModels();
      if (r?.ok && Array.isArray(r.data?.models) && r.data.models.length) {
        applyImageGenModelCatalog(r.data.models, {
          forceRender: isImageGenPageVisible(),
          source: 'api'
        });
        return true;
      }
    } catch (e) {
      console.warn('[imagegen] load models failed', e);
    }
    return false;
  }

  function prefetchImageGenModelCatalog() {
    if (imageGenModelCatalogFetchPromise) return imageGenModelCatalogFetchPromise;
    imageGenModelCatalogFetchPromise = fetchImageGenModelCatalogFromNetwork().finally(() => {
      imageGenModelCatalogFetchPromise = null;
    });
    return imageGenModelCatalogFetchPromise;
  }

  function scheduleDeferredImageGenModelCatalogRefresh() {
    clearTimeout(imageGenModelCatalogDeferredTimer);
    const runLater = () => prefetchImageGenModelCatalog();
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runLater, { timeout: 4000 });
    } else {
      imageGenModelCatalogDeferredTimer = setTimeout(runLater, 1500);
    }
  }

  function normalizeImageGenModelId(modelId) {
    const id = String(modelId || '')
      .trim()
      .toLowerCase();
    if (!id) return 'gpt-image-2';
    if (id === 'quanneng2') return 'gpt-image-2';
    if (id === 'jimeng') return 'nano-banana-pro';
    return id;
  }

  function imageGenModelLabel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    const hit = imageGenModelCatalog.find((m) => m.id === id);
    if (hit) return imageGenModelDisplayName(hit);
    return id === 'gpt-image-2' ? 'GPT Image 2' : id;
  }

  async function refreshImageGenModelCatalog(opts = {}) {
    warmImageGenModelCatalog();
    if (opts.force !== true && !isImageGenPageVisible()) {
      scheduleDeferredImageGenModelCatalogRefresh();
      return;
    }
    return prefetchImageGenModelCatalog();
  }

  function imageGenModelUiFamily(m) {
    if (m?.uiFamily === 'banana' || m?.uiFamily === 'gim2' || m?.uiFamily === 'jimeng' || m?.uiFamily === 'midjourney' || m?.uiFamily === 'wan' || m?.uiFamily === 'flux') return m.uiFamily;
    const id = String(m?.id || '').toLowerCase();
    if (id.startsWith('apimart-mj-')) return 'midjourney';
    if (id.startsWith('apimart-gemini') || id.includes('gemini-')) return 'banana';
    if (id.startsWith('apimart-wan') || id.includes('wan2.7')) return 'wan';
    if (id.startsWith('apimart-flux') || id.includes('flux-kontext') || id.includes('flux-2-')) return 'flux';
    if (id.includes('seedream') || id === 'jimeng') return 'jimeng';
    if (id.includes('nano-banana')) return 'banana';
    return 'gim2';
  }

  function isImageGenMidjourneyModel(modelId) {
    return imageGenModelUiFamily({ id: normalizeImageGenModelId(modelId) }) === 'midjourney';
  }

  function normalizeMjParentJobId(jobId) {
    return String(jobId || '').replace(/#\d+$/, '').trim();
  }

  /** APImart MJ：第 1 张常为四宫格合成图，后 4 张为单图；也可能只返回 3～4 张 */
  function parseMjImagineUrls(imageUrl, extras) {
    const all = [...new Set([imageUrl, ...(extras || [])].filter((u) => u && /^https?:\/\//i.test(String(u))))];
    if (!all.length) return { composite: null, tiles: [], primary: null };
    if (all.length >= 5) {
      return { composite: all[0], tiles: all.slice(1, 5), primary: all[0] || all[1] };
    }
    if (all.length === 4) {
      const gridIdx = all.findIndex((u) => /grid|composite|四宫|_0_0|\/0_0[./]|\/split\//i.test(String(u))
        && !/_[0-3]\.(jpe?g|webp|png)(?:\?|$)/i.test(String(u)));
      if (gridIdx >= 0) {
        const composite = all[gridIdx];
        const tiles = all.filter((_, i) => i !== gridIdx).slice(0, 4);
        return { composite, tiles, primary: composite || tiles[0] };
      }
      return { composite: null, tiles: all, primary: all[0] };
    }
    return { composite: all[0], tiles: all, primary: all[0] };
  }

  function resolveMjPollImages(poll) {
    const imageUrl = poll?.data?.imageUrl || '';
    const extras = getPollExtraImageUrls(poll, imageUrl);
    const CG = window.PromptHubCardGallery;
    if (Array.isArray(poll?.data?.mjGalleryUrls) && poll.data.mjGalleryUrls.length) {
      const gallery = poll.data.mjGalleryUrls.filter(Boolean).slice(0, CG?.MAX || 5);
      const composite = poll.data.mjCompositeUrl || null;
      const tiles = Array.isArray(poll.data.mjGridUrls) && poll.data.mjGridUrls.length
        ? poll.data.mjGridUrls.filter(Boolean).slice(0, 4)
        : (composite && gallery[0] === composite ? gallery.slice(1, 5) : gallery.slice(0, 4));
      return {
        composite,
        tiles,
        primary: gallery[0] || imageUrl,
        gallery
      };
    }
    if (Array.isArray(poll?.data?.mjGridUrls) && poll.data.mjGridUrls.length) {
      const tiles = poll.data.mjGridUrls.filter(Boolean);
      const composite = poll.data.mjCompositeUrl || null;
      const gallery = CG?.buildMjCardImages?.(composite, tiles, imageUrl || tiles[0])
        || (composite ? [composite, ...tiles] : tiles);
      return {
        composite,
        tiles,
        primary: gallery[0] || imageUrl,
        gallery
      };
    }
    const parsed = parseMjImagineUrls(imageUrl, extras);
    const gallery = CG?.buildMjCardImages?.(parsed.composite, parsed.tiles, parsed.primary)
      || (parsed.tiles.length ? parsed.tiles : parsed.primary ? [parsed.primary] : []);
    return { ...parsed, gallery };
  }

  function buildMjFilmstripHtml(urls, activeIdx = 0) {
    const list = (urls || []).filter((u) => u).slice(0, window.PromptHubCardGallery?.MAX || 5);
    if (!list.length) return '';
    const idx = Math.max(0, Math.min(Number(activeIdx) || 0, list.length - 1));
    const ph = (window.IMG_LOADING_PLACEHOLDER || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3C/svg%3E');
    const thumbs = list
      .map(
        (u, i) =>
          `<button type="button" class="imagegen-mj-strip-thumb${i === idx ? ' active' : ''}" data-mj-strip-idx="${i}" aria-label="第 ${i + 1} 张">
            <img src="${esc(ph)}" data-mj-ref="${esc(u)}" alt="" loading="lazy" decoding="async">
          </button>`
      )
      .join('');
    const prevDisabled = idx <= 0 ? ' disabled' : '';
    const nextDisabled = idx >= list.length - 1 ? ' disabled' : '';
    return `<div class="imagegen-mj-filmstrip" data-mj-strip-active="${idx}" data-mj-strip-count="${list.length}">
      <div class="imagegen-mj-filmstrip-stage">
        <button type="button" class="imagegen-mj-filmstrip-nav imagegen-mj-filmstrip-prev" data-mj-strip-nav="-1"${prevDisabled} aria-label="上一张">‹</button>
        <button type="button" class="imagegen-mj-filmstrip-main" data-mj-strip-main title="点击全屏查看">
          <img src="${esc(ph)}" data-mj-ref="${esc(list[idx])}" alt="" decoding="async">
        </button>
        <button type="button" class="imagegen-mj-filmstrip-nav imagegen-mj-filmstrip-next" data-mj-strip-nav="1"${nextDisabled} aria-label="下一张">›</button>
      </div>
      <div class="imagegen-mj-filmstrip-meta">
        <span class="imagegen-mj-filmstrip-counter">${idx + 1} / ${list.length}</span>
        <div class="imagegen-mj-filmstrip-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-mj-strip-dl>下载当前</button>
        </div>
      </div>
      <div class="imagegen-mj-filmstrip-thumbs" role="tablist" aria-label="切换单图">${thumbs}</div>
    </div>`;
  }

  function bindMjFilmstripPreview(body, urls, previewCtx) {
    const list = (urls || []).filter(Boolean).slice(0, window.PromptHubCardGallery?.MAX || 5);
    if (!body || !list.length) return;
    const strip = body.querySelector('.imagegen-mj-filmstrip');
    if (!strip) return;
    if (strip.dataset.mjFilmstripBound === '1') {
      strip.__mjUrlList = list;
      strip.__mjRenderAt?.(Number(strip.dataset.mjStripActive) || 0);
      return;
    }
    strip.dataset.mjFilmstripBound = '1';
    strip.__mjUrlList = list;
    const urlCache = new Map();
    let loadGen = 0;

    const resolveRef = (ref, galleryIndex) => {
      const cacheKey = `${galleryIndex}:${String(ref || '')}`;
      if (urlCache.has(cacheKey)) return Promise.resolve(urlCache.get(cacheKey));
      const isCover = galleryIndex <= 0;
      const p = window.PromptHubCardGallery?.resolveMediaUrl?.(ref, {
        cardId: previewCtx?.cardId,
        jobId: previewCtx?.parentJobId,
        galleryIndex,
        useJobImageApi: isCover,
        allowGridFallback: isCover,
        preferFull: true
      }) || Promise.resolve(ref);
      return Promise.resolve(p).then((src) => {
        const u = src && typeof src === 'string' ? src : '';
        if (u && !/data:image\/svg/i.test(u)) urlCache.set(cacheKey, u);
        return u;
      });
    };

    const prefetchAround = (idx) => {
      const refs = strip.__mjUrlList || list;
      for (const i of [idx - 1, idx + 1, idx + 2]) {
        if (i < 0 || i >= refs.length) continue;
        const key = `${i}:${String(refs[i] || '')}`;
        if (urlCache.has(key)) continue;
        void resolveRef(refs[i], i);
      }
    };

    const applyMainSrc = (mainImg, src, idx) => {
      if (!mainImg || !src || strip.dataset.mjStripActive !== String(idx)) return;
      const stage = strip.querySelector('.imagegen-mj-filmstrip-main');
      const done = () => {
        if (strip.dataset.mjStripActive !== String(idx)) return;
        stage?.classList.remove('is-switching');
        mainImg.classList.remove('is-switching');
        body.dataset.previewImageReady = '1';
        body.dataset.previewImageUrl = src;
      };
      if (mainImg.dataset.mjLoadedSrc === src && mainImg.complete && mainImg.naturalWidth > 8) {
        done();
        return;
      }
      stage?.classList.add('is-switching');
      mainImg.classList.add('is-switching');
      mainImg.onload = null;
      mainImg.onerror = null;
      mainImg.onload = () => {
        if (strip.dataset.mjStripActive !== String(idx)) return;
        mainImg.onload = null;
        mainImg.onerror = null;
        mainImg.dataset.mjLoadedSrc = src;
        done();
      };
      mainImg.onerror = () => {
        mainImg.onload = null;
        mainImg.onerror = null;
        if (strip.dataset.mjStripActive !== String(idx)) return;
        stage?.classList.remove('is-switching');
        mainImg.classList.remove('is-switching');
      };
      mainImg.src = src;
    };

    function renderAt(nextIdx) {
      const refs = strip.__mjUrlList || list;
      const idx = Math.max(0, Math.min(nextIdx, refs.length - 1));
      loadGen += 1;
      const myGen = loadGen;
      strip.dataset.mjStripActive = String(idx);
      const mainImg = strip.querySelector('.imagegen-mj-filmstrip-main img');
      const counter = strip.querySelector('.imagegen-mj-filmstrip-counter');
      if (counter) counter.textContent = `${idx + 1} / ${refs.length}`;
      strip.querySelectorAll('.imagegen-mj-strip-thumb').forEach((btn, i) => {
        btn.classList.toggle('active', i === idx);
      });
      const prev = strip.querySelector('.imagegen-mj-filmstrip-prev');
      const next = strip.querySelector('.imagegen-mj-filmstrip-next');
      if (prev) prev.disabled = idx <= 0;
      if (next) next.disabled = idx >= refs.length - 1;
      const ref = refs[idx];
      body.dataset.previewImageUrl = ref;
      delete body.dataset.previewImageReady;
      const cacheKey = `${idx}:${String(ref || '')}`;
      const cached = urlCache.get(cacheKey);
      if (cached && mainImg) applyMainSrc(mainImg, cached, idx);
      else if (mainImg) mainImg.classList.add('is-switching');
      void resolveRef(ref, idx).then((src) => {
        if (myGen !== loadGen || strip.dataset.mjStripActive !== String(idx)) return;
        if (mainImg && src) applyMainSrc(mainImg, src, idx);
        prefetchAround(idx);
      });
      strip.querySelectorAll('.imagegen-mj-strip-thumb img').forEach((thumb, i) => {
        const thumbRef = refs[i];
        const tKey = `${i}:${String(thumbRef || '')}`;
        const hit = urlCache.get(tKey);
        if (hit && thumb) {
          thumb.src = hit;
          thumb.dataset.mjLoadedSrc = hit;
          return;
        }
        void resolveRef(thumbRef, i).then((src) => {
          if (!src || !thumb || strip.dataset.mjStripActive === undefined) return;
          thumb.src = src;
          thumb.dataset.mjLoadedSrc = src;
        });
      });
    }

    strip.querySelectorAll('[data-mj-strip-nav]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = Number(btn.dataset.mjStripNav) || 0;
        const cur = Number(strip.dataset.mjStripActive) || 0;
        renderAt(cur + delta);
      });
    });
    strip.querySelectorAll('[data-mj-strip-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderAt(Number(btn.dataset.mjStripIdx) || 0);
      });
    });
    strip.querySelector('[data-mj-strip-main]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(strip.dataset.mjStripActive) || 0;
      const ref = list[idx];
      if (!ref || typeof window.openLightbox !== 'function') return;
      void resolveRef(ref, idx).then((src) => {
        window.openLightbox(src || ref, {
          imageGen: true,
          feedKey: previewCtx?.feedKey || '',
          cardId: previewCtx?.cardId || '',
          mjGalleryUrls: list,
          mjGalleryIndex: idx,
          mjJobId: previewCtx?.parentJobId || ''
        });
      });
    });
    strip.querySelector('[data-mj-strip-dl]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(strip.dataset.mjStripActive) || 0;
      const ref = list[idx];
      if (!ref) return;
      const mainImg = strip.querySelector('.imagegen-mj-filmstrip-main img');
      const dlBtn = strip.querySelector('[data-mj-strip-dl]');
      const baseJob = previewCtx?.parentJobId ? String(previewCtx.parentJobId).replace(/#\d+$/, '') : null;
      const slotJobId = baseJob && window.PromptHubCardGallery?.gallerySlotJobId
        ? window.PromptHubCardGallery.gallerySlotJobId(baseJob, idx)
        : previewCtx?.parentJobId || null;
      if (previewCtx?.cardId && typeof window.downloadCardImageFile === 'function') {
        void window.downloadCardImageFile(ref, previewCtx.cardId, `mj-${idx + 1}.png`, {
          triggerBtn: dlBtn,
          galleryIndex: idx,
          jobId: slotJobId,
          previewImg: mainImg
        });
        return;
      }
      void resolveRef(ref, idx).then(async (src) => {
        const url = src || ref;
        if (!url) return;
        try {
          if (typeof window.promptHubSaveImage === 'function') {
            await window.promptHubSaveImage(url, `mj-${idx + 1}.png`, mainImg);
          } else {
            await downloadImageFromUrl(url, `mj-${idx + 1}.png`);
            return;
          }
          toast('下载完成');
        } catch (err) {
          toast('下载失败，请稍后重试');
        }
      });
    });
    strip.__mjRenderAt = renderAt;
    renderAt(Number(strip.dataset.mjStripActive) || 0);
  }

  /** @deprecated 保留供旧预览路径；新预览用 buildMjFilmstripHtml */
  function buildMjGridPreviewHtml(urls) {
    return buildMjFilmstripHtml(urls, 0);
  }

  function imageGenModelsInFamily(family) {
    if (!imageGenModelsByFamilyCache) {
      imageGenModelsByFamilyCache = {};
      for (const f of IMAGE_GEN_MODEL_FAMILIES) {
        imageGenModelsByFamilyCache[f.key] = [...imageGenModelCatalog]
          .filter((m) => imageGenModelUiFamily(m) === f.key && m.status !== 'offline')
          .sort((a, b) => imageGenModelSortKey(a) - imageGenModelSortKey(b));
      }
    }
    return imageGenModelsByFamilyCache[family] || [];
  }

  function resolveImageGenModelFamily(preferredFamily, modelId) {
    const families = IMAGE_GEN_MODEL_FAMILIES.filter((f) => imageGenModelsInFamily(f.key).length);
    const keys = families.map((f) => f.key);
    if (preferredFamily && keys.includes(preferredFamily)) return preferredFamily;
    const fromModel = imageGenModelCatalog.find((m) => m.id === modelId);
    if (fromModel) {
      const fam = imageGenModelUiFamily(fromModel);
      if (keys.includes(fam)) return fam;
    }
    return keys.includes('gim2') ? 'gim2' : keys[0] || 'gim2';
  }

  function bindImageGenModelFamilyTabs() {
    if (imageGenFamilyTabsBound) return;
    const host = document.getElementById('imageGenModelFamilyTabs');
    if (!host) return;
    imageGenFamilyTabsBound = true;
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-family]');
      if (!btn || btn.classList.contains('active')) return;
      imageGenModelFamily = btn.dataset.family || 'gim2';
      updateImageGenModelFamilyTabsActive();
      renderImageGenModelSelect({ keepModel: false, family: imageGenModelFamily });
    });
  }

  function updateImageGenModelFamilyTabsActive() {
    document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').forEach((btn) => {
      const active = btn.dataset.family === imageGenModelFamily;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function rebuildImageGenModelFamilyTabs() {
    const host = document.getElementById('imageGenModelFamilyTabs');
    if (!host) return;
    const families = IMAGE_GEN_MODEL_FAMILIES.filter((f) => imageGenModelsInFamily(f.key).length);
    if (!families.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    imageGenModelFamily = resolveImageGenModelFamily(imageGenModelFamily);
    host.innerHTML = families
      .map(
        (f) =>
          `<button type="button" class="imagegen-model-family-tab${imageGenModelFamily === f.key ? ' active' : ''}" data-family="${f.key}" role="tab" aria-selected="${imageGenModelFamily === f.key ? 'true' : 'false'}">${f.label}</button>`
      )
      .join('');
  }

  function renderImageGenModelFamilyTabs() {
    rebuildImageGenModelFamilyTabs();
  }

  function imageGenModelSortKey(m) {
    const n = Number(m?.sortOrder);
    return Number.isFinite(n) ? n : 9999;
  }

  function renderImageGenModelSelect(opts = {}) {
    const sel = document.getElementById('imageGenModel');
    if (!sel || !imageGenModelCatalog.length) return;
    sel.disabled = false;
    sel.setAttribute('aria-busy', 'false');
    const draft = loadJson(LS_IMAGEGEN, null);
    const current = opts.modelId || sel.value || draft?.model || 'gpt-image-2';
    imageGenModelFamily = resolveImageGenModelFamily(
      opts.family ?? imageGenModelFamily ?? draft?.modelFamily,
      current
    );
    updateImageGenModelFamilyTabsActive();
    const list = imageGenModelsInFamily(imageGenModelFamily);
    const nextHtml = list
      .map((m) => {
        const name = imageGenModelDisplayName(m);
        let text = m.refundOnViolation ? name : `${name} · 违规不返还`;
        if (m.status === 'maintenance' || m.selectable === false) {
          text = `${name}（维护中）`;
        }
        const disabled = m.status === 'maintenance' || m.selectable === false ? ' disabled' : '';
        return `<option value="${esc(m.id)}"${disabled}>${esc(text)}</option>`;
      })
      .join('');
    if (sel.dataset.optionsHtml !== nextHtml) {
      sel.innerHTML = nextHtml;
      sel.dataset.optionsHtml = nextHtml;
    }
    const selectable = list.filter((m) => m.selectable !== false && m.status !== 'maintenance');
    const keepModel = opts.keepModel !== false;
    const pick =
      keepModel && [...sel.options].some((o) => o.value === current && !o.disabled)
        ? current
        : selectable[0]?.id || list[0]?.id || 'gpt-image-2';
    if (sel.value !== pick) sel.value = pick;
    if (!opts.skipUiRefresh) scheduleImageGenModelUiRefresh();
  }

  function syncImageGenModelHint() {
    const hint = document.getElementById('imageGenModelHint');
    const sel = document.getElementById('imageGenModel');
    if (!hint || !sel) return;
    const m = imageGenModelCatalog.find((x) => x.id === sel.value);
    if (m?.status === 'maintenance' || m?.selectable === false) {
      hint.textContent = m.statusNotice || '该模型维护中，请换用其他模型';
      hint.hidden = false;
    } else if (m?.violationNotice) {
      hint.textContent = m.violationNotice;
      hint.hidden = false;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }

  function normalizeImageGenResolution(res) {
    const r = String(res || '1k').toLowerCase();
    return ['1k', '2k', '4k'].includes(r) ? r : '1k';
  }

  /** 木瓜等分档模型：切分辨率时自动换到支持该档的 model id */
  function resolveImageGenModelForResolution(modelId, resolution) {
    const res = normalizeImageGenResolution(resolution);
    const id = normalizeImageGenModelId(modelId);
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    if (!entry) return id;
    const supported = entry.resolutions?.length ? entry.resolutions : ['1k', '2k', '4k'];
    if (supported.includes(res)) return id;
    if (id === 'mooko-gpt-image-2-pro' && res === '1k') return 'mooko-gpt-image-2-pro';
    if (id === 'mooko-gpt-image-2') return 'mooko-gpt-image-2-pro';
    const family = imageGenModelUiFamily(entry);
    const provider = entry.provider;
    const hit = imageGenModelCatalog.find(
      (m) =>
        imageGenModelUiFamily(m) === family
        && m.provider === provider
        && (m.resolutions || []).includes(res)
        && m.selectable !== false
        && m.status !== 'maintenance'
    );
    return hit?.id || id;
  }

  function syncImageGenModelToResolution() {
    const resSel = document.getElementById('imageGenResolution');
    const modelSel = document.getElementById('imageGenModel');
    if (!resSel || !modelSel) return;
    const res = normalizeImageGenResolution(resSel.value);
    const nextModel = resolveImageGenModelForResolution(modelSel.value, res);
    if (nextModel && nextModel !== modelSel.value) {
      modelSel.value = nextModel;
      syncImageGenModelHint();
    }
  }

  function getImageGenFormMeta() {
    const rawRes = document.getElementById('imageGenResolution')?.value || '1k';
    const mjParams = getImageGenMjParams();
    return {
      model: getImageGenModel(),
      resolution: normalizeImageGenResolution(rawRes),
      quality: getImageGenQuality(),
      size: document.getElementById('imageGenSize')?.value || '1:1',
      ...(mjParams ? { mjParams } : {})
    };
  }

  const IMAGE_GEN_SIZE_LABELS = {
    auto: '自动',
    '1:1': '正方形 1∶1',
    '16:9': '横屏 16∶9',
    '9:16': '竖屏 9∶16',
    '4:3': '横屏 4∶3',
    '3:4': '竖屏 3∶4',
    '3:2': '横屏 3∶2',
    '2:3': '竖屏 2∶3',
    '5:4': '横屏 5∶4',
    '4:5': '竖屏 4∶5',
    '21:9': '超宽 21∶9',
    '9:21': '超高 9∶21',
    '2:1': '横屏 2∶1',
    '1:2': '竖屏 1∶2',
    '3:1': '超宽 3∶1',
    '1:3': '超高 1∶3',
    '1:4': '超高 1∶4',
    '4:1': '超宽 4∶1',
    '1:8': '超高 1∶8',
    '8:1': '超宽 8∶1'
  };
  const IMAGE_GEN_SIZE_BASIC = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  const IMAGE_GEN_SIZE_BANANA = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
  const IMAGE_GEN_SIZE_BANANA2_EXTRA = ['1:4', '4:1', '1:8', '8:1'];
  const IMAGE_GEN_SIZE_GIM2 = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'];
  /** 离线兜底：与 server aspectRatiosForModel 一致 */
  const IMAGE_GEN_SIZE_MJ = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const IMAGE_GEN_SIZE_WAN = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const IMAGE_GEN_SIZE_FLUX_KONTEXT = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'];
  const IMAGE_GEN_SIZE_FLUX2 = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
  const IMAGE_GEN_ASPECT_FALLBACK = {
    'apimart-gpt-image-2-official-budget': ['16:9', '9:16', '4:3', '3:4'],
    'mooko-gpt-image-2-pro': ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'],
    'apimart-gpt-image-2': IMAGE_GEN_SIZE_BASIC,
    'ithink-gpt-image-2-slow': IMAGE_GEN_SIZE_BASIC,
    'gpt-image-2-vip': IMAGE_GEN_SIZE_GIM2,
    'gpt-image-2': IMAGE_GEN_SIZE_GIM2,
    'apimart-gpt-image-2': IMAGE_GEN_SIZE_GIM2,
    'apimart-mj-v61': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-v81': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-v7': IMAGE_GEN_SIZE_MJ,
    'apimart-mj-niji7': IMAGE_GEN_SIZE_MJ,
    'apimart-wan2-7-image': IMAGE_GEN_SIZE_WAN,
    'apimart-wan2-7-image-pro': IMAGE_GEN_SIZE_WAN,
    'apimart-flux-kontext-pro': IMAGE_GEN_SIZE_FLUX_KONTEXT,
    'apimart-flux-kontext-max': IMAGE_GEN_SIZE_FLUX_KONTEXT,
    'apimart-flux-2-pro': IMAGE_GEN_SIZE_FLUX2,
    'apimart-flux-2-flex': IMAGE_GEN_SIZE_FLUX2,
    'apimart-gemini-2-5-flash-preview': IMAGE_GEN_SIZE_BANANA,
    'apimart-gemini-3-1-flash-preview': IMAGE_GEN_SIZE_BANANA,
    'apimart-gemini-3-pro-preview': IMAGE_GEN_SIZE_BANANA
  };
  const BANANA2_EXTENDED_MODELS = new Set(['nano-banana-2', 'nano-banana-2-cl', 'nano-banana-2-4k-cl']);
  const IMAGE_GEN_SAVE_TARGET_LS = 'promptHub.imageGenSaveTarget.v1';

  function imageGenSizeOptionLabel(value) {
    return IMAGE_GEN_SIZE_LABELS[value] || String(value || '1:1');
  }

  function imageGenModelHidesQuality(modelId) {
    const id = normalizeImageGenModelId(modelId);
    if (isImageGenMidjourneyModel(id)) return true;
    const entry = imageGenModelCatalog.find((m) => m.id === id);
    return !!entry?.fixedQualityLow;
  }

  function imageGenModelHidesResolution(modelId) {
    const id = normalizeImageGenModelId(modelId);
    return id.startsWith('apimart-flux-kontext');
  }

  function isImageGenMjSaveAllTiles() {
    return false;
  }

  function getImageGenMjSpeed() {
    const v = document.getElementById('imageGenMjSpeedSelect')?.value;
    if (v === 'fast' || v === 'turbo') return v;
    return '';
  }

  const MJ_EXTRA_ALLOWED = ['', 'tile', 'raw', 'draft', 'hd', 'tile+raw'];

  function collectImageGenDraftMeta() {
    return {
      prompt: document.getElementById('imageGenPrompt')?.value || '',
      model: getImageGenModel(),
      refImages: getImageGenRefImages(),
      refImage: getImageGenPrimaryRef(),
      resolution: normalizeImageGenResolution(document.getElementById('imageGenResolution')?.value || '1k'),
      quality: getImageGenQuality(),
      size: document.getElementById('imageGenSize')?.value || '',
      count: getImageGenBatchCount(),
      cardTitle: getImageGenCardTitle(),
      batchSplit: isImageGenBatchSplitCards(),
      mjMode: getImageGenMjMode(),
      mjSaveAllTiles: isImageGenMjSaveAllTiles(),
      mjSpeed: getImageGenMjSpeed(),
      mjExtras: getImageGenMjExtrasValue()
    };
  }

  function persistImageGenFormDraft() {
    saveImageGenDraft(collectImageGenDraftMeta());
  }

  function getImageGenMjExtrasValue() {
    return document.getElementById('imageGenMjExtrasSelect')?.value || '';
  }

  function setImageGenMjExtrasValue(v) {
    const sel = document.getElementById('imageGenMjExtrasSelect');
    if (!sel) return;
    const val = MJ_EXTRA_ALLOWED.includes(v) ? v : '';
    sel.value = val;
  }

  function getImageGenMjExtrasFlags() {
    const v = getImageGenMjExtrasValue();
    return {
      tile: v === 'tile' || v === 'tile+raw',
      raw: v === 'raw' || v === 'tile+raw',
      draft: v === 'draft',
      hd: v === 'hd'
    };
  }

  function getImageGenMaxRefImages() {
    if (isImageGenMidjourneyModel(getImageGenModel())) {
      return getImageGenMjMode() === 'blend' ? 5 : 4;
    }
    return 16;
  }

  function syncImageGenRefLimitHint() {
    const hint = document.getElementById('imageGenRefLimitHint');
    if (!hint) return;
    const max = getImageGenMaxRefImages();
    const isMj = isImageGenMidjourneyModel(getImageGenModel());
    if (!isMj) {
      hint.hidden = true;
      hint.textContent = '';
      return;
    }
    hint.hidden = false;
    hint.textContent = getImageGenMjMode() === 'blend'
      ? '混图模式：参考图 2～5 张'
      : 'MJ 图生图：参考图最多 4 张（与 APIMart 一致）';
  }

  function trimImageGenRefsToLimit() {
    const max = getImageGenMaxRefImages();
    const refs = getImageGenRefImages();
    if (refs.length <= max) return;
    setImageGenRefs(refs.slice(0, max));
    toast(`Midjourney 参考图最多 ${max} 张，已保留前 ${max} 张`);
  }

  function syncImageGenMjToggleCheckedClasses() {
    /* 旧版卡片式开关已改为下拉框 */
  }

  function persistImageGenMjPrefs() {
    persistImageGenFormDraft();
  }

  function getImageGenMjMode() {
    return imageGenMjMode === 'blend' ? 'blend' : 'imagine';
  }

  function setImageGenMjMode(mode) {
    imageGenMjMode = mode === 'blend' ? 'blend' : 'imagine';
    document.querySelectorAll('[data-mj-mode]').forEach((btn) => {
      const active = btn.dataset.mjMode === imageGenMjMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    syncImageGenMjModeUI();
    persistImageGenMjPrefs();
  }

  function syncImageGenMjModeUI() {
    const blend = getImageGenMjMode() === 'blend';
    const blendHint = document.getElementById('imageGenMjBlendHint');
    const imagineFields = document.getElementById('imageGenMjImagineFields');
    if (blendHint) blendHint.classList.toggle('hidden', !blend);
    if (imagineFields) imagineFields.classList.toggle('hidden', blend);
    const countWrap = document.querySelector('.imagegen-footer-count');
    if (countWrap) countWrap.classList.toggle('hidden', blend);
    syncImageGenBatchSplitUi();
    syncImageGenRefLimitHint();
    trimImageGenRefsToLimit();
    updateImageGenCostHint();
  }

  function syncImageGenModelParamsUI(opts = {}) {
    const modelId = normalizeImageGenModelId(opts.modelId || getImageGenModel());
    const family = opts.family || imageGenModelFamily || imageGenModelUiFamily({ id: modelId });
    const isMj = family === 'midjourney';
    const shell = document.getElementById('imageGenSharedParams') || document.querySelector('.imagegen-shared-params');
    if (shell) {
      shell.classList.toggle('imagegen-params--mj', isMj);
      shell.dataset.modelFamily = family;
    }
    const panel = document.getElementById('imageGenMjParams');
    if (panel) {
      if (isMj) {
        panel.classList.remove('hidden');
        panel.hidden = false;
      } else {
        panel.classList.add('hidden');
        panel.hidden = true;
      }
    }
    const resParam = document.querySelector('.imagegen-param[data-param="resolution"]');
    const resLabel = document.querySelector('label[for="imageGenResolution"]');
    const hideResolution = isMj || imageGenModelHidesResolution(modelId);
    for (const el of [resParam, resLabel]) {
      if (el) el.hidden = hideResolution;
    }
    const sizeRow = document.querySelector('.imagegen-params-row--size');
    if (sizeRow) sizeRow.classList.toggle('imagegen-params-row--mj-size', isMj);
    const sizeLabel = document.querySelector('label[for="imageGenSize"]');
    if (sizeLabel) sizeLabel.textContent = isMj ? '宽高比' : '画面尺寸';
    const hideQuality = isMj || imageGenModelHidesQuality(modelId);
    const qEl = document.getElementById('imageGenQuality');
    const qLabel = document.querySelector('label[for="imageGenQuality"]');
    const qNote = document.querySelector('.imagegen-quality-note');
    for (const el of [qLabel, qEl, qNote]) {
      if (el) el.hidden = hideQuality;
    }
    if (isMj) {
      updateImageGenSizeSelect();
      syncImageGenMjModeUI();
      syncImageGenMjToggleCheckedClasses();
      syncImageGenRefLimitHint();
      trimImageGenRefsToLimit();
    } else {
      syncImageGenRefLimitHint();
    }
  }

  function syncImageGenMjParamsUI() {
    syncImageGenModelParamsUI();
  }

  function bindImageGenMjExtras() {
    const sel = document.getElementById('imageGenMjExtrasSelect');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', persistImageGenMjPrefs);
  }

  function bindImageGenCardTitle() {
    const el = document.getElementById('imageGenCardTitle');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('input', () => persistImageGenFormDraft());
  }

  function bindImageGenMjRange(id, valId) {
    const input = document.getElementById(id);
    const valEl = document.getElementById(valId);
    if (!input || !valEl) return;
    const sync = () => {
      valEl.textContent = input.value;
    };
    input.addEventListener('input', sync);
    sync();
  }

  function getImageGenMjParams() {
    if (!isImageGenMidjourneyModel(getImageGenModel())) return undefined;
    const stylize = Number(document.getElementById('imageGenMjStylize')?.value);
    const chaos = Number(document.getElementById('imageGenMjChaos')?.value);
    const weird = Number(document.getElementById('imageGenMjWeird')?.value);
    const iw = Number(document.getElementById('imageGenMjIw')?.value);
    const quality = document.getElementById('imageGenMjQuality')?.value || '';
    const style = document.getElementById('imageGenMjStyle')?.value || '';
    const negativePrompt = String(document.getElementById('imageGenMjNegative')?.value || '').trim();
    const out = {};
    if (Number.isFinite(stylize) && stylize !== 100) out.stylize = stylize;
    if (Number.isFinite(chaos) && chaos > 0) out.chaos = chaos;
    if (Number.isFinite(weird) && weird > 0) out.weird = weird;
    if (Number.isFinite(iw) && iw !== 1) out.iw = iw;
    if (quality) out.quality = quality;
    if (style) out.style = style;
    if (negativePrompt) out.negativePrompt = negativePrompt;
    const mjExtras = getImageGenMjExtrasFlags();
    if (mjExtras.tile) out.tile = true;
    if (mjExtras.raw) out.raw = true;
    if (mjExtras.draft) out.draft = true;
    if (mjExtras.hd) out.hd = true;
    const speed = getImageGenMjSpeed();
    out.speed = speed === 'fast' || speed === 'turbo' ? speed : 'relax';
    return out;
  }

  function filterMjPreviewButtons(buttons) {
    return (buttons || []).filter((b) => {
      const action = String(b?.action || '').toLowerCase();
      if (action === 'upscale') return false;
      const custom = String(b?.customId || '');
      if (/upsample|upscale/i.test(custom)) return false;
      const label = String(b?.label || '');
      if (/^放大\s*[1-4]?/.test(label)) return false;
      return true;
    });
  }

  function isMjBillableAction(action) {
    const a = String(action || '').toLowerCase();
    if (!a || a === 'custom' || a === 'upscale' || a === 'describe') return false;
    return true;
  }

  function getMjActionHint(action) {
    const a = String(action || '').toLowerCase();
    const hints = {
      variation: '基于当前图生成新的四宫格变体，完成后追加到原卡片',
      high_variation: '较大改动的新变体（四宫格）',
      low_variation: '轻微改动的新变体（四宫格）',
      reroll: '用相同提示词重新生成一批四宫格',
      pan: '向指定方向平移扩展画面，保留主体内容',
      zoom: '缩小视角向外扩展画幅（Zoom Out）',
      inpaint:
        '局部重绘：只改选定区域。本页点击后会直接提交任务（暂不支持在此画选区），扣积分等同一次生图',
      remix_strong: '强重塑：在现有构图上做较大改动',
      remix_subtle: '弱重塑：在现有构图上做较小改动',
      video: '基于当前图生成短视频',
      modal: '提交遮罩，完成局部重绘的第二步',
      edits: '对图片进行编辑',
      blend: '混图融合'
    };
    return hints[a] || 'Midjourney 二次操作，扣积分等同一次生图';
  }

  function getMjActionUnitCost(previewCard) {
    const model = previewCard?.model || getImageGenModel();
    const speed = getImageGenMjSpeed();
    const detail = window.PointsSystem?.getImageGenCostDetail?.(model, '1k', speed);
    if (detail?.final != null) return detail.final;
    return window.PointsSystem?.getImageGenCost?.(model, '1k') ?? null;
  }

