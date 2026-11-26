# Spike 3: slice 5, lessons as records

*26 Nov. Read-only. Code at main `5c33e4415` (25 Nov 17:52, the latest commit).
Live records read through the proxy on 26 Nov. Marks: **shown** (with where),
**unknown**, or *my reading*. "The design" is `integration/design.md`.*

## 1. Is the problem still real? Yes, in a new shape

- **Shown.** Bytes of notes (`docs/areas/*.md` without the README), from git:
  14 Nov 95,589 B (Lessons plus Waiting) → 19 Nov, end, 42,428 B (LIN-4495 took out Waiting)
  → 24 Nov 00:00 49,311 B → 25 Nov 17:52 53,955 B.
- **Shown.** The Lessons sections alone: 32.5 KB on 14 Nov, 33.0 KB on 19 Nov, 51.8 KB now.
  That is +57% in six days, while slices 1–4 ran. 139 bullets in 13 notes.
- **Shown.** Growth now runs into a cap. Since LIN-4414 (12 Nov), each note's Lessons section
  is capped at 6,144 B (`tests/unit/area-notes.test.js`, check 4). 7 of 13 notes sit within 180 B of it.
  front-end-pages went from 1,536 B to 6,143 B in 22–25 Nov. So growth shows as churn:
  +267 and −160 lines over 45 commits since 19 Nov. Each new lesson squeezes or prunes old ones.
- **Shown.** Lessons are already in two homes. Three `lesson` records hold:
  lesson-0df4a476 and lesson-4529dd00 (leftover, 22 Nov) and lesson-c4fd2623 (close-out, 25 Nov).
  None is in a note. Each was written while its note was at 6,141–6,143 B. *My reading:* they overflowed the cap.
- **Shown.** Lessons serve real decisions. 24 of 80 plan records mention a lesson, and 17 cite `docs/areas/`.
  One has the heading "Lessons that bind this work" (plan-c8c68fff). So this reader stays; only its home changes.
- Slice 1 moved Waiting (known work) out, so John's 14 Nov problem (journey.md:24) is half fixed.
  The Lessons half is still steering text with no end, and it gets shorter only when someone deletes.

## 2. What the design says, and does it still fit?

- **The design** (slice 5 row, design.md:199, :207; also §8 and §9):
  - a lesson is a project record with `says`, and the notes' Lessons are imported;
  - in the same move: the notes, the pointer and its tests, the registry path's prompt readers, the files;
  - witness: a lesson written in one task is counted in a later task's part 5 and found there by text;
  - reading: Lessons bytes; lessons shown on the project page.
- **It mostly fits.** The lesson kind is only `says`, with no area or path (`lib/records/kinds.json:84-92`).
  The store already writes and finds lessons. Part 5 already gives a count and a lookup
  (`lib/records/brief.js:125-128, 162`). The task page can supersede a lesson (`routes/task-records.js:7, 212`).
- **Corrections, all shown:**
  1. **The row names no writer.** The leftover step still says "add under `## Lessons` in
     `docs/areas/<slug>.md`" (`lib/dispatch-leftover.js:147`). Moving it is the core of the slice.
  2. **"The registry path's prompt readers" now reaches too far.** The registry stays (design §9).
     It still serves the blind read's in-area rule (`lib/prompt-template-defs.js:1032-1040`), the finding
     wording (`lib/prompts/leftover-words.js:40`) and the code-shape kit. Only the notes pointer's use goes.
  3. **Part 5 undercounts.** `composeTaskBrief` never fetches lessons (`lib/records/run-brief.js:45-52`).
     It counts only lessons in the task and its ancestors. Live: LIN-4568's brief says "0 lessons hold"
     while 3 hold. The design's witness would fail today, which gives a ready failing test.
  4. **The lookup hint is the walk model's syntax** (`find --kind lesson …`), not the route agents call
     (`GET /api/proxy/records?kind=lesson&state=holds&text=`).
  5. **The project page shows no lessons yet** (`lib/render-project-page.js` has none).

## 3. Every reader and writer to move or retire (main `5c33e4415`)

- **Writer.** `lib/dispatch-leftover.js:147`: the only prompt that tells anyone to write notes.
  → Write a `lesson` record. Close-out (C5-A11) and the Periodicals (C5-A15) no longer write notes.
  Only names are stale: the Periodicals' `notes: true` and `areaNotes()` (`lib/periodicals.js:236-255, 357-366`).
- **The pointer.** `lib/prompt-formatters.js:14-15, 555-569, 575-577, 598-602`. Given to 8 stages through
  `grounding` (`lib/prompts/stage-kinds.js:76` bug, `:103` plan, `:213` research, `:239` scoping,
  `:266` design, `:294` spike, `:381` implementation, `:410` review). It serves "read the lessons before
  you change code". → Retire it; part 5 carries the count and the lookup.
- **The blind read's notes exclusions.** `lib/prompt-template-defs.js:1030` and `lib/prompts/stage-kinds.js:580`.
  → They go with the files.
