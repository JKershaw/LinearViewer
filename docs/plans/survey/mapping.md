# Mapping: everything found, placed on the frame

*Started 16 Nov under `design-plan.md` §1. The expectations were committed before any row was placed (`design-expectations.md` §1, `f9a0d4c`). Marks are as on `situation.md`. The "Piece" column gives the traces' own facts, checked by their readers. Every placement is [my reading]. Nothing here is a design: it says where each thing lands on the frame, not how anything is stored.*

## How to read it

**The frame's shapes** are those of `shapes.md` §6:
- `plan`, with earlier versions kept
- `finding`
- `check`, which goes to John
- `question` and `decision`
- `ask`, a request to another lane
- `who is working`, meaning who is working on what

Need 5 has no shape. Note that §6's `ask` means a request to another lane. It is not the task's ask, which the traces also call "the ask". The two collide (§7).

**Other places a piece can land:**
- `computed`: drawn from records on the layer, never retyped.
- `structure:link`, `structure:versions` and `structure:ids`: parts of the general structure itself (items, links, versions, stable ids), not shapes.
- `outside:work`: the change itself, such as code, tests, commits, the PR's diff, CI, merges, deploys, an article, or collected data.
- `outside:engine`: Harbour's engine rules.
- `outside:reach`: systems no session can reach.
- `outside:tooling`.
- `waits:…`: fits no shape yet. The tag after `waits:` describes the piece, not a proposed shape. These are grouped only in §6.

**Fit**, one mark per part, in the order of "Lands on":
- ✓ fits cleanly
- ~ fits by stretching a shape
- ✗ waits
- o outside by design

**Writers:**
- J: John
- DS: the driving session
- ap: the autopilot
- H: Harbour's code
- The stages: st survey-task, sp survey-place, sc scoping, pl plan, pr plan-review, br breakdown, bu build, lo the leftover run, rv review, bl blind read, co close-out, rs Periodical research

**"Code would"** says what code does with the piece on the frame. It is not what happens today.

## 1. The six Harbour traces

