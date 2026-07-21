const fs = require('fs');
const html = fs.readFileSync('d:/prompt-hub/partials/index-body/part-03.html', 'utf8');
const p11 = fs.readFileSync('d:/prompt-hub/legacy/features-draft/part-11.js', 'utf8');
const p12 = fs.readFileSync('d:/prompt-hub/legacy/features-draft/part-12.js', 'utf8');

const checks = [
  ['size still in fold', /advanced-fold-body[\s\S]*?id="imageGenSize"/.test(html)],
  ['label 画面比例', html.includes('>画面比例<')],
  ['summary mentions 比例', html.includes('比例、质量、标题与分类')],
  ['not outside fold id', !html.includes('id="imageGenSizeParamsRow"')],
  ['economy fallback filled', /'image2-economy':\s*IMAGE_GEN_SIZE_GIM2/.test(p11)],
  ['quality sync fn', p12.includes('syncImageGenQualitySelectOptions')],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
