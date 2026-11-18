# C3 — Verdicts and runs

Route: verdicts and runs · main at `6f6c5d2` · 18 Nov · read by a census reader. Paths are from the repo root; `sd:` = simple-dispatcher. [checked] = read at the line; [reported] = from a header or comment, not traced.

## How the route works today

- A verdict is a tracker comment. The stage contract tells each stage how to open it and where the verdict word goes (`lib/prompts/stage-kinds.js:364,426-429,460`) [checked].
- `COMMENT_KINDS` (`lib/run-trail.js:134-145`) gives each comment one kind, first match wins: review, close-out, blind-read, survey-task, survey-place, area-read, agent-note, plan-review, audit, plain [checked].
- The kind is read from the opening only. The verdict value is parsed elsewhere, by three separate parsers: `parseRunLedger` for a review (`lib/run-ledger.js:320-350`), `checkBlindReadShape` for a blind read (`:443-461`), and `extractVerdict` for a plan review and the measures (`lib/plan-review-round-trips.js:296-307`) [checked].
- `readTrail` (`lib/run-trail.js:351-410`) reads the trail once. It gives the latest review (with the blind read after it), the landing PRs, and the work, close-out and audit facts. The close-out decision, the run page and the selector facts all use it [checked].
- Authorship is not recorded. Agents post under the person's account. The only "a person wrote this" sign is `RULING_MARK` (`lib/run-trail.js:95-100`) [checked].
- A run is a dispatch row: a queue doc, then a history doc with `status:'taken'`, `resolvedAt`, a `feedback[]` array and lineage fields (`lib/dispatch-store.js:1766-1802`) [checked].
- A run ends when a terminal marker (`[done]`, `[failed]`, ...) lands in `feedback[]`. `deriveTerminalStatus` and `deriveCompletedAt` read it (`lib/dispatch-terminal.js:37,193,417`) [checked].
- A run's own account is its final assistant text. The simple-dispatcher Stop hook posts it as `kind:'assistant-text'` feedback entries of up to 2,000 chars each, chunked as "recap i/n" (`sd:hook.js:187-200`, `sd:feedback.js:6,111`). They land in the row's `feedback[]` (`lib/dispatch-store.js:4060-4094`) [checked].
- Cost is not on the row. It is folded per lineage from request records or legacy `kind:'usage'` entries (`lib/cost-read.js`, `lib/row-usage.js:15-20`) [checked: headers].
- No row records the files or areas a run touches or claims. `RUN_FIELDS` has 23 fields and none is a path (`lib/dispatch-fields.js:50-216`) [checked].
- The only tie from a verdict to a version is the review's sha. `findSha` regexes it out of the review prose (`lib/run-ledger.js:298-310`). The close-out decision then compares it with the live PR head (`lib/run-closeout-state.js:195`) [checked].

