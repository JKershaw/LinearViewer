# Code Quality Review — 2026-09-26 (periodical run, LIN-3103)

*Review-only: no code, config or secrets changed — the only file this run writes is this report. Severity-ranked complexity / duplication / maintainability findings, weighted by risk × churn, grounded against source at HEAD.*

**HEAD** `LinearViewer` @ **`b5c528c4`** (= `origin/main`). Every figure below was re-measured at that SHA in this session with `wc -l` and `git log --since=90.days --name-only`; nothing is inherited from the ticket's mint-time leads (`6e8bf424`), the research comment (`2d8fa090`) or the approved plan (revision 1). Where a re-measurement contradicts one of those, the contradiction is stated rather than quietly corrected.

**Grounding delta.** The ticket was minted against `LinearViewer` @ `6e8bf424` and `simple-dispatcher` @ `3b1e734`. At review time `origin/main` had advanced by exactly one merge — `b5c528c4` (merge of LIN-3097) — whose diff is confined to `scripts/eval/jev-spike-out/*` and `scripts/eval/jev-spike.mjs`. No path this report cites is touched, and the risk × churn board is identical at both SHAs. `simple-dispatcher` is unchanged at `3b1e734` (= `origin/main`, zero commits since ticket creation). The `git log --since=<ticket creation> -- <cited paths>` staleness check returns empty.

**Method summary.** Risk × churn (`wc -l` × 90-day commit count) builds the board; the review then reads each lead at source and keeps only findings that name (i) a specific `file:line` at HEAD, (ii) a second site or a measured delta, and (iii) a change that would be risky or a bug likely. The highest-yield secondary signals are cross-file duplicate-block detection (normalised 8-line windows) and brace-matched function spans; both are used to bound classes rather than to rank by size alone. No new tooling is introduced.

**Churn method.** `git ls-tree -r --name-only HEAD`, filtered to `*.js`/`*.css`, minus the stated exclusions (below), then per path: `wc -l` × the number of times the path appears in `git log --since=90.days --name-only --pretty=format:`. This counts merges differently from `git log --oneline -- <file>` (merge-commit-blinding): `server.js` reads **143** here against **148** by the oneline method. Rank order is unaffected; every figure in this report uses the one method consistently.

---

## 0. Prior runs — what happened to them

| run | report | status |
|---|---|---|
| **2026-06-25** (LIN-667) | `docs/reviews/code-quality-review-2026-06-25.md` | committed; baseline edition |
| **2026-07-11** (LIN-1232) | — | **confirmed lost** — no branch or ref carries it; only the LIN-1232 comment survives |
| **2026-08-23** (LIN-1920) | `docs/reviews/code-quality-review-2026-08-23.md` | landed retroactively, six days late |
| **2026-08-29** (LIN-2378) | `docs/reviews/code-quality-review-2026-08-29.md` | landed on the day; last edition before this one |
| **2026-09-26** (this run, LIN-3103) | `docs/reviews/code-quality-review-2026-09-26.md` | **this file** |

The 08-29 edition is the immediate predecessor and the reference for this report's shape. Its findings and the tickets it minted are re-verified live in §4; its top unpromoted candidates (`tests/unit/prompt-templates.test.js` fixture duplication, `tests/e2e/proxy.spec.js`) are dispositioned in §5.

**What the 08-29 run left open, and its live state now.** Every state below was re-`GET`-ed from the workspace API during this session.

| 08-29 finding | owner ticket | live state | this run |
|---|---|---|---|
| F1 `routes/proxy.js` split | **LIN-679** (successor LIN-2360) | **Done** / **Canceled** | closed loop; headline §2 |
| F2 `lib/dispatch-store.js addFeedback` | **LIN-2398** | Backlog | still real; cross-link §3 |
| F9 GitHub App OAuth duplication | **LIN-2397** | Todo | code landed; Done withheld on a parked human decision — see §4 |
| F3 Jira ADF codec | **LIN-2399** | **Done** (2026-09-02) | resolved; closed loop |
| F5 client↔server mirror divergence | **LIN-2071** | Backlog | class owner; not rivalled |
| F4 `isTestMode` duplication | **LIN-2847** | Backlog | class owner; not rivalled |
| F6/F7/F8 `dashboard.js` / `dispatch.js` / `pipeline-loops.js` | none | — | re-decided in §3; deferrals upheld |
| F10 `tests/e2e/proxy.spec.js` | none | — | top unpromoted candidate; §5 |
| fixture duplication `prompt-templates.test.js` | none | — | top unpromoted candidate; §5 |
| `periodical-report-gate` adversarial predicate defect | none | — | **still unguarded and unticketed**; minted this run as **F-gate** |
| LIN-2360 proxy decomposition successor | **LIN-2360** | **Canceled** (operator ruling 2026-09-03: superseded; LIN-679 carried it) | cross-link only |
| LIN-2245 instructions catalog extraction | **LIN-2245** | **Done** (`937555cd`) | closed loop |
| LIN-1249 `server.js` decomposition | **LIN-1249** | Backlog | still real; cross-link §3 |
| LIN-2246 `workspace-api.js` decomposition | **LIN-2246** | Todo | worse than 08-29; cross-link §3 |
| LIN-680 / 1250 / 1251 / 1622 | — | Backlog | still real; re-verified §4 |

Two consecutive editions before 08-29 failed to land an artifact on time. That is the periodical's highest-leverage failure mode, and it is why `lib/periodical-report-gate.js` (LIN-694) refuses a Done transition until a comment on the task cites a real GitHub URL. This run satisfies that gate with a merged PR rather than a promise.

---

## 1. Risk × churn at HEAD — re-measured, not trusted

**Reproducible query.**

```
git ls-tree -r --name-only HEAD            # whole tracked tree
  | filter to *.js and *.css               # the extension filter is explicit
  | minus exclusions                       # package-lock.json, node_modules/,
                                           # public/*.min.js, tests/fixtures/,
                                           # tests/screenshots/, prototypes/,
                                           # test-results/, content/, plans/,
                                           # data/, scripts/, and .mjs one-off sweeps
per path: wc -l × count in
  git log --since=90.days --name-only --pretty=format:
```

**Why the filter is stated.** Without the extension filter, `docs/proxy-integration.md` (2,565 lines × ~80 commits/90d) lands around #7 on the board. It is excluded and routed to the **Documentation Review** sibling seam (§8), not silently dropped. `scripts/` and `.mjs` one-off sweeps are excluded as tooling, not shipped source. 958 eligible files result.

| # | file | lines | 90d | risk×churn | structural owner |
|---|---|---|---|---|---|
| 1 | **`server.js`** | 4,085 | 143 | **584,155** | LIN-1249 (Backlog) |
| 2 | **`routes/workspace-api.js`** | 4,234 | 65 | **275,210** | LIN-2246 (Todo) |
| 3 | `tests/unit/dashboard-routes.test.js` | 5,686 | 47 | 267,242 | none — clean |
| 4 | `tests/unit/prompt-templates.test.js` | 4,876 | 46 | 224,296 | none — 08-29 top unpromoted |
| 5 | `routes/proxy.js` | 1,591 | 134 | 213,194 | LIN-679 (Done) — headline §2 |
| 6 | **`public/observation.js`** | 4,614 | 46 | **212,244** | none — F-obs |
| 7 | `public/style.css` | 4,559 | 39 | 177,801 | Design & Interface (rendered) / here (structure) |
| 8 | **`lib/dispatch-store.js`** | 2,600 | 58 | **150,800** | LIN-2398 (Backlog) |
| 9 | `routes/dashboard.js` | 2,626 | 55 | 144,430 | none — 08-29 F6, re-decided |
| 10 | `tests/unit/chat-tools.test.js` | 3,617 | 35 | 126,595 | none — below threshold |
| 11 | `public/common.js` | 2,518 | 43 | 108,274 | none — clean |
| 12 | `tests/unit/observation-ruling-delivery.test.js` | 4,239 | 23 | 97,497 | none — recorded |
| 13 | `tests/unit/openrouter.test.js` | 3,293 | 28 | 92,204 | none — recorded |
| 14 | `tests/unit/flight-companion-client.test.js` | 3,895 | 22 | 85,690 | none — recorded |
| 15 | `routes/dispatch.js` | 1,775 | 47 | 83,425 | none — 08-29 F7, re-decided |
| 16 | `lib/chat-tools.js` | 2,219 | 33 | 73,227 | none — clean |
| 17 | `tests/e2e/proxy.spec.js` | 3,124 | 23 | 71,852 | none — 08-29 F10, unpromoted |
| 18 | `tests/unit/pipeline-loops.test.js` | 2,764 | 22 | 60,808 | none — below threshold |
| 19 | `routes/test.js` | 1,605 | 37 | 59,385 | none — test-gated |
| 20 | `lib/pipeline-loops.js` | 1,852 | 30 | 55,560 | none — 08-29 F8, re-decided |
| 21 | `lib/prompt-template-defs.js` | 1,348 | 40 | 53,920 | none — below threshold |
| 22 | `lib/render-settings.js` | 1,506 | 35 | 52,710 | none — recorded |
| 23 | `public/observation.css` | 1,428 | 33 | 47,124 | Design & Interface (rendered) / here (structure) |
| 24 | `tests/unit/mongo-smoke.test.js` | 1,759 | 24 | 42,216 | none — below threshold |
| 25 | `lib/providers/linear/index.js` | 2,344 | 18 | **42,192** | LIN-1251 (Backlog) |

