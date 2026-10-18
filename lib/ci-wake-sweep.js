/**
 * CI wake sweep (LIN-3661). The scheduler job body: `createCiWakeSweepRun({deps})`
 * returns the tick closure `server.js` registers as `ci-wake-sweep` (5 min / 2 min
 * lease).
 *
 * The gap it closes: a worker that parks `[pending]` (PENDING-EXTERNAL) to wait on
 * its PR's CI is never woken when CI ends. Harbour's only wake is `addFeedback` up
 * an `everything` edge to the PARENT, and CI is not a session, so nothing posts for
 * it. This sweep is the missing producer: it finds a live parked worker lineage,
 * resolves the PR its park text names, reads the PR's checks with the close-out
 * reader (`readPrStatuses`) and, once they are `passing` or `failing`, queues ONE
 * follow-up to the parked worker's own lineage tail.
 *
 * Tick-time sources (a tick has no `req.session`, so `getWorkspaceByUrlKey` would
 * return nothing): the roster is `listObservedWorkspaceKeys`; `workspaceId` comes
 * from the sessions collection, provider and call scope from
 * `resolveWorkspaceAccess` (`createTickWorkspaceResolver`); `baseUrl` is
 * `resolveEmailLinkOrigin()`. Absent `workspaceId`, `dispatchedBy` or `baseUrl`
 * posts nothing (fail closed, the owner gate in `enqueueFollowUp` is kept).
 *
 * The park entry is read from the RAW tail row (and its lineage's raw siblings),
 * never from the lean loop's `feedback`, which is `[]` (pipeline-loops.js).
 *
 * Bounds: a row that does not progress backs off (in memory) and is not a
 * candidate while it does, so a set of unreadable rows cannot hold every slot;
 * candidates are ordered never-tried, then least recently tried, then oldest.
 * PR reads and issue-comment fetches are capped per tick (anonymous GitHub is
 * 60 requests/hour and `readPrStatus` costs 4 per PR). Once per CI result: the
 * prompt carries a `ci-wake: <sha7> <verdict>` line and a lineage that already
 * holds it is not woken again.
 */

import { getLoopsForWorkspace } from './pipeline-loops.js';
import { isLiveParkedWaiter, derivePendingPark, mergeLineageFeedback } from './dispatch-terminal.js';
import { followUpForLoop } from './chat-tools.js';
import { enqueueFollowUp } from './follow-up-dispatch.js';
import { readPrStatuses } from './close-out-readiness.js';
import { summarizeChecks } from './github-pr-status.js';
import { extractPrUrls } from './run-evidence.js';
import { readHorizonStart } from './read-horizon.js';
import { resolveWorkspaceIdMapFromSessions } from './credential-invariant-sweep.js';
import { findWorkspaceByUrlKey } from './workspace-lookup.js';

export const MAX_PR_READS_PER_TICK = 5;
export const MAX_COMMENT_FETCHES_PER_TICK = 5;
export const MAX_CANDIDATES_PER_WORKSPACE = 25;
export const MAX_FAILING_CHECK_NAMES = 8;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
/** `pending` is the normal waiting state; it is retried sooner than a row that cannot progress. */
export const PENDING_BACKOFF_CAP_MS = 10 * 60 * 1000;
export const STUCK_BACKOFF_CAP_MS = 60 * 60 * 1000;
const NON_SESSION_TARGETS = new Set(['dash', 'local']);

