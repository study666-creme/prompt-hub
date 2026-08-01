import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE_BASE = 'https://prompt-hubs.com';
const API_BASE = 'https://api.prompt-hubs.com';
const APPROVAL_FLAG = 'PH_PAID_TEST_APPROVED';
const MAX_BILLABLE_REQUESTS = 5;
const MAX_IMAGES_PER_REQUEST = 1;
const RESOLUTION = '1k';
const QUALITY = 'medium';
const SIZE = '1:1';
const MAX_TOTAL_CREDITS = 200;
const CREDITS_PER_YUAN = 100;
const MAX_TOTAL_YUAN = 2;
const JOB_TIMEOUT_MS = 30 * 60_000;
const UI_ARCHIVE_TIMEOUT_MS = 2 * 60_000;
const CREDIT_TOLERANCE = 0.0001;
const LEDGER_LIMIT = 50;
const MODELS = Object.freeze(
  String(process.env.PH_ACCEPTANCE_MODELS || 'image2-economy,lingtu-fast,lingtu-lite,lingtu-2,lingtu-pro')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

if (process.env[APPROVAL_FLAG] !== '1') {
  console.error(`Refusing paid acceptance: set ${APPROVAL_FLAG}=1 only after explicit approval.`);
  process.exit(2);
}

const testEmail = String(process.env.PH_TEST_EMAIL || '').trim();
const testPassword = String(process.env.PH_TEST_PASSWORD || '');
if (!testEmail || !testPassword) {
  console.error('Refusing paid acceptance: PH_TEST_EMAIL and PH_TEST_PASSWORD are required.');
  process.exit(2);
}

if (
  MODELS.length !== MAX_BILLABLE_REQUESTS
  || new Set(MODELS).size !== MODELS.length
  || MAX_IMAGES_PER_REQUEST !== 1
  || RESOLUTION !== '1k'
  || MAX_TOTAL_CREDITS / CREDITS_PER_YUAN !== MAX_TOTAL_YUAN
) {
  throw new Error('Paid acceptance guard constants are invalid.');
}

const runId = `ui-image-acceptance-${Date.now()}-${randomUUID().slice(0, 8)}`;
const reportPath = join(tmpdir(), `prompt-hub-${runId}.json`);
const report = {
  runId,
  startedAt: new Date().toISOString(),
  result: 'preparing',
  policy: {
    approvalFlag: APPROVAL_FLAG,
    productionUi: SITE_BASE,
    publicApi: API_BASE,
    models: [...MODELS],
    maxBillableRequests: MAX_BILLABLE_REQUESTS,
    maxImagesPerRequest: MAX_IMAGES_PER_REQUEST,
    resolution: RESOLUTION,
    quality: QUALITY,
    size: SIZE,
    maxTotalCredits: MAX_TOTAL_CREDITS,
    creditsPerYuan: CREDITS_PER_YUAN,
    maxTotalYuan: MAX_TOTAL_YUAN,
    paidPostExecution: 'strictly-sequential',
    paidPostRetries: 0,
    alternateModels: 0
  },
  preflight: {
    catalogGet: null,
    costGets: [],
    selected: [],
    quotedTotalCredits: null,
    worstCaseTotalCredits: null,
    startingCredits: null,
    startingBalance: null,
    ledgerBaseline: null,
    uiSelection: [],
    uiForm: []
  },
  guard: {
    allowedPostCount: 0,
    seenClientRequestIds: [],
    seenModels: [],
    violations: []
  },
  requests: [],
  warehouseSummary: null,
  finalDebitState: null
};

persist();

let browser;
let context;
let page;
let activeExpectation = null;
let routeViolation = null;
let allowedPostCount = 0;
let actualCredits = 0;
const seenClientRequestIds = new Set();
const seenModels = new Set();

try {
  const playwrightPackageDir = String(process.env.PLAYWRIGHT_PACKAGE_DIR || '').trim();
  const playwrightImport = playwrightPackageDir
    ? pathToFileURL(join(playwrightPackageDir, 'index.js')).href
    : 'playwright';
  const playwright = await import(playwrightImport);
  const chromium = playwright.chromium || playwright.default?.chromium;
  if (!chromium) throw new Error('Playwright chromium is unavailable.');

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  await page.route(/\/api\/v1\/generate(?:\/[^?#]*)?(?:\?[^#]*)?$/i, async route => {
    const request = route.request();
    if (request.method().toUpperCase() !== 'POST') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    let payload = null;
    try {
      payload = request.postDataJSON();
    } catch {
      try { payload = JSON.parse(request.postData() || '{}'); } catch { payload = null; }
    }

    const clientRequestId = String(payload?.clientRequestId || '').trim();
    const model = String(payload?.model || '').trim();
    const resolution = String(payload?.resolution || '').toLowerCase();
    const quality = String(payload?.quality || '').toLowerCase();
    const size = String(payload?.size || '');
    const count = payload?.count == null ? 1 : Number(payload.count);
    const refs = Array.isArray(payload?.refImageUrls) ? payload.refImageUrls.filter(Boolean) : [];
    const expected = activeExpectation;

    let violation = '';
    if (url.origin !== API_BASE || url.pathname !== '/api/v1/generate') {
      violation = 'unexpected generation POST endpoint';
    } else if (!expected) {
      violation = 'generation POST occurred outside the active sequential step';
    } else if (expected.consumed) {
      violation = 'a second POST occurred in the same sequential step';
    } else if (allowedPostCount >= MAX_BILLABLE_REQUESTS) {
      violation = 'sixth generation POST blocked';
    } else if (!clientRequestId || clientRequestId.length < 8 || clientRequestId.length > 128) {
      violation = 'missing or invalid clientRequestId';
    } else if (seenClientRequestIds.has(clientRequestId)) {
      violation = 'duplicate clientRequestId POST blocked';
    } else if (seenModels.has(model)) {
      violation = 'duplicate model POST blocked';
    } else if (model !== expected.model) {
      violation = `unexpected model order: expected ${expected.model}, received ${model || '(empty)'}`;
    } else if (resolution !== RESOLUTION || quality !== QUALITY || size !== SIZE) {
      violation = 'generation parameters exceeded the approved scope';
    } else if (count !== MAX_IMAGES_PER_REQUEST || refs.length) {
      violation = 'request must contain one image and no reference inputs';
    }

    if (violation) {
      recordRouteViolation(violation, {
        path: url.pathname,
        model: model || null,
        clientRequestId: clientRequestId || null
      });
      await route.abort('blockedbyclient');
      return;
    }

    allowedPostCount += 1;
    seenClientRequestIds.add(clientRequestId);
    seenModels.add(model);
    expected.consumed = true;
    expected.item.postAttempts = 1;
    expected.item.clientRequestId = clientRequestId;
    expected.item.postRequest = {
      method: 'POST',
      path: url.pathname,
      model,
      clientRequestId,
      resolution,
      quality,
      size,
      count,
      referenceImageCount: refs.length
    };
    syncGuardReport();
    persist();
    await route.continue();
  });

  await loginThroughProductionUi();
  await assertProductionConfiguration();

  const catalogGet = await authenticatedRawGet('/api/v1/generate/models');
  report.preflight.catalogGet = catalogGet;
  persist();
  if (!catalogGet.ok || !Array.isArray(catalogGet.body?.data?.models)) {
    throw new Error(`Public model catalog preflight failed (${catalogGet.status || 0}).`);
  }

  const catalogModels = catalogGet.body.data.models;
  const selected = [];
  for (const modelId of MODELS) {
    const catalogModel = catalogModels.find(model => model?.id === modelId);
    if (
      !catalogModel
      || catalogModel.selectable === false
      || catalogModel.status === 'maintenance'
      || !Array.isArray(catalogModel.resolutions)
      || !catalogModel.resolutions.includes(RESOLUTION)
    ) {
      throw new Error(`Approved public model is unavailable at 1K: ${modelId}.`);
    }

    const catalogFinal = numberOrNaN(
      catalogModel.creditsByResolution?.[RESOLUTION]
      ?? catalogModel.costByResolution?.[RESOLUTION]?.final
      ?? catalogModel.creditsFinal
      ?? catalogModel.creditsPerCall
      ?? catalogModel.cost?.credits
    );
    if (!Number.isFinite(catalogFinal) || catalogFinal < 0) {
      throw new Error(`Catalog final price is unavailable: ${modelId}.`);
    }

    const costPath = `/api/v1/generate/cost?resolution=${encodeURIComponent(RESOLUTION)}&model=${encodeURIComponent(modelId)}`;
    const costGet = await authenticatedRawGet(costPath);
    report.preflight.costGets.push(costGet);
    persist();
    const quotedFinal = numberOrNaN(costGet.body?.data?.final);
    if (!costGet.ok || !Number.isFinite(quotedFinal) || quotedFinal < 0) {
      throw new Error(`Final cost preflight failed for ${modelId} (${costGet.status || 0}).`);
    }

    selected.push({
      id: modelId,
      uiFamily: String(catalogModel.uiFamily || ''),
      catalogFinal: roundCredits(catalogFinal),
      quotedFinal: roundCredits(quotedFinal),
      budgetFinal: roundCredits(Math.max(catalogFinal, quotedFinal))
    });
  }

  const quotedTotalCredits = roundCredits(selected.reduce((sum, model) => sum + model.quotedFinal, 0));
  const worstCaseTotalCredits = roundCredits(selected.reduce((sum, model) => sum + model.budgetFinal, 0));
  report.preflight.selected = selected;
  report.preflight.quotedTotalCredits = quotedTotalCredits;
  report.preflight.worstCaseTotalCredits = worstCaseTotalCredits;
  persist();
  if (quotedTotalCredits > MAX_TOTAL_CREDITS || worstCaseTotalCredits > MAX_TOTAL_CREDITS) {
    throw new Error(`Price preflight exceeds the ${MAX_TOTAL_CREDITS}-credit cap (${worstCaseTotalCredits}).`);
  }

  const startingBalance = await readServerCreditSnapshot('preflight');
  const startingCredits = startingBalance.credits;
  const startingUiCredits = await refreshAndReadCredits();
  if (!creditsEqual(startingUiCredits, startingCredits)) {
    throw new Error('Production UI credits did not match the authoritative starting balance.');
  }
  startingBalance.uiCreditsAfterSync = roundCredits(startingUiCredits);
  const baselineLedger = await readGenerationLedgerSnapshot('preflight');
  const baselineLedgerItemIds = new Set(baselineLedger.itemIds);
  report.preflight.startingCredits = startingCredits;
  report.preflight.startingBalance = startingBalance;
  report.preflight.ledgerBaseline = {
    at: baselineLedger.at,
    itemCount: baselineLedger.itemIds.length,
    itemIds: baselineLedger.itemIds
  };
  persist();
  if (!Number.isFinite(startingCredits) || startingCredits < worstCaseTotalCredits) {
    throw new Error(`Test account has insufficient credits; required ${worstCaseTotalCredits}. No top-up was attempted.`);
  }

  console.log(JSON.stringify({
    event: 'paid-acceptance-armed',
    requests: MAX_BILLABLE_REQUESTS,
    imagesPerRequest: MAX_IMAGES_PER_REQUEST,
    resolution: RESOLUTION,
    quotedTotalCredits,
    worstCaseTotalCredits,
    maximumChargeCredits: MAX_TOTAL_CREDITS,
    maximumChargeYuan: MAX_TOTAL_YUAN,
    execution: 'strictly-sequential',
    reportPath
  }));

  await openImageGenerationUi();
  await clearReferenceImagesThroughUi();
  await disableCommunityPublishThroughUi();
  report.preflight.uiSelection = await validateApprovedModelSelectionUi(selected);
  report.preflight.uiForm = await validateApprovedModelFormUi(selected);
  assertNoPaidSubmissionBeforeExecution();
  report.result = 'running';
  persist();

  for (let index = 0; index < selected.length; index += 1) {
    assertNoRouteViolation();
    const model = selected[index];
    const authorizedBeforeSend = roundCredits(
      report.requests.reduce((sum, item) => sum + Number(item.budgetCredits || 0), 0)
      + model.budgetFinal
    );
    if (report.requests.length >= MAX_BILLABLE_REQUESTS || authorizedBeforeSend > MAX_TOTAL_CREDITS) {
      throw new Error('Paid request or spend guard reached before submission.');
    }

    const prompt = [
      'A clean studio photograph of a translucent glass teapot beside fresh green leaves,',
      'soft daylight, centered product composition, neutral background, no text,',
      `acceptance frame ${index + 1} of ${MAX_BILLABLE_REQUESTS}, run ${runId}`
    ].join(' ');
    const item = {
      index: index + 1,
      model: model.id,
      expectedCredits: model.quotedFinal,
      budgetCredits: model.budgetFinal,
      submittedAt: null,
      postAttempts: 0,
      clientRequestId: null,
      jobId: null,
      creditsCharged: null,
      status: 'preparing-ui',
      submissionRaw: null,
      recoveryGets: [],
      pollGets: [],
      imageUrl: null,
      recentResult: null,
      warehouseResult: null
    };
    report.requests.push(item);
    persist();

    await selectModelThroughUi(model);
    await setApprovedGenerationForm(prompt, model.id, index + 1);
    item.status = 'ready-to-submit';
    persist();

    activeExpectation = { model: model.id, item, consumed: false };
    const postResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method().toUpperCase() === 'POST'
        && url.origin === API_BASE
        && url.pathname === '/api/v1/generate';
    }, { timeout: 130_000 }).then(
      response => ({ response }),
      error => ({ error })
    );

    item.submittedAt = new Date().toISOString();
    item.status = 'submitting';
    persist();
    await page.locator('#imageGenSubmit').click();
    await waitForCondition(
      () => activeExpectation?.consumed || routeViolation,
      8_000,
      'The production UI did not issue the approved generation POST.'
    );
    assertNoRouteViolation();

    const postOutcome = await postResponsePromise;
    if (postOutcome.error) {
      item.status = 'post-outcome-unknown';
      item.submissionRaw = { transportError: redact(postOutcome.error?.message || postOutcome.error) };
      persist();
      await recoverUnknownSubmission(item);
      throw new Error(`Generation POST outcome is unknown for ${model.id}; no retry or next POST was allowed.`);
    }

    const submissionRaw = await rawResponse(postOutcome.response);
    item.submissionRaw = submissionRaw;
    activeExpectation = null;
    persist();
    if (!submissionRaw.ok || !submissionRaw.body?.ok || !submissionRaw.body?.data?.jobId) {
      item.status = 'submission-unexpected';
      persist();
      await recoverUnknownSubmission(item);
      throw new Error(`Unexpected generation submission response for ${model.id}; stopped after one POST.`);
    }

    const submission = submissionRaw.body.data;
    const jobId = String(submission.jobId || '').trim();
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(jobId)) {
      throw new Error(`Invalid public jobId returned for ${model.id}.`);
    }
    if (submission.idempotentReplay === true) {
      throw new Error(`Unexpected idempotent replay returned for ${model.id}.`);
    }

    const creditsCharged = numberOrNaN(submission.creditsCharged ?? submission.cost?.final);
    if (!Number.isFinite(creditsCharged) || creditsCharged < 0 || creditsCharged > model.budgetFinal + 0.0001) {
      throw new Error(`Unexpected charge returned for ${model.id}.`);
    }
    if (!creditsEqual(creditsCharged, model.quotedFinal)) {
      throw new Error(`Generation charge did not match the authenticated API quote for ${model.id}.`);
    }
    actualCredits = roundCredits(actualCredits + creditsCharged);
    item.jobId = jobId;
    item.creditsCharged = roundCredits(creditsCharged);
    item.status = String(submission.status || 'processing');
    report.actualCredits = actualCredits;
    report.actualYuan = roundCredits(actualCredits / CREDITS_PER_YUAN);
    persist();
    if (actualCredits > MAX_TOTAL_CREDITS) {
      throw new Error(`Actual charge exceeded the approved ${MAX_TOTAL_CREDITS}-credit cap; no next POST was allowed.`);
    }
    item.debitAfterSubmission = await verifyExpectedDebitState({
      stage: `request-${index + 1}-submitted`,
      startingCredits,
      expectedDebits: actualCredits,
      expectedRequestCount: index + 1,
      baselineLedgerItemIds
    });
    persist();

    const completed = await pollJobUntilCompleted(item);
    item.imageUrl = String(completed.imageUrl || '');
    item.status = 'completed-api';
    persist();

    const recent = await waitForRecentCreation(jobId);
    item.recentResult = recent;
    persist();
    const warehouse = await saveRecentCreationThroughUi(jobId, recent.creationId, model.id);
    item.warehouseResult = warehouse;
    item.status = 'completed-and-saved';
    item.completedAt = new Date().toISOString();
    item.debitAfterCompletion = await verifyExpectedDebitState({
      stage: `request-${index + 1}-completed`,
      startingCredits,
      expectedDebits: actualCredits,
      expectedRequestCount: index + 1,
      baselineLedgerItemIds
    });
    persist();

    console.log(JSON.stringify({
      event: 'model-accepted',
      index: index + 1,
      model: model.id,
      clientRequestId: item.clientRequestId,
      jobId,
      creditsCharged: item.creditsCharged,
      cumulativeCredits: actualCredits,
      warehouseCardId: warehouse.cardId
    }));
  }

  activeExpectation = null;
  assertNoRouteViolation();
  if (
    allowedPostCount !== MAX_BILLABLE_REQUESTS
    || seenClientRequestIds.size !== MAX_BILLABLE_REQUESTS
    || seenModels.size !== MAX_BILLABLE_REQUESTS
  ) {
    throw new Error('Final paid POST count or uniqueness guard failed.');
  }

  report.warehouseSummary = await verifyWarehouseStateAndOpenUi(
    report.requests.map(item => ({
      jobId: item.jobId,
      cardId: item.warehouseResult?.cardId,
      model: item.model
    }))
  );
  if (!creditsEqual(actualCredits, quotedTotalCredits)) {
    throw new Error('Final charged credits did not match the authenticated API quotes.');
  }
  report.finalDebitState = await verifyExpectedDebitState({
    stage: 'final',
    startingCredits,
    expectedDebits: quotedTotalCredits,
    expectedRequestCount: MAX_BILLABLE_REQUESTS,
    baselineLedgerItemIds
  });
  report.result = 'completed';
  report.completedAt = new Date().toISOString();
  syncGuardReport();
  persist();
  console.log(JSON.stringify({
    ok: true,
    result: report.result,
    requests: allowedPostCount,
    actualCredits,
    actualYuan: report.actualYuan,
    reportPath
  }));
} catch (error) {
  activeExpectation = null;
  report.result = routeViolation ? 'guard-blocked' : 'stopped';
  report.stoppedAt = new Date().toISOString();
  report.error = redact(error?.message || error);
  syncGuardReport();
  persist();
  console.error(JSON.stringify({
    ok: false,
    result: report.result,
    allowedPaidPosts: allowedPostCount,
    actualCredits,
    reportPath,
    error: report.error
  }));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}

