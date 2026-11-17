#!/usr/bin/env bash
# Recreates walks/5/replay-4459/store.json from empty (walk 5 model): the state of LIN-4447 / LIN-4448 / LIN-4459
# just before LIN-4459's first stage (survey-task) was dispatched, 2026-11-13T16:23:17.729Z.
# Generated from walks/5/material and docs/areas @ 0092d8d9e; see seed-log.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LAYER="$HERE/../model/layer.mjs"
STORE="$HERE/store.json"
rm -f "$STORE"
L() { node "$LAYER" "$@" --store "$STORE"; }
idof() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }
# substitute @@NAME@@ with the shell variable NAME (record ids captured earlier)
sub() { local s="$1" v; for v in $(grep -o "@@[A-Z0-9_]*@@" <<<"$s" | sort -u | tr -d @); do s="${s//@@$v@@/${!v}}"; done; printf "%s" "$s"; }


# Area: Runs & dispatch (registry docs/areas/areas.json @ 0092d8d9e), by Harbour. Note docs/areas/runs-and-dispatch.md @ 0092d8d9e.
# Entries present at 4b5001ddf are dated 12:00Z (before the parents were filed); later ones at the main-line commit that added them.
P=$(cat <<'J1'
{"name":"Runs & dispatch","paths":["routes/dispatch.js","routes/live-console.js","routes/runner-kit.js","routes/runner-setup.js","lib/runner-kit/","lib/dispatch-","lib/pipeline-loops.js","lib/run-","lib/wake-","lib/digest-feedback.js","lib/lineage-closure.js","lib/loop-supersede.js","lib/follow-up-dispatch.js","lib/ci-wake-sweep.js","lib/follow-on-ratio.js","lib/observation-","lib/observer-","lib/liveness-","lib/completion-signals.js","lib/agent-status-store.js","lib/unanswered-decisions.js","lib/task-decisions-store.js","lib/shelved-rulings-store.js","lib/dismissal-suggestions-store.js","lib/close-out-events-store.js","lib/ticket-close-closer.js","lib/plan-review-round-trips.js","lib/pipeline-churn.js","lib/poll-halt.js","lib/workspace-halt.js","lib/queue-config.js","lib/session-summary","lib/session-telemetry.js","lib/session-materializer-precompute.js","lib/sessions-feed-cache.js","lib/sessions-view.js","lib/recent-runs.js","lib/task-run-facts.js","lib/close-out-readiness.js","lib/close-out-merges.js","lib/task-cost-read.js","lib/task-timeline.js","lib/session-roles.js","lib/terminal-marked-task-cost.js","lib/transcript-spend.js","lib/weekly-budget.js","lib/wall-clock-summary.js","lib/harbour-spawn.js","lib/runner-owner-gate.js","lib/consumer-poll-warning.js","lib/consumer-heartbeat","lib/effort-readout.js","lib/escalation-kpis.js","lib/task-stack.js","lib/task-page-loader.js","lib/task-mode-store.js","lib/task-snapshot-store.js","lib/task-done-cache.js","lib/live-console.js","lib/periodical-runs.js","lib/periodical-report-gate.js","lib/refresh-on-resolve-gate.js","lib/superseded-selection.js","lib/owner-mint-refusals.js","lib/request-usage-","lib/cost-read.js","lib/cost-read-calls.js","lib/row-usage.js","lib/lineage-membership.js","scripts/pipeline-churn.mjs"]}
J1
)
P=$(sub "$P")
AREA_RUNS=$(L add area --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 1 (first on main at 4b5001ddf)
P=$(cat <<'J2'
{"in":"@@AREA_RUNS@@","says":"A run-row field that is always present with a default is one entry in `RUN_FIELDS` (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once dropped on one hop of four.","paths":["lib/dispatch-fields.js"],"checked-at":"0092d8d9e"}
J2
)
P=$(sub "$P")
AREA_RUNS_L1=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 2 (first on main at 4b5001ddf)
P=$(cat <<'J3'
{"in":"@@AREA_RUNS@@","says":"Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`); a new exit must archive through it too.","paths":["lib/dispatch-store.js"],"checked-at":"0092d8d9e"}
J3
)
P=$(sub "$P")
AREA_RUNS_L2=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 3 (first on main at 4b5001ddf)
P=$(cat <<'J4'
{"in":"@@AREA_RUNS@@","says":"The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357, 2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites passing, and update the two census pins (`lin-3134-declared-mint-census`, `lin-4080-addItem-census`) if the write moves.","paths":["lib/dispatch-store.js"],"checked-at":"0092d8d9e"}
J4
)
P=$(sub "$P")
AREA_RUNS_L3=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 4 (first on main at 4b5001ddf)
P=$(cat <<'J5'
{"in":"@@AREA_RUNS@@","says":"\"This run's PR\" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`) takes a PR on a report line before the `[done]` `url`, which older runners filled by mention count (LIN-4375).","paths":["lib/dispatch-wake.js"],"checked-at":"0092d8d9e"}
J5
)
P=$(sub "$P")
AREA_RUNS_L4=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 5 (first on main at 4b5001ddf)
P=$(cat <<'J6'
{"in":"@@AREA_RUNS@@","says":"Two `[done]` posts can reach a decide-then-enqueue at once, so \"no row yet\" is no guard: claim first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two leftover rows (LIN-4375).","paths":[],"checked-at":"0092d8d9e"}
J6
)
P=$(sub "$P")
AREA_RUNS_L5=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 6 (first on main at 4b5001ddf)
P=$(cat <<'J7'
{"in":"@@AREA_RUNS@@","says":"A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left by a skip held the re-report forever (LIN-4375 review).","paths":[],"checked-at":"0092d8d9e"}
J7
)
P=$(sub "$P")
AREA_RUNS_L6=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 7 (first on main at 4b5001ddf)
P=$(cat <<'J8'
{"in":"@@AREA_RUNS@@","says":"Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`). A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`, `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals.","paths":["lib/ci-wake-sweep.js"],"checked-at":"0092d8d9e"}
J8
)
P=$(sub "$P")
AREA_RUNS_L7=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 8 (first on main at 4b5001ddf)
P=$(cat <<'J9'
{"in":"@@AREA_RUNS@@","says":"Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).","paths":["lib/prompt-templates.js","lib/dispatch-fields.js"],"checked-at":"0092d8d9e"}
J9
)
P=$(sub "$P")
AREA_RUNS_L8=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 9 (first on main at 192e1f81f)
P=$(cat <<'J10'
{"in":"@@AREA_RUNS@@","says":"The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373), released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once. Leftover wording lives in `lib/dispatch-leftover-hook.js`, bound into the store late (`setHeldWakeReleaseNote`) because most releases have no request; a new held-wake feature brings a hook (`lin-4377-store-knows-no-leftover` counts the word and forbids the `formatHeldWakeNote` import).","paths":["lib/dispatch-leftover-hook.js"],"checked-at":"0092d8d9e"}
J10
)
P=$(sub "$P")
AREA_RUNS_L9=$(L add lesson --by Harbour --at 2026-11-13T16:09:25Z "$P" | idof)
# Lesson 10 (first on main at 192e1f81f)
P=$(cat <<'J11'
{"in":"@@AREA_RUNS@@","says":"A feedback-entry kind is one row in `FEEDBACK_KINDS` (`lib/dispatch-feedback-kinds.js`) that declares every role; readers filter the table, and its row order is the runner prompt's bytes. A shared constant is imported from its owner (`HALT_MODES`, `followUpTarget`, `NEVER_RAN` in `lib/dispatch-terminal.js`). The decision-stamp set had four copies in `lib/`; the LIN-4455 censuses (`lin-4455-feedback-kinds-table`, `lin-4455-constants-owners`) fail on a new one.","paths":["lib/dispatch-feedback-kinds.js","lib/dispatch-terminal.js","lib/"],"checked-at":"0092d8d9e"}
J11
)
P=$(sub "$P")
AREA_RUNS_L10=$(L add lesson --by Harbour --at 2026-11-13T16:09:25Z "$P" | idof)
# Lesson 11 (first on main at 4b5001ddf)
P=$(cat <<'J12'
{"in":"@@AREA_RUNS@@","says":"Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as LIN-4226.","paths":[],"checked-at":"0092d8d9e"}
J12
)
P=$(sub "$P")
AREA_RUNS_L11=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 12 (first on main at 4b5001ddf)
P=$(cat <<'J13'
{"in":"@@AREA_RUNS@@","says":"A task timeline lane is running from the page's open session ids (`isOpenState`), never the cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides \"not complete\" (LIN-4405, `lib/task-timeline.js`).","paths":["lib/task-timeline.js"],"checked-at":"0092d8d9e"}
J13
)
P=$(sub "$P")
AREA_RUNS_L12=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 13 (first on main at 4b5001ddf)
P=$(cat <<'J14'
{"in":"@@AREA_RUNS@@","says":"A test that dispatches a close-out passes a `closeOut` seam (`resolveProvider`): the readiness guard reads comments for every close-out since LIN-4438, and without the seam it reaches the real provider and fails open, a pass the hermetic watcher catches only in CI.","paths":[],"checked-at":"0092d8d9e"}
J14
)
P=$(sub "$P")
AREA_RUNS_L13=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 14 (first on main at 4b5001ddf)
P=$(cat <<'J15'
{"in":"@@AREA_RUNS@@","says":"Close-out readiness has five lanes: the route (`codeRouteOf`), the stop-at state, the task page's box (`buildRunEvidence`) and both guard lanes (`closeOutNotReady`). A readiness rule goes in `closeOutWaitsOn` (`lib/run-closeout-state.js`) and gets a row in the shared-trail table (`lin-4438-blind-read-gate`); gating one lane let the page offer a press the guard refused (LIN-4438).","paths":["lib/run-closeout-state.js"],"checked-at":"0092d8d9e"}
J15
)
P=$(sub "$P")
AREA_RUNS_L14=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 15 (first on main at 4b5001ddf)
P=$(cat <<'J16'
{"in":"@@AREA_RUNS@@","says":"A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`): confirm a custom kind from its own row before trusting it (LIN-4426).","paths":["lib/wall-clock-summary.js","lib/cost-read.js"],"checked-at":"0092d8d9e"}
J16
)
P=$(sub "$P")
AREA_RUNS_L15=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 16 (first on main at 4b5001ddf)
P=$(cat <<'J17'
{"in":"@@AREA_RUNS@@","says":"A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`), for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).","paths":["lib/run-ledger.js"],"checked-at":"0092d8d9e"}
J17
)
P=$(sub "$P")
AREA_RUNS_L16=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 17 (first on main at c205190fd)
P=$(cat <<'J18'
{"in":"@@AREA_RUNS@@","says":"A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through `lib/cost-read.js`; a reader never re-ranks `byModel` itself. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)","paths":["lib/cost-read.js"],"checked-at":"0092d8d9e"}
J18
)
P=$(sub "$P")
AREA_RUNS_L17=$(L add lesson --by Harbour --at 2026-11-13T15:39:20Z "$P" | idof)
# Lesson 18 (first on main at 5dcf5bcda)
P=$(cat <<'J19'
{"in":"@@AREA_RUNS@@","says":"The Harbour calls read is `lib/cost-read-calls.js` (LIN-4457): `readCalls`, `appCallsOf` and `callsSurfaceOf` are pure over docs their caller keys to one workspace (`listInHorizon(urlKey)`). The instance-wide boundary is the `urlKey` / `instanceWide` guard on `lineageRecords` and `readCost` (LIN-4226), not these readers. A new calls shape goes beside them, and `appCallsOf([])` is the one empty shape.","paths":["lib/cost-read-calls.js"],"checked-at":"0092d8d9e"}
J19
)
P=$(sub "$P")
AREA_RUNS_L18=$(L add lesson --by Harbour --at 2026-11-13T15:49:16Z "$P" | idof)
# Waiting 1 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J20'
{"to":"@@AREA_RUNS@@","says":"`lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)"}
J20
)
P=$(sub "$P")
AREA_RUNS_W1=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 2 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J21'
{"to":"@@AREA_RUNS@@","says":"`lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)"}
J21
)
P=$(sub "$P")
AREA_RUNS_W2=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 3 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J22'
{"to":"@@AREA_RUNS@@","says":"`lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature first needs composable hooks. (Operator, LIN-4377.)"}
J22
)
P=$(sub "$P")
AREA_RUNS_W3=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 4 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J23'
{"to":"@@AREA_RUNS@@","says":"`lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`; SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)"}
J23
)
P=$(sub "$P")
AREA_RUNS_W4=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 5 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J24'
{"to":"@@AREA_RUNS@@","says":"`lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session (rows cover pause and stop), though the leftover step resumes its build that way (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.; `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)"}
J24
)
P=$(sub "$P")
AREA_RUNS_W5=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 6 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J25'
{"to":"@@AREA_RUNS@@","says":"`lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey tally: LIN-4201.)"}
J25
)
P=$(sub "$P")
AREA_RUNS_W6=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 7 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J26'
{"to":"@@AREA_RUNS@@","says":"`lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records. (Survey tally: LIN-3257.)"}
J26
)
P=$(sub "$P")
AREA_RUNS_W7=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 8 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J27'
{"to":"@@AREA_RUNS@@","says":"`lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)"}
J27
)
P=$(sub "$P")
AREA_RUNS_W8=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 9 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J28'
{"to":"@@AREA_RUNS@@","says":"`lib/recent-runs.js`: `runFact` reads only the row's feedback: a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` reads `running` and holds the live-stage wait until aborted. (LIN-4392.)"}
J28
)
P=$(sub "$P")
AREA_RUNS_W9=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 10 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J29'
{"to":"@@AREA_RUNS@@","says":"`lib/run-ledger.js`: `landingPrUrls` counts every full PR URL after its anchor, so it disagrees with the other landing readers in two cases the shared-trail table pins as chosen, not designed (`tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15): an audit report that re-cites a merged landing PR puts it in the notes PR's landing (`auditAfterLandingCloseOut` in `lib/recommendation-facts.js` treats only the new PR as the notes PR), and a foreign PR cited before the first review joins a first landing. Each costs a read that must name an extra PR. One comment classifier and one landing reader would make both follow from one rule. A third case is not pinned: an agent's own note (first line `autopilot`, `plan posted`, `plan revised`, or `revision N`) that cites a new PR after review joins `landingPrUrls` but not `isLandingEvidence` (`lib/recommendation-facts.js`), so `blindReadStep` offers a blind read naming a PR the approved review never covered, where a plain note sends it back to review (reproduced at e2d4659c4; Seams & Tangles, 13 Nov.; `docs/reviews/seams-tangles-review-2026-11-13-run12.md`, §3.0a). (LIN-4438; Survey global on LIN-4438.)"}
J29
)
P=$(sub "$P")
AREA_RUNS_W10=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 11 by position @ 0092d8d9e (first on main at cfd152fa4)
P=$(cat <<'J30'
{"to":"@@AREA_RUNS@@","says":"`lib/run-ledger.js`: `landingPrUrls` skips only blind reads and survey reports, so a comment headed `## Area read` that names a full PR URL would join the ticket's landing. Only the prose rule in `docs/plans/survey/area-read.md` (cite `path@sha`, never a PR URL) keeps the LIN-4447 area reads out today. An area-read kind in the one comment classifier (LIN-4458, piece 2) would make that rule code. (Leftover of LIN-4453; Survey global on LIN-4453.)"}
J30
)
P=$(sub "$P")
AREA_RUNS_W11=$(L add finding --by Harbour --at 2026-11-13T14:54:55Z "$P" | idof)
# Waiting 12 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J31'
{"to":"@@AREA_RUNS@@","says":"`lib/run-closeout-state.js`: `deriveCloseOutState` works from two PR lists: `prs` (`extractPrUrls`, every PR ever cited) drives the PR-shape reasons (multiple-prs, partial, merged) and `landingPrs` (`landingPrUrls`) drives the blind-read gate, so the box can count PRs the gate ignores and the other way round (pinned in `tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15). Which reader answers \"this task's PRs\" spans the box, the guard and the route. (Blind read on LIN-4439.)"}
J31
)
P=$(sub "$P")
AREA_RUNS_W12=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 13 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J32'
{"to":"@@AREA_RUNS@@","says":"`lib/close-out-readiness.js`: in the stop-at lane `deriveCloseOutState` lets merged and partial outrank the gate, then `closeOutNotReady` asks `closeOutWaitsOn` again to override it, so the box state is not the guard's whole answer and the precedence lives in two files. Carrying the gate's answer in the state changes the box model the renderers read. (Blind read on LIN-4439.) `ladderNotReady` asks the gate a third time, so the box and the guard order the same reasons two ways and the next close-out reason must be placed in both; one order is a decision about what the box shows versus what the guard refuses. (Blind read on LIN-4396.)"}
J32
)
P=$(sub "$P")
AREA_RUNS_W13=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 14 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J33'
{"to":"@@AREA_RUNS@@","says":"`lib/run-closeout-state.js`: the close-out reasons are bare string literals: `'blind-read-missing'` is spelled here and again in `REFUSED_REASONS` (`lib/close-out-readiness.js`, beside `'head-moved'`), and `closeOutNotReadyRefusal` builds its error by capitalising `state.message`. A reasons constant (like `CLOSE_OUT_STATUS`) covering every reason, used by the box, the guard and the render, would give them one vocabulary. (Blind read on LIN-4396.)"}
J33
)
P=$(sub "$P")
AREA_RUNS_W14=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 15 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J34'
{"to":"@@AREA_RUNS@@","says":"`lib/run-closeout-state.js`: `closeOutSetsDone` never asks `closeOutWaitsOn`, so the owner's check (`routes/workspace-api-run-evidence.js`) sets a stop-at-PR task Done when its landing PR is merged and approved with no blind read, while the close-out guard (`lib/close-out-readiness.js`) refuses the same trail as `blind-read-missing`, and `blindReadStep` (`lib/recommendation-blind-read.js`) then routes a read to the Done ticket (it stands aside on a completed ticket only after a close-out). The entries above name the box/guard precedence split; this is its Done path. Whether a person's own check may pass the gate is a decision; the shared-trail test runs with `byPersonCheck: false`, so it never reaches this path. (Drift & Coherence Review, 13 Nov., second read; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J34
)
P=$(sub "$P")
AREA_RUNS_W15=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 16 by position @ 0092d8d9e (first on main at 5dcf5bcda)
P=$(cat <<'J35'
{"to":"@@AREA_RUNS@@","says":"`lib/cost-read-calls.js`: `readCalls` states the figure rule (`totalUsd` only when everything is priced and complete; `pricedUsd` never counts a partial) in its own words, and the lineage figure in `lib/cost-read.js` states it again, so a change to the rule is made twice. One shared helper would make it one, but it reaches the lineage path and its goldens: larger than a fix. (LIN-4457 leftovers; Survey global on LIN-4457.)"}
J35
)
P=$(sub "$P")
AREA_RUNS_W16=$(L add finding --by Harbour --at 2026-11-13T15:49:16Z "$P" | idof)
# Waiting 17 by position @ 0092d8d9e (first on main at 192e1f81f)
P=$(cat <<'J36'
{"to":"@@AREA_RUNS@@","says":"`lib/dispatch-feedback-kinds.js`: the table's `mayCarryWake` column is `true` on every row (unknown kinds pass too), so `findWakeEvent` (`lib/dispatch-terminal.js`) never skips a kind, while `lastWakeEntry` (`lib/run-view.js`) skips the decision-stamp kinds as \"never a wake marker\". Two wake scans disagree about stamps, and the column only records `findWakeEvent`'s behaviour. Removing the column or making it true to both readers means deciding whether `findWakeEvent` should skip stamps, which changes wake minting and every reader of stored rows. (LIN-4455 blind read.)"}
J36
)
P=$(sub "$P")
AREA_RUNS_W17=$(L add finding --by Harbour --at 2026-11-13T16:09:25Z "$P" | idof)
# Waiting 18 by position @ 0092d8d9e (first on main at 0092d8d9e)
P=$(cat <<'J37'
{"to":"@@AREA_RUNS@@","says":"`lib/dispatch-factory.js`: `refusesHermeticToken` skips access for a provider that declares `testTransport` (`LinearProvider`, `lib/providers/linear/index.js`), but nothing links that declaration to the transport swaps it describes (`routes/test.js` `installTestTokenLinearTransport`, `tests/fixtures/hermetic-linear.js`), so a new installer or a change to Linear's can drift from it silently. Closing it means deciding where test transports register (for example installers that declare which provider they cover, plus a census test), across providers, web routes and fixtures: larger than a fix. (LIN-4456 blind read, 13 Nov.)"}
J37
)
P=$(sub "$P")
AREA_RUNS_W18=$(L add finding --by Harbour --at 2026-11-13T16:19:20Z "$P" | idof)

