#!/usr/bin/env bash
# Recreates walks/4/replay-4455/store.json from empty (walk 4 model): the state of LIN-4447/LIN-4455 just before
# LIN-4455's first stage (survey-task) was dispatched, 2026-11-13T14:58:27Z. Generated; see seed-log.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LAYER="$HERE/../model/layer.mjs"
STORE="$HERE/store.json"
rm -f "$STORE"
L() { node "$LAYER" "$@" --store "$STORE"; }
idof() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }
# substitute @@NAME@@ with the shell variable NAME (record ids captured earlier)
sub() { local s="$1" v; for v in $(grep -o "@@[A-Z0-9_]*@@" <<<"$s" | sort -u | tr -d @); do s="${s//@@$v@@/${!v}}"; done; printf "%s" "$s"; }

# Area: Runs & dispatch (registry docs/areas/areas.json @ cfd152fa4), by Harbour.
P=$(cat <<'J1'
{"name": "Runs & dispatch", "paths": ["routes/dispatch.js", "routes/live-console.js", "routes/runner-kit.js", "routes/runner-setup.js", "lib/runner-kit/", "lib/dispatch-", "lib/pipeline-loops.js", "lib/run-", "lib/wake-", "lib/digest-feedback.js", "lib/lineage-closure.js", "lib/loop-supersede.js", "lib/follow-up-dispatch.js", "lib/ci-wake-sweep.js", "lib/follow-on-ratio.js", "lib/observation-", "lib/observer-", "lib/liveness-", "lib/completion-signals.js", "lib/agent-status-store.js", "lib/unanswered-decisions.js", "lib/task-decisions-store.js", "lib/shelved-rulings-store.js", "lib/dismissal-suggestions-store.js", "lib/close-out-events-store.js", "lib/ticket-close-closer.js", "lib/plan-review-round-trips.js", "lib/pipeline-churn.js", "lib/poll-halt.js", "lib/workspace-halt.js", "lib/queue-config.js", "lib/session-summary", "lib/session-telemetry.js", "lib/session-materializer-precompute.js", "lib/sessions-feed-cache.js", "lib/sessions-view.js", "lib/recent-runs.js", "lib/task-run-facts.js", "lib/close-out-readiness.js", "lib/close-out-merges.js", "lib/task-cost-read.js", "lib/task-timeline.js", "lib/session-roles.js", "lib/terminal-marked-task-cost.js", "lib/transcript-spend.js", "lib/weekly-budget.js", "lib/wall-clock-summary.js", "lib/harbour-spawn.js", "lib/runner-owner-gate.js", "lib/consumer-poll-warning.js", "lib/consumer-heartbeat", "lib/effort-readout.js", "lib/escalation-kpis.js", "lib/task-stack.js", "lib/task-page-loader.js", "lib/task-mode-store.js", "lib/task-snapshot-store.js", "lib/task-done-cache.js", "lib/live-console.js", "lib/periodical-runs.js", "lib/periodical-report-gate.js", "lib/refresh-on-resolve-gate.js", "lib/superseded-selection.js", "lib/owner-mint-refusals.js", "lib/request-usage-", "lib/cost-read.js", "lib/row-usage.js", "lib/lineage-membership.js", "scripts/pipeline-churn.mjs"]}
J1
)
P=$(sub "$P")
AREA=$(L add area --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Lessons, docs/areas/runs-and-dispatch.md @ cfd152fa4 (same text at 4b5001ddf).
P=$(cat <<'J2'
{"in": "@@AREA@@", "says": "A run-row field that is always present with a default is one entry in `RUN_FIELDS` (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once dropped on one hop of four.", "paths": ["lib/dispatch-fields.js"], "checked-at": "cfd152fa4"}
J2
)
P=$(sub "$P")
LESSON1=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J3'
{"in": "@@AREA@@", "says": "Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`); a new exit must archive through it too.", "paths": ["lib/dispatch-store.js"], "checked-at": "cfd152fa4"}
J3
)
P=$(sub "$P")
LESSON2=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J4'
{"in": "@@AREA@@", "says": "The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357, 2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites passing, and update the two census pins (`lin-3134-declared-mint-census`, `lin-4080-addItem-census`) if the write moves.", "paths": ["lib/dispatch-store.js"], "checked-at": "cfd152fa4"}
J4
)
P=$(sub "$P")
LESSON3=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J5'
{"in": "@@AREA@@", "says": "\"This run's PR\" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`) takes a PR on a report line before the `[done]` `url`, which older runners filled by mention count (LIN-4375).", "paths": ["lib/dispatch-wake.js"], "checked-at": "cfd152fa4"}
J5
)
P=$(sub "$P")
LESSON4=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J6'
{"in": "@@AREA@@", "says": "Two `[done]` posts can reach a decide-then-enqueue at once, so \"no row yet\" is no guard: claim first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two leftover rows (LIN-4375).", "paths": [], "checked-at": "cfd152fa4"}
J6
)
P=$(sub "$P")
LESSON5=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J7'
{"in": "@@AREA@@", "says": "A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left by a skip held the re-report forever (LIN-4375 review).", "paths": [], "checked-at": "cfd152fa4"}
J7
)
P=$(sub "$P")
LESSON6=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J8'
{"in": "@@AREA@@", "says": "Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`). A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`, `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals.", "paths": ["lib/ci-wake-sweep.js"], "checked-at": "cfd152fa4"}
J8
)
P=$(sub "$P")
LESSON7=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J9'
{"in": "@@AREA@@", "says": "Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).", "paths": ["lib/prompt-templates.js", "lib/dispatch-fields.js"], "checked-at": "cfd152fa4"}
J9
)
P=$(sub "$P")
LESSON8=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J10'
{"in": "@@AREA@@", "says": "The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373), released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once. Leftover wording lives in `lib/dispatch-leftover-hook.js`; a new held-wake feature brings a hook (`lin-4377-store-knows-no-leftover` counts the word).", "paths": ["lib/dispatch-store.js", "lib/dispatch-leftover-hook.js"], "checked-at": "cfd152fa4"}
J10
)
P=$(sub "$P")
LESSON9=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J11'
{"in": "@@AREA@@", "says": "Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as LIN-4226.", "paths": [], "checked-at": "cfd152fa4"}
J11
)
P=$(sub "$P")
LESSON10=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J12'
{"in": "@@AREA@@", "says": "A task timeline lane is running from the page's open session ids (`isOpenState`), never the cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides \"not complete\" (LIN-4405, `lib/task-timeline.js`).", "paths": ["lib/task-timeline.js"], "checked-at": "cfd152fa4"}
J12
)
P=$(sub "$P")
LESSON11=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J13'
{"in": "@@AREA@@", "says": "A test that dispatches a close-out passes a `closeOut` seam (`resolveProvider`): the readiness guard reads comments for every close-out since LIN-4438, and without the seam it reaches the real provider and fails open, a pass the hermetic watcher catches only in CI.", "paths": [], "checked-at": "cfd152fa4"}
J13
)
P=$(sub "$P")
LESSON12=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J14'
{"in": "@@AREA@@", "says": "Close-out readiness has five lanes: the route (`codeRouteOf`), the stop-at state, the task page's box (`buildRunEvidence`) and both guard lanes (`closeOutNotReady`). A readiness rule goes in `closeOutWaitsOn` (`lib/run-closeout-state.js`) and gets a row in the shared-trail table (`lin-4438-blind-read-gate`); gating one lane let the page offer a press the guard refused (LIN-4438).", "paths": ["lib/run-closeout-state.js"], "checked-at": "cfd152fa4"}
J14
)
P=$(sub "$P")
LESSON13=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J15'
{"in": "@@AREA@@", "says": "A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`): confirm a custom kind from its own row before trusting it (LIN-4426).", "paths": ["lib/wall-clock-summary.js", "lib/cost-read.js"], "checked-at": "cfd152fa4"}
J15
)
P=$(sub "$P")
LESSON14=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J16'
{"in": "@@AREA@@", "says": "A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`), for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).", "paths": ["lib/run-ledger.js"], "checked-at": "cfd152fa4"}
J16
)
P=$(sub "$P")
LESSON15=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J17'
{"in": "@@AREA@@", "says": "A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through `lib/cost-read.js`; a reader never re-ranks `byModel` itself. `dispatchModelOf` in `lib/task-timeline.js` did, and a lane can now name two models. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)", "paths": ["lib/cost-read.js", "lib/task-timeline.js"], "checked-at": "cfd152fa4"}
J17
)
P=$(sub "$P")
LESSON16=$(L add lesson --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
# Waiting entries, numbered by position in the note @ cfd152fa4. 1-15 match the plan's numbers;
# 16 is new in cfd152fa4 (LIN-4453's leftover); 17-21 are the plan's 16-20.
P=$(cat <<'J18'
{"to": "@@AREA@@", "says": "Waiting 1: `lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)"}
J18
)
P=$(sub "$P")
W1=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J19'
{"to": "@@AREA@@", "says": "Waiting 2: `lib/dispatch-leftover.js`: restates the follow-up target, halt modes and `NEVER_RAN` (also in `_releaseIfHeld`) beside their homes (`lib/workspace-halt.js`, `HALT_MODES`); a new halt mode would not stop a leftover. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)"}
J19
)
P=$(sub "$P")
W2=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J20'
{"to": "@@AREA@@", "says": "Waiting 3: `lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)"}
J20
)
P=$(sub "$P")
W3=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J21'
{"to": "@@AREA@@", "says": "Waiting 4: `lib/dispatch-store.js`: `releaseHeldWake` prepends `formatHeldWakeNote({status})`, so release picks leftover wording; `lin-4377` counts the spelling, not the dependency. (Operator, LIN-4377.)"}
J21
)
P=$(sub "$P")
W4=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J22'
{"to": "@@AREA@@", "says": "Waiting 5: `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature first needs composable hooks. (Operator, LIN-4377.)"}
J22
)
P=$(sub "$P")
W5=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J23'
{"to": "@@AREA@@", "says": "Waiting 6: `lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`; SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)"}
J23
)
P=$(sub "$P")
W6=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J24'
{"to": "@@AREA@@", "says": "Waiting 7: `lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session (rows cover pause and stop), though the leftover step resumes its build that way (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.; `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)"}
J24
)
P=$(sub "$P")
W7=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J25'
{"to": "@@AREA@@", "says": "Waiting 8: `lib/dispatch-factory.js`: tests `provider.name === 'linear'` beside `isHermeticTestToken` for a test-only transport. (LIN-4347.)"}
J25
)
P=$(sub "$P")
W8=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J26'
{"to": "@@AREA@@", "says": "Waiting 9: `lib/cost-read.js`: split out `readCalls` and `callsSurfaceOf`; settle whether instance-wide reads sit beside workspace-keyed stores. (Survey tally: LIN-4201.)"}
J26
)
P=$(sub "$P")
W9=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J27'
{"to": "@@AREA@@", "says": "Waiting 10: `lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey tally: LIN-4201.)"}
J27
)
P=$(sub "$P")
W10=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J28'
{"to": "@@AREA@@", "says": "Waiting 11: `lib/dispatch-feedback-validation.js`: feedback kinds lack one declaration with their role: `PARKED_WAIT_SKIPPED_KINDS` (`lib/session-telemetry.js`), `FEEDBACK_ENTRY_KINDS`, `findWakeEvent`'s skip rule. (Survey tally: LIN-4240, 4239, 4233.)"}
J28
)
P=$(sub "$P")
W11=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J29'
{"to": "@@AREA@@", "says": "Waiting 12: `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records. (Survey tally: LIN-3257.)"}
J29
)
P=$(sub "$P")
W12=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J30'
{"to": "@@AREA@@", "says": "Waiting 13: `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)"}
J30
)
P=$(sub "$P")
W13=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J31'
{"to": "@@AREA@@", "says": "Waiting 14: `lib/recent-runs.js`: `runFact` reads only the row's feedback: a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` reads `running` and holds the live-stage wait until aborted. (LIN-4392.)"}
J31
)
P=$(sub "$P")
W14=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J32'
{"to": "@@AREA@@", "says": "Waiting 15: `lib/run-ledger.js`: `landingPrUrls` counts every full PR URL after its anchor, so it disagrees with the other landing readers in two cases the shared-trail table pins as chosen, not designed (`tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15): an audit report that re-cites a merged landing PR puts it in the notes PR's landing (`auditAfterLandingCloseOut` in `lib/recommendation-facts.js` treats only the new PR as the notes PR), and a foreign PR cited before the first review joins a first landing. Each costs a read that must name an extra PR. One comment classifier and one landing reader would make both follow from one rule. A third case is not pinned: an agent's own note (first line `autopilot`, `plan posted`, `plan revised`, or `revision N`) that cites a new PR after review joins `landingPrUrls` but not `isLandingEvidence` (`lib/recommendation-facts.js`), so `blindReadStep` offers a blind read naming a PR the approved review never covered, where a plain note sends it back to review (reproduced at e2d4659c4; Seams & Tangles, 13 Nov.; `docs/reviews/seams-tangles-review-2026-11-13-run12.md`, §3.0a). (LIN-4438; Survey global on LIN-4438.)"}
J32
)
P=$(sub "$P")
W15=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J33'
{"to": "@@AREA@@", "says": "Waiting 16 (added in cfd152fa4 by LIN-4453's leftover; not among the plan's 20): `lib/run-ledger.js`: `landingPrUrls` skips only blind reads and survey reports, so a comment headed `## Area read` that names a full PR URL would join the ticket's landing. Only the prose rule in `docs/plans/survey/area-read.md` (cite `path@sha`, never a PR URL) keeps the LIN-4447 area reads out today. An area-read kind in the one comment classifier (LIN-4458, piece 2) would make that rule code. (Leftover of LIN-4453; Survey global on LIN-4453.)"}
J33
)
P=$(sub "$P")
W16=$(L add finding --by Harbour --at 2026-11-13T14:55:00Z "$P" | idof)
P=$(cat <<'J34'
{"to": "@@AREA@@", "says": "Waiting 17 (the plan's Waiting 16): `lib/run-closeout-state.js`: `deriveCloseOutState` works from two PR lists: `prs` (`extractPrUrls`, every PR ever cited) drives the PR-shape reasons (multiple-prs, partial, merged) and `landingPrs` (`landingPrUrls`) drives the blind-read gate, so the box can count PRs the gate ignores and the other way round (pinned in `tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15). Which reader answers \"this task's PRs\" spans the box, the guard and the route. (Blind read on LIN-4439.)"}
J34
)
P=$(sub "$P")
W17=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J35'
{"to": "@@AREA@@", "says": "Waiting 18 (the plan's Waiting 17): `lib/close-out-readiness.js`: in the stop-at lane `deriveCloseOutState` lets merged and partial outrank the gate, then `closeOutNotReady` asks `closeOutWaitsOn` again to override it, so the box state is not the guard's whole answer and the precedence lives in two files. Carrying the gate's answer in the state changes the box model the renderers read. (Blind read on LIN-4439.) `ladderNotReady` asks the gate a third time, so the box and the guard order the same reasons two ways and the next close-out reason must be placed in both; one order is a decision about what the box shows versus what the guard refuses. (Blind read on LIN-4396.)"}
J35
)
P=$(sub "$P")
W18=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J36'
{"to": "@@AREA@@", "says": "Waiting 19 (the plan's Waiting 18): `lib/run-closeout-state.js`: the close-out reasons are bare string literals: `'blind-read-missing'` is spelled here and again in `REFUSED_REASONS` (`lib/close-out-readiness.js`, beside `'head-moved'`), and `closeOutNotReadyRefusal` builds its error by capitalising `state.message`. A reasons constant (like `CLOSE_OUT_STATUS`) covering every reason, used by the box, the guard and the render, would give them one vocabulary. (Blind read on LIN-4396.)"}
J36
)
P=$(sub "$P")
W19=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J37'
{"to": "@@AREA@@", "says": "Waiting 20 (the plan's Waiting 19): `lib/task-timeline.js`: `dispatchModelOf` picks a dispatch's model by its own rule (`costUsd`, null as -1, then request count), while the home, `foldRequestUsage` (`lib/request-usage-fold.js`), ranks by priced dollars, then latest use, and names the latest model when nothing is priced. `modelRowOf` (`lib/cost-read.js`) drops `pricedUsd`, so the lane label (`session.model`, the fold's answer) and the rows inside it can name different models whenever any request is unpriced. The fix is for `dispatchesOf` to carry the fold's `last.model`; a change to the dominant-model rule otherwise leaves the timeline behind. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J37
)
P=$(sub "$P")
W20=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)
P=$(cat <<'J38'
{"to": "@@AREA@@", "says": "Waiting 21 (the plan's Waiting 20): `lib/run-closeout-state.js`: `closeOutSetsDone` never asks `closeOutWaitsOn`, so the owner's check (`routes/workspace-api-run-evidence.js`) sets a stop-at-PR task Done when its landing PR is merged and approved with no blind read, while the close-out guard (`lib/close-out-readiness.js`) refuses the same trail as `blind-read-missing`, and `blindReadStep` (`lib/recommendation-blind-read.js`) then routes a read to the Done ticket (it stands aside on a completed ticket only after a close-out). The entries above name the box/guard precedence split; this is its Done path. Whether a person's own check may pass the gate is a decision; the shared-trail test runs with `byPersonCheck: false`, so it never reaches this path. (Drift & Coherence Review, 13 Nov., second read; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J38
)
P=$(sub "$P")
W21=$(L add finding --by Harbour --at 2026-11-13T12:00:00Z "$P" | idof)

# Parent LIN-4447, filed 2026-11-13T12:08:12.387Z. asked = its ## As asked block, byte-exact.
P=$(cat <<'J39'
{"asked": "**Repository:** JKershaw/LinearViewer (Harbour).\n\n**What this is for.** John: \"we've not been applying quite the right force to bend the curve… now want to run both real work, and some real tidies.\" The Drift & Coherence and Seams & Tangles reviews of 13 Nov found this area carrying rules written in two places that disagree. Batch 1 added several of them:\n\n* Harbour can mark a task Done on a person's check before its blind read, while another check refuses that same task, and a read is then sent to a ticket that's already Done (Drift run 7, `close-out-gate-precedence-split`). John's ruling: \"if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour.\"\n* Two pieces of code decide which PRs belong to a task, and they disagree about agent notes, so a blind read can be offered over a PR no review covered (Seams run 12, §3.0a).\n* The task timeline decides which model a dispatch used by its own rule, separate from the one the cost figures use (Drift, row 150).\n* The check that makes a stage wait while another is live is a runs rule, but it lives with the prompts (Seams, P-LW1).\n\nThe area's note holds 20 Waiting entries, and `lib/dispatch-store.js` is 4,530 lines. Seams also tried moving files between areas three ways, and none made the tangle smaller.\n\n**What we want.**\n\n* Each rule in the area has one home, and the copies are gone.\n* When a person acts, Harbour follows, and that rule is written once.\n* The area's Waiting entries are settled, or each says why it can't be yet.\n* Each piece finishes one move and names what it retired. John: \"I'd be happy to run a small variety, erring larger, to see\", so piece sizes vary, leaning larger.\n* The LLM & prompts side of the seam is A14's.\n\n**Done when**\n\n* the cases above are settled, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.\n\n**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*", "done-when": "* the cases above are settled, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.", "paths": ["lib/dispatch-store.js"]}
J39
)
P=$(sub "$P")
PARENT=$(L add task --by John --via driving-session --at 2026-11-13T12:08:12.387Z "$P" | idof)

# Plan pieces, by design, in the parent. order = landing step: 0; then 3/5/6/7; then 2/4; then 1; then 8.
P=$(cat <<'J40'
{"in": "@@PARENT@@", "says": "Piece 0: paired readability baseline (no code). Fresh agents read Runs & dispatch and the untouched control `front-end-pages` in one window, by a committed sampling rule and short rubric; each report posted as `## Area read`. Witness: both reports and the rubric are on the ticket before any piece merges. Retires nothing (a measurement). Repeated after the last piece.", "paths": [], "order": 1}
J40
)
P=$(sub "$P")
P0=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J41'
{"in": "@@PARENT@@", "says": "Piece 1 (larger): one close-out decision. `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor })` and `CLOSE_OUT_REASONS` in `lib/run-closeout-state.js`, answering `{ status, reason, refuses, setDone, waitsOn, followsPerson }`; the box, both guard lanes, the check route, `blindReadStep` and `run-evidence` render or enforce it. Settles Waiting 17, 18, 20 (plan numbering). Waits on R1.", "paths": ["lib/run-closeout-state.js", "lib/close-out-readiness.js", "routes/workspace-api-run-evidence.js", "lib/recommendation-blind-read.js", "lib/run-evidence.js", "lib/close-out-merges.js"], "order": 4}
J41
)
P=$(sub "$P")
P1=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J42'
{"in": "@@PARENT@@", "says": "Piece 2 (larger): one trail pass. `lib/run-trail.js` holds the one comment classifier `commentKindOf` and `readTrail(comments)`; the landing is the PRs first cited after the anchor. Settles Waiting 15 (row 15 kept as a why-not) and 16 (plan numbering). Ask LIN-4448 first.", "paths": ["lib/run-trail.js", "lib/run-ledger.js", "lib/recommendation-facts.js", "lib/run-evidence.js", "scripts/stability-measures-blind.mjs"], "order": 3}
J42
)
P=$(sub "$P")
P2=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J43'
{"in": "@@PARENT@@", "says": "Piece 3 (small): model attribution. `dispatchesOf` in `lib/cost-read.js` carries the fold's `last.model`; retires `dispatchModelOf`. Settles Waiting 19 (plan numbering).", "paths": ["lib/cost-read.js", "lib/task-timeline.js"], "order": 2}
J43
)
P=$(sub "$P")
P3=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J44'
{"in": "@@PARENT@@", "says": "Piece 4 (medium): the live-stage wait gets a Runs home in `lib/run-live-wait.js` (`liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE`, `newestLiveRun`, `isLiveRun`), `lib/recommendation-live-wait.js` deleted, and `isLiveRun` reads the lineage's terminal. Settles Waiting 14. Ask LIN-4448 first.", "paths": ["lib/run-live-wait.js", "lib/recommendation-live-wait.js", "lib/recent-runs.js"], "order": 3}
J44
)
P=$(sub "$P")
P4=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J45'
{"in": "@@PARENT@@", "says": "Piece 5 (medium): one declaration for each restated constant. `lib/dispatch-leftover.js` and `_releaseIfHeld` import halt modes, `NEVER_RAN` and the follow-up target from their owners; `wakeHook.releaseNote` supplies the release wording so the store no longer calls `formatHeldWakeNote`; one `FEEDBACK_KINDS` table in `lib/dispatch-feedback-validation.js` carries each kind's roles, and `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it. *Retires:* the restated constants and the three hand-written kind sets. *Settles Waiting:* 2, 4, 11. *Witness:* a test that iterates `HALT_MODES` and shows every one stops a leftover (so a newly added mode is caught), and `lin-4377` counting the import, not the spelling.", "paths": ["lib/dispatch-leftover.js", "lib/dispatch-store.js", "lib/dispatch-feedback-validation.js"], "order": 2}
J45
)
P=$(sub "$P")
P5=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J46'
{"in": "@@PARENT@@", "says": "Piece 6 (small): hermetic transport. A provider declares `testTransport` where its transport is swapped; the factory skips access when `provider.testTransport && isHermeticTestToken(token)`. Settles Waiting 8.", "paths": ["lib/dispatch-factory.js", "routes/test.js", "tests/fixtures/hermetic-linear.js"], "order": 2}
J46
)
P=$(sub "$P")
P6=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J47'
{"in": "@@PARENT@@", "says": "Piece 7 (small): cost-call reads. `readCalls` and `callsSurfaceOf` move to `lib/cost-read-calls.js`, with a Runs pattern in `areas.json`. Settles Waiting 9.", "paths": ["lib/cost-read.js", "lib/cost-read-calls.js", "docs/areas/areas.json"], "order": 2}
J47
)
P=$(sub "$P")
P7=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)
P=$(cat <<'J48'
{"in": "@@PARENT@@", "says": "Piece 8 (later, cross-repository): simple-dispatcher. Waiting 1, 6, 7 and 13 get one owner and a drift check per rule (in `lib/runner-kit/contract.json` as data, or a golden test); planned in detail at its own start, after 1 to 7. Waiting 10 written as an engineering call.", "paths": ["lib/runner-kit/", "lib/dispatch-wake.js", "lib/session-summary.js"], "order": 5}
J48
)
P=$(sub "$P")
P8=$(L add plan --by design --at 2026-11-13T13:40:00Z "$P" | idof)

