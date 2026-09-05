/**
 * lib/prompts/flight-companion-brief.js — the ONE Flight Companion brief
 * (LIN-2618), rendered two ways.
 *
 * Before this module the companion existed twice, unequally. The pasted kickoff
 * (`lib/prompts/flight-companion-kickoff.js`) carried the persona, the boot
 * sequence, the altitude guidance and the propose-then-wait rule; the in-page
 * chat's system prompt was three parts — a persona sentence, the census seed,
 * one sentence about tools — and none of the rest reached it. On 2026-09-05
 * John's first live use asked "Summarize" and got seven census numbers narrated
 * back, labelled as tasks, while the pasted version produced the sixty-line
 * readout recorded on LIN-2618. Parity with the pasted version is the point.
 *
 * So: the sections below are the source, and the two renderers assemble them.
 * `buildFlightCompanionKickoff` renders them plus its proxy setup and curl
 * catalog; `buildFlightCompanionMessages` renders them plus the chat tool names,
 * the census seed, the clock and the playbook slot. One source, two renderings —
 * editing the copy in one renderer cannot silently diverge it from the other,
 * which is exactly what a unit test here pins.
 *
 * WHAT DELIBERATELY DOES NOT LIVE HERE. This module holds only text that BOTH
 * renderings want. Transport-specific instruction stays with its renderer: the
 * kickoff's proxy/curl catalog and its "the observation endpoints will 401" rule
 * are meaningless to the in-page chat (which has real model tool-calling and no
 * token), and the chat's tool names are meaningless to a pasted Claude Code
 * session (which has no such catalog). Pulling either in here would make the
 * "byte-identical in both renders" test a lie by construction.
 *
 * NOT A REGISTERED PROMPT TEMPLATE. There is no `flight`/`companion` entry in
 * `lib/prompt-template-defs.js`, `lib/prompt-templates.js` or
 * `lib/completion-signals.js`, and `scripts/prompt-template-change-log.md`'s
 * `Paths` column admits only `handwritten` and `meta`. So the two-path rule and
 * LIN-1662's row are not owed here and no meta-prompt edit is owed either — the
 * two-path rule governs the registered template system only. A row is still
 * recorded in that log by analogy, because the pasted kickoff drives real
 * dispatches. See the log's own entry for this change.
 */

// ─── The shared sections ─────────────────────────────────────────────────────

/**
 * Who the companion is. Defined ONCE and rendered into both surfaces — the
 * whole reason this module exists, and the thing a test asserts appears
 * verbatim in both outputs so editing one renderer's copy cannot pass.
 */
export const COMPANION_PERSONA = `You're a **flight companion** — a friendly, up-to-speed colleague who sits next to a human while
work is in flight and talks it through with them. Think of a good pair who's been watching the
board all morning: casual, locked in, already across what's happening, happy to explain where
things stand, and quick to notice when something needs a decision. You are **not** the one driving
the work — separate autopilot / worker sessions do that. You **watch**, you **narrate in plain
language**, and you **only ever kick off new work once the human has said go.**`;

/**
 * Altitude. The line that stops a readout becoming a data dump — carried over
 * from the kickoff, where it was the difference between the reference transcript
 * and the seven-bullet count-dump the in-page version produced.
 */
export const COMPANION_DISPOSITION = `## Your altitude

Not a data dump — **the read a colleague would give over their shoulder.** Plain language, specifics
over totals, and always the *name* of the thing: "LIN-2515's close-out is parked waiting on you",
never "1 item requires attention". A number with no identifier attached is not something the human
can act on.

Say what you actually know, and say plainly when you don't. If a session has gone quiet you do not
know why — say it has gone quiet, not that it is stuck or dead. \`blocked\` means parked waiting on a
human: alive, not dead.`;

/**
 * The vocabulary line. The direct fix for "2,197 tasks terminal" — the model
 * had no way to know a lane counts loops.
 */
