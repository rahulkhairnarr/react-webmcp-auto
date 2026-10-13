import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Use a preinstalled Chromium when one is provided (CI images, sandboxes); else Playwright's own.
const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath,
      // Native WebMCP is used when this Chromium has it; otherwise the polyfill kicks in.
      args: [
        '--enable-experimental-web-platform-features',
        '--enable-features=WebMCP,WebMCPTesting',
      ],
    },
  },
  webServer: {
    command: 'pnpm --filter demo-vite dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
