# What the layer and the integration assume about the target repo or tracker

*Fresh read, 18 Nov, of `layer/design.md` (approved), `integration/design.md` (draft 2) and `checks/placement.md`, against the census and main at `6f6c5d2`. Code written into Harbour's own source is fine. This lists what the loop or the layer needs to exist in, or be laid out a certain way in, the repo or tracker the loop works on. Classes: **H** works only for Harbour's repo; **R** needs something most repos won't have in that form; **T** needs a particular tracker or git host shape; **G** general.*

## Table

| id | where | assumes | class | when it fails | general alternative |
|---|---|---|---|---|---|
| A1 | Int §9 "Area records come from `docs/areas/areas.json`", regexes turned into prefixes by hand for 13 areas | The target has a hand-kept area registry | H | Elsewhere there are no area records. Everything in A3–A11 then finds nothing. Silent | Drop the import and area records |
| A2 | Int §9 "A unit test checks that each pattern still matches its record's paths"; placement C5-A19/A20 "Keep" | Area records and `areas.json` stay in step | H | Harmless to others. It ties a general store to one repo's file | Drop the test. Harbour's own scripts keep reading `areas.json` from git as today [checked: C5-A20] |
| A3 | Layer §3.2 `area` kind {`name`, `paths`}; "Paths overlap … on whole segments" (l.82) | A repo divides into named path prefixes | R | Most repos have none. The Yap walk invented "area 4 (one per file touched)" [checked: `walks/7/yap/notes.md`], so it never tested this | Drop the kind. If a place is needed, a finding goes `to` the project |
| A4 | Layer §3.2 task `paths`; Int §3 "The first stage that names files … sets the task's `paths`, and its prompt says so"; Int §10 slice 1 prompts write "the task's paths" | A task can be tied to file paths early | R | Tasks arrive as a sentence or a vast note. Paths in notes are rare and an agent getting ahead. The prompt pushes stages to guess. Wrong or missing paths silently pick the wrong areas, lessons and decisions | Drop task `paths`. Agents find the files themselves |
| A5 | Layer §3.5 part 5 "each area whose paths overlap the task's"; Int §3 "part 5 lists every area … 13 lines for Harbour" | Areas exist and tasks have paths | H/R | Elsewhere part 5 is empty. In Harbour it is 13 lines of noise until paths exist | Part 5 becomes one line: how many open records are addressed to the project, with `find --to project` |
| A6 | Int §6 "Areas wake nothing. Their records reach the next task whose paths overlap them"; layer §3.4 open `to` an area | Some later task will carry overlapping paths | R | A finding sent to an area reaches nobody. That is the "out of the task" leak the layer exists to fix (`paths.md` §1). Silent | Address the project instead. Every brief shows the count; agents query by text |
| A7 | Int §9 "111 Waiting entries become `finding`s, `in` and `to` their area" | Harbour's notes and areas | H | One-off for Harbour's own data, so it's fine. But it depends on A1 | Import them `to` the project, with the note line (which cites its file) kept in `says` |
| A8 | Int §9 seven "Security Review" entries; parked LIN-4416, LIN-4210, LIN-4441, LIN-4445, LIN-4463 | Harbour's own backlog | H | Harmless: a one-off migration of Harbour-as-target | Keep |
| A9 | Layer §3.2 run `claims` ("paths it expects to touch"); §3.4 Overlap; §3.5 part 6; Int §3 "so the stage can revise its claims" | Runs predict paths, and overlap is decided by path prefix | R | Claims are guesses or empty. Overlap gives false negatives, worst where it matters. Silent | Drop `claims` and the view. Part 6 lists the other open runs in the workspace (task, stage, first line). There are few, and the agent judges |
| A10 | Layer §3.2 lesson `paths`, `in` an area; §3.5 part 7 "every lesson whose paths overlap the task's"; Int slice 5 witness "A lesson flagged when a change touches its paths" | Lessons are found by path match | R | With no task paths or areas, no lesson ever reaches a brief. The "flag" is not one of the layer's views (stale is only for `on` links) [checked: layer §3.4]. Silent | Lessons `in` the workspace. The brief gives their count; agents `find --kind lesson --text`. Drop the path-flag witness |
| A11 | Layer §3.2 decision `scope` "an area, covering every task whose paths overlap it" | Same as A10 | R | A standing direction scoped to an area applies to nothing. Silent | Scope is a task (and its subtree) or the whole workspace |
| A12 | Layer §3.5/§4 `find --area`, `--path`; layer §1 l.23 "what is known about the paths it touches" | Path is the main way to look things up | R | The queries return nothing. The reading principle points at the wrong key | Drop the two flags, keep `--text`. Reword l.23: "what is addressed to it, and an index of what is known" |
| A13 | Int §10 "A workspace with several repositories gets one set of areas. That stays open until Yap" | Area paths are repo-relative with no repo named | R | Paths collide across repos | Goes away with A3 |
| A14 | Inherited until slice 5 (placement C1-07, C5-A06/A13): "Read `docs/areas/README.md` and the notes…", unconditional in 7 stages and scoping; its doc comment says "each keeps docs/areas/" [checked: `lib/prompt-formatters.js:607-620`]. The blind read reads `areas.json` (C5-A13) | Every target keeps `docs/areas/` | H | Elsewhere the agent looks for files that don't exist. Mostly harmless, but it costs reads on every stage | Remove the pointer in slice 1, when Waiting retires, not in slice 5 |
| A15 | Inherited `LEFTOVER_RULE` "Inside the change's area … a `## Waiting` entry in that area's `docs/areas/<slug>.md`"; `areaLookup` "first match wins"; `NOTES_PR` [checked: `lib/prompts/leftover-words.js:41-65`] | Areas and notes files exist; a docs-only PR | H | In slice 1 Waiting retires, but the "inside the area" routing stays in the words. In Yap an agent may create `docs/areas/` in the target repo, or drop the leftover. Silent | Rewrite in slice 1: a leftover is fixed on the branch, or becomes a finding `to` the task, its parent or the project |
| A16 | Layer §3.2 task `asked` "a child task has none"; Int §2 "Only a ticket with no parent gets `asked`" | Every child is made by breakdown from a plan | T | In a team's Jira or Linear, people file subtasks with their own words, and John hand-files sub-issues too. After slice 4 those words reach no brief. Silent | A child gets `asked` when a person wrote it. Only a breakdown-made child relies on its `piece` |
| A17 | Int §2 tasks made "up the ticket's own tree"; Int §7 "creates child tickets from child task records" | The tracker has parent/child | T | GitHub Issues and GitHub Projects have `subtasks:false`; Jira has one level [checked: `lib/providers/*/index.js` `ui` getters]. The tree flattens and the child-ticket write fails | The tree lives in the store. Mirror it to the tracker only where the provider supports subtasks, else post a marked comment |
| A18 | Int §7 inward "any unmarked comment is a person's, and becomes a `finding` … `to` the task" | One person comments, and every comment needs action | T/R | On a team tracker, chatter becomes open findings that nobody ends. Silent growth | Don't convert comments. The brief says "N person comments since the last run" and the agent reads the thread |
| A19 | Int §7 outward: a marked comment per verdict, decision and plan version, plus one at each run's end | The tracker takes comments, and a team tolerates the volume | T | Harmless where comments are unsupported (skip). Noisy on a team tracker | Keep, gated on the provider's comment capability. One comment per run, not per record |
| A20 | Int §4 change `ref` = the PR; head refreshed by `readPrStatuses` (GitHub) [checked: `lib/close-out-readiness.js:25-45`]; "an unreadable PR is left as it is" | Work lands as a GitHub PR | T | A non-GitHub host or a direct commit is unreadable, so `head` never moves and stale never fires. `headMoved`, today's guard, is retired by this slice. A push after approval goes unseen. Silent | Read the head from git (the branch tip via `git ls-remote`), which works on any host. The PR is an optional `ref` |
| A21 | Int §4 "Harbour ends the change `merged` when it records the merge (C1-29)" | A GitHub merge, recorded by close-out | T | Elsewhere the change stays open. Silent | End it when git shows the head reachable from the default branch, or when close-out writes it |
| A22 | Inherited review contract: head `<sha>`, `CI:` line, `### What CI Did Not Prove`; close-out `--match-head-commit`; `ci-wake-sweep` (C5-B07) | GitHub checks and `gh pr merge` | T | CI absent is handled in words ("absent plus the substitute run") [checked: `lib/prompts/stage-kinds.js:420-428`]. The merge flag and the sweep are GitHub only. Mostly harmless | Keep. Have the review say the head commit, not a PR head |
| A23 | Int §5 questions go "`to` the owner"; "John" is the workspace owner | One person decides everything | R | On a team tracker, questions land on whoever bound the workspace | Send it to the task's asker or assignee from the tracker when known, else the owner |
| A24 | All slice witnesses are Harbour tasks ("walk 7's three tasks replayed"); layer §5 says Yap was filled "with no refusals" | Harbour-shaped data proves the general case | R | Nothing exercises a target with no areas, no paths, no tracker tree or no PR | Add a Yap replay (sentence-sized tasks, no areas, no subtasks) to the slice 1 and slice 3 witnesses |
| A25 | Slice 2: the file-pointer pilot takes plan `paths` from records (placement C4-07) | Plans name files | R (harmless) | A plan stage has read the code, so the names are earned. If there are none, the pilot adds nothing | Keep plan `paths` as optional text for the pilot. No matching on them |