# Area: LLM & prompts (registry docs/areas/areas.json @ 0092d8d9e), by Harbour. Note docs/areas/llm-and-prompts.md @ 0092d8d9e.
# Entries present at 4b5001ddf are dated 12:00Z (before the parents were filed); later ones at the main-line commit that added them.
P=$(cat <<'J38'
{"name":"LLM & prompts","paths":["lib/prompts/","lib/as-asked.js","lib/size-of-move.js","lib/openrouter","lib/prompt-","lib/stage-router.js","lib/recommend","lib/recommendation-","lib/chat-","lib/agent-turn.js","lib/bash-tool.js","lib/llm-call-log.js","lib/llm-jobs.js","lib/model-routing","lib/model-pricing.js","lib/catalog-rate.js","lib/call-budget.js","lib/should-mock-ai.js","lib/brief","lib/recap","lib/collective-","lib/yap-client.js","lib/north-star-resolver.js","lib/scan.js","lib/scan-fingerprint.js","lib/audit.js","lib/roadmap.js","lib/context-graph.js","lib/graph-features.js","lib/library.js","lib/library-metadata.js","lib/custom-prompts-store.js","lib/saved-chat-store.js","lib/file-pointer.js","lib/feedback-title.js","lib/action-kind.js","lib/flight-companion-gate.js","lib/flight-companion-census-seed.js","lib/harbour-comments-store.js","lib/report-history-store.js","lib/ship-biscuit.js","lib/ship-biscuit-history-store.js","lib/periodicals.js"]}
J38
)
P=$(sub "$P")
AREA_LLM=$(L add area --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 1 (first on main at 4b5001ddf)
P=$(cat <<'J39'
{"in":"@@AREA_LLM@@","says":"Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its ticket and reason beside the ceiling and `FROZEN_TOTAL_BYTES`; old reasons go to \"Ceiling history\" in `scripts/prompt-template-change-log.md`.","paths":["scripts/prompt-template-change-log.md"],"checked-at":"0092d8d9e"}
J39
)
P=$(sub "$P")
AREA_LLM_L1=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 2 (first on main at 4b5001ddf)
P=$(cat <<'J40'
{"in":"@@AREA_LLM@@","says":"Grounding lists in `lib/prompt-formatters.js` are shared (`WORK` serves several stages, `GROUNDING_NOTES` unknown kinds): give one stage its own list (LIN-4371).","paths":["lib/prompt-formatters.js"],"checked-at":"0092d8d9e"}
J40
)
P=$(sub "$P")
AREA_LLM_L2=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 3 (first on main at 4b5001ddf)
P=$(cat <<'J41'
{"in":"@@AREA_LLM@@","says":"Keep scoping and both Survey renders byte-identical unless a ticket is about them (replays compare them, LIN-4369).","paths":[],"checked-at":"0092d8d9e"}
J41
)
P=$(sub "$P")
AREA_LLM_L3=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 4 (first on main at 4b5001ddf)
P=$(cat <<'J42'
{"in":"@@AREA_LLM@@","says":"The Surveys get no area notes pointer: survey-place reads no shape reports, which feed the notes. Scoping cites its pointer in its final message; both share `AREA_NOTES_WHERE` (LIN-4346).","paths":[],"checked-at":"0092d8d9e"}
J42
)
P=$(sub "$P")
AREA_LLM_L4=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 5 (first on main at 4b5001ddf)
P=$(cat <<'J43'
{"in":"@@AREA_LLM@@","says":"`lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase, then re-measure. Its fixture passes no context (the empty-context branch), so dropping one can raise a ceiling while real renders shrink (LIN-4393).","paths":["lib/prompt-template-defs.js"],"checked-at":"0092d8d9e"}
J43
)
P=$(sub "$P")
AREA_LLM_L5=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 6 (first on main at 4b5001ddf)
P=$(cat <<'J44'
{"in":"@@AREA_LLM@@","says":"The `## As asked` block's words have one owner, `lib/as-asked.js`: import its spellings, never retype the heading or end line (LIN-4362).","paths":["lib/as-asked.js"],"checked-at":"0092d8d9e"}
J44
)
P=$(sub "$P")
AREA_LLM_L6=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 7 (first on main at 4b5001ddf)
P=$(cat <<'J45'
{"in":"@@AREA_LLM@@","says":"`lib/prompt-template-defs.js` cannot import what imports `lib/prompt-templates.js` (a cycle): shared words live in an import-free leaf, as `lib/prompts/leftover-words.js` (LIN-4376) and `lib/prompts/autopilot-precedence.js` (never restate a rank; LIN-4382).","paths":["lib/prompt-template-defs.js","lib/prompt-templates.js","lib/prompts/leftover-words.js","lib/prompts/autopilot-precedence.js"],"checked-at":"0092d8d9e"}
J45
)
P=$(sub "$P")
AREA_LLM_L7=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 8 (first on main at 4b5001ddf)
P=$(cat <<'J46'
{"in":"@@AREA_LLM@@","says":"Prompt words banning a kind of how do not hold it (LIN-4369's replay: closing one channel moved it to the next). Hold the shape in code or a test (`SIZE_RECORD_SHAPE`, `lib/size-of-move.js`, arm 3) or hold the reader's side (arm 4).","paths":["lib/size-of-move.js"],"checked-at":"0092d8d9e"}
J46
)
P=$(sub "$P")
AREA_LLM_L8=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 9 (first on main at 4b5001ddf)
P=$(cat <<'J47'
{"in":"@@AREA_LLM@@","says":"A stage lead's first sentence is the selector's purpose line: changing it means new router snapshots, `scripts/eval/meta-prompt.baseline.txt` and routing ceiling (LIN-4369).","paths":["scripts/eval/meta-prompt.baseline.txt"],"checked-at":"0092d8d9e"}
J47
)
P=$(sub "$P")
AREA_LLM_L9=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 10 (first on main at 4b5001ddf)
P=$(cat <<'J48'
{"in":"@@AREA_LLM@@","says":"`lib/prompts/autopilot-precedence.js`: check real rows reach a server guard before prompt text bypasses it (LIN-4349). A scoped run's Periodical is opt-in by goal: no tail, no flag (LIN-4415).","paths":["lib/prompts/autopilot-precedence.js"],"checked-at":"0092d8d9e"}
J48
)
P=$(sub "$P")
AREA_LLM_L10=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 11 (first on main at 4b5001ddf)
P=$(cat <<'J49'
{"in":"@@AREA_LLM@@","says":"`lib/periodicals.js`: close-out merges a Periodical's PR and sets Done as for any task; give no Periodical its own merge rule: notes are prompt input (LIN-4390). The rule is retyped in five files; only a test links them.","paths":["lib/periodicals.js"],"checked-at":"0092d8d9e"}
J49
)
P=$(sub "$P")
AREA_LLM_L11=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 12 (first on main at 4b5001ddf)
P=$(cat <<'J50'
{"in":"@@AREA_LLM@@","says":"Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358); tests seed `tests/unit/helpers/pinned-catalog.js`.","paths":[],"checked-at":"0092d8d9e"}
J50
)
P=$(sub "$P")
AREA_LLM_L12=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 13 (first on main at 4b5001ddf)
P=$(cat <<'J51'
{"in":"@@AREA_LLM@@","says":"`lib/library.js` takes a shelf doc's summary by position (`firstParagraphAfterTitle`): a paper that opens with a figure keeps its alt text under 12 words, or the alt text becomes the summary; a rewritten first paragraph re-pins `tests/fixtures/library-doc-summaries.json` (LIN-4428).","paths":["lib/library.js"],"checked-at":"0092d8d9e"}
J51
)
P=$(sub "$P")
AREA_LLM_L13=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 14 (first on main at 4b5001ddf)
P=$(cat <<'J52'
{"in":"@@AREA_LLM@@","says":"A blind reader's limits are instructions, not access: with the repository checked out it can still see commit subjects (`git worktree add` prints the head's) and area notes. Both slipped, harmlessly, in the LIN-4436 pilot. Code hands a blind stage SHAs and PR URLs, never a PR body or commit log.","paths":[],"checked-at":"0092d8d9e"}
J52
)
P=$(sub "$P")
AREA_LLM_L14=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 15 (first on main at 4b5001ddf)
P=$(cat <<'J53'
{"in":"@@AREA_LLM@@","says":"`lib/periodicals.js`: Stability defers to a repo's committed declaration of its measures and names none (LIN-4424): change Harbour's measures in `docs/reviews/stability-measures/README.md` and its script, never in the shared template; a test links the bullet's list to that README.","paths":["lib/periodicals.js"],"checked-at":"0092d8d9e"}
J53
)
P=$(sub "$P")
AREA_LLM_L15=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 16 (first on main at 4b5001ddf)
P=$(cat <<'J54'
{"in":"@@AREA_LLM@@","says":"A new stage kind is a row in every table `tests/unit/stage-kind-tables.test.js` reads: add it, or list it there as out with the reason. A kind in `SPINE` (`lib/run-view.js`) also moves the run page's \"n of N\", the session and task-page goldens (`UPDATE_RENDER_SESSION_GOLDEN=1`, `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`) and the E2E count pins; read the golden diff before accepting it (LIN-4437).","paths":["lib/run-view.js"],"checked-at":"0092d8d9e"}
J54
)
P=$(sub "$P")
AREA_LLM_L16=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lesson 17 (first on main at 4b5001ddf)
P=$(cat <<'J55'
{"in":"@@AREA_LLM@@","says":"`formatCiGateCheck` (`lib/prompt-formatters.js`) renders in implementation, review and close-out: a rule for one stage gets its own formatter beside it. Prove the others unchanged by rendering every kind, fresh and fix round, at HEAD and on the branch, not by the budget test, whose ceilings are caps (LIN-4441).","paths":["lib/prompt-formatters.js"],"checked-at":"0092d8d9e"}
J55
)
P=$(sub "$P")
AREA_LLM_L17=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 1 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J56'
{"to":"@@AREA_LLM@@","says":"`lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`, `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build context by hand: a new field must reach all five (LIN-4368 missed one; LIN-4393 leftovers.)"}
J56
)
P=$(sub "$P")
AREA_LLM_W1=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 2 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J57'
{"to":"@@AREA_LLM@@","says":"`lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in for John's \"per task breakdown of options\"; its size words are unexplained. (John, LIN-4393.)"}
J57
)
P=$(sub "$P")
AREA_LLM_W2=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 3 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J58'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/stage-intent.js`: `CUT` writes the closing contract's token order (`DECISION:` before `BLOCKED:`) into a scope line beside `ASK`. Its \"cut\" and the plan-review and review \"narrowing\" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)"}
J58
)
P=$(sub "$P")
AREA_LLM_W3=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 4 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J59'
{"to":"@@AREA_LLM@@","says":"`lib/prompt-template-defs.js`: a stage kind is a row in ~fourteen parallel tables (`GROUNDING_BY_KIND`, ceilings, completion signals, labels…): fold them into one definition. (Survey tally, LIN-4248.)"}
J59
)
P=$(sub "$P")
AREA_LLM_W4=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 5 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J60'
{"to":"@@AREA_LLM@@","says":"`lib/call-budget.js`: the budget rule is untested live on anthropic/claude-haiku-5.5; before moving a call there, replay LIN-4352's snapshot through `scripts/replay-brief.mjs`: block [2] WHOLE, four sections, finishReason=stop, any retry's reasoning bound accepted. REFUSED: change the rule first. (John, LIN-4358.)"}
J60
)
P=$(sub "$P")
AREA_LLM_W5=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 6 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J61'
{"to":"@@AREA_LLM@@","says":"`lib/call-budget.js`: split: `resolveReasoningBudget`/`isReasoningModel` stay in `lib/openrouter.js`; tool hops and the routing pair get the budget, not the retry; `canReason` has test callers only. (Area reads CG/CH.)"}
J61
)
P=$(sub "$P")
AREA_LLM_W6=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 7 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J62'
{"to":"@@AREA_LLM@@","says":"`lib/openrouter.js`: `SUGGESTED_MODEL_IDS` and `DISPATCH_MODEL_SUGGESTIONS` (`lib/model-routing-harnesses.js`) repeat ids by hand, unchecked; the first is also the cold-catalog fallback. (Area reads CG/CH.)"}
J62
)
P=$(sub "$P")
AREA_LLM_W7=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 8 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J63'
{"to":"@@AREA_LLM@@","says":"`lib/periodicals.js`: `docs/areas/` is spelled in 26 lines across 11 code files (`lib/`, `routes/`, `public/`, `server.js`, `scripts/`), up from 17 in 10 at the 10 Nov reading, and two leaves now spell the directory: `REGISTRY_PATH` (`lib/prompts/area-registry-path.js`) and `NOTES_DIR` (`lib/prompts/area-note-format.js`, LIN-4420), neither derived from the other. Moving the notes means editing both leaves and the prose. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`; count, Documentation Review; recounted, Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J63
)
P=$(sub "$P")
AREA_LLM_W8=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 9 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J64'
{"to":"@@AREA_LLM@@","says":"`lib/recommendation-live-wait.js`: a read, not a claim: two different-kind calls racing on one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392)."}
J64
)
P=$(sub "$P")
AREA_LLM_W9=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 10 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J65'
{"to":"@@AREA_LLM@@","says":"`lib/recommendation-live-wait.js`: the live-stage refusal (`liveWaitRefusal`, 409 `STAGE_IN_FLIGHT`) is a Runs dispatch rule placed here by the `^lib/recommendation-` prefix. `lib/dispatch-entrance.js` (Runs) enforces it, `routes/workspace-api.js` (Web) imports it, `lib/proxy-instructions.js` (Agent API) takes its code, and the one run-state test it makes, `isLiveRun`, is in `lib/recent-runs.js` (Runs), so a change to what counts as live moves three areas. `lib/openrouter.js` (LLM) also routes on it, as the first code-settled route in `codeRouteOf`, so the wait is recommendation logic as well. A size of move: give the wait a Runs home. (Seams & Tangles, 13 Nov.; `docs/reviews/seams-tangles-review-2026-11-13-run12.md`.)"}
J65
)
P=$(sub "$P")
AREA_LLM_W10=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 11 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J66'
{"to":"@@AREA_LLM@@","says":"`lib/periodicals.js`: two sizes of move: a ceiling for Periodical prompts (+18.8% in the window, 185,952 to 220,882 B; only a sha256 tripwire), and an index or series archive for `docs/reviews/` (109 top-level reports, 88 MB). (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J66
)
P=$(sub "$P")
AREA_LLM_W11=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 12 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J67'
{"to":"@@AREA_LLM@@","says":"`lib/prompt-formatters.js`: eight stage kinds are told notes bind, yet `tests/unit/area-notes.test.js` checks shape only and close-out writes review-worded entries to main unreviewed: no content boundary on who adds a Lesson. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)"}
J67
)
P=$(sub "$P")
AREA_LLM_W12=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 13 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J68'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/autopilot-kickoff.js`: a dispatch holder's `goal` is \"Goal from the human\" (ranked first), a periodical mint `note` \"the operator\" (`lib/periodicals.js`): attribute both to the minting token. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)"}
J68
)
P=$(sub "$P")
AREA_LLM_W13=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 14 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J69'
{"to":"@@AREA_LLM@@","says":"`lib/library.js`: summaries come from first-paragraph position, so an opening image's alt text can become the summary and every shelf rewrite churns `tests/fixtures/library-doc-summaries.json`; a `summary:` front-matter field would end both, but changes every doc's summary source. (Survey global, LIN-4428.)"}
J69
)
P=$(sub "$P")
AREA_LLM_W14=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 15 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J70'
{"to":"@@AREA_LLM@@","says":"`lib/periodicals.js`: a reading's finding with no file in an area to cite goes to the closing comment, \"never in a ticket\", a live secret included, while `CONSEQUENCE_TEST` (`lib/prompts/leftover-words.js`) sends a find that touches safety to a ticket. The two rules in this area answer the live-secret case oppositely; having Periodicals render the gate needs John's ruling on that case first. (LIN-4401, LIN-4431.)"}
J70
)
P=$(sub "$P")
AREA_LLM_W15=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 16 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J71'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/leftover-words.js`: since `CONSEQUENCE_TEST` (LIN-4401), outside finds gather as Waiting entries in other areas' notes where tickets used to be filed. LIN-4414's one retirement per build drains only the areas a build touches, so rarely touched notes (other-features) will grow; their Waiting counts are the honest measure. (LIN-4431.)"}
J71
)
P=$(sub "$P")
AREA_LLM_W16=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 17 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J72'
{"to":"@@AREA_LLM@@","says":"`lib/prompt-template-defs.js` (retrospective-audit Reporting) and `lib/periodicals.js` (`areaNotesRoutes`) each state the docs-only notes-PR rule in their own words; one shared constant in `lib/prompts/leftover-words.js` would make it one, at the cost of re-pinning the 13 Periodical prompt hashes. (LIN-4432.)"}
J72
)
P=$(sub "$P")
AREA_LLM_W17=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 18 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J73'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/leftover-words.js`: the first-match area lookup is spelled three ways: `CONSEQUENCE_TEST`'s \"first match wins\" parenthetical, `docs/areas/README.md` (\"take the first area with a pattern that matches its path\") and the blind-read prompt's own sentence (`lib/prompt-template-defs.js`, the `blind-read` template), which shipped as piloted (LIN-4437), so it was not retyped after the pilot. One constant in the leaf would make it one, at the cost of re-piloting that sentence. (LIN-4436 leftovers.)"}
J73
)
P=$(sub "$P")
AREA_LLM_W18=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 19 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J74'
{"to":"@@AREA_LLM@@","says":"`lib/prompt-formatters.js`: `formatLocalTestRule` names this repo's runner command (`node scripts/run-unit-tests.mjs tests/unit/<files>`) in a template that also drives other repos, and `CLAUDE.md` spells the same rule; a repo-supplied test command would make the line right elsewhere and give it one spelling. (LIN-4441 leftovers.)"}
J74
)
P=$(sub "$P")
AREA_LLM_W19=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 20 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J75'
{"to":"@@AREA_LLM@@","says":"`lib/periodicals.js`: \"search the repo for a committed tool (no path is written here) and run it\" is spelled four times: Drift & Coherence's census bullet, Seams & Tangles' two bullets and Stability's declaration bullet. One shared helper would make it one, at the cost of re-pinning those three templates' hashes. (LIN-4424 leftovers; Survey global.) The rule it answers, whether a review may run a tool the repo commits, is itself worded per template: Stability's run bullet says \"introducing no tooling beyond what the repo commits\", while Recent Headwinds (which reads the same rework and churn trajectory) and Drift & Coherence still say \"introducing no new tooling\", Code Quality says \"introduce no new tooling\", and Seams & Tangles allows committed tools in its own bullets. No `periodicalBullet` helper owns it; deciding it is one rule re-pins every template that states it. (LIN-4424 blind read.)"}
J75
)
P=$(sub "$P")
AREA_LLM_W20=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 21 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J76'
{"to":"@@AREA_LLM@@","says":"`lib/model-routing-harnesses.js`: a dispatch record's `model` names the routed id (\"anthropic/claude-opus-4.8\" for the `opus` route), but the claude-code harness runs a Claude id by its family token (`isModelRunnableOn`, `CLAUDE_MAPPABLE_MODEL_FAMILIES`), and on blind-read dispatches d9bdf6d8, cced07ee and 0399b2e2 it ran `claude-opus-5-5`, so a record can misname the model that ran. Cost is already priced from the model the worker reports. Waiting: make the record carry the model the worker reports, or update the routed id. (LIN-4396 review.)"}
J76
)
P=$(sub "$P")
AREA_LLM_W21=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 22 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J77'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/blind-read-words.js`: its header says none retypes its words, but the kind is typed bare in `lib/recommendation-blind-read.js` (the run predicate and the dispatched step), `lib/pipeline-churn.js`, `lib/run-view.js` and `lib/run-closeout-state.js`, and has a second constant, `VIRTUAL_PROMPTS.BLIND_READ` (`lib/workflow-config.js`); `lib/completion-signals.js` types the heading (three times) and the verdict words instead of importing them. The route module does not import `BLIND_READ_KIND` at all, and `tests/unit/stage-kind-tables.test.js` checks presence, not these literals. LOW: a stored kind is rarely renamed; the leaf's claim is what is untrue. `lib/recommendation-blind-read.js` also redeclares `COMPLETED`. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J77
)
P=$(sub "$P")
AREA_LLM_W22=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 23 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J78'
{"to":"@@AREA_LLM@@","says":"`lib/openrouter.js`: the four routes code settles (the live-stage wait, the review loop bound, the blind read, the look-first sequence) are listed by hand in about nine places, no test pins any copy, and two are already wrong: `docs/architecture/prompt-system.md` says \"four routes\" and then restates three, without the blind read, and `public/llms.txt` says the blind read is \"Sent by hand\", where its description (`lib/prompt-template-defs.js`) says code sends it. The templates sync test checks that the catalogue bullet exists, not its words. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J78
)
P=$(sub "$P")
AREA_LLM_W23=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 24 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J79'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/leftover-words.js`: the retirement line's words have one home and one checker (`lib/dispatch-leftover-answer.js`), but which entry to settle (the busiest touched area, else another) and the three forms are restated by hand in `docs/areas/README.md`, simple-dispatcher's docs/areas/README.md, `docs/proxy-integration.md` (with the refusal kinds) and `docs/architecture/dispatch-and-proxy.md`, and the verbatim guard reads only `lib/` and `routes/`. simple-dispatcher's README says a waiting entry also leaves when \"a follow-up is filed for it\", where this README says only when the consequence test sends it to a ticket. A cross-repo seam; simple-dispatcher's side is named here, not edited. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J79
)
P=$(sub "$P")
AREA_LLM_W24=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 25 by position @ 0092d8d9e (first on main at 4b5001ddf)
P=$(cat <<'J80'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/area-note-format.js`: the one reading of a waiting entry in code does not hold what a cited path is; that rule is in the guard (`tests/unit/area-notes.test.js`, a listed extension), in `lib/dispatch-leftover-answer.js` (any one to six characters, its comment calling it the guard's rule) and in simple-dispatcher's guard. A retirement line can name a path the guard would not read as one. Borderline. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J80
)
P=$(sub "$P")
AREA_LLM_W25=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting 26 by position @ 0092d8d9e (first on main at 192e1f81f)
P=$(cat <<'J81'
{"to":"@@AREA_LLM@@","says":"`lib/prompts/runner-kickoff.js`: imports `FEEDBACK_ENTRY_KINDS` from the store (`lib/dispatch-store.js`), the only importer of the store's re-export of it (`export { FEEDBACK_ENTRY_KINDS } from './dispatch-feedback-kinds.js'`). Importing from the leaf `lib/dispatch-feedback-kinds.js` would let the store drop the shim and keep the prompt module off the store's import graph. The runner prompt bytes and the kinds' exact order must not change. (LIN-4455 blind read.)"}
J81
)
P=$(sub "$P")
AREA_LLM_W26=$(L add finding --by Harbour --at 2026-11-13T16:09:25Z "$P" | idof)

# Parent LIN-4447, filed 2026-11-13T12:08:12.387Z by John. asked = its ## As asked block, byte-exact from LIN-4447.json.
P=$(cat <<'J82'
{"ref":"LIN-4447","asked":"**Repository:** JKershaw/LinearViewer (Harbour).\n\n**What this is for.** John: \"we've not been applying quite the right force to bend the curve… now want to run both real work, and some real tidies.\" The Drift & Coherence and Seams & Tangles reviews of 13 Nov found this area carrying rules written in two places that disagree. Batch 1 added several of them:\n\n* Harbour can mark a task Done on a person's check before its blind read, while another check refuses that same task, and a read is then sent to a ticket that's already Done (Drift run 7, `close-out-gate-precedence-split`). John's ruling: \"if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour.\"\n* Two pieces of code decide which PRs belong to a task, and they disagree about agent notes, so a blind read can be offered over a PR no review covered (Seams run 12, §3.0a).\n* The task timeline decides which model a dispatch used by its own rule, separate from the one the cost figures use (Drift, row 150).\n* The check that makes a stage wait while another is live is a runs rule, but it lives with the prompts (Seams, P-LW1).\n\nThe area's note holds 20 Waiting entries, and `lib/dispatch-store.js` is 4,530 lines. Seams also tried moving files between areas three ways, and none made the tangle smaller.\n\n**What we want.**\n\n* Each rule in the area has one home, and the copies are gone.\n* When a person acts, Harbour follows, and that rule is written once.\n* The area's Waiting entries are settled, or each says why it can't be yet.\n* Each piece finishes one move and names what it retired. John: \"I'd be happy to run a small variety, erring larger, to see\", so piece sizes vary, leaning larger.\n* The LLM & prompts side of the seam is A14's.\n\n**Done when**\n\n* the cases above are settled, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.\n\n**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*","done-when":"* the cases above are settled, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.","paths":["lib/dispatch-store.js"]}
J82
)
P=$(sub "$P")
PARENT=$(L add task --by John --via driving-session --at 2026-11-13T12:08:12.387Z "$P" | idof)

# LIN-4448 (LLM & prompts parent, A14), filed 2026-11-13T12:08:14.585Z by John; seeded so asks can be addressed to it. asked byte-exact from LIN-4448.json.
P=$(cat <<'J83'
{"ref":"LIN-4448","asked":"**Repository:** JKershaw/LinearViewer (Harbour).\n\n**What this is for.** The tightest tangle in Harbour is between LLM & prompts and Runs & dispatch: the links between the two areas grew from 32 one way and 50 the other to 38 and 55 over batch 1 (Seams run 12). On this side:\n\n* the list of routes that code settles without asking a model is copied about nine times, and `docs/architecture/prompt-system.md` and `public/llms.txt` already describe it wrongly (Drift, row 154);\n* the blind read's name and heading are retyped outside the file that defines them (Drift, row 151);\n* batch 1 added rules to the prompts as text (the frozen prompt total rose about 21,000 bytes, to 378,915). John on that limit: \"That limit is to push against lists if rules. Worth knowing, but not hard and fast.\";\n* LIN-4350 asks to fold the rules together into plainer, more general instructions.\n\nThe safety pass (A5, LIN-4400) found two themes here: merge and read-only limits that exist only in prompt text (LIN-1242, LIN-1273, LIN-3417), and tokens inside prompt text (LIN-1372, LIN-1395, LIN-1408). Both are part of A12 (LIN-4416). The area's note holds 26 Waiting entries.\n\n**What we want.**\n\n* Each rule has one home; the copies are gone, and the docs say what the code does.\n* A limit that matters is held in code, not only in a prompt's words.\n* Fewer rules are restated as lists in prompt text.\n* The area's Waiting entries are settled, or each says why it can't be yet.\n* Each piece finishes one move and names what it retired; piece sizes vary, leaning larger.\n* The Runs & dispatch side of the seam is A13's.\n\n**Done when**\n\n* the cases above are settled, or John has ruled they can wait;\n* the safety tickets named above are closed in code for that reason, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.\n\n**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*","done-when":"* the cases above are settled, or John has ruled they can wait;\n* the safety tickets named above are closed in code for that reason, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times."}
J83
)
P=$(sub "$P")
LIN4448=$(L add task --by John --via driving-session --at 2026-11-13T12:08:14.585Z "$P" | idof)

# Ruling lin4447-sd-scope, raised by scoping at 2026-11-13T13:26:41.331Z.
P=$(cat <<'J84'
{"in":"@@PARENT@@","to":"John","asks":"LIN-4447: are the simple-dispatcher halves of the copied rules (sessionPrs, columnProblems, transcript fold) in scope? The size record assumes yes.","options":["Yes, change both repos so the copies are gone","No, LinearViewer only; record 'the copies are gone' as a cut and leave those Waiting entries explaining why"],"recommended":"Yes, change both repos so the copies are gone","if-unanswered":"keep the size record as written, with simple-dispatcher in scope"}
J84
)
P=$(sub "$P")
Q_SD=$(L add question --by scoping --at 2026-11-13T13:26:41.331Z "$P" | idof)
# Ruling lin4447-r1-passenger-scope, raised by design at 2026-11-13T13:32:55.976Z.
P=$(cat <<'J85'
{"in":"@@PARENT@@","to":"John","asks":"LIN-4447 R1: Does 'Harbour is a passenger' cover both a person marking the ticket Done and a merge made outside Harbour? If so, no blind read is routed and Harbour's gate stands aside for that landing. Piece 1 waits on this.","options":["Both: a person's Done and an outside merge","Only a person marking Done"],"recommended":"Both: a person's Done and an outside merge"}
J85
)
P=$(sub "$P")
Q_R1=$(L add question --by design --at 2026-11-13T13:32:55.976Z "$P" | idof)

# The seam ask: LIN-4447's unblock session (Harbour's `blocked` stage, not a declared actor, so --by Harbour --via blocked) posted it on LIN-4448 at 13:36:44 (comment d3ba7421).
P=$(cat <<'J86'
{"in":"@@PARENT@@","to":"@@LIN4448@@","asks":"## From LIN-4447 (Runs & dispatch): three proposed seam moves, for your reply\n\nLIN-4447's design (comment \"Design: LIN-4447 @ 4b5001ddf\") moves three things across our shared seam. Its pieces 2 and 4 wait on your agreement, so here are the moves, each with the reason it lands on the Runs side. Please reply on LIN-4447 with **agree**, or with the boundary you want instead. That ticket's other pieces don't wait on this.\n\n1. **One comment classifier, home in `lib/run-trail.js` (Runs).** `commentKindOf(body)` would hold close-out, review summary, blind read, survey, audit report and agent note. At the moment these are split between `lib/run-ledger.js` and `lib/recommendation-facts.js`. `recommendation-facts.js` would import `isAgentNote`, `isRuling`, `isPersonComment` and `isAuditReport` from there. `isLandingEvidence` and `auditAfterLandingCloseOut`'s private notes-PR set would retire into `readTrail(...).landing`/`workAfterReview`. **Fallback if you'd rather own it:** the classifier stays in `recommendation-facts.js` and Runs imports it. Either way there is one classifier, not two.\n2. **The live-stage wait moves to `lib/run-live-wait.js`.** It takes `liveWaitOf`, `liveWaitRefusal` and `STAGE_IN_FLIGHT` from `lib/recommendation-live-wait.js`, and `isLiveRun` from `recent-runs.js`. The old file is deleted with no re-export shim. Callers in your area (`openrouter.js`, `proxy-instructions.js`) change their import path only. This settles your note's Waiting entry \"`recommendation-live-wait.js`: the live-stage refusal … is a Runs dispatch rule\" (Seams, 13 Nov). Your note's claim compare-and-set entry moves to the Runs note unchanged.\n3. **`blindReadStep` (`lib/recommendation-blind-read.js`) reads the shared close-out decision.** It would use `closeOutDecision().waitsOn`/`followsPerson` and drop its own `isTerminalState`/`COMPLETED` test, which retires your \"`COMPLETED` redeclared\" Waiting clause. The file stays yours. Only the rule it applies moves to Runs. This is LIN-4447 piece 1, which also waits on John's R1.\n\nYour hand-maintained code-route lists (`openrouter.js`, about nine copies) stay yours. LIN-4447 adds no copy of them.\n","options":["agree","the boundary you want instead"],"if-unanswered":"Its pieces 2 and 4 wait on your agreement. That ticket's other pieces don't wait on this."}
J86
)
P=$(sub "$P")
Q_SEAM=$(L add question --by Harbour --via blocked --at 2026-11-13T13:36:44.276Z "$P" | idof)

# Plan pieces, by design (Harbour's plan stage), in the parent, as walk 4 seeded them; piece 4's text is its paragraph
# in the Implementation Plan, verbatim. order = landing step: 0; then 3/5/6/7; then 2/4; then 1; then 8.
P=$(cat <<'J87'
{"in":"@@PARENT@@","says":"Piece 0: paired readability baseline (no code). Fresh agents read Runs & dispatch and the untouched control `front-end-pages` in one window, by a committed sampling rule and short rubric; each report posted as `## Area read`. Witness: both reports and the rubric are on the ticket before any piece merges. Retires nothing (a measurement). Repeated after the last piece.","paths":[],"order":1}
J87
)
P=$(sub "$P")
P0=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J88'
{"in":"@@PARENT@@","says":"Piece 1 (larger): one close-out decision. `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor })` and `CLOSE_OUT_REASONS` in `lib/run-closeout-state.js`, answering `{ status, reason, refuses, setDone, waitsOn, followsPerson }`; the box, both guard lanes, the check route, `blindReadStep` and `run-evidence` render or enforce it. Settles Waiting 17, 18, 20 (plan numbering). Waits on R1.","paths":["lib/run-closeout-state.js","lib/close-out-readiness.js","routes/workspace-api-run-evidence.js","lib/recommendation-blind-read.js","lib/run-evidence.js","lib/close-out-merges.js"],"order":4}
J88
)
P=$(sub "$P")
P1=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J89'
{"in":"@@PARENT@@","says":"Piece 2 (larger): one trail pass. `lib/run-trail.js` holds the one comment classifier `commentKindOf` and `readTrail(comments)`; the landing is the PRs first cited after the anchor. Settles Waiting 15 (row 15 kept as a why-not) and 16 (plan numbering). Ask LIN-4448 first.","paths":["lib/run-trail.js","lib/run-ledger.js","lib/recommendation-facts.js","lib/run-evidence.js","scripts/stability-measures-blind.mjs"],"order":3}
J89
)
P=$(sub "$P")
P2=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J90'
{"in":"@@PARENT@@","says":"Piece 3 (small): model attribution. `dispatchesOf` in `lib/cost-read.js` carries the fold's `last.model`; retires `dispatchModelOf`. Settles Waiting 19 (plan numbering).","paths":["lib/cost-read.js","lib/task-timeline.js"],"order":2}
J90
)
P=$(sub "$P")
P3=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J91'
{"in":"@@PARENT@@","says":"**Piece 4 (medium): the live-stage wait gets a Runs home.** `lib/run-live-wait.js` holds `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT` and the live predicate; `lib/recommendation-live-wait.js` is deleted, with no re-export, and the importers listed above are updated. Behaviour change in the same move: a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` is not live (today `runFact` reads only the row, so it holds the wait until aborted). `isLiveRun` is a predicate over a run fact's `outcome`, so the fix is in how `runFact` sets `outcome`, through the existing follow-up and held-wake lineage helpers; the builder confirms that against the code. The claim compare-and-set note moves from the LLM note to the Runs note unchanged. *Retires:* the old module and `runFact`'s row-only read. *Settles Waiting:* 14, and the LLM-side entry with A14. *Witness:* extend `lin-4392-live-stage-wait.test.js` with the `[pending]`-then-`[blocked]` lineage (fails before, passes after) and a census that nothing outside `lib/run-live-wait.js` spells the wait. Keep `area-map-placement` green; `run-live-wait.js` already matches Runs by its `run-` prefix.","paths":["lib/run-live-wait.js","lib/recommendation-live-wait.js","lib/recent-runs.js"],"order":3}
J91
)
P=$(sub "$P")
P4=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J92'
{"in":"@@PARENT@@","says":"Piece 5 (medium): one declaration for each restated constant. `lib/dispatch-leftover.js` and `_releaseIfHeld` import halt modes, `NEVER_RAN` and the follow-up target from their owners; `wakeHook.releaseNote` supplies the release wording so the store no longer calls `formatHeldWakeNote`; one `FEEDBACK_KINDS` table in `lib/dispatch-feedback-validation.js` carries each kind's roles, and `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it. *Retires:* the restated constants and the three hand-written kind sets. *Settles Waiting:* 2, 4, 11. *Witness:* a test that iterates `HALT_MODES` and shows every one stops a leftover (so a newly added mode is caught), and `lin-4377` counting the import, not the spelling.","paths":["lib/dispatch-leftover.js","lib/dispatch-store.js","lib/dispatch-feedback-validation.js"],"order":2}
J92
)
P=$(sub "$P")
P5=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J93'
{"in":"@@PARENT@@","says":"Piece 6 (small): hermetic transport. A provider declares `testTransport` where its transport is swapped; the factory skips access when `provider.testTransport && isHermeticTestToken(token)`. Settles Waiting 8.","paths":["lib/dispatch-factory.js","routes/test.js","tests/fixtures/hermetic-linear.js"],"order":2}
J93
)
P=$(sub "$P")
P6=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J94'
{"in":"@@PARENT@@","says":"Piece 7 (small): cost-call reads. `readCalls` and `callsSurfaceOf` move to `lib/cost-read-calls.js`, with a Runs pattern in `areas.json`. Settles Waiting 9.","paths":["lib/cost-read.js","lib/cost-read-calls.js","docs/areas/areas.json"],"order":2}
J94
)
P=$(sub "$P")
P7=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J95'
{"in":"@@PARENT@@","says":"Piece 8 (later, cross-repository): simple-dispatcher. Waiting 1, 6, 7 and 13 get one owner and a drift check per rule (in `lib/runner-kit/contract.json` as data, or a golden test); planned in detail at its own start, after 1 to 7. Waiting 10 written as an engineering call.","paths":["lib/runner-kit/","lib/dispatch-wake.js","lib/session-summary.js"],"order":5}
J95
)
P=$(sub "$P")
P8=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
# The plan names where the work is expected.
P=$(cat <<'J96'
{"paths":["docs/areas/areas.json","docs/areas/llm-and-prompts.md","docs/areas/runs-and-dispatch.md","lib/close-out-merges.js","lib/close-out-readiness.js","lib/cost-read-calls.js","lib/cost-read.js","lib/dispatch-factory.js","lib/dispatch-feedback-validation.js","lib/dispatch-leftover.js","lib/dispatch-store.js","lib/dispatch-wake.js","lib/recent-runs.js","lib/recommendation-blind-read.js","lib/recommendation-facts.js","lib/recommendation-live-wait.js","lib/run-closeout-state.js","lib/run-evidence.js","lib/run-ledger.js","lib/run-live-wait.js","lib/run-trail.js","lib/runner-kit/","lib/session-summary.js","lib/task-timeline.js","routes/test.js","routes/workspace-api-run-evidence.js","scripts/stability-measures-blind.mjs","tests/fixtures/hermetic-linear.js"]}
J96
)
P=$(sub "$P")
L revise "$PARENT" --by design --at 2026-11-13T13:40:00Z --reason "The Implementation Plan names the files each piece changes (plan rev 1)." "$P" >/dev/null

