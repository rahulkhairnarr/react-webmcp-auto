import { describe, expect, it } from 'vitest';
import { assignNames, globToRegExp, matchesAny, sanitizeName } from '../src/naming';
import { classifyRisk } from '../src/risk';
import { isSensitiveField } from '../src/sensitive';
import type { ToolCandidate } from '../src/types';

const cand = (name: string): ToolCandidate => ({
  key: name,
  name,
  description: '',
  inputSchema: {},
  risk: 'write',
  source: 't',
  execute: async () => ({ content: [] }),
});

describe('naming', () => {
  it('sanitises to the spec charset', () => {
    expect(sanitizeName('Submit "Log in" form!')).toBe('Submit_Log_in_form');
    expect(sanitizeName('é ü')).toBe('e_u');
    expect(sanitizeName('')).toBe('tool');
    expect(sanitizeName('x'.repeat(300)).length).toBeLessThanOrEqual(128);
  });
  it('dedupes with deterministic suffixes in order', () => {
    const run = () => assignNames([cand('a'), cand('a'), cand('b'), cand('a')]).map((c) => c.name);
    expect(run()).toEqual(['a', 'a_2', 'b', 'a_3']);
    expect(run()).toEqual(run());
  });
  it('honours custom naming and survives it throwing', () => {
    expect(assignNames([cand('a')], () => 'custom').map((c) => c.name)).toEqual(['custom']);
    expect(
      assignNames([cand('a')], () => {
        throw new Error('x');
      }).map((c) => c.name),
    ).toEqual(['a']);
  });
  it('matches globs and selectors', () => {
    expect(globToRegExp('delete_*').test('delete_account')).toBe(true);
    document.body.innerHTML = '<div class="x"><form id="f"></form></div>';
    const f = document.getElementById('f')!;
    expect(matchesAny('zzz', f, ['.x'])).toBe(true);
    expect(matchesAny('zzz', f, ['#nope'])).toBe(false);
    expect(matchesAny('delete_account', f, ['delete_*'])).toBe(true);
  });
});

describe('risk heuristic', () => {
  it.each([
    ['Delete account', 'destructive'],
    ['cancel subscription', 'destructive'],
    ['Pay now', 'destructive'],
    ['Purchase', 'destructive'],
    ['Transfer funds', 'destructive'],
    ['Publish post', 'destructive'],
    ['Send message', 'destructive'],
    ['remove_item', 'destructive'],
    ['Update profile', 'write'],
    ['Log in', 'write'],
  ])('%s -> %s', (text, expected) => {
    expect(classifyRisk({ text })).toBe(expected);
  });
  it('uses HTTP method and lets declared risk win', () => {
    expect(classifyRisk({ text: 'search', method: 'get' })).toBe('read');
    expect(classifyRisk({ method: 'DELETE' })).toBe('destructive');
    expect(classifyRisk({ text: 'delete', declared: 'read' })).toBe('read');
    expect(classifyRisk({ text: 'hello', declared: 'bogus' })).toBe('write');
  });
});

describe('sensitive fields', () => {
  const el = (attrs: string) => {
    document.body.innerHTML = `<input ${attrs}>`;
    return document.querySelector('input')!;
  };
  it.each([
    'type="password"',
    'autocomplete="cc-number"',
    'autocomplete="one-time-code"',
    'autocomplete="new-password"',
    'name="otp"',
    'name="cardNumber"',
    'name="ssn"',
    'id="cvv"',
    'name="social_security"',
  ])('flags %s', (attrs) => expect(isSensitiveField(el(attrs))).toBe(true));
  it.each([
    'name="email"',
    'name="username"',
    'name="spinner"',
    'name="shipping"',
    'type="text" name="company"',
  ])('allows %s', (attrs) => expect(isSensitiveField(el(attrs))).toBe(false));
});
