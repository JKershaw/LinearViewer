import { test, expect } from '../fixtures/test-base.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';
import { seedHistoryFeedback } from '../fixtures/history-feedback.js';

// LIN-2193: real-Chromium, real-stylesheet coverage for a decision-bearing
// waiting session. LIN-2184 shipped three CSS regressions in a row on this
// exact surface (missing decision classes, an option-run clip against
// `.obs-session { overflow: hidden }`, and an unbroken-token overflow in the
// case prose) and every one was invisible to 7,334 unit tests and four green
// E2E shards: no e2e spec rendered a decision-bearing session at all, and
// `tests/unit/observation-render.test.js` evaluates public/observation.js's
// markup as an HTML *string* in a vm sandbox, so a correct string can still
// paint wrong. This file renders the real surface and asserts on computed
// layout/paint (relations, counts, elementFromPoint), never markup strings
// or document overflow — `document.documentElement.scrollWidth - clientWidth`
// and `el.scrollWidth - el.clientWidth` both measured DEAD (0) under all
// three regressions, because `.sess-page`/`.obs-session` clip their own
// overflow and the case chunk grows past its parent rather than overflowing
// itself.
//
// Seeding mirrors session-page.spec.js/observation.spec.js: an autopilot
// anchor + a worker carrying sessionId, taken via the real consumer token
// flow, then real feedback posts (never a store poke). Feedback ORDER is
// load-bearing — correlateDecisionCase (lib/pipeline-loops.js) takes only
// the maximal contiguous `assistant-text` run immediately preceding the
// `decision` entry, and deriveSessionWaiting (routes/dashboard.js) needs the
// `[blocked]` marker for `waitingMessage` — so every seed here posts exactly:
// 2x assistant-text (the second carrying an unbroken long token, the
// case-chunk-overflow fixture), 1x decision, 1x bare [blocked].
//
// LIN-4538 (P7a): the run page pins the question RECORDS the run asked
// (lib/question-record-card.js), not the old decision card, so the three
// run-page tests read a question record (QUESTION below) asked by a run of its
// own, parked on `[blocked]` so the card is answerable (QUESTION_RUN; the
// session's anchor above is never taken, so its run reads as still working
// and its card would be read-only). A question record has no case prose: the unbroken-token
// overflow fixture moves into the question's own text. The feed-card test
// still reads an old `decision` row, which the Observation feed card shows as
// history: its sentence and case excerpt, with no answer choices (LIN-4541,
// which also writes that row through the history seam, since no route
// writes the kind now).

let URL_KEY;
let SESSION_ID;
let QUESTION_RUN;

// An ~120-char token with no whitespace — the case-chunk overflow fixture
// (an unbroken token with no break rule overflows its card at narrow width).
const UNBROKEN_TOKEN = 'https://example.com/investigations/rollout-strategy-comparison-report-detailed-analysis-doc-2026-08-22-final-version-x7';

const DECISION_PAYLOAD = {
  decision_id: 'lin-2193-layout-decision',
  question: 'Which deployment strategy should we use for the rollout?',
  options: [
    { id: 'blue-green', label: 'Blue-green deployment' },
    { id: 'canary', label: 'Canary rollout' },
    { id: 'rolling', label: 'Rolling update' },
    { id: 'big-bang', label: 'Big-bang cutover' },
    { id: 'feature-flag', label: 'Feature-flag gated release' },
  ],
};

// The question the run page pins: five options (the chip-wrap fixture) and an
// unbroken token in its text (the overflow fixture).
const QUESTION = {
  asks: `Which deployment strategy should we use for the rollout? Notes: ${UNBROKEN_TOKEN}`,
  options: DECISION_PAYLOAD.options.map(o => o.label),
  recommended: 'Canary rollout',
};

