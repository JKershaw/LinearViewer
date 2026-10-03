import { test, expect } from '../fixtures/test-base.js';

// LIN-1003 (Phase 1 of LIN-950): the dedicated per-session page
// (GET /workspace/:urlKey/observation/session/:sessionId) — the Observation
// in-feed drill-down promoted to a server-rendered page with its own URL.
//
// Seeding mirrors observation.spec.js: the live feed reconstructs sessions from
// the dispatch/agent-status stores (Mongo-only), so we seed an autopilot anchor
// + a worker stamped with the anchor id as sessionId (the LIN-591 spine), then
// drive the worker to a terminal outcome through the real consumer take+feedback
// flow so the run reconstructs WITH a `feedback[]` transcript. The sessionId is
// discovered from the sessions feed so the test never guesses the derived key.

let URL_KEY;

test.beforeEach(async ({ page, workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  // LIN-3198 Class A: drop the in-process comment-dedupe caches. Several tests
  // here re-post the same comment body to the same (workspace, issue) every run
  // (e.g. 'recorded' on LIN-1728, 'recording this decision' on LIN-1252); the
  // 5-min server-side dedupe window would otherwise collapse a repeat run's
  // fresh 201 into a deduped 200, making the exact-201 assertions retry-fatal.
  // Global clear (the dedupe key is hashed, so it can't be urlKey-scoped).
  await page.request.get('/test/clear-comment-dedupe');
});

async function clearRuns(page) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

// Seed an autopilot session with one worker driven to a terminal [done] outcome
// (which carries an evidence link in its feedback). Returns nothing — the caller
// discovers the sessionId from the feed.
async function seedSessionWithTranscript(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1003', issueTitle: 'Session-page seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1003', issueTitle: 'Session-page worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A feedback entry carrying an explicit url/urlLabel → a link-rich transcript
  // entry (the endpoint stores url/urlLabel on the entry; LIN-1003 renders them).
  const fb = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: 'opened the pull request', url: 'https://example.com/pr/42', urlLabel: 'PR #42' }
  });
  expect(fb.status(), `evidence feedback failed: ${await fb.text()}`).toBe(200);
  const done = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[done] landed the change' }
  });
  expect(done.status(), `done feedback failed: ${await done.text()}`).toBe(200);
}

// Seed an autopilot session with one worker left in a [blocked] state (paused on
// a human, never driven to [done]) — the LIN-1005 "waiting on user" case.
async function seedBlockedSession(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1005', issueTitle: 'Waiting seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1005', issueTitle: 'Waiting worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A [blocked] feedback marker with no subsequent [done]: the run stays a
  // pause/wait signal, so the session rolls up to a waiting-on-user state.
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: '[blocked] need your decision on the auth flow' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);
}

// Seed a WARM autopilot session: a worker taken and mid-run with only a plain
// progress note — no terminal ([done]/[failed]) and no wait ([blocked]) marker —
// so the session is non-terminal AND not waiting (the genuinely warm/EXECUTING
// case that must still omit `force`, LIN-1252).
async function seedWarmSession(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1252', issueTitle: 'Warm seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1252', issueTitle: 'Warm worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  // A plain progress note — no [done]/[failed]/[blocked]/[pending] marker — so the
  // run stays warm (in-progress), neither terminal nor waiting.
  const progress = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message: 'made progress on the refactor' }
  });
  expect(progress.status(), `progress feedback failed: ${await progress.text()}`).toBe(200);
}

// LIN-3250 ledger item 5: a real-shaped stepped single-lineage run — the ticket's
// own "one warm session, in-session follow-ups" shape. An autopilot anchor plus
// one implementation lineage built from follow-ups (implementation, rework,
// review, rework) whose close-out is still running. Progress must read
// "3 of 4" with "Next: close-out".
async function seedSteppedLineageSession(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-3250', issueTitle: 'Stepped run', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const dispatch = async (data) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
      data: { issueIdentifier: 'LIN-3250', issueTitle: 'Stepped run', target: 'cli', sessionId: anchorId, ...data }
    });
    expect(res.status(), `dispatch ${data.kind} failed: ${await res.text()}`).toBe(201);
    return (await res.json()).item.id;
  };
  const finish = async (id) => {
    const take = await page.request.post(`/api/dispatch/take/${id}`, { headers: auth });
    expect(take.status(), `take ${id} failed: ${await take.text()}`).toBe(200);
    const fb = await page.request.post(`/api/dispatch/feedback/${id}`, { headers: auth, data: { message: '[done] landed' } });
    expect(fb.status(), `feedback ${id} failed: ${await fb.text()}`).toBe(200);
  };

  const impl1 = await dispatch({ prompt: 'implement', promptName: 'implementation', kind: 'implementation' });
  await finish(impl1);
  const impl2 = await dispatch({ prompt: 'rework', promptName: 'implementation', kind: 'implementation', followUpTo: impl1 });
  await finish(impl2);
  const review = await dispatch({ prompt: 'review', promptName: 'review', kind: 'review', followUpTo: impl2 });
  await finish(review);
  const rework = await dispatch({ prompt: 'rework after review', promptName: 'implementation', kind: 'implementation', followUpTo: review });
  await finish(rework);
  const closeOut = await dispatch({ prompt: 'close out', promptName: 'close-out', kind: 'close-out', followUpTo: rework });
  // close-out: taken but deliberately left running (no terminal marker).
  const takeClose = await page.request.post(`/api/dispatch/take/${closeOut}`, { headers: auth });
  expect(takeClose.status(), `close-out take failed: ${await takeClose.text()}`).toBe(200);

  return { anchorId, impl1, closeOut };
}

// Seed a FINISHED autopilot session (anchor driven to [done]) that still has a
// worker left in a [blocked] state — the LIN-1005 session-level terminal-gate
// case: the session is terminal, so it must NOT surface as waiting even though a
// child run is still blocked ("a finished session is never waiting").
async function seedTerminalSessionWithBlockedWorker(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1005', issueTitle: 'Done seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1005', issueTitle: 'Lingering blocked worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Worker: [blocked] with no [done] — stays a pause/wait signal.
  const wTake = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(wTake.status(), `worker take failed: ${await wTake.text()}`).toBe(200);
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need your decision on the auth flow' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);

  // Anchor: driven to [done] — the session anchor is terminal, so the whole
  // session is terminal (terminality follows the anchor loop, LIN-592).
  const aTake = await page.request.post(`/api/dispatch/take/${anchorId}`, { headers: auth });
  expect(aTake.status(), `anchor take failed: ${await aTake.text()}`).toBe(200);
  const aDone = await page.request.post(`/api/dispatch/feedback/${anchorId}`, {
    headers: auth, data: { message: '[done] orchestration complete' }
  });
  expect(aDone.status(), `anchor done feedback failed: ${await aDone.text()}`).toBe(200);
}

