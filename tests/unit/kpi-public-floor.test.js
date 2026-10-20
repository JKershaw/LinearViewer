/**
 * LIN-3703: the public /kpis view and its small-count floor.
 *
 * Run with: node --test tests/unit/kpi-public-floor.test.js
 *
 * Every number below comes from PUBLIC_COUNT_FLOOR, never a literal, so a
 * change to the constant moves the tests with it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { toPublicKpis, PUBLIC_COUNT_FLOOR, PUBLIC_LEAF_REGISTRY } from '../../lib/kpi-stats.js';
import { buildStats, buildFunnel, buildMode, buildCost, STEP_KEYS } from '../helpers/public-kpis-fixture.js';

const F = PUBLIC_COUNT_FLOOR;
const GRID = Array.from({ length: F + 3 }, (_, v) => v); // 0 .. F+2
const BELOW = { hidden: 'below-floor' };
const WITHHELD = { hidden: 'withheld' };

const isLow = v => typeof v === 'number' && v >= 1 && v < F;

// The leaves of a payload: numbers, plus `{ hidden }` markers (one leaf each).
// Paths write array indexes as `[]`, the registry's convention.
function leaves(value, path = '', out = []) {
  if (typeof value === 'number') out.push({ path, value });
  else if (value && typeof value === 'object' && 'hidden' in value) out.push({ path, value });
  else if (Array.isArray(value)) value.forEach(item => leaves(item, `${path}[]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const stepCount = (view, key) => view.milestoneFunnel.steps[key].count;

describe('PUBLIC_COUNT_FLOOR', () => {
  test('is 5 (the operator default; John to confirm)', () => {
    assert.strictEqual(PUBLIC_COUNT_FLOOR, 5);
  });
});

describe('toPublicKpis: a floored leaf on its own', () => {
  test('workspaces is exact at 0 and at the floor and above, hidden below it', () => {
    for (const v of GRID) {
      const got = toPublicKpis(buildStats({ workspaces: v })).totals.workspaces;
      assert.deepStrictEqual(got, isLow(v) ? BELOW : v, `workspaces=${v}`);
    }
  });

  test('a count at floor-1 is below-floor: not no-signal, not 0', () => {
    const got = toPublicKpis(buildStats({ workspaces: F - 1 })).totals.workspaces;
    assert.deepStrictEqual(got, BELOW);
    assert.notStrictEqual(got, 0);
    assert.strictEqual(toPublicKpis(buildStats({ workspaces: F })).totals.workspaces, F);
  });

  for (const key of STEP_KEYS) {
    test(`step ${key}, seeded alone (others 0), follows the leaf rule across the grid`, () => {
      for (const v of GRID) {
        const view = toPublicKpis(buildStats({ funnel: buildFunnel({ [key]: v }) }));
        assert.deepStrictEqual(stepCount(view, key), isLow(v) ? BELOW : v, `${key}=${v}`);
        assert.strictEqual(view.milestoneFunnel.steps[key].state, 'reached');
      }
    });
  }

  const modeLeaves = [
    ['total', v => buildMode(v, [[0, 0], [0, 0]]), m => m.total],
    ['byRung[0].entries', v => buildMode(0, [[v, 0], [0, 0]]), m => m.byRung[0].entries],
    ['byRung[0].notReady', v => buildMode(0, [[0, v], [0, 0]]), m => m.byRung[0].notReady],
    ['byRung[1].entries', v => buildMode(0, [[0, 0], [v, 0]]), m => m.byRung[1].entries],
    ['byRung[1].notReady', v => buildMode(0, [[0, 0], [0, v]]), m => m.byRung[1].notReady]
  ];
  for (const [name, seed, pick] of modeLeaves) {
    test(`mode.${name}, seeded alone (others 0), follows the leaf rule across the grid`, () => {
      for (const v of GRID) {
        const view = toPublicKpis(buildStats({ funnel: buildFunnel({}, seed(v)) }));
        assert.deepStrictEqual(pick(view.milestoneFunnel.mode), isLow(v) ? BELOW : v, `${name}=${v}`);
      }
    });
  }

  test('a no-signal step stays a "could not read" step: count null, never 0 or hidden', () => {
    const view = toPublicKpis(buildStats({ funnel: buildFunnel({ login: F - 1, prOpened: null }) }));
    assert.deepStrictEqual(view.milestoneFunnel.steps.prOpened, { state: 'no-signal', count: null, coverage: 'prOpened: app-defined coverage label' });
    assert.deepStrictEqual(stepCount(view, 'login'), BELOW);
  });

  test('an absent mode stays null', () => {
    assert.strictEqual(toPublicKpis(buildStats({ funnel: buildFunnel({ login: 9 }, null) })).milestoneFunnel.mode, null);
  });
});

describe('toPublicKpis: suppress the dependents', () => {
  test('one low step withholds every other nonzero step, even a large one', () => {
    const view = toPublicKpis(buildStats({ funnel: buildFunnel({ login: 400, connected: F - 1, firstGo: F + 10, prOpened: 0, mergeClicked: null }) }));
    assert.deepStrictEqual(stepCount(view, 'login'), WITHHELD);
    assert.deepStrictEqual(stepCount(view, 'connected'), BELOW);
    assert.deepStrictEqual(stepCount(view, 'firstGo'), WITHHELD);
    assert.strictEqual(stepCount(view, 'prOpened'), 0, 'zero stays 0');
    assert.strictEqual(view.milestoneFunnel.steps.mergeClicked.count, null);
  });

  test('two large steps whose difference is below the floor are both withheld (container minus part)', () => {
    const view = toPublicKpis(buildStats({ funnel: buildFunnel({ login: 40 + F, connected: 40 + 1, firstGo: 0, prOpened: 0 }) }));
    assert.deepStrictEqual(stepCount(view, 'login'), WITHHELD);
    assert.deepStrictEqual(stepCount(view, 'connected'), WITHHELD);
    assert.strictEqual(stepCount(view, 'firstGo'), 0);
  });

  test('steps whose differences are all clear of the floor are published exactly', () => {
    const view = toPublicKpis(buildStats({ funnel: buildFunnel({ login: 10 * F, connected: 5 * F, firstGo: 3 * F, prOpened: F, mergeClicked: 0 }) }));
    assert.deepStrictEqual(STEP_KEYS.map(k => stepCount(view, k)), [10 * F, 5 * F, 3 * F, F, 0]);
  });

  test('a rung with entries well above floor but notReady one short of it is withheld (part and its container)', () => {
    const mode = buildMode(2 * F, [[F + 2, F - 1], [F - 2, 0]]);
    const view = toPublicKpis(buildStats({ funnel: buildFunnel({}, mode) }));
    const out = view.milestoneFunnel.mode;
    assert.deepStrictEqual(out.byRung[0].notReady, BELOW);
    assert.deepStrictEqual(out.byRung[0].entries, WITHHELD);
    assert.deepStrictEqual(out.byRung[1].entries, BELOW);
    assert.deepStrictEqual(out.total, WITHHELD);
    assert.strictEqual(out.byRung[1].notReady, 0);
  });

  test('entries minus notReady below the floor withholds the rung and the total', () => {
    const mode = buildMode(10 * F, [[5 * F, 5 * F - 2], [5 * F, 0]]);
    const out = toPublicKpis(buildStats({ funnel: buildFunnel({}, mode) })).milestoneFunnel.mode;
    assert.deepStrictEqual(out.total, WITHHELD);
    assert.deepStrictEqual(out.byRung[0].entries, WITHHELD);
    assert.deepStrictEqual(out.byRung[0].notReady, WITHHELD);
    assert.deepStrictEqual(out.byRung[1].entries, WITHHELD);
    assert.strictEqual(out.byRung[1].notReady, 0);
  });

  test('total minus a subset of the rungs below the floor withholds the group', () => {
    // total is not the sum of the rungs here: the reader can still form total - rungs.
    const mode = buildMode(10 * F + 2, [[5 * F, 0], [5 * F, 0]]);
    const out = toPublicKpis(buildStats({ funnel: buildFunnel({}, mode) })).milestoneFunnel.mode;
    assert.deepStrictEqual(out.total, WITHHELD);
    assert.deepStrictEqual(out.byRung[0].entries, WITHHELD);
  });

  test('a clean mode block is published exactly', () => {
    const mode = buildMode(10 * F, [[6 * F, 2 * F], [4 * F, 0]]);
    const out = toPublicKpis(buildStats({ funnel: buildFunnel({}, mode) })).milestoneFunnel.mode;
    assert.deepStrictEqual([out.total, out.byRung[0].entries, out.byRung[0].notReady, out.byRung[1].entries, out.byRung[1].notReady], [10 * F, 6 * F, 2 * F, 4 * F, 0]);
  });

  test('the steps group and the mode group do not suppress each other, nor does workspaces', () => {
    const view = toPublicKpis(buildStats({ workspaces: F - 1, funnel: buildFunnel({ login: F - 1 }, buildMode(10 * F, [[10 * F, 0]])) }));
    assert.deepStrictEqual(view.totals.workspaces, BELOW);
    assert.strictEqual(view.milestoneFunnel.mode.total, 10 * F);
  });
});

describe('toPublicKpis: no raw below-floor value survives', () => {
  // Every floored leaf, over the grid, in a sparse instance.
  test('structural walk: no floored leaf is a number in 1..floor-1, over a seeded grid', () => {
    const flooredPaths = new Set(PUBLIC_LEAF_REGISTRY.filter(e => e.kind === 'floored').map(e => e.path));
    let checked = 0;
    for (const a of GRID) {
      for (const b of GRID) {
        const funnel = buildFunnel({ login: a, connected: b, firstGo: a, prOpened: b, mergeClicked: a }, buildMode(a + b, [[a, b], [b, a], [a, a]]));
        const view = toPublicKpis(buildStats({ workspaces: a, funnel }));
        for (const { path, value } of leaves(view)) {
          if (!flooredPaths.has(path)) continue;
          checked++;
          assert.ok(!isLow(value), `${path} = ${JSON.stringify(value)} (a=${a}, b=${b})`);
        }
      }
    }
    assert.ok(checked > 0);
  });

  test('registry walk: every numeric leaf of a real payload is classified', () => {
    const registered = new Set(PUBLIC_LEAF_REGISTRY.map(e => e.path));
    const sparse = buildStats({ workspaces: 2, funnel: buildFunnel({ login: 2, connected: 1 }, buildMode(3, [[2, 1], [1, 0], [0, 0]])) });
    const seen = new Set();
    for (const stats of [sparse, buildStats()]) {
      for (const { path } of leaves(toPublicKpis(stats))) {
        seen.add(path);
        assert.ok(registered.has(path), `unclassified numeric leaf: ${path}`);
      }
    }
    // And the registry has no entry the payload cannot produce.
    for (const path of registered) assert.ok(seen.has(path), `registry entry never emitted: ${path}`);
  });

  // LIN-3710
  test('the five trend-chart leaves are registered open, and weeklyDone is not a leaf', () => {
    const paths = ['outcomes.weeklyFailed[]', 'outcomes.weeklyAborted[]', 'daily.dispatches[]', 'daily.autopilotRuns[]', 'daily.done[]'];
    for (const path of paths) {
      assert.strictEqual(PUBLIC_LEAF_REGISTRY.find(e => e.path === path)?.kind, 'open', path);
    }
    assert.ok(!PUBLIC_LEAF_REGISTRY.some(e => e.path.includes('weeklyDone')));
    assert.ok(!JSON.stringify(toPublicKpis(buildStats())).includes('weeklyDone'));
  });

  test('every daily array has one point per phases day, and a week\'s done is derivable', () => {
    for (const stats of [buildStats(), buildStats({ fullSeries: true })]) {
      const view = toPublicKpis(stats);
      for (const [name, series] of Object.entries(view.daily)) {
        assert.strictEqual(series.length, view.phases.days.length, name);
      }
      assert.ok(!('days' in view.daily));
      view.outcomes.weeklyResolved.forEach((resolved, i) => {
        assert.ok(resolved - view.outcomes.weeklyFailed[i] - view.outcomes.weeklyAborted[i] >= 0);
      });
    }
  });

  test('the registry classes every entry and names the group of each floored one', () => {
    for (const entry of PUBLIC_LEAF_REGISTRY) {
      assert.ok(entry.kind === 'open' || entry.kind === 'floored', entry.path);
      assert.ok(entry.why, entry.path);
      if (entry.kind === 'floored') assert.ok('group' in entry, entry.path);
    }
  });

  // The recovery attempt: from what the reader can SEE, form every sum and
  // difference the relations allow, and none may land in 1..floor-1.
  const visible = (...cells) => cells.filter(c => typeof c === 'number');
  const pairCombos = values => values.flatMap((a, i) => values.flatMap((b, j) => (i === j ? [] : [a - b, a + b])));

  test('recovery grid, steps: no sum or difference of the visible steps is in 1..floor-1', () => {
    let seeds = 0;
    for (const a of GRID) for (const b of GRID) for (const c of GRID) for (const d of GRID) for (const e of GRID) {
      const view = toPublicKpis(buildStats({ funnel: buildFunnel({ login: a, connected: b, firstGo: c, prOpened: d, mergeClicked: e }) }));
      const shown = visible(...STEP_KEYS.map(k => stepCount(view, k)));
      for (const value of [...shown, ...pairCombos(shown)]) assert.ok(!isLow(value), `steps ${[a, b, c, d, e]} -> ${value}`);
      seeds++;
    }
    assert.strictEqual(seeds, GRID.length ** 5);
  });

  test('recovery grid, mode: no member, subset sum, total-minus-rungs or entries-minus-notReady is in 1..floor-1', () => {
    for (const t of GRID) for (const e0 of GRID) for (const n0 of GRID) for (const e1 of GRID) for (const n1 of GRID) {
      const out = toPublicKpis(buildStats({ funnel: buildFunnel({}, buildMode(t, [[e0, n0], [e1, n1]])) })).milestoneFunnel.mode;
      const [r0, r1] = out.byRung;
      const entries = visible(r0.entries, r1.entries);
      const forms = [
        ...visible(out.total, r0.entries, r0.notReady, r1.entries, r1.notReady),
        ...entries.map(x => x),
        entries.reduce((a, b) => a + b, 0)
      ];
      if (typeof out.total === 'number') {
        forms.push(out.total - entries.reduce((a, b) => a + b, 0), ...entries.map(x => out.total - x));
      }
      for (const [r] of [[r0], [r1]]) {
        if (typeof r.entries === 'number' && typeof r.notReady === 'number') forms.push(r.entries - r.notReady);
      }
      for (const value of forms) assert.ok(!isLow(value), `mode ${[t, e0, n0, e1, n1]} -> ${value}`);
    }
  });
});

describe('toPublicKpis: the view is only what the page draws', () => {
  const view = toPublicKpis(buildStats());

  test('top-level keys', () => {
    assert.deepStrictEqual(Object.keys(view).sort(), ['cost', 'daily', 'dispatchKinds', 'generatedAt', 'milestoneFunnel', 'outcomes', 'phases', 'totals']);
  });

  test('operator-only and undrawn fields are not published', () => {
    const text = JSON.stringify(view);
    for (const dropped of ['terminalMarkedTaskCost', 'weeklyBudgetGauge', 'stepOutcomes', 'proxyStatus', 'topEndpoints', 'hourOfDay', 'freeTier', 'vanity', 'dbBackend', 'localIssues', 'activeTokens', 'activeSessions', 'users', 'proxyCategoriesHourly', 'dispatchByDay', 'surfaces']) {
      assert.ok(!text.includes(`"${dropped}"`), dropped);
    }
  });

  test('does not mutate its input', () => {
    const stats = buildStats({ workspaces: 2, funnel: buildFunnel({ login: 2, connected: 90 }, buildMode(3, [[2, 1]])) });
    const before = JSON.stringify(stats);
    toPublicKpis(stats);
    assert.strictEqual(JSON.stringify(stats), before);
  });

  test('passes the exact counts the page headlines through untouched', () => {
    assert.deepStrictEqual(view.outcomes.done, 41);
    assert.deepStrictEqual(view.totals.agentActions, 1234);
    assert.deepStrictEqual(view.dispatchKinds, [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }]);
    assert.deepStrictEqual(view.phases.orienting, [10, 20]);
  });
});

// LIN-3714: the cost-per-finished-task block.
describe('toPublicKpis: cost (LIN-3714)', () => {
  const costOf = overrides => toPublicKpis(buildStats({ terminalMarkedTaskCost: buildCost(overrides) })).cost;

  test('holds only the picked keys, even if the stats carry cash, unresolved and issue counts', () => {
    const cost = costOf({ cashUsd: 12.34, inFlightUsd: 5.67, issueCount: 99 });
    assert.deepStrictEqual(Object.keys(cost), ['windowDays', 'perTaskUsd', 'tasks', 'shares']);
    assert.deepStrictEqual(Object.keys(cost.shares).sort(), [
      'attributableLineageShare', 'captureRateShare', 'closeOutLineageShare', 'evidenceLinkedShare',
      'opencodeSummedShare', 'pricedLineageShare', 'unknownHarnessShare'
    ]);
    const text = JSON.stringify(toPublicKpis(buildStats({ terminalMarkedTaskCost: buildCost({ cashUsd: 12.34, inFlightUsd: 5.67, issueCount: 99 }) })));
    for (const dropped of ['cashUsd', 'inFlightUsd', 'overheadUsd', 'unknownLaneUsd', 'issueCount', 'unpriced', 'laneLandedCount', 'noLineageCount', 'markerOccupancyShare', 'markerOccupiedLineages', 'ticketsPerPricedLane', 'costUsd', 'pricedTicketCostUsd', '12.34', '5.67']) {
      assert.ok(!text.includes(dropped), dropped);
    }
  });

  test('divides pricedTicketCostUsd (not costUsd) by pricedTicketCount, to 2 decimals', () => {
    assert.strictEqual(costOf({ pricedTicketCostUsd: 100, pricedTicketCount: 8, costUsd: 999 }).perTaskUsd, 12.5);
    assert.strictEqual(costOf({ pricedTicketCostUsd: 10, pricedTicketCount: 6 }).perTaskUsd, 1.67);
    assert.strictEqual(costOf({ pricedTicketCostUsd: 100 }).tasks, 8);
    assert.strictEqual(costOf().windowDays, 30);
  });

  test('perTaskUsd is null, never 0, when nothing is priced', () => {
    assert.strictEqual(costOf({ pricedTicketCostUsd: null }).perTaskUsd, null);
  });

  test('the small-sample rule: tasks at floor-1 publishes cost null, at the floor a figure', () => {
    for (const tasks of [0, 1, F - 1]) assert.strictEqual(costOf({ pricedTicketCount: tasks }), null, `tasks=${tasks}`);
    assert.strictEqual(F, 5);
    assert.strictEqual(costOf({ pricedTicketCount: 4 }), null);
    assert.strictEqual(costOf({ pricedTicketCount: 5, pricedTicketCostUsd: 10 }).perTaskUsd, 2);
  });

  test('no terminal-marked-task-cost in the stats publishes cost null', () => {
    assert.strictEqual(toPublicKpis(buildStats({ terminalMarkedTaskCost: undefined })).cost, null);
  });

  test('every cost leaf is registered open, and the reason says it is not a count of people', () => {
    const entries = PUBLIC_LEAF_REGISTRY.filter(e => e.path.startsWith('cost.'));
    assert.strictEqual(entries.length, 3 + 7);
    for (const entry of entries) {
      assert.strictEqual(entry.kind, 'open', entry.path);
      assert.match(entry.why, /average or ratio .* not a count of people/);
    }
  });

  test('the builder name, exports and emitted fields never use the reserved wording', () => {
    assert.ok(!/verif/i.test(JSON.stringify(costOf())));
  });
});
