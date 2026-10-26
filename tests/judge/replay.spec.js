/**
 * Visual replay (LIN-3887): opens the same fixed list of pages and states on a BASE server and a
 * HEAD server (each an export of its own commit, see visual-replay.mjs), screenshots both at
 * 1280×900 and 390×844 in light and dark, and compares them at zero tolerance.
 *
 * Two tiers. (1) PNG bytes equal = zero difference. (2) Bytes differ: Playwright's own
 * comparator with threshold 0 and maxDiffPixels 0 counts the differing pixels. Bytes that differ
 * with zero differing pixels are their own row ("bytes differ, pixels equal"), never a pass.
 *
 * Seeded through tests/fixtures/local-harness.js (the local provider), not the mock fixtures.
 * Nothing leaves the machine: every non-loopback request is aborted.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLocalSeed } from '../fixtures/local-harness.js';
import { PAGES, VIEWPORTS, THEMES, FROZEN_TIME, NORMALISE, parsePixelDiff, layoutClass } from './pages.mjs';
import { homeSeed, hasHomeSessions, seedHomeSessions, HOME_WRITE_SSE } from './home-states.mjs';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { LIVE_CONSOLE_STATES, seedLiveConsole } from './live-console-states.mjs';
import { taskSeed, seedTaskState, mintGuestPath } from './task-states.mjs';
import { OBSERVATION_STATES, seedObservation } from './observation-states.mjs';

const BASE_URL = process.env.JUDGE_BASE_URL;
const HEAD_URL = process.env.JUDGE_HEAD_URL;
const RESULTS = process.env.JUDGE_RESULTS;
const PROBE = process.env.JUDGE_PROBE_SELECTOR || '';
const ATTEMPTS = 3;
const ONLY = process.env.JUDGE_ONLY ? new RegExp(process.env.JUDGE_ONLY) : null;

const AUDIT_FIXTURE = fileURLToPath(new URL('./audit-report.fixture.json', import.meta.url));

// LIN-3968: Home's opened-task states (the six that seed sessions or write a prompt). The LIN-3962 states are not these.
const isOpenedTaskState = (state) => /^home-(stages-done|running|failed|failed-first|copy-first|copy-written)$/.test(state ?? '');
// LIN-3975: the task page's states (owner, member, guest, runner-less owner, and the chat fold open). Each has its own workspace.
const isTaskState = (state) => /^task-(build-done|running|failed|waiting|ready|chat-open|member|guest|no-runner)$/.test(state ?? '');
const isLoopback = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || url.startsWith('data:') || url.startsWith('blob:');

// `urlKey` null means no local seed: the account is a zero-workspace one, signed in by email (LIN-3956).
async function openContext(browser, baseURL, viewport, theme, urlKey, seed = {}, base = null, realClock = false) {
  const context = await browser.newContext({
    baseURL, viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await context.route('**/*', (route) => (isLoopback(route.request().url()) ? route.continue() : route.abort()));
  await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);
  // LIN-3977: the Live Console's runs are seeded on the real clock, so its states keep the real clock (see pages.mjs).
  if (!realClock) await context.clock.setFixedTime(new Date(FROZEN_TIME));
  if (urlKey) {
    // LIN-3968: Home's opened-task states seed their own workspace (homeSeed); the run control shows only where the entry has a runner.
    const data = { ...(base || defaultLocalSeed(urlKey)), urlKey, runnerKey: false, ...seed };
    const resp = await context.request.post('/test/set-local-session', { data });
    if (!resp.ok()) throw new Error(`seed failed on ${baseURL}: ${resp.status()} ${await resp.text()}`);
  }
  return context;
}

