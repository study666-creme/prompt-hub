const base = process.env.SMOKE_BASE || 'https://prompt-hubs.com';

const index = await (await fetch(`${base}/`, { cache: 'no-store' })).text();
const re = /<script[^>]+src="([^"]+)"/g;
const scripts = [];
let m;
while ((m = re.exec(index)) !== null) scripts.push(m[1]);

console.log('build', (index.match(/__APP_BUILD__\s*=\s*'([^']+)'/) || [])[1]);
console.log('bundle tags:');
for (const s of scripts.filter((x) => x.includes('bundle'))) console.log(' ', s);

let failed = 0;
for (const s of scripts) {
  if (!s.endsWith('.js') && !s.includes('.js?')) continue;
  const url = s.startsWith('http') ? s : `${base}/${s.replace(/^\//, '')}`;
  const r = await fetch(url, { cache: 'no-store' });
  const t = await r.text();
  const ct = r.headers.get('content-type') || '';
  const html = /text\/html/i.test(ct) || t.trimStart().startsWith('<!');
  if (html) {
    failed++;
    console.error('HTML!', s, ct);
  }
}

const fm = await fetch(`${base}/feed-modules.bundle.js`, { cache: 'no-store' });
const fmText = await fm.text();
console.log('feed-modules:', fm.headers.get('content-type'), 'FeedImages', fmText.includes('FeedImages'), 'bytes', fmText.length);

if (failed) process.exit(1);
console.log('all script tags OK');
