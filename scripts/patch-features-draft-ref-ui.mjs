/**
 * 从 features-draft.js 移除已迁入 imagegen-ref-ui.js 的参考图 UI 块，插入薄代理。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let code = readFileSync(join(root, 'features-draft.js'), 'utf8');

const startMark = '  function readFileAsDataUrl(file) {';
const endMark = '  function isUsableGenRefUrl(url) {';
const start = code.indexOf(startMark);
const end = code.indexOf(endMark);
if (start < 0 || end < 0 || end <= start) {
  console.error('patch-features-draft-ref-ui FAIL: markers not found', start, end);
  process.exit(1);
}

const endFn = code.indexOf('\n  async function resolveRefUrlsFromList', end);
if (endFn < 0) {
  console.error('patch-features-draft-ref-ui FAIL: resolveRefUrlsFromList not found');
  process.exit(1);
}

const proxyBlock = `  function getImageGenRefImages() { return ru('getImageGenRefImages') || []; }
  function getImageGenPrimaryRef() { return ru('getImageGenPrimaryRef') || null; }
  function setImageGenRefs(urls, opts) { return ru('setImageGenRefs', urls, opts); }
  function clearImageGenRef() { return ru('clearImageGenRef'); }
  async function resolveRefDisplayUrl(ref, opts) { return ru('resolveRefDisplayUrl', ref, opts) || ''; }
  function addImageGenRefFromFeed(payload) { return ru('addImageGenRefFromFeed', payload); }
  function bindImageGenUpload() { return ru('bindImageGenUpload'); }
  function bindImageGenPromptTools() { return ru('bindImageGenPromptTools'); }
  function renderImageGenRefGallery() { return ru('renderImageGenRefGallery'); }

`;

code = code.slice(0, start) + proxyBlock + code.slice(endFn);

code = code.replace(
  `  const MAX_REF_IMAGES = 16;
  /** 参考图展示解析时附带卡片 id（从仓库填入时提高 storage:// 命中率） */
  let imageGenRefResolveAssetId = '';
  const REF_INPUT_MAX_BYTES = 50 * 1024 * 1024;
  const REF_AUTO_COMPRESS_BYTES = 12 * 1024 * 1024;
  const REF_TARGET_MAX_BYTES = 8 * 1024 * 1024;
  const REF_MAX_SIDE = 2560;
  const REF_THUMB_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect fill="#2a2a2e" width="100%" height="100%" rx="6"/></svg>'
  );
  let imageGenRefImages = [];
`,
  `  const REF_TARGET_MAX_BYTES = 8 * 1024 * 1024;
  const REF_MAX_SIDE = 2560;
`
);

code = code.replace(
  `  function getImageGenPrimaryRef() {
    return imageGenRefImages[0] || null;
  }

`,
  ''
);

code = code.replace(
  `    if (imageGenRefImages.length) {
      parts.push(\`参考图 \${imageGenRefImages.length} 张\`);
    }`,
  `    const refCount = getImageGenRefImages().length;
    if (refCount) {
      parts.push(\`参考图 \${refCount} 张\`);
    }`
);

code = code.replace(
  `    imageGenRefResolveAssetId = refAssetId ? String(refAssetId) : '';
    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const singleRef = refImage && isDisplayableImage(refImage) ? refImage : null;
    if (refs.length) setImageGenRefs(refs);
    else if (singleRef) setImageGenRefs([singleRef]);
    else clearImageGenRef();`,
  `    const refs = (refImages || []).filter(r => isDisplayableImage(r));
    const singleRef = refImage && isDisplayableImage(refImage) ? refImage : null;
    const assetId = refAssetId ? String(refAssetId) : '';
    if (refs.length) setImageGenRefs(refs, { assetId });
    else if (singleRef) setImageGenRefs([singleRef], { assetId });
    else clearImageGenRef();`
);

code = code.replace(
  `    imageGenRefResolveAssetId = opts?.assetId ? String(opts.assetId) : '';
    const refs = (opts?.refImages || []).filter((r) => isDisplayableImage(r));
    const single = opts?.refImage && isDisplayableImage(opts.refImage) ? opts.refImage : null;
    if (refs.length) setImageGenRefs(refs);
    else if (single) setImageGenRefs([single]);
    else clearImageGenRef();`,
  `    const refs = (opts?.refImages || []).filter((r) => isDisplayableImage(r));
    const single = opts?.refImage && isDisplayableImage(opts.refImage) ? opts.refImage : null;
    const assetId = opts?.assetId ? String(opts.assetId) : '';
    if (refs.length) setImageGenRefs(refs, { assetId });
    else if (single) setImageGenRefs([single], { assetId });
    else clearImageGenRef();`
);

code = code.replace(
  '    return resolveRefUrlsFromList(imageGenRefImages);',
  '    return resolveRefUrlsFromList(getImageGenRefImages());'
);

if (!code.includes('let _refUi')) {
  code = code.replace(
    '  let _refCompress;\n  let _warehouseSave;',
    '  let _refCompress;\n  let _refUi;\n  let _warehouseSave;'
  );
  code = code.replace(
    `  function rc(name, ...args) {
    const fn = _refCompress?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ws(name, ...args) {`,
    `  function rc(name, ...args) {
    const fn = _refCompress?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ru(name, ...args) {
    const fn = _refUi?.[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function ws(name, ...args) {`
  );

  const wireRefUi = `  function wireImageGenRefUI() {
    if (window.__imageGenRefUiWired) return;
    if (!window.ImageGenRefUI?.init) {
      console.error('[FeatureDraft] pack-imagegen.js not loaded — ImageGenRefUI missing');
      return;
    }
    _refUi = window.ImageGenRefUI.init({
      toast,
      isDisplayableImage,
      updateImageGenCostHint,
      compressRefImageFromSource: (...a) => rc('compressRefImageFromSource', ...a)
    });
    window.__imageGenRefUiWired = true;
  }

`;
  code = code.replace('  function wireImageGenRefCompress() {', wireRefUi + '  function wireImageGenRefCompress() {');
  code = code.replace(
    '    wireImageGenRefCompress();\n    wireImageGenWarehouseSave();',
    '    wireImageGenRefCompress();\n    wireImageGenRefUI();\n    wireImageGenWarehouseSave();'
  );
}

code = code.replace(
  '      getImageGenRefImages: () => imageGenRefImages,',
  '      getImageGenRefImages,'
);
code = code.replace(
  '    getImageGenRefImages: () => [...imageGenRefImages],',
  '    getImageGenRefImages: () => [...getImageGenRefImages()],'
);

code = code.replace(
  '      addImageGenRefFromFeed\n    });',
  '      addImageGenRefFromFeed: (...a) => ru(\'addImageGenRefFromFeed\', ...a)\n    });'
);

writeFileSync(join(root, 'features-draft.js'), code);
console.log('patch-features-draft-ref-ui OK');
