import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

const bin = resolve('packages/cli/dist/bin.js');
const fixture = (n: string) => pathToFileURL(resolve('e2e/fixtures', n)).href;
const audit = (url: string, ...args: string[]) =>
  spawnSync('node', [bin, 'audit', url, '--wait', '300', ...args], { encoding: 'utf8' });

test.describe('react-webmcp audit', () => {
  test('reports the expected warnings on a deliberately bad page (JSON)', () => {
    const r = audit(fixture('bad.html'), '--format', 'json', '--strict');
    expect(r.status, r.stderr).toBe(1); // --strict + warnings
    const out = JSON.parse(r.stdout) as {
      tools: { name: string; risk: string; source: string; inputSchema: object }[];
      warnings: { code: string; hint?: string }[];
    };
    const codes = out.warnings.map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'unlabeled-input',
        'placeholder-only-label',
        'div-button',
        'duplicate-name',
        'destructive-undeclared',
      ]),
    );
    expect(out.warnings.find((w) => w.code === 'duplicate-name')?.hint).toBe('submit_settings');
    const names = out.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['submit_settings', 'submit_settings_2', 'submit_close']),
    );
    expect(out.tools.find((t) => t.name === 'submit_close')).toMatchObject({
      risk: 'destructive',
      source: 'form',
    });
  });

  test('flags canvas-only UIs', () => {
    const r = audit(fixture('canvas.html'), '--format', 'json');
    expect(r.status, r.stderr).toBe(0); // no --strict: warnings do not fail
    expect(JSON.parse(r.stdout).warnings.map((w: { code: string }) => w.code)).toContain(
      'canvas-only-ui',
    );
  });

  test('a clean page passes --strict and prints a table', () => {
    const r = audit(fixture('good.html'), '--strict');
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain('submit_contact');
    expect(r.stdout).toMatch(/NAME\s+RISK\s+SOURCE/);
    expect(r.stdout).toContain('name*:string');
    expect(r.stdout).toMatch(/Warnings \(0\)/);
  });

  test('usage errors exit 2', () => {
    expect(spawnSync('node', [bin, 'audit'], { encoding: 'utf8' }).status).toBe(2);
    expect(
      spawnSync('node', [bin, 'audit', 'x', '--format', 'xml'], { encoding: 'utf8' }).status,
    ).toBe(2);
  });
});
