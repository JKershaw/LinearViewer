/**
 * Milestone-funnel readers (LIN-2952): the shared pieces the per-account route
 * (routes/milestone-funnel.js) and the cross-account aggregate build on.
 *
 * Two things live here:
 *
 * 1. Canonicalization — a PRE-RESOLVED map, the same idiom as
 *    `lib/credential-invariant-sweep.js:220-224`: resolve every recorded account
 *    id once, and let the pure aggregator group on
 *    `canonicalByAccountId.get(id) ?? id`. A merge can only ever move a person
 *    forward (an id canonical at write time can later be merged away), so the
 *    read must fold the group at read time.
 *
 * 2. The five step readers. Each yields one of THREE states:
 *    `reached | not-reached | no-signal`, with the step's OWN recorded time and
 *    a coverage label. Times are never synthesized, and out-of-order steps are
 *    FLAGGED, never reordered or dropped:
 *      - login       account.createdAt (first sign-in across the group)
 *      - connected   account↔workspace membership-edge createdAt
 *      - first Go    earliest FRESH dispatch by `dispatchedBy` — the LIN-2955 Q1
 *                    predicate (`isFreshRun`, lib/dispatch-store.js), so one Go
 *                    press is one row and follow-up/worker/cascade/wake/abort
 *                    rows are continuations, not a Go
 *      - PR opened   earliest `kind:'evidence'` feedback whose `url` is a PR —
 *                    a witnessed proxy for open time, not the forge's timestamp.
 *                    Deliberately NOT narrowed to fresh rows: evidence is posted
 *                    on the run's later worker/follow-up rows
 *      - merge click the funnel-event store; `no-signal` until LIN-2949 wires
 *                    the write (`INSTRUMENTED_STEPS`)
 *
 * A source read that THROWS is `no-signal` (could not observe), never a
 * synthesized `not-reached` (observed absence) and never `reached`.
 */

import { INSTRUMENTED_STEPS } from './funnel-event-store.js';
import { isFreshRun } from './dispatch-store.js';

// The funnel's steps, in the order the milestone claims they happen. Read as
// such for the out-of-order flag; display order is this order.
export const STEP_KEYS = Object.freeze(['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']);

export const STEP_STATES = Object.freeze({
  REACHED: 'reached',
  NOT_REACHED: 'not-reached',
  NO_SIGNAL: 'no-signal'
});

