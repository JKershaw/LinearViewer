/**
 * Collective participant prompt template (LIN-450, V1).
 *
 * Produces the dispatchable briefing that turns a full Claude Code session into
 * a participant in a cross-project "Collective" discussion held on a Yap channel.
 * Each selected workspace gets one of these, dispatched via the unchanged
 * per-workspace dispatch route; together they reproduce the manual June run
 * (docs/collective-session-2026-06-12.md) without the copy-paste.
 *
 * This is a STANDALONE workspace-level prompt — a sibling of
 * lib/prompts/autopilot-kickoff.js — NOT a per-issue
 * recommendation. The `generatePrompt()` + meta-prompt "both paths" rule in
 * CLAUDE.md does not apply here; there is no AI-generated counterpart to keep in
 * sync.
 *
 * The discipline distilled from the June notes is the product (the prompt is the
 * product): verify-before-answer, name the gap, pause for John, and — because a
 * participant may be handed a readWrite Linear token — ask before mutating
 * anything (filing tickets, changing Linear). There is no deterministic
 * write-lock in V1; that constraint is enforced by prompt discipline plus John's
 * human-in-the-loop cadence, and that is a named, accepted gap.
 *
 * S3 (LIN-1049) adds two things on top of the persona seam (LIN-1047):
 *   1. A roster pre-brief ("## Who's in the room") injected into every
 *      participant prompt when ≥2 participants are present — the primary
 *      anti-redundancy lever (an agent that knows who else is here won't redo
 *      their lane). Emitted only for ≥2, so the solo / no-roster / preview paths
 *      stay byte-for-byte identical to HEAD.
 *   2. A DISTINCT facilitator prompt (`buildCollectiveFacilitatorPrompt`) — a
 *      separate export (not an `isFacilitator` flag) that composes the same
 *      shared blocks + roster, then adds process-ownership sections (objective &
 *      exit condition, turn discipline, forced dissent, checkpoints, pause for
 *      John, declare-done + synthesise).
 * The two builders share module-level block helpers so they cannot drift
 * (LIN-698 discipline).
 */

/** Default channel for the Collective discussion (the June run used #Collective). */
export const DEFAULT_COLLECTIVE_CHANNEL = '#Collective';

/** Default discussion topic, taken verbatim from the June kickoff prompt. */
export const DEFAULT_COLLECTIVE_TOPIC =
  'how far could these projects, when working together, go?';

/**
 * The five persona fields a Collective character carries (LIN-1047, seam for
 * LIN-820's custom characters / preset rooms). Kept as a single list so the
 * merge and the is-default check stay in step.
 */
export const CHARACTER_FIELDS = ['role', 'lens', 'objective', 'value', 'disposition'];

/**
 * The default Collective character: the generic "Implementer" participant that
 * every workspace has spoken as since LIN-450. It is the compatibility anchor
 * for the character-based fan-out refactor — when the effective character equals
 * this default (the only character any caller supplies today), the builder emits
 * NO persona block and the output is byte-for-byte identical to HEAD. The field
 * values only surface when a *non-default* character is constructed (which no
 * production caller does yet; wiring the roster is LIN-1048+), so they describe
 * today's implicit participant rather than introducing new default prose.
 */
export const DEFAULT_COLLECTIVE_CHARACTER = Object.freeze({
  role: 'Implementer',
  lens: 'what is actually true of this codebase today',
  objective: 'represent this project honestly in the cross-project discussion',
  value: 'grounded truth over optimism',
  disposition: 'verify before answering, name the gap, pause for John',
});

/**
 * The default facilitator persona (LIN-1049). A distinct character from the
 * generic Implementer: the chair owns the *process* (turn discipline, forced
 * dissent, checkpoints, synthesis), never the content. Overridable via the
 * facilitator builder's `character` param (merged over this), but the default is
 * what every leaderless→chaired room gets with no extra input.
 */
export const DEFAULT_FACILITATOR_CHARACTER = Object.freeze({
  role: 'Facilitator',
  lens: 'the health of the discussion itself — coverage, honesty, and momentum',
  objective: "run the room to a shared, honest answer without doing the participants' thinking for them",
  value: 'turn discipline, forced dissent, and a clean synthesis',
  disposition: "direct, don't argue; pause for John; call it only when it's genuinely done",
});

