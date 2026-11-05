# Drift & Coherence Review — 2026-11-05, run 4 (trend vs the 2026-11-05 run 3)

**Ticket:** LIN-4299. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-05.md` (LIN-4250, PR #2288, merge `40557e9f`), called **11-05** below. **Evidence:** `docs/reviews/_evidence-2026-11-05-drift-run4/` (the `-run4` suffix follows the same-day precedent of 11-05's `-drift` folder).

**Review-only.** This edition adds this report and its evidence folder. No code, config, guide, ticket intent or secret was changed. The Survey branch `claude/cool-rubin-6acj5j` was only read.

## Grounding (HEADs measured)

- **LinearViewer `origin/main` = `af55cb737ec4e63919bac65558b35498ede3d290`** (LIN-4293, #2314). The mint-time HEAD; it did not move during the review.
- **simple-dispatcher `origin/main` = `07c88f7a338b3e19a01070775e1f4d4cfc91f040`** (LIN-4233, #328). Unchanged since the previous edition: **0 commits** in `07c88f7..origin/main`, and a 0-line diff.
- **The window: LinearViewer `2eb73ae07fb7297fc0fa057a6198aa8cbe901558..af55cb737ec4e63919bac65558b35498ede3d290`.** That is 11-05's measured commit to today's `origin/main`. **29 commits**, not the 28 the ticket body states. The extra one is `40557e9f` (the 11-05 report, docs only), which the ticket's own list includes. Two landed after 11-05 measured: `a569b61c` (Seams run 7, docs only) and `29f14bf6` (LIN-4248, the Survey stage templates). Both are in the window and both were measured here.
- **Ten commits touch production** (`lib/`, `routes/`, `public/`, `server.js`): 24 files, **+717 / −178** (`git diff --shortstat 2eb73ae0 origin/main -- lib routes public server.js`). The test tree has 71 touched files, which were read for the fake-DOM move; docs and `scripts/` were read for the scope audit.
- **0-line diffs, verified by `git diff --stat`:** `scripts/code-shape/` (the census tools and the area guide), `lib/runner-kit/`, `docs/runner-prompt.md`. The guide is byte-identical at both ends: sha256 `e3194f52a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f`, git blob `642e9405`.

**What the window's size does to confidence.** Ten production commits, all of them Survey-driven tidies and features, plus the fake-DOM consolidation. An "unchanged" on a file the window did not touch is a high-confidence reading. An "unchanged" on a row that cites a touched file is lower confidence, so each of those 18 rows was checked at its cited lines, and all ten production diffs were read in full, not sampled. The window carries no information about whether anyone will act on a row.

## Better or worse, by area

This section was written from the code at `af55cb73` **before** the Survey place ledger was read. The draft is committed in `_evidence-2026-11-05-drift-run4/notes-beat1-verdicts-from-code.md`, and the ledger comparison comes after it below.

| Area (window clusters) | Verdict | What decides it (code at `af55cb73`) |
|---|---|---|
| **Stage templates and preamble** (LIN-4248, 4253, 4251, 4277) | **Better** | `route` and `writes` are declared once on each template (`lib/prompt-template-defs.js`). `EXCLUDED_FROM_AI_RECOMMENDATION` is derived from `route === null` (`lib/prompt-templates.js`). One `stageWrites` resolver serves both entrances (`lib/dispatch-entrance.js` ×2, `routes/workspace-api-feedback.js` ×2). One endpoint-hint ladder (`endpointHintParts` / `renderEndpointHints`, `lib/proxy-preamble.js`, net −36 lines). Residue: `lib/stage-writes.js` sits in the guide's catch-all (Seams' gap); the `writes` value is threaded by hand at four entrance call sites (row 134); the VERB OVERRIDE sentence is stale (row 131, minted). |
| **Cost read** (LIN-4263, 4276) | **Better (small)** | One posting-key list (`postingKeysOf`, `lib/cost-read.js`). One exported dispatch order (`byDispatchOrder`, `lib/lineage-membership.js`), reused by `dispatchesOf`. The per-dispatch split is opt-in (`perDispatch`), passed only by `/cost`, so the Models page and the effort readout pay nothing. Residue: the new comment at `lib/lineage-membership.js:14-15` says readers "none re-writes" the order, which three existing lineage sort copies contradict (sub-item of row 79). The inline loader check moved 147 → 160 and is still inline (row 129). |
| **Go state and the in-progress rule** (LIN-4247, 4246, 4293) | **Better on Go; the in-progress rule is still split across the server/client seam** (row 135) | `goState()` replaces every `state.go = {…}` literal (none left; 12 uses). `InProgress` owns the client reads with three named views (`public/prompt-section.js`). `focusInCard` is the one focus rule (`public/question-cards.js`). Three run-item literals became `runItemOf()`. Residue: the client `liveNow` adds a `status === 'waiting'` literal to the server's `live` flag, which by design covers running and queued only. That literal predates the window (`2eb73ae0:public/prompt-section.js:2300`). LIN-4293's comment "adds no rule of its own" overstates. The Go-status literals at `prompt-section.js:300` and `:2407` also predate the window. |
| **Home and task page** | **Neutral** | `lib/render-task-page.js`, `public/task-page.js`, `public/app.js`, `lib/home-row-states.js`, `lib/waiting-section.js`, `lib/home-view.js` have 0-line diffs. `READY_TASK_STATE` is still at `render-task-page.js:108`. The window changed the shared Go file, not Home's own surfaces. |
| **Client test tree** (LIN-4252, 4265, 4266–4285, 4270, 4272, 4255) | **Better, with one unguarded half** | The fake-DOM ratchet is real: an exact sorted list of 25 hand-written fakes, matched by AST shape, not by name (`tests/unit/fake-dom-census.test.js`). Each of its 9 "stop" entries names the fake API that blocks it. The `loadWorld` half of the CLAUDE.md rule is not guarded (row 133): of 68 vm-over-`public/` suites, 64 do not use `loadWorld`. |
| **Survey and delivery scripts** (LIN-4257) | **Better in the touched file; the copies beside it are unchanged** | `scripts/delivery-paths.mjs` is now the one home for `isTest` / `isDoc`, and `delivery-composition.mjs` and the task-size paper import it. Eight pre-window copies in `scripts/survey-*.mjs` and `scripts/steady-base-*.mjs` were not touched (row 132). |
| **Overall** | **Better, small.** | Real consolidations with one owner each: stage routing and writes, cost posting keys, cost dispatch order, Go state, the focus rule. No `mustRule` group joined or left the census. No new import cycle, and the 0 upward edges hold. No cross-repo change, since SD and the kit have 0 diff. Four new low findings. None changes behaviour today. Three are about text an agent or reader is told, and one is a duplicated decision outside the census's scope. |

**Trend, by row, against 11-05:** resolved 17 (held), improved 1 (row 122, 2 of 9 cited sites rewritten), unchanged 111, touched without consolidation 1 (row 121), new 5 (rows 131–135). Row 79 worsened by a comment (not a copy). Per-row detail is in the compact ledger.

## Headline

1. **Better, small.** Four areas moved, all in the same direction: one owner for a decision that was spread out before. No `mustRule` group joined or left, and the import graph and `res.status(` count are unchanged in kind.
2. **The top of the ledger did not move in code.** `resume-model-effort-cross-repo`, `credential-decision-multiplicity`, `runner-contract-semantics-cross-repo`, `halt-word-map-copies` and `halt-poll-cold-cache-fail-open` are unchanged. The cross-repo rows are unchanged by construction, since SD has 0 commits and the kit has a 0-line diff. The halt cold-cache row is John's ruling (LIN-3024) and is not chosen here.
3. **One follow-up minted:** `override-kind-list-stale` (row 131, LOW), **LIN-4302**, under LIN-3449 with `kind:follow-up`, in Backlog. It is the only candidate with no existing ticket that is cheap and concrete (see Follow-ups).
4. **New report-only rows** (no tickets): row 132 (path-classifier copies), 133 (the `loadWorld` half), 134 (`writes` threading and its silent default), and 135 (the in-progress rule across the seam, found by the second read; home LIN-4256).
5. **The instruments reproduce.** The census at the 11-05 readings matches 11-05 on every JSON key except the guide path. The import graph at `2eb73ae0` matches 11-05 (499 / 2,051 / 2 SCCs), and at HEAD it has 500 / 2,053 with the two new edges into `lib/stage-writes.js`.

## Findings (severity-ranked; delta vs 11-05)

Citations are at `af55cb73` (Harbour) and `07c88f7` (SD). "Carried" rows are the 11-05 ledger's rows under their stable names. The compact ledger holds every row with its delta.

| # | name | severity | delta vs 11-05 | one line |
|---|---|---|---|---|
| 1 | `resume-model-effort-cross-repo` | MEDIUM-HIGH | unchanged | `dispatch-factory.js` and `follow-up-dispatch.js` and SD `harnesses.js` have 0-line diffs. LIN-4156 Backlog, 0 comments. |
| 2 | `credential-decision-multiplicity` | MEDIUM-HIGH | unchanged (borderline) | `lib/workspace.js`, `lib/errors.js` 0-line diffs. LIN-3822 Backlog. |
| 3 | `cross-repo-sentinel-decision-marker-vocabulary` | MEDIUM | unchanged | The kit has a 0-line diff. SD status strings unchanged. |
| 4 | `halt-poll-cold-cache-fail-open` | MEDIUM (conditional) | unchanged | All cited files 0-line diff. LIN-4210 Backlog, 0 comments. **John's ruling (LIN-3024); not chosen.** |
| 5 | `runner-contract-semantics-cross-repo` | MEDIUM | unchanged | 38 vs 34 rows, both 0-line diff, 0 usage rows. |
| 6 | `halt-word-map-copies` | MEDIUM | unchanged | All four map files 0-line diffs. LIN-4157. |
| 7 | `run-page-identity-scrape` | MEDIUM | unchanged | The cited lines are unmoved. |
| 8 | `home-next-answer-split` | MEDIUM | unchanged | Home files 0-line diff. LIN-4158 Backlog. |
| 9 | `coherence-loop-stalled` | MEDIUM (process) | unchanged | No Drift-family ticket moved. 16 open as at 11-05; this run adds LIN-4302 under LIN-3449. |
| 10 | `parked-wait-text-cross-repo` | LOW-MEDIUM | unchanged | SD side 0 commits. Home is LIN-2258. |
| 11 | `live-anchor-old-home-alive` | LOW-MEDIUM | unchanged | Cited lines unmoved. |
| 12 | `decision-stamp-classifier-copies` | LOW-MEDIUM | unchanged | `session-telemetry.js` 0-line diff. |
| 13 | `task-page-state-outside-owner` | LOW-MEDIUM | unchanged (borderline) | `READY_TASK_STATE` still `render-task-page.js:108`. The Go-status literals at `prompt-section.js:300` and `:2407` predate the window. |
| 14 | `ruling-settled-row-predicate-inline` | LOW | unchanged | The three cited route files (`dashboard-rulings.js`, `workspace-api-issue-write.js`, `workspace-api-scan.js`) have 0-line diffs. |
| 15 | `error-code-case-split` | LOW | unchanged | `RULING_SETTLED_CODE` unmoved at `question-cards.js:248`. |
| 16 | `usage-snapshot-prose-residue` | LOW | **improved (2 of 9)** | `proxy-instructions.js` and `proxy-integration.md` rewritten by LIN-4263. See the ledger, row 122, for the citation correction. |
| 17 | `waiting-standing-comment-residue` | LOW | unchanged | `lib/home-row-states.js`, `lib/waiting-section.js`, `public/app.js` 0-line diffs. |
| 18 | `request-source-guard-copies` | LOW | unchanged (touched, not consolidated) | The inline check moved `cost-read.js` 147 → 160, still inline. No new copy. |
| 19 | `vendor-script-list-restated` | LOW | unchanged | No window change to the script lists. |
| **131** | **`override-kind-list-stale`** | **LOW** | **new; minted LIN-4302** | `lib/proxy-instructions.js:860` lists 15 of the 19 keys the route accepts (`routes/proxy-compute.js:406`). Missing `bug`, `plan-review`, `close-out`, `retrospective-audit`. |
| **135** | **`in-progress-predicate-server-client-split`** | **LOW** | **new; report-only (home LIN-4256)** | The client `liveNow` adds a `'waiting'` literal to the server's `live`. Predates the window; moved, not removed. The LIN-4293 comment overstates. |
| **134** | **`stage-writes-threading-per-entrance`** | **LOW** | **new; report-only** | `writes` resolved once, threaded by hand at four call sites; absent means `work` silently. |
| **132** | **`path-class-predicate-copies`** | **LOW** | **new; report-only** | `isTest`/`isDoc`: one canonical home (`scripts/delivery-paths.mjs`) plus eight untouched copies in `scripts/`. |
| **133** | **`world-helper-convention-half-guarded`** | **LOW** | **new; report-only** | 64 of 68 vm-over-`public/` suites do not use `loadWorld`. 25 are census-listed hand-written fakes, 1 imports `fake-dom.js`, 38 build their own non-tree `document` stub that the census excludes by design. |
| — | `unit-census-convention-split` (row 121) | informational | **touched** (+1 census) | LIN-4265's `fake-dom-census.test.js` is an exact sorted list over an AST shape. Probably a fifth allowlist shape; the 11-04 text names four without listing them, so this is not ruled. |
| — | `lineage-row-read-copies` (sub-item of 79) | low | **worsened by a comment** | `lib/lineage-membership.js:14-15` says "none re-writes" the order. `ci-wake-sweep.js:253`, `pipeline-loops.js:84`, `pipeline-churn.js:196` keep their own sort rules. The copies are unchanged; the comment is wrong. |
| — | `reply-effect-default-split`, `completeness-precedence-restated` | borderline (not graded) | unchanged | See the ledger, rows 130 and 123. |
| — | `lib-import-cycles`, `lineage-identity-read-twins`, `cost-fold-partition-restated`, `erasure-inventory-lockstep-gap` and the other resolved rows | as 11-05 | held | Each row was checked by its own cited files or by its hunk. |

**Resolved:** none new this run. **Improved:** 1 (row 122). **New:** 5 (rows 131–135). **Worsened:** 1 comment-level (row 79's sub-item). The window's own cross-cutting findings, ranked: 131 first (a concrete agent-facing contract gap, minted), then 135 (the in-progress rule split, the top of the second-read's answer), then 134, then 132 and 133.

### Window findings, with the code behind them

**131 `override-kind-list-stale` (LOW, minted LIN-4302).** The catalog tells an agent which template keys a VERB OVERRIDE accepts, and the list is hand-written. At `af55cb73` it has 15 keys, and the route's `hasPrompt` check accepts all 19 (`routes/proxy-compute.js:406`). The four missing keys are `bug`, `plan-review`, `close-out` and `retrospective-audit`. LIN-4248 added its two Survey keys to the same sentence without deriving the list, so the next stage kind will drift the same way. **Fix options** (for LIN-4302): derive the list from `PROMPT_TEMPLATES` in the catalog, or add a test that fails on a missing key. The second is less work; the first removes the drift.

**135 `in-progress-predicate-server-client-split` (LOW, report-only; home LIN-4256).** The second read raised this as the largest window item this review would otherwise miss, and I checked it. The server's `sessionFactsOf` (`lib/task-state.js:55-66`) sets `live` to running or queued, by design. The client's `InProgress.liveNow` (`public/prompt-section.js:726`) adds `status === 'waiting'`. That literal predates the window (`2eb73ae0:public/prompt-section.js:2300`). LIN-4293 moved it into the owner but kept it, and its comment says the owner "adds no rule of its own", which is not true. Nothing diverges today. The two honest fixes are a server flag that covers waiting, or one named client field read from the reply. Both are design choices, so this is not minted. **LIN-4256** (Backlog) already asks whether Go's displayed state should follow `/state`, and is the natural home.

**134 `stage-writes-threading-per-entrance` (LOW, report-only).** A stage's `writes` is resolved once, by `stageWrites(kind)` (`lib/prompt-templates.js`), then threaded by hand at four entrance call sites: `lib/dispatch-entrance.js` (×2) and `routes/workspace-api-feedback.js` (×2). The call-site census (`tests/unit/lin-3134-declared-mint-census.test.js`) guards the mint, not the field. The default is silent: an absent value resolves to `work` (`lib/proxy-preamble.js` `resolveWrites`), so an entrance that drops the argument gets the PR-mandate block with no error. `routes/collective.js:373` omits it, which is safe only because its kind is `custom`. Same shape as row 36.

**132 `path-class-predicate-copies` (LOW, report-only).** LIN-4257 extracted `isTest` and `isDoc` into `scripts/delivery-paths.mjs`, and `delivery-composition.mjs` and the task-size paper now import it. That is one canonical home. Eight pre-window copies remain: six `scripts/survey-*.mjs` files define the path classifiers, five with the same two regexes and `survey-costmix-classes.mjs` with an extended `isDoc`; and `steady-base-code.mjs` and `steady-base-provenance.mjs` carry differing `isTest` rules. (`survey-tests-shape.mjs` has an unrelated `isDoc` over file content, so it is not counted.) The window did not touch them. Not minted: this is repo tooling with no shipped behaviour, and the cap is reached.

**133 `world-helper-convention-half-guarded` (LOW, report-only).** `CLAUDE.md` requires vm-over-`public/` suites to use `fake-dom.js` and `client-world.js` (`loadWorld`). The census guards only the fake-DOM half. Of 68 vm-over-`public/` suites, 64 do not use `loadWorld`. Split by the census's own shape and imports: **25** are the census's hand-written fakes (guarded by the ratchet), **1** imports `fake-dom.js` directly, and **38** build their own `document` stub with no tree shape, which the census excludes by design. Those 38 are the unguarded class. Per-suite quality is Code Quality's, and coverage is Test Coverage's. The `loadWorld` cheap-path tickets (LIN-4297, LIN-4289) are the existing homes for the helper.

**Sub-item of 79 (worsened by a comment, not minted).** The comment is wrong and its copies are pre-existing. The fix is a comment edit plus row 79's consolidation, which is already tracked there.

## Cross-repo verdicts

The cross-repo contract (the runner contract table, halt, markers, the parked-wait text, the consumer heartbeat, the model/effort/harness vocabulary, and the per-request usage records) lives across both repos and the kit.

- **SD: 0 commits** in `07c88f7..origin/main`. **Kit (`lib/runner-kit/`) and `docs/runner-prompt.md`: 0-line diffs.** So every cross-repo row is **unchanged by construction**. The rows are 6, 9, 10, 11, 15, 33, 42, 61, 76, 92, 93, 97, 101, 102, 114, 118 and 125.
- **Harbour-side contract text that moved:** the `/cost` `dispatches` prose and the VERB OVERRIDE sentence in `lib/proxy-instructions.js`, and the `/cost` section of `docs/proxy-integration.md`. These are Harbour-only texts that SD does not read. The `/cost` change adds keys and does not rename any (`routes/proxy-compute.js`: "additive, placed last").
- **Verdict:** no cross-repo row moved. The only movement is one Harbour-side text (131), which is minted.

## Sibling hand-offs (recorded, not double-flagged)

- **Seams & Tangles run 7** (LIN-4249, `a569b61c`, docs only). Its Drift hand-offs (`seams-tangles-review-2026-11-05.md:424-430`) were folded into 11-05 (rows 126, 127, 128). Nothing new to take. Its one live gap, `lib/stage-writes.js` in the catch-all, is Seams' guide gap. It is recorded here, not re-flagged. **Seams run 8** (LIN-4298) is in progress and has no hand-off yet.
- **Code Quality:** `clearRunItem(why)` (`public/prompt-section.js:2369`) takes a reason it never reads. The comment says the reason is for the reader. That is a within-file cleanup, not Drift's. Cross-linked, not ranked.
- **Test Coverage:** the 38 own-stub suites (row 133) and the coverage of the 9 stops. Cross-linked.
- **Stability:** the path-classifier copies in `scripts/` are not on the churn or fault path. Nothing to hand off.
- **Survey place ledger:** read after the verdicts above. Agreement per ticket is below.

### Survey place ledger: agreement per ticket

The ledger (read-only, `origin/claude/cool-rubin-6acj5j:docs/plans/survey/place-ledger.md`) rates each window ticket. This is one line per ticket.

- **LIN-4248** (ledger: mixed). **Agree** on the feature row. The stage templates now read better, which the later tidies bring about.
- **LIN-4253** (ledger: better). **Agree.** `route` and `writes` have one home each.
- **LIN-4251** (ledger: better, mixed). **Agree on the area.** The mixed part is the threading copy that row 134 records.
- **LIN-4277** (ledger: better). **Agree.** One endpoint-hint ladder.
- **LIN-4263** (ledger: mixed). **Agree.** The capability was a re-write of nearby rules, and LIN-4276 cleaned it up.
- **LIN-4276** (ledger: better). **Agree.** One posting-key list and one dispatch order in `/cost`.
- **LIN-4247** (ledger: mixed, "the edges gain another copy"). **Partly disagree.** I could not find a copy that 4247 added. The Go-status literals at `prompt-section.js:300` and `:2407` predate the window (`:286` and `:2326` at `2eb73ae0`). The `ended` view is a new owner, and LIN-4293 then named it. The residue is row 135, which predates the window.
- **LIN-4246** (ledger: mixed). **Agree.** The bug fix is a real user-facing repair, and it carried a copy.
- **LIN-4293** (ledger: better, better). **Agree on the consolidation**, and **disagree with the comment**: the owner composes a server flag with a client literal (row 135).
- **LIN-4252** (ledger: mixed). **Agree.** A shared helper that callers may adopt later.
- **LIN-4255** (ledger: better, better). **Agree on the ratchet.** The `loadWorld` half is unguarded (row 133), and the census does not cover it.

**The area-level balance** agrees with the ledger's "better, better" for the three "after" tidies (LIN-4276, 4277, 4293) and the census (LIN-4255). It is **more modest than the ledger's cumulative reading** on the Go state, because row 135's split is still there.

## Method and instrument

- **Census.** `scripts/code-shape/census-review.mjs` at one guide (`areas-2eb73ae0.json`, sha256 above) with the 11-05 scope pattern `^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)`, run from the repo root against committed objects.
  - **Reproduction (R)**, the 11-05 reproduction of 11-04b's W1: `d7ceb373` vs `5334c81a`. Equal to 11-05's own R JSON apart from the guide path.
  - **Reading (W)**, 11-05's: `2eb73ae0` vs `d7ceb373`. **566 / 105 / 309 / 1 / 0.** This run reproduced it: equal to 11-05's JSON apart from the guide path.
  - **This run's reading:** `af55cb73` vs `2eb73ae0`. **566 / 105 / 309 / 1 / 0.** `census-compare.py` against 11-05's reading: 562 unchanged, 2 grown, 1 new, 1 shrunk, 1 gone. **0 `mustRule` groups joined or left.** 105 kept: 85 with identical sites, 20 with shifted line numbers only.
  - **Table groups:** G0119 (gone) → G0113 (new). This is the same stage-kind set, with 17 kinds, keyed in `STAGE_LEADS`, `STAGE_LABELS` and `BUCKET_OF_KIND`. It is a **re-key**, not a resolution (ledger row 77). G0173 (`status == 'running'`) grew 2 → 3 sites. G0164 shrank and G0166 grew (anonymous helper clones). Full table: `_evidence-2026-11-05-drift-run4/census-table-groups-run4.tsv`.
- **Rulings.** `rulings-carry-run4.py` joins the 105 groups to 11-05's rulings on (detector, decision, file set). Carried: **34 real, 29 borderline, 42 noise**. A group is flagged when a site falls inside a hunk of `git diff -U0 2eb73ae0 origin/main`. **None was flagged.** The 20 shifted groups had line numbers move with no site inside a hunk.
- **Import walker.** `import-walker.mjs` (copied unchanged). At `2eb73ae0`: 499 nodes, 2,051 static edges, 2 dynamic, SCCs 6 + 6 (same members), upward 0 / 0, route→route 53. At `af55cb73`: 500 / 2,053 / 2, the same SCCs and members, upward 0 / 0, route→route 53. **The edge diff is exactly two new edges, both into `lib/stage-writes.js`:** `prompt-template-defs.js` and `proxy-preamble.js`. No edge removed.
- **`res.status(`** in `routes/` and `server.js`: **275 at both ends** (`git grep -c`).
- **Touch map.** `ledger-touch-map-run4.txt`: the 11-05 ledger rows whose text names a window-touched file (basename match over all 416 window files). It gives 18 production rows, the same 18 as the research. Row 1 also matched the previous edition's evidence file, which is a false positive. Row 121 was added by hand, because its text names no file and it is touched by LIN-4265's new census. Each touched row was checked at its cited lines against the hunks.
- **Ticket re-check.** The 23 carried follow-up tickets (LIN-4210, 4214, 4156, 4157, 4158, 3822, 3823, 3835, 3836, 3843, 3624, 3636, 3649, 3736, 3979, 1496, 3449, 2258, 4235, 4244, 4245, 4238, 2739). State and comment counts were read at review time. None moved after 11-05 measured. LIN-4214's last comment is at `2026-11-04T19:37`, the boundary, so it is not after it.
- **Linear searches.** Run for every mint candidate and for every "missing fake API" claim (`VERB OVERRIDE`, `override kind list`, `kind list stale`, `accepts 19`, `override-kind`, `getBoundingClientRect`, `dispatchEvent bubbling`, `fake DOM select value`, `loadWorld`, `fake-dom`, `liveNow`, `sessionFactsOf live`, `in progress waiting live`). See Follow-ups.
- **Scope audit.** In remit and checked: the test tree, through the fake-DOM census only (`tests/` is excluded from the census's scope pattern, and its per-suite quality is owned by Code Quality and Test Coverage); `scripts/delivery-*.mjs` against the stage-route table (the research's guess was wrong: `delivery-paths.mjs` is the `isTest`/`isDoc` helper, row 132); `public/llms.txt` and `lib/proxy-instructions.js` against the preamble ladder (row 131 and the 19-template count, both checked); `experiments/place-change/place-change.mjs`, which wraps `scripts/code-shape/seams.mjs` and restates the guide's area match inline (`homeOf`, borderline and unowned per Stability F10, not ranked); the `docs/architecture/prompt-system.md` and `source-map.md` edits against the code (the "19 templates" count and the writes values hold).
- **Second read.** Tier 2: a fresh-context sub-agent given only the repo, the window and one question, with no reports or the place ledger. Its answer was recorded before it was shown this report. See the section below.
- **Not run.** No test suite in either repo: no code changed. SD's `test:system` tier was not run.

## Follow-ups

**Minted (1):**

- **LIN-4302** `Override kind list: VERB OVERRIDE lists 15 of the 19 template keys the route accepts`. LOW. Parent LIN-3449. Label `kind:follow-up`. Backlog. Filed after a search for `VERB OVERRIDE`, `override kind list`, `kind list stale`, `accepts 19` and `override-kind` found no ticket naming it. The nearest is LIN-839 (Done), which is the older `?kind=` override bug and is a different defect.

**Considered, not minted:**

- **`in-progress-predicate-server-client-split`** (row 135, ranked first among the report-only items). It has no behaviour divergence today, and its fix is a design choice (a server flag that covers waiting, or one named client field). **LIN-4256** is the existing home (Backlog, "Go's displayed state should follow `/state`"). Re-raise there, not as a new ticket.
- **`path-class-predicate-copies`** (row 132). Repo tooling with no shipped behaviour. The Survey copies are a Survey concern. Cap reached.
- **`world-helper-convention-half-guarded`** (row 133). A guard for the `loadWorld` half would be new tooling, and this review introduces none. The helper's cheap path is already tracked by LIN-4297 and LIN-4289.
- **`stage-writes-threading-per-entrance`** (row 134). Guarded by a census for the mint, and the silent default is a designed default, not a defect. Report-only.
- **Three missing fake APIs.** `<select>.value` is covered by **LIN-4296** (In Progress: "Shared fake DOM models `<select>.value`; move the suites stopped on it"). `getBoundingClientRect` and the bubbling `dispatchEvent` (stops at `public/common.js:2907` and `public/question-cards.js:239-241`) have no ticket that I found. The ratchet already tracks the three stops, so this is a cause note, not a ticket. The research's claim that nothing covered the `<select>` stops was wrong, and this section corrects it.
- **The lineage dispatch-order comment** (sub-item of row 79). The fix is a comment edit plus row 79's consolidation, which is already tracked there.

## For John

- **Halt cold-cache, row 114 (LIN-4210 / LIN-3024).** John's ruling, not chosen here. Unchanged in code.
- **Nothing else needs a ruling.** The choice between "derive the VERB OVERRIDE list" and "test it" (LIN-4302) is an engineering choice and is the owner's.

## Ticket trend

| Ticket | State (11-05) | State (run 4) | Comments | Delta |
|---|---|---|---|---|
| LIN-4210 | Backlog | Backlog | 0 | unchanged |
| LIN-4214 | Backlog | Backlog | 1 (2026-11-04T19:37) | unchanged |
| LIN-4156 | Backlog | Backlog | 0 | unchanged |
| LIN-4157 | Backlog | Backlog | 0 | unchanged |
| LIN-4158 | Backlog | Backlog | 0 | unchanged |
| LIN-3822 | Backlog | Backlog | 3 (2026-11-03) | unchanged |
| LIN-3823 | Backlog | Backlog | 2 (2026-11-03) | unchanged |
| LIN-3835 | Backlog | Backlog | 1 (2026-11-03) | unchanged |
| LIN-3836 | Backlog | Backlog | 1 (2026-11-03) | unchanged |
| LIN-3843 | Backlog | Backlog | 1 (2026-11-03) | unchanged |
| LIN-3624 | Backlog | Backlog | 6 (2026-11-04T08:41) | unchanged |
| LIN-3636 | Backlog | Backlog | 7 (2026-11-03) | unchanged |
| LIN-3649 | Backlog | Backlog | 3 (2026-11-03) | unchanged |
| LIN-3736 | Backlog | Backlog | 3 (2026-11-03) | unchanged |
| LIN-3979 | Backlog | Backlog | 2 (2026-11-03) | unchanged |
| LIN-1496 | Backlog | Backlog | 6 (2026-11-03) | unchanged |
| LIN-3449 | Todo | Todo (+LIN-4302 child) | 22 (2026-11-04T08:41) | parent of the new child |
| LIN-2258 | Backlog | Backlog | 1 (2026-08-24) | unchanged |
| LIN-4235 | Backlog | Backlog | 0 | unchanged |
| LIN-4244 | Backlog | Backlog | 0 | unchanged |
| LIN-4245 | Backlog | Backlog | 0 | unchanged |
| LIN-4238 | Backlog | Backlog | 0 | unchanged (the Observation twin) |
| LIN-2739 | Backlog | Backlog | 0 | unchanged |
| LIN-4302 | — | Backlog (minted) | 0 | new |

Related, not re-flagged: LIN-4296 (In Progress, `<select>.value`), LIN-4292 (In Progress, method-presence guards), LIN-4256 (Backlog, Go state), LIN-4259 (Backlog, derive template write-policy wording from `writes`), LIN-4254 (Backlog, 16 not-attempted client stubs), LIN-4291 (Backlog, fake-DOM sibling reads), LIN-4297 and LIN-4289 (Backlog, `loadWorld`), LIN-4298 (In Progress, Seams run 8).

## Adversarial Second-Read

**Tier:** Tier 2, a fresh-context sub-agent with no memory of this review. It was given only the repo, the window `2eb73ae0..af55cb73`, and one question, and was told not to read `docs/reviews/` or `docs/plans/`, so no report or place ledger could anchor it.

**The question:** "What is the largest item in this window that a Drift & Coherence review (cross-cutting duplication, convention fragmentation, dependency direction, cross-repo contract) would miss or misfile?"

**Its answer, recorded before it saw this report (in full):**

> **Primary: the run-state "in progress" rule is split across the server/client boundary (LIN-4293).**
>
> - `public/prompt-section.js:726` (`liveNow`) returns `data.live === true || data.status === 'waiting'`. `ended()` just below it adds `!sessions.busy`.
> - The server's `lib/task-state.js:55-65` (`sessionFactsOf`) sets `live: !!held`, and its comment says `live` covers only running and queued. Waiting is excluded on purpose, and the client re-adds it with a string literal.
> - The commit title says "one 'in progress'", and the comment at `prompt-section.js` says the owner "adds no rule of its own". Both are inaccurate: `liveNow` is a rule, and it is computed from two server fields plus a status literal.
> - The fix belongs across the boundary: the server should emit one `inProgress` flag, or the client should read one named field.
> - Why it is cross-cutting: the owner is the HTTP reply shape, which both repos depend on, so a single-module review sees one tidy file and misses the split.
>
> **Runner-up 1: the `writes` default is silent.** `lib/dispatch-factory.js:1110` passes the resolved kind to `finalizePrompt`. `attachProxyContext` (`lib/proxy-preamble.js:723`) defaults `writes = null`, which means `work`, the PR-mandate block. `routes/collective.js:368-373` calls `attachProxyContext` without `writes`; it is safe only because its kind is `custom`. `routes/workspace-api-feedback.js:268` and `:332` were patched in this window, which shows the failure mode is real. Why it is cross-cutting: the contract is a positional callback argument shared by the factory, several entrances and the preamble.
>
> **Runner-up 2: none.** The `writes`/READING coupling is pinned by `tests/unit/lin-4253-stage-traits.test.js:117`.

**Checked by this review before it was accepted.** The `status === 'waiting'` literal is at `2eb73ae0:public/prompt-section.js:2300` and at `726` now, so it predates the window and was moved, not added. The server's `live` covers running and queued only (`lib/task-state.js` `sessionFactsOf`). `routes/collective.js:373` calls `attachProxyContext` without `writes`. Each claim holds. The report records row 135 for the first, and the silent default under row 134.

**Verdict (the same agent, shown this report after its answer):** **AGREE.** The report handles the primary item (row 135) and runner-up 1 (row 134) correctly. Runner-up 2 is not ranked, which is acceptable because the READING/`writes` coupling is pinned by a test. On the top finding, the agent's answer is that row 131 is the right top for a present defect, and row 135 is the top for an item a Drift review would miss. It named no other item above row 131.

**Differed from top finding: yes.** The second read's primary item is row 135. The report's top window finding, ranked on present cost, is row 131 (the stale VERB OVERRIDE list, minted as LIN-4302). The two criteria differ, defect against missed, and the report keeps both. Row 131 is first under findings; row 135 is first among the items this review would otherwise have missed.

**Disposition:** Report-only, with no code change, since this review is docs-only. Row 135 is recorded with its home, LIN-4256 (Backlog, Go's displayed state following `/state`). The silent `writes` default is part of row 134. No escalation. The second read changed the report in two places: row 135 was added, and row 134 gained the silent-default point.

**Adversarial second-read verdict:** AGREE (Tier 2, fresh-context sub-agent).


## Census ruling table (the 105 `mustRule` groups, run-4 reading)

Counts: 34 real, 29 borderline, 42 noise. The same as 11-05. Rulings carry from 11-05 on the join (detector, decision, file set). **None was flagged** for re-read: no site falls in a window hunk. The reasons are carried as written in 11-05, which also means they are not re-argued here.

| id (run 4) | 11-05 id | decision | a/f/s | ruling | one-line reason (carried from 11-05) | basis (run 4) |
|---|---|---|---|---|---|---|
| G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/18/43 | **real** | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it never landed). | lines shifted; no site inside a window hunk |
| G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | **real** | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: findAnchorLoop plus one run-root helper. | lines shifted; no site inside a window hunk |
| G0003 | G0003 | repeated comparison authType == 'oauth' | 4/8/12 | **real** | lib/workspace.js getBindingCallScope | identical sites |
| G0004 | G0005 | record assembled from the same sources {id=ID.id, identifier=ID.identifier, title=ID.title} | 7/10/15 | noise | Three-field projection of differently shaped objects; no rule inside. The mock-fixture cluster is covered by G0035 and G0158. | identical sites |
| G0005 | G0004 | record assembled from the same sources {deployInfo=getDeployInfo(), urlKey=ID.urlKey, openRouterSource=getOpenRouterSource(), workspaces=ID.session.workspaces} | 2/13/13 | **real** | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/components/page.js should own it. | identical sites |
| G0006 | G0006 | repeated comparison accessToken == 'test-token' | 6/8/15 | **real** | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN`), the same mock rule restated in the key-state holder. Home unchanged: `isTestToken` in `routes/workspace-api-steps.js`, belongs in `lib/`. | lines shifted; no site inside a window hunk |
| G0007 | G0007 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, stripMarkdown, slugifyPeriodicalTitle, plainParagraph), 11 copies of 1-4 statements | 4/9/11 | **borderline** | slugifyForFilename is copied identically in lib/prompt-formatters.js, public/app.js and public/prompt-section.js; the other members are different rules. Client-side sharing cost is unclear. | lines shifted; no site inside a window hunk |
| G0008 | G0008 | repeated comparison kind == 'wake' | 2/10/23 | **real** | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake sites are distinct filters. | lines shifted; no site inside a window hunk |
| G0009 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | noise | provider switch at the edge; each branch differs | identical sites |
| G0010 | G0010 | repeated comparison status == 'taken' | 1/9/16 | **borderline** | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joined predicate. One helper is cheap; benefit still unclear. | lines shifted; no site inside a window hunk |
| G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | **real** | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recommendation-facts, proxy.js). Route them through it. | identical sites |
| G0012 | G0012 | repeated comparison scope == 'current' | 3/10/16 | **real** | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Label 'scope == current' is misleading. Home: lib/workspace.js. | identical sites |
| G0013 | G0013 | repeated comparison NODE_ENV == 'production' | 3/5/7 | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. | identical sites |
| G0014 | G0014 | repeated comparison key == 'Escape' | 1/7/10 | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-derived. | lines shifted; no site inside a window hunk |
| G0015 | G0015 | repeated comparison key == 'Enter' | 1/8/12 | **borderline** | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards, distinct. No shared helper. | identical sites |
| G0016 | G0016 | repeated comparison stopAt == 'pr' | 4/10/15 | **real** | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-derive it. | lines shifted; no site inside a window hunk |
| G0017 | G0017 | text contract marker: [blocked] | 3/7/15 | **borderline** | dispatch-terminal — the parse side is the authority; the emit side is the kit | lines shifted; no site inside a window hunk |
| G0018 | G0019 | repeated comparison name == 'AbortError' | 4/6/10 | noise | standard fetch-abort check | lines shifted; no site inside a window hunk |
| G0019 | G0018 | repeated comparison provider == 'linear' | 2/4/7 | **borderline** | workspace-token-refresh defaultResolveExchange | identical sites |
| G0020 | G0020 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...].some] | 4/4/8 | **real** | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entrance.js:245 is an exact-host variant. | identical sites |
| G0021 | G0021 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} as switch/array/or-chain [ID.provider, KNOWN_SOURCES, REGISTRY_PROVIDERS] | 3/4/4 | **borderline** | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW | identical sites |
| G0022 | G0022 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [months, MONTHS, FLOW_MONTHS] | 4/6/7 | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. | identical sites |
| G0023 | G0023 | text contract marker: [evidence] | 5/6/9 | **real** | session-telemetry EVIDENCE_PREFIX | identical sites |
| G0024 | G0024 | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-alive", Content-Type="text/event-stream"} | 2/5/7 | **real** | lib/http-keepalive.js | identical sites |
| G0025 | G0025 | record assembled from the same sources {code=ID.code, category=ID.category, retryable=ID.retryable} | 4/7/8 | **real** | lib/errors.js — refusal envelope; `lib/errors.js` is the home | identical sites |
| G0028 | G0031 | repeated comparison harness == 'claude-code' | 4/5/8 | **borderline** | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so cost is unclear. | lines shifted; no site inside a window hunk |
| G0029 | G0029 | repeated comparison type == 'blocks' | 3/10/12 | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. | identical sites |
| G0030 | G0028 | record assembled from the same sources {token=ID.token, expiresAt=ID.expiresAt, provider=ID.provider, scope=ID.scope} | 3/3/9 | **borderline** | server.js resolver — cache tuple; follows the credential row, no separate decision | identical sites |
| G0031 | G0030 | repeated comparison enabled == 'true' | 3/3/3 | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores and rules. | identical sites |
| G0032 | G0032 | repeated comparison kind == 'recent' | 3/3/3 | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. | identical sites |
| G0035 | G0035 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | **real** | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/workspace-api-mocks.js; provider shapes differ. | identical sites |
| G0036 | G0036 | repeated comparison status == 'owner' | 4/8/8 | **borderline** | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. | identical sites |
| G0037 | G0037 | repeated comparison recommendedAction == 'defer' | 3/4/6 | **borderline** | recommend-recurse | lines shifted; no site inside a window hunk |
| G0038 | G0039 | repeated comparison status == 'ready' | 3/5/7 | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. | lines shifted; no site inside a window hunk |
| G0039 | G0040 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | **borderline** | proxy-preamble — sentinel string shared by two modules; follows the credential row | lines shifted; no site inside a window hunk |
| G0040 | G0038 | repeated comparison type == 'completed' | 5/8/10 | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate reads. | identical sites |
| G0044 | G0048 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_WORDS, [...].filter, OPAQUE_FIELDS] | 4/5/5 | **real** | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds terminal, a different rule. Home: lib/model-routing.js. | lines shifted; no site inside a window hunk |
| G0049 | G0049 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, hashState, hashContext, inputHash), 11 copies of 1-4 statements | 4/9/11 | noise | hash helpers, identical by design; now also `account-erasure.js:231` | identical sites |
| G0050 | G0050 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of 1-4 statements | 3/3/3 | noise | new only because LIN-3596 moved the mocks; same shape | identical sites |
| G0056 | G0064 | text contract marker: [failed] | 3/4/17 | **borderline** | dispatch-terminal parses / kit emits | lines shifted; no site inside a window hunk |
| G0069 | G0069 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | **borderline** | lib/agent-turn.js | identical sites |
| G0072 | G0070 | string set {'pause', 'stop'} as table-keys/or-chain/array [HALT_BANNER_WORD, HALT_MODE_LABELS] | 3/4/4 | **borderline** | runner.mjs literal mirrors HALT_MODES under a contract test (by design). Two label maps (render 'paused', dispatch 'Pause') are the unguarded copies; cost low. | identical sites |
| G0074 | G0074 | repeated comparison state == 'running' | 3/5/22 | **borderline** | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that ledger cluster is one rule. | identical sites |
| G0075 | G0076 | record assembled from the same sources {id=ID.id, body=ID.body, createdAt=ID.createdAt} | 4/5/7 | noise | comment record, three fields | identical sites |
| G0077 | G0075 | repeated comparison stateType == 'started' | 3/10/19 | **real** | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/roadmap.js. | identical sites |
| G0078 | G0078 | text contract heading: changelog | 3/4/4 | **real** | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) | identical sites |
| G0079 | G0079 | text contract heading: constraints | 3/4/4 | **real** | as G0088 | identical sites |
| G0080 | G0080 | text contract heading: open questions | 3/4/4 | **real** | as G0088 | identical sites |
| G0081 | G0081 | repeated comparison agentState == 'error' | 3/4/5 | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. | identical sites |
| G0088 | G0088 | repeated comparison state == 'done' | 3/4/5 | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. | identical sites |
| G0093 | G0091 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status, MERGED_STATUSES, ID.status] | 3/4/5 | **real** | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate | identical sites |
| G0094 | G0096 | repeated comparison type == 'text' | 3/3/5 | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. | lines shifted; no site inside a window hunk |
| G0095 | G0095 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | **borderline** | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | identical sites |
| G0100 | G0100 | text contract marker: [done] | 3/3/5 | **borderline** | `[done]` marker: the parse side (`dispatch-terminal.js`) is the authority; the kit emits it. Newly mustRule by gaining a third file | lines shifted; no site inside a window hunk |
| G0101 | G0101 | repeated comparison state == 'waiting' | 3/4/8 | **borderline** | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. | identical sites |
| G0102 | G0102 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | 3/3/3 | **borderline** | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is cheap but low value. | identical sites |
| G0107 | G0111 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. | lines shifted; no site inside a window hunk |
| G0108 | G0110 | repeated comparison provider == 'local' | 4/4/4 | **borderline** | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a documented decision. | identical sites |
| G0114 | G0113 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies of 1-4 statements | 3/3/3 | noise | escape helpers per output format | identical sites |
| G0117 | G0116 | repeated comparison kind == 'implementation' | 3/5/5 | **real** | dispatch-factory.js:812 re-inlines the kind and identifier clauses of isPilotEligible (lib/file-pointer.js), which its comment says store and recompute share. Route it through isPilotEligible. | identical sites |
| G0120 | G0118 | repeated comparison disposition == 'task-bound' | 3/3/7 | **borderline** | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one duplicated rule; cost unclear. | identical sites |
| G0124 | G0122 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | **borderline** | lib/workspace.js; `UUID_REGEX` copies 6 → 3 | identical sites |
| G0126 | G0123 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, FLOW_PRIO, pLabels] | 4/6/8 | **real** | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY_OPTION_LABELS. Home: lib/render.js. | identical sites |
| G0127 | G0124 | repeated comparison kind == 'custom' | 3/3/3 | noise | Quota count (collective store), churn filter and label suppression on 'custom' answer three different questions over different row types. | identical sites |
| G0135 | G0133 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. | identical sites |
| G0136 | G0134 | repeated comparison state == 'failed' | 3/4/7 | **borderline** | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (`plainRunState`, LIN-4106) is a run state with the same word. Two state domains share one literal; the decision that matters is `task-state.js:168`. Not a Drift finding. | identical sites |
| G0138 | G0137 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | **real** | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnendedState but not this set. Home: lib/task-state.js. | identical sites |
| G0144 | G0141 | repeated comparison status == 'done' | 3/3/5 | noise | done status literal; unrelated meanings | identical sites |
| G0145 | G0142 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | **real** | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) | identical sites |
| G0152 | G0152 | near-duplicate function buildMockRecapContext() (also: buildMockRecapContextFromFixtures, buildMockTaskContext), ~8 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | **real** | `lib/workspace-api-mocks.js` `buildMockRecapContext` | identical sites |
| G0153 | G0153 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | **real** | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mocks.js. Pairs with G0035. | identical sites |
| G0155 | G0155 | repeated comparison category == 'auth' | 4/4/4 | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. | identical sites |
| G0158 | G0157 | repeated comparison phase == 'result' | 3/3/3 | noise | phase literal in one module | identical sites |
| G0160 | G0159 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, parseRecommendedAction, parseDeferTo, parseWhyNow), 6 copies of 1-4 statements | 4/4/6 | noise | small parse helpers, coincidental similarity | identical sites |
| G0167 | G0166 | repeated comparison state == 'needs-you' | 3/3/6 | **real** | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-state text or lists. Home: lib/task-state.js. | identical sites |
| G0168 | G0167 | repeated comparison state == 'queued' | 3/3/7 | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. | identical sites |
| G0169 | G0168 | repeated comparison waitingFor == 'ruling' | 3/3/7 | **borderline** | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. | identical sites |
| G0170 | G0169 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbor), 3 copies of 1-4 statements | 3/3/3 | noise | Three ref projections returning different fields under different names. Not one decision. | identical sites |
| G0177 | G0175 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) | identical sites |
| G0179 | G0174 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim, stripCodeBlockFences), 3 copies of 1-4 statements | 3/3/3 | noise | string cleanup helpers, coincidental | identical sites |
| G0205 | G0201 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_VARIANTS, ID.variant] | 3/3/3 | **borderline** | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it | identical sites |
| G0216 | G0214 | repeated comparison variant == 'stepper' | 3/3/3 | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. | identical sites |
| G0220 | G0220 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started', 'unstarted'} as ternary-chain/table-keys/switch/array [SEGMENT_RANK, m, SEG] | 3/5/11 | **real** | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` | identical sites |
| G0221 | G0221 | repeated comparison state == 'parked' | 3/3/3 | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. | identical sites |
| G0230 | G0230 | repeated comparison outcome == 'self-resolved' | 3/4/7 | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. | identical sites |
| G0240 | G0238 | text contract marker: [ticket-closer] | 3/4/4 | **borderline** | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. | identical sites |
| G0242 | G0242 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | noise | (`lib/workspace.js` `UUID_REGEX` exists) | identical sites |
| G0250 | G0250 | near-duplicate function find() (also: componentFind), ~9 statements, fuzzy | 3/4/4 | noise | union-find helper, generic | identical sites |
| G0251 | G0265 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-keys [eligibleStates, STATUS_RANK] | 3/4/4 | **borderline** | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps | lines shifted; no site inside a window hunk |
| G0272 | G0270 | repeated comparison kind == 'evidence' | 3/3/3 | noise | feedback kind literal | identical sites |
| G0287 | G0286 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copies of 1-4 statements | 3/3/3 | **borderline** | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolidation. | identical sites |
| G0313 | G0313 | repeated comparison harness == 'opencode' | 3/4/4 | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. | identical sites |
| G0331 | G0331 | text contract marker: [close-out-merges] | 3/3/3 | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on it. | identical sites |
| G0338 | G0338 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID.state.type] | 3/3/3 | **real** | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is gone; queue-config is the home. | identical sites |
| G0361 | G0360 | repeated comparison verdict == 'credential_dead' | 3/3/3 | **real** | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser filter. Home: lib/credential-state.js. | identical sites |
| G0386 | G0386 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Weather'} as array [VALID_SECTIONS, DESK_ORDER, DESKS] | 3/4/4 | **real** | `lib/ship-biscuit.js` `DESKS` (exported) | identical sites |
| G0387 | G0387 | named constant MS_PER_DAY=86400000 | 3/3/3 | noise | `MS_PER_DAY` constant, inert | identical sites |
| G0404 | G0403 | repeated comparison setting == 'halt' | 3/3/6 | **real** | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-change-log.js would own it. Home: lib/workspace-change-log.js. | identical sites |
| G0406 | G0405 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array/switch/or-chain/if-chain | 3/3/4 | **real** | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-chain in routes/runner-setup.js:70. Home: lib/workspace-owner.js. | identical sites |
| G0415 | G0414 | near-duplicate function stableStringify(), ~7 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | **real** | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `run-summary-cache.js:32`, `account-erasure.js:235` | identical sites |
| G0429 | G0428 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | noise | `cleanup()` per store | identical sites |
| G0433 | G0431 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. | identical sites |
| G0473 | G0473 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 copies of 1-4 statements | 3/3/3 | noise | sort comparators | identical sites |
| G0480 | G0480 | repeated comparison stateType == 'backlog' | 3/3/3 | **borderline** | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). Drift risk only. | identical sites |
| G0512 | G0512 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys [ORIENTATION_BEARINGS, BEARING_TO_ANGLE, BEARINGS] | 3/3/5 | noise | (`lib/ship-layout.js` `BEARINGS` exists) | identical sites |