### T1. LIN-4450, an ordinary task

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T1.1 | Parent's ask, with John's direction "settle engineering questions yourself" | waits:ask-of-task + waits:instruction | DS quoting J → every stage, children | parent closes | keep fixed | ✗ ✗ |
| T1.2 | Child's ask: an agent's slice of the parent plan, sealed under "As asked" | `plan` (a link to the piece) + waits:ask-of-task | br → all seven sessions | task closes | link, not copy | ~ ✗ |
| T1.3 | The plan, design and plan review on the parent | `plan` + waits:judgement | pl, design, pr → children | parent closes | versions; children read current | ✓ ✗ |
| T1.4 | Task survey: three risks; "a 15-minute live probe on a real Jira site" | `finding` + `check` | st → sc, bu; probe → J | done / declined | wake addressee; gate close | ✓ ✓ |
| T1.5 | Place survey: in-task points; three "better still, not this task's", two of which vanish | `finding` | sp → bu; the rest → the area's future | done / declined | refuse a silent drop | ✓ ~ |
| T1.6 | Size "a small tidy", "Decided by: the standing policy" | `decision`, decided by a policy | sc → bu, rv | answered | record decider | ~ |
| T1.7 | The change, PR #2421 | outside:work | bu | merged | — | o |
| T1.8 | Build summary, "Not verified: no live check" | `computed` + `check` | bu → co | — | show the check's state | ✓ ✓ |
| T1.9 | Five departures from the plan, posted on the parent | `plan` (a new version) | bu → parent, siblings, rv | superseded | versions; readers see current | ✓ |
| T1.10 | Leftovers: tidies; one find "noted"; a `Retires:` line on an unrelated entry | outside:work + `finding` + `finding` (ended) | lo → area; rv | done | record end | o ✓ ✓ |
| T1.11 | New area note: four Lessons, one Waiting entry | waits:lasting-truth + `finding` | bu → the area's future | Lessons: none; entry: done / declined | — | ✗ ~ |
| T1.12 | Review: gap analysis, one fix | waits:judgement + `finding` | rv → co | superseded when the head moves | tie to head | ✗ ✓ |
| T1.13 | Blind read: "better"; three fix-sized; the bulk path again | waits:judgement + `finding` + `finding` (duplicate of T1.5) | bl → co | done | link to existing | ✗ ✓ ~ |
| T1.14 | Close-out: merged; three checks "not run" (need real Jira); rollback | `computed` + `check` | co → J | done / declined | show John; gate | ✓ ✓ |
| T1.15 | Description pruned; full text in snapshots | `computed` (the tracker's view) + structure:versions | co, H | — | no prune | ✓ ✓ |
| T1.16 | Dispatch rows, models, costs; nine app calls | `who is working` + waits:run-record | H | run ends | — | ✓ ✗ |

### T2. LIN-4455, a tidy under autopilot

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T2.1 | John's goal for the area; "every piece names what it retires" | waits:ask-of-task + waits:instruction | J (quoted) → the lane | parent closes | keep fixed | ✗ ✗ |
| T2.2 | Area note: Waiting 2, 4, 11 (two with wrong premises); a stale Lesson | `finding` + waits:lasting-truth | earlier work → the area's future | done | note the commit each was true at | ~ ✗ |
| T2.3 | Design comment on the parent | `plan` | design → plan, children | parent closes | versions | ✓ |
| T2.4 | Approved plan's piece-5 paragraph | `plan` + waits:judgement (approved) | pl, pr → br | superseded | versions | ✓ ✗ |
| T2.5 | Breakdown: ten subtasks; Waiting entries handed to pieces | `plan` + waits:ask-of-task + `finding` (re-addressed) | br → children | — | create; re-address | ✓ ✗ ✓ |
| T2.6 | LIN-4455's ask: slice, "say so in a comment on LIN-4447", "nothing above it changes" | `plan` (link) + waits:ask-of-task + waits:instruction | br → all stages | task closes | link; the plan's versions replace "say so" | ~ ✗ ✗ |
| T2.7 | Relations: LIN-4453 blocks LIN-4455, which blocks two more | structure:link | br | resolved | link | ✓ |
| T2.8 | Seven snapshots | structure:versions | H | — | — | ✓ |
| T2.9 | Survey open-0: five points; one adopted then dropped | `finding` | st → bu | done / declined (with reason) | wake; record end | ✓ |
| T2.10 | Survey global: the same three, more spellings; stale Lesson; name Waiting 5 | `finding` (duplicate in part) + waits:lasting-truth (correction) | sp → bu | done | link duplicates | ~ ✗ |
| T2.11 | Size, standing policy | `decision`, decided by a policy | sc → rv | answered | — | ~ |
| T2.12 | Plan change on the parent (departures) | `plan` (version) | bu → parent, rv | superseded | versions | ✓ |
| T2.13 | Pre-rebase commits, cited by the summary, not in history | outside:work + structure:ids | bu | — | links that resolve | o ✓ |
| T2.14 | Commit messages, one per beat | outside:work | bu | — | — | o |
| T2.15 | PR body: retires; four departures; left on purpose; bytes | `computed` + outside:work | bu → rv, bl, co | — | draw departures from the plan | ~ o |
| T2.16 | Fourth departure on the parent | `plan` (version) | bu → parent | superseded | versions | ✓ |
| T2.17 | Code: the new leaf, store changes, tests | outside:work | bu | — | — | o |
| T2.18 | Leaf header describing another file; stale after T2.30 | waits:lasting-truth (in a code comment) | bu → whoever reads the code | none | — | ✗ |
| T2.19 | "Piece 5 built": PR, CI, tests, decisions | `computed` + outside:work | bu → rv | — | compute | ✓ o |
| T2.20 | Review: clauses met; ledger of 5 (3 for close-out, 1 log monitor after deploy) | waits:judgement + `finding` + `check` | rv → co; operator | done / declined | gate close on the ledger | ✗ ✓ ✓ |
| T2.21 | From LIN-4448: file collisions; "whichever lands second rebases" | `ask` (a notice) + `who is working` | LIN-4448 → LIN-4447's lane | — | compute collisions from claims | ~ ✓ |
| T2.22 | Blind read: worse points; fix-sized; outside find; one folded into "Waiting 5" unchanged | waits:judgement + `finding` | bl → co | done | link to existing, and show it | ✗ ✓ |
| T2.23 | Leftovers written by close-out, not the builder, then counted done | `finding` (ended) + `finding` (new) | co → areas | done | refuse close while an expected output is missing | ✓ ✓ |
| T2.24 | Close-out commits: docblock "Do not add bindings there"; two Waiting entries | outside:work + waits:lasting-truth (in code) + `finding` | co → areas | — | — | o ✗ ✓ |
| T2.25 | Merged; deploy footer | outside:work | co | — | record the event | o |
| T2.26 | Close-out: post-approval changes; ledger; "Not run: no access to production logs" | `check` + `computed` + need 5 | co → operator / J | done / declined | show John; the reader sees all | ✓ ✓ ~ |
| T2.27 | Implemented stub: two of four departures | `computed` | co | — | draw from versions | ✓ |
| T2.28 | Autopilot summary, citing pre-rebase SHAs | `computed` + structure:ids | ap | — | compute | ✓ ✓ |
| T2.29 | Cost record | `who is working` + waits:run-record | H | — | — | ✓ ✗ |
| T2.30 | LIN-4459 settles an llm entry; leaves the leaf header stale | `finding` (ended) + waits:lasting-truth | LIN-4459 bu | done | — | ✓ ✗ |
| T2.31 | Repeat area read on the parent | waits:measured-value + waits:judgement | LIN-4462 → parent | — | — | ✗ ✗ |
| T2.32 | Drift run 8 rows: improved, resolved, new LOW | `finding` + outside:work (the report) | Drift → areas | done | — | ✓ o |
| T2.33 | Seams and stability readings count the task | `computed` + waits:measured-value | later runs | — | — | ✓ ✗ |
| T2.34 | Parent status "W5" names a different entry | `computed` + structure:ids | ap | — | stable ids, not positions | ✓ ✓ |

### T3. LIN-4472, a front-end lane piece

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T3.1 | Parent ask: John's words; "engineering questions are settled by the lane; only John's calls go to him" | waits:ask-of-task + waits:instruction | J (quoted) → lane | parent closes | decider setting | ✗ ✗ |
| T3.2 | Parent plan piece 2, with the wrong name search, never corrected | `plan` | pl → children | parent closes | versions | ✓ |
| T3.3 | Plan review Approve; eight builder notes (lines, "rerun") | waits:judgement + `finding` | pr → children's builders | done | — | ✗ ✓ |
| T3.4 | Breakdown: "fits one session", "adds nothing to the bridge" | `plan` (a field, later overruled) | br → children | superseded | versions | ~ |
| T3.5 | Piece 1's helper, census baseline, rewritten entry, "Piece 2 is unblocked" | outside:work + `finding` + structure:link + waits:measured-value | LIN-4471 → LIN-4472 | — | resolve the link | o ✓ ✓ ✗ |
| T3.6 | LIN-4472 brief: goal, files, testing, retires; "say so in a comment on LIN-4463" | waits:ask-of-task + `plan` (link) + waits:instruction | br → all stages | task closes | link | ✗ ~ ✗ |
| T3.7 | Brief's suite list, wrong | `plan` (slice) | br → st, sp, bu | superseded | the correction is a new version | ✓ |
| T3.8 | Brief's name search, wrong | `plan` (slice) | br | superseded | same | ✓ |
| T3.9 | "Session fit … no serving change", read as a rule, then a forecast | `plan` (field) + `decision` (overruled by T3.14) | br → sc, ap | superseded | — | ~ ✓ |
| T3.10 | Survey open-0: slicers, unlisted suites, census forecast (wrong) | `finding` + waits:measured-value | st → sc, rv | done | — | ✓ ✗ |
| T3.11 | Survey global: seven suites; "better still"; a wrong source-map claim | `finding` | sp → sc | done | — | ✓ |
| T3.12 | Size record: standing policy, then "a ruling" | `decision` (the decider changes) | sc → rv | answered | record decider | ~ |
| T3.13 | Scoping's reasoning and DECISION, only in its final message | `question` (reasoning as content) | sc → J | answered / withdrawn | one place, one decider | ✓ |
| T3.14 | Autopilot's engineering call, 26 s later, on the parent | `decision` (a second decider on T3.13) | ap → bu | — | one decider per question | ✓ |
| T3.15 | Proposed answer on the ruling: "the lane could have settled it" | `question` (suggested answer) | an agent → J | — | a field | ✓ |
| T3.16 | Commit `a8955813`: re-export design, "Decided on LIN-4463" | outside:work + structure:link | bu | — | link to the decision | o ✓ |
| T3.17 | Builder's summary; a known shortfall | `computed` + `finding` | bu → rv | done | — | ✓ ✓ |
| T3.18 | PR body, stale, rewritten by close-out | `computed` + outside:work | bu, co → rv | — | compute | ~ o |
| T3.19 | Code; the leaf header's wrong example `5m 0s` | outside:work + waits:lasting-truth (in code) | bu | — | — | o ✗ |
| T3.20 | Tests, guard, census baseline 100 | outside:work + waits:measured-value | bu, lo | — | — | o ✗ |
| T3.21 | John's answer, on the child not the parent; it woke the finished scoping | `decision` + outside:engine | J → sc | — | lands on the question wherever he clicks | ✓ o |
| T3.22 | Commit `ffa70b78`: guard, Waiting note, lesson, e2e poll | outside:work + `finding` + waits:lasting-truth | lo | — | — | o ✓ ✗ |
| T3.23 | Leftovers answer; `Retires:` | `finding` (ended, and new) | lo → rv | done | — | ✓ |
| T3.24 | Front-end-browser note: lessons; entry "observation.js is next in LIN-4463's order" | waits:lasting-truth + `finding` + `computed` (order from the plan) | bu, lo → area | — | compute order | ✗ ✓ ~ |
| T3.25 | Front-end-pages flake entry removed | `finding` (ended) | lo | done | — | ✓ |
| T3.26 | Source map: `fmtDuration` moved; `time-words.js` entry with `5m 0s` | waits:lasting-truth (a map of the code) | bu, co → every session | none | — | ✗ |
| T3.27 | `areas.json`: `time-words` maps to front-end-pages | waits:place | bu → periodicals, rv | none | — | ✗ |
| T3.28 | Review: Approve conditional; F1–F3; "What CI did not prove": Safari, Firefox, polling | waits:judgement + `finding` + `check` | rv → co; J | done / declined | gate; show John | ✗ ✓ ✓ |
| T3.29 | Blind read: better; finds | waits:judgement + `finding` | bl → co | done | — | ✗ ✓ |
| T3.30 | Runs note: "`fmtWhen` ownership waits on a call" | `question` (filed as a Waiting entry) | co → a decider | answered | — | ~ |
| T3.31 | PR comment: browser checks "not run"; carried nine times on LIN-4463 | `check` + `computed` | co → J | done / declined | show state; no retelling | ✓ ✓ |
| T3.32 | Close-out stub: one deviation; the prune removed nothing | `computed` | co | — | — | ✓ |
| T3.33 | Close-out summary: post-approval changes "nobody reviews these" | `computed` + need 5 | co | — | the reader sees all | ✓ ~ |
| T3.34 | Snapshots | structure:versions | H | — | — | ✓ |
| T3.35 | Dispatch rows: labelled Opus, built on Haiku | `who is working` + waits:run-record | H | — | label computed from the run | ✓ ✗ |
| T3.36 | Routing: implementation on Haiku, a job setting from 7 Nov | waits:instruction (a setting) | set via proxy | none | — | ✗ |
| T3.37 | LIN-4154, open in Backlog, largely settled; no stage found it | `finding` (no running addressee) | Seams → nobody running | done | surface by area | ~ |

### T4. LIN-4482, a Seams & Tangles run

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T4.1 | Sealed ask from the template: steps 1–11, "mint no tickets", second read in three fields | waits:ask-of-task + waits:instruction | minting session → rs, rv, co | task closes | keep fixed | ✗ ✗ |
| T4.2 | Mint-time leads, "every figure below is a lead to re-check" | `finding` | minting → rs | done | — | ✓ |
| T4.3 | Pointers to run 12's report, ledger, proposals | structure:link + outside:work | minting → rs | — | links | ✓ o |
| T4.4 | Periodical gate marker, read by code | waits:ask-of-task (its kind) | minting → H | — | a field code reads | ✗ |
| T4.5 | Size: standing policy | `decision`, decided by a policy | sc | answered | — | ~ |
| T4.6 | Findings section in the description, pruned at close | `finding` + outside:work (summary of the report) | rs → co | done | no prune | ✓ o |
| T4.7 | Close-out stub | `computed` | co | — | — | ✓ |
| T4.8 | "PR open" comment with URL; the gate checks it | `computed` + structure:link | rs → rv, gate | — | link | ✓ ✓ |
| T4.9 | Second read: AGREE / YES / fixed in place; gate regexes read the three fields | waits:judgement | rs (sub-agent) → rv, gate | — | checked fields | ✗ |
| T4.10 | Adversarial reader's answer in the report | waits:judgement + outside:work | sub-agent → rs | — | — | ✗ o |
| T4.11 | 65 Waiting entries re-checked; eight corrections, one removal | `finding` (versions, corrected in place) | rs → areas | — | versions | ✓ |
| T4.12 | Closing hand-off: two tidies and five finds "to the person" | `finding` → J | rs → J | done / declined | show John; ends seen | ✓ |
| T4.13 | Review: re-ran tools; fix 1; ledger; Approve conditional | waits:judgement + `finding` | rv → co | done | gate on ledger | ✗ ✓ |
| T4.14 | Blind read: "same"; diff empty (all paths excluded) | waits:judgement + need 5 | bl → co | — | the reader sees all | ✗ ~ |
| T4.15 | Close-out: merge pinned; edits unread; "measure from the new main"; LIN-4154 "for you to close" | `finding` → next run + `finding` → J + need 5 | co → run 14; J | done | wake the next run's reader | ✓ ✓ ~ |
| T4.16 | PR body | `computed` | rs | — | — | ✓ |
| T4.17 | Commits with Opus and Sonnet trailers | outside:work | rs, co | — | writer recorded | o |
| T4.18 | The report, 620 lines; not cited by sibling Periodicals | outside:work + `finding` | rs → run 14, areas | — | — | o ✓ |
| T4.19 | Evidence folder, 66 files | outside:work | rs | — | — | o |
| T4.20 | `stage-writes.js` has no home; "the choice is the owner's"; a second entry added beside it | `question` (filed as Waiting) + `finding` (duplicate) | rs, Drift → J | answered | one entry, linked | ~ ~ |
| T4.21 | Jira provider imports the Periodical engine for one regex | `finding` | rs → area | done | — | ✓ |
| T4.22 | Eight corrections tagged "Corrected by Seams & Tangles" | `finding` (versions) | rs → areas | — | versions | ✓ |
| T4.23 | Main's #2457: the same decision from another task; `areas.json` move | `finding` (duplicate, across) + waits:place | LIN-4448 co | — | link | ~ ✗ |
| T4.24 | Cost record | `who is working` + waits:run-record | H | — | — | ✓ ✗ |
| T4.25 | Six snapshots | structure:versions | H | — | — | ✓ |
| T4.26 | `/periodicals` shows the close-out's dispatch time as the last run | `computed` (wrong derivation) | H | — | compute from runs | ~ |
| T4.27 | Drift run 8 hands Seams a row run 13 had closed | `finding` (across, stale state) | Drift → Seams | done | state visible | ✓ |
| T4.28 | LIN-4154 still Backlog, called settled | `finding` → J | rs, co → J | done / declined | show John | ✓ |

### T5. LIN-4474, a piece built in simple-dispatcher

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T5.1 | Two older Waiting entries, one in each repository: the rule written twice; the sha pins bytes | `finding` (spanning two projects) | LIN-4377 → both areas | done | — | ~ |
| T5.2 | Plan: "its two describe blocks", wrong | `plan` | pl → children | superseded | versions | ✓ |
| T5.3 | Plan review Approve on rev 2 | waits:judgement | pr | — | tie to the revision | ✗ |
| T5.4 | Breakdown: three subtasks; blocks relation | `plan` + waits:ask-of-task + structure:link | br | — | — | ✓ ✗ ✓ |
| T5.5 | Ask: eight parts, "change course and say so on LIN-4461" | waits:ask-of-task + `plan` (link) + waits:instruction | br → all stages | task closes | link | ✗ ~ ✗ |
| T5.6 | Survey open-0: the premise holds; "two describe blocks" wrong; W-4 passes by construction | `finding` + `plan` (correction) | st → sc, bu | done | the correction becomes a version | ✓ ✓ |
| T5.7 | Survey global: one helper; a gap, so write a rule; leftover advice | `finding` + waits:lasting-truth (proposed) | sp → sc, bu | done | — | ✓ ✗ |
| T5.8 | Ruling `lin4474-describe-blocks-cut` | `question` | sc → J (the cut rule) | answered | wake decider | ✓ |
| T5.9 | Suggested answer, unknown actor | `question` (field) | ? → J | — | writer recorded | ✓ |
| T5.10 | John's answer | `decision` | J → sc | — | — | ✓ |
| T5.11 | Size: a written rule, "copies only from merged LV commits"; decided by a ruling | `decision` + waits:lasting-truth | sc → bu | — | — | ✓ ✗ |
| T5.12 | Seven snapshots | structure:versions | H | — | — | ✓ |
| T5.13 | Commit `0306d4b`: deletes the checker; W-4; the header rule (L28–31); removes a Waiting entry | outside:work + waits:lasting-truth (in a test header) + `finding` (ended) | bu → siblings, by reading code | — | — | o ✗ ✓ |
| T5.14 | "PR 1 of 3 is open" comment | `computed` | bu | — | — | ✓ |
| T5.15 | PR #340 body, never updated for `54b1870` | `computed` + outside:work | bu, lo | — | compute | ~ o |
| T5.16 | Leftover commit: sentinel move; a Lesson; a module-map line; Waiting entry removed | outside:work + waits:lasting-truth ×2 + `finding` (ended) | lo | done | — | o ✗ ✓ |
| T5.17 | Leftovers comment, `Retires:` | `finding` (ended) | lo → rv | done | — | ✓ |
| T5.18 | SD's README: every build settles one Waiting entry (Harbour's rule) | waits:instruction | Harbour → SD builds | none | — | ✗ |
| T5.19 | Review: re-grounded; mutations; ledger; Approve conditional | waits:judgement + `finding` | rv → co | done | gate | ✗ ✓ |
| T5.20 | Blind read "same": W-4 "guards nothing at re-pin" (a settled trade re-found) | waits:judgement + `finding` | bl → co | done | — | ✗ ✓ |
| T5.21 | Close-out commit `54b1870`, never re-read | outside:work + `finding` + need 5 | co | — | the reader sees all | o ✓ ~ |
| T5.22 | Waiting entry: the sentinel family split; "a design call" | `question` (filed as Waiting) | co → a decider | answered | — | ~ |
| T5.23 | Waiting entry: re-pin gap; "the ruling … accepted this trade"; filed under `transcript.js` | `finding` + structure:link (to the decision) + waits:place | co → area | done | the link shows what the ruling said | ✓ ✓ ✗ |
| T5.24 | Close-out: post-approval table; 48 local failures; the guard refused the first entry | `computed` + need 5 + outside:work | co | — | — | ✓ ~ o |
| T5.25 | Implemented stub | `computed` | co | — | — | ✓ |
| T5.26 | Autopilot summary | `computed` | ap | — | — | ✓ |
| T5.27 | CI on three heads; merge by the JKershaw account | outside:work | GitHub, co | — | writer recorded | o |
| T5.28 | Cross-repo facts read each time (contract sha equals the pin) | waits:measured-value | st, sp, rv | — | — | ✗ |
| T5.29 | Parent close: "the sha pin catches drift"; the re-pin gap not carried up | `computed` | LIN-4461 co, ap | — | compute from open findings | ✓ |
| T5.30 | Cost record | `who is working` + waits:run-record | H | — | — | ✓ ✗ |