**G (suspected but general):**
- **Actors** (Int §1) are Harbour's 20 stage kinds plus leftover, autopilot, harbour and people. They are the loop's own actors, the same on every target. The layer's "another project declares its own" is about another product using the layer, not about the target.
- Lesson `checked-at` as a commit sha. Harbour works through git checkouts.
- `## As asked` and `## Implementation Plan` (kept until slices 2 and 4). Harbour writes and reads these markers itself, on any provider. Jira has its own region (`lib/providers/jira/as-asked-region.js`) [checked: listing].
- Tracker ids in `to` and `in` (`LIN-4451`) use the provider's identifier. A local-provider workspace (Yap) uses the local ids. Also accept a store task id.
- `DECISION:` and `WITHDRAW:` markers, terminal markers, the run `account` and the brief door. These are Harbour's and simple-dispatcher's own transport.
- The store keyed by `urlKey`, `person:<accountId>`, and "closing a ticket ends its task". All are provider-neutral.
- The layer's `change` ("a PR, commit range or saved file") is general. Only the integration narrows it to a GitHub PR (A20).

## Which parts of the approved layer design would need revising

- **§1 l.23:** the reading principle names "the paths it touches". It becomes: what is addressed to the reader, the person's words, and an index to look up the rest.
- **§3.2:**
  - remove the `area` kind, or keep it as a named addressee with no `paths`;
  - drop `paths` from task;
  - drop `claims` from run;
  - drop `paths` and `in` an area from lesson (a lesson is `in` the workspace);
  - the decision `scope` loses the area option and gains "workspace";
  - a person-written child task keeps its `asked` (A16).
