import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from '../src/adapter';

function fakeContext() {
  const et = new EventTarget() as EventTarget & { registerTool: ReturnType<typeof vi.fn> };
  et.registerTool = vi.fn(() => Promise.resolve());
  return et;
}

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).modelContext;
  delete (navigator as unknown as Record<string, unknown>).modelContext;
});

describe('adapter', () => {
  it('prefers document.modelContext', async () => {
    const ctx = fakeContext();
    Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true });
    const a = await createAdapter();
    expect(a.kind).toBe('native-document');
    const ac = a.register(
      { name: 't', description: 'd', inputSchema: {}, execute: async () => 1 },
      { exposedTo: ['https://a.test'] },
    );
    const [tool, opts] = ctx.registerTool.mock.calls[0] as [
      { name: string },
      { signal: AbortSignal; exposedTo: string[] },
    ];
    expect(tool.name).toBe('t');
    expect(opts.exposedTo).toEqual(['https://a.test']);
    expect(opts.signal.aborted).toBe(false);
    ac.abort();
    expect(opts.signal.aborted).toBe(true);
  });

  it('falls back to navigator.modelContext', async () => {
    Object.defineProperty(navigator, 'modelContext', { value: fakeContext(), configurable: true });
    expect((await createAdapter()).kind).toBe('native-navigator');
  });

  it('uses the injected polyfill loader when neither surface exists', async () => {
    const installWebMCP = vi.fn(() =>
      Object.defineProperty(document, 'modelContext', { value: fakeContext(), configurable: true }),
    );
    const a = await createAdapter({ loadPolyfill: async () => ({ installWebMCP }) });
    expect(installWebMCP).toHaveBeenCalled();
    expect(a.kind).toBe('polyfill');
  });

  it('degrades to a silent no-op (warns only in debug) and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const quiet = await createAdapter({
      loadPolyfill: async () => {
        throw new Error('missing');
      },
    });
    expect(quiet.kind).toBe('none');
    expect(() =>
      quiet.register({ name: 'x', description: '', inputSchema: {}, execute: async () => 0 }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    await createAdapter({ debug: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows registerTool throwing or rejecting', async () => {
    const ctx = fakeContext();
    ctx.registerTool.mockImplementation(() => {
      throw new Error('dup');
    });
    Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true });
    const a = await createAdapter();
    expect(() =>
      a.register({ name: 'x', description: '', inputSchema: {}, execute: async () => 0 }),
    ).not.toThrow();
    ctx.registerTool.mockImplementation(() => Promise.reject(new Error('dup')));
    expect(() =>
      a.register({ name: 'y', description: '', inputSchema: {}, execute: async () => 0 }),
    ).not.toThrow();
  });

  it('forwards toolchange events', async () => {
    const ctx = fakeContext();
    Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true });
    const a = await createAdapter();
    const cb = vi.fn();
    const off = a.onToolChange(cb);
    ctx.dispatchEvent(new Event('toolchange'));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    ctx.dispatchEvent(new Event('toolchange'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
