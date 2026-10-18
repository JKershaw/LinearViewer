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
import { findWakeEvent, isRowClosed, isWaitingWakeMarker, WAKE_FEEDBACK_REGEX } from './dispatch-terminal.js';
import { USUAL_STAGES, STAGE_LABELS } from './run-view.js';
import { stepKindWord } from './render-run-steps.js';
import { readTaskRunFacts as realReadTaskRunFacts } from './task-run-facts.js';
import { closeOutSummaryFor } from './run-evidence.js';
import { prReadToken } from './github-pr-status.js';
import { latestReviewComment } from './run-ledger.js';
import { ORCHESTRATION_KINDS } from './effort-readout.js';
import { hashContext } from './brief-cache.js';
import { isTerminalState } from './providers/state-map.js';

// ---------------------------------------------------------------------------
// Names, once. Each rule below is stated here and used wherever it applies.
// ---------------------------------------------------------------------------

/** A session that is still the task's current attention: the stage reads `open`. */
const OPEN_STATES = new Set(['running', 'waiting']);
/** A session a worker holds or is about to hold: the model reads `live`. */
const LIVE_STATES = new Set(['running', 'queued']);
/** A session with no end yet: its stage has no `endedAt`. */
const UNENDED_STATES = new Set(['running', 'queued', 'waiting']);
/** Close-out statuses whose PR is already merged (fully or partly). */
const MERGED_STATUSES = new Set(['merged', 'partial']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The one longest line a waiting message is cut to in the header sentence. */
const SENTENCE_MAX_CHARS = 160;

/**
 * The newest loop's tracker id. Deliberately unguarded: a malformed loop list
 * rejects the loaders, as it always has, and a guard here would turn those
 * rejections into resolves. Safe on raw and enriched loops (`enrichLoop` spreads
 * and never touches `issueId`).
 */
const lastIssueId = loops => ([...loops].reverse().find(l => l.issueId) || {}).issueId || null;

// ---------------------------------------------------------------------------
// Leaf formatters.
// ---------------------------------------------------------------------------

/**
 * A kind's display word: the shared `STAGE_LABELS` map, else `stepKindWord`'s
 * capitalised fallback, so an unlabelled kind degrades instead of leaking.
 * A plain-object lookup on purpose: any `Object.prototype` key resolves.
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
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** First non-empty line of `text`, trimmed and cut to one readable sentence length. */
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
  return !text || /^[-*]?\s*_?none\.?_?$/i.test(text) ? null : text;
}

// ---------------------------------------------------------------------------
// Sessions: one loop → one session.
// ---------------------------------------------------------------------------

/**
 * The one line a session shows on the task page: the text of its last
 * `[done]`/`[blocked]`/... wake marker (marker stripped), else the agent
 * summary. A `[blocked]` question is the line only while the session is
 * `waiting`: once answered (continued, or running again after a resume) or
 * ended, the question is stale, so the session shows its closing line — or
 * null, which the renderer shows as "no message recorded". `state` is the one
 * `buildTaskPageModel` computes beside its only call. Per-session tracker
 * comments are not stored (research L5), so nothing is guessed from the
 * tracker here. (`loop.waitingMessage` stays on the loop for other pages; it is
 * deliberately not read here, as it mirrors the stale `[blocked]` line.)
 *
 * @param {Object} loop - enriched loop
 * @param {string} state - the session's task-page state
 * @returns {string|null}
 */