## Sites

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C3-01 | lib/run-trail.js:66-76 | reads | Review opening: title names "review", not plan review or close-out, and the body holds `VERDICT_WORD` (:69) or the ledger heading | C3-02 |
| C3-02 | lib/run-trail.js:134-145,158-161 | reads | `COMMENT_KINDS` and `commentKindOf` | every C3 reader below |
| C3-03 | lib/run-trail.js:194-227 | reads | `isPlanComment`, `reportsLandedWork`, `isRuling`, `isPersonComment` | C3-12, C3-14, C3-20 |
| C3-04 | lib/run-trail.js:236-270 | reads | `latestReviewComment` (by `createdAt`), `readRunLedger`, `latestReviewRef` (first PR URL in the review) | C3-09, C3-16, C3-18 |
| C3-05 | lib/run-trail.js:280-317 | reads | `checkBlindRead`, `parseBlindRead` → `{verdict, reason, prs, at, commentId}`, `latestBlindRead` | C3-10, C3-17, C3-22 |
| C3-06 | lib/run-trail.js:351-410,420-422 | reads | `readTrail`, `landingPrUrls` | C3-07, C3-09, C3-10, C3-12, C3-15, C3-17, C3-22 |
| C3-07 | lib/run-ledger.js:265-350 | reads | `parseRunLedger` → `verdict`, `verdictText`, `ciLine`, `at`, `sha`, `commentId`, `ledger` | C3-04, C3-06 |
| C3-08 | lib/run-ledger.js:298-310 | reads | `findSha`: the first head-labelled sha, else any 7–40-hex token in the body | C3-07 |
| C3-09 | lib/run-closeout-state.js:108-117,164-169,189-206,237 | reads | Approve check; blind-read wait; `headMoved` = review.sha ≠ PR head; `closeOutDecision` | C3-11, C3-13, C3-15 |
| C3-10 | lib/close-out-readiness.js:82-111,131-137,149-170 | guards | Close-out chain and dispatch guard: refuses `head-moved` / `blind-read-missing` | lib/dispatch-entrance.js:50, routes/workspace-api-run-evidence.js:16,351, lib/close-out-merges.js:10 |
| C3-11 | lib/close-out-merges.js:18-30 | writes | Counts open ledger items from the review, by scope, into a close-out event | close-out-events record |
| C3-12 | lib/recommendation-facts.js:285-353,455-524 | reads | Plan-review verdicts (`planReviewVerdictOf` :302), blocking count, latest review verdict/at/ledger counts, person and ruling | lib/openrouter.js:981, lib/recommendation-look-first.js:150, lib/code-routes.js:44 |
| C3-13 | lib/recommendation-blind-read.js:43-73 | reads | `blindReadStep`: `routesRead`, plus ended blind-read runs since `review.at` (bound 2) | lib/code-routes.js:52-55 |
| C3-14 | lib/recommendation-look-first.js:102-138 | reads | Survey comments by kind, person comment holds the route, step attempted | lib/code-routes.js:61-64 |
| C3-15 | lib/run-evidence.js:100-118,151-215,277 | reads | Run-evidence model: review verdict/sha, blind read, `now.headMoved`, close-out box | routes/dashboard.js:496,743; routes/workspace-api-run-evidence.js:13; server.js:186,3361 |
| C3-16 | lib/run-evidence.js:324 | reads | `closeOutSummaryFor`: close-out after the chosen review | lib/task-page-loader.js:1363 |
| C3-17 | routes/proxy-writes.js:773-795 | guards | Write-time blind-read refusal (422): shape, then PR set = landing | every comment write on the proxy |
| C3-18 | lib/prompts/revision-brief.js:15-17,53-69 | instructs | Request Changes → revision section naming the reviewed PR | lib/prompt-template-defs.js:644-649 |
| C3-19 | lib/plan-review-round-trips.js:296-307,360-395 | reads | `extractVerdict`, a ±window around "verdict"; Tier A comment, Tier B `DONE:` feedback, Tier C next row | C3-12, lib/pipeline-churn.js:43,173-177, lib/effort-readout.js:80,463 |
| C3-20 | lib/openrouter.js:940-957,975-987 | carries | Selector view labels the ruling/person comment; facts block from C3-12 | getRecommendation seams |
| C3-21 | lib/openrouter.js:2071-2109 | reads | `codeRouteOf` iterates `CODE_ROUTES` | recommend surfaces |
| C3-22 | scripts/stability-measures-blind.mjs:26-27 | reads | Measure 1: `landingPrUrls`, `parseBlindRead` | script |
| C3-23 | lib/periodical-report-gate.js:51-54,67-90,105-153 | guards | Done gate: any GitHub commit/PR/blob URL, plus one comment with AGREE/DISAGREE, YES/NO, Disposition. Own regexes, not the classifier | routes/proxy-writes.js:539 |
| C3-24 | lib/follow-on-ratio.js:173 | reads | Ledger-heading presence (diagnostic) | scripts/follow-on-ratio.mjs |
| C3-25 | routes/workspace-api-issue-write.js:408 | writes | Appends `RULING_MARK` to an in-app comment | in-app comment route |
| C3-26 | lib/providers/linear/index.js:428-431,1177 | carries | 250-comment page keeps early verdicts in view | `fetchIssueComments` |
| C3-27 | lib/prompts/stage-kinds.js:363-366 | instructs | Plan-review contract: `### Plan Review Verdict`, `**Verdict:**`, `Blocking findings: <n>` | lib/prompt-contract.js:30-34 |
| C3-28 | lib/prompts/stage-kinds.js:425-430 | instructs | Review contract: `## Review — ID`, head `<sha>`, `CI:` line, ledger, `### Verdict` | same |
| C3-29 | lib/prompts/stage-kinds.js:460-461 | instructs | Close-out contract: `## Close-out — ID` | same |
| C3-30 | lib/prompt-contract.js:8-19 | instructs | Format table naming each reader | finishStagePrompt |
| C3-31 | lib/prompt-template-defs.js:602-635 | instructs | Plan-review prompt: verdict words and routing | PROMPT_TEMPLATES |
| C3-32 | lib/prompt-template-defs.js:764-791 | instructs | Review prompt: ledger, then `### Verdict`, conditional Approve rule | same |
| C3-33 | lib/prompt-template-defs.js:813-854 | instructs | Close-out prompt: read review + blind read; `--match-head-commit` | same |
| C3-34 | lib/prompt-template-defs.js:1014,1040-1110 | instructs | Blind-read prompt: `## Blind read`, one `Verdict:` line, `Read:` line with {HEAD}/{BASE} | same |
| C3-35 | lib/prompt-template-defs.js:916 | instructs | Audit heading | same |
| C3-36 | lib/prompt-template-defs.js:975,994 | instructs | Survey headings `… @ {BASE}` | same |
| C3-37 | lib/prompt-template-defs.js:194,321-333 | instructs | Plan and breakdown agents read a plan-review verdict | same |
| C3-38 | lib/periodicals.js:408-410 | instructs | Adversarial second-read: the three fields in one comment | periodical bullets :284 |
| C3-39 | lib/stage-router.js:36 | instructs | Selector rule: latest plan-review verdict asked for changes → `plan` | stage selector |
| C3-40 | lib/prompts/autopilot-kickoff.js:438,573 | instructs | Autopilot stops at the review verdict and blind read | kickoff |
| C3-41 | lib/prompts/blind-read-words.js:21-36 | carries | Kind, heading, `Verdict:` label, three words | C3-02, C3-07, C3-34, lib/llm-jobs.js:49 |
| C3-42 | lib/render-run-evidence.js:50-88 | shows | Review verdict + sha, blind-read verdict, head now, head-moved | lib/render-task-page.js:606,892; lib/render-session.js:519-521 |
| C3-43 | lib/render-task-page.js:521 | shows | `REVIEW_COPY[review.verdict]` | task page |
| C3-44 | lib/dispatch-store.js:6-55 | writes | Row schema: kind, issue, dispatchedAt/By, target, repo, model, harness, effort, sessionId, rootItemId | lib/dispatch-factory.js |
| C3-45 | lib/dispatch-store.js:1766-1802 | writes | History doc: `status`, `resolvedAt` (take time), `takenByToken*`, lineage seed | takeItem :1659 |
| C3-46 | lib/dispatch-store.js:4060-4094 | writes | `addFeedback`: `{message, url, urlLabel, timestamp, kind?, rootItemId?}` pushed atomically | routes/dispatch.js:1603 |
| C3-47 | lib/dispatch-terminal.js:37-38,193,417,680-691 | reads | Terminal markers → status / completedAt; `reportLinesOf` (`DONE:`/`[done]`) | C3-19, lib/dispatch-wake.js:284, C3-50 |
| C3-48 | lib/dispatch-lineage-status.js:11-58 | writes | Persisted `lineageStatus`, `lineageCompletedAt`, counts | feedback writes, closers |
| C3-49 | lib/lineage-membership.js:31-45 | reads | Anchor = `rootItemId` ?? id; member = taken, not abort | cost-read, dispatch-lineage.js:15 |
| C3-50 | lib/recent-runs.js:46-106,146-150 | reads | Stage run facts `{stage, at, outcome, dispatchedAt, id}`, "no run's messages" (:42) | lib/recommendation-input.js:38 |
| C3-51 | lib/run-live-wait.js:18-19,70 | reads | Queued/running stage run holds the ticket (`liveWaitOf`) | lib/code-routes.js:34-36 |
| C3-52 | lib/task-run-facts.js:1-30 | reads | `stopAt` / `variant` from the task's rows | C3-10 `readStopAt` |
| C3-53 | lib/cost-read.js:1-30; lib/task-cost-read.js:1-25 | reads | Lineage cost from request records or legacy usage | routes/proxy-compute.js:687, lib/task-timeline.js:417, run view |
| C3-54 | lib/run-paragraph-store.js:14-23; lib/run-paragraph-hook.js:91-105 | writes | AI paragraph per run (`urlKey:runId`, `inputHash`, `final`), no TTL | observation materializer; read routes/dashboard.js:700 |
| C3-55 | routes/dashboard.js:105-117 | reads | Latest `assistant-text` on a loop | session page |
| C3-56 | lib/close-out-events-store.js:22-39 | writes | Event: prUrl, headSha at merge, open-item counts. No review sha | C3-11, run-evidence route :356 |
| C3-57 | lib/ci-wake-sweep.js:88-100 | writes | `ci-wake: <sha7> <verdict>` marker. The only run-side record keyed by sha (CI verdict, not a stage verdict) | scheduler |
| C3-58 | sd:hook.js:187-200,2096; sd:feedback.js:94-113 | writes | Final text → `assistant-text` chunks; `[done] Task completed in …` → POST `/api/dispatch/feedback/:id` | Stop hook |
| C3-59 | tests/unit/lin-4458-comment-kind-census.test.js:1-23,292-340 | guards | Table frozen; no kind test outside run-trail.js; verdict-value parsers excluded (:16-18) | npm test |
| C3-60 | tests/unit/: lin-4458-trail-characterization, lin-4458-landing-consumers, lin-4437/4438 blind read, lin-4460, run-ledger, run-closeout-state, close-out-readiness-chain | guards | Trail, landing, blind read, close-out, ledger | npm test |
| C3-61 | tests/unit/: periodical-report-gate, plan-review-round-trips, effort-readout, lin-4465-code-routes, lin-4392-live-stage-wait, recent-runs, run-paragraph-store, cost-read-census | guards | Periodical gate, extractVerdict, routes, runs, cost | npm test |

