import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiClientSource = readFileSync(join(root, 'api-client.js'), 'utf8');
const publicFeedSource = readFileSync(join(root, 'community-public-feed.js'), 'utf8');
const imageGenCardsSource = readFileSync(join(root, 'image-gen-feed-cards.js'), 'utf8');
const imageGenFeedSource = readFileSync(join(root, 'image-gen-feed.js'), 'utf8');
const communityRenderSource = readFileSync(join(root, 'legacy', 'features-draft', 'part-06.js'), 'utf8');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function post(id, updatedAt = 1000) {
  return {
    id,
    authorId: `author-${id}`,
    authorName: 'Author',
    title: `Title ${id}`,
    prompt: `Prompt ${id}`,
    image: `storage://community/${id}.webp`,
    createdAt: updatedAt,
    updatedAt
  };
}

function createPublicFeedHarness({ cachedPosts = null, getCommunityFeed, prepareApiCall } = {}) {
  const storage = new MemoryStorage();
  if (cachedPosts) {
    storage.setItem('promptrepo_public_feed_cache', JSON.stringify({
      v: 7,
      posts: cachedPosts,
      cachedAt: Date.now()
    }));
  }
  const window = {
    PromptHubApi: { getCommunityFeed, prepareApiCall },
    SupabaseSync: { isLoggedIn: () => false }
  };
  window.window = window;
  window.globalThis = window;
  const context = {
    window,
    globalThis: window,
    localStorage: storage,
    console,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(publicFeedSource, context, { filename: 'community-public-feed.js' });
  const state = window.CommunityPublicFeed.createState();
  const api = window.CommunityPublicFeed.init({
    state,
    getFeedPerPage: () => 24,
    sortPostsByActivity: (items) => [...items]
  });
  return { api, state, storage };
}

{
  const fetchedUrls = [];
  const window = {
    API_BASE_URL: 'https://fixture.invalid',
    location: { pathname: '/' },
    SupabaseSync: {}
  };
  const context = {
    window,
    location: { protocol: 'https:' },
    console,
    AbortController,
    clearTimeout,
    setTimeout,
    fetch: async (url) => {
      fetchedUrls.push(String(url));
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 'RATE_LIMITED', message: 'retry later' } })
      };
    }
  };
  vm.runInNewContext(apiClientSource, context, { filename: 'api-client.js' });
  const result = await window.PromptHubApi.getCommunityFeed({ timeoutMs: 100, noRetry: true });
  assert.equal(result.code, 'RATE_LIMITED');
  assert.equal(
    fetchedUrls.filter((url) => url.includes('/api/v1/community/feed')).length,
    1,
    'noRetry should also suppress public GET rate-limit retries'
  );
}

{
  const requestOptions = [];
  let prepareCount = 0;
  const cachedPosts = [post('cached-1'), post('cached-2')];
  const { api, state, storage } = createPublicFeedHarness({
    cachedPosts,
    prepareApiCall: async () => { prepareCount += 1; },
    getCommunityFeed: async (opts) => {
      requestOptions.push(opts);
      return {
        ok: true,
        data: { posts: cachedPosts, nextOffset: 2, hasMore: false }
      };
    }
  });

  assert.equal(api.hydratePublicFeedFromCache(), true, 'partial cache should hydrate');
  assert.equal(state.posts.length, 2, 'partial cache should remain available for first paint');
  assert.ok(storage.getItem(api.LS_PUBLIC_FEED_CACHE), 'partial cache should not be deleted');
  assert.equal(api.publicFeedNeedsFullRefresh(), true, 'partial cache should refresh once in background');

  await api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 });
  assert.equal(requestOptions.length, 1, 'head refresh should make one upstream request');
  assert.equal(prepareCount, 0, 'public feed should not wait for private-session API preparation');
  assert.equal(requestOptions[0].noRetry, true, 'head refresh should disable nested API retries');
  assert.equal(requestOptions[0].timeoutMs, 8000, 'head refresh should preserve its bounded timeout');
  assert.equal(state.remoteHasMore, false, 'an exhausted short feed should be authoritative');
  assert.equal(api.publicFeedNeedsFullRefresh(), false, 'an exhausted short feed should not refresh on every render');
}

{
  let resolveRequest;
  let requestCount = 0;
  const response = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const { api, state } = createPublicFeedHarness({
    getCommunityFeed: () => {
      requestCount += 1;
      return response;
    }
  });

  const first = api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 });
  const second = api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 });
  assert.equal(first, second, 'concurrent consumers should share the same refresh promise');
  assert.equal(state.loading, true, 'shared refresh should expose loading state');
  assert.equal(requestCount, 1, 'concurrent consumers should not duplicate the request');
  resolveRequest({
    ok: true,
    data: { posts: [post('remote-1')], nextOffset: 1, hasMore: false }
  });
  const [firstChanged, secondChanged] = await Promise.all([first, second]);
  assert.equal(firstChanged, true);
  assert.equal(secondChanged, true);
  assert.equal(state.loading, false);
  assert.equal(state.refreshPromise, null);
}

