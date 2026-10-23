# Integration & Surface Maturity Review — 2026-10-21

*Advisory, review-only. Periodical: **Integration & Surface Maturity** (LIN-1336). This is the
periodical's **fourth** run — a trend delta against
[`docs/reviews/integration-surface-maturity-review-2026-09-26.md`](./integration-surface-maturity-review-2026-09-26.md)
(run 3, LIN-3105; close-out `e69e2cc9`, 2026-09-27); the baseline is
[`…-2026-07-17.md`](./integration-surface-maturity-review-2026-07-17.md) (HEAD `ae00c61b7`) and run 2 is
[`…-2026-08-29.md`](./integration-surface-maturity-review-2026-08-29.md). Parent task LIN-3765; this report is
its subtask LIN-3766. It mints no code changes and no follow-up tasks or sub-issues; it hands a maintainer a
triageable maturity read framed as a **trend**, not a snapshot, and leaves the decision to them. The run date
(2026-10-21) is the date the task was minted and the plan pinned; the report was written on 2026-10-23.*

*Bulky evidence is in `docs/reviews/_evidence-2026-10-21/integration-surface-maturity/` (the folder was free at the writer's
start, so no `isml-4-*` prefix was needed): `importer-dispositions.md` (134 rows), `citation-repoints.md`
(137 groups), `rerun-outputs.md` (every bound query, SHA, timestamp and verbatim output), `summary.md`,
`c9-members.md`, `c14-members.md`.*

---

## Re-grounding (fetch, HEAD pins, drift)

`git fetch` was run in **both** repos before any comparison, at the timestamps below.

```
# at report writing
LinearViewer:      git fetch origin  ->  origin/main = 8e59ed62aa9f35cf9e99bee772c5c532805b6211   (2026-10-23T09:41:15Z)
simple-dispatcher: git fetch origin  ->  origin/main = bb1da78e29a99940dc5aa37cf7e826992db097f5   (2026-10-23T09:41:15Z)
LinearViewer:      git log --oneline c5694b68..origin/main  ->  8e59ed62 2026-10-23T09:50:04+01:00 docs/incidents: Railway security disclosure; production route via railway ssh; correct the 22 Sep record (#2034)
LinearViewer:      git diff --name-only c5694b68 origin/main -- lib routes server.js public  ->  (empty, 0 files)
LinearViewer:      git diff --name-status c5694b68 origin/main  ->  M docs/incidents/2026-09-22-harbour-db-reads-hang.md
                                                                    A docs/incidents/2026-10-22-railway-security-disclosure.md
                                                                    M docs/operator-execution.md
simple-dispatcher: git log origin/main --since=2026-10-21T10:22:07Z  ->  0 commits
LinearViewer:      git rev-list --count e69e2cc9..c5694b68  ->  1158   (577 touching lib/routes/server.js)
LinearViewer:      git rev-list --count e69e2cc9..origin/main  ->  1159
LinearViewer:      git diff --diff-filter=A --name-only e69e2cc9..origin/main -- lib routes | wc -l  ->  134
LinearViewer:      git diff --diff-filter=D --name-only e69e2cc9..origin/main -- lib routes  ->  lib/dispatch-repo-guard.js
                                                                                                lib/prompts/meta-prompt-template.js
                                                                                                lib/workspace-repos.js
simple-dispatcher: git rev-list --count 3b1e734..origin/main  ->  61   (48 non-merge)
```

Every reproducible count in the breakdown reproduces (1,158 / 134 / 3 / 61); the full outputs of the window
and bound queries, re-run at the evidence step (2026-10-21T12:02Z onward), are in `rerun-outputs.md`.