async function settle(page) {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  // `fonts.ready` alone resolves before a face that has not been asked for yet is requested, which
  // moved the wordmark by a sub-pixel between two identical runs. Ask for every declared face first.
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

// LIN-3952: priced agent runs through the dispatch API, the way a runner reports them (see tests/e2e/lin-3987-decision-panel.spec.js).
// Every agent job gets two priced runs at a cost that differs by job, so the rows, the section totals and the sidebar all have figures.
const SPEND_JOBS = ['implementation', 'review', 'bug', 'plan', 'close-out'];
async function seedAgentSpend(request, urlKey) {
  // The dispatch create is an owner's write, so the workspace's owner is set first, as the e2e spec does.
  await seedWorkspaceOwnership(request, urlKey, 'owner');
  const { token } = await (await request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // The seed's issues are LOCAL-1 to LOCAL-4. A kind may not run twice on one issue within minutes, so a kind's two runs take
  // two different issues (the rotation), and the kinds are spread across them.
  for (const [index, kind] of SPEND_JOBS.entries()) {
    for (let run = 0; run < 2; run += 1) {
      const issueIdentifier = `LOCAL-${((index + run) % 4) + 1}`;
      const create = await request.post(`/workspace/${urlKey}/api/dispatch`, {
        data: { prompt: 'judge spend fixture', promptName: kind, kind, issueIdentifier, issueTitle: 'Judge spend fixture', target: 'cli' },
      });
      if (!create.ok()) throw new Error(`spend seed create failed: ${create.status()} ${await create.text()}`);
      const itemId = (await create.json()).item.id;
      await request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
      await request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { kind: 'usage', message: `[usage] ${JSON.stringify({ costUsd: 0.2 + index * 0.25 })}` } });
      await request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: '[done] complete' } });
    }
  }
}

// Per-state set-up: identical on both sides, driven by the page's own markup.
// LIN-3968: Home's opened task. The sessions are seeded through the consumer API (on both sides), then Home is
// opened and its top task clicked. The write is the fixed stream, so the request never leaves the browser.
// Seeded once per server and state: the dispatch guard refuses the same kind on the same task for five minutes, so
// a second shoot of the same state would be refused. Sessions persist on the server, so later contexts see them too.
const seeded = new Set();
async function prepareHome(page, context, entry, baseURL) {
  const key = `${baseURL}|${entry.urlKey}`;
  if (hasHomeSessions(entry.state) && !seeded.has(key)) {
    await seedHomeSessions(context.request, entry.urlKey, entry.state);
    seeded.add(key);
  }
  if (entry.state === 'home-copy-written') {
    await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: HOME_WRITE_SSE }));
  }
  await page.goto(entry.path(entry.urlKey));
  await settle(page);
  const block = page.locator('.opened-task').first();
  if (!(await block.isVisible())) await page.locator('[data-top-task="1"]').click();
  // LIN-3968 adds the `.opened-task` wrapper: base (33e5dc6e) has none, so base is judged after its lazy detail settles.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  if (await block.count()) await block.waitFor();
  if (entry.state === 'home-copy-written' && await page.locator('[data-testid="opened-task-write"]').count()) {
    await page.locator('[data-testid="opened-task-write"]').click();
    // Both sides show the write's result (head: the target line; base: no target line), so wait for the Copy button.
    await page.getByRole('button', { name: 'Copy prompt' }).waitFor();
  }
}

// LIN-3975: the task page's states. Seeded once per server and state, as prepareHome does. A guest is the owner's share
// opened as a guest; the chat fold is opened by its own summary, the way a reader opens it, where the side has one.
async function prepareTask(page, context, entry, baseURL) {
  const key = `${baseURL}|${entry.urlKey}`;
  if (!seeded.has(key)) {
    await seedTaskState(context.request, entry.urlKey, entry.state);
    seeded.add(key);
  }
  // A member is the session that is not the owner. Each shot re-binds the session (openContext), so the foreign edge
  // is set again here, on every shot, not once per server.
  if (entry.state === 'task-member') await seedWorkspaceOwnership(context.request, entry.urlKey, 'foreign');
  const path = entry.state === 'task-guest' ? await mintGuestPath(context.request, entry.urlKey) : entry.path(entry.urlKey);
  await page.goto(path);
  await settle(page);
  // The fold is new in LIN-3975: base has none, so it is opened only where it is (head), and the base shot shows the page without it.
  const fold = page.locator('[data-testid="task-page-chat-fold"] summary');
  if (entry.state === 'task-chat-open' && await fold.count()) {
    await fold.first().click();
    await settle(page);
  }
}

