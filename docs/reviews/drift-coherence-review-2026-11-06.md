# Drift & Coherence Review — 2026-11-06, run 5 (trend vs the 2026-11-05 run 4)

**Ticket:** LIN-4324. **Previous edition:** `docs/reviews/drift-coherence-review-2026-11-05-run4.md` (LIN-4299, PR #2319, merge `6c6bada5`), called **run 4** below. **Evidence:** `docs/reviews/_evidence-2026-11-06-drift/` (the `-drift` suffix: Seams run 9, LIN-4323, is live the same day and may take the plain name).

**Review-only.** This edition adds this report and its evidence folder. No code, config, guide, paper, Survey notebook, `docs/plans/survey/` file or secret was changed. The window is pinned to `af55cb73..5c63aa26`; the later main commit is reported as an addendum, not used for any figure.

## Better or worse, by area

**One line for the whole window: better, small (the same verdict as run 4).** Six production commits, 20 files, +368 / −109. Every area the window touched is better or neutral in its core decision, with one cost in the agent-facing prose (row 137) and one residue that is a sharper version of an old one (row 138).

Written from the code first. The draft is committed as `docs/reviews/_evidence-2026-11-06-drift/notes-beat1-verdicts-from-code.md` in commit `119f1b6f`, which is the first commit on this branch, before the paper or the place ledger was opened. Corrections found later are listed under "Revised after reading" below and do not edit that file.

| Area | Verdict | Evidence (code at `5c63aa26`, measured against `af55cb73`) |
|---|---|---|
| **Periodical mint and grant** (LIN-4313, LIN-4317) | **better in the rule; neutral in its inputs**, with one stale-copy cost and one open input (row 141) | One renderer: `renderPeriodicalPrompt` feeds both the nodes and the mint lane. One id lookup: `getPeriodical` (`lib/periodicals.js:1031`). The other `PERIODICALS.find` (`:1066`) matches by gate slug, a different key. One name helper, `periodicalPromptName` (`:1167`), used by `lib/render.js:660,674` and `lib/dispatch-entrance.js:2016`. One grant rule, `declaresPeriodicalGrant` (`lib/dispatch-entrance.js:1218`). It still takes two inputs. The session lane learns the variant by sniffing prompt text (`isAutopilotVariant`, `periodicals.js:1131`, read at `dispatch-entrance.js:1226-1227`), and that text is what the browser posts (`public/app.js:1620-1626`), so on that lane the grant is decided on client-composed text (row 141). The mint lane takes the route flag. The owner check at the mint remains the authority. The input is LIN-4318's. One copy predates the window: `lib/periodical-runs.js:117` builds `${t.title} + Autopilot` itself, also LIN-4318. **Cost:** the enqueue-route list is now restated in 10 prose places, 4 of them stale (row 137). |
| **DOM-access spelling in `public/`** (LIN-4292, LIN-4304) | **better** | The method-presence guards on the six scanned methods are gone and an AST scan holds the result (`tests/unit/public-element-method-guards.test.js`, allowlist of 3, stale entries fail). The scan reuses an existing shape (`no-page-wide-label-listener.test.js`), so it adds no new convention. Counts (`dom-guard-residue.txt`): the `typeof X.m === 'function'` form 13 at `af55cb73`, 10 at `5c63aa26`; the bare presence test form 40 → 1. **Residue:** the same idiom on `focus`, `setSelectionRange` and `dispatchEvent` at 8 sites outside the scan (row 138): `prompt-section.js:1053,1055,1219,1223,1856`, `question-cards.js:241-242`, `common.js:2301`. The named-idiom grep over `public/*.js` now leaves only `settings-models.js:61` (`phone.matches`, a MediaQueryList). |
| **Production code shaped for tests** (LIN-4309, LIN-4310, the LIN-4304 allowlist) | **mixed** | Better: a test-side copy of the lane template was removed (LIN-4310; the suites now use the real `laneNode`). Outlier: `public/live-console.js` now publishes two disjoint surfaces, `module.exports` (`:1361-1362`, six functions) and `window.LiveConsoleLane` (`:1367`, one function read only by tests). The canonical dual export is one `api` object published both ways (question-cards, cost-format, home-placement); the named window namespace is also canonical (17 files, research §2). The window does not make the test global canonical by assumption: row 139 is report-only. LIN-4309's production comment about the unit suite is Comprehension-Debt's, not ruled here. |
| **Client test tree** (LIN-4296, LIN-4306–4311) | **better** | Vm-over-`public/` suites that do not use `loadWorld`: **64 → 49** across the window (`client-tree-measure.txt`, same script at each end). Hand-written fakes in `HAND_WRITTEN_FAKE_DOM_FILES`: **25 → 10** (stop markers 9 → 6). The 39 own-stub suites (64 − 25 and 49 − 10) are unchanged. LIN-4306 computes the fake's consumer list from imports; it removes one hand-kept list and does not change what the census guards. Row 121: one more allowlist-shaped test, in an existing shape; the test files importing `acorn` go 5 → 6. |
| **Post-window addendum: LIN-4311** (`90542b2c`, not in the window) | **better**, after the window | Production is unchanged across `5c63aa26..90542b2c` (0 files under `lib`, `routes`, `public`, `server.js`, `scripts` or `docs/runner-prompt.md`; six test files). The same script reads 49 → 46 not on `loadWorld` and 10 → 7 hand-written fakes. Labelled "after the window" everywhere it appears. |

**Revised after reading** (the research notes' own §5, and the paper and place ledger; the beat-1 file is unchanged):

- The enqueue-route prose has **10** restatements, not 9: `docs/architecture/auth.md:236` ("enforced on the four enqueue routes (LIN-4313 adds the periodical mint)") is current and was missing from the research's list. So: 6 current, 4 stale.
- LIN-4320's acceptance grep (`three (POST|proxy|enqueue)|any of the three|four enqueue`) matches **none** of the four stale copies, so it would pass with all four still stale. The research said it would miss three of four; checked at `5c63aa26`, it misses all four.
- Row 138 (the `focus`, `setSelectionRange` and `dispatchEvent` residue) is confirmed at the same eight sites the research named, and the research's "8 sites" is the figure this review uses.

### Per-ticket agreement with the paper and the place ledger

Compared after the code verdicts above. "No reading" means the paper's Limits list the ticket as merged after `af55cb73`, and the place ledger has no row for it, so there is nothing to agree or disagree with.

- **LIN-4292** — **agree** (ledger: better, mixed alone). Code: the presence-test form drops 40 → 13 at `b389f9b0`, while the `typeof` form stays at 13. The ledger's "about 17 sites in 10 other files" uses its own pattern and is not compared number for number; the residue it names is confirmed (row 138).
- **LIN-4296** — **agree** on the census (ledger and paper: 25 → 22). Code: the count is 25 → 22 at `b581ac92`, with stop markers 9 → 6. Test-only; the selectedness rules were not re-read (Test Coverage's).
- **LIN-4304** — **agree** (ledger: better, better). Code: `typeof` form 13 → 10, presence tests 13 → 1 at `f742e5ac`. Every residue the ledger names is confirmed in code, including the same idiom on `focus` and `dispatchEvent` (row 138).
- **LIN-4292 + LIN-4304 together** — **agree** (better, better).
- **LIN-4306** — **no reading**. Code: the census count stays at 22 (`165c61e7`); the consumer list is computed from imports instead of being hand-kept.
- **LIN-4307** — **no reading**; the paper's freeze lists it as Done, and the count moves 22 → 18 at `f73f1b11`. Code: better.
- **LIN-4308** — **no reading**. Code: 18 → 15 at `3f4d4131`; the own-stub class does not move.
- **LIN-4309** — **no reading**. Code: 15 → 14 at `8b84a8fe`, plus a two-line production comment (Comprehension-Debt's matter).
- **LIN-4310** — **no reading**. Code: 14 → 10 at `ff6a69fa`, and the two-surface export outlier (row 139). Code verdict: mixed.
- **LIN-4313** — **no reading**. Code: better (one renderer, one lookup, one name helper, one grant rule). The stale prose (row 137) and the `+ Autopilot` copy at `periodical-runs.js:117` (LIN-4318) are its costs.
- **LIN-4317** — **no reading**. Code: better in the rule; the session lane's input is client-posted text, and that is row 141 (home LIN-4318).

The paper's Next 3 asks for this reading. It is given here from the code. It does not answer the paper's question on the paper's behalf, and it does not edit the paper.

## Headline

1. **Better, small.** The same verdict as run 4. Four areas moved in the same direction as before: one owner for a decision that was spread out. No `mustRule` group joined or left, the import graph gained one edge (`lib/render.js → lib/periodicals.js`), and the `res.status(` count is unchanged at 275.
2. **The top window finding is row 137, the enqueue-route list restated.** The window added a fourth enqueue mount (LIN-4313) and updated five prose copies of the route list; four still say three, including `CLAUDE.md:107`, which the agent-facing 403 table (`lib/proxy-instructions.js:1171`) and the grant table (`docs/proxy-integration.md:102`) repeat. The home is LIN-4320, which should be widened; its own acceptance grep would not catch any of the four.
3. **The cross-repo contract is unchanged by construction.** SD has 0 commits since run 4, and the runner kit, its prompt and the scripts have a 0-line diff. Every cross-repo row is unchanged. The one new cross-repo item, the `[working]` beat grammar (row 140), is unchanged and has a home (LIN-3828).
4. **The halt cold-cache row (114) is John's ruling and is not chosen here.** Unchanged in code.
5. **Follow-ups: zero new tickets.** Two existing tickets get comments: LIN-4320 (widen) and LIN-4303 (re-scope, since LIN-4304 finished its named list). Searches for each new finding are in "Considered, not minted".
6. **The instruments reproduce.** The census tool run at `af55cb73` against `2eb73ae0` gives JSON byte-equal to run 4's HEAD census. The import walker at `af55cb73` is byte-equal to run 4's graph.
7. **Second read: DISAGREE** (Tier 2, a fresh-context sub-agent). Its primary item is different from row 137: the session lane declares the dispatch grant from prompt text the browser posts (row 141, home LIN-4318). The report was revised in place. Both items are kept: row 137 is the top window-introduced change, row 141 is the larger item by consequence. See "Adversarial Second-Read" for the full answer and the checks.

## Grounding (HEADs measured)

- **LinearViewer, window end: `5c63aa261a2de891907c9b8d567f9932ed1985d0`** (LIN-4315, #2326). **`origin/main` at the time of writing: `90542b2c79016d2a1d64f75cb5d3e9037080eae7`** (LIN-4311, #2330), one commit later. The production diff between the two is 0 files (see the addendum above), so every production figure below is the same at either end.
- **The window: `af55cb73..5c63aa26`, 15 commits** (2026-11-05T19:02Z to 2026-11-06T10:56Z). The window's start is run 4's measured head, `af55cb737ec4e63919bac65558b35498ede3d290`. The ticket's own pin is kept.
- **Six production commits:** `b389f9b0` (LIN-4292), `f742e5ac` (LIN-4304), `c491eca5` (LIN-4313), `f2816e17` (LIN-4317), `8b84a8fe` (LIN-4309, +2 comment), `ff6a69fa` (LIN-4310, +4). **20 files, +368 / −109** (`git diff --shortstat af55cb73 5c63aa26 -- lib routes public server.js`). **Tests: 49 files, +2,609 / −1,230.** Docs: 472 files changed in the window, mostly the Survey notebook sync, the paper and its evidence; read for the scope audit, not as code.
- **SD: `origin/main` = `07c88f7a338b3e19a01070775e1f4d4cfc91f040`** (LIN-4233, #328). **0 commits** since run 4 measured it.
- **0-line diffs, verified by `git diff --stat af55cb73 5c63aa26`:** `scripts/code-shape/` (the census tools and the guide), `lib/runner-kit/` and `docs/runner-prompt.md`.
- **The area guide** is `scripts/code-shape/areas.json`, sha256 `e3194f52a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f`, git blob `642e9405`. It is byte-identical at both ends and to run 4's copy (`_evidence-2026-11-05-drift-run4/areas-2eb73ae0.json`, same sha). **One guide serves both runs**, and the evidence folder holds a copy (`areas-run5.json`).

**What the window's size does to confidence.** Six production commits, all of them consolidations or test-side moves, and no new decision of its own. Of run 4's 135 rows, **31 cite a file the window touched** (by name, `ledger-touch-map-run5.txt`), and row 121 is touched through a new test file its text does not name, so **32 rows are touched**. The other **103 rows** cite no touched file: "unchanged" for them is a high-confidence reading. The 32 touched rows were checked at their cited lines or against the hunks, not sampled. The window carries no information about whether anyone will act on a row.

## Findings (severity-ranked; delta vs run 4)

Citations are at `5c63aa26` (Harbour) and `07c88f7a` (SD). "Carried" rows keep their run-4 names; the compact ledger holds all 141 rows with their deltas.

| # | name | severity | delta vs run 4 | one line |
|---|---|---|---|---|
| 1 | **140** `working-beat-grammar-cross-repo` | LOW-MEDIUM | **new** (received from Comprehension-Debt run 5, R6, which rates it medium) | Harbour reads the `[working]` beat; SD writes it; neither end names the other. CD's spike: `state:'running'` is unreachable from SD's real beats. Unchanged by construction (SD 0 commits). Home LIN-3828 (Backlog, 1 comment). |
| 2 | **141** `session-lane-grant-from-client-text` | LOW-MEDIUM | **new as framed**; top by consequence (found by the second read) | The session lane declares the dispatch grant from prompt text the browser posts (`dispatch-entrance.js:1226-1227`, `isAutopilotVariant` at `periodicals.js:1131`). The mint lane takes the route flag. The owner check at the mint stays the authority, so this is a grant decided on client text, not an escalation. Home LIN-4318. |
| 3 | **137** `enqueue-route-list-restated` | LOW | **new**; top window finding | Route list restated in 10 prose places, 6 current and 4 stale (`CLAUDE.md:107`, `lib/proxy-scopes.js:23-25`, `lib/proxy-instructions.js:1171`, `docs/proxy-integration.md:102`). The window introduced the fourth mount and left those four saying three. Home: widen LIN-4320. |
| 4 | **131** `override-kind-list-stale` | LOW | unchanged | `lib/proxy-instructions.js:884` VERB OVERRIDE is not edited by the window (it moved 860 → 884). Lists 15 of the 19 template keys the route accepts. LIN-4302 (Backlog, 0 comments). |
| 5 | **135** `in-progress-predicate-server-client-split` | LOW | unchanged | `public/prompt-section.js:726` still reads `data.status === 'waiting'` beside `data.live`; the server's `live: !!held` (`lib/task-state.js:65`) excludes waiting. Moved from run 4's `:2300`, not removed. Home LIN-4256 (Backlog). |
| 6 | **138** `element-method-guard-idiom-beyond-scan` | LOW | **new** (pre-existing sites, made visible by the window's "one spelling" claim) | Eight presence guards on `focus` / `setSelectionRange` / `dispatchEvent` outside the scan's six methods. Home: LIN-4303, re-scope. |
| 7 | **136** `stage-kind-roster-tables` | LOW | **new** (received from Seams & Tangles run 8 §3, which rates it low-medium) | The `survey-place` kind tables: 13 occurrences in 9 files, joined by string keys. 7 of 8 tables are guarded by a kind loop; the unguarded one is row 131. Unchanged at both ends. No ticket names the roster; see "Considered, not minted". |
| 8 | **139** `client-dual-export-split` | LOW (borderline) | **new** (LIN-4310) | `public/live-console.js` has two disjoint export surfaces; one is a test-only window global. The canonical rule is one `api` object published both ways. Report-only: a convention outlier, not a finding that a fix is due. |
| 9 | **134** `stage-writes-threading-per-entrance` | LOW | unchanged (report-only) | `stageWrites(` call sites in `lib` and `routes`: 5 at both ends. The PM lane goes through `enqueueRow`; no new threading site. The silent default is unchanged. |
| 10 | **132** `path-class-predicate-copies` | LOW | unchanged (report-only) | `isTest` / `isDoc`: one canonical home (`scripts/delivery-paths.mjs`) and eight untouched copies in `scripts/`. |
| 11 | **133** `world-helper-convention-half-guarded` | LOW | **improved** (guarded half) | `loadWorld` half: 64 → 49 not on `loadWorld` at `5c63aa26` (46 at `90542b2c`); census 25 → 10. The 39 own-stub suites are unchanged. |
| — | `unit-census-convention-split` (row 121) | informational | **touched** (+1 census) | `tests/unit/public-element-method-guards.test.js` is an acorn AST scan with a keyed allowlist, the shape of `no-page-wide-label-listener.test.js`. Probably not a new shape. Files importing `acorn` in tests: 5 → 6. Still not ruled. |
| — | Claude model-family mirror (CD run 5, R4) | — | **unchanged** (cross-repo) | See "Cross-repo verdicts". Real; home LIN-4301. |
| — | `lineage-row-read-copies` (sub-item of row 79) | low | unchanged | The comment at `lib/lineage-membership.js:14-15` is unchanged and still wrong; the copies are unchanged. |
| — | lib import cycles and the resolved rows | as run 4 | held | Re-measured: 2 SCCs with the same members, 0 upward edges. |

**Resolved:** none new this run. **Improved:** 1 (row 133, guarded half). **Touched and unchanged:** 31 rows (see the ledger). **New:** 6 (rows 136–141). **Worsened:** none in code; row 137 is worse in the window by its own measure (four stale copies against a list that now has four routes).

Row 140 ranks first by severity and row 141 second, both LOW-MEDIUM. Row 137 ranks first among the window's LOW findings because the window made it worse and it is cheap to fix. Row 141 is the larger item by consequence (a grant decided on client-composed text), found by the second read; it is not a defect that is biting today, because the owner check at the mint is the authority.

## Cross-repo verdicts

The contract between Harbour, SD and the runner kit is in this review's remit, and no sibling review owns it. SD and the kit have 0 commits or a 0-line diff in the window, so every cross-repo row is **unchanged by construction**. The checks below are against the code as it stands at `5c63aa26` and SD `07c88f7a`, not against the docs.

| Contract | Verdict | Evidence |
|---|---|---|
| Runner contract table (run 4 counted 38 Harbour rows and 34 SD rows, and 0 usage rows) | unchanged by construction | The kit side is a 0-line diff and SD has 0 commits, so the count cannot have moved. |
| Halt, markers and the parked-wait text | unchanged | Kit 0-line diff; SD side 0 commits. Park text home LIN-2258 (Backlog). |
| Consumer heartbeat and the `[working]` beat | unchanged; row 140 | Neither end names the other; `state:'running'` still unreachable from SD's real beats (CD run 5's spike). Home LIN-3828. |
| Model / effort / harness vocabulary | unchanged | The Harbour files that hold it (`lib/model-routing-harnesses.js`, `lib/dispatch-factory.js`) are not in the window's production list; the kit and SD are 0-line / 0 commits. |
| Claude model-family mirror (`lib/model-routing-harnesses.js`, `CLAUDE_MAPPABLE_MODEL_FAMILIES` against SD's `executors.js` launch guard) | unchanged; **real**; home LIN-4301 | The "update both" warning that CD run 5 recorded as dropped is still absent: `git grep -i 'update both'` over `lib`, `routes` and `public` returns 0 hits at both ends. The mirror's own comment says it mirrors SD's guard, but not that an edit must be made in both. The fix is a comment restore, carried by LIN-4301. Recorded here as the cross-repo instance of row 137's class (a copied decision with no check), not minted again. |
| Enqueue-route list (agent-facing, in both repos' docs) | unchanged in SD; **worse** in Harbour prose | SD has no copy. Harbour's copies: row 137. |
| Per-request usage records | unchanged | Kit and SD usage files 0-line diff. Field-name pin is Drift's `usage-record-vocabulary-two-readers`, not restated here. |

## Sibling hand-offs (received, ruled, recorded)

Four items from Seams & Tangles run 8 (§3, §12) and two from Comprehension-Debt run 5 (R4, R6). Each is ruled below. None is double-flagged.

- **Seams run 8: `map:stage-kind-roster`** (Low–Medium, handed to Drift). **Carried as row 136**, rated LOW. Verified at `5c63aa26`: `git grep -l survey-place` over `lib routes public server.js` names 9 files, with 13 occurrences, the same at `af55cb73`. The window touched one of the nine (`proxy-instructions.js`, the PM catalog entry) without changing the count.
- **Seams run 8: the "Pure" wording at `lib/cost-read.js:36`** ("Pure: no store, clock or network", true only because the loader is passed in). **Not carried as a row.** It is one comment's accuracy in one file, with no second copy of the decision. The cold-reader question for a comment is Comprehension-Debt's. Recorded here so Seams and CD can see it was received.
- **Seams run 8: the stale note at `lib/home-row-states.js:121`** (the task page's read leaves the live-run guard off). **Carried as row 128** (`waiting-standing-comment-residue`), unchanged: its cited files are untouched and the note is still at `:121`.
- **Seams run 8: the "two 409 codes" and the settled-check copies** (`docs/plans/survey/place-ledger.md:91`, a Survey-document claim about LIN-4241). **Carried as rows 126 and 127**, unchanged. At `5c63aa26` the server's settled refusal is one constant, `RULING_SETTLED_REFUSAL` (`lib/ruling-settled.js`), used by `routes/dashboard-rulings.js`; the client keeps its own copy of the code string (`public/question-cards.js:250`, row 126). The "two codes" wording is the Survey's; the code has one.
- **Comprehension-Debt run 5, R6: the `[working]` grammar** (rated Medium). **Carried as row 140** at LOW-MEDIUM. The severity difference is the one place this review rates lower than CD; the reason is that the window does not touch the seam and the fix is a comment-and-test pair with a home.
- **Comprehension-Debt run 5, R4: the model-family mirror** (the dropped "update both" warning). **Ruled real, home LIN-4301**, recorded under Cross-repo verdicts. Not a new row: the list itself is unchanged, and the fix is a restored comment that LIN-4301 already carries.

Seams run 9 (LIN-4323) is in progress and has made no hand-off to Drift yet. This review did not read its worktree.

## Method and instrument

- **Census.** `scripts/code-shape/census-review.mjs`, one guide (`scripts/code-shape/areas.json`, sha256 above), scope `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'` (run 4's pattern), run from the repo root against committed objects.
  - **Reproduction, first:** `census-review.mjs . af55cb73… 2eb73ae0… --areas _evidence-2026-11-05-drift-run4/areas-2eb73ae0.json` gives JSON **byte-equal** to run 4's HEAD census (`census-repro-run4-af55cb73-vs-2eb73ae0.json` against `census-HEAD-code-af55cb73-vs-2eb73ae0-guide-2eb73ae0.json`). The instrument is unchanged. Had it not matched, the run would have stopped.
  - **This run's reading:** `5c63aa26` vs `af55cb73`. **566 / 105 / 309 / 0 unranked / 0 gone** (run 4's reading had 1 gone, G0119, which the window does not produce). `census-compare.py` against run 4's HEAD reading: **all 566 groups unchanged; 0 `mustRule` groups joined or left; 0 table groups joined or left; 105 kept, of which 87 have identical sites and 18 have shifted line numbers only.** The window added no census-visible repeated decision.
- **Rulings.** `rulings-carry-run5.py` joins the 105 `mustRule` groups to run 4's rulings on (detector, decision, file set). Carried: **34 real, 29 borderline, 42 noise**, the same as run 4. A group is flagged when a site falls inside a hunk of `git diff -U0 af55cb73 5c63aa26`. **None was flagged.** The 18 shifted groups had line numbers move with no site inside a hunk. The ruling table is below, with run-5 ids (ids shift by rank for 53 groups; the join is on content, not id).
- **Import walker.** `import-walker.mjs` (copied unchanged). Reproduced: at `af55cb73` its output is byte-equal to run 4's `import-graph-af55cb73.json`. At `5c63aa26`: **500 nodes, 2,054 static edges, 2 dynamic, the same two SCCs (6 + 6, same members), upward 0 / 0, route→route 53, parse failures 0.** The one added edge is `lib/render.js → lib/periodicals.js`.
- **`res.status(`** in `routes/` and `server.js`: **275 at `af55cb73`, 275 at `5c63aa26`** (`res-status-count-run5.txt`).
- **Client test tree cross-checks (second read).** The second read's counts reproduce on their own definitions: files referencing `loadWorld` in `tests/` 40 → 59 (`af55cb73` to `5c63aa26`), and a crude line count of `makeContainer|createElement` in `tests/unit` 495 → 506. Neither is the census measure, and the verdict does not rest on them. The census counts the files on `HAND_WRITTEN_FAKE_DOM_FILES`, not copies, so it does not show whether hand-written DOM construction disappeared outside that list; this limit is stated, not closed.
- **Client test tree.** `client-tree-measure.py` (read from git objects, no checkout). Vm-over-`public/` suites: a `tests/**/*.test.[cm]js` file that uses `vm` and mentions `public/`. Not on `loadWorld`: no `loadWorld` or `client-world` reference. Hand-written fakes: the entries in `HAND_WRITTEN_FAKE_DOM_FILES`, and their `// stop:` markers. The definition reproduces run 4's 68 / 64 at `af55cb73` exactly. Per ticket: `client-tree-by-ticket-run5.txt`.
- **DOM-guard residue.** `dom-guard-residue.sh`, two patterns over `public/` at each commit: `typeof X.m === 'function'` and a bare presence test (`X.m &&`, `||`, `?`), for a list of DOM methods that includes the six scanned by LIN-4304 plus `focus`, `setSelectionRange`, `dispatchEvent`. The per-commit counts are in `dom-guard-residue.txt`; they are pattern counts, not a count of "sites" in the ledger's sense, and are compared only by direction.
- **Touch map.** `touch-map-run5.py` (a mechanical basename match of each run-4 ledger row's cited files against the window's numstat, `window-numstat-all-run5.tsv`). Output: `ledger-touch-map-run5.txt`, 31 rows. Row 121 is added by hand (its text names no file).
- **Ledger.** `build-ledger-run5.py` carries run 4's 135 rows under their names, adds a run-5 delta column and rows 136–141. `ledger-run5.tsv` has all 135 names and all 6 new ones, each with a delta (checked by script; no name missing, no delta empty). The untouched rows default to "unchanged", except rows 1, 79, 104 and 120, which carry a re-measured note; the 32 touched rows have an explicit delta.
- **Hand-offs.** Read from the Seams run 8 report (§3, §12) and the Comprehension-Debt run 5 report (R4, R6), each checked against the code at `5c63aa26`.
- **Order of reading.** The beat-1 file was committed (`119f1b6f`) before the paper (`docs/papers/harbour/cleaner-than-it-started.md`) or the place ledger (`docs/plans/survey/place-ledger.md`) was opened, and before any instrument ran. The instruments and the ledger were committed in `c7a3444b`, after the beat-1 commit and before this report.
- **Scope audit.** Widened, not shrunk: the periodical registry as a consumer of the entrance, grant and validation decisions (rows 137, 138, the `+ Autopilot` copy); the proxy catalog, `llms.txt` and the docs as restatements of the route and grant tables (row 137); the test tree's guard and census files (row 121, the client-tree figures; the census scope itself excludes `tests/`, so the test side is read through its own guard tests); `docs/plans/survey/` as a text that cites code by line (out of scope as a drift surface: its `@sha:line` citations are immutable by design, and it is read-only here).
- **What was not done.** The test suites were not run (no code changed). The selectedness rules of `LIN-4296` were not re-read (Test Coverage's). The second read is the only check on what the research missed; its answer is recorded, not filtered.

## Follow-ups

**Minted: 0.** Every finding in this window has a live home, and row 104 records that new Drift-family tickets are not being worked (the Drift-family Backlog has not moved in several editions; all 24 carried tickets are unmoved this run).

**Comments on existing tickets (two):**

- **LIN-4320** (`CLAUDE.md:107 lists the enqueue routes without POST /periodicals/{id}/mint`). Widen it to the three copies no ticket owns: `lib/proxy-scopes.js:23-25`, `lib/proxy-instructions.js:1171` (the agent-served 403 table) and `docs/proxy-integration.md:102` (the grant table). Its acceptance grep matches none of the four stale copies (checked at `5c63aa26`), so the acceptance should be `git grep -n 'autopilot/kickoff'` over `CLAUDE.md docs lib routes public/llms.txt` with each hit either naming all four mounts or pointing at `docs/proxy-integration.md`. The research's "who carries" lists are not re-checked here. *Unvalidated idea:* a test that reads each route list against the `requireGrant('dispatch')` mounts; the grant sweep already enumerates them.
- **LIN-4303** (`Remove the remaining DOM method-presence guards in public/`). LIN-4304 removed its named list (the named-idiom grep leaves only `phone.matches`, a MediaQueryList). The residue is the eight `focus` / `setSelectionRange` / `dispatchEvent` sites (row 138). *Re-scope* to those, or close it and fold them in under LIN-4304's scan. *Unvalidated idea:* add the three methods to the scan's method set, which would make the scan hold them with the same allowlist shape.

**Considered, not minted:**

- **Row 137**, the enqueue-route prose. Home **LIN-4320**. Searches: `enqueue routes dispatch grant`, `four enqueue mounts`, `enqueue route list` (all return LIN-4320). Related, not the same: LIN-3609 (five enqueue callers outside the dispatch entrance make row, mint and base-URL decisions: a decision split, not prose), LIN-3909 (move two enqueue functions out of `routes/workspace-api-feedback.js`: a location), LIN-3607 (launch arms mint without a declared grant: a behaviour).
- **Row 138**, residual `public/` guards. Home **LIN-4303** (re-scope). Searches: `method-presence guard focus` (returns LIN-4303, LIN-4292, LIN-4304).
- **Row 139**, the `live-console.js` dual export. Searches: `LiveConsoleLane` (returns LIN-4310, which added it, and LIN-4324 itself). Not minted: the canonical rule is a convention choice with no behaviour at stake, and the outlier is one file. Re-raise on a second outlier.
- **Row 136**, the stage-kind roster. Searches: `stage kind roster`, `per-kind tables` (return LIN-4298 and LIN-4299, both Done, which handed it on, and LIN-4323, Seams run 9, in progress). Not minted: it has no fix that is not a redesign of the kind tables, and the Drift home is this ledger. A ticket with no fix would be a Backlog item nobody works.
- **Row 140**, the `[working]` grammar. Search: `working beat` returns **LIN-3828** (Backlog, 1 comment). Home. Recorded there by CD run 5 as a comment, not minted.
- **Hand-listed grant mounts and the `declaration` literal** (second read's runner-up). The same class as row 137 (lists restated in code, held in place by a census test). The census owners are LIN-3134 and LIN-3136 (Done). Cross-linked; not a new Drift finding.
- **Row 131**, VERB OVERRIDE. Home **LIN-4302** (Backlog, 0 comments), minted by run 4.
- **Row 135**, the in-progress predicate. Home **LIN-4256** (Backlog).
- **Row 132**, the path-class copies: repo tooling with no shipped behaviour; report-only.
- **Row 133**, the `loadWorld` half: a guard for it would be new tooling, which this review does not introduce; the cheap path is tracked by LIN-4297 and LIN-4289.
- **Row 134**, `stageWrites` threading: a designed default, guarded for the mint; report-only.
- **The family mirror** (CD R4). Home **LIN-4301** (Backlog). Search: `CLAUDE_MAPPABLE_MODEL_FAMILIES update both` returns no ticket naming the warning; LIN-4301's title ("restore the dropped C…") is its home.
- **Row 141** (the session-lane grant on client text). Home **LIN-4318**, which already reads "no grant decision reads prompt text". Search `periodical grant prompt text` returns it. A comment with the trust point was added to LIN-4318, and no ticket was minted.
- **"Pure: no store, clock or network"** (`lib/cost-read.js:36`). Search: `Pure no store clock` returns no ticket. Not carried (see the hand-offs).

Searches also run, for the record: `VERB OVERRIDE` (LIN-4302), `DISPATCH_GRANT_REQUIRED` (LIN-3136, LIN-3607 and LIN-4320 among the hits), `setSelectionRange` (no finding ticket), `periodical grant prompt text` (LIN-4318, LIN-4313, LIN-4317).

**Comments posted on existing tickets, this run:** LIN-4320 (row 137), LIN-4303 (row 138), LIN-4318 (row 141: the session lane's grant input is client-posted text, so the fix belongs to the grant decision's owner, not the prompt-sniff).

## For John

- **Halt cold-cache, row 114 (LIN-4210 / LIN-3024).** John's ruling, not chosen here. Unchanged in code this window; LIN-4210 is Backlog with 0 comments.
- **Nothing else needs a ruling.** The choices above (widen LIN-4320; re-scope LIN-4303; carry row 136 with no ticket; report row 139 without a ticket) are engineering choices and the owners' to make.

## Ticket trend

| Ticket | State (run 4) | State (run 5) | Comments (run 5) | Delta |
|---|---|---|---|---|
| LIN-4210 | Backlog | Backlog | 0 | unchanged |
| LIN-4214 | Backlog | Backlog | 1 | unchanged |
| LIN-4156 | Backlog | Backlog | 0 | unchanged |
| LIN-4157 | Backlog | Backlog | 0 | unchanged |
| LIN-4158 | Backlog | Backlog | 0 | unchanged |
| LIN-3822 | Backlog | Backlog | 3 | unchanged |
| LIN-3823 | Backlog | Backlog | 2 | unchanged |
| LIN-3835 | Backlog | Backlog | 1 | unchanged |
| LIN-3836 | Backlog | Backlog | 1 | unchanged |
| LIN-3843 | Backlog | Backlog | 1 | unchanged |
| LIN-3624 | Backlog | Backlog | 6 | unchanged |
| LIN-3636 | Backlog | Backlog | 7 | unchanged |
| LIN-3649 | Backlog | Backlog | 3 | unchanged |
| LIN-3736 | Backlog | Backlog | 3 | unchanged |
| LIN-3979 | Backlog | Backlog | 2 | unchanged |
| LIN-1496 | Backlog | Backlog | 6 | unchanged |
| LIN-3449 | Todo | Todo | 22 | unchanged (parent of LIN-4302) |
| LIN-2258 | Backlog | Backlog | 1 | unchanged |
| LIN-4235 | Backlog | Backlog | 0 | unchanged |
| LIN-4244 | Backlog | Backlog | 0 | unchanged |
| LIN-4245 | Backlog | Backlog | 0 | unchanged |
| LIN-4238 | Backlog | Backlog | 0 | unchanged |
| LIN-2739 | Backlog | Backlog | 0 | unchanged |
| LIN-4302 | Backlog (minted) | Backlog | 0 | unchanged |
| LIN-4254 | In Progress | In Progress | 12 | unchanged; the census move, piece 5 (LIN-4311) merged after the window |
| LIN-4256 | Backlog | Backlog | 1 | unchanged |
| LIN-4297 | Backlog | Backlog | 2 | unchanged |
| LIN-4289 | Backlog | Backlog | 0 | unchanged |
| LIN-4291 | Backlog | Backlog | 0 | unchanged |
| LIN-4318 | Backlog | Backlog | 0 at read; comment added by this run | the grant input's home (row 141) |
| LIN-4301 | — | Backlog | 0 | the family-mirror home (CD R4); unchanged |
| LIN-3828 | — | Backlog | 1 | the `[working]` grammar home (row 140) |
| LIN-4320 | — | Backlog | 0 at read; comment added by this run | widen (row 137) |
| LIN-4303 | — | Backlog | 0 at read; comment added by this run | re-scope (row 138) |
| LIN-4292, 4296, 4304, 4306–4311, 4313, 4317, 4315, 4293, 4299 | — | Done | as read | merged; the window's own tickets |
| LIN-4323 | — | In Progress | 1 | Seams run 9, live the same day |

Related, not re-flagged: LIN-4292 (Done), LIN-4296 (Done), LIN-4304 (Done), LIN-4256 (Backlog, the Go state), LIN-4291 (Backlog, fake-DOM sibling reads), LIN-4298 (Done, Seams run 8, which handed four items to Drift).

## Adversarial Second-Read

**Tier:** Tier 2, a fresh-context sub-agent (`general-purpose`) with no memory of this run. It was given the repository, the window `af55cb73..5c63aa26`, the definition of cross-cutting (duplication, convention fragmentation, dependency direction, the cross-repo contract), and the exclusions: no `docs/reviews/`, `docs/plans/` or `docs/papers/`, no review-named files, read-only. It did not see this report, the research notes, the beat-1 file or any Linear comment. It did not see the report's row 137.

**The question:** "What is the single largest item in this window that a cross-cutting review would miss or misfile?"

**Its answer, in full (verbatim):**

> **1. Primary: the "+ Autopilot" periodical variant is still identified by three different inputs, and on the session lane the grant follows client-posted text.**
>
> - **Session lane grant.** `declaresDispatchGrant` (`lib/dispatch-entrance.js:1226-1227`) calls `declaresPeriodicalGrant` with `autopilot: isAutopilotVariant(prompt)`. `isAutopilotVariant` (`lib/periodicals.js:1131`) is `prompt.includes(PERIODICAL_AUTOPILOT_TAIL)`. The prompt is what the browser posts: `public/app.js:1620-1626` sends `prompt`, `kind` and `periodicalId` from DOM data attributes.
> - **Mint lane grant.** The same rule takes the route flag instead (`dispatch-entrance.js:2008`).
> - **Variant name.** `periodicalPromptName` (`lib/periodicals.js:1167`) is used by `lib/render.js:660,674` and the mint row (`dispatch-entrance.js:2016`). `lib/periodical-runs.js:117` still hard-codes `` `${t.title} + Autopilot` ``. The browser's session `promptName` is read back from `.prompt-name` text (`public/app.js:1553`).
> - **Why a cross-cutting review misses it.** The LIN-4317 commit and the comment at `dispatch-entrance.js:1212-1216` call this "the one periodical grant rule". A reviewer of the entrance sees one function and stops. `lib/periodical-runs.js` is outside the window's diff. The text dependence is explicitly deferred to LIN-4318, so it reads as a pending follow-up rather than a trust-input question.
> - **Cost.** Whether the session lane declares the dispatch grant depends on whether the client echoes the server tail, while the mint lane uses a server flag. Renaming the variant suffix means editing `periodicals.js:1168` and `periodical-runs.js:117` separately.
>
> **Runner-up: production code shaped for the declared-mint census.** `LANES.periodical` keeps its `declaration` as a literal "so the census counts those literals" (`dispatch-entrance.js:866-869`). The set of dispatch-grant enqueue routes is hand-listed in several places: `requireGrant('dispatch')` at `routes/proxy-dispatch.js:252,293,310` and `routes/proxy-kickoff.js:110`, the `LANES` literals, the "four enqueue mounts" comment at `lib/proxy-scopes.js:8`, the grant section of `lib/proxy-instructions.js`, and the census test. The c491eca5 commit body lists about six lists touched for one new entrance. A review scoped to one file files this as census-test plumbing.
>
> **3. Verdict on the window**
>
> - **Periodical mint and grant: neutral.** Better: `renderPeriodicalPrompt` (`lib/periodicals.js:1150-1156`) is the one renderer for UI nodes and the mint route. Worse: the second grant input and the `periodical-runs.js` literal remain.
> - **DOM-access spelling in `public/`: better.** The guard spellings were removed (b389f9b0, f742e5ac). The remaining `typeof … === 'function'` checks are `public/close-out.js:159,161,175`, allow-listed in the AST check `tests/unit/public-element-method-guards.test.js`.
> - **Production code shaped for tests: worse.** The `declaration` literal above, and `declaresPeriodicalGrant` is exported for a direct test import (`tests/unit/lin-4317-periodical-grant-rule.test.js:12`). Counterpoint: b389f9b0 removed the method guards that existed only for test stubs.
> - **Client test tree: better on shared helpers, mixed otherwise.** Files that reference `loadWorld` rose from 40 to 59 (`git grep -l loadWorld` at af55cb73 vs 5c63aa26). A crude `makeContainer|createElement` count in `tests/unit` rose from 46 to 51, so hand-written fakes did not disappear.
>
> **4. Not checked**
>
> - The sibling `simple-dispatcher` repo, which is not in this checkout.
> - `lib/runner-kit/`: `contract.json` is unchanged in the window, and I grepped `runner.mjs` for periodical and grant terms with no hits. I did not check the contract against SD.
> - The server-side session route `routes/dispatch.js`. I inferred the client-supplied `kind`/`periodicalId` from `public/app.js` and `dispatch-entrance.js`.
> - The `lib/proxy-instructions.js` claim that a periodical kind on the proxy route is refused at kickoff.
> - `docs/` was excluded by the rules.
> - Checkout HEAD is `565b839b`, not the window end. I used `5c63aa26` throughout via explicit `git show` and `git grep`.
> - No tests were run.

**Checked by this review before it was accepted:**

- **Primary (the session-lane grant on client text): confirmed.** `lib/dispatch-entrance.js:1226-1227` (`declaresDispatchGrant`) passes `isAutopilotVariant(prompt)`; `lib/periodicals.js:1131` is `prompt.includes(PERIODICAL_AUTOPILOT_TAIL)`; `public/app.js:1620-1626` posts the rendered `prompt`, `kind` and `periodicalId`; the comment at `dispatch-entrance.js:1222-1226` says "the UI posts rendered text; LIN-4318 is the cure". The mint lane takes the route flag (`dispatch-entrance.js:2008`). The sniff is inline at `af55cb73:lib/dispatch-entrance.js:1185`. The report had named the input and filed it under LIN-4318 but had not said that the grant on that lane is decided on client-composed text. That is the miss, and it is now row 141.
- **Runner-up (hand-listed grant mounts and the `declaration` literal): the class is confirmed, the line numbers were not all re-checked.** It is the same class as row 137, a list restated in code and held in place by a census test. Its census owners are LIN-3134 and LIN-3136. Cross-linked, not a new Drift finding.
- **"The one periodical grant rule" comment, and the `periodical-runs.js:117` literal:** both confirmed in the report.
- **The client-test counts:** `loadWorld` file counts 40 → 59 reproduce. The crude `makeContainer|createElement` count is 495 → 506 as line hits, against the reader's 46 → 51 by its own method. Both are crude and neither is the census measure. The reader's point that hand-written fakes did not disappear outside the census list is a fair limit, now stated in Method.
- **DOM residue:** `public/close-out.js:159,161,175` are `typeof` checks inside the six-method scan's allowlist for `close-out.js`, so they are not row 138's residue. Consistent with the report.
- **Window verdicts:** the mint and grant area is re-graded from "better" to "better in the rule; neutral in its inputs" in the table above.

**Verdict: DISAGREE.** The reader's primary item is not the report's top finding. It is the session-lane grant input, which the report named and filed under LIN-4318 as a pending follow-up, without saying that the grant on that lane is decided on client-composed text.

**Differed from top finding: YES.** The report's top window-introduced finding is row 137 (the enqueue-route prose). The reader's answer is row 141 (the grant's trust input). Both are kept. Row 137 is the top change the window introduced; row 141 is the larger item by consequence, and it is now listed second among the LOW-MEDIUM rows.

**Disposition: fixed in place.** The report now states the client-text input and its consequence, grades the mint and grant area as "better in the rule; neutral in its inputs", adds ledger row 141 with LIN-4318 as its home, and records the runner-up as cross-linked to row 137's class. A comment with the trust point is on LIN-4318, the existing home, so no ticket was minted. The choice of input is LIN-4318's own scope. The owner check at the mint is the authority, so the item does not need John's ruling and is not an escalation to a person.

**Adversarial second-read verdict:** DISAGREE (Tier 2, fresh-context sub-agent). Differed from top finding: YES. Disposition: fixed in place.

## Census ruling table (the 105 `mustRule` groups, run-5 reading)

Counts: 34 real, 29 borderline, 42 noise. The same as run 4. Rulings carry from run 4 on the join (detector, decision, file set). **None was flagged** for re-read: no site falls in a window hunk. The reasons are carried as written in run 4, which also means they are not re-argued here. The ids are run 5's; the run-4 id is in the second column.

| id (run 5) | run-4 id | decision | a/f/s | ruling | one-line reason (carried from run 4) | basis (run 5) |
|---|---|---|---|---|---|---|
| G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/18/43 | **real** | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it never landed). | lines shifted; no site inside a window hunk |
| G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | **real** | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: findAnchorLoop plus one run-root helper. | lines shifted; no site inside a window hunk |
| G0003 | G0004 | record assembled from the same sources {id=ID.id, identifier=ID.identifier, title=ID.title} | 7/10/15 | noise | Three-field projection of differently shaped objects; no rule inside. The mock-fixture cluster is covered by G0035 and G0158. | identical sites |
| G0004 | G0006 | repeated comparison accessToken == 'test-token' | 6/8/15 | **real** | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN`), the same mock rule restated in the key-state holder. Home unchanged: `isTestToken` in `routes/workspace-api-steps.js`, belongs in `lib/`. | lines shifted; no site inside a window hunk |
| G0005 | G0003 | repeated comparison authType == 'oauth' | 4/8/12 | **real** | lib/workspace.js getBindingCallScope | identical sites |
| G0006 | G0005 | record assembled from the same sources {deployInfo=getDeployInfo(), urlKey=ID.urlKey, openRouterSource=getOpenRouterSource(), workspaces=ID.session.workspaces} | 2/13/13 | **real** | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/components/page.js should own it. | identical sites |
| G0007 | G0007 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, stripMarkdown, slugifyPeriodicalTitle, plainParagraph), 11 copies of 1-4 statements | 4/9/11 | borderline | slugifyForFilename is copied identically in lib/prompt-formatters.js, public/app.js and public/prompt-section.js; the other members are different rules. Client-side sharing cost is unclear. | identical sites |
| G0008 | G0008 | repeated comparison kind == 'wake' | 2/10/23 | **real** | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake sites are distinct filters. | lines shifted; no site inside a window hunk |
| G0009 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | noise | provider switch at the edge; each branch differs | identical sites |
| G0010 | G0010 | repeated comparison status == 'taken' | 1/9/16 | borderline | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joined predicate. One helper is cheap; benefit still unclear. | identical sites |
| G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | **real** | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recommendation-facts, proxy.js). Route them through it. | identical sites |
| G0012 | G0012 | repeated comparison scope == 'current' | 3/10/16 | **real** | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Label 'scope == current' is misleading. Home: lib/workspace.js. | identical sites |
| G0013 | G0013 | repeated comparison NODE_ENV == 'production' | 3/5/7 | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. | identical sites |
| G0014 | G0014 | repeated comparison key == 'Escape' | 1/7/10 | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-derived. | lines shifted; no site inside a window hunk |
| G0015 | G0015 | repeated comparison key == 'Enter' | 1/8/12 | borderline | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards, distinct. No shared helper. | lines shifted; no site inside a window hunk |
| G0016 | G0016 | repeated comparison stopAt == 'pr' | 4/10/15 | **real** | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-derive it. | lines shifted; no site inside a window hunk |
| G0017 | G0017 | text contract marker: [blocked] | 3/7/15 | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit | lines shifted; no site inside a window hunk |
| G0018 | G0018 | repeated comparison name == 'AbortError' | 4/6/10 | noise | standard fetch-abort check | identical sites |
| G0019 | G0020 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...].some] | 4/4/8 | **real** | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entrance.js:245 is an exact-host variant. | lines shifted; no site inside a window hunk |
| G0020 | G0019 | repeated comparison provider == 'linear' | 2/4/7 | borderline | workspace-token-refresh defaultResolveExchange | identical sites |
| G0021 | G0021 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} as switch/array/or-chain [ID.provider, KNOWN_SOURCES, REGISTRY_PROVIDERS] | 3/4/4 | borderline | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW | identical sites |
| G0022 | G0022 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [months, MONTHS, FLOW_MONTHS] | 4/6/7 | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. | lines shifted; no site inside a window hunk |
| G0023 | G0023 | text contract marker: [evidence] | 5/6/9 | **real** | session-telemetry EVIDENCE_PREFIX | identical sites |
| G0024 | G0024 | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-alive", Content-Type="text/event-stream"} | 2/5/7 | **real** | lib/http-keepalive.js | identical sites |
| G0025 | G0025 | record assembled from the same sources {code=ID.code, category=ID.category, retryable=ID.retryable} | 4/7/8 | **real** | lib/errors.js — refusal envelope; `lib/errors.js` is the home | lines shifted; no site inside a window hunk |
| G0028 | G0029 | repeated comparison type == 'blocks' | 3/10/12 | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. | identical sites |
| G0029 | G0028 | repeated comparison harness == 'claude-code' | 4/5/8 | borderline | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so cost is unclear. | identical sites |
| G0030 | G0030 | record assembled from the same sources {token=ID.token, expiresAt=ID.expiresAt, provider=ID.provider, scope=ID.scope} | 3/3/9 | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision | identical sites |
| G0031 | G0031 | repeated comparison enabled == 'true' | 3/3/3 | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores and rules. | identical sites |
| G0032 | G0032 | repeated comparison kind == 'recent' | 3/3/3 | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. | identical sites |
| G0035 | G0035 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | **real** | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/workspace-api-mocks.js; provider shapes differ. | identical sites |
| G0036 | G0036 | repeated comparison status == 'owner' | 4/8/8 | borderline | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. | identical sites |
| G0037 | G0037 | repeated comparison recommendedAction == 'defer' | 3/4/6 | borderline | recommend-recurse | lines shifted; no site inside a window hunk |
| G0038 | G0038 | repeated comparison status == 'ready' | 3/5/7 | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. | identical sites |
| G0039 | G0039 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row | identical sites |
| G0040 | G0040 | repeated comparison type == 'completed' | 5/8/10 | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate reads. | identical sites |
| G0041 | G0044 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_WORDS, [...].filter, OPAQUE_FIELDS] | 4/5/5 | **real** | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds terminal, a different rule. Home: lib/model-routing.js. | lines shifted; no site inside a window hunk |
| G0049 | G0049 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, hashState, hashContext, inputHash), 11 copies of 1-4 statements | 4/9/11 | noise | hash helpers, identical by design; now also `account-erasure.js:231` | identical sites |
| G0050 | G0050 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of 1-4 statements | 3/3/3 | noise | new only because LIN-3596 moved the mocks; same shape | identical sites |
| G0051 | G0056 | text contract marker: [failed] | 3/4/17 | borderline | dispatch-terminal parses / kit emits | lines shifted; no site inside a window hunk |
| G0068 | G0069 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | borderline | lib/agent-turn.js | identical sites |
| G0072 | G0072 | string set {'pause', 'stop'} as table-keys/or-chain/array [HALT_BANNER_WORD, HALT_MODE_LABELS] | 3/4/4 | borderline | runner.mjs literal mirrors HALT_MODES under a contract test (by design). Two label maps (render 'paused', dispatch 'Pause') are the unguarded copies; cost low. | lines shifted; no site inside a window hunk |
| G0075 | G0074 | repeated comparison state == 'running' | 3/5/22 | borderline | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that ledger cluster is one rule. | identical sites |
| G0076 | G0075 | record assembled from the same sources {id=ID.id, body=ID.body, createdAt=ID.createdAt} | 4/5/7 | noise | comment record, three fields | identical sites |
| G0077 | G0077 | repeated comparison stateType == 'started' | 3/10/19 | **real** | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/roadmap.js. | identical sites |
| G0078 | G0078 | text contract heading: changelog | 3/4/4 | **real** | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) | identical sites |
| G0079 | G0079 | text contract heading: constraints | 3/4/4 | **real** | as G0088 | identical sites |
| G0080 | G0080 | text contract heading: open questions | 3/4/4 | **real** | as G0088 | identical sites |
| G0082 | G0081 | repeated comparison agentState == 'error' | 3/4/5 | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. | identical sites |
| G0088 | G0088 | repeated comparison state == 'done' | 3/4/5 | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. | identical sites |
| G0092 | G0093 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status, MERGED_STATUSES, ID.status] | 3/4/5 | **real** | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate | identical sites |
| G0093 | G0094 | repeated comparison type == 'text' | 3/3/5 | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. | identical sites |
| G0095 | G0095 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) | identical sites |
| G0099 | G0100 | text contract marker: [done] | 3/3/5 | borderline | `[done]` marker: the parse side (`dispatch-terminal.js`) is the authority; the kit emits it. Newly mustRule by gaining a third file | lines shifted; no site inside a window hunk |
| G0102 | G0102 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Sep] | 3/3/3 | borderline | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is cheap but low value. | lines shifted; no site inside a window hunk |
| G0103 | G0101 | repeated comparison state == 'waiting' | 3/4/8 | borderline | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. | identical sites |
| G0106 | G0107 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. | identical sites |
| G0115 | G0108 | repeated comparison provider == 'local' | 4/4/4 | borderline | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a documented decision. | identical sites |
| G0116 | G0114 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies of 1-4 statements | 3/3/3 | noise | escape helpers per output format | identical sites |
| G0120 | G0117 | repeated comparison kind == 'implementation' | 3/5/5 | **real** | dispatch-factory.js:812 re-inlines the kind and identifier clauses of isPilotEligible (lib/file-pointer.js), which its comment says store and recompute share. Route it through isPilotEligible. | identical sites |
| G0123 | G0120 | repeated comparison disposition == 'task-bound' | 3/3/7 | borderline | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one duplicated rule; cost unclear. | identical sites |
| G0125 | G0126 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, FLOW_PRIO, pLabels] | 4/6/8 | **real** | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY_OPTION_LABELS. Home: lib/render.js. | identical sites |
| G0126 | G0124 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | borderline | lib/workspace.js; `UUID_REGEX` copies 6 → 3 | identical sites |
| G0129 | G0127 | repeated comparison kind == 'custom' | 3/3/3 | noise | Quota count (collective store), churn filter and label suppression on 'custom' answer three different questions over different row types. | identical sites |
| G0135 | G0135 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. | identical sites |
| G0136 | G0136 | repeated comparison state == 'failed' | 3/4/7 | borderline | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (`plainRunState`, LIN-4106) is a run state with the same word. Two state domains share one literal; the decision that matters is `task-state.js:168`. Not a Drift finding. | identical sites |
| G0139 | G0138 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | **real** | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnendedState but not this set. Home: lib/task-state.js. | identical sites |
| G0140 | G0144 | repeated comparison status == 'done' | 3/3/5 | noise | done status literal; unrelated meanings | identical sites |
| G0146 | G0145 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | **real** | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) | identical sites |
| G0151 | G0152 | near-duplicate function buildMockRecapContext() (also: buildMockRecapContextFromFixtures, buildMockTaskContext), ~8 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | **real** | `lib/workspace-api-mocks.js` `buildMockRecapContext` | identical sites |
| G0152 | G0153 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | **real** | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mocks.js. Pairs with G0035. | identical sites |
| G0154 | G0158 | repeated comparison phase == 'result' | 3/3/3 | noise | phase literal in one module | identical sites |
| G0157 | G0155 | repeated comparison category == 'auth' | 4/4/4 | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. | identical sites |
| G0166 | G0160 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, parseRecommendedAction, parseDeferTo, parseWhyNow), 6 copies of 1-4 statements | 4/4/6 | noise | small parse helpers, coincidental similarity | identical sites |
| G0168 | G0167 | repeated comparison state == 'needs-you' | 3/3/6 | **real** | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-state text or lists. Home: lib/task-state.js. | identical sites |
| G0169 | G0168 | repeated comparison state == 'queued' | 3/3/7 | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. | identical sites |
| G0170 | G0169 | repeated comparison waitingFor == 'ruling' | 3/3/7 | borderline | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. | identical sites |
| G0171 | G0170 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbor), 3 copies of 1-4 statements | 3/3/3 | noise | Three ref projections returning different fields under different names. Not one decision. | identical sites |
| G0177 | G0177 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) | identical sites |
| G0183 | G0179 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim, stripCodeBlockFences), 3 copies of 1-4 statements | 3/3/3 | noise | string cleanup helpers, coincidental | identical sites |
| G0198 | G0205 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_VARIANTS, ID.variant] | 3/3/3 | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it | identical sites |
| G0216 | G0216 | repeated comparison variant == 'stepper' | 3/3/3 | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. | identical sites |
| G0220 | G0220 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started', 'unstarted'} as ternary-chain/table-keys/switch/array [SEGMENT_RANK, m, SEG] | 3/5/11 | **real** | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` | identical sites |
| G0221 | G0221 | repeated comparison state == 'parked' | 3/3/3 | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. | identical sites |
| G0230 | G0230 | repeated comparison outcome == 'self-resolved' | 3/4/7 | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. | identical sites |
| G0239 | G0240 | text contract marker: [ticket-closer] | 3/4/4 | borderline | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. | identical sites |
| G0249 | G0250 | near-duplicate function find() (also: componentFind), ~9 statements, fuzzy | 3/4/4 | noise | union-find helper, generic | identical sites |
| G0250 | G0251 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-keys [eligibleStates, STATUS_RANK] | 3/4/4 | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps | identical sites |
| G0251 | G0242 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i | 3/3/3 | noise | (`lib/workspace.js` `UUID_REGEX` exists) | identical sites |
| G0277 | G0272 | repeated comparison kind == 'evidence' | 3/3/3 | noise | feedback kind literal | lines shifted; no site inside a window hunk |
| G0286 | G0287 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copies of 1-4 statements | 3/3/3 | borderline | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolidation. | identical sites |
| G0320 | G0313 | repeated comparison harness == 'opencode' | 3/4/4 | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. | identical sites |
| G0331 | G0331 | text contract marker: [close-out-merges] | 3/3/3 | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on it. | identical sites |
| G0339 | G0338 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID.state.type] | 3/3/3 | **real** | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is gone; queue-config is the home. | identical sites |
| G0361 | G0361 | repeated comparison verdict == 'credential_dead' | 3/3/3 | **real** | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser filter. Home: lib/credential-state.js. | identical sites |
| G0376 | G0386 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Weather'} as array [VALID_SECTIONS, DESK_ORDER, DESKS] | 3/4/4 | **real** | `lib/ship-biscuit.js` `DESKS` (exported) | identical sites |
| G0387 | G0387 | named constant MS_PER_DAY=86400000 | 3/3/3 | noise | `MS_PER_DAY` constant, inert | identical sites |
| G0403 | G0404 | repeated comparison setting == 'halt' | 3/3/6 | **real** | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-change-log.js would own it. Home: lib/workspace-change-log.js. | identical sites |
| G0405 | G0406 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array/switch/or-chain/if-chain | 3/3/4 | **real** | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-chain in routes/runner-setup.js:70. Home: lib/workspace-owner.js. | identical sites |
| G0416 | G0415 | near-duplicate function stableStringify(), ~7 statements, same vocabulary (dialect copy or close variant) | 3/3/3 | **real** | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `run-summary-cache.js:32`, `account-erasure.js:235` | identical sites |
| G0429 | G0429 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | noise | `cleanup()` per store | identical sites |
| G0433 | G0433 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. | identical sites |
| G0473 | G0473 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 copies of 1-4 statements | 3/3/3 | noise | sort comparators | identical sites |
| G0479 | G0480 | repeated comparison stateType == 'backlog' | 3/3/3 | borderline | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). Drift risk only. | identical sites |
| G0512 | G0512 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys [ORIENTATION_BEARINGS, BEARING_TO_ANGLE, BEARINGS] | 3/3/5 | noise | (`lib/ship-layout.js` `BEARINGS` exists) | identical sites |

## Census table groups (309; no ruling, per the method)

The full list, with decision, files and sites, is `_evidence-2026-11-06-drift/census-table-groups-run5.tsv`. Status against run 4's reading: **309 unchanged; 0 joined; 0 left.** Table groups are not ruled, per the method.

## Compact trend ledger

Run 4's 135 rows, carried under their stable names, each with a run-5 delta, plus rows 136–141. `_evidence-2026-11-06-drift/ledger-run5.tsv` is the machine copy; `build-ledger-run5.py` produces it. A row is retired only explicitly, and none is retired in this run.

| # | finding | severity (run 4) | run 5 delta vs run 4, and evidence |
|---|---|---|---|
| 1 | `lib-import-cycles` | low-medium | unchanged (re-measured at 5c63aa26: 2 SCCs, same members, 0 upward; +1 static edge lib/render.js -> lib/periodicals.js; no cycle) |
| 2 | `provider-auth-router-upward-imports` | resolved | resolved (held) |
| 3 | `routes-error-envelope-fragmentation` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 4 | `production-to-test-fixture-imports` | resolved | resolved (held) |
| 5 | `periodical-report-filename-convention-split` | medium-low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 6 | `dispatch-kind-vocabulary-cross-repo` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 7 | `provider-resolution-incantation` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 8 | `ui-divergences-registry-staleness` | low | unchanged (touched: public/common.js, the LIN-4292/4304 guard spelling only; the cited decision is outside the hunks) |
| 9 | `simple-dispatcher-api-base-duplication` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 10 | `cross-repo-halt-vocabulary` | low-medium (sub-row) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 11 | `cross-repo-sentinel-decision-marker-vocabulary` | medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 12 | `target-vocabulary` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 13 | `sse-frame-writer-duplication` | resolved | resolved (held) |
| 14 | `routes-proxy-decomposition` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 15 | `cross-repo-repo-list` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 16 | `ci-convention-split-across-repos` | informational | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 17 | `semicolon-style-split` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 18 | `client-escape-html-duplication` | — | unchanged (touched: public/common.js, guard spelling only; the cited sites are outside the hunks) |
| 19 | `client-shared-helper-duplication` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 20 | `client-section-fetch-idiom-duplication` | — | unchanged (touched: public/question-cards.js, a comment (LIN-4309) and one guard-spelling line; the focus helper is not in a hunk) |
| 21 | `linear-cli-parallel-graphql-surface` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 22 | `store-module-uniformity` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 23 | `server-side-escaping` | — | unchanged (touched: lib/render.js +3/-2, the import and the two periodicalPromptName() calls; the cited decision is outside the hunks) |
| 24 | `dispatch-payload-centralization` | — | unchanged (touched: public/prompt-section.js, guard spelling only; the payload sites are unmoved) |
| 25 | `renderer-provider-abstraction` | — | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 26 | `cache-module-family` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 27 | `lib-components-primitive-adoption` | — | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 28 | `state-store-write-seam` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 29 | `phase-vocabulary-centralization` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 30 | `target-harness-axis-orthogonality` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 31 | `test-seam-separation` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 32 | `css-token-layer` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 33 | `runner-contract-semantics-cross-repo` | medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 34 | `connection-binding-predicate-drift` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 35 | `run-page-identity-scrape` | medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 36 | `dispatch-entrance-field-duplication` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 37 | `owner-word-collision` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 38 | `run-family-render-primitives` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 39 | `persist-binding-sibling-seams` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 40 | `server-formatter-duplication` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 41 | `wake-marker-regex-copies` | resolved | resolved (held) |
| 42 | `runner-liveness-assumption` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 43 | `workspace-urlkey-consolidation` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 44 | `credential-decision-multiplicity` | medium-high | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 45 | `keepalive-error-envelope-writer` | resolved | resolved (held) |
| 46 | `html-error-page-two-writers` | resolved | resolved (held) |
| 47 | `ai-availability-gate-duplication` | medium-low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 48 | `dispatch-refusal-relay-duplication` | resolved | resolved (held) |
| 49 | `tolerant-date-parse-date-twins` | resolved | resolved (held) |
| 50 | `timestamp-parse-consolidation` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 51 | `loose-json-consolidation` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 52 | `ai-mock-predicate-consolidation` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 53 | `batch-guard-residue` | informational | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 54 | `decision-dialect-split` | medium (sub-row) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 55 | `human-wait-derivation-split` | low-medium | unchanged (touched: public/prompt-section.js guard spelling only; the derivation split is not in a hunk) |
| 56 | `decision-stamp-classifier-copies` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 57 | `provider-write-field-contract` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 58 | `close-out-merged-refusal-split` | low-medium | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 59 | `periodic-loop-two-mechanisms` | informational | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 60 | `consumer-liveness-signal-conflation` | resolved | resolved (held) |
| 61 | `consumer-heartbeat-wire-restated` | low-medium (sub-row of 60) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 62 | `owner-answer-reader-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 63 | `mock-ai-builder-copies` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 64 | `fresh-run-definition-copies` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 65 | `terminal-loop-rule-copies` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 66 | `state-type-label-rank-maps` | low-medium | unchanged (touched: public/common.js guard spelling only; the cited decision is outside the hunks) |
| 67 | `csp-decision-split` | resolved | resolved (held) |
| 68 | `priority-label-maps` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 69 | `localhost-predicate-split` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 70 | `observer-instance-key-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 71 | `pilot-eligibility-copies` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 72 | `linear-image-host-allowlist` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 73 | `page-chrome-options` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 74 | `ship-biscuit-desk-list` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 75 | `free-tier-rule-copies` | resolved | resolved (held) |
| 76 | `sd-blocked-child-last-activity-split` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 77 | `census-gone-overstates-resolution` | informational | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 78 | `follow-up-target-rule-copies` | resolved | resolved (held) |
| 79 | `lineage-row-read-copies` | low | unchanged (cited files 0-line diff; the sub-item comment at lib/lineage-membership.js:14-15 is unchanged) |
| 80 | `pr-url-regex-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 81 | `pause-marker-predicate-gap` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 82 | `review-on-record-readers` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 83 | `credential-block-grammar-split` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 84 | `review-loop-ceiling-restated` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 85 | `sweep-as-library-imports` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 86 | `github-envelope-walker-split` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 87 | `binding-active-answer-copies` | low-medium (sub-row of 44) | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 88 | `auth-failure-answer-copies` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 89 | `account-group-reader-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 90 | `stable-stringify-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 91 | `kpi-page-twin-copies` | low-medium | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 92 | `kit-terminal-status-copy` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 93 | `sd-parked-predicate-inline` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 94 | `https-predicate-restated` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 95 | `harbour-token-format-restated` | — | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 96 | `registry-providers-restated` | low (sub-row of 44) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 97 | `sd-401-layers-three` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 98 | `expire-ownerless-has-owner-copy` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 99 | `vendor-script-list-restated` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 100 | `prune-to-capacity-clones` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 101 | `resume-model-effort-cross-repo` | medium-high | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 102 | `halt-word-map-copies` | medium | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 103 | `home-next-answer-split` | medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 104 | `coherence-loop-stalled` | medium (process) | unchanged (no Drift-family ticket moved; all 24 carried tickets unmoved; LIN-3449 Todo; this run mints no child) |
| 105 | `settings-run-setup-rebuilt` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 106 | `settings-preset-systems` | low-medium | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 107 | `routes-as-library` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 108 | `model-vocabulary-rule-copies` | low-medium | unchanged (touched: lib/render.js and public/common.js; the window hunks are the periodical name calls and guard spelling; the cited decision is outside them) |
| 109 | `task-page-state-outside-owner` | low-medium | unchanged (touched: public/prompt-section.js and public/task-page.js, guard spelling only; READY_TASK_STATE still lib/render-task-page.js:108) |
| 110 | `live-anchor-old-home-alive` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 111 | `lineage-anchor-rules-three` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 112 | `model-constants-server-client-twins` | resolved | resolved (held) |
| 113 | `low-rows-unpromoted` | low | unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks) |
| 114 | `halt-poll-cold-cache-fail-open` | medium (conditional) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 115 | `usage-relay-flag-partial` | resolved | resolved (held) |
| 116 | `usage-record-vocabulary-two-readers` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 117 | `lineage-identity-read-twins` | resolved | resolved (held) |
| 118 | `reap-window-constant-cross-repo` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 119 | `cost-fold-partition-restated` | resolved | resolved (held) |
| 120 | `key-state-residue` | informational | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 121 | `unit-census-convention-split` | informational | touched: +1 allowlist-shaped test (tests/unit/public-element-method-guards.test.js, LIN-4304: an acorn AST scan with a keyed allowlist and a stale-entry check, the shape of no-page-wide-label-listener.test.js). Files importing acorn in tests: 5 -> 6. Count +1, existing shape; still not ruled |
| 122 | `usage-snapshot-prose-residue` | low | unchanged (touched: lib/proxy-instructions.js +27/-2, the PM catalog entry and the Grants line; docs/proxy-integration.md +60/-3, the LIN-4313 mint route; the usage-prose sites are not in a hunk). Run 4's improvement holds |
| 123 | `completeness-precedence-restated` | borderline (not graded) | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 124 | `erasure-inventory-lockstep-gap` | resolved | resolved (held) |
| 125 | `parked-wait-text-cross-repo` | low-medium | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 126 | `error-code-case-split` | low | unchanged (touched: public/question-cards.js, a comment and one guard-spelling line; RULING_SETTLED_CODE now at :250, value unchanged) |
| 127 | `ruling-settled-row-predicate-inline` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 128 | `waiting-standing-comment-residue` | low | unchanged (cited production files 0-line diff; the one touched citation, tests/unit/dashboard-routes.test.js, is a LIN-4308 suite move and not the decision) |
| 129 | `request-source-guard-copies` | low | unchanged (no cited file touched in af55cb73..5c63aa26) |
| 130 | `reply-effect-default-split` | borderline (not graded) | unchanged (touched: public/question-cards.js, a comment and one guard-spelling line; the effect default is not in a hunk) |
| 131 | `override-kind-list-stale` | low | unchanged in code: lib/proxy-instructions.js VERB OVERRIDE sentence not edited (it moved 860 -> 884); the window touched only the PM catalog entry and the Grants line. LIN-4302 Backlog, 0 comments. Not a new prose copy |
| 132 | `path-class-predicate-copies` | low | new (report-only) / isTest / isDoc: one canonical home, scripts/delivery-paths.mjs (LIN-4257, extracted from delivery-composition.mjs), plus eight pre-window copies: six in scripts/survey-*.mjs (five with the same two regexes, one with an extended isDoc) and two in scripts/steady-base-*.mjs (differing isTest). The window did not touch the copies. Not minted: scripts/ tooling, no shipped behaviour, cap reached. |
| 133 | `world-helper-convention-half-guarded` | low | improved (guarded half, at 5c63aa26): vm-over-public suites not on loadWorld 64 -> 49 (46 at 90542b2c after LIN-4311); HAND_WRITTEN_FAKE_DOM_FILES 25 -> 10 (stops 9 -> 6); own-stub suites unchanged at 39 |
| 134 | `stage-writes-threading-per-entrance` | low | unchanged: stageWrites( call sites in lib and routes 5 -> 5; the PM lane goes through enqueueRow and adds no threading site; the silent default is unchanged. The window touched tests/unit/lin-3134-declared-mint-census.test.js (+14/-12, the mint census), not the decision |
| 135 | `in-progress-predicate-server-client-split` | low | unchanged: the client liveNow still reads data.status === 'waiting' (public/prompt-section.js:726, moved from run 4's :2300, not removed); lib/task-state.js:65 live: !!held unchanged; LIN-4256 Backlog |
| 136 | `stage-kind-roster-tables` | low | new (received from Seams run 8 §3, which rates it low-medium) |
| 137 | `enqueue-route-list-restated` | low | new (window-introduced; top of the window findings) |
| 138 | `element-method-guard-idiom-beyond-scan` | low | new (pre-existing sites, made visible by the one-spelling claim) |
| 139 | `client-dual-export-split` | low (borderline) | new (window-introduced, LIN-4310) |
| 141 | `session-lane-grant-from-client-text` | low-medium | new as framed (the sniff is inline at af55cb73:lib/dispatch-entrance.js:1185; LIN-4317 named and centralised it; found by the Tier-2 second read) |
| 140 | `working-beat-grammar-cross-repo` | low-medium | new (received from Comprehension-Debt run 5, R6, which rates it medium) |