## Consumers of the classifier and verdict parsing

| Consumer | What it needs from a verdict |
|---|---|
| run-closeout-state `closeOutDecision` (C3-09) | Review outcome (approve / conditional); review sha vs PR head; blind read on record naming each landing PR. Not its words |
| close-out-readiness guard (C3-10) | As above, through `readTrail` |
| recommendation-blind-read (C3-13) | Only "is a read on record"; `review.at` to count runs since |
| recommendation-facts (C3-12) | Review outcome, time, ledger item and open counts; plan-review outcomes in order with blocking count; person/ruling after |
| recommendation-look-first (C3-14) | Survey comment present (kind only) |
| openrouter selector view (C3-20) | Which comment is the ruling / person comment |
| run-evidence + pages (C3-15, C3-42, C3-43) | Outcome, verdict text, CI line, sha, time; blind-read verdict and reason |
| revision-brief (C3-18) | Outcome = Request Changes; the PR the review names |
| proxy blind-read guard (C3-17) | Shape at write: one word, a reason, PRs = landing |
| close-out-merges (C3-11) | Open ledger items by scope |
| periodical gate (C3-23) | Presence of three fields; outcome not read. Does not use the classifier |
| plan-review-round-trips, pipeline-churn, effort-readout (C3-19) | Outcome word from `extractVerdict`; not the classifier |
| follow-on-ratio (C3-24) | Ledger heading present |
| stability-measures-blind (C3-22) | Blind-read verdict and PRs |
| stage router (C3-39) | Prompt rule only; code reads none (`lib/stage-router.js:20`, `lib/code-routes.js:18-19`) |

