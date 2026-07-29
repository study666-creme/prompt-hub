import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXECUTE_FLAG = '--execute-approved-five-model-test';
const API_BASE = 'https://api.prompt-hubs.com';
const MAX_REQUESTS = 5;
const MAX_IMAGES_PER_REQUEST = 1;
const MAX_RESOLUTION = '1k';
const MAX_TOTAL_CREDITS = 50;
const CREDIT_GRANT = 30;
const MIN_IMAGE_BYTES = 1024;
const APPROVAL_SCOPE = '20260722-five-image-models-1k-50-credits-v1';
const MODELS = [
  'image2-pro',
  'lingtu-fast',
  'lingtu-lite',
  'image2',
  'lingtu'
];
const PROMPT = 'A clean studio photograph of a translucent glass teapot beside green leaves, soft daylight, centered product composition, no text.';

if (!process.argv.includes(EXECUTE_FLAG)) {
  console.error(`Refusing to run without ${EXECUTE_FLAG}`);
  process.exit(2);
}
if (
  MODELS.length !== MAX_REQUESTS
  || new Set(MODELS).size !== MODELS.length
  || MAX_IMAGES_PER_REQUEST !== 1
  || MAX_RESOLUTION !== '1k'
) {
  throw new Error('Paid test guard configuration is invalid');
}

const root = new URL('../', import.meta.url);
const adminEnv = parseEnv(readFileSync(new URL('scripts/admin.local.env', root), 'utf8'));
const memfireUrl = required(adminEnv.MEMFIRE_URL, 'MEMFIRE_URL').replace(/\/+$/, '');
const serviceKey = required(adminEnv.MEMFIRE_SERVICE_ROLE_KEY, 'MEMFIRE_SERVICE_ROLE_KEY');
const publicConfig = readFileSync(new URL('supabase-config.js', root), 'utf8');
const anonKey = publicConfig.match(/if \(isOverseasSite\)[\s\S]*?SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)?.[1];
required(anonKey, 'production public anon key');