export function sessionMessage(loop, state) {
  const wake = findWakeEvent(loop.feedback);
  const stale = wake && isWaitingWakeMarker(wake.marker) && state !== 'waiting';
  const wakeText = !stale && wake && wake.entry && wake.entry.message;
  const raw = wakeText || loop.agentSummary || '';
  const text = String(raw).replace(WAKE_FEEDBACK_REGEX, '').trim();
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

/**
 * How a session ended without the loader's help, for display. The face's
 * `runStatusMeta` reads only the feedback-marker `terminalStatus`, so a run that
 * ended without a marker — an operator cancel, an expired queue item, or an
 * agent-status completed/failed — would read "running" forever. First rung that
 * matches wins; null while the session is live.
 */
function namedEnd(loop) {
  if (loop.terminalStatus) return loop.terminalStatus;
  if (isRowClosed(loop)) return 'closed'; // LIN-3364: closed at the source (bookkeeping stamp)
  if (loop.historyStatus === 'cancelled' || loop.historyStatus === 'expired') return loop.historyStatus;
  if (loop.agentState === 'complete') return 'done';
  return loop.agentState === 'error' ? 'failed' : null;
}

/**
 * A session's end: `{ word, at }`, or null while it is live. A live session a
 * follow-up resumed (a reply to a block) never writes its own terminal marker;
 * it ended when the follow-up took over (`continuedAt`, the first follow-up's
 * dispatch). A superseded session still `queued` is not continued — it never ran.
 */
function sessionEnd(loop, superseded, continuedAt) {
  const word = namedEnd(loop);
  if (word) return { word, at: loop.completedAt || loop.terminalCompletedAt || loop.resolvedAt || null };
  if (superseded && loop.agentState !== 'queued') return { word: 'continued', at: continuedAt.get(loop.loopId) || null };
  return null;
}

/**
 * One loop as the task page's session. The state ladder is
 * queued → waiting → running → named end. `deriveSessionWaiting([loop])` is asked
 * for every session that is not superseded, queued or not (one derivation per
 * session, then one over all of them in `buildTaskPageModel`).
 */
function toSession(loop, superseded, continuedAt, deriveSessionWaiting) {
  const end = sessionEnd(loop, superseded, continuedAt);
  const waitingHere = !superseded && deriveSessionWaiting([loop]).waiting;
  let state = end ? end.word : 'running';
  if (waitingHere) state = 'waiting';
  if (loop.agentState === 'queued') state = 'queued';
  const endedAt = end ? end.at : null;
  return {
    loopId: loop.loopId,
    kind: loop.kind || null,
    label: stageLabel(loop.kind),
    state,
    open: OPEN_STATES.has(state),
    endedAt,
    message: sessionMessage(loop, state),
    links: sessionEvidenceLinks(loop),
    // The face reads `terminalStatus`/`terminalCompletedAt`; hand it the task
    // page's named end so a marker-less end doesn't read "running".
    loop: end && !loop.terminalStatus
      ? { ...loop, terminalStatus: end.word, terminalCompletedAt: loop.terminalCompletedAt || endedAt }
      : loop,
  };
}

/** When each superseded session was taken over: its first follow-up's dispatch. */
function followUpDispatches(loops) {
  const at = new Map();
  for (const l of loops) {
    if (l.followUpTo && !at.has(l.followUpTo)) at.set(l.followUpTo, l.dispatchedAt || null);
  }
  return at;
}

function toSessions(enriched, deriveSessionWaiting) {
  const supersededLoopIds = computeSupersededLoopIds(enriched);
  const continuedAt = followUpDispatches(enriched);
  return enriched.map(loop => toSession(loop, supersededLoopIds.has(loop.loopId), continuedAt, deriveSessionWaiting));
}

// ---------------------------------------------------------------------------
// Stages: sessions folded into the few steps a reader cares about.
// ---------------------------------------------------------------------------

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
  if (isTerminalState(trackerType)) return [];
  const reached = (Array.isArray(sessions) ? sessions : []).map(s => USUAL_STAGES.indexOf(s && s.kind));
  return USUAL_STAGES.slice(reached.reduce((a, b) => Math.max(a, b), -1) + 1);
}

/**
 * Sessions grouped into runs of one work kind. An orchestration row
 * (`ORCHESTRATION_KINDS`: autopilot, wake, custom, periodical) is housekeeping:
 * it is held, then filed as a check-in on the group of the first work session
 * at or after it, or on the last group when none follows. A task with ONLY
 * orchestration rows has nothing to file them under, so each is a group itself.
 */
