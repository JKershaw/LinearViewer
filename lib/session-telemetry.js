/**
 * lib/session-telemetry.js
 *
 * Read-only telemetry extraction for autopilot sessions and worker runs (LIN-594).
 *
 * The dispatch runner emits free-form feedback entries — heartbeats, evidence
 * pointers, terminal markers — that all land in a loop's `feedback[]` as
 * `{ message, url, urlLabel, timestamp }` (`lib/dispatch-store.js`, carried
 * through `lib/pipeline-loops.js`). This module derives the observation page's
 * `{ runtime, metrics[], producedArtifacts[], model?, usage? }` from that
 * substrate WITHOUT mutating it — the same tolerant, read-only discipline as
 * `lib/dispatch-terminal.js` (anchored regex, last/all matches, never throws on
 * malformed input).
 *
 * Field sourcing (all read-only; nothing is invented):
 *  - runtime           → session/run `dispatchedAt` → `completedAt`. The
 *                        `[done] Task completed in Xm Ys` marker is parsed only
 *                        as a `crossCheck`, never as the source of truth.
 *  - metrics[]         → heartbeat markers, both the compact
 *                        (`[working] 6 tools/32s · alive`) and rich
 *                        (`12 tools in 8m 11s: Bash×7, Read×2 · 15 total`) forms.
 *  - producedArtifacts → `[evidence]` markers; URLs are read from BOTH the
 *                        message text and the structured `url`/`urlLabel` fields.
 *  - model?            → OPTIONAL and OMITTED today. The worker model is not
 *                        currently emitted anywhere in dispatch/feedback/session
 *                        data (`[started]`/`[working]` carry session id + tty
 *                        only; `lib/llm-call-log.js` tracks the *server's*
 *                        recommend/recap calls, not the worker's session). We do
 *                        NOT infer it from unrelated markers. The recommended
 *                        runner-side change is a small paired emission — append
 *                        `· model <id>` to the `[started]` marker (or post it via
 *                        `POST /api/proxy/agent/status`). `parseModel` reads that
 *                        tolerantly when it arrives and the field stays omitted
 *                        until then.
 *  - usage?            → OPTIONAL, attached when the runner has posted a
 *                        `kind: 'usage'` feedback entry (LIN-1425). The runner
 *                        posts a CUMULATIVE snapshot on every Stop, so
 *                        `parseUsage` takes the last valid entry in feedback
 *                        order — it never sums multiple entries, which would
 *                        multiply-count a lineage by its Stop count. Carries
 *                        the five raw Anthropic token fields, `model`, and a
 *                        nullable `costUsd` — native where the harness reports
 *                        one (`opencode`), otherwise DERIVED from the token
 *                        counts and `lib/model-pricing.js`'s static rate card
 *                        (LIN-1495), since `claude-code` has no native cost
 *                        field. Still null when the model is unpriceable.
 */

import { findTerminalFeedback, deriveCompletedAt } from './dispatch-terminal.js';
import { computeUsageCostUsd } from './model-pricing.js';

// ─── Tolerant primitives ─────────────────────────────────────────────────────

function _toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a human duration like `45s`, `8m 11s`, `2m`, `1h 5m 3s` into seconds.
 * Tolerant: returns null when no h/m/s token is present. Only h/m/s tokens are
 * read, so adjacent prose (e.g. `... 3 mentions`) cannot be mistaken for time.
 *
 * @param {string} str
 * @returns {number|null}
 */
function parseDurationToSeconds(str) {
  if (typeof str !== 'string') return null;
  let total = 0;
  let found = false;
  const h = /(\d+)\s*h(?:ours?|rs?)?\b/i.exec(str);
  const m = /(\d+)\s*m(?:in(?:ute)?s?)?\b/i.exec(str);
  const s = /(\d+)\s*s(?:ec(?:ond)?s?)?\b/i.exec(str);
  if (h) { total += parseInt(h[1], 10) * 3600; found = true; }
  if (m) { total += parseInt(m[1], 10) * 60; found = true; }
  if (s) { total += parseInt(s[1], 10); found = true; }
  return found ? total : null;
}