async function loginThroughProductionUi() {
  await page.goto(`${SITE_BASE}/prompts/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => typeof window.openAuthModal === 'function', null, { timeout: 30_000 });
  const loggedIn = await page.evaluate(() => window.SupabaseSync?.isLoggedIn?.() === true);
  if (!loggedIn) {
    await page.evaluate(({ email, password }) => {
      window.openAuthModal('login');
      const emailInput = document.getElementById('authEmail');
      const passwordInput = document.getElementById('authPassword');
      if (!emailInput || !passwordInput) throw new Error('Production login fields are unavailable.');
      emailInput.value = email;
      passwordInput.value = password;
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    }, { email: testEmail, password: testPassword });
    await page.locator('#authSubmitBtn').click();
    try {
      await page.waitForFunction(() => window.SupabaseSync?.isLoggedIn?.() === true, null, { timeout: 45_000 });
    } catch (error) {
      const status = await page.locator('#authStatus').textContent().catch(() => '');
      throw new Error(`Production UI login failed${status ? `: ${status.trim()}` : '.'}`, { cause: error });
    }
  }
}

async function assertProductionConfiguration() {
  const config = await page.evaluate(() => ({
    origin: location.origin,
    apiBase: String(window.API_BASE_URL || '').replace(/\/+$/, ''),
    loggedIn: window.SupabaseSync?.isLoggedIn?.() === true
  }));
  if (config.origin !== SITE_BASE || config.apiBase !== API_BASE || !config.loggedIn) {
    throw new Error('Production UI/API configuration check failed.');
  }
}

async function authenticatedRawGet(path) {
  try {
    return await page.evaluate(async ({ apiBase, requestPath }) => {
      const token = await window.SupabaseSync?.getValidAccessToken?.()
        || window.SupabaseSync?.getSession?.()?.access_token
        || '';
      if (!token) throw new Error('Authenticated browser session is unavailable.');
      const response = await fetch(`${apiBase}${requestPath}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        },
        cache: 'no-store'
      });
      const rawText = await response.text();
      let body = null;
      try { body = rawText ? JSON.parse(rawText) : null; } catch { /* preserve rawText */ }
      return {
        at: new Date().toISOString(),
        method: 'GET',
        path: requestPath,
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        rawText,
        body
      };
    }, { apiBase: API_BASE, requestPath: path });
  } catch (error) {
    return {
      at: new Date().toISOString(),
      method: 'GET',
      path,
      ok: false,
      status: 0,
      transportError: redact(error?.message || error),
      rawText: '',
      body: null
    };
  }
}

