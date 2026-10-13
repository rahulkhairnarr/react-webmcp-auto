import type { Adapter, AdapterTool, AdapterToolAnnotations } from './adapter';
import type { ExecuteOptions, JsonSchema, Risk, ToolResult } from './types';

/** A tool in registry-ready form. The runtime wraps candidates into these (adding safety). */
export interface RegistryTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  risk: Risk;
  untrusted?: boolean;
  source: string;
  node?: Element;
  execute(input: Record<string, unknown>, opts: ExecuteOptions): Promise<ToolResult>;
}

interface Entry {
  def: RegistryTool;
  fingerprint: string;
  abortController: AbortController;
  sourceNode?: Element;
}

export function annotationsFor(
  tool: Pick<RegistryTool, 'risk' | 'untrusted'>,
): AdapterToolAnnotations {
  const a: AdapterToolAnnotations = {};
  if (tool.risk === 'read') a.readOnlyHint = true;
  if (tool.risk === 'destructive') a.consequentialHint = true;
  if (tool.untrusted) a.untrustedContentHint = true;
  return a;
}

function fingerprint(t: RegistryTool): string {
  return JSON.stringify([t.name, t.title, t.description, t.inputSchema, t.risk, t.untrusted]);
}

/**
 * Keeps what is registered with the browser in step with what the scanner found.
 * `execute` is resolved through the entry at call time, so changes that only touch
 * behaviour (new closures after a re-render) never cause a re-registration.
 */
export class Registry {
  private readonly entries = new Map<string, Entry>();
  private readonly explicit = new Map<
    string,
    { def: RegistryTool; abortController: AbortController }
  >();

  constructor(
    private readonly adapter: Adapter,
    private readonly opts: { exposedTo?: string[] } = {},
    private readonly onChange?: () => void,
  ) {}

  get names(): string[] {
    return [
      ...this.explicit.keys(),
      ...[...this.entries.keys()].filter((n) => !this.explicit.has(n)),
    ];
  }

  get(name: string): RegistryTool | undefined {
    return this.explicit.get(name)?.def ?? this.entries.get(name)?.def;
  }

  list(): RegistryTool[] {
    return this.names.map((n) => this.get(n)).filter((t): t is RegistryTool => !!t);
  }

  /** Explicit tools (useWebMCPTool) always win on a name clash. Returns a disposer. */
  registerExplicit(def: RegistryTool): () => void {
    this.explicit.get(def.name)?.abortController.abort();
    this.entries.get(def.name)?.abortController.abort();
    this.entries.delete(def.name);
    const abortController = this.registerWithAdapter(def);
    this.explicit.set(def.name, { def, abortController });
    this.onChange?.();
    return () => {
      const cur = this.explicit.get(def.name);
      if (cur?.abortController === abortController) {
        abortController.abort();
        this.explicit.delete(def.name);
        this.onChange?.();
      }
    };
  }

  /** Diff-and-apply. Returns what changed. */
  sync(next: RegistryTool[]): { added: string[]; removed: string[]; changed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const nextByName = new Map<string, RegistryTool>();
    for (const t of next) if (!this.explicit.has(t.name)) nextByName.set(t.name, t);

    for (const [name, entry] of this.entries) {
      if (!nextByName.has(name)) {
        entry.abortController.abort();
        this.entries.delete(name);
        removed.push(name);
      }
    }
    for (const [name, def] of nextByName) {
      const fp = fingerprint(def);
      const existing = this.entries.get(name);
      if (!existing) {
        this.entries.set(name, this.makeEntry(def, fp));
        added.push(name);
      } else if (existing.fingerprint !== fp) {
        existing.abortController.abort();
        this.entries.set(name, this.makeEntry(def, fp, true));
        changed.push(name);
      } else {
        // Same shape: just swap in the fresh closure/node.
        existing.def = def;
        existing.sourceNode = def.node;
      }
    }
    if (added.length || removed.length || changed.length) this.onChange?.();
    return { added, removed, changed };
  }

  /** Aborts every registration (unmount / teardown). */
  clear(): void {
    for (const e of this.entries.values()) e.abortController.abort();
    for (const e of this.explicit.values()) e.abortController.abort();
    this.entries.clear();
    this.explicit.clear();
  }

  private makeEntry(def: RegistryTool, fp: string, deferred = false): Entry {
    const entry: Entry = {
      def,
      fingerprint: fp,
      sourceNode: def.node,
      abortController: new AbortController(),
    };
    const tool: AdapterTool = {
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: annotationsFor(def),
      execute: (input, o) =>
        this.entries.get(def.name)?.def.execute(input, o) ?? def.execute(input, o),
    };
    if (!deferred) {
      entry.abortController = this.adapter.register(tool, this.opts);
      return entry;
    }
    // Re-registration under the same name: let the abort land first (spec issue #92 race).
    const outer = entry.abortController;
    queueMicrotask(() => {
      if (outer.signal.aborted) return;
      const inner = this.adapter.register(tool, this.opts);
      outer.signal.addEventListener('abort', () => inner.abort(), { once: true });
    });
    return entry;
  }

  private registerWithAdapter(def: RegistryTool): AbortController {
    return this.adapter.register(
      {
        name: def.name,
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: annotationsFor(def),
        execute: (input, o) => def.execute(input, o),
      },
      this.opts,
    );
  }
}
