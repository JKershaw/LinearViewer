import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // fullyParallel stays false: Playwright assigns whole spec FILES to workers
  // (file-atomic), which keeps specs on shared non-partition state safe —
  // proxy-local.spec.js (fixed `local-workspace` key) and the free-tier global
  // hourly counter. Enabling fullyParallel would split a file's test()s across
  // workers and reintroduce those collisions; deferred to a follow-up (LIN-625).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Per-worker urlKey isolation (tests/fixtures/test-base.js, scope:'worker')
  // makes file-level parallelism safe — each worker owns `${base}-w${parallelIndex}`.
  workers: process.env.CI ? 2 : 4,
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
    // Unset OpenRouter env keys so tests can deterministically exercise the
    // "no AI configured" 503 path regardless of the developer's local .env.
    // Tests that need an API key set it session-side via
    // /test/set-session?openRouterConnected=true.
    // YAP_BASE_URL points at the in-process mock Yap server (routes/test.js) so
    // the Collective live view (poll/say) is exercised without real egress.
    command: 'NODE_ENV=test PORT=3001 SESSION_SECRET=test-secret-for-playwright OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 YAP_BASE_URL=http://localhost:3001/test/yap node server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