async function refreshAndReadCredits() {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const credits = await page.evaluate(async () => {
        const result = await window.PromptHubApi?.syncMe?.({ silent: true });
        if (result && result.ok === false) throw new Error('Unable to refresh account credits.');
        const current = Number(window.PointsSystem?.getCredits?.());
        if (!Number.isFinite(current)) throw new Error('Account credits are unavailable after refresh.');
        return current;
      });
      return credits;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(1000 * (attempt + 1));
    }
  }
  throw new Error(`Unable to refresh account credits after read-only retries: ${redact(lastError?.message || lastError)}`);
}

async function readServerCreditSnapshot(stage) {
  const raw = await authenticatedRawGet('/api/v1/me');
  const data = raw.body?.data;
  const credits = numberOrNaN(data?.credits);
  if (!raw.ok || !raw.body?.ok || !Number.isFinite(credits)) {
    throw new Error(`Authoritative balance read failed at ${stage} (${raw.status || 0}).`);
  }
  return {
    at: raw.at,
    stage,
    credits: roundCredits(credits),
    creditsPermanent: finiteCreditOrNull(data?.creditsPermanent),
    dailyCredits: finiteCreditOrNull(data?.dailyCredits),
    lifetimeCreditsSpent: finiteCreditOrNull(data?.lifetimeCreditsSpent)
  };
}

