/**
 * 从 features-draft.js 提取参考图 UI 函数，生成 imagegen-ref-ui.js（一次性/可重复跑）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'features-draft.js'), 'utf8');

function extractFn(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('missing ' + name);
  const start = m.index;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== '{') throw new Error('no body for ' + name);
  let j = i;
  depth = 0;
  let started = false;
  while (j < src.length) {
    const ch = src[j++];
    if (ch === '{') {
      depth++;
      started = true;
    } else if (ch === '}') {
      depth--;
      if (started && depth === 0) break;
    }
  }
  return src.slice(start, j);
}

const names = [
  'readFileAsDataUrl',
  'loadRefImageElement',
  'fetchRefImageBlob',
  'resolveRefImageForEdit',
  'prepareRefImageFromFile',
  'resolveRefDisplayUrl',
  'parseImageGenRefDropPayload',
  'addImageGenRefFromFeed',
  'addImageGenRefFiles',
  'removeImageGenRefAt',
  'refAnnotatorLineWidth',
  'drawRefAnnotatorBrush',
  'drawRefAnnotatorCircle',
  'redrawRefAnnotatorCanvas',
  'closeRefImageAnnotator',
  'paintRefAnnotatorStrokesToCtx',
  'bindRefImageAnnotatorOnce',
  'layoutRefAnnotatorCanvas',
  'openRefImageAnnotator',
  'renderImageGenRefGallery',
  'setImageGenRefs',
  'clearImageGenRef',
  'bindImageGenPromptTools',
  'bindImageGenUpload'
];

const fns = names.map((n) => extractFn(code, n));

const header = `/**
 * 生图参考图 UI：上传、画廊、标注器、展示 URL 解析
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  function d() { return deps; }

  const MAX_REF_IMAGES = 16;
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

`;

const footer = `
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
`;

let body = fns.join('\n\n');
body = body.replace(/\btoast\(/g, 'd().toast(');
body = body.replace(/\bisDisplayableImage\(/g, 'd().isDisplayableImage(');
body = body.replace(/\bupdateImageGenCostHint\(\)/g, 'd().updateImageGenCostHint?.()');
body = body.replace(
  /return \{ dataUrl: await compressRefImageFromSource\(blobUrl, REF_MAX_SIDE\), compressed: true \};/,
  'return { dataUrl: await d().compressRefImageFromSource(blobUrl, REF_MAX_SIDE), compressed: true };'
);

// setImageGenRefs: support optional assetId
body = body.replace(
  /function setImageGenRefs\(urls\) \{/,
  'function setImageGenRefs(urls, opts = {}) {'
);
body = body.replace(
  /(function setImageGenRefs\(urls, opts = \{\}\) \{[\s\S]*?)(imageGenRefImages = )/,
  '$1if (opts.assetId != null) imageGenRefResolveAssetId = opts.assetId ? String(opts.assetId) : \'\';\n    $2'
);

const out = header + body + footer;
writeFileSync(join(root, 'imagegen-ref-ui.js'), out);
console.log('build-imagegen-ref-ui OK:', out.length, 'bytes');