async function clearRuns(page) {
  await page.goto(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
}

// Seed an autopilot anchor + worker driven through the real take+feedback
// flow to a decision-bearing waiting state. Positional order is load-bearing
// (see file header) — do not reorder these posts.
async function seedDecisionSession(page) {
  await page.goto(`/test/set-session?urlKey=${URL_KEY}`);

  const anchor = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-2193', issueTitle: 'Decision-layout seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;

  const worker = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-2193', issueTitle: 'Decision-layout worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);

  const note1 = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: { kind: 'assistant-text', message: 'Investigated the rollout options across three environments and compared their risk profiles.' }
  });
  expect(note1.status(), `first assistant-text failed: ${await note1.text()}`).toBe(200);

  const note2 = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: { kind: 'assistant-text', message: `Full investigation notes: ${UNBROKEN_TOKEN}` }
  });
  expect(note2.status(), `second assistant-text failed: ${await note2.text()}`).toBe(200);

  // LIN-4541: the feedback route refuses a decision entry now, so the old row is written as it was stored (history seam).
  await seedHistoryFeedback(page, URL_KEY, workerId, [{ kind: 'decision', message: `[decision] ${JSON.stringify(DECISION_PAYLOAD)}` }]);

  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: { message: '[blocked] need your decision on the rollout strategy' }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);
}

// Discover sessionId from the sessions feed (never guessed), and gate on the
// derived decision/waiting facts before touching the UI — mirrors
// session-page.spec.js:296-300, so a seeding-order mistake surfaces here
// rather than being misread as a layout failure later.
//
// Polled, not a one-shot read: lib/sessions-feed-cache.js is a 5s
// stale-while-revalidate cache whose clear() cannot cancel an in-flight
// producer, so a session seeded right after clearRuns can briefly race a
// stale/incomplete snapshot back into the cache. This spec's predicate is
// stricter than session-page.spec.js's (a decision_id match plus a non-empty
// decisionCase, not just a non-empty sessionId), which makes it more exposed
// to that window — a first-attempt CI flake (LIN-2193 review/close-out)
// failed here and passed on the very next retry ~1.4s later.
async function discoverSessionId(page) {
  let seeded = null;
  await expect
    .poll(
      async () => {
        const resp = await page.request.get(`/workspace/${URL_KEY}/api/dashboard/sessions`);
        expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
        const body = await resp.json();
        const all = [...(body.active || []), ...(body.recent || [])];
        const candidate = all.find(s => s.decision && s.decision.decision_id === DECISION_PAYLOAD.decision_id);
        seeded =
          candidate &&
          candidate.waiting === true &&
          candidate.status === 'waiting' &&
          Array.isArray(candidate.decisionCase) &&
          candidate.decisionCase.length > 0
            ? candidate
            : null;
        return seeded;
      },
      { timeout: 10000, message: 'no decision-bearing waiting session appeared in the feed' }
    )
    .not.toBeNull();
  return seeded.sessionId;
}

