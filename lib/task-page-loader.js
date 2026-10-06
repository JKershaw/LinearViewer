/**
 * Task page loader (LIN-3329, Subtask B of LIN-3324).
 *
 * One page per task: `GET /workspace/:urlKey/task/:identifier`. This module
 * reads what Harbour already has for a task and shapes it into the model
 * `lib/render-task-page.js` formats. It reads, and never generates:
 *
 *   - every session the task has had: `getLoopsForIssue(..., {horizon:'all'})`,
 *     oldest-first, with NO lineage folding — repeats all show (LIN-3324's
 *     Surfaces table). `groupLoopsByLineage` is deliberately not used here;
 *   - ONE task-scoped tracker read: `provider.fetchRecommendationContext(scope,
 *     identifier, {noDescend:true})` — issue, parent, children, comments and
 *     blockers in one call (`fetchIssueFields` returns no children);
 *   - the brief and recap from their caches, `get` only — never `put`, never a
 *     generate call (opening the page doesn't start one);
 *   - evidence through `readRunEvidence`, handed the comments from the one read
 *     above so it does not fetch them again, and through the shared
 *     `prStateStore` (no second PR reader, LIN-2948).
 *
 * Stored-only fallback (LIN-3324 Decisions): when there is no tracker access, or
 * the tracker read fails for a reason other than not-found, the page still
 * renders the track, brief and recap from stored data. Then the title comes from
 * the newest loop's `issueTitle`, `tracker.available` is false, the status is
 * never `done` (only the tracker knows that), task details and ledger/PR
 * evidence are left out, and the sentence ends "Tracker details unavailable."
 *
 * `enrichLoop` and `deriveSessionWaiting` live in `routes/dashboard.js`; a `lib/`
 * module must not import a route, so both are injected (wired in `server.js`).
 * Reusing them means no fourth "waiting" derivation (LIN-3324 strategy table).
 */

import { getLoopsForIssue as realGetLoopsForIssue } from './pipeline-loops.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { findWakeEvent } from './dispatch-terminal.js';
import { USUAL_STAGES, STAGE_LABELS } from './run-view.js';
import { stepKindWord } from './render-run-steps.js';

/** Tracker state types that mean the task is finished. */
const FINISHED_STATE_TYPES = new Set(['completed', 'canceled']);

/** Session kinds that carry the task-level evidence (newest wins). */
const EVIDENCE_HOST_KINDS = new Set(['implementation', 'review', 'close-out']);

/** A stored wake message's leading `[done]`/`[blocked]`/… marker. */
const WAKE_PREFIX_RE = /^\s*\[(done|complete|failed|aborted|blocked|pending)\]\s*/i;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The one longest line a waiting message is cut to in the header sentence. */
const SENTENCE_MAX_CHARS = 160;

/**
 * A kind's display word: the shared `STAGE_LABELS` map, else `stepKindWord`'s
 * capitalised fallback, so an unlabelled kind degrades instead of leaking.
 *
 * @param {string|null|undefined} kind
 * @returns {string}
 */
export function stageLabel(kind) {
  return (kind && STAGE_LABELS[kind]) || stepKindWord(kind);
}

/**
 * A timestamp as a short human date in UTC — `6 Oct, 14:02 UTC`, with the year
 * when it isn't `now`'s. Deterministic (UTC, no locale) so the golden is stable.
 *
 * @param {string|Date|null|undefined} value
 * @param {Date} now
 * @returns {string|null}
 */