const FULL_PR_URL_RE = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/gi;
// `#1945`, `PR 1945`, `PR #1945`, `pull 1945`, `pull #1945`
const BARE_PR_RE = /(?:\b(?:PR|pull)\s*#?|(?:^|[^\w&/])#)(\d+)\b/gi;

/**
 * The PR(s) a park message names.
 *
 * Full `github.com/o/r/pull/N` URLs win. Otherwise bare numbers (`#N`, `PR N`,
 * `PR #N`, `pull N`) are resolved by number against `knownPrs` (the PRs the issue's
 * comments mention). `knownPrs === null` means "not fetched yet": the answer then
 * says `needsComments` so the caller can fetch once.
 *
 * @param {string} message
 * @param {Array<{repo: string, number: number, url: string}>|null} [knownPrs]
 * @returns {{ prs: Array<{repo: string, number: number, url: string}>, needsComments: boolean }}
 */
export function prRefsFromPark(message, knownPrs = null) {
  const text = typeof message === 'string' ? message : '';
  const found = new Map();
  for (const m of text.matchAll(FULL_PR_URL_RE)) {
    const number = Number(m[2]);
    found.set(`${m[1].toLowerCase()}#${number}`, { repo: m[1], number, url: `https://github.com/${m[1]}/pull/${number}` });
  }
  if (found.size) return { prs: [...found.values()], needsComments: false };

  const numbers = new Set([...text.matchAll(BARE_PR_RE)].map((m) => Number(m[1])));
  if (!numbers.size) return { prs: [], needsComments: false };
  if (!Array.isArray(knownPrs)) return { prs: [], needsComments: true };
  const matched = new Map();
  for (const pr of knownPrs) {
    if (numbers.has(Number(pr.number))) matched.set(`${pr.repo.toLowerCase()}#${pr.number}`, pr);
  }
  return { prs: [...matched.values()], needsComments: false };
}

/** The marker line that makes a wake once-per-(sha, verdict). */
export function ciWakeMarker(sha7, verdict) {
  return `ci-wake: ${sha7} ${verdict}`;
}

/**
 * The fixed follow-up text. No model call: PR URL, head sha, verdict, failing
 * check names (capped) and the marker.
 */
export function ciWakePrompt({ prUrl, sha, verdict, failing = [] }) {
  const sha7 = String(sha).slice(0, 7);
  const lines = [`CI finished on ${prUrl} (head ${sha7}): ${verdict}.`];
  if (verdict === 'failing') {
    const names = failing.slice(0, MAX_FAILING_CHECK_NAMES);
    if (names.length) lines.push(`Failing checks: ${names.join(', ')}${failing.length > names.length ? ` (+${failing.length - names.length} more)` : ''}.`);
    lines.push('You parked waiting on these checks. Read the failures, fix them, push, and wait for the new run.');
  } else {
    lines.push('You parked waiting on these checks. They are green: continue the task.');
  }
  lines.push('', ciWakeMarker(sha7, verdict));
  return lines.join('\n');
}

/**
 * The tick-time stand-in for the request-scoped workspace lookup. One seam holds
 * the three inputs a request used to supply: `workspaceId` (the sessions
 * collection), provider and call scope (`resolveWorkspaceAccess`). No session
 * object anywhere. Memoised per tick; call `reset()` at the start of a tick.
 *
 * @param {Object} deps
 * @param {Object} deps.sessionsCollection
 * @param {Function} deps.resolveWorkspaceAccess - `(urlKey, ownerAccountId, {source}) => {token, scope, provider, reason}`
 * @param {Function} deps.getProviderByName - `(name) => provider`
 * @param {Function} [deps.now]
 */
export function createTickWorkspaceResolver({ sessionsCollection, resolveWorkspaceAccess, getProviderByName, now = Date.now } = {}) {
  if (!sessionsCollection || !resolveWorkspaceAccess || !getProviderByName) {
    throw new Error('ci-wake-sweep: createTickWorkspaceResolver requires sessionsCollection, resolveWorkspaceAccess and getProviderByName');
  }
  let workspaces = null; // memoised promise of the session-derived workspace list
  let tickAt = null; // the tick's injected time, so expired session rows are judged at tick time
  const access = new Map();

  return {
    reset(at) { workspaces = null; access.clear(); tickAt = at ?? null; },

    /** @returns {Promise<{workspaceId: string, provider: Object, callScope: *}|{skip: string}>} */
    async resolve(urlKey, { dispatchedBy, source } = {}) {
      if (!workspaces) {
        workspaces = (async () => {
          const sessions = await sessionsCollection.find({}).toArray();
          return [...resolveWorkspaceIdMapFromSessions(sessions, tickAt ?? now()).values()];
        })();
      }
      let list;
      try {
        list = await workspaces;
      } catch (err) {
        workspaces = null;
        return { skip: `sessions-unreadable: ${err.message}` };
      }
      // Same documented gap as credential-invariant-sweep.js: bounded by session TTL.
      const workspaceId = findWorkspaceByUrlKey(list, urlKey)?.id ?? null;
      if (!workspaceId) return { skip: 'no-live-session-for-url-key' };

      const key = `${urlKey}|${dispatchedBy}|${source || ''}`;
      if (!access.has(key)) {
        access.set(key, Promise.resolve(resolveWorkspaceAccess(urlKey, dispatchedBy, source ? { source } : {})).catch((err) => ({ reason: `error: ${err.message}` })));
      }
      const granted = await access.get(key);
      if (!granted || granted.reason !== 'ok') return { skip: `access-${granted?.reason ?? 'unavailable'}` };
      const callScope = granted.scope ?? granted.token;
      if (!callScope) return { skip: 'access-no-credential' };
      return { workspaceId, provider: getProviderByName(granted.provider), callScope };
    }
  };
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the CI wake sweep.
 *
 * @param {Object} deps
 * @param {Object} deps.dispatchStore - `listItems`/`listHistory`/`listObservedWorkspaceKeys` (reads)
 * @param {Object} deps.agentStatusStore - passthrough to `getLoopsForWorkspace`
 * @param {Object} deps.proxyTokenStore
 * @param {Object} deps.workspacePreferencesStore
 * @param {Function} deps.ownerCheck - the hoisted workspace-owner seam (LIN-3383)
 * @param {{resolve: Function, reset?: Function}} deps.resolver - `createTickWorkspaceResolver(...)`
 * @param {string|null} deps.baseUrl - `resolveEmailLinkOrigin()`; falsy makes the tick inert
 * @param {Function} [deps.now]
 * @param {Function} [deps.getLoops]
 * @param {Function} [deps.readStatuses] - `readPrStatuses` seam
 * @param {Function} [deps.enqueue] - `enqueueFollowUp` seam
 * @param {Object} [deps.seam] - `{ readPrStatus, githubFetch }` passed to `readPrStatuses`
 * @returns {() => Promise<void>}
 */
export function createCiWakeSweepRun({
  dispatchStore,
  agentStatusStore,
  proxyTokenStore,
  workspacePreferencesStore,
  ownerCheck,
  resolver,
  baseUrl,
  now = Date.now,
  getLoops = getLoopsForWorkspace,
  readStatuses = readPrStatuses,
  enqueue = enqueueFollowUp,
  seam = {}
} = {}) {
  if (!dispatchStore || !resolver) {
    throw new Error('ci-wake-sweep: dispatchStore and resolver are required');
  }
  // lineageId -> { urlKey, misses, nextAt, lastTriedAt }. In memory: a restart only
  // resets back-off to "try again", which is today's behaviour.
  const attempts = new Map();

  return async () => {
    if (!baseUrl) return; // inert; server.js logged why once at registration
    const tickNow = now();
    resolver.reset?.(tickNow);
    const tick = { now: tickNow, prReads: 0, commentFetches: 0, rateLimited: false, comments: new Map() };
    const roster = [...new Set((await dispatchStore.listObservedWorkspaceKeys().catch(() => [])) || [])].sort();
    for (const urlKey of roster) {
      try {
        await sweepOneWorkspace(urlKey, tick, {
          dispatchStore, agentStatusStore, proxyTokenStore, workspacePreferencesStore, ownerCheck,
          resolver, baseUrl, getLoops, readStatuses, enqueue, seam, attempts
        });
      } catch (err) {
        console.error(`[ci-wake-sweep] workspace ${urlKey} failed: ${err.message}`);
      }
    }
  };
}

function toMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function recordMiss(attempts, lineageId, urlKey, tick, reason, cap) {
  const misses = (attempts.get(lineageId)?.misses || 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** misses, cap);
  attempts.set(lineageId, { urlKey, misses, nextAt: tick.now + delay, lastTriedAt: tick.now });
  console.log(`[ci-wake-sweep] ${lineageId}: ${reason} (retry in ${Math.round(delay / 60000)} min)`);
}

/** Raw rows of one lineage, live and history, de-duplicated (the `sweepD2` read). */
async function readLineageRows(dispatchStore, urlKey, lineageId, now) {
  const since = readHorizonStart(now);
  const [live, history] = await Promise.all([
    dispatchStore.listItems(urlKey, { rootItemId: lineageId }).catch(() => []),
    dispatchStore.listHistory(urlKey, { rootItemId: lineageId, since }).then((r) => r.items || []).catch(() => [])
  ]);
  const seen = new Set();
  const rows = [];
  for (const row of [...(live || []), ...(history || [])]) {
    const key = row.id || row._id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.sort((a, b) => toMs(a.dispatchedAt) - toMs(b.dispatchedAt));
}

function tailOf(rows) {
  let tail = null;
  for (const row of rows) {
    if (!tail || toMs(row.dispatchedAt) >= toMs(tail.dispatchedAt)) tail = row;
  }
  return tail;
}

/**
 * The per-workspace tick body. Exported for the tick-simulator tests.
 *
 * @param {string} urlKey
 * @param {{now: number, prReads: number, commentFetches: number, rateLimited: boolean, comments: Map}} tick
 * @param {Object} deps
 */
export async function sweepOneWorkspace(urlKey, tick, deps) {
  const { dispatchStore, agentStatusStore, resolver, baseUrl, getLoops, readStatuses, enqueue, seam, attempts } = deps;

  // 1. Latest loop per lineage, the live-parked predicate `sweepD2` shares.
  const loops = await getLoops(urlKey, { lean: true, dispatchStore, agentStatusStore });
  const latest = new Map();
  for (const loop of loops || []) {
    const lineageId = loop.lineageId || loop.loopId;
    if (!lineageId) continue;
    const prev = latest.get(lineageId);
    if (!prev || toMs(loop.dispatchedAt) >= toMs(prev.dispatchedAt)) latest.set(lineageId, loop);
  }
  const parked = [...latest].filter(([, loop]) => isLiveParkedWaiter(loop));
  const parkedIds = new Set(parked.map(([id]) => id));
  for (const [id, entry] of attempts) {
    if (entry.urlKey === urlKey && !parkedIds.has(id)) attempts.delete(id);
  }

  // Rows in back-off are not candidates, so they hold no slot. Never-tried first,
  // then least recently tried, then the oldest park.
  const candidates = parked
    .filter(([id]) => (attempts.get(id)?.nextAt ?? 0) <= tick.now)
    .sort(([aId, a], [bId, b]) => {
      const at = attempts.get(aId);
      const bt = attempts.get(bId);
      if (!at !== !bt) return at ? 1 : -1;
      if (at && bt && at.lastTriedAt !== bt.lastTriedAt) return at.lastTriedAt - bt.lastTriedAt;
      return toMs(a.dispatchedAt) - toMs(b.dispatchedAt);
    })
    .slice(0, MAX_CANDIDATES_PER_WORKSPACE);

  const miss = (lineageId, reason, cap = STUCK_BACKOFF_CAP_MS) => recordMiss(attempts, lineageId, urlKey, tick, reason, cap);

  // 2-4. Per candidate: the park from raw rows, the owner's access, the one PR.
  const resolved = [];
  for (const [lineageId, tail] of candidates) {
    if (tick.rateLimited) break;
    const target = tail.target === 'web' ? 'web' : NON_SESSION_TARGETS.has(tail.target) ? null : 'cli';
    if (!target) { miss(lineageId, `target ${tail.target} cannot be followed up`); continue; }

    const rows = await readLineageRows(dispatchStore, urlKey, lineageId, tick.now);
    const own = rows.find((r) => (r.id || r._id) === tail.loopId);
    if (!own) { miss(lineageId, 'tail row not in the raw read'); continue; } // never the lean feedback
    const siblings = rows.filter((r) => r !== own);
    const park = derivePendingPark(mergeLineageFeedback(own.feedback, siblings, lineageId, own.dispatchedAt));
    if (!park) { miss(lineageId, 'no pending park on the raw rows'); continue; }

    const dispatchedBy = tail.dispatchedBy || rows.find((r) => r.dispatchedBy)?.dispatchedBy || null;
    if (!dispatchedBy) { miss(lineageId, 'no dispatchedBy on the lineage'); continue; }
    const access = await resolver.resolve(urlKey, { dispatchedBy, source: tail.issueSource });
    if (access.skip) { miss(lineageId, `skipped: ${access.skip}`); continue; }

    let refs = prRefsFromPark(park.message, null);
    if (refs.needsComments) {
      const memoKey = `${urlKey}|${tail.issueIdentifier}`;
      if (!tick.comments.has(memoKey)) {
        if (tick.commentFetches >= MAX_COMMENT_FETCHES_PER_TICK) continue; // deferred, not a miss
        tick.commentFetches += 1;
        tick.comments.set(memoKey, access.provider.fetchIssueComments(access.callScope, tail.issueIdentifier)
          .then((comments) => extractPrUrls(comments)).catch(() => null));
      }
      const known = await tick.comments.get(memoKey);
      if (!known) { miss(lineageId, 'issue comments unreadable'); continue; }
      refs = prRefsFromPark(park.message, known);
    }
    if (refs.prs.length !== 1) { miss(lineageId, refs.prs.length ? 'park names more than one PR' : 'no PR resolvable from the park'); continue; }
    resolved.push({ lineageId, tail, rows, target, dispatchedBy, access, pr: refs.prs[0] });
  }

  // 5. Group by PR, read at most MAX_PR_READS_PER_TICK distinct PRs per tick.
  const byPr = new Map();
  for (const r of resolved) {
    const key = `${r.pr.repo.toLowerCase()}#${r.pr.number}`;
    if (!byPr.has(key)) byPr.set(key, []);
    byPr.get(key).push(r);
  }
  for (const group of byPr.values()) {
    if (tick.rateLimited || tick.prReads >= MAX_PR_READS_PER_TICK) break; // deferred, not a miss
    tick.prReads += 1;
    const { pr, access } = group[0];
    const [status] = await readStatuses({
      prUrls: [{ repo: pr.repo, number: pr.number }],
      callScope: access.callScope,
      workspace: { urlKey },
      seam
    });
    if (!status || status.readable !== true) {
      const reason = status?.reason || 'not checked';
      if (/\b403\b|rate limit/i.test(reason)) tick.rateLimited = true;
      for (const r of group) miss(r.lineageId, `PR ${pr.url} unreadable: ${reason}`);
      continue;
    }
    const verdict = summarizeChecks(status.checks);
    const sha = status.head?.sha || status.ref || null;
    if (verdict === 'pending') { for (const r of group) miss(r.lineageId, `PR ${pr.url} checks pending`, PENDING_BACKOFF_CAP_MS); continue; }
    if (verdict === 'unknown' || !sha) { for (const r of group) miss(r.lineageId, `PR ${pr.url} checks unknown`); continue; }

    const sha7 = String(sha).slice(0, 7);
    const marker = ciWakeMarker(sha7, verdict);
    const failing = (status.checks || [])
      .filter((c) => summarizeChecks([c]) === 'failing')
      .map((c) => c.name)
      .filter(Boolean);
    for (const r of group) {
      // 6. Once per CI result: any row of the lineage already carries this marker.
      if (r.rows.some((row) => typeof row.prompt === 'string' && row.prompt.split('\n').includes(marker))) {
        miss(r.lineageId, `already woken for ${marker}`);
        continue;
      }
      // 7. Re-read the tail right before posting; if it moved, the wait is over.
      const fresh = tailOf(await readLineageRows(dispatchStore, urlKey, r.lineageId, tick.now));
      if (!fresh || (fresh.id || fresh._id) !== r.tail.loopId) { miss(r.lineageId, 'lineage tail moved'); continue; }
      // 8. The wake goes to the parked worker's own tail, never the session anchor.
      const { followUpTo, force } = followUpForLoop(r.tail);
      const result = await enqueue({
        dispatchQueueStore: dispatchStore,
        workspacePreferencesStore: deps.workspacePreferencesStore,
        proxyTokenStore: deps.proxyTokenStore,
        urlKey,
        prompt: ciWakePrompt({ prUrl: pr.url, sha, verdict, failing }),
        baseUrl,
        dispatchedBy: r.dispatchedBy,
        ownerCheck: deps.ownerCheck,
        workspaceId: r.access.workspaceId,
        followUpTo,
        target: r.target,
        force,
        sessionId: r.tail.sessionId ?? r.tail.loopId
      }).catch((err) => ({ status: 500, body: { error: err.message } }));
      if (result.status === 200) {
        attempts.delete(r.lineageId);
        console.log(`[ci-wake-sweep] woke ${r.tail.loopId} (${r.tail.issueIdentifier}): ${marker} on ${pr.url}`);
      } else {
        miss(r.lineageId, `follow-up refused (${result.status}): ${result.body?.error || 'unknown'}`);
      }
    }
  }
}
