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
 *      - first Go    earliest non-abort dispatch by `dispatchedBy` (session-auth;
 *                    proxy/token-created rows never match)
 *      - PR opened   earliest `kind:'evidence'` feedback whose `url` is a PR —
 *                    a witnessed proxy for open time, not the forge's timestamp
 *      - merge click the funnel-event store; `no-signal` until LIN-2949 wires
 *                    the write (`INSTRUMENTED_STEPS`)
 *
 * A source read that THROWS is `no-signal` (could not observe), never a
 * synthesized `not-reached` (observed absence) and never `reached`.
 */

import { INSTRUMENTED_STEPS } from './funnel-event-store.js';

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
const FIRST_GO_COVERAGE = 'session-auth dispatch rows (dispatchedBy), oldest first';
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
 * A person's dispatch rows across BOTH collections, excluding aborts (an abort
 * carries no run). Proxy/token-created rows are excluded by construction: they
 * store a token id in `dispatchedBy`, which is never one of the account ids.
 */
async function readGroupDispatches(accountIds, { dispatchQueue, dispatchHistory } = {}) {
  const query = { dispatchedBy: { $in: accountIds } };
  const read = (collection) => (collection ? collection.find(query).toArray() : Promise.resolve([]));
  const [queued, history] = await Promise.all([read(dispatchQueue), read(dispatchHistory)]);
  return [...queued, ...history].filter(doc => doc.abort !== true);
}

function readFirstGo(rows) {
  const at = earliestIso(rows.map(doc => doc.dispatchedAt));
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

async function readMergeClicked(accountIds, funnelEventStore) {
  if (!INSTRUMENTED_STEPS.includes('merge-clicked')) {
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
 * @returns {Promise<{steps: Object, outOfOrder: string[]}>}
 */
export async function stepsForAccountGroup({ accountIds, accountStore, accountWorkspaceStore, dispatchQueue, dispatchHistory, funnelEventStore } = {}) {
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
    readMergeClicked(ids, funnelEventStore)
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