// Seed a STANDALONE (non-autopilot, no sessionId) warm cli session — the LIN-1194
// human-dispatched case that reconstructs as its own single-loop session keyed by
// its own dispatch id. Left non-terminal (a plain progress note, no [done]/
// [blocked]) so the reply box omits force, isolating the LIN-1292 stitch from the
// force/kill-first behavior already covered above.
async function seedStandaloneWarm(page, { issueIdentifier, issueTitle }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'investigate the flake', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const item = (await res.json()).item;
  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${item.id}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  const progress = await page.request.post(`/api/dispatch/feedback/${item.id}`, {
    headers: auth, data: { message: 'looked at the failing run' }
  });
  expect(progress.status(), `progress feedback failed: ${await progress.text()}`).toBe(200);
  return { item, token };
}

// Seed an autopilot session with one worker carrying an unanswered `decision`
// feedback entry (LIN-1728 Phase 2) plus a [blocked] marker — the real
// "waiting for a ruling" shape the runner emits via
// `POST /api/dispatch/feedback/:itemId` with `kind: 'decision'` (accepted
// since LIN-2180, FEEDBACK_ENTRY_KINDS). Returns the seeded decisionId so
// callers can assert the threaded value.
async function seedSessionWithDecision(page) {
  const decisionId = 'd-e2e-1';
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1728', issueTitle: 'Decision seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1728', issueTitle: 'Decision worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need a ruling before continuing' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);
  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed with option A?', options: [{ id: 'a', label: 'Approve' }] }) }
  });
  expect(decision.status(), `decision feedback failed: ${await decision.text()}`).toBe(200);
  return { workerId, decisionId };
}

// LIN-2948 R1: one decision-bearing run that ALSO carries a run-chat proposal,
// so the dark-contrast check sees every control this ticket added in a single
// render (card Answer + dismiss, chat link, proposal Apply/Decline). Uses
// TEST-1 (a mockAi-resolvable fixture task, tests/fixtures/mock-data.js) so the
// run-scoped chat turn takes the propose path with no live LLM — the same seam
// session-proposals.spec.js uses. Returns the anchor id (the run's session id).
async function seedDecisionRunWithProposal(page) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'TEST-1', issueTitle: 'Run-controls seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'TEST-1', issueTitle: 'Run-controls worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message: '[blocked] need a ruling before continuing' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);
  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: {
      kind: 'decision',
      message: JSON.stringify({
        decision_id: 'd-r1-dark-controls',
        question: 'Proceed with the rollout?',
        options: [{ id: 'a', label: 'Approve' }],
        if_unanswered: { summary: 'Nothing further runs; the run has already ended.' }
      })
    }
  });
  expect(decision.status(), `decision feedback failed: ${await decision.text()}`).toBe(200);

  // One run-scoped chat turn → one pending proposal under the run's step.
  await page.goto(`/workspace/${URL_KEY}/task-chat?task=TEST-1&run=${encodeURIComponent(anchorId)}`);
  await page.waitForLoadState('networkidle');
  await page.locator('#task-chat-question').fill('Please follow up on this run.');
  await page.locator('#task-chat-send').click();
  await expect(page.locator('.task-chat-tool', { hasText: 'proposed a follow-up' })).toBeVisible({ timeout: 5000 });

  return anchorId;
}

