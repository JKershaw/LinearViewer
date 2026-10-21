# Documentation Review — 2026-10-21 (periodical run, drift-first) — supersedes `documentation-review-2026-09-26.md`

*Review-only: no code, docs, config or secrets changed except this report. Severity-ranked, uncapped; follow-ups capped at ~3. Table-first by design (the 09-26 report was 585 lines).*

**HEAD audited.** `LinearViewer` @ `821cf841e84ef0b151f545321902fcd12e2b7b1a` (= `origin/main`, 1,153 commits after `b5c528c4`; the ticket's "~1,171" was a seed) · `simple-dispatcher` @ `bb1da78e29a99940dc5aa37cf7e826992db097f5` (= `origin/main`, 61 commits after `3b1e734b`). Neither repo had a commit after the ticket was created. Key claims in HEAD were re-read at write time.

**Method.** Each doc claim was treated as a hypothesis and located against source at HEAD. Counts were taken by **executing** source, not grep. Findings below carry file:line at HEAD; earlier-run prose was not trusted.

| Count (executed) | HEAD | Doc state |
| -- | -- | -- |
| `PROMPT_TEMPLATES` | 17 | "14" survives at `docs/executive-summary.md:34,131` |
| `EXPERIMENTAL_VIEWS` | 9 | `docs/view-tiers.md` names 7 (LIN-1856) |
| `lib/providers/` | 5 | ok |
| `PERIODICALS` | 16 | ok everywhere (`lib/periodicals.js:225`) |
| SD `PHASES` | 8 | SD `docs/session-lifecycle.md:27` says 7 |
| SD `TERMINAL_DRIVERS` | 4 | SD `docs/substrate.md:14` lists 2 |

**Guards.** LV `CLAUDE.md` = 110 lines / 10,780 B (limit 110 / 12,000: at the line limit, so any edit to it must remove a line). LV `claude-md-line-budget`, `docs-architecture-anchor-resolver`, `prompt-templates` pass; SD `claude-md-*` guards pass. 0 TODO/FIXME/HACK in both repos. `.claude/` config resolves.

---

# Findings, severity-ranked

| # | Sev | Finding | Evidence (HEAD) | Owner |
| -- | -- | -- | -- | -- |
| 1 | **HIGH** | **LIN-3300 retirement residue.** The meta-prompt (`lib/prompts/meta-prompt-template.js`, deleted `19d7198a`, 2026-10-04) is still described as current at 8 live sites, contradicting `CLAUDE.md`'s one-path invariant and `docs/architecture/prompt-system.md:10` | `CLAUDE.md:110` (rewritten 10-18, after the deletion); `docs/executive-summary.md:28` ("Two Independent Paths"), `:208` ("update … the AI meta-prompt"); user-facing `lib/render-prompts.js:107` (section titled "Meta-Prompt", now renders router output, `lib/audit.js:610`); `docs/prompt-audit-instructions.md:170-190`; `docs/prompt-feedback-strategy.md:98,138,207`; `stage-descriptions/plumbing.md:62,185` (frozen total 568534 vs 343285 at `tests/unit/prompt-size-budget.test.js:153`); `stage-descriptions/README.md:18`; `retro-audit.md:136,288` (ceilings 4114/4161 vs 4265/4427, `prompt-size-budget.test.js:103-104`) | **M1 (minted)** |
| 2 | MED | `docs/dispatch-integration.md:283` is false: "The runner kit sends the same body to `POST /api/proxy/runner/heartbeat`". The kit makes 0 such calls; `lib/runner-kit/contract.json:289` says "not sent". Doc written ahead of build. Third consecutive sibling hand-off with no ticket (Drift & Coherence 10-18, 10-19) | feature owner LIN-3636 | comment on LIN-3636 |
| 3 | MED | `CLAUDE.md:69` ("landing page with static projects preview") is false: landing is the LIN-980 showcase (`server.js:2175`, `lib/render-landing.js:4-7`); `content/landing.md` feeds only `/swipe`,`/swim`,`/ship` previews (`server.js:2201,2225,2246`). Same section as H3 | LIN-2391 | comment |
| 4 | MED | **SD-H7 re-drifted under an edit.** `session-lifecycle.md:27` now says "7 phases" (8; AWAITING_EXTERNAL missing from the list though named at `:77,:83,:85`; stray `)` at `:30`); `module-map.md` omits 11 of 41 root modules (8 in no SD doc, incl. `duplicate-launch.js`); `substrate.md:14` 2 of 4 drivers; `testing-and-ci.md:26-27` 2 of 4 macOS suites; `deployment.md:28,38` dangling "above"; `phases.js:24-27` and `config.js:551-563` say "BLOCKED never ends" (false since LIN-3585, `reapStaleBlockedSessions`, `BLOCKED_REAP_MS`); `README.md:65` "two-phase" | third run recording it | **M2 (minted)** |
| 5 | MED | Served catalog (H1): half-closed. Fixed: `DISPATCH_GRANT_REQUIRED` at `lib/proxy-instructions.js:1080`. Still absent: `PERIODICAL_REPORT_NOT_PERSISTED`, `PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED` (`lib/periodical-report-gate.js:123,137`; 0 hits in catalog/guide/llms.txt), `/snapshots`, `/prompt/{templateKey}`; 409 quick-ref `:1085` lists only the trashed refusal. New contradictions: grants table `:922` has an unmintable `readWrite`+`take` row (`take` needs `dispatch`, `lib/proxy-scopes.js:29`; guide `docs/proxy-integration.md:112` is right); TTL summary `:1034-1035` ("every … 48h") contradicts the 90d row `:1023`. Served catalog is byte-identical to source; all 9 new proxy routes documented. *(Added by second-read)* LIN-3622 (`bba51895`) restricts runner poll/take to `cli`/`web` (`routes/proxy-runner.js:116,156`, `lib/dispatch-targets.js:29`); catalog `:942-943` and `docs/proxy-integration.md:263` state no target restriction | LIN-2390 | comment |
| 6 | MED | H6 `docs/architecture/source-map.md` worse: 153,272 B / 329 lines / 36 lines >1k chars (was 103,596 / 248 / 23); longest line 9,007 chars at `:62`; 76 commits in window, 28 touching ≤1 line. Omits `lib/providers/github/installation-pages.js`, `app-auth.js`, two email routes (`:16`); `:94-95` says 14 `LISTED_DOCS`/2 papers (15/1 at HEAD) | human decision (below) | not minted |
| 7 | MED | `effort` accepted by POST /dispatch (`lib/dispatch-entrance.js:1111,1280,1336,1688`) but absent from catalog body (`:786`) and guide | LIN-2656 | comment |
| 8 | MED | Post-split `routes/proxy.js` citations (it now serves only `/instructions`, `:1297`): 3 docs (`source-map.md:142,224`, `docs/passage-runner-prompt.md:11`), 9 inline (`lib/dispatch-store.js:500`, `lib/issue-write-validation.js:6`, `lib/plan-review-round-trips.js:54`, `lib/providers/linear/index.js:1674`, `lib/workspace.js:1069`, `routes/workspace-api.js:1572,2889`, `simple-dispatcher/hook.js:1131`, new `lib/periodicals.js:31`), 10 tests. DC-fields half (a) fixed | LIN-3116 | comment |
| 9 | MED-LOW | Env drift: SD 109 unique vars, **48 undocumented** (was 39; new: LIN-3208 retry knobs `config.js:1157-1179`, `:856`, `:894`, `signal-guard.js:107`); LV runtime 9 absent from both docs (`FEEDBACK_PROJECT_ID`, `FEEDBACK_TEAM_ID`, `HARBOUR_DATA_DIR`, `HARBOUR_DISABLE_AI_MOCK`, `OBSERVATION_FEED_TIMING`, `OPENROUTER_API_URL`, `JIRA_OAUTH_TEST_BASE`, `HTTP(S)_PROXY`). Grep blind spot: `lib/plan-allowance.js:150` reads `env.X` | record only | — |
| 10 | MED-LOW | `docs/architecture/auth.md:94-100` omits `GET /auth/email/register` and `/auth/email/reproof` (`routes/email-auth.js:374,389`) | — | record |
| 11 | MED-LOW | Unguarded hand-written counts (C4): `docs/executive-summary.md:34,131` (LIN-3115, guard skips `render-landing.js`, `prompt-templates.test.js:224-228`); SD `session-lifecycle.md:27`; `source-map.md:94-95`; `scripts/code-shape/README.md:19` ("Five more" lists 6); `docs/runner-prompt.md:13` ("~73 KB", is 94,689 B; runtime source, `lib/prompts/runner-kickoff.js:41`); `docs/theseus-method-long.md:282` ("eleven areas", `areas.json` has 12); `server.js:2285` | LIN-3115 | comment |
| 12 | MED-LOW | Stale status lines (C5): `docs/plans/kpi-daily-rollup.md:3` ("build is a separate ticket"; built `d2da45a3`), `docs/runbooks/improvement-cycles.md:84` ("until LIN-3661 lands"; landed `b6beb380`) | — | record |
| 13 | MED-LOW | `stage-descriptions/*`: only 45 of 287 (16%) line citations still hit the same text; central claim (`plumbing.md:9`, "prompts come mainly from the meta path") overturned; no superseded banner and sweeps keep editing them as live (`ec21bf9a`) | folded into M1 | **M1** |
| 14 | LOW-MED | CI-doc twin, now 3 copies: `docs/architecture/ci.md:48`, `CLAUDE.md:104` ("unit and e2e jobs"), `.github/workflows/test.yml:145`; `ci-success` needs `[unit, e2e, secret-scan]` (`test.yml:150`) | — | record |
| 15 | LOW | Stale inline comments: `routes/proxy-compute.js:108,188`, `routes/task-chat.js:58` ("mirrors workspace-api.js"; builders in `lib/workspace-api-mocks.js:186,239`); `lib/workspace-owner.js:27` and `lib/connection-credential.js:1403` (`isOwnerAnswer`, 0 callers); `routes/workspace-api.js:102-103`; `lib/consumer-poll-warning.js:8-9,58` and `lib/dispatch-tokens.js:19` ("poll/take"); `tests/e2e/prompts-page.spec.js:5`, `tests/e2e/templates.spec.js:17`; SD `feedback.js:19` + `test/feedback.test.js:542,565` cite `dispatch-terminal.js:53` (real `:63`) | — | record |
| 16 | LOW | H9–H12 hold: H10 `docs/direction-layer-proposal.md:21` (sixth run); H11 `public/llms.txt:156` unscoped `/api/recommend/status` (client uses scoped, `public/app.js:1815`); H12 `server.js:2285` | — | record |
| 17 | LOW | `executive-summary.md:207` "monospace font" contradicts mono/sans split; `:146` "Session-based (Linear OAuth) for all user routes" false (H3 framing at `:5,:8,:18,:43,:116,:218`); `content/landing.md:66` Linear-OAuth self-host prompt (LIN-3510) | LIN-2391 / LIN-3510 | comment |
| 18 | LOW | SD: `CLAUDE.md` `loadState`-cache line points at `docs/substrate.md`, which never mentions it; README auth-stop omits credentialDead workspaces in `authStoppedWorkspaces`; LIN-2177 holds | — | record |

## Discoverability and growth (assessed subtractively)

| Surface | Fact | Assessment |
| -- | -- | -- |
| `docs/reviews/` | 946 files / 28.9 MB (+776 in window, 730 under `_evidence-2026-09-26/`); 65 top-level reports; no index, no supersession marker; 2 names break `<name>-<date>.md` (`-10-11-post-batch`, `-10-12-tests`) | Finding: "latest report per periodical" needs a directory listing. Suggest an index (human call; not minted) |
| `experiments/` | 570 files / 21 MB, no README, unreferenced from `CLAUDE.md`/`source-map.md`; `docs/architecture/experiments.md` is about Collective (confusing name) | Discoverability finding only; content is commit-pinned lab notes |
| `docs/papers/README` | 87 of 89 indexed; missing `fleet-complexity-read.md`, `replay-small-work-preregistration.md` | LOW |
| `docs/`, `runbooks/`, `incidents/` | no index | LOW |
| Catalog / guide / llms.txt growth | 1,050→1,183 (+12.7%) / 2,565→2,796 (+9.0%) / 677→788 (+16.4%) | Growth is mostly new routes (documented); llms.txt selectors swept for H11/LIN-2255 only |

# Existing-ticket comments and close recommendations

| Ticket | State | At HEAD | Action |
| -- | -- | -- | -- |
| LIN-3074 (H13 halt copy) | Backlog | **fixed**: 0 non-test hits; test sites now assert the old wording is gone (`tests/e2e/dispatch-halt.spec.js:128`, `render-dispatch-exec-controls.test.js:43,52-53`, `runner-kickoff.test.js:109-110`) | recommend close |
| LIN-3599 | Open | **fixed**: `auth.md:178-179` | recommend close |
| LIN-2629 | Open | resolved in doc (`proxy-integration.md:1261-1263`) | recommend close |
| LIN-687, LIN-1233 | Backlog | fixed/superseded; third recommendation | recommend close |
| LIN-2392 | Done | confirmed (`content/landing.md:13,18`, guard `prompt-templates.test.js:227`) | none |
| LIN-2390, 2391, 3115, 3116, 3117, 1856, 2656, 3594 (line moved to `:115`; `groupDispatchLineages` is at `lib/dispatch-lineage.js:158`), 3510, 3636 | open | see findings above | comment measurements |
| LIN-3117 (N1) | Backlog | holds: 4 broken root-relative links (`dispatch-and-proxy.md:66,96`, `prompt-system.md:46`, `views.md:5`) | comment |

Known-owned open doc tickets (not re-minted): LIN-1029, 1091, 1171, 1320, 1356, 1443, 1599, 1723, 1779, 1806, 1940, 2082, 2177, 2204, 2255, 2295, 2344, 2465, 2481, 2482, 2714, 2753, 2795, 3063, 3510, 3571, 3577, 3594, 814, 883.

# Clean results

- Seven of the eight window retirements are clean (share links, project `repo=`, ifParked, funnel-events, E1/E2, ticket-closed sweep, "merged by you"); live docs omit them or correctly say retired (e.g. `proxy-integration.md:1842`, `docs/v1.md:115`).
- Served catalog byte-identical to source; 9 of 9 new proxy routes documented; 9 of 11 spot-checks hold. `item.force` (`proxy-integration.md:2311`, `lib/dispatch-fields.js:100`), `session-telemetry.js:662-670`, `openrouter.js:1831` ("ceiling of 5" = `REVIEW_LOOP_CEILING`, `lib/recommendation-facts.js:406`, hard-coded literal) hold. SD README auth-stop and heartbeat sections match code; SD `test/runner-contract.test.js:14` pin resolves. SD has 0 broken links.
- New surfaces with ≥4/5 claims holding: `operator-execution.md` (no inbound link), `steady-base.md`, `plan-allowance-design.md`, `kpis-public-design.md`, `runbooks/{account-erasure,runner-hosted-witness,kpi-daily-rollup-backfill}.md`, `community-answers/`.
- `docs/pipeline-design-history.md` is bannered "Superseded" (`:3`): point-in-time, not drift. 45 further LIN-3300 mentions are dated or bannered records and are excluded.

# Seed corrections

- LV is 1,153 commits ahead (not ~1,171). `PERIODICALS` = 16 and all docs agree. Judgment call, not drift: "AI-generated prompt recommendation" (`lib/proxy-instructions.js:266`) is half-true (a model picks the stage; code writes the prompt).

# Minted / not-minted

| Finding | Disposition |
| -- | -- |
| 1 + 13 | **Minted M1**: LIN-3300 residue (8 sites + superseded banner on `stage-descriptions/`) |
| 4 | **Minted M2**: SD area-doc enumerations + stale BLOCKED comments; add an executed-count guard (`PHASES`, module-map census) on the model of `prompt-templates` |
| 2 | Not minted; doc half assigned by comment to LIN-3636 |
| 3, 5, 7, 8, 11, 17 | Comment on existing owners |
| 6 | Human decision |
| 9, 10, 12, 14–16, 18, discoverability | Record only (next run may promote) |

# Sibling seams

Stale Linear ticket text cited by docs (LIN-3616, LIN-3475, LIN-3624): class unbounded (production data, not source); recorded, fixing ticket text is not doc editing. Contract behaviour (e.g. LIN-1564 400-vs-404) stays with API Quality; module rationale with Comprehension-Debt; rendering with Design & Interface; entry walk with Onboarding. Coverage not exhaustive: the 2,796-line guide was spot-checked, not swept; `public/llms.txt` beyond H11/LIN-2255 is the largest unswept surface; C3 (doc-ahead-of-build) is bounded only by a PCRE grep for runner-kit claims.

# Trend ledger (vs 2026-09-26)

| Item | 09-26 | 10-21 |
| -- | -- | -- |
| H13 halt copy | HIGH | fixed |
| H3 Linear-only | HIGH | holds (+`CLAUDE.md:69`) |
| H4 landing | HIGH | fixed (LIN-2392) |
| N2 count guard | MED | partly fixed |
| DC-fields | MED | (a) fixed, (b) holds |
| H1 catalog | MED | half-closed + 2 contradictions |
| H6 source-map | 103,596 B | 153,272 B (+48%) |
| SD-H7 | 12 modules omitted | 11 omitted, phases re-drifted |
| SD env undocumented | 39 | 48 |
| New: LIN-3300 residue | — | HIGH |

# H6 · human-decision item

`source-map.md` is now 153,272 B / 329 lines / 36 lines >1k chars, with 76 commits in the window (28 single-line touches). The decision is unchanged and still human: *generate* the map from the tree, or *pin* selected entries mechanically (the `claude-md-scheduler-jobs-census` / `prompt-templates` precedent, which M2 proposes for SD too), not a third manual backfill. Recorded, **not minted**.

## Adversarial Second-Read

**Tier used:** Tier 2 (fresh-context sub-agent; Tier 1 unavailable, token lacks the `dispatch` grant).
**Question:** What is the largest item in this window that this report missed or misfiled?
**Reader's answer (condensed):** No item larger than #1 found. Best miss: LIN-3622 made runner poll/take serve only `cli`/`web` targets (`routes/proxy-runner.js:116,156`, `lib/dispatch-targets.js:29`) while catalog `lib/proxy-instructions.js:942-943` and `docs/proxy-integration.md:263` state no restriction; MED/LOW, belongs under finding #5 (LIN-2390). Agrees #1 is the top finding (checked `lib/render-prompts.js:107`, `docs/executive-summary.md:28`, `lib/plan-review-round-trips.js:27`; did not independently check the "8 sites" count). Spot-checks #2, #3, #4 hold. Notes #2 is arguably over-ranked against #5. LIN-3199's SUMMARIZING removal is handled in SD docs, not drift.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place

(The missed item was added to finding #5 above; it is a different, smaller item and does not displace #1.)
