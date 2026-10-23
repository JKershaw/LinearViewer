# Comprehension-Debt Review — run of 2026-10-23

**Task:** LIN-3825 (periodical run 4; the first since LIN-895 on 2026-07-01). **Mode:** review only. No code, config or docs under review were changed.
**Grounding:** LinearViewer `76fc3e91`, simple-dispatcher (SD) `1798790`. Both `main` = `origin/main`, and neither moved between the ticket seed and this report. Every `file:line` below was read at those SHAs.
**Prior runs:** 2026-06-12 (LIN-439), 2026-06-25 (LIN-674), 2026-07-01 (LIN-895, `6e5d928`). SD had never been read by this series.
**Evidence:** `docs/reviews/_evidence-2026-10-23/comprehension-debt-*` (rationale diff and counting method, landing-status grep with verdicts, heartbeat spike).

## Headline

1. **The design-first rebuild wave kept its rationale.** Of 14 rebuilt modules, 12 drop no ref that is gone from HEAD. The two exceptions (pipeline-loops, proxy-writes) are Low. The forward risk is the real finding: **nothing enforces the retention rule** (N4), and the queued rebuilds (LIN-3742, LIN-3755, LIN-3608) carry no retention wording.
2. **The top finding is a new class that no earlier run looked for: landing-status comments never retired (N1).** 13 comments (11 found in research, 2 more found when verifying the unverified hits) say live code is "INERT", "no production caller" or "read by nothing". Most sit on the credential-minting and dispatch core, and each is wrong in the direction that lowers a reader's caution.
3. **One cross-repo contract has no owner on either side (N3):** Harbour regex-parses SD's free-text `[working]` beat. A reword in SD passes every SD test and silently blanks Harbour's live console. The documented `state:'running'` is unreachable.
4. SD, read for the first time, is largely recoverable. Tag sampling is healthy (about 9 in 10 tags paraphrase their constraint in every module), and three of four CLAUDE.md invariants are recoverable at the code sites.

## Findings (severity-ranked)

### N1 — `landing-status-claims-never-retired` — **Medium+** — *new*
Code lands in beats (S1/S2, PR2/PR3, C1/C2). Each beat writes a present-tense status into the code. The next beat wires the code up and does not retire the line. **Cold-hand-off test: fails** on the credential and dispatch core.

Confirmed false at HEAD (each by grepping callers):

| Site | Claim | Reality |
|---|---|---|
| `lib/proxy-tokens.js:339-340` | `mintGrantBootstrap`: "INERT in S1: no production caller" | called at `lib/proxy-preamble.js:478`, `routes/proxy-tokens-admin.js:202` |
| `lib/proxy-tokens.js:124-126` | `exchangeBootstrapToken` routes through `createToken` "until beat 3" | already calls `this.#mint` (`:551`, research) |
| `lib/dispatch-store.js:601` | `getGrantDeclaration`: "Inert: no production caller yet" | `lib/proxy-preamble.js:744`, `routes/dispatch.js:1256` (research), `lib/dispatch-store.js:2649` |
| `lib/proxy-preamble.js:692` | `provisionResumeCredential`: "Inert: no production caller yet" | `lib/follow-up-dispatch.js:247`, `lib/wake-credential.js:106`, `lib/chat-tools.js:1882`, `lib/dispatch-entrance.js:953`, `routes/dispatch.js:1316` (research) |
| `lib/proxy-preamble.js:444` | declared mint "Inert: no production caller passes a non-empty `declaredGrants` yet" | **added by this run:** `lib/dispatch-entrance.js:739,776`, `routes/workspace-api.js:3095` pass `['dispatch']` |
| `lib/dispatch-store.js:2017-2018` | `expandCascadeAborts`: "INERT until a caller issues a cascade — nothing does yet" | `lib/dispatch-entrance.js:1078` via the public `cascade:true` verb, documented to agents in `lib/proxy-instructions.js:797` (research) |
| `lib/dispatch-store.js:30`, `:361` | "the recursive walk is a later beat" | the walk exists at `:2027` |
| `lib/owner-credential-store.js:9-11` | "touches no read path" | `ownerCredentialStore.get` is read at `server.js:1272,2198,2896` |
| `lib/connection-binding.js:16-18` | the side-table is "read by nothing" | consumed at `lib/workspace.js:13,278,284`, `lib/connection-secondary-remint.js:31,59` |
| `routes/held-connection.js:27` | "`mode=new` is beat 4" | handled at `:158`, `:277` |
| `lib/account-workspace-store.js:139` | `getWorkspaceOwnerAccountId`: "LIN-1892 adds no production caller" | **added by this run:** `lib/workspace-owner.js:77`, `lib/connection-credential.js:1452` |
| SD `opencode-liveness.js:7-9` | "C1 IS INERT: nothing in reapers.js calls `readOpenCodeLiveness`" | imported at `reapers.js:38` and used at `:1890`; `reapers.js:37` itself says "C1's seam was inert until this commit" |
| SD `reapers.js:1743-1745` | `resumeOpenCodeOverNativeId`: "LANDS INERT — nothing calls this yet" | default dep at `reapers.js:1893`; referenced at `:2160,2506,2800` |