### T6. LIN-4448, a lane's parent

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| T6.1 | The ask: facts (copies, 378,915, 26 Waiting), done-when; "sessions settle engineering questions; John's calls go to rulings"; writer not recorded | waits:ask-of-task + `computed` (the copied counts) + waits:instruction | ? for J → every stage, every child | parent closes | counts computed | ✗ ✓ ✗ |
| T6.2 | Survey open-0: a stage kind is a row in about 14 tables | `finding` | st → sc, pl | done | — | ✓ |
| T6.3 | Survey global: three better moves | `finding` | sp → sc, pl | done | — | ✓ |
| T6.4 | Size: rebuild, two cuts; "pending a ruling", then "a ruling" | `decision` | sc → pl | answered | — | ✓ |
| T6.5 | Ruling `lin4448-safety-cuts`; the answer on the parent | `question` + `decision` | sc → J | answered | — | ✓ ✓ |
| T6.6 | From LIN-4447: three seam moves, "please reply on LIN-4447" | `ask` | LIN-4447 → this lane | answered ("agree to all three") | wake the lane | ✓ |
| T6.7 | The plan; pruned at close | `plan` | pl → children | parent closes | versions; no prune | ✓ |
| T6.8 | Plan review Approve; twelve builder notes | waits:judgement + `finding` | pr → children | done | — | ✗ ✓ |
| T6.9 | Breakdown: seven subtasks; an assignee rule as an engineering call; DECISION on look-into | `plan` + waits:ask-of-task + `decision` + `question` | br → children; J | — | — | ✓ ✗ ✓ ✓ |
| T6.10 | Ruling `lin4448-lookinto-none`; `record_on` LIN-4468, answer on the parent | `question` + `decision` | br → J | answered | lands on the question | ✓ ✓ |
| T6.11 | "Ruling applied" written into two children | `computed` (the decision, linked) | br → LIN-4468, LIN-4469 | — | link | ✓ |
| T6.12 | Handed down: slices, notes, "say so on LIN-4448", "if it doesn't, say so plainly" | `plan` (links) + waits:ask-of-task + waits:instruction | br → children | — | — | ~ ✗ ✗ |
| T6.13 | From LIN-4458: renewed ask; "tell me on LIN-4458"; no reply | `ask` | LIN-4458 → this lane | open (silence) | wake the lane | ✓ |
| T6.14 | From LIN-4459: "unless you say otherwise … proceeding to merge"; no reply | `ask` | LIN-4459 → this lane | open (silence) | wake; silence stays open | ✓ |
| T6.15 | LIN-4466: the leaf stays put; "recorded on the parent so the cost is visible" | `plan` (version) | child bu → parent | superseded | versions | ✓ |
| T6.16 | Autopilot note: the selector chose review on a parent with no PR | `finding` (about the engine) + outside:engine | ap → J | — | — | ~ o |
| T6.17 | Review, 13 Nov: Request Changes; "keep descending" | waits:judgement + `finding` | rv → ap, co | superseded | tie to head | ✗ ✓ |
| T6.18 | LIN-4468: one table, a correction to the plan; default deny, "the team should confirm" | `plan` (version) + `question` | child bu → parent | answered | — | ✓ ✓ |
| T6.19 | LIN-4467: five departures; a DECISION with no ruling row; "BLOCKED" | `plan` (version) + `question` | child bu → parent | answered | one place | ✓ ✓ |
| T6.20 | "BLOCKED holds nothing"; budget raise accepted on a condition passed to LIN-4469 | `decision` + `finding` → LIN-4469 | child co → LIN-4469 | done | wake addressee | ✓ ✓ |
| T6.21 | DECISION on a token stamp, anchored on LIN-4468; touched a file the lane said it wouldn't | `question` + `decision` + `who is working` | child bu → J, ap | answered | — | ✓ ✓ ~ |
| T6.22 | Autopilot note: LIN-4469 skipped survey and scoping | `finding` (about the engine) + outside:engine | ap → J | — | — | ~ o |
| T6.23 | LIN-4469: figures re-pinned; "the ruling `lin-4469-witness` … gates merge" | `plan` (version) + waits:measured-value + structure:link | child bu → parent | — | link shows withdrawal | ✓ ✗ ✓ |
| T6.24 | Ruling `lin-4469-witness`, raised under the parent's loop, withdrawn | `question` (withdrawn) | ap | withdrawn | state visible | ✓ |
| T6.25 | LIN-4470's disposition map: 22 entries settled, routed, moved, kept | `computed` (over findings) | child bu → parent | — | compute | ✓ |
| T6.26 | Repeat reads: D = −0.3; does not beat the control | waits:measured-value + waits:judgement | child bu → parent, J | — | — | ✗ ✗ |
| T6.27 | Ruling `lin4448-done-whenever`: close now, inconclusive-negative | `question` + `decision` | ap → J | answered | — | ✓ ✓ |
| T6.28 | Close-out held: the latest review is the stale Request Changes | waits:judgement (stale) + outside:engine | co → ap | — | — | ✗ o |
| T6.29 | Autopilot override, "waiting would deadlock" | outside:engine | ap | — | — | o |
| T6.30 | Review at `fb358dbda`: ledger; byte fix; a live 403 check; Approve | waits:judgement + `check` | rv → co; J | done | — | ✗ ✓ |
| T6.31 | Blind read: better; finds written into three notes | waits:judgement + `finding` | bl → co; areas | done | — | ✗ ✓ |
| T6.32 | Close-out: not met; live checks not run; LIN-1273, LIN-1242 open; prune | `computed` + `check` | co → J | done / declined | — | ✓ ✓ |
| T6.33 | Sent outward to LIN-1273, LIN-1242, LIN-4350, LIN-4416 | `finding` → other tasks | children → those tasks | done | wake their owners | ~ |
| T6.34 | Cost record: the autopilot lineage counts under its earliest issue | `who is working` + waits:run-record | H | — | — | ✓ ✗ |

