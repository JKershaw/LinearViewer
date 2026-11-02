/**
 * LIN-4114 — Home's "Waiting on you" section, as the rows, the view and the folds build it.
 *
 * Witnesses 5, 6, 8, 9 (the view half), 10 and the workspace-scope assertion of witness 5 (plan rev 2). Every NEW test
 * must FAIL against the unmodified code (no `rulingRows`, no `waiting` on the view, no waiting set in the folds). The
 * GUARD tests pass before and after and must keep passing: the task page's ruling read without the live-run option,
 * and the feed's effect for a live run.
 *
 * Names the plan leaves open are read off namespaces, so a missing one fails one assertion, not the file:
 *   - `rulingRows` (homeRowStates output; buildHomeView and homeRowsFor input), `waiting: { rows, ids }` (buildHomeView output).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { readRulingStanding } from '../../lib/ruling-standing.js';
import { rulingStandingOf } from '../../lib/unanswered-decisions.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { liveOnAnchor } from '../../routes/dashboard-session-state.js';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { isCompleted } from '../../lib/providers/state-map.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');
const NOW_ISO = '2026-11-02T09:00:00.000Z';

// ---- loop fixtures (as tests/unit/lin-4016-home-row-states.test.js builds them) -----------------------------------

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-1', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
/** A resumable ruling: its run has completed and it is blocked on a person. */
const rulingLoop = (identifier, over = {}) => loop({
  loopId: `r-${identifier}`, lineageId: `r-${identifier}`, issueIdentifier: identifier, agentState: 'complete',
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: `d-${identifier}`, question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});
/**
 * A ruling whose run ended long ago ("gone"): not resumable, so its default effect is a fresh run ("dispatch"), and a
 * live run on the same task turns that into "record" (lib/unanswered-decisions.js, resolveEffect branch 3).
 */
const goneRulingLoop = (identifier) => loop({
  loopId: `g-${identifier}`, lineageId: `g-${identifier}`, issueIdentifier: identifier, agentState: 'complete',
  wakeMarker: null, terminalStatus: 'complete', terminalCompletedAt: '2020-01-01T00:00:00.000Z',
  feedback: [], decision: { decision_id: `d-${identifier}`, question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null,
});
/** A live run on the same task as a ruling: non-terminal, so it is the "live run already exists on this anchor" case. */
const liveLoop = (identifier) => loop({ loopId: `live-${identifier}`, lineageId: `live-${identifier}`, issueIdentifier: identifier });

function assemblyWith({ loops = [], decisions = [] } = {}) {
  return createHomeRowStates({
    getLoopsForWorkspace: async () => loops,
    dispatchStore: {},
    agentStatusStore: {},
    taskDecisionsStore: {
      listUnansweredForWorkspaces: async () => decisions,
      listNewestScanPerTask: async () => ({}),
    },
    shelvedRulingsStore: { listForWorkspaces: async () => [] },
    enrichLoop,
    deriveSessionWaiting,
    now: () => NOW,
    onError: () => {},
  });
}
const issueNode = (identifier, type = 'started') => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: type, type } },
  children: [], depth: 0,
});

// ---- witness 5: the rows Home reads for the count are passed through ---------------------------------------------

