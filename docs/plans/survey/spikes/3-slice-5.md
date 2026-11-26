# Spike 3: slice 5, lessons as records

*26 Nov. Read-only. Code at main `5c33e4415` (25 Nov 17:52, the latest commit).
Live records read through the proxy on 26 Nov. Marks: **shown** (with where),
**unknown**, or *my reading*. "The design" is `integration/design.md`.*

## 1. Is the problem still real? Yes, in a new shape

- **Shown.** Bytes of notes (`docs/areas/*.md` without the README), from git:
  | When (UTC) | Commit | Notes | What happened |
  |---|---|---|---|
  | 14 Nov | `6f6c5d2e2` | 95,589 B | Lessons plus Waiting |
  | 19 Nov, end | `e942c1031` | 42,428 B | LIN-4495 took out Waiting |
  | 24 Nov 00:00 | `d0e013d45` | 49,311 B | |
  | 25 Nov 17:52 | `5c33e4415` | 53,955 B | main today |
- **Shown.** The Lessons sections alone: 32.5 KB on 14 Nov, 33.0 KB on 19 Nov,
  51.8 KB now. That is +57% in six days, while slices 1–4 ran. 139 bullets in 13 notes.
- **Shown.** Growth now runs into a cap. Since LIN-4414 (12 Nov), each note's Lessons
  section is capped at 6,144 B (`tests/unit/area-notes.test.js`, check 4).
  7 of the 13 notes sit within 180 B of that cap. front-end-pages went from 1,536 B
  to 6,143 B between 22 and 25 Nov. The ceiling is about 80 KB (13 × 6,144).
- **Shown.** So growth now shows up as churn: +267 and −160 lines in `docs/areas/` since
  19 Nov, across 45 commits. Each new lesson now has to squeeze or prune old ones.
- **Shown.** Lessons are already in two homes. Three `lesson` records hold in the store:
  lesson-0df4a476 and lesson-4529dd00 (leftover, 22 Nov) and lesson-c4fd2623
  (close-out, 25 Nov). None of the three is in a note. Each was written while its note was
  at 6,141–6,143 B. *My reading:* they overflowed the cap.
- **Shown.** Lessons serve real decisions. 24 of 80 plan records mention a lesson, and
  17 cite `docs/areas/`. One example has a heading, "Lessons that bind this work" (plan-c8c68fff).
  This reader stays. Only its home changes.
- What John saw on 14 Nov (journey.md:24) is half fixed. Slice 1 moved Waiting (known work) out.
  The Lessons half is still steering text with no end, and it gets shorter only when someone deletes.

## 2. What the design says, and does it still fit?

- **The design, slice 5 row (design.md:199, :207):**
  - a lesson becomes a project record with `says`, and the notes' Lessons are imported;
  - in the same move it retires the notes, the pointer and its tests, the prompt readers
    of the registry path, and the notes files;
  - witness: a lesson written in one task is counted in a later task's part 5, and found
    there with `--text`;
  - reading: Lessons bytes. §8 adds lessons to the project page, and §9 says lessons are imported.
- **It mostly fits.** The lesson kind is only `says`, with no area and no path
  (`lib/records/kinds.json:84-92`), so removing areas costs it nothing. The store
  already writes and finds lessons. The brief's part 5 already gives a count and a
  lookup (`lib/records/brief.js:125-128, 162`). The task page can supersede a lesson
  (`routes/task-records.js:7, 212`).
- **Corrections, all shown:**
  1. **The row names no writer.** The leftover step still says "add under `## Lessons` in
     `docs/areas/<slug>.md`" (`lib/dispatch-leftover.js:147`). Moving it is the core of the slice.
  2. **"The prompt readers of the registry path" now reaches too far.** The registry stays (design §9).
     It still serves the blind read's in-area or outside rule (`lib/prompt-template-defs.js:1032-1040`),
     the finding wording (`CONSEQUENCE_TEST`, `lib/prompts/leftover-words.js:40`) and the
     code-shape kit. Only the notes pointer's use goes.
  3. **Part 5 undercounts.** `composeTaskBrief` never fetches lessons
     (`lib/records/run-brief.js:45-52`). It counts only lessons in the task and its ancestors.
     Live: LIN-4568's brief says "0 lessons hold" while 3 hold. So the design's witness would
     fail today. That gives a ready failing test.
  4. **The lookup hint uses the walk model's command syntax** (`find --kind lesson …`), not the
     route agents call (`GET /api/proxy/records?kind=lesson&state=holds&text=`).
  5. **The project page shows no lessons yet** (`lib/render-project-page.js` has none).

