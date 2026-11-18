# Paper walk: walk 7's three tasks through the integrated design

*18 Nov. A fresh reader, read-only. Walk 7's three tasks, traced through `integration/design.md` as after slices 1–5, against main `6f6c5d2`. Table cells are [my reading] unless marked [checked]. "w7" means walk 7's model run. Sizes are w7's `brief.txt` bytes, then an estimate with part 8 cut to one line, as the approved layer §3.5 has it [checked: measured per step].*

**The same in every row (said once).**
- **Writes.** Every stage write goes to `routes/proxy-records.js` (`POST /records`, `/:id/revise`, `/:id/end`, `/:id/link`). It is checked by `lib/records/check.js` and stored by `lib/records-store.js` (§1–2).
- **`by`.** The actor is the one the token names: the dispatch row's `kind`, recorded at mint (§2, C5-C07).
- **Run records.** Harbour adds the run when the row is taken (C3-45) and ends it on `[done]` (C3-47). Its account is the final text (C3-58), so the stage no longer writes its own run.
- **Brief.** `GET /api/proxy/brief/<LIN-id>` (today routes/proxy-compute.js:1332 [checked]) is built by `lib/records/brief.js` for `req.proxyStage`.
- **Marks.** *unchanged* means the same records reach the same readers, with brief bytes within ±5%. *changed* means it differs and is not worse. *worse* means something is refused, misattributed or unreached.
- **Slices 1–2 alone.** Brief part 2 is the model's distillation of the plan section. There are no verdict records (slice 2), no question or decision records (slice 4, see Q1), and no area or lesson records (slice 5). So part 5 is empty and nothing can be written `to` an area (B3).

## LIN-4450 (task-60, a child of task-53)

| # | stage | writes → by | brief | hand-offs reach | tracker / John | mark |
|---|---|---|---|---|---|---|
| 1 | survey-task | 2 questions, 1 check, 2 findings, all `to` implementation. `by` survey-task (a one-comment stamp, so the gate must allow record ops, Q9) | 10.1→10.1 KB. Part 2 plan-54 | Implementation's part 3 | Nothing posted. Task page lists them (s1) | unchanged |
| 2 | survey-place | 6 findings → implementation; 3 → area-1 | 16.5→12.4 | Part 3; area-1 only through a count in part 5 | Task page | changed |
| 3 | scoping | decision-82 (scope task-60, answers q-68) | 18.7→15.3 | Part 4 of later stages | The size decision is a tracker summary (s4, C2-43) | changed |
| 4 | implementation | change-84 → review; decisions 85–89; ends q-67/68 and 6 findings; check-90 → **task-62**; finding-92 → **task-61** | 19.4→19.0. Part 3 has 11 records [checked] | Review gets the change and findings 70/74/91. The sibling hand-offs are refused: those tasks have no record yet (B5) | Task page | **worse** |
| 5 | leftover | Ends finding-22 (imported); revises finding-79; lessons 95–98 (s5); revises change-84's head. `by` leftover only on a cold resume, else implementation (B2) | 23.2→15.6 | finding-99 → review's part 3 | Lessons on the task page (s5) | **worse** |
| 6 | review | verdict-100 `on change-84@2`; finding-101 → close-out; checks 102/103 → **task-62** | 29.2→18.3 | Close-out's parts 3–4. The task-62 checks are refused (B5). The verdict may rest on a lagging head (B6) | Verdict summary comment and run-evidence box (s2) | **worse** |
| 7 | blind-read | verdict-105 `better`; findings 106–108 → close-out | 27.1→16.0, but today it has no brief door (B7) | Close-out's part 3 | Summary comment (s2) | **worse** |
| 8 | close-out | Ends the change `merged`, ends its findings and task-60; finding-110 → **task-62**; finding-91 → task-61 | 24.4→21.7 | Refused (B5). Its dispatch may be refused on a false stale flag (B6) | Ticket closed, so the task ends (C2-27) | **worse** |

## LIN-4446 (task-9, no parent)

