const base = 'https://prompt-hubs.com';
const index = await (await fetch(`${base}/`, { cache: 'no-store' })).text();
const build = (index.match(/__APP_BUILD__\s*=\s*'([^']+)'/) || [])[1];
console.log('build', build);
const scripts = [...index.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
scripts.forEach((s, i) => console.log(String(i + 1).padStart(2), s));
const fd = scripts.findIndex((s) => s.includes('features-draft'));
const feed = scripts.findIndex((s) => s.includes('feed-modules') || s.includes('pack-feed'));
console.log('feed idx', feed, 'features-draft idx', fd, feed < fd ? 'ORDER OK' : 'ORDER BAD');
