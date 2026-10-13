/** Router-agnostic navigation. React Router / Next adapters (packages/react) implement this. */
export interface RouterAdapter {
  id: string;
  getRoutes(): string[];
  navigate(path: string): void | Promise<void>;
  getCurrentRoute(): string;
}

/** Fallback: same-origin <a href> scanning plus history.pushState + popstate. */
export function createHistoryRouter(doc: Document): RouterAdapter {
  const win = doc.defaultView!;
  return {
    id: 'history',
    getRoutes() {
      const out = new Set<string>();
      for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        if (a.closest('[data-webmcp-ignore]')) continue;
        try {
          const u = new URL(a.getAttribute('href')!, win.location.href);
          if (u.origin === win.location.origin && /^https?:$/.test(u.protocol))
            out.add(u.pathname + u.search);
        } catch {
          /* skip malformed hrefs */
        }
      }
      return [...out].sort();
    },
    navigate(path) {
      win.history.pushState({}, '', path);
      win.dispatchEvent(new win.PopStateEvent('popstate', { state: {} }));
    },
    getCurrentRoute: () => win.location.pathname + win.location.search,
  };
}

/** Returns a same-origin path+search+hash, or null if `input` would leave the origin. */
export function safeInternalPath(input: string, doc: Document): string | null {
  const win = doc.defaultView!;
  try {
    const u = new URL(input, win.location.origin);
    if (u.origin !== win.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}