*Arithmetic note:* #25 is **42,192** (2,344 × 18), not the 41,292 of the original research draft; rank is unchanged.

**The whole tree is on the board, tests included.** 13 of the 25 entries are test files (9) or client assets (4), so "in scope" and "on the board" are the same set — the exact defect the 08-29 Tier-1 reader caught and this edition is instrumented to avoid.

**Test sub-board (top 8).** `tests/unit/dashboard-routes.test.js` 5,686/47; `tests/unit/prompt-templates.test.js` 4,876/46; `tests/unit/observation-ruling-delivery.test.js` 4,239/23; `tests/unit/flight-companion-client.test.js` 3,895/22; `tests/unit/chat-tools.test.js` 3,617/35; `tests/unit/openrouter.test.js` 3,293/28; `tests/e2e/proxy.spec.js` 3,124/23; `tests/unit/pipeline-loops.test.js` 2,764/22.

**`public/*.js` sub-board (top 8).** `public/observation.js` 4,614/46 = 212,244; `public/common.js` 2,518/43 = 108,274; `public/flight-companion.js` 1,843/21 = 38,703; `public/app.js` 2,268/16 = 36,288; `public/live-console.js` 1,385/18 = 24,930; `public/dispatch.js` 1,274/17 = 21,658; `public/swim.js` 2,975/3 = 8,925; `public/ship-journey.js` 676/11 = 7,436.

**simple-dispatcher sub-board** (same method at SD HEAD `3b1e734`; tests included). `reapers.js` 3,513/74 = 259,962; `dispatcher.js` 2,148/82 = 176,136; `test/stall-failsafe.test.js` 3,763/38 = 142,994; `test/opencode-runner.test.js` 4,038/34 = 137,292; `hook.js` 2,101/62 = 130,262; `opencode-runner.js` 1,695/42 = 71,190; `config.js` 1,303/47 = 61,241; `test/hook-decision.test.js` 1,400/31 = 43,400; `executors.js` 773/43 = 33,239; `e2e-smoke.js` 2,076/16 = 33,216; `terminal-driver.js` 1,568/21 = 32,928; `test/e2e-smoke.test.js` 2,053/14 = 28,742. Its disposition is §3.

**The dominant complexity shape is still the route-factory closure, and it recurs.** The largest genuine units in the tree are not handlers or algorithms — they are the closures that hold them, and the LIN-679 split moved them without removing the shape:

| unit | span | lines | share of its file |
|---|---|---|---|
| `createWorkspaceApiRoutes` (`routes/workspace-api.js:321`) | `:321–4234` | **3,914** | 92% |
| `createDashboardRoutes` (`routes/dashboard.js:495`) | `:495–2593` | 2,099 | 80% |
| `createDispatchRoutes` (`routes/dispatch.js:181`) | `:181–1775` | 1,595 | 90% |
| `createTestRoutes` (`routes/test.js:53`) | `:53–1605` | 1,553 | 97% |
| `createDispatchRoutes` (`routes/proxy-dispatch.js:176`) | `:176–1755` | 1,580 | 90% |
| `createComputeRoutes` (`routes/proxy-compute.js:67`) | `:67–1590` | 1,524 | 96% |
| `createProxyRoutes` (`routes/proxy.js:469`) | `:469–1591` | 1,123 | 71% |

