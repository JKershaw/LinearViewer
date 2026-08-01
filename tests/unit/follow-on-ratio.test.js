/**
 * Unit tests for lib/follow-on-ratio.js (LIN-1654 — LIN-1601 Phase 0 / LIN-1600 S6).
 *
 * The pure half of the follow-on-ratio baseline: the "before" number LIN-1600's
 * falsifiable close is judged against one cycle after the `plan-review` gate
 * lands. `scripts/follow-on-ratio.mjs` owns the network read; nothing here
 * touches it.
 *
 * FIXTURES ARE INLINE LITERALS MIRRORING THE REAL WIRE SHAPE — the detail
 * payload `GET /api/proxy/issues/{id}` actually returns, verified live against
 * the proxy while writing these tests:
 *
 *   { id: '<uuid>', identifier: 'LIN-1654', title: '…', description: '…',
 *     state: { name: 'Todo', type: 'unstarted' }, trashed: null,
 *     assignee: null, labels: [], priority: 2, priorityLabel: 'High',
 *     createdAt: '2026-07-26T17:47:03.919Z', completedAt: null,
 *     team: {…}, project: {…}, parent: {…}|null, children: [{id,identifier,…}],
 *     comments: [{ id, body, createdAt }],
 *     relations:        [{ id, type: 'blocks', relatedIssue: { id, identifier, state } }],
 *     inverseRelations: [{ id, type: 'blocks', issue:        { id, identifier, state } }] }
 *
 * Note the two relation arms nest the peer under DIFFERENT keys (`relatedIssue`
 * vs `issue`) — that asymmetry is the highest-consequence detail in the metric
 * (5 of 6 counted follow-ups in the planning probe arrived on the inverse arm),
 * so it is pinned explicitly in group C.
 *
 * No network, no clock, no fixture files. Every instant is a literal, and group
 * F pins fixtures decades in the past AND the future so the suite fails the
 * moment anyone introduces a clock read into the module.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFollowOnRatio, isVerifiedDone, countFollowOns, __internal,
} from '../../lib/follow-on-ratio.js';

// ─── fixture builders (literal wire shape, parameterised only where a case varies) ──

const WINDOW = {
  windowStart: '2026-06-01T00:00:00.000Z',
  windowEnd: '2026-07-01T00:00:00.000Z',
  asOf: '2026-07-01T12:00:00.000Z',
};

/** A done task as the detail endpoint returns it. */
function source(id, completedAt, extra = {}) {
  return {
    id,
    identifier: `LIN-${id}`,
    title: `source ${id}`,
    description: '',
    state: { name: 'Done', type: 'completed' },
    trashed: null,
    labels: [],
    priority: 2,
    priorityLabel: 'High',
    createdAt: '2026-05-01T00:00:00.000Z',
    completedAt,
    parent: null,
    children: [],
    comments: [],
    relations: [],
    inverseRelations: [],
    ...extra,
  };
}

/** A peer issue — only `id` / `createdAt` / `parent` are load-bearing for the metric. */
function peer(id, createdAt, extra = {}) {
  return {
    id,
    identifier: `LIN-${id}`,
    title: `peer ${id}`,
    state: { name: 'Todo', type: 'unstarted' },
    trashed: null,
    createdAt,
    completedAt: null,
    parent: null,
    children: [],
    comments: [],
    relations: [],
    inverseRelations: [],
    ...extra,
  };
}

const outgoing = (type, peerId) => ({ id: `rel-${type}-${peerId}`, type, relatedIssue: { id: peerId, identifier: `LIN-${peerId}`, title: `peer ${peerId}`, state: { name: 'Todo', type: 'unstarted' } } });
const inverse = (type, peerId) => ({ id: `inv-${type}-${peerId}`, type, issue: { id: peerId, identifier: `LIN-${peerId}`, title: `peer ${peerId}`, state: { name: 'Todo', type: 'unstarted' } } });

const run = (issues, options = {}) => computeFollowOnRatio(issues, { ...WINDOW, ...options });

/**
 * A cohort of `n` completed sources carrying `m` qualifying peers between them,
 * for the sufficiency-floor edges. Built from the same literal shape above —
 * 33 hand-written sources would obscure the one number each case is about.
 */
function cohort(n, m) {
  const issues = [];
  let made = 0;
  for (let i = 0; i < n; i += 1) {
    const relations = [];
    // Spread the peers across the first sources, up to 2 each.
    while (made < m && relations.length < 2) {
      const pid = `p${made}`;
      relations.push(outgoing('related', pid));
      issues.push(peer(pid, '2026-06-20T00:00:00.000Z'));
      made += 1;
      if (made % Math.max(1, Math.ceil(m / n)) === 0) break;
    }
    issues.push(source(`s${i}`, '2026-06-10T00:00:00.000Z', { relations }));
  }
  // Any peers left over hang off the last source.
  const last = issues.filter((x) => x.state.type === 'completed').pop();
  while (made < m) {
    const pid = `p${made}`;
    last.relations.push(outgoing('related', pid));
    issues.push(peer(pid, '2026-06-20T00:00:00.000Z'));
    made += 1;
  }
  return issues;
}

// ─── A. Denominator — `state.type === 'completed'`, written literally ─────────

