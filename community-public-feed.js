/**
 * 全站社区 Feed API：缓存、分页拉取、帖归一化（与 features-draft 业务状态解耦）
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} */
  let deps = {};
  /** @type {ReturnType<typeof createState>|null} */
  let state = null;

  const PUBLIC_FEED_TTL_MS = 300_000;
  const PUBLIC_FEED_HEAD_LIMIT = 100;
  const PUBLIC_FEED_CACHE_VERSION = 7;
  const LS_PUBLIC_FEED_CACHE = 'promptrepo_public_feed_cache';

  function d() {
    return deps;
  }

  function createState() {
    return {
      posts: [],
      at: 0,
      apiOffset: 0,
      nextApiOffset: 0,
      remoteHasMore: true,
      loading: false,
      refreshPromise: null,
      moreInflight: false
    };
  }

  function minReady() {
    return d().getFeedPerPage?.() || 24;
  }

  function loadPublicFeedCache() {
    try {
      const raw = localStorage.getItem(LS_PUBLIC_FEED_CACHE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.posts)) return null;
      if (data.v !== PUBLIC_FEED_CACHE_VERSION) {
        localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function savePublicFeedCache(posts) {
    try {
      const list = (posts || []).filter((p) => p && !p.isMock);
      if (!list.length) {
        localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
        return;
      }
      localStorage.setItem(
        LS_PUBLIC_FEED_CACHE,
        JSON.stringify({ v: PUBLIC_FEED_CACHE_VERSION, posts: list, cachedAt: Date.now() })
      );
    } catch (e) { /* ignore */ }
  }

  function normalizeFeedPost(p) {
    if (!p || p.isMock) return null;
    return {
      id: String(p.id || ''),
      sourceCardId: p.sourceCardId ?? p.source_card_id ?? null,
      authorId: String(p.authorId ?? p.author_id ?? ''),
      authorName: String(p.authorName ?? p.author_name ?? '用户'),
      title: String(p.title || ''),
      prompt: String(p.prompt || ''),
      image: p.image ?? null,
      likes: Math.max(0, Number(p.likes) || 0),
      createdAt: Number(p.createdAt ?? p.created_at) || Date.now(),
      updatedAt: Number(p.updatedAt ?? p.updated_at) || Date.now()
    };
  }

  function authorIdFromPostImage(post) {
    const image = post?.image;
    if (!image || !global.SupabaseSync?.storagePathFromRef) return '';
    const path = global.SupabaseSync.storagePathFromRef(image) || '';
    const head = path.replace(/^\//, '').split('/')[0] || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(head)) {
      return head;
    }
    return '';
  }

  function communityPostDisplayKey(p) {
    if (!p) return '';
    if (p.sourceCardId) return `card:${p.sourceCardId}`;
    const owner = authorIdFromPostImage(p) || String(p.authorId || '');
    const prompt = String(p.prompt || '').trim().slice(0, 160).toLowerCase();
    if (prompt && owner) return `prompt:${owner}:${prompt}`;
    return p.id ? `id:${p.id}` : '';
  }

  function mergePostsLists(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const p of list || []) {
        if (!p || p.isMock) continue;
        const key = communityPostDisplayKey(p);
        if (!key) continue;
        const prev = map.get(key);
        const ts = p.updatedAt || p.createdAt || 0;
        const prevTs = prev ? (prev.updatedAt || prev.createdAt || 0) : -1;
        if (!prev || ts >= prevTs) map.set(key, p);
      }
    }
    return [...map.values()];
  }

  function publicFeedNeedsFullRefresh(st) {
    const s = st || state;
    if (!s) return true;
    return s.at === 0
      || s.posts.length < minReady()
      || Date.now() - s.at >= PUBLIC_FEED_TTL_MS;
  }

  function hydratePublicFeedFromCache(st) {
    const s = st || state;
    if (!s || s.at > 0) return false;
    const cached = loadPublicFeedCache();
    if (!cached?.posts?.length) return false;
    if (cached.posts.length < minReady()) {
      localStorage.removeItem(LS_PUBLIC_FEED_CACHE);
      return false;
    }
    s.posts = cached.posts.map(normalizeFeedPost).filter(Boolean);
    s.at = cached.cachedAt || Date.now();
    s.apiOffset = s.posts.length;
    s.nextApiOffset = s.posts.length;
    s.remoteHasMore = true;
    return s.posts.length > 0;
  }

  function mergePublicFeedHead(incoming, st) {
    const s = st || state;
    if (!s) return false;
    const next = (incoming || []).map(normalizeFeedPost).filter(Boolean);
    if (!next.length) return false;
    if (!s.posts.length || s.posts.length <= next.length) {
      s.posts = next;
      s.apiOffset = Math.max(s.apiOffset, next.length);
      return true;
    }
    const upd = new Map(next.map((p) => [String(p.id), p]));
    s.posts = s.posts.map((p) => upd.get(String(p.id)) || p);
    const seen = new Set(s.posts.map((p) => String(p.id)));
    const fresh = next.filter((p) => !seen.has(String(p.id)));
    if (fresh.length) s.posts = [...fresh, ...s.posts];
    return true;
  }

  async function fetchPublicCommunityFeedHead(timeoutMs = 22000, st) {
    const s = st || state;
    if (!s || !global.PromptHubApi?.getCommunityFeed) return null;
    if (global.PromptHubApi?.prepareApiCall) await global.PromptHubApi.prepareApiCall();
    else global.__PH_API_DOWN_UNTIL__ = 0;
    const pageSize = PUBLIC_FEED_HEAD_LIMIT;
    let lastFeedRes = null;
    let batch = null;
    const sortPosts = d().sortPostsByActivity;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const r = await global.PromptHubApi.getCommunityFeed({
        limit: pageSize,
        offset: 0,
        timeoutMs,
        skipUnreachableMark: true
      });
      if (r?.ok && Array.isArray(r.data?.posts)) {
        batch = r.data.posts;
        lastFeedRes = r;
        break;
      }
      if (attempt < 2) await new Promise((res) => setTimeout(res, 700 + attempt * 900));
    }
    if (!batch) return null;
    const head = batch.map(normalizeFeedPost).filter(Boolean);
    const merged = mergePostsLists(head, s.posts);
    const sorted = typeof sortPosts === 'function' ? sortPosts(merged) : merged;
    const nextOff = Number(lastFeedRes?.data?.nextOffset);
    const remoteNext = Number.isFinite(nextOff) && nextOff > 0 ? nextOff : head.length;
    s.apiOffset = Math.max(s.apiOffset, remoteNext);
    s.nextApiOffset = Math.max(s.nextApiOffset, remoteNext, sorted.length);
    s.remoteHasMore = lastFeedRes?.data?.hasMore === true
      || (lastFeedRes?.data?.hasMore !== false && batch.length >= pageSize);
    s.posts = sorted;
    savePublicFeedCache(s.posts);
    if (head.length >= minReady()) d().scheduleProgressiveCommunityRender?.();
    return sorted;
  }

  async function fetchAllPublicCommunityFeedPages(timeoutMs = 22000, st) {
    return fetchPublicCommunityFeedHead(timeoutMs, st);
  }

  async function refreshPublicCommunityFeed(opts = {}, st) {
    const s = st || state;
    if (!s || !global.PromptHubApi?.getCommunityFeed) return false;
    if (s.loading) return false;
    const loggedIn = global.SupabaseSync?.isLoggedIn?.();
    if (!opts.force && !publicFeedNeedsFullRefresh(s) && s.posts.length > 0) {
      return false;
    }
    s.loading = true;
    const prevPubSig = s.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
    try {
      const fetched = await fetchPublicCommunityFeedHead(opts.timeoutMs || 20000, s);
      if (!fetched?.length) {
        const cached = loadPublicFeedCache();
        if (cached?.posts?.length && s.at === 0) {
          const cachedSig = cached.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
          if (cachedSig !== prevPubSig) {
            s.posts = cached.posts.map(normalizeFeedPost).filter(Boolean);
            s.at = cached.cachedAt || Date.now();
            s.apiOffset = Math.max(s.apiOffset, s.posts.length);
            return true;
          }
          return false;
        }
        return false;
      }
      s.posts = fetched;
      s.at = Date.now();
      s.apiOffset = s.nextApiOffset;
      savePublicFeedCache(s.posts);
      if (loggedIn) d().onLoggedInFeedRefreshed?.(s.posts);
      d().rebuildOwnPostFilterCache?.();
      d().invalidateCommunityReconcileCache?.();
      d().pruneLocalCommunityNotOnServer?.();
      const nextPubSig = s.posts.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
      return nextPubSig !== prevPubSig;
    } catch (e) {
      console.warn('[community] public feed failed', e);
      if (s.at > 0 && Date.now() - s.at < 5 * 60 * 1000) return false;
      const cached = loadPublicFeedCache();
      if (cached?.posts?.length && !s.posts.length) {
        s.posts = cached.posts.map(normalizeFeedPost).filter(Boolean);
        s.at = cached.cachedAt || Date.now();
        s.apiOffset = Math.max(s.apiOffset, s.posts.length);
        return true;
      }
      return false;
    } finally {
      s.loading = false;
    }
  }

  async function fetchMorePublicCommunityFeed(st) {
    const s = st || state;
    if (!s || !global.PromptHubApi?.getCommunityFeed || s.moreInflight || s.loading) return null;
    if (!s.remoteHasMore) return [];
    s.moreInflight = true;
    try {
      const offset = s.nextApiOffset;
      const limit = 100;
      const r = await global.PromptHubApi.getCommunityFeed({ limit, offset, timeoutMs: 20000 });
      if (!r?.ok || !Array.isArray(r.data?.posts)) {
        d().logFeedPageDebug?.('communityGrid', 'api_fetch_fail', { offset, code: r?.code });
        return null;
      }
      const batch = r.data.posts;
      const nextOff = Number(r.data?.nextOffset);
      const hasMore = r.data?.hasMore === true
        || (r.data?.hasMore !== false && batch.length >= limit);
      s.nextApiOffset = Number.isFinite(nextOff) && nextOff > offset
        ? nextOff
        : offset + batch.length;
      s.apiOffset = s.nextApiOffset;
      s.remoteHasMore = hasMore && batch.length > 0;
      if (!batch.length) {
        s.remoteHasMore = false;
        d().logFeedPageDebug?.('communityGrid', 'api_exhausted', { offset });
        return [];
      }
      const seen = new Set(s.posts.map((p) => String(p.id)));
      const added = [];
      for (const raw of batch) {
        const p = normalizeFeedPost(raw);
        if (!p || seen.has(String(p.id))) continue;
        seen.add(String(p.id));
        s.posts.push(p);
        added.push(p);
      }
      if (added.length) {
        s.at = Date.now();
        savePublicFeedCache(s.posts);
      }
      d().logFeedPageDebug?.('communityGrid', 'api_batch', {
        offset,
        batch: batch.length,
        added: added.length,
        nextOffset: s.nextApiOffset,
        hasMore: s.remoteHasMore
      });
      return added.length ? added : batch.map(normalizeFeedPost).filter(Boolean);
    } catch (e) {
      console.warn('[community] fetch more feed failed', e);
      return null;
    } finally {
      s.moreInflight = false;
    }
  }

  function init(injected) {
    deps = injected || {};
    state = injected?.state || createState();
    return {
      createState,
      PUBLIC_FEED_TTL_MS,
      PUBLIC_FEED_CACHE_VERSION,
      LS_PUBLIC_FEED_CACHE,
      loadPublicFeedCache,
      savePublicFeedCache,
      normalizeFeedPost,
      authorIdFromPostImage,
      communityPostDisplayKey,
      mergePostsLists,
      publicFeedNeedsFullRefresh: () => publicFeedNeedsFullRefresh(state),
      hydratePublicFeedFromCache: () => hydratePublicFeedFromCache(state),
      mergePublicFeedHead: (incoming) => mergePublicFeedHead(incoming, state),
      fetchAllPublicCommunityFeedPages: (timeoutMs) => fetchAllPublicCommunityFeedPages(timeoutMs, state),
      refreshPublicCommunityFeed: (opts) => refreshPublicCommunityFeed(opts, state),
      fetchMorePublicCommunityFeed: () => fetchMorePublicCommunityFeed(state),
      getState: () => state
    };
  }

  global.CommunityPublicFeed = { init, createState };
})(typeof window !== 'undefined' ? window : globalThis);
