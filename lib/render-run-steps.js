/**
 * Shared run-page step-row rendering (LIN-3328, extracted from LIN-1003's
 * `lib/render-session.js`).
 *
 * The run page's per-step *face* and its status/label/duration helpers live
 * here so the task page (LIN-3329) can reuse them instead of re-deriving step
 * status and waiting text — a second representation of what the run page
 * already does. (LIN-4537 retired the brief/recap panel that lived here too.)
 *
 * The extraction is output-preserving: `renderSessionPage` (the owner run page)
 * stays byte-identical under `tests/unit/render-session-golden.test.js`.
 *
 * The face is split from the body. `renderStepFace` renders the always-visible
 * part of a run row (`<div class="sess-run-head">` through the chips and ticket
 * walk); `lib/render-session.js` composes it with the proposal block and the
 * transcript/reply body, which stay tied to the run page's `canReply` semantics.
 */

import { escapeHtml } from './utils/html.js';
import { resolveCredentialState } from './credential-state.js';
import { tierOf, runIsWaiting, runClosedAtSource } from './run-view.js';
import { formatUsd } from './cost-format.js';
import { timeHtml } from './components/time.js';
import { fmtAge } from './time-words.js';

/**
 * A step's moment, in words. LIN-4553: the run page prints no raw ISO time; a moment reads as the shared moment piece
 * (lib/components/time.js: "3 minutes ago", the exact time in the reader's zone on a tap, UTC in the title), as on the task
 * page. `now` is the render's clock (renderSessionPage's `options.now`). No moment, or one that does not parse, reads '—'.
 */
function fmtTs(ts, now = new Date()) {
  if (!ts) return '—';
  return timeHtml(ts, { now }) || '—';
}

/**
 * LIN-4558: a parked run's words, "waiting on <what> · 48m · since <moment>". `what` is the runner's own
 * words for the wait (lib/session-telemetry.js parseParkedWait); the age is `fmtAge` (lib/time-words.js);
 * the moment is the shared moment piece. A wait whose lines never say what reads "waiting". Returns HTML.
 */
function parkedWaitWords(parkedWait, now = new Date()) {
  const head = parkedWait.what ? `waiting on ${escapeHtml(parkedWait.what)}` : 'waiting';
  const sinceMs = parkedWait.since ? Date.parse(parkedWait.since) : NaN;
  const ms = Number.isFinite(sinceMs) ? Math.max(0, now.getTime() - sinceMs) : NaN;
  const age = Number.isFinite(ms) ? fmtAge(ms) : null;
  return [head, age ? escapeHtml(age) : null, parkedWait.since ? `since ${fmtTs(parkedWait.since, now)}` : null].filter(Boolean).join(' · ');
}

/**
 * LIN-4558: the dispatched child run a parked run waits on, when that child is a row on this same page
 * (`pageLoopIds`, passed by the run page: an autopilot and the children it dispatches share one run page; a worker
 * that is not under an autopilot window and its child are two runs, so the run page names the wait and its age but
 * links no child, while Live Console links it through `childSessionId`, tests/unit/lin-4558-waiting-lane.test.js).
 * Its own feed is then one click away, as an in-page link to the child's row (`id="run-<loopId>"`,
 * lib/render-session.js renderRun). The link sits outside the row's toggle head, so following it never
 * folds the parent's card. '' when the wait names no child on this page.
 */
function parkedChildLink(parkedWait, pageLoopIds) {
  if (!pageLoopIds || !Array.isArray(parkedWait.runIds)) return '';
  const childId = parkedWait.runIds.find((id) => pageLoopIds.has(id));
  if (!childId) return '';
  return `<div class="sess-run-child" data-testid="session-run-child-link"><a href="#run-${escapeHtml(childId)}">↳ the child run it waits on</a></div>`;
}

/** A telemetry runtime → a compact `Ns` / `—` label. */
function fmtRuntime(runtime) {
  if (!runtime || runtime.ms == null) return null;
  const secs = Math.round(runtime.ms / 1000);
  return `${secs}s`;
}

/** A byte count (e.g. peak RSS) → a compact `N MB` label. LIN-1789. */
function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