- **§3.1 `in` and `to`:** "a task or an area" becomes "a task or the project (workspace)".
- **§3.2 "Paths overlap" (l.82):** delete it.
- **§3.4:** delete the Overlap view.
- **§3.5:**
  - part 5 becomes the project's open count;
  - part 6 lists the other open runs in the workspace with no path match;
  - part 7 drops "every lesson whose paths overlap", leaving a lesson count and a pointer to `find --text`;
  - the queries lose `--area` and `--path`.
- **§3.2 Actors:** "Another project declares its own" should say the actors are the loop's, not the target's.
- **§5:** the Yap fill should be described honestly. Its areas were invented per file, so it didn't test path matching.

## Which of these, if removed, simplify the design

- **Fields:**
  - `area.paths`, `task.paths`, `run.claims`, `lesson.paths`, and decision `scope: area`. Five path fields go, and with them the one matching rule (segment-prefix overlap).
  - Possibly the whole `area` kind: one kind fewer and one fewer `in`/`to` target.
- **Views:** Overlap goes. "Open for a reader" loses its area case.
- **Brief:**
  - parts 5 and 6 shrink to one line each, with no matching code;
  - part 7 loses its lesson match;
  - Int §3's "no paths, list all areas" patch goes, and so does flagged change 1 of the four for John (Int §11.3).
- **Queries:** `--area` and `--path` go.
- **Integration:**
  - the slice 1 area import and its regex-to-prefix hand check go, and so does the `areas.json` sync test;
  - the "several repositories, one set of areas" open item goes;
  - the stage prompts stop asking for task paths and claims;
  - slice 5's witness becomes "a lesson written by one task is found by a later one".
- **Behaviour:** if A20 and A21 read git rather than GitHub, one path covers every host, and the "unreadable PR" case goes.