# Plan review round 1 (13:46:36, comment e452fe3a): request-changes, blocking B1 on piece 1 only.
P=$(cat <<'J97'
{"in":"@@PARENT@@","links":{"on":"@@P1@@@1"},"of":"plan-review","outcome":"request-changes","reasoning":"Request Changes (comment e452fe3a). B1: closeOutDecision's inputs (the ticket's state, whether the landing is merged) are not held by two to four of its six surfaces, and the plan does not say where each gets them or what the decision answers when one is unknown; built as written the surfaces split on an outside merge. Pieces 3, 6 and 7 hold as written; pieces 0, 3, 5, 6 and 7 don't depend on B1."}
J97
)
P=$(sub "$P")
V1=$(L add verdict --by plan-review --at 2026-11-13T13:46:36.011Z "$P" | idof)
# Plan revision 2 (13:53:21, comment 84a944a9): B1 settled in piece 1; piece 4 takes builder note 5 (real names, lineage rows reach runFact).
P=$(cat <<'J98'
{"says":"Piece 1 (larger): one close-out decision. `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor, ticketState })` and `CLOSE_OUT_REASONS` in `lib/run-closeout-state.js`, answering `{ status, reason, refuses, setDone, waitsOn, routesRead, followsPerson }`. Enforcement uses only the trail and URL-keyed PR statuses (gate stands aside only when every landing PR reads merged; missing or unreadable means not known merged, the gate holds); `ticketState` feeds only the advice `routesRead`, asked by `blindReadStep`. No new GitHub or provider read. Settles Waiting 17, 18, 20 (plan numbering). Merge held on R1 and the recommend-path ruling."}
J98
)
P=$(sub "$P")
L revise "$P1" --by design --at 2026-11-13T13:53:21.272Z --reason "Answers plan-review B1 (comment e452fe3a): per-surface inputs named, unknown means not known merged, ticket state only for advice." "$P" >/dev/null
P=$(cat <<'J99'
{"says":"**Piece 4 (medium): the live-stage wait gets a Runs home.** `lib/run-live-wait.js` holds `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE`, `newestLiveRun` and the live predicate (`isLiveRun`); `lib/recommendation-live-wait.js` is deleted, with no re-export, and the importers listed above are updated. Behaviour change in the same move: a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` is not live (today `runFact` reads only the row, so it holds the wait until aborted). `isLiveRun` is a predicate over a run fact's `outcome`, and `runFact(r, aborted)` (`lib/recent-runs.js:66`) sees one row at a time, so the fix is to pass it the lineage's rows and read the terminal through the existing follow-up and held-wake lineage helpers; its two callers (`recentRuns`, `loadRecentRuns`) hand the rows over. The claim compare-and-set note moves from the LLM note to the Runs note unchanged. *Retires:* the old module (no re-export; the census uses the four real names) and `runFact`'s row-only read. *Settles Waiting:* 14, and the LLM-side entry with A14. *Witness:* extend `lin-4392-live-stage-wait.test.js` with the `[pending]`-then-`[blocked]` lineage (fails before, passes after) and a census that nothing outside `lib/run-live-wait.js` spells the wait. Keep `area-map-placement` green; `run-live-wait.js` already matches Runs by its `run-` prefix."}
J99
)
P=$(sub "$P")
L revise "$P4" --by design --at 2026-11-13T13:53:21.272Z --reason "Plan revision 2 (comment 84a944a9): piece 4 uses the real names and the lineage rows reach runFact (plan-review builder note 5)." "$P" >/dev/null
# The third ruling, raised by the plan stage at 2026-11-13T13:53:31.293Z.
P=$(cat <<'J100'
{"in":"@@PARENT@@","to":"John","asks":"LIN-4447: the ask says \"When a person acts, Harbour follows, and that rule is written once.\" The plan writes the rule once and follows an outside merge wherever a surface already reads the PR. The recommend path (`blindReadStep`) and the ladder guard lane make no PR read, so they follow a person's Done but not an outside merge on a ticket still In Progress, and the recommend path may route one blind read over a merged landing. Accept this, or add a PR read there?","options":["Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up","Add a PR read on the recommend path and ladder lane (costs PR-state budget and token resolution there)"],"recommended":"Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up","if-unanswered":"Piece 1 is built as planned but its PR stays unmerged. Pieces 0, 3, 5, 6, 7, then 2 and 4, proceed."}
J100
)
P=$(sub "$P")
Q_RP=$(L add question --by design --at 2026-11-13T13:53:31.293Z "$P" | idof)