/**
 * Credential display vocabulary (LIN-1588, Beat 2 of LIN-1577).
 *
 * The run page is NOT flag-gated — it ships on the default path — and `unknown`
 * is the ordinary state (~99.86% of dispatches carry no joinable credential
 * identity, LIN-1585). So the copy for it has to read as calm and normal, not
 * as an alarm. `ok` is deliberately hedged too: Beat 1's verdict means "no
 * death evidence in the last 15 minutes", never "verified healthy".
 */
export const CREDENTIAL_COPY = {
  dead: { label: 'dead — re-issue the token', pill: 'error', title: 'This session’s workspace-scoped calls report token_ownerless while its workspace-free calls still succeed.' },
  ok: { label: 'ok', pill: 'done', title: 'No credential-death evidence in the last 15 minutes. Not a verified-healthy check.' },
  unknown: { label: 'unknown', pill: 'queued', title: 'No recent credential evidence for this session — the ordinary case, not a fault.' },
};

// LIN-2242/LIN-2243: a worker-lane's [ticket] marker state → the shared
// status-pill vocabulary. `blocked`/`refused`/`dissolved` map to `error` —
// deliberately the SAME loud pill class a `failed` run gets, not a dimmer one,
// per the ticket's own "not buried prose" acceptance test: a non-success
// outcome is a first-class row, not a footnote.
const TICKET_PILL_STATE = {
  done: 'done',
  started: 'running',
  blocked: 'error',
  refused: 'error',
  dissolved: 'error',
  trimmed: 'queued',
};

/**
 * A worker-lane's per-ticket walk (LIN-2243), parsed from its own [ticket]
 * markers (lib/session-telemetry.js). Each row is a first-class outcome —
 * `blocked`/`refused`/`dissolved` render with the same loud pill a `failed`
 * run gets, never buried in prose — with the outcome line (if any) shown
 * alongside. Returns '' when the run isn't a lane (no markers observed).
 *
 * @param {Array<{identifier: string, state: string, outcomeLine: string|null}>} ticketWalk
 * @returns {string}
 */
function renderTicketWalk(ticketWalk) {
  if (!Array.isArray(ticketWalk) || !ticketWalk.length) return '';
  const rows = ticketWalk.map((t) => {
    const pillState = TICKET_PILL_STATE[t.state] || 'queued';
    const outcome = t.outcomeLine
      ? `<span class="sess-ticket-outcome" data-testid="session-ticket-outcome">${escapeHtml(t.outcomeLine)}</span>`
      : '';
    return `<li class="sess-ticket" data-testid="session-ticket-row" data-state="${escapeHtml(t.state)}">
        <span class="sess-ticket-ident" data-testid="session-ticket-ident">${escapeHtml(t.identifier)}</span>
        <span class="status-pill status-pill--${pillState}" data-testid="session-ticket-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(t.state)}</span>
        ${outcome}
      </li>`;
  }).join('');
  return `<ol class="sess-ticket-walk" data-testid="session-ticket-walk">${rows}</ol>`;
}

/**
 * Map a run's terminal status → the shared `.status-pill` vocabulary (LIN-1225).
 * The per-run status is a real status pill (dot + AA-safe label) and drives
 * the card's coloured left accent, so the runs list speaks the same green/amber/
 * red language as the Observation feed instead of a bare green word.
 *
 * @param {Object} loop
 * @returns {{state: string, label: string}}
 */
export function runStatusMeta(loop) {
  const t = loop.terminalStatus;
  if (t === 'done') return { state: 'done', label: 'done' };
  if (t === 'failed') return { state: 'error', label: 'failed' };
  if (t) return { state: 'queued', label: String(t) };
  if (runClosedAtSource(loop)) return { state: 'queued', label: 'closed' }; // LIN-3364
  return { state: 'running', label: 'running' };
}

