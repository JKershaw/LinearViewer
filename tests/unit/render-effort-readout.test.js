/**
 * Unit tests for lib/render-effort-readout.js (LIN-2641).
 *
 * Every assertion here runs the real renderer over a real
 * `computeEffortReadout` result — the ruling (`5ec445a0`) requires the suite
 * to own the runtime claims, so no fixture is hand-shaped to bypass the
 * compute layer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffortReadout } from '../../lib/effort-readout.js';
import { renderEffortReadoutPage } from '../../lib/render-effort-readout.js';

const ASOF = '2026-09-05T16:00:00.000Z';

function doneRow({ id, issueId, issueIdentifier, kind, dispatchedAt, completedAt }) {
  return {
    id, issueId, issueIdentifier, kind, status: 'taken', dispatchedAt,
    feedback: [{ message: '[done] complete', timestamp: completedAt }],
  };
}

function render(readout) {
  return renderEffortReadoutPage('Workspace', {
    urlKey: 'ws', workspaces: [], featureFlags: {}, readout, generatedAt: ASOF,
  });
}

function readoutOver(rows, { issueContext = new Map(), liveRows = [], historyTotal, skipped = 0 } = {}) {
  return computeEffortReadout({
    liveRows, historyRows: rows, historyTotal, issueContext, asOf: ASOF, skipped,
  });
}

describe('survival states render distinct copy (D8)', () => {
  const rows = [
    doneRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'research', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
    doneRow({ id: 'r2', issueId: 'i2', issueIdentifier: 'LIN-2', kind: 'custom', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
    doneRow({ id: 'r3', issueId: 'i3', issueIdentifier: 'LIN-3', kind: 'close-out', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
  ];
  const html = render(readoutOver(rows));

  test('research renders "not instrumented" (state ii)', () => {
    assert.match(html, /not instrumented/);
  });

  test('an orchestration kind renders "not applicable — orchestration step" (state iii)', () => {
    assert.match(html, /not applicable — orchestration step/);
  });

  test('a no-gate-pair kind renders its own distinct copy (state iv), never conflated with ii or iii', () => {
    assert.match(html, /not applicable — no next-gate pair defined for this kind/);
  });

  test('all three states are distinct strings on one page', () => {
    const states = [
      'not instrumented',
      'not applicable — orchestration step',
      'not applicable — no next-gate pair defined for this kind',
    ];
    for (const s of states) assert.ok(html.includes(s), `missing: ${s}`);
  });
});

describe('per-kind cards and markup conventions (D3, S1 sweep)', () => {
  const rows = [
    doneRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
    doneRow({ id: 'r2', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'plan-review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:30:00.000Z' }),
  ];
  const html = render(readoutOver(rows, {
    issueContext: new Map([['LIN-1', { id: 'i1', comments: [{ id: 'c1', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z' }] }]]),
  }));

  test('emits no <table> element (the repo has zero table markup in lib/*.js)', () => {
    assert.ok(!/<table/i.test(html));
  });

  test('every kind present gets its own data-testid card', () => {
    assert.match(html, /data-testid="effort-card-plan"/);
    assert.match(html, /data-testid="effort-card-plan-review"/);
    assert.match(html, /data-testid="effort-grid"/);
  });
});

describe('D10 — the ship-empty effort caption names LIN-2567', () => {
  test('the caption is on the surface, naming the dependency and that it self-populates', () => {
    const html = render(readoutOver([]));
    assert.match(html, /data-testid="effort-caption-ship-empty"/);
    assert.match(html, /LIN-2567/);
    assert.match(html, /does not yet report a realised effort value/);
  });

  test('a kind whose worker sessions report no effort renders "not reported", never a substituted requested value', () => {
    // The raw dispatch row carries a REQUESTED effort of 'high'; the realised
    // (telemetry) value is absent, so the cell must stay "not reported".
    const row = {
      ...doneRow({ id: 'r1', issueId: 'i1', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
      effort: 'high',
    };
    const readout = readoutOver([row]);
    const implCard = readout.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.effort, null, 'requested row-level effort must never populate the realised cell');
    const html = render(readout);
    assert.match(html, /data-testid="effort-card-effort-implementation">not reported</);
    assert.ok(!/effort-card-effort-implementation">high/.test(html));
  });
});

describe('A3 — the two survival rates are not presented as comparable', () => {
  test('the tier-c count renders beside the implementation rate, not folded into it', () => {
    const rows = [
      doneRow({ id: 'a1', issueId: 'ia', issueIdentifier: 'LIN-A', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:20:00.000Z' }),
      doneRow({ id: 'a2', issueId: 'ia', issueIdentifier: 'LIN-A', kind: 'review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:20:00.000Z' }),
      doneRow({ id: 'b1', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'implementation', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:20:00.000Z' }),
      doneRow({ id: 'b2', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:20:00.000Z' }),
      doneRow({ id: 'b3', issueId: 'ib', issueIdentifier: 'LIN-B', kind: 'implementation', dispatchedAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T02:20:00.000Z' }),
    ];
    const readout = readoutOver(rows, {
      issueContext: new Map([
        ['LIN-A', { id: 'ia', comments: [{ id: 'ca', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z' }] }],
        ['LIN-B', { id: 'ib', comments: [] }],
      ]),
    });
    const html = render(readout);
    assert.match(html, /tier a\/b only/);
    assert.match(html, /tier-c re-pass(es)? shown separately/);
  });

  test('a footnote states the plan and implementation rates are not directly comparable', () => {
    const html = render(readoutOver([]));
    assert.match(html, /not directly comparable/);
  });
});

describe('"what this does not measure" and the anchor-attribution note', () => {
  const html = render(readoutOver([]));

  test('names the plan-pair-only gate fields', () => {
    assert.match(html, /plan-pair-only/);
  });

  test('names the anchor-attributed cost unit (LIN-2253 assumption, D5)', () => {
    assert.match(html, /per dispatch LINEAGE \(anchor-attributed\)/);
  });

  test('discloses the sibling-completeness bound (J2)', () => {
    assert.match(html, /sibling rows fall outside the 200-row history window is right-censored/);
  });

  test('discloses the reused walk\'s own kind blindness (B4) — a card without a gate figure is explained', () => {
    // `pipelineRowsOf` drops rows whose kind buckets as orchestration, and
    // `bug`/`defer` fall through that map — so they are invisible to the
    // survival walk while still getting a state-(iv) card here.
    assert.match(html, /invisible to survival while still reporting cost, duration and effort/);
  });
});

describe('population caption states the two real bounds (H1)', () => {
  test('live queue is TTL-scoped and explicitly NOT row-limited; history is the resolved-order row bound', () => {
    const html = render(readoutOver([], { liveRows: [], historyTotal: 250 }));
    assert.match(html, /TTL-scoped, not row-limited/);
    assert.match(html, /most-recently-resolved rows/);
    assert.ok(!/live.{0,40}limit(ed)? to \d+/i.test(html), 'must not claim a live-side row cap');
  });

  test('a history read past its bound renders "showing N of TOTAL" with the truncation stated', () => {
    const rows = Array.from({ length: 3 }, (_, i) => doneRow({
      id: `r${i}`, issueId: `i${i}`, issueIdentifier: `LIN-${i}`, kind: 'plan',
      dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z',
    }));
    const html = render(readoutOver(rows, { historyTotal: 250 }));
    assert.match(html, /showing 3 of 250/);
    assert.match(html, /truncated to the 200-row bound/);
  });
});

describe('completeness is visible when a read was skipped (D2)', () => {
  test('skipped > 0 renders the incomplete notice with the skip count', () => {
    const html = render(readoutOver([], { skipped: 2 }));
    assert.match(html, /data-testid="effort-completeness"/);
    assert.match(html, /2 issue read\(s\) skipped/);
  });

  test('a complete read says so rather than staying silent', () => {
    const html = render(readoutOver([]));
    assert.match(html, /complete\./);
  });
});
