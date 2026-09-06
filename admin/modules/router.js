/* Hash router: #/tab?query — keeps refresh/back-forward and deep links working. */

const listeners = new Map();
let currentTab = null;

export function parseHash() {
  const hash = (window.location.hash || '').replace(/^#\/?/, '');
  const [tab, query = ''] = hash.split('?');
  return {
    tab: tab || 'overview',
    params: new URLSearchParams(query)
  };
}

export function navigate(tab, params) {
  const query = params && typeof params.entries === 'function'
    ? '?' + new URLSearchParams(params).toString()
    : '';
  const target = `#/${tab}${query}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  } else {
    dispatch(parseHash());
  }
}

export function currentRoute() {
  return parseHash();
}

export function onRoute(handler) {
  listeners.set(handler, handler);
  return () => listeners.delete(handler);
}

function dispatch(route) {
  currentTab = route.tab;
  for (const handler of listeners.keys()) {
    try {
      handler(route);
    } catch (e) {
      console.error('[admin-router] handler failed', e);
    }
  }
}

export function startRouter(onChange) {
  const handler = () => {
    const route = parseHash();
    if (route.tab !== currentTab || true) {
      onChange(route);
    }
    dispatch(route);
  };
  window.addEventListener('hashchange', handler);
  handler();
}