| # | stage | writes → by | brief | hand-offs reach | tracker / John | mark |
|---|---|---|---|---|---|---|
| 1 | survey-task | 4 findings → design; check-13 → review; check-16 → **John**; finding-11 → area-1 | 3.0→3.0 | check-16 is on the rulings page (s4); before s4, on the task page only | Rulings page (s4) | unchanged |
| 2 | survey-place | 5 findings → design; checks 22/23 → review; finding-25 → area-1 | 9.2→5.9 | Design's part 3 | Task page | changed |
| 3 | scoping | decision-26 (scope task-9) | 12.0→8.5 | Part 4 | Summary (s4) | changed |
| 4 | design | plan-28 (s3); decision-29; 7 findings ended `handed-on` into plan-28/decision-29; checks 31–33 → review | 9.7→9.3 | Plan-review's part 2. Under s1–2 the plan is description text, so `handed-on` has no record to name and they end `done` | Plan version comment (s3) | unchanged |
| 5 | plan-review | verdict-45 `request-changes on plan-28@1`; finding-36 → design; findings 37–44 → implementation | 23.3→10.3 | Design's parts 3–4. **Under s2 the verdict has no plan to rest on (B8)** | Verdict summary (s2) | changed |
| 6 | design | plan-28 v2; ends 9 findings; decision-46 | 25.2→17.1 | Plan-review's part 2. Under s1, the request-changes reasoning is only in a comment the brief no longer folds in (B9) | Plan comment (s3) | changed |
| 7 | plan-review | verdict-49 supersedes 45; findings 50–55 → implementation | 30.9→14.6 | Implementation's part 3 | Summary (s2) | changed |
| 8 | implementation | change-57 → review; check-59; lesson-60 (s5) | 24.2→18.0 | Review's part 3 | Task page | changed |
| 9 | leftover | Revises change-57's head and two area findings; finding-61 → **Harbour**; check-63 → review. `by`: see B2 | 17.4→16.2 | finding-61 has no reader (B11) | none | **worse** |
| 10 | review | verdict-65 `on change-57@2`; 2 findings → close-out; ends 8 checks | 22.7→20.9 | Close-out's part 3. The head may lag (B6) | Summary (s2) | **worse** |
| 11 | blind-read | verdict-69; findings → close-out and area-1 | 25.4→14.5 | As in 4450 step 7 (B7) | Summary (s2) | **worse** |
| 12 | close-out | Merges; check-63 → task-9 (its own task, then ended); decision-74 | 22.4→19.5 | check-63 is stranded under ended task-9, which has no parent (B11). False stale (B6) | Ticket closed | **worse** |
| 13 | John | Ends check-16; decision-76 supersedes decision-29; child task-77; ends task-9 | none | Nothing writes it: John's read was an agent-relayed comment (B10) | Rulings page lists check-16 | **worse** |

## LIN-4469 (task-131, piece 5 of task-108)

| # | stage | writes → by | brief | hand-offs reach | tracker / John | mark |
|---|---|---|---|---|---|---|
| 1 | implementation | change-142; decisions 143–145; finding-146 → its task; question-147 → John; revises 3 imported area-1 findings | 16.0→16.0 | The question is on the rulings page (s4). Under s1–2, part 2 is empty: the child's description has no plan (Q6) [checked: real/2-autopilot.md] | Rulings page | unchanged |
| 2 | autopilot | finding-148 → area-1; check-149 → review. `by` autopilot (its own row, on LIN-4448) | 23.7→19.8 | Review's part 3. Its run sits in task-108, so task-131's part 8 points at the implementation run instead | Parent's task page | changed |
| 3 | review | verdict-152 `needs-discussion`; 5 findings → close-out; check-158 → John; check-159 → leftover | 21.5→20.9 | Leftover's part 3 at step 7; the rulings page | Summary (s2); rulings page | unchanged |
| 4 | John | decision-160 answers q-147 | none | The rulings page writes `by: john` (§5). Harbour wakes the asker if parked. The wake row has no kind, so it carries `custom` (B1) | Decision summary comment | changed |
| 5 | autopilot (wake 1df3249b) | decision-161; ends finding-146; question-162 → John; readdresses 5 findings. `by` = **`wake`** (B1) | 37.3→26.2 | Refused, or the wrong actor. Under s1–3, John's "fold" is a comment and missing from the brief (B9) | Rulings page | **worse** |
| 6 | implementation | Two runs: fresh c66a3141, plus custom resume ac074b22 [checked: real/6]; decision-166; findings 167/168 → review | 30.8→27.9 | The custom resume writes `by: custom` (B1). Gain: part 6 shows the other open run, if claims are set (B12) | Session page shows both accounts | **worse** |
| 7 | leftover | decision-170 (scope area-1, s5); lesson-171; ends finding-26 and check-159. `by`: see B2 | 33.3→27.8 | The area decision reaches area tasks' part 4 (s5) | Task page | **worse** |
| 8 | review | verdict-173 supersedes 152; ends 4 findings; withdraws q-162 | 30.1→28.3 | Close-out's part 3. The stale flag here is real (the real reviewer agreed) | Summary (s2) | changed |
| 9 | autopilot (wake ad1b1a6d) | decision-178 (q-162 was withdrawn in the wake [checked: real/9]). `by` **`wake`** | 38.4→28.0 | As in step 5 (B1) | Rulings page | **worse** |
| 10 | blind-read | verdict-188; 4 findings → close-out; 4 → area-1 or area-65 | 25.4→25.1 | As in 4450 step 7 (B7). The area findings need area records (B3) | Summary (s2) | **worse** |
| 11 | close-out | Merges; decision-189 supersedes 166; check-149 handed-on; lesson-190; ends task-131 | 37.8→32.8 | check-158 stays on John's page | Ticket closed | changed |

