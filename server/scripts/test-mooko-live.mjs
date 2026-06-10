/**
 * 本地实测木瓜 Pro API（2K）：在 server 目录执行
 *   $env:MOOKO_API_KEY="sk-..."; node scripts/test-mooko-live.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';

const key = String(process.env.MOOKO_API_KEY || '').trim();
const base = (process.env.MOOKO_API_BASE_URL || 'https://api.mooko.ai').replace(/\/$/, '');
const resolution = String(process.env.MOOKO_TEST_RES || '2k').toLowerCase();

if (!key) {
  console.error('请设置 MOOKO_API_KEY 环境变量');
  process.exit(1);
}

const body = {
  model: 'gpt-image-2-pro',
  prompt: 'a single red apple on pure white background, product photo',
  n: 1,
  size: resolution === '4k' ? '3840x2160' : '2048x2048',
  quality: 'high',
  response_format: 'url',
  moderation: 'auto',
  output_format: resolution === '4k' ? 'jpeg' : 'png'
};

async function fetchLong(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12 * 60 * 1000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickImageUrl(json, text) {
  const urls = [];
  const push = (u) => {
    if (typeof u === 'string' && u.trim()) urls.push(u.trim());
  };
  if (json?.data && Array.isArray(json.data)) {
    for (const row of json.data) {
      if (typeof row === 'string') push(row);
      else if (row && typeof row === 'object') {
        push(row.url);
        push(row.image_url);
      }
    }
  }
  if (!urls.length && text) {
    const m = text.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    for (const u of m) {
      if (/gimg\.mooko\.ai|\.(png|jpe?g|webp)/i.test(u)) push(u.replace(/[),.;}\]]+$/, ''));
    }
  }
  return urls[0] || null;
}

async function main() {
  console.log('POST', `${base}/v1/images/generations`);
  console.log('body', JSON.stringify(body));
  const res = await fetchLong(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log('status', res.status);
  console.log('response', text.slice(0, 2500));
  if (!res.ok) process.exit(2);
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    process.exit(3);
  }
  let url = pickImageUrl(json, text);
  if (url) {
    if (url.startsWith('/')) url = `https://gimg.mooko.ai${url}`;
    console.log('OK image url:', url);
    return;
  }
  const tid = json?.task_id || json?.request_id || json?.id;
  if (!tid) {
    console.error('无 url 也无 task_id');
    process.exit(4);
  }
  console.log('task_id', tid, '— 轮询中…');
  for (let i = 0; i < 48; i++) {
    await sleep(5000);
    const pr = await fetchLong(`${base}/v1/tasks/${encodeURIComponent(tid)}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const pt = await pr.text();
    console.log(`poll ${i + 1}`, pr.status, pt.slice(0, 600));
    let pj;
    try {
      pj = pt ? JSON.parse(pt) : null;
    } catch {
      pj = null;
    }
    url = pickImageUrl(pj, pt);
    if (url) {
      if (url.startsWith('/')) url = `https://gimg.mooko.ai${url}`;
      console.log('OK image url:', url);
      return;
    }
    if (/"failed"|"error"/i.test(pt)) {
      console.error('task failed');
      process.exit(5);
    }
  }
  console.error('poll timeout');
  process.exit(6);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
