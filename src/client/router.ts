// ── Simple History API router ──

export type Route =
  | { page: 'landing' }
  | { page: 'sheet'; sheetId: string }
  | { page: '404' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { page: 'landing' };
  const m = pathname.match(/^\/s\/([a-zA-Z0-9_-]+)$/);
  if (m) return { page: 'sheet', sheetId: m[1]! };
  return { page: '404' };
}

export function serializeRoute(route: Route): string {
  switch (route.page) {
    case 'landing': return '/';
    case 'sheet': return `/s/${(route as { sheetId: string }).sheetId}`;
    case '404': return '/404';
  }
}

type RouteListener = (route: Route) => void;
const listeners: Set<RouteListener> = new Set();

export function currentRoute(): Route {
  if (typeof window === 'undefined') return { page: 'landing' };
  return parseRoute(window.location.pathname);
}

export function navigate(route: Route, replace = false): void {
  const path = serializeRoute(route);
  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  notify();
}

export function subscribeRoute(cb: RouteListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify(): void {
  const route = currentRoute();
  for (const cb of listeners) cb(route);
}

// Listen for popstate (back/forward)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => notify());
}
