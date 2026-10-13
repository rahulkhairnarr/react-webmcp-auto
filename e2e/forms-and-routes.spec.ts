import { expect, test } from '@playwright/test';
import { callTool, listTools, waitForTools } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
});

test('login form is discovered, schema is correct, password is excluded', async ({ page }) => {
  await page.goto('/');
  await waitForTools(page, 3);
  const backend = await page.evaluate(
    () => (window as unknown as { __WEBMCP_AUTO__: { adapter: string } }).__WEBMCP_AUTO__.adapter,
  );
  console.log('WebMCP backend:', backend);
  expect(['native-document', 'polyfill']).toContain(backend);
  const tools = await listTools(page);
  const login = tools.find((t) => t.name === 'submit_login');
  expect(login, `tools: ${tools.map((t) => t.name)}`).toBeTruthy();
  const props = login!.inputSchema.properties!;
  expect(Object.keys(props).sort()).toEqual(['remember', 'username']);
  expect(props.username).toMatchObject({ type: 'string', minLength: 3 });
  expect(props.remember).toMatchObject({ type: 'boolean' });
  expect(login!.inputSchema.required).toEqual(['username']);
  expect(JSON.stringify(login)).not.toMatch(/"password"/);
  expect(login!.description).toMatch(/Sensitive fields/);
  // Default tool set: forms + navigation + read tools, no click actions.
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(['list_routes', 'navigate', 'get_page_snapshot', 'get_form_state']),
  );
  expect(tools.some((t) => /action/.test(t.name))).toBe(false);
});

test('login tool fills the form but does NOT submit while the password is missing', async ({
  page,
}) => {
  await page.goto('/');
  await waitForTools(page, 3);
  const { data } = await callTool(page, 'submit_login', { username: 'alice', remember: true });
  expect(data.status).toBe('needs_user_input');
  expect(data.userMustFill).toEqual(['Password']);
  await expect(page.locator('#username')).toHaveValue('alice');
  await expect(page.getByLabel('Remember me')).toBeChecked();
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('');
});

test('contact tool fills select/radio/text, submits, returns the page response', async ({
  page,
}) => {
  await page.goto('/contact');
  await waitForTools(page, 3);
  const { data } = await callTool(page, 'submit_contact', {
    name: 'Ada',
    email: 'ada@example.com',
    topic: 'support',
    priority: 'high',
    message: 'Call me',
  });
  expect(data.status).toBe('submitted');
  expect(data.messages).toContain('Thanks Ada, topic: support');
  await expect(page.locator('#topic')).toHaveValue('support');
  await expect(page.getByLabel('High')).toBeChecked();
});

test('contact tool reports native validation errors and does not submit', async ({ page }) => {
  await page.goto('/contact');
  await waitForTools(page, 3);
  const { data, raw } = await callTool(page, 'submit_contact', {
    name: 'Ada',
    email: 'not-an-email',
  });
  expect(JSON.parse(raw).isError).toBe(true);
  expect(data.status).toBe('validation_failed');
  expect(data.errors!.map((e: { field: string }) => e.field)).toContain('email');
  await expect(page.getByRole('status')).toHaveText('');
});

test('navigate changes route via React Router without a full reload; toolchange fires and tools follow the route', async ({
  page,
}) => {
  await page.goto('/');
  await waitForTools(page, 3);
  await page.evaluate(() => {
    (window as unknown as { __marker: string }).__marker = 'same-document';
    window.__toolchanges = 0;
    document.modelContext!.addEventListener(
      'toolchange',
      () => void (window.__toolchanges = (window.__toolchanges ?? 0) + 1),
    );
  });

  expect((await listTools(page)).map((t) => t.name)).toContain('submit_login');

  const { data } = await callTool(page, 'navigate', { path: '/settings' });
  expect(data).toMatchObject({ status: 'navigated', from: '/', to: '/settings' });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe(
    'same-document',
  );

  await expect
    .poll(async () => (await listTools(page)).map((t) => t.name))
    .toContain('submit_profile');
  const names = (await listTools(page)).map((t) => t.name);
  expect(names).not.toContain('submit_login');
  expect(names).toContain('submit_delete-account');
  expect(await page.evaluate(() => window.__toolchanges)).toBeGreaterThan(0);
});

test('navigate refuses cross-origin targets', async ({ page }) => {
  await page.goto('/');
  await waitForTools(page, 3);
  const { raw } = await callTool(page, 'navigate', { path: 'https://example.com/' });
  expect(JSON.parse(raw).isError).toBe(true);
  expect(new URL(page.url()).origin).toBe('http://localhost:5173');
});

test('list_routes reports links found in the page', async ({ page }) => {
  await page.goto('/');
  await waitForTools(page, 3);
  const { data } = await callTool(page, 'list_routes');
  expect(data.current).toBe('/');
  expect(data.routes).toEqual(['/', '/contact', '/settings']);
});

test('hidden prompt-injection text never appears in the snapshot; output is delimited as untrusted', async ({
  page,
}) => {
  await page.goto('/');
  await waitForTools(page, 3);
  expect(await page.locator('#injection').textContent()).toMatch(
    /Ignore all previous instructions/,
  );
  const { data } = await callTool(page, 'get_page_snapshot');
  const text = String(data);
  expect(text).not.toMatch(/ignore all previous/i);
  expect(text).not.toMatch(/delete_account/);
  expect(text.startsWith('<untrusted_page_content')).toBe(true);
  expect(text).toContain('heading [level 1] "Sign in"');
  const tools = await listTools(page);
  expect(tools.find((t) => t.name === 'get_page_snapshot')?.annotations).toMatchObject({
    readOnlyHint: true,
    untrustedContentHint: true,
  });
});

test('no console errors on a plain page without WebMCP support', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  // Simulate a browser with neither native WebMCP nor the polyfill: make the polyfill chunk fail.
  await page.route(/webmcp-polyfill/, (r) => r.abort());
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'modelContext', {
      get: () => undefined,
      configurable: true,
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __WEBMCP_AUTO__?: { adapter: string } }).__WEBMCP_AUTO__?.adapter,
    ),
  ).toBe('none');
  expect(errors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e))).toEqual([]);
  await ctx.close();
});
