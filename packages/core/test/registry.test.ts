import { describe, expect, it } from 'vitest';
import { Registry, type RegistryTool } from '../src/registry';
import { tick, fakeAdapter } from './helpers';

const tool = (name: string, over: Partial<RegistryTool> = {}): RegistryTool => ({
  name,
  description: `desc ${name}`,
  inputSchema: { type: 'object', properties: {} },
  risk: 'write',
  source: 'test',
  execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  ...over,
});

describe('Registry.sync', () => {
  it('adds, removes, and re-registers changed tools only', async () => {
    const a = fakeAdapter();
    const r = new Registry(a);
    expect(r.sync([tool('a'), tool('b')]).added).toEqual(['a', 'b']);
    expect(r.sync([tool('a'), tool('b')])).toEqual({ added: [], removed: [], changed: [] });
    expect(r.sync([tool('a', { description: 'new' })])).toEqual({
      added: [],
      removed: ['b'],
      changed: ['a'],
    });
    await tick();
    expect(a.tools.get('a')?.description).toBe('new');
    expect(a.tools.has('b')).toBe(false);
    expect(a.events).toEqual(['+a', '+b', '-b', '-a', '+a']);
  });

  it('does not re-register when only the execute closure changes, and calls the newest one', async () => {
    const a = fakeAdapter();
    const r = new Registry(a);
    r.sync([tool('a', { execute: async () => ({ content: [{ type: 'text', text: 'v1' }] }) })]);
    r.sync([tool('a', { execute: async () => ({ content: [{ type: 'text', text: 'v2' }] }) })]);
    expect(a.events).toEqual(['+a']);
    const res = (await a.tools.get('a')!.execute({}, { signal: new AbortController().signal })) as {
      content: { text: string }[];
    };
    expect(res.content[0]!.text).toBe('v2');
  });

  it('explicit tools win on a name clash and survive scans', () => {
    const a = fakeAdapter();
    const r = new Registry(a);
    r.sync([tool('x', { description: 'auto' })]);
    const dispose = r.registerExplicit(tool('x', { description: 'explicit' }));
    expect(a.tools.get('x')?.description).toBe('explicit');
    r.sync([tool('x', { description: 'auto again' })]);
    expect(a.tools.get('x')?.description).toBe('explicit');
    dispose();
    expect(a.tools.has('x')).toBe(false);
  });

  it('clear() aborts everything', () => {
    const a = fakeAdapter();
    const r = new Registry(a);
    r.sync([tool('a'), tool('b')]);
    r.clear();
    expect(a.tools.size).toBe(0);
  });
});
