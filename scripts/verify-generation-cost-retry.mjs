import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiClientSource = readFileSync(join(root, 'api-client.js'), 'utf8');
const imageSubmitSource = readFileSync(join(root, 'imagegen-submit.js'), 'utf8');
const quoteSource = readFileSync(join(root, 'legacy', 'features-draft', 'part-12.js'), 'utf8');
const repositoryRoot = existsSync(join(root, 'server')) ? root : join(root, '..');
const serverGenerateSource = readFileSync(
  join(repositoryRoot, 'server', 'src', 'routes', 'v1', 'generate.ts'),
  'utf8'
);

await verifyRetryableColdStart();
await verifyConcurrentSingleFlight();
await verifyRetryLimit();
await verifyNonRetryableResponse();
await verifyNetworkFailureIsNotRetried();
await verifyRateLimitIsNotRetried();
await verifyAuthFailureIsNotRetried();
await verifyConflictInvalidatesQuote();
await verifyBlendConflictInvalidatesQuote();
await verifyPaidPostNeverRetries();

assert(
  quoteSource.includes('quotedCredits: quote.data.final'),
  'API quote must preserve the displayed credits for submission'
);
assert(
  imageSubmitSource.includes('quotedCredits,'),
  'image submission must return the displayed quote to the Worker'
);
assert(
  imageSubmitSource.includes('meta.mjParams?.speed ? { speed: meta.mjParams.speed } : undefined'),
  'Midjourney submission quote must use the selected speed'
);
assert(
  /mjBlend\(\{[\s\S]*?quotedCredits[\s\S]*?\}\)/.test(imageSubmitSource),
  'Midjourney blend must return the displayed quote to the Worker'
);

const blendRouteStart = serverGenerateSource.indexOf("generateRoutes.post('/mj-blend'");
const blendRouteEnd = serverGenerateSource.indexOf("generateRoutes.get('/jobs/:jobId/image'", blendRouteStart);
const blendRouteSource = serverGenerateSource.slice(blendRouteStart, blendRouteEnd);
assert(blendRouteStart >= 0 && blendRouteEnd > blendRouteStart, 'Midjourney blend route must exist');
assert(
  blendRouteSource.indexOf('assertQuotedGenerationCost(parsed.data.quotedCredits, final)')
    < blendRouteSource.indexOf(".from('generation_requests')"),
  'Midjourney blend quote conflict must be checked before job creation'
);

console.log('verify-generation-cost-retry OK');

async function verifyRetryableColdStart() {
  const test = apiWithResponses([
    response(503, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'cold' } }),
    response(200, { ok: true, data: { final: 5.5 } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'image2');
  assert(result.ok && result.data?.final === 5.5, 'one transient 503 must recover');
  assert(test.requests.length === 2, 'one transient 503 must issue exactly one retry');
  assert(test.requests.every(item => item.method === 'GET'), 'cost retry must remain read-only');
}

async function verifyConcurrentSingleFlight() {
  const test = apiWithResponses([
    response(502, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'cold' } }),
    response(200, { ok: true, data: { final: 6 } })
  ]);
  const [first, second] = await Promise.all([
    test.api.getGenerationCost('1k', 'standard', 'lingtu-pro'),
    test.api.getGenerationCost('1k', 'standard', 'lingtu-pro')
  ]);
  assert(first.ok && second.ok, 'concurrent callers must share the recovered quote');
  assert(test.requests.length === 2, 'concurrent quote callers must share one retry sequence');
}

async function verifyRetryLimit() {
  const test = apiWithResponses([
    response(504, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'cold' } }),
    response(503, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'still cold' } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'image2');
  assert(
    !result.ok && result.status === 503,
    `the second server error must be returned: ${JSON.stringify(result)} ${JSON.stringify(test.requests)}`
  );
  assert(test.requests.length === 2, 'cost endpoint must retry at most once');
}

