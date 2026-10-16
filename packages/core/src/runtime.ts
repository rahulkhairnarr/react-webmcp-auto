import { createAdapter, createNoopAdapter, type Adapter, type AdapterOptions } from './adapter';
import { currentRoute } from './dom';
import { formDiscoverer } from './discoverers/form';
import { createActionDiscoverer } from './discoverers/actions';
import { declarativeDiscoverer } from './discoverers/declarative';
import { createConfirmDialog, type ConfirmDialogOptions } from './confirm-dialog';
import { auditDocument, type AuditWarning } from './audit';
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
  /** Replaces the built-in confirmation dialog (config.confirm still wins over this). */
  confirmUI?: (call: Parameters<NonNullable<ResolvedConfig['confirm']>>[0]) => Promise<boolean>;
  confirmDialog?: ConfirmDialogOptions;
  /** Expose `window.__WEBMCP_AUTO__`. Default true. */
  devtools?: boolean;
}

export interface ScanReportEntry {
  key: string;
  /** Name asked for by the discoverer, before de-duplication. */
  requestedName: string;
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolCandidate['inputSchema'];
  risk: ToolCandidate['risk'];
  riskDeclared: boolean;
  source: string;
}

export interface ScanReport {
  at: number;
  candidates: ScanReportEntry[];
  duplicates: string[];
}

export interface Runtime {
  readonly adapter: Adapter;
  readonly registry: Registry;
  readonly log: CallLog;
  readonly config: ResolvedConfig;
  /** Runs a scan immediately (synchronously), returning the diff. */
  scanNow(): ReturnType<Registry['sync']>;
  /** What the most recent scan found (for audit and devtools). */
  readonly lastScan: ScanReport | undefined;
  audit(): AuditWarning[];
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
  list.push(declarativeDiscoverer);
  if (config.discover.navigation) list.push(createNavigationDiscoverer(getRouter));
  if (config.discover.snapshot) list.push(createSnapshotDiscoverer());
  if (config.discover.actions) list.push(createActionDiscoverer(config.discover.actions));
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
  // config.confirm > options.confirmUI > built-in dialog. No document (SSR) => undefined => fail closed.
  const confirmFn =
    config.confirm ??
    options.confirmUI ??
    (config.enabled && win ? createConfirmDialog(doc, options.confirmDialog) : undefined);
  const askConfirm = async (
    call: Parameters<NonNullable<typeof confirmFn>>[0],
  ): Promise<boolean> => {
    try {
      return confirmFn ? await confirmFn(call) : false;
    } catch {
      return false;
    }
  };
  const guard: Guard = createGuard({ ...config, confirm: confirmFn }, log);
  const registry = new Registry(adapter, { exposedTo: config.exposedTo });
  let tracker: NetworkTracker | undefined;
  if (config.enabled && win) tracker = installNetworkTracker(win);

  const discoverers = options.discoverers ?? defaultDiscoverers(config, () => options.router);
  const ctx: ScanContext = {
    document: doc,
    config,
    route: currentRoute(doc),
    settle: (o) => settle(doc, tracker, o),
    confirm: askConfirm,
  };

  let lastScan: ScanReport | undefined;

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
    const requested = candidates.map((c) => c.name);
    candidates = assignNames(candidates, config.naming);
    const counts = new Map<string, number>();
    requested.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    lastScan = {
      at: Date.now(),
      duplicates: [...counts].filter(([, n]) => n > 1).map(([n]) => n),
      candidates: candidates.map((c, i) => ({
        key: c.key,
        requestedName: requested[i]!,
        name: c.name,
        title: c.title,
        description: c.description,
        inputSchema: c.inputSchema,
        risk: c.risk,
        riskDeclared: !!c.riskDeclared,
        source: c.source,
      })),
    };

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
  let lastScanAt = 0;
  let stopped = false;
  const gap = options.scanDelayMs ?? MIN_SCAN_GAP_MS;

  function scheduleScan() {
    if (stopped || timer !== undefined || idleId !== undefined) return;
    const wait = Math.max(0, lastScanAt + gap - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      const run = () => {
        idleId = undefined;
        if (stopped) return;
        lastScanAt = Date.now();
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
    get lastScan() {
      return lastScan;
    },
    audit: () => auditDocument(doc, lastScan),
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
  if (config.enabled && win && options.devtools !== false) exposeDevtools(runtime, win);
  return runtime;
}

/** The ONLY global we add: one namespaced, read-mostly handle for devtools, the extension popup, and `audit`. */
function exposeDevtools(rt: Runtime, win: Window): void {
  try {
    (win as unknown as Record<string, unknown>).__WEBMCP_AUTO__ = {
      adapter: rt.adapter.kind,
      tools: () =>
        rt.registry.list().map((t) => ({ name: t.name, risk: t.risk, source: t.source })),
      describe: () => rt.lastScan,
      audit: () => rt.audit(),
      log: () => rt.log.entries(),
      scan: () => rt.scanNow(),
    };
  } catch {
    /* frozen window: ignore */
  }
}
