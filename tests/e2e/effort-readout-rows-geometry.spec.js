import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';

// LIN-2830: regression witness for the clipped bake-off rows — the RENDERED
// GEOMETRY of `.effort-group-rows`, not the HTML string.
//
// The first LIN-2830 commit landed the per-(harness, model, effort) rows with
// seven FIXED grid tracks (`8.5rem 16rem 5rem 6rem 6rem 5rem auto` ≈ 792px of
// content) inside `.kpi-card`s laid out by `.kpi-grid`'s
// `repeat(auto-fit, minmax(220px, 1fr))` — so a card is ~263px wide at a
// 1440px viewport while its rows need ~792px. Fixed tracks do not shrink, and
// `html`/`body` carry a deliberate site-wide `overflow-x: clip`
// (public/style.css, LIN-1068) — clip, not auto, so nothing recovers the
// overflow: the effort/lineages/cost/duration columns were unreachable, and
// `anthropic/claude-sonnet-5` was cut to the same visible prefix as
// `anthropic/claude-opus-5`, so the two models were indistinguishable. Green
// CI never noticed because every existing test asserts the HTML string, none
// the layout — this spec is the pinned rendered-geometry witness (the same
// discipline as flight-companion-prestart-overflow.spec.js, LIN-2715).
//
// Legs:
//   - wide viewports (1440, 1024): every cell of every row — head included —
//     paints fully INSIDE its `.effort-group-rows` box, and the box itself
//     needs no scroll (scrollWidth == clientWidth): the bake-off columns are
//     visible at rest, zero interaction.
//   - phone viewport (375): the rows block IS its own scroll container
//     (overflow-x: auto — unaffected by the body's clip), its content is
//     genuinely wider than the card (fixture guard), and the rightmost cells
//     are reachable by scrolling — while the card itself stays inside the
//     viewport (no page-level blowout).
//
// Seeding rides the REAL flow (the escalation-kpis.spec.js pattern): dispatch
// items are created through the workspace dispatch API, claimed via a consumer
// token's take (which archives them to history as `taken`), then fed
// `[usage]` + `[done]` feedback exactly the way the runners post it
// (`[usage] ${JSON.stringify(payload)}` with `kind: 'usage'`). The workspace is
// a seeded LOCAL provider workspace, so the route's per-issue provider reads
// (comments/description for LOCAL-1) genuinely resolve.

let URL_KEY;
let PAGE_URL;

// One issue per lineage: the dispatch-create route's duplicate guard
// (LIN-1656) refuses a second fresh dispatch for the same issueIdentifier+kind
// within 5 minutes, so sibling lineages cannot share an issue at seeding time.
// The rows themselves group by (harness, model, effort) across ALL issues, so
// distinct issues still land as sibling rows on one kind card.
function geometrySeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    projects: [{ id: id('geom-proj'), name: 'Geometry Project', content: null, sortOrder: 1 }],
    issues: [1, 2, 3, 4, 5].map((n) => ({
      id: id(`geom-issue-${n}`), identifier: `GEOM-${n}`, title: `Geometry task ${n}`,
      description: 'Geometry fixture issue — rows-geometry witness corpus',
      projectId: id('geom-proj'), sortOrder: n,
      state: { name: 'In Progress', type: 'started' },
      url: `/workspace/${urlKey}/issue/${id(`geom-issue-${n}`)}`,
    })),
  };
}

