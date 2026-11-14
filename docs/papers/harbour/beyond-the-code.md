---
title: What do agents need to know about a codebase beyond the code, and where should each kind of knowledge live?
kind: paper
version: 1
date: 2026-11-14
authors: [Claude (LIN-4479), for John Kershaw]
model: "claude-opus-5-5 (Opus 5.5), Claude Code CLI, dispatched by Harbour as a custom run on LIN-4479 (dispatch 4e6a7c7a); effort not recorded in this session. Four in-session subagents, each claude-opus-5-5 and independent of the others: two coded every note entry against the codebook without seeing each other's codes, and two checked the time-sensitive claims at HEAD, half each. Revised before merge by a second claude-opus-5-5 session (dispatch daabb3bb) to answer the independent review on LIN-4479 (14 Nov 11:02Z). Unchecked: no check document has been written."
grounded_at: "LinearViewer a886fb506 (origin/main, 14 Nov 2026) and simple-dispatcher 7d5fe7d94 (origin/main); note history read over every first-parent commit to docs/areas/ from 526bca66c (8 Nov) to a886fb506. The coding and truth check are at a886fb506. Later counts are read at LinearViewer 0a1adcf9b (origin/main, 14 Nov 11:00Z), after LIN-4470's PR #2450 merged as fb358dbda (09:49:26Z)."
cites:
  - "docs/areas/README.md@a886fb506 (the note format, the one-home rule, the guard's five checks)"
  - "docs/areas/*.md@a886fb506 and simple-dispatcher docs/areas/*.md@7d5fe7d94 (the 221 entries coded)"
  - "tests/unit/area-notes.test.js@a886fb506:1-12,112 (what the guard checks; the Waiting count printed in CI)"
  - "lib/prompts/leftover-words.js@a886fb506 (LEFTOVER_RULE, CONSEQUENCE_TEST)"
  - "lib/prompt-formatters.js@a886fb506:614 (the grounding line: Lessons bind, Waiting is context)"
  - "CLAUDE.md@a886fb506:110 (a new lesson lands as code or a test first)"
  - "docs/reviews/stability-measures/README.md@a886fb506:52-57 (waiting.* rows: a count, not the content)"
  - "beyond-the-code-entries-lv.json, beyond-the-code-entries-sd.json, beyond-the-code-codes-A.json, beyond-the-code-codes-B.json, beyond-the-code-truth.json (this change)"
  - "beyond-the-code-scripts/ (notes-history.mjs, cited-symbols.mjs, dump-entries.mjs, agreement.py, codebook.md; this change)"
  - "LIN-4479 (description, As asked: John's 'secret backlog' and 'notes as TS')"
  - "LIN-4347 (As asked, 7 Nov: notes 'kept with the code on main, by area'), LIN-4371 (the registry and guard), LIN-4401 (outside finds go to notes, 10 Nov), LIN-4414 (Waiting uncapped, 11 Nov), LIN-4431 (the consequence gate, merged c6d99f05e, 12 Nov 13:38:44Z)"
  - "LIN-4400 (As asked: one pass over every open ticket for broken, blocking or unsafe; John: 'not losing important things in the mix'; completed 10 Nov 09:35:58Z) and LIN-4416 (opened 11 Nov 21:42Z from LIN-4400's tickets; description and comments read 14 Nov)"
  - "da5df707d (the Security Review's merge, 10 Nov 15:05:25Z: the nine safety entries first appear) and fb358dbda (PR #2450, 14 Nov 09:49:26Z)"
  - "LIN-4447 (close-out comment, 14 Nov 09:02Z: 21 Waiting entries; ruling lin4447-area-read-inconclusive), LIN-4448 (comments 14 Nov 09:15Z and 09:18Z: 26, 25 and 22 for one note's count; 'A move is not an exit'), LIN-4470 (Leftovers comment, 14 Nov 09:32Z: after the PR's own move, the note, the source map and a test named the wrong file for NOTES_DIR; lib/prompts/area-note-format.js@a886fb506:8 had been right)"
  - "LIN-4462 (comparison, 14 Nov 02:21Z) and the LIN-4470 comparison posted on LIN-4447 (14 Nov 09:17Z): note scores reported apart from code scores"
  - "Outside sources: each is linked where it is used and listed under Method."
---