describe('A. denominator — state.type === "completed" alone', () => {
  test('a completed issue whose completedAt falls in the window enters the denominator', () => {
    const r = run([source('a', '2026-06-15T00:00:00.000Z')]);
    assert.equal(r.denominator, 1);
    assert.equal(r.diagnostics.inWindowCompletions, 1);
  });

  test('canceled and duplicate in the window are EXCLUDED — the +13.7% trap', () => {
    // THE assertion this file exists for. `isCompleted()`/`isTerminalState()`
    // (lib/providers/state-map.js:17-19,:26) return true for all three states
    // below; on this workspace that inflates the denominator 1,035 → 1,177.
    // The module must import neither, and count only the first issue.
    const issues = [
      source('done', '2026-06-15T00:00:00.000Z'),
      { ...source('cancelled', '2026-06-15T00:00:00.000Z'), state: { name: 'Canceled', type: 'canceled' } },
      { ...source('dupe', '2026-06-15T00:00:00.000Z'), state: { name: 'Duplicate', type: 'duplicate' } },
    ];
    const r = run(issues);
    assert.equal(r.denominator, 1, 'canceled and duplicate must not enter D');
    assert.equal(r.scale.totalCompleted, 1, 'nor the workspace-scale completed count');
    // Stated the other way round, so a regression names the cause:
    assert.equal(isVerifiedDone(issues[1]), false, 'canceled is not verified-done');
    assert.equal(isVerifiedDone(issues[2]), false, 'duplicate is not verified-done');
  });

  test('started / unstarted / backlog are excluded', () => {
    const r = run([
      { ...source('s', '2026-06-15T00:00:00.000Z'), state: { name: 'In Progress', type: 'started' } },
      { ...source('u', '2026-06-15T00:00:00.000Z'), state: { name: 'Todo', type: 'unstarted' } },
      { ...source('b', '2026-06-15T00:00:00.000Z'), state: { name: 'Backlog', type: 'backlog' } },
    ]);
    assert.equal(r.denominator, 0);
    assert.equal(r.ratio, null);
  });

  test('a malformed or missing state is tolerated, not thrown', () => {
    const r = run([
      { ...source('n', '2026-06-15T00:00:00.000Z'), state: null },
      { ...source('e', '2026-06-15T00:00:00.000Z'), state: {} },
      { ...source('ok', '2026-06-15T00:00:00.000Z') },
      null,
      'not an issue',
    ]);
    assert.equal(r.denominator, 1);
    assert.equal(isVerifiedDone(undefined), false);
  });

  test('a trashed issue is excluded — both via the proxy state rewrite and the flag', () => {
    // routes/proxy.js's applyTrashedSignal returns 200 for a trashed issue with
    // state rewritten to {name:'Trashed', type:'canceled'}; the raw flag is the
    // belt-and-braces path for a payload that was not rewritten.
    const r = run([
      { ...source('rewritten', '2026-06-15T00:00:00.000Z'), trashed: true, state: { name: 'Trashed', type: 'canceled' } },
      { ...source('flagged', '2026-06-15T00:00:00.000Z'), trashed: true },
    ]);
    assert.equal(r.denominator, 0);
  });

  test('isVerifiedDone is the narrow predicate, exercised directly', () => {
    assert.equal(isVerifiedDone({ state: { type: 'completed' } }), true);
    assert.equal(isVerifiedDone({ state: { type: 'completed' }, trashed: null }), true, 'the proxy sends trashed:null on a live issue');
    assert.equal(isVerifiedDone({ state: { type: 'completed' }, trashed: true }), false);
    assert.equal(isVerifiedDone({ state: { type: 'canceled' } }), false);
    assert.equal(isVerifiedDone({ state: { type: 'duplicate' } }), false);
    assert.equal(isVerifiedDone({}), false);
    assert.equal(isVerifiedDone(null), false);
  });
});

// ─── B. Window boundaries — parameters only, half-open so windows tile ────────