No consumer needs who wrote a verdict; that cannot be told today (C3-25 aside).

## Corrections to the inventory

- **E6** held. The schema header is at `lib/dispatch-store.js:6-55`; the file has 4,571 lines. The quote is at `lib/run-live-wait.js:18-19`. No claim fields exist (C3-44) [checked]. Added: the end time is derived from markers, not stored on the row, except the persisted `lineageCompletedAt` (C3-47, C3-48).
- **E8** held in part.
  - `:134-145`, `:69` and `recommendation-facts.js:302` are right.
  - Corrected: the Periodical gate reads three fields plus a GitHub-URL check, with its own regexes, outside the classifier (C3-23).
  - Corrected: verdict parsing is not one route. There are three value parsers (C3-07, C3-05, C3-19), and `VERDICT_WORD` is typed twice (`run-trail.js:69`, `recommendation-facts.js:285`).
  - Corrected: "missing: tied to the version" is partly wrong. The review's sha is parsed (C3-08) and gates close-out (C3-09). It is prose-regexed, though, and falls back to any hex token.
- **E11** held. Cost files and the paragraph store's "no TTL" check out. Added: the run's own account is `assistant-text` feedback chunks (C3-58, C3-46). It is not stored apart, and the selector's run facts carry none of it (C3-50). "Headline model label" stays [reported].
- **E16** held. The diff exclusion is at `lib/prompt-template-defs.js:1072` and is repeated at `:1076`. The close-out quote is at `:833` [checked].

## Loose ends

- A blind read writes its {HEAD}/{BASE} shas on `Read:` (C3-34), but `checkBlindReadShape` keeps only PR URLs (`lib/run-ledger.js:451`). The survey `@ {BASE}` is not parsed in `lib/` either [checked: grep].
- A verdict comment carries no dispatch id. A run is tied to its verdict only by time (C3-13 `endedReadsSince`) [checked].
- `findSha` takes the first head-labelled sha. Failing that, it takes any bare 7–40-hex token, so a body citing another commit first can give the wrong sha (`lib/run-ledger.js:299-306`) [checked].
- `extractVerdict` also reads review comments for the effort read-out's implementation gate (`lib/effort-readout.js:7-9`) [reported].
- The `DONE_LINE_RE` that `lib/dispatch-terminal.js:677` names was not found in simple-dispatcher by grep [checked: grep only].
- `buildRunView`'s inputs (the paragraph's source) were not traced.
