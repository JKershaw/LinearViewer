# Drift & Coherence Review — run of 2026-10-11 (trend vs 2026-09-26)

**Grounding.** Measured at `LinearViewer` `6df0fbd5ba12f05ec8931ab5e34dc9ec3c06a74c` / `simple-dispatcher` `3dc08b5b587b897fa83e4c76cbdb23cd6eec2e82`. Report-time HEADs are identical (`origin/main` re-fetched when the report was written), so **drift verdict: none** — every count below was measured at the SHAs above. The ticket-time research record (LIN-3450 comment, same SHAs) was re-verified rather than trusted: the headline counts and the Tarjan SCC walk were re-run by this stage (commands per row).

**Window since 2026-09-26** (`LinearViewer` `08257bd3` / `simple-dispatcher` `3b1e734`): **947** and **49** commits — about 1.5× the previous window in LinearViewer. `lib/*.js` 264 top-level modules, `routes/*.js` 48, `public/*.js` 39; `lib/runner-kit/` (2 files, 1,698 lines) is new. Deleted: `lib/dispatch-repo-guard.js` and `lib/workspace-repos.js` (LIN-3333), `lib/prompts/meta-prompt-template.js` (LIN-3300).

**Review-only.** No code, config, secret, or under-review doc was changed. The only artifacts are this report, its branch/PR, and the Linear updates.

**Provenance.** The 07-12 edition was never recovered; its column is `not recovered` and nothing is interpolated.

**Headline.** The window's one structural event is a **second runner implementation**: `lib/runner-kit/runner.mjs` + `broker.mjs` (LIN-3098). Harbour now has *two consumers of one wire contract owned in two repos*, and the kit does not implement SD's reactions to that contract — it already differs on halt (four ways), target, repo and marker emission, while `docs/runner-prompt.md:219` tells the person's session it follows "Simple Dispatcher's meaning". That re-grades four 09-26 rows upward and is this edition's top finding. Second, the **import graph worsened**: 3 → 4 SCCs, and the KPI and dispatch/digest clusters have **merged into one 6-member SCC**. Third, a **drifted copy of a "the ONE shared predicate"** (`activeConnectionBackedBinding`) shows that the connection cluster's consolidation landed the predicate and the guard fix in one place while three copies kept the weaker rule. The good news is real and mechanical: `workspace-urlkey` (LIN-3382) is a true retirement, `dispatch-kind-vocabulary-cross-repo` is **resolved** (SD's `NO_BOOTSTRAP_KINDS` is gone), new-file hygiene is good (8 new files adopted the error envelope from birth), and every grant/scope gate goes through `requireGrant`. **None of the standing follow-ups moved — LIN-675, LIN-2388 and LIN-2389 are still Backlog with no activity since 09-26; LIN-3339 (In Progress) has 0 commits.**

**Method notes (read before comparing counts).** (1) Counts use the 09-26 commands verbatim where one is recorded; where this edition adds a shape-based count it is labelled as such and the 09-26-command number is kept beside it for continuity. (2) *File-split attribution:* this window has **no** split artifact comparable to the 09-26 `routes/proxy.js` split — every importer delta in finding 5 is attributed to named files. (3) *Cycles:* a Tarjan SCC walk over static `import`/`export … from`/side-effect imports of `lib/`, `routes/`, `server.js` (a ~25-line scratch walker; no tooling added to the repo). It reproduces 09-26's 289-node/3-SCC baseline per the research stage and gives **377 nodes / 1,369 edges / 4 SCCs (sizes 15, 6, 2, 4)** at HEAD. (4) Runtime impact of findings 1, 4 and 12 is **code-inferred, not reproduced**; that is stated on each.

---

## Findings (severity-ranked; delta vs 2026-09-26)

### 1. `runner-contract-semantics-cross-repo` — **HIGH — NEW**

