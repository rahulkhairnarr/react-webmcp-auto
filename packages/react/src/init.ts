import {
  startRuntime,
  type PolyfillModule,
  type Runtime,
  type WebMCPAutoConfig,
} from '@react-webmcp-auto/core';

let current: Promise<Runtime> | undefined;

/** Optional peer: resolved lazily so apps without it still build and run (as a no-op without WebMCP). */
const loadPolyfill = (): Promise<PolyfillModule> =>
  import('@mcp-b/webmcp-polyfill') as Promise<PolyfillModule>;

/** Starts auto-registration once. Safe to call repeatedly; never throws. */
export function initWebMCPAuto(config: WebMCPAutoConfig = {}): Promise<Runtime | undefined> {
  if (typeof document === 'undefined') return Promise.resolve(undefined); // SSR
  const p = (current ??= startRuntime(config, { loadPolyfill }).then((rt) => {
    exposeDevtools(rt);
    return rt;
  }));
  return p.catch(() => undefined);
}

/** Stops the runtime and aborts every registration. */
export async function stopWebMCPAuto(): Promise<void> {
  const p = current;
  current = undefined;
  (await p?.catch(() => undefined))?.stop();
}

/** The ONLY global we add: a namespaced, read-mostly devtools handle. */
function exposeDevtools(rt: Runtime): void {
  try {
    (window as unknown as Record<string, unknown>).__WEBMCP_AUTO__ = {
      adapter: rt.adapter.kind,
      tools: () =>
        rt.registry.list().map((t) => ({ name: t.name, risk: t.risk, source: t.source })),
      log: () => rt.log.entries(),
      scan: () => rt.scanNow(),
    };
  } catch {
    /* frozen window: ignore */
  }
}
