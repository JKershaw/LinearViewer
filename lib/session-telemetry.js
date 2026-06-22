/**
 * lib/session-telemetry.js
 *
 * Read-only telemetry extraction for autopilot sessions and worker runs (LIN-594).
 *
 * The dispatch runner emits free-form feedback entries — heartbeats, evidence
 * pointers, terminal markers — that all land in a loop's `feedback[]` as
 * `{ message, url, urlLabel, timestamp }` (`lib/dispatch-store.js`, carried
 * through `lib/pipeline-loops.js`). This module derives the observation page's
 * `{ runtime, metrics[], producedArtifacts[], model? }` from that substrate
 * WITHOUT mutating it — the same tolerant, read-only discipline as
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
 */

import { findTerminalFeedback, deriveCompletedAt } from './dispatch-terminal.js';

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

// ─── Composite builders ──────────────────────────────────────────────────────

function _assembleTelemetry(runtime, feedback) {
  const telemetry = {
    runtime,
    metrics: parseHeartbeats(feedback),
    producedArtifacts: parseEvidenceArtifacts(feedback),
  };
  const model = parseModel(feedback);
  if (model) telemetry.model = model; // optional: omitted when absent
  return telemetry;
}

/**
 * Telemetry for a single worker run (loop). Runtime spans the run's
 * `dispatchedAt` → its terminal-marker completion time (null while open).
 *
 * @param {{dispatchedAt?: string, feedback?: Array<Object>}} run
 * @returns {{runtime: Object, metrics: Array, producedArtifacts: Array, model?: string}}
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
 * @returns {{runtime: Object, metrics: Array, producedArtifacts: Array, model?: string}}
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
};