async function verifyNonRetryableResponse() {
  const test = apiWithResponses([
    response(400, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'bad model' } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'bad-model');
  assert(!result.ok && result.status === 400, 'validation errors must be returned directly');
  assert(test.requests.length === 1, 'validation errors must not retry');
}

async function verifyNetworkFailureIsNotRetried() {
  const test = apiWithResponses([
    new TypeError('Failed to fetch'),
    response(200, { ok: true, data: { final: 5.5 } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'image2');
  assert(!result.ok && result.code === 'NETWORK_ERROR', 'network failures must be returned directly');
  assert(test.requests.length === 1, 'network failures must not retry the quote');
}

async function verifyRateLimitIsNotRetried() {
  const test = apiWithResponses([
    response(429, { ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } }),
    response(200, { ok: true, data: { final: 5.5 } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'image2');
  assert(!result.ok && result.status === 429, 'rate limits must be returned directly');
  assert(test.requests.length === 1, 'rate limits must not retry the quote');
}

async function verifyAuthFailureIsNotRetried() {
  const test = apiWithResponses([
    response(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'expired' } }),
    response(200, { ok: true, data: { final: 5.5 } })
  ]);
  const result = await test.api.getGenerationCost('1k', 'standard', 'image2');
  assert(!result.ok && result.status === 401, 'auth failures must be returned directly');
  assert(test.requests.length === 1, 'auth failures must not retry the quote');
}

async function verifyPaidPostNeverRetries() {
  const cases = [
    {
      name: 'image generation',
      path: '/api/v1/generate',
      run: api => api.generateImage({
        clientRequestId: 'web.image.retry-proof',
        prompt: 'test',
        model: 'image2',
        resolution: '1k'
      })
    },
    {
      name: 'Midjourney action',
      path: '/api/v1/generate/mj-action',
      run: api => api.mjAction({ parentJobId: 'parent-job', action: 'variation' })
    },
    {
      name: 'Midjourney blend',
      path: '/api/v1/generate/mj-blend',
      run: api => api.mjBlend({ refImageUrls: ['https://ref.test/a.png', 'https://ref.test/b.png'] })
    }
  ];

  for (const testCase of cases) {
    for (const status of [503, 401]) {
      const code = status === 401 ? 'UNAUTHORIZED' : 'SERVICE_UNAVAILABLE';
      const test = apiWithResponses([
        response(status, { ok: false, error: { code, message: 'first response' } }),
        response(200, { ok: true, data: { jobId: 'must-not-run' } })
      ]);
      const result = await testCase.run(test.api);
      assert(!result.ok && result.status === status, `${testCase.name} must expose its first ${status}`);
      assert(test.requests.length === 1, `${testCase.name} must never retry after ${status}`);
      assert(test.requests[0]?.method === 'POST', `${testCase.name} must remain a POST`);
      assert(test.requests[0]?.url.endsWith(testCase.path), `${testCase.name} must call ${testCase.path}`);
    }
  }
}

async function verifyConflictInvalidatesQuote() {
  const test = apiWithResponses([
    response(200, { ok: true, data: { final: 5.5 } }),
    response(409, { ok: false, error: { code: 'CONFLICT', message: '价格已更新' } }),
    response(200, { ok: true, data: { final: 6 } })
  ]);
  const first = await test.api.getGenerationCost('1k', 'standard', 'image2');
  const submit = await test.api.generateImage({
    clientRequestId: 'web.image.changed-price',
    prompt: 'test',
    model: 'image2',
    resolution: '1k',
    quality: 'standard',
    quotedCredits: first.data.final
  });
  const refreshed = await test.api.getGenerationCost('1k', 'standard', 'image2');

  assert(!submit.ok && submit.status === 409, 'a changed price must not submit');
  assert(refreshed.ok && refreshed.data?.final === 6, 'the next click must fetch the updated quote');
  assert(test.requests.length === 3, 'quote conflict must invalidate only the matching cached quote');
  assert(test.requests[1]?.method === 'POST', 'quote conflict check must not retry the paid POST');
}

async function verifyBlendConflictInvalidatesQuote() {
  const test = apiWithResponses([
    response(200, { ok: true, data: { final: 12 } }),
    response(409, { ok: false, error: { code: 'CONFLICT', message: 'price changed' } }),
    response(200, { ok: true, data: { final: 14 } })
  ]);
  const quoteOpts = { speed: 'fast' };
  const first = await test.api.getGenerationCost('1k', 'standard', 'mj-v81', quoteOpts);
  const submit = await test.api.mjBlend({
    refImageUrls: ['https://ref.test/a.png', 'https://ref.test/b.png'],
    model: 'mj-v81',
    resolution: '1k',
    quality: 'standard',
    speed: 'fast',
    quotedCredits: first.data.final
  });
  const refreshed = await test.api.getGenerationCost('1k', 'standard', 'mj-v81', quoteOpts);

  assert(!submit.ok && submit.status === 409, 'a changed blend price must not submit');
  assert(refreshed.ok && refreshed.data?.final === 14, 'a blend conflict must invalidate its speed quote');
  assert(test.requests.length === 3, 'a blend conflict must not retry its paid POST');
}

function apiWithResponses(responses) {
  const queue = [...responses];
  const requests = [];
  const storage = new Map();
  const context = {
    AbortController,
    clearTimeout,
    console,
    Date,
    JSON,
    location: { protocol: 'https:' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    setTimeout: (callback, delay, ...args) => {
      return setTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
    },
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), method: String(init.method || 'GET') });
      const next = queue.shift();
      if (!next) throw new Error('unexpected fetch');
      if (next instanceof Error) throw next;
      return next;
    }
  };
  context.window = context;
  context.globalThis = context;
  context.API_BASE_URL = 'disabled';
  context.SupabaseSync = { getValidAccessToken: async () => 'test-token' };
  vm.runInNewContext(apiClientSource, context, { filename: 'api-client.js' });
  context.API_BASE_URL = 'https://cost-retry.test';
  return { api: context.PromptHubApi, requests };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function assert(condition, message) {
  if (condition) return;
  console.error(`verify-generation-cost-retry: ${message}`);
  process.exit(1);
}
