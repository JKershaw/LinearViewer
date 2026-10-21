# Summary: S-evidence counts and exception rows (LIN-3766, beats 1–2)

The one file the scoring step reads. Counts and exceptions only; the row tables are in `importer-dispositions.md`, `citation-repoints.md` and `rerun-outputs.md` and are not needed to score. Pins: LinearViewer `c5694b68`, simple-dispatcher `bb1da78`, both `origin/main` at fetch 2026-10-21T12:02:30Z. Window `e69e2cc9..c5694b68`; simple-dispatcher `3b1e734..bb1da78`.

## 1. Pins and drift

- Drift: **none**. 0 commits in either repo since 2026-10-21T10:57:26.014Z or 10:22:07Z, and 0 after the pins (`rerun-outputs.md` Q3). The first finding therefore records "no drift" plus the mint-text errata; it does not stop or change the approach.
- Evidence subfolder `docs/reviews/_evidence-2026-10-21/integration-surface-maturity/` was free (0 `integration-surface`/`isml-4` files among 845); no `isml-4-*` prefixes.
- Sibling freshness at the pin: 68 top-level report files in `docs/reviews`, 16 dated after run 3 (listing in `rerun-outputs.md` Q10). Re-list at scoring time and record any newer edition as a dated note (research §6.5).

## 2. Window and the 134 added files

- 1,158 commits (577 touching `lib`/`routes`/`server.js`); 134 added files (120 lib + 14 routes), 0 renamed, 3 deleted under `lib`/`routes` (18 repo-wide); simple-dispatcher 61 commits (48 non-merge), 110 files, +10,956/−946.
- **Dispositions: 58 folds + 65 under 11 new ids + 11 exclusions = 134.** `mod-stage-router` is folded into `mod-prompt-template-system` (plan decision 1; the parent C1 had 54 + 69 + 11). Scored denominator 40 carried + 11 new = **51 + META**.
- Folds by carried id (22 ids, all run-3 ids; none collides with a new id): `mod-prompt-template-system` 11, `flow-account-connection-workspace-credential` 9, `mod-kpi-audit` 8, `mod-observation-materializer` 4, `api-workspace-proxy` 3, `flow-autopilot-wake` 3, `flow-dispatch-lifecycle` 3, `flow-flight-companion-turn` 2, `mod-dispatch-queue` 2, `api-dispatch` 1, `api-github-app` 1, `api-mongodb-storage` 1, `flow-account-merge` 1, `flow-bootstrap-token-exchange` 1, `flow-cost-telemetry` 1, `flow-dispatch-halt` 1, `flow-followup-resume` 1, `flow-free-tier-rate-limit` 1, `flow-oauth` 1, `flow-operator-decisions` 1, `mod-scheduler` 1, `mod-secret-scan` 1.
- New ids (11): `flow-run-evidence-closeout` 10, `api-runner-kit` 8, `flow-email-identity` 7, `flow-workspace-lifecycle` 7, `flow-consumer-liveness` 6, `mod-task-page` 6, `flow-agent-grants` 5, `mod-dispatch-entrance` 5, `flow-task-share` 4, `mod-library` 4, `mod-response-hardening` 3.
- Exclusions (11): `lib/drop-shares-collection.js`, `lib/expire-ownerless-dispatch-tokens.js`, `lib/loose-json.js`, `lib/read-horizon.js`, `lib/sample-data/mock-data.js`, `lib/sample-data/ship-dense-sample-data.js`, `lib/sample-data/swim-sample-data.js`, `lib/should-mock-ai.js`, `lib/utils/time.js`, `lib/workspace-api-mocks.js`, `lib/workspace-lookup.js`.
- **Zero production importers (4):** `lib/account-erasure.js` (used by `scripts/erase-account.mjs:35` only), `lib/drop-shares-collection.js` and `lib/expire-ownerless-dispatch-tokens.js` (scripts-only one-off migrations), `lib/runner-kit/contract.json` (a test fixture by its header, read by `fs` in `tests/unit/runner-kit-contract.test.js:38`). The other 130 files have at least one production importer, resolved by full path (the three duplicate basenames do not collide).
- **Deleted files (3):** `lib/dispatch-repo-guard.js` and `lib/workspace-repos.js` (both `e1a80856`, LIN-3333): evidence retired (run-3 lines L80, L283–284, L367, L408, L426, L457, L541, L612), the run-3 R8 "resolved" instance retired, no remaining references in `lib routes server.js public`; `isGitHubRepoSlug` survives at `lib/github-pr-status.js:61`. `lib/prompts/meta-prompt-template.js` (`19d7198a`, LIN-3300): no run-3 cite; `mod-prompt-template-system`'s "what it is" cell is updated; one stale mention remains as a comment at `lib/plan-review-round-trips.js:27` (findings-step sighting, not a count). The other 15 repo-wide deletions are scripts/tests, uncited by run 3 (0 basename hits).