// Read the sessions feed and return the first session's id.
async function discoverSessionId(page) {
  const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const all = [...(body.active || []), ...(body.recent || [])];
  const seeded = all.find(s => String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session in the feed: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

// WCAG 2.x relative-luminance contrast resolved against each element's
// effective (first opaque ancestor) background — the same maths
// tests/unit/theme.test.js uses over the tokens, here on the live computed
// style. Shared by the LIN-3250 header strip and the LIN-2948 R1 run-page
// controls so both measure the surface the same way.
async function measureAaContrast(page, selectors) {
  return page.evaluate((sels) => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(',').map(s => parseFloat(s.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
    const bgOf = (el) => {
      // Composite every semi-transparent background layer (dark `--inset` is
      // `rgba(255,255,255,0.05)`) over the opaque page surface, outermost
      // first, so the ratio reflects what the eye sees.
      const layers = [];
      let n = el;
      while (n) { layers.push(parse(getComputedStyle(n).backgroundColor)); n = n.parentElement; }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) {
        const c = layers[i];
        if (!c || c.a === 0) continue;
        base = {
          r: c.r * c.a + base.r * (1 - c.a),
          g: c.g * c.a + base.g * (1 - c.a),
          b: c.b * c.a + base.b * (1 - c.a),
          a: 1,
        };
      }
      return { r: Math.round(base.r), g: Math.round(base.g), b: Math.round(base.b), a: 1 };
    };
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      return { sel, ratio: ratio(fg, bg), color: getComputedStyle(el).color, bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})` };
    });
  }, selectors);
}

test.describe('Dedicated per-session page (LIN-1003)', () => {
  test('renders overview, runs, and a link-rich transcript for a seeded session', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The page shell rendered.
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    // LIN-3250: the heading is the task title + a short "Run <id>".
    await expect(page.locator('[data-testid="session-title"]')).toContainText('Session-page seed');
    await expect(page.locator('[data-testid="session-run-id"]')).toContainText('Run ');

    // Tasks-touched surface carries the seeded task.
    await expect(page.locator('[data-testid="session-tasks"]')).toContainText('LIN-1003');

    // At least one run row rendered.
    const run = page.locator('[data-testid="session-run"]').first();
    await expect(run).toBeVisible();

    // The run card has an expand/collapse toggle.
    await expect(page.locator('[data-testid="session-run-toggle"]').first()).toBeVisible();

    // Per-run transcript data is embedded in data-feedback attribute (JSON).
    const transcript = page.locator('[data-testid="session-run-transcript"]').first();
    const feedbackData = await transcript.getAttribute('data-feedback');
    expect(feedbackData).toBeTruthy();
    expect(feedbackData).toContain('opened the pull request');
    expect(feedbackData).toContain('https://example.com/pr/42');
    expect(feedbackData).toContain('[done] landed the change');

    // The run has a body container for the transcript (initially hidden via CSS).
    await expect(page.locator('[data-testid="session-run-body"]').first()).toBeAttached();

    // LIN-1309: the transcript is the shared chat.css thread, and each feedback
    // entry client-renders as a chat bubble (speaker pill + surface body) —
    // the same conversational idiom as Task Chat / the reply echo threads —
    // rather than the old bespoke `.sess-run-tx-entry` list markup.
    await expect(transcript).toHaveClass(/chat-thread/);
    const entries = transcript.locator('[data-testid="session-transcript-entry"].chat-msg');
    await expect(entries).toHaveCount(2);
    await expect(entries.first().locator('.status-pill.chat-msg__who')).toContainText('agent');
    await expect(entries.first().locator('.surface.chat-msg__body')).toContainText('opened the pull request');
    await expect(entries.first().locator('.sess-tx-link')).toHaveAttribute('href', 'https://example.com/pr/42');
    await expect(entries.last().locator('.surface.chat-msg__body')).toContainText('landed the change');

    // Back-to-feed link points at the observation feed.
    await expect(page.locator('[data-testid="session-back"]'))
      .toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);
  });

  // LIN-1801 review fix: the Overview seed-title span is a THIRD child of the
  // `.sess-kv` grid row (label + value already fill it), so a `display: block`
  // declaration left it in grid auto-placement's label column instead of the
  // value column (row 2, col 1 rather than col 2) — invisible to the HTML
  // substring assertions above, only visible in a real computed layout. This
  // asserts actual rendered bounding boxes so a regression back to `display:
  // block` (or any other declaration that drops `grid-column: 2`) fails here.
  test('the Overview seed title left-aligns with the identifier value, not the label (LIN-1801)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const label = page.locator('[data-testid="session-seed"]')
      .locator('xpath=preceding-sibling::span[1]');
    const value = page.locator('[data-testid="session-seed"]');
    const title = page.locator('[data-testid="session-seed-title"]');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Session-page seed');

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const [labelBox, valueBox, titleBox] = await Promise.all([
        label.boundingBox(),
        value.boundingBox(),
        title.boundingBox(),
      ]);
      // The title shares the value column's left edge, not the label's.
      expect(Math.abs(titleBox.x - valueBox.x)).toBeLessThan(2);
      expect(Math.abs(titleBox.x - labelBox.x)).toBeGreaterThan(20);
    }
  });

  test('shows the pinned question card for a bare [blocked] (paused) session (LIN-3252 S2.7)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    // The feed rolls the session up to a waiting status with the blocked message.
    //
    // LIN-3198: polled for the same reason as the terminal-gate read below — the
    // feed is eventually consistent (5s stale-while-revalidate cache + the async
    // materializer's backfill), and `discoverSessionId` has just warmed the cache
    // with whatever snapshot the materializer held. A mid-seed snapshot (worker
    // taken, not yet [blocked]) reads `in-progress`; one read then fails (seen
    // 1/20 in the seven-spec ×20 run). The assertions are unchanged: the session
    // must become waiting with the blocked message once the read model settles.
    await expect.poll(async () => {
      const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
      const body = await feed.json();
      const s = [...(body.active || []), ...(body.recent || [])].find(x => x.sessionId === sessionId);
      if (!s) return null;
      return { status: s.status, waiting: s.waiting, waitingMessage: s.waitingMessage };
    }, {
      timeout: 15000,
      message: 'session feed reflects the [blocked] worker once the async materializer settles',
    }).toMatchObject({
      status: 'waiting',
      waiting: true,
      waitingMessage: expect.stringContaining('need your decision on the auth flow'),
    });

    // The session page renders the pinned question card for the bare blocker —
    // the worker's message, a free-text box and "Answer", with no dismiss.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');
    const card = page.locator('[data-testid="session-question-card"]');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-testid="session-question-card-question"]')).toContainText('need your decision on the auth flow');
    await expect(page.locator('[data-testid="session-question-card-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-question-card-answer"]')).toHaveText('Answer');
    // Bare blocker: no options, no dismiss.
    await expect(page.locator('[data-testid="session-question-card-options"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-question-card-dismiss"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="session-question-card-if-unanswered"]')).toContainText('Harbour keeps waiting for your answer');
  });

  test('a finished session with a lingering blocked worker is NOT waiting — no banner (LIN-1005 terminal gate)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedTerminalSessionWithBlockedWorker(page);
    const sessionId = await discoverSessionId(page);

    // Feed: the session is terminal, so the waiting flag is gated off — the card
    // reports done with no waiting flag/message even though a worker is [blocked].
    //
    // LIN-3198: the feed is intentionally eventually consistent — a 5s
    // stale-while-revalidate cache plus an async per-workspace materializer whose
    // background backfill can race the seed and persist a mid-seed snapshot
    // (worker already [blocked], anchor not yet [done]). A single read then
    // asserts against that transient "waiting" doc (observed ~2-3/20, only under
    // parallel repeats; clean HEAD flakes identically, so it is pre-existing and
    // not one of the four fix surfaces). Poll the read until the terminal gate is
    // reflected — the assertion is unchanged (it must become terminal and
    // not-waiting), only the read outlasts the refresh window.
    await expect.poll(async () => {
      const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
      const body = await feed.json();
      const s = [...(body.active || []), ...(body.recent || [])].find(x => x.sessionId === sessionId);
      if (!s) return null;
      return {
        terminal: s.terminal,
        statusIsWaiting: s.status === 'waiting',
        waiting: s.waiting,
        waitingMessage: s.waitingMessage,
      };
    }, {
      timeout: 15000,
      message: 'session feed reflects the terminal gate once the async materializer settles',
    }).toMatchObject({
      terminal: true,
      statusIsWaiting: false,
      waiting: false,
      waitingMessage: null,
    });

    // Session page: a finished session with no decision renders no question card.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-question-card"]')).toHaveCount(0);
  });

  // LIN-1163: the page-level reply box was removed — every reply now goes
  // through a run's own inline box, which must be expanded first (the
  // whole-card click, item 3) before its textarea/send button are interactable.
  async function expandRun(page, textFilter) {
    const run = page.locator('[data-testid="session-run"]').filter({ hasText: textFilter });
    await run.click();
    await expect(run.locator('[data-testid="session-inline-reply"]')).toBeVisible();
    return run;
  }

  test('the inline reply sends force:true for a run whose session is waiting (paused-on-human) (LIN-1252)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The blocked worker's own run: non-terminal itself, but the SESSION is
    // waiting — the paused-on-human state the runner must kill-first to resume
    // (LIN-1252) still forces via data-session-waiting.
    const run = await expandRun(page, 'Waiting worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'false');
    await expect(box).toHaveAttribute('data-session-waiting', 'true');
    const loopId = await box.getAttribute('data-loop-id');

    // Capture the outbound dispatch POST to assert the wire shape.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('please continue with option A');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // Additive follow-up: followUpTo = the RUN's own loopId (per-run, not the
    // session id), cli target, force:true (waiting → resume anyway / kill-first,
    // LIN-1252/LIN-546), and crucially NO kind:'wake' (no wake collision).
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBe(true);
    expect(payload.kind).toBeUndefined();
    expect(payload.prompt).toContain('option A');

    // The server accepts the forced follow-up (force + followUpTo is valid).
    const resp = await request.response();
    expect(resp.status()).toBe(201);

    // The UI confirms QUEUED (not delivered) — honest about the async handoff.
    await expect(box.locator('.sess-reply-feedback')).toContainText('queued');

    // LIN-1298: the sent reply is echoed as a conversational "you" bubble in the
    // reply thread — the shared Task Chat chat UI, reused on the session surface.
    const youBubble = box.locator('[data-testid="session-reply-you"]');
    await expect(youBubble).toHaveCount(1);
    await expect(youBubble).toContainText('option A');
    // It composes the shared speaker-pill + surface primitives.
    await expect(youBubble.locator('.status-pill.chat-msg__who')).toContainText('you');
    await expect(youBubble.locator('.surface.chat-msg__body')).toBeVisible();
  });

  test('the inline reply omits force for a run in a genuinely warm/executing session (LIN-1252)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    // A running worker with NO terminal/blocked marker → non-terminal AND not
    // waiting: the warm/EXECUTING case that must still omit force.
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Warm worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'false');
    await expect(box).toHaveAttribute('data-session-waiting', 'false');
    const loopId = await box.getAttribute('data-loop-id');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('a note for the warm session');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // Warm/executing run: plain follow-up, NO force (don't kill a live writer).
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBeUndefined();
    expect(payload.kind).toBeUndefined();

    await expect(box.locator('.sess-reply-feedback')).toContainText('queued');
  });

  test('the inline reply sends force:true for a finalized (terminal) run (LIN-1004)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedTerminalSessionWithBlockedWorker(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The anchor run itself was driven to [done] — terminal — so ITS OWN inline
    // box forces to "resume anyway", independent of the still-blocked worker.
    const run = await expandRun(page, 'Done seed');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-terminal', 'true');
    const loopId = await box.getAttribute('data-loop-id');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('one more thing');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    expect(payload.followUpTo).toBe(loopId);
    expect(payload.target).toBe('cli');
    expect(payload.force).toBe(true);

    // The server accepts the forced follow-up (force + followUpTo is valid).
    const resp = await request.response();
    expect(resp.status()).toBe(201);
  });

  test('Save writes a durable comment only — no dispatch follow-up is sent (LIN-2154)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Warm worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    const saveBtn = box.locator('[data-testid="session-inline-reply-save"]');
    await expect(saveBtn).toBeVisible();

    let dispatchFired = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/dispatch') && r.method() === 'POST') dispatchFired = true;
    });

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('recording this decision');
        await saveBtn.click();
      })()
    ]);
    expect(request.url()).toContain('/api/comments/LIN-1252');
    expect(request.postDataJSON().body).toBe('recording this decision');
    const resp = await request.response();
    expect(resp.status()).toBe(201);

    await expect(box.locator('.sess-reply-feedback')).toContainText('recorded on the task');
    expect(dispatchFired).toBe(false);
  });

  test('Save against a waiting session confirms before recording (LIN-2154 OQ5)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Waiting worker');
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveAttribute('data-session-waiting', 'true');
    const saveBtn = box.locator('[data-testid="session-inline-reply-save"]');

    let dialogText = null;
    page.once('dialog', async (dialog) => {
      dialogText = dialog.message();
      await dialog.dismiss();
    });
    await box.locator('textarea').fill('a decision, not delivered');
    await saveBtn.click();
    await page.waitForTimeout(200);
    expect(dialogText).toContain('waiting');

    // Dismissing the confirm means no comment was recorded.
    await expect(box.locator('.sess-reply-feedback')).not.toContainText('recorded on the task');
  });

  test('Save and continue: a synchronous dispatch failure surfaces a structural partial-failure with a working retry (LIN-2154 OQ4)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Warm worker');
    const box = run.locator('[data-testid="session-inline-reply"]');

    // Fail the dispatch call once (simulating a synchronous 429/503) while
    // leaving the comment route untouched — the comment must still land.
    let dispatchAttempts = 0;
    await page.route('**/api/dispatch', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      dispatchAttempts += 1;
      if (dispatchAttempts === 1) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'queue temporarily unavailable' }) });
      }
      return route.continue();
    });

    await box.locator('textarea').fill('please continue, if you can');
    await box.locator('[data-testid="session-inline-reply-send"]').click();

    const feedback = box.locator('.sess-reply-feedback');
    await expect(feedback).toContainText('Recorded on the task');
    await expect(feedback).toContainText('Could not deliver');
    const retryBtn = box.locator('.sess-reply-retry-delivery');
    await expect(retryBtn).toBeVisible();

    // The comment landed even though delivery failed — no comment call is
    // reissued on retry, only the dispatch call.
    await expect(box.locator('[data-testid="session-reply-you"]')).toHaveCount(1);

    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      retryBtn.click()
    ]);
    expect(dispatchAttempts).toBe(2);
    const resp = await request.response();
    expect(resp.status()).toBe(201);
    await expect(feedback).toContainText('reply queued');
    await expect(feedback).toContainText('Recorded on the task');
  });

  test('Save and continue: a comment write failure blocks the dispatch entirely (LIN-2154 OQ4)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Warm worker');
    const box = run.locator('[data-testid="session-inline-reply"]');

    let dispatchFired = false;
    await page.route('**/api/comments/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Comment was not created' }) });
    });
    page.on('request', (r) => {
      if (r.url().includes('/api/dispatch') && r.method() === 'POST') dispatchFired = true;
    });

    await box.locator('textarea').fill('this will not land');
    await box.locator('[data-testid="session-inline-reply-send"]').click();

    await expect(box.locator('.sess-reply-feedback')).toContainText('reply failed');
    await page.waitForTimeout(300);
    expect(dispatchFired).toBe(false);
  });

  test('the pinned card answers a decision: comment carries the decision ids + chosen option, and the run resumes (LIN-3252 S2)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId, decisionId } = await seedSessionWithDecision(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('[data-testid="session-question-card"]');
    await expect(card).toBeVisible();
    // Choose a declared option (leaving the "own answer" box empty) so the
    // option id rides the write.
    await card.locator('[data-testid="session-question-card-option"]').first().click();

    const [commentReq, dispatchReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/comments/') && r.method() === 'POST'),
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      card.locator('[data-testid="session-question-card-answer"]').click()
    ]);

    const commentBody = commentReq.postDataJSON();
    expect(commentBody.decisionLoopId).toBe(workerId);
    expect(commentBody.decisionId).toBe(decisionId);
    expect(commentBody.optionId).toBe('a');
    expect((await commentReq.response()).status()).toBe(201);

    // Answer → the run resumes: the follow-up dispatch targets the decision's loop.
    expect(dispatchReq.postDataJSON().followUpTo).toBe(workerId);
    expect((await dispatchReq.response()).status()).toBeLessThan(300);
  });

  test('the pinned card dismisses a decision and the false-escalation KPI counts it (LIN-3252 S2/C2)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { decisionId } = await seedSessionWithDecision(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('[data-testid="session-question-card"]');
    await expect(card).toBeVisible();
    const [dismissReq] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dashboard/rulings/dismiss') && r.method() === 'POST'),
      card.locator('[data-testid="session-question-card-dismiss"]').click()
    ]);
    expect(dismissReq.postDataJSON().decisionId).toBe(decisionId);
    expect((await dismissReq.response()).status()).toBe(200);

    // The card goes away and does not come back.
    await expect(page.locator('[data-testid="session-question-card"]')).toHaveCount(0);

    // The dismissal is counted by the false-escalation KPI.
    const kpiResp = await page.request.get(`/workspace/${URL_KEY}/api/escalation-kpis`);
    expect(kpiResp.status()).toBe(200);
    const kpi = await kpiResp.json();
    expect(kpi.falseEscalation.dismissed).toBe(1);
    expect(kpi.falseEscalation.total).toBe(1);
  });

  test('a decision-answer stamp in a run\'s transcript never renders as a chat bubble (LIN-1728 Phase 2, F6)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { workerId, decisionId } = await seedSessionWithDecision(page);
    // Stamp the answer directly through the durable comment route's own write
    // path shape — a `decision-answer` feedback entry — without going through
    // the UI, isolating this test to the transcript-render exclusion (F6).
    const commentResp = await page.request.post(`/workspace/${URL_KEY}/api/comments/LIN-1728`, {
      data: { body: 'recorded', decisionLoopId: workerId, decisionId }
    });
    expect(commentResp.status()).toBe(201);

    // LIN-2209 (F1/L1): a rendered-count assertion alone is not a witness for
    // the write — storage holding 2 entries (a no-op stamp) and storage
    // holding 3 (a real stamp, correctly hidden) both render 2 bubbles below.
    // Read the item back FIRST and prove the stamp actually landed, before
    // asserting anything about rendering.
    const itemResp = await page.request.get(`/test/dispatch-item?urlKey=${URL_KEY}&itemId=${workerId}`);
    expect(itemResp.status()).toBe(200);
    const { feedback } = await itemResp.json();
    expect(feedback.length).toBe(3);
    const stampEntry = feedback.find(f => f.kind === 'decision-answer');
    expect(stampEntry, 'a decision-answer entry must be present in storage').toBeTruthy();
    expect(JSON.parse(stampEntry.message).decision_id).toBe(decisionId);

    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const run = await expandRun(page, 'Decision worker');
    const transcript = run.locator('[data-testid="session-run-transcript"]');
    await expect(transcript).toBeVisible();
    // Exactly the two real entries ([blocked] + the decision itself, which
    // legitimately renders its own raw JSON) produce chat bubbles — the
    // third entry, the decision-answer stamp (just proven present above),
    // must never produce one. A regression (the stamp rendering too) would
    // show as a count of 3.
    await expect(transcript.locator('.chat-msg')).toHaveCount(2);
  });

  // A genuinely issueless run (no issueIdentifier on the dispatch item at all)
  // cannot be produced through this end-to-end path: `_buildLoops`
  // (lib/pipeline-loops.js:246/:267) unconditionally drops any live or history
  // dispatch item with no `issueIdentifier` as "malformed" before it ever
  // reaches session reconstruction, so it can never render as a `session-run`
  // here. The server-side half of the issueless gate (renderInlineReplyBox
  // emitting an empty `data-issue-identifier`) is covered at the unit level
  // instead — tests/unit/render-session.test.js, "issueless gate (LIN-2154)".

  test('an unknown sessionId 404s with a not-found body', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);

    const resp = await page.request.get(`/workspace/${URL_KEY}/observation/session/does-not-exist`);
    expect(resp.status()).toBe(404);
    expect(await resp.text()).toContain('data-testid="session-not-found"');
  });

  test('Observation nav tab is active and links to the feed, not the session page (LIN-1149)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The page rendered.
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    // The page-local back link points to the Observation feed.
    await expect(page.locator('[data-testid="session-back"]'))
      .toHaveAttribute('href', `/workspace/${URL_KEY}/observation`);

    // The shared Observation nav tab is active (aria-current) on the session page.
    const observationTab = page.locator('[data-testid="nav-view-observation"]');
    await expect(observationTab).toBeVisible();
    await expect(observationTab).toHaveAttribute('aria-current', 'page');
    // The Observation tab is a direct link to the feed, not the session page —
    // verified by navigating from a different surface.
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');
    // On the swipe page the Observation tab is a clickable anchor (not active).
    const tabHref = await page.locator('[data-testid="nav-view-observation"]').getAttribute('href');
    expect(tabHref).toBe(`/workspace/${URL_KEY}/observation`);
  });

  // ── LIN-3250: the rewritten run page (header strip, steps, live clocks) ────
  test('renders the header strip and per-step summaries, with no money when unpriced (LIN-3250)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // Header strip: the one progress number, active time, and the wall clock.
    await expect(page.locator('[data-testid="session-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-active-time"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-elapsed"]')).toBeVisible();
    // Reserved paragraph slot for S3 is present (empty).
    await expect(page.locator('[data-testid="session-paragraph"]')).toBeAttached();

    // Steps: each lineage gets a one-line summary above its existing run rows.
    const steps = page.locator('[data-testid="session-step"]');
    await expect(steps.first()).toBeVisible();
    await expect(page.locator('[data-testid="session-step-summary"]').first()).toBeVisible();
    // Every step's summary sits above that step's own run rows.
    await expect(steps.first().locator('[data-testid="session-run"]').first()).toBeVisible();

    // The seeded run carries no usage → the header total is not reported, so
    // there is NO money markup at all (never a zero/placeholder).
    await expect(page.locator('[data-testid="session-cost"]')).toHaveCount(0);
  });

  test('the wall clock and waiting clock carry the timestamps the client ticks from (LIN-3250)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedBlockedSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    // The session is waiting: the waiting clock is rendered with its since stamp.
    const waiting = page.locator('[data-testid="session-waiting-clock"]');
    await expect(waiting).toBeVisible();
    await expect(waiting).toHaveAttribute('data-since', /.+/);
    // The wall clock carries its start (and no end while the run is open).
    const wall = page.locator('[data-testid="session-elapsed"]');
    await expect(wall).toHaveAttribute('data-start', /.+/);
    await expect(wall).toHaveAttribute('data-end', '');
  });

  test('reduced motion leaves the running step dot static (LIN-3250)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedWarmSession(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const dot = page.locator('[data-testid="session-run"][data-status="running"] .status-pill__dot').first();
    await expect(dot).toBeVisible();
    // The ONE pulse rule (the global `.status-pill--running .status-pill__dot`
    // in style.css) is gated behind prefers-reduced-motion: no-preference, so
    // under `reduce` it does not apply at all — the dot has NO animation (name
    // `none`), not merely a neutralized duration. Removing the gate makes this
    // read `pulse` and fails.
    const reducedName = await dot.evaluate((el) => getComputedStyle(el).animationName);
    expect(reducedName).toBe('none');
    const reducedDuration = await dot.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(reducedDuration)).toBeLessThan(0.01);

    // With motion allowed the same dot pulses (real animation, real seconds).
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload({ waitUntil: 'networkidle' });
    const pulsingName = await dot.evaluate((el) => getComputedStyle(el).animationName);
    expect(pulsingName).toBe('pulse');
    const pulsingDuration = await dot.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(pulsingDuration)).toBeGreaterThan(1);
  });

  test('the new header strip and step summaries clear AA contrast in the dark theme (LIN-3250)', async ({ page }) => {
    // Dark is the opt-in `.theme-dark` hook driven by the `theme` cookie.
    await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveClass(/theme-dark/);

    // WCAG 2.x relative-luminance contrast, resolved against the element's
    // effective (first opaque ancestor) background — the same maths
    // tests/unit/theme.test.js uses over the tokens, here on the live computed
    // style of the new strip + step summaries.
    const results = await measureAaContrast(page, ['[data-testid="session-progress"]', '[data-testid="session-active-time"]', '[data-testid="session-elapsed"]', '[data-testid="session-step-summary"]']);

    for (const r of results) {
      expect(r.missing, `no element for ${r.sel}`).toBeFalsy();
      expect(r.ratio, `${r.sel}: ${r.color} on ${r.bg} = ${r.ratio}`).toBeGreaterThanOrEqual(4.5);
    }

    await page.screenshot({ path: test.info().outputPath('session-run-dark.png'), fullPage: true });
  });

  test('the run-page controls clear AA contrast in both themes (LIN-2948 R1)', async ({ page }) => {
    // R1 (review e3328d9b): in dark the card Answer, the chat link and the
    // proposal buttons inherited bare `.action-btn` (no `color`) or the
    // browser-default link colour, measuring 1.65:1 and 1.89:1. Light passes
    // for all of them and must not regress, so both themes are measured.
    await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3001' }]);
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ taskChat: true }))}&urlKey=${URL_KEY}`);
    await clearRuns(page);
    const sessionId = await seedDecisionRunWithProposal(page);

    const selectors = [
      '[data-testid="session-question-card-answer"]',
      '[data-testid="session-question-card-dismiss"]',
      '[data-testid="session-run-chat"]',
      '[data-testid="session-proposal"][data-proposal-status="proposed"] [data-proposal-action="apply"]',
      '[data-testid="session-proposal"][data-proposal-status="proposed"] [data-proposal-action="decline"]',
    ];
    const sessionUrl = `/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`;

    await page.goto(sessionUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    // The proposal row must actually be on the page, or the Apply/Decline
    // selectors would be reported "missing" and the run would be vacuous.
    await expect(page.locator('[data-testid="session-proposals"]')).toBeVisible();
    const dark = await measureAaContrast(page, selectors);
    for (const r of dark) {
      expect(r.missing, `dark: no element for ${r.sel}`).toBeFalsy();
      expect(r.ratio, `dark ${r.sel}: ${r.color} on ${r.bg} = ${r.ratio}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: test.info().outputPath('session-run-controls-dark.png'), fullPage: true });

    // Light: the same controls rendered as default high-contrast text before
    // R1; the themed colours must keep them at AA.
    await page.context().addCookies([{ name: 'theme', value: 'light', url: 'http://localhost:3001' }]);
    await page.goto(sessionUrl);
    await page.waitForLoadState('networkidle');
    const light = await measureAaContrast(page, selectors);
    for (const r of light) {
      expect(r.missing, `light: no element for ${r.sel}`).toBeFalsy();
      expect(r.ratio, `light ${r.sel}: ${r.color} on ${r.bg} = ${r.ratio}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a real stepped single-lineage run reads 3 of 4 with Next: close-out while close-out runs (LIN-3250)', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { anchorId } = await seedSteppedLineageSession(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchorId)}`);
    await page.waitForLoadState('networkidle');

    // The headline number is monotone through the whole rework chain: the
    // finished plan/implementation/review stages count even though the running
    // close-out is the active loop.
    await expect(page.locator('[data-testid="session-progress"]')).toHaveText('3 of 4 stages');
    await expect(page.locator('[data-testid="session-next"]')).toHaveText('Next: close-out');

    // The implementation lineage is one step with all five loops' rows intact.
    const lineageStep = page.locator('[data-testid="session-step"]').filter({ has: page.locator('[data-testid="session-lineage"]') });
    await expect(lineageStep).toHaveCount(1);
    await expect(lineageStep.locator('[data-testid="session-run"]')).toHaveCount(5);
    // Its one-line summary is plain words, computed from the active (close-out) loop.
    await expect(lineageStep.locator('[data-testid="session-step-summary"]')).toHaveText('Close-out · in progress · not reported');

    await page.screenshot({ path: test.info().outputPath('session-run-stepped.png'), fullPage: true });
  });
});