## 2. Lighthouse

From the reader's notes, which stay outside this repository (`plan.md`). Each row is a summary, not a copy. A is LH044 weekly read 1 (15 Nov); B is LH004 (26 Sep, through a local Harbour).

| ID | Piece | Lands on | From → for | End | Code would | Fit |
|---|---|---|---|---|---|---|
| LA.1 | Horizon scout note: operators withdrawing anonymous access | `finding` | scout → proposals | done | — | ✓ |
| LA.2 | Proposal P-0013 and "Keeper: agree", committed by Claude on the keeper's word | `question` + `decision` | sweep → keeper | answered | writer recorded truly | ✓ ✓ |
| LA.3 | A correction appended below wording that stays | `finding` (version) | driver | — | versions | ✓ |
| LA.4 | Study brief, protocol 0.1, amendments | `plan` | subagent → reads | study ends | versions | ✓ |
| LA.5 | `for-driver.md`: a subagent's requests for shared files | `ask` | subagent → driver | done | — | ✓ |
| LA.6 | `due.csv` row: command, window, open | waits:ask-of-task | driver → the run | done | — | ✗ |
| LA.7 | Baseline checkpoint, corrected in place, "(corrected)" | outside:work + structure:versions | subagent, review | — | — | o ✓ |
| LA.8 | Claim: row set running | `who is working` | the run | done | refuse a second claim | ✓ |
| LA.9 | Raw panel data, 274 requests | outside:work | collector | — | — | o |
| LA.10 | Comparison output | outside:work | script | — | — | o |
| LA.11 | Wayback and statement searches | outside:work + `finding` | subagent | — | — | o ✓ |
| LA.12 | Checkpoint read 1: counts; flags for review | outside:work + `finding` → review | subagent → review | done | — | o ✓ |
| LA.13 | Commit message repeating the counts | `computed` | driver | — | — | ✓ |
| LA.14 | Row done; note repeats the counts | waits:ask-of-task (state) + `computed` | driver | — | — | ✗ ✓ |
| LA.15 | New review row; reshaped in place later; old values only in git | waits:ask-of-task + structure:versions | driver; PR #56 | done | versions | ✗ ✓ |
| LA.16 | Run line, edited in place; "$6.57" survives only in a commit message | `who is working` + waits:run-record + structure:versions | driver | — | versions | ✓ ✗ ✓ |
| LA.17 | `costs.csv` spend, overwritten | waits:run-record | driver | — | — | ✗ |
| LA.18 | Day's line on the public site, from an unreviewed read | `computed` (public view) + need 5 | driver → readers | — | publish only what passed | ~ ~ |
| LA.19 | Phone reader's visit | waits:judgement + `finding` | reader → driver | — | — | ✗ ✓ |
| LA.20 | Final reconciliation by a Codex session | `decision` + structure:versions | Codex, keeper | — | — | ✓ ✓ |
| LA.21 | Baseline line on the investigation page, left pending review | `computed` (public view) | sessions | — | — | ~ |
| LB.1 | "A later exchange" asked when Lighthouse would learn the wider space; asker unnamed | `question` + `decision` | ? → founding session | answered | writer recorded | ✓ ✓ |
| LB.2 | LH004 in the founding documents | `plan` | founding session | — | — | ✓ |
| LB.3 | Ticket LH004 in `tickets.json` | waits:ask-of-task | Claude → local Harbour | done | — | ✗ |
| LB.4 | Harbour's next-run: four options from a model | `question` (options, from an LLM) | Harbour's model → driver | answered | — | ~ |
| LB.5 | Keeper raised the cost limit and steered the drive (only in a retro) | `decision` | keeper | — | — | ✓ |
| LB.6 | "sonnet for research", changed by D-0002 | waits:instruction + `decision` | drive skill; keeper | — | — | ✗ ✓ |
| LB.7 | Dispatch: ticket text plus instructions; the brief says "initiated by: unknown" | `who is working` + need: what a reader is given | hb → subagent | — | give the reader the records | ✓ ~ |
| LB.8 | Study brief, record, reading list | outside:work + `finding` | subagent | — | — | o ✓ |
| LB.9 | Feedback: summary, usage, done | `computed` + waits:run-record | driver | — | — | ✓ ✗ |
| LB.10 | Retro of the first drive | outside:work + `finding` | driver | — | — | o ✓ |
| LB.11 | D-0004: add a Correctness surface | `decision` | driver for keeper | — | — | ✓ |
| LB.12 | E-0002 ticket and the article draft | waits:ask-of-task + outside:work | driver; subagent | done | — | ✗ o |
| LB.13 | First review, by an observing agent, relayed | waits:judgement + `finding` | agent via keeper | — | writer recorded | ✗ ✓ |
| LB.14 | v0.2 and the redrafted article | outside:work + structure:versions | subagent | — | — | o ✓ |
| LB.15 | R-0001: five must-fix | waits:judgement + `finding` | subagent → driver | done | — | ✗ ✓ |
| LB.16 | R-0002: two must-fix; fixed by the driver, "not re-reviewed"; released | waits:judgement + `finding` + need 5 + `decision` | subagent, driver | — | the reader sees all | ✗ ✓ ~ ✓ |
| LB.17 | Later exports reuse `LOCAL-n` identifiers | structure:ids | local Harbour | — | stable ids | ✓ |
| LB.18 | Later retellings on the site and in the programme | `computed` | later sessions | — | — | ✓ |
| LB.19 | LH016 item 13 wrong for lack of git history | outside:tooling | later agent | — | — | o |
| LB.20 | The record's header cites files later deleted | structure:link | subagent | — | links that resolve | ✓ |

