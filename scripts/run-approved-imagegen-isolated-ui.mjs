import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

if (process.env.PH_PAID_TEST_APPROVED !== '1' || process.env.PH_CREATE_ISOLATED_ACCOUNT !== '1') {
  console.error('Refusing isolated paid UI acceptance without both approval flags.');
  process.exit(2);
}

const env = parseEnv(readFileSync(new URL('admin.local.env', import.meta.url), 'utf8'));
const serviceUrl = required(
  String(env.MEMFIRE_URL || '').trim() || env.SUPABASE_URL,
  'MEMFIRE_URL or SUPABASE_URL'
).replace(/\/+$/, '');
const serviceKey = required(env.MEMFIRE_SERVICE_ROLE_KEY, 'MEMFIRE_SERVICE_ROLE_KEY');
const email = `image-ui-${Date.now()}-${randomBytes(3).toString('hex')}@prompt-hubs.invalid`;
const password = `T-${randomBytes(24).toString('base64url')}!7a`;
const runRef = `ui-image-acceptance-${Date.now()}-${randomUUID().slice(0, 8)}`;
const MAX_BILLABLE_REQUESTS = 5;
const MAX_TOTAL_CREDITS = 200;

const created = await jsonRequest(`${serviceUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers: serviceHeaders(serviceKey),
  body: {
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Image UI acceptance' }
  }
});
const userId = String(created.body?.id || created.body?.user?.id || '');
if (!created.ok || !userId) throw new Error(`Isolated test account creation failed (${created.status}).`);

const initialProfile = await waitForProfile(userId);
const initialCredits = Number(initialProfile.credits || 0);
const initialDailyCredits = Number(initialProfile.daily_credits || 0);
if (initialCredits !== 0 || initialDailyCredits !== 0) {
  throw new Error('Isolated test account did not start with a zero balance.');
}
const credited = await jsonRequest(`${serviceUrl}/rest/v1/rpc/apply_credit_delta`, {
  method: 'POST',
  headers: serviceHeaders(serviceKey, { Prefer: 'return=representation' }),
  body: {
    p_user_id: userId,
    p_delta: MAX_TOTAL_CREDITS,
    p_reason: 'isolated_paid_image_ui_acceptance',
    p_ref_id: `${runRef}-credit`,
    p_meta: {
      maxRequests: MAX_BILLABLE_REQUESTS,
      maxImagesPerRequest: 1,
      maxTotalCredits: MAX_TOTAL_CREDITS,
      resolution: '1k'
    }
  }
});
if (!credited.ok) throw new Error(`Isolated test credit grant failed (${credited.status}).`);
const fundedProfile = await readProfile(userId);
const fundedCredits = Number(fundedProfile.credits || 0);
const fundedDailyCredits = Number(fundedProfile.daily_credits || 0);
if (fundedCredits !== MAX_TOTAL_CREDITS || fundedDailyCredits !== 0) {
  throw new Error(`Isolated test account balance did not match the ${MAX_TOTAL_CREDITS}-credit hard cap.`);
}

console.log(JSON.stringify({
  event: 'isolated-test-account-ready',
  userId,
  grantedCredits: MAX_TOTAL_CREDITS,
  maxBillableRequests: MAX_BILLABLE_REQUESTS,
  retainedForAudit: true
}));

process.env.PH_TEST_EMAIL = email;
process.env.PH_TEST_PASSWORD = password;
await import('./run-approved-imagegen-acceptance.mjs');

async function waitForProfile(userId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await jsonRequest(
      `${serviceUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits,daily_credits`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (response.ok && Array.isArray(response.body) && response.body[0]?.user_id) return response.body[0];
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Isolated test profile was not created.');
}

async function readProfile(userId) {
  const response = await jsonRequest(
    `${serviceUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,credits,daily_credits`,
    { headers: serviceHeaders(serviceKey) }
  );
  if (!response.ok || !Array.isArray(response.body) || !response.body[0]?.user_id) {
    throw new Error(`Isolated test profile read failed (${response.status}).`);
  }
  return response.body[0];
}

async function jsonRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  let body;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, { method: options.method || 'GET', headers, body });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* status is sufficient */ }
  return { ok: response.ok, status: response.status, body: parsed };
}

function serviceHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function required(value, label) {
  if (!String(value || '').trim()) throw new Error(`Missing ${label}.`);
  return String(value).trim();
}
