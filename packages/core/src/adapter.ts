/**
 * The ONLY file that knows the WebMCP API shape. See docs/spec-notes.md.
 * Everything else talks to the `Adapter` interface.
 */
import type { JsonSchema } from './types';

export interface AdapterToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
  debugging?: boolean;
}

export interface AdapterTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: AdapterToolAnnotations;
  execute(input: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<unknown>;
}

export type AdapterKind = 'native-document' | 'native-navigator' | 'polyfill' | 'none';

export interface Adapter {
  readonly kind: AdapterKind;
  /** Registers a tool. Aborting the returned controller unregisters it. Never throws. */
  register(tool: AdapterTool, opts?: { exposedTo?: string[] }): AbortController;
  /** Subscribes to `toolchange`. Returns an unsubscribe function. */
  onToolChange(cb: () => void): () => void;
  /** Names currently registered with the browser (best effort; for tests and devtools). */
  listNames(): Promise<string[]>;
}

/** Structural view of ModelContext: just what we call. */
interface ModelContextLike extends EventTarget {
  registerTool(tool: unknown, options?: { signal?: AbortSignal; exposedTo?: string[] }): unknown;
  getTools?(): Promise<{ name: string }[]>;
}

export interface PolyfillModule {
  installWebMCP(): void;
}

export interface AdapterOptions {
  /** Loader for `@mcp-b/webmcp-polyfill` (optional peer). Injected so core has no bundler-visible import. */
  loadPolyfill?: () => Promise<PolyfillModule>;
  debug?: boolean;
  doc?: Document;
}

function probe(doc: Document): { ctx: ModelContextLike; kind: AdapterKind } | null {
  try {
    const d = (doc as unknown as { modelContext?: ModelContextLike }).modelContext;
    if (d && typeof d.registerTool === 'function') return { ctx: d, kind: 'native-document' };
  } catch {
    /* getter may throw on insecure origins or broken polyfills */
  }
  try {
    const nav = (doc.defaultView?.navigator ?? navigator) as unknown as {
      modelContext?: ModelContextLike;
    };
    if (nav.modelContext && typeof nav.modelContext.registerTool === 'function') {
      return { ctx: nav.modelContext, kind: 'native-navigator' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function warn(debug: boolean | undefined, msg: string, err?: unknown): void {
  if (debug) console.warn(`[react-webmcp-auto] ${msg}`, err ?? '');
}

export function createNoopAdapter(): Adapter {
  return {
    kind: 'none',
    register: () => new AbortController(),
    onToolChange: () => () => undefined,
    listNames: async () => [],
  };
}

function wrap(ctx: ModelContextLike, kind: AdapterKind, debug?: boolean): Adapter {
  return {
    kind,
    register(tool, opts) {
      const controller = new AbortController();
      try {
        const options: { signal: AbortSignal; exposedTo?: string[] } = {
          signal: controller.signal,
        };
        if (opts?.exposedTo?.length) options.exposedTo = opts.exposedTo;
        // Older builds return void, newer ones a Promise; handle both and never reject loudly.
        Promise.resolve(ctx.registerTool(tool, options)).catch((e) =>
          warn(debug, `registerTool(${tool.name}) rejected`, e),
        );
      } catch (e) {
        warn(debug, `registerTool(${tool.name}) threw`, e);
      }
      return controller;
    },
    onToolChange(cb) {
      const handler = () => cb();
      try {
        ctx.addEventListener('toolchange', handler);
      } catch {
        return () => undefined;
      }
      return () => ctx.removeEventListener('toolchange', handler);
    },
    async listNames() {
      try {
        return ctx.getTools ? (await ctx.getTools()).map((t) => t.name) : [];
      } catch {
        return [];
      }
    },
  };
}

function unavailable(debug?: boolean): Adapter {
  warn(debug, 'WebMCP is not available in this browser; running as a no-op.');
  return createNoopAdapter();
}

/** Feature-detects native WebMCP, falls back to the polyfill, else degrades to a no-op. Never throws. */
export async function createAdapter(options: AdapterOptions = {}): Promise<Adapter> {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) return unavailable(options.debug);
  const found = probe(doc);
  if (found) return wrap(found.ctx, found.kind, options.debug);
  if (options.loadPolyfill) {
    try {
      const mod = await options.loadPolyfill();
      mod.installWebMCP();
      const after = probe(doc);
      if (after) return wrap(after.ctx, 'polyfill', options.debug);
    } catch (e) {
      warn(options.debug, 'Could not load @mcp-b/webmcp-polyfill (optional peer dependency).', e);
    }
  }
  return unavailable(options.debug);
}