**Tally:** 5 unchanged, 12 changed, 15 worse, out of 32 steps.

## The safety-finding trace

**The entry.** `docs/areas/agent-api.md:84-87`, under Waiting. It is the model-routing write the gate summary already names (gate-2026-11-14.md:25), tagged "(Security Review, 10 Nov.)". `grep -c "Security Review" docs/areas/*.md` finds 7 tags across 5 notes, which matches "seven" [checked].

1. **The import (slice 1, §9).** It becomes one `finding`: `in` agent-api, `to` john or the area (§11.3), `by: harbour`, `via: import`, its `says` the note line. §9 names no rule for picking the seven out. The tag would do it [my reading].
2. **Shape.** `in: agent-api` must be an area record (layer §3.3). Area records are written only in slice 5 (§10), so at slice 1 the write is refused, or it is made with no `in` (B3).
3. **If `to: john`.** In slices 1–3 no page lists it. The task page shows one task's records, and this finding has no task. The rulings page is slice 4 (B11). From slice 4 John sees it. His act is a call (ticket it, or fold it into LIN-4416). To end it `handed-on` it needs a task record, which exists only after a first dispatch (B5). Otherwise he ends it `declined` or `done` with a reason.
4. **If `to: agent-api`.** It wakes nothing (§6). A later task touching `routes/proxy-model-routing.js` sees it only as a count in brief part 5. Layer part 7 lists only records `in` the task and lessons, so §6's "parts 5 and 7" is really part 5 [checked: layer/design.md:114]. The stage must then `find --to`. Part 5 also needs that path to overlap the area, and the area's pattern is a regex (B4).
5. **Exposure.** The tracker gets no finding summaries (§7). Any workspace token can read it through `GET /records?text=`, as the repo note is today [my reading].

So it reaches its reader (John) only from slice 4, and only if it is addressed `to: john`.

## Breaks