## 3. The picture's items

### §1, the places: what each becomes

| ID | Place | On the frame | Fit |
|---|---|---|---|
| P1.1 | Ticket description | The task's ask as a fixed field, a link to its `plan` piece, and a `computed` view; nothing pruned | ✗ ✓ ✓ |
| P1.2 | Ticket comments | Each becomes the record it carries (`finding`, `plan` version, `decision`, a judgement), and the tracker shows a `computed` view | ✓ ✓ |
| P1.3 | Parent ticket | `plan` with versions; `ask`s to the lane; `finding`s addressed to it. The switchboard goes | ✓ |
| P1.4 | PR and commits | outside:work; the PR body is `computed` | o ✓ |
| P1.5 | Code and tests | outside:work; rules in code comments wait (lasting truth) | o ✗ |
| P1.6 | Area notes | Waiting entries become `finding`s; Lessons wait (lasting truth) | ~ ✗ |
| P1.7 | Other repository docs | Source and module maps wait (lasting truth); Periodical reports and evidence are outside:work | ✗ o |
| P1.8 | Harbour's stores | Rulings become `question`/`decision`; snapshots, structure:versions; dispatch, `who is working`; cost waits (run record); model routing waits (instruction); the brief cache is a read view | ✓ ✓ ✓ ✗ ✗ ~ |
| P1.9 | Sessions' final messages | The `question`'s content | ✓ |
| P1.10 | Standing text | Waits (instruction) | ✗ |
| P1.11 | Outside reach | outside:reach; the `check` reaches John | o ✓ |

