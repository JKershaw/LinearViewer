import { test, expect } from '../fixtures/test-base.js';

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

let URL_KEY;
let SESSION_ID;

// An ~120-char token with no whitespace — the case-chunk overflow fixture
// (an unbroken token with no break rule overflows its banner at narrow width).
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

async function clearRuns(page) {
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

  const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth,
    data: { kind: 'decision', message: `[decision] ${JSON.stringify(DECISION_PAYLOAD)}` }
  });
  expect(decision.status(), `decision feedback failed: ${await decision.text()}`).toBe(200);

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
});

test.describe('Decision-bearing waiting-session layout (LIN-2193)', () => {
  test('desktop: waiting banner spaces the question/case and resets the options list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(SESSION_ID)}`);
    await page.waitForLoadState('networkidle');

    const question = page.locator('[data-testid="session-waiting-decision-question"]');
    const kase = page.locator('[data-testid="session-waiting-decision-case"]');
    const chunks = page.locator('[data-testid="session-waiting-decision-case-chunk"]');
    const optionsList = page.locator('[data-testid="session-waiting-decision-options"]');
    const options = page.locator('[data-testid="session-waiting-decision-option"]');

    await expect(question).toBeVisible();
    await expect(question).not.toHaveText('');
    await expect(kase).toBeVisible();
    await expect(chunks).toHaveCount(2);
    await expect(optionsList).toBeVisible();
    await expect(options).toHaveCount(DECISION_PAYLOAD.options.length);

    // Question -> case spacing: the case starts strictly below the question.
    const [questionBox, caseBox] = await Promise.all([question.boundingBox(), kase.boundingBox()]);
    expect(caseBox.y - (questionBox.y + questionBox.height)).toBeGreaterThan(0);

    // Chunk-to-chunk gap: the second chunk starts strictly below the first
    // chunk's bottom edge (the grid-gap repair, LIN-2184).
    const chunkRects = await chunks.evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }));
    expect(chunkRects[1].top - chunkRects[0].bottom).toBeGreaterThan(0);

    // List reset: a plain <ul> defaults to disc/block; the repair resets it
    // to a flex chip row with no bullets.
    const [listStyleType, display] = await optionsList.evaluate(el => {
      const cs = getComputedStyle(el);
      return [cs.listStyleType, cs.display];
    });
    expect(listStyleType).toBe('none');
    expect(display).toBe('flex');
  });

  test('360px: option chips wrap and stay painted where they render', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(SESSION_ID)}`);
    await page.waitForLoadState('networkidle');

    const banner = page.locator('[data-testid="session-waiting-banner"]');
    const options = page.locator('[data-testid="session-waiting-decision-option"]');
    await expect(banner).toBeVisible();
    const optionCount = await options.count();
    expect(optionCount).toBe(DECISION_PAYLOAD.options.length);

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
      const bannerBox = await banner.boundingBox();
      const result = await chip.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return { right: rect.right, painted: hit === el || el.contains(hit) };
      });
      expect(result.painted).toBe(true);
      expect(result.right).toBeLessThanOrEqual(bannerBox.x + bannerBox.width);
    }
  });

  test('360px: the unbroken token in case prose stays inside the banner', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`/workspace/${URL_KEY}/observation/session/${encodeURIComponent(SESSION_ID)}`);
    await page.waitForLoadState('networkidle');

    const banner = page.locator('[data-testid="session-waiting-banner"]');
    const chunks = page.locator('[data-testid="session-waiting-decision-case-chunk"]');
    await expect(banner).toBeVisible();
    await expect(chunks).toHaveCount(2);
    await expect(chunks.last()).toContainText(UNBROKEN_TOKEN);

    const bannerBox = await banner.boundingBox();
    // Not scrollWidth/clientWidth on the document or the chunk — both
    // measured dead against this regression (see file header). The honest
    // signal is whether the chunk's own painted box stays inside the banner.
    const chunkRights = await chunks.evaluateAll(els => els.map(el => el.getBoundingClientRect().right));
    for (const right of chunkRights) {
      expect(right).toBeLessThanOrEqual(bannerBox.x + bannerBox.width);
    }
  });

  test('feed card: excerpt line-count and option-run stay contained at the measured content widths', async ({ page }) => {
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
      await page.waitForSelector('#obs-active .obs-session .obs-summary-decision-options');

      const excerpt = page.locator('#obs-active .obs-session .obs-summary-decision-excerpt').first();
      await expect(excerpt).toBeVisible();
      await expect(excerpt).not.toHaveText('');

      const { rectsLength, textLength } = await excerpt.evaluate(el => ({
        rectsLength: el.getClientRects().length,
        textLength: el.textContent.length,
      }));
      expect(rectsLength).toBeLessThanOrEqual(2);
      expect(textLength).toBeLessThanOrEqual(66);
    }

    // Option-run clip check (the card clips its own overflow via
    // `.obs-session { overflow: hidden }`) at 360px: the options span's own
    // painted box must stay inside the card, and the point at its own last
    // client rect must resolve back to itself, not the clipping ancestor.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(OBSERVATION_URL);
    await page.waitForSelector('#obs-active .obs-session .obs-summary-decision-options');

    const card = page.locator('#obs-active .obs-session').first();
    const optionsRun = card.locator('.obs-summary-decision-options');
    await expect(optionsRun).toBeVisible();
    await expect(optionsRun).not.toHaveText('');
    await optionsRun.scrollIntoViewIfNeeded();

    // LIN-2195: the ticket's ACTUAL acceptance criterion — "the glance surface
    // should stay glanceable at 360px" — measured rather than asserted in
    // prose. The clip check below proves the run is CONTAINED; containment was
    // already true before this ticket and stayed true while the card grew to 7
    // line boxes, so it cannot witness the growth. This does.
    //
    // Measured RELATIVE to the same run rendered unbounded, in the same element
    // and the same computed style, rather than against a fixed line count. An
    // absolute count is a font-metrics assertion in disguise: it held at <= 2
    // locally and produced 3 in the Linux CI container, where the self-hosted
    // face resolves differently. The relative form asks the question the ticket
    // actually asks — did bounding the run make the glance surface smaller —
    // and is invariant to whatever font the runner ends up with.
    const { boundedLines, unboundedLines } = await optionsRun.evaluate((el, labels) => {
      const probe = el.cloneNode(false);
      probe.textContent = `[${labels.join(' / ')}]`;
      el.parentNode.appendChild(probe);
      const unbounded = probe.getClientRects().length;
      probe.remove();
      return { boundedLines: el.getClientRects().length, unboundedLines: unbounded };
    }, DECISION_PAYLOAD.options.map(o => o.label));

    expect(unboundedLines).toBeGreaterThan(1); // the fixture must actually overflow, or this proves nothing
    expect(boundedLines).toBeLessThan(unboundedLines);
    // A generous absolute ceiling on top, so an unbounded run that happened to
    // fit in 2 lines on some future runner still could not pass silently.
    expect(boundedLines).toBeLessThanOrEqual(3);

    // ...and the run must actually be doing its job — bounded, but not empty,
    // and reporting the remainder rather than silently dropping it. The
    // fixture's 5 options exceed the budget, so a "+N more" marker is expected.
    await expect(optionsRun).toContainText('more');

    const cardBox = await card.boundingBox();
    const result = await optionsRun.evaluate(el => {
      const rects = el.getClientRects();
      const last = rects[rects.length - 1];
      // The horizontal centre of the last line-box, not its edge — a wrapped
      // inline element's fragment boundary is imprecise right at its own
      // edge (kerning/sub-pixel rounding can hand that exact pixel to a
      // sibling or the parent even when healthy), so the centre is the
      // honest point to hit-test.
      const cx = (last.left + last.right) / 2;
      const cy = last.top + last.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return { right: last.right, painted: hit === el || el.contains(hit) };
    });
    expect(result.painted).toBe(true);
    expect(result.right).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  });
});
