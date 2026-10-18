/**
 * Milestone-funnel readers (LIN-2952, LIN-3501): the shared pieces the per-person
 * route (routes/milestone-funnel.js) and the public /kpis aggregate build on.
 * The funnel's unit is the person (their merge group, across every workspace): a
 * person's funnel is their first-ever moment at each step, and /kpis counts, for
 * the people who signed up in the last 30 days, how many have reached each step
 * so far. `stepsForAccountGroup` is the one place that decides what a step means.
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
 *      - merge click earliest `by:'press'` close-out event for any account in
 *                    the group (LIN-3500); a press counts before the merge lands
 *
 * A source read that THROWS is `no-signal` (could not observe), never a
 * synthesized `not-reached` (observed absence) and never `reached`.
 */

import { isFreshRun } from './dispatch-store.js';
import { toEpochMs } from './utils/time.js';
import { resolveAccountGroup } from './account-group.js';

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

function earliestIso(values) {
  let min = null;
  for (const value of values) {
    const ms = toEpochMs(value);
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
const MERGE_CLICKED_COVERAGE = 'close-out press events (by: press), earliest for the group';

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

// R4/G4: the dispatch read (route and /kpis aggregate alike, LIN-3501) projects ONLY the fields its predicate
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

/**
 * A person's dispatch rows across BOTH collections, excluding aborts. This is
 * the wide read both first-Go and PR-opened need: first-Go narrows it through
 * `isFreshRun` (a Go press is exactly one fresh row), while PR opened reads
 * every non-abort person-attributed row because the runner posts its `[evidence]`
 * PR url on the run's worker/follow-up rows, not only the fresh one.
 */
async function readGroupDispatches(accountIds, { dispatchQueue, dispatchHistory } = {}) {
  // No dispatch collection injected is no instrument: null reads no-signal
  // (LIN-3501), never a not-reached "no one went".
  if (!dispatchQueue && !dispatchHistory) return null;
  const query = { dispatchedBy: { $in: accountIds } };
  const read = (collection) => (collection ? collection.find(query, { projection: DISPATCH_PROJECTION }).toArray() : Promise.resolve([]));
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
    for (const entry of feedbackEntries(doc)) {
      if (entry?.kind !== 'evidence' || !isPullRequestUrl(entry?.url)) continue;
      const ms = toEpochMs(entry.timestamp);
      if (ms !== null && (min === null || ms < min)) min = ms;
    }
  }
  return min === null ? notReached(PR_OPENED_COVERAGE) : reached(new Date(min).toISOString(), PR_OPENED_COVERAGE);
}

// LIN-3500: the close-out record is the source. `firstPressAt` throws on a read
// failure (its siblings swallow), so a failed read lands here as no-signal and
// never as a not-reached "nobody clicked".
async function readMergeClicked(accountIds, closeOutEventsStore) {
  if (!closeOutEventsStore) return noSignal(MERGE_CLICKED_COVERAGE);
  try {
    const at = earliestIso([await closeOutEventsStore.firstPressAt({ accountIds })]);
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
    const ms = toEpochMs(step.at);
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
 * @param {import('./close-out-events-store.js').CloseOutEventsStore} deps.closeOutEventsStore
 * @returns {Promise<{steps: Object, outOfOrder: string[]}>}
 */
export async function stepsForAccountGroup({ accountIds, accountStore, accountWorkspaceStore, dispatchQueue, dispatchHistory, closeOutEventsStore } = {}) {
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
    readMergeClicked(ids, closeOutEventsStore)
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

// ─── Cohort aggregate (LIN-2952, LIN-3501) ───────────────────────────────────

const COHORT_CONCURRENCY = 8;

// Order is irrelevant: results fold into counts.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// The caption for each step is the reader's own coverage label, so the aggregate
// has no second table of what a step means. App-defined strings only — no ids,
// keys or urls.
function allNoSignal(coverageByStep) {
  const steps = {};
  for (const key of STEP_KEYS) steps[key] = { state: STEP_STATES.NO_SIGNAL, count: null, coverage: coverageByStep[key] };
  return steps;
}

// The funnel half of /kpis: for the people (merge groups) whose first sign-in is
// in the window, how many have reached each step so far. Every step's meaning
// comes from `stepsForAccountGroup`.
async function collectCohortSteps({ since, accountStore, accountWorkspaceStore, closeOutEventsStore, dispatchQueue, dispatchHistory }) {
  const readerDeps = { accountStore, accountWorkspaceStore, closeOutEventsStore, dispatchQueue, dispatchHistory };
  // Coverage labels come from a read of the empty group, which touches no rows.
  const labels = (await stepsForAccountGroup({ accountIds: [], ...readerDeps })).steps;
  const coverage = Object.fromEntries(STEP_KEYS.map(key => [key, labels[key].coverage]));
  // Without the account collection the cohort itself is unknowable.
  if (!accountStore?.collection) return allNoSignal(coverage);

  try {
    const candidates = await accountStore.collection.find({ createdAt: { $gte: since } }, { projection: { _id: 1 } })
      .toArray().then(docs => docs.map(d => d._id));
    // Dedupe on the canonical id (ids[0]); a corrupt chain narrows to the
    // account itself, so it under-counts and never merges people wrongly.
    const groups = new Map();
    await mapWithConcurrency(candidates, COHORT_CONCURRENCY, async (accountId) => {
      const accountIds = await resolveAccountGroup(accountStore, accountId);
      if (!groups.has(accountIds[0])) groups.set(accountIds[0], accountIds);
    });
    const people = await mapWithConcurrency([...groups.values()], COHORT_CONCURRENCY, async (accountIds) => (
      (await stepsForAccountGroup({ accountIds, ...readerDeps })).steps
    ));

    // Unreadable membership comes first: if any candidate's sign-in could not
    // be read, the denominator is unknown, so no step may show a count.
    if (people.some(steps => steps.login.state === STEP_STATES.NO_SIGNAL)) return allNoSignal(coverage);
    // "Signed up" is the group's earliest createdAt, so an old account merged
    // with a new one is not a new person.
    const sinceMs = toEpochMs(since);
    const cohort = people.filter(steps => steps.login.state === STEP_STATES.REACHED && toEpochMs(steps.login.at) >= sinceMs);

    // With nobody in the cohort no one can report no-signal, so the empty
    // group's own states say whether the instrument exists.
    const steps = {};
    for (const key of STEP_KEYS) {
      const states = cohort.length ? cohort.map(p => p[key].state) : [labels[key].state];
      if (states.includes(STEP_STATES.NO_SIGNAL)) {
        steps[key] = { state: STEP_STATES.NO_SIGNAL, count: null, coverage: coverage[key] };
      } else {
        const count = cohort.filter(p => p[key].state === STEP_STATES.REACHED).length;
        steps[key] = { state: STEP_STATES.REACHED, count, coverage: coverage[key] };
      }
    }
    return steps;
  } catch (err) {
    // Funnel only (LIN-3501): a failed cohort read is no signal, never zero.
    // The rest of /kpis keeps LIN-3002's fail-loud behaviour.
    console.error('[milestone-funnel] cohort read failed:', err?.message || err);
    return allNoSignal(coverage);
  }
}

/**
 * The milestone-funnel aggregate for the public /kpis page.
 *
 * Takes the people (merge groups) who signed up on or after `since`, reads each
 * through `stepsForAccountGroup`, and counts how many have reached each step so
 * far. Counts and app-defined labels only — no account ids, workspace keys,
 * urlKeys, issue identifiers, PR urls or per-person timestamps appear anywhere
 * in the result.
 *
 * Three-state rules, all load-bearing:
 *  - An ABSENT source (no dep injected) is `no-signal`, never a zero — a
 *    missing instrument must never read as "no people".
 *  - A step that reads `no-signal` for any person is `no-signal` (count null)
 *    for the whole step, never a partial count. A failing cohort read makes all
 *    five steps `no-signal`. Funnel only: the mode count and the rest of /kpis
 *    keep LIN-3002's fail-loud behaviour (R3/G3) — a throwing
 *    `taskModeStore` rejects this call.
 *  - `merge-clicked` reads the close-out record; a failed read or an absent
 *    `closeOutEventsStore` is `no-signal`, never zero reach.
 *
 * `mode` stays window-event based, not cohort based.
 *
 * @param {Object} [deps]
 * @param {Date} [deps.since] - window start (kpi-stats' 30-day horizon)
 * @param {import('./task-mode-store.js').TaskModeStore} [deps.taskModeStore]
 * @param {import('./account-store.js').AccountStore} [deps.accountStore]
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} [deps.accountWorkspaceStore]
 * @param {import('./close-out-events-store.js').CloseOutEventsStore} [deps.closeOutEventsStore]
 * @param {Object} [deps.dispatchQueue] - 'dispatch-queue' collection
 * @param {Object} [deps.dispatchHistory] - 'dispatch-history' collection
 * @returns {Promise<{steps: Object, mode: Object|null}>}
 */
export async function collectMilestoneFunnel({ since, taskModeStore, accountStore, accountWorkspaceStore, closeOutEventsStore, dispatchQueue, dispatchHistory } = {}) {
  const steps = await collectCohortSteps({ since, accountStore, accountWorkspaceStore, closeOutEventsStore, dispatchQueue, dispatchHistory });

  // Mode (R3/G3, LIN-3002): reads are NOT wrapped — a throwing dep propagates.
  // Its account read runs only when there is a taskModeStore, so an absent mode
  // instrument cannot make an unreadable account collection reject the funnel.
  let mode = null;
  if (taskModeStore) {
    let allAccountIds = [];
    if (accountStore?.collection) {
      allAccountIds = await accountStore.collection.find({}, { projection: { _id: 1 } }).toArray().then(docs => docs.map(d => d._id));
    }
    const canonicalByAccountId = accountStore
      ? await buildCanonicalMap(allAccountIds, accountStore)
      : new Map();
    mode = await taskModeStore.countByEntryRung({ since, canonicalByAccountId });
  }

  return { steps, mode };
}