**Bound.** Lexical grep over `lib routes` and SD `*.js` (pattern in the evidence file), then a caller check per hit. A status claim worded differently ("S1 only", "PR3 will") escapes it, so the class may be larger. Result: 13 false, 1 likely false and not fully re-derived (`lib/prompts/collective-participant.js:126`; `routes/collective.js:545` threads a user-supplied character), the rest true or design-status. Verdicts per hit are in `comprehension-debt-landing-status-grep.txt`.

**F7 folds in** (same shape: comments describing a Pipeline page that no longer exists): `public/common.js:510,729,2436`, `public/sessions.js:13-14` (points at deleted `public/pipeline.js`), `public/recap.js:10`, and user-visible `lib/render-styleguide.js:407`. The Documentation Review of 10-21 does not own it (it hands module rationale to this series, `documentation-review-2026-10-21.md:93`).
**Fix:** restate each line in the present tense or delete it. **Follow-up: LIN-3827.**

### N2 — `entrance-open-questions-offsite` — **Medium** — *new*
`lib/dispatch-entrance.js:40-42` points to "the PR (the '(d)' items)" with no number. `LIN-3608`, which tracks the eight frozen lane divergences, appears nowhere in the file (`grep -c LIN-3608` gives 0). Only open questions 1 and 4 (`:726-728`) and the new (d) at `:1571` are marked at their sites. Questions 3, 5, 6, 7 and 8 sit at sites with history but no "frozen, undecided" note (research: `:244-256` vs `:173-176`, `:1274-1280`, `:1091-1097`, `:548-551`, `:648` vs `:657`; the site list is reader-sourced and not re-derived). **Cold-hand-off test: fails** on a critical path: tidying the lanes to agree changes behaviour that needs a ruling. Code Quality 10-20 graded the file clean on behaviour; this is about pointers only.
**Disposition:** no new ticket. Added to LIN-3608 as a "first step" (comment posted). Its resolution makes the markers moot.

