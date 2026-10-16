// Scenario generator for routes/proxy-rulings.js (createRulingsRoutes).
//
// Loops are NOT faked: the real lib/pipeline-loops.js getLoopsForWorkspace
// rebuilds them from seeded dispatchQueueStore (listItems/listHistory) and
// agentStatusStore (listStatus) rows, shaped like the fixtures in
// tests/unit/proxy-rulings-routes.test.js, with fresh digests stamped by the
// real digestFeedback (withFreshDigests).
import { G, FIXED_NOW } from './common.mjs';
import { ok, fail, genAuth, genRegistry, encodeBody, qs, pathVariant } from './gen-common.mjs';
import { RULINGS_VARIANTS } from './fakes.mjs';

export const ROUTE_KEYS = {
  get: 'GET /api/proxy/rulings',
  dismiss: 'POST /api/proxy/rulings/:decisionId/suggest-dismissal',
  answer: 'POST /api/proxy/rulings/:decisionId/suggest-answer',
  unmatched: '(unmatched)',
};

const iso = (msAgo) => new Date(FIXED_NOW - msAgo).toISOString();
const H = 3600_000;
const DECISIONS = ['d-1', 'd-2', 'd-3', 'd-ünï'];
const OPTIONS = [{ id: 'opt-a', label: 'Ship it' }, { id: 'opt-b', label: 'Hold' }];

function decisionEntry(g, decisionId, at) {
  const d = { decision_id: decisionId, question: g.pick(['Proceed?', 'Which approach? ✓']) };
  const o = g.weighted([['opts', 5], ['none', 2], ['empty', 0.6], ['bad', 0.3]]);
  if (o === 'opts') d.options = OPTIONS;
  if (o === 'empty') d.options = [];
  if (o === 'bad') d.options = 'opt-a';
  if (g.chance(0.3)) d.on_answer = { effect: g.pick(['dispatch', 'record', 'resume']) };
  return { kind: 'decision', message: JSON.stringify(d), timestamp: at };
}

function historyRow(g, k, urlKey, ids) {
  const id = `loop-${k}`;
  const ago = g.pick([2 * H, 5 * H, 20 * H, 3 * 24 * H, 40 * 24 * H]);
  const decisionId = g.pick(DECISIONS);
  const feedback = [{ message: '[blocked] need a decision', timestamp: iso(ago - 1000) }];
  if (g.chance(0.9)) feedback.push(decisionEntry(g, decisionId, iso(ago - 2000)));
  const fate = g.weighted([['open', 6], ['answered', 1.2], ['dismissed', 1], ['withdrawn', 1], ['reversed', 0.3], ['badStamp', 0.3]]);
  if (fate === 'answered' || fate === 'dismissed') feedback.push({ kind: 'decision-answer', message: JSON.stringify({ decision_id: decisionId, outcome: fate }), timestamp: iso(ago - 3000) });
  if (fate === 'withdrawn' || fate === 'reversed') feedback.push({ kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: decisionId, reason: 'no longer needed' }), timestamp: iso(ago - 3000) });
  if (fate === 'reversed') feedback.push({ kind: 'decision-withdrawal-reversed', message: JSON.stringify({ decision_id: decisionId }), timestamp: iso(ago - 4000) });
  if (fate === 'badStamp') feedback.push({ kind: 'decision-answer', message: '{not json', timestamp: iso(ago - 3000) });
  if (g.chance(0.25)) feedback.push({ message: g.pick(['[done] shipped', '[failed] crashed']), timestamp: iso(ago - 5000) });
  const row = {
    id, issueIdentifier: g.weighted([['LIN-12', 4], ['LIN-7', 2], [null, 0.5]]), issueTitle: 'Title', issueId: g.pick(['iss-12', 'iss-7']),
    promptName: 'implementation', prompt: 'p', dispatchedAt: iso(ago), resolvedAt: iso(ago - 500), status: 'taken', feedback,
  };
  if (ids.length && g.chance(0.25)) row.rootItemId = g.pick(ids); // lineage member
  if (ids.length && g.chance(0.12)) row.followUpTo = g.pick(ids); // supersedes a prior loop
  if (g.chance(0.08)) row.bookkeeping = { at: iso(ago - 6000), by: 'closer' };
  if (g.chance(0.15)) row.issueSource = g.pick(['linear', 'jira']);
  void urlKey;
  return row;
}

