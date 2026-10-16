import { expect, test } from '@playwright/test';
import { callTool, waitForTools } from './helpers';

test.describe('destructive actions need confirmation', () => {
  test('declining prevents execution; confirming runs it; both are logged', async ({ page }) => {
    await page.goto('/settings');
    await waitForTools(page, 4);

    // --- decline ---
    const declined = callTool(page, 'submit_delete-account');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('submit_delete-account');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused(); // safe default
    await page.getByRole('button', { name: 'Cancel' }).click();
    const d = await declined;
    expect(JSON.parse(d.raw).isError).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('deleted')).toHaveText('');

    // --- Escape also declines ---
    const escaped = callTool(page, 'submit_delete-account');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    expect(JSON.parse((await escaped).raw).isError).toBe(true);
    await expect(page.getByTestId('deleted')).toHaveText('');

    // --- accept ---
    const accepted = callTool(page, 'submit_delete-account');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Allow' }).click();
    const a = await accepted;
    expect(a.data.status).toBe('submitted');
    await expect(page.getByTestId('deleted')).toHaveText('Account deleted');

    const log = await page.evaluate(() =>
      (
        window as unknown as { __WEBMCP_AUTO__: { log(): { name: string; status: string }[] } }
      ).__WEBMCP_AUTO__.log(),
    );
    expect(log.filter((e) => e.name === 'submit_delete-account').map((e) => e.status)).toEqual([
      'denied',
      'denied',
      'ok',
    ]);
  });

  test('a page script cannot approve the dialog with a synthetic click', async ({ page }) => {
    await page.goto('/settings');
    await waitForTools(page, 4);
    const pending = callTool(page, 'submit_delete-account');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLButtonElement>('[data-webmcp-ui] button')
        .forEach((b) => b.click());
    });
    await expect(page.getByRole('alertdialog')).toBeVisible(); // untrusted clicks changed nothing
    await expect(page.getByTestId('deleted')).toHaveText('');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(JSON.parse((await pending).raw).isError).toBe(true);
  });

  test('the dialog is invisible to snapshots', async ({ page }) => {
    await page.goto('/settings');
    await waitForTools(page, 4);
    const pending = callTool(page, 'submit_delete-account');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    const snap = await callTool(page, 'get_page_snapshot');
    expect(String(snap.data)).not.toMatch(/consequential action|Allow/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await pending;
  });
});