### N3 — `working-beat-grammar-unowned` — **Medium** (cross-repo; supersedes F4)
- **Producer:** SD `heartbeat.js:338-360` (`buildHeartbeatMessage`), `:78-83` (`formatBreakdown`, the `×`). It names no consumer.
- **Consumer:** `lib/session-telemetry.js:127-136` (`HEARTBEAT_HINT`, `TOOL_COUNT_RE`, `ELAPSED_RE`, `BREAKDOWN_RE`, `TOTAL_RE`). It explains its regexes and never names the producer. Downstream: `lib/live-console.js`, `lib/wall-clock-summary.js:98`, `public/live-console.js:161`.
- **No test spans the two repos.** `lib/runner-kit/contract.json` covers the host heartbeat route, not this free text.
- **Spike (re-run this session, `comprehension-debt-heartbeat-spike.out.txt`):** `[working · editing] 6 tools in 32s: Edit×4, Bash×2 · 40 total` parses (`state:null`); `[working] no tool calls in 5m · 40 total` gives `state:'idle'`; `[working · running] Bash running for 3m` gives **null**; `[stalled?] …` gives null. So `state:'running'`, documented at `lib/session-telemetry.js:144` and `public/llms.txt:769`, is unreachable against the real producer.
- F4's old mitigation ("no UI consumer") no longer holds: `public/live-console.js:161` reads `hb.state === 'idle'`.
- **Cold-hand-off test: fails.** Rewording "tools in" or `×` to `x` in SD's pure `heartbeat.js` passes every SD test and empties Harbour's live-console activity and wall-clock attribution.
- **Constraint note:** the grammar is the contract. Keep it at both ends, and state the `state` vocabulary truthfully. Related: N8 (stale line-number cites). **Follow-up: LIN-3828.**

### N4 — `rebuild-retention-rule-unenforced` — **Medium** (forward risk)
The wave itself kept its rationale (table in `comprehension-debt-rebuild-rationale.md`; counted, not asserted). But the retention rule exists only as ticket wording plus hand scoring:
- The rule: `docs/papers/harbour/rebuild-round.md` (Method), `docs/theseus-method-long.md:181,346`.
- `scripts/code-shape/verbatim-core.mjs:4` deliberately ignores comments; `shape-core.mjs:9` counts `commentLines` but nothing gates on the count; `perturb-core.mjs:19-24` showed that blanking all comments broke nothing.
- Nothing in `.github/workflows/test.yml` (`grep -niE "retention|dropped ref"` over `scripts/code-shape` and `.github/workflows` matches only an artifact `retention-days: 7`).
- Rung 7 (LIN-3596) claimed "none dropped" and dropped LIN-772 (the counter agrees: 1 dropped). It was caught by hand (`theseus-method-long.md:223`).
- The queued rebuild tickets LIN-3742, LIN-3755 and LIN-3608 have no retention wording (checked in this session).

The counter used here (acorn `onComment`, ref set diff per commit) is already a working starting point. **Follow-up: LIN-3829**, plus a comment on each of LIN-3742, LIN-3755, LIN-3608.

### N13 — `runStallFailsafe-unsafe-to-modify` — **Medium** (SD) — *added after the second-read*
SD `reapers.js:1854-2832` is one function of about 979 lines, of which 500 are `//` comment lines. It holds every arm that fails, re-fires or kills real sessions (transcript heal, verify and exhausted-refire, the opencode hold-expired arm, broker re-arm, blocked-child shielding) behind about 15 injected dependencies. Its comments are mostly provenance (LIN-1125, 1358, 1397, 2446, 2720, 2738, 3270) rather than a constraint a newcomer can act on, and nothing at the function says which arm's ordering is load-bearing. **Cold-hand-off test: fails** (inferred from size and comment style; the ordering constraints were not traced by this run). N7 filed the same module as Low "rationale inflation" and cited only `:1139-1185`; that understated it. A stale cite sits in the same file: `reapers.js:36` says "runStallFailsafe's opencode arm (:1754)", but `:1754` is inside `refireSentinelOverResume` (starts `:1661`); this is another N8-class instance.
**Fix:** a short ordered list of the arms and which orderings are load-bearing at the top of the function, and cite by symbol at `:36`. Complexity itself is Code Quality's (as for LIN-3741 on the runner kit). **Not promoted** (follow-ups are capped at 3 and N13 was found after they were minted); next run should promote it if LIN-3827 does not absorb the `:36` cite.

