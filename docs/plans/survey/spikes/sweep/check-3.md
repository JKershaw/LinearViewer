# Sweep pass 2, check 3: sections F and G (27 Nov)

Checked against Harbour main `5c33e4415` (25 Nov), simple-dispatcher main `d692ac7`, the fetched tickets, live records and dispatch rows read through the proxy on 27 Nov, and the survey files on this branch. "Open finding to John" means a finding record addressed to `person:e7e948a4…`, state open, read on 27 Nov.

## F

- F1 — **open** — `lib/model-routing-harnesses.js:65` still maps `fable: 'claude-fable-5-1'`, unchanged since 26 Oct (`4f75f00df`); the log's claim that a newer Fable exists can't be checked in the repo; no ticket (search "fable model id"). If left alone, a `fable` dispatch is priced and named as 5.1 even if Claude Code runs a newer model.
- F2 — **can't tell** — neither log.md:3624/4045 nor `working-2026-11-15/readings/3-definition-and-rulings.md:179` names the company or the two files, so main can't be searched for it. Only the log's author can say which files.
- F3 — **open** — `lib/run-view.js:112` still has `ORCHESTRATION_KINDS = {autopilot, wake, custom, periodical}`. Parked by John ("one to look into later"; spike 0 ledger row 81, set aside). No ticket: the Live Console search found only LIN-2083 Backlog (autopilot sessions), which is not this. If left alone, the Live Console keeps showing little of the custom and Periodical work that is most of the day's activity.
- F4 — **can't tell** — the "watcher" is the survey session's own tooling (log.md:4055: "I'm now polling the dispatch itself"). I found no code or ticket for it in either repo.
- F5 — **tracked** — LIN-4579 Backlog "Security Review (10 Nov): seven findings", with children LIN-4580–4586, all Backlog (`tix/LIN-4579.json` children).
- F6 — **gone** — LIN-4210 Canceled. Dropped 20 Nov: "no clear answer and nothing to fold in" (its last comment).
- F7 — **tracked** — LIN-4441 Done (24 Nov) and LIN-4463 Done (24 Nov). LIN-4445 is still In Progress, set aside by John (log.md:5043; G47).
- F8 — **open** — the adversarial second read is still gated, now as records (`lib/periodical-report-gate.js:19, 52-55`, LIN-2323/LIN-4533). No disagreement-rate review was ever recorded; LIN-2323 is Done (26 Aug), with the ~1-month sunset still "live" in its description. No ticket. If left alone, every Periodical keeps paying for an extra session that nobody has checked still earns its place.
- F9 — **open** — both markers are on main: `public/style.css:3455` "until LIN-4015 retires the tone names" (LIN-4015 Done 30 Oct), and `lib/render-landing.js:58` "fallback until LIN-3952 owns one display name" (LIN-3952 Done 26 Oct). No ticket. If left alone, the code keeps temporary structures whose end condition passed a month ago, and readers are told they are waiting on something.
- F10 — **tracked** — LIN-4578 Todo, outcome: "simple-dispatcher's notes come too: its lessons as lesson records, its Waiting entries as project findings". I take the "prose copy" to be sd `docs/areas/README.md:9` ("keeps its own copy of the format and of the guard"). That copy has already drifted: it still describes `## Waiting` and LIN-4414's `RETIRES_LABEL` line (sd `docs/areas/README.md:40-82`), which Harbour retired (`docs/areas/README.md:41-48`; no `RETIRES_LABEL` in Harbour `lib/`).
- F11 — **gone** — overtaken by the layer slices, structure by structure. The Waiting quota and LIN-4414's Retires line were retired by LIN-4495 (Done). The Lessons cap goes in LIN-4578 (Todo, "No cap on lessons"). The course doc's rulings were superseded (log.md:4212). The one structure left standing is the blind-read gate: see F12.
- F12 — **open** — the gate is still in code: `lib/run-closeout-state.js:80-81` (`blind-read-missing`), refused at `lib/close-out-readiness.js:148,176`. LIN-4577 Todo removes only the parked blind-read special case, not the gate, and no ticket or ruling squares it with "measures report and never gate". If left alone, a close-out can still be refused for a missing blind read, against John's standing direction, unless he has meant this gate to stay.
- F13 — **gone** — overtaken by the data layer. Notes become lesson records, and the notes files go in LIN-4578 (Todo).
- F14 — **open** — idea, untracked; no ticket found. If left alone, the "square peg" mapping of the code for big deliberate tidies stays an idea held only in the log.
- F15 — **open** — idea, untracked. LIN-4017 Backlog is a CSS component garden, not a framework ruling, and John keeps the UI rebuild as his own planned work (log.md:5265). If left alone, the general idea of clearing outlived choices by ruling is lost with the log.
- F16 — **open** — `docs/v1.md` already defines v1 (one person, one task, one proven merge, done at the dress rehearsal), but the "A* quality, then run other projects" milestone isn't written anywhere tracked. If left alone, John's V1-then-feedback framing lives only in the log.
- F17 — **open** — a standing preference, not work; written nowhere kept. If left alone, later planning won't know John is open to large rebuilds and to cutting features.
- F18 — **can't tell** — "cross-session communication" isn't defined in the log. LIN-826 Done (push-based inter-session comms) and LIN-4480 Done (paper on lanes coordinating) exist, but I can't tell whether John meant something beyond them.
- F19 — **gone** — the course doc was superseded: "none of its rulings needs marking yet" (log.md:4212), then the layer plan and integration design replaced it (log.md:4308, 4382).
- F20 — **open** — `docs/v1.md:130-132`: "no fresh-account run has happened yet", owner's call. LIN-2953 Done (10 Oct, on the existing account), LIN-3690 Done (scoping only). No open ticket. If left alone, v1's own "done" gate stays unmet, and nobody has walked a true first sign-in.
- F21 — **open** — Collective is still on main (`routes/collective.js`, `lib/render-collective.js`). `lib/swim-lanes.js` and `lib/swim-graph.js` still have no import statement anywhere in lib/routes/public/server.js. John's answer isn't recorded. If left alone, about 1,500 dead lines and an unused feature stay to be read and maintained.
- F22 — **open** — no ticket found; the nearest is LIN-1386 Todo, a human-attested GitHub App login smoke. If left alone, the whole product path (sign-in, runner, chained stages, merge) can break without any test noticing.
- F23 — **open** — not run since: the Yap experiment ended 19 Nov (log.md:4485). No ticket. If left alone, Harbour's loop is still shaped only by its own repository, the risk John named on 3 Nov.
- F24 — **open** — parked. Provider sync is "a follow-up … after the slices land" (`integration/design.md:158`); nothing filed. If left alone, the tasks-as-primary idea has no home once the log is gone.
- F25 — **open** — parked ("a separate matter", log.md:4208). Only generic old performance tickets exist (LIN-446 and LIN-2605, both Backlog). If left alone, the slowness John noticed has no owner.
- F26 — **done** — answered from the code: `POST /workspace/:urlKey/api/feedback` creates the ticket in the workspace named in the URL (`routes/workspace-api-feedback.js:40-44, 447`, `workspaceFromUrl`), not in Harbour's own workspace.
- F27 — **tracked** — still holds: only a GitHub-bound workspace reads its own repo with a token, and every other repo is read anonymously (`lib/github-pr-status.js:17-20`). LIN-614 Todo is the umbrella "a workspace becomes code & task sources" (code sources separate from task sources).
- F28 — **tracked** — LIN-3141 Backlog "Cross-device workspace restore".
- F29 — **tracked** — the survey's reading was partly out of date. Phase B (LIN-1328) and Phase D (LIN-1330) are Done, and the Connection noun is in (LIN-2149, LIN-3124 Done). What remains: LIN-2150 Todo (migration off per-workspace credentials), LIN-3141 Backlog, and the team workspace in LIN-4449 Backlog.
- F30 — **tracked** — LIN-4449 Backlog "A team shares a workspace…" and LIN-4445 In Progress (the Jira loop, set aside).
- F31 — **tracked** — LIN-2805 Backlog covers the `[ticket]` marker parser, `LIN-\d+` in `lib/session-telemetry.js:286` and sd `transcript.js:445`. Not covered by it: `lib/liveness-detectors.js:122` and `lib/dispatch-wake.js:448`.
- F32 — **done** — erasure covers the layer: `lib/account-erasure.js:193-199` lists `records` (`by`/`to` as person-ref), `records-refs` and `records-query-log`. I found no account data-export feature on main to extend.
- F33 — **open** — LIN-4452 is still In Progress, and its live-check runbook is still `f495ca4b` of 13 Nov (LIN-4445 hand-back; finding-ec383bcf). Nothing records the two missing LIN-4450 checks (log.md:4270). If left alone, John's Jira live check will pass without exercising two of LIN-4450's three live claims.
- F34 — **open** — idea ("much, much later"), untracked. If left alone, the list of rules John expects to become configuration is lost with the log.
- F35 — **open** — no real task has been run on a non-Harbour project. Yap was only filled in after the fact (log.md:4302-4349), and the experiment ended (log.md:4485). No ticket. If left alone, the same gap as F23: no outside project tests the loop.
- F36 — **done** — John answered §11: "the knots are accepted as a tax, with nothing tidied first" (log.md:4382).
- F37 — **gone** — the design was built and corrected through slices 1–4 (LIN-4491, LIN-4499, LIN-4513, LIN-4529 all Done), so the paper-walk gaps were overtaken by the real build.
- F38 — **tracked** — slices 1–4 are Done. Slice 5 is LIN-4578 Todo. Of the parked work, LIN-4416, LIN-4441 and LIN-4463 are Done, and LIN-4579 (Backlog) and LIN-4445 (In Progress) remain.