Three of the seven already have a decomposition ticket (LIN-2246, LIN-1249's sibling class, LIN-679 Done). The count of un-ticketed instances is not the finding; the class is, and its disposition is §3.

---

## 2. The question this edition was best placed to answer

> *Did the LIN-679 decomposition reduce complexity, or relocate it?*

**Verdict: a real reduction in the largest unit, and a real relocation of the composition cost into the hub. Both halves are true, and the second is why this is not a pure win.**

**The reduction is real.** `routes/proxy.js` fell **7,356 → 1,591** lines (`routes/proxy.js:1–1591`). Its own largest member, `createProxyRoutes`, is now **1,123 lines** (`:469–1591`), against a 6,676-line closure at the 08-29 measurement. The proxy surface is now 11 sub-routers plus a catalog module, and the maximum single unit in the tree is no longer the proxy closure at all.

**The relocation is real too.** `createProxyRoutes` now does almost no routing of its own: it wires **11 `router.use(...)` calls** (`routes/proxy.js:1273–1588`), each injecting **10–30 dependencies** into a sub-router. The two largest sub-routers are `createDispatchRoutes` **1,580** (`routes/proxy-dispatch.js:176–1755`) and `createComputeRoutes` **1,524** (`routes/proxy-compute.js:67–1590`) — each within ~5% of the old `routes/workspace-api.js` scale. Total proxy-surface code grew **7,356 → 9,829** (11 sub-routers 7,188 + `lib/proxy-instructions.js` 1,050 + hub 1,591). No shared mutable "context" module formed — dependencies are explicitly injected per sub-router, so the LIN-2360 spike's worst case did not occur — but the hub is now a dependency-wiring composer under the same 134 commits/90d of churn.

**`c7aeacb5` relocated the mock-builder duplication rather than removing it.** LIN-679 Stage 4 (`c7aeacb5`, PR-4) created `routes/proxy-compute.js` by moving the compute group out of `routes/proxy.js`. The mock-fixture context builders moved with it: `routes/proxy-compute.js:111-220` (`buildMockRecapContextFromFixtures:111`, `buildMockRecapFromContext:152`, `buildMockBriefFromContext:192`) are near-line-for-line copies of `routes/workspace-api.js:2355-2457` (`buildMockBrief:2355`, `buildMockRecapContext:2387`, `buildMockRecap:2425`), which `routes/task-chat.js:63-98` (`buildMockTaskContext:63`) also mirrors and self-documents as doing so. `routes/proxy-compute.js` has exactly one commit ever — the split — so the split **relocated** this duplication into a new file; it neither created nor removed it. This is a distinct finding (F-mockbuilders, §3) folded into the headline answer.

**Condition 5 — the largest request handlers, named.** The ≥200-line bound counts **named functions only**, so the closures above hide their handlers. Measured at HEAD, the largest request handlers are:

| handler | span | lines | disposition |
|---|---|---|---|
| `POST /api/proxy/recommend-and-dispatch` (`routes/proxy-dispatch.js:660`) | `:660–1349` | **690** | cross-link **LIN-679 follow-on set** |
| `POST /workspace/:urlKey/api/dispatch` (`routes/dispatch.js:273`) | `:273–751` | 479 | recorded-not-promoted — 08-29 F7 deferral upheld |
| `POST /api/proxy/dispatch` (`routes/proxy-dispatch.js:218`) | `:218–621` | 404 | cross-link **LIN-679 follow-on set** |
| `POST /api/proxy/autopilot/kickoff` (`routes/proxy-kickoff.js:124`) | `:124–524` | 401 | recorded-not-promoted |

A single 690-line handler — a dispatch verb that computes a recommendation and then dispatches — is larger than any single named non-closure function in the repo except the biggest route factories. It informs the "is the largest unit smaller?" question: the closures shrank, but the handlers inside the two largest proxy sub-routers did not.

**What this tells the next run.** The LIN-679 split is a genuine win on the metric it targeted and should not be re-litigated. Its residual is the hub's dependency wiring plus two re-concentrated sub-routers, which is exactly the LIN-3016/3031/2558/2590 follow-on set — cross-linked, not re-minted.

---

# Findings, severity-ranked

**The `F-<name>` labels are stable identifiers, not ranks.** Severity order is the table below, and it is what decided the mint set.

| rank | finding | severity | surface | disposition |
|---|---|---|---|---|
| 1 | **F-sd-stall** | HIGH | `simple-dispatcher/reapers.js:1575–2503` `runStallFailsafe` (930) | recorded-not-promoted (cap spent); cross-link LIN-2568, LIN-2470 |
| 2 | **F-obs** | HIGH | `public/observation.js:3201–3565` `deliverRulingReply` (365 lines) | **mint** — cross-link LIN-2793, LIN-2784 |
| 3 | **F-gate** | HIGH (correctness-adjacent) | `lib/periodical-report-gate.js:117–119` | **mint** |
| 4 | **F-json** | MED | 7-site loose-JSON extraction | **mint** — cross-link LIN-1674, LIN-1672 |
| 5 | **F-workspace-api** | MED | `routes/workspace-api.js` (275,210) | cross-link **LIN-2246** |
| 6 | **F-server-auth** | MED | `server.js` auth-refresh ladder | cross-link **LIN-1249** |
| 7 | **F-dispatch-store** | MED | `lib/dispatch-store.js:2008–2293` `addFeedback` (286) | cross-link **LIN-2398** |
| 8 | **F-mock** | MED | mock/test-mode decision written many times | cross-link **LIN-2847** |
| 9 | **F-mockbuilders** | MED | mock-fixture builders written 3× | recorded-not-promoted (§3d) |
| 10 | **F-proxy-dispatch** | MED-LOW | `routes/proxy-dispatch.js:56` `formatDispatchWatch` | cross-link **LIN-3016** |

**Why the mint set is F-obs, F-gate, F-json.** F-obs and F-gate are HIGH on live-production-behaviour and correctness-adjacent surfaces; F-json is a production LLM-response-parsing risk across 7 live sites with an open ticket (LIN-1674) about to deliberately diverge one copy. F-workspace-api, F-server-auth, F-dispatch-store, F-mock and F-proxy-dispatch all have live owners and are cross-linked rather than rivalled. F-mockbuilders is unowned but confined to the `mockAi`/test-mode path and dormant per its git history, so it does not displace the mint set (full ranking reason in §3d). F-sd-stall outranks F-obs on size, branch count, churn and open defects; it was surfaced by the Tier-1 second read after the mint cap was spent, so it is recorded, not minted. The mint set (LIN-3112/3113/3114) is unchanged.

---

## F-obs · **HIGH** — `public/observation.js` `deliverRulingReply` is a 365-line four-disposition orchestrator, and the 08-29 "clean" verdict is invalidated

**What.** `deliverRulingReply` (`public/observation.js:3201–3565`, **365 lines**) is a single function owning four reply dispositions — `resumable` (`:3332`), `gone` (`:3374`), `task-bound`, and `record` via a nested `deliverAsRecord` closure (`:3405`) — each with its own partial-failure handler and its own comment/dispatch/record contract. It is the largest unit in `public/observation.js`, which is itself **4,614 lines / 46 commits = 212,244, #6 on the board**.

**Second site / delta.** The 08-29 edition graded `public/observation.js` a **clean result** at 2,101 lines, 76 functions, largest 183. That verdict does not survive HEAD: the file has more than doubled (2,101 → 4,614), and its largest function has doubled (183 → 365). This is a re-grade, not a continuation of the prior verdict.

**Concrete maintainability cost.** A fifth disposition, or any change to the comment/dispatch/record contract, must land correctly across four interlocked branches plus the press-time hydrate→downgrade dance in `deliverAsRecord`. The file's own recent history shows drift already: `public/observation.js`'s last 15 commits are entirely the rulings stream (LIN-2934, LIN-3022, LIN-2933, LIN-2760/2758/2797/2757, LIN-2792, LIN-2775), so changes land here continuously, and the branch structure is where a missed disposition hides.

**Condition 3 — owner cross-links and corrected locus.** Two open tickets sit on this function's behaviour, and both must be sequenced against the decomposition:

- **LIN-2793** (Backlog — *"a STALE proposal delivers an opaque option id as the answer text"*). Its source is **`resolveRulingOptionLabel` (`public/observation.js:1911`)** — the bare-`optionId` fallback (`return match ? match.label : (optionId || '')`) whose result the Agree callers pass into `deliverRulingReply`. It is **not** "inside the function's Agree branches"; the report corrects that framing.
- **LIN-2784** (Backlog — *"effect-flip press during the partial-failure window destroys the retry affordance and strands a preserved row key"*). A live defect in the same function's partial-failure/retry path, and its acceptance test targets the real `deliverRulingReply`.

**Negative search.** No ticket names the function's *structure*. The class-level search for `deliverRulingReply` returns only behavioural owners (LIN-2793, LIN-2784) and Done/Canceled items. Structural decomposition is unowned.

**Confidence: verified at HEAD by reading the function and both owner tickets.** → **minted as F-obs; cross-links LIN-2793 and LIN-2784.**

---

## F-gate · **HIGH (correctness-adjacent)** — the report gate's adversarial predicate is satisfied by a comment that merely *quotes* it, and it has now gone unrecorded twice

**What.** `lib/periodical-report-gate.js:117–119` defines the three predicates that gate this task's own Done transition — the verdict, differed-from-top-finding, and disposition matchers, exported through `hasAdversarialReadEvidenceComment`. Each is an **unguarded alternation with a trailing `\b`**. The three predicates are unanchored: any occurrence of a field label followed by an accepted value matches, whether in a pipe-separated field template, in the ticket-description form (one value, then "or … <other value>"), or in negated prose (a field line followed by "is not yet given"). A quotation of the regex *source* does not match. A lookahead against a following alternation bar closes only the first of these forms. The 08-29 run demonstrated this empirically: its own Step-1 research comment matched all three predicates, and calling the exported function with only a quotation as input returned `true`. *(This report describes the predicates by name only and does not reproduce their patterns — see the operational note below.)*

**Second site / delta.** This is the second consecutive edition to find it. The 08-29 report recorded it in full but did not mint it (cap spent on product findings; module owners LIN-694/LIN-2323 both Done). Nothing has changed since: `lib/periodical-report-gate.js` has only 3 commits ever, the regexes at `:117–119` are unchanged since LIN-2323 (#1263), and the last touch (LIN-2896) was an unrelated prose repoint.

**Concrete maintainability cost.** Any periodical whose research or planning pass quotes its own Done-gate pre-satisfies that gate, so the gate can pass with **no second opinion at all** — the exact failure it exists to prevent. A `(?!\s*\|)` guard on each alternation closes only the pipe-template form; the ticket-description form and negated prose would still pass. Closing all three needs the predicates anchored or made to require the full field structure, or the match required outside a code span. It gates *this* task's own eventual Done transition, so deferring it again is self-undermining.

**Negative search.** No ticket names `ADVERSARIAL_VERDICT_RE`, `hasAdversarialReadEvidenceComment`, `periodical-report-gate` or the regex defect. LIN-2328 (Todo) is a watch/monitor of the gate's branches, not the defect; LIN-2576 (Todo) widens the gate to the session-auth write path. LIN-694 and LIN-2323 are Done. **Unowned.**

**Operational note.** Per this very finding, no comment on LIN-3103 — and no report text before the real second read — writes the three field patterns verbatim. This report refers to them by field name only.

**Confidence: verified at HEAD by reading the regexes and re-running the owner search.** → **minted as F-gate.**

---

## F-json · **MED** — loose-JSON fence extraction is re-implemented at 7 production sites, and the server has a fence helper but no JSON-extract helper

**What.** Seven production parsers independently implement the same decision — trim, strip a ```` ```json ```` fence, slice from the first `{` to the last `}`, `JSON.parse` — differing only in the fallback value:

| # | site | fence body |
|---|---|---|
| 1 | `lib/recap.js:53` `parseRecapResponse` | `:60` |
| 2 | `lib/run-summary.js:106` `parseRunSummaryResponse` | `:113` |
| 3 | `lib/scan.js:109` `extractScanPayload` | `:113` |
| 4 | `lib/session-summary.js:139` `parseSessionSummaryResponse` | `:146` |
| 5 | `lib/next-run.js:560` `extractJsonObject` | `:566` |
| 6 | `lib/observer-pass.js:99` `extractJsonObject` | `:102` |
| 7 | `lib/prompts/ship-biscuit-editor.js:99` `extractJsonObject` | `:102` |

The class was widened from the earlier 5-site draft to **7**: `lib/observer-pass.js` and `lib/prompts/ship-biscuit-editor.js` were previously omitted (both `extractJsonObject`, the latter's own doc-comment noting it "mirrors lib/next-run.js").

**Condition 6 — the existing server fence helper.** The server is **not** without a fence helper: `lib/openrouter.js:336 stripCodeBlockMarkers` strips ```` ``` ```` markers (and is used at `lib/openrouter.js:1726`). What does **not** exist is a shared **JSON-extract** helper — the "first `{` / last `}`" half. The follow-up must build on `stripCodeBlockMarkers`, not re-invent it; the report does not claim the server has none.

**Second site / delta.** The client already has a canonical helper (`public/common.js:401 stripCodeBlockWrapper`); the server has no equivalent shared **JSON-extract** helper. `lib/next-run.js`'s copy is unchanged since 2026-06-25 (LIN-642) and LIN-1674's salvage change has not landed, so the sequencing below is still actionable.

**Concrete maintainability cost.** A change to how fenced or malformed LLM JSON is handled (unescaped backticks, leading prose, a bare fence) is a 7-site production edit with **silent parse divergence** as the failure mode. LIN-1674 (*"Salvage the complete leading options out of a truncated JSON reply"*) is about to land salvage behaviour on `lib/next-run.js`'s standalone copy specifically — which, unless the shared helper is extracted first, deliberately diverges one of the seven. LIN-1672 (*"A truncated LLM reply should be an error, not a silent degradation"*) is the general owner.

**Sequencing.** Extract the shared helper first; land LIN-1674's salvage behaviour **on the shared helper**, not the standalone `lib/next-run.js` copy.

**Negative search.** LIN-1620 (Backlog) scopes the *client* `stripCodeBlockWrapper`; LIN-2984 (Backlog) is a different openrouter-streaming `JSON.parse` conflation. No ticket names a shared server JSON-extract helper.

**Confidence: verified at HEAD by reading all seven bodies.** → **minted as F-json; cross-links LIN-1674 and LIN-1672.**

---

## F-workspace-api · **MED** — the 08-29 "held reduction" has reversed; `routes/workspace-api.js` grew again

**What.** `routes/workspace-api.js` is **4,234 lines / 65 commits = 275,210, #2 on the board**. `createWorkspaceApiRoutes` (`:321–4234`) is a **3,914-line closure, 92% of the file**. The 08-29 run recorded 3,498 lines and celebrated the split as a held reduction; at HEAD it has grown **+736** since then, and the split's own family total is **5,263** (4,234 + `workspace-api-roadmap.js` 898 + `workspace-api-prompts.js` 131) against 4,495 at 08-29.

**Second site.** The mock-fixture builders at `:2355–2457` are duplicated into `routes/proxy-compute.js` and `routes/task-chat.js` (F-mockbuilders, §3d).

**Concrete maintainability cost.** 65 commits/90d land in a 3,914-line closure with no module boundary to localise a mistake. The reversal means the previous run's positive verdict is no longer accurate.

**Disposition —** cross-link LIN-2246 (Todo — *"Decompose routes/workspace-api.js (4,388 lines, 36 endpoints, 24 in-closure helpers) by URL group"*), not rivalled.

**Confidence: verified at HEAD.**

---

## F-server-auth · **MED** — the auth-refresh ladder is duplicated between `ensureValidToken` and `handleUnauthorizedError` in the #1 hotspot

**What.** `server.js` is **4,085 / 143 = 584,155, #1 on the board**. Two auth-path functions implement the same strategy-derivation + branch structure:

| function | span | lines |
|---|---|---|
| `ensureValidToken` (`server.js:927`) | `:927–1162` | 236 |
| `handleUnauthorizedError` (`server.js:1551`) | `:1551–1758` | 208 |
| `resolveWorkspaceAccess` (`server.js:2160`) | `:2160–2360` | 201 |

**Second site.** `handleUnauthorizedError`'s own comments assert the mirror explicitly — *"Mirrors `ensureValidToken`'s own provider branch (`server.js:647-648`)"* (`:1618`), *"matching `ensureValidToken`'s own try scope exactly (`server.js:631-689`)"* (`:1626`), *"the same outcome `ensureValidToken`'s identically-scoped try produces for the same failure"* (`:1644`). The comments say "deliberately not cited by line number, which drifts" — and they then cite line numbers that drift.

**Concrete maintainability cost.** A refresh/remint fix must land twice, correctly, in the repo's highest-churn file; the mirror comments are load-bearing and will silently go stale.

**Disposition —** cross-link LIN-1249 (Backlog — *"Decompose server.js"*), not rivalled.

**Confidence: verified at HEAD.**

---

## F-dispatch-store · **MED** — `addFeedback` is a 286-line method on the dispatch hot path, still unactioned

**What.** `lib/dispatch-store.js` is **2,600 / 58 = 150,800, #8 on the board**. `addFeedback` (`:2008–2293`, **286 lines**) performs append + wake-detect + credential-provision-with-draw + terminal-witness CAS + digest + notify in one method. It grew from 157 → 243 → 288 across the prior runs; at HEAD it is **286** (the +18.5% 08-29 measurement has flattened but not reversed).

**Second site.** The next-largest `lib/*store*.js` is an order of magnitude smaller; this is one outlier, not a family convention.

**Concrete maintainability cost.** Every runner feedback POST enters this method. LIN-1343 already fixed a check-then-write stale-snapshot race **inside it** when it was 157 lines; the next concurrency defect will be harder to see and harder to test.

**Disposition —** cross-link LIN-2398 (Backlog), not rivalled.

**Confidence: verified at HEAD.**

---

## F-mock · **MED** — the mock/test-mode decision is written many times, and the class already has an owner

**What.** The "should this request be mocked?" decision is written in several families:

- **Named:** `shouldMockAi` in **5** copies — `routes/workspace-api.js:108` (exported), `routes/workspace-api-roadmap.js:37`, `routes/next-run.js:38`, `routes/task-chat.js:53`, `routes/ship-biscuit.js:55`. All five are byte-identical.
- **Inline:** the narrow `=== 'test-token'` predicate appears **40 times across 10 files** (`routes/workspace-api.js` ×19, `routes/proxy-compute.js` ×7, `server.js` ×4, and seven others), almost always bound to a local `isTestMode` (113 references repo-wide).
- **Third family:** `lib/openrouter-catalog.js` (`getModelCatalog({ mock })` at `:171`, `MOCK_CATALOG_MODELS` at `:48`) is a separate mock representation.

**Concrete maintainability cost.** Changing what "test mode" means — adding a provider, changing the token sentinel — is a many-site edit with no single definition, and the families must stay correctly different while being edited together.

**Disposition —** cross-link LIN-2847 (Backlog — *"Audit the isTestMode-duplication class"*), which owns this class. The report records the class; it does not re-derive its full census.

**Confidence: verified at HEAD.**

---

## F-proxy-dispatch · **MED-LOW** — `formatDispatchWatch` hand-copies the feedback formatter

**What.** `routes/proxy-dispatch.js:56 formatDispatchWatch` re-implements the dispatch feedback formatting that `lib/dispatch-store.js:69 formatFeedbackEntries` already provides.

**Concrete maintainability cost.** A change to the feedback entry shape must be mirrored by hand in the proxy-dispatch copy; the two can drift silently.

**Disposition —** cross-link LIN-3016 (Backlog — *"routes/proxy-dispatch.js hand-copies the dispatch feedback formatter instead of importing formatFeedbackEntries"*), not rivalled.

**Confidence: verified at HEAD.**

---

---

# Part 2 — class dispositions, clean results, and close-out

## 3. Class dispositions — every member of every bounded class

Every member returned by every class bound below receives exactly one disposition — **finding**, **clean**, **cross-link** (to an existing owner), **recorded-not-promoted**, or a stated **below-threshold batch** rationale.

### 3a. Long-function class — ≥200-line named functions

**Query.** Brace-matching span scan over the same file set as §1's board (`*.js`, exclusions as stated), skipping strings, template literals and regex literals, with parameter lists matched before the body brace. Threshold **≥ 200 lines**. The bound counts **named functions only** — `function` declarations, named arrow/function-expression assignments, and named method shorthand. Anonymous route handlers nested inside a named member are **not** separately counted (they are enumerated by handler span in §2 instead).

**Census count: 63.** The plan's §3c said 62; the plan-review's independent re-run said 63. Re-run here with a regex-literal-aware scanner (the earlier naive scanner mis-closed on regex literals containing quotes), the count resolves to **63 named members**. The one-line difference from the plan is scanner fidelity, not a different bound. The full member list is below; all 63 are dispositioned.

**Individually dispositioned — the 7 board-file members (condition 1).** None is described as "outside the top-25 board"; every host file already carries a board-row disposition in §1.

| member | span | lines | disposition |
|---|---|---|---|
| `createWorkspaceApiRoutes` | `routes/workspace-api.js:321–4234` | 3,914 | **cross-link LIN-2246** (F-workspace-api) |
| `createDashboardRoutes` | `routes/dashboard.js:495–2593` | 2,099 | **recorded-not-promoted** — 08-29 F6, deferral upheld (§3f) |
| `createProxyRoutes` | `routes/proxy.js:469–1591` | 1,123 | **cross-link/closed** — LIN-679 headline (§2) |
| `_buildLoops` | `lib/pipeline-loops.js:411–890` | 480 | **recorded-not-promoted** — 08-29 F8, deferral upheld |
| `_buildSessions` | `lib/pipeline-loops.js:1121–1402` | 282 | **recorded-not-promoted** — 08-29 F8 |
| `renderRulingRow` | `public/observation.js:1923–2159` | 237 | **recorded-not-promoted** — inside the F-obs file; the F-obs mint covers `deliverRulingReply`, not this function |
| `resolveWorkspaceAccess` | `server.js:2160–2360` | 201 | **cross-link LIN-1249** (F-server-auth row) |

**Individually dispositioned — the named proxy sub-routers (plan §3c).** All are **cross-link/closed**: no new complexity beyond the LIN-679 headline discussion, and none is separately minted.

| member | span | lines | disposition |
|---|---|---|---|
| `createDispatchRoutes` | `routes/proxy-dispatch.js:176–1755` | 1,580 | cross-link/closed — headline §2 |
| `createComputeRoutes` | `routes/proxy-compute.js:67–1590` | 1,524 | cross-link/closed — headline §2; hosts F-mockbuilders |
| `buildInstructions` | `lib/proxy-instructions.js:31–1050` | 1,020 | cross-link/closed — LIN-2245 Done; accuracy is Documentation Review's seam |
| `createProxyWriteRoutes` | `routes/proxy-writes.js:51–1040` | 990 | cross-link/closed |
| `createReadRoutes` | `routes/proxy-reads.js:44–796` | 753 | cross-link/closed |
| `createKickoffRoutes` | `routes/proxy-kickoff.js:45–549` | 505 | cross-link/closed |
| `createRulingsRoutes` | `routes/proxy-rulings.js:76–482` | 407 | cross-link/closed |
| `createProxyFlightCompanionRoutes` | `routes/proxy-flight-companion.js:150–382` | 233 | cross-link/closed |
| `createTokensAdminRoutes` | `routes/proxy-tokens-admin.js:37–243` | 207 | cross-link/closed |

**Individually dispositioned — other top-25 board-file members ≥ 200.**

| member | span | lines | disposition |
|---|---|---|---|
| `createDispatchRoutes` | `routes/dispatch.js:181–1775` | 1,595 | **recorded-not-promoted** — 08-29 F7 deferral upheld; also under heavy concurrent, unrelated feature work |
| `createTestRoutes` | `routes/test.js:53–1605` | 1,553 | **recorded-not-promoted** — test-gated surface, not production |
| `createChatToolCatalog` | `lib/chat-tools.js:1520–2219` | 700 | **clean** — flat tool-catalog + helpers |
| `renderSettingsPage` | `lib/render-settings.js:1165–1506` | 342 | **recorded-not-promoted** — flat template/data, below the line |
| `ensureValidToken` | `server.js:927–1162` | 236 | **cross-link LIN-1249** (F-server-auth) |
| `handleUnauthorizedError` | `server.js:1551–1758` | 208 | **cross-link LIN-1249** (F-server-auth) |

**Individually dispositioned — `public/*.js` members.** Each is dispositioned in the §3e sub-board table below.

**Below-board batch — the remaining 31 members at ≥ 200 lines.** Rationale: a ≥200-line span alone, without top-25 risk×churn rank, is **not sufficient signal** to promote past the mint set or the top-25 board's own findings. Each is named here with its measured span so the next run can promote whichever still matters. Disposition for the batch: **recorded-not-promoted**.

`createRoadmapRoutes` (`routes/workspace-api-roadmap.js:90`, 809); `createJiraAuthRoutes` (`routes/jira-auth.js:154`, 679); `createDispatchItem` (`lib/dispatch-factory.js:174`, 625); `createGitHubInstallFlowRoutes` (`lib/github-install-flow.js:169`, 570) — note adjacency to LIN-2397; `createCollectiveRoutes` (`routes/collective.js:79`, 541); `createFlightCompanionRoutes` (`routes/flight-companion.js:468`, 522); `computeTerminalMarkedTaskCost` (`lib/terminal-marked-task-cost.js:210`, 471); `buildAutopilotKickoff` (`lib/prompts/autopilot-kickoff.js:296`, 454 — corrected figure); `createAuthRoutes` (`routes/auth.js:34`, 431); `collectKpiStats` (`lib/kpi-stats.js:874`, 402); `createTaskChatRoutes` (`routes/task-chat.js:237`, 390); `init` (`public/prompt-section.js:189`, 390); `buildWidget` (`public/feedback-widget.js:129`, 382); `runAgentTurn` (`lib/agent-turn.js:159`, 374); `createObservationMaterializer` (`lib/observation-sessions-materializer.js:57`, 366); `createJiraClient` (`lib/providers/jira/client.js:97`, 353); `buildMetaPromptTemplate` (`lib/prompts/meta-prompt-template.js:43`, 327); `seed` (`tests/unit/proxy-jira-write-routes.test.js:86`, 318); `renderDetailsContent` (`lib/render.js:810`, 313); `renderCard` (`public/swipe.js:185`, 290); `collectUnansweredDecisions` (`lib/unanswered-decisions.js:445`, 263); `renderObservationPage` (`lib/render-observation.js:82`, 257); `computePlanReviewRoundTrips` (`lib/plan-review-round-trips.js:557`, 222); `createOpenRouterAuthRoutes` (`routes/openrouter-auth.js:48`, 218); `doOwnerRefresh` (`lib/workspace-token-refresh.js:330`, 218); `getRecommendationStream` (`lib/openrouter.js:947`, 216); `createFakeJiraClient` (`lib/providers/jira/fake-client.js:56`, 215); `render` (`public/ship.js:904`, 213); `renderStyleguide` (`lib/render-styleguide.js:234`, 207); `createShipBiscuitRoutes` (`routes/ship-biscuit.js:75`, 201); `place` (`public/ship-biscuit.js:14`, 201).

### 3b. Duplicate-block class — cross-file, normalised 8-line windows

**Query.** Normalised **8-line sliding windows** over consecutive non-trivial lines (comments and blank/pure-punctuation lines dropped), hashed, then counted per file pair, over **non-test `.js`**. **Threshold: ≥ 5 shared windows.** The scan returns **17 pairs** at or above it.

| shared windows | pair | disposition |
|---|---|---|
| 50 | `routes/proxy-compute.js` ↔ `routes/workspace-api.js` | **F-mockbuilders** (recorded-not-promoted, §3d) |
| 34 | `lib/dispatch-tokens.js` ↔ `lib/proxy-tokens.js` | recorded-not-promoted — token-store CRUD boilerplate |
| 22 | `routes/task-chat.js` ↔ `routes/workspace-api.js` | **F-mockbuilders** (§3d) |
| 21 | `routes/proxy-compute.js` ↔ `routes/task-chat.js` | **F-mockbuilders** (§3d) |
| 14 | `lib/llm-call-log.js` ↔ `lib/prompt-trace-store.js` | recorded-not-promoted — log/trace store boilerplate |
| 12 | `lib/observer-pass.js` ↔ `lib/prompts/ship-biscuit-editor.js` | **covered by F-json** (loose-JSON pair) |
| 11 | `lib/run-summary.js` ↔ `lib/session-summary.js` | **covered by F-json** (loose-JSON pair) |
| 9 | `lib/llm-call-log.js` ↔ `lib/proxy-events.js` | recorded-not-promoted — event-log boilerplate |
| 6 | `lib/brief-cache.js` ↔ `lib/recap-cache.js` | recorded-not-promoted — cache-store boilerplate |
| 6 | `lib/collective-characters-store.js` ↔ `lib/dispatch-presets-store.js` | recorded-not-promoted — store boilerplate |
| 6 | `lib/dismissal-suggestions-store.js` ↔ `lib/shelved-rulings-store.js` | recorded-not-promoted — store boilerplate |
| 6 | `lib/recap-cache.js` ↔ `lib/run-summary-cache.js` | recorded-not-promoted — cache-store boilerplate |
| 6 | `lib/render-swim.js` ↔ `lib/render-swipe.js` | recorded-not-promoted — client render-mirror class (LIN-2071 seam) |
| 6 | `public/brief.js` ↔ `public/recap.js` | recorded-not-promoted — client mirror class (LIN-2071 seam) |
| 5 | `lib/providers/github-projects/index.js` ↔ `lib/providers/github/index.js` | recorded-not-promoted — `completeInstallation`; note adjacency to LIN-2397 |
| 5 | `lib/user-preferences.js` ↔ `lib/workspace-preferences.js` | recorded-not-promoted — preference-store boilerplate |
| 5 | `playwright.config.js` ↔ `playwright.visual.config.js` | recorded-not-promoted — config duplication |

**The named pair below this threshold, dispositioned anyway (condition 2).** `lib/render-settings.js:61` ↔ `public/common.js:991` — `DISPATCH_HARNESS_SUGGESTIONS` and `DEFAULT_HARNESS` are written twice (server-rendered settings and the client helper). My window scan measures it **below** the ≥5 threshold because the shared run is short, but it is real by direct read: this is the client↔server mirror class, so its disposition is **cross-link LIN-2071** (the class owner), not a new mint.

**The named validation-duplication pair below this threshold, dispositioned anyway (condition 2).** `routes/dispatch.js:273` ↔ `routes/proxy-dispatch.js:218` — dispatch-request validation (`abortTo`/`cascade`/`maxTasks`/`maxSessionsPerTask`/`queueIfBusy`/`waitForFollowUps`/`periodicalId` checks) written twice, ≈104 by the Tier-1 reader's count; **87** exact trimmed-line matches by the author's re-measure. Missed by 8-line windows because the checks are interleaved differently. Recorded-not-promoted; adjacent **LIN-1760**.

**The mock-builder cluster (condition 2's headline pair set) is dispositioned in §3d.** The two loose-JSON pairs are marked covered by F-json above. The remaining 14 pairs are store/log/cache/config boilerplate or client mirrors: each is real duplication, but each is shallow (a repeated CRUD or mirror idiom) and overlaps an existing owner class (Drift & Coherence for the store/config boilerplate; LIN-2071 for the client mirrors), so none outranks the mint set and all are recorded-not-promoted.

### 3c. Loose-JSON parsing duplication — 7 sites

Bound and dispositioned in full in **F-json** (§ findings, part 1): `lib/recap.js:53`, `lib/run-summary.js:106`, `lib/scan.js:109`, `lib/session-summary.js:139`, `lib/next-run.js:560`, `lib/observer-pass.js:99`, `lib/prompts/ship-biscuit-editor.js:99`. Disposition — **finding → minted as F-json**; cross-links LIN-1674 and LIN-1672; acknowledges `lib/openrouter.js:336 stripCodeBlockMarkers`.

### 3d. Mock-fixture-builder cluster (unowned)

**Members.** `routes/proxy-compute.js:111–220` (`buildMockRecapContextFromFixtures:111`, `buildMockRecapFromContext:152`, `buildMockBriefFromContext:192`) ↔ `routes/workspace-api.js:2355–2457` (`buildMockBrief:2355`, `buildMockRecapContext:2387`, `buildMockRecap:2425`) ↔ `routes/task-chat.js:63–98` (`buildMockTaskContext:63`). ~90 lines of mock-fixture context builders written three times, near-line-for-line identical bodies confirmed by direct read.

**History.** `routes/proxy-compute.js` has exactly one commit ever (`c7aeacb5`, LIN-679 Stage 4) — the split relocated this duplication into a new file rather than creating or removing it (headline §2). `routes/task-chat.js`'s recent commits do not touch `buildMockTaskContext`.

**Disposition — recorded-not-promoted.** Unowned (LIN-2847 covers a narrower test-mode-flag class, not these builders; the earlier mock-block tickets LIN-388/413/403-405 are Done and addressed a different block), but its blast radius is confined to the `mockAi`/test-mode path rather than live user-facing behaviour, and it is dormant per its git history. It does not displace F-obs, F-gate or F-json.

### 3e. Client-module class — `public/*.js` sub-board (all 8 members)

| file | lines/90d | long-function members | disposition |
|---|---|---|---|
| `public/observation.js` | 4,614/46 | `deliverRulingReply` 365 (`:3201`), `renderRulingRow` 237 (`:1923`) | **finding / mint F-obs** — 08-29 clean verdict invalidated |
| `public/common.js` | 2,518/43 | `initNavBar` 242 (`:1964`) | **clean** — flat nav wiring, depth ≤5; canonical `stripCodeBlockWrapper` (`:401`) |
| `public/flight-companion.js` | 1,843/21 | `sendTurn` 242 (`:1404`) | recorded-not-promoted |
| `public/app.js` | 2,268/16 | `init` 355 (`:554`), `initPrompts` 287 (`:961`), `initRecommendations` 255 (`:1696`) | recorded-not-promoted |
| `public/live-console.js` | 1,385/18 | none ≥ 200 | **clean / below-threshold** |
| `public/dispatch.js` | 1,274/17 | `initDispatchPagePrompt` 259 (`:340`) | recorded-not-promoted |
| `public/swim.js` | 2,975/3 | `drawBlockingConnectors` 375 (`:1659`), `drawBlockingConnectorsVertical` 375 (`:2045`) | **finding (duplication), recorded-not-promoted** — near-twins; client-rendering duplication, dormant (last touch `c6ab69d8` is an unrelated one-line comment fix) |
| `public/ship-journey.js` | 676/11 | `paint` 253 (`:306`) | recorded-not-promoted |

The `swim.js` pair is a real near-twin (both 375 lines, sharing a large verbatim body) but is client-rendering duplication under near-zero churn, so it sits below the mint set. `public/observation.js` is the one client member that is **not** clean, and it is minted.

### 3f. simple-dispatcher row (graded; recorded-not-promoted)

**Same method at SD HEAD `3b1e734`** (tests included): `reapers.js` 3,513/74 = 259,962; `dispatcher.js` 2,148/82 = 176,136; `test/stall-failsafe.test.js` 3,763/38 = 142,994; `test/opencode-runner.test.js` 4,038/34 = 137,292; `hook.js` 2,101/62 = 130,262; `opencode-runner.js` 1,695/42 = 71,190; `config.js` 1,303/47 = 61,241; `test/hook-decision.test.js` 1,400/31 = 43,400; `executors.js` 773/43 = 33,239; `e2e-smoke.js` 2,076/16 = 33,216; `terminal-driver.js` 1,568/21 = 32,928; `test/e2e-smoke.test.js` 2,053/14 = 28,742. Its mega-functions (regex-sized, verified at research time) are `runStallFailsafe` ~930, `processPolledItem` ~744, `runOpenCode` ~677, `main()` ~577, `runOnce` ~500.

**Disposition — graded; recorded-not-promoted (cap spent).** simple-dispatcher is in this review's remit (ticket §4) and its tickets are routinely filed and dispositioned in the LIN queue (LIN-514 `dispatcher.js` split, Done; LIN-2720, LIN-2738, both Done; LIN-1456), so LIN-1933's missing lane does not prevent grading or minting. It only means simple-dispatcher is not auto-dispatched as a separate periodical target. **F-sd-stall — HIGH — `reapers.js:1575–2503 runStallFailsafe`**: 930 lines (≈417 code, ≈481 comment), ≈96 branch points, 36 commits touching its body in 90 days (12 since 08-29), grown 454 → 930 since 08-29. It hosts two open behavioural defects: LIN-2568 (`:2380–2381`, the generic stall-refire else-arm overwrites an opencode resume; the ticket's own 09-04 locus `:1969` has drifted) and LIN-2470 (the terminal-health cache `:1772–1775` lacks its dispatcher sibling's shape guard). No ticket owns its structure. **Batch, same reasoning, recorded-not-promoted:** `dispatcher.js:595 processPolledItem` 744, `opencode-runner.js:978 runOpenCode` 677, `hook.js:1515 main` 577, `dispatcher.js:1450 runOnce` 500, `hook.js:1100 decideHookActionInner` 379. **First promotion candidate for the next edition**, to be minted in LIN whether or not LIN-1933 has landed.

**SD CI observation (record only).** `simple-dispatcher/.github/workflows/ci.yml` now exists (`npm ci` + `npm test` unit job, `on: pull_request` + push to main), which makes **LIN-1456** (*"simple-dispatcher has no CI"*, Backlog) **stale**. Its disposition is not this review's to execute.

---

## 4. Clean results

- **`lib/chat-tools.js`** — `createChatToolCatalog` (`:1520–2219`, 700) is a flat tool catalog with small helpers; no tangled control flow. **Clean.**
- **`public/common.js`** — `initNavBar` (`:1964–2205`, 242) is flat nav wiring, depth ≤5; the file is also the canonical home of `stripCodeBlockWrapper` (`:401`). **Clean.**
- **`tests/unit/dashboard-routes.test.js`** — 5,686/47, #3 on the board, and factored to the house convention: **24 top-level named factory helpers** (`makeStores:43`, `activeItem:59`, `getHandler:93`, `makeReqRes:99`, `makeRouter:115`, `decisionItem:290`, `scopedStore:4235`, …). Large and high-churn, but not a finding. **Clean.**
- **`public/live-console.js`** — 1,385/18, no named function ≥ 200. **Clean / below-threshold.**
- **`LIN-2399` resolved** — the Jira ADF codec was extracted to `lib/providers/jira/adf.js` (Done 2026-09-02). Closed loop; no re-mint.
- **`LIN-681` Done** — the roadmap mock/baseline work is closed. Closed loop.
- **No real inline debt markers.** `grep -rE 'TODO|FIXME|HACK|XXX' lib/ routes/ public/ server.js` returns only the `LIN-####`/`TODO_TIER_CAP` marker substrings and one deliberate `LIN-XXXX` placeholder in prose (`public/observation.js:693`). The 08-29 "zero debt markers" verdict holds at HEAD.

---

## 5. Recorded but not promoted

Per the ticket's "record everything" rule, nothing found is lost. The following findings did not receive a ticket, with the reason stated:

- **F-sd-stall — `simple-dispatcher/reapers.js:1575–2503 runStallFailsafe` (§3f).** HIGH, ranked #1, unowned structurally, with two open behavioural defects inside it (LIN-2568, LIN-2470). Recorded-not-promoted **solely** because the 3-ticket mint cap was spent on LIN-3112/3113/3114 before the Tier-1 read surfaced it. **First promotion candidate for the next edition**, to be minted in LIN. The sibling SD batch (`processPolledItem` 744, `runOpenCode` 677, `hook.js main` 577, `runOnce` 500, `decideHookActionInner` 379) is recorded-not-promoted on the same reasoning.
- **Validation-duplication pair — `routes/dispatch.js:273` ↔ `routes/proxy-dispatch.js:218` (§3b).** Dispatch-request validation written twice, ≈104 by the Tier-1 reader's count (**87** exact trimmed-line matches by the author's re-measure); missed by the 8-line-window scan because the checks are interleaved differently. Recorded-not-promoted; adjacent LIN-1760.
- **F-mockbuilders — the mock-fixture-builder cluster (§3d).** MED, unowned, dormant, test-mode-only blast radius. Available to a future run if its severity profile changes.
- **F-store — the store `clear(urlKey)` family.** **17** `lib/` files define `clear(urlKey)` (16 `async`, plus one sync in `lib/sessions-feed-cache.js`), each hand-writing a `deleteMany({ urlKey })` wrapper with no shared store base. Recorded-not-promoted: each is an ~8-line wrapper (breadth without per-instance depth), and the canonical-store-convention angle overlaps Drift & Coherence.
- **F-fixture — `tests/unit/prompt-templates.test.js`.** 4,876 lines / 46 commits (224,296, #4), with **30** inline `const issue = {` fixture literals and no issue/context factory in `tests/fixtures/`. The 08-29 run's top unpromoted candidate; still unpromoted. Concrete cost: adding a field to the recommendation-context contract means hand-editing ~30 fixtures in one file.
- **F10 — `tests/e2e/proxy.spec.js`.** 3,124/23 (71,852), the 08-29 F10 continuation; still the coupled test surface for the proxy/dispatch churn. Recorded, unpromoted.
- **`public/swim.js` connector near-twin** (§3e) — real duplication, near-zero churn, client-rendering. Recorded.
- **The 14 duplicate-block pairs at ≥5 windows** beyond F-mockbuilders and the two loose-JSON pairs (§3b) — store/log/cache/config boilerplate and client mirrors, each shallow and overlapping an existing owner class. Recorded.
- **`lib/render-settings.js`** (1,506/35) and **`lib/prompt-template-defs.js`** (1,348/40) — high churn, flat template/data structure, no nesting or duplication found. Baselines hold, below the line.
- **The below-board long-function batch (§3a, 31 members)** — ≥200 lines without top-25 rank. Recorded.

---

## 6. Re-verified prior follow-ups — live states at execution time

Every ticket below was re-`GET`-ed from the workspace API during this session.

| ticket | live state | verdict at HEAD `b5c528c4` |
|---|---|---|
| **LIN-679** | Done | proxy split shipped; largest unit shrank, composition cost moved to the hub — headline §2 |
| **LIN-2360** | **Canceled** | operator ruling 2026-09-03: superseded; LIN-679 carried it. Cross-link only |
| **LIN-2245** | Done (`937555cd`) | instructions catalog extracted to `lib/proxy-instructions.js` (1,050). Closed loop |
| **LIN-2398** | Backlog | still real — `addFeedback` 286 (`lib/dispatch-store.js:2008–2293`); cross-link F-dispatch-store |
| **LIN-2397** | **Todo** | **not stale.** Code landed at HEAD (`routes/github-auth.js` 92, `routes/github-projects-auth.js` 96, both delegating to `lib/github-install-flow.js` 738). Done is withheld on parked human decision `lin2397-item1-route` (one install per surface: Issues via `/auth/github`, Projects via `/auth/github-projects`, each error page's "Try again" returning to its own base path) — a human precondition on a security-adjacent surface. The 09-19 board sweep only changed state |
| **LIN-2399** | Done (2026-09-02) | resolved; `lib/providers/jira/adf.js` exists. Closed loop |
| **LIN-1249** | Backlog | still real — `server.js` 4,085/143 = 584,155, #1; cross-link F-server-auth |
| **LIN-2246** | Todo | worse than 08-29 — `workspace-api.js` 4,234, family 5,263; cross-link F-workspace-api |
| **LIN-2071** | Backlog | class owner of the client↔server mirror family; not rivalled (cross-link from §3b) |
| **LIN-2847** | Backlog | class owner of the `isTestMode` duplication; cross-link F-mock |
| **LIN-3016** | Backlog | `formatDispatchWatch` hand-copies the formatter; cross-link F-proxy-dispatch |
| **LIN-680 / 1250 / 1251 / 1622** | Backlog | still real; no rival in-flight work found |
| **LIN-3017 / LIN-2979** | Backlog | peak-tool-count rule ×2 / fifth client SSE reader — repeated-decision owners; cross-link only |
| **LIN-681** | **Done** | closed loop; no re-mint |

---

## 7. Scope decisions

- **`simple-dispatcher` — graded, not minted this run (cap spent).** The lane argument does not hold: simple-dispatcher tickets live in LIN. Graded in §3f (F-sd-stall ranked #1); recorded-not-promoted solely because the cap was spent before the Tier-1 read.
- **Test-file maintainability — IN SCOPE, whole tree on the board.** §1's board includes tests; the bounded test findings are F-fixture (`prompt-templates.test.js`) and F10 (`proxy.spec.js`), both recorded-not-promoted. Test *adequacy* remains Test Coverage Gap's.
- **Client-side `public/*.js` structure — IN SCOPE, all 8 sub-board members dispositioned (§3e).** `public/observation.js` is re-graded from scratch (the 08-29 clean verdict is invalidated) and yields F-obs.
- **08-29 F6/F7/F8 re-decided.** `routes/dashboard.js`, `routes/dispatch.js`, `lib/pipeline-loops.js`: LIN-679 shipped end-to-end, testing the "bottleneck is capacity, not coverage" premise; history shows no structural follow-through from the split onto these files, and each remains a single large factory/loop. **Deferral upheld** — recorded-not-promoted, none unowned-and-severe enough to displace the mint set.
- **Sibling review seams — not re-flagged.** See §8.
- **No new tooling.** All measurements use `wc`, `git`, and lightweight built-in scans.

---

## 8. Follow-ups minted

Minted at the cap of 3, highest-severity unowned only, after search-before-mint. Each was created in team `LIN` in its default state and is `related` to LIN-3103 and to its cross-links.

| ticket | finding | cross-links (related) | sequencing |
|---|---|---|---|
| **LIN-3112** — *Decompose `public/observation.js deliverRulingReply` (365-line four-disposition orchestrator)* | **F-obs** — `public/observation.js:3201–3565` | LIN-2793 (locus `resolveRulingOptionLabel`, `public/observation.js:1911`), LIN-2784 | sequence the decomposition against both open behavioural tickets; do not land blind on the same function |
| **LIN-3113** — *Guard the adversarial-read gate: a comment that merely quotes the field list satisfies it* | **F-gate** — `lib/periodical-report-gate.js:117–119` | LIN-694, LIN-2323 (Done owners), LIN-2328, LIN-2576 (adjacent) | independent; gates this task's own Done transition |
| **LIN-3114** — *Extract a shared server loose-JSON helper: fence-strip → brace-slice → `JSON.parse` duplicated at 7 sites* | **F-json** — the 7 loose-JSON sites | LIN-1674, LIN-1672; build on `lib/openrouter.js:336 stripCodeBlockMarkers` | extract the shared helper **first**; land LIN-1674's salvage on the helper, not the standalone `lib/next-run.js` copy |

Search-before-mint results (re-run immediately before minting): F-obs — no structural owner (behavioural owners LIN-2793/LIN-2784 only); F-gate — no ticket names the defect (LIN-2328 is a watch, LIN-2576 widens the gate; LIN-694/LIN-2323 are Done owners); F-json — no shared-helper ticket (LIN-1674/LIN-1672 are behavioural). All three remain unowned, and all three were minted.

---

## 9. Deliberately not re-flagged — owned by a sibling review

- **Doc / contract accuracy** → **Documentation Review** (includes `/api/proxy/instructions` as a documentation surface; F-json and the headline treat it only as code bulk).
- **Dependency direction, cross-cutting duplication, canonical-convention fragmentation** → **Drift & Coherence** (includes the build-step / `public/`-imports-`lib/` question; the store/config boilerplate pairs in §3b report per-pair cost only, never the architectural remedy).
- **Interface / contract shape** → **API Quality**.
- **The rendered product** → **Design & Interface**; stylesheet *structure* stays here by standing arrangement.
- **Test adequacy / coverage** → **Test Coverage Gap**; test-file *maintainability* is in scope here and produced §3a/§5.
- **Rate-of-change convergence** → **Stability Review**; §1/§2 growth figures are maintainability trend, not a convergence verdict.
- **Reader comprehension / missing rationale** → **Comprehension-Debt**.
- **Performance / scale** → **Performance / Scale**.
- **Data / fetch architecture** → **Data & Fetch Architecture**.

---

## 10. Method notes

- **Queries.** Board: `git ls-tree -r --name-only HEAD` → `*.js`/`*.css` minus exclusions → `wc -l` × count in `git log --since=90.days --name-only --pretty=format:`. Long functions: brace-matching span scan, strings/templates/regex skipped, ≥200 lines, named functions only. Duplicates: normalised 8-line windows over non-test `.js`, threshold ≥5 shared windows. Every size figure was re-derived from a complete boundary set and read at source.
- **Merge-counting note.** The churn method counts merges differently from `git log --oneline -- <file>` (merge-commit-blinding): `server.js` reads 143 here against 148 by the oneline method. Rank order is unaffected; one method is used consistently throughout.
- **The 08-29 "largest 183" is quoted, not re-measured.** The claim that `public/observation.js`'s largest function was 183 lines at the 08-29 HEAD is taken from the 08-29 report; it was not re-measured at `b78c4499`. The current figure (365) is measured at `b5c528c4`.
- **Scanner-fidelity note.** The long-function count resolves to 63 (plan: 62; plan-review: 63). The difference is scanner fidelity — regex literals containing quotes can mis-close a naive brace matcher; the count here uses a regex-literal-aware scanner.
- **The bar applied.** A finding names (i) a `file:line` at HEAD, (ii) a second site or a measured delta, and (iii) a change that would be risky or a bug likely. Rejected by construction: renames, reformatting, "this file is big", and any metric that moves without removing a decision point.

---

## Adversarial Second-Read

**Tier:** Tier 1. A separately dispatched review session (dispatch `f49348e1`, `eee71d37`, `c2bcb026`) with no memory of the authoring run. Caveat: the research and plan are embedded in the LIN-3103 description, which the reader read for the §0–§7 remit. The reader did not read any comment (research, plan or plan-review) before forming the cold answer.

**Cold question:** What is the largest item in this review window that this report missed or misfiled?

**Answer:** `simple-dispatcher/reapers.js:1575–2503 runStallFailsafe`, misfiled as observation-only. It is 930 lines (≈417 code), ≈96 branch points, with 36 commits touching its body in 90 days (12 since 08-29), grown 454 → 930 since 08-29. Two open behavioural defects sit inside it (LIN-2568 at `:1969` [current locus at `3b1e734`: `:2380–2381`], LIN-2470 at `:1772–1775`), and no ticket owns its structure. Against F-obs (`deliverRulingReply`: 365 lines, ≈172 code, ≈25 branch points, 13 commits touching its body in 90 days), it is larger on every measure. The report's reason for not grading it is contradicted by the workspace: simple-dispatcher tickets are filed and closed in LIN routinely (LIN-514, LIN-2720, LIN-2738, LIN-1456). The claim that its largest units are smaller than LinearViewer's top closures compares an imperative function with route-factory containers. It is in remit (ticket §4) and inside the §3f class the report bounded. The same reasoning covers `processPolledItem` 744, `runOpenCode` 677, `hook.js main` 577, `runOnce` 500 and `decideHookActionInner` 379.

Secondary items: (1) dispatch-request validation is duplicated between `routes/dispatch.js:273` and `routes/proxy-dispatch.js:218` (≈104 shared distinct lines; adjacent LIN-1760), and the §2 handlers had no disposition. (2) F-gate's mechanism is broader than described: unanchored predicates match the ticket-description form and negated prose, not only the pipe template, so LIN-3113's lookahead remedy is incomplete.

**Resolution:** the report was corrected before merge. F-sd-stall is graded as rank 1 and recorded-not-promoted because the cap was spent, and it is the first candidate for the next edition. The mint set (LIN-3112/3113/3114) is unchanged.

**Gate fields (copied literally from the gate comment `a8eb57d2`):**
Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