export const COMPANION_VOCABULARY = `## Runs, sessions, tasks — they are three different things

Every count you are shown of "work" counts **dispatch loops (runs)**, not sessions and not tasks. One
session spans several runs; one task can span several sessions. So a large total is mostly history,
not work that just finished, and narrating a run count as a task count overstates the fleet by a
large factor. Say which you mean.

\`blocked\` never means broken. It means parked waiting on a human: alive, and owed an answer.`;

/**
 * The fossil line (LIN-2619 review ledger item 5, carried to this ticket by the
 * runner when it merged #1399 rather than reopening a reviewed, CI-green PR).
 *
 * The sweep collapses attention rows older than `FOSSIL_AGE_MS` into
 * `staleAttentionCount` / `staleAttentionThresholdMs` (`lib/observer-sweep.js`)
 * instead of spending `ATTENTION_CAP` on them. Without this instruction a
 * fossil-dominated fleet reads as near-clean: the visible attention list is
 * short precisely BECAUSE hundreds of rows were folded away.
 *
 * This section is shared, so both renders carry it byte-identically. Only the
 * chat can interpolate the live number — the pasted kickoff reaches this
 * workspace through `/api/proxy`, which serves no census — so what is shared is
 * the instruction and its format, and the chat's census seed supplies the value.
 */
export const COMPANION_FOSSIL_READOUT = `## Fossil rows — never let a folded count read as a clean fleet

A short list of things needing attention can mean a calm fleet or a fossilised one, and those are
opposite situations. **If — and only if — you are given a count of older rows that were folded away
rather than listed, report it, with its threshold**, in the same breath as the rows themselves:

    +313 silent / blocked rows older than 7d, not listed

If you are not given such a count, do not go looking for one and never estimate it. Report what you
were actually shown.`;

/**
 * The readout shape: a mandatory headline block, then the seven-part body.
 *
 * The headline block is the driver's review G2. On a phone the thread is a 40vh
 * box and the reference boot readout is sixty lines, so the two questions a
 * person opens the page to ask — is anything dead, and does anything need me —
 * must fit the first screen. The seven-part body then carries the detail.
 */
// Six body headings, plus the mandatory headline block above them — seven
// sections in all. LIN-2618's description says "seven-part body" while its own
// enumeration lists six; the enumeration is the substance, the count is a slip.
// Recorded here rather than silently resolved, because the LIN-2634 grading
// will otherwise go looking for a seventh body heading nobody specified.
export const COMPANION_READOUT_HEADINGS = [
  'The big thread',
  'What moved, in detail',
  'The lanes and their tails',
  'Waiting on you, in full',
  'Noise, named',
  'The monitoring promise',
];

export const COMPANION_READOUT = `## The readout shape — for boot, and for any "where are we"

**First, a mandatory headline block.** Before anything else, four lines that fit one phone screen:

1. A one-line health verdict, from how recently each live session last reported.
2. Every waiting-on-you item, by identifier and age — one line each, no prose.
3. What moved since last time, as a count.
4. The clock.

**Then the body, in this order:**

1. **The big thread** — the one piece of work most of the fleet is actually about, and what it is
   waiting on.
2. **What moved, in detail** — what landed, what merged, what changed state, with identifiers.
3. **The lanes and their tails** — each lane, what it is on now, and what is left in it. Name a tail
   that looks at risk.
4. **Waiting on you, in full** — for each parked decision: what the prompt says versus what the
   ticket and the review say, the options offered, your recommendation, and the caveat on it. This
   is the section the human actually came for; do not compress it.

   **Say what each one is holding up.** A decision that blocks nothing and one that blocks the top
   of the stack look identical in a queue and are not remotely the same ask. Where you can see the
   blocking / critical-path signals for the task a decision sits on, carry them in — "answering this
   unblocks three others", "nothing is waiting behind this one" — so the human can order their
   attention by consequence rather than by age.
5. **Noise, named** — the rows that are not work. "37 wake rows are re-wakes, not work." Any older
   rows that were folded away rather than listed belong here too, with their threshold.
6. **The monitoring promise** — what you will keep an eye on, and when you will next check.

Do **not** close by asking what they would like to look at. If they want something they will say so;
a closing question is filler that costs them a turn.`;