## G

- G1 — **open** — parked: "Provider sync is a follow-up … its own design after the slices land" (`integration/design.md:158`); spike 0 ledger row 20 calls it set aside. Nothing filed. If left alone, the sync design (and the tracker-direction question folded into it) has no home once the log is deleted.
- G2 — **done** — LIN-4494 Done: the project page lists the records addressed to the project, "numbered oldest first as its backlog" (`lib/render-project-page.js:1-10`), with make-a-task and decline actions.
- G3 — **gone** — slice 4 (LIN-4529 Done) removed the ruling stores. What's left reads question records (spike 0 ledger row 19); no Theseus is needed or filed.
- G4 — **tracked** — the query-log reading is in finding-8fef4f19 (open to John: "the query log before 17 Feb 2027"). Person addressing has since been shown working: stage records go to `person:e7e948a4…` (for example finding-554005cc on 25 Nov), and the LIN-4548 witness covers it (ledger row 39).
- G5 — **done** — LIN-4497 close-out ledger, 19 Nov 16:46: "Settled after the deploy. I read LIN-4493's 22 dispatch rows from the live store … `pr` …/pull/2465".
- G6 — **done** — LIN-4494 close-out (19 Nov 18:36): Chromium on a seeded local workspace at 390px and 1280px, both templates, no horizontal scroll. The "Assigned to me" name risk was accepted, with a named rollback in `server.js` `resolveAssigneeSelection`.
- G7 — **open** — no ticket found (search "duplicate launch same branch"; LIN-4045 Todo is a different case). The leftover row b2ff7059 (LIN-4494) still reads "taken" today. If left alone, a rework can again start on a branch while an older session is still live on it.
- G8 — **tracked** — finding-0cc5a636 is open to John.
- G9 — **done** — finding-76683071 ended done 22 Nov ("LIN-4520 (P7) removed … isEmptyStatement and legacyLedgerOf"). `lib/run-ledger.js` now exports only PR helpers (`PR_URL_RE`, `prUrlsIn`, `prOf`, `byTime`).
- G10 — **tracked** — LIN-4452 In Progress (John's Jira live check), and LIN-2422 Todo (under LIN-4511 Backlog).
- G11 — **open** — the "hold for old reviews" is gone: LIN-4527 Done removed the legacy state ("drops the third 'legacy' state", its blind read). The badge question is unanswered: the badge counts questions only (`public/common.js:2604-2618`, `lib/components/frame.js:78-85`). LIN-4494's close-out calls it "John's call, on LIN-4491", and no answer was found. If left alone, the 60 findings open to John never show on Home's count.
- G12 — **tracked** — finding-8fef4f19 and finding-f4c0b65d are both open to John.
- G13 — **done** — the brief-size reading was taken at slice 4 (finding-d8179c5c, 24 Nov: records brief against the model-written brief per ticket). The slice 1–2 "pending" figures were moot once the brief was rebuilt from records (log.md:5225, 5281).
- G14 — **can't tell** — "the rule-grant idea" appears only at log.md:4712. I found no description of it in the log or the survey files.
- G15 — **tracked** — LIN-3896 Backlog: John's 24 Oct words, "the actual narrative of the tasks moving through the system", not work completed. The match is by content: the 20 Nov note doesn't name it, and spike 0 ledger row 17 found no ticket.
- G16 — **tracked** — LIN-4578 Todo ("simple-dispatcher's notes come too … its Waiting entries as project findings"). The entries are still on sd main: 13 entries across 5 files under `docs/areas/*.md` `## Waiting`.
- G17 — **done** — `integration/design.md:93` now reads "The `plan` stage writes the plan … routing stays design → plan → plan-review". The old "design stage addresses its plan" wording is gone.
- G18 — **gone** — by design: a records write by a dispatch credential that names no run is refused, and nothing falls through to a person (`lib/run-lineage.js:5-9, 29`; `routes/proxy-records.js:69`; `docs/proxy-integration.md` Records).
- G19 — **open** — the duplicate question was retired by slice 4 (ledger row 45). Still open: runs building the contested part while a ruling waits, and engineering questions raised as rulings (ledger rows 47-48: "No change made"). No smoothing pass was filed. If left alone, runs can still waste work on contested parts and send John questions that aren't his.
- G20 — **can't tell** — the "refused-follow-up pattern" appears only at log.md:5025. Ledger row 52 is "unknown" too, and I didn't trace the dispatcher's or Harbour's status code for it.
- G21 — **done** — LIN-4527 Done. `ANY_EXTENSION` is gone (`lib/prompts/area-note-format.js:16` comment), `tests/fixtures/leftover-answers/` is gone, `openItems` is gone (finding-5b2fe3b2 ended), and the ledger box no longer shows pre-cutover text (`lib/render-run-evidence.js:93-96`).
- G22 — **gone** — kept on purpose by slice 4. LIN-4529's plan: "Stays, because something else uses it: `textWithoutPlan` (the selector view …)". `lib/asked-of.js` is now the one-line "as filed" rule (`lib/asked-of.js:8-23`).
- G23 — **open** — still at `lib/records/check.js:122-128`: a revise that names the stored ref passes unchecked, so a legacy non-URL change ref is never validated. No ticket. If left alone, old change records with non-PR refs stay writable and refreshable, but can't be read as PRs.
- G24 — **done** — all four findings ended done: 5b2fe3b2 and b559517b (LIN-4527), 4657b715 and 987a7853 (settled by LIN-4501/4502/4504).
- G25 — **done** — the code is settled: 0f91d9be done (PR #2488; stray changes left as merged), and e99fe61f handed on (to finding-8561c285). Slice 3 P7 (LIN-4520 Done) removed what 92289ee4, 6e05393c and 41fb5f7f named: `run-ledger.js` has PR helpers only, and `scripts/records/slice-3-verdict-import.mjs` and `tests/helpers/comment-path-capture.js` are gone. 6be368c6 (`actedAfter` now from runs, `lib/recommendation-facts.js:458`) and ad088c22 (constants from `lib/records/words.js`) are fixed. The records still read open: 7577ea9d, b44dd95a, d0a8b20a, 6be368c6, 6e05393c, 92289ee4, 41fb5f7f and ad088c22.
- G26 — **open** — `git ls-remote` shows both branches still on origin, `feat/lin-4524-shared-retirement-census` and `feat/lin-4518-records-standing`, plus four more `feat/lin-4518-*` branches. If left alone, dead branches clutter the repo and can be mistaken for live work.
- G27 — **tracked** — LIN-4523 Todo, set aside by John. It covers queued work held on stop, and plain pause-versus-stop wording.
- G28 — **open** — set aside by John ("will do it later", ledger row 80); untracked. If left alone, Git-free close-out stays an unwritten intention.
- G29 — **tracked** — two findings still hold and are open to project. finding-09e34102: `scripts/eval-review-closeout.mjs:160` still exits 2. finding-0d0ea9bd: `server.js:665-667` still throws for local-provider workspaces. The others are settled: 3c29963d by LIN-4520 (run-ledger is PR helpers only), 3f64b084 (the sentence appears once in `docs/architecture/prompt-system.md`), and 0bb50a0d by P7.
- G30 — **tracked** — finding-598a59f0, finding-b89ac5a3 and finding-da5bc495 are all open to John.
- G31 — **gone** — by design: "`asked` stays … editing a description reaches no stage: a correction goes in as a comment … or a decision" (`integration/design.md:92`; `lib/asked-of.js` header, John's ruling on LIN-4522).
- G32 — **open** — on John's list for later (log.md:5228; ledger row 83); untracked. If left alone, the size settings discussion has no home after the log.
- G33 — **open** — set aside: "a later permissions sweep, or keep as is" (`notes-review.md:31`); untracked. If left alone, the next task that needs production access will hit the same hidden-on-purpose gap.
- G34 — **done** — question-6a487149 is v2 answered, by decision-320df844.
- G35 — **open** — idea, untracked. The pile it would clear is growing: 369 open findings to project today. If left alone, small tidy-ups keep piling up with no bulk way to clear them.
- G36 — **open** — 377 records are open to project today (369 of them findings), against 259 on 23 Nov; only 24 project findings have ever ended done. John: "they'll fold into planned work" (`journey.md:355`), for later. The only reader is the project page, by hand. If left alone, the "out" leak keeps growing, unread.
- G37 — **gone** — John: the UI rebuild is his own planned work, so keep it out of these lists (log.md:5265).
- G38 — **tracked** — finding-581bfa0e (time to answer, due about 1 Dec) and finding-484b88f6 (held-run reading) are both open to John.
- G39 — **open** — still ended by hand (log.md:5459: finding-67c625f3), and LIN-4548 makes it by design. Not in any ticket (ledger row 78; `notes-review.md:32`). If left alone, every log comment John's token posts becomes a finding someone has to end by hand.
- G40 — **gone** — handled by visibility: "LIN-4508's mid-turn words now show what a run is waiting on" (`notes-review.md:26`; LIN-4508 Done). The stall watch itself is unchanged (sd `config.js:63`, 60 min).
- G41 — **open** — no ticket (search "scheduler lease timing flaky"). `tests/unit/scheduler.test.js` is unchanged since 16 Aug. If left alone, a flaky test can again fail a production deploy silently, with Railway not retrying.
- G42 — **tracked** — finding-554005cc is open to John. finding-c93ea0bb is covered by LIN-4574 Todo ("The reaper logs what it drops"). The LIN-4342 seed question defaulted to the synthetic seed (question-d2640e4b; LIN-4342 Done).
- G43 — **tracked** — LIN-4571, LIN-4572, LIN-4573 and LIN-4574 are all Todo; LIN-4569 is Backlog.
- G44 — **tracked** — LIN-4509, LIN-4510 and LIN-4511 are all Backlog.
- G45 — **tracked** — LIN-4577 Todo, LIN-4578 Todo, LIN-4576 Todo and LIN-4575 Backlog.
- G46 — **tracked** — LIN-4579 Backlog, with children LIN-4580–4586 Backlog.
- G47 — **tracked** — LIN-4445 In Progress (set aside by John).
- G48 — **tracked** — LIN-3976 Todo (27 Nov update block), LIN-4343 Backlog, and LIN-4017 Backlog (rewritten as the component garden).
- G49 — **open** — LIN-3976's update says "Outcomes 3 (steering) and 9 (member view) are out of this ticket and not ticketed yet". PR #2344 is still open (REST read: state open, not merged), and LIN-4343 tells its builder that the sweep docs are only on that PR. If left alone, run-page steering and the member view drop off the list, and LIN-4343's builder reads unmerged docs.
- G50 — **open** — `GET /api/proxy/dispatch?status=taken` returns 23 rows today (1 Sep – 20 Nov, including b2ff7059 for LIN-4494 and dee1c97d for LIN-4501). LIN-4574 Todo is the prerequisite for a safe abort but doesn't clear them. If left alone, stale "taken" rows keep cluttering the Dispatch page and any count of live work.
- G51 — **open** — `lib/settings-keys.js:96` labels every queue token `'Queue token (legacy)'`. LIN-4576 Todo doesn't mention the label. If left alone, John keeps seeing "legacy" on the one key his runner needs, which he has ruled out.
- G52 — **tracked** — LIN-4576 Todo: "Settings › Agent access makes it clear which key a runner needs, and where to make it".
- G53 — **open** — none of the three has re-run: the fleet has stayed paused since 27 Nov 11:25:56 (`GET /api/proxy/dispatch/halt` → `mode: pause`). No ticket. If left alone, this week's Drift & Coherence, Seams & Tangles and Comprehension-Debt readings never happen.
- G54 — **open** — sd `terminal-driver.js:1052-1060` still calls `open -a kitty --args --listen-on …`, unchanged since 1 Nov. LIN-4573 (tabs) doesn't cover a kitty already reopened at login. If left alone, the first kitty launch after any login fails with a missing socket.
- G55 — **open** — the halt is still `pause`, set 27 Nov 11:25:56. This is an ops step for John (macOS 27.2.1, start SD by hand, confirm a tmux session) that no ticket tracks. If left alone, the runner takes no work at all.
- G56 — **open** — LIN-4573 Todo assumes kitty tabs, while the laptop's `.env` was switched to tmux (log.md:5527). Nothing records which one stays. If left alone, LIN-4573 may be built for a driver the laptop no longer uses, or tmux runs untested.
- G57 — **open** — log.md:5532 lists it as "Open" and nothing later says it was done. It's John's machine; no ticket. If left alone, the next freeze again needs a hard power-off, and Apple never sees the reports.
- G58 — **open** — unexplained (log.md:5524), with no ticket (search "SIGHUP"). I can't see whether it still happens, since SD autostart is disarmed. If left alone, a login-started dispatcher may keep dying about a minute after start once autostart is re-armed.
- G59 — **open** — `docs/autopilot-operating-manual.md:487` (served at `GET /api/proxy/autopilot/manual`) still says review "writes a ledger of what CI didn't prove", and :490 says close-out "settles each ledger item". No open ticket names it. If left alone, every autopilot reads a handbook describing a ledger that no longer exists.

## Counts

| Verdict | F | G | Total |
|---|---|---|---|
| done | 3 | 10 | 13 |
| tracked | 9 | 18 | 27 |
| gone | 5 | 6 | 11 |
| open | 18 | 23 | 41 |
| can't tell | 3 | 2 | 5 |
| **all** | **38** | **59** | **97** |
