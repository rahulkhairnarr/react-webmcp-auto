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
  const p = (current ??= startRuntime(config, { loadPolyfill }));
  return p.catch(() => undefined);
}

/** Stops the runtime and aborts every registration. */
export async function stopWebMCPAuto(): Promise<void> {
  const p = current;
  current = undefined;
  (await p?.catch(() => undefined))?.stop();
}
