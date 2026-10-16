import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AuditWarning, ScanReportEntry } from '@react-webmcp-auto/core';
import { chromium } from 'playwright-core';

export interface AuditOptions {
  url: string;
  /** Extra time after load for the app to render, in ms. Default 1500. */
  waitMs?: number;
  actions?: false | 'safe' | 'all';
  executablePath?: string;
  /** Navigation timeout in ms. Default 30000. */
  timeoutMs?: number;
}

export interface AuditResult {
  url: string;
  tools: ScanReportEntry[];
  warnings: AuditWarning[];
}

function coreBundle(): string {
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve('@react-webmcp-auto/core/iife'), 'utf8');
}

function findChromium(explicit?: string): string | undefined {
  const candidates = [explicit, process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'];
  return candidates.find((p): p is string => !!p && existsSync(p));
}

/** Loads `url` in headless Chromium with the core runtime injected, then reports tools and warnings. */
export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChromium(opts.executablePath),
  });
  try {
    const context = await browser.newContext();
    const config = JSON.stringify({ discover: { actions: opts.actions ?? false } });
    // Injected before any page script so a framework hook (when added) sees it first.
    await context.addInitScript({
      content: `${coreBundle()};\n;(function(){try{WebMCPAutoCore.startRuntime(${config},{});}catch(e){}})();`,
    });
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 30_000 });
    await page.waitForTimeout(opts.waitMs ?? 1500);
    const result = await page.evaluate(() => {
      const h = (
        window as unknown as {
          __WEBMCP_AUTO__?: {
            scan(): unknown;
            describe(): { candidates: unknown[] } | undefined;
            audit(): unknown[];
          };
        }
      ).__WEBMCP_AUTO__;
      if (!h) return null;
      h.scan();
      return { tools: h.describe()?.candidates ?? [], warnings: h.audit() };
    });
    if (!result)
      throw new Error(
        'The WebMCP runtime did not start on this page (blocked by CSP or a navigation error?).',
      );
    return {
      url: opts.url,
      tools: result.tools as ScanReportEntry[],
      warnings: result.warnings as AuditWarning[],
    };
  } finally {
    await browser.close();
  }
}