// LIN-1292: the render-side follow-up thread stitch, driven through the REAL
// producer path (the reply box in public/session.js posting {prompt, followUpTo,
// target} with no sessionId) rather than a hand-built fixture — closing the
// close-out ledger's "no test drives a real reply-box POST through the store and
// asserts the follow-up renders inside the original session" gap. A standalone
// (non-autopilot, no-sessionId) anchor is the exact reproduction the ticket
// described: before the stitch, this follow-up fell into LIN-1194 pass 3 and
// surfaced as its own separate session — "vanished discussion."
test.describe('Follow-up thread stitching through the real reply-box path (LIN-1292)', () => {
  test('a human reply to a standalone cli session stitches into the same session, not a new one', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { item: anchor, token } = await seedStandaloneWarm(page, { issueIdentifier: 'LIN-1292', issueTitle: 'Standalone thread-split repro' });

    // The standalone loop reconstructs as its own session keyed by its own dispatch id.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-run"]')).toHaveCount(1);

    // LIN-1163: reply is driven through the (single) run's own inline box —
    // the page-level box this test used to drive is gone. Expand the card
    // first (whole-card click, item 3) to reach the now-collapsed reply.
    const run = page.locator('[data-testid="session-run"]');
    await run.click();
    const box = run.locator('[data-testid="session-inline-reply"]');
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('data-terminal', 'false');

    // Drive the REAL reply-box producer path: fill + send, exactly what a human does.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('one more thing on the flake');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    // The exact wire shape a human reply sends: followUpTo pointing at the
    // standalone anchor's own dispatch id, no sessionId.
    expect(payload.followUpTo).toBe(anchor.id);
    expect(payload.sessionId).toBeUndefined();
    const resp = await request.response();
    expect(resp.status()).toBe(201);
    const followUp = (await resp.json()).item;

    // Drive the follow-up to completion so it carries its own transcript.
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const take2 = await page.request.post(`/api/dispatch/take/${followUp.id}`, { headers: auth });
    expect(take2.status(), `follow-up take failed: ${await take2.text()}`).toBe(200);
    const done2 = await page.request.post(`/api/dispatch/feedback/${followUp.id}`, {
      headers: auth, data: { message: '[done] fixed the flake' }
    });
    expect(done2.status(), `follow-up done feedback failed: ${await done2.text()}`).toBe(200);

    // The live sessions feed: still ONE session at the anchor's id — the follow-up
    // did NOT spawn a second standalone session (the LIN-1292 stitch engaging).
    // Standalone sessions surface only under the Sessions tab (LIN-1194, `?view=sessions`).
    const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions?view=sessions`);
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const all = [...(body.active || []), ...(body.recent || [])];
    const matches = all.filter(s => s.sessionId === anchor.id || s.sessionId === followUp.id);
    expect(matches.map(s => s.sessionId)).toEqual([anchor.id]);

    // The per-session page — reloaded from the ORIGINAL anchor's own URL, the only
    // one a human would have bookmarked — shows BOTH runs: the follow-up's own
    // transcript is reachable from the original session, not vanished into a
    // separate one.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-run"]')).toHaveCount(2);
    const loopIds = await page.locator('[data-testid="session-run"]').evaluateAll(els => els.map(el => el.getAttribute('data-loop-id')));
    expect(loopIds).toContain(anchor.id);
    expect(loopIds).toContain(followUp.id);
    await expect(page.locator('[data-testid="session-page"]')).toContainText('fixed the flake');

    // The follow-up's own dispatch id was never promoted to a session identity of
    // its own — the only live view of it is nested inside the original session.
    const directResp = await page.request.get(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(followUp.id)}`);
    expect(directResp.status()).toBe(404);
  });
});

