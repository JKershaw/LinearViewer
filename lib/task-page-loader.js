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
 *     `prStateStore` (no second PR reader, LIN-2948);
 *   - the run facts (`stopAt`, `variant`) through `readTaskRunFacts`, keyed by
 *     the task with the subtask `sessionId` hop (LIN-3340), so the close-out
 *     box's `ready` is the same fact the check route and the dispatch guard use.
 *
 * The loader makes ONE tracker read. The OWNER page's brief/recap widgets mount
 * client-side and each GET `/api/brief|recap/:id`, which resolves a tracker
 * provider (`fetchRecommendationContext` again) — so an OWNER page load makes
 * three reads, two of them once per load, never on a poll, never for a guest
 * (G2, decided and bounded in LIN-3340; `public/brief.js`/`recap.js` are shared
 * with Home and the run page). The state endpoint below keeps the loader-only
 * one-read property.
 *
 * No stored-only fallback (John's decision at LIN-3329 close-out, reversing
 * LIN-3324's Decisions): the page needs its tracker read. A tracker not-found is
 * `{ notFound }` and any other failure (or no access at all) is
 * `{ unavailable }`, whatever sessions are stored — the not-found / try-again
 * pair the task-edit page uses. LIN-3330's guest route gets the same refusal
 * for free when the owner's login can't be used.
 *
 * `enrichLoop` and `deriveSessionWaiting` live in `routes/dashboard.js`; a `lib/`
 * module must not import a route, so both are injected (wired in `server.js`).
 * Reusing them means no fourth "waiting" derivation (LIN-3324 strategy table).
 */

import { getLoopsForIssue as realGetLoopsForIssue } from './pipeline-loops.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { findWakeEvent, isRowClosed } from './dispatch-terminal.js';
import { USUAL_STAGES, STAGE_LABELS } from './run-view.js';
import { stepKindWord } from './render-run-steps.js';
import { readTaskRunFacts as realReadTaskRunFacts } from './task-run-facts.js';
import { closeOutSummaryFor } from './run-evidence.js';
import { latestReviewComment } from './run-ledger.js';
import { ORCHESTRATION_KINDS } from './effort-readout.js';
import { hashContext } from './brief-cache.js';
import { isTerminalState } from './providers/state-map.js';

/** Tracker state types that mean the task is finished. */
const FINISHED_STATE_TYPES = new Set(['completed', 'canceled']);

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
  if (isRowClosed(loop)) return 'closed'; // LIN-3364: closed at the source (bookkeeping stamp)
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
 * The brief's `## Current` paragraph (LIN-3356): the one present-tense summary
 * the page puts at the top. A pure split of the already-cached brief body on its
 * fixed headings (`lib/brief.js`) — no new cache and no LLM call. Only a
 * level-2 heading ends the section, so `###` text inside it stays. Null when the
 * brief is missing, has no `## Current`, or the section is empty / `_None._`.
 *
 * @param {string|null|undefined} body - the brief's Markdown
 * @returns {string|null}
 */
export function briefCurrentSection(body) {
  if (typeof body !== 'string' || !body) return null;
  const lines = body.split('\n');
  const start = lines.findIndex(l => /^##[ \t]+Current[ \t]*$/i.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^##(?!#)[ \t]/.test(l));
  const text = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!text || /^[-*]?\s*_?none\.?_?$/i.test(text)) return null;
  return text;
}

/**
 * The task's stages (LIN-3356): the sessions folded into the few steps a reader
 * cares about, oldest-first, then the usual ones still ahead.
 *
 *   - An orchestration row (`ORCHESTRATION_KINDS`: autopilot, wake, custom,
 *     periodical — a kick-off, a check-in, an abort) is housekeeping. By time
 *     order it folds into the first work session dispatched at or after it, or
 *     into the last stage when none follows. No prose is parsed.
 *   - Consecutive sessions of the same work kind are one stage, counted as
 *     attempts. A folded row between them does not break the run
 *     (Build ✕, check-in, Build ✓ is one Build stage, two attempts).
 *   - A task with ONLY orchestration rows has nothing to fold into, so each
 *     such row is a stage itself.
 *   - A stage's state is its LAST session's state; `endedAt`/`durationMs` are
 *     null until that session has ended.
 *   - Ahead stages come from `guessStages` as `{kind, label, state:'ahead'}`
 *     with no id — a guess, not a promise.
 *
 * @param {Array<Object>} sessions - the model's sessions, oldest-first
 * @param {{trackerType?: string|null}} [opts]
 * @returns {Array<Object>}
 */
export function buildTaskStages(sessions, { trackerType = null } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const hasWork = list.some(s => !ORCHESTRATION_KINDS.has(s.kind));
  const stages = [];
  let buffer = [];
  for (const s of list) {
    if (hasWork && ORCHESTRATION_KINDS.has(s.kind)) {
      buffer.push(s);
      continue;
    }
    const last = stages[stages.length - 1];
    if (last && last.kind === s.kind) {
      last.sessions.push(s);
      last.checkIns.push(...buffer);
    } else {
      stages.push({ kind: s.kind, sessions: [s], checkIns: buffer });
    }
    buffer = [];
  }
  if (buffer.length && stages.length) stages[stages.length - 1].checkIns.push(...buffer);

  const done = stages.map((st) => {
    const first = st.sessions[0];
    const last = st.sessions[st.sessions.length - 1];
    const startedAt = first.loop.takenAt || first.loop.dispatchedAt || null;
    const live = last.state === 'running' || last.state === 'queued' || last.state === 'waiting';
    const endedAt = live ? null : last.endedAt || null;
    const ms = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
    return {
      id: first.loopId,
      kind: st.kind || null,
      label: stageLabel(st.kind),
      state: last.state,
      open: last.state === 'running' || last.state === 'waiting',
      startedAt,
      endedAt,
      durationMs: Number.isFinite(ms) && ms >= 0 ? ms : null,
      attempts: st.sessions.length,
      sessions: st.sessions,
      checkIns: st.checkIns,
    };
  });
  const ahead = guessStages(list, trackerType).map(kind => ({ kind, label: stageLabel(kind), state: 'ahead' }));
  return [...done, ...ahead];
}

/**
 * The header's status and its one sentence. First match wins:
 *
 *   done     tracker state type completed/canceled
 *   waiting  `deriveSessionWaiting(...).waiting` — its message, one line
 *   running  a taken, live session → "<stage> running since <when>";
 *            only queued → "<stage> queued, waiting for a worker"
 *   waiting  (ready) nothing running or queued, and `closeOut.status === 'ready'`
 *            → "Approved. PR #N is ready to merge."
 *   idle     "No session running. Last: <stage> <end> <when>." / "No sessions yet."
 *
 * A `null` tracker means "not read this time" (the state endpoint): it never
 * claims done.
 *
 * @param {Object} input
 * @param {Array<Object>} input.sessions - task-page sessions (see buildTaskPageModel)
 * @param {{waiting: boolean, message: string|null}} input.waiting
 * @param {{state?: {name?: string, type?: string}|null, finishedAt?: string|null}|null} input.tracker
 * @param {Object|null} [input.closeOut] - `readRunEvidence`'s close-out model
 * @param {Date} [input.now]
 * @returns {{status: 'done'|'waiting'|'running'|'idle', sentence: string}}
 */
export function deriveHeader({ sessions = [], waiting = { waiting: false, message: null }, tracker = null, closeOut = null, now = new Date() } = {}) {
  const say = (status, sentence) => ({ status, sentence });

  const stateType = tracker && tracker.state ? tracker.state.type : null;
  if (stateType && FINISHED_STATE_TYPES.has(stateType)) {
    const verb = stateType === 'canceled' ? 'Cancelled' : 'Finished';
    const when = fmtWhen(tracker.finishedAt, now);
    return say('done', when ? `${verb} ${when}.` : `${verb}.`);
  }

  if (waiting && waiting.waiting) {
    // The stored waiting text carries its `[blocked]` marker; the sentence doesn't.
    const line = oneLine(String(waiting.message || '').replace(WAKE_PREFIX_RE, ''));
    return say('waiting', line || 'Waiting for an answer.');
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

  // C4: an approved round with nothing left running is "waiting on the person"
  // to merge. Readiness comes from `deriveCloseOutState`'s own output only — no
  // second derivation. The guest load has no runner flag, so its box is never
  // ready and its header stays on the stored-data sentence.
  if (closeOut && closeOut.status === 'ready' && closeOut.pr && closeOut.pr.number != null) {
    return say('waiting', `Approved. PR #${closeOut.pr.number} is ready to merge.`);
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
 * A comment's author name across providers: Linear carries `user: { name }`,
 * GitHub and Jira carry `user` as a bare string (plan-review `b694cc4c` §1).
 * @param {string|Object|null|undefined} user
 * @returns {string|null}
 */
function commentAuthor(user) {
  if (!user) return null;
  if (typeof user === 'string') return user.trim() || null;
  if (typeof user === 'object') return user.name || user.displayName || null;
  return null;
}

/**
 * The tracker read's comments as the model's `{body, author, createdAt}[]`.
 * Untrusted text; the renderer escapes it and the client upgrades it to
 * markdown. `body`-less entries are dropped (nothing to show).
 */
function normaliseComments(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map(c => ({
      body: c && typeof c.body === 'string' ? c.body : '',
      author: commentAuthor(c && c.user),
      createdAt: c && c.createdAt ? c.createdAt : null,
    }))
    .filter(c => c.body.trim());
}

/**
 * Build the page model from already-read inputs. Pure: no I/O, no clock beyond
 * `now`. Exported for unit tests; `loadTaskPage`/`loadTaskState` call it.
 *
 * @param {Object} input
 * @param {string} input.identifier
 * @param {Array<Object>} input.loops - raw loops, oldest-first (getLoopsForIssue)
 * @param {Object|null} input.ctx - the tracker read (fetchRecommendationContext
 *   shape), or null for the state endpoint, which never reads the tracker
 * @param {Object|null} [input.brief] - brief cache doc
 * @param {Object|null} [input.recap] - recap cache doc
 * @param {{brief?: string|null, recap?: string|null}} [input.contextMiss] - why a
 *   cached brief/recap was withheld: `'stale'` (written before the latest
 *   changes) or `'unverifiable'` (a finished task with open children, whose
 *   hash can't be recomputed from the task-scoped read). Null/absent: no doc.
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
  brief = null,
  recap = null,
  contextMiss = null,
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
      loop: faceLoop,
    };
  });

  // `tracker` is null when the tracker wasn't read this time (the state
  // endpoint); the page itself never renders without it.
  const issue = ctx && ctx.issue ? ctx.issue : null;
  const trackerState = issue && issue.state ? { name: issue.state.name || null, type: issue.state.type || null } : null;
  const tracker = issue
    ? {
        state: trackerState,
        finishedAt: trackerFinishedAt(ctx),
        url: issue.url || null,
        parent: refOf(ctx.parent),
        subtasks: Array.isArray(ctx.children) ? ctx.children.map(refOf).filter(Boolean) : [],
        blockedBy: Array.isArray(issue.blockedBy) ? issue.blockedBy.map(refOf).filter(Boolean) : [],
      }
    : null;

  // Evidence is task-level and the page renders it once, in its own "Pull
  // request" section (LIN-3340) — no session hosts it, and the client no longer
  // carries it across a poll. The state endpoint still carries none (the PR ref
  // and ledger come from the tracker comments).
  const waiting = deriveSessionWaiting(enriched);
  const { status, sentence } = deriveHeader({ sessions, waiting, tracker, closeOut: evidence ? evidence.closeOut : null, now });
  const live = sessions.some(s => s.state === 'running' || s.state === 'queued');

  const title = (issue && issue.title) || (newest && newest.issueTitle) || null;
  const canonicalIdentifier = (issue && issue.identifier) || identifier;
  const resolvedIssueId = (issue && issue.id) || issueId || ([...enriched].reverse().find(l => l.issueId) || {}).issueId || null;

  const details = issue
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
    // One finished-task predicate (the tracker state type), read once here so
    // the renderers never re-derive it. False when the tracker wasn't read.
    finished: !!(trackerState && FINISHED_STATE_TYPES.has(trackerState.type)),
    sessions,
    guesses: guessStages(sessions, trackerState ? trackerState.type : null),
    stages: buildTaskStages(sessions, { trackerType: trackerState ? trackerState.type : null }),
    summary: briefCurrentSection(brief && brief.brief),
    brief: brief && brief.brief ? { body: brief.brief, model: brief.model || null, generatedAt: brief.generatedAt || null } : null,
    recap: recap && recap.recap ? { body: recap.recap, model: recap.model || null, generatedAt: recap.generatedAt || null } : null,
    contextMiss: { brief: (contextMiss && contextMiss.brief) || null, recap: (contextMiss && contextMiss.recap) || null },
    description: issue && typeof issue.description === 'string' && issue.description.trim() ? issue.description : null,
    comments: issue ? normaliseComments(ctx && ctx.comments) : [],
    evidence: issue ? evidence || null : null,
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
 * @param {Object|null} [deps.closeOutEventsStore] - read with `listForIssue` only
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
  closeOutEventsStore = null,
  readTaskRunFacts = realReadTaskRunFacts,
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
  //
  // A cached doc is shown only if its `inputHash` matches the hash of the
  // tracker read this page holds (LIN-3373): every other brief/recap reader
  // does the same. Without a tracker read (`ctx` null, the state endpoint)
  // nothing can be verified, so nothing is returned.
  //
  // The hash covers `focusedChild`, which the task-scoped read (`noDescend`)
  // never carries. The two agree only when the provider would have found no
  // focused child: every child terminal (tree.js). On an inexact tree that is
  // not finished we keep today's behaviour (a named residual); on a finished
  // one a doc can't be checked, so it is withheld as unverifiable.
  async function readContext(urlKey, issueId, ctx) {
    const none = { brief: null, recap: null, miss: { brief: null, recap: null } };
    if (!issueId || !ctx) return none;
    const [brief, recap] = await Promise.all([
      briefCacheStore ? briefCacheStore.get(urlKey, issueId).catch(() => null) : null,
      recapCacheStore ? recapCacheStore.get(urlKey, issueId).catch(() => null) : null,
    ]);
    const hash = hashContext(ctx);
    const children = Array.isArray(ctx.children) ? ctx.children : [];
    const exact = children.every(c => isTerminalState(c && c.state && c.state.type));
    const finished = FINISHED_STATE_TYPES.has(ctx.issue && ctx.issue.state ? ctx.issue.state.type : null);
    const judge = (doc) => {
      if (!doc) return { doc: null, miss: null };
      if (exact) return doc.inputHash === hash ? { doc, miss: null } : { doc: null, miss: 'stale' };
      return finished ? { doc: null, miss: 'unverifiable' } : { doc, miss: null };
    };
    const b = judge(brief);
    const r = judge(recap);
    return { brief: b.doc, recap: r.doc, miss: { brief: b.miss, recap: r.miss } };
  }

  /**
   * Who merged the PR the close-out lead names, from the stored close-out
   * events (LIN-3248 F4): a press or a close-out event is Harbour's close-out;
   * else a person-noticed merge is "by hand"; else unknown. Keyed to that PR so
   * a press for another PR is ignored. Never throws.
   */
  async function readMergedBy({ urlKey, identifier, closeOut }) {
    if (!closeOutEventsStore || !closeOut || closeOut.status !== 'merged' || !closeOut.pr) return null;
    let events;
    try {
      events = await closeOutEventsStore.listForIssue({ urlKey, issueIdentifier: identifier });
    } catch {
      return null;
    }
    const mine = (Array.isArray(events) ? events : []).filter(e => (closeOut.pr.url
      ? e.prUrl === closeOut.pr.url
      : typeof e.prUrl === 'string' && e.prUrl.endsWith(`/pull/${closeOut.pr.number}`)));
    if (mine.some(e => e.by === 'press' || e.by === 'close-out')) return 'close-out';
    if (mine.some(e => e.by === 'person' && e.merged === true)) return 'person';
    return null;
  }

  async function readEvidence({ urlKey, identifier, access, comments, loops, asked, viewerIsOwner = false, stopAt = null, variant = null, runnerReady = false }) {
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
        viewerIsOwner,
        stopAt,
        variant,
        runnerReady,
        ...(readPrStatus ? { readPrStatus } : {}),
      });
    } catch (err) {
      console.error('Task page evidence read failed:', err.message);
      return null;
    }
  }

  /**
   * The page load. The tracker read comes first and decides whether there is a
   * page at all: `{ notFound: true }` when the tracker doesn't know the task,
   * `{ unavailable: true }` when it can't be read (or there is no access), else
   * `{ model }`. Stored sessions never stand in for the tracker.
   *
   * @param {{urlKey: string, identifier: string, access: {provider: Object, callScope: *}|null, viewerIsOwner?: boolean, runnerReady?: boolean}} args
   */
  async function loadTaskPage({ urlKey, identifier, access = null, viewerIsOwner = false, runnerReady = false }) {
    if (!access || !access.provider) return { unavailable: true };
    let ctx;
    try {
      ctx = await access.provider.fetchRecommendationContext(access.callScope, identifier, { noDescend: true });
    } catch (err) {
      if (isNotFoundError(err)) return { notFound: true };
      console.error('Task page tracker read failed:', err.message);
      return { unavailable: true };
    }
    if (!ctx || !ctx.issue) return { notFound: true };

    // A tracker can be reached by UUID or identifier; sessions are stored by
    // identifier, so read them under the tracker's canonical one.
    const canonical = ctx.issue.identifier || identifier;
    const loops = await readLoops(urlKey, canonical);

    const newestIssueId = ([...loops].reverse().find(l => l.issueId) || {}).issueId || null;
    const issueId = ctx.issue.id || newestIssueId;
    // The run facts the close-out box takes from outside the comments. Keyed by
    // the task, with the subtask `sessionId` hop (LIN-3340). Read before the
    // evidence so the box's `ready` reflects the real stop-at/variant.
    const runFacts = await readTaskRunFacts({ store: dispatchStore, urlKey, issueIdentifier: canonical });
    const [{ brief, recap, miss }, rawEvidence] = await Promise.all([
      readContext(urlKey, issueId, ctx),
      readEvidence({
        urlKey, identifier: canonical, access,
        comments: Array.isArray(ctx.comments) ? ctx.comments : [],
        loops, asked: ctx.issue.title || canonical,
        viewerIsOwner, stopAt: runFacts.stopAt, variant: runFacts.variant, runnerReady,
      }),
    ]);

    // The finished-task PR section's two stored facts (LIN-3373): who merged,
    // and the close-out's own summary. Both ride on the evidence model.
    let evidence = rawEvidence;
    if (evidence && evidence.closeOut) {
      const mergedBy = await readMergedBy({ urlKey, identifier: canonical, closeOut: evidence.closeOut });
      evidence = {
        ...evidence,
        closeOut: { ...evidence.closeOut, mergedBy },
        closeOutSummary: closeOutSummaryFor(ctx.comments, latestReviewComment(ctx.comments)),
      };
    }

    const model = buildTaskPageModel({
      identifier: canonical, loops, ctx, brief, recap, contextMiss: miss, evidence, issueId,
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
    // No tracker read, so no brief/recap hash to check against: the model
    // carries neither, and the routes send no context to repaint.
    const model = buildTaskPageModel({
      identifier, loops, ctx: null, brief: null, recap: null, evidence: null, issueId: resolvedIssueId,
      enrichLoop, deriveSessionWaiting, now: now(),
    });
    return { model };
  }

  return { loadTaskPage, loadTaskState };
}