# Plan review round 2 (13:57:37, comment 12619798): Approve, over every piece at its current version.
P=$(cat <<'J101'
{"in":"@@PARENT@@","links":{"on":"@@P0@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 0 and its repeat cover \"reads better ... by more than an untouched area\"."}
J101
)
P=$(sub "$P")
V_P0=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J102'
{"in":"@@PARENT@@","links":{"on":"@@P1@@@2"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 1: enforcement reads only facts each surface has; unknown means the gate holds. Builder notes 1-4 and 6 concern it (ruling wording, the loosening property, the unmerged-PR set, readTrail fields, press-route order)."}
J102
)
P=$(sub "$P")
V_P1=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J103'
{"in":"@@PARENT@@","links":{"on":"@@P2@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 2: no note this round beyond its seam with piece 1 (readTrail supplies closeOutAfterReview/workAfterReview)."}
J103
)
P=$(sub "$P")
V_P2=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J104'
{"in":"@@PARENT@@","links":{"on":"@@P3@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 3 holds as last time."}
J104
)
P=$(sub "$P")
V_P3=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J105'
{"in":"@@PARENT@@","links":{"on":"@@P4@@@2"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 4: builder note 5, hand runFact the lineage before it is filtered."}
J105
)
P=$(sub "$P")
V_P4=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J106'
{"in":"@@PARENT@@","links":{"on":"@@P5@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 5: no note in either round; round 1 said it does not depend on B1. Settles Waiting 2, 4, 11."}
J106
)
P=$(sub "$P")
V_P5=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J107'
{"in":"@@PARENT@@","links":{"on":"@@P6@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 6 holds; its capability approach matches dispatch-factory.js:925-934."}
J107
)
P=$(sub "$P")
V_P6=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J108'
{"in":"@@PARENT@@","links":{"on":"@@P7@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 7 holds as last time."}
J108
)
P=$(sub "$P")
V_P7=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J109'
{"in":"@@PARENT@@","links":{"on":"@@P8@@@1"},"of":"plan-review","outcome":"approve","reasoning":"Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 8 keeps simple-dispatcher in scope, matching lin4447-sd-scope."}
J109
)
P=$(sub "$P")
V_P8=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)

# Breakdown (comment 49b291c4, 14:02:31): ten subtasks; the children up to LIN-4459 are written. LIN-4453 and LIN-4455 carry
# walk 4's done-when; the others are composed from the breakdown table and their piece. Creation times between 14:01:50 and
# LIN-4459's 14:01:57.719 are interpolated except LIN-4455's (see seed-log.md).
P=$(cat <<'J110'
{"in":"@@PARENT@@","ref":"LIN-4453","links":{"piece":"@@P0@@"},"asked":"","done-when":"LIN-4453 (piece 0, paired area reads before): both `## Area read` reports (Runs & dispatch and the control `front-end-pages`) and the committed rubric are on LIN-4447 before any implementation piece merges. Retires nothing (a measurement).","paths":[]}
J110
)
P=$(sub "$P")
T4453=$(L add task --by breakdown --at 2026-11-13T14:01:50Z "$P" | idof)
P=$(cat <<'J111'
{"in":"@@PARENT@@","ref":"LIN-4454","links":{"piece":"@@P3@@"},"asked":"","done-when":"LIN-4454 (piece 3, model attribution): `dispatchesOf` in `lib/cost-read.js` carries the fold's `last.model` and timeline rows read it. Retires `dispatchModelOf` and its ranking, and the Lesson clause that names it; settles Waiting 19 (plan numbering). Witness: the Drift case as a test (lane and row name the same model; with nothing priced, both name the latest). One session (small).","paths":["lib/cost-read.js","lib/task-timeline.js"]}
J111
)
P=$(sub "$P")
T4454=$(L add task --by breakdown --at 2026-11-13T14:01:53Z "$P" | idof)
P=$(cat <<'J112'
{"in":"@@PARENT@@","ref":"LIN-4455","links":{"piece":"@@P5@@"},"asked":"","done-when":"LIN-4455 (piece 5): `lib/dispatch-leftover.js` and `_releaseIfHeld` / `releaseHeldWake` in `lib/dispatch-store.js` import halt modes, `NEVER_RAN` and the follow-up target from their owners instead of restating them; `wakeHook.releaseNote` supplies the release wording, so the store no longer calls `formatHeldWakeNote` and stops owning that wording; one `FEEDBACK_KINDS` table in `lib/dispatch-feedback-validation.js` carries each kind's roles, and `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it. Retires the restated constants, the store's ownership of the release wording and the three hand-written kind sets; settles Waiting 2, 4, 11, removed from `docs/areas/runs-and-dispatch.md` in the same change with Lessons under 6,144 bytes; the PR says what it retires. Witness: a test that iterates `HALT_MODES` and shows every mode stops a leftover, and the `lin-4377` test counting the import, not the spelling. Binding: no stored readiness, no GitHub or provider reads, never recompute pre-cutover history, the LLM & prompts side is LIN-4448's.","paths":["lib/dispatch-leftover.js","lib/dispatch-store.js","lib/dispatch-feedback-validation.js","docs/areas/runs-and-dispatch.md"]}
J112
)
P=$(sub "$P")
T4455=$(L add task --by breakdown --at 2026-11-13T14:01:56.140Z "$P" | idof)
P=$(cat <<'J113'
{"in":"@@PARENT@@","ref":"LIN-4456","links":{"piece":"@@P6@@"},"asked":"","done-when":"LIN-4456 (piece 6, hermetic transport): a provider declares the capability `testTransport` where its transport is swapped, and `lib/dispatch-factory.js` skips access when `provider.testTransport && isHermeticTestToken(token)`. Retires the `provider.name === 'linear'` test and the \"this is not a capability\" comment; settles Waiting 8 (plan numbering). One session (small).","paths":["lib/dispatch-factory.js","routes/test.js","tests/fixtures/hermetic-linear.js"]}
J113
)
P=$(sub "$P")
T4456=$(L add task --by breakdown --at 2026-11-13T14:01:56.6Z "$P" | idof)
P=$(cat <<'J114'
{"in":"@@PARENT@@","ref":"LIN-4457","links":{"piece":"@@P7@@"},"asked":"","done-when":"LIN-4457 (piece 7, cost-call reads): `readCalls` and `callsSurfaceOf` move to `lib/cost-read-calls.js`, with a Runs pattern in `docs/areas/areas.json` in the same change. Retires the two functions' place in `lib/cost-read.js`; settles Waiting 9 (plan numbering). Witness: `area-map-placement.test.js` pins the new file to Runs. One session (small).","paths":["lib/cost-read.js","lib/cost-read-calls.js","docs/areas/areas.json"]}
J114
)
P=$(sub "$P")
T4457=$(L add task --by breakdown --at 2026-11-13T14:01:57.0Z "$P" | idof)
P=$(cat <<'J115'
{"in":"@@PARENT@@","ref":"LIN-4458","links":{"piece":"@@P2@@"},"asked":"","done-when":"LIN-4458 (piece 2, one trail pass and one comment classifier): `lib/run-trail.js` holds `commentKindOf` and `readTrail(comments)`; the landing is the PRs first cited after the anchor. Settles Waiting 15 (row 15 kept as a why-not) and 16 (plan numbering). Blocked by LIN-4454 to LIN-4457. One session (larger). Ask LIN-4448 first.","paths":["lib/run-trail.js","lib/run-ledger.js","lib/recommendation-facts.js","lib/run-evidence.js","scripts/stability-measures-blind.mjs"]}
J115
)
P=$(sub "$P")
T4458=$(L add task --by breakdown --at 2026-11-13T14:01:57.4Z "$P" | idof)

# This task, LIN-4459 (piece 4), created 2026-11-13T14:01:57.719Z by breakdown. done-when from its description (approach, retires, witness, binding).
P=$(cat <<'J116'
{"in":"@@PARENT@@","ref":"LIN-4459","links":{"piece":"@@P4@@"},"asked":"","done-when":"LIN-4459 (piece 4): `lib/run-live-wait.js` holds `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE`, `newestLiveRun` and the live predicate `isLiveRun`; `lib/recommendation-live-wait.js` is deleted with no re-export or shim, and its importers (`lib/openrouter.js`, `lib/dispatch-entrance.js`, `routes/workspace-api.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-look-first.js`, `lib/recommendation-facts.js`) are updated; a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` is not live, its terminal resolved from the unfiltered lineage before `loadRecentRuns`/`stageRuns` filter and window it, using `resolveFollowUpRoot` (`lib/dispatch-store.js`) and `heldWakeHolderOf` (`lib/dispatch-leftover-hook.js`), with the callers (`recentRuns`, `loadRecentRuns`) handing the rows over; the claim compare-and-set note moves unchanged from the LLM area note to the Runs note. Retires the old module and `runFact`'s row-only read; settles Waiting 14 and the LLM-side entry on `recommendation-live-wait.js`, together with A14, removed from `docs/areas/runs-and-dispatch.md` and `docs/areas/llm-and-prompts.md` in the same change with Lessons under 6,144 bytes; the PR says what it retires. Witness: `lin-4392-live-stage-wait.test.js` extended with a `[pending]` stage whose terminal `[blocked]`/`[skipped]` sits on a follow-up or held-wake row that the filter drops, failing before the change and passing after it; a census that none of the names is spelled outside `lib/run-live-wait.js`; `area-map-placement` stays green. Before starting: ask LIN-4448 (A14) again to agree the move. Binding: no stored readiness, no GitHub or provider reads, never recompute stored pre-cutover history, never edit recorded prompt changelog text, the LLM & prompts side of the seam is LIN-4448's.","paths":["lib/run-live-wait.js","lib/recommendation-live-wait.js","lib/recent-runs.js","docs/areas/runs-and-dispatch.md","docs/areas/llm-and-prompts.md"]}
J116
)
P=$(sub "$P")
T4459=$(L add task --by breakdown --at 2026-11-13T14:01:57.719Z "$P" | idof)
# Breakdown decisions about LIN-4459, in LIN-4459, resting on the approve verdict on piece 4 (comment 49b291c4 and the ticket's own lines).
P=$(cat <<'J117'
{"in":"@@T4459@@","links":{"on":"@@V_P4@@@1"},"answer":"Grounding commit origin/main 4b5001ddf; the plan needs no re-planning, and LIN-4459 carries piece 4's slice as approved.","why":"Staleness check at breakdown: origin/main still 4b5001ddf, git log 4b5001ddf..origin/main empty, nothing under lib, routes, tests, scripts or docs/areas changed since filing; spot checks hold (dispatch-store.js still 4,530 lines)."}
J117
)
P=$(sub "$P")
D1=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J118'
{"in":"@@T4459@@","links":{"on":"@@V_P4@@@1"},"answer":"Session fit: fits one session (medium). Plan-review due: no, covered by LIN-4447's approving plan-review (comment 12619798, rev 2).","why":"The approved plan sizes piece 4 medium; the parent's plan review approved it."}
J118
)
P=$(sub "$P")
D2=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J119'
{"in":"@@T4459@@","links":{"on":"@@V_P4@@@1","about":["@@T4454@@","@@T4455@@","@@T4456@@","@@T4457@@"]},"answer":"LIN-4459 is blocked by LIN-4454, LIN-4455, LIN-4456 and LIN-4457, in order step 3 beside LIN-4458. Ask LIN-4448 first.","why":"2 and 4 wait on all of 3/5/6/7. The plan orders them that way, and the work overlaps: 4's lineage helpers live in `dispatch-store.js`, which 5 edits."}
J119
)
P=$(sub "$P")
D3=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J120'
{"in":"@@T4459@@","links":{"on":"@@V_P4@@@1"},"answer":"LIN-4459 blocks LIN-4460 (piece 1).","why":"1 waits on both 2 and 4. It consumes `readTrail`, and `blindReadStep` imports the live-wait module that 4 moves."}
J120
)
P=$(sub "$P")
D4=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J121'
{"in":"@@T4459@@","links":{"on":"@@V_P4@@@1"},"answer":"Waiting 14 is LIN-4459's to settle.","why":"Waiting accounting is unchanged from the plan."}
J121
)
P=$(sub "$P")
D5=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)

