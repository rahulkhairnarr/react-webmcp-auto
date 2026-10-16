import { afterEach, describe, expect, it } from 'vitest';
import { auditDocument } from '../src/audit';
import { createConfirmDialog } from '../src/confirm-dialog';
import { collectActions, createActionDiscoverer } from '../src/discoverers/actions';
import { declarativeDiscoverer } from '../src/discoverers/declarative';
import { startRuntime, type Runtime } from '../src/runtime';
import type { ToolCall } from '../src/types';
import { fakeAdapter, html, tick, testCtx } from './helpers';

const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  name: 'delete_account',
  input: { a: 1 },
  risk: 'destructive',
  description: 'Deletes <b>everything</b>',
  source: 'form',
  ...over,
});
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const btn = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-webmcp-ui] button')].find(
    (b) => b.textContent === label,
  )!;
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

let rt: Runtime | undefined;
afterEach(() => {
  rt?.stop();
  rt = undefined;
  document.body.innerHTML = '';
});

describe('confirm dialog', () => {
  it('is an accessible alertdialog, focuses the safe button, renders page text as text (not HTML)', async () => {
    const ask = createConfirmDialog(document, { requireTrusted: false });
    const p = ask(call());
    await tick();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)).toBeTruthy();
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toContain(
      'delete_account',
    );
    expect(d.querySelector('b')).toBeNull(); // injected markup stayed inert
    expect(d.textContent).toContain('<b>everything</b>');
    expect(document.activeElement).toBe(btn('Cancel'));
    btn('Allow').click();
    expect(await p).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('Cancel, Escape and backdrop decline; focus is restored', async () => {
    document.body.innerHTML = '<button id="origin">o</button>';
    const origin = document.getElementById('origin')!;
    const ask = createConfirmDialog(document, { requireTrusted: false });
    origin.focus();
    let p = ask(call());
    await tick();
    btn('Cancel').click();
    expect(await p).toBe(false);
    expect(document.activeElement).toBe(origin);
    p = ask(call());
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p).toBe(false);
    p = ask(call());
    await tick();
    document.querySelector<HTMLElement>('[data-webmcp-ui]')!.click();
    expect(await p).toBe(false);
  });

  it('traps Tab between its two buttons', async () => {
    const ask = createConfirmDialog(document, { requireTrusted: false });
    const p = ask(call());
    await tick();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(btn('Allow'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(btn('Cancel'));
    btn('Cancel').click();
    await p;
  });

  it('IGNORES synthetic clicks by default, so a script or agent cannot approve its own action', async () => {
    const ask = createConfirmDialog(document, { timeoutMs: 80 });
    const p = ask(call());
    await tick();
    btn('Allow').click(); // isTrusted === false
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).not.toBeNull(); // still open: neither approved nor dismissed by script
    expect(await p).toBe(false); // times out => declined
  });

  it('queues concurrent requests and shows one dialog at a time', async () => {
    const ask = createConfirmDialog(document, { requireTrusted: false });
    const a = ask(call({ name: 'first' }));
    const b = ask(call({ name: 'second' }));
    await tick();
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(dialog()!.textContent).toContain('first');
    btn('Allow').click();
    expect(await a).toBe(true);
    await tick();
    expect(dialog()!.textContent).toContain('second');
    btn('Cancel').click();
    expect(await b).toBe(false);
  });
});

describe('runtime confirmation wiring', () => {
  it('custom config.confirm replaces the dialog; declining prevents execution', async () => {
    html('<form id="d"><button>Delete account</button></form>');
    let ran = 0;
    document.getElementById('d')!.addEventListener('submit', (e) => {
      e.preventDefault();
      ran++;
    });
    const adapter = fakeAdapter();
    Object.defineProperty(document, 'modelContext', {
      value: Object.assign(new EventTarget(), {
        registerTool: (t: never) => {
          adapter.register(t);
        },
      }),
      configurable: true,
    });
    const asked: ToolCall[] = [];
    rt = await startRuntime(
      {
        discover: { navigation: false, snapshot: false },
        confirm: async (c) => {
          asked.push(c);
          return false;
        },
      },
      { scanDelayMs: 0 },
    );
    const out = await rt.registry.get('submit_d')!.execute({}, {});
    expect(out.isError).toBe(true);
    expect(ran).toBe(0);
    expect(asked[0]).toMatchObject({ name: 'submit_d', risk: 'destructive' });
    expect(dialog()).toBeNull();
  });

  it('read and write tools never prompt', async () => {
    html('<form id="w"><button>Save</button></form>');
    document.getElementById('w')!.addEventListener('submit', (e) => e.preventDefault());
    const adapter = fakeAdapter();
    Object.defineProperty(document, 'modelContext', {
      value: Object.assign(new EventTarget(), {
        registerTool: (t: never) => {
          adapter.register(t);
        },
      }),
      configurable: true,
    });
    rt = await startRuntime(
      {
        discover: { navigation: false, snapshot: false },
        confirm: async () => {
          throw new Error('must not be asked');
        },
      },
      { scanDelayMs: 0 },
    );
    expect((await rt.registry.get('submit_w')!.execute({}, {})).isError).toBeUndefined();
  });
});