export function fmtWhen(value, now = new Date()) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear() === now.getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}, ${hh}:${mm} UTC`;
}

/** First line of `text`, trimmed and cut to one readable sentence length. */
function oneLine(text) {
  const first = String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  return first.length > SENTENCE_MAX_CHARS ? `${first.slice(0, SENTENCE_MAX_CHARS - 1).trimEnd()}…` : first;
}

/**
 * Is this a tracker "not found" (unknown, cross-workspace or deleted id)? The
 * provider read seam signals it by throwing `Issue not found: <id>`; the same
 * message match `routes/task-edit.js` and the lazy detail route use.
 */
export function isNotFoundError(err) {
  return /not found/i.test(String(err && err.message ? err.message : ''));
}

/**
 * How a session ended, for display. The face's `runStatusMeta` reads only the
 * feedback-marker `terminalStatus`, so a run that ended without a marker — an
 * operator cancel, an expired queue item, or an agent-status completed/failed —
 * would read "running" forever. The task page names those ends here, on its own
 * display copy, without touching the shared face (the run page stays
 * byte-identical).
 *
 * A session a follow-up resumed reads `continued` (see buildTaskPageModel).
 *
 * @param {Object} loop - enriched loop
 * @returns {string|null} terminal word, or null while the session is live
 */
function displayTerminal(loop) {
  if (loop.terminalStatus) return loop.terminalStatus;
  if (loop.historyStatus === 'cancelled' || loop.historyStatus === 'expired') return loop.historyStatus;
  if (loop.agentState === 'complete') return 'done';
  if (loop.agentState === 'error') return 'failed';
  return null;
}

/**
 * The session's own stored message: the text of its last `[done]`/`[blocked]`
 * wake marker (marker stripped), its waiting message, else the agent summary.
 * Per-session tracker comments are not stored (research L5), so nothing is
 * guessed from the tracker here.
 */
function sessionMessage(loop) {
  const wake = findWakeEvent(loop.feedback);
  const raw = (wake && wake.entry && wake.entry.message) || loop.waitingMessage || loop.agentSummary || '';
  const text = String(raw).replace(WAKE_PREFIX_RE, '').trim();
  return text || null;
}

/** The session's `[evidence]` links (http(s) only), from its telemetry. */
function sessionEvidenceLinks(loop) {
  const artifacts = loop.telemetry && Array.isArray(loop.telemetry.producedArtifacts)
    ? loop.telemetry.producedArtifacts
    : [];
  return artifacts
    .filter(a => a && typeof a.url === 'string' && /^https?:\/\//i.test(a.url))
    .map(a => ({ url: a.url, label: a.label || null }));
}

/** Every `[evidence]` URL across the task's sessions — corroboration only. */
function collectEvidenceUrls(loops) {
  const urls = [];
  for (const loop of loops) {
    for (const link of sessionEvidenceLinks(loop)) urls.push(link.url);
  }
  return urls;
}

/**
 * The usual stages still ahead: `USUAL_STAGES` after the FURTHEST index any
 * session's kind reached (not the last session's — a review → implementation
 * loop doesn't move the guess back), all five when none was reached, none once
 * the tracker says the task is finished. Kinds outside `USUAL_STAGES`
 * (plan-review, triage, …) don't move the index. A light touch, not a promise.
 *
 * @param {Array<{kind?: string|null}>} sessions
 * @param {string|null} trackerType - tracker state type, when known
 * @returns {string[]} stage kinds, in order
 */
export function guessStages(sessions, trackerType = null) {
  if (trackerType && FINISHED_STATE_TYPES.has(trackerType)) return [];
  let furthest = -1;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const i = USUAL_STAGES.indexOf(s && s.kind);
    if (i > furthest) furthest = i;
  }
  return USUAL_STAGES.slice(furthest + 1);
}

/**
 * The header's status and its one sentence. First match wins:
 *
 *   done     tracker state type completed/canceled
 *   waiting  `deriveSessionWaiting(...).waiting` — its message, one line
 *   running  a taken, live session → "<stage> running since <when>";
 *            only queued → "<stage> queued, waiting for a worker"
 *   idle     "No session running. Last: <stage> <end> <when>." / "No sessions yet."
 *
 * Stored-only (`tracker.available === false`) never claims done and ends the
 * sentence "Tracker details unavailable." A `null` tracker means "not read this
 * time" (the state endpoint): no done, no suffix.
 *
 * @param {Object} input
 * @param {Array<Object>} input.sessions - task-page sessions (see buildTaskPageModel)
 * @param {{waiting: boolean, message: string|null}} input.waiting
 * @param {{available: boolean, state?: {name?: string, type?: string}|null, finishedAt?: string|null}|null} input.tracker
 * @param {Date} [input.now]
 * @returns {{status: 'done'|'waiting'|'running'|'idle', sentence: string}}
 */
export function deriveHeader({ sessions = [], waiting = { waiting: false, message: null }, tracker = null, now = new Date() } = {}) {
  const suffix = tracker && tracker.available === false ? ' Tracker details unavailable.' : '';
  const say = (status, sentence) => ({ status, sentence: `${sentence}${suffix}` });

  const stateType = tracker && tracker.available && tracker.state ? tracker.state.type : null;
  if (stateType && FINISHED_STATE_TYPES.has(stateType)) {
    const verb = stateType === 'canceled' ? 'Cancelled' : 'Finished';
    const when = fmtWhen(tracker.finishedAt, now);
    return say('done', when ? `${verb} ${when}.` : `${verb}.`);
  }

  if (waiting && waiting.waiting) {
    // The stored waiting text carries its `[blocked]` marker; the sentence doesn't.
    const line = oneLine(String(waiting.message || '').replace(WAKE_PREFIX_RE, ''));
    return say('waiting', line || 'Waiting for your answer.');
  }

  const running = [...sessions].reverse().find(s => s.state === 'running');
  if (running) {
    const when = fmtWhen(running.loop.takenAt || running.loop.dispatchedAt, now);
    return say('running', `${stageLabel(running.kind)} running${when ? ` since ${when}` : ''}.`);
  }
  const queued = [...sessions].reverse().find(s => s.state === 'queued');
  if (queued) {
    return say('running', `${stageLabel(queued.kind)} queued, waiting for a worker.`);
  }

  const last = sessions[sessions.length - 1];
  if (!last) return say('idle', 'No sessions yet.');
  const when = fmtWhen(last.endedAt, now);
  return say('idle', `No session running. Last: ${stageLabel(last.kind)} ${last.state}${when ? ` ${when}` : ''}.`);
}

/**
 * The tracker's "finished at": the newest state transition INTO the current
 * state (Linear supplies `stateTransitions`, newest-first), else null.
 */
function trackerFinishedAt(ctx) {
  const name = ctx && ctx.issue && ctx.issue.state ? ctx.issue.state.name : null;
  const transitions = Array.isArray(ctx && ctx.stateTransitions) ? ctx.stateTransitions : [];
  const hit = transitions.find(t => t && t.toState === name && t.createdAt);
  return hit ? hit.createdAt : null;
}

/** A tracker ref (`{identifier, title, state}`) in the model's flat shape. */
function refOf(r) {
  if (!r || !r.identifier) return null;
  return {
    identifier: r.identifier,
    title: r.title || null,
    state: r.state ? { name: r.state.name || null, type: r.state.type || null } : null,
  };
}

/**
 * Build the page model from already-read inputs. Pure: no I/O, no clock beyond
 * `now`. Exported for unit tests; `loadTaskPage`/`loadTaskState` call it.
 *
 * @param {Object} input
 * @param {string} input.identifier
 * @param {Array<Object>} input.loops - raw loops, oldest-first (getLoopsForIssue)
 * @param {Object|null} input.ctx - the tracker read (fetchRecommendationContext shape), or null
 * @param {'read'|'unavailable'|'skipped'} input.trackerMode - `read`: ctx is the
 *   tracker's answer; `unavailable`: stored-only fallback; `skipped`: the state
 *   endpoint, which never reads the tracker
 * @param {Object|null} [input.brief] - brief cache doc
 * @param {Object|null} [input.recap] - recap cache doc
 * @param {Object|null} [input.evidence] - readRunEvidence model
 * @param {string|null} [input.issueId] - canonical tracker id, when known
 * @param {Function} input.enrichLoop
 * @param {Function} input.deriveSessionWaiting
 * @param {Date} [input.now]
 * @returns {Object} the page model
 */
export function buildTaskPageModel({
  identifier,
  loops = [],
  ctx = null,
  trackerMode = 'read',
  brief = null,
  recap = null,
  evidence = null,
  issueId = null,
  enrichLoop,
  deriveSessionWaiting,
  now = new Date(),
}) {
  const enriched = (Array.isArray(loops) ? loops : []).map(enrichLoop);
  const supersededLoopIds = computeSupersededLoopIds(enriched);
  // When each superseded session was taken over: its first follow-up's dispatch.
  const continuedAt = new Map();
  for (const l of enriched) {
    if (l.followUpTo && !continuedAt.has(l.followUpTo)) continuedAt.set(l.followUpTo, l.dispatchedAt || null);
  }
  const newest = enriched[enriched.length - 1] || null;

  const sessions = enriched.map((loop) => {
    const superseded = supersededLoopIds.has(loop.loopId);
    // A live session a follow-up resumed (a reply to a block) never writes its
    // own terminal marker; it ended when the follow-up took over.
    const named = displayTerminal(loop);
    const end = named || (superseded && loop.agentState !== 'queued' ? 'continued' : null);
    const endedAt = !end ? null
      : named ? (loop.completedAt || loop.terminalCompletedAt || loop.resolvedAt || null)
        : continuedAt.get(loop.loopId) || null;
    const waitingHere = !superseded && deriveSessionWaiting([loop]).waiting;
    let state;
    if (loop.agentState === 'queued') state = 'queued';
    else if (waitingHere) state = 'waiting';
    else if (!end) state = 'running';
    else state = end;
    // The face reads `terminalStatus`/`terminalCompletedAt`; hand it the
    // task page's named end so a marker-less end doesn't read "running".
    const faceLoop = end && !loop.terminalStatus
      ? { ...loop, terminalStatus: end, terminalCompletedAt: loop.terminalCompletedAt || endedAt }
      : loop;
    return {
      loopId: loop.loopId,
      kind: loop.kind || null,
      label: stageLabel(loop.kind),
      state,
      open: state === 'running' || state === 'waiting',
      endedAt,
      message: sessionMessage(loop),
      links: sessionEvidenceLinks(loop),
      evidenceHost: false,
      loop: faceLoop,
    };
  });

  const hasTracker = trackerMode === 'read' && !!(ctx && ctx.issue);
  const issue = hasTracker ? ctx.issue : null;
  const trackerState = issue && issue.state ? { name: issue.state.name || null, type: issue.state.type || null } : null;
  const tracker = trackerMode === 'skipped'
    ? null
    : {
        available: hasTracker,
        state: trackerState,
        finishedAt: hasTracker ? trackerFinishedAt(ctx) : null,
        url: issue ? issue.url || null : null,
        parent: hasTracker ? refOf(ctx.parent) : null,
        subtasks: hasTracker && Array.isArray(ctx.children) ? ctx.children.map(refOf).filter(Boolean) : [],
        blockedBy: issue && Array.isArray(issue.blockedBy) ? issue.blockedBy.map(refOf).filter(Boolean) : [],
      };

  // Evidence is task-level, not per-session: it renders once, inside the newest
  // implementation/review/close-out session (else the newest session). Stored-only
  // pages carry none — the ledger and PR ref come from the tracker's comments.
  const hostIndex = (() => {
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (EVIDENCE_HOST_KINDS.has(sessions[i].kind)) return i;
    }
    return sessions.length - 1;
  })();
  if (hostIndex >= 0) sessions[hostIndex].evidenceHost = true;

  const waiting = deriveSessionWaiting(enriched);
  const { status, sentence } = deriveHeader({ sessions, waiting, tracker, now });
  const live = sessions.some(s => s.state === 'running' || s.state === 'queued');

  const title = (issue && issue.title) || (newest && newest.issueTitle) || null;
  const canonicalIdentifier = (issue && issue.identifier) || identifier;
  const resolvedIssueId = (issue && issue.id) || issueId || ([...enriched].reverse().find(l => l.issueId) || {}).issueId || null;

  const details = hasTracker
    ? {
        identifier: canonicalIdentifier,
        issueId: resolvedIssueId,
        state: trackerState,
        labels: Array.isArray(issue.labels) ? issue.labels.map(l => (typeof l === 'string' ? l : l && l.name)).filter(Boolean) : [],
        createdAt: issue.createdAt || null,
        updatedAt: issue.updatedAt || null,
        url: issue.url || null,
        sessionCount: sessions.length,
        doneCount: sessions.filter(s => s.state === 'done').length,
        failedCount: sessions.filter(s => s.state === 'failed').length,
        firstSessionAt: sessions[0] ? sessions[0].loop.dispatchedAt || null : null,
        lastSessionAt: newest ? newest.dispatchedAt || null : null,
        headSha: evidence && evidence.state && evidence.state.pr ? evidence.state.pr.headSha || null : null,
        prUrl: evidence && evidence.state && evidence.state.pr ? evidence.state.pr.url || null : null,
      }
    : null;

  return {
    identifier: canonicalIdentifier,
    title,
    issueId: resolvedIssueId,
    tracker,
    status,
    sentence,
    live,
    sessions,
    guesses: guessStages(sessions, trackerState ? trackerState.type : null),
    brief: brief && brief.brief ? { body: brief.brief, model: brief.model || null, generatedAt: brief.generatedAt || null } : null,
    recap: recap && recap.recap ? { body: recap.recap, model: recap.model || null, generatedAt: recap.generatedAt || null } : null,
    evidence: hasTracker ? evidence || null : null,
    details,
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Object|null} [deps.briefCacheStore] - read with `get` only
 * @param {Object|null} [deps.recapCacheStore] - read with `get` only
 * @param {Function|null} [deps.readRunEvidence] - `lib/run-evidence.js`
 * @param {Object|null} [deps.prStateStore] - the shared PR-state store
 * @param {Function} deps.enrichLoop - `routes/dashboard.js`
 * @param {Function} deps.deriveSessionWaiting - `routes/dashboard.js`
 * @param {Function} [deps.getLoopsForIssue] - test seam
 * @param {Function} [deps.now] - () → Date
 */
export function createTaskPageLoader({
  dispatchStore,
  agentStatusStore,
  briefCacheStore = null,
  recapCacheStore = null,
  readRunEvidence = null,
  prStateStore = null,
  enrichLoop,
  deriveSessionWaiting,
  getLoopsForIssue = realGetLoopsForIssue,
  now = () => new Date(),
} = {}) {
  if (typeof enrichLoop !== 'function' || typeof deriveSessionWaiting !== 'function') {
    throw new Error('task-page-loader: enrichLoop and deriveSessionWaiting must be injected');
  }

  function readLoops(urlKey, identifier) {
    return getLoopsForIssue(urlKey, identifier, { dispatchStore, agentStatusStore, horizon: 'all' });
  }

  // Cache reads only. `get` deletes an expired entry while reading
  // (brief-cache.js) — unchanged, the same as every other surface.
  async function readContext(urlKey, issueId) {
    if (!issueId) return { brief: null, recap: null };
    const [brief, recap] = await Promise.all([
      briefCacheStore ? briefCacheStore.get(urlKey, issueId).catch(() => null) : null,
      recapCacheStore ? recapCacheStore.get(urlKey, issueId).catch(() => null) : null,
    ]);
    return { brief, recap };
  }

  async function readEvidence({ urlKey, identifier, access, comments, loops, asked }) {
    if (!readRunEvidence) return null;
    try {
      // PR state goes through the shared budgeted store (LIN-2948: no second PR
      // reader); without it the reader's own fail-open default applies.
      const readPrStatus = prStateStore
        ? async ({ repo, number }) => (await prStateStore.readResult({ repo, number }, prStateStore.now())).result
        : undefined;
      return await readRunEvidence({
        issueIdentifier: identifier,
        provider: access.provider,
        callScope: access.callScope,
        comments,
        evidenceUrls: collectEvidenceUrls(loops),
        asked,
        urlKey,
        ...(readPrStatus ? { readPrStatus } : {}),
      });
    } catch (err) {
      console.error('Task page evidence read failed:', err.message);
      return null;
    }
  }

  /**
   * The page load. Returns `{ notFound: true }` for an unknown task (no stored
   * sessions and a tracker not-found), `{ unavailable: true }` when there is
   * nothing stored and the tracker could not be read, else `{ model }`.
   *
   * @param {{urlKey: string, identifier: string, access: {provider: Object, callScope: *}|null}} args
   */
  async function loadTaskPage({ urlKey, identifier, access = null }) {
    let ctx = null;
    let trackerMode = 'unavailable';
    let trackerNotFound = false;
    if (access && access.provider) {
      try {
        ctx = await access.provider.fetchRecommendationContext(access.callScope, identifier, { noDescend: true });
        if (ctx && ctx.issue) trackerMode = 'read';
        else trackerNotFound = true;
      } catch (err) {
        if (isNotFoundError(err)) trackerNotFound = true;
        else console.error('Task page tracker read failed (stored-only):', err.message);
        ctx = null;
      }
    }

    // A tracker can be reached by UUID or identifier; sessions are stored by
    // identifier, so read them under the tracker's canonical one when known.
    const canonical = (ctx && ctx.issue && ctx.issue.identifier) || identifier;
    const loops = await readLoops(urlKey, canonical);

    if (!loops.length && trackerMode !== 'read') {
      return trackerNotFound || !access ? { notFound: true } : { unavailable: true };
    }

    const newestIssueId = ([...loops].reverse().find(l => l.issueId) || {}).issueId || null;
    const issueId = (ctx && ctx.issue && ctx.issue.id) || newestIssueId;
    const [{ brief, recap }, evidence] = await Promise.all([
      readContext(urlKey, issueId),
      trackerMode === 'read'
        ? readEvidence({ urlKey, identifier: canonical, access, comments: Array.isArray(ctx.comments) ? ctx.comments : [], loops, asked: ctx.issue.title || canonical })
        : null,
    ]);

    const model = buildTaskPageModel({
      identifier: canonical, loops, ctx, trackerMode, brief, recap, evidence, issueId,
      enrichLoop, deriveSessionWaiting, now: now(),
    });
    return { model };
  }

  /**
   * The state endpoint's read: stored data only. Never touches a provider — the
   * header can't learn "done" here, which is why the client doesn't poll a page
   * that loaded done (LIN-3324 Decisions: poll rule).
   *
   * @param {{urlKey: string, identifier: string, issueId?: string|null}} args
   */
  async function loadTaskState({ urlKey, identifier, issueId = null }) {
    const loops = await readLoops(urlKey, identifier);
    const newestIssueId = ([...loops].reverse().find(l => l.issueId) || {}).issueId || null;
    const resolvedIssueId = issueId || newestIssueId;
    const { brief, recap } = await readContext(urlKey, resolvedIssueId);
    const model = buildTaskPageModel({
      identifier, loops, ctx: null, trackerMode: 'skipped', brief, recap, evidence: null, issueId: resolvedIssueId,
      enrichLoop, deriveSessionWaiting, now: now(),
    });
    return { model };
  }

  return { loadTaskPage, loadTaskState };
}