# What do agents need to know about a codebase beyond the code, and where should each kind of knowledge live?

Agents need four kinds of knowledge the code does not show: **traps** (how a change here goes wrong),
**homes** (which one place owns a rule), **reasons** (why something is the way it is, and who
decided), and **known work** (what is wrong or waiting). Harbour's area notes hold all four in one
prose file per area, and each kind fails there differently. The traps and homes, a third of the
221 entries, are often already held by a test: three in four Lessons are at least partly held by
a check, and a third (31 of 91, by both coders) are fully held. For those the prose is a second
copy of a rule the build enforces, plus a pointer. The Waiting entries, three in five of all
entries, are almost all known work, and they form a backlog the tracker cannot see. In
LinearViewer it grew from 30 entries to 118 in six days, and about a third of it is behaviour that
is wrong today. A tidying ticket aimed at one note took it to 108 the same morning, and it stood at
111 by 11:00Z. It holds nine safety findings that the Security Review wrote as notes, not tickets.
LIN-4416, the safety collection built from the tracker-wide pass's tickets, named none of them
until two were routed there on 14 Nov, and seven are still only in notes. That is the "secret
backlog" John suspected (LIN-4479). Each kind should live where something keeps it true: a trap or
a home in a check, whose failure message carries the why, or beside the code it is about; a reason
in a dated decision record; known work in one register that has ids, fields and a status, and that
the tracker's views and sweeps read. John's idea, notes as TypeScript, fits the last of these and
the homes. Types alone check a note's shape and its references, not whether what it says is still
true, and in these notes the names hold up while the claims about them go stale. A data module
under a census goes further. A Lesson's `heldBy` test path must exist, and counts are computed,
not written, which removes the kind of claim that was false in seven of the eight false entries
found here. No data structure keeps the prose of a trap or a reason true.

## Findings

**1. The notes hold four kinds of knowledge, and the two sections split cleanly between them.**
Two coders, working apart from each other, coded all 221 entries in both repositories against one
codebook. They agreed on the kind of 89% of entries (Cohen's κ 0.87). In the table, each cell
shows coder A's count | coder B's count, and the share of the section.

| Section | Kind | A \| B | Share |
|---|---|---|---|
| Lessons (91) | trap: a non-obvious way a change goes wrong | 44 \| 46 | half |
| | home: the one place a rule lives | 28 \| 26 | three in ten |
| | recipe: what else a change must update | 9 \| 11 | one in ten |
| | ruling: a decision and its reason | 10 \| 8 | one in ten |
| Waiting (130) | defect: behaviour wrong today | 44 \| 40 | a third |
| | copy: one rule written in two or more places | 37 \| 35 | over a quarter |
| | cleanup: dead code, stale comment, oversize file | 22 \| 21 | a sixth |
| | question: waiting on someone's decision | 11 \| 17 | one in ten |
| | ruling: an accepted limit, with its reason | 12 \| 10 | one in eleven |
| | measure: a figure, with no defect stated | 3 \| 5 | small |

Lessons are knowledge about *how to change* the code. Waiting is *work*: both coders called 94
of the 130 entries a defect, a copy or a cleanup, and both put 104 of them in the tracker's job
(the `home` field). Only about one entry in ten is knowledge that needs prose: both coders put 20 entries
in a decision record or an area note, the rulings and the traps that no single place in the code
owns.

**2. The known work is a backlog that no work view shows, and it outgrew its settling until a
ticket was aimed at it.** LinearViewer's Waiting entries went from 30 in the founding commit (`526bca66c`,
8 Nov) and 56 by that evening to 118 at `a886fb506` six days later, with a peak of 121 the night
before. Their text grew from 7,089 bytes to 15,184 that evening and 54,627 at `a886fb506`. Over
that history, 201 Waiting entries appeared (the founding 30 among them) and 83 left, and 68 of the
83 left in a commit that also changed code. The inflow quickened after the consequence gate
(LIN-4431, merged `c6d99f05e`, 12 Nov 13:38:44Z) began sending outside finds to the notes instead
of tickets: 83 added and 29 gone in the four and a half days before it, 88 added and 54 gone in the
day and a half after. (The days after also carried the LIN-4447 and LIN-4448 tidying batches, so
the gate is not the only cause.)