async function readGenerationLedgerSnapshot(stage) {
  const raw = await authenticatedRawGet(`/api/v1/me/ledger?limit=${LEDGER_LIMIT}`);
  const rows = raw.body?.data?.items;
  if (!raw.ok || !raw.body?.ok || !Array.isArray(rows)) {
    throw new Error(`Credit ledger read failed at ${stage} (${raw.status || 0}).`);
  }
  const items = rows.map(row => ({
    id: String(row?.id || ''),
    delta: finiteCreditOrNull(row?.delta),
    balanceAfter: finiteCreditOrNull(row?.balanceAfter),
    reason: String(row?.reason || ''),
    model: String(row?.meta?.model || ''),
    resolution: String(row?.meta?.resolution || ''),
    count: Number.isInteger(Number(row?.meta?.count)) ? Number(row.meta.count) : null,
    createdAt: String(row?.createdAt || '')
  }));
  if (items.some(item => !item.id)) {
    throw new Error(`Credit ledger returned an invalid item at ${stage}.`);
  }
  return {
    at: raw.at,
    stage,
    itemIds: items.map(item => item.id),
    items
  };
}

async function verifyExpectedDebitState({
  stage,
  startingCredits,
  expectedDebits,
  expectedRequestCount,
  baselineLedgerItemIds
}) {
  const expectedBalance = roundCredits(startingCredits - expectedDebits);
  const serverBalance = await readServerCreditSnapshot(stage);
  const uiCredits = roundCredits(await refreshAndReadCredits());
  const ledger = await readGenerationLedgerSnapshot(stage);
  const newItems = ledger.items.filter(item => !baselineLedgerItemIds.has(item.id));
  const generationEntries = newItems.filter(item => item.reason === 'image_generation');
  const generationDebits = generationEntries.filter(item => Number(item.delta) < 0);
  const unexpectedNonDebitEntries = generationEntries.filter(item => Number(item.delta) >= 0);
  const generationRefunds = newItems.filter(item => item.reason === 'image_generation_refund');
  const ledgerDebits = roundCredits(generationDebits.reduce((sum, item) => {
    return sum + (Number(item.delta) < 0 ? -Number(item.delta) : 0);
  }, 0));
  const expectedBillableRequests = report.requests
    .slice(0, expectedRequestCount)
    .filter(item => Number(item.expectedCredits) > 0);
  const expectedModels = expectedBillableRequests.map(item => String(item.model || ''));
  const expectedDebitByModel = new Map(expectedBillableRequests
    .map(item => [String(item.model || ''), Number(item.expectedCredits)]));
  const observedModels = generationDebits.map(item => item.model);

  if (generationRefunds.length) {
    throw new Error(`An unexpected image-generation refund was recorded at ${stage}.`);
  }
  if (
    generationDebits.length !== expectedBillableRequests.length
    || unexpectedNonDebitEntries.length
    || generationDebits.some(item => item.resolution !== RESOLUTION || item.count !== 1)
    || generationDebits.some(item => !creditsEqual(
      -Number(item.delta),
      expectedDebitByModel.get(item.model)
    ))
    || !creditsEqual(ledgerDebits, expectedDebits)
  ) {
    throw new Error(`Credit ledger debit mismatch at ${stage}.`);
  }
  if (
    expectedModels.some(model => observedModels.filter(value => value === model).length !== 1)
    || observedModels.some(model => !expectedModels.includes(model))
  ) {
    throw new Error(`Credit ledger model mismatch at ${stage}.`);
  }
  if (!creditsEqual(serverBalance.credits, expectedBalance)) {
    throw new Error(`Authoritative balance mismatch or unintended refund detected at ${stage}.`);
  }
  if (!creditsEqual(uiCredits, expectedBalance)) {
    throw new Error(`Production UI balance did not converge to the authoritative balance at ${stage}.`);
  }

  return {
    at: serverBalance.at,
    stage,
    startingCredits: roundCredits(startingCredits),
    expectedDebits: roundCredits(expectedDebits),
    expectedBillableRequestCount: expectedBillableRequests.length,
    expectedBalance,
    serverBalance,
    uiCredits,
    ledgerDebits,
    generationDebits,
    generationRefunds
  };
}

async function openImageGenerationUi() {
  await page.evaluate(() => window.switchAppPage?.('imagegen'));
  await page.waitForFunction(() => (
    document.getElementById('pageImageGen')?.classList.contains('active')
    && document.getElementById('imageGenModel')?.disabled === false
    && document.getElementById('imageGenModel')?.getAttribute('aria-busy') !== 'true'
    && document.getElementById('imageGenModelTrigger')?.disabled === false
    && document.getElementById('imageGenModelTrigger')?.getAttribute('aria-busy') !== 'true'
    && document.querySelectorAll('#imageGenModelFamilyTabs [data-family]').length > 0
    && document.querySelectorAll('#imageGenModelMenu [data-model-id]').length > 0
  ), null, { timeout: 45_000 });
  await page.selectOption('#imageGenCount', '1');
}

