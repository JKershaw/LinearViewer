/**
 * LIN-4178 witnesses: the KPI path and the run page on the one cost read.
 *
 *  - W2 (KPI part): a horizon straddler is credited to its founder's issue on S11 and S12, with the same
 *    lineage set and day bucket; the founder lookup is what makes that true.
 *  - W5 (S13/S12 part): a complete $0 shows $0.00; an unpriced or unreadable lineage still withholds; the
 *    formatter never turns a missing figure into a dollar figure.
 *  - W4 (part): S1 and S13 agree on every lineage both price.
 *  - The incomplete rule on the public path (plan note 1): a done opencode straddler is not priced.
 *  - The founder lookup stays off the public path (kpi-stats.js receives it; it does not import it).
 *
 * Run with: node --test tests/unit/cost-read-kpi-path.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lineageRecords as lineageRecords__unplumbed, lineageFigure, lineageFigureOf as lineageFigureOf__unplumbed } from '../../lib/cost-read.js';
import { computeTerminalMarkedTaskCost as computeTerminalMarkedTaskCost__unplumbed } from '../../lib/terminal-marked-task-cost.js';
import { windowedSpend } from '../../lib/weekly-budget.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { fmtUsd } from '../../lib/render-run-steps.js';
import { collectKpiStats as collectKpiStats__unplumbed, toPublicKpis } from '../../lib/kpi-stats.js';
import { lineageIdentityOfRows } from '../../lib/dispatch-store.js';
import { runReplay, matches } from '../fixtures/cost-replay/harness.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';
import { lineageFigureOfOf, lineageRecordsOf, terminalMarkedTaskCostOf } from '../fixtures/cost-read-cores.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const lineageRecords = lineageRecordsOf;
const lineageFigureOf = lineageFigureOfOf;
const computeTerminalMarkedTaskCost = terminalMarkedTaskCostOf;
const collectKpiStats = withDefaults(collectKpiStats__unplumbed, 1, { requestSource: NO_REQUEST_RECORDS });


const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const ago = days => new Date(NOW.getTime() - days * DAY);

const usage = (payload, at) => ({ kind: 'usage', timestamp: at.toISOString(), message: `[usage] ${JSON.stringify(payload)}` });
const done = at => ({ kind: 'terminal', timestamp: at.toISOString(), message: '[done] fixture' });
const SONNET = 'anthropic/claude-sonnet-5';

/** A dispatch row in the formatted (feedback) shape the store's list reads return. */
function row({ id, root = id, issue, kind = 'implementation', at, status = 'taken', feedback = [], followUpTo }) {
  return { _id: id, id, rootItemId: root, issueIdentifier: issue, kind, status, abort: false, dispatchedAt: at, followUpTo, feedback };
}

/** The founder lookup's scalar shape for the same row. */
function scalar(r) {
  return { _id: r._id, rootItemId: r.rootItemId, status: r.status, abort: r.abort, kind: r.kind, issueIdentifier: r.issueIdentifier, dispatchedAt: r.dispatchedAt };
}

// The W2 corpus: founder `st` on LIN-42, 40 days old (outside the horizon); its in-window follow-up `st-2`
// is on LIN-99 and closes the lineage. `oth` is an unrelated done lineage on LIN-99.
const founder = row({ id: 'st', issue: 'LIN-42', at: ago(40), feedback: [usage({ model: SONNET, costUsd: 3 }, ago(40))] });
const followUp = row({ id: 'st-2', root: 'st', issue: 'LIN-99', kind: 'close-out', at: ago(2), followUpTo: 'st', feedback: [usage({ model: SONNET, costUsd: 4 }, ago(2)), done(ago(2))] });
const other = row({ id: 'oth', issue: 'LIN-99', at: ago(5), feedback: [usage({ model: SONNET, costUsd: 1 }, ago(5)), done(ago(5))] });
const horizon = [followUp, other];
const identity = [founder, followUp, other].map(scalar);