### §2, each direction of travel as a path

| ID | Direction | Path on the frame | Fit |
|---|---|---|---|
| P2.1 | Down: copied whole, errors included | A child links to its piece of the current `plan`; nothing is copied, so a correction reaches every reader | ✓ |
| P2.2 | Up: corrections pile beside the source | A correction is the `plan`'s next version, with the reason; earlier versions are kept | ✓ |
| P2.3 | Across: nothing carries it but tickets and code | `ask` to a lane, `who is working` for overlap, `finding`s addressed to another lane. Rules found in code (T5.13) still wait | ✓ ✗ |
| P2.4 | Out of the task: into notes, or "to the person" | `finding` with an addressee and an end. But "the area's next task" is not running, so something must wake it | ~ |
| P2.5 | Out of reach: carried, not done | `check` to John; the system itself stays out of reach | ✓ o |
| P2.6 | Retold at every step | `computed`; no stage retypes another | ✓ |
| P2.7 | Written where no one checks | Need 5: the reader's view is drawn from everything written. No shape | ~ |

### §3 to §7

| ID | Item | On the frame | Fit |
|---|---|---|---|
| P3.1 | Standing text makes the person's calls | The decider of each `question` is a setting John controls (D6). A policy as decider stretches `decision` | ~ |
| P3.2 | The rules collide | One `question`, one decider | ✓ |
| P3.3 | Questions and answers on different tickets | A `decision` attaches to its `question`, wherever it is answered | ✓ |
| P4.1 | The autopilot holds the lane together | Summaries become `computed` and asks are woken by code. Its engineering calls stay `decision`s | ✓ ✓ |
| P4.2 | One near-deadlock broken by hand | outside:engine | o |
| P4.3 | John answers rulings late, and gets the checks no session can run | `question`, `check` | ✓ ✓ |
| P4.4 | Close-out writes under John's name | The writer is a field. The tracker's single account is outside the layer | ✓ o |
| P5.1 | Seven to nine sessions, each caching 63,000 to 97,000 tokens | What each reader is given: a read view, no shape | ~ |
| P5.2 | A child's start-up reading | A read view drawn from records | ~ |
| P5.3 | The ticket does five jobs | Split across `plan`, `finding`, `decision`, `computed`, structure:versions, and the task's ask (waits) | ✓ ✗ |
| P6.1 | The only memory is what is written | The layer is that memory. The cause stays; it gains a shape | ✓ |
| P6.2 | Rules send pieces to places with no end | Every shape has an end | ✓ |
| P6.3 | Sources are frozen by design | The `plan` is versioned; the task's ask stays fixed, but apart from the plan | ✓ ✗ |
| P6.4 | No path runs sideways or back | `ask`, addressees and links. Waking is still undesigned | ~ |
| P7.1 | Need 1: correction reaches the source | `plan` | ✓ |
| P7.2 | Need 2: a finding moves once, then ends | `finding` | ✓ |
| P7.3 | Need 3: John's checks as to-dos | `check` | ✓ |
| P7.4 | Need 4: one account of who decided | `question` / `decision` | ✓ |
| P7.5 | Need 5: the reader sees everything written | No shape | ~ |
| P7.6 | Need 6: parallel work learns of each other | `ask` + `who is working` | ✓ |

### §9, Lighthouse's results

| ID | Result | On the frame | Fit |
|---|---|---|---|
| P9.1 | Lists with no end grow; the checked list grows too, because closed rows stay | Ends on every shape. But closed records must leave what readers load, which is the read view again | ✓ ~ |
| P9.2 | Corrected in place; overwritten ledgers lose history | structure:versions | ✓ |
| P9.3 | One observation copied to six places | `computed` | ✓ |
| P9.4 | One owner-verification item carried | `check` | ✓ |
| P9.5 | Standing text chooses, and contradicts itself (two queues) | Waits (instruction). The contradiction itself is outside any shape | ✗ |
| P9.6 | Overlapping sessions both took LH051 | `who is working`, if it can refuse a second claim. Allocating identifiers is structure:ids | ✓ ✓ |
| P9.7 | A run reads 130 to 270 KB before work | Read view (no shape); standing text growth waits | ~ ✗ |
| P9.8 | The subagent got only the ticket text: "initiated by: unknown" | Read view, and the writer field | ~ ✓ |
| P9.9 | Unreviewed text reached the public site | Need 5, and a publish that waits on a judgement | ~ |

## 4. The routing rules: what each moves

What becomes of each rule is left to the design (`design-plan.md` §1).

