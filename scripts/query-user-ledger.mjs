import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const envFlagIdx = args.indexOf('--env');
const envFileArg = envFlagIdx >= 0 ? args[envFlagIdx + 1] : null;
const uid = args.find((a) => a !== '--env' && a !== envFileArg);
if (!uid) {
  console.error('Usage: node scripts/query-user-ledger.mjs <user_id> [--env scripts/admin.local.env]');
  console.error('  生产库：复制 scripts/admin.local.env.example -> admin.local.env，填入 MemFire URL + service_role');
  process.exit(1);
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      })
  );
}

const env =
  (envFileArg && readDotEnv(path.resolve(envFileArg))) ||
  readDotEnv(path.join(process.cwd(), 'scripts', 'admin.local.env')) ||
  readDotEnv(path.join(process.cwd(), 'server', '.dev.vars'));

if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。请配置 scripts/admin.local.env（境外库）或 server/.dev.vars');
  process.exit(1);
}

const base = env.SUPABASE_URL.replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function q(table, query) {
  const r = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
  return r.json();
}

const profile = await q(
  'profiles',
  `user_id=eq.${uid}&select=credits,daily_credits,lifetime_credits_spent,credit_grant_mode,membership_tier,membership_until,display_name`
);
const ledger = await q(
  'credit_ledger',
  `user_id=eq.${uid}&select=delta,balance_after,reason,ref_id,meta,created_at&order=created_at.asc&limit=500`
);
const codes = await q('code_redemptions', `user_id=eq.${uid}&select=code,redeemed_at&order=redeemed_at.asc`);
const codeList = (codes || []).map((c) => c.code).filter(Boolean);
let activations = [];
if (codeList.length) {
  activations = await q(
    'activation_codes',
    `code=in.(${codeList.map((c) => `"${c}"`).join(',')})&select=code,credits,membership_tier,membership_days,note,offer_kind`
  );
}

const summary = {};
for (const row of ledger || []) {
  const k = row.reason || 'unknown';
  summary[k] = (summary[k] || 0) + Number(row.delta || 0);
}

const out = { db: base, profile: profile[0] ?? null, codes, activations, summary, ledger };
if (!profile[0]) {
  out.hint =
    '该 UID 在此库不存在。请确认 scripts/admin.local.env 指向当前生产 MemFire，并核对 AUDIT_USER_ID。';
}
console.log(JSON.stringify(out, null, 2));