// ─── runtime ─────────────────────────────────────────────────────────────────

// The stated duration tail of a terminal marker, e.g. "... completed in 55s",
// "... landed in 3s". Cross-check only — never the source of truth for runtime.
const DONE_DURATION_RE = /\bin\s+(\d+\s*[hms](?:\s*\d+\s*[hms])*)/i;

function _parseDoneDuration(feedback) {
  const terminal = findTerminalFeedback(feedback);
  if (!terminal) return null;
  const match = DONE_DURATION_RE.exec(terminal.entry?.message || '');
  if (!match) return null;
  const seconds = parseDurationToSeconds(match[1]);
  if (seconds == null) return null;
  return { seconds, ms: seconds * 1000, raw: match[1].trim() };
}

/**
 * Runtime derived from the authoritative timestamps, with the terminal marker's
 * stated duration carried alongside as a verification-only cross-check.
 *
 * @param {string|Date|null} dispatchedAt
 * @param {string|Date|null} completedAt
 * @param {Array<Object>} [feedback]
 * @returns {{ms: number|null, dispatchedAt: string|null, completedAt: string|null, crossCheck: {seconds: number, ms: number, raw: string}|null}}
 */
export function deriveRuntime(dispatchedAt, completedAt, feedback = []) {
  const start = _toDate(dispatchedAt);
  const end = _toDate(completedAt);
  const ms = start && end ? end.getTime() - start.getTime() : null;
  return {
    ms: ms != null && ms >= 0 ? ms : null,
    dispatchedAt: dispatchedAt || null,
    completedAt: completedAt || null,
    crossCheck: _parseDoneDuration(feedback),
  };
}

// ─── metrics[] (heartbeats) ──────────────────────────────────────────────────