## Census table groups (309; no ruling, per the method)

Full table, status against `2eb73ae0`: `_evidence-2026-11-05-drift-run4/census-table-groups-run4.tsv`. Summary: 306 unchanged, 1 new (G0113, the re-key), 1 shrunk (G0164), 1 grown (G0166). G0119 is gone (re-keyed to G0113).

## Compact trend ledger

The 11-05 ledger's 130 rows, carried under their stable names, each with a run-4 delta. Rows 131–135 are new. `_evidence-2026-11-05-drift-run4/ledger-run4.tsv` is the machine copy.

| # | finding | severity (11-05) | run 4 delta vs 11-05, and evidence |
|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged (re-measured: 2 SCCs, same members, 0 upward; +2 edges, both into lib/stage-writes.js; no cycle) |
| 2 | `provider-auth-router-upward-imports` | resolved | resolved (held) |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged (cited files 0-line diff) |
| 4 | `production-to-test-fixture-imports` | resolved | resolved (held) |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged (cited files 0-line diff) |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 7 | `provider-resolution-incantation` | low | unchanged (cited files 0-line diff) |
| 8 | `ui-divergences-registry-staleness` | low | unchanged (cited files 0-line diff) |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 12 | `target-vocabulary` | low | unchanged (touched: LINEAGE_IDENTITY_PROJECTION +followUpTo in lib/dispatch-store.js; cited decision unmoved) |
| 13 | `sse-frame-writer-duplication` | resolved | resolved (held) |
| 14 | `routes-proxy-decomposition` | — | unchanged (cited files 0-line diff) |
| 15 | `cross-repo-repo-list` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 16 | `ci-convention-split-across-repos` | informational | unchanged (cited files 0-line diff) |
| 17 | `semicolon-style-split` | low | unchanged (cited files 0-line diff) |
| 18 | `client-escape-html-duplication` | — | unchanged (cited files 0-line diff) |
| 19 | `client-shared-helper-duplication` | — | unchanged (cited files 0-line diff) |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged (touched: public/question-cards.js focus helpers; the fetch idiom is not in a hunk) |
| 21 | `linear-cli-parallel-graphql-surface` | — | unchanged (cited files 0-line diff) |
| 22 | `store-module-uniformity` | — | unchanged (cited files 0-line diff) |
| 23 | `server-side-escaping` | — | unchanged (cited files 0-line diff) |
| 24 | `dispatch-payload-centralization` | — | unchanged (touched: three run-item literals in public/prompt-section.js became runItemOf(), LIN-4293; the cited payload sites are unmoved) |
| 25 | `renderer-provider-abstraction` | — | unchanged (cited files 0-line diff) |
| 26 | `cache-module-family` | low | unchanged (cited files 0-line diff) |
| 27 | `lib-components-primitive-adoption` | — | unchanged (cited files 0-line diff) |
| 28 | `state-store-write-seam` | — | unchanged (cited files 0-line diff) |
| 29 | `phase-vocabulary-centralization` | low | unchanged (cited files 0-line diff) |
| 30 | `target-harness-axis-orthogonality` | — | unchanged (cited files 0-line diff) |
| 31 | `test-seam-separation` | — | unchanged (cited files 0-line diff) |
| 32 | `css-token-layer` | — | unchanged (cited files 0-line diff) |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged (cited files 0-line diff) |
| 35 | `run-page-identity-scrape` | medium | unchanged (cited files 0-line diff) |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged at cited sites (routes/proxy-compute.js: the /cost perDispatch flag only). One entrance field added at four call sites (`writes`, see new-row note on the stage-writes threading); the call-site census (lin-3134-declared-mint-census) guards it |
| 37 | `owner-word-collision` | low | unchanged (touched: lib/run-view.js STAGE_LABELS +2 Survey labels; the owner-word sites unmoved) |
| 38 | `run-family-render-primitives` | low | unchanged (cited files 0-line diff) |
| 39 | `persist-binding-sibling-seams` | low | unchanged (cited files 0-line diff) |
| 40 | `server-formatter-duplication` | low | unchanged (cited files 0-line diff) |
| 41 | `wake-marker-regex-copies` | resolved | resolved (held) |
| 42 | `runner-liveness-assumption` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 43 | `workspace-urlkey-consolidation` | — | unchanged (cited files 0-line diff) |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (cited files 0-line diff) |
| 45 | `keepalive-error-envelope-writer` | resolved | resolved (held) |
| 46 | `html-error-page-two-writers` | resolved | resolved (held) |
| 47 | `ai-availability-gate-duplication` | medium-low | unchanged (cited files 0-line diff) |
| 48 | `dispatch-refusal-relay-duplication` | resolved | resolved (held) |
| 49 | `tolerant-date-parse-date-twins` | resolved | resolved (held) |
| 50 | `timestamp-parse-consolidation` | — | unchanged (cited files 0-line diff) |
| 51 | `loose-json-consolidation` | — | unchanged (cited files 0-line diff) |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged (cited files 0-line diff) |
| 53 | `batch-guard-residue` | informational | unchanged (cited files 0-line diff) |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged (cited files 0-line diff) |
| 55 | `human-wait-derivation-split` | low-medium | unchanged (touched: lib/run-view.js STAGE_LABELS only; the derivation split is not in a hunk) |
| 56 | `decision-stamp-classifier-copies` | low-medium | unchanged (cited files 0-line diff) |
| 57 | `provider-write-field-contract` | low-medium | unchanged (cited files 0-line diff) |
| 58 | `close-out-merged-refusal-split` | low-medium | unchanged (cited files 0-line diff) |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged (cited files 0-line diff) |
| 60 | `consumer-liveness-signal-conflation` | resolved | resolved (held) |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 62 | `owner-answer-reader-copies` | low | unchanged (cited files 0-line diff) |
| 63 | `mock-ai-builder-copies` | low-medium | unchanged (touched: routes/proxy-compute.js /cost perDispatch and docs only; the mock-AI builder is not in a hunk) |
| 64 | `fresh-run-definition-copies` | low-medium | unchanged (touched: lib/dispatch-store.js projection +followUpTo only) |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged (cited files 0-line diff) |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged (cited files 0-line diff) |
| 67 | `csp-decision-split` | resolved | resolved (held) |
| 68 | `priority-label-maps` | low | unchanged (cited files 0-line diff) |
| 69 | `localhost-predicate-split` | low | unchanged (cited files 0-line diff) |
| 70 | `observer-instance-key-copies` | low | unchanged (cited files 0-line diff) |
| 71 | `pilot-eligibility-copies` | low | unchanged (cited files 0-line diff) |
| 72 | `linear-image-host-allowlist` | low | unchanged (cited files 0-line diff) |
| 73 | `page-chrome-options` | low | unchanged (cited files 0-line diff) |
| 74 | `ship-biscuit-desk-list` | low | unchanged (cited files 0-line diff) |
| 75 | `free-tier-rule-copies` | resolved | resolved (held) |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 77 | `census-gone-overstates-resolution` | informational | unchanged (cited files 0-line diff) |
| 78 | `follow-up-target-rule-copies` | resolved | resolved (held) |
| 79 | `lineage-row-read-copies` | low | unchanged copies; WORSENED by a contradicting comment: lib/lineage-membership.js:14-15 says readers "none re-writes" the dispatch order, but ci-wake-sweep.js:253, pipeline-loops.js:84 and pipeline-churn.js:196 keep their own sort rules (sub-item; not a new row) |
| 80 | `pr-url-regex-copies` | low | unchanged (cited files 0-line diff) |
| 81 | `pause-marker-predicate-gap` | low | unchanged (touched: lib/dispatch-store.js projection only; the pause-marker predicate is not in a hunk) |
| 82 | `review-on-record-readers` | low | unchanged (cited files 0-line diff) |
| 83 | `credential-block-grammar-split` | low | unchanged (cited files 0-line diff) |
| 84 | `review-loop-ceiling-restated` | low | unchanged (cited files 0-line diff) |
| 85 | `sweep-as-library-imports` | low | unchanged (cited files 0-line diff) |
| 86 | `github-envelope-walker-split` | low | unchanged (cited files 0-line diff) |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged (cited files 0-line diff) |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged (cited files 0-line diff) |
| 89 | `account-group-reader-copies` | low | unchanged (cited files 0-line diff) |
| 90 | `stable-stringify-copies` | low | unchanged (cited files 0-line diff) |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged (cited files 0-line diff) |
| 92 | `kit-terminal-status-copy` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 93 | `sd-parked-predicate-inline` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 94 | `https-predicate-restated` | low | unchanged (cited files 0-line diff) |
| 95 | `harbour-token-format-restated` | — | unchanged (cited files 0-line diff) |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged (cited files 0-line diff) |
| 97 | `sd-401-layers-three` | low | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged (cited files 0-line diff) |
| 99 | `vendor-script-list-restated` | low | unchanged (cited files 0-line diff) |
| 100 | `prune-to-capacity-clones` | low | unchanged (cited files 0-line diff) |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 102 | `halt-word-map-copies` | medium | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 103 | `home-next-answer-split` | medium | unchanged (cited files 0-line diff) (lib/home-view.js, lib/home-row-states.js, public/app.js untouched) |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged (no Drift-family ticket moved; 16 open as at 11-05; this run mints one new open child under LIN-3449) |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged (cited files 0-line diff) |
| 106 | `settings-preset-systems` | low-medium | unchanged (cited files 0-line diff) |
| 107 | `routes-as-library` | low-medium | unchanged (cited files 0-line diff) |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged (cited files 0-line diff) |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged (touched: prompt-section.js line numbers shifted; READY_TASK_STATE still render-task-page.js:108; takesNoRun body unmoved, now :705). Pre-existing: the started/running Go-status literals at prompt-section.js:300 and :2407 (were :286 and :2326 at 2eb73ae0) |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged (cited files 0-line diff) |
| 111 | `lineage-anchor-rules-three` | low-medium | unchanged (touched: lib/dispatch-store.js projection only; the 11-05 improvement holds) |
| 112 | `model-constants-server-client-twins` | resolved | resolved (held) |
| 113 | `low-rows-unpromoted` | low | unchanged (cited files 0-line diff) |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 115 | `usage-relay-flag-partial` | resolved | resolved (held) |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | unchanged (cited files 0-line diff) |
| 117 | `lineage-identity-read-twins` | resolved | resolved (held): the founder lookup reads the same fields; the window adds followUpTo to its projection and nothing reads it there |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 119 | `cost-fold-partition-restated` | resolved | resolved (held): countedRowsOf is still the one partition of snapshot rows. New, single-owner: dispatchesOf (lib/cost-read.js, LIN-4263) partitions records among dispatches, a different partition; the cited restatements are not repeated |
| 120 | `key-state-residue` | informational | unchanged (cited files 0-line diff) |
| 121 | `unit-census-convention-split` | informational | touched by a new sibling census (LIN-4265, tests/unit/fake-dom-census.test.js): an exact sorted-list ratchet over an AST shape. Probably a fifth allowlist shape; the 11-04 text names four without listing them, so not ruled. Count +1 |
| 122 | `usage-snapshot-prose-residue` | low | improved (small): two cited sites rewritten by LIN-4263 (lib/proxy-instructions.js dispatches prose; docs/proxy-integration.md the cumulative-snapshot sentence, now the dispatch-split sentence). The 11-05 citations lib/effort-readout.js:599 and lib/model-routing-spend.js:6,58 do not contain the word at either end (they say "[usage] telemetry", byte-identical); citation corrected |
| 123 | `completeness-precedence-restated` | borderline (not graded) | unchanged (cited cost-read.js line moved 199 -> 211 with the window insertions above it; the completeness ladder is lib/row-usage.js:116-118, not in the window) |
| 124 | `erasure-inventory-lockstep-gap` | resolved | resolved (held) |
| 125 | `parked-wait-text-cross-repo` | low-medium | unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff) |
| 126 | `error-code-case-split` | low | unchanged (touched: question-cards.js focus helpers above it; RULING_SETTLED_CODE = "ruling-settled" unmoved at :248) |
| 127 | `ruling-settled-row-predicate-inline` | low | unchanged (cited files 0-line diff) |
| 128 | `waiting-standing-comment-residue` | low | unchanged (cited files 0-line diff) (lib/waiting-section.js, lib/home-row-states.js, public/app.js untouched) |
| 129 | `request-source-guard-copies` | low | unchanged (touched: the inline loader check moved cost-read.js 147 -> 160, still inline; run-view.js:391 shifted; kpi-stats.js:1067 unmoved; no new inline copy) |
| 130 | `reply-effect-default-split` | borderline (not graded) | unchanged (touched: question-cards.js focus helpers only; the effect default at :82-89 is not in a hunk) |
| 131 | `override-kind-list-stale` | low | new (minted) \| lib/proxy-instructions.js:860 VERB OVERRIDE lists 15 of the 19 template keys the route accepts (routes/proxy-compute.js:406, `hasPrompt`); missing bug, plan-review, close-out, retrospective-audit. LIN-4248 edited the sentence (+2) without deriving it. No ticket names it (Linear searches in the report). Minted under LIN-3449. |
| 132 | `path-class-predicate-copies` | low | new (report-only) \| isTest / isDoc: one canonical home, scripts/delivery-paths.mjs (LIN-4257, extracted from delivery-composition.mjs), plus eight pre-window copies: six in scripts/survey-*.mjs (five with the same two regexes, one with an extended isDoc) and two in scripts/steady-base-*.mjs (differing isTest). The window did not touch the copies. Not minted: scripts/ tooling, no shipped behaviour, cap reached. |
| 133 | `world-helper-convention-half-guarded` | low | new (report-only) \| CLAUDE.md requires vm-over-public suites to use fake-dom.js and client-world.js (loadWorld). The census guards only the fake-DOM half. Of 68 vm-over-public suites, 64 do not use loadWorld: 25 are the census list (hand-written fakes), 1 imports fake-dom.js directly, 38 build their own non-tree document stub that the census excludes by design. Per-suite quality is Code Quality's; coverage is Test Coverage's. |
| 134 | `stage-writes-threading-per-entrance` | low | new (report-only; sub-item of 36 would also fit) \| The new `writes` value is resolved once (stageWrites) but threaded by hand at four entrance call sites (lib/dispatch-entrance.js x2, routes/workspace-api-feedback.js x2). The call-site census (tests/unit/lin-3134-declared-mint-census.test.js) guards the mint, not the field. The default is silent: an absent value is `work` (lib/proxy-preamble.js resolveWrites), so an entrance that drops the argument gets the PR-mandate block with no error; routes/collective.js:373 omits it (safe only because its kind is custom). Same shape as row 36; worsened by one field; report-only. |
| 135 | `in-progress-predicate-server-client-split` | low | new (report-only; found by the second read) \| The "in progress" rule is composed across the server/client seam. The server's `live` (lib/task-state.js sessionFactsOf) is running or queued only, by design. The client liveNow (public/prompt-section.js:726) adds `status === 'waiting'`; that literal predates the window (2eb73ae0 public/prompt-section.js:2300) and LIN-4293 moved it into InProgress.liveNow without removing it. The LIN-4293 comment "adds no rule of its own" overstates. No behaviour diverges today. Report-only: the fix is a design choice (one server flag, or one named client field). |