- **B1. Wake and follow-up rows name no stage** (4469 steps 4, 5, 6 and 9). A wake row has kind `wake`. A follow-up with no kind is `custom`: CI sweep, person, resume on answer, and §5's own wake (lib/item-stage-stamp.js `stampForFollowUp`; lib/follow-up-dispatch.js:257-269) [checked]. §2's "its stage" then gives an undeclared actor. The code already resolves a wake's write stamp from the parent session (`stampForWakeParent`, lib/wake-credential.js:47) [checked]. §2 doesn't say the stage is resolved the same way.
- **B2. A held session keeps its first credential** (every leftover step). A signalled follow-up stores only `{prompt, itemId}` (simple-dispatcher dispatcher.js:371). Only a cold resume arms a broker with the new token (dispatcher.js:1040-1070) [checked]. So a leftover signalled into a held build writes `by: implementation`, against the build's run [my reading].
- **B3. Area records come in slice 5, but slice 1 needs them.** §9 imports 118 entries `in`/`to` areas at slice 1. Layer §3.3 refuses a non-record target. Walk 7's area writes (4450 step 2, 4446 steps 1–2, 4446 step 4, 4469 steps 2 and 10, the leftovers) and brief part 5 have nothing to rest on before slice 5 (§10).
- **B4. areas.json holds regexes; the layer matches segment prefixes.** One example is `^routes/proxy[^/]*\.js$|…` (docs/areas/areas.json:21) [checked]. Walk 7's area-2 used `lib/prompt-`, which the whole-segment rule (layer §3.2) doesn't match [checked: store]. §11.2's "derived from it" needs a rule.
- **B5. A hand-off to a ticket not yet dispatched has nothing to address** (4450 steps 4, 6 and 8). Task records appear only at first dispatch (§7). LIN-4451 and LIN-4452 came later [my reading]. A `to` must resolve (layer §3.3).
- **B6. The change head lags the verdict** (4450 steps 6 and 8; 4446 steps 10 and 12). §4 has Harbour revise the head only where it reads it live: C3-09, and C3-57 for parked workers only (C5-B07). In walk 7 the leftover revised the head before review in all three tasks [checked: change-84 v2, change-57 v2, change-142 v4]. If it doesn't, review rests on the old version and a later Harbour revise flags it stale. Close-out's guard (C3-10) would then refuse. Today `findSha` compares the sha the reviewer named, so there is no refusal.
- **B7. The blind read has no brief door and loses the PR-set check** (4450 step 7, 4446 step 11, 4469 step 10). Its preamble names no brief (lib/proxy-preamble.js:270-276), and its template forbids reading any ticket (lib/prompt-template-defs.js:1072-1076) [checked]. It needs the change id to write `on`. A full brief would hand it the ask, plan and decisions it can't read today; reads are unguarded (agent-api.md:88-93). C3-17 also checks that the PR set equals the landing set (routes/proxy-writes.js:777-787) [checked]. That isn't shape, yet §4 says the shape check replaces it.
- **B8. In slice 2, plan-review verdicts have no plan to rest on.** A verdict needs `on` (layer §3.3). Plans arrive in slice 3, and slice 2 retires `extractVerdict` (C3-19).
- **B9. Slice 1 drops comment-borne amendments from the brief.** C4-35 is retired as brief input, and part 2 reads "the plan section alone" (§3). Answers stay comments until slice 4, and nothing reads comments inward (§7). Today they amend the brief (C4-35). This hits 4469 steps 5–6 (John's "fold" [checked: real/4-John.md]) and 4446 step 6. C4-31's "read the comment thread" is reworded in slice 1.
- **B10. John's standing read has no door** (4446 step 13). §2's `john` comes only from the UI, and §5's page answers questions. Ending a check, superseding a decision and adding a child task have no named place. A relaying agent writes `by` its own stage.
- **B11. Open records with no reader.** check-63 sits under ended task-9, which has no parent: layer §3.4 gives `find` only, and §8 has no page for it. finding-61 is `to: Harbour`. Findings `to: john` in slices 1–3 also have no page.
- **B12. A stage can't find its own run.** It must revise its claims (§4), but no brief part names its run. 4469 step 6 had two implementation runs open at once.

## Questions for the design

1. Which kinds does `POST /records` take in slices 1–3? If all, slice 1 writes verdicts and Survey results twice (C3-14 still reads Survey comments). If only findings and checks, survey questions and stage decisions have no home until slice 4.
2. Does the mint take a wake's stage from its parent, as `stampForWakeParent` does? And what kind does §5's answer-wake carry?
3. Is "parked waiting" a held Stop or C3-51? C3-51 is queued/running (lib/run-live-wait.js).
4. What is `via`? Token labels are per mint site (C5-C07), not per relay.
5. Does first dispatch find an existing task by `ref`? Does a child task get `in` its parent? §7 lists only ref, asked and paths.
6. In slices 1–2, whose plan section feeds part 2: the child's or the parent's? (4469's child has none.)
7. Kinds outside the actors: plan, bug, research, spike, triage, context, look-into, retro, retrospective-audit and blocked (PROMPT_TEMPLATES) [checked]. Do they get actors?
8. Does the bootstrap exchange carry the item id and stage, as LIN-4468 carries `writes` (lib/stage-writes.js:46-47)?
9. Which record ops do the one-comment and blind-comment stamps get? Walk 7's surveys and blind reads added, revised and linked.
10. Who ends a change `merged`: close-out, or Harbour on merge?