async function clearReferenceImagesThroughUi() {
  for (let count = 0; count < 8; count += 1) {
    const remove = page.locator('.imagegen-ref-rm').first();
    if (!(await remove.count())) break;
    await remove.click();
  }
  const remaining = await page.locator('.imagegen-ref-rm').count();
  if (remaining) throw new Error('Reference images could not be cleared before the paid test.');
}

async function disableCommunityPublishThroughUi() {
  const publish = page.locator('#imageGenGenPublicBtn');
  if (await publish.getAttribute('aria-pressed') === 'true') await publish.click();
  if (await publish.getAttribute('aria-pressed') === 'true') {
    throw new Error('Community publishing could not be disabled before the paid test.');
  }
}

async function selectModelThroughUi(model) {
  const modelId = String(model.id || '');
  const trigger = page.locator('#imageGenModelTrigger');
  await trigger.waitFor({ state: 'visible' });

  const selectFromCurrentFamily = async () => {
    const availability = await page.evaluate(expectedModelId => ({
      native: [...(document.getElementById('imageGenModel')?.options || [])]
        .some(option => option.value === expectedModelId && !option.disabled),
      custom: [...document.querySelectorAll('#imageGenModelMenu [data-model-id]')]
        .some(option => option.dataset.modelId === expectedModelId && !option.disabled)
    }), modelId);
    if (!availability.native || !availability.custom) return null;

    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    const option = page.locator(`#imageGenModelMenu [data-model-id="${modelId}"]`);
    await option.waitFor({ state: 'visible' });
    if (await option.isDisabled()) throw new Error(`UI model option is disabled: ${modelId}.`);
    await option.click();
    await page.waitForFunction(expectedModelId => {
      const select = document.getElementById('imageGenModel');
      const selected = document.querySelector(
        `#imageGenModelMenu [data-model-id="${CSS.escape(expectedModelId)}"]`
      );
      return select?.value === expectedModelId
        && selected?.getAttribute('aria-selected') === 'true';
    }, modelId, { timeout: 10_000 });
    return readSelectedModelUiState(modelId);
  };

  const current = await selectFromCurrentFamily();
  if (current) return current;

  const families = await page.locator('#imageGenModelFamilyTabs [data-family]').evaluateAll(tabs => (
    [...new Set(tabs.map(tab => String(tab.dataset.family || '')).filter(Boolean))]
  ));
  for (const family of families) {
    const tab = page.locator(`#imageGenModelFamilyTabs [data-family="${family}"]`);
    if (!(await tab.count())) continue;
    if (!(await tab.evaluate(node => node.classList.contains('active')))) await tab.click();
    await page.waitForFunction(expectedFamily => {
      const active = [...document.querySelectorAll('#imageGenModelFamilyTabs [data-family]')]
        .find(tab => tab.dataset.family === expectedFamily);
      return active?.classList.contains('active')
        && document.getElementById('imageGenModel')?.getAttribute('aria-busy') !== 'true'
        && document.querySelectorAll('#imageGenModelMenu [data-model-id]').length > 0;
    }, family, { timeout: 10_000 });
    const selected = await selectFromCurrentFamily();
    if (selected) return selected;
  }

  const diagnostics = await page.evaluate(expectedModelId => ({
    expectedModelId,
    activeFamily: document.querySelector('#imageGenModelFamilyTabs [data-family].active')?.getAttribute('data-family') || '',
    families: [...document.querySelectorAll('#imageGenModelFamilyTabs [data-family]')]
      .map(tab => tab.getAttribute('data-family') || ''),
    nativeModels: [...(document.getElementById('imageGenModel')?.options || [])]
      .map(option => option.value),
    customModels: [...document.querySelectorAll('#imageGenModelMenu [data-model-id]')]
      .map(option => option.getAttribute('data-model-id') || '')
  }), modelId);
  throw new Error(`Exact UI model option is unavailable after scanning deployed families: ${JSON.stringify(diagnostics)}.`);
}

async function readSelectedModelUiState(modelId) {
  return page.evaluate(expectedModelId => ({
    modelId: document.getElementById('imageGenModel')?.value || '',
    expectedModelId,
    activeFamily: document.querySelector('#imageGenModelFamilyTabs [data-family].active')?.getAttribute('data-family') || '',
    triggerLabel: document.getElementById('imageGenModelTriggerLabel')?.textContent?.trim() || '',
    customSelected: document.querySelector(
      `#imageGenModelMenu [data-model-id="${CSS.escape(expectedModelId)}"]`
    )?.getAttribute('aria-selected') === 'true'
  }), modelId);
}

async function validateApprovedModelSelectionUi(models) {
  const results = [];
  for (const model of models) {
    const selected = await selectModelThroughUi(model);
    if (
      selected.modelId !== model.id
      || selected.expectedModelId !== model.id
      || !selected.activeFamily
      || !selected.triggerLabel
      || !selected.customSelected
    ) {
      throw new Error(`Read-only UI model selection preflight failed for ${model.id}.`);
    }
    results.push(selected);
  }
  return results;
}

async function ensureAdvancedGenerationFieldsVisible() {
  const fold = page.locator('#imageGenAdvancedFold');
  await fold.waitFor({ state: 'visible' });
  const summary = fold.locator('summary');
  await summary.waitFor({ state: 'visible' });
  if (!(await fold.evaluate(node => node.open === true))) {
    await summary.click();
  }
  await page.waitForFunction(
    () => document.getElementById('imageGenAdvancedFold')?.open === true,
    null,
    { timeout: 10_000 }
  );
  await Promise.all([
    page.locator('#imageGenSize').waitFor({ state: 'visible' }),
    page.locator('#imageGenQuality').waitFor({ state: 'visible' }),
    page.locator('#imageGenCardTitle').waitFor({ state: 'visible' })
  ]);
}

async function selectRequiredVisibleOption(selector, value, label) {
  const control = page.locator(selector);
  await control.waitFor({ state: 'visible' });
  const expectedValue = String(value);
  await page.waitForFunction(({ selector: selectSelector, expected }) => {
    const select = document.querySelector(selectSelector);
    return select instanceof HTMLSelectElement
      && !select.disabled
      && [...select.options].some(option => option.value === expected && !option.disabled);
  }, { selector, expected: expectedValue }, { timeout: 15_000 });

  await control.selectOption(expectedValue);
  const state = await control.evaluate((select, expected) => ({
    value: select.value,
    disabled: select.disabled,
    visible: select.checkVisibility?.() ?? select.getClientRects().length > 0,
    enabledOption: [...select.options].some(option => option.value === expected && !option.disabled)
  }), expectedValue);
  if (!state.visible || state.disabled || !state.enabledOption || state.value !== expectedValue) {
    throw new Error(`${label} UI selection could not be confirmed: ${JSON.stringify(state)}.`);
  }
  return state;
}