// A GitHub pull-request URL, exactly as the runner's `link.js` canonicalises a
// classified PR (`https://github.com/<owner>/<repo>/pull/<n>`, see
// simple-dispatcher/links.js's `canon` for category 'pr' and e2e-smoke.js's
// fixture). Deliberately not a GitHub issue/commit/compare, and not another
// host — those are not "PR opened". Trailing path/query/fragment tolerated.
const PR_URL_RE = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:[/?#].*)?$/i;

/**
 * Whether a URL is a pull request (the runner's evidence `url` field).
 * @param {*} url
 * @returns {boolean}
 */
export function isPullRequestUrl(url) {
  return typeof url === 'string' && PR_URL_RE.test(url.trim());
}

function toMillis(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function earliestIso(values) {
  let min = null;
  for (const value of values) {
    const ms = toMillis(value);
    if (ms !== null && (min === null || ms < min)) min = ms;
  }
  return min === null ? null : new Date(min).toISOString();
}

function reached(at, coverage) {
  return { state: STEP_STATES.REACHED, at, coverage };
}

function notReached(coverage) {
  return { state: STEP_STATES.NOT_REACHED, at: null, coverage };
}

function noSignal(coverage) {
  return { state: STEP_STATES.NO_SIGNAL, at: null, coverage };
}

/**
 * Resolve every recorded account id to its canonical id, once.
 *
 * Never drops or crashes: `resolveCanonicalAccountId` throws on a corrupt
 * `mergedInto` chain (a cycle, or an over-deep chain), and a throw here falls
 * back to the recorded id for THAT id only — the person under-counts, and no
 * account is ever silently reassigned to another. Falsy ids are skipped.
 *
 * @param {Iterable<string>} accountIds
 * @param {import('./account-store.js').AccountStore} accountStore
 * @returns {Promise<Map<string, string>>} recorded id -> canonical id
 */
export async function buildCanonicalMap(accountIds, accountStore) {
  const map = new Map();
  for (const accountId of new Set(accountIds || [])) {
    if (!accountId) continue;
    try {
      map.set(accountId, await accountStore.resolveCanonicalAccountId(accountId));
    } catch (err) {
      console.error(`[milestone-funnel] canonicalization failed for an account: ${err?.message || err}`);
      map.set(accountId, accountId);
    }
  }
  return map;
}

const LOGIN_COVERAGE = 'account.createdAt (first sign-in across the group)';
const CONNECTED_COVERAGE = 'account↔workspace membership-edge createdAt';
const FIRST_GO_COVERAGE = 'fresh Go presses (one Go press = one fresh dispatch row), oldest first';
const PR_OPENED_COVERAGE = 'runner [evidence] feedback with a PR URL — a witnessed proxy for open time';
const MERGE_CLICKED_COVERAGE = 'merge-click event store';

async function readLogin(accountIds, accountStore) {
  if (!accountStore) return noSignal(LOGIN_COVERAGE);
  try {
    const accounts = await Promise.all(accountIds.map(id => accountStore.getAccount(id)));
    const at = earliestIso(accounts.filter(Boolean).map(a => a.createdAt));
    return at ? reached(at, LOGIN_COVERAGE) : notReached(LOGIN_COVERAGE);
  } catch (err) {
    console.error('[milestone-funnel] login read failed:', err?.message || err);
    return noSignal(LOGIN_COVERAGE);
  }
}

async function readConnected(accountIds, accountWorkspaceStore) {
  if (!accountWorkspaceStore) return noSignal(CONNECTED_COVERAGE);
  try {
    const edges = await accountWorkspaceStore.listEdgesForAccounts(accountIds);
    const at = earliestIso(edges.map(edge => edge.createdAt));
    return at ? reached(at, CONNECTED_COVERAGE) : notReached(CONNECTED_COVERAGE);
  } catch (err) {
    console.error('[milestone-funnel] connected read failed:', err?.message || err);
    return noSignal(CONNECTED_COVERAGE);
  }
}

/**
 * A person's dispatch rows across BOTH collections, excluding aborts. This is
 * the wide read both first-Go and PR-opened need: first-Go narrows it through
 * `isFreshRun` (a Go press is exactly one fresh row), while PR opened reads
 * every non-abort person-attributed row because the runner posts its `[evidence]`
 * PR url on the run's worker/follow-up rows, not only the fresh one.
 */
async function readGroupDispatches(accountIds, { dispatchQueue, dispatchHistory } = {}) {
  const query = { dispatchedBy: { $in: accountIds } };
  const read = (collection) => (collection ? collection.find(query).toArray() : Promise.resolve([]));
  const [queued, history] = await Promise.all([read(dispatchQueue), read(dispatchHistory)]);
  return [...queued, ...history].filter(doc => doc.abort !== true);
}

function readFirstGo(rows) {
  const at = earliestIso(rows.filter(isFreshRun).map(doc => doc.dispatchedAt));
  return at ? reached(at, FIRST_GO_COVERAGE) : notReached(FIRST_GO_COVERAGE);
}

function readPrOpened(rows) {
  let min = null;
  for (const doc of rows) {
    for (const entry of doc.feedback || []) {
      if (entry?.kind !== 'evidence' || !isPullRequestUrl(entry?.url)) continue;
      const ms = toMillis(entry.timestamp);
      if (ms !== null && (min === null || ms < min)) min = ms;
    }
  }
  return min === null ? notReached(PR_OPENED_COVERAGE) : reached(new Date(min).toISOString(), PR_OPENED_COVERAGE);
}

async function readMergeClicked(accountIds, funnelEventStore, instrumentedSteps = INSTRUMENTED_STEPS) {
  if (!instrumentedSteps.includes('merge-clicked')) {
    return noSignal('awaiting instrumentation (LIN-2949)');
  }
  if (!funnelEventStore) return noSignal(MERGE_CLICKED_COVERAGE);
  try {
    const rows = await funnelEventStore.firstPerAccount({ accountIds, step: 'merge-clicked' });
    const at = earliestIso(rows.map(row => row.at));
    return at ? reached(at, MERGE_CLICKED_COVERAGE) : notReached(MERGE_CLICKED_COVERAGE);
  } catch (err) {
    console.error('[milestone-funnel] merge-click read failed:', err?.message || err);
    return noSignal(MERGE_CLICKED_COVERAGE);
  }
}

/**
 * The steps whose recorded time runs before an earlier step's — flagged, never
 * reordered or repaired. `reached` steps only; an unreached/no-signal step has
 * no time to compare and is omitted.
 * @param {Object} steps
 * @returns {string[]}
 */
function findOutOfOrder(steps) {
  const outOfOrder = [];
  let latestEarlier = null;
  for (const key of STEP_KEYS) {
    const step = steps[key];
    if (step?.state !== STEP_STATES.REACHED) continue;
    const ms = toMillis(step.at);
    if (ms === null) continue;
    if (latestEarlier !== null && ms < latestEarlier) outOfOrder.push(key);
    if (latestEarlier === null || ms > latestEarlier) latestEarlier = ms;
  }
  return outOfOrder;
}

/**
 * Read the five funnel steps for one account GROUP (the whole merge group), so
 * the per-account route finds events recorded under a merged-away id. Merging
 * is the caller's job (`resolveAccountGroup`): pass every id in the group.
 *
 * @param {Object} deps
 * @param {string[]} deps.accountIds - canonical + merged + the session id
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @param {Object} deps.dispatchQueue - 'dispatch-queue' collection
 * @param {Object} deps.dispatchHistory - 'dispatch-history' collection
 * @param {import('./funnel-event-store.js').FunnelEventStore} deps.funnelEventStore
 * @param {readonly string[]} [deps.instrumentedSteps=INSTRUMENTED_STEPS] - test seam; always the code constant in production
 * @returns {Promise<{steps: Object, outOfOrder: string[]}>}
 */
export async function stepsForAccountGroup({ accountIds, accountStore, accountWorkspaceStore, dispatchQueue, dispatchHistory, funnelEventStore, instrumentedSteps = INSTRUMENTED_STEPS } = {}) {
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean))];

  let rows = null;
  try {
    rows = await readGroupDispatches(ids, { dispatchQueue, dispatchHistory });
  } catch (err) {
    console.error('[milestone-funnel] dispatch read failed:', err?.message || err);
  }

  const [login, connected, mergeClicked] = await Promise.all([
    readLogin(ids, accountStore),
    readConnected(ids, accountWorkspaceStore),
    readMergeClicked(ids, funnelEventStore, instrumentedSteps)
  ]);

  const steps = {
    login,
    connected,
    firstGo: rows ? readFirstGo(rows) : noSignal(FIRST_GO_COVERAGE),
    prOpened: rows ? readPrOpened(rows) : noSignal(PR_OPENED_COVERAGE),
    mergeClicked
  };

  return { steps, outOfOrder: findOutOfOrder(steps) };
}