// Each test gets its own fresh seed (clearRuns + reseed), consistent with
// session-page.spec.js/observation.spec.js's per-test seeding pattern — no
// dependency between scenarios, no shared afterEach.
test.beforeEach(async ({ page, workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  await clearRuns(page);
  await seedDecisionSession(page);
  SESSION_ID = await discoverSessionId(page);
  // Its own ticket: the dispatch route refuses a second implementation run on LIN-2193 within moments of the first.
  QUESTION_RUN = await askingRun(page, URL_KEY, 'LIN-2194');
  await seedQuestion(page, URL_KEY, { ticket: 'LIN-2194', runId: QUESTION_RUN, ...QUESTION });
});

test.describe('Decision-bearing waiting-session layout (LIN-2193)', () => {
  test('desktop: the question card spaces the question and lays the options out as a chip row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(QUESTION_RUN)}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('[data-testid="question-record-card"]');
    const question = card.locator('[data-testid="question-record-card-question"]');
    const optionsList = card.locator('[data-testid="question-record-card-options"]');
    const options = card.locator('[data-testid="question-record-card-option"]');

    await expect(card).toBeVisible();
    await expect(question).toBeVisible();
    await expect(question).not.toHaveText('');
    await expect(optionsList).toBeVisible();
    await expect(options).toHaveCount(QUESTION.options.length);

    // Question -> options spacing: the options start strictly below the question.
    const [questionBox, optionsBox] = await Promise.all([question.boundingBox(), optionsList.boundingBox()]);
    expect(optionsBox.y - (questionBox.y + questionBox.height)).toBeGreaterThan(0);

    // LIN-4114: the options are buttons in a labelled group (no list any more), laid out as a flex chip row.
    const [role, display] = await optionsList.evaluate(el => [el.getAttribute('role'), getComputedStyle(el).display]);
    expect(role).toBe('group');
    expect(display).toBe('flex');
  });

  test('360px: option chips wrap and stay painted where they render', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(QUESTION_RUN)}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('[data-testid="question-record-card"]');
    const options = card.locator('[data-testid="question-record-card-option"]');
    await expect(card).toBeVisible();
    const optionCount = await options.count();
    expect(optionCount).toBe(QUESTION.options.length);

    // Paint-identity per chip (elementFromPoint at the chip's own centre):
    // toBeVisible()/boundingBox() describe the chip's own box and are blind
    // to an ancestor overflow:hidden clip — this is the honest instrument
    // for the option-run clip regression (per live-console.spec.js's
    // established precedent). Scrolled into view first — elementFromPoint
    // only hit-tests the currently visible viewport, and the option run at
    // 360px commonly runs past the fold.
    for (let i = 0; i < optionCount; i++) {
      const chip = options.nth(i);
      await chip.scrollIntoViewIfNeeded();
      const cardBox = await card.boundingBox();
      const result = await chip.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return { right: rect.right, painted: hit === el || el.contains(hit) };
      });
      expect(result.painted).toBe(true);
      expect(result.right).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
  });

  test('360px: the unbroken token in the question text stays inside the card', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(QUESTION_RUN)}`);
    await page.waitForLoadState('networkidle');

    const card = page.locator('[data-testid="question-record-card"]');
    const question = card.locator('[data-testid="question-record-card-question"]');
    await expect(card).toBeVisible();
    await expect(question).toContainText(UNBROKEN_TOKEN);

    const cardBox = await card.boundingBox();
    // Not scrollWidth/clientWidth on the document or the text — both
    // measured dead against this kind of regression (see file header). The
    // honest signal is whether the text's own painted lines stay inside the card.
    const lineRights = await question.evaluate(el => [...el.getClientRects()].map(r => r.right));
    expect(lineRights.length).toBeGreaterThan(0);
    for (const right of lineRights) {
      expect(right).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
  });

  test('feed card: the excerpt line-count stays contained at the measured content widths, and an old decision offers no choices (LIN-4541)', async ({ page }) => {
    const OBSERVATION_URL = `/workspace/${URL_KEY}/observation`;

    // .obs-page's content width is 460.8px at a 600px viewport and 588.0px at
    // a 1000px viewport (measured; NOT 480px, which under-shoots to 428.8px
    // after body padding). The excerpt's healthy line-box count at these two
    // widths is 2; at 360px it is 3, so the <=2 assertion belongs only here.
    for (const viewportWidth of [600, 1000]) {
      await page.setViewportSize({ width: viewportWidth, height: 800 });
      await page.goto(OBSERVATION_URL);
      // The feed card is client-rendered from a poll — wait for it before
      // measuring; expect()'s 5s default is tighter than first poll+paint.
      await page.waitForSelector('#obs-active .obs-session .obs-summary-decision-excerpt');

      const excerpt = page.locator('#obs-active .obs-session .obs-summary-decision-excerpt').first();
      await expect(excerpt).toBeVisible();
      await expect(excerpt).not.toHaveText('');

      const { rectsLength, textLength } = await excerpt.evaluate(el => ({
        rectsLength: el.getClientRects().length,
        textLength: el.textContent.length,
      }));
      expect(rectsLength).toBeLessThanOrEqual(2);
      expect(textLength).toBeLessThanOrEqual(66);
      // LIN-4541: a question is answered on its question record's card; an old decision on the feed card offers nothing to pick.
      await expect(page.locator('#obs-active .obs-session .obs-summary-decision-options')).toHaveCount(0);
    }
  });
});
