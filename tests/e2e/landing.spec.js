import { test, expect } from '@playwright/test';

// LIN-980 (UI audit G): the unauthenticated home page is a bespoke Harbour
// showcase — a Harbour-focused top area, fake-data glimpses of real surfaces
// (observation feed, swim board, grounded prompt), a providers strip, and a
// distinct Harbour OS section — composed on D's shared header nav and the shared
// design system. It is NO LONGER rendered through render.js's project-tree
// renderer (the old landing was marketing copy dressed as a fake projects tree).

test.describe('Landing Page (bespoke showcase)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('renders the Harbour brand hero as the page heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="landing-hero"]')).toBeVisible();
    await expect(page.locator('h1.landing-wordmark')).toContainText('harbour');
    await expect(page.locator('.landing-mark svg')).toBeVisible();
    // Body is flagged is-landing so the landing token remap + grid apply.
    await expect(page.locator('body')).toHaveClass(/is-landing/);
  });

  test('does NOT render the fake project-tree landing', async ({ page }) => {
    await page.goto('/');
    // The old landing rendered content/landing.md through the tree renderer.
    // The showcase replaces it — no project rows on the home page.
    await expect(page.locator('.project-header')).toHaveCount(0);
    await expect(page.locator('.project')).toHaveCount(0);
    await expect(page.locator('.landing-showcase')).toBeVisible();
  });

  test('drops the shared top bar on the homepage — hero is the sole sign-in path (LIN-1508)', async ({ page }) => {
    await page.goto('/');
    // The redundant landing top bar (projects / local workspace / sign in /
    // GitHub) is removed on the homepage: the hero below already carries the
    // primary sign-in CTAs, so the bar was pure duplication. It is preserved for
    // the swipe/swim previews (see landing-swipe/landing-swim specs), which have
    // no hero and rely on it as their only sign-in route.
    await expect(page.locator('nav.nav-bar')).toHaveCount(0);
    await expect(page.locator('nav a.login')).toHaveCount(0);
    // The hero carries the directly-reachable Linear sign-in CTA instead.
    const linearCta = page.locator('[data-testid="landing-cta-linear"]');
    await expect(linearCta).toBeVisible();
    await expect(linearCta).toHaveAttribute('href', '/auth/linear');
    // The hero header itself carries no legacy reset chrome.
    await expect(page.locator('header .reset-view')).toHaveCount(0);
  });

  // LIN-1890 close-out, ledger items 1–2. The plan's R1 recorded "no configured
  // Jira CTA is rendered by a real server" and "no test drives /auth/jira/oauth
  // as HTTP" as harness LIMITATIONS. Both were false: this Playwright server IS
  // Jira-OAuth-configured (playwright.config.js's webServer sets the three
  // JIRA_* presence-only placeholders), so the CTA renders here today and the
  // entry route answers. They were UNASSERTED, not unavailable — which is a
  // missing test, not a missing mechanism. These two assertions are the fix, and
  // they close the entry chain end to end: the CTA a Jira-only human actually
  // clicks → the route it points at → Harbour's own redirect to Atlassian.
  test('the configured server renders the Jira entry CTA, and it reaches Atlassian (LIN-1890)', async ({ page }) => {
    await page.goto('/');
    const jiraCta = page.locator('[data-testid="landing-cta-jira"]');
    await expect(jiraCta).toBeVisible();
    // `mode=new` is the landing entry point. Omitting it would still work (the
    // route defaults to `new`), but the CTA states its intent explicitly, and an
    // add-source URL appearing here would be a real bug — it would bind onto
    // some other workspace instead of bootstrapping one.
    await expect(jiraCta).toHaveAttribute('href', '/auth/jira/oauth?mode=new');

    // The HTTP leg. Stops at Harbour's own redirect — no live Atlassian app
    // exists (D3) and none is contacted, same bound as settings-providers.spec.js.
    const begin = await page.request.get('/auth/jira/oauth?mode=new', { maxRedirects: 0 });
    expect(begin.status()).toBe(302);
    const consent = new URL(begin.headers()['location']);
    expect(consent.origin).toBe('https://auth.atlassian.com');
    expect(consent.pathname).toBe('/authorize');
    expect(consent.searchParams.get('client_id')).toBeTruthy();
  });

  test('shows the showcase sections', async ({ page }) => {
    await page.goto('/');
    for (const id of ['landing-loop', 'landing-observation', 'landing-swim', 'landing-prompt', 'landing-try', 'landing-providers', 'landing-os']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
    }
  });

  test('"try it yourself" section grounds its claim in the pricing rate card, scoped to AI Generated Prompts (LIN-1161)', async ({ page }) => {
    await page.goto('/');
    const tryIt = page.locator('[data-testid="landing-try"]');
    await expect(tryIt).toBeVisible();
    // Not a hardcoded second price: the section renders the live per-1M-token
    // rate from formatModelPricing(DEFAULT_MODEL), the same figure Settings shows.
    await expect(tryIt).toContainText(/\$\d+\.\d{2} in \/ \$\d+\.\d{2} out per 1M tokens/);
    await expect(tryIt).toContainText(/OpenRouter/);
    await expect(tryIt).toContainText(/AI Generated Prompts/);
    await expect(tryIt).toContainText(/under \$1/);
    // Honesty guardrail: never claims the whole product runs for under $1, and
    // never says a user must pay to try (the playwright env unsets the free-tier
    // key, so this exercises the BYOK-lead copy fork).
    await expect(tryIt).not.toContainText(/run Harbour for/i);
    await expect(tryIt).not.toContainText(/must pay/i);
  });

  test('observation glimpse renders run-status pills of real surfaces', async ({ page }) => {
    await page.goto('/');
    const obs = page.locator('[data-testid="landing-observation"]');
    // Illustrative session feed: running / done / queued run-status pills.
    await expect(obs.locator('.status-pill--running')).toBeVisible();
    await expect(obs.locator('.status-pill--done')).toBeVisible();
    await expect(obs.locator('.status-pill--queued')).toBeVisible();
    // Per-run progress track is present.
    await expect(obs.locator('.lx-run').first()).toBeVisible();
  });

  test('Harbour OS is a distinct bottom section linking os.harbour.cat', async ({ page }) => {
    await page.goto('/');
    const os = page.locator('[data-testid="landing-os"]');
    await expect(os).toBeVisible();
    await expect(os.locator('.lx-section__title')).toHaveText('Harbour OS');
    const osLink = os.locator('a[href="https://os.harbour.cat"]');
    await expect(osLink).toBeVisible();
  });

  test('footer shows cross-view navigation and the GitHub link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.page-footer')).toBeVisible();
    // projects is the current landing view — bold, not a link.
    await expect(page.locator('.footer-actions strong.footer-current')).toHaveText('projects');
    await expect(page.locator('.footer-actions a[href="/swipe"]')).toBeVisible();
    await expect(page.locator('.footer-actions a[href="/swim"]')).toBeVisible();
    const footerLink = page.locator('.footer-link');
    await expect(footerLink.first()).toBeVisible();
    await expect(footerLink.first()).toHaveAttribute('href', 'https://github.com/JKershaw/LinearViewer');
  });

  test('hero sign-in CTA is a directly reachable link', async ({ page }) => {
    await page.goto('/');
    const linearCta = page.locator('[data-testid="landing-cta-linear"]');
    await expect(linearCta).toBeVisible();
    await expect(linearCta).toHaveAttribute('href', '/auth/linear');
    await linearCta.focus();
    await expect(linearCta).toBeFocused();
  });

  test('does not show a logout link (unauthenticated)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.logout')).not.toBeVisible();
  });
});

// The landing is dark-safe: it responds to the OS colour scheme via the
// `@media (prefers-color-scheme: dark) body.is-landing` token remap. This guards
// the LIN-980 regression where the semantic layer (--text/--card …) was not
// re-bound for the landing's dark path, leaving section titles near-black on a
// dark background. We assert the section heading text is LIGHT under dark.
test.describe('Landing Page (dark scheme)', () => {
  test.use({ colorScheme: 'dark' });

  test('section titles remain light on the dark background', async ({ page }) => {
    await page.goto('/');
    // landing-try (LIN-1161) introduces its own text-on-surface pairing
    // (the --green-dim eyebrow), so it is checked alongside landing-loop.
    for (const id of ['landing-loop', 'landing-try']) {
      const title = page.locator(`[data-testid="${id}"] .lx-section__title`);
      await expect(title).toBeVisible();
      const luminance = await title.evaluate((el) => {
        const m = getComputedStyle(el).color.match(/\d+/g).map(Number);
        // Rec. 601 luma — high ⇒ light text (readable on dark).
        return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
      });
      expect(luminance).toBeGreaterThan(160);
    }
  });
});