// ─── Cross-account aggregate (LIN-2952) ──────────────────────────────────────

// Aggregate coverage labels. App-defined strings only — no ids, keys or urls.
const AGG_COVERAGE = Object.freeze({
  login: 'accounts created in the window (distinct canonical people)',
  connected: 'account↔workspace membership edges created in the window (distinct canonical people)',
  firstGo: 'fresh Go presses in the window (one Go press = one fresh dispatch row, continuations excluded), distinct canonical people',
  prOpened: 'runner [evidence] feedback with a PR url in the window, any non-abort person-attributed row (distinct canonical people)',
  mergeClicked: 'merge-click event store',
  mergeClickedNoSignal: 'awaiting instrumentation (LIN-2949)'
});

function aggReached(count, coverage) {
  return { state: STEP_STATES.REACHED, count, coverage };
}

function aggNoSignal(coverage) {
  return { state: STEP_STATES.NO_SIGNAL, count: null, coverage };
}

function countDistinctCanonical(ids, canonicalByAccountId) {
  const seen = new Set();
  for (const id of ids) {
    if (!id) continue;
    seen.add(canonicalByAccountId.get(id) ?? id);
  }
  return seen.size;
}

// R4/G4: the aggregate's dispatch read projects ONLY the fields its predicate
// (`isFreshRun`) and its PR-link scan need — never `prompt`, the raw feedback
// `message`, or any other task content. `dispatchedBy`/`dispatchedAt`; the
// fresh-run predicate's `followUpTo`/`sessionId`/`cascade`/`kind`/`abort`; and
// the feedback link's `kind`/`url`/`timestamp`.
const DISPATCH_PROJECTION = Object.freeze({
  dispatchedBy: 1,
  dispatchedAt: 1,
  followUpTo: 1,
  sessionId: 1,
  cascade: 1,
  kind: 1,
  abort: 1,
  'feedback.kind': 1,
  'feedback.url': 1,
  'feedback.timestamp': 1
});

