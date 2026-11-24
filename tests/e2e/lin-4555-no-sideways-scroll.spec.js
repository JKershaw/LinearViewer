/**
 * LIN-4555 (LIN-4546 piece 7, "Done when": no sideways scroll at 390px).
 *
 * In the walk's workspace (tests/fixtures/question-walk.js: long questions with lists and long options, dozens of notes, running
 * runs, an asking run), each of the six surfaces (Home, the Questions page, Runs, a task page, a run page, Flight Companion) is
 * loaded at 390x844, in light and in dark, as the owner and as a member, with everything a person can open on it opened (the same
 * walkSurfaces as the raw-text scan), and the page must not scroll sideways:
 *   - document.documentElement.scrollWidth is at most its clientWidth; and, because that alone cannot fail here,
 *   - no element a person can see reaches past the screen's left or right edge unless an ancestor below the root contains it (a
 *     scroll box, or a deliberate clip such as a title's ellipsis). The root and body clip horizontal overflow (`overflow-x: clip`,
 *     public/style.css, LIN-1068, which keeps the sticky header working), so a too-wide element never makes the page scroll: it is
 *     cut off at the screen's edge instead, and scrollWidth stays equal to clientWidth. The second check is what a sideways scroll
 *     would have shown without the clip.
 * One seed per role.
 *
 * Seeded through tests/fixtures/local-harness.js (via the walk fixture); selectors through SELECTORS.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedQuestionWalk, becomeMember, setTheme, mockPendingDecisions, walkSurfaces } from '../fixtures/question-walk.js';

test.setTimeout(240000);

/**
 * In the page: the root's scroll and client widths, and each visible element that reaches past the screen's edge with nothing
 * below the root to contain it (an ancestor whose overflow-x is not `visible` contains it: it scrolls or clips there on purpose).
 */
function escapes() {
  const root = document.documentElement;
  const vw = root.clientWidth;
  const escaped = [];
  const containedBelowRoot = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== root; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (containedBelowRoot(el)) continue;
    const id = el.getAttribute('data-testid') || String(el.className || '').split(' ')[0] || el.tagName.toLowerCase();
    escaped.push(`${el.tagName.toLowerCase()} "${id}" spans ${Math.round(r.left)}..${Math.round(r.right)} on a ${vw}px screen`);
  }
  return { scrollWidth: root.scrollWidth, clientWidth: vw, escaped: escaped.slice(0, 8) };
}

for (const role of ['owner', 'member']) {
  test(`${role}: no sideways scroll at 390px on any of the six surfaces, light and dark, with everything opened`, async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
    const { runId, rows } = await seedQuestionWalk(page, seedLocal, urlKey);
    if (role === 'member') await becomeMember(page, urlKey);
    await mockPendingDecisions(page, rows);
    await page.clock.install();
    await page.setViewportSize({ width: 390, height: 844 });
    const wide = [];
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      for (const surface of walkSurfaces({ urlKey, runId, role })) {
        if (surface.before) await surface.before(page);
        await page.goto(surface.path);
        await page.waitForLoadState('networkidle');
        await surface.open(page);
        const { scrollWidth, clientWidth, escaped } = await page.evaluate(escapes);
        if (scrollWidth > clientWidth) wide.push(`${surface.name} (${role}, ${theme}): scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`);
        for (const el of escaped) wide.push(`${surface.name} (${role}, ${theme}): ${el}`);
      }
    }
    expect(wide, `sideways scroll at 390px:\n${wide.join('\n')}`).toEqual([]);
  });
}