/**
 * Check-in policy. LIN-2443 AC1: a silent tick must not produce a bubble.
 */
export const COMPANION_SURFACING = `## When to speak, and when to stay quiet

On a check-in that nobody asked for, speak **only** for one of three things: a new decision that
needs the human, a stall, or a landing. Never restate counts as news — an unchanged picture is not an
event.

If none of those happened, **say nothing at all.** Not "nothing to report", not a restated summary —
nothing. Speak an all-clear only at boot, or when you are asked.`;

/**
 * The propose-then-wait rule. Prompt-only on both surfaces, and named as such
 * rather than implied — the kickoff's session holds a readWrite token, and the
 * chat's `send_follow_up` can be built in propose mode, but neither is enforced
 * by the platform on the model's side.
 */
export const COMPANION_GATE = `## The one hard rule: propose, then wait for the go

You can technically start work on your own. **Don't.** Whenever you spot a next move worth making —
kicking off a task, dispatching a step, sending a follow-up — **propose it in plain language and wait
for the human to say go.** Lay out what you would do and why in a sentence or two, then stop.

- Reading, orienting and monitoring need **no** approval. That is your whole job; do it freely.
- Anything that **changes state** needs an explicit **yes** from the human first.

This gate is **prompt-only** — a convention of this brief, not something the platform enforces on your
side — so it is on you to honour it. If the human tells you to go ahead on something, that is their call to relax it.`;

/**
 * The sections every rendering carries, in order. Exported as one array so a
 * renderer cannot quietly drop one and so a test can assert both outputs carry
 * all of them.
 * @type {Array<string>}
 */
export const COMPANION_BRIEF_SECTIONS = [
  COMPANION_DISPOSITION,
  COMPANION_READOUT,
  COMPANION_FOSSIL_READOUT,
  COMPANION_SURFACING,
  COMPANION_VOCABULARY,
  COMPANION_GATE,
];

/**
 * Render the fossil-row line the census seed puts in front of the model, in the
 * ONE shape `COMPANION_FOSSIL_READOUT` above teaches — so the instruction both
 * surfaces carry and the line the chat actually renders cannot drift apart.
 *
 * `null` when there is nothing to say: the sweep has not written the field (a
 * census from before LIN-2619), or nothing was folded. A zero rendered as
 * "+0 rows older than 7d" is noise that trains the model to ignore the line.
 *
 * @param {number} count - `state.staleAttentionCount`
 * @param {number} thresholdMs - `state.staleAttentionThresholdMs`
 * @returns {string|null}
 */
export function renderStaleAttentionLine(count, thresholdMs) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return `  +${count} silent / blocked rows older than ${formatFossilThreshold(thresholdMs)}, not listed` +
    ' (folded by the census, NOT in the attention rows above — a short attention list can mean a calm' +
    ' fleet or a fossilised one, and this is which)';
}

/**
 * The staleness threshold in the compact form the readout instruction uses.
 * Days when it divides evenly (the production case — `FOSSIL_AGE_MS` is 7d),
 * else hours, else a bounded fallback so a malformed value never renders
 * "older than undefined" inside a block the prompt calls ground truth.
 *
 * @param {number} thresholdMs
 * @returns {string}
 */
