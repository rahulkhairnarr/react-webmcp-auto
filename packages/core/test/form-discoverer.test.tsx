import { afterEach, describe, expect, it } from 'vitest';
import { formDiscoverer } from '../src/discoverers/form';
import { resolveConfig, type ScanContext, type ToolCandidate } from '../src/types';
import { settle } from '../src/settle';
import { html } from './helpers';

function ctx(): ScanContext {
  return {
    document,
    config: resolveConfig(),
    route: '/',
    settle: (o) => settle(document, undefined, { quietMs: 20, timeoutMs: 500, ...o }),
  };
}
const discover = (): ToolCandidate[] => formDiscoverer.discover(ctx());
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FormDiscoverer schema inference', () => {
  it('infers every input type, constraints, and omits password', () => {
    html(`
      <h2>Sign up</h2>
      <form id="signup">
        <label for="u">Username</label><input id="u" name="username" required minlength="3" maxlength="12" pattern="[a-z]+">
        <label>Email <input name="email" type="email" required></label>
        <input name="site" type="url" aria-label="Website">
        <input name="age" type="number" min="18" max="99" step="1" aria-label="Age">
        <input name="born" type="date" min="1900-01-01" aria-label="Born">
        <input name="pw" type="password" required aria-label="Password">
        <input name="cc" autocomplete="cc-number" aria-label="Card">
        <input name="tracking" type="hidden" value="x">
        <label><input name="newsletter" type="checkbox"> Subscribe</label>
        <fieldset><legend>Plan</legend>
          <label><input type="radio" name="plan" value="free"> Free tier</label>
          <label><input type="radio" name="plan" value="pro"> Pro tier</label>
        </fieldset>
        <fieldset><legend>Interests</legend>
          <label><input type="checkbox" name="interests" value="a"> Alpha</label>
          <label><input type="checkbox" name="interests" value="b"> Beta</label>
        </fieldset>
        <label for="c">Country</label>
        <select id="c" name="country"><option value="">Pick</option><option value="us">United States</option><option value="de">Germany</option></select>
        <input name="city" list="cities" placeholder="City"><datalist id="cities"><option value="Paris"></option></datalist>
        <textarea name="bio" aria-label="Bio"></textarea>
        <input type="file" name="avatar" aria-label="Avatar">
        <button type="submit">Create</button>
      </form>`);
    const [c] = discover();
    expect(c!.name).toBe('submit_signup');
    const p = c!.inputSchema.properties!;
    expect(Object.keys(p).sort()).toEqual(
      [
        'age',
        'bio',
        'born',
        'city',
        'country',
        'email',
        'interests',
        'newsletter',
        'plan',
        'site',
        'username',
      ].sort(),
    );
    expect(p.username).toMatchObject({
      type: 'string',
      minLength: 3,
      maxLength: 12,
      pattern: '[a-z]+',
    });
    expect(p.username!.description).toContain('Username');
    expect(p.email).toMatchObject({ type: 'string', format: 'email' });
    expect(p.site).toMatchObject({ type: 'string', format: 'uri' });
    expect(p.age).toMatchObject({ type: 'number', minimum: 18, maximum: 99, multipleOf: 1 });
    expect(p.born).toMatchObject({ type: 'string', format: 'date' });
    expect(p.newsletter).toMatchObject({ type: 'boolean' });
    expect(p.plan).toMatchObject({ type: 'string', enum: ['free', 'pro'] });
    expect(p.plan!.description).toContain('pro: Pro tier');
    expect(p.interests).toMatchObject({ type: 'array', items: { enum: ['a', 'b'] } });
    expect(p.country).toMatchObject({ enum: ['us', 'de'] });
    expect(p.country!.description).toContain('us: United States');
    expect(p.city).toMatchObject({ enum: ['Paris'] });
    expect(c!.inputSchema.required).toEqual(['username', 'email']);
    expect(c!.inputSchema.additionalProperties).toBe(false);
    const s = JSON.stringify(c);
    expect(s).not.toContain('"pw"');
    expect(s).not.toContain('"cc"');
    expect(c!.description).toContain('Sensitive fields');
  });

  it('labels: aria-labelledby, aria-label, wrapping label, placeholder last', () => {
    html(`<span id="l">By ref</span><form id="f">
      <input name="a" aria-labelledby="l">
      <input name="b" aria-label="By aria">
      <label>Wrapped <input name="c"></label>
      <input name="d" placeholder="Only placeholder"></form>`);
    const p = discover()[0]!.inputSchema.properties!;
    expect(p.a!.description).toContain('By ref');
    expect(p.b!.description).toContain('By aria');
    expect(p.c!.description).toContain('Wrapped');
    expect(p.d!.description).toContain('Only placeholder');
  });

  it('name precedence: data-webmcp-tool > aria-label > id > name > heading > route+index', () => {
    html(`<form data-webmcp-tool="custom" aria-label="A" id="i" name="n"></form>
      <form aria-label="Aria One" id="i2"></form>
      <form id="only-id"></form>
      <form name="only-name"></form>
      <h3>Billing Info</h3><form></form>`);
    const names = discover().map((c) => c.name);
    expect(names).toEqual([
      'custom',
      'submit_aria_one',
      'submit_only-id',
      'submit_only-name',
      'submit_billing_info',
    ]);
    html('<div><form></form><form></form></div>');
    expect(discover().map((c) => c.name)).toEqual(['submit_form_root_1', 'submit_form_root_2']);
  });

  it('names are stable across re-renders and skip ignored/hidden forms', () => {
    const markup = `<form id="login"><input name="a"></form><form data-webmcp-ignore id="x"></form><form hidden id="h"></form>`;
    html(markup);
    const a = discover().map((c) => [c.key, c.name]);
    html(markup);
    expect(discover().map((c) => [c.key, c.name])).toEqual(a);
    expect(a).toEqual([['form:submit_login', 'submit_login']]);
  });

  it('risk: destructive from button text, declared override, GET search is read', () => {
    html(`<form id="d"><button>Delete account</button></form>
      <form id="s" method="get" action="/search"><input name="q" aria-label="Query"><button>Go</button></form>
      <form id="o" data-webmcp-risk="read"><button>Delete</button></form>`);
    expect(discover().map((c) => c.risk)).toEqual(['destructive', 'read', 'read']);
  });

  it('honours data-webmcp-description and finds forms in open shadow roots', () => {
    html('<form id="a" data-webmcp-description="Custom desc"></form><div id="host"></div>');
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<form id="inner"><input name="z"></form>';
    const c = discover();
    expect(c.map((x) => x.name)).toEqual(['submit_a', 'submit_inner']);
    expect(c[0]!.description).toContain('Custom desc');
  });
});