// A line is a candidate heartbeat if it is a [working] beat, reports no tool
// calls, or states "N tools in/<time>". This deliberately tolerates the rich
// form that arrives without a [working] prefix.
const HEARTBEAT_HINT = /\[working|no tool calls|\d+\s*tools?\s*(?:in\b|\/)/i;
const TOOL_COUNT_RE = /(\d+)\s*tools?\b/i;
const ELAPSED_RE = /(?:tools?|calls)\s*(?:in|\/)\s*([^·:]+)/i;
// Per-tool breakdown uses the multiplication sign (Bash×7). ASCII 'x' is
// intentionally NOT accepted — it would false-match names like "Linux2".
const BREAKDOWN_RE = /([A-Za-z][A-Za-z0-9_+#-]*)\s*×\s*(\d+)/g;
const TOTAL_RE = /(\d+)\s*total\b/i;

/**
 * Parse a single heartbeat message into a structured activity snapshot, or null
 * if the message is not a heartbeat / carries no tool count.
 *
 * @param {string} message
 * @param {string|null} [timestamp]
 * @returns {{toolCount: number, elapsedSeconds: number|null, breakdown: Object|null, total: number|null, state: ('running'|'idle'|null), timestamp: string|null, raw: string}|null}
 */
export function parseHeartbeat(message, timestamp = null) {
  if (typeof message !== 'string' || !HEARTBEAT_HINT.test(message)) return null;

  const noTools = /no tool calls/i.test(message);
  const countMatch = TOOL_COUNT_RE.exec(message);
  const toolCount = noTools ? 0 : countMatch ? parseInt(countMatch[1], 10) : null;
  if (toolCount == null) return null;

  const elapsedMatch = ELAPSED_RE.exec(message);
  const elapsedSeconds = elapsedMatch ? parseDurationToSeconds(elapsedMatch[1]) : null;

  const breakdown = {};
  BREAKDOWN_RE.lastIndex = 0;
  let b;
  while ((b = BREAKDOWN_RE.exec(message))) breakdown[b[1]] = parseInt(b[2], 10);

  const totalMatch = TOTAL_RE.exec(message);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : null;

  let state = null;
  if (/running/i.test(message)) state = 'running';
  else if (noTools) state = 'idle';

  return {
    toolCount,
    elapsedSeconds,
    breakdown: Object.keys(breakdown).length ? breakdown : null,
    total,
    state,
    timestamp: timestamp || null,
    raw: message,
  };
}

/**
 * Parse every heartbeat in a feedback list, in order. Non-heartbeat and
 * malformed entries are skipped without throwing.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {Array<Object>}
 */
export function parseHeartbeats(feedback) {
  if (!Array.isArray(feedback)) return [];
  const out = [];
  for (const entry of feedback) {
    // A decision entry (LIN-2181) carries free-form human prose (question/options[].label)
    // that can incidentally match HEARTBEAT_HINT (e.g. "batch 3 tools in one turn?"), minting
    // a phantom metric. Excluded by kind, not by content — a positive `kind === 'heartbeat'`
    // allow-list would silently zero `kind:'status'` beats and untagged pre-LIN-1475 rows,
    // which carry no `kind` at all.
    if (entry?.kind === 'decision') continue;
    const metric = parseHeartbeat(entry?.message || '', entry?.timestamp || null);
    if (metric) out.push(metric);
  }
  return out;
}

// ─── producedArtifacts[] (evidence) ──────────────────────────────────────────

const EVIDENCE_PREFIX = /^\s*\[evidence\]/i;
const EVIDENCE_LABEL_RE = /\[evidence\]\s*([^·\n]*?)\s*(?:·|https?:|$)/i;
const MENTIONS_RE = /·\s*(\d+)\s*mentions?\b/i;
const URL_RE = /https?:\/\/[^\s)·,]+/g;

/**
 * Collect artifact URLs from `[evidence]` feedback entries, reading URLs from
 * BOTH the message text and the structured `url`/`urlLabel` fields. Deduped by
 * URL (first occurrence wins).
 *
 * @param {Array<{message?: string, url?: string, urlLabel?: string, timestamp?: string}>} feedback
 * @returns {Array<{url: string, label: string|null, mentions: number|null, timestamp: string|null}>}
 */
export function parseEvidenceArtifacts(feedback) {
  if (!Array.isArray(feedback)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of feedback) {
    const message = entry?.message || '';
    if (!EVIDENCE_PREFIX.test(message)) continue;

    const labelMatch = EVIDENCE_LABEL_RE.exec(message);
    const textLabel = labelMatch ? labelMatch[1].trim() : '';
    const mentionsMatch = MENTIONS_RE.exec(message);
    const mentions = mentionsMatch ? parseInt(mentionsMatch[1], 10) : null;

    const urls = [];
    if (entry?.url) urls.push(String(entry.url).trim());
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(message))) urls.push(m[0].replace(/[.,;)]+$/, ''));

    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        label: entry?.urlLabel || textLabel || null,
        mentions,
        timestamp: entry?.timestamp || null,
      });
    }
  }
  return out;
}

// ─── ticketWalk? (worker-lane [ticket] markers, LIN-2242/LIN-2243) ────────────

const TICKET_PREFIX = /^\s*\[ticket\]\s*(LIN-\d+)\s+(started|done|blocked|refused|dissolved|trimmed)\b\s*(?:[—-]\s*(.*))?$/i;

/**
 * Parse `[ticket] LIN-XXXX <state>[ — <outcome>]` markers (LIN-2242's worker-
 * lane convention) into an ordered per-lane ticket walk. One entry per
 * identifier — a later marker for the same ticket (e.g. `started` then
 * `done`) overwrites the earlier one in place, so the walk reflects each
 * ticket's LATEST known state while preserving first-seen order. Tolerant:
 * malformed/missing feedback yields [], never throws.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {Array<{identifier: string, state: string, outcomeLine: string|null, timestamp: string|null}>}
 */
