import { afterEach, describe, expect, it } from 'vitest';
import type { WebMCPAutoConfig } from '../src/types';
import { startRuntime, type Runtime } from '../src/runtime';
import { createGuard, CallLog, RateLimiter } from '../src/safety';
import { installNetworkTracker, settle } from '../src/settle';
import { fakeAdapter, html, tick } from './helpers';

let rt: Runtime | undefined;
afterEach(() => {
  rt?.stop();
  rt = undefined;
  document.body.innerHTML = '';
});

async function boot(config: WebMCPAutoConfig = {}, scanDelayMs = 0) {
  const adapter = fakeAdapter();
  Object.defineProperty(document, 'modelContext', {
    value: Object.assign(new EventTarget(), {
      registerTool: (t: never, o: { signal: AbortSignal }) => {
        adapter.register(t);
        void o;
      },
    }),
    configurable: true,
  });
  rt = await startRuntime(
    { discover: { navigation: false, snapshot: false }, ...config },
    { scanDelayMs },
  );
  return rt;
}

describe('runtime', () => {
  it('registers tools for forms on start and reacts to DOM changes (add/remove)', async () => {
    html('<form id="a"><input name="x" aria-label="X"></form>');
    const r = await boot();
    expect(r.registry.names).toEqual(['submit_a']);
    document.body.insertAdjacentHTML('beforeend', '<form id="b"></form>');
    await tick(50);
    expect(r.registry.names).toEqual(['submit_a', 'submit_b']);
    document.getElementById('a')!.remove();
    await tick(50);
    expect(r.registry.names).toEqual(['submit_b']);
  });

  it('applies exclude / include (selectors and name globs)', async () => {
    html('<form id="a"></form><form id="b" class="keep"></form><form id="c"></form>');
    expect((await boot({ exclude: ['submit_a', '#c'] })).registry.names).toEqual(['submit_b']);
    rt!.stop();
    expect((await boot({ include: ['.keep'] })).registry.names).toEqual(['submit_b']);
  });

  it('manifest overrides name, description, risk and can ignore', async () => {
    html('<form id="a"></form><form id="b"></form>');
    const r = await boot({
      manifest: {
        tools: [
          { key: 'form:submit_a', name: 'renamed', description: 'From manifest', risk: 'read' },
          { key: 'form:submit_b', ignore: true },
        ],
      },
    });
    expect(r.registry.names).toEqual(['renamed']);
    expect(r.registry.get('renamed')).toMatchObject({ description: 'From manifest', risk: 'read' });
  });

  it('coalesces a burst of mutations into one scan (<=1 per 150ms)', async () => {
    html('<form id="a"></form>');
    const r = await boot({}, 150);
    // 30 synchronous mutations must not produce 30 scans: nothing is registered until the throttle fires.
    for (let i = 0; i < 30; i++)
      document.body.insertAdjacentHTML('beforeend', `<form id="f${i}"></form>`);
    expect(r.registry.names).toHaveLength(1);
    await tick(400);
    expect(r.registry.names).toHaveLength(31);
  });

  it('stop() unregisters everything and is idempotent; disabled config does nothing', async () => {
    html('<form id="a"></form>');
    const r = await boot();
    r.stop();
    expect(r.registry.names).toEqual([]);
    expect(() => r.stop()).not.toThrow();
    expect((await boot({ enabled: false })).registry.names).toEqual([]);
  });

  it('destructive tools are refused when nobody can confirm (fails closed) and the call is logged', async () => {
    html('<form id="d"><button>Delete account</button></form>');
    let submitted = false;
    document.getElementById('d')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    const r = await boot();
    const out = await r.registry.get('submit_d')!.execute({}, {});
    expect(out.isError).toBe(true);
    expect(submitted).toBe(false);
    expect(r.log.entries().at(-1)).toMatchObject({
      name: 'submit_d',
      status: 'denied',
      risk: 'destructive',
    });
  });

  it('confirm callback: decline blocks, accept runs', async () => {
    html('<form id="d"><button>Delete account</button></form>');
    let submitted = 0;
    document.getElementById('d')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted++;
    });
    const answers = [false, true];
    const r = await boot({ confirm: async () => answers.shift()! });
    await r.registry.get('submit_d')!.execute({}, {});
    expect(submitted).toBe(0);
    const ok = await r.registry.get('submit_d')!.execute({}, {});
    expect(ok.isError).toBeUndefined();
    expect(submitted).toBe(1);
  });
});

