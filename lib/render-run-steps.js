/**
 * Shared run-page step-row rendering (LIN-3328, extracted from LIN-1003's
 * `lib/render-session.js`).
 *
 * The run page's per-step *face* and its status/label/duration/context-panel
 * helpers live here so the task page (LIN-3329) can reuse them instead of
 * re-deriving step status, step words, waiting text and the brief/recap panel —
 * a second representation of what the run page already does.
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
import { findWakeEvent } from './dispatch-terminal.js';
import { tierOf } from './run-view.js';

/** Short, safe machine-fact rendering of a timestamp (mono face upstream). */
function fmtTs(ts) {
  if (!ts) return '—';
  return escapeHtml(String(ts));
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

// The wake markers that count as "waiting on a human" (LIN-1005/LIN-1025).
// Mirrors `WAITING_WAKE_MARKERS` in `routes/dashboard.js` and
// `lib/pipeline-loops.js` — keep in parity. ONLY `[blocked]` qualifies:
// `[pending]` is an agent-to-agent orchestrator handoff (LIN-843), not a
// request for user input.
const WAITING_WAKE_MARKERS = new Set(['blocked']);

/**
 * A per-run "waiting for input" signal (LIN-1163, item 5), derived read-only
 * from the run's OWN feedback — deliberately NOT the session-level `waiting`
 * rollup (which is keyed session-wide and can't say *which* run is parked).
 * A run only counts as waiting while it is itself non-terminal — a finished
 * run's last entry could still carry a `[blocked]` marker from earlier in its
 * life, and that's not "waiting" anymore. A run superseded by a follow-up loop
 * (see `computeSupersededLoopIds`) is also excluded — it has since been replied
 * to, even though its own stale feedback still ends on a blocked marker.
 *
 * LIN-2264: this used to walk back from `feedback[]`'s LAST entry, skipping
 * only `decision-answer` stamps — positional adjacency, not a semantic scan.
 * Simple Dispatcher posts a `[usage]` bookkeeping entry at the same Stop
 * boundary immediately after a `[blocked]` status entry, and that predicate
 * didn't skip it, so on real data (measured: 19/19 blocked loops) the walk
 * stopped on `[usage]` and this always read false — the flag was effectively
 * dead in production. It now uses the same SEMANTIC scan
 * `routes/dashboard.js`'s `loopIsWaiting` uses: the build-time `wakeMarker`
 * baked onto every loop `_buildLoops` produces (lean or not —
 * `lib/pipeline-loops.js`), falling back to `findWakeEvent` over raw
 * `feedback[]` for a loop built elsewhere (e.g. a test fixture). Both scan
 * for the LAST *wake* marker (`[done]`/`[complete]`/`[failed]`/`[aborted]`/
 * `[blocked]`/`[pending]`) regardless of what non-wake bookkeeping — `[usage]`,
 * a `decision`/`decision-answer` entry, a plain heartbeat — sits after it, so
 * this is robust to `WORKER_USAGE_RELAY` being on or off and to future
 * bookkeeping entries alike. Only `[blocked]` counts as waiting-on-a-human
 * (`WAITING_WAKE_MARKERS` above); `[pending]` no longer does, matching
 * `loopIsWaiting` — this is what keeps the per-run flag and the session
 * banner from disagreeing (the divergence this ticket closes).
 */
function runIsWaiting(loop, supersededLoopIds = EMPTY_SET) {
  if (loop.terminalStatus) return false;
  if (supersededLoopIds.has(loop.loopId)) return false;
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return marker != null && WAITING_WAKE_MARKERS.has(marker);
}

/**
 * The three recap groups, in render order. Each recap item is
 * `{ item, ... }` with a group-specific secondary field (`evidence`/`predicted`);
 * deviations additionally carry a short `type` tag. See lib/recap.js for the
 * schema the recap cache stores.
 */
const RECAP_GROUPS = [
  { key: 'done', label: 'Done', icon: '✓', secondary: 'evidence' },
  { key: 'pending', label: 'Pending', icon: '○', secondary: 'predicted' },
  { key: 'deviations', label: 'Deviations', icon: '◐', secondary: 'evidence' }
];

/**
 * Render a structured recap object (`{ done, pending, deviations }`, lib/recap.js)
 * into readable HTML — the fix for the `[object Object]` defect (LIN-1023): the
 * recap cache stores an OBJECT, not a Markdown string like the brief, so it must
 * never be interpolated via `String(recap)`. Renders one group per non-empty
 * section; an all-empty recap is honestly labelled rather than hidden.
 *
 * @param {Object} recap
 * @returns {string}
 */
export function renderRecapBody(recap) {
  const groups = RECAP_GROUPS.map(g => {
    const items = Array.isArray(recap?.[g.key]) ? recap[g.key] : [];
    if (!items.length) return '';
    const lis = items.map(it => {
      const what = escapeHtml(String(it?.item || ''));
      const tag = it?.type ? ` <span class="sess-recap-tag">${escapeHtml(String(it.type))}</span>` : '';
      const sub = it?.[g.secondary]
        ? `<span class="sess-recap-sub">${escapeHtml(String(it[g.secondary]))}</span>`
        : '';
      return `<li class="sess-recap-item">
            <span class="sess-recap-what">${what}${tag}</span>
            ${sub}
          </li>`;
    }).join('');
    return `<div class="sess-recap-group" data-testid="session-recap-${g.key}">
          <div class="sess-recap-group-head"><span class="sess-recap-icon" aria-hidden="true">${g.icon}</span> ${escapeHtml(g.label)}</div>
          <ul class="sess-recap-list">${lis}</ul>
        </div>`;
  }).filter(Boolean).join('');
  return groups
    ? `<div class="sess-ctx-recap" data-testid="session-recap-body">${groups}</div>`
    : '<p class="sess-ctx-body sess-muted" data-testid="session-recap-empty">recap generated but recorded no items</p>';
}

/**
 * Render a cached context body by its shape (LIN-1023): the brief is a Markdown
 * STRING (verbatim `<pre>`), the recap is a structured OBJECT (grouped lists).
 * Returns '' for an absent/unusable body so the panel falls through to the
 * cache-miss affordance — and, critically, NEVER stringifies an object into
 * `[object Object]`.
 */
function renderContextBody(kind, body) {
  if (body == null) return '';
  if (typeof body === 'string') {
    return body.trim() ? `<pre class="sess-ctx-body">${escapeHtml(body)}</pre>` : '';
  }
  if (kind === 'recap' && typeof body === 'object') return renderRecapBody(body);
  return '';
}

/**
 * A brief or recap panel: cached body rendered server-side, tagged for
 * client-side widget init. Shared with the task page (LIN-3329).
 *
 * @param {Object} args
 * @param {string} [args.missText] - the cache-miss line (escaped). Omitted, the
 *   run page's own "generate on demand from the task view" copy renders,
 *   byte-identical; the task page IS that view, so it passes its own.
 * @returns {string}
 */
export function renderContextPanel({ label, kind, issueIdentifier, issueId, body, model, generatedAt, urlKey, missText = null }) {
  const widgetClass = kind === 'brief' ? 'brief-section' : 'recap-section';
  const idForWidget = issueIdentifier || issueId || '';
  const heading = `<div class="sess-ctx-head">
          <span class="sess-ctx-kind">${escapeHtml(label)}</span>
          <span class="sess-ctx-ident" data-testid="session-ctx-ident">${escapeHtml(idForWidget)}</span>
        </div>`;
  const renderedBody = renderContextBody(kind, body);
  if (renderedBody) {
    const meta = [
      model ? `model ${escapeHtml(String(model))}` : null,
      generatedAt ? `generated ${fmtTs(generatedAt)}` : null
    ].filter(Boolean).join(' · ');
    const widgetAttrs = `data-url-key="${escapeHtml(urlKey || '')}" data-identifier="${escapeHtml(idForWidget)}"`;
    return `<div class="sess-ctx-panel sess-ctx-panel--present ${widgetClass}" data-testid="session-${kind}" ${widgetAttrs}>
        ${heading}
        ${renderedBody}
        ${meta ? `<div class="sess-ctx-meta">${meta}</div>` : ''}
      </div>`;
  }
  const widgetAttrs = `data-url-key="${escapeHtml(urlKey || '')}" data-identifier="${escapeHtml(idForWidget)}"`;
  return `<div class="sess-ctx-panel sess-ctx-panel--miss ${widgetClass}" data-testid="session-${kind}" ${widgetAttrs}>
        ${heading}
        <p class="sess-ctx-miss" data-testid="session-${kind}-generate">${missText != null ? escapeHtml(missText) : `○ no cached ${escapeHtml(label.toLowerCase())} — generate on demand from the task view (avoids auto-spending an LLM call on page load)`}</p>
      </div>`;
}

// ─── Run-page formatting (LIN-3250) — the renderer only formats the view model ─

/** A compact, human duration (`5m 0s`, `2h 3m`), or null when unknown. */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** A USD figure for a priced total (the plan forbids ever rendering `0`). */
export function fmtUsd(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return `$${usd.toFixed(2)}`;
}

/**
 * One per-loop cost cell from `step.loopCosts` (LIN-3250 plan §2): the lineage's
 * final loop carries the figure, earlier loops read "included in the step
 * total", an unpriced/missing/harness-only lineage reads "not reported". A
 * per-turn harness figure is labelled "as reported" (LIN-3230/LIN-1426); the
 * cumulative snapshot keeps the bare figure.
 */
function fmtLoopCost(loopCost, cumulative) {
  if (!loopCost) return null;
  if (loopCost.status === 'included') return 'included in the step total';
  if (loopCost.status === 'figure') {
    const usd = fmtUsd(loopCost.usd);
    if (!usd) return null;
    return cumulative ? usd : `${usd} as reported`;
  }
  return loopCost.label || 'not reported';
}

// Plain words for a step's kind (LIN-3250 review nit): operator kinds such as
// `autopilot`/`wake` never reach the page. Unknown kinds fall back to a
// capitalised form, so a new kind degrades gracefully instead of leaking.
export const STEP_KIND_WORDS = {
  autopilot: 'Kick-off',
  wake: 'Check-in',
  plan: 'Plan',
  implementation: 'Build',
  review: 'Review',
  'close-out': 'Close-out',
  research: 'Research',
  bug: 'Bug fix',
};

/**
 * A kind's plain display word: `STEP_KIND_WORDS` when known, else the
 * capitalised kind. The fallback for an unlabelled dispatch kind (LIN-3328).
 *
 * @param {string|null|undefined} kind
 * @returns {string}
 */
export function stepKindWord(kind) {
  if (!kind) return 'Step';
  return STEP_KIND_WORDS[kind] || kind.charAt(0).toUpperCase() + kind.slice(1);
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
 * @param {boolean} [options.costCumulative] - the step's cost is a cumulative snapshot
 * @returns {string}
 */
export function renderStepFace(loop, options = {}) {
  const {
    supersededLoopIds = EMPTY_SET,
    credentialByToken = {},
    loopCostsByLoopId = null,
    costCumulative = false,
  } = options;
  const loopCost = loopCostsByLoopId ? (loopCostsByLoopId.get(loop.loopId ?? null) || null) : null;
  const costText = fmtLoopCost(loopCost, costCumulative);
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
  // human" above — parked on a pending async wait (e.g. a ScheduleWakeup CI
  // poll), not real activity and not something a human needs to answer.
  // NOT guaranteed disjoint from waitingFlag by construction: since LIN-2264,
  // `runIsWaiting` matches a semantic wake marker of `blocked` (never
  // `pending` — LIN-1025), while `PARKED_WAIT_HINT` (lib/session-telemetry.js)
  // is a substring match anywhere in the text — a `[blocked]` message that
  // itself happens to mention "a scheduled wakeup" would satisfy both. The
  // explicit `!waitingFlag` gate is therefore real disambiguation, not a
  // redundant safety net, and it resolves in favor of blocked-on-a-human,
  // matching this ticket's "distinct from" acceptance criterion. (LIN-2264
  // note: `parseParkedWait` itself still reads `feedback[]`'s literal last
  // entry — the same positional-adjacency class this ticket fixed here — so
  // `loop.telemetry.parkedWait` is not yet reliable on real trailing-`[usage]`
  // data; that predicate's fix is tracked separately.)
  const parkedFlag = (!waitingFlag && loop.telemetry && loop.telemetry.parkedWait)
    ? `<span class="sess-run-parked-flag" data-testid="session-run-parked-flag">◐ parked on a wait since ${fmtTs(loop.telemetry.parkedWait.since)}</span>`
    : '';
  const title = loop.issueTitle ? `<div class="sess-run-title">${escapeHtml(loop.issueTitle)}</div>` : '';

  // LIN-1163 item 4: a genuinely finished run (terminalStatus set) shows its
  // completion time; a still-running run never shows the misleading
  // "completed —" — it shows an in-progress marker the client fills with
  // elapsed time computed from dispatchedAt.
  const runTerminal = !!loop.terminalStatus;
  const timesBody = runTerminal
    ? `<span data-testid="session-run-completed">completed ${fmtTs(loop.terminalCompletedAt)}</span>`
    : `<span data-testid="session-run-elapsed" data-dispatched-at="${escapeHtml(String(loop.dispatchedAt || ''))}">in progress</span>`;

  return `<div class="sess-run-head" data-testid="session-run-toggle" role="button" tabindex="0" aria-expanded="false">
          <span class="sess-run-toggle-icon" aria-hidden="true">▸</span>
          <span class="sess-run-iter">#${escapeHtml(String(loop.iteration ?? ''))}</span>
          ${ident} ${kind} ${status} ${waitingFlag} ${parkedFlag}
        </div>
        ${title}
        <div class="sess-run-times">
          <span data-testid="session-run-dispatched">dispatched ${fmtTs(loop.dispatchedAt)}</span>
          ${timesBody}
          ${costText ? `<span class="sess-run-cost" data-testid="session-run-cost">${escapeHtml(costText)}</span>` : ''}
        </div>
        ${renderRunChips(loop.telemetry, loop.agentTokenId
          ? { state: resolveCredentialState(loop.agentTokenId, credentialByToken), label: loop.agentTokenLabel || null }
          : null)}
        ${renderTicketWalk(loop.telemetry && loop.telemetry.ticketWalk)}`;
}