## 3. Every reader and writer slice 5 moves or retires (main `5c33e4415`)

**Writers**
- `lib/dispatch-leftover.js:147`: the leftover step writes Lessons into notes.
  → Move it: write a `lesson` record. The only prompt that tells anyone to write notes.
- Close-out (C5-A11) and the Periodicals (C5-A15) already write no notes. The Periodicals'
  `notes: true` flag and `areaNotes()` (`lib/periodicals.js:236-255, 357-366`) now mean
  "record findings". Only the names are stale.

**Readers (prompt)**
- `lib/prompt-formatters.js:14-15, 555-569, 575-577, 598-602`: the "Area Notes" pointer and the
  scoping variant, given to 8 stages through `grounding` (`lib/prompts/stage-kinds.js:76` bug,
  `:103` plan, `:213` research, `:239` scoping, `:266` design, `:294` spike, `:381`
  implementation, `:410` review). It serves "read the lessons before you change code".
  → Retire it. Part 5 carries the count and the lookup. Keep scoping's one sentence on weighing
  Periodical findings if it is still needed.
- The blind read's notes exclusions: `lib/prompt-template-defs.js:1030` (`:(exclude)docs/areas/*.md`)
  and `lib/prompts/stage-kinds.js:580` ("…area notes…"). → They go with the files.

**A dead path: the audit's notes PR** (LIN-4432, 12 Nov)
- The audit now "opens no pull request and writes no note" (`lib/prompt-template-defs.js:873`,
  since LIN-4495). Its workflow still says "Notes pull request" (`:846-847`), which contradicts that.
- The routing still serves a notes PR: `:789`; `lib/prompts/stage-kinds.js:439, 470`;
  `lib/records/standing.js:119-124, 196-197, 237`; `lib/run-closeout-state.js:244, 292`;
  `lib/recommendation-blind-read.js:18-19`; `lib/recommendation-re-review.js:16`;
  `lib/pipeline-churn.js:237`; `tests/unit/lin-4432-audit-notes-pr.test.js`.
- No live change record was written by an audit (0 of 80, shown). → Retire it. Keep
  `auditAfterCloseOut`, which still stops a second audit on a landing.

**Files, the leaf and the guards**
- `docs/areas/<slug>.md` × 13 (53,955 B). The README's note sections go; its registry part stays.
- `lib/prompts/area-note-format.js` (49 lines; read only by tests).
- `lib/prompts/area-registry-path.js:10-15` stays (the registry). `NOTES_DIR` keeps its now-odd name.
- Tests: `area-notes.test.js` (the guard and cap), `lin-4377-area-notes-pointer-bytes.test.js`,
  `lin-4346-scoping-area-notes.test.js`, the notes half of `lin-4470-note-leaves.test.js`, and the
  pointer's row in `area-map-placement.test.js:128-134`. Also the pointer wording in
  `prompt-templates.test.js` and `lin-4373-leftover-step.test.js:749`.
- 98 lines in 21 files cite a note file (shown by grep), `CLAUDE.md:43, 109` among them.
  CLAUDE.md is at 11,988 of 12,000 B, so cutting there helps. Each citation is repointed
  to the code, or to the lesson's id.
- Nothing in Harbour reads the notes at run time. Only agents, through git, and the tests do (shown).

## 4. The smallest slice 5

1. **Lessons reach every brief.** Part 5 counts the project's holding lessons, and its hint
   names the real route. Built test-first, on the defect in §2.3.
2. **The writer moves.** The leftover step writes a `lesson` record, `in` its task. Per
   CLAUDE.md:110, it writes one only for what no test or site comment can hold.