describe('W2 (KPI part): the horizon straddler is credited to its founder on the KPI path', () => {
  test('lineageRecords with the founder lookup: the lineage is LIN-42, of kind implementation, priced 4.00', () => {
    const [record] = lineageRecords({ fetchedRows: [followUp], identityRows: identity, outcomes: groupDispatchLineages(horizon) }).filter(r => r.anchor === 'st');
    assert.equal(record.issueIdentifier, 'LIN-42');
    assert.equal(record.baseKind, 'implementation');
    assert.equal(record.incomplete, false, 'the founder is older than the running total it does not change: complete');
    assert.equal(lineageFigure(record).costUsd, 4);
    assert.equal(record.status, 'done');
  });

  test('without the lookup the same lineage is credited to the follow-up issue (the defect LIN-4148 names)', () => {
    const [record] = lineageRecords({ fetchedRows: [followUp] }).filter(r => r.anchor === 'st');
    assert.equal(record.issueIdentifier, 'LIN-99');
  });

  test('S11: the straddler counts under LIN-42, so the ticket set is two tickets with the cost summed once', () => {
    const withLookup = computeTerminalMarkedTaskCost(horizon, NOW, { identityRows: identity });
    assert.equal(withLookup.pricedTicketCount, 2, 'LIN-42 and LIN-99');
    assert.equal(withLookup.pricedTicketCostUsd, 5, '4.00 (the straddler) + 1.00, each once');
    // The closeOut flag sits on the credited issue: LIN-42 is closed out, LIN-99 is not.
    assert.equal(withLookup.closeOutLineageShare, 0.5);

    const without = computeTerminalMarkedTaskCost(horizon, NOW);
    assert.equal(without.pricedTicketCount, 1, 'without the lookup both lineages fall under LIN-99');
    assert.equal(without.closeOutLineageShare, 1);
  });

  test('S12: the straddler is in the day of its earliest in-window member, not the founder\'s day', () => {
    const records = lineageRecords({ fetchedRows: horizon, identityRows: identity, outcomes: groupDispatchLineages(horizon) });
    const sinceMs = NOW.getTime() - 30 * DAY;
    const spend = windowedSpend(records, sinceMs, NOW.getTime());
    // Each lineage's day is its earliest in-window member's day: the straddler's is its follow-up's (2 days
    // ago), never the founder's (40 days ago, outside the window).
    const straddlerDay = followUp.dispatchedAt.toISOString().slice(0, 10);
    const otherDay = other.dispatchedAt.toISOString().slice(0, 10);
    assert.equal(spend.byDay.get(straddlerDay), 4);
    assert.equal(spend.byDay.get(otherDay), 1);
    assert.equal(spend.byDay.has(founder.dispatchedAt.toISOString().slice(0, 10)), false, 'the founder\'s day is outside the window');
    assert.equal(spend.pricedCount, 2);
    assert.equal(spend.lineageCount, 2);
  });

  test('the KPI path reads the aggregation shape (usageEntry, no feedback array) as the same figure', () => {
    const agg = { _id: 'oth', rootItemId: 'oth', issueIdentifier: 'LIN-99', kind: 'implementation', status: 'taken', abort: false, dispatchedAt: ago(5), usageEntry: usage({ model: SONNET, costUsd: 1 }, ago(5)) };
    const [record] = lineageRecords({ fetchedRows: [agg] }).filter(r => r.anchor === 'oth');
    assert.equal(lineageFigure(record).costUsd, 1);
  });
});

describe('the incomplete rule on the public path (plan note 1): a done opencode straddler is not priced', () => {
  test('S11 withholds the figure of a done opencode straddler whose founder the lookup supplies', () => {
    const founderDelta = row({ id: 'so', issue: 'LIN-8', at: ago(38), feedback: [usage({ harness: 'opencode', model: 'openrouter/qwen-3', costUsd: 0.7 }, ago(38))] });
    const delta = row({ id: 'so-2', root: 'so', issue: 'LIN-8', at: ago(3), followUpTo: 'so', feedback: [usage({ harness: 'opencode', model: 'openrouter/qwen-3', costUsd: 0.4 }, ago(3)), done(ago(3))] });
    const rows = [delta];
    const lookedUp = computeTerminalMarkedTaskCost(rows, NOW, { identityRows: [founderDelta, delta].map(scalar) });
    assert.equal(lookedUp.pricedTicketCount, 0, 'the straddler is incomplete: its component is not priced');
    assert.equal(lookedUp.pricedTicketCostUsd, null);
    const [record] = lineageRecords({ fetchedRows: rows, identityRows: [founderDelta, delta].map(scalar) });
    assert.equal(record.incomplete, true);
    assert.equal(lineageFigure(record).costUsd, null, 'never the in-window 0.40 as a complete figure');
  });
});

