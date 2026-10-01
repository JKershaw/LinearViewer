import { defineConfig } from '@playwright/test';
import crypto from 'node:crypto';

// LIN-3125 Phase 3: the held-connection e2e twin needs a server with the GitHub
// App CONFIGURED (the /auth/github hook runs only after the config guard). The
// default webServer deliberately runs unconfigured (many specs assert the
// GitHub add affordances are honestly blocked), so the twin gets its own
// GitHub-configured server on port 3002 with an isolated MangoDB dir and a
// freshly generated, PEM-valid App key.
const { privateKey: heldKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const HELD_GITHUB_PEM = heldKey.export({ type: 'pkcs1', format: 'pem' });
const UNCONFIGURED_ENV = 'NODE_ENV=test SESSION_SECRET=test-secret-for-playwright OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 PLAN_FEE_MONTHLY_USD= YAP_BASE_URL=http://localhost:3001/test/yap JIRA_CLIENT_ID=test-jira-client JIRA_CLIENT_SECRET=test-jira-secret JIRA_REDIRECT_URI=http://localhost:3001/auth/jira/oauth/callback JIRA_OAUTH_TEST_BASE=http://localhost:3001/test/atlassian EMAIL_TRANSPORT=capture EMAIL_LINK_ORIGIN=';

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
  webServer: [
    {
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
    // Settings without a hand-typed URL. No live Atlassian app exists (D3) for
    // `landing.spec.js`/`settings-providers.spec.js` — those specs stop at
    // Harbour's own redirect to the consent URL, and none of Atlassian is
    // contacted. That blanket claim no longer covers every Jira spec, though
    // (LIN-2001): JIRA_OAUTH_TEST_BASE points the two direct-fetch call sites in
    // `lib/providers/jira/oauth.js` (token exchange, accessible-resources) at
    // the in-process fake Atlassian routes below, so Harbour's SERVER process
    // (never the Playwright browser) makes two real HTTP calls to
    // `http://localhost:3001/test/atlassian/...` — an in-process stand-in for
    // Atlassian, not Atlassian itself. It is gated the same way JIRA_* above is
    // presence-only: inert unless NODE_ENV=test AND the var is set, so it is
    // strictly a test-only widening of the OAuth token/accessible-resources
    // call sites, never the authorize host or the REST-gateway guard.
    //
    // EMAIL_TRANSPORT=capture (LIN-1892): turns the email magic-link door on
    // with the in-memory capture transport, so specs read sign-in links back
    // from GET /test/email-outbox — nothing is ever sent. Like JIRA_* above it
    // is inert outside NODE_ENV=test: lib/email-availability.js resolves
    // `capture` only under test. Set on this command line, it beats a
    // developer's .env (server.js runs `import 'dotenv/config'`, and dotenv
    // never overrides a variable that is already set), so a local
    // EMAIL_TRANSPORT=console can't switch Playwright to the console transport,
    // and local Resend keys can't send real mail (capture wins over Resend).
    // EMAIL_LINK_ORIGIN= (empty, which counts as unset) pins captured links to
    // this server's own origin, whatever a developer's .env points it at.
    command: `${UNCONFIGURED_ENV} PORT=3001 node server.js`,
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    },
    {
      // LIN-3125 Phase 3 held-connection twin: GitHub App configured, isolated
      // MangoDB dir. The twin opts into this origin via `test.use({ baseURL })`.
      command: `${UNCONFIGURED_ENV} PORT=3002 HARBOUR_DATA_DIR=./test-results/held-e2e-data GITHUB_CLIENT_ID=test-held-client GITHUB_CLIENT_SECRET=test-held-secret GITHUB_APP_ID=424242 GITHUB_APP_SLUG=held-test-app GITHUB_APP_PRIVATE_KEY='${HELD_GITHUB_PEM}' node server.js`,
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