/** Per-run telemetry chips (metric count, runtime, artifacts, model?, peak RSS?, credential?). */
function renderRunChips(telemetry, credential = null) {
  if (!telemetry && !credential) return '';
  const chips = [];
  if (telemetry) {
    const runtime = fmtRuntime(telemetry.runtime);
    if (runtime) chips.push(`<span class="sess-chip" data-testid="session-run-runtime">⏱ ${escapeHtml(runtime)}</span>`);
    const metricCount = Array.isArray(telemetry.metrics) ? telemetry.metrics.length : 0;
    if (metricCount) chips.push(`<span class="sess-chip" data-testid="session-run-metrics">◐ ${metricCount} heartbeats</span>`);
    const artifactCount = Array.isArray(telemetry.producedArtifacts) ? telemetry.producedArtifacts.length : 0;
    if (artifactCount) chips.push(`<span class="sess-chip" data-testid="session-run-artifacts">✎ ${artifactCount} artifacts</span>`);
    // LIN-3250: the realised model is shown by TIER only — the identifier is
    // never printed on the page (the raw value stays in operator data).
    if (telemetry.model) {
      const tier = tierOf(telemetry.model);
      chips.push(`<span class="sess-chip" data-testid="session-run-model" data-tier="${escapeHtml(tier)}">◇ ${escapeHtml(tier)}</span>`);
    }
    // LIN-1789: peakRssBytes only — the other nine `resources` fields are
    // host/session-wide snapshots, not per-run facts, so they get no chip here.
    const peakRss = fmtBytes(telemetry.resources && telemetry.resources.peakRssBytes);
    if (peakRss) chips.push(`<span class="sess-chip" data-testid="session-run-resources">▤ ${escapeHtml(peakRss)} peak</span>`);
  }
  // LIN-1588: only a run that carries its own credential identity earns a chip —
  // a run with no token has nothing run-specific to say, and the Overview line
  // already states the session's state. `label` is display-only and is escaped
  // HERE: these helpers are raw-by-contract, so user-controlled text escapes at
  // the call site (the 8aa32eaf / LIN-1567 convention).
  if (credential) {
    const copy = CREDENTIAL_COPY[credential.state] || CREDENTIAL_COPY.unknown;
    const label = credential.label ? ` · ${escapeHtml(String(credential.label))}` : '';
    chips.push(`<span class="sess-chip sess-chip--cred" data-state="${escapeHtml(credential.state)}" data-testid="session-run-credential" title="${escapeHtml(copy.title)}">⚿ credential ${escapeHtml(copy.label)}${label}</span>`);
  }
  return chips.length ? `<div class="sess-chips">${chips.join('')}</div>` : '';
}

const EMPTY_SET = new Set();


// ─── Run-page formatting (LIN-3250) — the renderer only formats the view model ─

/**
 * A USD figure for a priced total or loop. A complete $0 is `$0.00` (LIN-4178), never "not reported";
 * null, unknown or non-finite, is no figure at all.
 */
export function fmtUsd(usd) {
  return formatUsd(usd);
}

/**
 * One per-loop cost cell from `step.loopCosts` (LIN-3250 plan §2): the lineage's
 * final counted loop carries the figure, earlier loops read "included in the
 * step total", an unpriced/unreadable/missing lineage reads "not reported".
 */
function fmtLoopCost(loopCost) {
  if (!loopCost) return null;
  if (loopCost.status === 'included') return 'included in the step total';
  if (loopCost.status === 'figure') return fmtUsd(loopCost.usd) || null;
  return loopCost.label || 'not reported';
}

/**
 * One worker-run row's always-visible *face* — the `<div class="sess-run-head">`
 * through the telemetry chips and the worker-lane ticket walk (LIN-3328). Split
 * from `renderRun`'s proposal/transcript/reply body so the task page can reuse
 * the step row without the run page's `canReply` semantics.
 *
 * @param {Object} loop
 * @param {Object} [options]
 * @param {Set<string>} [options.supersededLoopIds] - loops superseded by a follow-up
 * @param {Object<string,string>} [options.credentialByToken] - tokenId → verdict
 * @param {Map<string,Object>|null} [options.loopCostsByLoopId] - per-loop cost cells
 * @returns {string}
 */