- **A dead path: the audit's notes PR** (LIN-4432). Since LIN-4495, the audit "opens no pull request and
  writes no note" (`lib/prompt-template-defs.js:873`). Its own workflow still says "Notes pull request"
  (`:846-847`), and routing still serves one:
  - `:789`; `lib/prompts/stage-kinds.js:439, 470`;
  - `lib/records/standing.js:119-124, 196-197, 237`; `lib/run-closeout-state.js:244, 292`;
  - `lib/recommendation-blind-read.js:18-19`; `lib/recommendation-re-review.js:16`; `lib/pipeline-churn.js:237`;
  - `tests/unit/lin-4432-audit-notes-pr.test.js`.

  0 of 80 live change records came from an audit. → Retire it, but keep `auditAfterCloseOut`,
  which still stops a second audit on one landing.
- **The files.** The 13 notes (53,955 B) and the README's note sections; the registry part stays.
  `lib/prompts/area-note-format.js` is read only by tests. `area-registry-path.js` stays.
- **Tests.** `area-notes.test.js` (the guard and the cap), `lin-4377-area-notes-pointer-bytes`,
  `lin-4346-scoping-area-notes`, the notes half of `lin-4470-note-leaves`, `area-map-placement.test.js:128-134`,
  and the pointer wording in `prompt-templates.test.js` and `lin-4373-leftover-step.test.js:749`.
- **Citations.** 98 lines in 21 files cite a note file. `CLAUDE.md:43, 109` are among them, and
  CLAUDE.md is at 11,988 of its 12,000 B. Each one is repointed to the code or to a lesson id.
- At run time, nothing in Harbour reads the notes; only agents (through git) and tests do.

## 4. The smallest slice 5

1. **Lessons reach every brief.** Part 5 counts the project's holding lessons, and its hint names
   the real route. Built test-first on §2 item 3.
2. **The writer moves.** The leftover step writes a `lesson` record `in` its task, only for what no
   test or site comment can hold (CLAUDE.md:110).
3. **A one-off import.** The 139 bullets become `lesson` records, `via: import`, with the note's name
   in `says`, as slice 1 did with Waiting.
4. **The project page** lists the holding lessons, with supersede and disprove, as the task page does.
5. **Retired in the same move:** everything in §3.

**Size,** *my reading:* 3 or 4 pieces, against 15 for slice 4 and 6 for slice 2:
- (a) the brief, the writer, the pointer and the page;
- (b) the import, the files, the guards and the citations;
- (c) the audit's notes-PR path;
- (d) a simple-dispatcher piece, if John says yes to Q2.

No new edge into Records (design §11 item 6).

## 5. Overlap

- **Slice 6 (wakes): none.** A lesson has no `to`, and records to `project` wake nothing (design §6).
- **The clean-up ticket.** The audit's notes-PR path and the Periodicals' `notes` names could go in
  either ticket. *Proposed:* slice 5 takes them, since notes are their only reason to exist.
- **"Project findings nothing reads"** (shown):
  - 371 open of 411 addressed to `project`; 22 done and 14 declined;
  - 169 of the open ones from the blind read;
  - about 45 added a day since 22 Nov.

  Lessons as records risk a second unread pile: about 142, with no cap and only a count in each brief.
  A lesson is reference, not work, so it is a different problem: don't merge it in, but measure it (§6).
  The project page is shared ground.

## 6. Witness and readings

- **Witness (unit, failing then passing):** a lesson `in` task A appears in task B's part 5 count,
  and B finds it by a word from its `says`. It fails today (§2 item 3).
- **Witness (live):** the first suitable task after deploy cites a lesson record by id, or writes one.
- **Before** (now, shown): 53,955 B of notes; 51,810 B of Lessons; 139 bullets; 7 of 13 at the cap;
  3 lesson records; 24 of 80 plans mention a lesson; part 5 says "0 lessons hold".
- **After:** 0 B of notes; about 142 holding lessons, counted correctly; the share of plans citing a
  lesson; lessons written per merged task. Lesson queries per run come from `records-query-log`,
  production only (**unknown** today). Report any lesson that cites a missing path, never gated.
  That replaces the guard's path check.

## 7. What could change the plan

- **Most lessons may not belong in records.** Three in four are at least partly held by a check, and a
  third fully (`docs/papers/harbour/beyond-the-code.md:30-45, 211-219`). The paper puts a trap in a test,
  a home in a census, a reason in a decision. Importing all 139 makes second copies. That argues for a
  "test first" writer rule, not a bigger slice.
- **Search alone may stop lessons being read.** Today 8 stages are told to read them. Afterwards there is
  only a count and a substring search (`lib/records-store.js:181-186`). If the share of plans citing a
  lesson falls, add a one-line index of lessons to the plan and implementation briefs.
- **simple-dispatcher keeps notes too.** Shown: 6 notes plus a README, about 13 KB, still with
  `## Waiting` (finding-8939773c). Harbour's pointer covers its work ("names no repository",
  `lib/prompt-formatters.js:561`), so retiring the pointer leaves them unread.
- **No reason found to merge slice 5 with slice 6 or the clean-up.** It is smaller than the design
  implied, because the store already does most of it.

## 8. For John (one line each, with a proposed answer)

1. Import all 139 Lessons, or only those no test holds? *Proposed: all, unsorted; the writer rule stops new copies.*
2. Retire simple-dispatcher's notes in the same move (Lessons as lessons, Waiting as project findings)? *Proposed: yes, as a last piece, as slice 4 did.*
3. Should lessons keep a cap when the notes cap goes? *Proposed: no cap; report the count each slice, never gate it.*
4. Lessons on the project page (design §8)? *Proposed: yes, a plain list with supersede and disprove.*
