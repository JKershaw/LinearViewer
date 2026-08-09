import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// Periodicals feature (LIN-341): a synthetic, workspace-flag-gated group on the
// main workspace view containing the periodical template rows. The LIN-354 set
// is Documentation Review, Test Coverage Gap Review, Security Review, API
// Quality Review, and Code Quality Review. This spec keys only on the
// Documentation Review row and never asserts a total row count, so it is
// agnostic to the rest of the registry.

// Local-provider workspace seeded via /test/set-local-session (LIN-410). The
// Periodicals group is injected in buildDashboardData purely from the
// workspace-scoped `periodicals` flag, independent of which provider supplies
// the real issues/projects — so the local provider fully backs this surface.
// The `periodicals` flag is WORKSPACE-scoped (read from workspacePreferencesStore
// by urlKey), NOT a session feature — so it must be set through the
// workspace-feature route targeting THIS workspace's partition, not via
// seedLocal's session `features`. The urlKey must be threaded on both
// set and reset, or the flag lands on (or leaks into) the wrong partition.
async function setPeriodicalsFlag(page, urlKey, enabled) {
  const res = await page.goto(
    `/test/set-workspace-feature?key=periodicals&value=${enabled}&urlKey=${urlKey}`
  );
  expect(res.ok()).toBeTruthy();
}