function groupSessions(sessions) {
  const hasWork = sessions.some(s => !ORCHESTRATION_KINDS.has(s.kind));
  const groups = [];
  let held = [];
  for (const s of sessions) {
    if (hasWork && ORCHESTRATION_KINDS.has(s.kind)) {
      held.push(s);
    } else {
      const group = groups.at(-1);
      // Build ✕, check-in, Build ✓ is one Build group: a held row does not break the run.
      if (group && group.kind === s.kind) {
        group.sessions.push(s);
        group.checkIns.push(...held);
      } else {
        groups.push({ kind: s.kind, sessions: [s], checkIns: held });
      }
      held = [];
    }
  }
  if (groups.length) groups.at(-1).checkIns.push(...held);
  return groups;
}

/** A group as the model's stage. Its state is its LAST session's; no end until that session has one. */
function toStage({ kind, sessions, checkIns }) {
  const first = sessions[0];
  const last = sessions.at(-1);
  const startedAt = first.loop.takenAt || first.loop.dispatchedAt || null;
  const endedAt = UNENDED_STATES.has(last.state) ? null : last.endedAt || null;
  const ms = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : NaN;
  return {
    id: first.loopId,
    kind: kind || null,
    label: stageLabel(kind),
    state: last.state,
    open: OPEN_STATES.has(last.state),
    startedAt,
    endedAt,
    durationMs: Number.isFinite(ms) && ms >= 0 ? ms : null,
    attempts: sessions.length,
    sessions,
    checkIns,
  };
}

/**
 * The task's stages (LIN-3356): the sessions folded into the steps a reader
 * cares about, oldest-first (see `groupSessions`), then the usual ones still
 * ahead from `guessStages` as `{kind, label, state:'ahead'}` with no id — a
 * guess, not a promise.
 *
 * @param {Array<Object>} sessions - the model's sessions, oldest-first
 * @param {{trackerType?: string|null}} [opts]
 * @returns {Array<Object>}
 */
export function buildTaskStages(sessions, { trackerType = null } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const done = groupSessions(list).map(toStage);
  const ahead = guessStages(list, trackerType).map(kind => ({ kind, label: stageLabel(kind), state: 'ahead' }));
  return [...done, ...ahead];
}

// ---------------------------------------------------------------------------
// Header: a ladder of rungs, first match wins.
// ---------------------------------------------------------------------------

const say = (status, sentence) => ({ status, sentence });

/**
 * The ready-to-merge header, or null. The one owner of the "ready" answer
 * (LIN-3448): `deriveHeader`'s ready rung, `model.readyHeader` (which the
 * renderer turns into `data-ready-header` and `data-merge-ready`) and so the
 * client's idle paint all read it. Ready means `deriveCloseOutState`'s own
 * `status === 'ready'` with a PR number; no second derivation.
 *
 * @param {Object|null} closeOut - `readRunEvidence`'s close-out model
 * @returns {{status: 'waiting', sentence: string}|null}
 */
export function deriveReadyHeader(closeOut) {
  if (closeOut && closeOut.status === 'ready' && closeOut.pr && closeOut.pr.number != null) {
    return say('waiting', `Approved. PR #${closeOut.pr.number} is ready to merge.`);
  }
  return null;
}

/** Rung 1: the tracker says the task is finished. */
function doneRung(tracker, now) {
  const type = tracker && tracker.state ? tracker.state.type : null;
  if (!isTerminalState(type)) return null;
  // Finished is for completed work; canceled and duplicate (LIN-276) read as Cancelled.
  const verb = type === 'completed' ? 'Finished' : 'Cancelled';
  const when = fmtWhen(tracker.finishedAt, now);
  return say('done', when ? `${verb} ${when}.` : `${verb}.`);
}

