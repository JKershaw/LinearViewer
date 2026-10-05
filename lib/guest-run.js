/**
 * Guest run projection (LIN-3312, Phase 2 of LIN-2950; plan surface S3).
 *
 * A shared run link (`/s/<token>`, Phase 3) shows the run page to whoever holds
 * the link. This module is the privacy boundary between the owner's live run
 * and that anonymous page, in the same spirit as `project()` in
 * `lib/share-snapshot.js`: every stored or rendered field is written explicitly
 * by an allow-list CONSTRUCTOR, never copied wholesale, so a future widening of
 * the session or evidence shape cannot leak a field through.
 *
 * Two consumers, one copier:
 *   - `guestSession(session)` cuts a session to the stub the guest renders.
 *     The projection calls it at refresh, and `renderSessionPage(…, {guest:true})`
 *     calls it again at serve, so even a live session handed to the guest
 *     renderer is cut first. It is idempotent.
 *   - `buildGuestRunProjection(input, deps)` builds the stored model: the stub,
 *     the evidence cut to `{evidence, ledger, closeOut:{status}}` (F1), the PR
 *     state with its own `asOf`, the one PR ref, the matched-and-final paragraph
 *     (R5), the paragraph and settle keys (R4), `lastFinishedAt` (R6/V1) and
 *     the settling gate's verdict.
 *
 * Never stored or rendered: `feedback`, `usage`, `metrics`,
 * `producedArtifacts`, `resources`, `parkedWait`, `wakeMarker`, `agentTokenId`,
 * `agentTokenLabel`, `outcomeLine`, `target`, `issueId`, `proposals`, `urlKey`,
 * and every `closeOut` field except `status`.
 *
 * Pure: no I/O and no clock beyond the injected `capturedAt`. The settle
 * predicate and loop enrichment live in `routes/dashboard.js`, which imports
 * the renderer that imports this module, so they are injected (`deps`) rather
 * than imported — the same injection pattern `server.js` uses for the
 * materializer, and it keeps ONE definition of "terminal" (class N-H).
 *
 * V1 (approving plan review `0c455af6`): the stub keeps no `agentState`, so it
 * cannot recompute `lastFinishedAt` for a markerless `complete`/`error` loop.
 * Option (i) is taken: `lastFinishedAt` is computed from the LIVE session at
 * refresh and stored on the projection; nothing recomputes it from the stub.
 */

import crypto from 'crypto';
import { buildRunView } from './run-view.js';
import { inputHash } from './run-paragraph.js';
import { stableStringify } from './run-summary-cache.js';
import { CLOSE_OUT_STATUS } from './run-closeout-state.js';
import { prStatePayload, prStateUnknown, resolveRunPrRef, PR_STATE_VIA } from './pr-state-store.js';
import { findAnchorLoop } from './session-summary.js';

/** Paragraph grace (gate c): a run with no matched paragraph settles this long after its last step. */
export const PARAGRAPH_GRACE_MS = 10 * 60 * 1000;

/** The stub's per-session keys, in order (`loops` holds the per-loop stubs). */
export const GUEST_SESSION_KEYS = Object.freeze(['sessionId', 'seedIssue', 'tasksTouched', 'dispatchedAt', 'completedAt', 'loops']);

/** The stub's per-loop keys, in order. */
export const GUEST_LOOP_KEYS = Object.freeze([
  'loopId', 'lineageId', 'followUpTo', 'kind', 'iteration',
  'terminalStatus', 'terminalCompletedAt', 'resolvedAt', 'dispatchedAt',
  'issueIdentifier', 'issueTitle', 'sessionId', 'telemetry',
]);

/** The per-loop telemetry keys: `runtime.ms`, the model (rendered as a tier only) and the ticket walk. */
export const GUEST_TELEMETRY_KEYS = Object.freeze(['runtime', 'model', 'ticketWalk']);

/** Ledger item keys. A parsed item's `raw` is never rendered, so it is dropped. */
export const GUEST_LEDGER_ITEM_KEYS = Object.freeze(['id', 'claim', 'scope', 'discharge', 'dischargedBy', 'discharged', 'followUp']);