test.describe('Periodicals group', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    // Isolate the dispatch queue so the queue-the-periodical test stays
    // deterministic against other specs sharing the local-workspace partition.
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
  });

  test.afterEach(async ({ page, localWorkerUrlKey }) => {
    // Reset so the flag never leaks into other specs sharing the store.
    await setPeriodicalsFlag(page, localWorkerUrlKey, false);
  });

  test('flag OFF: no Periodicals group, behaviour unchanged', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, false);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-project-type="periodicals"]')).toHaveCount(0);
    await expect(page.locator('.line:has-text("Documentation Review")')).toHaveCount(0);

    // Real projects still render (sanity: unchanged behaviour).
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible();
  });

  test('flag ON: distinct Periodicals group with a dispatchable Documentation Review row', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    await expect(group).toBeVisible();
    await expect(group.locator('.project-header:has-text("Periodicals")')).toBeVisible();

    // The single Documentation Review row.
    const row = group.locator('.line:has-text("Documentation Review")');
    await expect(row).toHaveCount(1);

    // Distinct colour hook resolves to the purple accent.
    const headerColor = await group.locator('.project-header').evaluate(
      el => getComputedStyle(el).color
    );
    // --purple: #7c3aed → rgb(124, 58, 237)
    expect(headerColor).toBe('rgb(124, 58, 237)');

    // Row is dispatchable: expand it and confirm its dispatch container is tagged
    // kind=periodical (no Linear add-task link inside the synthetic group). Scope
    // the count to this row's node — the group now holds more than one periodical.
    await row.click();
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    await expect(docNode.locator('[data-kind="periodical"]')).toHaveCount(1);
    // LIN-1973 review F3: `[data-action="create-task"]` only exists on the
    // ui.write-only (e.g. Jira) branch of render.js's add-task link — under
    // this spec's Local provider (ui.inlineCreate: true), that selector is
    // never emitted for ANY real project either, so the old assertion was
    // vacuous (it would pass even if the group wrongly rendered the create
    // affordance). Both branches always share the `.add-task-link` wrapper
    // class (`data-testid="create-task"` on the inlineCreate branch, bare on
    // the write-only branch) — assert on that shared wrapper so the guard
    // actually distinguishes "no create affordance" from "no create affordance
    // of this one specific shape".
    await expect(group.locator('.add-task-link')).toHaveCount(0);
    await expect(group.locator('[data-testid="create-task"]')).toHaveCount(0);
  });

  // LIN-345: the periodical row is issueless (no Linear issue backing it), so the
  // shared dispatch handler must opt out of the issue-link contract. Before the
  // fix, clicking dispatch threw `dispatchPrompt: issue with id and identifier is
  // required` (common.js) because the handler always built an `issue` object with
  // null fields and never passed `issueless: true`. The earlier test only asserts
  // the row *renders* a dispatch container — it never clicks dispatch, which is
  // why this regression slipped through. This test drives the real click path.
  test('flag ON: clicking dispatch on a Periodical actually queues it', async ({ page, localWorkerUrlKey }) => {
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    // Scope to this row's node — the group now holds more than one periodical,
    // so group-wide locators for the disclosure/dispatch button are ambiguous.
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    const row = docNode.locator('.line:has-text("Documentation Review")');
    await row.click();

    // Open the dispatch disclosure, then dispatch to the cli target.
    await docNode.locator('.dispatch-disclosure').click();
    const dispatchBtn = docNode.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // The button reaches the success state (it showed "failed" before the fix).
    await expect(dispatchBtn).toHaveText('dispatched!');

    // The item lands on the workspace queue, issueless, tagged kind=periodical.
    const listResponse = await page.request.get(`/workspace/${localWorkerUrlKey}/api/dispatch`);
    const { items } = await listResponse.json();
    const periodicalItem = items.find(i => i.kind === 'periodical');
    expect(periodicalItem).toBeDefined();
    expect(periodicalItem.promptName).toBe('Documentation Review');
    expect(periodicalItem.issueIdentifier ?? null).toBeNull();
    // LIN-1825: the periodical-template join key rode the container's
    // data-periodical-id all the way through render -> app.js -> common.js ->
    // route -> addItem -> _formatItem, proven here through the exact read path
    // (GET .../api/dispatch returns listItems() verbatim).
    expect(periodicalItem.periodicalId).toBe('documentation-review');
  });

  // LIN-1279: the "Mint + Autopilot" action is a SECOND dispatch container on each
  // periodical row, gated behind BOTH the `periodicals` workspace flag (already
  // required for the group to render) AND the per-user `proxy` flag (its tail calls
  // the workspace-API kickoff endpoint, so it needs a proxy token). It must show
  // ONLY when both are on.
  test('proxy flag OFF: periodical row shows plain Mint only, no Mint + Autopilot', async ({ page, localWorkerUrlKey }) => {
    // beforeEach seeded the session WITHOUT the proxy feature.
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    await docNode.locator('.line:has-text("Documentation Review")').click();

    // Exactly one dispatch container (plain Mint); no proxy-forced autopilot variant.
    await expect(docNode.locator('[data-kind="periodical"]')).toHaveCount(1);
    await expect(docNode.locator('[data-proxy-force="true"]')).toHaveCount(0);
  });

  test('proxy flag ON: periodical row also shows a proxy-forced Mint + Autopilot', async ({ page, seedLocal, localWorkerUrlKey }) => {
    // Re-establish the session with the per-user proxy feature enabled.
    await seedLocal(workspaceApiLocalSeed, { features: { proxy: true } });
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    await docNode.locator('.line:has-text("Documentation Review")').click();

    // Two dispatch containers now: plain Mint + the Mint + Autopilot variant.
    await expect(docNode.locator('[data-kind="periodical"]')).toHaveCount(2);
    // The variant forces proxy context on and is labelled "+ Autopilot".
    const variant = docNode.locator('[data-proxy-force="true"]');
    await expect(variant).toHaveCount(1);
    await expect(variant.locator('.prompt-name')).toHaveText('Documentation Review + Autopilot');
    // Its prompt carries the kickoff-endpoint handoff tail.
    await expect(variant.locator('.prompt-text')).toContainText('/api/proxy/autopilot/kickoff');
  });

  test('proxy flag ON: dispatching Mint + Autopilot queues the variant prompt with proxy attached', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { features: { proxy: true } });
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
    await setPeriodicalsFlag(page, localWorkerUrlKey, true);
    await page.goto(`/workspace/${localWorkerUrlKey}/`);
    await page.waitForLoadState('networkidle');

    const group = page.locator('[data-project-type="periodicals"]');
    const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
    await docNode.locator('.line:has-text("Documentation Review")').click();

    // Drive the VARIANT container's dispatch (the proxy-forced one), to the cli target.
    const variant = docNode.locator('[data-proxy-force="true"]');
    await variant.locator('.dispatch-disclosure').click();
    const dispatchBtn = variant.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();

    // Reaching 'dispatched!' is itself the proxy proof: proxyForce sends attachProxy,
    // and a failed server-side mint/attach would 503 → 'failed'. So success means the
    // workspace-API bootstrap was minted and the proxy context attached.
    await expect(dispatchBtn).toHaveText('dispatched!');

    // The queued item is the AUTOPILOT variant (its prompt carries the kickoff tail),
    // still issueless + kind=periodical.
    const { items } = await (await page.request.get(`/workspace/${localWorkerUrlKey}/api/dispatch`)).json();
    const item = items.find(i => i.kind === 'periodical');
    expect(item).toBeDefined();
    expect(item.promptName).toBe('Documentation Review + Autopilot');
    expect(item.issueIdentifier ?? null).toBeNull();
    expect(item.prompt).toContain('/api/proxy/autopilot/kickoff');
    expect(item.prompt).toContain('issueIdentifier');
    // LIN-1825: same join key as the plain-Mint variant — both mint from the
    // SAME template, and the id must not drift with the "+ Autopilot" title
    // suffix (that promptName drift is exactly what this id replaces).
    expect(item.periodicalId).toBe('documentation-review');
  });
});