const startedAt = new Date().toISOString();
const runId = `canary-${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `image-canary-${Date.now()}-${randomBytes(3).toString('hex')}@prompt-hubs.invalid`;
const password = `T-${randomBytes(24).toString('base64url')}!7a`;
let token = '';
const reportPath = join(tmpdir(), `prompt-hub-paid-image-canary-${Date.now()}.json`);
const approvalLockPath = join(tmpdir(), `prompt-hub-paid-image-canary-${APPROVAL_SCOPE}.lock`);
const report = {
  policy: {
    maxBillableRequests: MAX_REQUESTS,
    maxImagesPerRequest: MAX_IMAGES_PER_REQUEST,
    resolution: MAX_RESOLUTION,
    maxTotalCredits: MAX_TOTAL_CREDITS,
    maxTotalYuan: MAX_TOTAL_CREDITS / 100,
    postRetries: 0,
    execution: 'sequential',
    authRefresh: 'disabled_stop_on_auth_error',
    approvalScope: APPROVAL_SCOPE,
    singleUseLock: approvalLockPath
  },
  models: MODELS,
  startedAt,
  runId,
  account: {},
  catalog: {},
  requests: [],
  result: 'preparing'
};

persist();

try {
  if (existsSync(approvalLockPath)) {
    throw new Error(`Approval scope ${APPROVAL_SCOPE} was already consumed; refusing another paid run`);
  }
  const created = await jsonRequest(`${memfireUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey),
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Image canary' }
    }
  });
  const createdUserId = created.json?.id || created.json?.user?.id;
  if (!created.ok || !createdUserId) throw new Error(`Test account creation failed (${created.status})`);
  const userId = String(createdUserId);
  report.account = { userId, created: true, retainedForAudit: true };
  persist();

  const beforeGrantProfile = await waitForProfile(userId);
  const beforeGrantBalance = profileBalance(beforeGrantProfile);
  if (beforeGrantBalance.permanent !== 0 || beforeGrantBalance.daily !== 0) {
    throw new Error('New canary account did not start with a zero balance');
  }
  report.account.balanceBeforeGrant = beforeGrantBalance;
  persist();

  const creditRef = `${runId}-credit`;
  const credited = await jsonRequest(`${memfireUrl}/rest/v1/rpc/apply_credit_delta`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey, { Prefer: 'return=representation' }),
    body: {
      p_user_id: userId,
      p_delta: CREDIT_GRANT,
      p_reason: 'isolated_paid_image_canary',
      p_ref_id: creditRef,
      p_meta: { scope: 'image_canary', maxRequests: MAX_REQUESTS }
    }
  });
  if (!credited.ok) throw new Error(`Test credit grant failed (${credited.status})`);
  const afterGrantBalance = profileBalance(await readProfile(userId));
  const grantDelta = round(afterGrantBalance.permanent - beforeGrantBalance.permanent);
  if (
    grantDelta !== CREDIT_GRANT
    || afterGrantBalance.daily !== beforeGrantBalance.daily
  ) {
    throw new Error('Test credit grant balance delta was not exact');
  }
  report.account.creditGrant = CREDIT_GRANT;
  report.account.creditRef = creditRef;
  report.account.balanceAfterGrant = afterGrantBalance;
  report.account.creditGrantDelta = grantDelta;
  persist();

  const login = await jsonRequest(`${API_BASE}/supabase/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    },
    body: { email, password }
  });
  token = String(login.json?.access_token || '');
  if (!login.ok || !token) throw new Error(`Test account login failed (${login.status})`);
  const loginUserId = String(login.json?.user?.id || '');
  if (loginUserId && loginUserId !== userId) {
    throw new Error('Test account login returned a different user');
  }

  const catalog = await jsonRequest(`${API_BASE}/api/v1/generate/models`);
  if (!catalog.ok || !Array.isArray(catalog.json?.data?.models)) {
    throw new Error(`Public model catalog unavailable (${catalog.status})`);
  }
  const selected = MODELS.map(modelId => {
    const item = catalog.json.data.models.find(model => model?.id === modelId && model?.selectable === true);
    if (!item || !Array.isArray(item.resolutions) || !item.resolutions.includes(MAX_RESOLUTION)) {
      throw new Error(`Approved model is unavailable at 1K: ${modelId}`);
    }
    const credits = Number(item.creditsFinal ?? item.creditsPerCall ?? item.cost?.credits);
    if (!Number.isFinite(credits) || credits <= 0) throw new Error(`Approved model price unavailable: ${modelId}`);
    return { id: modelId, credits };
  });
  const expectedCredits = round(selected.reduce((sum, model) => sum + model.credits, 0));
  if (expectedCredits > MAX_TOTAL_CREDITS) {
    throw new Error(`Paid test budget exceeded before submission: ${expectedCredits} credits`);
  }
  if (expectedCredits > CREDIT_GRANT || expectedCredits > afterGrantBalance.total) {
    throw new Error(`Funded balance does not cover the selected models: ${expectedCredits} credits`);
  }
  report.catalog = { selected, expectedCredits, expectedYuan: expectedCredits / 100 };
  report.result = 'running';
  persist();

  let actualCredits = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const model = selected[index];
    if (report.requests.length >= MAX_REQUESTS) throw new Error('Billable request count guard reached');
    if (round(actualCredits + model.credits) > MAX_TOTAL_CREDITS) throw new Error('Billable spend guard reached');

    const balanceBeforeRequest = profileBalance(await readProfile(userId));
    if (balanceBeforeRequest.daily !== 0) {
      throw new Error('Canary account unexpectedly has daily credits');
    }
    const expectedBalanceBeforeRequest = round(afterGrantBalance.total - actualCredits);
    if (balanceBeforeRequest.total !== expectedBalanceBeforeRequest) {
      throw new Error('Canary balance changed unexpectedly between approved requests');
    }
    if (balanceBeforeRequest.total < model.credits) {
      throw new Error(`Canary balance cannot cover approved model ${model.id}`);
    }
    if (index === 0) acquireApprovalLock();

    const clientRequestId = `web.image.${runId}.${index + 1}`;
    const item = {
      index: index + 1,
      model: model.id,
      clientRequestId,
      expectedCredits: model.credits,
      submittedAt: new Date().toISOString(),
      postAttempts: 1,
      status: 'submitting',
      balanceBeforeRequest
    };
    report.requests.push(item);
    report.billableRequestsSent = report.requests.length;
    report.worstCaseCreditsSent = round(
      report.requests.reduce((sum, request) => sum + Number(request.expectedCredits || 0), 0)
    );
    persist();

    let submission = null;
    let submissionTransportError = null;
    try {
      submission = await jsonRequest(`${API_BASE}/api/v1/generate`, {
        method: 'POST',
        headers: authHeaders(token),
        body: {
          clientRequestId,
          model: model.id,
          prompt: PROMPT,
          resolution: MAX_RESOLUTION,
          quality: 'medium',
          size: '1:1',
          count: MAX_IMAGES_PER_REQUEST
        },
        timeoutMs: 120_000,
        redirect: 'error'
      });
      item.submission = publicRaw(submission);
    } catch (error) {
      submissionTransportError = String(error?.message || error);
      item.submission = { transportError: submissionTransportError };
    }

    if (!isExpectedSubmissionResponse(submission)) {
      item.status = 'submission_anomaly';
      persist();
      const recovery = await recoverSubmission(clientRequestId, token);
      item.recovery = recovery.response
        ? publicRaw(recovery.response)
        : { found: false, transportError: recovery.transportError || null };
      if (recovery.jobId) {
        item.jobId = recovery.jobId;
        item.recoveredStatus = recovery.status;
      }
      item.recoveredByClientRequestId = !!recovery.jobId;
      persist();
      const reason = submissionTransportError
        ? 'transport failure'
        : `HTTP/response anomaly${submission ? ` (${submission.status})` : ''}`;
      throw new Error(
        `Billable request ${index + 1} had a ${reason}; read-only recovery was recorded and the canary stopped without another POST`
      );
    }

    const jobId = String(submission.json.data.jobId);
    const declaredCredits = Number(submission.json.data.creditsCharged);
    item.jobId = jobId;
    item.status = String(submission.json.data.status || 'processing');
    item.declaredCreditsCharged = declaredCredits;
    if (round(declaredCredits) !== round(model.credits)) {
      item.status = 'charge_mismatch';
      persist();
      throw new Error(`Billable request ${index + 1} returned an unexpected charge; canary stopped`);
    }
    if (round(actualCredits + declaredCredits) > MAX_TOTAL_CREDITS) {
      item.status = 'spend_limit_exceeded';
      persist();
      throw new Error('Billable spend guard was exceeded; canary stopped');
    }
    persist();
    console.log(JSON.stringify({
      event: 'submitted',
      count: index + 1,
      model: model.id,
      clientRequestId,
      jobId,
      declaredCreditsCharged: declaredCredits,
      verifiedCredits: actualCredits
    }));

    const completed = await pollJob(jobId, token, item);
    item.final = jobResultForReport(completed);
    if (completed.status !== 'completed') {
      item.status = completed.status || 'unexpected';
      persist();
      throw new Error(`Billable request ${index + 1} did not complete successfully`);
    }

    item.status = 'verifying';
    item.imageCheck = await verifyImage(jobId, token);
    const finance = await inspectCompletedCharge(
      userId,
      jobId,
      balanceBeforeRequest,
      model.credits
    );
    item.finance = finance;
    if (!finance.ok) {
      item.status = 'finance_mismatch';
      persist();
      throw new Error(`Billable request ${index + 1} had an unexpected debit or refund; canary stopped`);
    }
    item.creditsCharged = finance.debitedCredits;
    actualCredits = round(actualCredits + finance.debitedCredits);
    report.actualCredits = actualCredits;
    report.actualYuan = actualCredits / 100;

    if (!item.imageCheck.ok) {
      item.status = 'image_unavailable';
      persist();
      throw new Error(`Billable request ${index + 1} completed but its image was not retrievable`);
    }
    item.status = 'completed';
    item.completedAt = new Date().toISOString();
    persist();
    console.log(JSON.stringify({
      event: 'completed',
      count: index + 1,
      model: model.id,
      clientRequestId,
      jobId,
      creditsCharged: item.creditsCharged,
      imageBytes: item.imageCheck.bytes
    }));
  }

  const finalFinance = await inspectFinalAccount(userId, afterGrantBalance, actualCredits, report.requests);
  report.finalFinance = finalFinance;
  if (!finalFinance.ok) {
    throw new Error('Final canary balance or ledger reconciliation failed');
  }
  report.result = 'completed';
  report.completedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify({
    ok: true,
    count: report.requests.length,
    credits: report.actualCredits,
    yuan: report.actualYuan,
    reportPath,
    jobs: report.requests.map(item => ({
      model: item.model,
      clientRequestId: item.clientRequestId,
      jobId: item.jobId,
      status: item.status,
      imageBytes: item.imageCheck?.bytes || 0
    }))
  }));
} catch (error) {
  report.result = 'stopped';
  report.stoppedAt = new Date().toISOString();
  report.error = String(error?.message || error);
  persist();
  console.error(JSON.stringify({
    ok: false,
    count: report.requests.length,
    credits: report.actualCredits || 0,
    reportPath,
    error: report.error
  }));
  process.exitCode = 1;
}

async function waitForProfile(userId) {
  let lastError = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const profile = await readProfile(userId, { allowMissing: true });
      if (profile) return profile;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(500);
  }
  throw new Error(`Test profile was not created${lastError ? `: ${lastError}` : ''}`);
}

async function readProfile(userId, options = {}) {
  const url = new URL(`${memfireUrl}/rest/v1/profiles`);
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('select', 'user_id,credits,daily_credits,daily_credits_date');
  const response = await jsonRequest(url, { headers: serviceHeaders(serviceKey) });
  if (!response.ok || !Array.isArray(response.json)) {
    throw new Error(`Test profile read failed (${response.status})`);
  }
  const profile = response.json[0] || null;
  if (!profile && !options.allowMissing) throw new Error('Test profile is missing');
  return profile;
}

function profileBalance(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('Test profile balance is unavailable');
  const permanent = Number(profile.credits);
  const daily = Number(profile.daily_credits);
  if (!Number.isFinite(permanent) || permanent < 0 || !Number.isFinite(daily) || daily < 0) {
    throw new Error('Test profile returned an invalid balance');
  }
  return {
    permanent: round(permanent),
    daily: round(daily),
    total: round(permanent + daily)
  };
}

async function readCreditLedger(userId, jobId) {
  const url = new URL(`${memfireUrl}/rest/v1/credit_ledger`);
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('ref_id', `eq.${jobId}`);
  url.searchParams.set('select', 'id,delta,balance_after,reason,ref_id,created_at');
  url.searchParams.set('order', 'created_at.asc');
  const response = await jsonRequest(url, { headers: serviceHeaders(serviceKey) });
  if (!response.ok || !Array.isArray(response.json)) {
    throw new Error(`Credit ledger read failed (${response.status})`);
  }
  return response.json.map(row => {
    const delta = Number(row?.delta);
    const balanceAfter = Number(row?.balance_after);
    if (!Number.isFinite(delta) || !Number.isFinite(balanceAfter)) {
      throw new Error('Credit ledger returned invalid numeric values');
    }
    return {
      id: String(row.id || ''),
      delta: round(delta),
      balanceAfter: round(balanceAfter),
      reason: String(row.reason || ''),
      refId: String(row.ref_id || ''),
      createdAt: String(row.created_at || '')
    };
  });
}

async function inspectCompletedCharge(userId, jobId, beforeBalance, expectedCredits) {
  const afterBalance = profileBalance(await readProfile(userId));
  const ledger = await readCreditLedger(userId, jobId);
  const debits = ledger.filter(row => row.reason === 'image_generation' && row.delta < 0);
  const refunds = ledger.filter(row => row.delta > 0 || /refund/i.test(row.reason));
  const unexpected = ledger.filter(row => !debits.includes(row) && !refunds.includes(row));
  const debitedCredits = round(debits.reduce((sum, row) => sum - row.delta, 0));
  const balanceDelta = round(beforeBalance.total - afterBalance.total);
  const expected = round(expectedCredits);
  const ok = (
    beforeBalance.daily === 0
    && afterBalance.daily === 0
    && debits.length === 1
    && refunds.length === 0
    && unexpected.length === 0
    && debitedCredits === expected
    && balanceDelta === expected
  );
  return {
    ok,
    expectedCredits: expected,
    debitedCredits,
    balanceDelta,
    balanceAfter: afterBalance,
    debitEntries: debits.length,
    refundEntries: refunds.length,
    unexpectedEntries: unexpected.length,
    ledger
  };
}

async function inspectFinalAccount(userId, fundedBalance, actualCredits, requests) {
  const balance = profileBalance(await readProfile(userId));
  const expectedBalance = round(fundedBalance.total - actualCredits);
  const jobs = [];
  for (const request of requests) {
    const ledger = await readCreditLedger(userId, request.jobId);
    const debits = ledger.filter(row => row.reason === 'image_generation' && row.delta < 0);
    const refunds = ledger.filter(row => row.delta > 0 || /refund/i.test(row.reason));
    const debitedCredits = round(debits.reduce((sum, row) => sum - row.delta, 0));
    jobs.push({
      jobId: request.jobId,
      debitedCredits,
      debitEntries: debits.length,
      refundEntries: refunds.length,
      ok: (
        debits.length === 1
        && refunds.length === 0
        && ledger.length === 1
        && debitedCredits === round(request.expectedCredits)
      )
    });
  }
  return {
    ok: (
      balance.daily === 0
      && balance.total === expectedBalance
      && jobs.length === MAX_REQUESTS
      && jobs.every(job => job.ok)
    ),
    expectedBalance,
    balance,
    jobs
  };
}

async function recoverSubmission(clientRequestId, accessToken) {
  const deadline = Date.now() + 120_000;
  let lastResponse = null;
  let transportError = '';
  while (Date.now() < deadline) {
    let response;
    try {
      response = await jsonRequest(
        `${API_BASE}/api/v1/generate/requests/${encodeURIComponent(clientRequestId)}`,
        { headers: authHeaders(accessToken), timeoutMs: 30_000, redirect: 'error' }
      );
    } catch (error) {
      transportError = String(error?.message || error);
      await delay(3000);
      continue;
    }
    assertAuthStillValid(response, 'submission recovery');
    lastResponse = response;
    const jobId = String(response.json?.data?.jobId || '');
    if (response.ok && response.json?.ok === true && jobId) {
      return {
        jobId,
        status: String(response.json.data.status || 'unknown'),
        response,
        transportError: null
      };
    }
    if (response.status !== 404) break;
    await delay(3000);
  }
  return { jobId: null, status: null, response: lastResponse, transportError };
}

async function pollJob(jobId, accessToken, item) {
  const deadline = Date.now() + 30 * 60_000;
  let last = null;
  while (Date.now() < deadline) {
    let response;
    try {
      response = await jsonRequest(
        `${API_BASE}/api/v1/generate/jobs/${encodeURIComponent(jobId)}`,
        { headers: authHeaders(accessToken), timeoutMs: 60_000, redirect: 'error' }
      );
    } catch (error) {
      item.status = 'poll_transport_error';
      persist();
      throw new Error(`Read-only job polling failed; canary stopped: ${String(error?.message || error)}`);
    }
    assertAuthStillValid(response, 'job polling');
    if (!response.ok || response.json?.ok !== true || !response.json?.data) {
      item.status = 'poll_response_error';
      persist();
      throw new Error(`Read-only job polling returned an unexpected response (${response.status})`);
    }
    last = response.json.data;
    const status = String(last.status || '');
    if (!['processing', 'completed', 'failed'].includes(status)) {
      item.status = 'poll_response_error';
      persist();
      throw new Error(`Read-only job polling returned an unexpected status: ${status || 'empty'}`);
    }
    item.lastPolledAt = new Date().toISOString();
    item.status = status;
    persist();
    if (status === 'completed' || status === 'failed') return last;
    await delay(3000);
  }
  return last || { status: 'timeout', imageUrl: null };
}

async function verifyImage(jobId, accessToken) {
  let response;
  try {
    response = await fetchWithTimeout(
      `${API_BASE}/api/v1/generate/jobs/${encodeURIComponent(jobId)}/image`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 120_000,
        redirect: 'error'
      }
    );
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytes: 0,
      format: null,
      transportError: String(error?.message || error)
    };
  }
  assertAuthStillValid({ status: response.status }, 'image retrieval');
  const body = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const format = detectImageFormat(body);
  const contentTypeOk = /^image\//i.test(contentType) || /^application\/octet-stream\b/i.test(contentType);
  return {
    ok: response.ok && contentTypeOk && body.byteLength >= MIN_IMAGE_BYTES && !!format,
    status: response.status,
    contentType,
    bytes: body.byteLength,
    format
  };
}

async function jsonRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  let body;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  const response = await fetchWithTimeout(url, {
    method: options.method || 'GET',
    headers,
    body,
    timeoutMs: options.timeoutMs || 30_000,
    redirect: options.redirect || 'error'
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* preserve raw text */ }
  return { ok: response.ok, status: response.status, text, json };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

function serviceHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function publicRaw(response) {
  return {
    ok: response.ok,
    status: response.status,
    body: response.json ?? response.text.slice(0, 2000)
  };
}

function isExpectedSubmissionResponse(response) {
  if (!response?.ok || response.json?.ok !== true || !response.json?.data) return false;
  const data = response.json.data;
  const jobId = String(data.jobId || '');
  const status = String(data.status || '');
  const credits = Number(data.creditsCharged);
  return (
    !!jobId
    && ['processing', 'completed'].includes(status)
    && Number.isFinite(credits)
    && credits > 0
  );
}

function assertAuthStillValid(response, operation) {
  if (response?.status === 401 || response?.status === 403) {
    throw new Error(`Authentication expired or was rejected during ${operation}; canary stopped without refresh or POST retry`);
  }
}

function jobResultForReport(result) {
  const creditsRemaining = Number(result?.creditsRemaining);
  return {
    jobId: String(result?.jobId || ''),
    status: String(result?.status || 'unknown'),
    imageUrlReturned: typeof result?.imageUrl === 'string' && !!result.imageUrl,
    refunded: typeof result?.refunded === 'boolean' ? result.refunded : undefined,
    creditsRemaining: Number.isFinite(creditsRemaining) ? round(creditsRemaining) : undefined,
    errorMessage: result?.errorMessage ? String(result.errorMessage) : undefined
  };
}

function detectImageFormat(bytes) {
  const startsWith = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (bytes.length >= 3 && startsWith(0xff, 0xd8, 0xff)) return 'jpeg';
  if (bytes.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (bytes.length >= 6) {
    const header = ascii(bytes, 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (bytes.length >= 4 && (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a))) return 'tiff';
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (['avif', 'avis'].includes(brand)) return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heif';
  }
  return null;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function sanitizeReportValue(value, key = '') {
  if (/password|authorization|token|service[_-]?role|api[_-]?key|secret|jwt/i.test(key)) {
    return '[redacted]';
  }
  if (Array.isArray(value)) return value.map(item => sanitizeReportValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeReportValue(childValue, childKey)
      ])
    );
  }
  if (typeof value !== 'string') return value;
  let safe = value;
  for (const secret of [serviceKey, password, token]) {
    if (secret && secret.length >= 8) safe = safe.split(secret).join('[redacted]');
  }
  safe = safe.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]');
  safe = safe.replace(/data:image\/[^;,\s]+(?:;base64)?,[^\s"'<>]+/gi, '[inline-image]');
  safe = safe.replace(/https?:\/\/[^\s"'<>]+/gi, rawUrl => sanitizeUrl(rawUrl));
  if (/url/i.test(key)) safe = sanitizeUrl(safe);
  return safe;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!url.protocol) return String(value).split(/[?#]/, 1)[0];
    if (url.host) return `${url.protocol}//${url.host}${url.pathname}`;
    return `${url.protocol}${url.pathname}`;
  } catch {
    return String(value).split(/[?#]/, 1)[0];
  }
}

function acquireApprovalLock() {
  let fd;
  try {
    fd = openSync(approvalLockPath, 'wx', 0o600);
    writeFileSync(
      fd,
      `${JSON.stringify({
        approvalScope: APPROVAL_SCOPE,
        runId,
        startedAt,
        models: MODELS,
        maxRequests: MAX_REQUESTS,
        maxTotalCredits: MAX_TOTAL_CREDITS,
        reportPath
      }, null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Approval scope ${APPROVAL_SCOPE} was already consumed; refusing another paid run`);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseEnv(source) {
  const out = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function required(value, label) {
  if (!String(value || '').trim()) throw new Error(`Missing ${label}`);
  return String(value).trim();
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persist() {
  writeFileSync(
    reportPath,
    `${JSON.stringify(sanitizeReportValue(report), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
}