3. **The import runs once.** The 139 bullets become `lesson` records, `via: import`, with the
   note's name kept in `says`. This is how slice 1 imported Waiting.
4. **The project page lists the lessons that hold**, with supersede and disprove, as the task page does.
5. **Retired in the same move:** everything in §3 (writer text, pointer, files, leaf, guards,
   cap, citations, the audit's notes-PR path).

**Size, my reading:** 3 or 4 pieces against slice 4's 15. Smaller than slice 2's 6.
- (a) the brief, the writer, the pointer and the page;
- (b) the import, the files, the guards and the citations;
- (c) the audit's notes-PR path;
- (d) a simple-dispatcher piece, if John says yes to Q2.

No new edge into Records (design §11 item 6).

## 5. Overlap with other planned work

- **Slice 6 (wakes): none.** A lesson has no `to`, and records to `project` wake nothing (design §6).
- **The clean-up ticket.** The audit's notes-PR path and the Periodicals' `notes` names could
  sit in either ticket. *Proposed:* slice 5 takes both, since they exist only because of notes,
  and the clean-up spike drops them.
- **"Project findings nothing reads"** (shown):
  - 371 open of 411 addressed to `project`; 22 done and 14 declined;
  - 169 of the open ones come from the blind read;
  - about 45 are added a day since 22 Nov.
  
  Lessons-as-records could become a second unread pile: about 142 records, with no cap and
  only a count in each brief. A lesson is reference, not work, so this is a different problem.
  Don't merge it in. Do measure it (§6). The project page's lessons list sits beside the
  backlog list, so the page work is shared.

## 6. Witness and readings

- **Witness (unit, failing then passing):** a lesson written `in` task A shows up in task B's part 5
  count, and B finds it by a word from its `says`. Today it fails (§2.3).
- **Witness (live):** the first suitable task after deploy has a plan or build that cites a
  lesson record by id, or writes one.
- **Before** (now, all shown): 53,955 B of notes; 51,810 B of Lessons; 139 bullets; 7 of 13 notes
  at the cap; 3 lesson records; 24 of 80 plans mention a lesson; part 5 says "0 lessons hold".
- **After:** notes bytes 0; holding lessons about 142, counted correctly in part 5; the share
  of plans that cite a lesson; lessons written per merged task.
- **Also after:** lesson queries per run, from `records-query-log`. Production only, so
  **unknown** today. Lessons that cite a path that no longer exists, computed and reported,
  never gated. This replaces the guard's path check.

## 7. What could change the plan

- **Most lessons may not belong in records at all.** Three in four Lessons are at least partly
  held by a check, and a third fully (`docs/papers/harbour/beyond-the-code.md:30-45, 211-219`).
  The paper puts a trap in a test, a home in a census and a reason in a decision record.
  Importing all 139 copies them a second time. That argues for a writer rule of "a test
  first", not a bigger slice.
- **Search alone may stop lessons being read.** Today 8 stages are told to read them. Afterwards
  they only get a count and a substring search (`lib/records-store.js:181-186`). If the
  share of plans citing a lesson falls, add an index line per lesson to plan and implementation briefs.
- **simple-dispatcher keeps notes too** (shown: 6 notes and a README, about 13 KB, and still with
  `## Waiting`; finding-8939773c). Harbour's pointer covers its work ("names no repository",
  `lib/prompt-formatters.js:561`), so retiring the pointer leaves them unread.
- **Nothing here argues for merging slice 5 with slice 6 or the clean-up.** It is smaller than the
  design implied, because the store already does most of it.

## 8. For John (product calls, one line each, with a proposed answer)

1. Import all 139 Lessons, or only the ones no test holds? *Proposed: import all, unsorted; the writer rule stops new copies.*
2. Retire simple-dispatcher's notes in the same move (Lessons as lessons, Waiting as project findings)? *Proposed: yes, as a last piece, as slice 4 did.*
3. Should lessons keep a cap now that the notes cap goes? *Proposed: no cap; report the count each slice, never gate it.*
4. Lessons on the project page (design §8)? *Proposed: yes, a plain list with supersede and disprove.*
