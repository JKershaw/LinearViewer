import { test, expect } from '../fixtures/test-base.js';
import { defaultJiraSeed, JIRA_SITE } from '../fixtures/jira-harness.js';

// LIN-1903 — the acceptance witness the ticket's research called for: a
// multi-binding workspace where the issue under test belongs to the
// NON-active binding. `tests/e2e/jira-provider.spec.js`'s existing detail
// click-through is insufficient by itself — it seeds Jira as the sole,
// ACTIVE binding, the one shape that never hits the bug (a single-binding
// workspace always resolves the right provider). Here Jira is a SECOND,
// non-active binding alongside the active `local` one, so the merged
// dashboard tree (LIN-544) contains a Jira-sourced row whose id-only
// `/api/detail` drill-down previously fell through to the active `local`
// provider and 404'd.
//
// Composes two existing test seams with no new test-route code: POST
// /test/set-jira-session configures the Jira singleton's fake client (a
// process-level side effect that survives the next seed call), then
// seedLocal's POST /test/set-local-session establishes the active `local`
// session with the Jira binding riding along as `extraBindings`.

test.describe('Detail drill-down on a non-active binding (LIN-1903)', () => {
  test('a foreign-source (Jira) row on a merged multi-binding workspace opens ITS OWN detail, not the active provider\'s', async ({ page, seedLocal }) => {
    const jiraResp = await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    expect(jiraResp.ok()).toBeTruthy();

    const { dashboard } = await seedLocal(null, {
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    // The merged tree renders the Jira row with its own source badge — proof
    // it came from the fan-out (LIN-544), not the active local provider.
    // `.line` and its lazy `.details` block are SIBLINGS under one `.node`
    // wrapper (lib/render.js), so detail assertions scope through the node,
    // not the `.line` itself.
    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task to do")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();
    await expect(jiraRow.locator('[data-testid="issue-source"]')).toHaveText('jira');

    // Expand it — the lazy /api/detail fetch this ticket fixes. Pre-fix, this
    // request carried no provenance and fell through to the ACTIVE (local)
    // provider with the LOCAL scope, so a Jira-shaped id 404'd there instead
    // of ever reaching the Jira client.
    await jiraRow.click();

    // Positive proof the rendered detail is sourced from the JIRA binding:
    // the provider-aware link label and the ADF→Markdown-converted body.
    await expect(jiraNode.locator('.detail-link', { hasText: 'View in Jira' }).first()).toBeAttached();
    await expect(jiraNode.locator('.detail-link', { hasText: 'View in Linear' })).toHaveCount(0);
    await jiraNode.locator('[data-toggle="details"]').first().click();
    await expect(jiraNode.locator('.detail-content[data-content="details"]', { hasText: 'A todo Jira issue.' }).first()).toBeAttached();
  });

  test('regression control: the ACTIVE (local) binding\'s own rows are unaffected on the same multi-binding workspace', async ({ page, seedLocal }) => {
    await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    const { dashboard } = await seedLocal(null, {
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    const localRow = page.locator('.line:has-text("Local parent task")').first();
    await expect(localRow).toBeAttached();
    await expect(localRow.locator('[data-testid="issue-source"]')).toHaveText('local');

    await localRow.click();
    await expect(page.locator('body')).toContainText('Seeded parent');
  });
});