export function parseTicketMarkers(feedback) {
  if (!Array.isArray(feedback)) return [];
  const byId = new Map();
  for (const entry of feedback) {
    const match = TICKET_PREFIX.exec(entry?.message || '');
    if (!match) continue;
    const [, identifier, rawState, outcomeLine] = match;
    byId.set(identifier, {
      identifier,
      state: rawState.toLowerCase(),
      outcomeLine: outcomeLine ? outcomeLine.trim() : null,
      timestamp: entry?.timestamp || null,
    });
  }
  return Array.from(byId.values());
}

// ─── parkedWait? (LIN-2244: parked on an async wait, distinct from "working") ─

// Anchored to the ACTUAL observed convention (2026-08-23's W1/W3 lanes:
// `[working · verifying] Not done yet — a scheduled wakeup still pending.`),
// not a broad "pending"/"waiting" guess — a wider hint would false-positive on
// unrelated "pending review"-type prose. Deliberately narrower than the
// similarly-worded "confirming completion" cross-check message a coordinator
// posts while polling a CHILD session (a different flow entirely) — that
// message never mentions a scheduled wakeup, so it never matches here.
const PARKED_WAIT_HINT = /scheduled wakeup/i;

/**
 * Whether a session/run is CURRENTLY parked on a pending async wait (e.g. a
 * ScheduleWakeup-driven CI poll) — distinct from both "working" (real
 * activity) and "blocked on a human" (`[blocked]`/`[pending]` markers,
 * `lib/render-session.js`'s `runIsWaiting`). Tolerant, feedback[]-only,
 * heuristic by design (v1: no new wire field) — mirrors the discipline of
 * `parseTicketMarkers`/`parseEvidenceArtifacts` above.
 *
 * Only the LATEST feedback entry decides "currently" parked: a session that
 * was parked earlier but has since posted anything else (real progress, a
 * terminal marker, a blocked marker) is not reported as parked now. `since`
 * is the start of the CONTIGUOUS run of parked-wait entries ending at the
 * latest one — not the session's first-ever mention — so a lane that parks,
 * resumes, and parks again reports only the CURRENT park's duration.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{since: string|null, latest: string|null}|null}
 */
export function parseParkedWait(feedback) {
  if (!Array.isArray(feedback) || !feedback.length) return null;
  const last = feedback[feedback.length - 1];
  if (!PARKED_WAIT_HINT.test(last?.message || '')) return null;
  let sinceIdx = feedback.length - 1;
  for (let i = feedback.length - 2; i >= 0; i--) {
    if (!PARKED_WAIT_HINT.test(feedback[i]?.message || '')) break;
    sinceIdx = i;
  }
  return {
    since: feedback[sinceIdx]?.timestamp || null,
    latest: last?.timestamp || null,
  };
}

// ─── model? (forward-compat, omitted until the runner emits it) ───────────────

const STARTED_PREFIX = /^\s*\[started\]/i;
const MODEL_RE = /\bmodel[:=\s]+([A-Za-z0-9._/-]+)/i;

/**
 * The worker model, IF the runner has started emitting it on the `[started]`
 * marker (e.g. `[started] session abc · tty 3 · model claude-opus-4-8`).
 * Returns null today — the field is omitted from telemetry until then. Never
 * inferred from unrelated markers.
 *
 * @param {Array<{message?: string}>} feedback
 * @returns {string|null}
 */
export function parseModel(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (const entry of feedback) {
    const message = entry?.message || '';
    if (!STARTED_PREFIX.test(message)) continue;
    const m = MODEL_RE.exec(message);
    if (m) return m[1];
  }
  return null;
}