One wire contract (Harbour's dispatch queue: poll → take → feedback markers, halt flag, target, repo) now has **two runner implementations owned in two repos**, and the *meaning* of the contract is hand-kept in both. Harbour is the single authority for the **values** (`lib/workspace-halt.js` `HALT_MODES`, read via `lib/poll-halt.js` by both `routes/dispatch.js:41` and `routes/proxy-runner.js:38`); the **reactions** are copies. Cost: a change to a rule (what `stop` does to an abort; whether an unknown mode fails open; what a follow-up with no live session becomes) must be made in two repos, with no cross-repo pin — and the documentation tells the kit's user it already matches.

| decision | SD (`simple-dispatcher`) | runner kit (`lib/runner-kit/runner.mjs`) | verdict |
|---|---|---|---|
| unknown halt mode | fails **open** — only `pause`/`stop` are retained (`dispatcher.js:1652-1654`) | fails **closed** — `leave`, reason `halt:${mode}` (`runner.mjs:196`) | **diverged** |
| abort row under `stop` | processed (research-stage reading, **not independently confirmed — the second-read also could not confirm SD's side**; this stage verified only the kit side and SD's halt-stop sweep, which cancels live sessions and reuses `[aborted]`, `dispatcher.js:2023-2029`) | `stop` falls to the final `leave` (`runner.mjs:196`; only `pause` lets `item.abort` flow, `:189-190`) | **diverged** |
| stop line text | phase-based closing text (`dispatcher.js:603`; halt-stop log line `dispatcher.js:2027` carries `${session.phase}`) | `(stopped by operator)` (`runner.mjs:235`); the phrase appears nowhere in SD | **diverged** |
| `pause` + follow-up with no live session | posts `[failed] No live session to resume…` (`followup.js:40`) | resolves via `resolveFollowUp`; otherwise **leaves queued** (`runner.mjs:189-193`) | **diverged** |
| `target` | takes only `cli`/`web` (`targets.js:16-19`, `queue.js:219`) | no target filter; Harbour's runner poll is an unfiltered `listItems` (`routes/proxy-runner.js:94` → `lib/dispatch-store.js:1057`) | **diverged** (kit can take a `dash` item SD ignores — inferred from code, not reproduced) |
| `item.repo` | SD alone validates it (`dispatcher.js:159-187`, `admission.js:33-37`, terminal reject) | ignores `item.repo` entirely; Harbour's guard was deleted (LIN-3333) | **diverged** — the same item fails on SD and runs in the session's cwd on the kit |
| other row fields | `queueIfBusy`, `cascade`, `waitForFollowUps`, `subscription`, `force` acted on by SD, absent from `runner.mjs`; `harnessDecision` (`runner.mjs:120-122`) filters on a hard-coded `'claude-code'` | not read / one-value copy | **diverged** (added after second-read) |
| markers | full set incl. `[pending]`/`[decision]`/heartbeat | no `[pending]`/`[decision]`/`decision-withdrawn`/`[evidence]`/heartbeat path — a kit run **cannot raise a decision** | **diverged (capability gap)** |
| 2000-char feedback cap | truncates (`feedback.js:6`) | throws (`runner.mjs:75`); Harbour returns 400 (`dispatch-feedback-validation.js:17`) | **three treatments of one limit** |
| wake-marker regex | n/a | 3 LV copies (`run-view.js:135` ≡ `liveness-detectors.js:130`; `task-page-loader.js:60` a variant), none import the authority `dispatch-terminal.js:61` `WAKE_FEEDBACK_REGEX`; SD `feedback.js:22` cites the old line `:53` | copies, drifted citation |

* **Doc claim now false:** `docs/runner-prompt.md:219` — "Halts … are binding here, with Simple Dispatcher's meaning" — is untrue in four ways (above). The kit's own `haltAction` doc comment (`runner.mjs:181-185`) says the same. (Documentation Review owns the wording; the divergence is ours.)
* **Pins:** exactly one cross-party pin exists — `tests/unit/runner-prompt-markers.test.js` runs the kit's marker lines through Harbour's parsers. The halt pin (`tests/unit/runner-kit-helper.test.js:412-417`) checks the kit against *itself*. No test spans SD ↔ kit.
* **Liveness assumption:** `lib/liveness-detectors.js:73-88` `ACTIVE_FRESH_MS` (15 min) assumes SD's ≤10 min heartbeat cap (`:76-77`); the kit posts no heartbeats, so a long kit step can read as stalled (see finding 12). The kit's HTTP calls also have no timeout (`runner.mjs:590-602`) where SD uses 15 s.
* **Legitimate difference (not flagged):** the kit is deliberately *not* SD — it runs inside a person's existing session and has no iTerm/tmux substrate, no `harness`/`terminal` axis. Missing substrate features are not drift. The drift is where the kit claims SD's meaning and does not have it.
* **Owning ticket:** none. LIN-3074 is only the halt *copy and runbook* (and predates the kit); LIN-3213/3227 are kit polish/guard. **Follow-up minted** (see Follow-ups).

### 2. `lib-import-cycles` — **MEDIUM — WORSENED**

Tarjan SCC over 377 modules finds **4 SCCs / 27 members** (09-26: 3 SCCs; 289 nodes):

1. Provider seam, **15 members, unchanged** (own walk reproduces the member set: `providers/{index,linear,github,github-projects,jira}`, `routes/{auth,github-auth,github-projects-auth,jira-auth}`, `render`, `render-pages`, `render-settings`, `github-install-flow`, `account-conflict`, `components/navbar`).
2. **KPI + dispatch/digest clusters merged into one 6-member SCC:** `kpi-stats`, `terminal-marked-task-cost`, `weekly-budget`, `dispatch-store`, `digest-feedback`, **`milestone-funnel`**. The bridge is the new `lib/milestone-funnel.js` (LIN-2952): `kpi-stats.js:35` → `milestone-funnel.js`, and `milestone-funnel.js:36` → `dispatch-store.js` (`isFreshRun`). 09-26 listed these as two separate latent clusters; this is *new coupling*, not a count change.
3. **New 2-node:** `run-evidence.js:19` → `run-closeout-state.js` ↔ `run-closeout-state.js:21` → `run-evidence.js` (`sameHead`) (LIN-3248).
4. **New 4-node, routes only:** `routes/flight-companion.js:88` imports `shouldMockAi` from `./workspace-api.js` → `workspace-api.js:91` → `proxy.js` → `proxy.js:31` → `proxy-flight-companion.js` → `:37` → `flight-companion.js` (LIN-3370, 10-08). Root cause: `shouldMockAi` lives in a route file and has **5 byte-identical copies** (`routes/{workspace-api:116, ship-biscuit:55, workspace-api-roadmap:37, next-run:38, task-chat:56}`) — same 5 at baseline; the mock/test-mode decision is Code Quality's (hand-off), the cycle is ours.

**Latent, not live:** each of the 27 members was imported alone in a fresh `node` process (`NODE_ENV=test`) by the research stage — 27/27 loaded. Cost: a top-level peer read added to any member turns a cycle live; the 6-member SCC is now the largest in `lib/` after the provider seam. Ticket: **LIN-2388** (Backlog, unmoved) — updated with the merge.

### 3. `provider-auth-router-upward-imports` — **MEDIUM — WORSENED (edges 4 → 5; SCC 15 unchanged)**

`lib/` → `routes/` edges: the four provider index files (`lib/providers/{linear:34, github:67, github-projects:60, jira:103}` → `routes/*-auth`) plus **new `lib/render-swipe.js:23` → `routes/workspace.js` `starterSeedIssueIds`** (LIN-2944, 10-03). The new edge is not in an SCC, but it is the first non-provider upward edge: a data helper living in a route file. Watch item from 09-26 ("whether a fifth provider edge appears") resolved as a *non-provider* fifth edge. Ticket **LIN-675** (Backlog, unmoved) — updated.

### 4. `connection-binding-predicate-drift` — **MEDIUM — NEW**

`lib/connection-binding.js:50-56` `activeConnectionBackedBinding` is documented as "the ONE shared predicate". It refuses a **stale marker** (`:53` — the marker's provider no longer matches the workspace's). Three inline copies of the same lookup omit that guard:

* `lib/credential-invariant-sweep.js:37-42` (`activeConnectionId`)
* `routes/workspace-api.js:321-326` (`connectionBackedId`)
* `lib/connection-credential.js:861-865` (`adoptConnectionCredential`) — in a module that **already imports the predicate at `:41`**

The guard was added to the shared predicate (review fix `cd7b1563`) *after* the copies landed (`8adaea82`, `bd07c866`), so the copies now encode a weaker rule: given a stale marker, the shared path answers "no binding" and the copies answer from whichever binding happens to match `provider`+`scope`. A **second copied rule**: `connection-credential.js:499-502` `legacyFallbackTarget` re-implements `selectIssueSourceBinding` (`lib/workspace.js:1162-1168`), which the module imports and uses elsewhere (LIN-3282). Cost: a 3-place (+1) fix for any change to "which binding is the active one". Runtime impact **not reproduced**. Ticket: none → **follow-up minted**.

### 5. `routes-error-envelope-fragmentation` — **MEDIUM — residue WORSENED 87 → 93; adoption broadened**

09-26 command, verbatim (`grep -rnE "res\.status\(4[0-9][0-9]\)|res\.status\(5[0-9][0-9]\)" routes/*.js server.js | grep "\.json(" | grep -v routes/test.js`): **93** (re-run by this stage), up from 87 at matched SHAs; all +6 is attributable: `routes/task-chat.js` 20 → 24 (LIN-3254, a non-adopter) and new `routes/runner-kit.js` 0 → 2 (`:29`, `:36`). Importers of `lib/errors.js` (real `import … from '…errors.js'` lines): **26 → 35** — 6 routes adopted from birth (`milestone-funnel`, `proxy-alarms`, `proxy-runner`, `task-mode`, `task-page`, `task-share`), 2 new lib modules (`require-grant`, `runner-owner-gate`), and **1 genuine adoption by an existing file** (`lib/dispatch-referent-guard.js`, LIN-3186). **No file-split artifact this window** (contrast the 09-26 `proxy.js` split). Of the 12 new route files only `runner-kit.js` writes raw JSON errors; 5 are HTML-only (their HTML error-page idiom was not audited — a stated gap). Verdict: new-file hygiene is good, the legacy files keep growing the residue. The `runner-kit.js` raw errors are on the **runner-facing** surface, where the envelope is part of the cross-repo contract (finding 1).

### 6. `run-page-identity-scrape` — **MEDIUM — NEW** (owned by LIN-3349)

`public/session.js:738-742` (and `:866`) takes the issue id, identifier, urlKey and source for the run-page close-out from the first `[data-testid="session-inline-reply"][data-issue-id]` **on the page** — a neighbouring widget — rather than from what Harbour holds. The task page's equivalent was fixed to carry server-rendered `data-issue-id`/`data-source` (`lib/render-run-evidence.js:197-202`); `lib/render-session.js:725` renders the run page's box without them. The run-page copy also missed the `?source=`, check-POST source and `Content-Type` fixes `close-out.js` received, and the close-out copy exists twice (server `lib/render-run-evidence.js:224-249` vs browser `public/session.js:764-784`) with already-diverging fallback text. This is the LIN-3339 8-Oct pattern re-found on the sibling surface. Ticket **LIN-3349** (Backlog, "Rebuild the run page properly") — updated, not minted. The unchecked share `issueId` (`public/task-page.js:360-366` → `routes/task-share.js:291,301`) is a trust boundary → Security Review.

### 7. `provider-resolution-incantation` — **LOW-MEDIUM — WORSENED 17 → 18 sites (raw lines 18 → 21)**

09-26 method (`grep -rn "urlKey === urlKey" lib/ routes/ server.js`): **21** raw lines (re-run). All 17 baseline sites survive; the new site is `lib/superseded-selection.js:53` (LIN-3186). **Gauge validity:** that file's own comment (`:50-52`) says it names its variable `entry`/`candidate` *so that* the `urlkey-lookups` count pin (`tests/unit/lin-3124-pr1-count-pins.test.js:140`, regex `/w\??\.urlKey === urlKey/`, expected 16) will not count it. The repo's own pin can read green while the duplication grows; four lines at HEAD already escape it (`ws.`, `located.`, `candidate.`, `r.`) and `lib/workspace-urlkey.js:196,240,256,258` hand-roll lookups on a variable named `key`, which also escapes this review's grep. Because LIN-3449 uses this row as its gauge: **next edition keep the 09-26 command for continuity and add a shape-based count** (`.find(` over `workspaces` comparing `.urlKey`). The canonical `getWorkspaceByUrlKey(session, urlKey)` (`lib/workspace.js:1243`) still takes a session, so no array-accepting lookup exists. Ticket **LIN-2389** (Backlog, unmoved) — updated.

*Resolved sub-claim:* `workspace-urlkey` (LIN-3382) is a **real retirement** — all 7 bind arms call `deriveUrlKey`, and the per-arm `deriveGithubFreshUrlKey`/`deriveJiraUrlKey`/`slugifyName` are gone. The one residue is Linear's `org.urlKey || org.name`, still computed by callers (`routes/auth.js:215`, `lib/pat-session.js:93`).

### 8. `dispatch-entrance-field-duplication` — **MEDIUM-LOW — NEW**

The census's top coupling pairs with no import edge (`coupling --since 2026-09-26`) are `dispatch-store`/`routes/dispatch` (12), `dispatch-store`/`proxy-dispatch` (11), `dispatch`/`proxy-dispatch` (11). The decision behind them: the `maxSessionsPerTask` check is restated at `routes/dispatch.js:389`, `proxy-dispatch.js:335` and `proxy-kickoff.js:256`, plus a variant at `dispatch.js:1413` and the store's own at `dispatch-store.js:1797`; item fields are re-serialised 6× in `proxy-dispatch.js` and 4× in the store. These are *entrances* that legitimately differ (session vs proxy vs kickoff) around a rule that should not. Cost: a 3-5-place edit per cap/field change, found only by co-change history. Also from `admissions`: `lib/render.js:116-139` `buildHomePromptOpts` restates `lib/render-swipe.js:655-678` (LIN-3239 had to edit both); `run-view.js:271` restates `isStandaloneSession` though `lib/session-summary.js:49` already offers the shared predicate. No ticket; **not promoted** (LIN-3339 is the consolidation vehicle for the paper's candidates — recommended: fold this in).

### 9. Unchanged

* `production-to-test-fixture-imports` — **7** (`server.js:131-133`, `routes/workspace-api-roadmap.js:25`, `next-run.js:31`, `task-chat.js:32`, `workspace-api.js:94`). `routes/proxy.js:143` is a dynamic import and `routes/test.js` is the test harness route; counting them gives the 9-11 a rough probe reports.
* `periodical-report-filename-convention-split` — `lib/periodicals.js:881` still maps `design-review` against `design-interface-review-*` files; `source-map.md` ratifies human-readable slugs but the join is not mechanical.
* `simple-dispatcher-api-base-duplication` — SD still has 2 copies (`config.js:17`, `feedback.js:5`). The kit takes `baseUrl` from the server (single authority). Harbour's inline `${req.protocol}://${req.get('host')}` rose to 30 sites (research; 31 by this stage's looser grep).
* `sse-frame-writer-duplication` — 2 copies beside the canonical `lib/sse.js:23` (`routes/workspace-api-roadmap.js:51`, `routes/workspace-api.js:1065`). **Tracked by LIN-2663 (Backlog)**, which the 09-26 edition did not cite. Noted, not minted.

### 10. `ui-divergences-registry-staleness` — **LOW — WORSENED 9 → 10**

Native `confirm(` call sites 9 → **10**; new: `public/proxy.js:389` (runner credential revoke). Registry accuracy belongs to Documentation Review; the count is the gauge.

### 11. `dispatch-kind-vocabulary-cross-repo` — **RESOLVED**

SD's `NO_BOOTSTRAP_KINDS` was deleted by `7ca5e23` (LIN-3199); `grep NO_BOOTSTRAP_KINDS` over SD's `*.js` finds nothing. Residue: the bare `'wake'` literal — 18 lines in 10 files including the kit, with no constant (Low, rolled into finding 1's marker copies).

### 12. Low / informational, new this edition

* `owner-word-collision` — `viewerIsOwner: true` / `viewer:'owner'` hard-coded at `routes/task-page.js:85,104`, `routes/dashboard.js:1415`, `routes/workspace-api.js:4410` means "session member, not a share guest"; elsewhere "owner" is the workspace `role:'owner'` edge. The real gate is enforced at the press (`routes/dispatch.js:277`).
* `run-family-render-primitives` — `render-run-evidence.js` and `render-run-steps.js` (the 2 of 38 `render*.js` not importing `lib/components/`) hand-build pills, buttons and `<details>` (`render-run-steps.js:92,394`, `render-run-evidence.js:126,217`, `render-task-page.js:159,249,259,614`) where `renderStatusPill`/`renderButton`/`renderDisclosure` exist. Visual consequence → Design & Interface.
* `persist-binding-sibling-seams` — `lib/persist-binding.js` covers 3 GitHub sites; the same convert-then-legacy-fallback decision is written at 7 seams its own header (`:22`) names (`auth.js:309/436`, `jira-auth.js:328/700/798×2`, `account-merge.js:169`).
* `server-formatter-duplication` — `formatDuration` (`render-escalation-kpis.js:21` ≡ `render-effort-readout.js:24`), `formatUsd`/`fmtUsd` ×3, `formatElapsed` byte-identical in `public/task-page.js:184-194` ≡ `public/session.js:544-554`.
* `wake-marker-regex-copies` — see finding 1 table.
* `runner-liveness-assumption` — see finding 1; inferred, not reproduced.
* `target-vocabulary` — LV literal sites 16/8 → **17/9** by the 09-26 PCRE (new: `lib/runner-owner-gate.js:22` `RUNNER_TARGETS = ['cli','web']`, LIN-3409); `public/` 3 → 5 lines. The three disagreeing named lists persist (`routes/dispatch.js:267`, `routes/proxy.js:340`, `routes/collective.js:41`); the kit has none. Re-graded Low-medium → **Medium** because a third consumer now exists.

### 13. Clean or held

`store-module-uniformity` **32/33** (33 `lib/*-store.js`; the exception, `lib/pr-state-store.js`, is an in-process cache factory mis-named "store" — LIN-3311); `server-side-escaping` (`lib/utils/html.js` importers 46 → **55**); `lib-components-primitive-adoption` **36/38** (the 2 exceptions are the fragment modules in finding 12); `client-section-fetch-idiom-duplication` (23 `window.api` files, was 20); `dispatch-payload-centralization` (**8 sites by the 09-26 print, but that command gives 5 at baseline** — the 09-26 cell was mis-stated; held); `client-escape-html-duplication` (1 definition); `linear-cli-parallel-graphql-surface` (module absent); `cache-module-family` (7, two families); `state-store-write-seam` and `phase-vocabulary-centralization` (SD) — the new SD modules `duplicate-launch.js`, `shutdown.js`, `signal-guard.js` import from `./phases`, use no raw phase literals, and `saveStateAtomic` has no external callers; `target-harness-axis-orthogonality`; `test-seam-separation`; **grant/scope gates are clean** — every `take`/`dispatch` gate is a `requireGrant(...)` mount (`proxy-kickoff:130`, `proxy-runner:76`, `proxy-dispatch:233,713`, `proxy-runner-prompt:39`), the only `grants.includes` in production is inside `hasGrant` (`lib/proxy-scopes.js:41`), `requireWriteScope` exists once (`routes/proxy.js:636`), the runner-owner gate has 8 callers; dialect-only: `['dispatch']` literal ×4, `['cli','web']` ×3 repeating `RUNNER_TARGETS`.

**Census (repo-native tooling, as instructed).** `coherence-census.mjs admissions`: admission lines **112 → 125** (15 new, 2 gone), sync-pinning tests **21 → 34**; self-admitted copy phrases 237 → 246 (LV), 35 → 36 (SD). Four of the new admissions are real code twins (`run-view.js:271`, `dispatch-store.js:1198`, `db-indexes.js:34`, `dispatch-store.js:1697`). `mirrored`: 19 PRs in the window (9.0% of October's). TODO/FIXME added this window: **0** in both repos. **LIN-3339** (In Progress, consolidating the paper's five candidates): 0 commits; none consolidated (only the "finish first" task-address work landed — LIN-3335/3336 took `bindingScope` files from 44 to 8).

**Gaps stated.** SD-internal duplication was audited only for the three new modules and the cross-repo seams; the HTML error-page idiom of 5 HTML-only new routes was not checked; a duplicated decision living entirely among `public/` classic scripts (`window` globals) is invisible to the census and the import walk.

---

## Cross-repo contract verdicts (three parties: Harbour · SD · runner kit)

| field | verdict | delta vs 09-26 |
|---|---|---|
| halt | Harbour owns the **value**; **meaning** is two hand-kept copies (SD `halt.js:219-277` + `dispatcher.js:1654`; kit `runner.mjs:186-242`) that **differ in four ways** while docs claim parity (finding 1). Pinned only inside the kit. | Low → **High** |
| sentinel / `DECISION` / marker | Grammar split is clean producer→consumer; word vocabulary now lives in SD `hook.js:549-561` and `docs/runner-prompt.md:177-186` (the deleted `meta-prompt-template.js` held only display labels). The **kit cannot emit** `[pending]`/`[decision]`; one real cross-party pin (`runner-prompt-markers.test.js`). Wake regex ×3 un-imported copies in LV. | Low → **Medium** |
| `target` | SD `targets.js:16-19`; LV 17 literal lines / 9 files + 3 disagreeing named lists + `RUNNER_TARGETS`; kit has **no filter**, Harbour's runner poll is unfiltered. | Low-medium → **Medium** |
| `repo` | **Harbour's list is gone** (LIN-3333 deleted the guard, allowlist and `known-repos`; `repo` stored verbatim). SD alone validates (`dispatcher.js:159-187`, `admission.js:33-37`); the kit ignores `item.repo`. The 09-26 grade "deliberate, closed by LIN-2974" no longer describes the code. LIN-3347 tracks only SD's dead references. | informational → **Medium-low** |
| `kind` | **Resolved** — `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); only the `'wake'` literal remains (18 lines / 10 files, no constant). | low-medium → **resolved** |
| `terminal` | Clean. SD owns the vocabulary; Harbour and the kit treat it as opaque. | held |
| `harness` | **Kit filters on it**: `runner.mjs:120-122` `harnessDecision` leaves any item whose `harness` is not null or `RUNNER_HARNESS` (`'claude-code'`, `:58`). SD owns the axis; the kit hard-codes a one-value copy. Low (found by the second-read). | held → **low drift** |
| row fields SD acts on, kit ignores | `queueIfBusy` (`followup.js:99-108`; Harbour `routes/dispatch.js:249,349`), `cascade`, `waitForFollowUps`, `subscription`, `force`, `maxSessionsPerTask` — no occurrence in `runner.mjs`, so a kit session claims a busy-target follow-up SD would hold. Same class as the `target`/`repo` rows (finding 1). Also SD merges three halt sources (Harbour, local file, auto-pause, `halt.js:216-236`); the kit reads only Harbour's — a substrate difference, not drift. | new (second-read) |
| `effort`, `model` | Clean. Opaque on the runner side. | held |
| API base | SD 2 copies (unchanged); kit takes `baseUrl` from the server. | unchanged |
| dispatch status enum | Clean; no cross-repo copy. | held |
| liveness | `ACTIVE_FRESH_MS` assumes SD's heartbeat; kit posts none. | new (inferred) |
| CI | LV Node 20 with `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22, no aggregate. | unchanged |

---

## Sibling Hand-offs

* **Code Quality:** `shouldMockAi` ×5 byte-identical copies in route files (mock/test-mode decision; it is also the root of the new 4-node routes cycle); the runner kit's HTTP-call timeout absence (`runner.mjs:590-602`) as a robustness item.
* **Security Review:** the share-create `issueId` is parsed from the `data-state-url` query (`public/task-page.js:360-366`) and stored unchecked (`routes/task-share.js:291,301`).
* **Documentation Review:** `docs/runner-prompt.md:219` parity claim (false in four ways); SD `docs/module-map.md` — 12 unmapped modules incl. `halt.js` and `duplicate-launch.js`, and no mention of the runner kit in SD `CLAUDE.md`/`README`; stale headers `lib/connection-binding.js:9-11` ("only one module writes", but `routes/workspace-api.js:1724` also writes) and `lib/connection-store.js:1-8` ("write-only / no delete"); SD `feedback.js:22` cites `dispatch-terminal.js:53` (now `:61`); `ui-divergences.md` confirm count (10).
* **Design & Interface:** hand-built pills/buttons/details in the run/task page family (finding 12).
* **API Quality:** raw `{error}` JSON on the runner-facing `routes/runner-kit.js` (`:29`, `:36`).
* **Data & Fetch Architecture / Dependency & Supply-Chain:** nothing new.

---

## Follow-ups (highest severity only)

* **Minted: LIN-3451** — *Runner kit ↔ SD: one meaning for halt / target / repo / markers, with a cross-repo pin* (finding 1). No existing ticket covers it.
* **Minted: LIN-3452** — *Route the three inline active-binding lookups through `activeConnectionBackedBinding`* (finding 4).
* **Updated, not minted:** LIN-2388 (merged 6-member SCC, `run-evidence ↔ run-closeout-state`, the routes-only 4-cycle), LIN-675 (fifth upward edge `render-swipe.js:23`), LIN-2389 (18 sites / 21 raw lines, count-pin evasion, shape-based gauge), LIN-3349 (run-page identity scrape), LIN-2663 (SSE copies still 2).
* **Not promoted:** findings 5, 8, 10, 12 (below the top-3 cut or already vehicle-owned; finding 8 is recommended input to LIN-3339).

## Ticket trend — the promotion path is still not converting

| ticket | state at dispatch | change this window |
|---|---|---|
| LIN-675 (provider-seam SCC) | Backlog | unmoved since 09-26; the fifth upward edge appeared in the interim |
| LIN-2388 (kpi / dispatch-digest cycle) | Backlog | unmoved; the cluster it names has since **merged into a 6-member SCC** |
| LIN-2389 (urlKey lookup) | Backlog | unmoved; 17 → 18 sites; its count pin is now evaded on purpose |
| LIN-2663 (SSE writer copies) | Backlog | not cited by 09-26; copies still 2 |
| LIN-3339 (One job, many paths) | In Progress | 0 commits; none of the five candidates consolidated |
| LIN-3349 (run-page rebuild) | Backlog | owns finding 6 |
| LIN-3074 (halt copy / runbook) | Backlog | covers only the halt copy, not the four-way divergence |
| LIN-3347 (SD dead repo-guard refs) | Backlog | tracks only SD side of the repo-list change |

All three standing 06-25/08-29 follow-ups (LIN-675, 2388, 2389) have now stood unmoved across ≥ 1 further edition while the cycles they name grew. The churn went to new surfaces (947 commits); the gauge rows grew, nobody retired one. The exception that works is *birth-time* adoption: 8 new files used `lib/errors.js` and `requireGrant` from day one.

---

## Adversarial Second-Read

**Tier used: Tier 2** — a fresh-context sub-agent with no memory of the report-writing turn. (Tier 1, a separate dispatched session, was unavailable: this session's token carries no `dispatch` grant.)

**Question asked:** "What is the largest item in this window that this report missed or misfiled?" (given only the report path, both SHAs and the window bounds).

**Fields:** `Adversarial second-read verdict: AGREE` · `Differed from top finding: NO` · `Disposition: fixed in place`

**Reader's full answer (verbatim in substance):**

1. *Verdict AGREE.* Ranking and coverage hold; nothing larger than finding 1; its main claims check out against source.
2. *Differs from top finding: NO.* The largest item is still the runner kit vs SD divergence; what was found is a gap inside it.
3. *The item:* the table omits dispatch-row fields SD acts on and the kit never reads. `lib/runner-kit/runner.mjs` has no occurrence of `queueIfBusy`, `cascade`, `waitForFollowUps`, `subscription`, `force` or `maxSessionsPerTask`; SD acts on `queueIfBusy` (`followup.js:99-108`, also `dispatcher.js`/`queue.js`); Harbour accepts the fields (`routes/dispatch.js:249`) and describes `queueIfBusy` as "the runner leaves a busy-target follow-up unclaimed" (`:349`), so a kit session claims and runs such an item. Kit-only halt gap: SD merges three halt sources (Harbour, local halt file, host-wide auto-pause; `halt.js:216-236`, `dispatcher.js:1671`), the kit reads only Harbour's — not drift (no host-wide substrate) but one more way the "Simple Dispatcher's meaning" claim (`docs/runner-prompt.md:219`) does not hold.
4. *Factual errors:* (a) the `harness` row was wrong — the kit filters on it (`runner.mjs:120-122` `harnessDecision`; `RUNNER_HARNESS = 'claude-code'` at `:58`) and reads `item.model`; "opaque" was incorrect. (b) The `target` row's "unfiltered `listItems`" is indirect: `proxy-runner.js:94` calls `pollAvailable`, which `dispatch-store.js:1057` forwards to `listItems`; conclusion holds. (c) The abort-under-`stop` SD side was not verified (the reader could not confirm it either; `dispatcher.js:1750-1766` comments say the follow-up resume hold applies only under `stop` and are silent on aborts).
5. *Checked and correct:* unknown-halt fail-open vs fail-closed (`dispatcher.js:1654` / `runner.mjs:196`); the `haltAction` comment claiming SD's meaning (`:181-185`); the stale-marker guard and both copies; the `milestone-funnel` bridge edges; LIN-3135 `{itemId}` mint (no drift); `ifParked` retired consistently on both sides.

**Disposition: fixed in place.** The `harness` verdict row was corrected, the missing row-fields row was added to the finding-1 table and the contract-verdict table, the `target` citation chain was noted, and the abort-under-`stop` SD cell now says it is unconfirmed by either reader. Severity and ranking unchanged.

---

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231); every 07-12 cell is `not recovered` and no value is interpolated. Row names are stable; the 33 rows of the 09-26 ledger are carried, then new rows are appended. Severity is this run's grade.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | delta |
|---|---|---|---|---|---|---|---|
| `lib-import-cycles` | medium | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | 4 SCCs / 27 members: provider 15 + **6 (kpi + dispatch/digest merged via `milestone-funnel`)** + new `run-evidence↔run-closeout-state` + new 4-node routes cycle (latent, 27/27 load alone) | **worsened** |
| `provider-auth-router-upward-imports` | medium | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 13 (re-measured by this run at `292ac962`; not stated in the 08-29 edition) | 4 edges; **SCC 13→15** (+`github-install-flow`, +`render-settings`) | SCC 15 (unchanged); edges **4→5** (+`render-swipe.js:23`→`routes/workspace.js`) | **worsened (edge)** |
| `routes-error-envelope-fragmentation` | medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue (routes-only); `dashboard.js` half-adopter | 26 importers but **adoption flat** (11 from the `proxy.js` split); residue **76 → 87** matched-SHA; `flight-companion.js` **0 → 8** | 35 importers (no split artifact; 8 born-adopters + 1 genuine); residue **87→93** (`task-chat` +4, `runner-kit` +2) | **residue worsened; adoption broadened** |
| `production-to-test-fixture-imports` | medium-low | — | not recovered | 7 sites | 7 sites | 7 sites | unchanged |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | same (`periodicals.js:881`) | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | low-medium | — | not recovered | 3 hardcoded keys | 3-key subset | `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); bare `'wake'` literal only (18 lines / 10 files) | **resolved** |
| `provider-resolution-incantation` | low-medium | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **18 sites** (21 raw lines); new `superseded-selection.js:53` written to evade the count pin | **worsened** |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | native `confirm()` **9→10** (`proxy.js:389`) | **worsened** |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | 2 (kit takes `baseUrl` from server) | unchanged |
| `cross-repo-halt-vocabulary` | **high** | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | value single-authority; **meaning diverges 4 ways** SD↔kit; docs claim parity; LIN-3074 covers copy only | **worsened (Low→High; re-graded, kit = 3rd party)** |
| `cross-repo-sentinel-decision-marker-vocabulary` | **medium** | — | not recovered | — | grammar split clean; word vocabulary duplicated | kit cannot emit `[pending]`/`[decision]`; wake regex ×3 un-imported; 1 cross-party pin | **worsened (Low→Medium)** |
| `target-vocabulary` | **medium** | — | not recovered | — | 3 disagreeing LinearViewer lists + inline copies; SD owns runner set | LV 17 lines / 9 files (+`runner-owner-gate.js:22`); 3 lists persist; kit/Harbour poll unfiltered vs SD `cli`/`web` | **worsened** |
| `sse-frame-writer-duplication` | low | — | not recovered | — | 2 byte-identical copies of canonical `lib/sse.js:23 sendSSE` | 2 copies; **LIN-2663** tracks (not minted) | unchanged |
| `routes-proxy-decomposition` | — | — | not recovered | — | `routes/proxy.js` 7,315→1,591 lines, 11 injected sub-routers | held (`proxy.js` 11 sub-routers); no new split this window | held |
| `cross-repo-repo-list` | **medium-low** | — | not recovered | deliberate | deliberate; LIN-2974 Done | Harbour list **deleted** (LIN-3333); SD alone validates; kit ignores `item.repo`; LIN-3347 SD-side only | **worsened (informational→Medium-low; authority deleted)** |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | same (Node 20 vs 22; `ci-success` `needs:[unit,e2e,secret-scan]`) | unchanged |
| `semicolon-style-split` | low (informational) | unchanged | not recovered | unchanged | unchanged | unchanged (not re-measured; no style change observed) | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held (1 definition) | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held (`formatElapsed` pair noted under `server-formatter-duplication`) | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held (**23 files**) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held (module absent) | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | **32/33** (33 stores); 1 naming outlier `pr-state-store` | held (1 outlier) |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | clean (**55**) | reinforced |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | clean (**5** by the 09-26 command; the 09-26 "8" was mis-stated) | held (correction) |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held (not re-measured beyond provider seam) | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | clean (7, two families) | held |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | **36/38** (2 fragment modules) | held |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | clean (incl. 3 new SD modules) | held |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | clean (incl. 3 new SD modules) | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | clean | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | clean | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | sibling-owned (Design & Interface) | routed |
| `runner-contract-semantics-cross-repo` | **high** | — | not recovered | — | — | **NEW: kit re-implements SD reactions; diverged on halt ×4, target, repo, markers** | **new** |
| `connection-binding-predicate-drift` | medium | — | not recovered | — | — | shared predicate + 3 inline copies lacking stale-marker guard; +1 copied selector | **new** |
| `run-page-identity-scrape` | medium | — | not recovered | — | — | `session.js:738-742,866` task id from neighbouring widget; LIN-3349 | **new** |
| `dispatch-entrance-field-duplication` | medium-low | — | not recovered | — | — | `maxSessionsPerTask` ×5; fields re-serialised 6×/4× | **new** |
| `owner-word-collision` | low | — | not recovered | — | — | `viewerIsOwner:true` ×4 = "session member" | new |
| `run-family-render-primitives` | low | — | not recovered | — | — | 2 fragment modules hand-build pills/buttons/details | new |
| `persist-binding-sibling-seams` | low | — | not recovered | — | — | ×7 sibling seams | new |
| `server-formatter-duplication` | low | — | not recovered | — | — | `formatDuration`/`formatUsd`/`formatElapsed` copies | new |
| `wake-marker-regex-copies` | low | — | not recovered | — | — | 3 new LV copies, none import `dispatch-terminal.js:61` | new |
| `runner-liveness-assumption` | low | — | not recovered | — | — | `ACTIVE_FRESH_MS` assumes SD heartbeats; kit posts none (inferred) | new |
| `workspace-urlkey-consolidation` | — | — | not recovered | — | — | `deriveUrlKey` used by all 7 bind arms; per-arm derivations deleted (LIN-3382); Linear `org.urlKey||org.name` residue at `auth.js:215`, `pat-session.js:93` | **resolved** |

*Measured at `LinearViewer` `6df0fbd5` / `simple-dispatcher` `3dc08b5`; report-time HEADs identical. Next run: re-ground every row against HEAD, not this prose; for `provider-resolution-incantation` keep the 09-26 command **and** add the shape-based count; for `lib-import-cycles` keep the Tarjan walk. Watch items: whether the kit and SD halt/target/repo meaning converge behind one pin; whether the 6-member SCC or the new 2-/4-node cycles turn live; whether LIN-675/2388/2389/3339 move.*