# The plan names where the work is expected.
P=$(cat <<'J49'
{"paths": ["docs/areas/areas.json", "docs/areas/llm-and-prompts.md", "docs/areas/runs-and-dispatch.md", "lib/close-out-merges.js", "lib/close-out-readiness.js", "lib/cost-read-calls.js", "lib/cost-read.js", "lib/dispatch-factory.js", "lib/dispatch-feedback-validation.js", "lib/dispatch-leftover.js", "lib/dispatch-store.js", "lib/dispatch-wake.js", "lib/recent-runs.js", "lib/recommendation-blind-read.js", "lib/recommendation-facts.js", "lib/recommendation-live-wait.js", "lib/run-closeout-state.js", "lib/run-evidence.js", "lib/run-ledger.js", "lib/run-live-wait.js", "lib/run-trail.js", "lib/runner-kit/", "lib/session-summary.js", "lib/task-timeline.js", "routes/test.js", "routes/workspace-api-run-evidence.js", "scripts/stability-measures-blind.mjs", "tests/fixtures/hermetic-linear.js"]}
J49
)
P=$(sub "$P")
L revise "$PARENT" --by design --at 2026-11-13T13:40:00Z --reason "The Implementation Plan names the files each piece changes (plan rev 1)." "$P" >/dev/null