async function assertOrSetApprovedResolution() {
  const control = page.locator('#imageGenResolution');
  const state = await control.evaluate(select => ({
    disabled: select.disabled,
    value: select.value,
    visible: select.checkVisibility?.() ?? select.getClientRects().length > 0,
    fixedParamHidden: select.closest('.imagegen-param[data-param="resolution"]')?.hidden === true,
    options: [...select.options].map(option => ({
      value: String(option.value || '').toLowerCase(),
      disabled: option.disabled
    }))
  }));

  if (state.visible && state.options.length > 1 && state.options.some(option => option.value !== RESOLUTION && !option.disabled)) {
    await selectRequiredVisibleOption('#imageGenResolution', RESOLUTION, 'Resolution');
    return { mode: 'visible-selected', value: RESOLUTION };
  }

  const enabledOptions = state.options.filter(option => !option.disabled).map(option => option.value);
  if (
    state.disabled
    || state.value.toLowerCase() !== RESOLUTION
    || state.options.length !== 1
    || enabledOptions.length !== 1
    || enabledOptions[0] !== RESOLUTION
  ) {
    throw new Error(`Hidden fixed resolution is not exactly ${RESOLUTION}.`);
  }
  return { mode: 'fixed-hidden', value: RESOLUTION };
}

async function configureApprovedGenerationForm({ prompt, modelId, index, title }) {
  await ensureAdvancedGenerationFieldsVisible();
  const resolution = await assertOrSetApprovedResolution();
  await selectRequiredVisibleOption('#imageGenQuality', QUALITY, 'Quality');
  await selectRequiredVisibleOption('#imageGenSize', SIZE, 'Aspect ratio');
  await selectRequiredVisibleOption('#imageGenCount', '1', 'Image count');
  await page.locator('#imageGenPrompt').fill(prompt);
  const cardTitle = title || `Acceptance ${index}/${MAX_BILLABLE_REQUESTS} ${modelId}`;
  await page.locator('#imageGenCardTitle').fill(cardTitle);
  await clearReferenceImagesThroughUi();
  await disableCommunityPublishThroughUi();
  try {
    await page.waitForFunction(({ expectedModel, resolution, quality, size }) => {
      const button = document.getElementById('imageGenSubmit');
      const fold = document.getElementById('imageGenAdvancedFold');
      const buttonVisible = !!button && (button.checkVisibility?.() ?? button.getClientRects().length > 0);
      return fold?.open === true
        && document.getElementById('imageGenModel')?.value === expectedModel
        && document.getElementById('imageGenResolution')?.value.toLowerCase() === resolution
        && document.getElementById('imageGenQuality')?.value === quality
        && document.getElementById('imageGenSize')?.value === size
        && document.getElementById('imageGenCount')?.value === '1'
        && buttonVisible
        && !button.disabled
        && button.getAttribute('aria-busy') !== 'true';
    }, { expectedModel: modelId, resolution: RESOLUTION, quality: QUALITY, size: SIZE }, { timeout: 20_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const read = id => {
        const node = document.getElementById(id);
        return node ? {
          value: 'value' in node ? node.value : null,
          disabled: 'disabled' in node ? node.disabled : null,
          hidden: node.hidden,
          visible: node.checkVisibility?.() ?? node.getClientRects().length > 0,
          busy: node.getAttribute('aria-busy')
        } : null;
      };
      return {
        activePage: document.querySelector('.app-page.active')?.id || '',
        foldOpen: document.getElementById('imageGenAdvancedFold')?.open === true,
        model: read('imageGenModel'),
        resolution: read('imageGenResolution'),
        quality: read('imageGenQuality'),
        size: read('imageGenSize'),
        count: read('imageGenCount'),
        submit: read('imageGenSubmit'),
        promptLength: String(document.getElementById('imageGenPrompt')?.value || '').length,
        titleLength: String(document.getElementById('imageGenCardTitle')?.value || '').length,
        bodyText: document.body?.innerText?.slice(-1200) || ''
      };
    });
    throw new Error(`Generation form readiness timed out for ${modelId}: ${JSON.stringify(diagnostic)}`, { cause: error });
  }

  return page.evaluate(({ expectedModel, resolutionMode }) => ({
    model: document.getElementById('imageGenModel')?.value || '',
    expectedModel,
    resolution: document.getElementById('imageGenResolution')?.value || '',
    resolutionVisible: document.getElementById('imageGenResolution')?.getClientRects().length > 0,
    resolutionMode,
    quality: document.getElementById('imageGenQuality')?.value || '',
    size: document.getElementById('imageGenSize')?.value || '',
    count: document.getElementById('imageGenCount')?.value || '',
    advancedOpen: document.getElementById('imageGenAdvancedFold')?.open === true,
    submitEnabled: document.getElementById('imageGenSubmit')?.disabled === false,
    submitBusy: document.getElementById('imageGenSubmit')?.getAttribute('aria-busy') === 'true',
    submitVisible: document.getElementById('imageGenSubmit')?.getClientRects().length > 0,
    referenceCount: document.querySelectorAll('.imagegen-ref-rm').length,
    publishEnabled: document.getElementById('imageGenGenPublicBtn')?.getAttribute('aria-pressed') === 'true',
    prompt: document.getElementById('imageGenPrompt')?.value || '',
    cardTitle: document.getElementById('imageGenCardTitle')?.value || ''
  }), { expectedModel: modelId, resolutionMode: resolution.mode });
}

async function validateApprovedModelFormUi(models) {
  const results = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    await selectModelThroughUi(model);
    const state = await configureApprovedGenerationForm({
      prompt: `Read-only form preflight ${index + 1}/${models.length}`,
      modelId: model.id,
      index: index + 1,
      title: `Read-only preflight ${index + 1}/${models.length} ${model.id}`
    });
    if (
      state.model !== model.id
      || state.resolution.toLowerCase() !== RESOLUTION
      || !['visible-selected', 'fixed-hidden'].includes(state.resolutionMode)
      || state.quality !== QUALITY
      || state.size !== SIZE
      || state.count !== '1'
      || !state.advancedOpen
      || !state.submitEnabled
      || state.submitBusy
      || !state.submitVisible
      || state.referenceCount !== 0
      || state.publishEnabled
    ) {
      throw new Error(`Read-only generation form preflight failed for ${model.id}.`);
    }
    results.push(state);
  }
  return results;
}

async function setApprovedGenerationForm(prompt, modelId, index) {
  await configureApprovedGenerationForm({ prompt, modelId, index });
}

async function recoverUnknownSubmission(item) {
  if (!item.clientRequestId) return null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const raw = await authenticatedRawGet(
      `/api/v1/generate/requests/${encodeURIComponent(item.clientRequestId)}`
    );
    item.recoveryGets.push(raw);
    const jobId = String(raw.body?.data?.jobId || '').trim();
    if (raw.ok && jobId) {
      item.jobId = jobId;
      item.recoveredByClientRequestId = true;
      persist();
      return raw.body.data;
    }
    persist();
    if (raw.status !== 404 || raw.transportError) return null;
    await delay(3000);
  }
  return null;
}