// Feedback entries. Production MongoDB returns `feedback` as an array of projected subdocs (verified on a real mongod). MangoDB (dev/test engine) collapses a dotted `feedback.kind/url` projection into ONE object, taking each field from the first element that has it, so this tolerance is exact only for a single-entry array; a mixed multi-entry array can miscount on MangoDB (dev /kpis only).
function feedbackEntries(doc) {
  const feedback = doc.feedback;
  if (!feedback) return [];
  return Array.isArray(feedback) ? feedback : [feedback];
}

function collectPrAccountIds(rows) {
  const ids = [];
  for (const doc of rows) {
    for (const entry of feedbackEntries(doc)) {
      if (entry?.kind === 'evidence' && isPullRequestUrl(entry?.url)) {
        ids.push(doc.dispatchedBy);
        break;
      }
    }
  }
  return ids;
}

/**
 * The instance-wide milestone-funnel aggregate for the public /kpis page.
 *
 * Counts DISTINCT CANONICAL PEOPLE per step, with events inside the shared
 * 30-day window (`since` is kpi-stats' own horizon start). Counts and
 * app-defined labels only — no account ids, workspace keys, urlKeys, issue
 * identifiers, PR urls or per-account timestamps appear anywhere in the result.
 *
 * Three-state rules, all load-bearing:
 *  - An ABSENT source (no dep injected) is `no-signal`, never a zero — a
 *    missing instrument must never read as "no people".
 *  - A READ FAILURE propagates (R3/G3, LIN-3002): a throwing dep rejects this
 *    call so `collectKpiStats`/`/kpis` surfaces it instead of caching an
 *    all-no-signal snapshot. The ONE exception is the merge-clicked
 *    funnel-event read below, which is a step-level instrument signal (R2) and
 *    reads `no-signal`.
 *  - `merge-clicked` is `no-signal` until `INSTRUMENTED_STEPS` contains it, so a
 *    not-yet-built instrument is never reported as zero reach.
 *
 * Rejects when a dep read throws; `collectKpiStats` awaits it in `Promise.all`.
 *
 * @param {Object} [deps]
 * @param {Date} [deps.since] - window start (kpi-stats' 30-day horizon)
 * @param {import('./task-mode-store.js').TaskModeStore} [deps.taskModeStore]
 * @param {import('./account-store.js').AccountStore} [deps.accountStore]
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} [deps.accountWorkspaceStore]
 * @param {import('./funnel-event-store.js').FunnelEventStore} [deps.funnelEventStore]
 * @param {Object} [deps.dispatchQueue] - 'dispatch-queue' collection
 * @param {Object} [deps.dispatchHistory] - 'dispatch-history' collection
 * @param {readonly string[]} [deps.instrumentedSteps=INSTRUMENTED_STEPS] - test seam; always the code constant in production
 * @returns {Promise<{steps: Object, mode: Object|null}>}
 */