test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/effort-readout`;
  // Seeded LOCAL provider workspace, so the read-out route's per-issue
  // provider reads (comments/description per GEOM-n) genuinely resolve.
  await seedLocal(geometrySeed(URL_KEY));
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);

  for (const lineage of LINEAGES) {
    await seedWorkerLineage(page, lineage);
  }
});

// One row per distinct realised (harness, model, effort) triple. The exact
// review-measured clipping case is here: two claude-code models sharing a
// 16-character prefix, plus the acceptance row (opencode posts no `effort`
// key by design, so its effort cell must render "—", never vanish).
const LINEAGES = [
  { issue: 'GEOM-1', kind: 'implementation', usage: { harness: 'opencode', model: 'z-ai/glm-5.3', lane: 'openrouter', costUsd: 0.03 } },
  { issue: 'GEOM-2', kind: 'implementation', usage: { harness: 'claude-code', model: 'anthropic/claude-sonnet-5', effort: 'high', costUsd: 12.34 } },
  { issue: 'GEOM-3', kind: 'implementation', usage: { harness: 'claude-code', model: 'anthropic/claude-opus-5', effort: 'high', costUsd: 45.67 } },
  // No costUsd and no priceable token fields → an UNPRICED lineage, so the
  // row's 7th (auto) column — the per-row coverage disclosure — renders.
  { issue: 'GEOM-4', kind: 'implementation', usage: { harness: 'opencode', model: 'deepseek/deepseek-v4.1-flash', lane: 'openrouter' } },
  { issue: 'GEOM-5', kind: 'plan', usage: { harness: 'opencode', model: 'z-ai/glm-5.3', lane: 'openrouter', costUsd: 0.02 } },
];

const EXPECTED_ROW_COUNTS = { implementation: 4, plan: 1 };

// Mirrors the real runner contract (hook.js/opencode-runner.js): `[usage] …`
// feedback with kind 'usage', then a terminal `[done]` marker so the lineage
// is eligible (a taken row with no terminal marker reads as in-flight, and an
// in-flight row never reaches a kind card).
async function seedWorkerLineage(page, { issue, kind, usage }) {
  const create = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: {
      prompt: 'geometry fixture', promptName: kind, kind,
      issueIdentifier: issue, issueTitle: 'Geometry fixture', target: 'cli',
    },
  });
  expect(create.status()).toBe(201);
  const itemId = (await create.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const take = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
  expect(take.status()).toBe(200);

  const usagePost = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: auth, data: { kind: 'usage', message: `[usage] ${JSON.stringify(usage)}` },
  });
  expect(usagePost.status()).toBe(200);

  const done = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: auth, data: { message: '[done] complete' },
  });
  expect(done.status()).toBe(200);
  return itemId;
}

/**
 * Measure the rendered geometry of one kind card's rows block: the box, its
 * scroll state, and every cell (head + rows) with two per-cell facts —
 * `insideBox` (the cell's border box fits entirely within the rows block's
 * border box) and `textFits` (the cell's own content is not clipped inside
 * the cell). `insideBox` is the review's exact complaint made testable: on
 * the unfixed page the fixed tracks push cells up to ~792px wide inside a
 * ~230px box, so every column past the second fails it.
 */
async function measureRows(page, kind) {
  return page.evaluate((k) => {
    const box = document.querySelector(`[data-testid="effort-card-rows-${k}"]`);
    if (!box) return null;
    const boxRect = box.getBoundingClientRect();
    const cellInfo = (cell) => {
      const r = cell.getBoundingClientRect();
      return {
        text: (cell.textContent || '').trim(),
        left: r.left,
        right: r.right,
        insideBox: r.left >= boxRect.left - 0.5 && r.right <= boxRect.right + 0.5,
        textFits: cell.scrollWidth <= cell.clientWidth + 1,
      };
    };
    const head = box.querySelector('.effort-group-rows-head');
    const rows = Array.from(box.querySelectorAll('.effort-group-row'));
    return {
      boxWidth: boxRect.width,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      overflowX: getComputedStyle(box).overflowX,
      rowCount: rows.length,
      headCells: head ? Array.from(head.children).map(cellInfo) : [],
      rowCells: rows.map((row) => Array.from(row.children).map(cellInfo)),
    };
  }, kind);
}

function allCells(measurement) {
  return [...measurement.headCells, ...measurement.rowCells.flat()];
}

function cellsOutside(measurement) {
  return allCells(measurement).filter((c) => !c.insideBox).map((c) => c.text);
}

test.describe('effort-readout rows geometry (LIN-2830)', () => {
  test('the bake-off rows render through the real dispatch flow', async ({ page }) => {
    const resp = await page.goto(PAGE_URL);
    expect(resp.status()).toBe(200);

    const implRows = page.locator('[data-testid="effort-card-rows-implementation"]');
    await expect(implRows).toBeVisible();

    // The acceptance line, on the painted page: the first opencode run is
    // its own row with harness `opencode`, model `z-ai/glm-5.3`, effort "—"
    // (no effort key on the payload — the row must survive, not vanish).
    const implText = await implRows.textContent();
    expect(implText).toContain('opencode');
    expect(implText).toContain('z-ai/glm-5.3');
    expect(implText).toContain('anthropic/claude-sonnet-5');
    expect(implText).toContain('anthropic/claude-opus-5');
    expect(implText).toContain('$0.03');
    expect(implText).toContain('0 of 1 priced');

    // Four distinct (harness, model, effort) rows on the implementation card.
    const measurement = await measureRows(page, 'implementation');
    expect(measurement.rowCount).toBe(EXPECTED_ROW_COUNTS.implementation);

    // The effort-less opencode row renders "—" in the effort column.
    const effortCells = measurement.rowCells.map((cells) => cells[2]?.text);
    expect(effortCells).toContain('—');
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    test.describe(`${viewport.width}x${viewport.height} desktop — columns visible at rest`, () => {
      test.use({ viewport });

      test('every rows cell paints fully inside its rows block, no scroll needed', async ({ page }) => {
        await page.goto(PAGE_URL);

        for (const kind of Object.keys(EXPECTED_ROW_COUNTS)) {
          const m = await measureRows(page, kind);
          expect(m, `no rows block rendered for kind ${kind}`).not.toBeNull();
          // Fixture guard: the geometry assertions are meaningless without
          // the seeded rows actually rendering.
          expect(m.rowCount).toBe(EXPECTED_ROW_COUNTS[kind]);

          // The bake-off columns are visible at rest — the box holds all its
          // content without scrolling.
          expect(m.scrollWidth, `${kind}: rows block needs a scrollbar at ${viewport.width}px`).toBeLessThanOrEqual(m.clientWidth + 1);

          // Every cell — head labels and row cells alike — fits entirely
          // inside the rows block. On the unfixed page this fails for every
          // column past the model prefix (~792px of fixed tracks in a
          // ~230-1100px-wide box's card).
          const outside = cellsOutside(m);
          expect(outside, `${kind}: cells painting outside the rows block: ${outside.join(' | ')}`).toEqual([]);

          // No cell clips its own text (guards a "fix" that shrinks tracks
          // below their content instead of reflowing the layout).
          const clipped = allCells(m).filter((c) => !c.textFits).map((c) => c.text);
          expect(clipped, `${kind}: cells clipping their own text: ${clipped.join(' | ')}`).toEqual([]);

          // The two long model names — the review's distinguishability
          // complaint — are fully laid out, not just present in the DOM.
          if (kind === 'implementation') {
            const texts = m.rowCells.flat().map((c) => c.text);
            expect(texts).toContain('anthropic/claude-sonnet-5');
            expect(texts).toContain('anthropic/claude-opus-5');
          }
        }
      });
    });
  }

  test.describe('375x812 phone — rows block is a scroll container, content reachable', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('the rows block scrolls its own content and the card stays inside the viewport', async ({ page }) => {
      await page.goto(PAGE_URL);

      const card = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="effort-card-implementation"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      expect(card).not.toBeNull();
      // No page-level blowout: the card's own box never leaves the viewport
      // (guards a fix that widens the CARD instead of reflowing its content —
      // html/body `overflow-x: clip` would eat the difference unreadably).
      expect(card.right).toBeLessThanOrEqual(375 + 0.5);
      expect(card.left).toBeGreaterThanOrEqual(-0.5);

      const before = await measureRows(page, 'implementation');
      expect(before.rowCount).toBe(EXPECTED_ROW_COUNTS.implementation);

      // Fixture guard: at this width the seeded rows genuinely overflow the
      // card — if they ever stop doing so, the reachability leg below is
      // vacuous and must be re-thought, not silently kept.
      expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);

      // The rows block is its OWN scroll container — the one escape hatch
      // from the site-wide `overflow-x: clip` (a bare `visible`/`clip` box
      // here means the overflow is simply unreachable again).
      expect(before.overflowX).toBe('auto');

      // Reachability: scroll fully right — the DURATION cell (the last fixed
      // column) must come fully inside the box. On the unfixed page the box
      // is not scrollable at all, so the cell stays out.
      const rightmost = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="effort-card-rows-implementation"]');
        box.scrollLeft = box.scrollWidth;
        const boxRect = box.getBoundingClientRect();
        const firstRow = box.querySelector('.effort-group-row');
        const cells = Array.from(firstRow.children).filter((c) => c.classList.contains('effort-group-cell'));
        const duration = cells[cells.length - 1];
        const r = duration.getBoundingClientRect();
        const coverage = firstRow.querySelector('.effort-group-coverage');
        const cr = coverage ? coverage.getBoundingClientRect() : null;
        return {
          inside: r.left >= boxRect.left - 0.5 && r.right <= boxRect.right + 0.5,
          coverageInside: cr ? cr.left >= boxRect.left - 0.5 && cr.right <= boxRect.right + 0.5 : null,
          scrollLeft: box.scrollLeft,
        };
      });
      expect(rightmost.inside, 'duration cell unreachable after full scroll').toBe(true);

      // No cell clips its own text while scrolled.
      const afterScroll = await measureRows(page, 'implementation');
      const clipped = allCells(afterScroll).filter((c) => !c.textFits).map((c) => c.text);
      expect(clipped, `cells clipping their own text at 375px: ${clipped.join(' | ')}`).toEqual([]);

      // Scroll back to the left edge — the harness cell is reachable too.
      const leftmost = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="effort-card-rows-implementation"]');
        box.scrollLeft = 0;
        const boxRect = box.getBoundingClientRect();
        const harness = box.querySelector('.effort-group-row .effort-group-harness');
        const r = harness.getBoundingClientRect();
        return { inside: r.left >= boxRect.left - 0.5 && r.right <= boxRect.right + 0.5 };
      });
      expect(leftmost.inside, 'harness cell unreachable after scrolling back left').toBe(true);
    });
  });
});
