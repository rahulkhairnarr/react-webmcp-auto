import type { Adapter, AdapterTool } from '../src/adapter';
import { settle } from '../src/settle';
import {
  resolveConfig,
  type ScanContext,
  type ToolCall,
  type WebMCPAutoConfig,
} from '../src/types';

export interface FakeAdapter extends Adapter {
  tools: Map<string, AdapterTool>;
  events: string[];
}

/** In-memory adapter that records register/unregister, mirroring signal-based unregistration. */
export function fakeAdapter(): FakeAdapter {
  const tools = new Map<string, AdapterTool>();
  const events: string[] = [];
  return {
    kind: 'native-document',
    tools,
    events,
    register(tool) {
      const ac = new AbortController();
      tools.set(tool.name, tool);
      events.push(`+${tool.name}`);
      ac.signal.addEventListener('abort', () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
        events.push(`-${tool.name}`);
      });
      return ac;
    },
    onToolChange: () => () => undefined,
    listNames: async () => [...tools.keys()],
  };
}

export function html(markup: string): void {
  document.body.innerHTML = markup;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** ScanContext for discoverer unit tests: short settle, confirm answers come from `answers` (default: decline). */
export function testCtx(
  opts: { config?: WebMCPAutoConfig; answers?: boolean[]; asked?: ToolCall[] } = {},
): ScanContext {
  return {
    document,
    config: resolveConfig(opts.config),
    route: '/',
    settle: (o) => settle(document, undefined, { quietMs: 20, timeoutMs: 500, ...o }),
    confirm: async (call) => {
      opts.asked?.push(call);
      return opts.answers?.shift() ?? false;
    },
  };
}