export function formatFossilThreshold(thresholdMs) {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return 'the staleness threshold';
  const hours = thresholdMs / 3600000;
  if (hours >= 24 && Number.isInteger(hours / 24)) return `${hours / 24}d`;
  if (Number.isInteger(hours)) return `${hours}h`;
  // FLOOR, never round, and the direction is the point: this renders a claim
  // that rows are older than X, so rounding 100 minutes up to "2h" asserts an
  // age the data does not support. Below an hour, hours would read "older than
  // 0h" — vacuous inside a block the prompt calls ground truth — so it falls to
  // minutes, floored to at least 1 for the same reason.
  if (hours < 1) return `${Math.max(1, Math.floor(thresholdMs / 60000))}m`;
  return `${Math.floor(hours)}h`;
}

// ─── Rendering 1 of 2: the in-page chat's system turn ────────────────────────

/**
 * Format the turn's clock for the system prompt.
 *
 * ISO plus a readable local hint, because both are needed for different jobs:
 * the model does date arithmetic against the ISO stamp ("parked since 01:35" is
 * only sayable if it can subtract), and the human reads the local form back in
 * the answer. Without any clock at all the model cannot age anything it is
 * shown — every `since` in the census seed is an absolute instant.
 *
 * @param {Date|number|string} now
 * @returns {string}
 */
export function formatCompanionClock(now) {
  // `new Date(null)` is the EPOCH, not an Invalid Date, so a null clock would
  // otherwise render a confident 1970 stamp and have the model age every
  // `since` it is shown by ~56 years — reporting the whole fleet as fossilised.
  // The `= Date.now()` default only covers `undefined`.
  // Two doorways to the same wrong answer, both narrower than "is it a Date":
  // `0` is a legal epoch-ms number that renders 1970, and the STRING '0' is
  // parsed by V8 as the year 2000. Either would have the model age every
  // `since` it is shown against a confidently wrong stamp — the exact failure
  // this guard exists to prevent — so the bar is a plausible instant, not a
  // parseable one. `= Date.now()` covers only `undefined`, never `null`.
  // 2020 rather than 1970: `'0'` parses to exactly 2000-01-01, so a year-2000
  // floor lets that one straight through. Any real clock for this app is well
  // past 2020, and every accidental-parse artifact worth catching (0, '0',
  // negatives, a bare year) lands below it.
  const EARLIEST_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);
  const date = now instanceof Date ? now
    : typeof now === 'number' || typeof now === 'string' ? new Date(now)
    : new Date(NaN);
  const ms = date.getTime();
  if (!Number.isFinite(ms) || ms < EARLIEST_PLAUSIBLE_MS) {
    return 'CURRENT TIME: unknown (no clock available this turn).';
  }
  let local;
  try {
    local = date.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    // A runtime without full ICU still gets the ISO half rather than nothing.
    local = null;
  }
  return `CURRENT TIME: ${date.toISOString()}${local ? ` (${local} UK)` : ''}. ` +
    'Every timestamp you are shown is an absolute instant — age them against this, and say ages in ' +
    'plain language ("parked since 01:35, about six hours").';
}

/**
 * Say, in words, what kind of turn this is.
 *
 * The model behaves differently on the two and cannot tell them apart from the
 * message alone — an auto-wake turn's stand-in user text reads exactly like a
 * real question. Getting this wrong is what produces a chatty bubble on a
 * silent tick, which LIN-2443 AC1 forbids.
 *
 * @param {'user-initiated'|'auto-wake'|string} turnKind
 * @returns {string}
 */
export function describeTurnKind(turnKind) {
  return turnKind === 'user-initiated'
    ? 'THIS TURN: the human just asked you something. Answer it.'
    : 'THIS TURN: a check-in tick — nobody typed anything. Apply the speak-only-for-a-reason rule ' +
      'below: if there is no new decision, no stall and no landing, say nothing at all.';
}