export function renderStepFace(loop, options = {}) {
  const {
    supersededLoopIds = EMPTY_SET,
    credentialByToken = {},
    loopCostsByLoopId = null,
    now = new Date(),
    pageLoopIds = null,
  } = options;
  const loopCost = loopCostsByLoopId ? (loopCostsByLoopId.get(loop.loopId ?? null) || null) : null;
  const costText = fmtLoopCost(loopCost);
  const ident = loop.issueIdentifier
    ? `<span class="sess-run-ident" data-testid="session-run-ident">${escapeHtml(loop.issueIdentifier)}</span>`
    : '<span class="sess-run-ident sess-muted">(no task)</span>';
  const kind = loop.kind ? `<span class="sess-run-kind">${escapeHtml(loop.kind)}</span>` : '';
  const sm = runStatusMeta(loop);
  const status = `<span class="sess-run-status status-pill status-pill--${sm.state}" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(sm.label)}</span>`;
  // LIN-1163 item 5: a visible flag on the (possibly collapsed) card face when
  // this run's own last WAKE marker (LIN-2264: semantic scan, not a literal
  // last-entry read) is `[blocked]`.
  const waitingFlag = runIsWaiting(loop, supersededLoopIds)
    ? `<span class="sess-run-waiting-flag" data-testid="session-run-waiting-flag">◐ waiting for input</span>`
    : '';
  // LIN-2244: a THIRD state, distinct from both "working" and "blocked on a
  // human" above — parked on a wait (LIN-4558: a child run, a sub-agent, a
  // background task or a scheduled wakeup), not real activity and not
  // something a human needs to answer.
  // NOT guaranteed disjoint from waitingFlag by construction: since LIN-2264,
  // `runIsWaiting` matches a semantic wake marker of `blocked` (never
  // `pending` — LIN-1025), while the waiting check (`parseParkedWaitLine`,
  // lib/session-telemetry.js) still reads any line naming a scheduled wakeup
  // as a wait — a `[blocked]` message that itself happens to mention
  // "a scheduled wakeup" would satisfy both. The
  // explicit `!waitingFlag` gate is therefore real disambiguation, not a
  // redundant safety net, and it resolves in favor of blocked-on-a-human,
  // matching this ticket's "distinct from" acceptance criterion. (LIN-4240:
  // `parseParkedWait` decides on the newest state-bearing feedback entry. It
  // walks past tool, usage and resources relays, a legacy untagged `[usage]`,
  // decision stamps and `[ticket]` markers, so a trailing one of those does not
  // hide a park from `loop.telemetry.parkedWait`.)
  // LIN-4558: the flag says what the run waits on and for how long (was "parked on a wait since <moment>").
  const parkedWait = (!waitingFlag && loop.telemetry && loop.telemetry.parkedWait) || null;
  const parkedFlag = parkedWait
    ? `<span class="sess-run-parked-flag" data-testid="session-run-parked-flag">◐ ${parkedWaitWords(parkedWait, now)}</span>`
    : '';
  const childLink = parkedWait ? parkedChildLink(parkedWait, pageLoopIds) : '';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';

  // LIN-1163 item 4: a genuinely finished run (terminalStatus set) shows its
  // completion time; a still-running run never shows the misleading
  // "completed —" — it shows an in-progress marker the client fills with
  // elapsed time computed from dispatchedAt.
  // LIN-3364: a row closed at the source shows when it was closed, never "in progress".
  const runClosed = runClosedAtSource(loop);
  const runTerminal = !!loop.terminalStatus || runClosed;
  const timesBody = runClosed
    ? `<span data-testid="session-run-completed">closed ${fmtTs(loop.bookkeeping.at, now)}</span>`
    : runTerminal
    ? `<span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt, now)}</span>`
    : `<span data-testid="session-run-elapsed" data-dispatched-at="${escapeHtml(String(loop.dispatchedAt || ''))}">in progress</span>`;

  return `<div class="sess-run-head" data-testid="session-run-toggle" role="button" tabindex="0" aria-expanded="false">
          <span class="sess-run-toggle-icon" aria-hidden="true">▸</span>
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status} ${waitingFlag} ${parkedFlag}
        </div>
        ${title}${childLink}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt, now)}</span>
          ${timesBody}
          ${costText ? `<span class="sess-run-cost" data-testid="session-run-cost">${escapeHtml(costText)}</span>` : ''}
        </div>
        ${renderRunChips(loop.telemetry, loop.agentTokenId
          ? { state: resolveCredentialState(loop.agentTokenId, credentialByToken), label: loop.agentTokenLabel || null }
          : null)}
        ${renderTicketWalk(loop.telemetry && loop.telemetry.ticketWalk)}`;
}