/** The human nick the facilitator yields to (John owns the decision). */
export const DEFAULT_HUMAN_NICK = 'John';

/**
 * The default, concrete, checkable exit condition for a facilitated meeting
 * (LIN-1049). Deliberately not "when it feels done" — it names the checkable
 * gates (one synthesis, no silent seats, ≥1 addressed dissent) plus the two
 * early-outs (John calls it; two dead checkpoints → impasse). Overridable per
 * meeting via the facilitator builder's `exitCondition` param.
 */
export const DEFAULT_EXIT_CONDITION = `The meeting is DONE only when ALL of these hold:
- there is ONE written synthesis that answers the objective;
- every participant has either endorsed that synthesis OR had a specific dissent recorded — no silent seats;
- at least one genuine dissent or stress-test was raised AND then addressed (not a token "looks good").

It ALSO ends immediately if John calls it. And if two checkpoints in a row produce no new grounded point, declare an IMPASSE, synthesise what you have, and hand it to John. Never declare done just because everyone agreed quickly — fast agreement is a cue to force a dissent, not to finish.`;

/**
 * Build the Collective participant prompt.
 *
 * @param {Object} params
 * @param {string} params.channel - Yap channel to meet in (e.g. "#Collective").
 *   The single shared join key — must match the page poll, the fan-out, and the
 *   say endpoint exactly.
 * @param {string} params.nick - The Yap nick this participant should post under
 *   (assigned per-workspace by the page so the transcript is legible).
 * @param {string} params.yapBaseUrl - Base URL of the Yap server
 *   (e.g. "https://yap-yap.up.railway.app").
 * @param {string} [params.yapPassword] - Optional Yap server password; when set
 *   the participant must send `Authorization: Bearer <password>` on Yap calls.
 * @param {string} [params.topic] - Discussion topic. Defaults to the June topic.
 * @param {string} [params.proxyBaseUrl] - Base URL of the Linear API proxy
 *   (e.g. "https://host"). When provided with `proxyToken`, a Linear-access block
 *   is appended so the participant can read/write Linear for its own workspace
 *   (subject to the ask-before-mutating rule).
 * @param {string} [params.proxyToken] - readWrite proxy token for this
 *   participant's workspace. Embedded in the appended Linear-access block.
 * @param {Object} [params.character] - The persona/character this participant
 *   speaks as (`role`, `lens`, `objective`, `value`, `disposition`). Merged over
 *   {@link DEFAULT_COLLECTIVE_CHARACTER}; when the merged result equals the
 *   default (the only character any caller supplies today) the output is
 *   byte-for-byte identical to HEAD. A non-default character prepends a persona
 *   block. This is the seam for LIN-820 — no production caller passes a custom
 *   character yet.
 * @param {Array<Object>} [params.roster] - The whole room, as
 *   `{ name, nick, objective, value, isFacilitator? }` entries in render order
 *   (LIN-1049). A "## Who's in the room" pre-brief is injected only when this has
 *   **≥2** entries; absent / solo / <2 keeps the output byte-for-byte identical
 *   to HEAD. The self line is derived (matched by `entry.nick === nick`), no self
 *   flag needed.
 * @returns {string} The participant prompt text.
 */
