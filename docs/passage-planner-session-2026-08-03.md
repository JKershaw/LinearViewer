# Passage-planning session, 2026-08-03: v0 met a human

A chronicle of the first live human-ratified run of the experimental Passage
Planner prompt (LIN-1811), in the tradition of
`collective-session-2026-06-12.md` and `flight-companion-session-2026-08-02.md`.
Every code and contract claim below was re-verified against this repository
at the time of writing (`git log --since=2026-08-03T07:22:03Z` shows exactly
two commits on `main`: `cfaee25c`, which landed the v0 prompt text this
session ran, and a later, unrelated KPI-windowing fix that touches none of
the files this chronicle cites — the v0 text is unchanged since `cfaee25c`).
All timestamps are UTC. **No transcript of either planning session was
retained** — both were hand-run `claude` CLI sessions (a proxy-page bootstrap
token plus the pasted prompt doc), which is why neither appears in the
dispatch history. This chronicle rests on the flight companion's
contemporaneous session notes plus the durable Linear/GitHub artifacts both
sessions left behind; every sentence below traces to one or the other, named
as it goes.

## Cast

- **John** — the human. Ran both sessions, ratified the passage, chose not to
  exercise the challenge loop.
- **Planning session #1** — a `claude` CLI session running prompt v0
  (`docs/passage-planner-prompt.md` at `cfaee25c`).
- **Planning session #2** — a `claude` CLI session running the unmerged v0.1
  draft (the text attached to LIN-1850's first comment; not yet in this
  repository — see "What this session changed").
- **The flight companion** — observer, feedback scribe, and the source of
  every session-interior detail in this chronicle. Supervised from outside
  both sessions; John pasted key artifacts into their shared channel as the
  sessions ran.

## Boot

Prompt v0 landed at 08:23:42Z as PR #1063 (`cfaee25c`), closing out LIN-1841.
John began session #1 shortly after, per the LIN-1842 recipe: mint a
bootstrap token from the proxy page, paste `docs/passage-planner-prompt.md`
into a fresh `claude` CLI session. Because the session was hand-run rather
than dispatched, it left no row in the dispatch feed and no transcript —
everything about its interior comes from the flight companion's
contemporaneous notes.

## Legs

Session #1's orientation reads are not independently recoverable (the
overview that would have shown them was not retained), but the same reads
resurface, quoted, in session #2's writeout and reproduce today:

- **North star** — `GET /north-star` reads `reading.state: "fresh"` and
  `roadmap.state: "fresh"` off a report generated 2026-08-02T19:44:55Z. The
  roadmap narrative contains, word for word, *"LIN-1625 is seven days stale
  and blocks seven tasks—the longest listed chain"* and flags Product
  capability work as drift against "finish transitions before starting
  capabilities."
- **Periodicals** — `GET /periodicals` returns 15 templates: 4 `due`
  (Documentation Review, 23 days since last run; Code Quality Review, 23
  days; Drift & Coherence Review, 22 days; Recent Headwinds, 24 days), 1
  `recent` (Design & Interface Review, 5 days), and 10 `never`. Per
  `routes/proxy.js:1525-1543`, `never` means no run recorded inside
  `min(30-day horizon, retention)` — a bounded claim, not "has never run."
- **Stack digest** — `GET /stack?limit=15&view=digest` returns each task's
  `why[]` reasons verbatim. LIN-1625 carries `["unblocks 6", "critical path
  3"]`; LIN-1666 carries `["unblocks 1", "critical path 2"]`; LIN-1557 and
  LIN-1558 carry `[]` (the digest gave no ranking reason for either); the
  seven stack-digest anchors that became Leg 2 (LIN-1694, LIN-1731, LIN-1594,
  LIN-1821, LIN-1458, LIN-1848, LIN-1389) all carry `["bug"]`. A live re-read
  today reproduces every one of these values, though it also surfaces two
  tasks (LIN-1503, LIN-1455) that were never anchors — the digest is a live
  ranked read, not a replayable snapshot, so this corroborates the quoted
  values without reproducing the session's exact membership.

## Dialogue

Session #1 surfaced seven human-interface defects, distilled and posted as
comment `4f3d5cce` on LIN-1842 at 09:19:22Z:

1. **Serial ratification produced rubber-stamping.** One-leg-at-a-time
   approval (`docs/passage-planner-prompt.md:94`, "Human dialogue and
   ratification, one leg at a time") gave John no whole-plan context; per the
   flight companion's notes he was click-approving without reading
   ("honestly I'm just clicking approve without reading").
2. **Contract-formal tone throughout**, with no register guidance in the doc.
3. **A timid, unexplained 4-task budget default**, with no sizing
   conversation in the prompt.
4. **No synthesis-first proposal** — the full total → legs → path view only
   appeared when John explicitly asked for it.
5. **Orientation invisible to the human** — the north-star/periodical/digest
   reads happened but were never shown before John was asked to ratify.
6. **A false ratification record** — the session's overview claimed "All
   four legs are ratified" off the hollow per-leg clicks, with no way to
   distinguish a genuine yes from a fatigued one.
7. **Machine-legible, human-illegible output** —
   `docs/passage-planner-prompt.md:237` ("Write every leg so it survives
   runner handoff") engineers every leg to survive brief-distillation but
   says nothing about human legibility. Per the flight companion's notes,
   John read session #1's 30-task overview attentively and concluded the
   periodicals leg was missing; it was present as Leg 4 — the wall of text
   simply didn't show it.

John's decision, per the flight companion's notes: iterate the prompt text
directly rather than route a fix through the normal pipeline. The companion
drafted a v0.1 revision addressing all seven findings while preserving every
v0 hard invariant (task-counts-only budgets, the reserved maintenance leg
drawn from the shared pool, `related`-type anchors with an inline mapping,
description/append discipline, the write gates, witness-before-runner). That
draft is attached as the first comment (`44f45b69`) on LIN-1850, filed
09:34:02Z.

Session #2 ran the v0.1 draft. Per the flight companion's notes: orientation
was shown before ratification, sizing was negotiated (the session proposed a
20–30 range and 26 was set at the midpoint), the full four-leg passage was
proposed at once as a table plus per-leg detail, and evidence gaps were
stated honestly in the proposal itself — including that the stack digest
counted six downstream unblocks for LIN-1625 without naming them, and that
the ten `never`-state periodicals were deliberately excluded from Leg 4 with
that reasoning given. John's assessment, per the notes: "much stronger."

**The 20–30 range's origin is contradictorily attributed.** The flight
companion's notes record the session proposing the range with John setting
26 at the midpoint; LIN-1851's own voyage-log comment instead states "John's
chosen range was 20–30." Both cannot be the source, and nothing in this
session resolves which — the disagreement is recorded here rather than
picked.

John ratified the whole proposal in one motion — a single yes to the full
4-leg proposal as presented, with no partial per-leg approvals, per LIN-1851's
voyage-log comment (`dc7660d5`, 09:37:51Z). Per the flight companion's notes,
this was an explicit choice: John was validating the planning experience,
not flying a passage, and said he lacked run-budget for the passage that
day — so the v0.1 draft's step 4 challenge/negotiate loop was never
exercised. The central fix session #1 lacked is therefore validated only in
its propose-and-ratify half; whether a real challenge round works as
intended is untested by this session.

## Writeout

LIN-1851 ("Passage — Cost chain, reliability bugs, Product close-out,
maintenance (26 tasks)") was created 09:37:16Z: 4 legs plus 3 tasks of
unallocated slack, budgets of 7 + 8 + 4 + 4 (summing to 26, matching the
stated pool). A live check of `GET /relations/LIN-1851` today confirms
exactly 12 `related`-type relations, no `blocks`/`blocked-by` anchors,
matching the description's inline leg↔anchor mapping exactly: Leg 1 →
LIN-1625 (1); Leg 2 → LIN-1694, LIN-1731, LIN-1594, LIN-1821, LIN-1458,
LIN-1848, LIN-1389, LIN-1815 (8; the eighth, LIN-1815, was named by the
north-star reading rather than the stack digest); Leg 3 → LIN-1666,
LIN-1557, LIN-1558 (3). A voyage-log comment (`dc7660d5`) opened at
09:37:51Z, recording the ratification and the planning-time evidence above.
Append-discipline for future edits ("post-creation edits to this description
go through description/append or description/replace, never whole-body
PATCH") is recorded in-description.

The writeout deviates from the strict block prescribed at
`docs/passage-planner-prompt.md:253` (`### Leg: <name>` with `**Anchors:**` /
`**Intent:**` / `**Budget:**` / `**Making port:**` / `**Wind down if:**`
lines): LIN-1851's description instead uses `## Leg N — <name>` headings with
bolded bullets. This is left uncorrected deliberately — LIN-1844, the
cold-read witness, is the task that measures the format actually written,
not this chronicle.

## Gate

`docs/passage-planner-prompt.md:265` (section 9, "The acceptance bar") makes
the ordering load-bearing: chronicle, then a cold-read witness (a fresh
context-free session reading only `GET /brief/LIN-1851` and stating each leg
back), and only then may any runner be dispatched against a ratified leg. A
live check of `GET /dispatch?issueIdentifier=LIN-1851` and
`GET /dispatch?issueIdentifier=LIN-1812` today both return zero items — no
runner dispatch exists against the passage task or its gated build-order
sibling across the whole window since LIN-1851 was created, and LIN-1812
itself remains `Backlog`. The gate has held for the entirety of LIN-1851's
life to date. This chronicle is the first of the two required steps; LIN-1844
(cold-read witness) is next, and LIN-1845 links the resulting evidence back
to LIN-1811.

## What this session changed

The v0.1 revision is in flight as **PR #1065** (commit `7bffcbe`,
`lin-1850-passage-planner-v0-1`), tracked as LIN-1850, currently **open and
unmerged** — the repository's prompt at HEAD is still v0
(`docs/passage-planner-prompt.md` unchanged since `cfaee25c`). Every
statement above about v0.1's content describes the unmerged draft, not the
prompt this repository currently ships. LIN-1849 (a one-click kickoff page
for the planner, mirroring the Flight Companion pattern) is filed and
sequenced to land after LIN-1850, so it serves the revised text rather than
v0. The session's overall finding: the planner's evidence and writeout
machinery worked as designed on the first real run: correct anchors, correct
budgets, correct quoted evidence, an honored write gate. What failed was
entirely in the human-interface layer — ratification mechanics, tone,
sizing, and legibility — and that is the layer v0.1 targets.

## Gaps and open threads

- **No transcript was retained**, for either session, though LIN-1842's own
  acceptance criteria called for one. This chronicle rests on the flight
  companion's contemporaneous notes plus the durable artifacts cited above,
  not a replayable record.
- **LIN-1842's tracker state lags reality**: it remains `Todo` despite having
  run and produced LIN-1851, and its `blocks` relation to this ticket is
  still open.
- **The 20–30 range's origin is contradictorily attributed** between the
  flight companion's notes (the session proposed it) and LIN-1851's voyage
  log ("John's chosen range") — see "Dialogue" above; this chronicle does not
  resolve it.
- **Session boundaries are inferred, not recorded.** No start/end timestamp
  exists for either session. The defensible bounds: session #1 ran between
  08:23:42Z (v0 merged) and 09:19:22Z (findings posted); session #2 ran
  between 09:19:22Z and 09:37:16Z (LIN-1851 created).
- **Session #1's own output is unrecoverable.** Its 30-task overview, its
  four proposed legs, and its false "all four legs are ratified" claim
  survive only as the seven distilled findings in comment `4f3d5cce`; the
  overview artifact itself was not retained.
- **The ratification was honest but narrow.** One genuine yes to a full
  proposal John had actually read — but the v0.1 draft's challenge/negotiate
  loop was never exercised, so that half of the central fix remains
  unvalidated by this session.
- **Ten of fifteen periodicals read `never`** at planning time, which is a
  bounded claim (no run inside the retained 30-day window), not evidence
  that they have never run at all; LIN-1851's own Notes section states this
  correctly and this chronicle mirrors that phrasing rather than the
  stronger, incorrect one.
- **The writeout format deviated** from the strict `### Leg:` block (see
  "Writeout" above) — recorded here as a fact for LIN-1844 to measure, not
  smoothed into "close enough."
