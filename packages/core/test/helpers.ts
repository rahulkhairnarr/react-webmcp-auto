import type { Adapter, AdapterTool } from '../src/adapter';

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
