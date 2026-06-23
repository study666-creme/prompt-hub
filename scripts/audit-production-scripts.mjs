/**
 * 线上审计：index 引用的每个 script 须为 JS（含浏览器 script 请求头）。
 */
const base = process.env.SMOKE_BASE || 'https://prompt-hubs.com';
const scriptHdr = {
  'Sec-Fetch-Dest': 'script',
  'Sec-Fetch-Mode': 'no-cors',
  Referer: `${base.replace(/\/$/, '')}/`
};

const index = await (await fetch(`${base}/`, { cache: 'no-store' })).text();
const re = /<script[^>]+src="([^"]+)"/g;
const scripts = [];
let m;
while ((m = re.exec(index)) !== null) scripts.push(m[1]);

console.log('build', (index.match(/__APP_BUILD__\s*=\s*'([^']+)'/) || [])[1]);

if (/\.bundle\.js/i.test(index)) {
  console.error('audit FAIL: index still references .bundle.js');
  process.exit(1);
}

let failed = 0;
for (const s of scripts) {
  if (!/\.js(\?|$)/.test(s)) continue;
  const url = s.startsWith('http') ? s : `${base}/${s.replace(/^\//, '')}`;
  const r = await fetch(url, { cache: 'no-store', headers: scriptHdr });
  const t = await r.text();
  const ct = r.headers.get('content-type') || '';
  const html = /text\/html/i.test(ct) || t.trimStart().startsWith('<!');
  if (html) {
    failed++;
    console.error('HTML (script dest)!', s, ct);
  }
}

if (failed) process.exit(1);
console.log('audit OK:', scripts.filter((x) => x.startsWith('pack-')).length, 'pack scripts, all JS');