describe('LIN-4114 witness 5: homeRowStates passes the ruling rows through, beside the count', () => {
  test('NEW: rulingRows is one row per open ruling, equal in length to rulingCount, in the workspace', async () => {
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-OUT'), rulingLoop('LIN-NOROW'), rulingLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [issueNode('LIN-1').issue], runControls: true });
    assert.equal(out.rulingCount, 3, 'the count is unchanged');
    assert.ok(Array.isArray(out.rulingRows), 'the rows are returned');
    assert.equal(out.rulingRows.length, out.rulingCount, 'rulingRows and rulingCount agree');
    assert.deepEqual(out.rulingRows.map(r => r.anchor.issueIdentifier).sort(), ['LIN-1', 'LIN-NOROW', 'LIN-OUT']);
  });

  test('NEW: every row Home hands the card is this workspace\'s (anchor.workspaceUrlKey === urlKey)', async () => {
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-1'), rulingLoop('LIN-2')] });
    const out = await assembly({ urlKey: 'acme', issues: [issueNode('LIN-1').issue], runControls: true });
    assert.ok(Array.isArray(out.rulingRows) && out.rulingRows.length === 2, 'two rows to check');
    for (const row of out.rulingRows) assert.equal(row.anchor.workspaceUrlKey, 'acme');
  });

  test('GUARD: a viewer who sees no sessions gets no rows and no count', async () => {
    const assembly = assemblyWith({ loops: [rulingLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [issueNode('LIN-1').issue], runControls: false });
    assert.equal(out.rulingCount, 0);
    assert.deepEqual(out.rulingRows ?? [], []);
  });
});

// ---- witness 6: the live-run guard, through Home, equals the feed's effect ---------------------------------------

describe('LIN-4114 witness 6: a ruling with a live run on its task reads as "record" on Home, as it does on the feed', () => {
  test('NEW: Home\'s row for a ruling with a live run on its task has effect "record"', async () => {
    const assembly = assemblyWith({ loops: [goneRulingLoop('LIN-1'), liveLoop('LIN-1')] });
    const out = await assembly({ urlKey: 'acme', issues: [issueNode('LIN-1').issue], runControls: true });
    const row = (out.rulingRows || []).find(r => r.anchor.issueIdentifier === 'LIN-1');
    assert.ok(row, 'the ruling has a row');
    assert.equal(row.effect, 'record', 'answering must not start a second run');
  });

  test('NEW: Home\'s effects equal the feed\'s effects for the same loops (a differential over the same predicate)', async () => {
    const loops = [goneRulingLoop('LIN-1'), liveLoop('LIN-1'), goneRulingLoop('LIN-2')];
    const assembly = assemblyWith({ loops });
    const home = await assembly({ urlKey: 'acme', issues: [issueNode('LIN-1').issue, issueNode('LIN-2').issue], runControls: true });
    // The feed (routes/dashboard-rulings.js) builds the same predicate over the enriched loops it holds.
    const enriched = loops.map(l => enrichLoop(l));
    const feed = rulingStandingOf(
      { urlKey: 'acme', loops, taskDecisions: [], shelvedRulings: [], newestScanByTask: {} },
      { now: NOW, enrichLoop, liveDispatchOnAnchor: liveOnAnchor(enriched) }
    );
    const effectsOf = rows => rows.map(r => `${r.anchor.issueIdentifier}:${r.effect}`).sort();
    assert.deepEqual(effectsOf(home.rulingRows || []), effectsOf(feed.rows), 'Home and the feed agree row for row');
    assert.ok(effectsOf(feed.rows).includes('LIN-1:record'), 'the feed says record for the task with a live run');
    assert.ok(effectsOf(feed.rows).includes('LIN-2:dispatch'), 'the feed says dispatch for the task with no live run');
  });

  test('GUARD: the task page\'s ruling read, without the live-run option, still says "dispatch" for that ruling', async () => {
    const loops = [goneRulingLoop('LIN-1'), liveLoop('LIN-1')];
    const standing = await readRulingStanding({ urlKey: 'acme', loops, at: NOW, enrichLoop });
    const row = standing.rows.find(r => r.anchor.issueIdentifier === 'LIN-1');
    assert.equal(row.effect, 'dispatch', 'the task page is not changed by this ticket');
  });
});

// ---- witnesses 8, 9, 10: the waiting set places each task once ---------------------------------------------------

const node = (identifier, type, children = [], over = {}) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { type }, ...over },
  children,
  depth: 0,
});
const project = (id, name, incomplete, completed = []) => ({
  project: { id, name, collapsed: false },
  incomplete,
  completed,
  completedCount: completed.length,
});
const card = (identifier) => ({ id: `id-${identifier}`, identifier, isSeed: false });
const recentOf = (identifiers, type = 'unstarted') => [{
  projectId: null,
  projectName: null,
  roots: identifiers.map(identifier => ({
    issue: { id: `id-${identifier}`, identifier, title: identifier, state: { type } },
    children: [], depth: 0, projectName: 'p', activityKind: 'created', activityAt: NOW_ISO,
  })),
}];
/** A ruling row as the workspace's standing hands it (the anchor fields Home and the card read). */
const ruling = (identifier, { task = true, workspaceUrlKey = 'acme' } = {}) => ({
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` },
  decisionCase: [],
  anchor: {
    loopId: task ? null : `r-${identifier}`,
    issueId: `id-${identifier}`,
    issueIdentifier: identifier,
    workspaceUrlKey,
    taskDecisionId: task ? `td-${identifier}` : null,
  },
  stampLoopId: task ? '' : `r-${identifier}`,
  disposition: task ? 'task-bound' : 'resumable',
  effect: 'record',
  canReply: true,
});
const statesFor = (ids) => new Map(ids.map(id => [id, { state: 'needs-you' }]));

/** Every identifier Home places, walked the way a reader of Home walks it: Waiting, Running and its folds, Up next and
 *  its folds, recent and its fold. A context row is reported apart: it is the one named exception. */
function placementsOf(input) {
  const view = buildHomeView(input);
  const placed = [];
  const contextRows = [];
  const walk = (n) => {
    if (n.context) contextRows.push(n.issue.identifier); else placed.push(n.issue.identifier);
    for (const child of n.children || []) walk(child);
    if (n.more) {
      let offset = 0;
      for (;;) {
        const page = homeRowsFor({ ...input, kind: 'more-of-parent', parentId: n.issue.id, offset });
        placed.push(...page.nodes.map(x => x.issue.identifier));
        if (page.nextOffset == null) break;
        offset = page.nextOffset;
      }
    }
  };
  view.inProgressTrees.forEach(t => t.roots.forEach(walk));
  placed.push(...((view.waiting && view.waiting.ids) || []));
  placed.push(...view.upNext.map(n => n.issue.identifier));
  // Home draws no project sections (LIN-4120), so the per-project Up next overflow and the project Backlog fold are the
  // /backlog page's lists, not Home's places. Home's Up next is the flat `view.upNext` above.
  placed.push(...view.recent.nodes.map(n => n.issue.identifier));
  let offset = 0;
  for (;;) {
    const page = homeRowsFor({ ...input, kind: 'recent', offset });
    placed.push(...page.nodes.map(x => x.issue.identifier));
    if (page.nextOffset == null) break;
    offset = page.nextOffset;
  }
  return { view, placed, contextRows };
}

describe('LIN-4114 witnesses 8-10: a waiting task is placed once, in Waiting, and not again in any other section', () => {
  test('NEW: a waiting Todo task is in Waiting and not in Up next, Running or recent; the view carries the rows and ids', () => {
    const input = {
      inProgressTrees: [],
      trees: [project('p', 'p', [node('W1', 'unstarted'), node('U1', 'unstarted')])],
      recentActivityTrees: recentOf(['W1', 'U1']),
      states: statesFor(['W1']),
      topTaskId: null,
      orderedCards: [card('W1'), card('U1')],
      rulingRows: [ruling('W1')],
    };
    const { view, placed } = placementsOf(input);
    assert.ok(view.waiting, 'the view carries a waiting section');
    assert.deepEqual(view.waiting.ids, ['W1']);
    assert.equal(view.waiting.rows.length, 1);
    assert.deepEqual(view.upNext.map(n => n.issue.identifier), ['U1'], 'W1 is not Up next');
    assert.equal(view.recent.nodes.length, 0, 'both are on Home already');
    assert.deepEqual([...placed].sort(), ['U1', 'W1'], 'each task appears once');
  });

  test('NEW: a waiting Todo task is absent from the up-next, backlog and more-of-parent folds, and its open child takes its place', () => {
    const input = {
      inProgressTrees: [{ projectId: 'p', projectName: 'p', roots: [node('S1', 'started', [node('SX', 'started')])] }],
      trees: [project('p', 'p', [
        node('S1', 'started', [node('SX', 'started'), node('W1', 'unstarted', [node('W1C', 'unstarted')]), node('X', 'unstarted')]),
        node('W1', 'unstarted', [node('W1C', 'unstarted')]),
        node('U1', 'unstarted'),
        node('B1', 'backlog'),
      ])],
      recentActivityTrees: [],
      states: statesFor(['W1']),
      topTaskId: null,
      orderedCards: [card('W1'), card('W1C'), card('U1'), card('X')],
      rulingRows: [ruling('W1')],
    };
    // The /backlog page's project lists: its Up next (the project's first roots) and that list's overflow fold.
    const projectUpNext = buildHomeView(input).trees[0].incomplete.map(n => n.issue.identifier);
    const upNext = [...projectUpNext, ...homeRowsFor({ ...input, kind: 'up-next', projectId: 'p', offset: 0 }).nodes.map(n => n.issue.identifier)];
    const backlog = homeRowsFor({ ...input, kind: 'backlog', projectId: 'p', offset: 0 }).nodes.map(n => n.issue.identifier);
    const folded = homeRowsFor({ ...input, kind: 'more-of-parent', parentId: 'id-S1', offset: 0 }).nodes.map(n => n.issue.identifier);
    assert.ok(!upNext.includes('W1'), `project Up next holds W1: ${upNext.join(', ')}`);
    assert.ok(upNext.includes('W1C'), `project Up next lost W1's child: ${upNext.join(', ')}`);
    assert.ok(!backlog.includes('W1'), 'backlog fold holds W1');
    assert.ok(!folded.includes('W1'), `more-of-parent fold holds W1: ${folded.join(', ')}`);
    assert.ok(folded.includes('W1C') && folded.includes('X'), `more-of-parent lost a child: ${folded.join(', ')}`);
  });

  test('NEW: a started waiting task with an open child shown below it is the named context row, and its ruling keeps its card in Waiting', () => {
    const input = {
      inProgressTrees: [{ projectId: 'p', projectName: 'p', roots: [node('P', 'started', [node('C', 'started')])] }],
      trees: [project('p', 'p', [node('P', 'started', [node('C', 'started')])])],
      recentActivityTrees: [],
      states: statesFor(['P']),
      topTaskId: null,
      orderedCards: [card('P'), card('C')],
      rulingRows: [ruling('P')],
    };
    const { view, placed, contextRows } = placementsOf(input);
    assert.deepEqual(contextRows, ['P'], 'P stays as a context row');
    assert.deepEqual(view.waiting.ids, ['P'], 'P has a card in Waiting');
    assert.equal(view.waiting.rows.length, 1, 'one ruling row, so one card: the count line and the badge agree with the cards');
    assert.deepEqual(view.waiting.contextIds, ['P'], 'P is a waiting context row (its row draws no state words)');
    assert.deepEqual([...placed].sort(), ['C', 'P'], 'P (its card) and C (the drawn child) are each placed once');
  });

  test('NEW: a started waiting task with nothing kept below it leaves Running and is in Waiting', () => {
    const input = {
      inProgressTrees: [{ projectId: 'p', projectName: 'p', roots: [node('S', 'started')] }],
      trees: [project('p', 'p', [node('S', 'started')])],
      recentActivityTrees: [],
      states: statesFor(['S']),
      topTaskId: null,
      orderedCards: [card('S')],
      rulingRows: [ruling('S')],
    };
    const view = buildHomeView(input);
    assert.deepEqual(view.waiting.ids, ['S']);
    assert.ok(!view.inProgressTrees.some(t => t.roots.some(n => n.issue.identifier === 'S')), 'S is not in Running');
  });

  test('NEW (witness 8, property): over generated forests with random waiting subsets, every open task is placed exactly once', () => {
    const SEEDS = 150;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = mulberry32(seed);
      const counter = { n: 0 };
      // Home's own reach, as the base view has it: a started task's children are reached through its Running node (kept
      // or "N more"), a Todo root through Up next (no more than three here, so the flat Up next rows hold all of them and
      // the per-project "show more" is empty), and a Backlog task only from /backlog, so its children are not generated.
      // Unstarted nodes are leaves below a started one. The per-project overflow overlapping the flat Up next rows is a
      // pre-existing base overlap and is outside this ticket's property (reported, not asserted here).
      let unstartedRoots = 0;
      const make = (depth, parentStarted) => {
        const id = `T${seed}-${++counter.n}`;
        let type = ['started', 'started', 'unstarted', 'backlog'][Math.floor(rng() * 4)];
        if (parentStarted === false && type === 'unstarted') type = 'backlog';
        if (type === 'unstarted' && parentStarted === undefined) {
          if (unstartedRoots >= 3) type = 'started';
          else unstartedRoots++;
        }
        const kids = type === 'started' && depth < 2
          ? Array.from({ length: Math.floor(rng() * 3) }, () => make(depth + 1, true))
          : [];
        return node(id, type, kids);
      };
      const trees = [];
      for (let p = 1; p <= 2; p++) {
        const roots = Array.from({ length: 3 + Math.floor(rng() * 4) }, () => make(0, undefined));
        trees.push(project(`p${p}`, `p${p}`, roots));
      }
      const allNodes = [];
      const visit = (nodes) => nodes.forEach(n => { allNodes.push(n); visit(n.children); });
      trees.forEach(t => visit(t.incomplete));
      const open = allNodes.filter(n => !isCompleted(n.issue));
      const ids = open.map(n => n.issue.identifier);
      // Home holds the started and Todo tasks; a Backlog task is counted per project and reached only from /backlog, so it
      // is placed by Home only when it has a ruling (then it is in Waiting). Every open task is a candidate for a ruling.
      const homeHeld = open.filter(n => n.issue.state.type !== 'backlog').map(n => n.issue.identifier);
      const waitingIds = ids.filter(() => rng() < 0.25);
      const inProgressTrees = trees.map(t => ({
        projectId: t.project.id,
        projectName: t.project.name,
        roots: t.incomplete.filter(n => n.issue.state.type === 'started').map(n => ({ ...n, children: n.children.filter(c => c.issue.state.type === 'started') })),
      })).filter(t => t.roots.length > 0);
      const recent = ids.filter(() => rng() < 0.3);
      const input = {
        inProgressTrees,
        trees,
        recentActivityTrees: recentOf(recent),
        states: statesFor(waitingIds),
        topTaskId: null,
        orderedCards: ids.map(card),
        rulingRows: waitingIds.map(id => ruling(id)),
      };
      const { view, placed, contextRows } = placementsOf(input);
      assert.ok(view.waiting, `seed ${seed}: the view carries a waiting section`);
      // One card per ruling, context rows included: the count line and the badge count every row, so every row has a card.
      assert.deepEqual(
        [...view.waiting.ids].sort(),
        [...waitingIds].sort(),
        `seed ${seed}: Waiting holds exactly the tasks with an open ruling, a named context row included`
      );
      const count = new Map();
      for (const id of placed) count.set(id, (count.get(id) || 0) + 1);
      for (const [id, n] of count) assert.equal(n, 1, `seed ${seed}: ${id} is placed ${n} times`);
      for (const id of new Set([...homeHeld, ...waitingIds])) {
        if (contextRows.includes(id)) continue;
        assert.equal(count.get(id) || 0, 1, `seed ${seed}: task ${id} is not placed exactly once`);
      }
    }
  });
});

/** A seeded PRNG (mulberry32), so the generated forests are the same on every run. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
