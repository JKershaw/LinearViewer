/**
 * LIN-4555 (LIN-4546 piece 7, "Done when": a test scans the six surfaces for raw ids and ISO times).
 *
 * Nothing a person reads is raw (LIN-4546, "The feel"): no internal task record id (`task-037eb576`), no person id
 * (`person:acct-…`), no ISO time. In the walk's workspace (tests/fixtures/question-walk.js: three long questions asked as before
 * LIN-4550, one quoting a task record id; 36 notes to the owner, many quoting ids, person ids and stamps; running runs; an asking
 * run), each of the six surfaces is loaded as the owner and as a member, everything a person can open on it is opened (the full
 * question, the notes past the fold and each note's whole text, each run's detail on Runs, each step's transcript on the run page,
 * Flight Companion's fold, its turn mocked as tests/e2e/flight-companion.spec.js mocks it), and the page's visible text
 * (`document.body.innerText`, so what is drawn and shown, not attributes or closed folds) is scanned.
 *
 * Excluded, and only this: the task page's "Task details — ids, times, counts…" fold (SELECTORS.taskPage.details), which shows the
 * task's ids by design (its summary says so); it is hidden while the page's text is read. Nothing is allowlisted.
 *
 * Seeded through tests/fixtures/local-harness.js (via the walk fixture); selectors through SELECTORS.
 */
import { test, expect } from '../fixtures/test-base.js';
import { SELECTORS } from '../helpers.js';
import { seedQuestionWalk, becomeMember, mockPendingDecisions, walkSurfaces } from '../fixtures/question-walk.js';

test.setTimeout(240000);

/** What a person would call raw. Not narrowed to get green: any task record id, any person id, any ISO time. */
const RAW = [
  ['a task record id', /\btask-[0-9a-f]{6,}\b/g],
  ['a person id', /\bperson:[A-Za-z0-9_.-]+/g],
  ['an ISO time', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^\s]*/g],
];
/** Hidden while the text is read: the task details fold shows ids by design. */
const EXCLUDED = [SELECTORS.taskPage.details];

/** The page's visible text with the excluded parts hidden, then shown again. */
function visibleText(page) {
  return page.evaluate((excluded) => {
    const els = excluded.flatMap((sel) => [...document.querySelectorAll(sel)]);
    const before = els.map((el) => el.style.display);
    for (const el of els) el.style.display = 'none';
    const text = document.body.innerText;
    els.forEach((el, i) => { el.style.display = before[i]; });
    return text;
  }, EXCLUDED);
}

/** Each raw match with a little of the text around it, so a failure names what a person would see. */
function rawIn(text) {
  const found = [];
  for (const [what, pattern] of RAW) {
    for (const m of text.matchAll(pattern)) {
      found.push(`${what}: "${m[0]}" in "…${text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30).replace(/\s+/g, ' ')}…"`);
    }
  }
  return found;
}

for (const role of ['owner', 'member']) {
  test(`${role}: no raw task id, person id or ISO time on any of the six surfaces, with everything opened`, async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
    const { runId, rows } = await seedQuestionWalk(page, seedLocal, urlKey);
    if (role === 'member') await becomeMember(page, urlKey);
    await mockPendingDecisions(page, rows);
    await page.clock.install();
    await page.setViewportSize({ width: 1280, height: 900 });
    const caught = [];
    for (const surface of walkSurfaces({ urlKey, runId, role })) {
      if (surface.before) await surface.before(page);
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle');
      await surface.open(page);
      const text = await visibleText(page);
      expect(text.length, `${surface.name} (${role}) drew some text`).toBeGreaterThan(200);
      for (const hit of rawIn(text)) caught.push(`${surface.name} (${role}): ${hit}`);
    }
    expect(caught, `raw text a person would see:\n${caught.join('\n')}`).toEqual([]);
  });
}