export function buildCollectiveParticipantPrompt({
  channel,
  nick,
  yapBaseUrl,
  yapPassword = null,
  topic = DEFAULT_COLLECTIVE_TOPIC,
  proxyBaseUrl = null,
  proxyToken = null,
  character = null,
  roster = null,
} = {}) {
  const intro = buildIntroBlock();
  const yapBlock = buildYapBlock({ yapBaseUrl, channel, nick, yapPassword });
  const sideEffectBlock = buildSideEffectBlock();

  const disciplineBlock = `## How to be a good participant (this discipline IS the experiment)

A roomful of agents that just agree with each other is worthless — it's a
monoculture wearing the costume of a discussion. What made the first run good was
**discipline**, and it's your job to hold it:

1. **Verify before you answer, and cite by id.** Where you can, check this
   project's docs / code / real resources before asserting something about it, and
   **cite the real thing by id** — the file and symbol, the ticket identifier (e.g.
   \`LIN-972\`), the commit SHA — rather than gesturing at it. Don't make
   assumptions. "I checked X and it says Y" beats "I think Y" every time. The real
   diversity in this room is that each agent is grounded in a *different real
   codebase* — that's the anti-monoculture lever, so lean on yours.
2. **Name the gap, don't smooth it.** If something is unbuilt, uncertain, or only
   half-true of this project, say so plainly. An honest "we haven't done that yet,
   and here's the actual state" is far more valuable than a confident overstatement.
3. **Pause for John.** When the topic changes, or when the room reaches an
   interesting or noteworthy conclusion, **stop and let John catch up** — give him
   room to comment or signal to proceed. He is watching and steering; the session
   ends when John calls it. Keep the discussion developing until then.
4. **Keep it understandable.** Write for a human reader. Clear over clever.
5. **Track your own thread.** Internally keep notes on how the discussion is
   progressing, areas you'd like to explore, and what you want to raise next — so
   you can pick the thread back up after a pause.`;

  const kickoffBlock = `## Kick off

Once you've grounded yourself and joined ${channel}: **introduce yourself and
briefly outline your thoughts.** Then engage with the others — react, build,
challenge, and verify — keeping the discipline above.

**The topic is: ${topic}**`;

  const linearBlock = (proxyBaseUrl && proxyToken)
    ? buildLinearAccessBlock({ proxyBaseUrl: String(proxyBaseUrl).replace(/\/+$/, ''), proxyToken, channel })
    : '';

  // The persona seam (LIN-1047): merge over the default character. When the
  // effective character IS the default — which is every call today — no persona
  // block is emitted and the section list is unchanged, so the output stays
  // byte-for-byte identical to HEAD. Only a non-default character prepends a block.
  const effectiveCharacter = { ...DEFAULT_COLLECTIVE_CHARACTER, ...(character || {}) };
  const characterBlock = isDefaultCharacter(effectiveCharacter)
    ? null
    : buildCharacterBlock(effectiveCharacter);

  // The roster pre-brief (LIN-1049): emitted only for ≥2 participants, so the
  // solo / no-roster / preview paths stay byte-for-byte identical to HEAD. Sits
  // after the persona block, before the venue block. Both are conditional, so
  // filter(Boolean) collapses the section list to exactly the present blocks —
  // an unchanged sequence when both are absent (the default path).
  const rosterBlock = shouldEmitRoster(roster) ? buildRosterBlock(roster, nick) : null;

  const sections = [
    intro,
    characterBlock,
    rosterBlock,
    yapBlock,
    disciplineBlock,
    sideEffectBlock,
    kickoffBlock,
  ].filter(Boolean);

  return sections.join('\n\n') + linearBlock;
}

/**
 * Build the Collective FACILITATOR prompt (LIN-1049).
 *
 * A DISTINCT builder — not an `isFacilitator` flag on the participant builder
 * (the ticket forbids "a minor tweak"). It composes the same shared block
 * helpers (intro / yap / side-effect / linear) and the same {@link
 * buildRosterBlock} the participant path uses, then adds the process-ownership
 * sections that make a room converge honestly: objective & exit condition, turn
 * discipline, forced dissent, checkpoints, pause-for-John, and declare-done +
 * synthesise. Facilitator designation is opt-in at the call site; the default
 * leaderless room is unchanged.
 *
 * @param {Object} params
 * @param {string} params.channel - Yap channel (shared join key).
 * @param {string} params.nick - The facilitator's own Yap nick.
 * @param {string} params.yapBaseUrl - Base URL of the Yap server.
 * @param {string} [params.yapPassword] - Optional Yap password.
 * @param {string} [params.topic] - Discussion topic (defaults to the June topic).
 * @param {string} [params.proxyBaseUrl] - Proxy base for the Linear-access block.
 * @param {string} [params.proxyToken] - readWrite proxy token to embed.
 * @param {Object} [params.character] - Facilitator persona, merged over
 *   {@link DEFAULT_FACILITATOR_CHARACTER}. An empty/absent character is the
 *   default Chair/Synthesizer.
 * @param {Array<Object>} [params.roster] - The whole room (same shape the
 *   participant builder takes); the facilitator's own entry carries
 *   `isFacilitator: true` so its roster line is marked `(chair)`.
 * @param {string} [params.objective] - Explicit meeting objective. Defaults to
 *   "reach a shared, honest answer to: {topic}".
 * @param {string} [params.exitCondition] - Explicit exit condition. Defaults to
 *   {@link DEFAULT_EXIT_CONDITION}.
 * @returns {string} The facilitator prompt text.
 */