function world(g, s) {
  const urlKey = s.auth.result.urlKey;
  const n = g.weighted([[0, 1], [1, 2], [3, 4], [6, 2], [30, 0.2]]);
  const rows = [];
  for (let k = 0; k < n; k++) rows.push(historyRow(g, k, urlKey, rows.map(r => r.id)));
  s.world = { loopIds: rows.map(r => r.id), decisionIds: [...new Set(rows.flatMap(r => r.feedback.filter(f => f.kind === 'decision').map(f => JSON.parse(f.message).decision_id)))] };
  const live = g.chance(0.3) ? [{ id: 'live-1', issueIdentifier: g.pick(['LIN-12', 'LIN-7']), status: 'pending', dispatchedAt: iso(60_000), feedback: [] }] : [];
  s.stores.dispatchQueueStore = {
    listItems: g.chance(0.02) ? fail({ kind: 'plain', message: 'queue down' }) : ok({ __fresh: live }),
    listHistory: g.weighted([[ok({ items: { __fresh: rows } }), 30], [ok(null), 0.3], [fail({ kind: 'plain', message: 'history down' }), 0.6]]),
  };
  s.stores.agentStatusStore = { listStatus: ok({ items: g.chance(0.1) ? [{ taskIdentifier: 'LIN-12', state: 'running', updatedAt: iso(1000) }] : [] }) };
  // task-bound decisions + newest-scan map
  const td = [];
  if (g.chance(0.4)) td.push({ id: 'td-1', urlKey, issueId: 'iss-9', issueIdentifier: g.pick(['LIN-9', 'LIN-12']), decision: { decision_id: g.pick(['d-task', 'd-1']), question: 'Task?', ...(g.chance(0.6) ? { options: OPTIONS } : {}) }, outcome: null, scannedAt: iso(H) });
  if (td.length) s.world.decisionIds.push(td[0].decision.decision_id);
  s.stores.taskDecisionsStore = {
    listUnansweredForWorkspaces: g.chance(0.03) ? fail({ kind: 'plain', message: 'td down' }) : ok(td),
    listNewestScanPerTask: ok(g.chance(0.2) && td.length ? { [`${urlKey}::iss-9`]: { urlKey, issueId: 'iss-9', outcome: 'answered', scannedAt: iso(10) } } : {}),
  };
  // shelves: loop-scoped / legacy-wide, active / lapsed
  const shelves = [];
  if (g.chance(0.3) && rows.length) {
    shelves.push({
      urlKey, decisionId: g.pick(DECISIONS), ...(g.chance(0.5) ? { decisionLoopId: g.pick(rows).id } : {}),
      resurfaceAt: g.chance(0.6) ? iso(-24 * H) : iso(H), lapseCount: g.pick([0, 1, 2]),
    });
  }
  s.stores.shelvedRulingsStore = { listForWorkspaces: ok(shelves) };
  // standing suggestions (with / without decisionLoopId, withdrawn)
  const sugg = [];
  if (g.chance(0.35) && rows.length) {
    sugg.push({
      urlKey, decisionId: g.pick(DECISIONS), ...(g.chance(0.5) ? { decisionLoopId: g.pick(rows).id } : {}),
      reason: 'looks moot', suggestedBy: 'acct_1', suggestedAt: iso(H), ...(g.chance(0.3) ? { proposedOutcome: 'answered', optionId: 'opt-a' } : {}),
      withdrawn: g.chance(0.2),
    });
  }
  s.stores.dismissalSuggestionsStore = {
    listForWorkspaces: g.chance(0.02) ? fail({ kind: 'plain', message: 'sugg down' }) : ok(sugg),
    suggest: g.weighted([
      [ok({ urlKey, decisionId: 'echo', reason: 'r', suggestedBy: 'acct_1', suggestedAt: iso(0), withdrawn: false }), 8],
      [ok(null), 0.8], [fail({ kind: 'plain', message: 'write failed' }), 0.8],
    ]),
  };
  s.feedCache = g.weighted([
    [{ mode: 'miss' }, 8],
    [{ mode: 'hit', cached: [{ loopId: 'cached-1', workspaceUrlKey: urlKey, decision: { decision_id: 'd-1', question: 'Cached?', options: OPTIONS }, agentState: 'running', issueIdentifier: 'LIN-12', dispatchedAt: iso(H) }] }, 1.5],
    [{ mode: 'throw', throw: { kind: 'plain', message: 'cache down' } }, 0.3],
  ]);
}

