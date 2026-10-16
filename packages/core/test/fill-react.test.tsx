import { afterEach, describe, expect, it } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { formDiscoverer } from '../src/discoverers/form';
import { setNativeValue } from '../src/fill';
import { testCtx } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

const ctx = () => testCtx();

describe('native setter vs React controlled inputs', () => {
  it('plain el.value= is ignored by React, setNativeValue is not', () => {
    let seen = '';
    function C() {
      const [v, setV] = useState('');
      return (
        <input
          data-testid="i"
          value={v}
          onChange={(e) => {
            seen = e.target.value;
            setV(e.target.value);
          }}
        />
      );
    }
    mount(<C />);
    const input = document.querySelector('input')!;
    act(() => {
      input.value = 'naive';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toBe(''); // React's value tracker swallowed it
    act(() => {
      setNativeValue(input, 'native');
    });
    expect(seen).toBe('native');
    expect(input.value).toBe('native');
  });

  it('form tool drives a controlled React form end to end (fill, validate in JS, submit)', async () => {
    const submissions: unknown[] = [];
    function Form() {
      const [email, setEmail] = useState('');
      const [plan, setPlan] = useState('free');
      const [agree, setAgree] = useState(false);
      const [err, setErr] = useState('');
      return (
        <form
          id="contact"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\S+@\S+\.\S+$/.test(email)) {
              setErr('Enter a valid email');
              return;
            }
            setErr('');
            submissions.push({ email, plan, agree });
          }}
        >
          <label>
            Email
            <input
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={err ? 'true' : undefined}
              aria-describedby="e"
            />
          </label>
          <div id="e">{err}</div>
          <select
            name="plan"
            aria-label="Plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
          <label>
            <input
              type="checkbox"
              name="agree"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />{' '}
            Agree
          </label>
          <button type="submit">Send</button>
        </form>
      );
    }
    mount(<Form />);
    const [c] = formDiscoverer.discover(ctx());
    expect(c!.risk).toBe('destructive'); // "Send" is classified as consequential

    // The tool runs outside act(): it must work against a live, concurrently rendering app.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    let res = await c!.execute({ email: 'bad', plan: 'pro', agree: true }, {});
    const first = JSON.parse(res.content[0]!.text);
    expect(first.status).toBe('submitted_with_errors');
    expect(first.errors[0]).toMatchObject({ field: 'email', message: 'Enter a valid email' });
    expect(submissions).toHaveLength(0);

    res = await c!.execute({ email: 'me@example.com' }, {});
    expect(JSON.parse(res.content[0]!.text).status).toBe('submitted');
    expect(submissions).toEqual([{ email: 'me@example.com', plan: 'pro', agree: true }]);
  });
});
