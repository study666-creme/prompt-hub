const fs = require('fs');
const html = fs.readFileSync('d:/prompt-hub/partials/index-body/part-03.html', 'utf8');
const p11 = fs.readFileSync('d:/prompt-hub/legacy/features-draft/part-11.js', 'utf8');
const p12 = fs.readFileSync('d:/prompt-hub/legacy/features-draft/part-12.js', 'utf8');
const css = fs.readFileSync('d:/prompt-hub/styles/features/part-11.css', 'utf8');
const assetStudioHtml = fs.readFileSync('d:/prompt-hub/asset-studio.html', 'utf8');
const assetStudioRuntime = fs.readFileSync('d:/prompt-hub/legacy/asset-studio/part-02.js', 'utf8');

const checks = [
  ['size still in fold', /advanced-fold-body[\s\S]*?id="imageGenSize"/.test(html)],
  ['label 画面比例', html.includes('>画面比例<')],
  ['summary mentions 比例', html.includes('比例、质量、标题与分类')],
  ['not outside fold id', !html.includes('id="imageGenSizeParamsRow"')],
  ['economy fallback filled', /'image2-economy':\s*IMAGE_GEN_SIZE_GIM2/.test(p11)],
  ['custom model combobox markup', html.includes('id="imageGenModelTrigger"') && html.includes('role="combobox"')],
  ['custom model listbox markup', html.includes('id="imageGenModelMenu"') && html.includes('role="listbox"')],
  ['native model select retained only as hidden state', /id="imageGenModel"[^>]*aria-hidden="true"[^>]*hidden/.test(html)],
  ['custom model picker is bound', p11.includes('function bindImageGenModelPicker()')],
  ['custom model picker supports keyboard selection', p11.includes("event.key === 'ArrowDown'") && p11.includes("event.key === 'Enter'")],
  ['model menu stays open while its own list scrolls', p11.includes('if (event.target === menu) return;')],
  ['custom model picker has site styling', css.includes('#pageImageGen .imagegen-model-trigger') && css.includes('#pageImageGen .imagegen-model-menu')],
  ['quality sync fn', p12.includes('syncImageGenQualitySelectOptions')],
  ['quality has three public tiers', p12.includes("const IMAGE_GEN_DEFAULT_QUALITY_OPTIONS = ['low', 'medium', 'high']")],
  ['quality markup has complete tiers', /value="low">低<\/option>[\s\S]*value="medium" selected>中<\/option>[\s\S]*value="high">高<\/option>/.test(html)],
  ['quality standard aliases to middle', p12.includes("standard: '中'")],
  ['legacy quality values normalize before restore', p12.includes('qEl.value = normalizeImageGenQualityOptionValue(quality)')],
  ['quality high label not duplicated as middle', p12.includes("high: '高'") && !p12.includes("high: '中'")],
  ['quality choices ignore model capability', !p12.includes('findImageGenQualityParameter') && !p12.includes('qualityParam?.options')],
  ['quality select always rewrites stale labels', !p12.includes('qEl.dataset.qualityOptions !== key')],
  ['only MJ hides shared quality', /return isImageGenMidjourneyModel\(normalizeImageGenModelId\(modelId\)\);/.test(p11)],
  ['fixed model quality cannot override user choice', !p11.includes('const fixedQuality =')],
  ['asset studio exposes free 1K fallback', assetStudioHtml.includes('<option value="image2-free">全能模型2 · 免费 1K</option>')],
  ['asset studio standard banana label is 1K only', /<option value="lingtu">[^<]*1K<\/option>/.test(assetStudioHtml) && !/<option value="lingtu">[^<]*(?:2K|4K)/.test(assetStudioHtml)],
  ['asset studio fixed 1K fallbacks include standard banana', assetStudioRuntime.includes("['image2', 'image2-free', 'lingtu', 'lingtu-fast', 'lingtu-lite'].includes(modelId)")],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