async function prepare(page, context, entry, viewport, theme, side, baseURL) {
  const url = entry.path(entry.urlKey);
  if (isOpenedTaskState(entry.state)) return prepareHome(page, context, entry, baseURL);
  if (isTaskState(entry.state)) return prepareTask(page, context, entry, baseURL);
  if (LIVE_CONSOLE_STATES.has(entry.state)) await seedLiveConsole(context.request, baseURL, entry.urlKey, entry.state);
  if (OBSERVATION_STATES.has(entry.state)) await seedObservation(context.request, baseURL, entry.urlKey, entry.state);
  if (entry.state === 'email-signin') {
    // One address per shot, the same on both sides: the send throttle is per address (3 per 15 minutes),
    // and the judge takes at most ATTEMPTS (3) tries per shot. The link is read from the capture outbox.
    const email = `judge-${viewport.name}-${theme}@example.test`;
    await page.goto('/auth/email');
    await page.getByTestId('email-signin-address').fill(email);
    await page.getByTestId('email-signin-submit').click();
    await page.getByTestId('email-check-inbox').waitFor();
    const sent = await context.request.get(`/test/email-outbox?to=${encodeURIComponent(email)}`);
    if (!sent.ok()) throw new Error(`no sign-in email for ${email}: ${sent.status()}`);
    const link = (await sent.json()).text.match(/https?:\/\/[^\s]+(\/auth\/email\/confirm\?t=[A-Za-z0-9_-]+)/);
    if (!link) throw new Error(`the sign-in email for ${email} carries no confirm link`);
    await page.goto(link[1]);
    await page.getByTestId('email-confirm-submit').click();
    await page.waitForURL(/\/account$/);
  }
  if (entry.state === 'models-spend') {
    // LIN-3952: priced agent runs, reported the way a runner reports them (a take, a `[usage]` line with a cost, a `[done]`),
    // so every agent job has spend for its row. Once per server, as the Home seeds are: a second shoot is the same data.
    const key = `${baseURL}|${entry.urlKey}|spend`;
    if (!seeded.has(key)) {
      await seedAgentSpend(context.request, entry.urlKey);
      seeded.add(key);
    }
  }
  if (entry.state === 'key-open') {
    const minted = await context.request.get(`/test/create-proxy-token?urlKey=${entry.urlKey}&label=judge-key&scope=read`);
    if (!minted.ok()) throw new Error(`mint failed: ${minted.status()}`);
  }
  if (entry.state === 'change-log-entry') {
    // The log is only written by really submitting the ask; do it once per server.
    await page.goto(url);
    if (await page.getByTestId('settings-change-empty').count()) {
      await page.goto(url.replace(/change-log$/, 'running'));
      const ask = page.getByTestId('settings-toggle-periodicals');
      await ask.locator('summary').click();
      await ask.locator('textarea[name="reason"]').fill('Judge fixture');
      // The submit redirects to running?changed=1; wait for that, not for any running URL (already true here).
      await Promise.all([page.waitForURL(/settings\/running\?changed=1/), ask.locator('[data-testid$="-confirm"]').click()]);
    }
  }
  if (entry.state === 'paused') {
    // A queue token is a runner (run-controls.js), so Pause is offered. Minted on the Dispatch page as an owner does.
    await page.goto(url);
    if (!(await page.getByTestId('settings-halt-pause').count())) {
      await page.goto(`/workspace/${entry.urlKey}/dispatch`);
      await page.locator('.token-label-input').fill('judge-runner');
      await page.locator('#create-token-form button[type="submit"]').click();
      await page.locator('.token-modal-close').click();
      await page.goto(url);
    }
    // The Runs row opens in place (head); base has no such row, so this step is conditional.
    const runs = page.getByTestId('settings-halt-state');
    if (await runs.locator(':scope > summary').count()) await runs.locator(':scope > summary').click();
    if (await page.getByTestId('settings-halt-pause').count()) {
      await page.getByTestId('settings-halt-pause').locator(':scope > summary').click();
      await page.getByTestId('settings-halt-pause-reason').fill('Judge fixture');
      await Promise.all([page.waitForURL(/settings\/running\?changed=1/), page.getByTestId('settings-halt-pause-confirm').click()]);
    }
  }
  await page.goto(url);
  await settle(page);
  if (entry.state === 'ask-open') await page.getByTestId('settings-toggle-periodicals').locator('summary').click();
  if (entry.state === 'key-open') await page.locator('[data-testid="settings-key-proxy"], [data-testid="settings-key-dispatch"]').locator('summary').first().click();
  if (entry.state === 'models-group-open') {
    // Head's group rows open in place. Base's groups are the old forms, so this is conditional there.
    const group = page.locator('[data-testid="models-group-agent-session-judge"]');
    if (await group.count()) await group.locator(':scope > summary').click();
  }
  if (entry.state === 'models-saved' && side === 'head') {
    // A row staged and saved (head only): one Undo for the save, and the row marked. Base's save redirects elsewhere, so base
    // is shot as it is (unsaved) and the difference is the change itself. The row is a job with no runs, so it sits behind
    // the fold: open the folds first, as a person would.
    const row = page.locator('[data-testid="models-job-review"]');
    if (await row.count()) {
      const closed = page.locator('details.models-fold:not([open])');
      while (await closed.count()) await closed.first().locator(':scope > summary').click();
      await row.locator(':scope > summary').click();
      // Base's model is a select, head's is the decision panel's input (as models-staged above): choose by the element's kind.
      const model = row.locator('[data-models-field="model"]');
      if ((await model.evaluate((el) => el.tagName)) === 'SELECT') await model.selectOption('sonnet');
      else await model.fill('sonnet');
      await page.locator('[data-testid="models-reason"]').fill('Judge fixture');
      // A DOM click, not a pointer click: on a phone the open panels above Save can intercept the pointer, and the save is a plain form submit.
      // Wait for the new document (the redirect lands on the page with ?changed=), not just the URL, before settling.
      await Promise.all([page.waitForURL(/settings\/models\?changed=/, { waitUntil: 'domcontentloaded' }), page.locator('[data-testid="models-save"]').dispatchEvent('click')]);
      await settle(page);
    }
  }
  if (entry.state === 'models-panel-open' || entry.state === 'models-staged') {
    // Head's job rows open in place. Base has the legacy forms and no such row, so these steps are conditional there.
    const row = page.locator('[data-testid="models-job-implementation"]');
    if (await row.count()) {
      await row.locator(':scope > summary').click();
      if (entry.state === 'models-staged') {
        // Base's model is a select, head's is the decision panel's input (LIN-3962): choose by the element's kind.
        const model = row.locator('[data-models-field="model"]');
        if ((await model.evaluate((el) => el.tagName)) === 'SELECT') await model.selectOption('sonnet');
        else await model.fill('sonnet');
      }
    }
  }
  if (entry.state === 'home-run-panel-open' || entry.state === 'home-run-panel-opencode' || entry.state === 'home-run-panel-pick') {
    // LIN-3962: Home's Change panel, opened the way a viewer opens it: the In Progress row (visible; the marked top task
    // sits under a collapsed parent in this seed), then Change. The seed gives this page its run controls, so head must
    // show Change; a head without it fails here rather than being skipped. Base's panel is the old one, so base may come
    // up without the control and is shot as it is.
    await page.locator('[data-section="in-progress"][data-identifier="LOCAL-1"]').first().click();
    const change = page.getByTestId('run-change');
    // LIN-3991: base waits too (briefly). Both sides now have Change, and a base that only counted it shot the page
    // before the control rendered, so the pair differed by a panel that one side never opened.
    if (side === 'head') await change.waitFor();
    else await change.waitFor({ timeout: 5000 }).catch(() => {});
    if (await change.count()) {
      await change.click();
      await page.getByTestId(side === 'head' ? 'run-decision-panel' : 'run-change-panel').waitFor();
    }
    // LIN-3987: the opencode state chooses opencode as the harness, so the effort line and the lost web choice show.
    // LIN-3991: on whichever side has the harness control (base waits for it: the panel's body arrives after its frame). Base is main now and has it; choosing it on head only made the
    // pair differ by a choice one side never made.
    if (entry.state === 'home-run-panel-opencode' && (side === 'head' || await page.getByTestId('run-harness').waitFor({ timeout: 5000 }).then(() => true, () => false))) {
      await page.getByTestId('run-harness').selectOption('opencode');
      await page.getByTestId('run-effort').first().waitFor({ state: 'hidden' });
    }
  }
  // LIN-3992: a viewer picks the Claude Opus 5.5 suggestion; head's summary then names it, base's still says the old thing.
  if (entry.state === 'home-run-panel-pick') {
    await page.locator('[data-decision-pick="opus"]').first().click();
  }
  if (entry.state === 'swipe-dispatch-open') {
    // LIN-3962: Swipe's card with its Prompts section open, where its exec controls live. The Dispatch ▾ disclosure
    // appears only on a generated prompt, which this seed does not make, so it is not claimed here. Swipe has no run
    // panel, so this state must show no difference.
    await page.getByText(/Prompts/).first().click();
    await page.getByText('next step').first().waitFor();
  }
  if (entry.state === 'audit-report') {
    // Both sides answer the same fixture, so the report is identical and the request never leaves the browser.
    await page.route('**/api/audit', (route) => route.fulfill({ path: AUDIT_FIXTURE, contentType: 'application/json' }));
    await page.locator('#run-audit').click();
    await page.locator('.report-timestamp').waitFor();
  }
}

