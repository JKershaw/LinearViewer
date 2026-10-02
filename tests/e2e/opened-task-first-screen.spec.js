import { test, expect } from '../fixtures/test-base.js';
import { seedGitHubWorkspace, GITHUB_WORKSPACE_URL_KEY } from '../fixtures/github-harness.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// =============================================================================
// LIN-2944 — The first screen: the opened task, shared by Home and Swipe.
//
// PHASE 0 ONLY. This file carries the Swipe-reachable witness subset:
//   * the top task and (where a ranking reason exists) its one-line why;
//   * the ✦ next-step primary action (the "Go" of docs/v1.md step 4);
//   * the tailored prompt with reasoning visible, not collapsed (reversing LIN-70);
//   * the ladder (copy → run-this-step → run-whole-task) with not-yet-enabled
//     rungs shown as "○ set up ›", never hidden;
//   * templates under "other prompts";
//   * addendum 5's per-state negatives (no /api/recommend/* request when the AI
//     is off by choice, unconfigured, or free-tier-exhausted).
//
// It is RED-FIRST: authored against `50588aef` (pre-P0), where none of the new
// DOM exists. P0's commits make it green. Home-path assertions arrive in P1, the
// Brief/Recap no-spend block in P2, and the proxy-default/R2-5 block in P3 —
// each in its own `test.describe` block, per the plan.
//
// DOM CONTRACT this spec pins (the P0 implementation must emit these hooks):
//   .prompt-section                                  the shared opened-task component
//   [data-testid="opened-task-why"]                  one-line why (buildWhy reasons)
//   [data-testid="opened-task-go"]                   ✦ next-step primary action
//   [data-testid="opened-task-primary-reason"]       plain-words reason when disabled
//   [data-testid="opened-task-reasoning"]            reasoning, VISIBLE by default
//   [data-testid="opened-task-ladder"]               the copy → run-step → run-task ladder
//   [data-testid="opened-task-ladder"] [data-rung="run-step"]
//   [data-testid="opened-task-ladder"] [data-rung="run-task"]
//   [data-testid="other-prompts"]                    templates under "other prompts"
//
// NOTE ON THE GITHUB WHY (settled in P0 beat 2, corrected): GitHub REST returns
// no priority and no typed relations, so `buildWhy()` is STRUCTURALLY empty for
// a GitHub-shaped issue. That is a real product fact, not a seed accident: on a
// real GitHub workspace the opened task shows NO one-line why because the source
// carries nothing `buildWhy()` reads. The GitHub-connected case therefore
// asserts that honest behaviour EXPLICITLY (no why line), and the local-connected
// case remains the positive why witness. No production code path is reachable
// only from a fixture.

// Any request that would SPEND AI on the recommend path (the `/status` probe is
// not a spend and is excluded).
function isRecommendSpend(url) {
  try {
    const p = new URL(url).pathname;
    return p.includes('/api/recommend/') && !p.endsWith('/api/recommend/status');
  } catch {
    return false;
  }
}

/** Attach a listener and return the (live) array of recommend-spend request URLs. */
function recommendSpy(page) {
  const seen = [];
  page.on('request', (req) => { if (isRecommendSpend(req.url())) seen.push(req.url()); });
  return seen;
}

async function openPrompts(page) {
  await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().click();
  await expect(page.locator('.prompt-section').first()).toBeVisible();
}

/** Deterministic tailored-prompt SSE the GitHub case stubs in. */
const REASONING_TEXT = 'This is the highest-value open task.';
const PROMPT_TEXT = '## Next step\n\nDo the thing.';
const SSE_BODY = [
  { phase: 'reasoning' },
  { section: 'reasoning', content: REASONING_TEXT },
  { phase: 'prompt' },
  { section: 'prompt', content: PROMPT_TEXT },
  '[DONE]',
]
  .map((f) => (typeof f === 'string' ? `data: ${f}\n\n` : `data: ${JSON.stringify(f)}\n\n`))
  .join('');