export async function collectMilestoneFunnel({ since, taskModeStore, accountStore, accountWorkspaceStore, funnelEventStore, dispatchQueue, dispatchHistory, instrumentedSteps = INSTRUMENTED_STEPS } = {}) {
  // R3/G3: reads are NOT wrapped — a throwing dep propagates to the caller
  // (LIN-3002). An ABSENT dep still means "no instrument" and reads no-signal;
  // only the merge-clicked funnel-event read below is caught (R2, step-level).
  const loginIds = accountStore?.collection
    ? await accountStore.collection.find({ createdAt: { $gte: since } }, { projection: { _id: 1 } })
      .toArray().then(docs => docs.map(d => d._id))
    : null;

  const connectedIds = accountWorkspaceStore?.collection
    ? await accountWorkspaceStore.collection.find({ createdAt: { $gte: since } }, { projection: { accountId: 1 } })
      .toArray().then(docs => docs.map(d => d.accountId))
    : null;

  const dispatchRows = (dispatchQueue || dispatchHistory)
    ? await Promise.all([
      dispatchQueue ? dispatchQueue.find({ dispatchedAt: { $gte: since } }, { projection: DISPATCH_PROJECTION }).toArray() : Promise.resolve([]),
      dispatchHistory ? dispatchHistory.find({ dispatchedAt: { $gte: since } }, { projection: DISPATCH_PROJECTION }).toArray() : Promise.resolve([])
    ]).then(([q, h]) => [...q, ...h])
    : null;

  const firstGoIds = dispatchRows === null ? null : dispatchRows.filter(isFreshRun).map(doc => doc.dispatchedBy);
  const prIds = dispatchRows === null ? null : collectPrAccountIds(dispatchRows.filter(doc => doc.abort !== true));

  let mergeIds = null;
  let mergeInstrumented = true;
  if (!instrumentedSteps.includes('merge-clicked')) {
    mergeInstrumented = false;
  } else if (funnelEventStore) {
    // R2: a failed funnel-event read is a step-level instrument signal, so the
    // merge-click step reads no-signal — the one swallowed read, kept distinct
    // from every other dep's read failure, which propagates (R3).
    try {
      mergeIds = await funnelEventStore.firstPerAccount({ step: 'merge-clicked', since }).then(rows => rows.map(r => r.accountId));
    } catch (err) {
      console.error('[milestone-funnel] merge-click read failed:', err?.message || err);
      mergeIds = null;
    }
  }

  // Build ONE canonical map. It covers every account so the task-mode log's
  // own recorded ids fold too (a person split across a merge); a step id not
  // in the map (a deleted account) falls back to itself.
  const sourceIds = new Set();
  for (const list of [loginIds, connectedIds, firstGoIds, prIds, mergeIds]) {
    for (const id of list || []) if (id) sourceIds.add(id);
  }
  let allAccountIds = [];
  if (accountStore?.collection) {
    allAccountIds = await accountStore.collection.find({}, { projection: { _id: 1 } }).toArray().then(docs => docs.map(d => d._id));
  }
  const canonicalByAccountId = accountStore
    ? await buildCanonicalMap(new Set([...allAccountIds, ...sourceIds]), accountStore)
    : new Map();

  let mergeClicked;
  if (!mergeInstrumented) {
    mergeClicked = aggNoSignal(AGG_COVERAGE.mergeClickedNoSignal);
  } else if (mergeIds === null) {
    mergeClicked = aggNoSignal(AGG_COVERAGE.mergeClicked);
  } else {
    mergeClicked = aggReached(countDistinctCanonical(mergeIds, canonicalByAccountId), AGG_COVERAGE.mergeClicked);
  }

  const steps = {
    login: loginIds === null ? aggNoSignal(AGG_COVERAGE.login) : aggReached(countDistinctCanonical(loginIds, canonicalByAccountId), AGG_COVERAGE.login),
    connected: connectedIds === null ? aggNoSignal(AGG_COVERAGE.connected) : aggReached(countDistinctCanonical(connectedIds, canonicalByAccountId), AGG_COVERAGE.connected),
    firstGo: firstGoIds === null ? aggNoSignal(AGG_COVERAGE.firstGo) : aggReached(countDistinctCanonical(firstGoIds, canonicalByAccountId), AGG_COVERAGE.firstGo),
    prOpened: prIds === null ? aggNoSignal(AGG_COVERAGE.prOpened) : aggReached(countDistinctCanonical(prIds, canonicalByAccountId), AGG_COVERAGE.prOpened),
    mergeClicked
  };

  // An absent taskModeStore is an absent instrument (mode null); a throw
  // propagates like every other dep (R3).
  const mode = taskModeStore
    ? await taskModeStore.countByEntryRung({ since, canonicalByAccountId })
    : null;

  return { steps, mode };
}