describe('FormDiscoverer execute (plain DOM)', () => {
  it('fills, reports native validation errors without submitting', async () => {
    html(
      `<form id="f"><input name="email" type="email" required aria-label="Email"><button>Go</button></form>`,
    );
    let submitted = false;
    document.getElementById('f')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    const [c] = discover();
    const bad = parse(await c!.execute({ email: 'nope' }, {}));
    expect(bad.status).toBe('validation_failed');
    expect(bad.errors[0].field).toBe('email');
    expect(submitted).toBe(false);
    const ok = parse(await c!.execute({ email: 'a@b.co' }, {}));
    expect(ok.status).toBe('submitted');
    expect(submitted).toBe(true);
  });

  it('rejects unknown fields and out-of-enum values with clear errors', async () => {
    html(`<form id="f"><select name="c"><option value="us">US</option></select></form>`);
    const [c] = discover();
    const r1 = await c!.execute({ nope: 1 }, {});
    expect(r1.isError).toBe(true);
    expect(parse(r1).error).toContain('Unknown field');
    const r2 = await c!.execute({ c: 'zz' }, {});
    expect(r2.isError).toBe(true);
    expect(parse(r2).error).toContain('Allowed: us');
  });

  it('never touches password and does not submit while it is empty', async () => {
    html(
      `<form id="f"><input name="user" aria-label="User"><input name="p" type="password" required><button>Log in</button></form>`,
    );
    let submitted = false;
    document.getElementById('f')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    const [c] = discover();
    const r = parse(await c!.execute({ user: 'bob' }, {}));
    expect(r.status).toBe('needs_user_input');
    expect(submitted).toBe(false);
    expect((document.querySelector('[name=user]') as HTMLInputElement).value).toBe('bob');
    expect((document.querySelector('[name=p]') as HTMLInputElement).value).toBe('');
  });

  it('handles checkbox, radio, multi-select, contenteditable', async () => {
    html(`<form id="f"><label><input type="checkbox" name="agree"> Agree</label>
      <input type="radio" name="r" value="1" aria-label="One"><input type="radio" name="r" value="2" aria-label="Two">
      <select name="m" multiple><option value="a">A</option><option value="b">B</option></select>
      <div contenteditable="true" aria-label="Notes" name="notes"></div></form>`);
    const [c] = discover();
    expect(c!.inputSchema.properties).toHaveProperty('notes');
    document.getElementById('f')!.addEventListener('submit', (e) => e.preventDefault());
    const r = parse(await c!.execute({ agree: true, r: '2', m: ['a', 'b'], notes: 'hi' }, {}));
    expect(r.status).toBe('submitted');
    expect((document.querySelector('[name=agree]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('[value="2"]') as HTMLInputElement).checked).toBe(true);
    expect(
      Array.from((document.querySelector('[name=m]') as HTMLSelectElement).selectedOptions).map(
        (o) => o.value,
      ),
    ).toEqual(['a', 'b']);
    expect(document.querySelector('[contenteditable]')!.textContent).toBe('hi');
  });

  it('errors clearly when a required file upload is present', async () => {
    html(
      `<form id="f"><input type="file" name="doc" required aria-label="Doc"><input name="t" aria-label="T"></form>`,
    );
    const [c] = discover();
    const r = await c!.execute({ t: 'x' }, {});
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('file upload');
  });
});