/** The P0 assertions both connected cases share once the component is mounted. */
async function assertOpenedTaskShell(page) {
  const component = page.locator('.prompt-section').first();

  // The ladder is present with its not-yet-enabled rungs SHOWN as "○ set up ›".
  const ladder = component.locator('[data-testid="opened-task-ladder"]');
  await expect(ladder).toBeVisible();
  await expect(ladder.locator('[data-rung="run-step"]')).toBeVisible();
  await expect(ladder.locator('[data-rung="run-step"]')).toContainText(/set up/i);
  await expect(ladder.locator('[data-rung="run-task"]')).toBeVisible();
  await expect(ladder.locator('[data-rung="run-task"]')).toContainText(/set up/i);

  // Templates live under "other prompts", not as the primary action.
  await expect(component.locator('[data-testid="other-prompts"]')).toBeVisible();

  // The primary action is the ✦ next step.
  const go = component.locator('[data-testid="opened-task-go"]');
  await expect(go).toBeVisible();
  await expect(go).toContainText(/next step/i);
  await expect(go).toBeEnabled();

  return { component, go };
}

test.describe('LIN-2944 P0 — the opened task on Swipe', () => {
  // ---------------------------------------------------------------------------
  // GitHub-connected (the sign-in/connect case). `seedGitHubWorkspace` does not
  // provision an OpenRouter key, so the session is given one first via the
  // established /test/set-session seam; set-github-session then replaces the
  // active workspace without clearing that key (it never touches
  // session.openRouterApiKey). The recommend stream is stubbed — no real spend.
  //
  // GAP-2 SETTLEMENT: this seam is ACCEPTED, not worked around. Per CLAUDE.md the
  // provider SEEDING seam (github-harness.js) owns provider data and the
  // SESSION seam (helpers.js / /test/set-session) owns session facts; an
  // OpenRouter credential is a session fact, not GitHub provider data, so it
  // belongs here rather than in `seedGitHubWorkspace`.
  // ---------------------------------------------------------------------------
  test.describe('GitHub-connected', () => {
    test('top task, Go, tailored prompt with visible reasoning, ladder, other prompts', async ({ page }) => {
      const seen = recommendSpy(page);
      // The stream URL carries `?source=github` (LIN-2046 threads provenance),
      // so the glob must allow a query suffix or the stub never intercepts.
      await page.route('**/api/recommend/*/stream*', (route) =>
        route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY })
      );

      await page.goto('/test/set-session?openRouterConnected=true');
      await seedGitHubWorkspace(page);

      await page.goto(`/workspace/${GITHUB_WORKSPACE_URL_KEY}/swipe`);
      await page.waitForLoadState('networkidle');

      // Their own backlog, and the task Harbour would take first.
      await expect(page.locator('.swipe-card-title')).toHaveText('GitHub open task');

      await openPrompts(page);

      // Nothing spends AI before the explicit click.
      expect(seen).toEqual([]);

      const { component, go } = await assertOpenedTaskShell(page);

      // Honest behaviour for an empty buildWhy(): GitHub issues carry no priority
      // or relations, so there is no ranking reason to advertise and the
      // component renders NO why line (it never invents one). Asserted
      // explicitly, not by omission.
      await expect(component.locator('[data-testid="opened-task-why"]')).toHaveCount(0);

      await go.click();

      // The tailored prompt, with its reasoning VISIBLE (never collapsed).
      await expect(component.locator('[data-prompt-body]')).toContainText('Next step');
      const reasoning = component.locator('[data-testid="opened-task-reasoning"]');
      await expect(reasoning).toBeVisible();
      await expect(reasoning).not.toHaveClass(/hidden/);
      await expect(reasoning).toContainText(REASONING_TEXT);

      // The click is what spends.
      expect(seen.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Local-connected (the R2-5/no-spend case). The deterministic server-side mock
  // (`shouldMockAi`, routes/workspace-api.js) drives the stream — no route stub.
  // Top task for `workspaceApiLocalSeed` is TEST-13, a boostable bug, so its
  // one-line why is non-empty here.
  // ---------------------------------------------------------------------------
  test.describe('local-connected', () => {
    test('top task with its one-line why, Go, tailored prompt with visible reasoning', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const seen = recommendSpy(page);
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.swipe-card-identifier')).toHaveText('TEST-13');

      await openPrompts(page);
      expect(seen).toEqual([]);

      const { component, go } = await assertOpenedTaskShell(page);

      // The one-line why is visible and names the ranking reason (bug).
      const why = component.locator('[data-testid="opened-task-why"]');
      await expect(why).toBeVisible();
      await expect(why).toContainText(/bug/i);

      await go.click();

      await expect(component.locator('[data-prompt-body]')).toContainText('Help me with task TEST-13');
      const reasoning = component.locator('[data-testid="opened-task-reasoning"]');
      await expect(reasoning).toBeVisible();
      await expect(reasoning).not.toHaveClass(/hidden/);
      await expect(reasoning).toContainText(/bug/i);

      expect(seen.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Addendum 5 — per-state negatives: the primary renders DISABLED with its
  // plain-words reason, and clicking it issues NO recommend request.
  // ---------------------------------------------------------------------------
  test.describe('per-state negatives', () => {
    async function clickDisabledWithoutSpend(page, component) {
      const go = component.locator('[data-testid="opened-task-go"]');
      await expect(go).toBeVisible();
      await expect(go).toBeDisabled();
      // A disabled control can't be actionably clicked; force it to prove that
      // even a synthetic click cannot fire the request.
      await go.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
    }

    test('AI off by choice: disabled primary with explanation, zero recommend requests', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const seen = recommendSpy(page);
      await seedLocal(workspaceApiLocalSeed, {
        openRouterConnected: true,
        features: { aiRecommendations: false },
      });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/suggestions are off/i);
      await clickDisabledWithoutSpend(page, component);
      expect(seen).toEqual([]);
    });

    test('AI unconfigured: disabled primary with "needs OpenRouter", zero recommend requests', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const seen = recommendSpy(page);
      await seedLocal(workspaceApiLocalSeed); // no key, no free tier
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/needs OpenRouter/i);
      await clickDisabledWithoutSpend(page, component);
      expect(seen).toEqual([]);
    });

    test('free-tier exhausted (429): disabled primary with quota message, zero recommend requests', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const seen = recommendSpy(page);
      await seedLocal(workspaceApiLocalSeed, { freeTierEnabled: true });
      // Pre-fill usage to the daily limit before loading the screen.
      await page.goto(`/test/add-free-tier-usage?count=5&urlKey=${localWorkerUrlKey}`);
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      await expect(component.locator('[data-testid="opened-task-primary-reason"]')).toContainText(/limit|quota/i);
      await clickDisabledWithoutSpend(page, component);
      expect(seen).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // P0 review fix-up (verdict d4b4adf7): F1 ladder ready state, F2 regenerate
  // gate, F4/M16 promptButtons. Each was observed failing against the unfixed
  // behaviour or an equivalent mutation (excerpts in the fix-up report).
  // ---------------------------------------------------------------------------
  test.describe('fix-up: ladder ready state, regenerate gate, promptButtons', () => {
    test('with dispatch enabled, "run this step" sends the dispatch request for the top task', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { dispatch: true } });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      // Get a prompt without AI spend (template) so the rung is enabled.
      await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn').first().click();
      await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

      const identifier = (await page.locator('.swipe-card-identifier').textContent()).trim();
      const [dispatchReq] = await Promise.all([
        page.waitForRequest((req) => req.url().includes('/api/dispatch') && req.method() === 'POST'),
        component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]').click(),
      ]);
      const body = dispatchReq.postDataJSON();
      expect(body.issueIdentifier).toBe(identifier);
      expect(body.target).toBe('cli');
      expect(body.prompt).toBeTruthy();
      // LIN-3211: the rung sends the card panel's harness (claude-code by
      // default), so the item carries the structured bootstrapToken rather than
      // a token in prompt prose. HEAD sent none (the rung sits outside the panel).
      expect(body.harness).toBe('claude-code');
    });

    test('a remembered AI prompt disables regenerate and spends nothing when AI is off', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const seen = recommendSpy(page);
      // 1. AI on: generate and persist a tailored prompt for the top card.
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);
      await page.locator('.prompt-section').first().locator('[data-testid="opened-task-go"]').click();
      await expect(page.locator('.prompt-section').first().locator('[data-testid="opened-task-reasoning"]')).toBeVisible({ timeout: 10000 });
      const spent = seen.length;
      expect(spent).toBeGreaterThan(0);

      // 2. Re-seed with AI off by choice and reload; the card hydrates from memory.
      await seedLocal(workspaceApiLocalSeed, { features: { aiRecommendations: false } });
      await page.reload();
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      await expect(component).toHaveAttribute('data-phase', 'fresh');
      const regenerate = component.locator('.opened-task-regenerate');
      await expect(regenerate).toBeVisible();
      await expect(regenerate).toBeDisabled();
      await regenerate.click({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
      expect(seen.length).toBe(spent);
    });

    test('promptButtons=false hides "other prompts" while the AI primary stays', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { promptButtons: false } });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      await expect(component.locator('[data-testid="other-prompts"]')).toHaveCount(0);
      await expect(component.locator('[data-testid="opened-task-go"]')).toBeVisible();
    });

    // N1: a `○ set up ›` rung in the FRESH state must say what it needs (the
    // set-up notice was only rendered in idle). Default flags leave both rungs
    // in set-up state, and fresh is where a remembered prompt restores.
    test('a set-up rung pressed in the fresh state says what it needs (N1)', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      // Get a prompt without AI spend so we are in the fresh state.
      await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn').first().click();
      await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });

      const notice = component.locator('.opened-task-setup-notice');
      await expect(notice).toHaveCount(0);
      await component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]').click();
      await expect(notice).toContainText(/dispatch runner set up/i);
      await expect(component).toHaveAttribute('data-phase', 'fresh');
    });

    // N2: with dispatch ENABLED, the idle run-step must STAY a set-up rung
    // (kills mutant R7, which enabled it before a prompt exists — a dead
    // control that silently did nothing because handleDispatch has no raw).
    test('with dispatch enabled, the rendered idle run-step stays a set-up rung (N2)', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { dispatch: true } });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      const rung = component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]');
      await expect(rung).toHaveAttribute('data-action', 'setup');
      await expect(rung).toContainText(/set up/i);

      await rung.click();
      await expect(component.locator('.opened-task-setup-notice')).toContainText(/generate a prompt first/i);
    });

    // N3 (class closure): a notice raised in idle must not survive into fresh,
    // and must never sit beside an ENABLED run-step.
    test('an idle setup notice is cleared once a prompt lands, with dispatch enabled (N3)', async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { dispatch: true } });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      const component = page.locator('.prompt-section').first();
      const notice = component.locator('.opened-task-setup-notice');

      // Idle: press the run-step set-up rung; it says a prompt is needed.
      await component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]').click();
      await expect(notice).toContainText(/generate a prompt first/i);

      // Pick a template -> fresh, run-step becomes enabled.
      await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn').first().click();
      await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
      await expect(component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]')).toHaveAttribute('data-action', 'run-step');
      await expect(notice).toHaveCount(0);
    });

    // N4/T1 (verdict a1f95b25): a ladder rung pressed while the ✦ stream is in
    // flight must not wipe the streamed reasoning, and must never say "generate
    // a prompt first" under a prompt that is generating. A notice raised
    // mid-stream (the proxy set-up rung) is cleared once the stream settles.
    test('a ladder rung pressed mid-stream keeps the streamed reasoning; settle clears the notice (N4/T1)', async ({ page, seedLocal, localWorkerUrlKey }) => {
      const STREAMED_REASONING = 'Reasoning about the task in several words.';
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, features: { dispatch: true } });
      await page.goto(`/workspace/${localWorkerUrlKey}/swipe`);
      await page.waitForLoadState('networkidle');
      await openPrompts(page);

      // Gate the shared SSE reader: emit the reasoning, then hold until released.
      await page.evaluate((reasoning) => {
        let release;
        const gate = new Promise((r) => { release = r; });
        window.__releaseStream = () => release();
        window.readSSEStream = async (response, onEvent) => {
          if (response.body) response.body.cancel().catch(() => {});
          onEvent('message', { phase: 'reasoning' });
          onEvent('message', { section: 'reasoning', content: `${reasoning}\n` });
          await gate;
          onEvent('message', { phase: 'prompt' });
          onEvent('message', { section: 'prompt', content: '## Next step\n\nDo the thing.' });
        };
      }, STREAMED_REASONING);

      const component = page.locator('.prompt-section').first();
      const ladder = component.locator('[data-testid="opened-task-ladder"]');
      const body = component.locator('[data-prompt-body]');
      const notice = component.locator('.opened-task-setup-notice');

      await component.locator('[data-testid="opened-task-go"]').click();
      await expect(component).toHaveClass(/streaming/);
      await expect(body).toContainText(STREAMED_REASONING);

      // run this step needs a prompt; one is generating, so the press is inert.
      await ladder.locator('[data-rung="run-step"]').click({ force: true });
      await expect(body).toContainText(STREAMED_REASONING);
      await expect(component.getByText(/generate a prompt first/i)).toHaveCount(0);

      // run the whole task needs the proxy: its notice shows, the body is kept.
      await ladder.locator('[data-rung="run-task"]').click();
      await expect(notice).toContainText(/proxy set up/i);
      await expect(body).toContainText(STREAMED_REASONING);

      await page.evaluate(() => window.__releaseStream());
      await expect(component).not.toHaveClass(/streaming/);
      await expect(body).toContainText('Do the thing');
      await expect(notice).toHaveCount(0);
      await expect(ladder.locator('[data-rung="run-step"]')).toHaveAttribute('data-action', 'run-step');
    });
  });
});
// =============================================================================
// LIN-2942 — the ladder records which way the task was taken.
//
// Each press on the opened task's ladder is recorded per account per task: a
// copy, a press on a "○ set up ›" rung (intent, with what it needs, and still no
// dispatch), and a run-step dispatch (recorded server-side, linked to the item
// by dispatchId). GET …/api/task-mode/:identifier reads it back for the session
// account. Red-first: authored before the client hooks existed.
// =============================================================================
test.describe('LIN-2942 — the ladder records its mode', () => {
  async function openTopTask(page, seedLocal, urlKey, options) {
    await seedLocal(workspaceApiLocalSeed, options);
    await page.goto(`/test/clear-task-mode-events?urlKey=${urlKey}`);
    await page.goto(`/workspace/${urlKey}/swipe`);
    await page.waitForLoadState('networkidle');
    await openPrompts(page);
    const identifier = (await page.locator('.swipe-card-identifier').textContent()).trim();
    return { component: page.locator('.prompt-section').first(), identifier };
  }

  async function pickTemplate(component) {
    await component.locator('[data-testid="other-prompts"] .swipe-prompt-btn').first().click();
    await expect(component).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
  }

  async function readMode(page, urlKey, identifier) {
    const res = await page.request.get(`/workspace/${urlKey}/api/task-mode/${encodeURIComponent(identifier)}`);
    expect(res.status()).toBe(200);
    return res.json();
  }

  /** Poll the mode until it holds `count` events (the client record is fire-and-forget). */
  async function modeWithEvents(page, urlKey, identifier, count) {
    let mode;
    await expect.poll(async () => {
      mode = await readMode(page, urlKey, identifier);
      return mode.events.length;
    }, { timeout: 5000 }).toBe(count);
    return mode;
  }

  test('(a) a copy records copy/copy', async ({ page, context, seedLocal, localWorkerUrlKey }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { component, identifier } = await openTopTask(page, seedLocal, localWorkerUrlKey, { openRouterConnected: true });
    await pickTemplate(component);

    await component.locator('[data-action="copy"]').first().click();
    await expect(component.locator('[data-action="copy"]').first()).toHaveText('copied!');

    const mode = await modeWithEvents(page, localWorkerUrlKey, identifier, 1);
    expect(mode.events[0]).toMatchObject({ rung: 'copy', act: 'copy', ready: true, needs: null, surface: 'swipe' });
  });

  test('(b) a press on a not-set-up run-step records ready:false, needs:dispatch, and sends no dispatch', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const dispatches = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/api/dispatch')) dispatches.push(req.url());
    });
    const { component, identifier } = await openTopTask(page, seedLocal, localWorkerUrlKey, { openRouterConnected: true });

    const rung = component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]');
    await expect(rung).toHaveAttribute('data-setup-needs', 'dispatch');
    await rung.click();
    await expect(component.locator('.opened-task-setup-notice')).toContainText(/dispatch runner set up/i);

    const mode = await modeWithEvents(page, localWorkerUrlKey, identifier, 1);
    expect(mode.events[0]).toMatchObject({ rung: 'run-step', ready: false, needs: 'dispatch', act: 'press', dispatchId: null });
    expect(dispatches).toEqual([]);
  });

  test('(c) a ready run-step records an event whose dispatchId is the created item', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const { component, identifier } = await openTopTask(page, seedLocal, localWorkerUrlKey, { openRouterConnected: true, features: { dispatch: true } });
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
    await page.request.get(`/test/clear-dispatch-history?urlKey=${localWorkerUrlKey}`);
    await pickTemplate(component);

    const [dispatchRes] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/api/dispatch')),
      component.locator('[data-testid="opened-task-ladder"] [data-rung="run-step"]').click(),
    ]);
    expect(dispatchRes.status()).toBe(201);
    expect(dispatchRes.request().postDataJSON().entryRung).toBe('run-step');
    const { item } = await dispatchRes.json();

    const mode = await modeWithEvents(page, localWorkerUrlKey, identifier, 1);
    expect(mode.events[0]).toMatchObject({ rung: 'run-step', ready: true, act: 'dispatch', dispatchId: item.id });
    expect(mode.taken).toMatchObject({ rung: 'run-step', dispatchId: item.id });
  });

  test('(d) GET returns the account\'s entry for the task', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const { component, identifier } = await openTopTask(page, seedLocal, localWorkerUrlKey, { openRouterConnected: true });

    // Entered on "run the whole task" (not set up), then fell back to copy.
    await component.locator('[data-testid="opened-task-ladder"] [data-rung="run-task"]').click();
    await modeWithEvents(page, localWorkerUrlKey, identifier, 1);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await pickTemplate(component);
    await component.locator('[data-action="copy"]').first().click();

    const mode = await modeWithEvents(page, localWorkerUrlKey, identifier, 2);
    expect(mode.entry).toMatchObject({ rung: 'run-task', ready: false });
    expect(mode.taken).toMatchObject({ rung: 'copy' });
    expect(mode.furthest).toBe('run-task');
    expect(mode.coverage).toEqual({ surfaces: ['swipe'] });

    // Another task has no mode for this account.
    const other = await readMode(page, localWorkerUrlKey, 'TEST-404');
    expect(other.entry).toBeNull();
  });
});