# LIN-4453 finished before the moment (as walk 4): reports on LIN-4447 at 14:24:09Z, baseline commit cfd152fa4. Time approximate.
L end "$T4453" done "Piece 0 baseline recorded: both ## Area read reports and the rubric on LIN-4447 (14:24Z); baseline commit cfd152fa4 on origin/main. Completion time approximate." --by Harbour --at 2026-11-13T14:56:00Z >/dev/null

# LIN-4448's reply on LIN-4447 (comment 08c9c898, 15:39:53), written by LIN-4448's plan session (actor design): agree to all three.
P=$(cat <<'J122'
{"in":"@@PARENT@@","links":{"answers":"@@Q_SEAM@@"},"answer":"agree","why":"## Reply from LIN-4448 (LLM & prompts): agree to all three seam moves\n\nChecked against main 2bf788b6d.\n\n1. **One comment classifier in lib/run-trail.js: agree.** No fallback needed.\n2. **Live-stage wait to lib/run-live-wait.js, old file deleted, no shim: agree.** Our CODE_ROUTES list (LIN-4448 piece 1) imports liveWaitOf from wherever it lives when it lands. Whichever of us lands second changes only the import path. The claim compare-and-set Waiting entry moves to your note unchanged.\n3. **blindReadStep reads closeOutDecision().waitsOn/followsPerson: agree.** The file stays ours. LIN-4448 piece 2 leaves its COMPLETED redeclaration alone, so that retires with your piece 1.\n\nCode-route ownership stays here: CODE_ROUTES is the one list and Runs adds no copy. The only edit LIN-4448 makes in a Runs file is the STAGE_LABELS literal in lib/run-view.js (piece 3, derived from the stage-kind record); rebase on that if your pieces touch it."}
J122
)
P=$(sub "$P")
D_SEAM=$(L add decision --by design --at 2026-11-13T15:39:53.858Z "$P" | idof)
L end "$Q_SEAM" answered "LIN-4448 replied agree to all three seam moves (comment 08c9c898 on LIN-4447)." --by design --at 2026-11-13T15:39:53.858Z >/dev/null
# Its correction (comment 097a3442, 15:55:15), written by LIN-4448's breakdown session: the full list of Runs files its pieces edit.
P=$(cat <<'J123'
{"why":"## Reply from LIN-4448 (LLM & prompts): agree to all three seam moves\n\nChecked against main 2bf788b6d.\n\n1. **One comment classifier in lib/run-trail.js: agree.** No fallback needed.\n2. **Live-stage wait to lib/run-live-wait.js, old file deleted, no shim: agree.** Our CODE_ROUTES list (LIN-4448 piece 1) imports liveWaitOf from wherever it lives when it lands. Whichever of us lands second changes only the import path. The claim compare-and-set Waiting entry moves to your note unchanged.\n3. **blindReadStep reads closeOutDecision().waitsOn/followsPerson: agree.** The file stays ours. LIN-4448 piece 2 leaves its COMPLETED redeclaration alone, so that retires with your piece 1.\n\nCode-route ownership stays here: CODE_ROUTES is the one list and Runs adds no copy. The only edit LIN-4448 makes in a Runs file is the STAGE_LABELS literal in lib/run-view.js (piece 3, derived from the stage-kind record); rebase on that if your pieces touch it.\n\n## Correction from LIN-4448 (LLM & prompts): the full list of Runs files our pieces edit\n\nThis corrects our reply of 15:39 (comment 08c9c898). That reply said the only Runs file LIN-4448 edits is the `STAGE_LABELS` literal in `lib/run-view.js`. That was wrong. By first match in `docs/areas/areas.json`, these files are `runs-and-dispatch` too. Checked at main `5dcf5bcda`.\n\n| LIN-4448 subtask | Runs files it edits | Collides with |\n|---|---|---|\n| LIN-4465 (piece 1, `CODE_ROUTES`) | comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js` | **LIN-4459** (`recent-runs.js`) |\n| LIN-4466 (piece 2, blind-read identifiers) | `lib/completion-signals.js`, `lib/run-closeout-state.js`, `lib/pipeline-churn.js`, `lib/run-view.js`; also `lib/wall-clock-summary.js` and `lib/run-ledger.js`, where the scan hits | **LIN-4460** (`run-closeout-state.js`); **PR #2427 / LIN-4455** (`run-view.js`, `wall-clock-summary.js`) |\n| LIN-4467 (piece 3, stage-kind records) | the `STAGE_LABELS` literal in `lib/run-view.js`; **`COMPLETION_SIGNALS` becomes a view of our record** | PR #2427 (`run-view.js`). This also **changes Runs' read sample for LIN-4462**: every consumer of `COMPLETION_SIGNALS` is a prompt, so the content belongs with us, but your after-read should know. |\n| LIN-4468 (piece 4, proxy write guard) | `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js`, `lib/wake-credential.js` (each mint path passes its stage's `writes`) | PR #2427 (`routes/dispatch.js`) |\n\nEvery rebase is mechanical: whichever lands second rebases. We don't touch the runner or `lib/dispatch-store.js`, and Runs' run-behaviour tables (`SPINE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS`, `OFF_SPINE_KINDS`) stay yours, with their tests. Also, `lib/stage-writes.js` (where piece 4 puts the one allowance table) is registered to `other-features`, not to either of our areas.\n\nThe three seam moves are agreed as before. Nothing here changes them.\n"}
J123
)
P=$(sub "$P")
L revise "$D_SEAM" --by breakdown --at 2026-11-13T15:55:15.496Z --reason "Corrects the reply (comment 097a3442): LIN-4448 edits more Runs files than STAGE_LABELS; LIN-4465 collides with LIN-4459 on lib/recent-runs.js. The seam moves stay agreed." "$P" >/dev/null