// ─── usage? (LIN-1425, forward-compat, omitted until the runner emits it) ────
//
// The runner posts a cumulative usage SNAPSHOT (not a per-turn delta) on each
// Stop, as a `kind: 'usage'` feedback entry whose `message` carries a JSON
// payload (LIN-1475 exposes `kind` on formatted feedback entries, so this
// gates on the structured field rather than scraping prose). Because it is
// cumulative and a lineage can span many Stops/follow-ups, the LAST valid
// `kind: 'usage'` entry in feedback order wins — never summed, which would
// multiply-count the session by its Stop count.
//
// Only the five raw Anthropic token fields + model + a nullable costUsd are
// read; anything else in the payload is ignored so vendor-noise fields never
// leak into telemetry. Malformed, truncated, or absent payloads are tolerated
// — parseUsage never throws, and returns null instead of a partial object.
//
// `costUsd` now has TWO provenances (LIN-1495). A native one, which opencode
// reports and which always wins; and a derived one, computed here from the five
// token counts and the static rate card in lib/model-pricing.js for the harness
// that has no native cost at all (claude-code). The field name and its nullable
// convention are unchanged (LIN-1086): null still means "unknown", and an
// unpriceable model still yields null rather than a guessed or zero figure.
//
// Stated, not fixed here: claude-code posts CUMULATIVE snapshots while opencode
// posts PER-TURN ones, and the reduce below is last-wins — so a multi-run
// opencode lineage under-reports. That mismatch predates this derivation and
// belongs to the lineage roll-up (LIN-1426); do NOT "fix" it by summing across
// harnesses, which would multiply-count claude-code by its Stop count.

const USAGE_NUMBER_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheCreationInputTokens',
  'cacheCreation1hInputTokens',
  'cacheReadInputTokens',
];

const USAGE_LANES = ['subscription', 'api', 'openrouter'];

/**
 * Parse a single `kind: 'usage'` feedback entry's JSON payload out of its
 * `message` (format: `[usage] { ...json... }`). Tolerant: returns null on any
 * non-string message, missing/invalid JSON, or a payload with no recognized
 * fields. Never throws.
 *
 * @param {string} message
 * @returns {{harness?: string, model?: string, effort?: string, inputTokens?: number, outputTokens?: number, cacheCreationInputTokens?: number, cacheCreation1hInputTokens?: number, cacheReadInputTokens?: number, lane: string|null, costUsd: number|null}|null}
 */