/** The projection's top-level keys (`prRef` only when exactly one valid ref is known). */
export const GUEST_PROJECTION_KEYS = Object.freeze([
  'session', 'runEvidence', 'prState', 'prRef', 'runParagraph',
  'paragraphKey', 'settledKey', 'lastFinishedAt', 'settled', 'capturedAt',
]);

const CLOSE_OUT_STATUSES = new Set(Object.values(CLOSE_OUT_STATUS));
const LEDGER_SCOPES = new Set(['inside', 'outside', 'unknown']);
const CHECK_STATES = new Set(['passing', 'failing', 'pending', 'unknown']);
const PR_STATES = new Set(['open', 'merged', 'closed', 'none', 'unknown']);
const PR_CHECKS = new Set(['passing', 'failing', 'running']);
const PR_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// ─── Scalar clamps ──────────────────────────────────────────────────────────

/** A string field: strings pass, finite numbers are stringified, anything else is null. */
function str(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * An id field: a string or a finite number passes with its type intact (the
 * paragraph hash and the supersede fold compare ids raw), anything else is null.
 */
function id(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/** A finite number, or null. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A timestamp as an ISO string (strings pass unchanged, so a stub re-copies identically). */
function ts(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ─── The stub ───────────────────────────────────────────────────────────────

function guestTelemetry(telemetry) {
  const t = telemetry && typeof telemetry === 'object' ? telemetry : {};
  const runtimeMs = t.runtime && typeof t.runtime === 'object' ? num(t.runtime.ms) : null;
  const walk = Array.isArray(t.ticketWalk) ? t.ticketWalk : [];
  return {
    runtime: runtimeMs == null ? null : { ms: runtimeMs },
    model: str(t.model),
    // The outcome line is agent prose ("behind the click"): identifier + state only.
    ticketWalk: walk
      .filter(row => row && typeof row === 'object')
      .map(row => ({ identifier: str(row.identifier) || '', state: str(row.state) || '' })),
  };
}

function guestLoop(loop) {
  const l = loop && typeof loop === 'object' ? loop : {};
  return {
    loopId: id(l.loopId),
    lineageId: id(l.lineageId),
    followUpTo: id(l.followUpTo),
    kind: str(l.kind),
    iteration: num(l.iteration),
    terminalStatus: str(l.terminalStatus),
    terminalCompletedAt: ts(l.terminalCompletedAt),
    resolvedAt: ts(l.resolvedAt),
    dispatchedAt: ts(l.dispatchedAt),
    issueIdentifier: str(l.issueIdentifier),
    issueTitle: str(l.issueTitle),
    sessionId: id(l.sessionId),
    telemetry: guestTelemetry(l.telemetry),
  };
}

/**
 * Cut a session to the guest stub. Idempotent: `guestSession(guestSession(s))`
 * deep-equals `guestSession(s)`. Every key is written explicitly.
 *
 * @param {Object|null} session - a live (non-lean) session or an existing stub
 * @returns {Object|null} the stub, or null for no session
 */
export function guestSession(session) {
  if (!session || typeof session !== 'object') return null;
  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const loops = Array.isArray(session.loops) ? session.loops : [];
  return {
    sessionId: id(session.sessionId),
    seedIssue: str(session.seedIssue),
    tasksTouched: tasks.map(str).filter(t => t != null),
    dispatchedAt: ts(session.dispatchedAt),
    completedAt: ts(session.completedAt),
    loops: loops.filter(l => l && typeof l === 'object').map(guestLoop),
  };
}

/**
 * The anchor issue title the run page heads with: the anchor loop's (or, for
 * an anchorless session, the first loop's) issue title — the same choice
 * `loadRunLocal` makes for the owner page. Works on a stub or a live session.
 *
 * @param {Object|null} session
 * @returns {string|null}
 */
export function guestAnchorIssueTitle(session) {
  const loops = session && Array.isArray(session.loops) ? session.loops : [];
  const anchor = findAnchorLoop(session) || loops[0] || null;
  return (anchor && str(anchor.issueTitle)) || null;
}

// ─── Workspace-key scrub (N3, PROVISIONAL #4) ───────────────────────────────

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Neutralise the URL-shaped forms of the workspace key in free text:
 * `linear.app/<urlKey>/…` and `/workspace/<urlKey>/…` become `linear.app/…/…`
 * and `/workspace/…/…`. A URL that carried the key also loses its scheme, so a
 * rewritten follow-up link renders as text, never as an anchor to a broken
 * address. A bare key word in prose is NOT rewritten (the accepted residual:
 * not a URL-addressable leak). The key match is case-insensitive and must end
 * at a path boundary, so `acme` never rewrites `acme2`.
 *
 * @param {*} text
 * @param {string} urlKey
 * @returns {*} the scrubbed string; a non-string input is returned unchanged
 */
export function scrubWorkspaceKey(text, urlKey) {
  if (typeof text !== 'string' || !text || typeof urlKey !== 'string' || !urlKey.trim()) return text;
  const key = escapeRegExp(urlKey.trim());
  const boundary = '(?=[/?#\\s)\\]\'"<>]|$)';
  const keyed = new RegExp(`(linear\\.app/|/workspace/)${key}${boundary}`, 'gi');
  const keyedTest = new RegExp(`(linear\\.app/|/workspace/)${key}${boundary}`, 'i');
  // A URL that names the key: drop its scheme so it can never become an anchor.
  const withoutScheme = text.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, url => (
    keyedTest.test(url) ? url.replace(/^https?:\/\//i, '') : url
  ));
  return withoutScheme.replace(keyed, '$1…');
}

// ─── Evidence cut (F1) ──────────────────────────────────────────────────────

function guestLedgerItem(item, urlKey) {
  const it = item && typeof item === 'object' ? item : {};
  return {
    id: str(it.id),
    claim: scrubWorkspaceKey(str(it.claim), urlKey),
    scope: LEDGER_SCOPES.has(it.scope) ? it.scope : 'unknown',
    discharge: scrubWorkspaceKey(str(it.discharge), urlKey),
    dischargedBy: scrubWorkspaceKey(str(it.dischargedBy), urlKey),
    discharged: !!it.discharged,
    followUp: scrubWorkspaceKey(str(it.followUp), urlKey),
  };
}

/**
 * The ledger the shared renderer reads (`model.ledger.ledger`). `raw` is kept
 * only where the renderer shows it — a present, non-empty ledger with no parsed
 * items — so a parsed ledger's source text never reaches the stub.
 */
function guestLedger(reviewModel, urlKey) {
  const ledger = reviewModel && reviewModel.ledger && typeof reviewModel.ledger === 'object'
    ? reviewModel.ledger
    : null;
  if (!ledger) return { ledger: null };
  const present = !!ledger.present;
  const empty = !!ledger.empty;
  const items = Array.isArray(ledger.items) ? ledger.items.map(item => guestLedgerItem(item, urlKey)) : [];
  const unparsed = !!ledger.unparsed;
  const showsRaw = present && !empty && (unparsed || items.length === 0);
  return {
    ledger: {
      present,
      empty,
      unparsed,
      items,
      raw: showsRaw ? scrubWorkspaceKey(str(ledger.raw), urlKey) : null,
    },
  };
}

function guestEvidence(evidence, urlKey, asOfArg) {
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const checked = e.checked && typeof e.checked === 'object' ? e.checked : {};
  const review = checked.review && typeof checked.review === 'object' ? checked.review : null;
  const now = checked.now && typeof checked.now === 'object' ? checked.now : null;
  // Omitted → keep the model's own stamp, so re-cutting a stored cut is a no-op.
  const asOf = asOfArg === undefined ? ts(now && now.asOf) : ts(asOfArg);
  return {
    asked: scrubWorkspaceKey(str(e.asked), urlKey),
    done: scrubWorkspaceKey(str(e.done), urlKey),
    checked: {
      review: review
        ? {
          verdict: str(review.verdict),
          verdictText: scrubWorkspaceKey(str(review.verdictText), urlKey),
          ciLine: scrubWorkspaceKey(str(review.ciLine), urlKey),
          at: ts(review.at),
          sha: str(review.sha),
        }
        : null,
      now: now
        ? {
          state: CHECK_STATES.has(now.state) ? now.state : 'unknown',
          headSha: str(now.headSha),
          checksUrl: str(now.checksUrl),
          headMoved: !!now.headMoved,
          // The "now" row and the header PR line come from ONE read, so they
          // carry the same stamp (`renderCheckedRow`'s optional `asOf`).
          asOf,
        }
        : null,
    },
  };
}

/**
 * Cut a run-evidence model (`readRunEvidence`/`buildRunEvidence` output) to
 * exactly what the shared `renderEvidence` reads: `evidence`, `ledger` and
 * `closeOut.status` (class N-G). `closeOut` keeps `status` alone, clamped to
 * `CLOSE_OUT_STATUS` (anything else is null), so the ledger's open-at-merge
 * markers render as on the owner page while no PR identity, owner flag, copy
 * or workspace key is carried.
 *
 * Idempotent: re-cutting a cut (with `asOf` omitted) returns an equal model,
 * which is what lets the guest renderer cut whatever it is handed.
 *
 * @param {Object|null} model
 * @param {string} urlKey - the workspace key to scrub from free text
 * @param {string|null} [asOf] - the PR read's `fetchedAt` (ISO), stamped on the
 *   "now" row; omitted, the model's own `now.asOf` is kept
 * @returns {{evidence: Object, ledger: Object, closeOut: {status: (string|null)}}|null}
 */
export function guestRunEvidence(model, urlKey, asOf = undefined) {
  if (!model || typeof model !== 'object') return null;
  const status = model.closeOut && CLOSE_OUT_STATUSES.has(model.closeOut.status) ? model.closeOut.status : null;
  return {
    evidence: guestEvidence(model.evidence, urlKey, asOf),
    ledger: guestLedger(model.ledger, urlKey),
    closeOut: { status },
  };
}

// ─── PR ref and PR state ────────────────────────────────────────────────────

/**
 * Validate a PR ref to exactly `{repo, number}`: `repo` matches
 * `owner/name` (`[A-Za-z0-9_.-]` only, neither part `.` or `..`) and `number`
 * is a positive integer.
 *
 * @param {*} ref
 * @returns {{repo: string, number: number}|null}
 */
export function guestPrRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const repo = typeof ref.repo === 'string' ? ref.repo : '';
  const number = ref.number;
  // `.`/`..` pass the character class but are path segments, not names.
  if (!PR_REPO_RE.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) return null;
  if (!Number.isInteger(number) || number <= 0) return null;
  return { repo, number };
}

/**
 * The header PR state, shaped like the owner's `pr-state` route
 * (`{state, number, checks}`) plus `asOf`: the read's `fetchedAt` as an ISO
 * string, or null when nothing was read (no PR, several PRs, or an
 * unavailable read). Mirrors the route: zero PRs is `none`, several are
 * withheld as `unknown`, one is read.
 *
 * @param {{status: string, ref: Object|null}} resolved - `resolveRunPrRef` output
 * @param {{result?: Object|null, fetchedAt?: number|null}|null} prRead - the shared store's `readResult`
 * @returns {{state: string, number: (number|null), checks: (string|null), asOf: (string|null)}}
 */
export function guestPrState(resolved, prRead) {
  if (!resolved || resolved.status === 'none') return { state: 'none', number: null, checks: null, asOf: null };
  if (resolved.status !== 'one') return { state: 'unknown', number: null, checks: null, asOf: null };
  const result = prRead && prRead.result ? prRead.result : null;
  const payload = result ? prStatePayload(result, resolved.ref) : prStateUnknown(resolved.ref);
  const fetchedAt = result && prRead ? num(prRead.fetchedAt) : null;
  return {
    state: PR_STATES.has(payload.state) ? payload.state : 'unknown',
    number: Number.isInteger(payload.number) ? payload.number : null,
    checks: PR_CHECKS.has(payload.checks) ? payload.checks : null,
    asOf: fetchedAt == null ? null : new Date(fetchedAt).toISOString(),
  };
}

// ─── Keys, paragraph, lastFinishedAt ────────────────────────────────────────

/**
 * The paragraph key (R4/R5): exactly the hash the paragraph hook writes
 * (`inputHash(buildRunView(session))`). `inputHash` reads only the title and
 * the ended loops' `loopId`/`kind`/`terminalStatus`, all of which the stub
 * keeps, so the stub and the live session give the same key.
 *
 * @param {Object} session - a stub or a live session
 * @returns {string}
 */
export function guestParagraphKey(session) {
  return inputHash(buildRunView(session || {}, { now: 0 }));
}

/**
 * `settledKey = sha256(stableStringify({paragraphKey, loops}))`, `loops` being
 * `sessionSettleState(session).loops` sorted by `loopId` — the SAME array the
 * settle check counted, so the key and the check cannot disagree on a
 * markerless terminal loop (R4).
 *
 * @param {string} paragraphKey
 * @param {{loops: Array<{loopId: *, terminal: boolean}>}} settleState
 * @returns {string}
 */
export function guestSettledKey(paragraphKey, settleState) {
  const loops = (settleState && Array.isArray(settleState.loops) ? settleState.loops : [])
    .map(l => ({ loopId: l.loopId ?? null, terminal: !!l.terminal }))
    .sort((a, b) => {
      const x = String(a.loopId ?? '');
      const y = String(b.loopId ?? '');
      return x < y ? -1 : (x > y ? 1 : 0);
    });
  return crypto.createHash('sha256').update(stableStringify({ paragraphKey, loops })).digest('hex');
}

/**
 * The stored paragraph's text when it describes exactly these steps AND is the
 * finished one (R5: `inputHash === paragraphKey && final === true`), else null.
 *
 * @param {{paragraph?: string, inputHash?: string, final?: boolean}|null} stored
 * @param {string} paragraphKey
 * @returns {string|null}
 */
export function guestParagraph(stored, paragraphKey) {
  if (!stored || typeof stored !== 'object') return null;
  if (stored.inputHash !== paragraphKey || stored.final !== true) return null;
  const text = typeof stored.paragraph === 'string' ? stored.paragraph.trim() : '';
  return text || null;
}

/**
 * When the run's last step finished (R6, V1 option (i)): the max over the LIVE
 * session's loops of `enrichLoop(l).completedAt` (`terminalCompletedAt`, else
 * `resolvedAt` for a terminal loop), a loop with no completion time at all
 * falling back to its `dispatchedAt` (a lower bound). Must be given the live
 * session — a stub has no `agentState`, so `enrichLoop` would miss the
 * `resolvedAt` of a markerless `complete` loop.
 *
 * @param {Object} session - the live session
 * @param {Function} enrichLoop - `routes/dashboard.js`'s `enrichLoop`
 * @returns {string|null} ISO timestamp, or null when no loop has any time
 */
export function computeLastFinishedAt(session, enrichLoop) {
  if (typeof enrichLoop !== 'function') throw new TypeError('computeLastFinishedAt needs enrichLoop');
  const loops = session && Array.isArray(session.loops) ? session.loops : [];
  let best = null;
  for (const loop of loops) {
    if (!loop || typeof loop !== 'object') continue;
    const enriched = enrichLoop(loop);
    const ms = toMs(enriched && enriched.completedAt) ?? toMs(loop.dispatchedAt);
    if (ms != null && (best == null || ms > best)) best = ms;
  }
  return best == null ? null : new Date(best).toISOString();
}

// ─── The settling gate ──────────────────────────────────────────────────────

/**
 * Is the PR read determinate (gate b)? No PR and several PRs are (nothing to
 * read). One PR is determinate only when a read SUCCEEDED (fresh, or a cache
 * entry inside its TTL) with a known `fetchedAt` at or after `lastFinishedAt`;
 * a `readable:false` result (private or off-allowlist repo) is a successful
 * read and counts. A thrown/unavailable read, a budget-exhausted stale
 * fallback or a too-old entry does not.
 *
 * @param {{status: string}} resolved - `resolveRunPrRef` output
 * @param {{result?: Object|null, fetchedAt?: number|null, via?: string}|null} prRead
 * @param {string|null} lastFinishedAt - ISO
 * @returns {boolean}
 */
export function guestPrReadDeterminate(resolved, prRead, lastFinishedAt) {
  const status = resolved && resolved.status;
  if (status === 'none' || status === 'multiple') return true;
  if (status !== 'one' || !prRead || !prRead.result) return false;
  if (prRead.via !== PR_STATE_VIA.FRESH && prRead.via !== PR_STATE_VIA.CACHE) return false;
  const fetchedAt = num(prRead.fetchedAt);
  const floor = toMs(lastFinishedAt);
  return fetchedAt != null && floor != null && fetchedAt >= floor;
}

/**
 * The settling gate, pure. Settled iff all hold:
 *   (a) the session is settled (`sessionIsSettled`);
 *   (b) the PR read is determinate (`guestPrReadDeterminate`);
 *   (c) the paragraph matched (final, same key), or the grace has run out:
 *       `now >= lastFinishedAt + PARAGRAPH_GRACE_MS`.
 * An unknown `lastFinishedAt` never settles (the safe direction: keep reading).
 *
 * @param {Object} facts
 * @param {boolean} facts.sessionSettled
 * @param {boolean} facts.prDeterminate
 * @param {boolean} facts.paragraphMatched
 * @param {string|null} facts.lastFinishedAt - ISO
 * @param {Date|string|number} facts.now
 * @returns {boolean}
 */
export function isGuestRunSettled({ sessionSettled, prDeterminate, paragraphMatched, lastFinishedAt, now }) {
  if (!sessionSettled || !prDeterminate) return false;
  const lastMs = toMs(lastFinishedAt);
  if (lastMs == null) return false;
  if (paragraphMatched) return true;
  const nowMs = toMs(now);
  return nowMs != null && nowMs >= lastMs + PARAGRAPH_GRACE_MS;
}

// ─── The projection ─────────────────────────────────────────────────────────

/**
 * Build the stored guest projection from one refresh's reads. `runEvidence`
 * and `prRead` must come from the SAME `readRunEvidence` call (the reader's
 * injected `readPrStatus` adapter records the store's `readResult`), so the
 * header PR line, the evidence "now" row and `closeOut.status` agree and carry
 * one `asOf` (F1).
 *
 * @param {Object} input
 * @param {Object} input.session - the LIVE session (`loadRunLocal().session`)
 * @param {Object|null} [input.runEvidence] - the `readRunEvidence` model, or null
 * @param {{result: (Object|null), fetchedAt: (number|null), via: string}|null} [input.prRead]
 *   - the shared store's `readResult` for the one PR; null when nothing was read
 * @param {Object|null} [input.paragraph] - the stored paragraph record (`loadRunLocal().paragraph`)
 * @param {string} [input.urlKey] - the owner's workspace key (scrubbed, never stored)
 * @param {Date|string|number} input.capturedAt - the refresh clock; the guest page's `now`
 * @param {Object} deps
 * @param {Function} deps.sessionSettleState - `routes/dashboard.js`
 * @param {Function} deps.enrichLoop - `routes/dashboard.js`
 * @returns {Object} the projection (keys: `GUEST_PROJECTION_KEYS`)
 */
export function buildGuestRunProjection({
  session,
  runEvidence = null,
  prRead = null,
  paragraph = null,
  urlKey = '',
  capturedAt,
} = {}, { sessionSettleState, enrichLoop } = {}) {
  if (!session || typeof session !== 'object') throw new TypeError('buildGuestRunProjection needs a session');
  if (typeof sessionSettleState !== 'function' || typeof enrichLoop !== 'function') {
    throw new TypeError('buildGuestRunProjection needs sessionSettleState and enrichLoop');
  }
  const capturedMs = toMs(capturedAt);
  if (capturedMs == null) throw new TypeError('buildGuestRunProjection needs capturedAt');

  const stub = guestSession(session);
  const settleState = sessionSettleState(session);
  const paragraphKey = guestParagraphKey(stub);
  const settledKey = guestSettledKey(paragraphKey, settleState);
  const runParagraph = guestParagraph(paragraph, paragraphKey);
  const lastFinishedAt = computeLastFinishedAt(session, enrichLoop);

  const resolved = resolveRunPrRef(runEvidence);
  const prState = guestPrState(resolved, prRead);
  const prRef = resolved.status === 'one' ? guestPrRef(resolved.ref) : null;

  const settled = isGuestRunSettled({
    sessionSettled: !!(settleState && settleState.settled),
    prDeterminate: guestPrReadDeterminate(resolved, prRead, lastFinishedAt),
    paragraphMatched: runParagraph != null,
    lastFinishedAt,
    now: capturedMs,
  });

  const projection = {
    session: stub,
    runEvidence: guestRunEvidence(runEvidence, urlKey, prState.asOf),
    prState,
    runParagraph,
    paragraphKey,
    settledKey,
    lastFinishedAt,
    settled,
    capturedAt: new Date(capturedMs).toISOString(),
  };
  // "Exactly one ref or none": the key is absent, not null, when there is none.
  if (prRef) projection.prRef = prRef;
  return projection;
}