# John answers the three rulings (15:33Z, "Ruling recorded via Harbour").
P=$(cat <<'J124'
{"in":"@@PARENT@@","links":{"answers":"@@Q_RP@@"},"answer":"Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up","why":"Ruling lin4447-recommend-path-outside-merge, recorded via Harbour (comment 90c9f8a4).","scope":"@@PARENT@@"}
J124
)
P=$(sub "$P")
DJ_Q_RP=$(L add decision --by John --via harbour-ruling --at 2026-11-13T15:33:37.554Z "$P" | idof)
L end "$Q_RP" answered "Answered by John (comment 90c9f8a4)." --by John --via harbour-ruling --at 2026-11-13T15:33:37.598Z >/dev/null
P=$(cat <<'J125'
{"in":"@@PARENT@@","links":{"answers":"@@Q_R1@@"},"answer":"Both: a person's Done and an outside merge","why":"Ruling lin4447-r1-passenger-scope, recorded via Harbour (comment cf8f5ed6).","scope":"@@PARENT@@"}
J125
)
P=$(sub "$P")
DJ_Q_R1=$(L add decision --by John --via harbour-ruling --at 2026-11-13T15:33:38.870Z "$P" | idof)
L end "$Q_R1" answered "Answered by John (comment cf8f5ed6)." --by John --via harbour-ruling --at 2026-11-13T15:33:38.912Z >/dev/null
P=$(cat <<'J126'
{"in":"@@PARENT@@","links":{"answers":"@@Q_SD@@"},"answer":"Yes, change both repos so the copies are gone","why":"Ruling lin4447-sd-scope, recorded via Harbour (comment 830a4864).","scope":"@@PARENT@@"}
J126
)
P=$(sub "$P")
DJ_Q_SD=$(L add decision --by John --via harbour-ruling --at 2026-11-13T15:33:41.552Z "$P" | idof)
L end "$Q_SD" answered "Answered by John (comment 830a4864)." --by John --via harbour-ruling --at 2026-11-13T15:33:41.603Z >/dev/null
# The plan records them (comment 9bfb9aa5): piece 1's merge hold is removed.
P=$(cat <<'J127'
{"says":"Piece 1 (larger): one close-out decision. `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor, ticketState })` and `CLOSE_OUT_REASONS` in `lib/run-closeout-state.js`, answering `{ status, reason, refuses, setDone, waitsOn, routesRead, followsPerson }`. Enforcement uses only the trail and URL-keyed PR statuses (gate stands aside only when every landing PR reads merged; missing or unreadable means not known merged, the gate holds); `ticketState` feeds only the advice `routesRead`, asked by `blindReadStep`. No new GitHub or provider read. Settles Waiting 17, 18, 20 (plan numbering). *Hold:* none. R1 is answered \"both\", and the limit above is accepted, so piece 1 merges on its own review like any other piece."}
J127
)
P=$(sub "$P")
L revise "$P1" --by design --at 2026-11-13T15:34:58.141Z --reason "Rulings recorded in the plan (comment 9bfb9aa5): R1 both, sd-scope in scope, recommend-path limit accepted; the R1 merge hold on piece 1 is removed." "$P" >/dev/null