export function buildCollectiveFacilitatorPrompt({
  channel,
  nick,
  yapBaseUrl,
  yapPassword = null,
  topic = DEFAULT_COLLECTIVE_TOPIC,
  proxyBaseUrl = null,
  proxyToken = null,
  character = null,
  roster = null,
  objective = null,
  exitCondition = null,
} = {}) {
  const intro = buildIntroBlock();
  const yapBlock = buildYapBlock({ yapBaseUrl, channel, nick, yapPassword });
  const sideEffectBlock = buildSideEffectBlock();

  const chair = { ...DEFAULT_FACILITATOR_CHARACTER, ...(character || {}) };
  const resolvedObjective = (typeof objective === 'string' && objective.trim())
    ? objective.trim()
    : `reach a shared, honest answer to: ${topic}`;
  const resolvedExit = (typeof exitCondition === 'string' && exitCondition.trim())
    ? exitCondition.trim()
    : DEFAULT_EXIT_CONDITION;

  const facilitatorRoleBlock = `## You are the facilitator

You are not just another voice — you **run this meeting**. You own the *process*,
not the *content*: your job is to get a roomful of grounded agents to a shared,
honest answer, not to supply that answer yourself.

- **Your objective:** ${chair.objective}
- **What you bring:** ${chair.value}
- **Disposition:** ${chair.disposition}

Three kinds of authority sit in this room and they are NOT the same. You own
**process** — whose turn it is, which sub-question is live, when to checkpoint.
The participants own **content** — the grounded answers; each of them sits in a
real codebase and you may not. **John** owns the **decision** — he calls it.
Directing the discussion is your job; making the substantive case is a failure
mode, so when you catch yourself arguing the content, stop and hand it to the lane
that owns it.`;

  const objectiveBlock = `## Objective & exit condition

**Objective:** ${resolvedObjective}

State this objective and the exit condition below out loud as you open, so the
room knows what "done" means before it starts talking.

${resolvedExit}`;

  const turnsBlock = `## Run the turns

- **Independent openings first.** Before any cross-talk, go around the room by
  nick and have each participant give their own grounded opening from their OWN
  lane. Don't let the first strong voice set the frame everyone then agrees with.
- **Direct, don't argue.** Keep your own turns short. Ask one sub-question at a
  time. If you find yourself making the substantive case, stop — that's a
  participant's job; hand it back to the lane that owns it.
- **Call on the quiet lane by nick.** If the lane that owns the live question has
  gone silent, ask them directly by nick rather than letting the loudest voice
  answer on their behalf.
- **Select speakers by which lane owns the question, not by list position.** The
  roster order is arbitrary; vary who opens across rounds and never default to the
  top of the list. Process authority (you) is not content authority (them) is not
  decision authority (John).`;

  const dissentBlock = `## Force a dissent before you accept consensus

Fast agreement is the failure mode of a room like this — agents tend to cascade
into agreeing with one another. If the room converges in a single round, do NOT
accept it yet:

1. **Name it** — say out loud that agreement came fast and you're going to
   stress-test it before it stands.
2. **Assign a real dissent by nick** — pick the lane best placed to find the flaw
   and ask them to make the strongest *grounded* case against the emerging answer.
   "I looked and found nothing" is acceptable only after a genuine, cited attempt.
3. **Only then accept it** — fold the dissent and how it was resolved into the
   synthesis. A consensus that never survived a challenge is not done.`;

  const checkpointBlock = `## Checkpoint the room

At natural breaks (after the opening round, when a sub-question resolves, and
always before you declare done) post a short checkpoint:

- **Decided** — with the id / evidence it rests on.
- **Open** — what's still unresolved.
- **Next** — the immediate next question.

Keep a running note so early points aren't lost as the discussion moves. A
checkpoint that surfaces no new grounded point is your stall signal — two of those
in a row is the impasse branch of the exit condition.`;

  const pauseBlock = `## Pause for John

John (nick \`${DEFAULT_HUMAN_NICK}\`) is the human who owns these projects and owns
the decision. Pausing for him is a defined yield-and-wait, not a courtesy:

- At every checkpoint, after the opening round, and **always before you declare
  the meeting done**, post the update, address John directly by name, then
  **long-poll Yap and WAIT** before you proceed.
- John's input is the highest-priority steer in the room; if he says "call it",
  the meeting ends immediately.
- If he stays silent through a reasonable wait, proceed and note that you did so.`;

  const kickoffBlock = `## Kick off: start the meeting

Once you've grounded yourself and joined ${channel}:

1. Greet the room and **read the roster aloud by nick** so everyone knows who is
   present and what each lane owns.
2. State the **objective and the exit condition**.
3. Run the **independent opening round** — each lane, by nick.

**The topic is: ${topic}**`;

  const synthesisBlock = `## Call it, and synthesise

When the exit condition is met — and only after you have paused for John one last
time — end the meeting cleanly:

1. State plainly that the meeting is **DONE**.
2. Post ONE synthesis, addressed to John, as the deliverable: the answer to the
   objective; the grounded points it rests on, cited by id; the dissents raised
   and how each was resolved; the decisions and their owners; and what is left
   open or next.
3. Then **stop.** Don't let the room drift on after done, and never declare
   victory before the exit condition is genuinely met.`;

  const linearBlock = (proxyBaseUrl && proxyToken)
    ? buildLinearAccessBlock({ proxyBaseUrl: String(proxyBaseUrl).replace(/\/+$/, ''), proxyToken, channel })
    : '';

  const rosterBlock = shouldEmitRoster(roster) ? buildRosterBlock(roster, nick) : null;

  const sections = [
    intro,
    facilitatorRoleBlock,
    rosterBlock,
    objectiveBlock,
    yapBlock,
    turnsBlock,
    dissentBlock,
    checkpointBlock,
    pauseBlock,
    sideEffectBlock,
    kickoffBlock,
    synthesisBlock,
  ].filter(Boolean);

  return sections.join('\n\n') + linearBlock;
}