// LIN-1478 (S2b): the render-edge fold — the third and final clause of
// LIN-1469's regression pin (C1: "a session with >=2 wakes must render as one
// continuous loop card"). Seeded through the REAL dispatch API, same
// producer path as LIN-1292 above: a standalone anchor (own dispatch id, no
// sessionId) driven to a [working] heartbeat, then a REAL reply-box-shaped
// POST ({prompt, followUpTo, target}) that stitches a follow-up into the same
// session and — via dispatch-factory.js's followUpTo inheritance seam —
// inherits the anchor's rootItemId, so this is a genuine lineage, not a
// hand-built one. Left non-terminal (no [done]/[failed]) on both wakes, per
// the ticket's C1 clause: a still-running multi-wake session, not a finished
// one. C2 (advancing heartbeat) and C3 (not stale) are S2a's (LIN-1477),
// unit-only until now — this is their first end-to-end observation, and must
// not regress.
async function seedLineageWarm(page, { issueIdentifier, issueTitle }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'investigate the flake', promptName: 'implementation', kind: 'implementation', issueIdentifier, issueTitle, target: 'cli' }
  });
  expect(res.status(), `anchor seed failed: ${await res.text()}`).toBe(201);
  const anchor = (await res.json()).item;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const take1 = await page.request.post(`/api/dispatch/take/${anchor.id}`, { headers: auth });
  expect(take1.status(), `anchor take failed: ${await take1.text()}`).toBe(200);
  const beat1 = await page.request.post(`/api/dispatch/feedback/${anchor.id}`, {
    headers: auth, data: { message: '[working] 4 tools/20s · alive' }
  });
  expect(beat1.status(), `anchor heartbeat failed: ${await beat1.text()}`).toBe(200);

  // The follow-up, through the SAME wire shape public/session.js's reply box
  // posts (LIN-1292): {prompt, followUpTo, target}, no sessionId.
  const replyRes = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'continue investigating the flake', followUpTo: anchor.id, target: 'cli' }
  });
  expect(replyRes.status(), `follow-up seed failed: ${await replyRes.text()}`).toBe(201);
  const followUp = (await replyRes.json()).item;

  const take2 = await page.request.post(`/api/dispatch/take/${followUp.id}`, { headers: auth });
  expect(take2.status(), `follow-up take failed: ${await take2.text()}`).toBe(200);
  const beat2 = await page.request.post(`/api/dispatch/feedback/${followUp.id}`, {
    headers: auth, data: { message: '[working] 9 tools/45s · alive' }
  });
  expect(beat2.status(), `follow-up heartbeat failed: ${await beat2.text()}`).toBe(200);

  return { anchor, followUp, token };
}