### Medium-Low / Low — recorded, not promoted
- **N5 `phase-graph-unenforced`** (SD, Medium-Low). `isLegalTransition` (`phases.js:135`) has no runtime caller; only `test/phases.test.js` uses it. This is stated once, mid-table at `phases.js:104`. The header (`phases.js:7-8`) says invariants "are checkable" and SD `CLAUDE.md:27-31` says "the rules live in one place". A reader adding a `.phase =` write assumes a guard exists. Fix: say "documentation-only" in the header and in CLAUDE.md.
- **N6 `connection-model-decision-codes-offsite`** (Low-Medium; reader, not re-derived). About 90 LIN-3124 codes (D1–D18, S2–S8, PR2/PR3) across `lib/connection-*.js` with no key, colliding with LIN-3125's C1/F2 codes (`routes/held-connection.js:5-16`). About two thirds paraphrase locally; D6/D15 are test-pinned. Fix: a one-screen code key.
- **N7 `reapers-rationale-inflation`** (SD; reader, not re-derived; see N13 for the larger reapers.js issue). `reapers.js:1139-1185` is a 47-line block that buries the BLOCKED-child shielding constraint in provenance; also `:1503-1510`, `:1950`. About 107 lines across 4 SD modules carry plan labels (C2/§4/D4/A3/R3/E1) whose plans are not in the repo.
- **N8 SD marker/resume cites by line number.** Confirmed: `feedback.js:19-22` cites `dispatch-terminal.js:53`, but `WAKE_FEEDBACK_REGEX` is at `lib/dispatch-terminal.js:63`. `lib/dispatch-terminal.js:98-115` cites `hook.js:~826/~837` (reader: moved about 400 lines, not re-derived). Fix: cite by symbol. Folded into LIN-3828's optional scope.
- **N9 `pipeline-loops-5d-residue`.** 18 refs dropped (the paper's "17" is net of the added LIN-3384). LIN-2187 is gone from HEAD code and survives only in `tests/unit/pipeline-loops.test.js:2112`. The singleton anchor-bucket reason (`lib/pipeline-loops.js:71-74,489`) and "lineageId never replaces loopId" (`:341-372`) are reader-reported losses, not re-derived.
- **N10 stale twin pointers** after moves (`lib/dispatch-factory.js:999-1000`; `routes/proxy-compute.js:108,188`, `routes/task-chat.js:58`). Owned by Code Quality 10-20 (`code-quality-review-2026-10-20.md:104-106`); cross-reference only.
- **N11 `relay-github-redirect-gap`.** `lib/proxy-wire.js:122` allowlists `private-user-images.githubusercontent.com`, but `routes/proxy-reads.js:439-446,569` refuses every redirect, and the note explaining this was dropped in `06ec62b7` (LIN-3569). Live redirect behaviour is unverified.
- **N12 proxy-writes residue.** The counter finds LIN-1976 and LIN-871 gone from HEAD after `350242d5`. Both were minor (a "not LIN-1976" disambiguation and a research cite for `attachmentCreate`); behaviour unchanged.
- **Smaller Lows:** `routes/dashboard.js:1-41` header omits routes including the mutating proposals apply/decline (`:1415`, `:1486`); `routes/github-auth.js:7-11` and `routes/github-projects-auth.js:6-11` describe the pre-LIN-735 entry; `lib/runner-kit/runner.mjs:71-73` watchdog thresholds have no stated reason; `lib/workspace-token-resolver.js:200-235` is inflated; `lib/dispatch-store.js:39` names an unnamed "sweep ticket"; SD `terminal-driver.js:1-22` says "exactly FIVE operations" and `probeHealth` is the fifth verb at `:533` (reader: lists four); SD LIN-3585 is not restated at the `reapers.js` `loadState()` sites (`:189,688,1896,2914,3153` all read `const state = loadState()`), mitigated by `test/state-cache-trap.js`; `public/runner-setup.js:43` vs `lib/runner-kit/runner.mjs:670` (a blank-line dependency in the credential block).

### Not a finding
- `lib/runner-kit/contract.json` vs SD's copy differ (Harbour 38 rows, SD 24; 10 `auth` rows from LIN-3699 and 4 `store` rows from LIN-3805). It is a same-day lag already ticketed as LIN-3809 and LIN-3823, with the re-pin procedure stated at SD `test/runner-contract.test.js:10-28`. The only residue is that `contract.json:3` "Byte-copied to…" reads as a standing fact.
- Inline markers: 0 TODO/FIXME/HACK/XXX in LinearViewer `lib routes public` (only the constant `TODO_TIER_CAP`) and 0 in SD source, as in the 10-21 Documentation Review. (Reader-sourced; not re-run.)

## Carried-forward ledger
| ID | Status at HEAD | Decision |
|---|---|---|
| **F2** composite-sort-key magnitude | 4 members, not 2: `lib/swim-graph.js:113` (`* 100000`), `lib/swim-lanes.js:279` (`* 1000000`), and the client mirrors `public/swim.js:251` and `:894` that every prior run missed. `public/swim.js:24-25` says "Keep in sync". Layout-only. | **Retired.** The tenure call: four cycles of a cosmetic item is a ledger tax, so the wait is declared indefinite. Re-open only if the idiom leaks into a non-layout path. Side observation for Code Quality: `swim-lanes.js:279` returns `rank*1e6 + Infinity` for ids with no index, which collapses the rank ordering. |
| **F3** provider label capability, not execution path | Trap still exists at Linear (`lib/providers/linear/index.js:2244-2245`), Local (`lib/providers/local/index.js:669-677`) and GitHub (`lib/providers/github/index.js:871-883`). Jira carries the note (`lib/providers/jira/index.js:1284`). | **Re-scoped to Low, not closed.** Comment posted on LIN-692 (still Backlog) with the three sites. The 06-25 "silent 422" claim was overstated: existing tests pin `supports()`. |
| **F4** `[working]` grammar | Gained a UI consumer and a dead `'running'` arm. | **Merged into N3.** |
| **F5** telemetry cross-check policy | `lib/session-telemetry.js:104-124`. Importers grew to 19 in `lib routes`, but none reads `crossCheck`; the only mentions are the default shape at `lib/pipeline-loops.js:240` and `lib/digest-feedback.js:497`. | Unchanged, Low. |
| **F6** GitHub `fetchRecommendationContext` `_opts` | Site moved to `lib/providers/github/index.js:410`; the leaf-case rationale is stated at `:405-408`. | **Retired.** |
| **F7** pipeline-removal orphaned references | 6 sites unchanged (see N1). | **Folded into N1 / LIN-3827.** |
| **GitHub App deferral** (LIN-708/709/711/712/713) | Walked: clean at the code sites (`lib/providers/github/index.js:28-39,198-213`, `:600-622`, `:540-541`; `lib/github-install-flow.js:810-820`). One Low: pre-LIN-735 route headers. | **Closed.** (Reader-sourced; not re-derived line by line.) |

## What was added to the scope, and why
- A whole-tree grep for the landing-status class (N1) in both repos, because the rebuild lead pointed at *losses* and this class is the opposite failure (claims that outlived their truth). It found the top finding.
- Credential-holding and destructive modules the seed did not list: `lib/runner-kit/broker.mjs`, `lib/owner-credential-store.js`, `lib/account-erasure.js`, `lib/email-auth.js`, `routes/proxy-token-exchange.js`, `lib/require-grant.js`, `routes/held-connection.js`. Clean apart from their N1/N6 lines.
- The ref-drop check beyond pipeline-loops: the counter covers 16 commits, which found the proxy-writes residue (N12).
- A re-check of the "unverified" N1 members. Two proved false (`proxy-preamble.js:444`, `account-workspace-store.js:139`), one is likely false, and the rest are true or design-status.

## New territory walked (clean passes recorded as passes)
LinearViewer (reader-sampled, not re-derived unless a line cite is shown above):
- **Clean:** Jira `oauth.js` (exemplary, `:11-26`, `:86-115`, `:270-279`), `index.js`, `client.js`, `adf.js`; `workspace-token-resolver.js` (apart from inflation); `proxy-scopes.js`; the halt path (`lib/workspace-halt.js:28-33,51-56`, `lib/poll-halt.js:41-44`, `routes/proxy-halt.js:62-71`); Flight Companion (`routes/flight-companion.js:39-46`, `routes/proxy-flight-companion.js:11-19`); `unanswered-decisions.js`, `question-card.js`, `close-out-readiness.js`, `ci-wake-sweep.js` (model header at `:6-29`); the why in `runner.mjs` (`:9-21,61-68,211-222`); `dispatch-store.js` substance (`:1048-1052,2422-2440`); `routes/dashboard.js` handlers.
- Tag sampling: 8 of 8, 8 of 8, 7 of 7 and 15 of 15 sampled tags paraphrase their constraint. **No bare-ticket-reference debt found in these modules.**
- Rebuilt modules: see the evidence table. `lib/plan-allowance.js:1-40` is a model header.

simple-dispatcher (first read by this series):
- **Recoverable:** `dispatcher.js`, `hook.js`, `config.js`, `opencode-runner.js` (`:1300-1309` states the cross-repo resume dependency), `terminal-driver.js`. Tag sampling: about 9 of 10 paraphrase in every module. Comment density is high (hook 50%, config 53%, dispatcher 46%, reapers 43%); see N7 for the inflated corner.
- **CLAUDE.md invariants at their code sites:** LIN-459 (no snapshot across an `await`): yes (`reapers.js:10-12,3276-3278,3360-3366`, `dispatcher.js:200-203`, `hook.js:224,266,322,330`). LIN-3585 (shared read-only `loadState` snapshot): partial (present at `hook.js:1612`, `dispatcher.js:1732`, `host-heartbeat.js:11`; absent at the `reapers.js` sites; trap-tested). LIN-2446 (no auto-relaunch): yes (`watch-restart.sh:4-8`). Phase graph: no (N5).

## Class list and bounds
| Class | Bound | Members |
|---|---|---|
| C1 stale landing-status claims | lexical grep + caller check per hit (would be larger if claims use other wording) | 13 false + F7's 6 sites; 1 likely false; remainder true or design-status |
| C2 unmarked entrance divergences | LIN-3608's numbered list vs in-code markers | Q3, Q5, Q6, Q7, Q8 + header pointer |
| C3 cross-repo text contracts | Harbour regexes over SD-emitted text | `[working]` beat (no cite), terminal/WAKE markers (one-way cite, stale line), resume marker (partial), host-heartbeat fields (cited), credential block (intra-Harbour) |
| C4 rebuild commits | 16 commits for the ticket list in §2a | 14 modules (evidence table) |
| C5 F2 sort keys | grep `\* *1000+ *\+` over `lib routes public` | 4 sites (re-run this session) |
| C6 F3 gate sites | grep `addLabel` in `lib/providers/*/index.js` | linear, local, github unnoted; jira noted |
| Unbounded | not yet in source | queued rebuilds LIN-3742, LIN-3755, LIN-3490 |

## Follow-ups (3) and comments on existing tickets
| ID | Covers |
|---|---|
| **LIN-3827** | Retire stale landing-status comments (N1 + F7) |
| **LIN-3828** | `[working]` grammar notes at both ends, truthful `state` vocabulary (N3, N8) |
| **LIN-3829** | Dropped-reference retention check for rebuild PRs (N4) |

Searched first (`/search`: "landing-status", "INERT claim", "no production caller", "working beat grammar", "heartbeat grammar", "session-telemetry parseHeartbeat", "retention check rebuild", "code-shape retention"): no existing ticket covers these three. Comments instead of new tickets: N2 on **LIN-3608**, F3 on **LIN-692**, retention wording on **LIN-3742** and **LIN-3755**. Not duplicated: LIN-692, LIN-3608, LIN-3741, LIN-3809, LIN-3823.

## Trend ledger
| Run | Date | HEAD | Findings promoted | Notes |
|---|---|---|---|---|
| 1 | 2026-06-12 | `f746725` | baseline | LIN-439 |
| 2 | 2026-06-25 | `8de7da5` | F2–F6 | LIN-674 |
| 3 | 2026-07-01 | `6e5d928` | F7 new; F2–F6 carried | LIN-895 |
| 4 | 2026-10-23 | `76fc3e91` / SD `1798790` | N1–N4 new (+ N5–N13 recorded); F2, F6 retired; F3 re-scoped; F4 merged; F7 folded | ~2,650 commits since run 3; SD read for the first time |

## Notes for the next run
1. Re-run the C1 grep and re-check LIN-3827. If it landed, the class should be empty. Widen the pattern ("S1 only", "PR3 will", "for now") because the bound is lexical.
2. If LIN-3829 landed, use its check instead of the evidence counter. If a rebuild of LIN-3742/3755/3608 merged, diff it first.
3. Re-run `heartbeat-spike.mjs` after any change to `heartbeat.js` or `session-telemetry.js`.
4. Verify the reader-sourced items this run did not re-derive: N2's site list, N6, N7, N9's lost reasons, the `render` cluster's 7 dropped refs (`1f8010a0`), SD `hook.js` cites in N8.
5. Verify `lib/prompts/collective-participant.js:126` and `lib/periodicals.js:94` for N1.
6. The report's counter cannot judge whether a retained ref still carries its reason; sampling is still needed.
7. Do not re-flag N10 (Code Quality 10-20) or the `contract.json` lag (LIN-3809, LIN-3823).

## Adversarial Second-Read
**Tier:** 2 (a fresh-context sub-agent, given no conclusion, verdict or finding of this report; it named its own candidate from the repos before reading the report).
**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (condensed, no changes of substance):**
- Own candidate before reading the report: `simple-dispatcher/reapers.js:1854-2864`, `runStallFailsafe`, one function of about 1,000 lines with about 8 arms, ~525 comment lines and ~15 injected dependencies; comments carry provenance, not actionable constraints. It also found a stale cite, `reapers.js:36` ("opencode arm (:1754)").
- Missed or misfiled: the report never names `runStallFailsafe`; it filed the module's problem as N7 (Low, "inflation", reader-sourced) pointing only at `:1139-1185`.
- Citation spot-check: 10 of 10 checked claims hold (N1 rows for `proxy-tokens.js:339-340,124-126`, `dispatch-store.js:601`, `proxy-preamble.js:692`, `opencode-liveness.js:7-9`, `reapers.js:1743-1745`; `phases.js:104`; `feedback.js:19-22` vs `dispatch-terminal.js:63`; `server.js:1272`). `connection-binding.js:16-18` consumers were not verified by the reader.
- The reader judged N1 real and well evidenced.

**Author's check of the reader's claim:** `runStallFailsafe` spans `reapers.js:1854-2832` (979 lines, 500 `//` comment lines in that range; the reader's 525 included lines past the function end). The `:36` cite is stale (`:1754` is inside `refireSentinelOverResume`, which starts at `:1661`). Both confirmed. The size and comment-style claims are verified; "unsafe to modify" remains an inference.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

The report was corrected in place before merge: N13 added above, N7 cross-referenced. N1 remains the top finding because it is the one with verified, directly misleading claims on the credential and dispatch core; N13 is ranked below it as Medium because its harm is inferred, not shown.