The counter-example came the same morning. LIN-4470's PR #2450 merged as `fb358dbda` at
09:49:26Z, eight minutes before this paper's first commit. It took the LLM & prompts note from 22
entries to 12 and LinearViewer's Waiting total from 118 to 108. By its own count, seven of the 22
were settled, two were routed to a ticket, one moved to Runs & dispatch and twelve were kept. The
comment on LIN-4448 says it plainly: "A move is not an exit". Two more merges took the total to
111 by 11:00Z (`0a1adcf9b`). So the list does shrink when a ticket is pointed at it: LIN-4470
settled seven entries in one note. Before that, entries left (83 of them) but more arrived, and
nothing outside such a ticket points at the list. simple-dispatcher's notes are small but grew too: 7 Waiting entries at its
founding commit (`4aee0c9fe`, 8 Nov), a peak of 13, and 12 at `7d5fe7d94`.

The work is not visible where Harbour ranks work. Home's Up next and the backlog pages read the
tracker. The only places the Waiting entries surface are the guard's CI diagnostic
(`tests/unit/area-notes.test.js:112`) and the Stability Review's `waiting.*` rows, and both show a
count, not the content. Meanwhile the tracker side was being made to converge: LIN-4401 moved
outside finds into notes because "each landing mints about 1.4 tickets". The code can read cleaner
while the list grows, and nothing that reads tickets will notice.