test.describe('Lineage-continuous rendering (LIN-1478)', () => {
  test('a session with >=2 wakes renders one continuous loop card, with an advancing heartbeat and not stale', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { anchor, followUp } = await seedLineageWarm(page, { issueIdentifier: 'LIN-1478', issueTitle: 'Lineage fold repro' });

    // C1 — the fold: exactly one session-lineage container, holding both
    // wakes as still-individually-addressable session-run segments.
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="session-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-lineage"]')).toHaveCount(1);
    const runsInLineage = page.locator('[data-testid="session-lineage"] [data-testid="session-run"]');
    await expect(runsInLineage).toHaveCount(2);
    const loopIds = await runsInLineage.evaluateAll(els => els.map(el => el.getAttribute('data-loop-id')));
    expect(loopIds).toContain(anchor.id);
    expect(loopIds).toContain(followUp.id);

    // C2/C3 (S2a, LIN-1477) observed end-to-end: the session's own feed row
    // shows an advancing heartbeat (the second wake's own peak tool count
    // exceeds the first's — each wake's OWN beat, not a merged/aggregated
    // figure) and the session is not stale.
    const feed = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions?view=sessions`);
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const all = [...(body.active || []), ...(body.recent || [])];
    const s = all.find(x => x.sessionId === anchor.id);
    expect(s, `no session found for anchor ${anchor.id}: ${JSON.stringify(body.counts)}`).toBeTruthy();
    expect(s.stale).toBe(false);
    expect(s.status).toBe('in-progress');
    const wake1 = s.runs.find(r => r.loopId === anchor.id);
    const wake2 = s.runs.find(r => r.loopId === followUp.id);
    expect(wake1, 'first wake present in the session\'s own runs').toBeTruthy();
    expect(wake2, 'second wake present in the session\'s own runs').toBeTruthy();
    expect(wake1.toolPeak).toBe(4);
    expect(wake2.toolPeak).toBe(9);
    expect(wake2.toolPeak).toBeGreaterThan(wake1.toolPeak);
  });

  test('reply targeting + force equivalence: a reply from the folded card posts followUpTo = the lineage tail, never the root', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    const { anchor, followUp } = await seedLineageWarm(page, { issueIdentifier: 'LIN-1478', issueTitle: 'Lineage tail-reply repro' });

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(anchor.id)}`);
    await page.waitForLoadState('networkidle');
    const lineage = page.locator('[data-testid="session-lineage"]');
    await expect(lineage).toHaveCount(1);

    // Exactly ONE reply box for the whole lineage — the tail's own box,
    // hoisted to the container footer, never the root's.
    const box = lineage.locator('[data-testid="session-inline-reply"]');
    await expect(box).toHaveCount(1);
    await expect(box).toHaveAttribute('data-loop-id', followUp.id);
    const boxLoopId = await box.getAttribute('data-loop-id');
    expect(boxLoopId).not.toBe(anchor.id);
    // force equivalence (LIN-1252): both wakes are non-terminal, so
    // data-terminal must be false — the TAIL's own status. If this were
    // wrongly aggregated with any()/all() over the lineage it would still
    // read false here (neither wake is terminal), so this alone doesn't
    // distinguish the derivations — the adversarial cases are unit-tested
    // (tests/unit/render-session.test.js); this pins the byte-for-byte
    // equivalence of the wire shape a real reply produces.
    await expect(box).toHaveAttribute('data-terminal', 'false');

    // Drive the REAL reply-box producer path — exactly what a human does.
    const [request] = await Promise.all([
      page.waitForRequest(r => r.url().includes('/api/dispatch') && r.method() === 'POST'),
      (async () => {
        await box.locator('textarea').fill('one more nudge on the flake');
        await box.locator('[data-testid="session-inline-reply-send"]').click();
      })()
    ]);
    const payload = request.postDataJSON();
    expect(payload.followUpTo).toBe(followUp.id);
    expect(payload.followUpTo).not.toBe(anchor.id);
    const resp = await request.response();
    expect(resp.status()).toBe(201);
  });
});