describe('guard', () => {
  it('rate limits per minute', async () => {
    let t = 0;
    const g = createGuard(
      { rateLimit: { perMinute: 2 }, confirm: undefined },
      new CallLog(),
      undefined,
      new RateLimiter(2, () => t),
    );
    const call = { name: 'n', input: {}, risk: 'write' as const, description: '', source: 's' };
    const ok = async () => ({ content: [{ type: 'text' as const, text: '{}' }] });
    expect((await g.run(call, ok)).isError).toBeUndefined();
    expect((await g.run(call, ok)).isError).toBeUndefined();
    expect((await g.run(call, ok)).isError).toBe(true);
    t = 61_000;
    expect((await g.run(call, ok)).isError).toBeUndefined();
  });
  it('ring buffer is bounded', () => {
    const l = new CallLog(3);
    for (let i = 0; i < 10; i++)
      l.push({ time: i, name: 'n', risk: 'read', status: 'ok', durationMs: 0, input: {} });
    expect(l.entries().map((e) => e.time)).toEqual([7, 8, 9]);
  });
});

describe('settle', () => {
  it('waits for DOM quiet and reports new alerts', async () => {
    html('<div id="root"></div>');
    const p = settle(document, undefined, { quietMs: 40, timeoutMs: 1000 });
    setTimeout(() => {
      document.getElementById('root')!.innerHTML = '<div role="alert">Saved!</div>';
    }, 20);
    const res = await p;
    expect(res.timedOut).toBe(false);
    expect(res.alerts).toEqual(['Saved!']);
    expect(res.durationMs).toBeGreaterThanOrEqual(55);
  });
  it('waits for in-flight fetch and restores fetch on dispose', async () => {
    const orig = globalThis.fetch;
    let resolveFetch!: (r: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((r) => {
        resolveFetch = r;
      })) as typeof fetch;
    const tracker = installNetworkTracker(window as Window & typeof globalThis);
    void fetch('/x');
    expect(tracker.inflight()).toBe(1);
    let done = false;
    const p = settle(document, tracker, { quietMs: 20, timeoutMs: 1000 }).then((r) => {
      done = true;
      return r;
    });
    await tick(80);
    expect(done).toBe(false);
    resolveFetch(new Response('ok'));
    await p;
    expect(tracker.inflight()).toBe(0);
    tracker.dispose();
    expect(globalThis.fetch).not.toBe(undefined);
    globalThis.fetch = orig;
  });
  it('gives up at the timeout when the page never goes quiet', async () => {
    html('<div id="r"></div>');
    const iv = setInterval(() => document.getElementById('r')!.append('x'), 5);
    const res = await settle(document, undefined, { quietMs: 50, timeoutMs: 150 });
    clearInterval(iv);
    expect(res.timedOut).toBe(true);
  });
});

describe('runtime defaults', () => {
  it('registers forms + navigation + read tools by default, but no click actions', async () => {
    html('<form id="a"></form>');
    const adapter = fakeAdapter();
    Object.defineProperty(document, 'modelContext', {
      value: Object.assign(new EventTarget(), {
        registerTool: (t: never) => {
          adapter.register(t);
        },
      }),
      configurable: true,
    });
    rt = await startRuntime({}, { scanDelayMs: 0 });
    expect(rt.registry.names.sort()).toEqual([
      'get_form_state',
      'get_page_snapshot',
      'list_routes',
      'navigate',
      'submit_a',
    ]);
  });
});