{
  let requestCount = 0;
  const { api, state } = createPublicFeedHarness({
    getCommunityFeed: async () => {
      requestCount += 1;
      return { ok: false, code: 'NETWORK_ERROR' };
    }
  });

  assert.equal(await api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 }), false);
  assert.equal(requestCount, 1, 'a failed head request should not fan out into retry loops');
  assert.equal(api.publicFeedNeedsFullRefresh(), false, 'a failed request should enter the retry cooldown');
  state.lastAttemptAt -= api.PUBLIC_FEED_RETRY_COOLDOWN_MS + 1;
  assert.equal(api.publicFeedNeedsFullRefresh(), true, 'the feed should become retryable after cooldown');
}

{
  const { api, state } = createPublicFeedHarness({
    getCommunityFeed: async () => ({
      ok: true,
      data: { posts: [], nextOffset: 0, hasMore: false }
    })
  });

  assert.equal(await api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 }), false);
  assert.ok(state.at > 0, 'an empty successful response should count as a loaded feed');
  assert.equal(api.publicFeedNeedsFullRefresh(), false);
}

{
  const cachedPosts = [post('removed-from-server')];
  const { api, state, storage } = createPublicFeedHarness({
    cachedPosts,
    getCommunityFeed: async () => ({
      ok: true,
      data: { posts: [], nextOffset: 0, hasMore: false }
    })
  });

  assert.equal(api.hydratePublicFeedFromCache(), true);
  assert.equal(await api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 }), true);
  assert.equal(state.posts.length, 0, 'an authoritative empty head should clear stale cached posts');
  assert.equal(state.nextApiOffset, 0);
  assert.equal(state.remoteHasMore, false);
  assert.equal(storage.getItem(api.LS_PUBLIC_FEED_CACHE), null, 'an authoritative empty head should clear the cache');
}

{
  const cachedPosts = Array.from({ length: 24 }, (_, index) => post(`cached-${index}`));
  const requestOffsets = [];
  const { api, state } = createPublicFeedHarness({
    cachedPosts,
    getCommunityFeed: async (opts) => {
      requestOffsets.push(opts.offset);
      if (opts.offset === 0) {
        return {
          ok: true,
          data: { posts: [post('remote-0'), post('remote-1')], nextOffset: 2, hasMore: true }
        };
      }
      return {
        ok: true,
        data: { posts: [post('remote-2')], nextOffset: 3, hasMore: false }
      };
    }
  });

  assert.equal(api.hydratePublicFeedFromCache(), true);
  await api.refreshPublicCommunityFeed({ force: true, timeoutMs: 8000 });
  assert.equal(state.nextApiOffset, 2, 'head refresh should reset pagination to the server cursor');
  await api.fetchMorePublicCommunityFeed();
  assert.deepEqual(requestOffsets, [0, 2], 'cached post count must not skip authoritative server pages');
}

{
  let ensureCalls = 0;
  const window = {};
  window.window = window;
  window.globalThis = window;
  const context = { window, globalThis: window, console };
  vm.runInNewContext(imageGenCardsSource, context, { filename: 'image-gen-feed-cards.js' });
  vm.runInNewContext(imageGenFeedSource, context, { filename: 'image-gen-feed.js' });
  const feed = window.ImageGenFeed.init({
    getImageGenFeedTab: () => 'community',
    ensureImageGenCommunityFeed: () => { ensureCalls += 1; },
    getCommunityFeedForDisplay: () => [post('imagegen-community')],
    filterAndSortPosts: (items) => items
  });

  assert.equal(feed.getImageGenCommunityFeedList().length, 1);
  assert.equal(ensureCalls, 1, 'image generation community view should ensure public feed loading');
}

{
  const renderStart = communityRenderSource.indexOf('function renderCommunityNow(opts = {})');
  const renderEnd = communityRenderSource.indexOf('\n  function renderCommunity(', renderStart);
  const renderBody = communityRenderSource.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined);
  const pendingSubscription = renderBody.indexOf('const pendingFeedRefresh = publicFeedState.refreshPromise;');
  const skipFetchBranch = renderBody.indexOf('if (!opts.skipFeedFetch)');
  assert.ok(renderStart >= 0 && pendingSubscription >= 0, 'community render should subscribe to a shared refresh');
  assert.ok(
    pendingSubscription < skipFetchBranch,
    'skipFeedFetch renders must still repaint when the shared refresh completes'
  );
}

console.log('community-feed-reliability OK');