**3. The secret backlog holds defects that matter, including nine on safety.** Both coders called
39 Waiting entries defects, and 25 of those are fix-sized by both. Some are user-facing: Settings ›
Models renders a select and an input per row with no accessible name; the Design Review measured
the Jira site picker overflowing a phone screen by 52 px; on a server with no AI configured, Next
step spins with no message. Nine came from the
Security Review of 10 Nov, which, like every Periodical since LIN-4349, wrote notes and filed no tickets (LIN-4379, LIN-4380).
Among them: the Collective preview returns the server's `YAP_PASSWORD` to any member who turns on
a self-service flag (`routes/collective.js`); on a Jira workspace, underscore-bearing secrets reach
a guest's `/t/` page unmasked (`lib/mask-secrets-in-html.js`); and with one setting on, any
readWrite key, a leaf worker's included, can set the harness for the whole workspace
(`routes/proxy-model-routing.js`). LIN-4400 was the "one pass over every open ticket" meant to make
sure, in John's words, "we're not losing important things in the mix". It could not have seen
these nine: it finished at 09:35:58Z on 10 Nov, and the nine first appear in the notes at 15:05:25Z
that day (`da5df707d`, the Security Review's merge). LIN-4416, the safety collection opened on
11 Nov from the 134 tickets LIN-4400 confirmed, came after them, but it was built from tickets,
and its description names none of the nine. The consequence test now sends a find that touches
safety to a ticket, but these entries are older than the gate. On 14 Nov LIN-4470 applied it to the
two in the LLM & prompts note (the Lesson authority and the kickoff goal's attribution): it posted
both to LIN-4416, and PR #2450 removed them from the note. The other seven are still only in notes
at `0a1adcf9b`, and nothing has applied the test to them.

**4. Most Lessons repeat a check at least in part, and a third are a full second copy.** For each
Lesson, both coders checked the cited test or census in the code. Coder A found 35 of 91 Lessons
held by a check, 34 partly held and 22 not held; coder B found 41, 30 and 20. Both agree that 31 are
fully held. The pattern is consistent: "A new stage kind is one record ... and
`tests/unit/lin-4467-stage-kind-record.test.js` fails on a missing field"; "The code routes'
order lives once, in `CODE_ROUTES` ... `tests/unit/lin-4465-code-routes.test.js` fails until all
three agree". Here the check is the authority, and the Lesson restates it. A partly held Lesson is
not a copy: the part no check holds is the prose's own. For the fully held ones, the restatement is
useful when an
agent is reading, but it is the same "second copy" the Lessons themselves warn against, and the
archive's essay on it (`the-second-copy.md`) traces it back to Parnas. Harbour already states the
better rule for prompts (CLAUDE.md:110, `a new lesson lands as code or a test first`), and the LLM
note's own Lesson says that "Prompt words banning a kind of how do not hold it ... Hold the shape in
code or a test". The 18 Lessons that neither coder found any check for are where the prose is the
only safeguard. Most of them are traps: "A `{ module }` entry's place in a renderer's script list
means nothing"; a new file "is not scanned until it is committed"; "A blind reader's limits are
instructions, not access".

**5. The notes go stale in what they claim about the code, not in its names.** The guard checks
that every cited path exists. I checked the names: the LinearViewer notes cite 253 distinct code
names (functions, constants, tables), and every one is still spelled somewhere outside `docs/` at
`a886fb506` (`cited-symbols.mjs`, a `git grep -w` that also reads tests and comments, so a name can
survive in a comment after its code has gone). In simple-dispatcher, one of 18 is gone
(`reportedPrUrlOf`). What goes stale
is the relation a sentence asserts: a count, "only X calls Y", or "X lives in Y". Both coders marked
44 entries as making such claims. Two checkers then tested each claim at HEAD
(`beyond-the-code-truth.json`). Of 110 claims, 94 held, 13 were false and 3 could not be settled
from the code. Eight of the 44 entries, nearly one in five, carry at least one false claim. Seven
of the eight carry a false count (one also a false "only"), and the eighth a false "every". One
Waiting entry says about 16 production sites
compare a credential to `'test-token'` inline, seven of them in `routes/proxy-compute.js`, and that
only two modules import the helper. At HEAD all seven call the helper and eleven modules import
it, so the entry describes work that is mostly done. Another says a contract misses "23
`DISPATCH_KINDS`"; it misses 3. The note's own count of unnamed Settings controls, 86, matches no
render: a render at HEAD gives 22 of each kind with no saved preset and 44 with one. One false
claim is a Lesson, a rule agents are told binds them: "every provider-side `getIssue` passes
`AS_ASKED_READ`". One Jira call does not, harmlessly, because it reads only an epic's key. The
record shows the same thing. The LLM & prompts note says `docs/areas/` is spelled in "26 lines
across 11 code files". LIN-4470 recounted 19 lines in 11 files, and the checker counted 20 in 12
by a slightly wider rule, but no rule gave 26. The same note's Waiting count was given as 26 in
LIN-4448's ask, 25 at its review, and 22 at the recount. Every name in those sentences resolves,
so a check that a reference exists would have passed each one. A hand-written count is a fact with
no owner. Staleness also arrives inside a change, where the process can catch it. At `a886fb506`
the note correctly placed `NOTES_DIR` in `lib/prompts/area-note-format.js` (line 8). PR #2450 moved
it to `lib/prompts/area-registry-path.js`, and the note, the source map and a test the PR itself
added went on naming the old file. The PR's own leftover step caught all three before merge.

**6. Notes cost every change something, and the evidence that they pay is thin.** Eight stage
kinds are told to read the notes of every area a change touches (`lib/prompt-formatters.js:614`).
LinearViewer's twelve notes are 89 KB. LLM & prompts alone is 15 KB and Runs & dispatch 18 KB,
and only Lessons are capped. Outside Harbour, the one controlled study of repository context files
I found ([Gloaguen et al. 2026](https://arxiv.org/abs/2602.11988), 138 tasks on 12 repositories
plus SWE-bench Lite, four agents) found that "providing context files does not generally improve
task success rates" while raising inference cost by over 20% on average. That covers both kinds of
file it tested. LLM-generated files had "a marginal negative effect" and developer-written ones "a
marginal performance gain", "neither statistically significant", and both raised cost. Agents did
follow the instructions, and overviews did not help. Harbour's notes are written by agents, but
entry by entry from the work, not generated as an overview in one pass, so they sit between the
study's two kinds, and it does not say which way they fall. A paired study ([Lulla et al. 2026](https://arxiv.org/html/2601.20404), 124 PRs) found
lower runtime with an `AGENTS.md`, but it did not measure correctness. A census of 2,303 such
files ([Chatlatanagulchai et al. 2025](https://arxiv.org/html/2511.12884v1)) found that they grow
by frequent small additions with negligible deletions, and its authors call them configuration,
not documentation. Harbour's notes behave the same way: 300 entries added against 97 gone. Harbour's
own area reads score the note apart from the code. In LIN-4470's repeat read (PR #2450, since
merged), the LLM & prompts note rose from 3.25 to 4.0 while the code score fell from 3.3 to 3.0.
That read scores how legible the code is to a blind reader. It says nothing about whether the
notes made changes safer or cheaper, so it neither shows nor rules out that they pay.

**7. Harbour already keeps knowledge as checked code wherever that has worked.** The registry is
data (`docs/areas/areas.json`) and a test holds it. Stage kinds are one record. Feedback kinds,
code routes and comment kinds are each one table, and a census fails when a copy appears
(`lin-4455-feedback-kinds-table`, `lin-4465-code-routes`, `lin-4458-comment-kind-census`). Many
Lessons are simply pointers to these. This is John's idea in practice: a fact about the code that
needs no second copy, because the build reads the one copy. It worked for exactly the kind of
knowledge that is a list of things the code has. It cannot work by typing alone for traps or
reasons, as the next section shows.

## Where each kind should live

The test for each home is the one the question sets: it stays true, it has no second copy, and an
agent finds it when it is needed. "Stays true" means something fails when it stops being true.

| Kind (share of 221) | Today | Where it should live | What keeps it true |
|---|---|---|---|
| Home (12%) | Lesson prose restating a census | The census or single-definition table itself. If agents need an index, generate it from the code | The census fails on a second copy |
| Trap (20%) | Lesson prose | A test that fails when the trap is sprung, with the why in its failure message. Where no test can express it, a comment at the site. Only a trap with no single site stays in a short area note | The test, or the reader of that code |
| Recipe (5%) | Lesson prose | The failure message of the check that fires ("regenerate with `UPDATE_..._GOLDEN=1`") | It is shown at the moment it is needed |
| Reason / ruling (9%) | Lessons and Waiting | A dated, append-only decision record with who decided, why, and when to revisit it, cited by id from the site. Harbour's rulings store already holds John's answers | Append-only; superseded, not edited |
| Question (6%) | Waiting prose | A ruling, raised where John answers rulings | It has an owner and a state |
| Defect, copy, cleanup (43–47%) | Waiting prose | One work register with an id, area, file, kind, size, source and status. The tracker's views and sweeps read it, and the consequence test is a field the register enforces | Ids prevent duplicates; status makes leaving explicit; sweeps can see it |
| Measure (2%) | Waiting prose | Computed by a script when it is needed, never written down | Nothing to go stale |

How the options compare, John's idea among them:

| Option | Stays true | No second copy | Easy for agents |
|---|---|---|---|
| Prose notes (today) | Paths only (guard checks 1–3) | No: Lessons restate checks, and Waiting sits apart from the tracker | Read in full before every change; uncapped Waiting |
| Notes as TypeScript types alone | Shape and references: required fields, unique ids, an imported symbol that must resolve. Not claims: a count, "only", "lives in" still pass | Yes, within the file (ids) | Queryable; an agent reads only its area's rows |
| Notes as a data module under a census (John's idea, fuller form) | Shape, references and every field a test can compute: a `heldBy` test path that must exist, counts and lists derived from the code at test time. Not the prose of a trap or a reason | Yes: ids, and a held Lesson becomes a pointer the census validates | Queryable; a count is never stale |
| Checks (tests, censuses) with a message | Yes: the build fails | Yes: the check is the one copy | Met when it matters, at failure |
| Comment at the site | Only while readers keep it ([Wen et al. 2019](https://www.inf.usi.ch/faculty/lanza/PUBS/P/Wen2019a.pdf) on how comments drift) | Yes | Met by whoever reads that code |
| Tracker / rulings | Status is explicit | Yes, if notes stop holding the same work | Ranked, swept, owned; costs a ticket each |
| Generated views | Yes: computed from source | Yes | As easy as prose |

TypeScript fits a different problem than the one the notes have. It would give the Waiting list
what John asks for: "a reliable, duplicate free, easy to use data structure", with ids, typed
fields and checked cross-references. It would let the consequence test become a field (`touches:
'safety'` with no ticket id fails), and it would let Harbour render the list and sweep it the way it
sweeps tickets. Two caveats. First, Harbour has no TypeScript toolchain: Node 24, the repository's
floor, runs a `.ts` file by stripping its types, and "no type checking is performed"
([Node.js docs](https://nodejs.org/api/typescript.html)). Static checks would need `tsc --noEmit` in
CI. A plain JS data module loaded by a `node:test` census, the pattern Harbour already uses, gives
the same ids, fields and resolvable references with no new tool. Second, a type cannot tell whether
"26 lines across 11 files" is still true. Only computing it can, and that is what the fuller form
of John's idea does: "notes as TS, so they get checks" read as a data module under a census, whose
rows carry fields a test can check. Measured against this paper's findings, it closes most of the
gap. A `heldBy` path that must name an existing test turns the 31 fully held Lessons into pointers
the build validates, so the second copy becomes a checked reference. Computed counts remove the
kind of claim that was false in seven of the eight false entries, and the eighth, an "every" claim,
is a census a test could hold. What it leaves open are the 18 Lessons no check holds and the
rulings, whose truth lives in prose that no structure checks. So the gain is in two steps: storing
the work as data, and replacing written claims with computed ones. Typing the prose alone is not
where the gain is.

Outside Harbour, the same split is old. "Every piece of knowledge must have a single, unambiguous,
authoritative representation within a system" (Hunt and Thomas, *The Pragmatic Programmer*, 1999).
Architecture decisions go in short, numbered, immutable records ([Nygard
2011](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)). Architectural
rules are held by automated "fitness functions" (Ford, Parsons and Kua, *Building Evolutionary
Architectures*, 2017). And documentation examples can run as tests ([Rust's documentation
tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html)). On known
work kept beside code, a survey and interview study of TODO comments ([Storey et al.
2008](https://doi.org/10.1145/1368088.1368123)) found that annotations which work for one
developer become unmanaged at team scale. A study of self-admitted technical debt ([Zampetti et al.
2018](https://doi.org/10.1145/3196398.3196423)) found that 20–50% of debt comments were removed
"accidentally" with the code around them, not resolved, and that 8% of removals were acknowledged
in commit messages. In other words, an entry leaving is not the same as the work being done, which
is LIN-4448's "a move is not an exit".

## Method

**Population.** Every entry (top-level bullet) under `## Lessons` and `## Waiting` in every note in
`docs/areas/` of LinearViewer at `a886fb506` (12 notes, 85 Lessons, 118 Waiting) and simple-dispatcher
at `7d5fe7d94` (5 notes, 6 Lessons, 12 Waiting), split as `lib/prompts/area-note-format.js`
`parseNote` splits Waiting (`dump-entries.mjs`; the output is committed as
`beyond-the-code-entries-*.json`).

**Coding.** `codebook.md` defines five fields: kind (nine values), held (yes, partly or no, by a
mechanical check, verified by reading the cited test), volatile, needs, and home. Two
claude-opus-5-5 subagents coded all 221 entries. Each saw only the codebook, the entries and the
code, never the other's codes or this paper. The codes are committed as
`beyond-the-code-codes-A.json` and `-B.json`. `agreement.py` gives raw agreement and Cohen's κ:
kind 0.89 (κ 0.87), held 0.90 (0.80), volatile 0.89 (0.70), needs 0.94 (0.91), home 0.85 (0.78).
Findings quote both coders' counts, or the count they agree on.

**History.** `notes-history.mjs` walks every first-parent commit on `origin/main` that touches
`docs/areas/` (76 in LinearViewer, 13 in simple-dispatcher). It counts the entries in each note and
follows each entry from commit to commit. Two entries are the same entry when their word sets
overlap by Jaccard ≥ 0.5 across all notes and both sections. Net counts do not depend on this rule.
Additions and removals do: Waiting additions are 189, 201 and 234, and removals 71, 83 and 116, at
thresholds 0.3, 0.5 and 0.7. The paper quotes 0.5. The Waiting totals after `a886fb506` (108 at
`fb358dbda`, 110, then 111 at `0a1adcf9b`) come from the same script run on `origin/main` at
`0a1adcf9b`. The script needs history back to 1 Nov: a shallow clone gives 42 commits, not 76.

**Staleness.** `cited-symbols.mjs` takes each identifier-shaped backtick span (camelCase,
PascalCase or UPPER_SNAKE, four characters or more) and runs `git grep -w` for it outside `docs/`
at HEAD. The time-sensitive claims in the 44 entries that both coders marked volatile were split in
two halves. Two further subagents checked one half each at HEAD, claim by claim, with the command
used (`beyond-the-code-truth.json`).

**Record.** The tickets cited in the header were read in full through the workspace proxy,
descriptions and comments, on 14 Nov. Whether LIN-4416 names the nine safety entries was checked
by searching its description and comments for each entry's distinctive term (`YAP_PASSWORD`,
`mask`, `task-share`, `normalizeEmail`, `NODE_ENV`, `model-routing`, `secret-scan`). The only
match is LIN-4470's comment of 14 Nov 09:15Z, which routes two of the nine there (the Lesson
authority and the kickoff goal's attribution) for PR #2450. The timings in Finding 3 are LIN-4400's
`completedAt` and `da5df707d`'s commit time. That the other seven are still in notes was checked
at `0a1adcf9b` by a `git grep` of `docs/areas/` for each one's distinctive term.

**Outside sources.** Each was read at the linked page on 14 Nov 2026. Gloaguen et al., *Evaluating
AGENTS.md* (arXiv 2602.11988); Lulla et al., *On the Impact of AGENTS.md Files on the Efficiency
of AI Coding Agents* (arXiv 2601.20404); Chatlatanagulchai et al., *Agent READMEs* (arXiv
2511.12884); Wen, Nagy, Bavota and Lanza, *A Large-Scale Empirical Study on Code-Comment
Inconsistencies* (ICPC 2019); Storey, Ryall, Bull, Myers and Singer, *TODO or to Bug* (ICSE 2008,
doi 10.1145/1368088.1368123); Zampetti, Serebrenik and Di Penta, *Was Self-Admitted Technical Debt
Removal a Real Removal?* (MSR 2018, doi 10.1145/3196398.3196423); Nygard, *Documenting Architecture
Decisions* (2011); the Node.js TypeScript documentation; and Rust's documentation-test chapter. The
two books are cited for their well-known definitions, not read for this paper. Each outside source
is a mechanism to consider, not an estimate for Harbour.

## Limits

- **Six days of a new system.** The notes began on 8 Nov. The growth in Finding 2 covers the
  system's first week, a week with two tidying batches and the consequence gate. It shows the
  direction in that week, not a steady rate, and PR #2450's drop from 118 to 108 shows a ticket
  aimed at a note can reverse it. The checkpoint John set on LIN-4414, 26 Nov, is the first fair
  reading of whether busy lists shrink.
- **One model family throughout.** The author, both coders and both checkers are claude-opus-5-5.
  Agreement between them is not independence of view. A person, or a coder from another model
  family, may draw the kind boundaries differently. The `home` field is the most judgement-laden
  (κ 0.64 on Lessons), and Lessons split between `check` and `site` most often.
- **The truth check is not a rate for all entries.** It covers only the 44 entries that both coders
  marked as making a checkable claim about current code. Those are the entries most exposed to
  going stale, so the figure overstates staleness across all notes. It understates it for the
  claims a grep cannot settle.
- **Identity across commits is a heuristic.** A rewrite can read as a removal plus an addition. A
  move between notes was detected once, though the record names more (LIN-4459, LIN-4470), so
  moves are undercounted and removals overcounted. "Left with code" means the commit changed code,
  not that the code settled the entry.
- **No outcome measure.** Nothing here shows whether a note changed what an agent did, or whether a
  Lesson prevented a fault. The case against prose rests on what keeps each kind true, not on
  measured harm.
- **The nine safety entries are findings as written.** They were not re-verified for this paper,
  and some may be settled by work not linked to the entry.

## Next

1. **Does moving one area's Lessons into checks and site comments leave its next changes as safe?**
   Take Runs & dispatch, whose Lessons are nearly at the cap. Convert each held Lesson into the
   check's failure message, each site-bound trap into a comment beside the code, and keep only
   area-wide traps in the note. Then compare the next ten changes against the area's last ten on
   review send-backs and post-merge faults. (Line added to `proposals.md`.)
2. **Does a typed Waiting register that Harbour surfaces get entries settled, where prose did not?**
   Put one area's Waiting entries in a JS or TS data module with ids, kind, size, source, status and
   `touches`, under a census that refuses a safety row without a ticket. Show its count and rows
   where Harbour shows work, include it in the next safety sweep, and compare settle rates with
   the prose areas over two weeks. (Line added to `proposals.md`.)
3. Before either: apply the consequence test to the existing Waiting entries once, and open
   tickets for the seven safety ones still in notes (Finding 3). That is a task, not a study, so it is not a proposal
   line.
