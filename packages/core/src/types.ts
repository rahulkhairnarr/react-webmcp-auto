/** Shared public types. Keep spec-dependent shapes in adapter.ts, not here. */

export type Risk = 'read' | 'write' | 'destructive';

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  additionalProperties?: boolean;
  [k: string]: unknown;
};

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  risk: Risk;
  description: string;
  source: string;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface ExecuteOptions {
  signal?: AbortSignal;
}

/** A tool the scanner found, before it is registered. */
export interface ToolCandidate {
  /** Stable key used by manifest overrides, e.g. `form:login`. */
  key: string;
  /** Final tool name (sanitised and de-duplicated by the registry). */
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  risk: Risk;
  /** Id of the discoverer that produced this candidate. */
  source: string;
  /** Element the tool was derived from (for diagnostics, never serialised). */
  node?: Element;
  /** True when the page text feeding this tool should be treated as untrusted content. */
  untrusted?: boolean;
  execute(input: Record<string, unknown>, opts: ExecuteOptions): Promise<ToolResult>;
}

export interface OpenAPIOptions {
  url: string;
  baseUrl?: string;
}

export interface WebMCPAutoConfig {
  enabled?: boolean;
  discover?: {
    forms?: boolean;
    navigation?: boolean;
    snapshot?: boolean;
    actions?: false | 'safe' | 'all';
    openapi?: string | OpenAPIOptions;
  };
  /** CSS selectors and/or tool-name globs. If non-empty, only matching candidates are kept. */
  include?: string[];
  /** CSS selectors and/or tool-name globs. Matching candidates are dropped. */
  exclude?: string[];
  naming?: (candidate: ToolCandidate) => string;
  confirm?: (call: ToolCall) => Promise<boolean>;
  exposedTo?: string[];
  rateLimit?: { perMinute: number };
  manifest?: string | object;
  debug?: boolean;
}

export interface ScanContext {
  document: Document;
  config: ResolvedConfig;
  /** Current route key, e.g. `/settings/profile`. */
  route: string;
  /** Shared settle helper bound to the runtime's network tracker. */
  settle(opts?: SettleOptions): Promise<SettleResult>;
}

export interface Discoverer {
  id: string;
  discover(ctx: ScanContext): ToolCandidate[];
}

export interface SettleOptions {
  quietMs?: number;
  timeoutMs?: number;
}

export interface SettleResult {
  settled: boolean;
  timedOut: boolean;
  durationMs: number;
  route?: { from: string; to: string };
  alerts: string[];
}

export interface ResolvedConfig {
  enabled: boolean;
  discover: {
    forms: boolean;
    navigation: boolean;
    snapshot: boolean;
    actions: false | 'safe' | 'all';
    openapi?: string | OpenAPIOptions;
  };
  include: string[];
  exclude: string[];
  naming?: WebMCPAutoConfig['naming'];
  confirm?: WebMCPAutoConfig['confirm'];
  exposedTo?: string[];
  rateLimit: { perMinute: number };
  manifest?: string | object;
  debug: boolean;
}

export function resolveConfig(config: WebMCPAutoConfig = {}): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    discover: {
      forms: config.discover?.forms ?? true,
      navigation: config.discover?.navigation ?? true,
      snapshot: config.discover?.snapshot ?? true,
      actions: config.discover?.actions ?? false,
      openapi: config.discover?.openapi,
    },
    include: config.include ?? [],
    exclude: config.exclude ?? [],
    naming: config.naming,
    confirm: config.confirm,
    exposedTo: config.exposedTo,
    rateLimit: config.rateLimit ?? { perMinute: 30 },
    manifest: config.manifest,
    debug: config.debug ?? false,
  };
}