async function shoot(browser, baseURL, viewport, theme, entry, side) {
  const openedTask = isOpenedTaskState(entry.state);
  const taskState = isTaskState(entry.state);
  // The task states seed their own task (taskSeed) and a runner key only where the state has one.
  const seedFor = openedTask ? { runnerKey: entry.runner === true }
    : taskState ? { runnerKey: entry.runner === true, ...(entry.seed || {}) }
      : entry.seed;
  const baseFor = openedTask ? homeSeed(entry.urlKey) : taskState ? taskSeed(entry.urlKey, { ready: entry.state === 'task-ready' }) : null;
  const context = await openContext(browser, baseURL, viewport, theme, entry.state === 'email-signin' ? null : entry.urlKey,
    seedFor, baseFor, LIVE_CONSOLE_STATES.has(entry.state) || OBSERVATION_STATES.has(entry.state));
  try {
    const page = await context.newPage();
    await prepare(page, context, entry, viewport, theme, side, baseURL);
    await settle(page);
    // Rewrite per-run text (see NORMALISE in pages.mjs) in text nodes, before the screenshot.
    await page.evaluate((rules) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const r of rules) n.nodeValue = n.nodeValue.replace(new RegExp(r.pattern, 'g'), r.replacement);
      }
    }, NORMALISE);
    const masks = entry.masks || [];
    const present = [];
    for (const m of masks) {
      // A mask that matches nothing would drop silently and let the judge read a false zero.
      // An optional mask names an element one side does not emit (LIN-3977's new lane duration on base); it is skipped there.
      if (!await page.locator(m.selector).count()) {
        if (m.optional) continue;
        throw new Error(`mask matched nothing on ${entry.id}: ${m.selector}`);
      }
      present.push(m);
    }
    // Where the planted piece is shown, for the positive control: rendered, and NOT inside a mask (a
    // difference inside a masked row is hidden by design, so it must not be expected to show).
    const maskSelectors = present.map((m) => m.selector).join(',');
    const probe = PROBE
      ? await page.locator(PROBE).evaluateAll((els, masked) => els.filter((e) => e.getClientRects().length > 0 && !(masked && e.closest(masked))).length, maskSelectors)
      : null;
    const take = () => page.screenshot({
      fullPage: true, animations: 'disabled', caret: 'hide',
      mask: present.map((m) => page.locator(m.selector)),
    });
    // Settle until the page paints the same twice in a row. Two identical exports sometimes differed
    // by a sub-pixel in the first paint of the nav text; a real CSS difference is stable, so it
    // survives this and is still reported. No tolerance is involved.
    let buffer = await take();
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(150);
      const again = await take();
      const stable = again.equals(buffer);
      buffer = again;
      if (stable) break;
    }
    return { buffer, masked: present.map((m) => `${m.selector} (${m.reason})`), probe };
  } finally {
    await context.close();
  }
}