/** Rung 2: a session is waiting for an answer. */
function waitingRung(waiting) {
  if (!(waiting && waiting.waiting)) return null;
  // The stored waiting text carries its `[blocked]` marker; the sentence doesn't.
  const line = oneLine(String(waiting.message || '').replace(WAKE_FEEDBACK_REGEX, ''));
  return say('waiting', line || 'Waiting for an answer.');
}

/** Rungs 3 and 4: the newest taken, live session; else the newest queued one. */
function liveRung(sessions, now) {
  const running = [...sessions].reverse().find(s => s.state === 'running');
  if (running) {
    const when = fmtWhen(running.loop.takenAt || running.loop.dispatchedAt, now);
    return say('running', `${stageLabel(running.kind)} running${when ? ` since ${when}` : ''}.`);
  }
  const queued = [...sessions].reverse().find(s => s.state === 'queued');
  return queued ? say('running', `${stageLabel(queued.kind)} queued, waiting for a worker.`) : null;
}

/** Last rung: nothing is happening; say what happened last. */
function idleRung(sessions, now) {
  const last = sessions[sessions.length - 1];
  if (!last) return say('idle', 'No sessions yet.');
  const when = fmtWhen(last.endedAt, now);
  return say('idle', `No session running. Last: ${stageLabel(last.kind)} ${last.state}${when ? ` ${when}` : ''}.`);
}

/**
 * The header's status and its one sentence. First match wins:
 *
 *   done     tracker state type is terminal (isTerminalState: completed/canceled/duplicate)
 *   waiting  `deriveSessionWaiting(...).waiting` — its message, one line
 *   running  a taken, live session → "<stage> running since <when>";
 *            only queued → "<stage> queued, waiting for a worker"
 *   waiting  (ready) nothing running or queued, and `deriveReadyHeader(closeOut)`
 *            → "Approved. PR #N is ready to merge."
 *   idle     "No session running. Last: <stage> <end> <when>." / "No sessions yet."
 *
 * A `null` tracker means "not read this time" (the state endpoint): it never
 * claims done.
 *
 * C4: an approved round with nothing left running is "waiting on the person" to
 * merge. Readiness comes from `deriveCloseOutState`'s own output only — no second
 * derivation. The guest load has no runner flag, so its box is never ready and
 * its header stays on the stored-data sentence.
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
  return doneRung(tracker, now)
    || waitingRung(waiting)
    || liveRung(sessions, now)
    || deriveReadyHeader(closeOut)
    || idleRung(sessions, now);
}

// ---------------------------------------------------------------------------
// Tracker view: the one read of `ctx`, shaped once.
// ---------------------------------------------------------------------------

/** A tracker ref (`{identifier, title, state}`) in the model's flat shape. */
function refOf(r) {
  if (!r || !r.identifier) return null;
  return {
    identifier: r.identifier,
    title: r.title || null,
    state: r.state ? { name: r.state.name || null, type: r.state.type || null } : null,
  };
}

const refsOf = list => (Array.isArray(list) ? list : []).map(refOf).filter(Boolean);

/**
 * The tracker's "finished at": the newest state transition INTO the current
 * state (Linear supplies `stateTransitions`, newest-first), else null.
 */
function trackerFinishedAt(ctx) {
  const name = ctx.issue.state ? ctx.issue.state.name : null;
  const transitions = Array.isArray(ctx.stateTransitions) ? ctx.stateTransitions : [];
  const hit = transitions.find(t => t && t.toState === name && t.createdAt);
  return hit ? hit.createdAt : null;
}

/**
 * The tracker read as the model needs it: `{ issue, state, tracker }`, all null
 * when the tracker wasn't read this time (the state endpoint); the page itself
 * never renders without it. `tracker.state` and `details.state` are the one
 * `state` object.
 */