describe('W5 (S13/S12 part): no silent zero, and a complete $0 is a figure', () => {
  test('a complete zero is $0.00; a missing figure is no figure', () => {
    assert.equal(fmtUsd(0), '$0.00');
    assert.equal(fmtUsd(null), null);
    assert.equal(fmtUsd(undefined), null);
    assert.equal(fmtUsd(NaN), null);
  });

  test('a complete fold of an incomplete lineage shows no figure', () => {
    const record = { fold: { completeness: 'complete', costUsd: 3 }, incomplete: true };
    assert.equal(lineageFigure(record).costUsd, null);
    assert.equal(lineageFigure(record).fullyPriced, false);
  });

  test('lineageFigureOf: a complete $0 is a figure; an unreadable or unpriced row withholds it', () => {
    const zero = lineageFigureOf([row({ id: 'z', at: ago(1), feedback: [usage({ model: SONNET, costUsd: 0 }, ago(1))] })]);
    assert.equal(zero.fullyPriced, true);
    assert.equal(zero.costUsd, 0);

    const unreadable = lineageFigureOf([row({ id: 'u', at: ago(1), feedback: [{ kind: 'usage', message: '[usage] {not json' }] })]);
    assert.equal(unreadable.fullyPriced, false);
    assert.equal(unreadable.costUsd, null);

    const unpriced = lineageFigureOf([row({ id: 'p', at: ago(1), feedback: [usage({ model: '<synthetic>' }, ago(1))] })]);
    assert.equal(unpriced.fullyPriced, false);
    assert.equal(unpriced.costUsd, null);
  });
});

describe('W4 (part): S1 and S13 agree on every lineage both price (plan N2 / W4)', () => {
  let replay;
  before(async () => { replay = await runReplay(); });

  test('each run-page step with a priced figure matches the cost route\'s figure for the same lineage, where the route prices it', () => {
    const routeSessions = new Map();
    for (const issue of Object.keys(replay.S1)) {
      for (const session of replay.S1[issue].body.workerSessions) {
        if (!routeSessions.has(session.rootItemId)) routeSessions.set(session.rootItemId, session);
      }
    }
    let compared = 0;
    for (const step of replay.S13.steps) {
      if (step.cost.status !== 'priced' || !step.lineageId) continue;
      const session = routeSessions.get(step.lineageId);
      if (!session || session.costUsd === null || session.costUsd === undefined) continue;
      compared += 1;
      assert.equal(session.costUsd, step.cost.usd, `lineage ${step.lineageId}: route ${session.costUsd} vs run page ${step.cost.usd}`);
    }
    assert.ok(compared > 0, 'the corpus has lineages both surfaces price');
  });
});