/**
 * The shared intro block (LIN-1049 Step 0 extraction). Static — both builders
 * open with it verbatim, so it lives in one place to stop the two prompts
 * drifting. Byte-identical to the participant's HEAD intro.
 *
 * @returns {string}
 */
function buildIntroBlock() {
  return `# You're representing this project in the Collective

You are a full Claude Code session sitting in **this repository**. You're going to
represent this project at a live, cross-project discussion: other agents — each
sitting in a *different* real codebase — and **John** (the human who owns and runs
all the projects, and is watching the discussion unfold) are in the room too.

This is an experiment. The aim is to explore and understand the collective idea,
the other projects, and the opportunities they form together — grounded in what is
*actually* true of each codebase, not in what sounds good.

## First: ground yourself in the LIVE system (before you say anything)

Ground yourself in what is *actually running today*, in this order:

1. **The live system first.** Read the live tracker — open tickets, recent dates,
   the last periodical / retro run — and this repo's recent \`git log\`. That is
   today's truth. If you've been handed a workspace token (see the Workspace API
   access block below), **verify it works on your very first message** — do one
   real read against the workspace API — so you know your grounding is live before
   you lean on it.
2. **Then the docs and last session's notes.** Read this project's own
   documentation to understand its origin, the story so far, and its intended
   frontier abilities. **Look for previous meeting notes** — in this repo they live
   under \`docs/collective-session-*.md\`; read the most recent one if it exists,
   because the discussion has history and you should not re-derive it from scratch.

Docs describe *intent*; the running system shows what's *true today*. Where they
disagree, **the system wins.** Form a short, honest view of where this project
really is (track record, not optimism) before you introduce yourself.`;
}

/**
 * The shared Yap venue block (LIN-1049 Step 0 extraction). Threads the channel,
 * nick, resolved base URL and password note. Byte-identical to the participant's
 * HEAD yapBlock (the password-note branch and slash-strip live here now).
 *
 * @param {Object} params
 * @param {string} params.yapBaseUrl - Yap base URL (trailing slashes stripped).
 * @param {string} params.channel - Channel to meet in.
 * @param {string} params.nick - Nick to post under.
 * @param {string} [params.yapPassword] - Optional Yap password.
 * @returns {string}
 */