| ID | Rule (as cited in the picture) | Moves what, from where to where |
|---|---|---|
| R1 | `LEFTOVER_RULE` (`lib/prompts/leftover-words.js:41`) | A larger find, from a build to an area note's Waiting list |
| R2 | `CONSEQUENCE_TEST` (`:58`) | A find, from a build to a ticket, only if it breaks, blocks or touches safety |
| R3 | `RETIRES_LABEL`, `RETIRES_NONE`; "Then settle one waiting entry" (`lib/dispatch-leftover.js:152`) | One Waiting entry out of a note, through each build |
| R4 | "mint no follow-up tasks"; "to the person, never to a ticket" (`lib/periodicals.js:362,365`) | A Periodical's finds, into the report or a closing comment for John |
| R5 | "record it as not run … then close" (`lib/prompt-template-defs.js:1062`) | A check needing John's systems, into close-out's comment, onward as text |
| R6 | "change course and say so on the parent" (breakdown, `:335`, `:435`) | A correction, from a child up to a comment beside the parent's plan |
| R7 | "the specific files, the approach, and the testing strategy" copied into each child (`:431` at `e666c4b`) | A slice of the plan, from the parent down into the child's sealed ask |
| R8 | The close-out prune (`:869-872`) | The plan and findings, from the tracker into the snapshot archive |
| R9 | The blind read's excluded paths (`:1072`) | Nothing. It keeps the notes and docs out of the outside reader's view |
| R10 | "Nobody reviews what you change after the approval" (`:833`) | Nothing. Close-out's own changes stay out of any reader's view |
| R11 | "Post no comment … your reasoning goes in your final message" (`:492`) | Scoping's reasoning, into its final message only |
| R12 | "Decided by: the standing policy", err larger (`lib/size-of-move.js:12`) | The person's size call, to a built-in policy |
| R13 | "it's yours — answer it" (`docs/autopilot-operating-manual.md:446`) | Engineering questions, to the autopilot |
| R14 | Any clause not delivered in full is a cut only John rules on (`lib/prompts/stage-kinds.js:27`) | A narrowed clause, to John as a ruling |
| R15 | Rulings keyed by the session's loop (`lib/unanswered-decisions.js:33-38`) | An answer, to wherever the asking loop sits, not to the task asked about |
| R16 | A snapshot saved on brief and recap reads (`routes/proxy-compute.js:1373`) | The ticket's text, into the archive, as a side effect of reading |
| R17 | An unmapped path takes the area of the code it concerns (`lib/prompts/leftover-words.js:42`) | A find about a test file, to whichever area registry maps it |

On the frame:
- R1 to R5 and R17 are all one move: a `finding` or `check` to an addressee.
- R6 and R7 are the `plan`'s versions and links.
- R8 and R16 are structure:versions.
- R9 and R10 are need 5.
- R11, R12, R13 and R15 are the `question`'s content, decider and anchor.
- R14 is a decider rule that collides with R13.

All 17 land somewhere. Five of them (R12 to R15, and the size policy behind R12) are about who decides, which the frame holds only as a setting.

## 5. The actors: what each reads and writes

| ID | Actor | Writes on the frame | Reads |
|---|---|---|---|
| A1 | survey-task | `finding`s to scoping and the build; `check`s for John | The task's ask, its `plan` piece, the code |
| A2 | survey-place | `finding`s, some for the area's future; corrections to lasting truths | The same, plus area notes |
| A3 | scoping | `decision` (size); `question`s to a decider, with reasoning | The ask, `plan`, `finding`s |
| A4 | plan / design | `plan` | The ask, `finding`s, `decision`s |
| A5 | plan-review | A judgement on a `plan` version; `finding`s to builders | `plan` |
| A6 | breakdown | `plan` pieces; new tasks; links; re-addressed `finding`s; `question`s | `plan`, judgement |
| A7 | build | Outside:work; `plan` versions (departures); `finding`s; lasting truths in notes and code | Its `plan` piece, `finding`s, `decision`s |
| A8 | leftover run | Outside:work; `finding` ends and new ones; lessons | `finding`s for the area |
| A9 | review | A judgement on a head; `finding`s (the ledger); `check`s | The change, the ask, `plan`, `decision`s |
| A10 | blind read | A judgement; `finding`s | The diff only, by design |
| A11 | close-out | Outside:work (merges, fixes); `check`s; `finding`s; `computed` stubs | Judgements, ledger, `check`s |
| A12 | autopilot | `decision`s (engineering calls); `question`s; `finding`s about the engine; `computed` summaries | Everything on its lane |
| A13 | Periodical research and minting | The task's ask (minting); outside:work (the report); `finding`s, many for John | Code, area notes, the previous run |
| A14 | Harbour's model calls (brief, recommend, selector) | Read views (brief); the route choice | Records |
| A15 | Harbour's code (gates, rulings, snapshots, routing) | structure:versions; `who is working`; gate verdicts | Checked fields |
| A16 | John | `decision`s; the task's ask; instructions | `question`s, `check`s, `finding`s |
| A17 | The tracker | Nothing, if it shows a `computed` view | — |
| A18 | GitHub and CI | Outside:work | — |
| A19 | Lighthouse's driver, subagents and keeper | Its rows, checkpoints, ledgers, decisions | Standing text, rows, briefs |

## 6. The waiting pieces, grouped

*Grouped only after every row above was placed, looking for repeating shapes (words §9).*

A script counted the `waits:` tags across §1 and §2 (§11). Each group below is a candidate shape. None is adopted; the design decides.

1. **The task's own ask**, tagged `waits:ask-of-task`, 19 parts.
   - What is in it: the order in the person's words, or an agent's slice; its kind (a Periodical's gate marker); its window and state (Lighthouse's rows); "Session fit".
   - It differs from §6's `ask`, which is a request to a lane. It is fixed by design, but John's words in it sit beside an agent's (T1.2).
   - The frame needs it as something every other record attaches to. **Candidate: a task item**, with the person's words kept apart from any agent's.
2. **A judgement on one version of something**, tagged `waits:judgement`, 27 parts.
   - What it covers: review, blind read, plan review, the Periodical's second read, Lighthouse's editor and R-reviews.
   - Each has a fixed set of verdicts and a ledger of conditions (which are `finding`s), and it goes stale when its subject moves (T6.17, T6.28).
   - Code already reads two of them as checked fields: the second read's three fields, and close-out's verdict check.
   - **Candidate: a verdict**, tied to the version it judged.
3. **A lasting truth about the code**, tagged `waits:lasting-truth`, 15 parts.
   - What it covers: the notes' Lessons, rules in code comments and test headers, the source map and module map, and the written rule in a size record.
   - It has no single addressee, and it ends only when superseded or when the code changes under it (T2.18, T2.30, T3.19).
   - It is what travelled across in trace 5, by being read in code.
   - **Candidate: a lesson** (or rule), with the code it is about linked, so a change there can flag it.
4. **An instruction to the processing components**, tagged `waits:instruction`, 12 parts.
   - What it covers: directions in a task's ask ("settle engineering questions yourself"), "say so on the parent", model routing, the drive skill's model choice, `AGENTS.md`, SD's README rule.
   - Two kinds are mixed here:
     - Settings, such as who decides or which model, which John can hold as data (D6: "Settings provides a nice few options").
     - The prompt text itself, which is the program the components run.
   - **Candidate: a setting**, for the first kind. The prompt text is outside.
