import { test, expect } from '../fixtures/test-base.js';
import { defaultJiraSeed, JIRA_SITE } from '../fixtures/jira-harness.js';
import { defaultGitHubSeed, GITHUB_REPO } from '../fixtures/github-harness.js';

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

// LIN-1904 — the sibling routes LIN-1903 deliberately left unfixed: the exact
// same misroute affects /api/prompt, /api/comments, /api/autopilot-prompt and
// PATCH /api/issues (via task-edit) whenever the id belongs to a NON-active
// binding. Extends the multi-binding fixture above rather than replacing it —
// same workspace shape (local active + Jira secondary), different routes.
test.describe('Sibling id-scoped routes on a non-active (Jira) binding (LIN-1904)', () => {
  test('prompt and comments resolve through the JIRA binding, not the active local one', async ({ page, seedLocal }) => {
    await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    const { dashboard } = await seedLocal(null, {
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    // ENG-2 ("Jira task in progress") carries a comment in the fixture, unlike
    // ENG-1 — a genuine discriminator for the comments assertion below.
    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task in progress")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();

    // Expand the row first — this is the lazy /api/detail fetch (LIN-1903)
    // that populates the Details/Prompts toggles below; skipping it leaves
    // the fragment empty and every nested locator times out.
    await jiraRow.click();
    await jiraNode.locator('[data-toggle="details"]').first().click();

    // Prompt: click the always-visible "implementation" prompt button and
    // assert the generated prompt embeds the JIRA issue's own title — pre-fix,
    // this request carried no provenance and fetched the ACTIVE (local)
    // provider's issue context for this id, either 404ing or embedding the
    // wrong issue's title.
    await jiraNode.locator('[data-toggle="prompts"]').first().click();
    await jiraNode.locator('[data-label="implementation"]').first().click();
    await expect(jiraNode.locator('.prompt-text').first()).toContainText('Jira task in progress');

    // Comments: expand the nested Comments toggle and assert the JIRA
    // comment body is present — proof the fetch reached the Jira binding's
    // own fetchIssueComments, not local's (which has no knowledge of this id).
    await jiraNode.locator('[data-toggle="comments"]').first().click();
    await expect(jiraNode.locator('.comments-list')).toContainText('Investigating.');
  });

  // LIN-1886 (Phase 2) SUPERSEDES this test's original premise, and the change
  // is deliberate. It used to assert "no Edit link renders for the Jira row —
  // Jira has no updateIssue, so ui.inlineEdit is false for its OWN binding".
  // Phase 2 implements `updateIssue` on the Jira provider, so `ui.inlineEdit`
  // derives TRUE and the Edit link now correctly renders. Jira was simply
  // LIN-1904's handiest example of a read-only binding; the negative case it
  // illustrated is unchanged for any provider that really is read-only.
  //
  // Rather than delete the coverage, it is re-pointed at what this PR makes
  // true — and at the observable the LIN-1886 review's ledger item 4 named as
  // undischarged: "that the priority control's absence behaves correctly in a
  // browser. Route tests never execute public/task-edit.js." This is that
  // browser-level check, on the exact shape the F4 merge decision turns on: a
  // JIRA-bound row in a LOCAL-active workspace. Reading `ui` off the active
  // provider there would render a priority <select> Jira silently drops.
  test('the Jira row\'s Edit link resolves its OWN binding and the page hides the priority control (LIN-1886 D3, review ledger 4)', async ({ page, seedLocal }) => {
    await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    const { dashboard } = await seedLocal(null, {
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task to do")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();
    await jiraRow.click();
    await jiraNode.locator('[data-toggle="details"]').first().click();

    // The Details panel is populated (proves the fragment actually rendered,
    // not just an empty/failed fetch) and now carries an Edit affordance
    // stamped with the row's OWN provider.
    await expect(jiraNode.locator('.detail-content[data-content="details"]')).toContainText('A todo Jira issue.');
    const editLink = jiraNode.locator('[data-testid="issue-edit-link"]');
    await expect(editLink).toBeAttached();
    await expect(editLink).toHaveAttribute('href', /\/edit\?source=jira$/);

    await editLink.click();

    // Landed on the Jira binding's own task-edit page…
    await expect(page.locator('[data-testid="task-edit-title"]')).toHaveValue('Jira task to do');
    // …with NO priority control. Jira's priority is unmapped, so `ui.priority`
    // is false and rendering the <select> would invite a value the provider
    // silently drops (D3). The workspace's ACTIVE provider here is local,
    // whose `ui.priority` is not false — so this passes only because the page
    // reads `ui` off the per-binding provider, which is the merge resolution
    // routes/task-edit.js takes (LIN-1886 review F4 × LIN-1904).
    await expect(page.locator('[data-testid="task-edit-priority"]')).toHaveCount(0);
  });
});

// LIN-1904 — the write-path provenance chain (plan-review F3): a foreign row
// whose OWN binding DOES support inline edit (unlike Jira above) must render
// an Edit link carrying `?source=<provider>`, land on THAT binding's own
// task-edit page, and PATCH THAT binding on save — never the active one.
// GitHub is the secondary, write-capable binding here (local stays active).
test.describe('Edit-link → task-edit → PATCH provenance chain, foreign write-capable binding (LIN-1904)', () => {
  test('editing a GitHub-sourced row (non-active binding) writes to GitHub, not the active local workspace', async ({ page, seedLocal }) => {
    await page.request.post('/test/set-github-session', { data: defaultGitHubSeed });
    const { dashboard } = await seedLocal(null, {
      extraBindings: [
        { provider: 'github', scope: GITHUB_REPO, credentials: { token: 'github-install-token', installationId: '4242', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });

    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');

    const githubNode = page.locator('.node').filter({ has: page.locator('.line:has-text("GitHub open task")') }).first();
    const githubRow = githubNode.locator('.line').first();
    await expect(githubRow).toBeAttached();
    await expect(githubRow.locator('[data-testid="issue-source"]')).toHaveText('github');

    // Expand the row first — the lazy /api/detail fetch that populates the
    // Details toggle (and the Edit link inside it) below.
    await githubRow.click();
    await githubNode.locator('[data-toggle="details"]').first().click();

    // The Edit link carries `?source=github` — the row's OWN provider, not the
    // active local one — so the drill-down and its PATCH resolve the same
    // binding this row came from.
    const editLink = githubNode.locator('[data-testid="issue-edit-link"]');
    await expect(editLink).toBeAttached();
    await expect(editLink).toHaveAttribute('href', /\/edit\?source=github$/);

    await editLink.click();

    // Landed on the task-edit page rendering the GITHUB binding's OWN issue —
    // pre-fix this would have resolved via the ACTIVE (local) provider with a
    // GitHub-shaped id, 404ing (LocalStore has no record for GitHub's `1`).
    const titleInput = page.locator('[data-testid="task-edit-title"]');
    await expect(titleInput).toHaveValue('GitHub open task');

    const newTitle = 'GitHub open task — edited via non-active binding (LIN-1904)';
    await titleInput.fill(newTitle);
    await page.locator('[data-testid="task-edit-submit"]').click();

    // Save redirects back to the dashboard; the GitHub row now shows the
    // edited title — proof the PATCH landed on the GitHub binding's own issue,
    // not a wrong-target write against the active local workspace.
    await page.waitForURL(dashboard);
    await expect(page.locator(`.line:has-text("${newTitle}")`)).toBeAttached();
  });
});

// LIN-1910 — the acceptance witness for the four surfaces the ticket names:
// recap / brief / recommend / task-chat on a Jira row in a MERGED
// multi-binding workspace (local active, Jira secondary — same fixture shape
// as LIN-1903/1904 above). A real browser click-through, not a raw
// page.request call with a hand-built ?source= — that is what actually
// exercises the frontend `data-source` threading (lib/render.js → app.js →
// recap.js/brief.js/task-chat.js), not just the backend route. Every
// assertion is POSITIVE on Jira-grounded content (never merely "not a 500"),
// plus a negative control against the active local binding's own answer.
test.describe('Recap / Brief / Recommend / Task Chat on a non-active (Jira) binding (LIN-1910)', () => {
  // Shared seed: local active + Jira secondary (openRouterConnected so the AI
  // surfaces render; taskChat on so the Chat deep-link renders).
  async function seedAndGoto(page, seedLocal) {
    await page.request.post('/test/set-jira-session', { data: { seed: defaultJiraSeed } });
    const { dashboard } = await seedLocal(null, {
      openRouterConnected: true,
      features: { taskChat: true },
      extraBindings: [
        { provider: 'jira', scope: JIRA_SITE, credentials: { token: 'jira-api-token', email: 'ada@example.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    });
    await page.goto(dashboard);
    await page.waitForLoadState('networkidle');
  }

  test('recap and brief render Jira-grounded content for a Jira row, not the active binding\'s', async ({ page, seedLocal }) => {
    await seedAndGoto(page, seedLocal);

    // ENG-2 ("Jira task in progress") carries a description, a comment, and
    // one open subtask (ENG-4) — enough surface for both mock builders to
    // embed Jira-specific content, not generic filler.
    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task in progress")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();
    await jiraRow.click();
    await jiraNode.locator('[data-toggle="details"]').first().click();

    await jiraNode.locator('[data-toggle="brief"]').first().click();
    const brief = jiraNode.locator('[data-content="brief"] .brief-section');
    await expect(brief).toContainText('Jira task in progress', { timeout: 5000 });
    await expect(brief).toContainText('ENG-4', { timeout: 5000 });

    await jiraNode.locator('[data-toggle="recap"]').first().click();
    const recap = jiraNode.locator('[data-content="recap"] .recap-section');
    await expect(recap).toContainText('ENG-4', { timeout: 5000 });
  });

  test('AI suggest generates a Jira-grounded prompt for a Jira row, not the active binding\'s', async ({ page, seedLocal }) => {
    await seedAndGoto(page, seedLocal);

    // ENG-1 ("Jira task to do") is a genuine leaf — no children to descend
    // into — so the mock recommendation resolves in one hop with a prompt
    // embedding its OWN identifier.
    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task to do")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();
    await jiraRow.click();
    await jiraNode.locator('[data-toggle="prompts"]').first().click();

    await jiraNode.locator('.suggest-btn').click();
    const promptText = jiraNode.locator('.recommend-prompt .prompt-text');
    await expect(promptText).toContainText('ENG-1', { timeout: 5000 });
  });

  test('task chat, reached via the dashboard Chat deep-link, answers first-person as the Jira row', async ({ page, seedLocal }) => {
    await seedAndGoto(page, seedLocal);

    const jiraNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Jira task to do")') }).first();
    const jiraRow = jiraNode.locator('.line').first();
    await expect(jiraRow).toBeAttached();
    await jiraRow.click();
    await jiraNode.locator('[data-toggle="details"]').first().click();

    const chatLink = jiraNode.locator('[data-testid="issue-chat-link"]');
    await expect(chatLink).toHaveAttribute('href', /\/task-chat\?task=ENG-1&source=jira$/);
    await chatLink.click();
    await page.waitForLoadState('networkidle');

    // Pre-filled from the deep-link's ?task=&source= — the click-through
    // acceptance witness, not a hand-typed ?source= (see public/task-chat.js's
    // prefillTask/prefillSource hint).
    await expect(page.locator('#task-chat-id')).toHaveValue('ENG-1');

    await page.locator('#task-chat-question').fill('Where do you stand?');
    await page.locator('#task-chat-send').click();

    const answer = page.locator('.task-chat-msg-assistant .task-chat-msg-body');
    await expect(answer).toContainText('ENG-1', { timeout: 5000 });
    await expect(answer).toContainText('Jira task to do');
  });

  // Negative control: the ACTIVE (local) binding's own row still resolves its
  // own brief content — proof the fix did not make every row resolve through
  // Jira regardless of which binding it actually belongs to.
  test('regression control: a local-active row\'s brief is unaffected', async ({ page, seedLocal }) => {
    await seedAndGoto(page, seedLocal);

    const localNode = page.locator('.node').filter({ has: page.locator('.line:has-text("Local parent task")') }).first();
    const localRow = localNode.locator('.line').first();
    await expect(localRow).toBeAttached();
    await localRow.click();
    await localNode.locator('[data-toggle="details"]').first().click();
    await localNode.locator('[data-toggle="brief"]').first().click();

    const brief = localNode.locator('[data-content="brief"] .brief-section');
    await expect(brief).toContainText('Local parent task', { timeout: 5000 });
    await expect(brief).not.toContainText('Jira task');
  });
});