## 3. Bounds: reproduced and not

| Bound | Plan | Re-run at the pin | Status |
| -- | -- | -- | -- |
| Window, added, deleted, renamed, simple-dispatcher | 1,158 / 134 / 3 / 0 / 61 (48) | same | reproduces |
| C3 churn (`adf.js` #9, `render-roadmap.js` #20, `openrouter.js` #22; rebuild commits 21 − 5) | as written | same | reproduces |
| C4 / C5 (state writers; gate calls) | 5 writers, 1 gated; 1 call | `:365` def, `:374` call, `:416` wrapper call, `:429` write; only `:475` writes description | reproduces |
| C6 (scheduler) | 7 registered + 1 bare | `server.js:801/868/898/928/948/980/1009` + `:4599`; also `lib/runner-kit/broker.mjs:530` (user-machine kit, not a server job) | reproduces |
| C8 halt copy | 52 hits, 17 files | same | reproduces |
| C9 Arm A | 60 lines | 60 | reproduces |
| C9 provenance | 11 predate, 8 newer (of 19) | by `git blame`: 11 / 8 | reproduces |
| **C9 Arm B** | 73 lines / 61 tickets | literal pattern 7 (case-sensitive) or 10 (`-i`); wider forms 50, 55 | **does not reproduce; members are read, count not load-bearing** |
| C10 strict | 132 raw / 98 unique | 132 / 98 | reproduces |
| **C10 total groups** | 143 | **137** (53 bare unique, 36 new, 0 unresolved, 3 slash) | **differs; 137 used** |
| C11 | 19 commits, 10 ids | 19, 10 ids | reproduces |
| **C11 PRs** | "six PRs" listing seven numbers | 6 ids with a squash PR, **7 PR numbers** (#1805 #1816 #1817 #1923 #1930 #1941 #1969) | wording fixed |
| C12 registry | 16 entries | 16 | reproduces |
| **C13 sample** | 20 of 17,765 | 20 of 17,780 at 12:04Z; 3 taken, all this workspace's own LIN-3766 dispatches; `periodicalId` absent from list rows and from `GET /dispatch/{id}` | illustration only |
| **C14 Arm 1** | 45 + 22 = 67 | reconstructed regexes give 28 + 26 = 54 (regexes were never written down; now recorded in Q34); the 13 kept members are named commits, all in the window | count does not reproduce; members stand |
| C-plan-1 | 15 files | 15 | reproduces |
| Misc | `BUILDER_VERSION` 18, 14 router mounts | 18 (`lib/observation-sessions-store.js:184`), 14 | reproduces |
| Mint error 1 (observer efficacy) | 0 production importers | 0; `observer-shadow-log.js` imports only `crypto` (`:53`) | reproduces |
| Ledger seed | 41 ids (17 MOD / 9 API / 14 FLOW / 1 META) | 41, rows verbatim | reproduces |

## 4. Citation re-points (137 groups, content-checked)

- **Final counts: PASS 110 / REVERSED 19 / RETIRED 7 / UNRESOLVED 1 = 137.** Sub-agents returned 111 / 18 / 7 / 1; one orchestrator override (G7). Excluding 4 rule false positives (G72, G133, G134, G135: bare `:N` cites that point at report lines, or duplicate G42, not code): **110 / 19 / 4 / 0 = 133**.
- Second pass: all 111 PASS anchors re-verified mechanically at the pin, 110 clean, 1 (G83) read by hand and confirmed. Fallback trigger (non-PASS + UNRESOLVED > ~40, or passes disagree) did **not** fire: 27 non-PASS rows.
- **The 19 REVERSED + real RETIRED collapse into these claim families** (these become the first-finding block with the mint-text errata):
  1. **R5, free-tier key** (G17, G18, G25): the `global:global:` double-prefix is fixed; one `_getGlobalHourKey` for read and write (`lib/free-tier-store.js:97-99,149,225`).
  2. **R10, halt copy** (G40, G41, G42, G87, G88, G89, G90, plus RETIRED G86): text now says the runner honours a stored halt; the stale "pending LIN-2995" claims are gone. Consistent with C8 (0 production members).
  3. **R11, scheduler** (G43–G46): four jobs became **7** (`server.js:801–1009`).
  4. **Router mounts** (G65): 11 became **14** (`routes/proxy.js:1277–1611`). Related: G73 (`proxy-kickoff` no longer imports `consumer-poll-warning`; now via `lib/dispatch-entrance.js:63`) and G74 (`proxy-reads` no longer imports `dispatch-repo-guard`).
  5. **R7, "exactly two routes can set a state"** (G7, orchestrator override): now 3 update-path writers (1 gated) plus 2 ungated create routes.
  6. **R8, deleted modules** (RETIRED G2, G3): `dispatch-repo-guard.js` / `workspace-repos.js` gone.
  7. **R12, `pipeline-loops`** (RETIRED G56): the LIN-2187 stale comment is gone (`lib/pipeline-loops.js` no longer carries it).
  8. **`BUILDER_VERSION` 16 → 18**: stated inside the text of G62/G132 (PASS on location), not a separate group; the re-run is `rerun-outputs.md` Q39.
  9. **G131** (historical narrative in run 3's Second-Read: "the report is silent"): no longer true; nothing to re-point.
- **PASS rows with a stale parenthetical:** G108 (`CLAUDE.md` is 110 lines, not 106; content relocated to `docs/architecture/source-map.md:143`).
- Judgement calls the sub-agents flagged and the orchestrator accepted: G8 (`routes/proxy.js:3487` → `routes/proxy-writes.js:429`), G37 (→ `routes/proxy-dispatch.js:152-158`), G123 (→ `routes/proxy-writes.js:46`).

## 5. Carried to later steps (open, not decided here)

- **Fidelity gaps in the plan** (beat 1): `public/app.js` and `public/flight-companion.js` (LIN-3385/3401) are absent from C3's "must not file unchanged" list; the ledger "what it is" cells for `flow-account-connection-workspace-credential` (add Connection) and `mod-prompt-template-system` need updating; the "a rename on either side fails a test" overstatement belongs in the runner-contract finding; research §8 caveats (`credential-health`, alarms) belong in scoring.
- **Paired-PR count:** research and the plan say 5 paired contract PRs (including simple-dispatcher `bb1da78` ↔ LinearViewer #1992), but #1992's subject is LIN-3618, so C11's shared-id rule cannot see that pair. Bound it separately before the report states a figure.
- **Disagreements with research, flagged:** R12 ("worsened", not "improved 5→4": research's own 4 persisting + 2 new = 6 > 5); LIN-3649 (not LIN-3417) is the open readiness-lane ticket (confirmed in LIN-3634's description via the API); denominator 51, not 52.
- **N5:** `api-openrouter` needs a content reason (commits `3ee41011`, `279258c9`, `a89c43b7`, `8c41aa19`; `lib/openrouter.js` has 31 window commits) before it is filed unchanged.
- **N3:** the Arm 2 editions read and the Code Quality F-dashboard disposition go in `c14-members.md`, together with the C9 member table (`c9-members.md`, with the `observer-sweep:645` vs `credential-invariant-sweep:20` borderline reason, N4) in the scoring step.
