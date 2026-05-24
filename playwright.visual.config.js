/**
 * Playwright config for visual screenshot generators in tests/visual/.
 *
 * These specs write PNGs to tests/screenshots/ without asserting anything.
 * They are intentionally excluded from the default `npm test` run (which
 * uses playwright.config.js with testDir './tests/e2e') so they don't
 * regenerate baselines on every CI run.
 *
 * Run manually:
 *   npx playwright test --config=playwright.visual.config.js
 *
 * Or target a single spec:
 *   npx playwright test --config=playwright.visual.config.js tests/visual/ship-screenshots.spec.js
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    },
  },
  webServer: {
    command: 'NODE_ENV=test PORT=3001 SESSION_SECRET=test-secret-for-playwright OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 node server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