describe('the founder lookup stays off the public path', () => {
  test('kpi-stats.js takes the lookup as an injected function and does not import the founder lookup', async () => {
    const source = await readFile(fileURLToPath(new URL('../../lib/kpi-stats.js', import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /from '\.\/dispatch-store\.js'/, 'no import of the store module');
    assert.doesNotMatch(source, /lineageIdentityOfRows\(/, 'no call of the lookup');
    assert.match(source, /lineageIdentity/, 'the lookup arrives as an injected dependency');
  });
});

describe('the /kpis founder wiring (LIN-4178 review finding 2): the production lookup reaches the public cost figure', () => {
  // A raw collection that answers the filters the production reads send (`matches`, the replay's filter model).
  const collection = (docs) => ({
    find: (filter = {}) => ({ toArray: async () => docs.filter(doc => matches(doc, filter)) }),
    countDocuments: async (filter = {}) => docs.filter(doc => matches(doc, filter)).length,
    findOne: async () => null,
  });
  const raw = (fields) => ({ urlKey: 'acme', status: 'taken', abort: false, ...fields });
  // Founder `st` on LIN-42, 40 days old: outside the 30-day horizon, so only the lookup can return it. Its in-window
  // follow-up `st-2` is on LIN-99 and carries the cost the public card sums; `oth` is an unrelated done lineage on LIN-99.
  const HISTORY = [
    raw({ _id: 'st', rootItemId: 'st', issueIdentifier: 'LIN-42', kind: 'implementation', dispatchedAt: ago(40), feedback: [usage({ model: SONNET, costUsd: 3 }, ago(40))] }),
    raw({ _id: 'st-2', rootItemId: 'st', issueIdentifier: 'LIN-99', kind: 'close-out', dispatchedAt: ago(2), followUpTo: 'st', feedback: [usage({ model: SONNET, costUsd: 4 }, ago(2)), done(ago(2))] }),
    raw({ _id: 'oth', rootItemId: 'oth', issueIdentifier: 'LIN-99', kind: 'implementation', dispatchedAt: ago(5), feedback: [usage({ model: SONNET, costUsd: 1 }, ago(5)), done(ago(5))] }),
  ];
  const QUEUE = [];
  // The same bag the server hands collectKpiStats, every collection empty but the two dispatch ones.
  const bag = () => {
    const empty = () => collection([]);
    return {
      sessions: empty(), userPreferences: empty(), workspacePreferences: empty(), customPrompts: empty(),
      localIssues: empty(), dispatchTokens: empty(), proxyTokens: empty(), proxyEvents: empty(), agentStatus: empty(),
      freeTier: empty(), recapCache: empty(), briefCache: empty(), reportHistory: empty(), kpiDailyRollup: empty(),
      dispatchHistory: collection(HISTORY), dispatchQueue: collection(QUEUE),
    };
  };

  test('with the lookup, the straddler is credited to LIN-42: the card counts two tickets and sums the cost once', async () => {
    const seen = [];
    const lineageIdentity = async rows => {
      const found = await lineageIdentityOfRows([collection(HISTORY), collection(QUEUE)], rows);
      seen.push(...found);
      return found;
    };
    const stats = await collectKpiStats(bag(), { lineageIdentity, now: NOW, milestoneFunnelDeps: {} });
    assert.ok(seen.some(row => row._id === 'st'), 'the lookup returned the founder, which the horizon did not fetch');
    assert.equal(stats.terminalMarkedTaskCost.pricedTicketCount, 2, 'LIN-42 and LIN-99');
    assert.equal(stats.terminalMarkedTaskCost.pricedTicketCostUsd, 5, '4.00 (the straddler) + 1.00, each once');
  });

  test('without the lookup the same rows read the straddler as LIN-99: one ticket (the difference the wiring makes)', async () => {
    const stats = await collectKpiStats(bag(), { lineageIdentity: async () => [], now: NOW, milestoneFunnelDeps: {} });
    assert.equal(stats.terminalMarkedTaskCost.pricedTicketCount, 1);
    assert.equal(stats.terminalMarkedTaskCost.pricedTicketCostUsd, 5);
  });

  test('the public page carries no identifier the lookup supplied', async () => {
    const lineageIdentity = rows => lineageIdentityOfRows([collection(HISTORY), collection(QUEUE)], rows);
    const stats = await collectKpiStats(bag(), { lineageIdentity, now: NOW, milestoneFunnelDeps: {} });
    assert.doesNotMatch(JSON.stringify(toPublicKpis(stats)), /LIN-42|LIN-99/);
  });

  test('server.js wires the lookup over the same two collections the test mirrors', async () => {
    const server = await readFile(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');
    assert.match(server, /lineageIdentity: rows => lineageIdentityOfRows\(\[dispatchHistoryCollection, dispatchQueueCollection\], rows\)/);
  });
});