# LIN-4454..LIN-4457 were Done before the autopilot dispatched LIN-4459 (16:22:01Z). Done times are not in the material:
# each is dated at its last main-line docs/areas commit (a lower bound; see seed-log.md).
L end "$T4454" done "LIN-4454 landed (PR #2425 on main c205190fd); Done before LIN-4459's dispatch. Completion time approximate." --by Harbour --at 2026-11-13T15:39:20Z >/dev/null
L end "$T4457" done "LIN-4457 landed (PR #2424 merged 5dcf5bcda); Done before LIN-4459's dispatch. Completion time approximate." --by Harbour --at 2026-11-13T15:49:16Z >/dev/null
L end "$T4455" done "LIN-4455 landed (PR #2427 merged 192e1f81f); Done before LIN-4459's dispatch. Completion time approximate." --by Harbour --at 2026-11-13T16:09:25Z >/dev/null
L end "$T4456" done "LIN-4456 landed (notes PR #2428 on main 0092d8d9e); Done before LIN-4459's dispatch. Completion time approximate." --by Harbour --at 2026-11-13T16:19:20Z >/dev/null

echo "seeded: parent=$PARENT lin4448=$LIN4448 lin4459=$T4459 piece4=$P4 verdict_p4=$V_P4 q_seam=$Q_SEAM d_seam=$D_SEAM area_runs=$AREA_RUNS area_llm=$AREA_LLM runfact=$AREA_RUNS_W9 llm_claim=$AREA_LLM_W9 llm_side=$AREA_LLM_W10 llm_kickoff=$AREA_LLM_W26 lin4458=$T4458"
node -e 'const s=require(process.argv[1]);const r=Object.values(s.records);console.log("records:",r.length,"versions:",r.reduce((a,v)=>a+v.length,0),"log:",s.log.length)' "$STORE"
