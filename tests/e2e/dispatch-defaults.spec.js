/**
 * E2E tests for the Dispatch defaults settings UI + write path (LIN-1095).
 *
 * Proves the cross-module contract HTTP handler → WorkspacePreferencesStore →
 * settings render end-to-end: the new section is a sibling of the AI section
 * (not nested), the workspace-wide row and per-prompt-type override rows
 * persist independently via read-merge-write, and invalid fields are rejected
 * without clobbering the rest of workspace preferences (LIN-1094's
 * `dispatchDefaults` storage shape).
 */
import { test, expect } from '../fixtures/test-base.js';

test.describe('Dispatch defaults settings', () => {
  test.beforeEach(async ({ request, seedLocal, localWorkerUrlKey }) => {
    // Clean slate: delete the whole workspace-prefs doc (no modelId = delete).
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
    await seedLocal();
  });

  test.afterEach(async ({ request, localWorkerUrlKey }) => {
    await request.get(`/test/set-workspace-model?urlKey=${localWorkerUrlKey}`);
  });

  test('settings page shows the Dispatch defaults section as a sibling of AI, with a row per live prompt type', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const section = page.locator('[data-testid="settings-section-dispatch-defaults"]');
    await expect(section).toBeVisible();
    await expect(section.locator('.settings-header')).toHaveText('Dispatch defaults');

    // Sibling of the AI section, not nested inside it.
    const aiSection = page.locator('.settings-section', { has: page.locator('.settings-header:text-is("AI")') });
    await expect(aiSection.locator('[data-testid="settings-section-dispatch-defaults"]')).toHaveCount(0);

    // Workspace-wide row is visible up front; per-kind rows (bug is easy to
    // miss — LIN-1094/this ticket's own count correction — and close-out is
    // the newest kind) live behind the collapsed progressive-disclosure
    // toggle (LIN-1111), so expand it first.
    await expect(section.locator('[data-testid="dispatch-default-row-default"]')).toBeVisible();
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    await expect(section.locator('[data-testid="dispatch-default-row-bug"]')).toBeVisible();
    await expect(section.locator('[data-testid="dispatch-default-row-implementation"]')).toBeVisible();
    await expect(section.locator('[data-testid="dispatch-default-row-close-out"]')).toBeVisible();
    // autopilot is a configurable dispatch-default type too (LIN-1278).
    await expect(section.locator('[data-testid="dispatch-default-row-autopilot"]')).toBeVisible();
  });

  test('the per-kind rows are collapsed behind a closed toggle until expanded (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const details = page.locator('details.dispatch-kind-overrides');
    const bugRow = page.locator('[data-testid="dispatch-default-row-bug"]');
    await expect(details).not.toHaveJSProperty('open', true);
    await expect(bugRow).not.toBeVisible();

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    await expect(details).toHaveJSProperty('open', true);
    await expect(bugRow).toBeVisible();
  });

  test('model inputs offer recommended suggestions via the OpenCode and Claude datalists (LIN-1111 / LIN-1282)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const opencodeList = page.locator('#dispatch-model-suggestions');
    const claudeList = page.locator('#dispatch-model-suggestions-claude');
    await expect(opencodeList).toHaveCount(1);
    await expect(opencodeList.locator('option')).not.toHaveCount(0);
    // The Claude Code datalist holds exactly the four presets (LIN-1763 added fable).
    await expect(claudeList).toHaveCount(1);
    await expect(claudeList.locator('option')).toHaveCount(4);
    await expect(claudeList.locator('option[value="sonnet"]')).toHaveCount(1);
    await expect(claudeList.locator('option[value="fable"]')).toHaveCount(1);
  });

  test('the model input is harness-aware: it swaps datalists when the harness changes (LIN-1282)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    const modelInput = page.locator('input[name="defaultModel"]');
    // Workspace default pre-selects claude-code → starts on the Claude datalist.
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
    await expect(modelInput).toHaveAttribute('list', 'dispatch-model-suggestions-claude');

    // Switch to OpenCode → the input swaps to the full-list datalist.
    await page.selectOption('select[name="defaultHarnessSelect"]', 'opencode');
    await expect(modelInput).toHaveAttribute('list', 'dispatch-model-suggestions');

    // Back to Claude Code → back to the Claude preset datalist.
    await page.selectOption('select[name="defaultHarnessSelect"]', 'claude-code');
    await expect(modelInput).toHaveAttribute('list', 'dispatch-model-suggestions-claude');
  });

  test('the live OpenRouter catalog is merged into the shared datalist (LIN-1111 Session 2)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Local-provider sessions are mock-gated (routes/workspace-api.js
    // shouldMockAi), so the settings render path resolves the deterministic
    // MOCK_CATALOG_MODELS instead of a live OpenRouter call.
    const datalist = page.locator('#dispatch-model-suggestions');
    await expect(datalist.locator('option[value="mock-provider/catalog-model-one"]')).toHaveCount(1);
    await expect(datalist.locator('option[value="mock-provider/catalog-model-two"]')).toHaveCount(1);
    // Still lists the curated suggestions — supplement, not replace.
    await expect(datalist.locator('option[value="openai/gpt-5.4-mini"]')).toHaveCount(1);
  });

  test('saving the workspace-wide default persists across reloads', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="defaultModel"]', 'anthropic/claude-opus-4.8');
    await page.selectOption('select[name="defaultHarnessSelect"]', 'opencode');
    await page.fill('input[name="defaultEffort"]', 'high');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('opencode');
    await expect(page.locator('input[name="defaultEffort"]')).toHaveValue('high');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('opencode');
    await expect(page.locator('input[name="defaultEffort"]')).toHaveValue('high');

    // G2's real proof (LIN-2616): not just that the settings page echoes the
    // stored value back, but that it RESOLVES into an actual dispatch item —
    // through S1's widened dispatch-factory.js gate, which is exactly the path
    // this ticket says G2 is inert without. Post a dispatch with explicit
    // model/harness (both already set above) and NO effort, then confirm the
    // created item's effort came from the workspace-wide default.
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/dispatch`, {
      data: { prompt: 'G2 resolution witness', promptName: 'G2 witness', model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });
    expect(createRes.ok()).toBeTruthy();

    const { items } = await (await page.request.get(`/workspace/${localWorkerUrlKey}/api/dispatch`)).json();
    const created = items.find(i => i.promptName === 'G2 witness');
    expect(created).toBeDefined();
    expect(created.effort).toBe('high');

    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
  });

  // Acceptance #3 (LIN-2616), save-path half: a save that touches ONE per-kind
  // row must not fan that value out into byKind.effort entries for the rows the
  // operator never typed in. Proven the same way the rest of this spec proves
  // persistence: through the real POST handler + a real reload, scoping the
  // check to the row a save actually touched vs. every row it didn't.
  //
  // NOTE what this does NOT cover: the LIN-1747 *visual-inheritance* hazard —
  // per-kind rows rendering the workspace-wide effort as if it were their own
  // override — is not exercised here, because this scenario never sets a
  // workspace-wide effort. That guard is the unit witness
  // `a kind with no effort override renders blank even when the workspace-wide
  // effort is set (LIN-2616, LIN-1747)` in tests/unit/render-settings.test.js;
  // mutating renderDispatchDefaultsSection to inherit reddens that test and
  // leaves this one green. Keep both — they cover different halves.
  test('saving one per-kind effort override does not write byKind.effort entries for untouched kinds (LIN-2616)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const reviewRow = page.locator('[data-testid="dispatch-default-row-review"]');
    await reviewRow.locator('input.dispatch-effort-input').fill('max');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // The touched row persisted...
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const savedReviewRow = page.locator('[data-testid="dispatch-default-row-review"]');
    await expect(savedReviewRow.locator('input.dispatch-effort-input')).toHaveValue('max');

    // ...but every OTHER kind's effort input is still blank — the save did not
    // fan the single touched row out into explicit overrides for the rest of
    // DISPATCH_DEFAULT_KINDS (18 kinds total; sampling a few is sufficient,
    // the hazard this guards is "all of them", which any surviving value
    // would already prove).
    for (const kind of ['implementation', 'bug', 'autopilot', 'plan']) {
      const row = page.locator(`[data-testid="dispatch-default-row-${kind}"]`);
      await expect(row.locator('input.dispatch-effort-input')).toHaveValue('');
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const reloadedReviewRow = page.locator('[data-testid="dispatch-default-row-review"]');
    await expect(reloadedReviewRow.locator('input.dispatch-effort-input')).toHaveValue('max');
    for (const kind of ['implementation', 'bug', 'autopilot', 'plan']) {
      const row = page.locator(`[data-testid="dispatch-default-row-${kind}"]`);
      await expect(row.locator('input.dispatch-effort-input')).toHaveValue('');
    }
  });

  // Acceptance #2 (LIN-1694 row-atomic style): a per-kind byKind.effort entry
  // scoped to one harness must NOT donate when a DIFFERENT harness is in
  // force for the actual dispatch — proven end-to-end through a real
  // Settings save + a real dispatch resolution, not just the unit-level
  // resolveRoutingFromConfig coverage this mirrors.
  test('a per-kind effort override scoped to another harness does not donate (row-atomic, LIN-2616/LIN-1694)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await row.locator('select.harness-select').selectOption('opencode');
    await row.locator('input.dispatch-effort-input').fill('xhigh');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    const savedRow = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(savedRow.locator('select.harness-select')).toHaveValue('opencode');
    await expect(savedRow.locator('input.dispatch-effort-input')).toHaveValue('xhigh');

    // Dispatch kind:implementation with harness EXPLICITLY claude-code — the
    // opposite of the byKind row's opencode scoping. Row-atomic: an
    // ineligible row must be skipped, not donate anyway.
    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
    const createRes = await page.request.post(`/workspace/${localWorkerUrlKey}/api/dispatch`, {
      data: { prompt: 'row-atomic witness', promptName: 'row-atomic witness', kind: 'implementation', harness: 'claude-code' }
    });
    expect(createRes.ok()).toBeTruthy();

    const { items } = await (await page.request.get(`/workspace/${localWorkerUrlKey}/api/dispatch`)).json();
    const created = items.find(i => i.promptName === 'row-atomic witness');
    expect(created).toBeDefined();
    // The opencode-scoped row's 'xhigh' must NOT have donated to this
    // claude-code-in-force resolution — nothing else donates either (no
    // workspace-wide effort was set), so the correct resolution is null, not
    // merely "something other than xhigh".
    expect(created.effort).toBeNull();

    await page.request.get(`/test/clear-dispatch-queue?urlKey=${localWorkerUrlKey}`);
  });

  test('saving a per-prompt-type override persists independently of the workspace-wide default', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    // Per-kind rows live behind the collapsed progressive-disclosure toggle
    // (LIN-1111) until expanded.
    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await row.locator('input.dispatch-model-input').fill('anthropic/claude-sonnet-5');
    await row.locator('select.harness-select').selectOption('opencode');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    const savedRow = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(savedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(savedRow.locator('select.harness-select')).toHaveValue('opencode');

    // Workspace-wide default model row stays untouched.
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedRow = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(reloadedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(reloadedRow.locator('select.harness-select')).toHaveValue('opencode');
  });

  test('saving the autopilot per-kind override round-trips through the real POST handler (LIN-1278)', async ({ page, localWorkerUrlKey }) => {
    // Ledger discharge (LIN-1278 close-out): drive the `autopilot` field through
    // the actual `for (const kind of DISPATCH_DEFAULT_KINDS)` save loop in the
    // POST handler — save → persist → re-render — for autopilot specifically,
    // not by composition of the step-kind rows.
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-autopilot"]');
    await row.locator('input.dispatch-model-input').fill('anthropic/claude-sonnet-5');
    await row.locator('select.harness-select').selectOption('opencode');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    const savedRow = page.locator('[data-testid="dispatch-default-row-autopilot"]');
    await expect(savedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(savedRow.locator('select.harness-select')).toHaveValue('opencode');

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedRow = page.locator('[data-testid="dispatch-default-row-autopilot"]');
    await expect(reloadedRow.locator('input.dispatch-model-input')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(reloadedRow.locator('select.harness-select')).toHaveValue('opencode');
  });

  test('the workspace-wide harness select pre-selects claude-code when unconfigured (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('per-kind override rows leave their harness select blank (inherit) even though the workspace-wide row pre-selects claude-code (LIN-1111)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await expect(row.locator('select.harness-select')).toHaveValue('');
  });

  test('saving a per-kind-only change also persists the pre-selected claude-code workspace default (LIN-1111, expected consequence of the shared form)', async ({ page, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="dispatch-kind-overrides-toggle"]').click();
    const row = page.locator('[data-testid="dispatch-default-row-implementation"]');
    await row.locator('input.dispatch-model-input').fill('anthropic/claude-sonnet-5');
    await page.locator('.dispatch-defaults-submit button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('rejects an oversized field and does not persist it', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;
    const res = await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { defaultModel: 'a'.repeat(1001) },
      maxRedirects: 0
    });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'];
    expect(location).toContain('dispatchDefaultsError=invalid-field');

    // Follow the actual redirect target (carries the error query param) rather
    // than a bare reload, which would drop it.
    await page.goto(location);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('');
    await expect(page.locator('[data-testid="settings-section-dispatch-defaults"] .settings-value.error')).toContainText('1000 characters or less');
  });

  test('read-merge-write does not clobber workspace features or the AI model preference', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;

    await page.request.post(`${settingsUrl}/workspace-features`, {
      form: { feature: 'periodicals', enabled: 'true' }
    });
    await page.request.post(`${settingsUrl}/model`, {
      form: { modelId: 'anthropic/claude-opus-4.8' }
    });
    await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { defaultModel: 'anthropic/claude-sonnet-5', defaultHarnessSelect: 'claude-code' }
    });

    await page.goto(settingsUrl);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-feature="periodicals"] .toggle-state')).toHaveText('● on');
    await expect(page.locator('.model-id')).toHaveText('anthropic/claude-opus-4.8');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-sonnet-5');
    await expect(page.locator('select[name="defaultHarnessSelect"]')).toHaveValue('claude-code');
  });

  test('ignores a byKind key that is not a live PROMPT_TEMPLATES kind', async ({ page, localWorkerUrlKey }) => {
    const settingsUrl = `/workspace/${localWorkerUrlKey}/settings`;
    // Nothing in the rendered form can produce this — a live PROMPT_TEMPLATES
    // row is the only per-kind field the POST handler ever reads — but prove
    // the write path drops an unrelated posted field defensively rather than
    // erroring.
    const res = await page.request.post(`${settingsUrl}/dispatch-defaults`, {
      form: { 'kind__not-a-real-kind__Model': 'should-never-be-read', defaultModel: 'anthropic/claude-opus-4.8' }
    });
    expect(res.ok()).toBeTruthy();

    await page.goto(settingsUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[name="defaultModel"]')).toHaveValue('anthropic/claude-opus-4.8');
  });
});