const record = (row) => RESULTS && fs.appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);

for (const entry of PAGES) {
  if (ONLY && !ONLY.test(entry.id)) continue;
  test(entry.id, async ({ browser }, testInfo) => {
    const failures = [];
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const name = `${entry.id}-${viewport.name}-${theme}`;
        // A freshly started server sometimes paints the nav text a sub-pixel off for one load (two
        // identical exports, found in the self-check). A real difference is stable, so a pair that
        // differs is taken again, up to ATTEMPTS times, and the result is the LAST attempt. A retried
        // pair is counted in the summary (`attempts`), so noise is visible, never silently absorbed.
        let base;
        let head;
        let attempts = 0;
        do {
          attempts++;
          base = await shoot(browser, BASE_URL, viewport, theme, entry, 'base');
          head = await shoot(browser, HEAD_URL, viewport, theme, entry, 'head');
        } while (!base.buffer.equals(head.buffer) && attempts < ATTEMPTS);
        const row = { page: entry.id, viewport: viewport.name, theme, masked: base.masked, probe: base.probe, attempts };
        if (base.buffer.equals(head.buffer)) {
          record({ ...row, result: 'byte-equal', pixels: 0 });
          continue;
        }
        // JUDGE_KEEP_DIR keeps both images of every non-equal pair, for finding the source of a difference.
        if (process.env.JUDGE_KEEP_DIR) {
          fs.mkdirSync(process.env.JUDGE_KEEP_DIR, { recursive: true });
          fs.writeFileSync(path.join(process.env.JUDGE_KEEP_DIR, `${name}.base.png`), base.buffer);
          fs.writeFileSync(path.join(process.env.JUDGE_KEEP_DIR, `${name}.head.png`), head.buffer);
        }
        // Tier 2: Playwright's comparator, zero threshold, zero allowed pixels.
        const snap = testInfo.snapshotPath(`${name}.png`);
        fs.mkdirSync(path.dirname(snap), { recursive: true });
        fs.writeFileSync(snap, base.buffer);
        try {
          expect(head.buffer).toMatchSnapshot(`${name}.png`, { threshold: 0, maxDiffPixels: 0 });
          record({ ...row, result: 'bytes-differ-pixels-equal', pixels: 0 });
          failures.push(name);
        } catch (e) {
          const diff = parsePixelDiff(String(e.message)) || {};
          record({
            ...row, result: 'differs', pixels: diff.pixels ?? null,
            // From the images' own sizes (LIN-3975): the comparator's text can count pixels for a pair that differs in height.
            class: layoutClass(base.buffer, head.buffer),
            message: diff.pixels === undefined && !diff.sizeMismatch ? String(e.message).slice(0, 300) : undefined,
          });
          failures.push(name);
        }
      }
    }
    expect(failures, `${entry.id}: pages that differ`).toEqual([]);
  });
}