// ── Credential state (LIN-1588, Beat 2 of LIN-1577) ──────────────────────────
//
// This page is NOT flag-gated, so the credential line ships on the default path
// and must always render — calmly as `unknown` in the ordinary case (~99.86% of
// dispatches carry no joinable credential identity, LIN-1585), and loudly as
// `dead` when Beat 1's verdict says the session's token is stranded.

// Seed an autopilot session whose worker carries a credential identity. The
// `dispatchId` is load-bearing: claiming the item stamps `resolvedAt`, closing
// the loop's match window, so a status row seeded after the take can only attach
// via the matcher's EXACT dispatchId branch (lib/pipeline-loops.js).
async function seedSessionWithCredential(page, { tokenId, tokenLabel = 'dispatch-bootstrap' }) {
  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-1588', issueTitle: 'Credential seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-1588', issueTitle: 'Credential worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
  await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
  await page.request.post('/test/seed-agent-status', {
    data: { urlKey: URL_KEY, taskIdentifier: 'LIN-1588', action: 'implementation', status: 'in_progress', summary: 'working the task', tokenId, tokenLabel, dispatchId: workerId }
  });
  return anchorId;
}

// Beat 1 calls a token dead only with BOTH an exactly-`token_ownerless` note and
// a success (<400) in the window — seed both.
async function seedDeadCredential(page, tokenId) {
  await page.request.get(`/test/seed-proxy-event?urlKey=${URL_KEY}&tokenId=${tokenId}&status=503&note=token_ownerless&endpoint=/api/proxy/issues`);
  await page.request.get(`/test/seed-proxy-event?urlKey=${URL_KEY}&tokenId=${tokenId}&status=201&endpoint=/api/proxy/agent/status`);
}