/**
 * Build the in-page chat's messages: one system turn assembled from the shared
 * sections plus this surface's own parts, then the replayed history, then the
 * new turn.
 *
 * Moved here from `routes/flight-companion.js` (LIN-2618 item 1), which is what
 * retires that file's "no premature lib/prompts/ extraction" header note — this
 * ticket supersedes it deliberately, because a second surface now needs the
 * same text and the note's own condition has therefore been met.
 *
 * `censusSeedText` arrives ALREADY RENDERED rather than being built here. That
 * keeps this module free of any `routes/` import, and it makes the
 * "seed embedded unmodified" guarantee structural: the string is inserted, never
 * reformatted, so there is no code path on which it could be summarised.
 *
 * An auto-wake turn carries no human text, but the model still needs a
 * turn-shaped final message to react to, so a fixed neutral prompt stands in.
 *
 * @param {Object} p
 * @param {Array<Object>} p.history - replayed prior turns
 * @param {string} [p.message] - the human's new message; absent on an auto-wake tick
 * @param {string} p.censusSeedText - `buildCensusSeedText`'s output, inserted verbatim
 * @param {Date|number|string} [p.now] - injected clock
 * @param {'user-initiated'|'auto-wake'} [p.turnKind]
 * @param {string|null} [p.playbook] - LIN-2625's slot; omitted entirely when absent
 * @returns {Array<Object>}
 */
export function buildFlightCompanionMessages({
  history, message, censusSeedText, now = Date.now(), turnKind = 'auto-wake', playbook = null,
} = {}) {
  // A parameter default covers `undefined` only — the same trap the clock guard
  // above calls out. `{history: null}` is what a caller threading `body.history`
  // straight through produces (LIN-2622's boot endpoint is the next one).
  const turns = Array.isArray(history) ? history : [];
  const parts = [
    `# You're the Flight Companion for this workspace\n\n${COMPANION_PERSONA}`,
    formatCompanionClock(now),
    describeTurnKind(turnKind),
    censusSeedText,
    ...COMPANION_BRIEF_SECTIONS,
    // Chat-only concretisations of two shared rules. They live HERE, not in the
    // shared sections, because they name things only this surface has: a census
    // with lanes, and a status line. Telling a pasted Claude Code session that
    // "the status line already carries it" would be asserting a false fact about
    // its own environment as the reason to stay silent.
    `## What that means on this page

- The counts above are the **census**, and its lanes count runs. \`silent\` and \`terminal\` both
  include historical bookkeeping, so a large \`terminal\` is mostly history.
- On a silent check-in tick you genuinely emit nothing: the page's own status line already says
  \`checked in 08:05 · no decisions need you\`, so a bubble repeating it is one more thing to scroll
  past. At boot, or when asked, speak the all-clear normally.
- Do not close with "what would you like to look at?" — the composer below is the invitation.`,
    `## Your tools

You have real tool-calling here — use it when you want more depth than the census above gives you.

- For "what is in flight?" or "what is stalled?", call \`list_active_sessions\`. It returns one row
  per session with real session ids and task identifiers, not counts, and a \`noise\` block naming
  what it folded away.
- For "what needs me?", call \`list_active_sessions\` with lane \`waiting\`, or
  \`list_pending_decisions\` for the questions themselves.
- Then drill into one session with \`get_session\`, and reach for \`get_stack\`,
  \`list_task_sessions\` and the rest of the read catalog as needed.

You may call \`send_follow_up\` to reason about or request a follow-up on a session, but its write
may not always execute immediately — respect whatever the tool itself reports back.`,
  ];
  // LIN-2625's slot. Omitted entirely rather than rendered as an empty heading:
  // a "## Playbook" with nothing under it reads to the model as a section it
  // failed to receive.
  if (typeof playbook === 'string' && playbook.trim()) {
    parts.push(`## Playbook\n\n${playbook.trim()}`);
  }

  return [
    { role: 'system', content: parts.join('\n\n---\n\n') },
    ...turns,
    {
      role: 'user',
      content: message
        || '(No new message from the human this tick — check on anything that changed and only speak up if there is something worth surfacing.)',
    },
  ];
}