5. **A record of a run**, tagged `waits:run-record`, 9 parts.
   - What it covers: cost, model, requests, timing, and Lighthouse's run and cost ledgers.
   - It is the history of `who is working`, which is a live view of the same thing.
   - **Candidate: fold `who is working` into a run record**, with the live view computed from it.
6. **A value measured from the code at a commit**, tagged `waits:measured-value`, 8 parts.
   - What it covers: the census, byte budgets, test counts, the repeat area reading, and the cross-repo sha.
   - Copied, these drift (picture §2), but they come from the code, not from records.
   - **Candidate: a measure**, a value with the commit it was taken at, never retyped.
7. **The place itself**, tagged `waits:place`, 3 parts.
   - What it covers: `areas.json`, a find about an unmapped path, an area move.
   - Small in count, but larger in reach. A `finding` "for the area's future" (T1.5, T1.11, T3.37) needs an addressee, and the area is that addressee. "Nobody's job is the place" (`tasks-are-tasks.md:15`, situation §6).
   - **Candidate: an area**, which findings and lessons are addressed to, and which something must wake.

## 7. Overlap, and a shape that takes unlike pieces

- **Overlap is common.** 122 of the 220 rows in §1 and §2 land on more than one place (§11). For example:
  - A review is a judgement, plus `finding`s, plus `check`s.
  - A close-out is `computed`, plus `check`s, plus need 5.
  - A breakdown is `plan` pieces, plus new tasks, plus links, plus re-addressed `finding`s.

  So one piece of writing usually carries several records. The overlap is the point John's Venn diagram made (words §2): today one comment holds them all, which is why one place does several jobs.
- **Duplicates.** The same finding arrives more than once:
  - two surveys "in almost the same words" (T2.10)
  - a blind read repeating a survey (T1.13)
  - two lanes filing the same decision (T4.20, T4.23)

  The frame says "linked rather than copied" (shapes §6), but nothing in it notices a duplicate. Matching a new record to an existing one is work for an LLM component, and it is undesigned.
- **`finding` takes unlike pieces.** It holds:
  - points consumed inside the task, whose addressee is running
  - Waiting entries for an area's future, whose addressee is not running
  - finds for John
  - notes about the engine
  - conditions passed to another task

  Structurally they are one shape. They differ in whether the addressee will be woken, which is shapes §1.1's pull-versus-pile line. The split is in the addressee, not the shape. That is one more reason for an area (group 7) that something wakes.
- **Questions filed as findings.** Three Waiting entries are really calls waiting on a decider (T3.30, T4.20, T5.22). On the frame they are `question`s.
- **The name `ask`.** §6's `ask` (a request to a lane) and "the ask" (the task's order) collide in every trace. One of them needs another name in the design.

## 8. What does not fit

Listed plainly. "Outside by design" means the frame should not carry it. "Waits" means it should, but no shape yet does.

**Outside by design:**
- **The change itself:** code, tests, commits, the PR's diff, CI, merges, deploys, reports and evidence as work products, Lighthouse's data and articles. After `finding`, it is the commonest landing: 37 of the 220 rows touch it (§11). It sits beside the layer, and records link to it.
- **Engine rules.** The near-deadlock (T6.28, T6.29), the selector choosing review on a parent with no PR (T6.16), surveys skipped (T6.22), and an answer waking a finished session (T3.21). These come from rules of Harbour's engine, not from information moving. The frame changes none of them, though the autopilot's notes about them are `finding`s.
- **Systems out of reach:** John's Jira, signed-in browsers, production logs. The `check` reaches John, but the system stays out of reach.
- **The prompt text itself:** the program the components run. Its growth and self-contradiction (picture §9 #5, #7) need some other cure.
- **The tracker's one account.** Every comment shows John (P4.4). The layer can hold the true writer, but how the tracker displays it is outside.
- **Tooling:** shallow clone history (LB.19).

**Waits** (§6): seven groups. In count order: judgements, the task's ask, lasting truths, instructions, run records, measures, the place.

**Not a shape at all:**
- **Need 5** (P7.5): what a reader sees is a view over everything written.
- **What each reader is given** (P5.1, P5.2, P9.7, LB.7): the read side, where "a task carries a lot" lives.
- **Waking:** how an addressee that isn't running, such as an area or "the next run", gets woken.
- **Duplicates** (§7).

These four are where the design has most to do. The frame names none of them.

**The leak itself.** Is it outside the frame? No. Each of the seven directions and the four causes lands on a shape or a path (§3), except waking and the read view, which belong to the design, not to missing shapes. So the frame carries the leak's core. What it doesn't yet carry is mostly at its edges (engine, reach, work product), plus the seven waiting groups [my reading]. `design-plan.md` asked me to stop if the misfits included a large part of the leak; they don't, so I don't stop.

## 9. Against the expectations

`design-expectations.md` §1 is marked there, under its predictions.

## 10. What this hands the avenues

No design, only what the avenues must now carry [my reading]:
- **Seven candidate shapes beside the six:** task, verdict, lesson, setting, run record, measure, area. Each needs a yes or no.
- **Four things that are not shapes:** waking, the read view, need 5, and duplicates.
- **Two naming points:** `ask` against the task's ask, and `who is working` against a run record.
- **One boundary:** where the layer meets the work product (code, PRs, reports), which most rows touch.

## 11. Counts

*Computed by script from §1 and §2 (a script in the session scratchpad, not in the repository, which also takes the expected IDs from the traces and the Lighthouse notes). Rerun on any change.*

- **Complete.** 303 items expected, 303 found, none missing, none repeated:
  - the 179 trace rows, taken from the traces themselves
  - the 41 Lighthouse rows, from the reader's notes
  - 47 picture items
  - 17 routing rules
  - 19 actors
- **Evidence rows** (the traces and Lighthouse): 220, holding 372 placed parts. 122 rows land on more than one place.
- **Fit marks:** 192 ✓, 45 ~, 92 ✗, 43 o.
- **Rows by fit:**
  - 83 rows fit cleanly in every part.
  - 109 rows fit cleanly or sit outside by design.
  - 81 rows have a waiting part.
  - 11 rows are wholly outside the frame. 43 touch outside somewhere, 37 of them through the work product.
- **Landings by place:**

  | Place | Parts |
  |---|---|
  | `finding` | 74 |
  | outside:work | 37 |
  | `computed` | 36 |
  | `plan` | 28 |
  | waits:judgement | 27 |
  | `decision` | 23 |
  | waits:ask-of-task | 19 |
  | `question` | 18 |
  | waits:lasting-truth | 15 |
  | waits:instruction | 12 |
  | `who is working` | 11 |
  | structure:versions | 10 |
  | `check` | 9 |
  | waits:run-record | 9 |
  | structure:link | 9 |
  | need 5 / read view | 9 |
  | waits:measured-value | 8 |
  | `ask` | 5 |
  | outside:engine | 5 |
  | structure:ids | 4 |
  | waits:place | 3 |
  | outside:tooling | 1 |

- **Rows with a waiting part, by source:**
  - The six traces: T1 7 of 16, T2 14 of 34, T3 15 of 37, T4 8 of 28, T5 13 of 30, T6 11 of 34.
  - Lighthouse: A 6 of 21, B 7 of 20.