test.describe('Session credential state (LIN-1588)', () => {
  // These specs seed a deliberately NON-terminal run (a live worker is the whole
  // point of a credential check) plus proxy-event audit rows, and the dev store
  // persists both across files. Clearing only on the way IN would leave that
  // state as the next spec file's starting condition — so this block also
  // clears on the way OUT.
  test.afterEach(async ({ page }) => {
    await clearRuns(page);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
  });

  test('an ordinary session with no credential identity shows the line as `unknown`', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
    await seedSessionWithTranscript(page);
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const line = page.locator('[data-testid="session-credential"]');
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute('data-state', 'unknown');
    await expect(line).toContainText('unknown');
  });

  test('a session whose credential is dead says so', async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
    await clearRuns(page);
    await page.request.get(`/test/clear-proxy-events?urlKey=${URL_KEY}`);
    await seedSessionWithCredential(page, { tokenId: 'tok-sess-dead' });
    await seedDeadCredential(page, 'tok-sess-dead');
    const sessionId = await discoverSessionId(page);

    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(sessionId)}`);
    await page.waitForLoadState('networkidle');

    const line = page.locator('[data-testid="session-credential"]');
    await expect(line).toHaveAttribute('data-state', 'dead');
    await expect(line).toContainText('re-issue the token');
    // The run that carries the token also earns its own chip.
    await expect(page.locator('[data-testid="session-run-credential"]').first()).toBeVisible();
  });
});

// Note: cross-workspace / no-session isolation is workspaceFromUrl's contract
// (shared middleware, covered by existing specs) and is not re-tested here — in
// PAT mode the server auto-recreates a session on the next visit, so "no
// session" is not reproducible from an e2e. The 404 test above already exercises
// this route's own missing-session handling behind a valid session.
