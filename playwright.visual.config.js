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
    // LINEAR_ACCESS_TOKEN is cleared so `/` renders the unauthenticated
    // landing showcase deterministically. If a local .env sets a PAT, the
    // server would auto-authenticate and 302 `/` to the workspace home, so the
    // `landing`/`landing-dark` captures would silently grab the authenticated
    // page instead — and dark would equal light there (the authed shell reads
    // the theme cookie, not prefers-color-scheme). Authenticated captures use
    // /test/set-session (mock fixtures), which is independent of PAT mode.
    command: 'NODE_ENV=test PORT=3001 SESSION_SECRET=test-secret-for-playwright LINEAR_ACCESS_TOKEN= OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 node server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
