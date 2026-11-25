/**
 * A run's transcript entries, as every page that draws a transcript receives them (LIN-4560, LIN-4508 piece E).
 *
 * The server half of the one transcript look. The run page embeds these entries (lib/render-session.js) and the Dispatch
 * history read sends them (routes/dispatch.js); both draw them through the one shared leaf, lib/transcript.js. That leaf
 * imports nothing, so what needs a server reader is decided here, once, on each entry:
 *
 *   - Masked at render time (`maskFeedbackFields`, lib/dispatch-feedback-masking.js, piece A's masker): `message`, `url`
 *     and `urlLabel`. Intake masks a run's words before they are stored (LIN-4556); this masks rows stored before that,
 *     so an old row shows masked on both pages. A clean field is returned as the same string.
 *   - `blocked`: the run's own `[blocked]`/`[pending]` line, which the look highlights. A child agent's is the child's,
 *     never the run's (the kinds table's `speaksForRun` role, LIN-4559).
 *   - `waiting: { what }`: a wait line of the run's own (`parseParkedWaitLine`, lib/session-telemetry.js, the one reader of
 *     the runner's wait shapes, LIN-4558), drawn as waiting, not as a bubble. `what` is null when the line does not say.
 *   - `quiet: true`: an entry the transcript does not draw. A run's own entry the parked-wait walk calls no statement
 *     (`isNonStateEntry`: the relays `tool`/`usage`/`resources`, a decision-lifecycle stamp, a legacy untagged `[usage]`
 *     line, a `[ticket]` marker), and a heartbeat that is not a wait line (kind `heartbeat`, or an untagged line the
 *     heartbeat reader `parseHeartbeat` reads). The words a run said stay; its machine lines do not become bubbles.
 *
 * Two shapes, the same facts: the run page's embed (`transcriptEntries`: the embed's key set before LIN-4560 — message,
 * url, urlLabel, timestamp, blocked, kind — with `agent`, `waiting` and `quiet` sparse) and the Dispatch history read's
 * (`historyTranscriptFeedback`: the formatted entry's own keys, additive-only, with the facts sparse).
 */
import { maskFeedbackFields } from './dispatch-feedback-masking.js';
import { entrySpeaksForRun } from './dispatch-feedback-kinds.js';
import { isNonStateEntry, parseHeartbeat, parseParkedWaitLine } from './session-telemetry.js';

/**
 * Moved from lib/render-session.js (LIN-1163 item 6): a server-side flag instead of divergent client-side regexes.
 * A `[pending]` line is also a wait shape, and waiting wins: it is drawn as waiting.
 */
const BLOCKED_MARKER_REGEX = /^\s*\[(blocked|pending)\]/i;

const isoOf = (t) => (t && typeof t.toISOString === 'function' ? t.toISOString() : (t || null));

/** A heartbeat (kind `heartbeat`, or an untagged line the heartbeat reader reads). */
const isHeartbeat = (raw, message) => raw.kind === 'heartbeat' || (!raw.kind && parseHeartbeat(message) !== null);

/**
 * What the transcript needs to know of one entry, decided once: its masked fields and how it is drawn.
 * `{ masked: {message, url, urlLabel}, blocked, waiting?, quiet? }`.
 */
function factsOf(f) {
  const masked = maskFeedbackFields({ message: f.message || '', url: f.url || null, urlLabel: f.urlLabel || null });
  const speaksForRun = entrySpeaksForRun(f);
  const facts = { masked, blocked: speaksForRun && BLOCKED_MARKER_REGEX.test(masked.message) };
  if (!speaksForRun) return facts;
  // No statement first: a stamp or relay is never drawn, whatever its text says (a withdrawal's reason may name a
  // "scheduled wakeup", which the wait reader would take for a wait line). Then a wait line, then a plain heartbeat.
  if (isNonStateEntry(f)) return { ...facts, quiet: true };
  const wait = parseParkedWaitLine(masked.message);
  if (wait) return { ...facts, waiting: { what: wait.what } };
  if (isHeartbeat(f, masked.message)) return { ...facts, quiet: true };
  return facts;
}

const sparse = (facts) => ({
  ...(facts.waiting ? { waiting: facts.waiting } : {}),
  ...(facts.quiet ? { quiet: true } : {})
});

/**
 * One stored (or formatted) feedback entry as the run page embeds it: the embed's key set before LIN-4560 (message,
 * url, urlLabel, timestamp, blocked, kind), then the sparse `agent`, `waiting` and `quiet`.
 *
 * @param {{message?: string, url?: string|null, urlLabel?: string|null, timestamp?: string|Date, kind?: string, agent?: string}} raw
 * @returns {{message: string, url: string|null, urlLabel: string|null, timestamp: string|null, blocked: boolean, kind: string|null, agent?: string, waiting?: {what: string|null}, quiet?: true}}
 */
export function transcriptEntry(raw) {
  const f = raw || {};
  const facts = factsOf(f);
  return {
    message: facts.masked.message,
    url: facts.masked.url || null,
    urlLabel: facts.masked.urlLabel || null,
    timestamp: isoOf(f.timestamp),
    blocked: facts.blocked,
    kind: f.kind || null,
    ...(f.agent ? { agent: String(f.agent) } : {}),
    ...sparse(facts)
  };
}

/**
 * A feedback array as the run page embeds it, in stored order (nothing is dropped: a `quiet` entry stays, flagged, so
 * an entry's index still names it).
 *
 * @param {Array|null|undefined} feedback
 * @returns {Array}
 */
export function transcriptEntries(feedback) {
  return Array.isArray(feedback) ? feedback.map(transcriptEntry) : [];
}

/**
 * A formatted feedback array (lib/dispatch-feedback-format.js) as the Dispatch history read sends it: each entry keeps
 * its own keys, additive-only as that formatter promises (LIN-1297: no `kind: null` for an entry without one), with
 * `message`, `url` and `urlLabel` masked and the transcript's facts added sparse (`blocked: true`, `waiting`, `quiet`).
 * The look reads the same fields off either shape, so the two pages draw the same items.
 *
 * @param {Array|null|undefined} feedback
 * @returns {Array}
 */
export function historyTranscriptFeedback(feedback) {
  if (!Array.isArray(feedback)) return [];
  return feedback.map((raw) => {
    const f = raw || {};
    const facts = factsOf(f);
    const out = { ...f };
    for (const field of ['message', 'url', 'urlLabel']) if (field in f) out[field] = facts.masked[field] ?? f[field];
    return { ...out, ...(facts.blocked ? { blocked: true } : {}), ...sparse(facts) };
  });
}