describe('ActionDiscoverer', () => {
  const page = `<nav><a href="/home">Home</a><a href="https://evil.test/">Out</a></nav>
    <button id="b1">Open menu</button><button id="del">Delete project</button>
    <button disabled>Disabled one</button><div aria-hidden="true"><button>Hidden</button></div>
    <button data-webmcp-ignore>Ignored</button>
    <form><input name="a" aria-label="A"><button type="submit">Submit form</button></form>
    <div data-webmcp-ui="confirm"><button>Allow</button></div>`;

  it("'safe' lists non-destructive same-origin controls only; form submits, hidden, ignored and our own UI are excluded", () => {
    html(page);
    const names = collectActions(document, 'safe').map((a) => a.name);
    expect(names).toEqual(['Home', 'Open menu']);
  });
  it("'all' also lists destructive ones, flagged", () => {
    html(page);
    const all = collectActions(document, 'all');
    expect(all.find((a) => a.name === 'Delete project')?.risk).toBe('destructive');
    expect(all.some((a) => a.name === 'Allow')).toBe(false);
  });
  it('perform_action clicks by id, rejects unknown/forged ids, and cannot reach excluded controls', async () => {
    html(page);
    let clicked = 0;
    document.getElementById('b1')!.addEventListener('click', () => clicked++);
    const [list, perform] = createActionDiscoverer('safe').discover(testCtx());
    const raw = (await list!.execute({}, {})).content[0]!.text;
    const items = JSON.parse(raw.split('\n')[2]!) as { id: string; name: string }[];
    const id = items.find((i) => i.name === 'Open menu')!.id;
    expect(parse(await perform!.execute({ id }, {})).status).toBe('performed');
    expect(clicked).toBe(1);
    expect((await perform!.execute({ id: 'e99999' }, {})).isError).toBe(true);
    // The destructive button has an id once 'all' has seen it; 'safe' must still refuse it.
    const delId = collectActions(document, 'all').find((a) => a.name === 'Delete project')!.id;
    expect((await perform!.execute({ id: delId }, {})).isError).toBe(true);
  });
  it("'all' mode: destructive perform_action asks first; decline prevents the click", async () => {
    html(page);
    let clicked = 0;
    document.getElementById('del')!.addEventListener('click', () => clicked++);
    const asked: ToolCall[] = [];
    const answers = [false, true];
    const [, perform] = createActionDiscoverer('all').discover(testCtx({ answers, asked }));
    const id = collectActions(document, 'all').find((a) => a.name === 'Delete project')!.id;
    expect((await perform!.execute({ id }, {})).isError).toBe(true);
    expect(clicked).toBe(0);
    expect(parse(await perform!.execute({ id }, {})).status).toBe('performed');
    expect(clicked).toBe(1);
    expect(asked).toHaveLength(2);
  });
  it('is OFF by default (no list_actions/perform_action registered)', async () => {
    html('<button>Hi</button>');
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
    expect(rt.registry.names).not.toContain('perform_action');
    rt.stop();
    rt = await startRuntime({ discover: { actions: 'safe' } }, { scanDelayMs: 0 });
    expect(rt.registry.names).toEqual(expect.arrayContaining(['list_actions', 'perform_action']));
  });
});

describe('DeclarativeDiscoverer', () => {
  it('turns marked non-form elements into tools; honours description, risk and ignore', async () => {
    html(`<button data-webmcp-tool="export_csv" data-webmcp-description="Download the table as CSV" data-webmcp-risk="read">Export</button>
      <button data-webmcp-tool="wipe_cache">Wipe cache</button>
      <button data-webmcp-tool="nope" data-webmcp-ignore>x</button>`);
    let n = 0;
    document.querySelector('button')!.addEventListener('click', () => n++);
    const c = declarativeDiscoverer.discover(testCtx());
    expect(c.map((x) => [x.name, x.risk, x.riskDeclared])).toEqual([
      ['export_csv', 'read', true],
      ['wipe_cache', 'destructive', false],
    ]);
    expect(c[0]!.description).toBe('Download the table as CSV');
    expect(parse(await c[0]!.execute({}, {})).status).toBe('performed');
    expect(n).toBe(1);
  });
});

describe('audit', () => {
  const run = async (markup: string) => {
    html(markup);
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
    return auditDocument(document, rt.lastScan);
  };
  it('reports unlabeled inputs, placeholder-only labels, div-buttons, duplicates, undeclared destructive', async () => {
    const w =
      await run(`<form id="x" aria-label="Same"><input name="a"><input name="b" placeholder="Only placeholder"><button>Delete everything</button></form>
      <form aria-label="Same"></form>
      <div onclick="void 0" class="fake-btn">Click me</div>`);
    const codes = w.map((x) => x.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'unlabeled-input',
        'placeholder-only-label',
        'div-button',
        'duplicate-name',
        'destructive-undeclared',
      ]),
    );
  });
  it('a clean page has no warnings; declared destructive is not flagged', async () => {
    const w = await run(
      '<form aria-label="Contact" data-webmcp-risk="destructive"><label>Name <input name="n"></label><button>Delete</button></form>',
    );
    expect(w).toEqual([]);
  });
  it('flags canvas-only UIs', async () => {
    document.body.innerHTML = '<canvas id="c"></canvas>';
    const c = document.getElementById('c')!;
    c.getBoundingClientRect = () => ({ width: 2000, height: 2000 }) as DOMRect;
    expect(auditDocument(document, undefined).map((x) => x.code)).toContain('canvas-only-ui');
  });
});