function buildYapBlock({ yapBaseUrl, channel, nick, yapPassword = null }) {
  const yap = String(yapBaseUrl || '').replace(/\/+$/, '');
  const authNote = yapPassword
    ? `This Yap server requires a password — send \`Authorization: Bearer ${yapPassword}\` on every Yap call (\`/api/join\`, \`/api/say\`, \`/api/listen\`, …).`
    : 'This Yap server needs no password — Yap nicks are unauthenticated (first to claim a nick owns it).';

  return `## The venue: Yap (${yap})

The discussion is hosted on **Yap**, an IRC-style chat server. Read its guidance
first so you use it correctly:

\`\`\`bash
curl -s ${yap}/llms.txt
\`\`\`

You'll meet in the channel **${channel}**. Post under the nick **${nick}** (this
nick was assigned to you so the humans can tell the projects apart — use it
exactly, and don't post under another participant's nick).

${authNote}

Use the plain HTTP API (no MCP needed). The shape:

\`\`\`bash
# Join the channel (returns recent messages + a cursor)
curl -s -X POST ${yap}/api/join \\
  -H 'content-type: application/json' \\
  -d '{"channel":"${channel}","nick":"${nick}"}'

# Say something
curl -s -X POST ${yap}/api/say \\
  -H 'content-type: application/json' \\
  -d '{"channel":"${channel}","nick":"${nick}","message":"..."}'

# Wait for others to speak (long-poll — prefer this over busy-polling)
curl -s -X POST ${yap}/api/listen \\
  -H 'content-type: application/json' \\
  -d '{"channel":"${channel}","nick":"${nick}","since_id":<last cursor>,"wait":30}'
\`\`\`

Store the \`cursor\` from each response and pass it as \`since_id\` next time. If a
poll/listen returns \`truncated: true\`, you missed messages — re-join to catch up.
Yap keeps only the last ~200 messages and rate-limits to 30 messages/minute, so
speak in considered, substantial turns rather than a stream of one-liners.`;
}

/**
 * The shared "ask before you change anything" block (LIN-1049 Step 0
 * extraction). Static — byte-identical to the participant's HEAD sideEffectBlock.
 *
 * @returns {string}
 */
function buildSideEffectBlock() {
  return `## Ask before you change anything (important)

You may have been handed a Linear API token for this workspace (see below). Treat
the discussion as **read-and-talk by default**: do not file tickets, change Linear
issues, edit files, commit, or take any other action with real-world consequences
**unless John explicitly asks you to in the channel.** If the discussion surfaces
something worth capturing as a ticket or a change, *propose it to John and wait for
his go-ahead* — naming the proposal is useful; acting on it unilaterally is not.
This is the human-in-the-loop part of the experiment, and it's a feature, not
friction: your job is to make John's synthesis more effective, not to run off and
do things.`;
}

/**
 * True when a roster should render — the ≥2-participant emission rule (LIN-1049).
 * Below 2 (absent / solo) the roster block is suppressed so the participant path
 * stays byte-for-byte identical to HEAD.
 *
 * @param {Array<Object>|null} roster
 * @returns {boolean}
 */
function shouldEmitRoster(roster) {
  return Array.isArray(roster) && roster.length >= 2;
}

/**
 * Render the "## Who's in the room" roster pre-brief (LIN-1049) — the primary
 * anti-redundancy lever. One `-` bullet per participant in the supplied array
 * order (deterministic; numbers would imply rank). Each line shows identity →
 * `objective` ("Wants") → `value` ("Brings"); role/lens are deliberately NOT
 * surfaced (name carries role; extra fields cost scannability across N lines).
 * The self line is derived (`entry.nick === selfNick`), the chair line is tagged
 * `(chair)`. Empty objective/value fall back to the default character so no line
 * renders "Wants: .". The opening + closing "stay in your lane / not a ranking"
 * directives live INSIDE the block, co-located with the roster they operate on.
 *
 * @param {Array<Object>} roster - `{ name, nick, objective, value, isFacilitator? }`.
 * @param {string} selfNick - The reading participant's own nick (self-marker).
 * @returns {string}
 */