function parseUsagePayload(message) {
  if (typeof message !== 'string') return null;
  const start = message.indexOf('{');
  if (start === -1) return null;
  let payload;
  try {
    payload = JSON.parse(message.slice(start));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const usage = {};
  if (typeof payload.harness === 'string') usage.harness = payload.harness;
  if (typeof payload.model === 'string') usage.model = payload.model;
  // Effort (LIN-2615): open-string passthrough like harness/model above — NOT
  // lane's closed enum below. Squashing an unknown level to null would destroy
  // the datum the Phase 2 self-assessment read-out exists to collect; the
  // conditional form (vs. an unconditional assign) is what keeps this a
  // no-op when the field is absent, matching harness/model's own convention.
  if (typeof payload.effort === 'string') usage.effort = payload.effort;
  for (const field of USAGE_NUMBER_FIELDS) {
    if (Number.isFinite(payload[field])) usage[field] = payload[field];
  }
  if (Object.keys(usage).length === 0) return null;
  // lane is a closed enum (Strategy A) — always present, null when unknown,
  // matching costUsd's LIN-1086 nullable idiom. Unlike the open-vocabulary
  // harness/model fields above, an unrecognized/non-string/absent value is
  // deliberately squashed to null rather than passed through raw: downstream
  // consumers groupBy lane, and an unconstrained value would mint a phantom
  // partition. null means "we don't know which lane" and must never be
  // defaulted to 'subscription'.
  usage.lane = USAGE_LANES.includes(payload.lane) ? payload.lane : null;
  // costUsd is nullable by design (LIN-1086 shape) — always present, null when
  // the harness has no native cost (claude-code) or the payload omits it.
  //
  // A native cost is authoritative and always wins. Only when it is absent do we
  // DERIVE one (LIN-1495) from the five raw token counts and the static rate card
  // in lib/model-pricing.js — the case claude-code is permanently in, since it does
  // not route through OpenRouter and reports no cost anywhere in its transcript.
  // This is the one place both harnesses converge on a single vocabulary, so it is
  // the one place the derivation belongs; downstream the shapes have already
  // diverged into two whitelists and two render paths. A native cost (the harness
  // reports its own costUsd) IS priced at the time of spend and never restated.
  // A derived cost is NOT: computeUsageCostUsd re-runs over these same stored raw
  // token counts on every later read (e.g. /api/proxy/cost, the KPI projection), so
  // editing lib/model-pricing.js's rate table restates every derived-cost session's
  // history retroactively, silently, the next time it is read (LIN-2384).
  //
  // computeUsageCostUsd is pure, synchronous and total — it returns null rather
  // than throwing or guessing — so the tolerance contract above is preserved, the
  // nullable convention survives an unpriceable model (`<synthetic>`, a bare alias,
  // a model newer than the table), and computeUsageCostUsd's own derivation adds
  // no key beyond costUsd (scoped to that function — the usage object above it
  // does gain keys, e.g. effort, LIN-2615).
  usage.costUsd = typeof payload.costUsd === 'number'
    ? payload.costUsd
    : computeUsageCostUsd(usage);
  return usage;
}

/**
 * The session's cumulative token/cost usage, IF the runner has posted a
 * `kind: 'usage'` feedback entry. Feedback is walked in order and the LAST
 * parseable entry wins (cumulative-snapshot, last-wins semantics — see
 * module notes above). Returns null (field omitted) when no entry is present
 * or every candidate is malformed.
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {Object|null}
 */
export function parseUsage(feedback) {
  if (!Array.isArray(feedback)) return null;
  let latest = null;
  for (const entry of feedback) {
    if (entry?.kind !== 'usage') continue;
    const parsed = parseUsagePayload(entry.message);
    if (parsed) latest = parsed;
  }
  return latest;
}

// ─── resources? (LIN-1789, forward-compat, inert until a producer exists) ────
//
// A `kind: 'resources'` feedback entry whose `message` carries a JSON payload
// of host/session resource-usage figures (peak RSS, host memory/swap, OOM-kill
// delta, load average, clone disk usage). Same posture `usage` was in before
// its runner shipped: parsed and carried, but nothing produces it yet.
//
// Ten fields, all numeric-only — gated field-by-field via `Number.isFinite`,
// the same mechanism `parseUsagePayload` uses for its five token-count fields.
// The wire field names are a PROPOSAL (LIN-1790 has not adopted them), so an
// unrecognized key is silently dropped rather than treated as an error —
// exactly the tolerant-parse contract below asks for.
//
// Last-entry-wins over `feedback[]` filtered on `kind === 'resources'` —
// mirrors `parseUsage`'s walk.

const RESOURCES_NUMBER_FIELDS = [
  'peakRssBytes',
  'hostMemAvailableBytes',
  'hostMemTotalBytes',
  'hostSwapUsedBytes',
  'oomKillDelta',
  'loadAvg1',
  'cpuCount',
  'activeSessionCount',
  'cloneDiskBytes',
  'cloneCount',
];

/**
 * Parse a single `kind: 'resources'` feedback entry's JSON payload out of its
 * `message` (format: `[resources] { ...json... }`). Tolerant: returns null on
 * any non-string message, missing/invalid JSON, non-object/array payload, or a
 * payload with no recognized fields. Never throws.
 *
 * @param {string} message
 * @returns {{peakRssBytes?: number, hostMemAvailableBytes?: number, hostMemTotalBytes?: number, hostSwapUsedBytes?: number, oomKillDelta?: number, loadAvg1?: number, cpuCount?: number, activeSessionCount?: number, cloneDiskBytes?: number, cloneCount?: number}|null}
 */
function parseResourcesPayload(message) {
  if (typeof message !== 'string') return null;
  const start = message.indexOf('{');
  if (start === -1) return null;
  let payload;
  try {
    payload = JSON.parse(message.slice(start));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const resources = {};
  for (const field of RESOURCES_NUMBER_FIELDS) {
    if (Number.isFinite(payload[field])) resources[field] = payload[field];
  }
  if (Object.keys(resources).length === 0) return null;
  return resources;
}

/**
 * The session's most recent resource-usage snapshot, IF the runner has posted
 * a `kind: 'resources'` feedback entry. Feedback is walked in order and the
 * LAST parseable entry wins. Returns null (field omitted) when no entry is
 * present or every candidate is malformed.
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {Object|null}
 */
export function parseResources(feedback) {
  if (!Array.isArray(feedback)) return null;
  let latest = null;
  for (const entry of feedback) {
    if (entry?.kind !== 'resources') continue;
    const parsed = parseResourcesPayload(entry.message);
    if (parsed) latest = parsed;
  }
  return latest;
}

// ─── decisions[] (LIN-2181, H2 of LIN-1725; inert until H3 wires a derivation) ─
//
// A `kind: 'decision'` feedback entry whose `message` carries a JSON payload
// describing an escalation-style decision surfaced by the runner (options,
// an optional recommendation, whether free text is accepted, and what to do
// `if_unanswered`). Same tolerant parse-from-first-`{` contract as
// `parseUsagePayload`/`parseResourcesPayload`: `JSON.parse` inside try/catch,
// non-object/array guard, field-by-field allow-listing, unknown keys
// dropped, never throws.
//
// This parser is deliberately STRICTER than the tolerance contract above
// requires, per LIN-2181's scoping:
//  - `decision_id` is mandatory. An id-less decision cannot be looked up or
//    re-answered, so a missing one drops the WHOLE entry (unlike every other
//    field here, which drops individually).
//  - `recommended` is cross-validated against `options[].id`. A value naming
//    an option that isn't (or is no longer) offered drops only the FIELD,
//    never the entry.
//  - `if_unanswered` stays an OPAQUE carrier: guarded to a plain object and
//    passed through as-is, with no enum validation of its contents. The
//    concrete `(a)/(b)/(c)` disposition vocabulary belongs to LIN-1727 and is
//    explicitly not this parser's to define.
//
// `options` is length-bounded — this parser carries a decision for display,
// it does not enforce exhaustive coverage of every option the runner sent.
//
// `parseDecisions` walks `feedback[]` filtered on `kind === 'decision'` and
// dedupes by `decision_id`, LAST-wins — mirrors the `kind === 'resources'`
// last-entry-wins walk above, since a re-post of the same id is a re-answer
// superseding the prior one, not a second record.

const DECISION_OPTIONS_MAX = 10;

function _parseDecisionOptions(value) {
  if (!Array.isArray(value)) return undefined;
  const options = [];
  for (const opt of value.slice(0, DECISION_OPTIONS_MAX)) {
    if (!opt || typeof opt !== 'object' || Array.isArray(opt)) continue;
    if (typeof opt.id !== 'string' || typeof opt.label !== 'string') continue;
    const clean = { id: opt.id, label: opt.label };
    if (Number.isFinite(opt.cost)) clean.cost = opt.cost;
    options.push(clean);
  }
  return options.length ? options : undefined;
}

function _parseIfUnanswered(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return { ...value };
}

/**
 * Parse a single `kind: 'decision'` feedback entry's JSON payload out of its
 * `message` (format: `[decision] { ...json... }`). Tolerant: returns null on
 * any non-string message, missing/invalid JSON, non-object/array payload, or
 * a payload with no string `decision_id`. Never throws.
 *
 * @param {string} message
 * @returns {{decision_id: string, question?: string, options?: Array<{id: string, label: string, cost?: number}>, recommended?: string, free_text?: boolean, if_unanswered?: Object}|null}
 */
export function parseDecision(message) {
  if (typeof message !== 'string') return null;
  const start = message.indexOf('{');
  if (start === -1) return null;
  let payload;
  try {
    payload = JSON.parse(message.slice(start));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.decision_id !== 'string') return null;

  const decision = { decision_id: payload.decision_id };
  if (typeof payload.question === 'string') decision.question = payload.question;

  const options = _parseDecisionOptions(payload.options);
  if (options) decision.options = options;

  // Cross-validated against options[].id (not schema-relaxed): an invalid
  // value drops only this field, never the entry.
  if (typeof payload.recommended === 'string' && options?.some((o) => o.id === payload.recommended)) {
    decision.recommended = payload.recommended;
  }

  if (typeof payload.free_text === 'boolean') decision.free_text = payload.free_text;

  const ifUnanswered = _parseIfUnanswered(payload.if_unanswered);
  if (ifUnanswered) decision.if_unanswered = ifUnanswered;

  return decision;
}

/**
 * Every `kind: 'decision'` feedback entry, deduped by `decision_id` with
 * LAST-wins semantics (a re-post of the same id supersedes the prior one).
 * Malformed/unsuitable entries are skipped without throwing.
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {Array<Object>}
 */
export function parseDecisions(feedback) {
  if (!Array.isArray(feedback)) return [];
  const byId = new Map();
  for (const entry of feedback) {
    if (entry?.kind !== 'decision') continue;
    const decision = parseDecision(entry?.message);
    if (decision) byId.set(decision.decision_id, decision);
  }
  return Array.from(byId.values());
}

// ─── Composite builders ──────────────────────────────────────────────────────

function _assembleTelemetry(runtime, feedback) {
  const telemetry = {
    runtime,
    metrics: parseHeartbeats(feedback),
    producedArtifacts: parseEvidenceArtifacts(feedback),
  };
  const model = parseModel(feedback);
  if (model) telemetry.model = model; // optional: omitted when absent
  const usage = parseUsage(feedback);
  if (usage) telemetry.usage = usage; // optional: omitted when absent
  const resources = parseResources(feedback);
  if (resources) telemetry.resources = resources; // optional: omitted when absent
  const ticketWalk = parseTicketMarkers(feedback);
  if (ticketWalk.length) telemetry.ticketWalk = ticketWalk; // optional: omitted for a non-lane run/session
  const parkedWait = parseParkedWait(feedback);
  if (parkedWait) telemetry.parkedWait = parkedWait; // optional: omitted when not currently parked
  return telemetry;
}

/**
 * Telemetry for a single worker run (loop). Runtime spans the run's
 * `dispatchedAt` → its terminal-marker completion time (null while open).
 *
 * @param {{dispatchedAt?: string, feedback?: Array<Object>}} run
 * @returns {{runtime: Object, metrics: Array, producedArtifacts: Array, model?: string, usage?: Object}}
 */
export function buildRunTelemetry(run = {}) {
  const feedback = Array.isArray(run.feedback) ? run.feedback : [];
  const completedAt = deriveCompletedAt(feedback);
  return _assembleTelemetry(deriveRuntime(run.dispatchedAt || null, completedAt, feedback), feedback);
}

/**
 * Telemetry for an assembled autopilot session. Runtime uses the session's
 * already-computed `dispatchedAt`/`completedAt` (LIN-591); metrics, artifacts
 * and model are aggregated across all of the session's loops' feedback.
 *
 * @param {{dispatchedAt?: string, completedAt?: string, loops?: Array<{feedback?: Array<Object>}>}} session
 * @returns {{runtime: Object, metrics: Array, producedArtifacts: Array, model?: string, usage?: Object}}
 */
export function buildSessionTelemetry(session = {}) {
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const feedback = loops.flatMap((l) => (Array.isArray(l?.feedback) ? l.feedback : []));
  return _assembleTelemetry(
    deriveRuntime(session.dispatchedAt || null, session.completedAt || null, feedback),
    feedback
  );
}

export const __internal = {
  _toDate,
  parseDurationToSeconds,
  _parseDoneDuration,
  HEARTBEAT_HINT,
  BREAKDOWN_RE,
  EVIDENCE_PREFIX,
  MODEL_RE,
  // LIN-2253: exposed so kpi-stats.js's Mongo/Mango aggregation projection
  // can $regexMatch feedback messages against the SAME pattern
  // parseTicketMarkers uses, mirroring how dispatch-terminal.js's
  // TERMINAL_FEEDBACK_REGEX is already shared with that projection —
  // one definition, never re-typed at the query layer.
  TICKET_PREFIX,
};
