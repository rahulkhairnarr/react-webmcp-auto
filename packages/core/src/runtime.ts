import { createAdapter, createNoopAdapter, type Adapter, type AdapterOptions } from './adapter';
import { currentRoute } from './dom';
import { formDiscoverer } from './discoverers/form';
import { createNavigationDiscoverer } from './discoverers/navigation';
import { createSnapshotDiscoverer } from './discoverers/snapshot';
import type { RouterAdapter } from './router';
import { applyManifest, type Manifest } from './manifest';
import { assignNames, matchesAny } from './naming';
import { Registry, type RegistryTool } from './registry';
import { CallLog, createGuard, type Guard } from './safety';
import { installNetworkTracker, settle, type NetworkTracker } from './settle';
import {
  resolveConfig,
  type Discoverer,
  type ResolvedConfig,
  type ScanContext,
  type ToolCandidate,
  type WebMCPAutoConfig,
} from './types';

export interface RuntimeOptions extends AdapterOptions {
  discoverers?: Discoverer[];
  /** Bypass the idle scheduling and throttling (tests). */
  scanDelayMs?: number;
  /** Framework router (React Router, Next...). Defaults to <a href> scanning + History API. */
  router?: RouterAdapter;
  confirmUI?: (call: Parameters<NonNullable<ResolvedConfig['confirm']>>[0]) => Promise<boolean>;
}

export interface Runtime {
  readonly adapter: Adapter;
  readonly registry: Registry;
  readonly log: CallLog;
  readonly config: ResolvedConfig;
  /** Runs a scan immediately (synchronously), returning the diff. */
  scanNow(): ReturnType<Registry['sync']>;
  /** Requests a throttled, idle-scheduled scan. */
  scheduleScan(): void;
  stop(): void;
}

const MIN_SCAN_GAP_MS = 150;

type IdleWin = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function resolveManifest(m: ResolvedConfig['manifest']): Manifest | undefined {
  return m && typeof m === 'object' ? (m as Manifest) : undefined;
}

export function defaultDiscoverers(
  config: ResolvedConfig,
  getRouter?: () => RouterAdapter | undefined,
): Discoverer[] {
  const list: Discoverer[] = [];
  if (config.discover.forms) list.push(formDiscoverer);
  if (config.discover.navigation) list.push(createNavigationDiscoverer(getRouter));
  if (config.discover.snapshot) list.push(createSnapshotDiscoverer());
  return list;
}

export async function startRuntime(
  userConfig: WebMCPAutoConfig = {},
  options: RuntimeOptions = {},
): Promise<Runtime> {
  const config = resolveConfig(userConfig);
  const doc = options.doc ?? document;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const adapter = config.enabled
    ? await createAdapter({ ...options, debug: config.debug })
    : createNoopAdapter();
  const log = new CallLog();
  const guard: Guard = createGuard(config, log, options.confirmUI);
  const registry = new Registry(adapter, { exposedTo: config.exposedTo });
  let tracker: NetworkTracker | undefined;
  if (config.enabled && win) tracker = installNetworkTracker(win);

  const discoverers = options.discoverers ?? defaultDiscoverers(config, () => options.router);
  const ctx: ScanContext = {
    document: doc,
    config,
    route: currentRoute(doc),
    settle: (o) => settle(doc, tracker, o),
  };

  function scanNow() {
    if (!config.enabled) return { added: [], removed: [], changed: [] };
    ctx.route = currentRoute(doc);
    let candidates: ToolCandidate[] = [];
    for (const d of discoverers) {
      try {
        candidates.push(...d.discover(ctx));
      } catch (e) {
        if (config.debug) console.warn(`[react-webmcp-auto] discoverer "${d.id}" failed`, e);
      }
    }
    candidates = applyManifest(candidates, resolveManifest(config.manifest));
    if (config.include.length)
      candidates = candidates.filter((c) => matchesAny(c.name, c.node, config.include));
    if (config.exclude.length)
      candidates = candidates.filter((c) => !matchesAny(c.name, c.node, config.exclude));
    candidates = assignNames(candidates, config.naming);

    const tools: RegistryTool[] = candidates.map((c) => ({
      name: c.name,
      title: c.title,
      description: c.description,
      inputSchema: c.inputSchema,
      risk: c.risk,
      untrusted: c.untrusted,
      source: c.source,
      node: c.node,
      execute: (input, opts) =>
        guard.run(
          { name: c.name, input, risk: c.risk, description: c.description, source: c.source },
          () => c.execute(input, opts),
        ),
    }));
    return registry.sync(tools);
  }

  // --- scheduling: <=1 scan per 150ms burst, run when the browser is idle ---
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleId: number | undefined;
  let lastScan = 0;
  let stopped = false;
  const gap = options.scanDelayMs ?? MIN_SCAN_GAP_MS;

  function scheduleScan() {
    if (stopped || timer !== undefined || idleId !== undefined) return;
    const wait = Math.max(0, lastScan + gap - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      const run = () => {
        idleId = undefined;
        if (stopped) return;
        lastScan = Date.now();
        scanNow();
      };
      const w = win as IdleWin | null;
      if (w?.requestIdleCallback) idleId = w.requestIdleCallback(run, { timeout: 500 });
      else run();
    }, wait);
  }

  let mo: MutationObserver | undefined;
  const onNav = () => scheduleScan();
  if (config.enabled && win) {
    mo = new win.MutationObserver((records) => {
      const relevant = records.some(
        (r) => !(r.target instanceof win.Element && r.target.closest('[data-webmcp-ui]')),
      );
      if (relevant) scheduleScan();
    });
    mo.observe(doc, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'id',
        'name',
        'type',
        'hidden',
        'disabled',
        'aria-label',
        'data-webmcp-tool',
        'data-webmcp-ignore',
        'data-webmcp-risk',
      ],
    });
    win.addEventListener('popstate', onNav);
    win.addEventListener('hashchange', onNav);
    scanNow();
  }

  const runtime: Runtime = {
    adapter,
    registry,
    log,
    config,
    scanNow,
    scheduleScan,
    stop() {
      stopped = true;
      clearTimeout(timer);
      const w = win as IdleWin | null;
      if (idleId !== undefined) w?.cancelIdleCallback?.(idleId);
      mo?.disconnect();
      win?.removeEventListener('popstate', onNav);
      win?.removeEventListener('hashchange', onNav);
      registry.clear();
      tracker?.dispose();
    },
  };
  return runtime;
}
