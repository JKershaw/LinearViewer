import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Parallel by file (per-worker urlKey isolation, LIN-625/LIN-629). fullyParallel
  // stays false so each spec file is worker-atomic — proxy-local.spec.js (fixed
  // 'local-workspace' key) and free-tier.spec.js (process-global hourly counter)
  // are safe only while their file runs on a single worker.
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
    // PLAN_FEE_MONTHLY_USD is unset for the same reason (LIN-1958 review F1):
    // tests/e2e/kpis.spec.js asserts the unset-state cash wording, and
    // server.js loads .env under NODE_ENV=test, so an operator's own
    // configured plan fee would otherwise leak into the test server and
    // break that assertion on their machine while CI stayed green.
    // YAP_BASE_URL points at the in-process mock Yap server (routes/test.js) so
    // the Collective live view (poll/say) is exercised without real egress.
    // JIRA_* are PRESENCE-ONLY placeholders (LIN-1887): `isJiraOAuthConfigured`
    // checks that the three vars are set, never that they are valid, so this is
    // what lets settings-providers.spec.js prove the OAuth add is REACHABLE from
    // Settings without a hand-typed URL. No live Atlassian app exists (D3) and
    // none is contacted — the spec stops at Harbour's own redirect to the
    // consent URL. Deliberately NOT dropped into .env.example as if usable.
    command: 'NODE_ENV=test PORT=3001 SESSION_SECRET=test-secret-for-playwright OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 PLAN_FEE_MONTHLY_USD= YAP_BASE_URL=http://localhost:3001/test/yap JIRA_CLIENT_ID=test-jira-client JIRA_CLIENT_SECRET=test-jira-secret JIRA_REDIRECT_URI=http://localhost:3001/auth/jira/oauth/callback node server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