# Plan review round 1 (13:46:36, comment e452fe3a): request-changes, blocking B1 on piece 1 only.
P=$(cat <<'J50'
{"in": "@@PARENT@@", "links": {"on": "@@P1@@@1"}, "of": "plan-review", "outcome": "request-changes", "reasoning": "Request Changes (comment e452fe3a). B1: closeOutDecision's inputs (the ticket's state, whether the landing is merged) are not held by two to four of its six surfaces, and the plan does not say where each gets them or what the decision answers when one is unknown; built as written the surfaces split on an outside merge. Pieces 3, 6 and 7 hold as written; pieces 0, 3, 5, 6 and 7 don't depend on B1."}
J50
)
P=$(sub "$P")
V1=$(L add verdict --by plan-review --at 2026-11-13T13:46:36.011Z "$P" | idof)
# Plan revision (13:53:21, comment 84a944a9): B1 settled in piece 1. No plan-review note touched piece 5.
P=$(cat <<'J51'
{"says": "Piece 1 (larger): one close-out decision. `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor, ticketState })` and `CLOSE_OUT_REASONS` in `lib/run-closeout-state.js`, answering `{ status, reason, refuses, setDone, waitsOn, routesRead, followsPerson }`. Enforcement uses only the trail and URL-keyed PR statuses (gate stands aside only when every landing PR reads merged; missing or unreadable means not known merged, the gate holds); `ticketState` feeds only the advice `routesRead`, asked by `blindReadStep`. No new GitHub or provider read. Settles Waiting 17, 18, 20 (plan numbering). Merge held on R1 and the recommend-path ruling."}
J51
)
P=$(sub "$P")
L revise "$P1" --by design --at 2026-11-13T13:53:21.272Z --reason "Answers plan-review B1 (comment e452fe3a): per-surface inputs named, unknown means not known merged, ticket state only for advice." "$P" >/dev/null
# Plan review round 2 (13:57:37, comment 12619798): Approve, over every piece at its current version.
P=$(cat <<'J52'
{"in": "@@PARENT@@", "links": {"on": "@@P0@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 0 and its repeat cover \"reads better ... by more than an untouched area\"."}
J52
)
P=$(sub "$P")
V_P0=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J53'
{"in": "@@PARENT@@", "links": {"on": "@@P1@@@2"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 1: enforcement reads only facts each surface has; unknown means the gate holds. Builder notes 1-4 and 6 concern it (ruling wording, the loosening property, the unmerged-PR set, readTrail fields, press-route order)."}
J53
)
P=$(sub "$P")
V_P1=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J54'
{"in": "@@PARENT@@", "links": {"on": "@@P2@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 2: no note this round beyond its seam with piece 1 (readTrail supplies closeOutAfterReview/workAfterReview)."}
J54
)
P=$(sub "$P")
V_P2=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J55'
{"in": "@@PARENT@@", "links": {"on": "@@P3@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 3 holds as last time."}
J55
)
P=$(sub "$P")
V_P3=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J56'
{"in": "@@PARENT@@", "links": {"on": "@@P4@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 4: builder note 5, hand runFact the lineage before it is filtered."}
J56
)
P=$(sub "$P")
V_P4=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J57'
{"in": "@@PARENT@@", "links": {"on": "@@P5@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 5: no note in either round; round 1 said it does not depend on B1. Settles Waiting 2, 4, 11."}
J57
)
P=$(sub "$P")
V_P5=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J58'
{"in": "@@PARENT@@", "links": {"on": "@@P6@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 6 holds; its capability approach matches dispatch-factory.js:925-934."}
J58
)
P=$(sub "$P")
V_P6=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J59'
{"in": "@@PARENT@@", "links": {"on": "@@P7@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 7 holds as last time."}
J59
)
P=$(sub "$P")
V_P7=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)
P=$(cat <<'J60'
{"in": "@@PARENT@@", "links": {"on": "@@P8@@@1"}, "of": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 8 keeps simple-dispatcher in scope, matching lin4447-sd-scope."}
J60
)
P=$(sub "$P")
V_P8=$(L add verdict --by plan-review --at 2026-11-13T13:57:37.874Z "$P" | idof)

# Breakdown (comment 49b291c4, 14:02:31): ten subtasks; only LIN-4453 (its blocker) and LIN-4455 written.
P=$(cat <<'J61'
{"in": "@@PARENT@@", "links": {"piece": "@@P0@@"}, "asked": "", "done-when": "LIN-4453 (piece 0, paired area reads before): both `## Area read` reports (Runs & dispatch and the control `front-end-pages`) and the committed rubric are on LIN-4447 before any implementation piece merges. Retires nothing (a measurement).", "paths": []}
J61
)
P=$(sub "$P")
T4453=$(L add task --by breakdown --at 2026-11-13T14:01:50Z "$P" | idof)
P=$(cat <<'J62'
{"in": "@@PARENT@@", "links": {"piece": "@@P5@@"}, "asked": "", "done-when": "LIN-4455 (piece 5): `lib/dispatch-leftover.js` and `_releaseIfHeld` / `releaseHeldWake` in `lib/dispatch-store.js` import halt modes, `NEVER_RAN` and the follow-up target from their owners instead of restating them; `wakeHook.releaseNote` supplies the release wording, so the store no longer calls `formatHeldWakeNote` and stops owning that wording; one `FEEDBACK_KINDS` table in `lib/dispatch-feedback-validation.js` carries each kind's roles, and `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it. Retires the restated constants, the store's ownership of the release wording and the three hand-written kind sets; settles Waiting 2, 4, 11, removed from `docs/areas/runs-and-dispatch.md` in the same change with Lessons under 6,144 bytes; the PR says what it retires. Witness: a test that iterates `HALT_MODES` and shows every mode stops a leftover, and the `lin-4377` test counting the import, not the spelling. Binding: no stored readiness, no GitHub or provider reads, never recompute pre-cutover history, the LLM & prompts side is LIN-4448's.", "paths": ["lib/dispatch-leftover.js", "lib/dispatch-store.js", "lib/dispatch-feedback-validation.js", "docs/areas/runs-and-dispatch.md"]}
J62
)
P=$(sub "$P")
T4455=$(L add task --by breakdown --at 2026-11-13T14:01:56.140Z "$P" | idof)
# Breakdown decisions about LIN-4455, in LIN-4455, resting on the approve verdict on piece 5.
P=$(cat <<'J63'
{"in": "@@T4455@@", "links": {"on": "@@V_P5@@@1"}, "answer": "Grounding commit origin/main 4b5001ddf; the plan needs no re-planning, and LIN-4455 carries piece 5's slice as approved, naming `releaseHeldWake` beside `_releaseIfHeld` in `lib/dispatch-store.js`.", "why": "Staleness check at breakdown: origin/main still 4b5001ddf, git log 4b5001ddf..origin/main empty, nothing under lib, routes, tests, scripts or docs/areas changed since filing; spot checks hold (dispatch-store.js still 4,530 lines)."}
J63
)
P=$(sub "$P")
D1=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J64'
{"in": "@@T4455@@", "links": {"on": "@@V_P5@@@1"}, "answer": "Session fit: one session (medium). Plan-review due: no, covered by LIN-4447's approving plan-review (comment 12619798, rev 2).", "why": "The approved plan sizes piece 5 medium and lists it among pieces that run alone; the parent's plan review approved it."}
J64
)
P=$(sub "$P")
D2=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J65'
{"in": "@@T4455@@", "links": {"on": "@@V_P5@@@1", "about": "@@T4453@@"}, "answer": "LIN-4455 is blocked by LIN-4453 (piece 0), in order step 2 beside LIN-4454, LIN-4456 and LIN-4457.", "why": "The graph follows the plan's landing order, 0 then 3/5/6/7 then 2/4 then 1 then 8 then 0, literally; no implementation PR merges before piece 0's reports and rubric are on the ticket."}
J65
)
P=$(sub "$P")
D3=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J66'
{"in": "@@T4455@@", "links": {"on": "@@V_P5@@@1"}, "answer": "LIN-4455 blocks LIN-4458 (piece 2) and LIN-4459 (piece 4).", "why": "2 and 4 wait on all of 3/5/6/7: the plan orders them that way, and the work overlaps (piece 4's lineage helpers live in dispatch-store.js, which piece 5 edits)."}
J66
)
P=$(sub "$P")
D4=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)
P=$(cat <<'J67'
{"in": "@@T4455@@", "links": {"on": "@@V_P5@@@1"}, "answer": "Waiting 2, 4 and 11 are LIN-4455's to settle.", "why": "Waiting accounting unchanged from the plan."}
J67
)
P=$(sub "$P")
D5=$(L add decision --by breakdown --at 2026-11-13T14:02:31.309Z "$P" | idof)

# LIN-4453 finished before the moment: both ## Area read reports on LIN-4447 at 14:24:09Z, and its
# docs-only baseline commit cfd152fa4 on origin/main. Exact completion time not in the material.
L end "$T4453" done "Piece 0 baseline recorded: both ## Area read reports and the rubric on LIN-4447 (14:24Z); baseline commit cfd152fa4 on origin/main. Completion time approximate." --by Harbour --at 2026-11-13T14:56:00Z >/dev/null

echo "seeded: parent=$PARENT lin4455=$T4455 piece5=$P5 lin4453=$T4453 piece0=$P0 waiting2=$W2 waiting4=$W4 waiting11=$W11 area=$AREA verdict_p5=$V_P5"
# The walk 4 model has no `check` command; count the records straight from the file (a query would log a read).
node -e 'const s=require(process.argv[1]);console.log("records:",Object.keys(s.records).length)' "$STORE"