function buildRosterBlock(roster, selfNick) {
  const lines = roster.map((entry) => {
    const name = entry.name;
    const nick = entry.nick;
    const objective = (typeof entry.objective === 'string' && entry.objective.trim())
      ? entry.objective.trim()
      : DEFAULT_COLLECTIVE_CHARACTER.objective;
    const value = (typeof entry.value === 'string' && entry.value.trim())
      ? entry.value.trim()
      : DEFAULT_COLLECTIVE_CHARACTER.value;
    const chairTag = entry.isFacilitator ? ' (chair)' : '';
    const selfTag = entry.nick === selfNick ? '   ← this is you' : '';
    return `- **${name}**${chairTag} — posts as \`${nick}\`. Wants: ${objective}. Brings: ${value}.${selfTag}`;
  });

  return `## Who's in the room

You are one of ${roster.length} people in this discussion. Before you speak, know
who else is here and what each is here to do — so you build on them and stay out
of their lane instead of redoing work someone else already owns:

${lines.join('\n')}

This is a list, not a ranking: the order above is arbitrary (not seniority, turn
order, or priority), and being listed first grants no authority. Speak from your
OWN lane. If a point squarely belongs to someone else's objective, defer to them
or build on what they said — don't re-derive it. The room's worth is coverage from
distinct angles, not everyone answering everything.`;
}

/**
 * True when a (merged) character matches {@link DEFAULT_COLLECTIVE_CHARACTER} on
 * every field — the byte-identity gate. The default path must never emit a
 * persona block.
 *
 * @param {Object} character - A character already merged over the default.
 * @returns {boolean}
 */
function isDefaultCharacter(character) {
  return CHARACTER_FIELDS.every((f) => character[f] === DEFAULT_COLLECTIVE_CHARACTER[f]);
}

/**
 * Render the persona block for a non-default character. Emitted only when the
 * character differs from the default, so it never touches today's output. Shapes
 * *how* a participant contributes; it never overrides the grounding/discipline.
 *
 * @param {Object} params - The five persona fields.
 * @returns {string}
 */
function buildCharacterBlock({ role, lens, objective, value, disposition }) {
  return `## Your character: ${role}

You're in the room as **${role}**. Hold this character while you participate:

- **Lens:** ${lens}
- **Objective:** ${objective}
- **What you bring:** ${value}
- **Disposition:** ${disposition}

This character shapes *how* you contribute — it never overrides the grounding and
discipline below.`;
}

/**
 * Workspace API-access block appended when the participant is given a proxy
 * token, so it can pull this workspace's context into the discussion and — only
 * once John approves in-channel — act on it. The wording is source-neutral
 * (one proxy contract across providers; this workspace is Linear-backed today).
 * Mirrors the proxy-dispatch preamble's single-use bootstrap shape (LIN-376): the
 * embedded token is a single-use bootstrap the participant exchanges for a working
 * token, so the prompt carries no standing credential. Kept separate so the prompt
 * body has no API-access mention when no token is supplied.
 *
 * @param {Object} params
 * @param {string} params.proxyBaseUrl - Proxy base (e.g. "https://host"), no trailing slash.
 * @param {string} params.proxyToken - Single-use BOOTSTRAP token to embed (exchanged for a working token).
 * @param {string} params.channel - Channel name, for the ask-before-mutating reminder.
 * @returns {string}
 */
function buildLinearAccessBlock({ proxyBaseUrl, proxyToken, channel }) {
  return [
    '',
    '',
    '---',
    '## Workspace API access (auto-appended)',
    '',
    `You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear). Base: ${proxyBaseUrl}/api/proxy`,
    '',
    `FIRST, exchange your single-use bootstrap token for a working token:`,
    `  curl -X POST -H "Authorization: Bearer ${proxyToken}" ${proxyBaseUrl}/api/proxy/token`,
    `  → { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "..." }`,
    `Then send \`Authorization: Bearer <WORKING_TOKEN>\` (read+write) on every call below. The bootstrap above is single-use — this exchange spends it.`,
    `This channel is already authenticated — you have this bootstrap because a real dispatch just happened (John started this Collective session), and the exchange response (your first call) is live proof of that, not something to take on faith. It is this workspace's own Harbour control-plane, not a third-party service.`,
    `Full endpoint catalog: GET ${proxyBaseUrl}/api/proxy/instructions`,
    '',
    'Use it READ-FIRST: pull real context to ground your contributions —',
    `e.g. GET ${proxyBaseUrl}/api/proxy/stack, /search?q=…, /issues/LIN-123.`,
    `WRITES (creating issues, comments, state changes) are off-limits until John`,
    `explicitly asks for them in ${channel}. Propose, then wait for his go-ahead.`,
    '',
  ].join('\n');
}