function trackerView(ctx) {
  const issue = ctx && ctx.issue ? ctx.issue : null;
  if (!issue) return { issue: null, state: null, tracker: null };
  const state = issue.state ? { name: issue.state.name || null, type: issue.state.type || null } : null;
  return {
    issue,
    state,
    tracker: {
      state,
      finishedAt: trackerFinishedAt(ctx),
      url: issue.url || null,
      parent: refOf(ctx.parent),
      subtasks: refsOf(ctx.children),
      blockedBy: refsOf(issue.blockedBy),
    },
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
  return typeof user === 'object' ? user.name || user.displayName || null : null;
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

// ---------------------------------------------------------------------------
// Model.
// ---------------------------------------------------------------------------

/** A cached brief/recap doc as the model's `{body, model, generatedAt}`, or null. */
const cachedText = (doc, field) => (doc && doc[field]
  ? { body: doc[field], model: doc.model || null, generatedAt: doc.generatedAt || null }
  : null);

/** Why a cached brief/recap was withheld, as the model's `{brief, recap}`. */
const missOf = miss => ({ brief: (miss && miss.brief) || null, recap: (miss && miss.recap) || null });

/** The tracker labels as plain names. */
const labelsOf = issue => (Array.isArray(issue.labels)
  ? issue.labels.map(l => (typeof l === 'string' ? l : l && l.name)).filter(Boolean)
  : []);

/** The task's identity: tracker values first, then what the caller or the stored sessions know. */
function identityOf({ issue, identifier, issueId, enriched }) {
  const newest = enriched[enriched.length - 1] || null;
  return {
    identifier: (issue && issue.identifier) || identifier,
    title: (issue && issue.title) || (newest && newest.issueTitle) || null,
    issueId: (issue && issue.id) || issueId || lastIssueId(enriched),
  };
}

/** What the sessions say about themselves: counts by outcome, first and last dispatch. */
function sessionFacts(sessions, newest) {
  const count = word => sessions.filter(s => s.state === word).length;
  return {
    sessionCount: sessions.length,
    doneCount: count('done'),
    failedCount: count('failed'),
    firstSessionAt: sessions[0] ? sessions[0].loop.dispatchedAt || null : null,
    lastSessionAt: newest ? newest.dispatchedAt || null : null,
  };
}

/** The PR the evidence names, as the side panel's two facts. */
function prFacts(evidence) {
  const pr = evidence && evidence.state && evidence.state.pr;
  return { headSha: pr ? pr.headSha || null : null, prUrl: pr ? pr.url || null : null };
}

/** The side panel's facts about the task. */
function detailsOf({ issue, state, identity, sessions, newest, evidence }) {
  return {
    identifier: identity.identifier,
    issueId: identity.issueId,
    state,
    labels: labelsOf(issue),
    createdAt: issue.createdAt || null,
    updatedAt: issue.updatedAt || null,
    url: issue.url || null,
    ...sessionFacts(sessions, newest),
    ...prFacts(evidence),
  };
}

/**
 * What the model carries only when the tracker was read: the description, the
 * comments, the evidence and the details. All empty otherwise.
 */
function trackerSections({ ctx, view, identity, sessions, enriched, evidence }) {
  const { issue } = view;
  if (!issue) return { description: null, comments: [], evidence: null, details: null };
  return {
    description: typeof issue.description === 'string' && issue.description.trim() ? issue.description : null,
    comments: normaliseComments(ctx.comments),
    evidence: evidence || null,
    details: detailsOf({ issue, state: view.state, identity, sessions, newest: enriched[enriched.length - 1] || null, evidence }),
  };
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
  const sessions = toSessions(enriched, deriveSessionWaiting);
  const view = trackerView(ctx);
  const trackerType = view.state ? view.state.type : null;

  // Evidence is task-level and the page renders it once, in its own "Pull
  // request" section (LIN-3340) — no session hosts it, and the client no longer
  // carries it across a poll. The state endpoint still carries none (the PR ref
  // and ledger come from the tracker comments).
  const waiting = deriveSessionWaiting(enriched);
  const closeOut = evidence ? evidence.closeOut : null;
  const { status, sentence } = deriveHeader({ sessions, waiting, tracker: view.tracker, closeOut, now });
  const identity = identityOf({ issue: view.issue, identifier, issueId, enriched });

  return {
    identifier: identity.identifier,
    title: identity.title,
    issueId: identity.issueId,
    tracker: view.tracker,
    status,
    sentence,
    // The ready-to-merge header regardless of sessions (null unless ready); the
    // page carries it so a poll that finds nothing running can paint it.
    readyHeader: deriveReadyHeader(closeOut),
    live: sessions.some(s => LIVE_STATES.has(s.state)),
    // One finished-task predicate (the tracker state type), read once here so
    // the renderers never re-derive it. False when the tracker wasn't read.
    finished: isTerminalState(trackerType),
    sessions,
    guesses: guessStages(sessions, trackerType),
    stages: buildTaskStages(sessions, { trackerType }),
    summary: briefCurrentSection(brief && brief.brief),
    brief: cachedText(brief, 'brief'),
    recap: cachedText(recap, 'recap'),
    contextMiss: missOf(contextMiss),
    ...trackerSections({ ctx, view, identity, sessions, enriched, evidence }),
  };
}

// ---------------------------------------------------------------------------
// Loader.
// ---------------------------------------------------------------------------

/** The `[evidence]` URLs across the task's sessions — corroboration only. */
const evidenceUrlsOf = loops => Array.from(loops, loop => sessionEvidenceLinks(loop).map(link => link.url)).flat();

/** The verdict on a doc a finished-or-not tree can be checked against; see `readContext`. */
function judgeDoc(doc, verdict, hash) {
  if (!doc) return { doc: null, miss: null };
  if (verdict === 'unchecked') return { doc, miss: null };
  if (verdict === 'exact') return doc.inputHash === hash ? { doc, miss: null } : { doc: null, miss: 'stale' };
  return { doc: null, miss: 'unverifiable' };
}

/**
 * Can a cached doc be checked against this tracker read (LIN-3373)? The hash
 * covers `focusedChild`, which the task-scoped read (`noDescend`) never carries.
 * The two agree only when the provider would have found no focused child: every
 * child terminal (tree.js) — `exact`. On an inexact tree that is not finished we
 * keep today's behaviour, the doc shown unchecked (`unchecked`, a named
 * residual); on a finished one a doc can't be checked, so it is withheld
 * (`unverifiable`).
 */
function cacheVerdict(ctx) {
  const children = Array.isArray(ctx.children) ? ctx.children : [];
  if (children.every(c => isTerminalState(c && c.state && c.state.type))) return 'exact';
  return isTerminalState(ctx.issue && ctx.issue.state ? ctx.issue.state.type : null) ? 'unverifiable' : 'unchecked';
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

  /**
   * A task's stored sessions and the tracker id they carry. The id is read
   * eagerly, even when the caller already knows one, so a malformed loop list
   * rejects either way.
   */
  async function readLoops(urlKey, identifier, knownIssueId) {
    const loops = await getLoopsForIssue(urlKey, identifier, { dispatchStore, agentStatusStore, horizon: 'all' });
    const found = lastIssueId(loops);
    return { loops, issueId: knownIssueId || found };
  }

  // Cache reads only. `get` deletes an expired entry while reading
  // (brief-cache.js) — unchanged, the same as every other surface.
  //
  // A cached doc is shown only if the tracker read this page holds says it is
  // current (LIN-3373): every other brief/recap reader does the same. Without a
  // tracker read (`ctx` null, the state endpoint) nothing can be verified, so
  // nothing is returned. The two `get`s are issued before the evidence read and
  // `hashContext` runs only once both have resolved — and always, whether or not
  // a doc exists, so a malformed `ctx.children` rejects the page.
  async function readContext(urlKey, issueId, ctx) {
    if (!issueId || !ctx) return { brief: null, recap: null, miss: { brief: null, recap: null } };
    const [brief, recap] = await Promise.all([
      briefCacheStore ? briefCacheStore.get(urlKey, issueId).catch(() => null) : null,
      recapCacheStore ? recapCacheStore.get(urlKey, issueId).catch(() => null) : null,
    ]);
    const hash = hashContext(ctx);
    const verdict = cacheVerdict(ctx);
    const b = judgeDoc(brief, verdict, hash);
    const r = judgeDoc(recap, verdict, hash);
    return { brief: b.doc, recap: r.doc, miss: { brief: b.miss, recap: r.miss } };
  }

  // LIN-3443: the bound repo is read with the workspace's own token, cached
  // under this workspace; anything else stays anonymous. PR state goes through
  // the shared budgeted store (LIN-2948: no second PR reader).
  const prReader = (urlKey, access) => async ({ repo, number }) => {
    const token = urlKey ? prReadToken(access.callScope, repo) : null;
    const auth = token ? { token, scopeKey: urlKey } : undefined;
    return (await prStateStore.readResult({ repo, number }, prStateStore.now(), auth)).result;
  };

  async function readEvidence({ urlKey, identifier, access, comments, loops, asked, viewerIsOwner = false, stopAt = null, variant = null, runnerReady = false }) {
    if (!readRunEvidence) return null;
    try {
      return await readRunEvidence({
        issueIdentifier: identifier,
        provider: access.provider,
        callScope: access.callScope,
        comments,
        evidenceUrls: evidenceUrlsOf(loops),
        asked,
        urlKey,
        viewerIsOwner,
        stopAt,
        variant,
        runnerReady,
        // Without the store the reader's own fail-open default applies.
        ...(prStateStore ? { readPrStatus: prReader(urlKey, access) } : {}),
      });
    } catch (err) {
      console.error('Task page evidence read failed:', err.message);
      return null;
    }
  }

  /**
   * Who merged the PR the close-out lead names, from the stored close-out
   * events (LIN-3248 F4): a press or a close-out event is Harbour's close-out;
   * else a person-noticed merge is "by hand"; else unknown. Keyed to that PR so
   * a press for another PR is ignored. Never throws: a failed read, a non-list
   * and a null event all read as "no such event".
   */
  async function readMergedBy({ urlKey, identifier, closeOut }) {
    const { pr } = closeOut;
    if (!closeOutEventsStore || !MERGED_STATUSES.has(closeOut.status) || !pr) return null;
    let events;
    try {
      events = await closeOutEventsStore.listForIssue({ urlKey, issueIdentifier: identifier });
    } catch {
      return null;
    }
    const forThisPr = e => (pr.url ? e.prUrl === pr.url : typeof e.prUrl === 'string' && e.prUrl.endsWith(`/pull/${pr.number}`));
    const mine = (Array.isArray(events) ? events : []).filter(e => e && forThisPr(e));
    if (mine.some(e => e.by === 'press' || e.by === 'close-out')) return 'close-out';
    return mine.some(e => e.by === 'person' && e.merged === true) ? 'person' : null;
  }

  /**
   * The finished-task PR section's two stored facts (LIN-3373): who merged, and
   * the close-out's own summary. Both ride on the evidence model, which must
   * carry a close-out.
   */
  async function withCloseOutFacts(evidence, { urlKey, identifier, comments }) {
    const mergedBy = await readMergedBy({ urlKey, identifier, closeOut: evidence.closeOut });
    const closeOut = { ...evidence.closeOut, mergedBy };
    if (mergedBy === 'close-out') closeOut.message = 'the pull request was merged by close-out';
    return { ...evidence, closeOut, closeOutSummary: closeOutSummaryFor(comments, latestReviewComment(comments)) };
  }

  /**
   * The tracker read decides whether there is a page at all: `{ ctx }`, or the
   * refusal to hand back as is — `{ notFound }` when the tracker doesn't know
   * the task, `{ unavailable }` when it can't be read.
   */
  async function readTracker(access, identifier) {
    let ctx;
    try {
      ctx = await access.provider.fetchRecommendationContext(access.callScope, identifier, { noDescend: true });
    } catch (err) {
      if (isNotFoundError(err)) return { notFound: true };
      console.error('Task page tracker read failed:', err.message);
      return { unavailable: true };
    }
    return ctx && ctx.issue ? { ctx } : { notFound: true };
  }

  /**
   * What the page reads once it has a tracker read and the stored sessions: the
   * run facts first (so the close-out box's `ready` reflects the real stop-at and
   * variant — LIN-3340, keyed by the task with the subtask `sessionId` hop), then
   * the cached brief/recap and the evidence together, then the close-out facts.
   */
  async function readPageFacts({ urlKey, identifier, access, ctx, loops, issueId, viewerIsOwner, runnerReady }) {
    const runFacts = await readTaskRunFacts({ store: dispatchStore, urlKey, issueIdentifier: identifier });
    const [{ brief, recap, miss }, rawEvidence] = await Promise.all([
      readContext(urlKey, issueId, ctx),
      readEvidence({
        urlKey, identifier, access,
        comments: Array.isArray(ctx.comments) ? ctx.comments : [],
        loops, asked: ctx.issue.title || identifier,
        viewerIsOwner, stopAt: runFacts.stopAt, variant: runFacts.variant, runnerReady,
      }),
    ]);
    const evidence = rawEvidence && rawEvidence.closeOut
      ? await withCloseOutFacts(rawEvidence, { urlKey, identifier, comments: ctx.comments })
      : rawEvidence;
    return { brief, recap, miss, evidence };
  }

  /**
   * The page load. The tracker read comes first; stored sessions never stand in
   * for it. Then, in this order: sessions, `readPageFacts`, the clock.
   *
   * @param {{urlKey: string, identifier: string, access: {provider: Object, callScope: *}|null, viewerIsOwner?: boolean, runnerReady?: boolean}} args
   */
  async function loadTaskPage({ urlKey, identifier, access = null, viewerIsOwner = false, runnerReady = false }) {
    if (!access || !access.provider) return { unavailable: true };
    const read = await readTracker(access, identifier);
    if (!read.ctx) return read;
    const { ctx } = read;

    // A tracker can be reached by UUID or identifier; sessions are stored by
    // identifier, so read them under the tracker's canonical one.
    const canonical = ctx.issue.identifier || identifier;
    const { loops, issueId } = await readLoops(urlKey, canonical, ctx.issue.id);
    const { brief, recap, miss, evidence } = await readPageFacts({
      urlKey, identifier: canonical, access, ctx, loops, issueId, viewerIsOwner, runnerReady,
    });
    const model = buildTaskPageModel({
      identifier: canonical, loops, ctx, brief, recap, contextMiss: miss, evidence, issueId,
      enrichLoop, deriveSessionWaiting, now: now(),
    });
    return { model };
  }

  /**
   * The state endpoint's read: stored data only. Never touches a provider — the
   * header can't learn "done" here, which is why the client doesn't poll a page
   * that loaded done (LIN-3324 Decisions: poll rule). No tracker read, so no
   * brief/recap hash to check against: the model carries neither, and the routes
   * send no context to repaint.
   *
   * @param {{urlKey: string, identifier: string, issueId?: string|null}} args
   */
  async function loadTaskState({ urlKey, identifier, issueId = null }) {
    const { loops, issueId: resolved } = await readLoops(urlKey, identifier, issueId);
    const model = buildTaskPageModel({
      identifier, loops, ctx: null, brief: null, recap: null, evidence: null, issueId: resolved,
      enrichLoop, deriveSessionWaiting, now: now(),
    });
    return { model };
  }

  return { loadTaskPage, loadTaskState };
}