function decisionIdParam(g, s) {
  const known = s.world.decisionIds;
  return g.weighted([
    [known.length ? g.pick(known) : 'd-1', 7], ['d-1', 1.5], ['nope', 1], ['d-%C3%BCn%C3%AF', 0.5], ['x'.repeat(300), 0.2], ['%E0%A4%A', 0.1], ['cached', 0.1],
  ]);
}

function decisionLoopId(g, s) {
  return g.weighted([
    [undefined, 5], [s.world.loopIds.length ? g.pick(s.world.loopIds) : 'loop-0', 3], ['loop-z', 0.8], ['td-1', 0.5], ['cached-1', 0.3],
    ['', 0.3], [5, 0.2], [null, 0.2],
  ]);
}

function reason(g) {
  return g.weighted([['Superseded by LIN-99 ✓', 8], ['', 0.4], ['   ', 0.3], [undefined, 0.5], [123, 0.2], ['r'.repeat(501), 0.3], ['r'.repeat(500) + '   ', 0.2]]);
}

const ROUTES = {
  get(g, s) {
    s.method = g.chance(0.02) ? 'HEAD' : 'GET';
    const pairs = [];
    const ir = g.weighted([['absent', 4], ['true', 3], ['false', 1], ['TRUE', 0.3], ['array', 0.2]]);
    if (ir === 'array') pairs.push(['includeResolved', 'true'], ['includeResolved', 'true']);
    else if (ir !== 'absent') pairs.push(['includeResolved', ir]);
    const ii = g.weighted([['absent', 4], ['LIN-12', 2], ['LIN-7', 1], ['LIN-9', 0.6], ['LIN-404', 0.6], ['', 0.3], ['array', 0.1]]);
    if (ii === 'array') pairs.push(['issueIdentifier', 'LIN-12'], ['issueIdentifier', 'LIN-7']);
    else if (ii !== 'absent') pairs.push(['issueIdentifier', ii]);
    if (g.chance(0.3)) pairs.reverse();
    s.path = '/api/proxy/rulings' + qs(pairs);
    s.body = { kind: 'none' };
  },
  dismiss(g, s) {
    s.method = 'POST';
    s.path = `/api/proxy/rulings/${decisionIdParam(g, s)}/suggest-dismissal`;
    s.body = encodeBody(g, { reason: reason(g), decisionLoopId: decisionLoopId(g, s), ...(g.chance(0.05) ? { suggestedBy: 'spoof' } : {}) });
  },
  answer(g, s) {
    s.method = 'POST';
    s.path = `/api/proxy/rulings/${decisionIdParam(g, s)}/suggest-answer`;
    s.body = encodeBody(g, {
      optionId: g.weighted([['opt-a', 6], ['opt-b', 2], ['opt-z', 1], ['', 0.3], ['  ', 0.2], [undefined, 0.4], [7, 0.2]]),
      reason: reason(g), decisionLoopId: decisionLoopId(g, s),
    });
  },
  unmatched(g, s) {
    const [m, p] = g.pick([
      ['POST', '/api/proxy/rulings'], ['GET', '/api/proxy/rulings/d-1/suggest-dismissal'], ['POST', '/api/proxy/rulings/d-1/dismiss'],
      ['POST', '/api/proxy/rulings/d-1/answer'], ['DELETE', '/api/proxy/rulings/d-1'], ['POST', '/api/proxy/rulings//suggest-answer'],
    ]);
    s.method = m;
    s.path = p;
    s.body = encodeBody(g, { reason: 'x' });
  },
};

const WEIGHTS = [['get', 1], ['dismiss', 1], ['answer', 1], ['unmatched', 0.1]];

export function generateScenario(seed, i) {
  const g = new G((seed * 1000003 + i * 7919 + 202) >>> 0);
  const route = g.weighted(WEIGHTS);
  const s = {
    index: i, slot: 'rulings', route, routeKey: ROUTE_KEYS[route],
    variant: g.weighted(RULINGS_VARIANTS.map((v, k) => [v, k === 0 ? 6 : 1])),
    method: 'GET', path: '', body: { kind: 'none' },
    auth: genAuth(g),
    access: { token: null },
    provider: null,
    registry: genRegistry(g),
    stores: {},
    limiter: g.chance(0.02) ? { proxyLimiter: 'block' } : {},
    randomSeed: g.int(1, 2 ** 31 - 1),
  };
  world(g, s);
  ROUTES[route](g, s);
  if (g.chance(0.01)) s.stores.proxyEventStore = { recordEvent: { throw: { kind: 'plain', message: 'recordEvent rejected' } } };
  if (route !== 'unmatched') s.path = pathVariant(g, s.path);
  return s;
}
