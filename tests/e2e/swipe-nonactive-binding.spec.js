import { test, expect } from '../fixtures/test-base.js';
import { defaultJiraSeed, JIRA_SITE } from '../fixtures/jira-harness.js';

// LIN-2046 — the acceptance witness for the swipe / flight-companion recap,
// brief, and recommend surfaces: a Jira row on a merged multi-binding
// workspace (local active, Jira secondary — same fixture shape as the
// LIN-1903/1904/1910 dashboard specs in detail-nonactive-binding.spec.js).
//
// Unlike that spec, this one asserts at the NETWORK layer, not the content
// layer, and deliberately so. AI responses on the swipe page are mocked, and
// `shouldMockAi` (routes/workspace-api.js) re-gates onto the workspace's
// ACTIVE provider (see the comment at tests/e2e/swipe.spec.js:4-6) — so
// mocked recap/brief/recommend content renders identically whether the
// request actually resolved against the Jira binding or silently fell
// through to the active local one. A content-layer assertion would pass even
// if the bug this ticket fixes were still present. So instead: intercept the
// real requests fired when opening the recap, brief, and prompts accordions
// on the Jira-sourced card, and assert each request URL carries
// `source=jira` — positive proof of foreign-source grounding, not merely the
// absence of a 500.
//
// Composes the existing fixture seams with no new test-route code, same as
// detail-nonactive-binding.spec.js: POST /test/set-jira-session configures
// the Jira singleton's fake client (a process-level side effect that
// survives the next seed call), then seedLocal's POST /test/set-local-session
// establishes the active `local` session with the Jira binding riding along
// as `extraBindings`.

test.describe('Swipe recap / brief / recommend on a non-active (Jira) binding (LIN-2046)', () => {
  async function seedAndGoto(page, seedLocal, identifier) {
    await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    const { urlKey } = await seedLocal(null, {
      openRouterConnected: true, // hasAI, so the __ai__ (AI Recommend) button renders
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });
    // The swipe route accepts an optional deep-link identifier
    // (/workspace/:urlKey/swipe/:identifier?) and navigates straight to that
    // card on load (public/swipe.js's navigateToIdentifier) — no need to
    // page through the deck to reach a specific row.
    await page.goto(`/workspace/${urlKey}/swipe/${identifier}`);
    await page.waitForLoadState('networkidle');
    return urlKey;
  }

  test('recap and brief requests for a Jira row carry source=jira, not the active binding\'s', async ({ page, seedLocal }) => {
    // ENG-2 ("Jira task in progress") — same row LIN-1910's dashboard spec
    // uses for recap/brief (description + comment + open subtask).
    await seedAndGoto(page, seedLocal, 'ENG-2');
    await expect(page.locator('.swipe-card-title')).toContainText('Jira task in progress');

    const [recapReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/recap/ENG-2')),
      page.locator('.swipe-accordion-header[data-accordion="recap"]').first().click(),
    ]);
    expect(recapReq.url()).toContain('source=jira');

    const [briefReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/brief/ENG-2')),
      page.locator('.swipe-accordion-header[data-accordion="brief"]').first().click(),
    ]);
    expect(briefReq.url()).toContain('source=jira');
  });

  test('the AI Recommend request for a Jira row carries source=jira, not the active binding\'s', async ({ page, seedLocal }) => {
    // ENG-1 ("Jira task to do") — a genuine leaf, same row LIN-1910's
    // dashboard spec uses for the recommend surface, so recommend resolves
    // in one hop.
    await seedAndGoto(page, seedLocal, 'ENG-1');
    await expect(page.locator('.swipe-card-title')).toContainText('Jira task to do');

    await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().click();

    const [recommendReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/recommend/') && req.url().includes('/stream')),
      page.locator('[data-prompt="__ai__"]').first().click(),
    ]);
    expect(recommendReq.url()).toContain('source=jira');
  });

  // Regression control: the ACTIVE (local) binding's own row still resolves
  // with ITS OWN source (local), never jira — proof the fix did not make
  // every swipe row resolve through Jira regardless of which binding it
  // actually belongs to.
  test('regression control: a local-active row\'s recap request carries source=local, not jira', async ({ page, seedLocal }) => {
    await seedAndGoto(page, seedLocal, 'LOCAL-1');
    await expect(page.locator('.swipe-card-title')).toContainText('Local parent task');

    const [recapReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/recap/LOCAL-1')),
      page.locator('.swipe-accordion-header[data-accordion="recap"]').first().click(),
    ]);
    expect(recapReq.url()).toContain('source=local');
    expect(recapReq.url()).not.toContain('source=jira');
  });
});