describe('B. window boundaries — [windowStart, windowEnd)', () => {
  test('completedAt exactly at windowStart is INSIDE', () => {
    assert.equal(run([source('a', WINDOW.windowStart)]).denominator, 1);
  });

  test('completedAt exactly at windowEnd is OUTSIDE, so adjacent windows tile', () => {
    const issue = source('a', WINDOW.windowEnd);
    assert.equal(run([issue]).denominator, 0, 'windowEnd is exclusive');
    // The same issue lands in exactly one of two adjacent windows, never both.
    const next = run([issue], { windowStart: WINDOW.windowEnd, windowEnd: '2026-08-01T00:00:00.000Z' });
    assert.equal(next.denominator, 1);
  });

  test('one millisecond either side of the bounds falls out', () => {
    assert.equal(run([source('before', '2026-05-31T23:59:59.999Z')]).denominator, 0);
    assert.equal(run([source('after', '2026-07-01T00:00:00.001Z')]).denominator, 0);
  });

  test('a completed issue with a null or unparseable completedAt is excluded AND surfaced', () => {
    // Undatable means it belongs to no window. Counted out loud in diagnostics
    // rather than silently folded in — a large undated set would otherwise read
    // as a small workspace.
    const r = run([
      source('null', null),
      source('garbage', 'not-a-date'),
      source('ok', '2026-06-15T00:00:00.000Z'),
    ]);
    assert.equal(r.denominator, 1);
    assert.equal(r.diagnostics.undated, 2);
    assert.equal(r.scale.totalCompleted, 3, 'they are still completed, just unwindowable');
  });

  test('the window is driven purely by the parameters — same issues, different windows', () => {
    const issues = [
      source('may', '2026-05-15T00:00:00.000Z'),
      source('jun', '2026-06-15T00:00:00.000Z'),
      source('jul', '2026-07-15T00:00:00.000Z'),
    ];
    assert.equal(run(issues).denominator, 1);
    assert.equal(run(issues, { windowStart: '2026-05-01T00:00:00.000Z', windowEnd: '2026-08-01T00:00:00.000Z' }).denominator, 3);
    assert.equal(run(issues, { windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-02-01T00:00:00.000Z' }).denominator, 0);
  });
});

// ─── C. Numerator — peer.createdAt > source.completedAt, related/blocks only ──

describe('C. numerator predicate — the causal rule', () => {
  const DONE = '2026-06-10T00:00:00.000Z';
  const AFTER = '2026-06-12T00:00:00.000Z';
  const BEFORE = '2026-06-08T00:00:00.000Z';

  test('a `related` peer created after completedAt counts', () => {
    const r = run([source('s', DONE, { relations: [outgoing('related', 'p')] }), peer('p', AFTER)]);
    assert.equal(r.numerator, 1);
    assert.equal(r.distinctPeers, 1);
    assert.equal(r.ratio, 1);
  });

  test('a `blocks` peer created after completedAt counts', () => {
    const r = run([source('s', DONE, { relations: [outgoing('blocks', 'p')] }), peer('p', AFTER)]);
    assert.equal(r.numerator, 1);
  });

  test('a breakdown-style peer created BEFORE completedAt is excluded', () => {
    // `breakdown` draws blocks edges between sibling phases before any work
    // happens (LIN-1601 blocks LIN-1603 is exactly this shape). Counting them
    // would make decomposition look like rework.
    const r = run([source('s', DONE, { relations: [outgoing('blocks', 'p')] }), peer('p', BEFORE)]);
    assert.equal(r.numerator, 0);
    assert.equal(r.diagnostics.unresolvedPeers, 0, 'it resolved fine — it simply failed the causal rule');
  });

  test('a peer created in the same instant as the completion is excluded (strict >)', () => {
    const r = run([source('s', DONE, { relations: [outgoing('related', 'p')] }), peer('p', DONE)]);
    assert.equal(r.numerator, 0);
  });

  test('a `duplicate` relation is excluded — not new work', () => {
    const r = run([source('s', DONE, { relations: [outgoing('duplicate', 'p')] }), peer('p', AFTER)]);
    assert.equal(r.numerator, 0);
    assert.equal(r.diagnostics.meanRelationsPerCompleted, 0, 'nor does it count toward relation hygiene');
  });

  test('a sub-issue is excluded even when created after the completion', () => {
    // Children are planned decomposition, not follow-on rework. The causal rule
    // excludes most of them anyway; this pins the explicit guard for a child
    // that really was created after its parent closed.
    const r = run([
      source('s', DONE, { children: [{ id: 'c', identifier: 'LIN-c', title: 'child' }], relations: [outgoing('related', 'c')] }),
      peer('c', AFTER, { parent: { id: 's', identifier: 'LIN-s' } }),
    ]);
    assert.equal(r.numerator, 0);
  });

  test('a peer arriving on inverseRelations counts, via the same normalizer', () => {
    // The two arms nest the peer under different keys. 5 of the 6 counted
    // follow-ups in the planning probe came from the inverse side, so dropping
    // this arm would erase five sixths of the numerator.
    const r = run([source('s', DONE, { inverseRelations: [inverse('related', 'p')] }), peer('p', AFTER)]);
    assert.equal(r.numerator, 1, 'inverse arm counted');
    assert.equal(r.arms.causalUnion.numerator, 1);
    assert.equal(r.arms.causalOutgoing.numerator, 0, 'and the outgoing-only diagnostic arm shows the 6x swing');
  });

  test('one peer linked from two sources → numerator 2, distinctPeers 1', () => {
    // LIN-1576 is a live example: a follow-up of three separate completed tasks.
    // The edge reading and the set reading differ, and both are recorded because
    // LIN-1600 §6(i) deliberately leaves the choice open.
    const r = run([
      source('s1', DONE, { relations: [outgoing('related', 'p')] }),
      source('s2', DONE, { relations: [outgoing('related', 'p')] }),
      peer('p', AFTER),
    ]);
    assert.equal(r.numerator, 2);
    assert.equal(r.distinctPeers, 1);
    // …but the same peer linked twice from ONE source counts once.
    const once = run([source('s', DONE, { relations: [outgoing('related', 'p'), outgoing('blocks', 'p')] }), peer('p', AFTER)]);
    assert.equal(once.numerator, 1, 'the pinned formula is a set-builder over peers, per source');
  });

  test('a peer missing from the input is surfaced as unresolved, never counted either way', () => {
    // The relation exists but the peer's own createdAt is unreadable, so the
    // causal rule cannot be evaluated. Silence here would lie in both directions.
    const r = run([source('s', DONE, { relations: [outgoing('related', 'gone')] })]);
    assert.equal(r.numerator, 0);
    assert.equal(r.diagnostics.unresolvedPeers, 1);
    assert.equal(r.diagnostics.meanRelationsPerCompleted, 1, 'the edge still counts as relation hygiene');
  });
});

// ─── D. Companion instruments — 7-day maturity and plan scoping ───────────────

describe('D. companion instruments', () => {
  const DONE = '2026-06-10T00:00:00.000Z';   // 21 days before windowEnd → fully matured
  const PLANNED = 'Session fit: needs multiple sessions';

  test('matured7d counts a peer at +6d and drops one at +8d', () => {
    const r = run([
      source('s', DONE, { relations: [outgoing('related', 'near'), outgoing('related', 'far')] }),
      peer('near', '2026-06-16T00:00:00.000Z'),  // +6d
      peer('far', '2026-06-18T00:00:00.000Z'),   // +8d
    ]);
    assert.equal(r.numerator, 2, 'the headline has no maturity horizon');
    assert.equal(r.matured7d.numerator, 1, 'only the +6d peer is inside the 7-day horizon');
    assert.equal(r.matured7d.denominator, 1);
  });

  test('a source whose 7-day maturation extends past windowEnd leaves the matured DENOMINATOR', () => {
    // The censoring correction: a task completed 3 days before the window shut
    // has not had its whole accrual period observed, so it is dropped from the
    // matured instrument rather than counted as a zero. It costs denominator,
    // never numerator.
    const r = run([
      source('early', DONE, { relations: [outgoing('related', 'pe')] }),                       // +21d of runway
      source('late', '2026-06-28T00:00:00.000Z', { relations: [outgoing('related', 'pl')] }),  // only 3d
      peer('pe', '2026-06-12T00:00:00.000Z'),
      peer('pl', '2026-06-29T00:00:00.000Z'),
    ]);
    assert.equal(r.denominator, 2, 'both are in the headline');
    assert.equal(r.matured7d.denominator, 1, 'the late source is censored out');
    assert.equal(r.diagnostics.maturedSources, 1);
  });

  test('planScoped narrows the denominator to plan-marked sources; primary is the intersection', () => {
    const r = run([
      source('planned', DONE, { description: PLANNED, relations: [outgoing('related', 'p1')] }),
      source('unplanned', DONE, { relations: [outgoing('related', 'p2')] }),
      peer('p1', '2026-06-12T00:00:00.000Z'),
      peer('p2', '2026-06-12T00:00:00.000Z'),
    ]);
    assert.equal(r.denominator, 2);
    assert.equal(r.planScoped.denominator, 1);
    assert.equal(r.planScoped.numerator, 1);
    assert.equal(r.primary.denominator, 1, 'plan-marked AND fully matured');
    assert.equal(r.primary.numerator, 1);
    assert.equal(r.diagnostics.pctWithPlanMarker, 0.5);
  });

  test('the plan marker reads the DESCRIPTION ONLY — a comment never sets it', () => {
    // F2. The two session-fit phrases are mandated into the DESCRIPTION by the
    // `plan` template (lib/prompt-template-defs.js:242) — the true positive —
    // but they also appear in the instruction text of `plan-review` (:782) and
    // `breakdown` (:364), and a plan-review verdict lands as a COMMENT. Since
    // `plan-review` is the gate LIN-1600 ships, baseline-window issues never met
    // it and re-read-window issues will: reading comments would inflate the
    // after-period planScoped/primary denominator and bias the ratio DOWN, in
    // the direction of the pre-registered hypothesis, on the primary instrument.
    // That is differential misclassification aligned with the treatment.
    const viaComment = run([source('s', DONE, {
      comments: [{ id: 'c1', body: 'Plan complete. Session fit: fits one session', createdAt: DONE }],
    })]);
    assert.equal(viaComment.planScoped.denominator, 0, 'a comment must not set the plan marker');
    assert.equal(viaComment.diagnostics.pctWithPlanMarker, 0);
    assert.equal(viaComment.denominator, 1, 'the headline denominator is untouched by the scoping');

    // The realistic contamination shape, stated as its own assertion: a
    // plan-review verdict comment on an issue the `plan` step never ran on.
    const reviewed = run([source('s', DONE, {
      description: 'Fix the thing.',
      comments: [{ id: 'c1', body: '## Review\nCheck #4: does it fit one session? Yes.\n\n### What CI Did Not Prove\n- x', createdAt: DONE }],
    })]);
    assert.equal(reviewed.planScoped.denominator, 0, 'a plan-review comment is not evidence the plan step ran');
    assert.equal(reviewed.diagnostics.pctWithReviewLedger, 1, 'while the ledger marker DOES still read comments — that is where review posts it');

    // The description surface still works, both markers.
    assert.equal(run([source('s', DONE, { description: PLANNED })]).planScoped.denominator, 1);
  });

  test('the plan marker is overridable and the ruler actually applied is echoed into the result', () => {
    // It is a heuristic, not a schema, so a baseline must record which ruler it
    // used — otherwise a later re-read moves because the ruler changed.
    const custom = /## Bespoke Plan Marker/;
    const r = run([
      source('hit', DONE, { description: '## Bespoke Plan Marker\nbody' }),
      source('miss', DONE, { description: PLANNED }),
    ], { planMarker: custom });
    assert.equal(r.planScoped.denominator, 1, 'the override replaces the default entirely');
    assert.equal(r.definition.planMarker, String(custom));
    assert.equal(r.definition.planMarkerScope, 'description');
    assert.equal(r.definition.reviewLedgerMarkerScope, 'description+comments');
  });

  test('a /g-flagged marker override does NOT under-count — regex state is never carried', () => {
    // F1. `RegExp.prototype.test` advances `lastIndex` on a /g (or /y) regex and
    // resumes from there next call, so N identical sources alternate hit/miss.
    // Measured at the PR head: /gi gave planScoped.denominator 2 of 3. This
    // matters because `options.planMarker` is the documented resolution path for
    // the plan-marker heuristic — the person handing in a fresh regex is exactly
    // the person likely to write /gi — and it corrupts `primary`, the instrument
    // LIN-1600 designates as the decision metric.
    const three = [
      source('s1', DONE, { description: PLANNED }),
      source('s2', DONE, { description: PLANNED }),
      source('s3', DONE, { description: PLANNED }),
    ];
    const stateless = run(three, { planMarker: /needs multiple sessions/i });
    assert.equal(stateless.planScoped.denominator, 3, 'the control: all three are plan-marked');

    for (const flags of ['g', 'gi', 'y', 'gy']) {
      const pattern = new RegExp('needs multiple sessions', flags);
      const r = run(three, { planMarker: pattern });
      assert.equal(r.planScoped.denominator, 3, `/${flags} must count all three, not alternate`);
      assert.equal(r.primary.denominator, 3, `/${flags} must not corrupt the primary instrument`);
      assert.equal(pattern.lastIndex, 0, 'and the caller\'s own regex is never mutated');
      assert.ok(!/[gy]/.test(r.definition.planMarker.split('/').pop()), 'the ruler recorded is the one applied, stripped of statefulness');
    }

    // Both overridable patterns are affected — the class is exactly two, and
    // they are fixed together.
    const ledger = { comments: [{ id: 'c', body: '### What CI Did Not Prove\n- x', createdAt: DONE }] };
    const ledgered = run(
      [source('s1', DONE, ledger), source('s2', DONE, ledger), source('s3', DONE, ledger)],
      { reviewLedgerMarker: /### What CI Did Not Prove/g },
    );
    assert.equal(ledgered.diagnostics.pctWithReviewLedger, 1, 'a /g review-ledger override must not alternate either');
  });

  test('a duplicate issue row does not inflate the denominator', () => {
    // F3. buildPeerIndex dedupes by id; the denominator loop walked the raw list,
    // so one real completion arriving twice counted twice. Cursor paging over a
    // mutating collection is the plausible route, and the number is meant to be
    // quotable. Deduped on entry, and the count surfaced rather than swallowed.
    const done = source('s', DONE, { relations: [outgoing('related', 'p')] });
    const p = peer('p', '2026-06-12T00:00:00.000Z');
    const r = run([done, done, p, p]);
    assert.equal(r.denominator, 1, 'one real completion');
    assert.equal(r.numerator, 1, 'and one real follow-on edge');
    assert.equal(r.scale.totalIssues, 2, 'scale reports the deduped population');
    assert.equal(r.diagnostics.duplicateInputs, 2, 'both duplicate rows are reported');
    // Distinct issues that merely look alike are untouched.
    assert.equal(run([source('a', DONE), source('b', DONE)]).denominator, 2);
    assert.equal(run([source('a', DONE), source('b', DONE)]).diagnostics.duplicateInputs, 0);
  });
});

// ─── E. Sufficiency floor and the recorded shape ──────────────────────────────

describe('E. sufficiency floor and freeze-list shape', () => {
  test('an empty denominator yields ratio null, never 0, and never divides by zero', () => {
    // 0 is a legitimate measured value for this metric (a window in which no
    // follow-ups were filed), so "no data" must not collapse onto it.
    const r = run([]);
    assert.equal(r.ratio, null);
    assert.equal(r.numerator, 0);
    assert.equal(r.denominator, 0);
    assert.equal(r.matured7d.ratio, null);
    assert.equal(r.planScoped.ratio, null);
    assert.equal(r.diagnostics.meanRelationsPerCompleted, null);
  });

  test('the denominator floor flips at 30, not 29', () => {
    const below = run(cohort(29, 40));
    const at = run(cohort(30, 40));
    assert.equal(below.denominator, 29);
    assert.equal(below.numerator, 40, 'held well clear of the 33 floor, so only the denominator can fail');
    assert.equal(below.sufficient, false, '29 completions is below the floor');
    assert.equal(at.denominator, 30);
    assert.equal(at.sufficient, true);
    assert.equal(at.minDenominator, 30);
  });

  test('the numerator floor flips at 33, not 32', () => {
    // 33 is derived from the pre-registered ~50% effect (2.80 x sqrt(2/N) <=
    // |ln 0.5| => N >= 32.6), not chosen to be passable.
    const below = run(cohort(40, 32));
    const at = run(cohort(40, 33));
    assert.equal(below.numerator, 32);
    assert.equal(below.denominator, 40, 'held clear of the 30 floor, so only the numerator can fail');
    assert.equal(below.sufficient, false, 'a fat denominator does not rescue a thin numerator');
    assert.equal(at.numerator, 33);
    assert.equal(at.sufficient, true);
    assert.equal(at.minNumerator, 33);
  });

  test('sufficiency is evaluated per instrument in a single call', () => {
    // The over-claim MIN_COHORT_EDIT guards, moved up a level: the headline can
    // clear the floor while the plan-scoped sub-instrument sits far below it.
    const issues = cohort(40, 40);
    issues.filter((i) => i.state.type === 'completed').slice(0, 3)
      .forEach((s) => { s.description = 'Session fit: needs multiple sessions'; });
    const r = run(issues);
    assert.equal(r.sufficient, true, 'headline clears both floors');
    assert.equal(r.planScoped.denominator, 3);
    assert.equal(r.planScoped.sufficient, false, 'the sub-instrument does not inherit the headline flag');
    assert.equal(r.arms.causalUnion.sufficient, true);
    assert.equal(r.arms.causalOutgoing.sufficient, true);
  });

  test('the freeze list is returned whole, with window and definition echoed verbatim', () => {
    const r = run([source('s', '2026-06-15T00:00:00.000Z')]);
    assert.deepEqual(Object.keys(r).sort(), [
      'arms', 'codeVersion', 'definition', 'denominator', 'diagnostics', 'distinctPeers',
      'matured7d', 'minDenominator', 'minNumerator', 'numerator', 'planScoped', 'primary',
      'ratio', 'scale', 'sufficient', 'window',
    ]);
    // item 1 — absolute instants, never "last 30 days"
    assert.equal(r.window.windowStart, WINDOW.windowStart);
    assert.equal(r.window.windowEnd, WINDOW.windowEnd);
    assert.equal(r.window.asOf, WINDOW.asOf);
    assert.equal(r.window.bounds, '[windowStart, windowEnd)');
    // item 3 — the definition parameters, next to the number
    assert.deepEqual(r.definition.relationTypesCounted, ['related', 'blocks']);
    assert.deepEqual(r.definition.excluded, ['duplicate relations', 'sub-issues (children)', 'reopens']);
    assert.equal(r.definition.numeratorRule, 'peer.createdAt > source.completedAt');
    assert.equal(r.definition.denominatorRule, "state.type === 'completed'");
    assert.equal(r.definition.maturityDays, 7);
    // item 4 — stamped by the script, never guessed by the shell-free module
    assert.equal(r.codeVersion, null);
    assert.equal(run([], { codeVersion: { sha: 'deadbeef' } }).codeVersion.sha, 'deadbeef');
    // item 5/8 — diagnostics and scale
    assert.equal(r.diagnostics.skipped, 0);
    assert.equal(run([], { skipped: ['a', 'b'] }).diagnostics.skipped, 2);
    assert.equal(r.scale.totalIssues, 1);
  });
});

// ─── F. Clock-freedom, loudness, and the __internal helpers ───────────────────

describe('F. clock-freedom, loudness and __internal', () => {
  test('fixtures decades in the past AND the future yield identical exact counts', () => {
    // The clock-freedom oracle: any Date.now()/new Date() read inside the module
    // would make one of these two windows empty. Both must count 1/1.
    const past = computeFollowOnRatio(
      [source('s', '1994-06-10T00:00:00.000Z', { relations: [outgoing('related', 'p')] }), peer('p', '1994-06-12T00:00:00.000Z')],
      { windowStart: '1994-06-01T00:00:00.000Z', windowEnd: '1994-07-01T00:00:00.000Z', asOf: '1994-07-01T00:00:00.000Z' },
    );
    const future = computeFollowOnRatio(
      [source('s', '2094-06-10T00:00:00.000Z', { relations: [outgoing('related', 'p')] }), peer('p', '2094-06-12T00:00:00.000Z')],
      { windowStart: '2094-06-01T00:00:00.000Z', windowEnd: '2094-07-01T00:00:00.000Z', asOf: '2094-07-01T00:00:00.000Z' },
    );
    assert.equal(past.denominator, 1);
    assert.equal(past.numerator, 1);
    assert.equal(future.denominator, 1);
    assert.equal(future.numerator, 1);
    assert.equal(past.matured7d.numerator, future.matured7d.numerator);
    // Deterministic: the same input twice is deep-equal.
    const issues = [source('s', '2026-06-10T00:00:00.000Z', { relations: [outgoing('related', 'p')] }), peer('p', '2026-06-12T00:00:00.000Z')];
    assert.deepEqual(run(issues), run(issues));
  });

  test('a missing or unparseable window boundary THROWS — it never defaults', () => {
    // The one place the module is loud, because a silently-defaulted window is
    // the exact failure the pinned definition exists to prevent: the number
    // would move between baseline and re-read because the ruler moved.
    assert.throws(() => computeFollowOnRatio([], { windowEnd: WINDOW.windowEnd, asOf: WINDOW.asOf }), /windowStart must be a parseable ISO instant/);
    assert.throws(() => computeFollowOnRatio([], { windowStart: WINDOW.windowStart, asOf: WINDOW.asOf }), /windowEnd must be a parseable ISO instant/);
    assert.throws(() => computeFollowOnRatio([], { windowStart: WINDOW.windowStart, windowEnd: WINDOW.windowEnd }), /asOf must be a parseable ISO instant/);
    assert.throws(() => run([], { windowStart: 'last 30 days' }), /windowStart/);
    assert.throws(() => run([], { windowEnd: 42 }), /windowEnd/);
  });

  test('a window that cannot contain anything THROWS rather than reading as "no data"', () => {
    // F4. Inverted bounds used to return `denominator: 0, ratio: null`, which is
    // indistinguishable from a genuinely empty window — a typo presented as a
    // finding. An empty half-open window is the same mistake in the same
    // predicate, so both are refused together rather than the witness patched.
    assert.throws(
      () => run([source('s', '2026-06-15T00:00:00.000Z')], { windowStart: WINDOW.windowEnd, windowEnd: WINDOW.windowStart }),
      /windowEnd must be after windowStart/,
      'inverted bounds',
    );
    assert.throws(
      () => run([], { windowStart: WINDOW.windowStart, windowEnd: WINDOW.windowStart }),
      /windowEnd must be after windowStart/,
      'an empty half-open window',
    );
    // One millisecond of window is legitimate and still measures.
    assert.equal(run([], { windowStart: WINDOW.windowStart, windowEnd: '2026-06-01T00:00:00.001Z' }).denominator, 0);
  });

  test('all three predicate arms come back from one pass, so the choice needs no second run', () => {
    // LIN-1600 §6(ii) is open, and a re-measurement costs ~29 minutes of
    // rate-limited network, so every arm is computed from the single pass.
    const r = run([
      source('s', '2026-06-10T00:00:00.000Z', {
        parent: { id: 'par', identifier: 'LIN-par' },
        relations: [outgoing('related', 'sib')],
        inverseRelations: [inverse('blocks', 'inv')],
      }),
      peer('sib', '2026-06-12T00:00:00.000Z', { parent: { id: 'par', identifier: 'LIN-par' } }),
      peer('inv', '2026-06-12T00:00:00.000Z'),
    ]);
    assert.equal(r.arms.causalUnion.numerator, 2, 'both arms');
    assert.equal(r.arms.causalOutgoing.numerator, 1, 'outgoing only');
    assert.equal(r.arms.sharedParentExcluded.numerator, 1, 'the breakdown sibling drops out structurally');
    assert.equal(r.numerator, r.arms.causalUnion.numerator, 'the headline is the union arm');
  });

  test('__internal helpers behave as the module relies on', () => {
    const {
      peerOf, toMs, rate, typeCounted, buildPeerIndex, dedupeById, hasPlanMarker, hasReviewLedger,
      requireInstant, textOf, descriptionOf, nonGlobal,
    } = __internal;

    // the highest-consequence predicate: both arms, and a shape it cannot read
    assert.equal(peerOf(outgoing('related', 'p')).id, 'p');
    assert.equal(peerOf(inverse('related', 'p')).id, 'p');
    assert.equal(peerOf({ type: 'related' }), null);
    assert.equal(peerOf(null), null);

    assert.equal(toMs('2026-06-10T00:00:00.000Z'), Date.parse('2026-06-10T00:00:00.000Z'));
    assert.ok(Number.isNaN(toMs(null)));
    assert.ok(Number.isNaN(toMs('nope')));

    assert.equal(rate(1, 4), 0.25);
    assert.equal(rate(0, 4), 0, 'a real zero is preserved');
    assert.equal(rate(3, 0), null, 'no data is null, not zero');

    assert.equal(typeCounted({ type: 'BLOCKS' }, ['related', 'blocks']), true, 'case/whitespace tolerated');
    assert.equal(typeCounted({ type: ' related ' }, ['related', 'blocks']), true);
    assert.equal(typeCounted({ type: 'duplicate' }, ['related', 'blocks']), false);
    assert.equal(typeCounted({}, ['related', 'blocks']), false);

    const idx = buildPeerIndex([peer('p', '2026-06-12T00:00:00.000Z'), null, { id: '' }]);
    assert.equal(idx.size, 1);
    assert.equal(idx.get('p').identifier, 'LIN-p');

    assert.equal(hasPlanMarker({ description: 'Session fit: fits one session' }), true);
    assert.equal(hasPlanMarker({ description: '## Implementation Plan (LIN-1)' }), true);
    assert.equal(hasPlanMarker({ description: 'no marker here' }), false);
    assert.equal(hasPlanMarker({ description: '', comments: [{ body: 'fits one session' }] }), false, 'F2: comments are not a plan-marker surface');
    assert.equal(hasReviewLedger({ comments: [{ body: '### What CI Did Not Prove\n- x' }] }), true);
    assert.equal(hasReviewLedger({ description: '' }), false);
    assert.equal(textOf({ description: 'a', comments: [{ body: 'b' }] }), 'a\nb');
    assert.equal(descriptionOf({ description: 'a', comments: [{ body: 'b' }] }), 'a', 'the narrow surface reads no further');
    assert.equal(descriptionOf({ comments: [{ body: 'b' }] }), '');
    assert.equal(descriptionOf(null), '');

    // F1: statelessness is a property of the copy, and the original is untouched
    const global = /x/gi;
    const copy = nonGlobal(global);
    assert.notEqual(copy, global, 'a stateful pattern is copied, never mutated');
    assert.equal(copy.global, false);
    assert.equal(copy.sticky, false);
    assert.equal(copy.ignoreCase, true, 'non-stateful flags survive');
    assert.equal(copy.source, 'x');
    assert.equal(global.global, true, 'the caller keeps the object it handed in');
    assert.deepEqual([copy.test('x'), copy.test('x'), copy.test('x')], [true, true, true], 'and it cannot alternate');
    const plain = /x/i;
    assert.equal(nonGlobal(plain), plain, 'an already-stateless pattern is returned as-is, allocating nothing');
    assert.equal(nonGlobal(/x/y).sticky, false, 'sticky is stateful too');

    // F3: first occurrence wins; rows with no usable id cannot be compared
    const dupe = { id: 'd', description: '' };
    const deduped = dedupeById([dupe, dupe, { id: 'e' }, null, 'not an issue', { id: '' }]);
    assert.deepEqual(deduped.issues.map((x) => (x && typeof x === 'object' ? x.id : x)), ['d', 'e', null, 'not an issue', '']);
    assert.equal(deduped.duplicates, 1);
    assert.deepEqual(dedupeById(null), { issues: [], duplicates: 0 });

    assert.equal(requireInstant('2026-06-10T00:00:00.000Z', 'x'), Date.parse('2026-06-10T00:00:00.000Z'));
    assert.throws(() => requireInstant(undefined, 'x'), /x must be a parseable ISO instant/);

    // countFollowOns is usable standalone against a peer index
    const out = countFollowOns(
      source('s', '2026-06-10T00:00:00.000Z', { relations: [outgoing('related', 'p')] }),
      idx,
    );
    assert.equal(out.peers.length, 1);
    assert.equal(out.peers[0].direction, 'outgoing');
    assert.equal(out.peers[0].withinMaturity, true);
    assert.equal(out.relationsSeen, 1);
    assert.deepEqual(countFollowOns(null, idx), { peers: [], unresolvedPeers: 0, relationsSeen: 0 });
  });
});

// ─── LIN-1770: close-out's archive+prune stub must not blind PLAN_MARKER ──────
//
// The close-out template now prunes stage artifacts from the description on
// successful close, including any `## Implementation Plan` heading and the
// `fits one session` / `needs multiple sessions` phrasing the plan step wrote.
// hasPlanMarker (this module) reads exactly those literals from the
// description, and it is LIN-1600's denominator instrument — pruning them
// away on every successfully-closed ticket would silently zero out the
// population the metric measures. The mitigation is wording, not code: the
// close-out template mandates the stub retain one of the two markers
// verbatim. This test locks that contract from the follow-on-ratio side —
// if a future edit to the close-out template's stub instructions drops the
// mandate, this fails, rather than the regression surfacing only as a
// silently-corrupted metric weeks later.
describe('LIN-1770: close-out prune must preserve a PLAN_MARKER-matching stub', () => {
  test('the close-out template instructs the stub to retain the plan marker verbatim', async () => {
    const { generatePrompt } = await import('../../lib/prompt-templates.js');
    const issue = {
      id: 'co-lin1770', identifier: 'LIN-1770-CO', title: 'Land the thing',
      description: 'work', url: 'https://linear.app/test/issue/LIN-1770-CO',
      labels: [], createdAt: '2026-01-01T00:00:00.000Z',
    };
    const context = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
    const { prompt } = generatePrompt('close-out', issue, context);

    assert.ok(/Archive & Prune/i.test(prompt), 'close-out documents the archive+prune step');
    assert.ok(/never prune/i.test(prompt), 'close-out names a never-prune carve-out');
    // The instruction must cite the SAME literals PLAN_MARKER matches, not a
    // paraphrase — a paraphrase would pass a human read but not the regex.
    assert.ok(/fits one session.*needs multiple sessions|needs multiple sessions.*fits one session/is.test(prompt),
      'the stub mandate names both committed session-fit phrases verbatim');
    assert.ok(/`Implementation Plan` heading/.test(prompt),
      'the stub mandate names the Implementation Plan heading verbatim, matching PLAN_MARKER\'s heading branch');
  });

  test('a stub written per the close-out mandate still satisfies hasPlanMarker; one that drops the marker does not', () => {
    const { hasPlanMarker } = __internal;
    // What close-out's stub looks like when it follows the mandate: the
    // stage-artifact sections are gone, but the session-fit phrase survives.
    const compliantStub = [
      '## Problem',
      'Original problem statement, untouched by the prune.',
      '',
      '## Shipped',
      'Implemented as approved. Session fit: fits one session.',
      'See PR #123. Full history in task snapshots and comments.',
    ].join('\n');
    assert.equal(hasPlanMarker({ description: compliantStub }), true,
      'a stub that keeps the session-fit phrase still registers as having a plan');

    // What it would look like if a future edit dropped the mandate — this is
    // the corruption the mandate exists to prevent, reproduced so the test
    // fails loudly if the mandate above is ever removed without a replacement.
    const noncompliantStub = [
      '## Problem',
      'Original problem statement, untouched by the prune.',
      '',
      '## Shipped',
      'Implemented as approved. See PR #123. Full history in task snapshots and comments.',
    ].join('\n');
    assert.equal(hasPlanMarker({ description: noncompliantStub }), false,
      'without the mandated phrase, the pruned description is indistinguishable from "no plan ever ran"');
  });
});