**First finding — drift from the breakdown pins: one commit, docs-only, and it matters for two surfaces.**
The breakdown pinned LinearViewer `c5694b68` and simple-dispatcher `bb1da78` with zero drift at 10:55Z on
2026-10-21. Since then LinearViewer `origin/main` moved by **one commit**, `8e59ed62` (#2034, 2026-10-23), which
changes three files under `docs/` and **no** file under `lib`, `routes`, `server.js` or `public`. simple-dispatcher
did not move. So **every code cite in this report resolves at `c5694b68`** (the pin) and is identical at `8e59ed62`;
the C8 halt-copy query returns the same 52 hits at both. The commit is nonetheless evidence this review has to
carry, because it records a production event after the pin:

* `docs/incidents/2026-10-22-railway-security-disclosure.md` (new): Railway disclosed that environment variables
  may have been exposed; every Harbour credential held in Railway was rotated on 2026-10-23, the database was
  moved to the app's region, and **email sign-in was switched off** (`EMAIL_TRANSPORT=off`, ~08:55Z) after a
  sign-in spam bot sent 47 emails since 2026-10-20 (LIN-3771, In Progress). It also reports the dispatcher's
  LIN-3695 auth-stop back-off firing in production during the outage ("working as designed"). It is a dated
  note, not a rescore: no code changed, and the incident is the tracker's/operator's to own. It touches
  `flow-email-identity` (a new id this run; see its row), `flow-consumer-liveness` (R15) and the credential lane
  (R13 sits next to it; Security 2026-10-18 owns the credential dimension and pre-dates the event).
* `docs/incidents/2026-09-22-harbour-db-reads-hang.md` gained a correction: the region move it credits with
  resolving LIN-2993 had not taken effect until 2026-10-23, so "the hang ended for some other reason". Run 3
  recorded LIN-2993 as a coverage caveat on four surfaces; the caveat stands and its stated cause is now open.

**Mint-text and research errata, recorded as the rest of the first-finding block.** The breakdown's seed text
and the research pass contained errors that primary sources correct (each is logged as "research said X;
primary shows Y"):

| # | Seed said | Primary source shows |
| -- | -- | -- |
| E1 | `observer-shadow-log.js` now imports `observer-efficacy-signal.js` | It does not: it imports only `crypto` (`lib/observer-shadow-log.js:53`); the efficacy module appears there only in a docblock (`:128`, `:138`). 0 production importers (R8) |
| E2 | R10 "about 9 files still match" | R10 is resolved in code. Run 3's exact query returns 52 hits in 17 files, 0 stale (`rerun-outputs.md` Q22); the stale wording was removed in `d272d2ec` / `d1085dcd` (their subjects are the runner-owner gate; the copy edit is a side change, found by `git log -S`). LIN-3074 is still Backlog |
| E3 | Security #6: no server-side readiness re-check | Partly superseded: LIN-3634 (Done) re-checks on the session and press lanes (`lib/dispatch-entrance.js:1182`, `routes/workspace-api.js:3744`). The proxy, recommend and kickoff lanes are tracked in **LIN-3649** (Backlog), per LIN-3634's description — **not LIN-3417**, which is a separate spike on credential-level merge enforcement (research mint-error 3 and R1 conflated them) |
| E4 | LIN-3642 open (seed cite: the Linear OAuth callback `state` check at line 134) | Done and fixed: `routes/auth.js:140` requires a present `state` (`bc875ddc`) |
| E5 | LIN-3635 open | Done and fixed: `checkFreeTierGate` at `routes/workspace-api.js:3159` |
| E6 | Run 3's R11 counted `lib/http-keepalive.js` as a recurring job | Both of its intervals are per response (`:83`, `:112`); the only bare recurring job is the hourly cleanup (`server.js:4599`) |
| E7 | Consumer heartbeat files are all new | `simple-dispatcher/heartbeat.js` predates the window; only `host-heartbeat.js` and `host-heartbeat-sender.js` are new (`4c9fb76`, LIN-1952) |
| E8 | Stability F9 counts 4 paired contract PRs | 5 (simple-dispatcher `bb1da78` ↔ LinearViewer #1992). C11's shared-LIN-id rule cannot see that pair (#1992's subject is LIN-3618), so the figure is not re-bounded here |
| E9 | R12: "improved 5 → 4" | **Worsened** (5 → 19, see R12 and `c9-members.md`): research's own "4 persisting + 2 new" is 6 > 5 |
| E10 | `owner-credential-store.js` has "10 production importers" | One module import, `server.js:64`; the store is **injected** into `lib/connection-credential.js`, `lib/connection-lifecycle.js`, `lib/credential-invariant-sweep.js`, `routes/account-merge.js`, `routes/auth.js` and `routes/workspace.js` and used by method call (`routes/workspace.js:130`, `routes/auth.js:326`). The dual representation (R13) stands; the count does not |
| E11 | Denominator 52 | 51 scored + META (`mod-stage-router` folds, plan decision 1) |
| E12 | C14 "6 surfaces" | 14 ids (`c14-members.md`); the plan's Arm 1 counts (45 + 22) do not reproduce from its words (54 from the reconstructed regexes) but the 13 named commits stand |
| E13 | C10 "143 groups" | 137 (53 bare unique, 36 new, 0 unresolved, 3 slash) |
| E14 | C9 Arm B "73 lines over 61 tickets" | does not reproduce (7–10 literal, 50–55 wider); members were read, the count is not load-bearing |
| E15 | Halt-consumer divergence as a candidate recommendation | The runner kit's unknown-mode behaviour (leave every item, aborts included; simple-dispatcher reads unknown as `pause`) is a **declared** row in `contract.json` with the reason (LIN-3630) and a doc comment at `lib/runner-kit/runner.mjs:215-219`. Not a gap; recorded under `flow-dispatch-halt`, not minted as a recommendation |

**Citation re-points.** Of run 3's 137 line-citation groups, content-checked at the pin: **PASS 110 / REVERSED 19 /
RETIRED 7 / UNRESOLVED 1** (110 / 19 / 4 / 0 = 133 after excluding 4 rule false positives that point at report
lines, not code). The 19 reversed and 3 real retired claims collapse into the families listed in *Findings*
(R5, R10, R11, router mounts, R7, R8, R12, `BUILDER_VERSION` 16 → 18). Detail: `citation-repoints.md`.

**Sibling freshness, pinned to a timestamp.** `docs/reviews/` was re-listed at 2026-10-23T09:41Z: **68**
top-level report files, **16 dated after run 3** (3 Code Quality, 5 Drift & Coherence, Design & Interface,
Documentation, Recent Headwinds, 2 Seams & Tangles, Security, 2 Stability). No registry sibling edition landed
after the evidence step's listing (`rerun-outputs.md` Q10); anything that lands later is a dated note, not a
rescore, unless it owns a scored dimension.

---

## Scope & sweep accounting

**Window.** LinearViewer `e69e2cc9..c5694b68`: **1,158 commits**, 577 touching `lib/`, `routes/` or `server.js`.
simple-dispatcher `3b1e734..bb1da78`: **61 commits** (48 non-merge; 110 files, +10,956/−946). Run 3's own
window accounting error (a consumer count of 0 vs 112) is the reason both windows are stated.
Sibling Stability 2026-10-21 calls this a **rebuild wave** (its F1): about 16 design-first rebuild commits
(since 2026-10-14, 21 matching minus 5 essays) carry most of the lines in 15 of the 25 most-churned files, claim
the same behaviour, and shipped **6 body-declared behaviour changes** (`91fca7dd`, `1f8010a0`, `4ee0a2c7`,
`350242d5`, `65969467`, `d2d7d818`) plus the three Jira codec tickets (LIN-3561/3564/3570). The plan's earlier
"3 behaviour fixes" undercounts.

**1. Added files: 134, each dispositioned (`importer-dispositions.md`).**
**58 folds + 65 under 11 new ids + 11 exclusions = 134.** `mod-stage-router` (4 files) folds into
`mod-prompt-template-system` (plan decision 1), so the parent C1's 54 + 69 + 11 becomes 58 + 65 + 11. Folds go to
22 run-3 ids, none colliding with a new id. The 11 new ids (65 files): `flow-run-evidence-closeout` 10,
`api-runner-kit` 8, `flow-email-identity` 7, `flow-workspace-lifecycle` 7, `flow-consumer-liveness` 6,
`mod-task-page` 6, `flow-agent-grants` 5, `mod-dispatch-entrance` 5, `flow-task-share` 4, `mod-library` 4,
`mod-response-hardening` 3. The 11 exclusions: `lib/drop-shares-collection.js`, `lib/expire-ownerless-dispatch-tokens.js`
(one-off migrations run by scripts), `lib/loose-json.js`, `lib/read-horizon.js`, `lib/utils/time.js`,
`lib/workspace-lookup.js` (pure helpers), and five test/sample-mode files (`lib/sample-data/{mock-data,
ship-dense-sample-data,swim-sample-data}.js`, `lib/should-mock-ai.js`, `lib/workspace-api-mocks.js`).
Importers were resolved by full path (the three duplicate basenames `email-auth`, `library`, `milestone-funnel`
do not collide). **Zero production importers (4):** `lib/account-erasure.js` (scripts only, `scripts/erase-account.mjs:35`),
the two migrations above, and `lib/runner-kit/contract.json` (a test fixture by its header, read via `fs` in
`tests/unit/runner-kit-contract.test.js:38`). The other 130 have at least one production importer.

**2. Deleted files: 3, each dispositioned.** `lib/dispatch-repo-guard.js` and `lib/workspace-repos.js`
(both `e1a80856`, LIN-3333, `repo=` lines retired, the logic removed not moved; `isGitHubRepoSlug` survives at
`lib/github-pr-status.js:61`): run 3's evidence on them (L80, L283–284, L367, L408, L426, L457, L541, L612) is
**retired**, as is R8's "resolved" instance (see R8). `lib/prompts/meta-prompt-template.js` (`19d7198a`, LIN-3300):
no run-3 cite; the `mod-prompt-template-system` "what it is" cell is updated (no model writes a prompt; the work
goes through `composeRoutedRecommendation`, defined at `lib/openrouter.js:1815`, and `lib/stage-router.js`), and one stale
mention remains as a comment at `lib/plan-review-round-trips.js:27` (a sighting, not a count). The other 15
repo-wide deletions are scripts/tests, uncited by run 3.

**3. Modified-not-added seams (the sweep run 3's second-read said was necessary).** Top 25 non-test files by
churn, checked against their carried ids (`rerun-outputs.md` Q11): none of these ids is filed "unchanged" below —
`flow-account-connection-workspace-credential` (~77 commits), runner grants (~47 commits across
`flow-bootstrap-token-exchange`, `api-workspace-proxy`, `api-dispatch`, `flow-followup-resume`),
`mod-prompt-template-system` (~56, LIN-3300), `flow-free-tier-rate-limit`, `flow-dispatch-lifecycle`,
`flow-operator-decisions` (second large window in a row), `mod-kpi-audit`, `api-github-app` (LIN-3404),
`flow-autopilot-wake` (`d2d7d818`), `api-jira-rest` (`lib/providers/jira/adf.js` is #9 by churn),
`mod-roadmap-trajectory` (`lib/render-roadmap.js`, #20), `api-openrouter` (`lib/openrouter.js` #22, 31 commits:
`3ee41011`, `279258c9`, `a89c43b7`, `8c41aa19`), and `public/app.js` / `public/flight-companion.js` (LIN-3385/3401,
"controls answer only themselves") under `mod-render-layer`. **`mod-render-layer`'s run page** (~57 commits in
`lib/render-session.js`, `routes/dashboard.js`) is placed in `mod-task-page` (route `routes/task-page.js`, loader and
steps) for the task-facing view and stays under `mod-render-layer` for the renderer; the data it shows is owned by
`flow-run-evidence-closeout`.

**4. Cross-repo FLOWs.** 19 non-merge simple-dispatcher commits share a LIN id (10 ids) with a LinearViewer window
commit; seven LinearViewer squash PRs cover six of the ids (#1805, #1816, #1817, #1923, #1930, #1941, #1969). The
flows: runner contract, heartbeat and auth-stop, halt modes, broker-token `itemId`, terminal-marker retry. See
*Findings* R14, R15 and the `flow-dispatch-halt` / `flow-dispatch-lifecycle` rows.
**Consumer-side change inventory (added after the second-read, see below).** The 61 simple-dispatcher commits are mostly
not Harbour crossings. The largest consumer-only changes, each outside the ledger by the consumer-repo decision:
`signal-guard.js` (new, +344, LIN-3270: a recycled pid took the whole fleet down twice on 2026-10-02 through a group
SIGTERM; every process-group kill now goes through a guard and is logged), `reapers.js` (+536), `dispatcher.js` (+395),
`opencode-runner.js` (+323; LIN-3354/3355/3431 judge OpenCode on progress, abort and resume a no-progress run, end dead
runners), `hook.js` (+198), LIN-3199 (SUMMARIZING phase removed), LIN-3585 (flat dispatcher cycle cost), LIN-3209
(duplicate-launch alarm, read only by LinearViewer scripts). 1,506 insertions across those five files. They shape
`flow-dispatch-lifecycle` and `flow-followup-resume` on the consumer half, whose ledger rows cite Harbour-side evidence
only; that is a stated limit of this run's discovery, not a finding of absence. **Added-file sweep gap:** the 134-file
sweep covered `lib/` and `routes/`; 10 files were added under `public/` (`task-page.js`, `close-out.js`, `runner-setup.js`,
`workspace-kpis.js`, `chart-helpers.js`, `form-behaviours.js`, `question-cards.js`, three stylesheets) and are not
dispositioned; they belong to `mod-task-page`, `flow-run-evidence-closeout`, `api-runner-kit` and `mod-kpi-audit` by name.

**Unbounded classes, recorded as such.** Live items taken forever; whether stored rows carry `periodicalId` when read
back (the dated sample in `rerun-outputs.md` Q33: 20 of 17,780 rows at 12:04Z on 2026-10-21, all this workspace's
own, `periodicalId` absent from list rows and from `GET /dispatch/{id}`); heartbeat rows reporting auth-stopped
workspaces; provider-side Done automations such as Linear workflow rules. No decision depends on any of them.

---

## Consumer-repository decision, made explicit (re-taken at HEAD)

**Decision: simple-dispatcher stays in discovery and out of the scored ledger, for the same reason as run 3 —
and a second reason is new.** (1) The ledger's unit is the Harbour-served surface, and the consumer's own internals (listed above) are not scored; `template.scope` is still consumed by no runtime code (every importer of
`lib/periodicals.js` ignores it; only a unit test reads it), and **LIN-1933** (target-repo selection) is still
**Todo** with no in-window commit. (2) The runner kit moved the boundary: `lib/runner-kit/` (added 2026-09-29, after
run 3's cut) is **served from Harbour** to user machines (`routes/runner-kit.js:27`, with sha256 pins in the
kickoff prompt `lib/prompts/runner-kickoff.js:89`) and `contract.json` names simple-dispatcher "the reference". The
part of the consumer that now ships from Harbour is therefore scored on the Harbour side as the new id
**`api-runner-kit`**; Harbour-anchored FLOWs keep scoring on the Harbour side with simple-dispatcher code cited
as consumer evidence (`halt.js`, `host-heartbeat.js`, `test/runner-contract.test.js`, `dispatcher.js`). Re-take
trigger: LIN-1933 landing, or `template.scope` gaining a reader.

---

## Headline read

**R7 — the periodical Done gate — is unmoved for a fourth cycle, and the class it describes got wider.** The
gate (`checkPeriodicalReportGate`) is still called from exactly one place, `routes/proxy-writes.js:374` (inside
`refusedByPeriodicalGate`, defined `:365`, called by the PATCH handler at `:416`, write `:429`). The session-auth
edit route (`routes/workspace-api.js:3410`, `updateIssue` `:3455`) still runs no gate, and a **third** in-product
Done writer has appeared: the close-out check (`routes/workspace-api.js:3655` → `settleDone` `:3619` →
`defaultMarkDone` `:815`, LIN-3248, 2026-10-02). Two ungated create routes can also mint an issue already in
Done. **3 update-path Done writers, 1 gated; plus 2 ungated create routes.** LIN-2576 is still `Todo`. The gate
this very report is subject to is again bypassable by the product's own pages, and the lifecycle (LIN-3768) is
told to close this task through the gated `PATCH /api/proxy/issues/:id` only.

**The trend, in one paragraph.** Run 3 left two things open that were "likely resolved": **R5 is resolved** (the
`global:global:` double-prefix key is gone, one key builder serves read and write, tests pin it), and **R10 is
resolved in code** (the halt copy now says the runner honours a halt; the ticket LIN-3074 is stale, not the
code). **R11 improved** (seven registered jobs, the doc roster is test-pinned and passes). **R6 improved
substantially** (16 sibling editions since run 3, including the first Security refresh since June). Against that,
**R12 got worse** (5 → 19 stale-contract-text instances; some of the jump is a better bound) and **R7, R3, R9
and R13 did not move**: LIN-2576 `Todo`, LIN-1040/1041 `Backlog`, `periodicalId` still dropped by
`formatDispatchWatch`, the credential lane's dual representation (LIN-2150 `Todo`) still open.

**What the connections, heartbeat/liveness, runner-kit and close-out lanes add.** They are 65 of the 134 added
files and four of the eleven new ids. The connections lane is a real model improvement
(Account → Connection → binding through one seam, `lib/connection-credential.js`) that **folds into
`flow-account-connection-workspace-credential`** with its CHP held at 3 while the legacy owner-credential record
still runs alongside (R13). The heartbeat/liveness lane (`flow-consumer-liveness`) closes visibility but not
the core of R2: alarms are alarm-only (`lib/liveness-alarm-sweep.js:20-23`), and a consumer that dies on an open
ticket still leaves its item taken forever. The runner kit (`api-runner-kit`) is the largest new cross-repo
surface and its cross-repo contract pin is guarded by nothing in CI on either side (R14). The close-out lane
(`flow-run-evidence-closeout`) is the best-built new lane, and its Done path is also the third R7 writer.

**The scoring model has a recurring gap, now at scale (R16).** 14 of the 35 surfaces rated done or High were hit
by a real finding or shipped defect in the window (11 fixed, 3 findings still open); run 3 found 2. The review's
confidence column did not inherit sibling staleness, and a fixed defect on a 4-rated surface changes nothing in
the ledger by design. That is the META recommendation.

---

## Findings (priority-ranked)

Advisory — **no task is minted for any of these**. R1–R13 keep their ids (R4 stays closed; **R5 and R10 are
now resolved**); new findings start at **R14**. Every carried verdict below was re-derived from primary sources
at the pin (code via `git show c5694b68:<path>` content-checked; tracker state via the workspace API at
2026-10-23T09:37Z; sibling reports via `git show`), not copied from research; `/periodicals` was not used
(it reports dispatch recency). A verdict identical to research still carries its own re-run output in
`rerun-outputs.md` (Q15–Q23, Q39, Q40) and the commands inline here.

### R7 — the periodical Done gate guards one of three update-path Done writers · **Impact: H · Effort: L · carried, unchanged (4th cycle), class widened**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/enforcement completeness (first-party) ·
Confidence: High · Owner: LIN-2576 (`Todo`)*

Writers that can set an issue's state, bounded by grepping every `updateIssue` / `createIssue` caller outside
`lib/providers/` (`rerun-outputs.md` Q15):

| # | Path | Gate | Evidence at `c5694b68` |
| -- | -- | -- | -- |
| 1 | Agent API `PATCH` (`routes/proxy-writes.js`) | **gated** | `refusedByPeriodicalGate` defined `:365`; `checkPeriodicalReportGate(` called inside it at `:374`; the PATCH handler calls the wrapper at `:416`; the write is `:429`. (Research C4's "`:374`" is the call inside the wrapper, not the handler entry.) |
| 2 | Session-auth edit page `PATCH /workspace/:urlKey/api/issues/:issueId` | **ungated** | route `routes/workspace-api.js:3410`; `input.stateId` set `:3451`; `provider.updateIssue` `:3455`. The route holds the gate's two inputs (`issueWriteGuard`, `:3440`) and never imports the gate |
| 3 | Close-out check `POST …/run-evidence/:issueIdentifier/check` | **ungated** (own guard `closeOutSetsDone` `:3695`, which is not the adversarial-read gate) | route `:3655` → `settleDone` `:3619` (called `:3696`) → `defaultMarkDone` `:802-816` → `provider.updateIssue(… { stateId })` `:815`. Introduced by LIN-3248 `bb5eca05` (2026-10-02) |
| c1 | Agent API create `routes/proxy-writes.js:339` | ungated | `stateId` accepted into the create input, `provider.createIssue` `:352` |
| c2 | Session create `POST /workspace/:urlKey/api/issues` `routes/workspace-api.js:3343` | ungated | `stateId` accepted `:3384`, `createIssue` `:3391` |

**3 update-path Done writers, 1 gated; plus 2 ungated create routes** (run 3: 2 and 1). The create routes can only mint an
issue already in Done, not close an existing periodical, so their severity is lower than #2 and #3; they are the same
class and the same owner, so R7 is widened in place rather than split. Checked and **not** members: the only other
`updateIssue` call, `routes/proxy-writes.js:475` (writes `description` only); `routes/workspace-api.js:3259`
(`createIssue` with no `stateId` field); `lib/ticket-close-closer.js` (reacts to tickets already closed);
`lib/chat-tools.js` (read-only); the flight-companion, task-chat and task-edit routes; the runner kit's internal
`row.state='done'`; simple-dispatcher (no direct writes); `routes/test.js` creates (test-only, `server.js:1100-1105`).
The gate's only caller is one: `grep checkPeriodicalReportGate(` returns `lib/periodical-report-gate.js:113`
(definition) and `routes/proxy-writes.js:374`. **Not boundable:** provider-side Done automations (Linear workflow
rules).

**Why it persists:** zero commits reference LIN-2576; the third writer arrived 11 days after run 3's pin, from a
legitimately separate ticket (LIN-3248) with its own review-ledger guard, which reads as "the close-out path is
already guarded" and so does not trip the same alarm. **Action (for a human to weigh):** run the identical
`checkPeriodicalReportGate` check in `routes/workspace-api.js`'s update-issue handler and in `defaultMarkDone`
(both already hold `description` and `comments`). **Close-out of *this* task must use the gated
`PATCH /api/proxy/issues/:id`, never the edit page or the close-out press.**

### R13 — `flow-account-connection-workspace-credential`: the model improved; the dual representation is the residual · **Impact: H · Effort: — (Security Review's remit) · carried, CHP held at 3, evidence refreshed**

*Surface: FLOW · Dimension: core/happy-path, auth & credentials (sibling-owned) · Confidence: Medium · Owner: Security
Review; migration LIN-2150 (`Todo`)*

The lane was rebuilt: Account → Connection (`accountId::provider::unitId`) → binding (`connectionId`) → workspace,
through one seam, `lib/connection-credential.js` (LIN-2149 Done; LIN-3124, 3125, 3240–3242, 3335/3336, 3382; ~77
commits). `CONNECTION_BACKED_WRITES` (default on, creation only) is at `lib/connection-credential.js:1061-1070`. But
the legacy `OwnerCredentialStore` still runs alongside, in the same collection, in both key shapes: one module import
(`server.js:64`), injected into `lib/connection-credential.js:330`, `lib/connection-lifecycle.js:57`,
`lib/credential-invariant-sweep.js:194`, `routes/account-merge.js:49`, `routes/auth.js:39` (`persistOwnerCredential`
`:326`) and `routes/workspace.js:29` (`deleteAll` `:130`). (Research said "10 production importers"; the primary shows
1 import and 6 injected consumers — E10.) A re-score down is not warranted: the seam is the improvement, and the
dual representation is ticketed (LIN-2150 `Todo`; Drift 2026-10-19 top row `credential-decision-multiplicity`,
LIN-2150/LIN-2188). Other open tickets, all `Backlog`: LIN-2493 (credential-health blind to a provider-lane
failure), LIN-2287, LIN-1900, LIN-2609. **A real incident is adjacent**: the 2026-10-23 credential rotation
(post-pin note above) re-exercised this lane in production; the incident record reports it recovered. Security
2026-10-18 owns the dimension and pre-dates the event, so confidence stays Medium.

### R1 — `flow-periodicals-two-stage`: Stage-2 completion — the close-out lane helps, the new gap is counted under R7 · **Impact: H · Effort: M · carried, improved**

*Surface: FLOW · Dimension: core/happy-path, configuration · Confidence: High*

The run-evidence and close-out lane landed (LIN-3248, 3251, 3254, 3311, 3634, 3717). The readiness re-check
(`closeOutNotReady`) now runs on the session lane (`lib/dispatch-entrance.js:1182`) and the press route
(`routes/workspace-api.js:3744`) — LIN-3634, Done. **The proxy, recommend and kickoff lanes still have no
server-side re-check: that is LIN-3649 (Backlog)**, per LIN-3634's description; **LIN-3417** (Backlog) is the
separate credential-level merge-enforcement spike (E3). Tracker states at 2026-10-23T09:37Z: LIN-2846 Backlog,
LIN-1629 Todo, LIN-2328 Todo, LIN-1933 Todo. The parent epics LIN-2948/2949 are Canceled, their slices Done and in
production. The new gap is the close-out Done path's missing periodical gate, which is R7's member #3, not a separate
row. Security 2026-10-18 #6 (Medium) is therefore partly superseded and partly open (LIN-3649).

### R14 — `api-runner-kit`: the cross-repo contract pin is guarded by nothing in CI · **Impact: M · Effort: L-M · new**

*Surface: API · Dimension: testing (contract tests for API surfaces), configuration · Confidence: High · Owner: this
review for the boundary; Code Quality (LIN-3741) for complexity*

`lib/runner-kit/contract.json` is **byte-identical** to `simple-dispatcher/test/fixtures/runner-contract.json`
(`cmp`, checked at the pins). simple-dispatcher pins `LV_COMMIT = '1d4aec6a'` (#1969) and a sha256
(`test/runner-contract.test.js:30`, `:151-152`); LinearViewer's test reads its own copy
(`tests/unit/runner-kit-contract.test.js:38`). **Each side pins only its own copy**; no check in either repo's CI
(`git grep runner-contract` over `.github`, `package.json` in both) fails if the copies diverge, so code comments that
say "a rename on either side fails a test" overstate it. The served surface is real: `routes/runner-kit.js:27`
serves the kit to user machines and `lib/prompts/runner-kickoff.js:89` pins per-file sha256 in the kickoff prompt.
Code Quality 2026-10-20 F-runner-kit (HIGH, LIN-3741 Backlog): `runCommand` cyclomatic complexity 132 in a file
served to user machines (`lib/runner-kit/runner.mjs`, 1,104 → 1,382 lines since 10-12). Stability F9 (Low, watch) records
rising kit churn. Also: `contract.json:289-290` says the kit sends no heartbeat while `docs/dispatch-integration.md:283`
says it does (Documentation 2026-10-21 #2); nothing in `runner.mjs` posts to `/api/proxy/runner/heartbeat`
(live at `routes/proxy-runner.js:131`). **Action (for a human to weigh):** a CI step in either repo that compares the
copies (or fetches the other side's pinned commit).

### R2 — `flow-dispatch-lifecycle`: a claimed-but-never-fed-back dispatch item still has no timeout · **Impact: M · Effort: M · carried, partly improved, core gap open**

*Surface: FLOW · Dimension: core/happy-path · Confidence: High · Owner: LIN-2120 (Backlog)*

Liveness alarms (`flow-consumer-liveness`) add visibility, not eviction: the sweep is **ALARM ONLY**
(`lib/liveness-alarm-sweep.js:20-23`), scheduled at `server.js:948` (10 min, 5-min lease); Rule S
(`lib/liveness-detectors.js:141`) is per workspace, not per item; alarms are read only through `GET /api/proxy/alarms`
and nothing in the UI reads them. Event-driven closers (LIN-3364/3365/3366, `closeIssueRows`
`lib/dispatch-store.js:1810`) close rows only on a later lineage post or a terminal ticket, and LIN-3399 removed the
scheduled sweep. `cleanup()` (`lib/dispatch-store.js:948-967`) still keys only on `expiresAt` (`:956,967`), and
`listHistory({ silentSince })` (`:1167,1183`, indexed `lib/db-indexes.js:157-163`) has **no production caller** (the
only other references are scripts). A consumer that dies on an open ticket still leaves its item taken forever.
Related, owned elsewhere: a terminal marker can be posted twice (simple-dispatcher LIN-3208 opt-in bounded retry) and
Harbour has no dedupe — idempotency, **Reliability (LIN-1040, not built)**.

### R9 — `periodicalId` at the dispatch response allow-list: the read side still drops it · **Impact: M · Effort: L · carried, unchanged**

*Surface: FLOW (`flow-periodicals-two-stage`) · Dimension: configuration/data integrity · Confidence: Medium · Owner:
LIN-2846 (Backlog)*

`formatDispatchWatch` (`routes/proxy-dispatch.js:118`) and the list allow-list still do not carry `periodicalId`
(`git grep periodicalId c5694b68 -- routes/proxy-dispatch.js` returns only the input doc comment at `:335`), though the
store carries it (`lib/dispatch-fields.js:125`, used in `lib/dispatch-store.js`). Whether stored rows carry it when
read back stays unverifiable from source (the dated sample above: absent).

### R16 — META: done/High ratings are hit by real findings at scale, and the model has no way to say so · **Impact: M · Effort: L · new**

*Surface: META · Dimension: methodology · Confidence: High · Owner: this review*

C14 (`c14-members.md`; regexes and the 13 kept commits in `rerun-outputs.md` Q34/Q35): **14 ids** rated done or High were hit by a real finding or a shipped defect in the window — 11
only by a defect since fixed (recorded as coverage caveats, run-3 precedent LIN-2993), **3 by findings still open**
(LIN-1410 `flow-bootstrap-token-exchange`, LIN-3394 `api-mongodb-storage`, the Rulings-feed item LIN-3281
`flow-operator-decisions`). Run 3 found 2. With 35 of 41 carried ids in the "4 or High" population (85%), the base
rate is high enough that a hit rate near 40% is the measurement, not a surprise. Two model gaps: (1) a fixed defect
on a 4-rated surface changes nothing in the ledger by design; (2) per-surface confidence does not inherit sibling
staleness (a surface can read High while its owning review is 17 weeks old). **Action:** record fixed-defect hits in
the ledger's delta cell (this run does) and let High confidence require a current owning sibling or a first-party
look.

### R15 — `flow-consumer-liveness`: the heartbeat's auth-stop field is stored but never shown · **Impact: M · Effort: L · new**

*Surface: FLOW · Dimension: observability (sibling-owned) · Confidence: Medium · Owner: Observability — LIN-1041 (not built)*

simple-dispatcher's LIN-3695 (`bb1da78`) stops polling a workspace after repeated 401s and reports it as
`authStoppedWorkspaces` (`host-heartbeat.js:25,108`). Harbour accepts and validates the field
(`lib/consumer-heartbeat.js:34,87`) and stores it, but **nothing displays it or alarms on it**: its only visible
surface is the raw `fields` in `GET /api/proxy/heartbeats`. Harbour's expired-token 401 carries no code, so the
consumer's credential-dead latch never fires and the 3×401 auth-stop is the only path. This was observed live after the
pin: during the 2026-10-23 database outage the dispatcher "reports both workspaces auth-stopped" and the operator
found out from the dispatcher, not from Harbour (incident record, post-pin note above). All 19 heartbeat field names
agree across the repos.

### R3 — Reliability and Observability reviews still do not exist · **Impact: H (portfolio-wide) · Effort: — (not this review's to mint) · carried, unchanged, owner map corrected**

*Surface: portfolio/META · Confidence: Medium*

LIN-1040 and LIN-1041 are both `Backlog` (tracker, read 2026-10-23T09:37Z) and unregistered: the registry has 16
entries and neither id is among them (`rerun-outputs.md` Q32); this review's template names the two reviews as
still unbuilt (`lib/periodicals.js:705-707,730`). **Owner-map correction (a META delta):** API Quality's remit
(`lib/periodicals.js:379`) covers error handling and idempotency **at
the external contract**, so run 3's "unowned" was too strong at that edge; Data & Fetch Architecture (`:978`, never
run) owns read-side pagination and cache coherence in part; Performance / Scale (`:970`, never run) owns none of the
twelve. Five dimensions stay unowned in practice (resilience, rate limits & pagination, observability, and the
internal halves of error handling and idempotency).

### R12 — stale-contract text beyond halt: the class is bigger than recorded and growing · **Impact: L-M · Effort: L · carried, worsened**

*Surface: portfolio/META · Dimension: documentation (sibling-owned) · Confidence: Medium · Owner: Documentation Review*

Bound written (`c9-members.md`, `rerun-outputs.md` Q24-Q27): **19 definite + 3 borderline** claims in code comments or
runtime strings that say a thing is unwired or pending a ticket, contradicted by production code. Provenance by
`git blame` against run 3's pin: 11 predate it (run 3 named 4), 8 are newer; run 3's fifth, `lib/pipeline-loops.js`,
is retired (`4ee0a2c7`). **Net 5 → 19, "worsened"** (new instances outnumber retirements 8 to 1). The jump is partly a
bound effect (7 latent members run 3 never recorded) and the report says so; research's "improved 5 → 4" was
wrong by its own count (E9). Worst offenders for a reader: `lib/held-connection-entry.js:2` ("dark: no consumer"),
`lib/connection-store.js:5` ("NO read path is wired"), `server.js:696,705`, `lib/proxy-preamble.js:444,692`
("no production caller"). Documentation 2026-10-21 owns the fix: its #1 (HIGH, LIN-3745 Backlog) is the LIN-3300
residue at 8 live sites. Out-of-bound sighting, inverse direction: `lib/liveness-alarm-store.js:276` claims
`cleanup()` is used by the periodic cleanup, but nothing calls it (R17).

### R8 — a recurring shape: landed, tested and consumed by nothing — mixed again · **Impact: M · Effort: — · carried, moved (mixed)**

*Surface: portfolio/META · Confidence: Medium*

* **Retired:** run 3's "resolved" instance. `lib/workspace-repos.js` and `lib/dispatch-repo-guard.js` were deleted, not
  moved, in `e1a80856` (LIN-3333). `repo` is stored as given (`lib/dispatch-entrance.js:360-364`).
* **Still dead:** `lib/observer-efficacy-signal.js` — 0 production importers (E1); `lib/observer-shadow-log.js` mentions it
  in a docblock only (`:128,:138`).
* **New, close:** `lib/workspace-registry.js` is **write-only by design** (`:2-3`, LIN-3700 Done, step 1 of LIN-3394
  Backlog): its only export is `recordWorkspace` (`:19`), called from 7 files (`lib/github-install-flow.js:30`,
  `lib/pat-session.js:14`, `routes/account-merge.js:14`, `routes/auth.js:20`, `routes/held-connection.js:39`,
  `routes/jira-auth.js:64`, `routes/workspace.js:9`), with no reader.
* **Near-miss:** `lib/lineage-closure.js` is used in production only for `TICKET_CLOSED_GRACE_MS`
  (`lib/ticket-close-closer.js:32`); its selector is scripts-only.
* **Not R8:** `lib/account-erasure.js` and the two migrations (scripts-only by design, dispositioned).

### R6 — sibling evidence: substantially refreshed, with two registered siblings that have never run · **Impact: M (portfolio-wide legibility) · Effort: — (scheduling call) · carried, improved**

*Surface: portfolio/META · Confidence: High*

Fresh since run 3 (16 files, listing pinned above): Security 2026-10-18 (the first refresh since June), Documentation
2026-10-21, Code Quality 2026-10-20 (+ 10-12, 10-12-tests), Stability 2026-10-12 and 10-21, Drift & Coherence
(five editions, newest 10-19), Design & Interface 2026-10-21, Recent Headwinds 2026-10-21, and the new sibling Seams &
Tangles (10-13, 10-20). **Still stale at the listing timestamp:** API Quality, Test Coverage Gap, Dependency &
Supply-Chain (all 2026-06-25, ~17 weeks), Comprehension-Debt (2026-07-01, ~16 weeks), Onboarding & Cold-Start
(2026-09-26, ~4 weeks). **Registered, never run:** Performance / Scale and Data & Fetch Architecture. Metric caveat:
`/periodicals` still shows Security as "never" (Headwinds H8, `lib/periodical-runs.js:111-120`); its "recent" is
dispatch-based. Listing command: `git ls-tree --name-only origin/main docs/reviews/` at 2026-10-23T09:41Z (`rerun-outputs.md` Q10); the two
never-run siblings were registered under LIN-1038 and LIN-1039 (both Done), so the gap is a scheduling call, not a build gap.

### R11 — `mod-scheduler`: the registered roster is complete; one bare recurring job remains · **Impact: L · Effort: L · carried, improved**

*Surface: MOD · Dimension: configuration · Confidence: High*

`server.js` registers **seven** jobs (`server.js:801`, `:868`, `:898`, `:928`, `:948`, `:980`, `:1009`: observer-sweep, observer-pass,
credential-invariant-sweep, pricing-conformance-sweep, liveness-alarm-sweep, ci-wake-sweep, kpi-daily-rollup). The
hand-written roster at `docs/architecture/source-map.md:189` matches, and `tests/unit/claude-md-scheduler-jobs-census.test.js`
passes (5/5, run locally on the PR branch). Substrate LIN-2128 (Done); the newest jobs are LIN-3258 (liveness alarm sweep) and LIN-3712 (KPI rollup), both Done. **Residual:** the hourly cleanup is a bare `setInterval`
(`server.js:4599` → `lib/hourly-cleanup.js`) with no lease and no source-map entry, so every instance runs it. Run 3's
second bare interval (`lib/http-keepalive.js`) was a miscount (E6).

### R17 — `lib/liveness-alarm-store.js:276` claims a periodic cleanup that nothing calls · **Impact: L · Effort: L · new**

*Surface: `flow-consumer-liveness` · Dimension: core/happy-path (retention), documentation · Confidence: Medium · Owner: this review (pointer)*

The comment at `lib/liveness-alarm-store.js:276` (LIN-3258, Done) says `cleanup()` is "used by the server's periodic cleanup"; `lib/hourly-cleanup.js` lists nine other
stores and not the alarm store, and `grep cleanup` over `lib/liveness-alarm-store.js`, `lib/liveness-alarm-sweep.js`
and `server.js` finds no caller. Alarm rows therefore have no retention (unbounded growth, low rate). The inverse of
R12: dead code claimed live.

### R5 — `flow-free-tier-rate-limit`: resolved after three cycles · **Impact: — (closed) · Effort: — · carried, RESOLVED**

*Surface: FLOW · Dimension: testing (sibling-owned) · Confidence: High (code), Medium (residual)*

One key builder, `_getGlobalHourKey` (`lib/free-tier-store.js:97`), used for both the read (`tryUse`, `:149`) and the
write (`:225`); its comment (`:87-96`) documents the old `global:global:` bug. `tryUse` does an atomic read-and-write
on the same key. Tests: `tests/unit/free-tier-store.test.js` (concurrent case) and
`tests/unit/free-tier-allowance-fronts.test.js`. Commits: LIN-3238 `ea4b4290`, LIN-3239, LIN-3269 `66014ac0`, LIN-3706
`0eb4a2d1`; LIN-2955 Done. Every spend site is now paired with a gate, including LIN-3635 (Done,
`routes/workspace-api.js:3159`). **Residual (Medium, predates the window):** the server-side run-paragraph precompute
(`lib/run-paragraph-hook.js:30-37` via `lib/session-materializer-precompute.js:93-99`) spends the free-tier key with
no hourly charge; Security 2026-10-18 #13 / LIN-3422 owns "spend outside every cap". The model moved from
prompts/day to runs/day.

### R10 — `flow-dispatch-halt`: halt copy resolved in code; the ticket is stale · **Impact: — · Effort: L (close LIN-3074) · carried, RESOLVED in code**

Run 3's exact query (`git grep -n -E "LIN-2995|yet honor" c5694b68 -- '*.js' '*.md'`) returns **52 hits in 17 files**
(run 3: 34 in 14). Reading each: 31 in `docs/reviews`, 9 in `docs/papers`, 1 incident status row, 10 test/fixture lines in 5 files with
negative or accurate assertions (`tests/unit/render-dispatch-exec-controls.test.js:52`, `tests/unit/runner-kickoff.test.js:110`,
`tests/e2e/dispatch-halt.spec.js:128`), and 1 production comment (`public/dispatch.js:771`, accurate). **0 stale.**
The old wording was removed by `d272d2ec` and `d1085dcd` (LIN-3408/3409, runner-owner gate) — found by `git log -S`,
not by those commits' subjects. LIN-3074 is still Backlog; Documentation 2026-10-21 (`:59`, `:99`) and Drift 2026-10-19
(`:235`) both recommend closing it. `flow-dispatch-halt` now has a **second consumer**, the runner kit
(`lib/runner-kit/runner.mjs:221` `haltAction`); on an unknown mode it leaves every item, aborts included, where
simple-dispatcher reads unknown as pause — a **declared** difference (`runner.mjs:215-219`, a `contract.json` row,
LIN-3630), so no recommendation.

### R4 — Security H1 (stored XSS): resolved · **Impact: — (closed) · Effort: — · carried, RESOLVED, stays closed**

Upload side `lib/attachment-upload.js:27,101` (`sniffRasterType`); serve side `routes/workspace-api.js:2938`
(sniff) and `:2944` (`X-Content-Type-Options: nosniff`); global `lib/security-headers.js:87`. No regression.

---

## Surface registration — new ids, folds, retirements

**Ledger shape: 51 scored ids + 1 META.** 40 carried (verbatim from run 3's 41 minus its META) + **11 new**; the
parent's 12 new ids become 11 because `mod-stage-router` folds. Run 3's 41 ids are all present, **none retired**. A removed
surface would be marked retired, never deleted; none qualified: the two deleted lib modules were *evidence* under
`api-workspace-proxy` and R8, not ids.

**New ids (11, 65 files).** Each was registered because no carried id models it and folding it would hide a half of
its evidence:

| id | Type | Files | Why a new id rather than a fold |
| -- | -- | -- | -- |
| `flow-run-evidence-closeout` | FLOW | 10 | the run-evidence / review-ledger / close-out box; spans `lib/` stores, `routes/workspace-api.js` and the run page; owns R7 member #3 |
| `api-runner-kit` | API | 8 | the part of the consumer that now ships from Harbour (consumer-repo decision); a cross-repo contract |
| `flow-email-identity` | FLOW | 7 | a second sign-in path (LIN-1892) that traverses store, transport, routes and account home |
| `flow-workspace-lifecycle` | FLOW | 7 | create/bind/remove, urlKey, registry, erasure; owned by no single module |
| `flow-consumer-liveness` | FLOW | 6 | heartbeat ingest → store → alarm sweep, cross-repo (R2, R15, R17) |
| `mod-task-page` | MOD | 6 | the task/run page and its stored-data endpoint; places the run page |
| `flow-agent-grants` | FLOW | 5 | grant/scope vocabulary and owner-only gates across the proxy, dispatch and runner lanes |
| `mod-dispatch-entrance` | MOD | 5 | the single decision seam under both `api-dispatch` and `api-workspace-proxy` (`lib/dispatch-entrance.js` is 1,812 lines); folding it into either hides the other half |
| `flow-task-share` | FLOW | 4 | owner-minted guest task pages (`/t/:token`) |
| `mod-library` | MOD | 4 | public `/library` catalogue |
| `mod-response-hardening` | MOD | 3 | public-origin, headers, CSP |

**Folds (58 files into 22 carried ids).** `mod-prompt-template-system` 11 (including the four `mod-stage-router` files:
`lib/action-kind.js`, `lib/recent-runs.js`, `lib/recommendation-input.js`, `lib/stage-router.js` — the weakest candidate
id, folded per plan decision 1 because choosing the next stage and assembling its prompt are one path under the
CLAUDE.md "one path for every recommendation" invariant; `recommendation-input.js` is imported by `routes/proxy.js:70`
and `routes/workspace-api.js:41`), `flow-account-connection-workspace-credential` 9, `mod-kpi-audit` 8,
`mod-observation-materializer` 4, `api-workspace-proxy` 3, `flow-autopilot-wake` 3, `flow-dispatch-lifecycle` 3,
`flow-flight-companion-turn` 2, `mod-dispatch-queue` 2, and one file each into `api-dispatch`, `api-github-app`,
`api-mongodb-storage`, `flow-account-merge`, `flow-bootstrap-token-exchange`, `flow-cost-telemetry`,
`flow-dispatch-halt`, `flow-followup-resume`, `flow-free-tier-rate-limit`, `flow-oauth`, `flow-operator-decisions`,
`mod-scheduler`, `mod-secret-scan` (11 + 9 + 8 + 4 + 3 + 3 + 3 + 2 + 2 + 13 = 58). Per-file rows with importer
`path:line` and introducing commit: `importer-dispositions.md`.

**Retired evidence (ids stay).** `lib/workspace-repos.js`, `lib/dispatch-repo-guard.js` (R8 "resolved", `api-workspace-proxy`
CFG evidence); `lib/pipeline-loops.js`'s LIN-2187 stale comment (R12); the ledger cell text "Deterministic + AI prompt
system" for `mod-prompt-template-system` (meta-prompt deleted).

**Modified-not-added seams filed as changed, not unchanged** (the run-3 second-read lesson): see *Scope & sweep
accounting* item 3 and the ledger delta cells.

---

## Scorecard over the twelve dimensions

Per-surface core/happy-path (CHP) and configuration (CFG) are in the Trend Ledger (first-party remit). The other ten
dimensions are aggregated at portfolio level, with the owning review named, as in run 3. Freshness is stated at the
listing timestamp 2026-10-23T09:41Z.

| # | Dimension | This run (portfolio) | Owning review | Confidence | Delta vs run 3 |
| -- | -- | -- | -- | -- | -- |
| 1 | Core/happy path | 88.6% over 51 ids (89.8% over the 40 carried; see Completeness) | **this review (first-party)** | High | mixed — free-tier +1 (R5), 11 new ids at 84.1% dilute |
| 2 | Error handling & failure modes | partly owned at the external contract by API Quality (stale); internally unowned | **Reliability — LIN-1040 (not built)** | — | unchanged; owner map refined (R3) |
| 3 | Resilience | unowned | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 4 | Rate limits & pagination | unowned (read-side pagination partly Data & Fetch, never run) | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 5 | Auth & credentials | Security 2026-10-18 is fresh; open: LIN-1410, LIN-3394, LIN-3617/3618/3619; LIN-3642 fixed | **Security Review** | Medium | improved evidence base (was stale/Low); credential dual representation open (R13) |
| 6 | Idempotency & consistency | unowned; terminal-marker double-post has no Harbour dedupe | **Reliability — LIN-1040 (not built)** | — | unchanged |
| 7 | Input & schema validation | stale sibling (2026-06-25, ~17 weeks) | **API Quality Review** | Low | unchanged |
| 8 | Observability | unowned; `authStoppedWorkspaces` not surfaced (R15), alarm store cleanup uncalled (R17) | **Observability — LIN-1041 (not built)** | — | unchanged |
| 9 | Security | Security 2026-10-18: no Critical; one new High, LIN-3642, now fixed; R4 stays closed | **Security Review** | Medium/High | improved (stale → fresh) |
| 10 | Testing | owner stale (2026-06-25); R5's defect now pinned by tests; Code Quality 2026-10-12-tests and Stability F3 (CI not converging) are current incidental evidence | **Test Coverage Gap Review** | Low/Medium | R5 resolved; confidence up by the incidental evidence only |
| 11 | Documentation | Documentation 2026-10-21 fresh: LIN-3300 residue at 8 live sites (HIGH, LIN-3745); R12 5 → 19 | **Documentation Review** | High | worsened — R12 |
| 12 | Configuration | first-party + siblings; 30 of 51 ids are N/A (justified), no carried N/A flipped | **this review + siblings** | Medium | unchanged; R11 improved (roster pinned); `CONNECTION_BACKED_WRITES` (`lib/connection-credential.js:1061-1070`) and `EMAIL_TRANSPORT` are the new numeric-CFG evidence |

---

## Sibling-owned dimension coverage

Per-dimension, not per-surface. The owning reviews are the home for deeper follow-up; this review does not re-derive
their findings. Freshness is pinned to 2026-10-23T09:41Z.

| Dimension | Owning review | Status | Confidence | What's known this run |
| -- | -- | -- | -- | -- |
| Auth & credentials | **Security Review** | **2026-10-18 — fresh**, the first refresh since June (5 days at writing) | Medium | LIN-3642 (High, provisional) fixed `routes/auth.js:140`; LIN-3394 (no unique `urlKey` index) and LIN-1410 (inline bootstrap token) open High; LIN-3617/3618/3619 (tokens outlive logout) filed; credential follow-ups LIN-2287/2493/1900/2609 Backlog. The post-pin credential rotation (2026-10-23) post-dates the sibling |
| Security | **Security Review** | 2026-10-18 fresh | Medium/High | no Critical; H1 stays fixed (R4); the sibling's own second read corrected "No new High" |
| Input & schema validation | **API Quality Review** | 2026-06-25, ~17 weeks stale | Low | `api-dispatch` LIN-3440 (GitHub ids rejected) was a validation defect, fixed (`lib/dispatch-validation.js:267`); `lib/issue-write-validation.js` shared seam incidental |
| Testing | **Test Coverage Gap Review** | 2026-06-25, ~17 weeks stale | Low/Medium | R5's Critical defect resolved and test-pinned; Code Quality 2026-10-12-tests (fresh) and Stability F3 (CI not converging) are current incidental reads; this run's census test passes 5/5 locally |
| Documentation | **Documentation Review** | **2026-10-21 — fresh** | High | LIN-3300 residue (HIGH, LIN-3745); `docs/dispatch-integration.md:283` kit-heartbeat claim false; `source-map.md` growth; R12 |
| Error handling | **Reliability — LIN-1040 (not built)** | no report | — | partly API Quality's at the external contract; internally unowned |
| Resilience | **Reliability — LIN-1040 (not built)** | no report | — | unowned; `0152606d` (hang-up noticed whenever it happened) and `5c1e85ac` (timer clear) are incidental |
| Rate limits & pagination | **Reliability — LIN-1040 (not built)** | no report | — | unowned; read-side pagination partly Data & Fetch Architecture (registered, never run); `lib/db-indexes.js` index/sort fix `5bcd09be` incidental |
| Idempotency & consistency | **Reliability — LIN-1040 (not built)** | no report | — | unowned; terminal-marker retry (LIN-3208) can double-post with no Harbour dedupe |
| Observability | **Observability — LIN-1041 (not built)** | no report | — | unowned; the credential lane's `credential-invariant-sweep.js` remains the strongest instance; R15, R17 |

Newer siblings checked for plausible ownership (a META delta): **Seams & Tangles** owns none of the twelve (structure
only: F1 LLM & prompts ↔ Runs & dispatch, F2 run/ordering logic in renderers); **Performance / Scale** (`lib/periodicals.js:970`) and
**Data & Fetch Architecture** (`:978`) are registered and have never run, so they hold no evidence yet. **Reliability** (LIN-1040) and
**Observability** (LIN-1041) remain the natural home for the five unowned rows; this report mints nothing into that territory.

---

## Self-Audit — META surface

*Surface: META (`meta-integration-surface-maturity-review`) · core/happy-path: **3** (**4→3**) · configuration:
**N/A\*** (unchanged — a review methodology has no environment-configuration surface) · confidence **Medium**
(High→Medium)*

Required self-checks this run:

- **How many surfaces are stuck at Low confidence, and why?** Four rows carry a Low component (listed in the ledger):
  `mod-roadmap-trajectory` (Medium/Low, unchanged), `mod-task-create` (Low/Medium, unchanged), `mod-secret-scan`
  (Low/Medium, unchanged — a CLI/CI-consumed module whose served-page scan is the open High tracker item
  LIN-2850/2852), and `mod-observation-materializer` (Medium → Medium/Low *this run*: its retention/horizon rework,
  `f4bfce14`, `8ee0ac68`, `c572a681`, was not read in depth). Portfolio-wide, two of the ten aggregated dimensions
  stay Low or Low/Medium because their owning sibling is ~17 weeks stale (input & schema validation, testing — R6), five
  are unowned (R3), and read-side `periodicalId` presence is unverifiable from source (R9). Eight carried rows had their
  confidence cut this run and one was raised (`mod-scheduler`, on a passing roster test); each is cited in its
  Trend Ledger delta cell.
- **Did a real finding elsewhere land on a surface this review had rated as done?** **Yes — on 14 ids, against 2 in
  run 3** (`c14-members.md`). The population is 35 of 41 carried ids (26 with a core cell of 4, plus 9 with High
  confidence and a lower score = 85%), so a hit rate near 40% is the measurement. **Fixed (11):** `api-dispatch`
  (LIN-3440 `4563046c`), `api-jira-rest` (LIN-3561 `bf6f7507`), `mod-dispatch-queue` (LIN-3578 `4ee0a2c7`),
  `mod-kpi-audit` (LIN-3591 `91fca7dd`), `flow-autopilot-wake` (LIN-3592 `d2d7d818`), `mod-render-layer` (LIN-3579
  `1f8010a0`), `api-workspace-proxy` (`350242d5`, `0152606d`, `5c1e85ac`), `mod-prompt-template-system` (LIN-3378
  `dbf3ecb8`), `flow-account-connection-workspace-credential` (LIN-3323 `ea6f0c37`, LIN-3278 `1290ef75`), `flow-oauth`
  (LIN-3642 `bc875ddc`), `api-github-app` (LIN-3404 `15c3b42c`) — recorded as coverage caveats (run-3 precedent,
  LIN-2993), which change no score. **Open (3 findings on 3 ids)** — the only score-change candidates, and each moved
  *confidence* only (High → Medium) because none of the three is a core/happy-path defect: LIN-1410
  (`flow-bootstrap-token-exchange`, `lib/proxy-preamble.js:200`), LIN-3394 (`api-mongodb-storage`,
  `lib/db-indexes.js` has no `workspaces.urlKey` unique spec), the Rulings-feed item LIN-3281
  (`flow-operator-decisions`). Also on a lower-rated id: LIN-2850/2852 on `mod-secret-scan`. This is a scoring-model gap
  and the subject of R16. Plan-review `9bafe452` found the first draft of this very count (6 ids) was unbounded.
- **Is any dimension consistently N/A (dead weight) or consistently 0 (unmeasurable)?** Configuration is `N/A*` for
  **30 of 51** scored ids (22 of the 40 carried, unchanged; 8 of the 11 new, each justified in its ledger row). **No
  carried `N/A*` flipped**, so no N/A delta is hiding in the denominator; but eight more N/As on the new ids make
  "configuration" an even smaller, easier-to-be-high set, and a fall in the CFG denominator must not read as
  improvement. The three numeric new CFG scores (`api-runner-kit` 3, `flow-email-identity` 4,
  `mod-response-hardening` 3) are each cited. No dimension scores 0 anywhere; no 0–1 core score exists.
- **Are past top recommendations actually being acted on?** Directly against R1–R13: **R7 — no, unmoved, fourth
  cycle** (LIN-2576 `Todo`, zero commits reference it; the class widened). **R5 — yes, resolved** (LIN-3238/3239/3269/3706).
  **R10 — yes in code** (LIN-3408/3409 side-edit; LIN-3074 still Backlog). **R1 — yes, incremental** (LIN-3634 Done;
  LIN-3649, 2846, 1629, 2328, 1933 open). **R2 — partly** (alarms added, eviction still absent; LIN-2120 Backlog).
  **R9 — no** (LIN-2846 Backlog). **R3 — no** (LIN-1040/1041 Backlog). **R8 — mixed.** **R6 — yes** (16 editions).
  **R11 — yes** (7 jobs, roster pinned). **R12 — no, worsened.** **R13 — partly** (model improved, dual representation
  open). **R4 — closed and stays closed.** Of the 13 carried recommendations: 3 resolved or closed (R4, R5, R10), 3 improved (R1, R6, R11), 3 partly or
  mixed (R2, R8, R13), 3 did not move (R3, R7, R9) and 1 worsened (R12).
- **Did this run's sweep method (added + deleted + modified + cross-repo) catch what run 3's missed?** Yes for the
  class run 3's second-read named: the modified-not-added sweep (top-25 churn) refuses to file the ids named in *Scope & sweep accounting* item 3 "unchanged" without a cited reason,
  names 6 body-declared behaviour changes inside the "same behaviour" rebuild wave, and found `api-jira-rest` and
  `api-openrouter` movement that a name-based sweep cannot see; the cross-repo sweep found the runner-contract pin
  gap (R14) and the stored-not-shown auth-stop field (R15). The deleted-file sweep retired run-3 evidence cleanly
  (3 files; run 3's cited lines L80, L283–284, L367, L408, L426, L457, L541, L612). **What this review's own method got wrong:** the plan-review round found C9 and C14 unbounded
  and step 6 copying derived verdicts, and the primary-source re-derivation then overturned research on R12, R10's
  cause, R13's importer count and the halt-divergence framing (E9, E2, E10, E15). The score therefore falls to 3. The Tier 2 adversarial
  second-read's finding on this report is in the *Adversarial Second-Read* section below.

**Score drops to 3:** the review is catching its own optimistic scoring at scale (14 ids) and its own research was
wrong in five load-bearing places; as before, the secondary Completeness % does not improve as a measurement.

---

## Completeness % (secondary, noisy — read with care)

Portfolio core/happy-path average across all **51** non-META surfaces this run: **≈88.6%** (raw CHP points sum to
**180.75 of 204** possible, using each split MOD score's midpoint per run 2's convention: `mod-render-layer` 4 / 2-3
→ 3.25, `mod-kpi-audit` 4 / 3 → 3.5). Run 3: ≈89.2% (142.75 of 160 over 40). **Do not read this as improvement or
decline.** The named movements:

* `flow-free-tier-rate-limit` **+1** (2 → 3, R5 resolved; cites in its row) — the only carried score that moved:
  **+0.63 points** (1 of 160), so the 40 carried ids alone are **≈89.8%** (143.75 of 160).
* **The denominator effect, 40 → 51 (not 52; `mod-stage-router` folds):** eleven new surfaces enter at CHP
  3, 3, 3, 3, 3, 4, 4, 3, 3, 4, 4 = **37 of 44, ≈84.1%**, which lowers the portfolio figure by **≈1.2 points** by
  being added, a mechanical dilution of the same kind run 3 warned of ("an unweighted average hides a live gap"). Net:
  89.2% → 88.6%.
* Mover list for the new ids' 3s: `flow-run-evidence-closeout` (R7 member #3, LIN-3649), `api-runner-kit` (R14),
  `flow-email-identity` (LIN-3771), `flow-workspace-lifecycle`, `flow-consumer-liveness` (R15/R17),
  `mod-dispatch-entrance`, `flow-task-share`.
* No carried score fell. The META score fell 4 → 3 but META is outside the average.

The per-surface Trend Ledger is the primary signal; this number is not.

---

## Trend Ledger

Stable ids are carried forward **verbatim**; **none retired**. Scores are core/happy-path (CHP) and configuration (CFG)
on a 0-4 scale, `N/A*` = frozen, justified not-applicable. Confidence is this run's own honesty check, not a maturity
score. Delta is against run 3 (`e69e2cc9` close-out; scored at `b5c528c4`) for carried ids, `new` for this run's
registrations. **Every changed score or confidence carries a citation in its row.** Shape counts: **51 scored ids
(21 MOD / 10 API / 20 FLOW) + 1 META = 52 rows**; run 3's 41 ids are a strict subset.

### MOD surfaces (21: 17 carried + 4 new)

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `mod-provider-abstraction` | Name→instance registry decoupling provider specifics | 4 | N/A* | High | unchanged — `lib/providers/interface.js` 2 window commits, `index.js` 0; Seams F3 (Medium, "providers reach upward") is below the C14 High bar |
| `mod-periodicals` | Registry of recurring review templates | 3 | 3 | High | unchanged — registry now 16 entries (Seams & Tangles added, owns none of the twelve); `template.scope` still unconsumed; `lib/periodicals.js` 3 window commits |
| `mod-prompt-template-system` | Deterministic recommendation system: stage router + one path for every recommendation (no model writes a prompt; meta-prompt deleted) | 4 | N/A* | Medium | **confidence High→Medium**, score unchanged — definition changed under LIN-3300 (`19d7198a` deleted `lib/prompts/meta-prompt-template.js`; selection via `lib/stage-router.js`, `composeRoutedRecommendation` `lib/openrouter.js:1815`); 11 files folded (incl. the 4 `mod-stage-router` files); `dbf3ecb8` fixed four selector misroutes (LIN-3378); Seams F1 (High, structural, 23/23) open |
| `mod-roadmap-trajectory` | Velocity/execution-order/milestone layer | 3 | 3 | Medium/Low | unchanged score — not filed unchanged blindly: `lib/render-roadmap.js` rebuilt, `65969467` (LIN-3566) fixed two class-(a) defects, `9ee09ae9` changed the glyph source (`lib/render-roadmap.js:95`); no cited gain, so no move |
| `mod-render-layer` | ~20+ server-side page renderers, tiered | 4 / 2-3 | N/A* | Medium | unchanged score — rebuild `1f8010a0` (LIN-3579) was the one behaviour change; run page placed with `mod-task-page`; Seams F2 (High, structural) and Code Quality F-dashboard (HIGH, LIN-3742) open; `public/app.js`, `public/flight-companion.js` (LIN-3385/3401) folded here |
| `mod-dispatch-queue` | Queue storage + wake propagation, TTL, loop guards | 4 | 4 | High | unchanged — `4ee0a2c7` (LIN-3578) fixed a dropped digest-less abort (shipped defect, fixed: coverage caveat); `takeItem({targets})` (LIN-3622, `lib/dispatch-store.js:889-906`); 2 files folded |
| `mod-observation-materializer` | Durable read-model store + materializer | 3 | N/A* | Medium/Low | unchanged score; **confidence Medium→Medium/Low** — retention/horizon rework (`f4bfce14` LIN-3161, `8ee0ac68`, `c572a681` LIN-3163) was not read in depth; 4 files folded (run-paragraph lane) |
| `mod-kpi-audit` | Public KPI aggregation + workspace audit | 4 / 3 | N/A* | Medium | unchanged — `91fca7dd` (LIN-3591) fixed a public `/kpis` free-tier count leak (fixed: coverage caveat); daily rollup folds in (read back at `lib/kpi-stats.js:649-651`); 8 files folded |
| `mod-live-console` | Ambient cross-workspace activity feed | 4 | N/A* | Medium | unchanged — `lib/live-console.js` 5 window commits, none behaviour-declared; LIN-2993 caveat from run 3 stands but its stated cause is now open (post-pin incident correction) |
| `mod-scheduler` | Leader-safe CAS-lease job substrate (7 registered jobs + 1 bare hourly interval) | 4 | N/A* | High | **confidence Medium→High**, score unchanged — 4 → 7 jobs (`server.js:801/868/898/928/948/980/1009`), roster test passes 5/5 (`tests/unit/claude-md-scheduler-jobs-census.test.js`); `lib/scheduler.js` untouched; hourly cleanup still bare (`server.js:4599`, R11); `lib/hourly-cleanup.js` folds |
| `mod-observer-lane` | Observer signal modules | 3 | N/A* | Medium | unchanged — `lib/observer-efficacy-signal.js` still 0 production importers (E1, R8); `observer-pass` 2 window commits |
| `mod-ship-journey` | Waypoint-trail derivation + playback view | 4 | N/A* | Medium | unchanged — `lib/ship-journey.js`, `lib/render-ship-journey.js` 0 window commits |
| `mod-passage-planner` | Kickoff-prompt copy view | 4 | N/A* | Medium | unchanged — `lib/render-passage-planner.js`, `lib/prompts/passage-planner-kickoff.js` 0 window commits |
| `mod-task-edit` | Dedicated task-edit drill-down | 4 | N/A* | Medium | unchanged — `lib/render-task-edit.js`, `public/task-edit.js` 2 window commits each, none behaviour-declared |
| `mod-task-create` | Dedicated task-create drill-down | 4 | N/A* | Low/Medium | unchanged — `lib/render-task-create.js`, `public/task-create.js` 0 window commits |
| `mod-effort-readout` | Per-kind effort × cost × duration read-out (route + renderer) | 4 | N/A* | Medium | unchanged — `lib/effort-readout.js:597` stale runtime string is an R12 member (runner now reports effort, LIN-2567 Done) |
| `mod-secret-scan` | Repo + served-public-page secret scan (CLI + CI) | 3 | N/A* | Low/Medium | unchanged score — new runtime consumer `lib/mask-secrets-in-html.js` (folded; `dfa8e881` LIN-3389); outside the C14 population (3, Low/Medium) but an open High tracker item sits here: LIN-2850/2852 (served-page scan reports a zero-JS page clean; source scanner fail-open) |
| `mod-task-page` | Owner task page and its stored-data state endpoint; loader, view model (`run-view`) and run-steps renderer shared with the run page | 4 | N/A* | High | new — `routes/task-page.js:58` → loader (`server.js:3081`) → `lib/render-task-page.js`; client poll `public/prompt-section.js:999`; mount order pinned; 11 loader and 9 renderer unit files plus `task-page.spec.js`. CFG N/A*: no flag by design, `runnerReady` from the dispatch flag |
| `mod-dispatch-entrance` | Single decision seam for the four enqueue lanes; refusal mapping, target lists, task-mode event log | 3 | N/A* | Medium | new — `routes/dispatch.js:437`, `routes/proxy-dispatch.js:316,357`, `routes/proxy-kickoff.js:104` call it; held at 3: GET `routes/task-mode.js:83` has no client or lib caller, rate limit marked PROVISIONAL (`routes/task-mode.js:24`); the 1,812-line `lib/dispatch-entrance.js` was not read in full. CFG N/A*: only a test seam |
| `mod-library` | Public `/library` catalogue of repo docs with a safe markdown renderer, search, sitemap, robots | 4 | N/A* | High | new — mounted `server.js:2300`, routes `routes/library.js:133-176`, raw HTML escaped and href allow-list (`routes/library.js:33,36`); catalogue depends on `docs/` being deployed. CFG N/A*: no env surface |
| `mod-response-hardening` | Pinned public-origin resolver, HSTS, default `no-store`, hash-based CSP with nosniff and frame guard | 4 | 3 | High | new — `server.js:1070` HSTS, `:1075` cache, `:1078` security headers; `APP_CSP` has no script `unsafe-inline` (`lib/security-headers.js:65`); caveat Security #18 (Low): `nosniff` only on `text/html` (`lib/security-headers.js:79`). CFG 3: `PUBLIC_ORIGIN` unset falls back to the Host header (`lib/public-origin.js:27`); HSTS only under production+https |

### API surfaces (10: 9 carried + 1 new)

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `api-linear-graphql` | Linear GraphQL client + retry/timeout | 4 | 3 | High | unchanged — `lib/providers/linear/index.js` 3 window commits, none behaviour-declared |
| `api-github-app` | GitHub App install→callback→link flow | 3 | 4 | Medium/High | unchanged — LIN-3404 (`15c3b42c`, `lib/github-install-flow.js:664`): the install callback trusted `installation_id`; fixed (coverage caveat); LIN-3626 (`ccdf7260`) bounded the installations walk; `installation-pages.js` folds |
| `api-openrouter` | LLM client + live model catalog | 4 | 4 | High | unchanged — not filed on churn alone: `3ee41011` (LIN-2854, a pre-aborted signal still bought a recommendation, `lib/openrouter.js:1019,1259`) fixed; `279258c9`, `a89c43b7` additive; `lib/openrouter.js` is #22 by churn (31 commits, mostly LIN-3300) |
| `api-mongodb-storage` | Session/data storage, dual backend | 4 | 4 | Medium | **confidence High→Medium**, score unchanged — LIN-3394 open (High, Security #1): no `workspaces.urlKey` unique index in `lib/db-indexes.js`; `5bcd09be` (LIN-3163, post-deploy) fixed index keys vs sort keys (`lib/db-indexes.js:270-282`); `session-row-live` folds |
| `api-yap-chat-client` | HTTP client for the experimental chat server | 3 | 4 | Medium/High | unchanged — `lib/yap-client.js` 0 window commits |
| `api-egress-proxy-fetch` | Outbound HTTP proxy wrapper | 3 | 4 | Medium/High | unchanged — `lib/proxy-fetch.js` 0 window commits |
| `api-workspace-proxy` | Harbour's exposed source-neutral consumer API | 4 | 4 | High | unchanged — `350242d5` (LIN-3576: credential-resolution rejection → unlogged 500; unlanded description write returned 200, now 502, `routes/proxy-writes.js:259`), `0152606d` (hang-up, `lib/http-keepalive.js:125`), `d1085dcd` (halt owner gate) fixed (coverage caveat); 14 routers mounted (`routes/proxy.js:1277–1611`, was 11); `proxy-alarms`, `proxy-runner`, `proxy-runner-prompt` fold; run 3 CFG evidence `dispatch-repo-guard.js` retired (deleted `e1a80856`) |
| `api-dispatch` | Harbour's exposed Dispatch API | 4 | 4 | High | unchanged — `4563046c` (LIN-3440: GitHub issue ids rejected, `lib/dispatch-validation.js:267`) fixed (coverage caveat); head-moved close-out refused with 409 (`lib/dispatch-entrance.js:1159-1191`); `dispatch-feedback-validation` folds |
| `api-jira-rest` | Jira Cloud provider — read-only MVP | 4 | 4 | High | unchanged — `lib/providers/jira/adf.js` #9 by churn: `bf6f7507` (LIN-3561), `c2bc9a65` (LIN-3564) fixed; `e90b94c6` (LIN-3570) additive; `oauth.js` and the client untouched (`adf.js:121,181,713`) |
| `api-runner-kit` | Runner kit served to user machines: kit JS, setup page, kickoff prompt, contract fixture shared with simple-dispatcher | 3 | 3 | High | new — served `routes/runner-kit.js:27`, sha256-pinned `lib/prompts/runner-kickoff.js:89`, setup `routes/runner-setup.js:57`; held at 3: cross-repo contract pin unguarded (R14), `runCommand` cyc 132 (LIN-3741), doc/contract disagree on the kit heartbeat (`contract.json:289-290` vs `docs/dispatch-integration.md:283`); CFG 3: feature flags gate the setup page, base URL from `publicOrigin` |

### FLOW surfaces (20: 14 carried + 6 new)

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `flow-dispatch-lifecycle` | queue → take → feedback → terminal-marker | 3 | N/A* | High | unchanged — R2 core gap open (`lib/dispatch-store.js:948-967` `cleanup()` keys on `expiresAt`; `silentSince` no production caller); closers LIN-3364/3365/3366 add event-driven closure; 3 files fold |
| `flow-followup-resume` | `followUpTo` resume; consumer owns liveness | 4 | N/A* | High | unchanged — all follow-up branches now provision a resume credential (`lib/follow-up-dispatch.js:247`, `cd85cf69`); `follow-up-dispatch.js` folds; no shipped-defect fix found |
| `flow-autopilot-wake` | subscription + `waitForFollowUps` up-chain wake | 4 | 3 | Medium | unchanged — `d2d7d818` (LIN-3592) fixed `waitForFollowUps` never stamped on the pinned-verb arm (fixed: coverage caveat); `lib/ci-wake-sweep.js` (LIN-3661) is the new scheduled job (`server.js:980`); 3 files fold |
| `flow-oauth` | Linear, GitHub App, OpenRouter PKCE, Jira | 3 | 4 | Medium | **confidence High→Medium**, score unchanged — LIN-3642 (High, provisional, Done) landed on a surface rated High: `routes/auth.js:140` now requires a present `state` (`bc875ddc`); Jira leg still self-disclosed unproven (`lib/providers/jira/oauth.js:28-36`, unchanged); `routes/provider-auth-routers.js` folds |
| `flow-bootstrap-token-exchange` | Single-use bootstrap → working-token exchange | 4 | N/A* | Medium | **confidence High→Medium**, score unchanged — exchange reworked in-window (`061d19ca` LIN-3129, corrective `c943ab11`); LIN-1410 open (High, Security #2): bootstrap token inline in prompt text for non-`claude-code` harnesses (`lib/proxy-preamble.js:200`); `dispatch-session-redaction` folds (`608d8501`, LIN-3384) |
| `flow-recap-brief-cache` | Hash-based staleness invalidation | 4 | 3 | High | unchanged — `lib/recap-cache.js`, `lib/brief-cache.js` 0 window commits; `lib/recap.js` 1 |
| `flow-free-tier-rate-limit` | Quota check → use → footer → 429 (runs/day per account; hourly global cap) | **3** | 4 | Medium | **CHP 2→3**, **confidence High→Medium** — R5 resolved: one key builder `lib/free-tier-store.js:97`, read `:149` and write `:225` on the same key, pinned by `tests/unit/free-tier-store.test.js` and `free-tier-allowance-fronts.test.js` (LIN-3238 `ea4b4290`, LIN-3239, LIN-3269, LIN-3706 `0eb4a2d1`); held at 3 not 4: residual precompute spend (`lib/run-paragraph-hook.js:30-37`, Security #13 / LIN-3422) and a model rewrite landed in-window; CFG 4 unchanged (`lib/plan-allowance.js:150`) |
| `flow-periodicals-two-stage` | Stage-1 mint → Stage-2 self-conclude contract (report gate) | 3 | 3 | High | unchanged scores — R7 widened to 3 update-path Done writers (1 gated) + 2 ungated create routes; R1 improved (close-out lane) but the new Done path is ungated; R9 `periodicalId` still dropped on read; CFG held at 3 |
| `flow-account-connection-workspace-credential` | Account → Connection → binding → workspace credential (legacy owner-credential record still runs alongside) | 3 | N/A* | Medium | **confidence High→Medium**, CHP 3 unchanged — R13: seam improved (`lib/connection-credential.js`), dual representation open (LIN-2150 `Todo`); ~77 window commits; 9 files fold; not filed unchanged; adjacent to the post-pin credential rotation |
| `flow-cost-telemetry` | task-cost/model-pricing/weekly-budget/plan-fee lane | 3 | 3 | Medium | unchanged — `unpriced-models` folds; `3739a540` (LIN-3094) new pricing rows; no shipped-defect fix found |
| `flow-operator-decisions` | scan → task-decisions → unanswered → shelved → supersede | 4 | N/A* | Medium | **confidence High→Medium**, score unchanged (at ceiling) — second large window in a row (decision withdrawal on ticket close, LIN-3366 `993c3923`); `4ee0a2c7` (LIN-3578) fixed a dropped abort; Rulings-feed item LIN-3281 open (High, tracker, not re-verified by Security); `question-card` folds |
| `flow-account-merge` | identity-conflict resolution lane | 4 | N/A* | High | unchanged — `5388ce40` (LIN-1892 S3) adds merge paths (`routes/account-merge.js:136`); `account-group` folds |
| `flow-flight-companion-turn` | agent turn core → gate → transcripts → SSE stream | 4 | N/A* | Medium | unchanged — `3cb74ddc`, `089a9081` small fixes; `flight-companion-census-seed`, `run-proposals-store` fold |
| `flow-dispatch-halt` | operator halt request → store → consumer honouring | 3 | N/A* | Medium | unchanged — R10 resolved in code (0 stale hits); second consumer (`lib/runner-kit/runner.mjs:221` `haltAction`) diverges on an unknown mode as a **declared** contract row (LIN-3630); `poll-halt` folds; CHP held at 3 (a CI check that new modes are handled by the kit, `2a90f7b4` LIN-3650, was not read here) |
| `flow-run-evidence-closeout` | PR evidence, review ledger and the close-out box for a run, with a durable close-out event log | 3 | N/A* | High | new — wired end to end (`routes/workspace-api.js:3521,3655,3721` → `lib/close-out-readiness.js`; events `server.js:749`; UI `lib/render-session.js:521`; funnel `lib/milestone-funnel.js:211`); held at 3: its Done path is R7 member #3 (ungated `:3655`→`:815`) and the proxy/recommend/kickoff lanes lack the readiness re-check (LIN-3649); the press event stores all-zero `openItems` (`routes/workspace-api.js:3759`) against the store header (`lib/close-out-events-store.js:7-9`). CFG N/A*: only hard-coded TTLs/budgets (`lib/pr-state-store.js:28-35`) |
| `flow-email-identity` | Email magic-link sign-in (Resend/console/capture transports), account home, session options | 3 | 4 | Medium | new — wired (`routes/email-auth.js:399` send, `:521` confirm; SHA-256-only tokens, login-CSRF nonce); held at 3, not 4: the send limiter is in-memory and per-process (per-IP 10/15 min `routes/email-auth.js:83-90`, per-address 3/15 min `lib/email-auth.js:41-42`), and a sign-in spam bot sent 47 emails from 2026-10-20 (LIN-3771 In Progress); email sign-in was switched off in production on 2026-10-23 (post-pin note). CFG 4: off by default, console refused in production, `PUBLIC_ORIGIN` required (`lib/email-availability.js:66`) |
| `flow-workspace-lifecycle` | Workspace create/bind/remove: urlKey resolver and holders, registry, removal revocation, owner backfill, starter seed, account erasure | 3 | N/A* | Medium | new — backfill runs at boot (`server.js:294`), resolver feeds the bind arms (`lib/pat-session.js:93`), revoker built `server.js:668`; held at 3: registry is write-only (`lib/workspace-registry.js:2-3`, R8), erasure is scripts-only (`scripts/erase-account.mjs:35`), no unique `urlKey` index (LIN-3394, R-pointer). CFG N/A*: backfill has no flag by design, `CUTOFF` is a constant (`lib/owner-backfill.js:62`) |
| `flow-consumer-liveness` | Consumer heartbeat ingest/store and the scheduled advisory liveness-alarm sweep | 3 | N/A* | Medium | new — heartbeat doors `routes/proxy-runner.js:131` → store (`server.js:762`) → read `routes/proxy-reads.js:375`; sweep `server.js:948-949` → `routes/proxy-alarms.js:38`; held at 3: alarm-only (`lib/liveness-alarm-sweep.js:20-23`, R2), `authStoppedWorkspaces` stored not shown (R15), alarm store `cleanup()` uncalled (R17); no e2e or contract test. CFG N/A*: intervals are constants in `server.js` |
| `flow-agent-grants` | Proxy grant/scope vocabulary, `requireGrant` middleware, owner-only gates for mints and runner actions | 4 | N/A* | Medium/High | new — fail-closed and fully wired: `requireGrant('dispatch')` `routes/proxy-dispatch.js:315,356`, `routes/proxy-kickoff.js:103`; `requireGrant('take')` `routes/proxy-runner.js:83`; `resolveRunnerOwnerRefusal` `routes/dispatch.js:360`, `routes/proxy-halt.js:77`; stale comment `lib/proxy-scopes.js:12-13`; tokens outliving logout is Security #10 (LIN-3617/3618/3619). CFG N/A*: closed constants |
| `flow-task-share` | Owner-minted unguessable `/t/:token` read-only guest task pages; only the SHA-256 is stored | 3 | N/A* | Medium/High | new — owner UI `lib/render-task-page.js:670`, mint/list/revoke `routes/task-share.js:287,316,332`, guest page `:191`; no rate limit on the public endpoints by ruling (`routes/task-share.js:21-22`); stale comment `lib/guest-task-path.js:41-43` (sitemap/robots now exist, `routes/library.js:133,149`). CFG N/A*: no env surface |

### META surface

| id | What it is | CHP | CFG | Confidence | Delta (citation) |
|---|---|---|---|---|---|
| `meta-integration-surface-maturity-review` | This review's own methodology | **3** | N/A* | Medium | **CHP 4→3**, **confidence High→Medium** — see Self-Audit and R16: plan-review `9bafe452` found C9 and C14 unbounded and step 6 copying derived verdicts (4 blocking findings); 14 done/High ids hit by real findings vs 2 in run 3; research errata E1–E15 |

**N/A justifications.** Carried `N/A*`s (22 configuration cells, plus META) were re-verified in place; **none flipped**.
New `N/A*`s this run (8), each justified in its row and restated: `flow-run-evidence-closeout` (TTLs and budgets are
hard-coded constants, `lib/pr-state-store.js:28-35`), `flow-workspace-lifecycle` (backfill has no flag by design,
`lib/owner-backfill.js:62`), `flow-consumer-liveness` (sweep intervals are constants in `server.js`), `mod-task-page` (no
flag by design), `flow-agent-grants` (closed constants), `mod-dispatch-entrance` (only a test seam), `flow-task-share`
(no environment surface), `mod-library` (no environment surface). A future run flipping any of these to a numeric score
is itself a reportable delta, never a silent denominator change. The three new numeric CFG scores are
`api-runner-kit` 3, `flow-email-identity` 4 and `mod-response-hardening` 3.

---

## Citation re-points (every carried run-3 citation into a changed file)

Extraction rule, written down (`rerun-outputs.md` Q28, Q29): strict form
`grep -noE '[A-Za-z0-9_./-]+\.(js|md|mjs|txt|json):[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*'` on the run-3 report (132 raw,
**98 unique**), plus bare backticked `:NNN` resolved to the nearest preceding path in the same paragraph (36 new, 0
unresolved), plus the slash form `server.js:633/700/730/757` (3 new): **137 groups**. Each was content-checked at
`c5694b68` by a fresh-context sub-agent (the claim, not the line number), then every PASS anchor was re-verified
mechanically (110 of 111 clean, the one exception read by hand).

**PASS 110 · REVERSED 19 · RETIRED 7 · UNRESOLVED 1 = 137** (110 / 19 / 4 / 0 = 133 after excluding four rule false
positives that point at report lines). The non-PASS rows collapse into the reversed-claim families already listed
under R5, R10, R11, R7, R8 and R12, plus: router mounts 11 → **14** (`routes/proxy.js:1277–1611`), `BUILDER_VERSION`
16 → **18** (`lib/observation-sessions-store.js:184`), and `CLAUDE.md` now 110 lines (the cited content relocated to
`docs/architecture/source-map.md:143`). simple-dispatcher citations re-point to `halt.js:223`,
`dispatcher.js:39,1618-1651`, `reapers.js:38-39`. The full row table is `citation-repoints.md`.

---

## Ranked recommendations (machine-readable state)

Uncapped. R1–R13 keep their ids; new ones start at **R14**. Headline list (top 10 by priority): R7, R13, R1, R14, R2,
R9, R16, R15, R3, R12. No follow-up task or sub-issue is created from any row.

| id | surface | dimension | impact | effort | priority | status | owner |
| -- | -- | -- | -- | -- | -- | -- | -- |
| R7 | `flow-periodicals-two-stage` | configuration/enforcement | H | L | 1 | open, carried (unchanged, 4th cycle; widened to 3 writers / 1 gated + 2 create routes) | this review → LIN-2576 |
| R13 | `flow-account-connection-workspace-credential` | core/happy-path, auth & credentials | H | — (Security's) | 2 | open, carried (model improved, CHP 3, dual representation) | Security Review; LIN-2150 |
| R1 | `flow-periodicals-two-stage` | core/happy-path, configuration | H | M | 3 | open, carried (improved; LIN-3649 is the open lane) | this review |
| R14 | `api-runner-kit` | testing (contract), configuration | M | L-M | 4 | open, **new** | this review (boundary); Code Quality LIN-3741 (complexity) |
| R2 | `flow-dispatch-lifecycle` | core/happy-path | M | M | 5 | open, carried (partly improved) | this review → LIN-2120 |
| R9 | `flow-periodicals-two-stage` | configuration/data integrity | M | L | 6 | open, carried (unchanged) | this review → LIN-2846 |
| R16 | META | methodology | M | L | 7 | open, **new** (scoring-model gap at scale) | this review |
| R15 | `flow-consumer-liveness` | observability | M | L | 8 | open, **new** | Observability — LIN-1041 (not built) |
| R3 | portfolio/META | error handling, resilience, rate limits, idempotency, observability | H | — | 9 | open, carried (unchanged; owner map corrected) | Reliability LIN-1040 / Observability LIN-1041 |
| R12 | portfolio/META | documentation | L-M | L | 10 | open, carried (**worsened** 5 → 19) | Documentation Review |
| R8 | portfolio/META | cross-surface (landed-but-unconsumed) | M | — | 11 | open, carried (mixed; resolved instance retired) | this review |
| R6 | portfolio/META | sibling review cadence | M | — | 12 | open, carried (improved) | scheduling call |
| R11 | `mod-scheduler` | configuration | L | L | 13 | open, carried (improved; bare hourly interval residual) | this review |
| R17 | `flow-consumer-liveness` | core/happy-path (retention), documentation | L | L | 14 | open, **new** | this review (pointer) |
| R5 | `flow-free-tier-rate-limit` | testing (sibling-owned) | — | — | 15 | **resolved**, carried (residual precompute: Security LIN-3422) | — |
| R10 | `flow-dispatch-halt` | documentation | — | L (close LIN-3074) | 16 | **resolved in code**, carried | Documentation Review |
| R4 | feedback-widget image handling | security | — | — | 17 | **closed/resolved**, carried | — |

Pointers to existing tickets that are not new rows (owned elsewhere, named so the maintainer can triage): LIN-3394
(`urlKey` unique index, Security High), LIN-1410 (inline bootstrap token, Security High), LIN-3649 (readiness re-check on
proxy/recommend/kickoff lanes), LIN-3771 (email sign-in spam, In Progress), LIN-3741 and LIN-3742 (Code Quality),
LIN-3745 (meta-prompt residue), LIN-3074 (stale after R10), LIN-3422 (spend outside every cap).

---

## Plain-language read for the maintainer

The short version: the biggest recommendation from three runs ago is **still not fixed**, and it got bigger. The gate that
stops a review task being marked Done without its evidence still guards only one of three doors a person can walk an
issue's state through; the other two are the product's own edit page and, new this window, its close-out button. That is
now a four-cycle-old, two-line fix (LIN-2576).

The good news is real. The free-tier global cap that was broken for three runs (R5) is fixed and pinned by tests. The
halt-copy complaint (R10) is fixed in the code, so the ticket that tracks it can be closed. The scheduler list is complete
and a test keeps it honest. Sixteen sibling reviews have landed since the last run, including the first security read
since June, so a lot more of this report rests on current evidence than the last one did.

Three things are genuinely new. First, the runner kit now ships from Harbour to people's machines, and the two copies of
the contract between it and the dispatcher are byte-identical today with nothing in CI that would notice if one drifted
(R14). Second, the dispatcher's "I stopped polling this workspace" signal is stored by Harbour and shown nowhere; it was
the operator, not Harbour, who noticed during the database outage on 23 October (R15). Third, this review keeps rating
things "done" that real findings then land on: fourteen surfaces this window, three of them still open (R16). The review
marked its own method down for it.

Also worth knowing, after the pin: on 23 October every credential in Railway was rotated after a disclosure, and email
sign-in was switched off after a spam bot used it. Neither changed code; both are in a docs-only commit that this report
treats as a dated note.

**If you act on one thing:** close R7 (LIN-2576). **If you act on two:** add the cross-repo contract check (R14).

**No follow-up tasks have been created.** This is advisory; the decisions above are the maintainer's.

---

## Adversarial Second-Read

**Tier used:** **Tier 2 — a fresh-context sub-agent**, dispatched from the report-writing session, carrying no memory of
the report-writing turn. It was given only: the report path, the repo roots, the review windows
(`e69e2cc9..HEAD`; simple-dispatcher `3b1e734..HEAD`), the one-line remit and the question below — no findings, no
summary. It inspected the repos itself.

**Question posed, verbatim:** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's full answer, verbatim:**

> **(1) Largest item missed or misfiled: the simple-dispatcher consumer's own change set.** The report counts it (61 commits, 110 files, +10,956/−946) but inventories none of it. It records the cross-repo slices only: heartbeat (LIN-1952, LIN-3695), halt (LIN-3630), LIN-3208 retry, and the runner contract pin. About 1,500 lines of core consumer code changed in `dispatcher.js`, `hook.js`, `opencode-runner.js`, `reapers.js` and the new `signal-guard.js`. None of it is named in the report, in any ledger row, or in the cross-repo flow list. These are the strings I grepped for in the report and got 0 hits on: OpenCode (case-insensitive), `signal-guard`; LIN-3270 (the incident that caused `signal-guard.js`); LIN-3354, LIN-3355 and LIN-3431 (OpenCode progress and dead-runner work); LIN-3199 (bootstrap removal); LIN-3585 (dispatcher cycle cost); LIN-3209 (duplicate-launch detector), also absent from the report's cross-repo flow list; LIN-3135 (`itemId` on the broker-token mint).
>
> This is a hole against the remit, which says "every module… and cross-module flow in the system". The consumer is the other half of the dispatch flow.
>
> **(2) Evidence I verified.** The simple-dispatcher window `3b1e734..HEAD` has 61 commits. `git diff --stat` shows `dispatcher.js` +395, `hook.js` +198, `opencode-runner.js` +323 (now 1,886 lines), `reapers.js` +536, and `signal-guard.js` +344, new. That is 1,506 insertions across those five files. `signal-guard.js:1-20` describes LIN-3270. A recycled pid sent a group SIGTERM that "silently took the whole fleet down twice (2 Oct 2026)". The fix is a new safety boundary around every process-group kill. It is a production incident, and the report gives it no mention. Other consumer commits in the window (none cited in the report): `5a6815f` LIN-3431: end dead OpenCode runners. `d8e544e` and `e8de8fd` LIN-3354/3355: OpenCode judged on progress, with a no-progress abort. `1deb625` and `7ca5e23` LIN-3199: the SUMMARIZING phase deleted, every launch starts EXECUTING. `d186892` LIN-3585: flat dispatcher cycle cost. `27b9de7` and `c027675` LIN-3209: duplicate-launch alarm. The report's grounds for excluding the consumer from the ledger (lines 164-173) are `template.scope` being unread and LIN-1933 being open. Those concern target-repo selection, not inventory coverage. The report scores only the part of the consumer served from Harbour (`api-runner-kit`). The report's own summary shows its sweeps were all Harbour-side: 134 added files, of which 120 are in `lib/` and 14 in `routes/`. The consumer was swept only for LIN-id overlaps with Harbour commits. The consumer-side window changes also touch the cross-repo flows the report does score (`flow-dispatch-lifecycle`, `flow-followup-resume`, `flow-bootstrap-token-exchange`). Their ledger rows are marked "unchanged" or "no shipped-defect fix found" with no consumer-side evidence.
>
> **(3) Classification:** coverage gap. It is partly a declared scoping decision, but it is miscalibrated: the exclusion is justified on the wrong grounds, and the consumer-side evidence for Harbour-scored flows is missing. It is not a factual error.
>
> **(4) Confidence:** about 60% that this is the largest miss. The weaker point is that the report does explicitly declare the consumer "in discovery, out of the ledger", so a reader could call it a deliberate choice rather than a miss.
>
> **Secondary items, not the headline:** The ledger has no row for the 10 added `public/` files (`public/task-page.js`, `public/close-out.js`, `public/runner-setup.js`, `public/workspace-kpis.js`, `public/chart-helpers.js`, `public/form-behaviours.js`, `public/question-cards.js` and three CSS files). The importer-dispositions sweep covered `lib/` and `routes/` only. `experiments/` (570 added files, +514k lines) and `scripts/eval` / `scripts/code-shape` (about 100 added files, +67k lines) are never mentioned; they are probably not product surfaces, so this is low severity. Harbour commit `794c625e` (LIN-3211, the run-step rung sends a harness) is not cited.
>
> **Top-ranked recommendation (R7, the periodical Done gate):** it looks right. I re-checked `origin/main` and `checkPeriodicalReportGate` is still called only at `routes/proxy-writes.js:374`. `routes/workspace-api.js:815` (`defaultMarkDone`) and `:3455` (the edit route) both call `provider.updateIssue` with no gate. It is a reasonable first row, though it is not the largest thing in the window.

**Verification by this report's author (content-checked).** Reproduced: the five-file stat is `+1506/−290`
(`git diff --stat 3b1e734..bb1da78`); `signal-guard.js:1-12` states the LIN-3270 incident as quoted; the commits for
LIN-3354/3355/3431/3585 exist in the window; 10 files were added under `public/`. The report was silent on all of it.
The finding is accepted as accurate; it is partly a declared scoping choice, and the stated grounds were the wrong ones.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place

The reader's answer differs from the report's own #1 finding (R7), which the reader endorsed. **Fixed in place, no
recommendation minted** (a coverage gap, not a code defect, and this review mints no fix-work): (1) *Scope & sweep
accounting* item 4 gains the consumer-side change inventory and names the `public/` added-file sweep gap; (2) the
*Consumer-repository decision* now says the ledger's unit is the Harbour-served surface, so consumer internals are
unscored by design, not by the `template.scope` reasoning alone. No score or id changed.