async function pollJobUntilCompleted(item) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertNoRouteViolation();
    const raw = await authenticatedRawGet(
      `/api/v1/generate/jobs/${encodeURIComponent(item.jobId)}`
    );
    item.pollGets.push(raw);
    persist();
    if (!raw.ok || !raw.body?.ok || !raw.body?.data) {
      throw new Error(`Read-only job polling failed for ${item.model} (${raw.status || 0}).`);
    }
    const data = raw.body.data;
    const status = String(data.status || '');
    item.status = status || 'unknown';
    persist();
    if (status === 'completed') {
      if (!data.imageUrl) throw new Error(`Completed job has no image URL for ${item.model}.`);
      return data;
    }
    if (status === 'failed') throw new Error(`Generation job failed for ${item.model}; no next POST was allowed.`);
    if (status !== 'processing') throw new Error(`Unexpected job status for ${item.model}: ${status || '(empty)'}.`);
    await delay(3000);
  }
  throw new Error(`Generation job timed out for ${item.model}; no next POST was allowed.`);
}

async function waitForRecentCreation(jobId) {
  const deadline = Date.now() + UI_ARCHIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertNoRouteViolation();
    const state = await page.evaluate(expectedJobId => {
      let creations = [];
      try { creations = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]'); } catch { /* ignore */ }
      const base = value => String(value || '').replace(/#\d+$/, '');
      const creation = creations.find(entry => base(entry?.jobId) === expectedJobId) || null;
      const failed = [...document.querySelectorAll('#imageGenFeed [data-failed="1"]')]
        .find(card => base(card.dataset.jobId) === expectedJobId);
      return {
        creation: creation ? {
          creationId: creation.id,
          jobId: base(creation.jobId),
          model: creation.model || null,
          resolution: creation.resolution || null,
          imageRef: creation.image || null,
          savedToWarehouse: !!creation.savedToWarehouse,
          warehouseCardId: creation.warehouseCardId || null
        } : null,
        failed: failed?.querySelector('.imagegen-gen-failed-error')?.textContent?.trim() || ''
      };
    }, jobId);
    if (state.failed) throw new Error('The production UI rendered a failed result card.');
    if (state.creation?.imageRef) {
      const image = page.locator(`#imageGenFeed img[data-job-id="${jobId}"]`).first();
      await image.waitFor({ state: 'attached', timeout: 30_000 });
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(expectedJobId => [...document.querySelectorAll('#imageGenFeed img[data-job-id]')]
        .some(img => {
          const src = img.currentSrc || img.src || '';
          return img.getAttribute('data-job-id') === expectedJobId
            && img.complete
            && img.naturalWidth > 8
            && !src.includes('data:image/svg')
            && (/^https?:\/\//i.test(src) || /^data:image\/(?!svg)/i.test(src) || src.startsWith('blob:'));
        }), jobId, { timeout: 60_000 });
      const imageState = await image.evaluate(img => ({
        imageRef: img.getAttribute('data-image-ref') || '',
        storageRef: img.getAttribute('data-storage-ref') || '',
        currentSrc: img.currentSrc || img.src || '',
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      }));
      return { ...state.creation, image: imageState };
    }
    await delay(750);
  }
  throw new Error(`Production UI did not archive the completed image for job ${jobId}.`);
}

async function saveRecentCreationThroughUi(jobId, creationId, expectedModel) {
  const image = page.locator(`#imageGenFeed img[data-job-id="${jobId}"]`).first();
  const card = image.locator('xpath=ancestor::article[contains(@class,"imagegen-feed-card")]');
  await card.hover();
  const save = card.locator('[data-save-feed="1"]');
  await save.waitFor({ state: 'visible' });
  await save.click();

  await page.waitForFunction(expectedJobId => {
    const base = value => String(value || '').replace(/#\d+$/, '');
    return (window.__promptHubCards || []).some(card => base(card?.genJobId) === expectedJobId && card?.image);
  }, jobId, { timeout: UI_ARCHIVE_TIMEOUT_MS });

  const result = await page.evaluate(({ expectedJobId, expectedCreationId }) => {
    const base = value => String(value || '').replace(/#\d+$/, '');
    const card = (window.__promptHubCards || []).find(entry => base(entry?.genJobId) === expectedJobId) || null;
    let creations = [];
    try { creations = JSON.parse(localStorage.getItem('promptrepo_creations') || '[]'); } catch { /* ignore */ }
    const creation = creations.find(entry => entry?.id === expectedCreationId) || null;
    return {
      cardId: card?.id || null,
      genJobId: base(card?.genJobId),
      genSourceId: card?.genSourceId || null,
      model: card?.model || null,
      resolution: card?.resolution || null,
      imageRef: card?.image || null,
      stableImageRef: !!(card?.image && window.SupabaseSync?.isStorageRef?.(card.image)),
      creationSavedToWarehouse: !!creation?.savedToWarehouse,
      creationWarehouseCardId: creation?.warehouseCardId || null
    };
  }, { expectedJobId: jobId, expectedCreationId: creationId });

  if (
    !result.cardId
    || result.genJobId !== jobId
    || result.model !== expectedModel
    || String(result.resolution || '').toLowerCase() !== RESOLUTION
    || !result.stableImageRef
    || !result.creationSavedToWarehouse
    || String(result.creationWarehouseCardId || '') !== String(result.cardId)
  ) {
    throw new Error(`Warehouse persistence contract failed for job ${jobId}.`);
  }
  const cloudPersistence = await confirmWarehouseCardCloudPersistence(
    jobId,
    result.cardId,
    expectedModel
  );
  return { ...result, cloudPersistence };
}

async function confirmWarehouseCardCloudPersistence(jobId, cardId, expectedModel) {
  const result = await page.evaluate(async ({ expectedJobId, expectedCardId, model, resolution }) => {
    if (typeof window.pushToCloud !== 'function') {
      throw new Error('Explicit cloud push is unavailable.');
    }
    if (typeof window.SupabaseSync?.pullCloudData !== 'function') {
      throw new Error('Read-only cloud verification is unavailable.');
    }

    window.SyncOrchestrator?.cancelPendingPush?.();
    if (typeof window.waitForCloudSyncIdle === 'function') {
      const idle = await window.waitForCloudSyncIdle(120_000);
      if (!idle) throw new Error('Cloud sync did not become idle before verification.');
    }

    const push = await window.pushToCloud({
      silent: true,
      skipSafety: false,
      skipImageUpload: false,
      strictImageCheck: true
    });
    const warnings = Array.isArray(push?.warnings) ? push.warnings : [];
    if (!push?.ok || push?.busy || push?.cancelled || warnings.length) {
      throw new Error('Strict cloud persistence push did not complete cleanly.');
    }

    const cloud = await window.SupabaseSync.pullCloudData({ force: true, ifStale: false });
    const base = value => String(value || '').replace(/#\d+$/, '');
    const remoteCard = Array.isArray(cloud?.cards)
      ? cloud.cards.find(card => String(card?.id || '') === String(expectedCardId))
      : null;
    return {
      pushed: true,
      warningCount: warnings.length,
      remoteCardId: remoteCard?.id || null,
      remoteJobId: base(remoteCard?.genJobId),
      remoteModel: remoteCard?.model || null,
      remoteResolution: String(remoteCard?.resolution || '').toLowerCase(),
      remoteContractMatches: !!(
        remoteCard
        && String(remoteCard.id || '') === String(expectedCardId)
        && base(remoteCard.genJobId) === expectedJobId
        && remoteCard.model === model
        && String(remoteCard.resolution || '').toLowerCase() === resolution
      ),
      remoteStableImageRef: !!(
        remoteCard?.image
        && window.SupabaseSync?.isStorageRef?.(remoteCard.image)
      )
    };
  }, {
    expectedJobId: jobId,
    expectedCardId: cardId,
    model: expectedModel,
    resolution: RESOLUTION
  });

  if (
    !result.pushed
    || !result.remoteContractMatches
    || String(result.remoteCardId || '') !== String(cardId)
    || result.remoteJobId !== jobId
    || result.remoteModel !== expectedModel
    || result.remoteResolution !== RESOLUTION
    || !result.remoteStableImageRef
    || result.warningCount !== 0
  ) {
    throw new Error(`Cloud card persistence contract failed for job ${jobId}.`);
  }
  return result;
}

async function verifyWarehouseStateAndOpenUi(expected) {
  await page.evaluate(() => window.switchAppPage?.('warehouse'));
  await page.waitForFunction(() => document.getElementById('pageWarehouse')?.classList.contains('active'));
  await page.waitForFunction(expectedRows => expectedRows.every(expectedRow => {
    const cardId = String(expectedRow.cardId || '');
    return cardId
      && document.querySelector(`#cardsContainer .card[data-id="${CSS.escape(cardId)}"]`);
  }), expected, { timeout: UI_ARCHIVE_TIMEOUT_MS });
  const summary = await page.evaluate(expectedRows => {
    const base = value => String(value || '').replace(/#\d+$/, '');
    const cards = window.__promptHubCards || [];
    const rows = expectedRows.map(expectedRow => {
      const card = cards.find(entry => base(entry?.genJobId) === expectedRow.jobId) || null;
      return {
        jobId: expectedRow.jobId,
        expectedCardId: expectedRow.cardId || null,
        expectedModel: expectedRow.model || null,
        cardId: card?.id || null,
        genJobId: base(card?.genJobId),
        model: card?.model || null,
        imageRef: card?.image || null,
        stableImageRef: !!(card?.image && window.SupabaseSync?.isStorageRef?.(card.image)),
        rendered: !!(card?.id && document.querySelector(`#cardsContainer .card[data-id="${CSS.escape(String(card.id))}"]`))
      };
    });
    return {
      activePage: document.querySelector('.app-page.active')?.id || '',
      rows,
      stateMatches: rows.filter(row => (
        row.cardId
        && row.genJobId === row.jobId
        && row.model === row.expectedModel
        && row.stableImageRef
      )).length,
      renderedMatches: rows.filter(row => row.rendered).length
    };
  }, expected);
  if (summary.stateMatches !== expected.length) {
    throw new Error(`Final card-library state does not contain all ${expected.length} accepted jobs.`);
  }
  if (summary.renderedMatches !== expected.length) {
    throw new Error(`Final card-library UI did not render all ${expected.length} accepted jobs.`);
  }
  const cloud = await verifyFinalCloudWarehouseState(expected);
  return { ...summary, cloud };
}

async function verifyFinalCloudWarehouseState(expected) {
  const summary = await page.evaluate(async expectedRows => {
    if (typeof window.SupabaseSync?.pullCloudData !== 'function') {
      throw new Error('Final cloud warehouse read is unavailable.');
    }
    const cloud = await window.SupabaseSync.pullCloudData({ force: true, ifStale: false });
    const cards = Array.isArray(cloud?.cards) ? cloud.cards : [];
    const base = value => String(value || '').replace(/#\d+$/, '');
    const rows = expectedRows.map(expectedRow => {
      const card = cards.find(item => String(item?.id || '') === String(expectedRow.cardId || '')) || null;
      return {
        expectedCardId: expectedRow.cardId || null,
        cardId: card?.id || null,
        jobId: base(card?.genJobId),
        model: card?.model || null,
        stableImageRef: !!(card?.image && window.SupabaseSync?.isStorageRef?.(card.image)),
        matches: !!(
          card
          && String(card.id || '') === String(expectedRow.cardId || '')
          && base(card.genJobId) === expectedRow.jobId
          && card.model === expectedRow.model
          && card.image
          && window.SupabaseSync?.isStorageRef?.(card.image)
        )
      };
    });
    return {
      rows,
      matches: rows.filter(row => row.matches).length
    };
  }, expected);
  if (summary.matches !== expected.length) {
    throw new Error(`Final cloud card-library state does not contain all ${expected.length} accepted jobs.`);
  }
  return summary;
}

async function rawResponse(response) {
  const rawText = await response.text();
  let body = null;
  try { body = rawText ? JSON.parse(rawText) : null; } catch { /* preserve rawText */ }
  return {
    at: new Date().toISOString(),
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    ok: response.ok(),
    status: response.status(),
    contentType: response.headers()['content-type'] || '',
    rawText,
    body
  };
}

function recordRouteViolation(reason, request) {
  const violation = { at: new Date().toISOString(), reason, request };
  routeViolation ||= violation;
  report.guard.violations.push(violation);
  syncGuardReport();
  persist();
}

function assertNoRouteViolation() {
  if (routeViolation) throw new Error(`Paid POST route guard blocked a request: ${routeViolation.reason}.`);
}

function assertNoPaidSubmissionBeforeExecution() {
  assertNoRouteViolation();
  if (
    allowedPostCount !== 0
    || seenClientRequestIds.size !== 0
    || seenModels.size !== 0
    || activeExpectation !== null
  ) {
    throw new Error('UI preflight must complete before any paid generation submission.');
  }
}

function syncGuardReport() {
  report.guard.allowedPostCount = allowedPostCount;
  report.guard.seenClientRequestIds = [...seenClientRequestIds];
  report.guard.seenModels = [...seenModels];
}

async function waitForCondition(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
}

function numberOrNaN(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function finiteCreditOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? roundCredits(number) : null;
}

function creditsEqual(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= CREDIT_TOLERANCE;
}

function roundCredits(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redact(value) {
  let text = String(value || '');
  if (testEmail) text = text.split(testEmail).join('[REDACTED_EMAIL]');
  if (testPassword) text = text.split(testPassword).join('[REDACTED_PASSWORD]');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(access[_-]?token["'=:\s]+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED_TOKEN]')
    .slice(0, 2000);
}

function persist() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
