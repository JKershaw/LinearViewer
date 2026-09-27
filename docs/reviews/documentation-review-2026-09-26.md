# Documentation Review — 2026-09-26 (periodical run, drift-first, post-CLAUDE.md area-doc split)

*Review-only: no code, docs, config or secrets changed except this report artifact. Severity-ranked, uncapped; follow-ups capped at ~3.*

**HEAD audited.** `LinearViewer` @ `b5c528c4807acc2222f4afd6fe2b87ded41fdf89` (= `origin/main`) · `simple-dispatcher` @ `3b1e734b5496941ef5a7ecfb9497741f275d67fa` (= `origin/main`), re-fetched and re-verified immediately before writing. **Drift since the plan-review grounding (`b5c528c4`/`3b1e734`): 0 commits in either repo.** Drift since the ticket's own seed SHAs (`6e8bf424`/`3b1e734`): `LinearViewer` 2 commits (`b5c528c4`, `207c1e71`, both LIN-3097), touching only `scripts/eval/jev-spike*` — **no doc-relevant files**. The ruling's warning that "the tree has moved tonight" did not materialise at fetch time; every plan-time line number reproduced. **Review-fix revision (review `447ab1b1`):** re-fetched before editing. `LinearViewer` `origin/main` is now `0fdf05e0`; since `b5c528c4` it touches 5 files: four sibling `docs/reviews/*-2026-09-26.md` reports (code-quality, drift-coherence, onboarding-cold-start, recent-headwinds) and `docs/papers/harbour/jev-decision-model.md`. None of them is cited by this report. `simple-dispatcher` is unchanged at `3b1e734b`. The guard inventory, the SD env count and the new SD-H7 were derived at those heads.

**Scope.** Both repos in this workspace (`LinearViewer` = Harbour, `simple-dispatcher`), for an audience of developers **and** AI agents: root entry docs (`README.md`, `CLAUDE.md`) and the area docs both repos moved to in LIN-2887/2896/2897 (`LinearViewer/docs/architecture/*.md`; `simple-dispatcher/docs/*.md`); the agent-audience `public/llms.txt`; the runtime-served catalog `lib/proxy-instructions.js` (its **content** is this review's; its **bulk** is Code Quality's); public copy (`content/landing.md`, `lib/render-landing.js` lede, `docs/executive-summary.md`); config commentary (`.env.example`, `docs/architecture/configuration.md`, and `process.env` reads both repos); CI-doc twins; prompt-twin docs; and inline comments both repos.

**Method.** Drift-first: every doc claim was located against the concrete thing it asserts at HEAD. Counts and enumerations were verified by **executing** the source (`lib/prompt-template-defs.js` → 17; `lib/feature-defaults.js` `EXPERIMENTAL_VIEWS` → 9; `lib/providers/` → 5; `lib/periodicals.js` `PERIODICALS` → 15; `simple-dispatcher/terminal-driver.js` `TERMINAL_DRIVERS` → 4), never by grep alone. Every class query is stated inline with its finding; the query residues that are point-in-time artifacts are named and excluded explicitly.

**Ruling / process note.** Plan-review looped twice. Both verdicts — `a41d3cfe-3c7d-4b92-839e-380a55a6946e` (9 corrections) and `cdb29489-e07f-4c45-b412-032dad0e5893` (8 corrections) — are **binding**, and their finding lists are a **floor, not a ceiling**. The delegated Con ruling `9d5b7c86-c466-48db-ac57-4ab70fa5100b` ("option a — write the report now", verb override `c128261f-29d0-4641-8e10-98b88569e4f8`) waived plan approval for this ticket only; research is `003e0676-d72f-4424-94f4-4cd9910e32f6`, plan `7bbcd520-786c-409d-84d0-75f34f34b78b`, revision `90ea268f-4db0-45cf-a639-193fd3672d49`, hand-back `9fad9e30-5c97-4b30-8a43-e4ae598467c7`. This report re-ran every class query at HEAD and treats the verdict member lists as the floor it was asked to be. The PR still goes through normal review and CI. **Follow-ups minted this run:** LIN-3115 (N2), LIN-3116 (DC-dispatch-fields + route citations), LIN-3117 (N1), each `related` to this ticket; existing-ticket measurements were posted as comments on LIN-2390/2391/2392/1856/2656/2255/2177/687/1233 and a cross-link on LIN-1653.

---

# Findings, severity-ranked

> **Adversarial second-read correction (see the appendix below).** The Tier-1 reader found one genuinely missed class — the stale "the runner does not yet honor a halt (pending LIN-2995)" copy — which is added here as **H13** and promoted to the top of the ranking. The reader's item differed from this report's previous top finding (H3).

## H13 · **HIGH** — operator/agent docs still say the runner ignores a halt, but LIN-2995 is Done and `simple-dispatcher` honors halts — **existing LIN-3074** *(found by the adversarial second-read)*

**What.** Harbour's halt copy is uniformly framed as "a request only — the runner does not yet honor it (pending LIN-2995)". That framing is now **false**: `LIN-2995` is **Done** ("simple-dispatcher: honour a halt without depending on Harbour …"), `LIN-2994` is Done, and `simple-dispatcher` implements and documents halt enforcement. The stale wording survives across LinearViewer's doc surfaces at HEAD.

**Evidence.**
- `simple-dispatcher/README.md:231` — a `## Halts (pause / stop)` section: "*A halt stops new work being claimed, using the same `pause` / `stop` meaning whether it comes from Harbour (per workspace token), from the host-local file below, or automatically when polling stays unhealthy.*" `stop` sweeps cancellable sessions to `CANCELLED`; `pause` holds fresh launches. Implementation: `simple-dispatcher/halt.js` (`resolveEffectiveHalt`, precedence `stop > pause`, source `harbour > local > auto`), `simple-dispatcher/config.js:868` ("LIN-2995 S5 (LIN-3045): the host-local halt file", `SD_LOCAL_HALT_FILE`), `dispatcher.js:31`.
- Linear: `LIN-2995` **Done**, `LIN-2994` **Done**, `LIN-3045` **Done** (via `/api/proxy/search` and `/api/proxy/issues/LIN-2995`).

**Stale sites at HEAD (non-test): ~26 line occurrences across 5 docs + 5 code files.**

Docs:
- `docs/architecture/dispatch-and-proxy.md:17`, `:22`, `:60`, `:61`
- `docs/dispatch-integration.md:129`, `:130`
- `docs/executive-summary.md:87`
- `docs/proxy-integration.md:2402`, `:2441`
- `docs/runbooks/harbour-degraded.md:6`, `:24`, `:28`, `:32`, `:60`, `:204`, `:207` (including `[unbuilt: LIN-2995]`)

Code / inline comments / served catalog:
- `lib/proxy-instructions.js:624`, `:845` (the runtime-served catalog)
- `lib/render-dispatch.js:151` (user-facing copy)
- `public/dispatch.js:757`, `:788` (user-facing status copy)
- `routes/dispatch.js:1002`, `:1003`
- `routes/proxy-halt.js:8`, `:9`, `:104`

Test line-sites that hardcode the old string (recorded, not part of the doc fix): `tests/e2e/dispatch-halt.spec.js:11`, `:124`; `tests/unit/dispatch-route-halt.test.js:14`, `:15`; `tests/unit/proxy-halt.test.js:11`; `tests/unit/render-dispatch-exec-controls.test.js:43`, `:49`.

Point-in-time, not a member: `docs/incidents/2026-09-22-harbour-db-reads-hang.md:148` lists LIN-2995 as Backlog in a dated incident table (a historical record; note only).

**Class.** Accuracy / drift, cross-repo (operator + agent-facing docs). **Confidence:** verified at HEAD, independently of the reader. **Existing ticket:** **LIN-3074** (Backlog) owns exactly this fix and explicitly asks which files beyond `tests/unit/render-dispatch-exec-controls.test.js` still carry the stale wording — this finding is that enumeration. Comment, do not re-mint. **Sibling:** none.

---

## H3 · **HIGH** — residual Linear-only framing: the agent-facing twin of the fixed human-facing defect — **existing LIN-2391**

**What.** `README.md`'s provider-generalisation (LIN-2248) fixed the human entry point; the same defect class survives across `CLAUDE.md`, the area docs, Settings copy, and `docs/executive-summary.md`. All sites re-read at HEAD:

- `CLAUDE.md:60` — a `## Linear API` section still present.
- `CLAUDE.md:94` — indexes `docs/architecture/auth.md` as "*Linear OAuth 2.0 and the rest of authentication*".
- `docs/architecture/auth.md:1` — "*authentication — Linear OAuth 2.0 and related auth flows*" (moved verbatim from the old `CLAUDE.md` by LIN-2896).
- `lib/feature-defaults.js:93` — `[FEATURES.PROXY]: 'Linear API proxy'`; `:122` — `'Let AI agents interact with Linear via proxy tokens'` (user-facing Settings copy).
- `docs/architecture/source-map.md:17` — `proxy.js  Linear API proxy`; `:243` — `proxy-integration.md  Linear API proxy consumer integration guide`.
- `routes/proxy.js:2` — "*Linear API proxy routes.*"
- `docs/executive-summary.md:5` ("presents Linear project management data as a … tree"), `:8` ("query Linear through the token-scoped workspace API proxy"), `:18` ("Linear projects and issues are fetched via GraphQL"), `:43` ("rich context from Linear"), `:117` ("auth.js ── Linear OAuth 2.0"), `:147` ("Session-based (Linear OAuth) for all user routes"), `:220` ("transforms Linear project data").

**Evidence.** `git grep -n` over the named files at HEAD. `docs/executive-summary.md:147` is the strongest member: it is **false** (GitHub and Jira login exist), not merely framing, so it ranks above the framing-only lines. `docs/executive-summary.md:104` (`linearMcp` flag) is legitimately Linear-specific and is **not** a member.

**Class.** Accuracy / drift (stale provider framing). **Confidence:** verified at HEAD. **Existing ticket:** LIN-2391 (Backlog) — comment the current measurement; do not re-mint. **Sibling:** none (doc truth is this review's).

---

## H4 · **HIGH** — public landing copy names 3 of 5 backends and a stale template count — **existing LIN-2392**

**What.** `content/landing.md` is parsed at boot and served unauthenticated (`server.js` → `lib/parse-landing.js`); it is the one public copy surface no prior run in this series examined before 08-29.

- `content/landing.md:13` — "*Linear, GitHub Issues, or a local store*—behind a single provider abstraction." Five adapters exist in `lib/providers/`: `linear`, `github`, `github-projects`, `jira`, `local`. GitHub Projects v2 and Jira Cloud are omitted.
- `content/landing.md:18` — "*14 deterministic templates plus an LLM meta-prompt*". **17** at HEAD.

**Evidence.** Template count by execution: `node -e "import('./lib/prompt-template-defs.js').then(m => console.log(Object.keys(m.PROMPT_TEMPLATES).length))"` → **17**. Provider set by `ls lib/providers/`. The count guard `tests/unit/prompt-templates.test.js` deliberately excludes `content/landing.md:18` — not on principle, but because it is LIN-2392's (documented at `:208-214`).

**Class.** Accuracy / drift, public copy. **Confidence:** verified at HEAD. **Existing ticket:** LIN-2392 (Todo) — comment; do not re-mint. **Sibling:** Design & Interface owns how `content/*.md` renders; the count truth is this review's.

---

## H1 · **MED** — served catalog: quick-reference gap, two undocumented gate codes, two endpoint gaps, and reverse drift — **existing LIN-2390**

**What.** The runtime-served `/api/proxy/instructions` blob is now `lib/proxy-instructions.js` (moved out of `routes/proxy.js` since the last run).

- The consolidated `## Error Codes` quick-reference at `lib/proxy-instructions.js:957` lists only the trashed-issue `409`. `DUPLICATE_DISPATCH` (`:779`) and `BUDGET_EXHAUSTED` (`:816`) are documented at length in the dispatch prose but are **not cross-referenced** from the summary table — a skimmer gets an incomplete picture (this half was corrected from HIGH to MED by the 08-29 run's own adversarial second-read; the correction stands).
- Two 409 causes are genuinely **absent from the catalog everywhere**: `PERIODICAL_REPORT_NOT_PERSISTED` (`lib/periodical-report-gate.js:170`) and `PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED` (`lib/periodical-report-gate.js:184`) — the exact `PATCH …→done` gates this very task must pass.
- Two endpoints independently absent from the catalog: `GET /api/proxy/issues/{identifier}/snapshots` (+ `/snapshots/diff`) and `GET /api/proxy/issues/{identifier}/prompt/{templateKey}`.
- **Reverse drift (H1-adjacent, new members).** The catalog documents fields the long-form guide does not: `includeResolved` (4 catalog hits — `:467,:468,:502,:522` — 0 in `docs/proxy-integration.md`) and `stampLoopId` (4 catalog hits — `:461,:488,:494,:497` — 0 in the guide).

**Evidence.** `grep -c 'PERIODICAL_REPORT_NOT_PERSISTED\|PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED' lib/proxy-instructions.js` → 0; `grep -c includeResolved/stampLoopId docs/proxy-integration.md` → 0/0.

**Class.** API / interface documentation. **Confidence:** verified at HEAD. **Existing ticket:** LIN-2390 — comment; do not re-mint. **Sibling:** Code Quality owns `lib/proxy-instructions.js` as code bulk; the content is this review's.

---

## N2 · **MED** — template-count guard hole: "14" survives on the public landing lede and three lines of `executive-summary.md` — **new (mint candidate; cross-link LIN-1653)**

**What.** The `prompt-templates` guard asserts the count is 17 against `docs/executive-summary.md:161`, but never reads the other three count sites in that same file, nor `render-landing.js` at all. Stale "14" survives at HEAD at:

- `lib/render-landing.js:339` — the public landing lede: "*Two paths — 14 deterministic templates and an LLM meta-prompt…*"
- `docs/executive-summary.md:34` — "*14 deterministic templates defined in `lib/prompt-template-defs.js`*"
- `docs/executive-summary.md:55` — "*The meta-prompt includes all 14 template definitions…*"
- `docs/executive-summary.md:132` — the ASCII map: "*prompt-templates.js ── 14 handwritten templates*"

Adjacent stale inline comment (same count class, record not mint): `tests/e2e/prompts-page.spec.js:5` ("15-template catalog").

**Evidence / reproducible query.**
`git grep -nIiP '\b(1[0-9]|fourteen|fifteen|sixteen|seventeen)\b[^.\n]{0,40}\btemplates?\b'`, then subtract the guard's documented dated exclusions (`tests/unit/prompt-templates.test.js:196-215`). Residue with no disposition is named and excluded as **point-in-time**: `docs/recommender-failure-patterns.md:58` (design note, "14 action templates"), `docs/prompt-obligation-audit.md:9,46` (audit, "~15 worker templates"), `docs/lin-367-research-notes.md:63` (research).

**Root cause.** A guard that reads one count site per file rather than the whole class. The fix belongs with the guard (`tests/unit/prompt-templates.test.js`) — extend its read sites — not only the prose. **LIN-1653** (Backlog) is an open ticket for the same count-guard class on other surfaces (`BUCKET_OF_KIND`, `llms.txt`); mint N2 for the landing/exec-summary surfaces and cross-link LIN-1653.

**Class.** Accuracy / drift + guard coverage. **Confidence:** verified at HEAD. **Owner:** new. **Sibling:** none.

---

## DC-dispatch-fields + post-split route citations · **MED** — new (mint candidate; strongest third slot)

**What.** Two seams with one mechanical root cause (the LIN-679 proxy route split never propagated into prose or inline comments).

**(a) Undocumented proxy dispatch fields.** Bounded against the real proxy route `routes/proxy-dispatch.js:225` (body destructure):

- `queueIfBusy` — 0 hits in **both** `docs/proxy-integration.md` and `lib/proxy-instructions.js`.
- `waitForFollowUps` — 0 hits in `docs/proxy-integration.md` (5 catalog hits).
- `subscription` — 0 hits in `docs/proxy-integration.md` (3 catalog hits).

UI-route-only fields accepted by `routes/dispatch.js:277` and **never** by the proxy route: `presetId`, `attachProxy`, `composedRunMarker` — not a proxy-doc gap (note unranked, do not mint).

**(b) Post-split route-file citations.** `routes/proxy.js` is now **1,591 lines** and serves only `GET /api/proxy/instructions` directly (plus `resolveProviderAccess`, still defined at `:657`). Query: `git grep -nI 'routes/proxy\.js' -- ':!docs/reviews' ':!docs/archive'`; keep lines naming a `/api/proxy/*` path other than `/instructions`, or a `:N` greater than 1,591.

Docs (4):

| doc | cites | actually served by |
| -- | -- | -- |
| `docs/dispatch-protocol.md:246` | `routes/proxy.js` for `GET /api/proxy/dispatch/:id?wait=N` | `routes/proxy-dispatch.js:1613` |
| `docs/architecture/source-map.md:107` | `routes/proxy.js` for `GET /api/proxy/passage-runner/prompt` | `routes/proxy-kickoff.js:543` |
| `docs/passage-runner-prompt.md:11` | `routes/proxy.js` for the same endpoint | `routes/proxy-kickoff.js:543` |
| `docs/architecture/source-map.md:158` | `routes/proxy.js` for `GET /api/proxy/periodicals` | `routes/proxy-compute.js:914` |

Non-test inline comments (10): handler-named — `lib/dispatch-store.js:523` (`GET /api/proxy/dispatch/:id`), `lib/dispatch-validation.js:139` (`POST /api/proxy/dispatch`), `lib/issue-write-validation.js:6` (`POST /api/proxy/issues`), `lib/periodical-report-gate.js:61` (`PATCH /api/proxy/issues/:id`), `lib/providers/linear/index.js:1636` (`PATCH /api/proxy/issues/:id`), `routes/workspace-api.js:1488` (`POST /api/proxy/issues/:issueId/comments`); line-cites past the end of the file — `lib/plan-review-round-trips.js:54` (`:6007`), `lib/workspace.js:854` (`:2477`), `routes/workspace-api.js:3388` (`:2477`); cross-repo — `simple-dispatcher/hook.js:1058` (the dispatch prompt is served at `routes/proxy-dispatch.js:1715`).

Test members (8, recorded not ranked): `tests/unit/dispatch-route-periodical-id.test.js:9`, `tests/unit/lin-2239-canonical-priority-scale.test.js:17`, `tests/unit/lin-2353-recommend-llm-provider-ui.test.js:3`, `tests/unit/quota-isolation.test.js:15`; past-end — `tests/unit/dispatch-wake.test.js:758` (`:5818`), `tests/unit/image-proxy.test.js:127` (`:2477`), `tests/unit/proxy-credential-fingerprint-stamping.test.js:21` (`:2072`), `tests/unit/proxy-openrouter-principal-hop.test.js:317` (`:4296`).

**Checked and correctly cited (not members):** `docs/runbooks/harbour-degraded.md:55` (`routes/proxy.js:527` sits inside `authenticateProxyToken`); `routes/proxy-reads.js:28` ("(routes/proxy.js:1745/:1747 before the move)" — an explicitly historical note, not a current-route claim; dropped per review `447ab1b1`); `docs/architecture/source-map.md:50` (`resolveProviderAccess (routes/proxy.js)`, genuinely defined at `:657`); `docs/architecture/prompt-system.md:32` (historical LIN-308/309 narrative). Dated research / design docs excluded as point-in-time, same class as the prompt-count guard's dated audit reports: `docs/autopilot-experiment.md`, `docs/autopilot-operating-manual-research.md`, `docs/lin-367-research-notes.md`, `docs/lin-418-llm-tracking-research.md`, `docs/pipeline-hierarchy.md`, `docs/pipeline-design-history.md`, `docs/passage-planner-session-2026-08-03.md`, `docs/recommender-structural-drift.md`, `simple-dispatcher/docs/fleet-design.md`, `simple-dispatcher/docs/control-plane-split-research.md`.

**Class.** API / interface documentation + inline comments. **Confidence:** verified at HEAD. **Owner:** new. Bound: **4 doc citations + 10 non-test inline comments (+8 test)**.

---

## F2 · **MED** — `docs/view-tiers.md` still lists 7 of 9 experimental views — **existing LIN-1856**

**What.** `lib/feature-defaults.js:166` `EXPERIMENTAL_VIEWS` holds 9 entries (`collective`, `taskChat`, `ship`, `nextRun`, `flightCompanion`, `passagePlanner`, `shipBiscuit`, `liveConsole`, `shipJourney`); `docs/view-tiers.md` §2 lists 7, missing `passagePlanner` and `liveConsole`. `docs/architecture/views.md:5` names all 9 correctly, making the hand-kept list in `view-tiers.md` the representation that rots.

**Evidence.** `node -e "import('./lib/feature-defaults.js').then(m => console.log(m.EXPERIMENTAL_VIEWS.length))"` → 9; read `docs/view-tiers.md` §2.

**Class.** Accuracy / drift (enumeration). **Confidence:** verified at HEAD. **Existing ticket:** LIN-1856 (Todo) — comment; cross-link. **Sibling:** none.

---

## H6 · **MED** — `docs/architecture/source-map.md` inflation: over-written *and* incomplete, now with per-feature single-entry churn — **human-decision (not minted)**

**What.** The exhaustive hand-maintained file map relocated from `CLAUDE.md` into `docs/architecture/source-map.md` by LIN-2896; the `CLAUDE.md` ≤12,000-byte guard does **not** bound it.

**Measurements at HEAD.** File = **103,596 bytes**, **248 lines**, **23 lines >1,000 chars**, longest line **9,007 chars** at `:50` (the `lib/providers/jira/index.js` entry). The ship-journey entry `:211` is **4,843 chars**.

**New evidence (why this is a structural, not backfill, call).** Of the 8 non-merge commits since the file was created (`3a822cb2`, LIN-2896 beat 1/5), 2 are paper-archive (`56020b07`, `b4610b08`), 1 is a rename (`65597b3e`), and **5 are per-ticket rewrites of the single ship-journey line** (`:211`): `f14c2fb6`/LIN-2959, `b4d55e4a`/LIN-2068, `03608ef9`/LIN-2956, `d043a0c9`/LIN-2067, `a76545c1`/LIN-2089. The inflation is not broad churn — it is repeated single-entry growth, which strengthens the case for **generate the map, or pin entries mechanically** (as `claude-md-scheduler-jobs-census` and `prompt-templates` already do) over a third manual backfill. **Which remedy is a human worth/direction call; not minted**, per the ticket's guardrail.

**Class.** Quality / inflation. **Confidence:** measured at HEAD. **Sibling:** Drift & Coherence owns the hand-maintained-mirror *cause*; the drift measurement is this review's.

---

## effort-accepted, absent from the served catalog · **MED** — **existing LIN-2656**

**What.** `effort` is accepted by **both** dispatch routes — `routes/proxy-dispatch.js:225` (the proxy route) and `routes/dispatch.js:277` (the session-auth UI route) — but `lib/proxy-instructions.js` documents it only incidentally inside a JSON example (`:344`), never as an accepted request field. `docs/proxy-integration.md` has no field-level documentation of it either.

**Evidence.** `git grep -n effort` in both files; body destructures read directly.

**Class.** API / interface documentation. **Confidence:** verified at HEAD. **Existing ticket:** LIN-2656 — comment (citing **both** routes, per verdict #2 correction 8b). **Sibling:** none.

---

## CFG · **MED-LOW** — code-vs-doc env drift, both repos — **record only (loses the third mint slot to DC-dispatch-fields)**

**What (LV, doc-vs-doc — the "7" restored).** Under the filter "*`docs/architecture/configuration.md`'s env block `:6-33` names the var and `.env.example` mentions it nowhere, commented `# KEY=` lines included*", exactly **7** vars are named in the doc and absent from `.env.example` (all verified present in `configuration.md`, 0 hits in `.env.example`):
`DISPATCH_OWNERLESS_BROKER_COMPAT`, `FREE_TIER_DAILY_LIMIT`, `FREE_TIER_HOURLY_LIMIT`, `OPENROUTER_FREE_TIER_MODEL`, `WEEKLY_BUDGET_CHECKPOINT_AT`, `WEEKLY_BUDGET_CHECKPOINT_PERCENT`, `WEEKLY_BUDGET_USD_PER_POINT`.
(The plan's earlier "22" came from counting only uncommented `KEY=` lines; the `WEEKLY_BUDGET_*` set is *in* the 7.)

**What (LV, code-vs-doc — runtime reads absent from both `.env.example` and `configuration.md`):**
`FEEDBACK_PROJECT_ID` (`routes/workspace-api.js:3790`), `FEEDBACK_TEAM_ID` (`routes/workspace-api.js:3532`), `HARBOUR_DISABLE_AI_MOCK` (`routes/dashboard.js:2232,2418`), `OBSERVATION_FEED_TIMING` (`lib/pipeline-loops.js:1711`), `OPENROUTER_API_URL` (`lib/openrouter.js:20`), `CONSUMER_POLL_WARNING_THRESHOLD_MS` (read `lib/consumer-poll-warning.js:29`; **named in `docs/proxy-integration.md:2120`**, absent `.env.example`+`configuration.md`), `HARBOUR_DATA_DIR` (`server.js:223-228`; only an incidental mention in `docs/fossil-bookkeeping-pass.md:93`).

**What (SD).** *(Counts completed per review `447ab1b1` item 5 / verdict `cdb29489` #3c.)*

**Query.** Run in `simple-dispatcher/` at `3b1e734b`:

```
grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" --include="*.js" --exclude-dir=node_modules .
```

A var counts as documented if `grep -w VAR README.md CLAUDE.md docs/*.md` finds it (top-level `docs/*.md`, 16 files).

| set | unique vars | undocumented |
| -- | -- | -- |
| all source | **92** | **43** (raw) |
| all source, after the exclusions below | — | **39** |
| non-test: also `--exclude-dir` `test`, `experiments`, `scratchpad` | **85** | **40** — the same 39 plus `UV_THREADPOOL_SIZE` |

Both routes reach the same **39 genuinely undocumented runtime vars**. The gap between the two sets is only folders: `92 − 85` = `CI`, `HARBOUR_DIR`, `HOME`, `PATH`, `SD_`, `SD_TEST_GIT_PROBE_MODE`, `TMPDIR`, all under `test/`. It is not Node built-ins.

**Exclusions.**
- **Comment matches, not reads.** `SD_` is not a template-literal prefix, as this report first said. Its only match is the comment ellipsis `delete process.env.SD_..._RELAY` at `simple-dispatcher/test/opencode-telemetry-relay.test.js:18`. `TMPDIR` is also comment-only (`simple-dispatcher/test/opencode-runner-process.test.js:72`).
- **Platform var.** `UV_THREADPOOL_SIZE` is a real platform read/default at `simple-dispatcher/clones.js:26`.
- **Test-only.** `SD_TEST_GIT_PROBE_MODE` is read only by a test fixture (`simple-dispatcher/test/fixtures/inject-broken-git-probe.js:23`).

**Why `CI` is not in the platform list.** `CI` is **never read**. The rule: a regex match that sits in comment text is not a var. Its only two matches are comments restating the repo's rule that suites gate on the platform, never on `process.env.CI`: `simple-dispatcher/test/claude-md-line-budget.test.js:9` and `simple-dispatcher/test/claude-md-anchor-resolver.test.js:10`. `simple-dispatcher/docs/testing-and-ci.md:27` documents that rule ("the gate is the PLATFORM, never `process.env.CI`"), so whole-word matching counts it as documented and it was never in the 43. The plan-review list of platform vars included it because the research query used a ≥4-character token regex, which cannot match `CI`.

**Query blind spots** (stated, not counted): indexed or helper reads.
- `simple-dispatcher/load-env.js:28` (`process.env[key]`, the `.env` loader)
- `simple-dispatcher/hook.js:795` (`env[k]` over the 5 API-redirect vars)
- `simple-dispatcher/hook.js:23` (`detectClaudeCodeLane(process.env)`)

**What the 39 are.** 36 tuning knobs (`LAUNCH_*`, `OPENCODE_*`, `FOLLOWUP_HOLD_*`, `TERMINAL_PREWARM_*`, `WINDOW_CLOSE_RETRY_*`, …) and 3 feature flags, all confirmed undocumented:
- `SD_OPLOG` (`simple-dispatcher/oplog.js:32`)
- `SD_LAUNCH_BREAKER_ENABLED` (`simple-dispatcher/config.js:736`)
- `SD_TICKET_MARKER_RELAY` (`simple-dispatcher/config.js:1202`)

**Class.** Config commentary. **Confidence:** verified at HEAD. **Disposition:** recorded here; not minted.

---

## H5 / H7 / H8 · **MED-LOW** — carried structural finds, re-verified — **not minted**

- **H5 (archive)** — largely **resolved-in-split**: `docs/architecture/source-map.md:231` now documents `docs/archive/1.html`–`7.html` accurately, including `#4`. `lib/render-landing.js:398` still hard-codes `/archive/2`, but with no false "latest edition" comment any more. Residual: `tests/e2e/archive.spec.js` exercises `/archive/1,2,3,5,6,7` but **skips `/4`** — a test-coverage gap, not doc drift.
- **H7 (modules in no doc)** — 5 of the 6 modules named in 08-29 are still zero-hit in non-review docs: `lib/periodical-report-gate.js`, `lib/proxy-credential-trail.js`, `lib/account-conflict.js`, `routes/workspace-api-prompts.js`, `routes/workspace-api-roadmap.js`. `routes/account-merge.js` now appears once (source-map) — partially resolved. **SD twin:** `simple-dispatcher/docs/module-map.md` omits 12 root modules, 8 of them in no SD doc — see **SD-H7**.
- **H8 (discoverability)** — `CLAUDE.md`'s "Where the detail lives" indexes 8 `docs/architecture/*` docs, not the **56** top-level `docs/*.md`; `charter/`, `roadmaps/`, `incidents/`, `observation-mockups/` are unreferenced; there is no `docs/README.md` index; and the seven overlapping `docs/autopilot*.md` documents carry no in-force/supersession marker (`autopilot-operating-manual-v2.md` shares the live manual's title). `docs/charter/*.md`'s `> **Status: DRAFT, not adopted.**` header is the in-repo precedent for the fix.

**Class.** Discoverability / entry-point quality. **Confidence:** verified at HEAD. **Sibling:** Onboarding & Cold-Start (entry-path walking is theirs).

---

## SD-H7 · **MED-LOW** — `simple-dispatcher`'s area docs: `module-map.md` omits 12 root modules (8 appear in no SD doc), and 4 verbatim-moved docs carry stale enumerations — **record only** *(added per review `447ab1b1` item 6)*

**What.** LIN-2897 moved the bulk of `simple-dispatcher/CLAUDE.md` into five area docs, each headed "moved verbatim from `CLAUDE.md`". This is the first run to assess them: `simple-dispatcher/docs/{substrate,session-lifecycle,module-map,testing-and-ci,deployment}.md`.
- `simple-dispatcher/CLAUDE.md`'s five "Where the detail lives" index lines resolve, and each matches its doc's scope (pinned by `test/claude-md-anchor-resolver.test.js`).
- The doc **content** is unguarded.
- Of 21 claims checked against source at `3b1e734b`: **16 hold** and **5 have drifted**. It is the SD twin of H7 (modules in no doc), plus the same relocation seam as N1 (verbatim moves carrying stale context).

**Drift at HEAD.**
1. **`simple-dispatcher/docs/module-map.md` omits 12 of the 35 non-e2e root modules.** There are 40 tracked root `*.js` files; the 5 `e2e-*` files are excluded. The 12:
   - `clones.js`, `halt.js`, `http.js`, `launch-breaker.js`, `load-env.js`, `opencode-liveness.js`
   - `oplog.js`, `pacing.js`, `refusal.js`, `resource-metrics.js`, `resources.js`, `subscription.js`

   **8 are named in no SD doc at all** (`README.md`, `CLAUDE.md`, `docs/**`): `halt.js`, `http.js`, `launch-breaker.js`, `load-env.js`, `opencode-liveness.js`, `pacing.js`, `refusal.js`, `subscription.js`. The other 4 are named only outside the map:
   - `clones.js` and `resources.js`: `docs/linux-substrate-findings.md`
   - `oplog.js` and `resource-metrics.js`: `README.md`

   **Aggravating factors:**
   - `simple-dispatcher/CLAUDE.md` says "New logic should land in the pure modules (see `docs/module-map.md`)". The pure `halt.js`, `pacing.js`, `refusal.js` and `subscription.js` are among those missing.
   - `halt.js` is the halt enforcement behind H13.
   - The flag for `launch-breaker.js`, `SD_LAUNCH_BREAKER_ENABLED`, is also undocumented (CFG).
2. **`simple-dispatcher/docs/session-lifecycle.md:26`, "The full vocabulary is 8 phases".**
   - `simple-dispatcher/phases.js` `PHASES` has **9** (executed: `Object.keys(PHASES).length` → 9).
   - `AWAITING_EXTERNAL` (`phases.js:61`, LIN-1260, 2026-07-11, before the split) is missing from the list.
   - It is also missing from ":28 `BLOCKED`/`AWAITING_FOLLOWUP` are deliberately neither", though it is neither ACTIVE nor TERMINAL too.
   - The same doc names `AWAITING_EXTERNAL` at `:73`/`:79`, so it contradicts itself.
3. **`simple-dispatcher/docs/substrate.md:14`, process-model row** ("a detached terminal `claude` child (iTerm by default; Terminal.app via `SD_TERMINAL=terminal`)").
   - It names 2 of the 4 registered drivers. `terminal-driver.js` `TERMINAL_DRIVERS` also has `kitty` and `tmux`; `README.md:24-29` is correct.
   - It ignores the `opencode` harness (`simple-dispatcher/harnesses.js:423`).
4. **`simple-dispatcher/docs/testing-and-ci.md:26-27`** names 2 macOS-only suites: `test/build-launch-applescript.test.js` and `test/workspace-prep-exec.test.js`. HEAD has 4; the other two are `test/git-launch-probe.test.js:120` and `test/watch-restart-path-git.test.js:273`.
5. **`simple-dispatcher/docs/deployment.md:28` and `:38`** refer to "`gitLaunchProbe` above" and "the dispatcher's own boot-probe refusal above (`SD_SKIP_GIT_PROBE=1` + restart)". Nothing above them in `deployment.md` covers this. The text now lives in `simple-dispatcher/docs/module-map.md:16-29` and `README.md:139-141`: a dangling reference left by the verbatim move.

**Checked and holding (16).**
- **`substrate.md` (3):**
  - `cli`/`web` both use the `hook` substrate, and `web` = `cli` + `remoteControl` (`targets.js:17-18`).
  - `updateState` locks, re-reads inside the lock, and writes temp + rename (`state-store.js:12-13,73`).
  - The route-around names exist: `followup.shouldQueueIfBusy` (`followup.js:107`), `pacing.freshLaunchDeferReason` (`pacing.js:104`) and `launchHoldReason` (`dispatcher.js:1595`).
- **`session-lifecycle.md` (3):**
  - Broker-armed `implementation`/`research`/`plan` skip `SUMMARIZING` (`dispatcher.js:41` `NO_BOOTSTRAP_KINDS`).
  - `ACTIVE_PHASES`/`TERMINAL_PHASES` (`phases.js:74,77`).
  - The claim → assess → route → execute seam (`executorFor` at `executors.js:736`, `createSession` at `dispatcher.js:188`).
- **`module-map.md` (3):**
  - `gitLaunchProbe()` runs at boot (`dispatcher.js:2044`).
  - `terminal-driver.js`'s four verbs `launch`/`capture`/`countWindows`/`closeWindow`. *Incidental: the source header at `terminal-driver.js:1` says "exactly FIVE operations" and then lists four; that is an inline-comment count error, not doc drift.*
  - `tmuxDriver` is the headless-Linux driver. Every file the doc names exists.
- **`testing-and-ci.md` (4):**
  - Script names match `package.json`, and `engines.node` is `>=22`.
  - `.github/workflows/ci.yml` runs on `pull_request` + push to `main` with `npm ci` + `npm test`, `permissions: contents: read`, `timeout-minutes: 10`.
  - The keep-alive is cleared via `t.after` in `test/http.test.js:43-44`.
  - `HARBOUR_DIR` defaults to `/home/user/LinearViewer`.
- **`deployment.md` (3):**
  - `watch-restart.sh` starts the dispatcher only at startup (`:314`) and in `update_and_restart` (`:264,:283`).
  - `WATCH_INTERVAL` defaults to 60 and `WATCH_FETCH_FAIL_ESCALATE_AFTER` to 5 (`:70,:74`).
  - `resolve_path_prepend` exists (`:105`), and the log strings `WATCHER GIT/PATH FAULT` (`:127`) and `PERSISTENT FAILURE` (`:158`) match.

**Class.** Accuracy/drift + discoverability, `simple-dispatcher`, the H7 class. **Severity: MED-LOW.** No false operator instruction and no agent-facing contract is involved. The module-map gap is an absence, and the other four are stale counts, enumerations and references.

**Disposition:** record only. The ~3-new cap is spent, and a tracker search ("module-map", "simple-dispatcher docs module map", "AWAITING_EXTERNAL docs", "session-lifecycle phases") found no owning ticket. LIN-2177 (Backlog) is the open SD-docs ticket but has a different scope. **Sibling:** Onboarding & Cold-Start (entry-path walking).

---

## CI-doc twin · **LOW-MED** — `docs/architecture/ci.md:46` omits the `secret-scan` job from its own `ci-success` description — **record only**

**What.** `docs/architecture/ci.md:46` describes `ci-success` as aggregating "the unit and e2e jobs". The workflow `.github/workflows/test.yml:139` shows `ci-success` `needs: [unit, e2e, secret-scan]`. The doc's own description of its central aggregator is incomplete (mirrored by `CLAUDE.md`'s Invariants line "*aggregates the unit and e2e jobs*").

**Class.** CI docs. **Confidence:** verified at HEAD. **Sibling:** none.

---

## N1 · **LOW** — broken relative links carried by the LIN-2896 area-doc relocation — **new (mint candidate)**

**What.** A relative-link resolver over all non-denylisted `*.md` (LinearViewer 105, simple-dispatcher 21; denylist `docs/reviews`, `docs/archive`, `plans`, `scripts/eval`) finds exactly **4** broken root-relative links, all in `docs/architecture/`, all resolving to a non-existent `docs/architecture/docs/...`:

- `docs/architecture/views.md:5` → `docs/view-tiers.md`
- `docs/architecture/dispatch-and-proxy.md:36` → `docs/dispatch-integration.md`
- `docs/architecture/dispatch-and-proxy.md:65` → `docs/proxy-integration.md`
- `docs/architecture/prompt-system.md:34` → `docs/prompt-change-validation.md`

Root cause: text moved verbatim from root `CLAUDE.md` into `docs/architecture/`, carrying root-relative link targets. Simple-dispatcher is clean (0 broken).

**Incidental, not this class (recorded, not minted):** `docs/proxy-integration.md:573,599,623` (bare "…" inside code fences) and `:2058` (`assetUrl` in a code sample) are resolver false positives; `docs/lin-367-research-notes.md:7` links a URL-encoded filename; `docs/pipeline-design-history.md:72` carries a pre-existing malformed `<http://CLAUDE.md>` link.

**Evidence.** Python resolver over every non-denylisted `.md`, checking `os.path.exists` on each relative link target. The existing guard `tests/unit/docs-architecture-anchor-resolver.test.js` covers citations **into** `docs/architecture/*.md`, **not** links **inside** them — hence the miss.

**Class.** Relocation seam / link drift. **Confidence:** verified at HEAD. **Owner:** new. **Sibling:** none.

---

## H9 · **LOW** — run-the-repo commands absent from the entry docs — **not minted**

**What.** `LinearViewer`: `npm run setup` (installs deps + Playwright + runs `env:check`) appears in neither `README.md` nor `CLAUDE.md`'s `## Commands` list, which instead documents the four manual steps it automates. `simple-dispatcher`: 13 of 18 `package.json` scripts appear in neither `README.md` nor `CLAUDE.md`, including the whole `test:e2e:*` family and `clones`/`clones:reap` (the only user-driven way to reclaim clone disk).

**Class.** Entry-point quality. **Confidence:** carried from 08-29, re-spot-checked at HEAD. **Sibling:** Onboarding & Cold-Start.

---

## H10 · **LOW** — `docs/direction-layer-proposal.md:21`: fifth consecutive run — **not minted**

**What.** "*There are **four** transport layers … (dispatch queue, proxy API, **Linear CLI**, llms.txt + data attributes)*" — `lib/linear-cli.js` was deleted (confirmed absent at HEAD); there are three. The same paragraph names the phantom "pipeline" view and frames Harbour's context as specifically "Linear". Cited as prior art by LIN-1647/LIN-1648, still open.

**Class.** Accuracy / drift. **Confidence:** verified at HEAD (file untouched since 08-29).

---

## H11 · **LOW** — `public/llms.txt:127` sends agents to a session-dependent legacy alias — **not minted**

**What.** "*`.footer-ai-model` / `[data-ai-model]` — … filled client-side from `/api/recommend/status`*". The client actually calls the workspace-scoped `/workspace/${urlKey}/api/recommend/status`; the unscoped path is a legacy redirect that 401s with no active workspace. `llms.txt` uses the scoped form two lines later, so it contradicts itself.

**Class.** Agent-audience doc accuracy. **Confidence:** verified at HEAD.

---

## H12 · **LOW** — `server.js:1884` comment: wrong count, misleading qualifier — **not minted**

**What.** "*publishes the **16 non-meta** prompt templates*". There are **17** (confirmed alongside H4, by execution), and `PROMPT_TEMPLATES` contains no meta template at all — "non-meta" implies a filter that does not exist. The rendered page derives its own count from source, so only the comment is wrong. (Was `:1718` in 08-29; the line moved.)

**Class.** Inline-comment accuracy. **Confidence:** verified at HEAD. **Sibling:** Comprehension-Debt (per-comment altitude).

---

# Existing-ticket / record-only findings (comment, do not re-mint)

- **LIN-2255** (`public/llms.txt:673-674`) — "*Read-only view (no editing tasks)*" / "*Logout requires re-authentication via Linear OAuth*". Both **still true at HEAD**; the ticket remains Backlog. Comment the current measurement.
- **LIN-2177** (simple-dispatcher docs, 3 items) — re-verified at HEAD: (1) `admission.js:42-43` still carries the stale "typically a case-mismatched basename" comment; (2) `README.md:184`'s `workspaces.json` section still lacks basename / uniqueness / `exit(1)` language; (3) the case-mismatch behaviour-loss point is still unnamed. All hold.
- **LIN-2465** (SD terminal precedence) — `README.md:31` now references the LIN-2465 precedence chain and describes the `SD_TERMINAL` global default plus per-workspace/per-dispatch override; ticket owns any remaining gap.
- **LIN-2482** (SD `SD_TERMINAL` default / driver-list drift guard) — `README.md:24`'s "Four drivers are registered … selected via `SD_TERMINAL`" matches `simple-dispatcher/terminal-driver.js`'s `TERMINAL_DRIVERS` (iterm/terminal/kitty/tmux), default `iterm`; correctness holds, the ticket owns the guard.
- **LIN-687** — the periodicals-stale-rationale-count defect is confirmed fixed in code (`lib/periodicals.js` header matches a 15-entry `PERIODICALS` registry); **recommend close**.
- **LIN-1233** — the older doc-review ticket superseded by this series; **recommend close**.

---

# Clean results — checked, and genuinely fine

1. **Zero `TODO`/`FIXME`/`HACK` markers** in production or documentation source across both repos (excluding `node_modules`, `docs/reviews`, `docs/archive`).
2. **`simple-dispatcher` has zero broken relative links** across its 21 non-denylisted `*.md`.
3. **Counts verified by execution, not prose** — all current: `PROMPT_TEMPLATES` → **17**; `EXPERIMENTAL_VIEWS` → **9**; `lib/providers/` → **5** (`linear`, `github`, `github-projects`, `jira`, `local`); `lib/periodicals.js` `PERIODICALS` → **15**; `simple-dispatcher/terminal-driver.js` `TERMINAL_DRIVERS` → **4**. No drift from the seed on any of these.
4. **`docs/dispatch-protocol.md` has zero provider mentions, and that is correct** — it governs dispatcher↔session-node messaging, a layer with no task-source dimension.
5. **`CLAUDE_CODE_BUBBLEWRAP` in `simple-dispatcher/README.md` remains accurate**, not stale — it correctly names what a sibling var deliberately does not mirror (a mechanical env-var diff would falsely flag it).
6. **`docs/proxy-integration.md:9`'s "currently backed by Linear"** is accurate and appropriately hedged, immediately followed by the source-neutral instruction — distinct from H3's unhedged assertions; not a finding.
7. **The `.env.example` / area-doc config commentary** and **simple-dispatcher's harness/target contract** (`README.md:13-29`) remain high-quality, accurate surfaces (their remaining gaps are enumerated under CFG, not as commentary-quality defects).
8. **`docs/architecture/views.md:5` carries a correct 9-member experimental-view summary**, so the F2 defect is confined to the redundant hand-kept list in `view-tiers.md`.

---

# Seed corrections

Per the ticket's instruction ("re-verify every seed against source at HEAD; correct rather than repeat"), and the binding plan-review corrections:

1. **H2 (Jira read-only / no-OAuth) is resolved-in-split, not carried.** The false CLAUDE.md prose was dropped by the LIN-2887/2896/2897 split, not moved; the correct detail now lives at `docs/architecture/source-map.md:13,50`, `lib/providers/jira/index.js:16`, and `README.md:60,84-94`. Not re-flagged.
2. **LIN-2629 (missing rulings endpoints in `docs/proxy-integration.md`) is resolved-in-doc** at `docs/proxy-integration.md:1261-1263`. Not re-flagged.
3. **H12 holds** — 17 templates, none meta; `server.js:1884`'s "16 non-meta" comment is wrong (relocated from `:1718`).
4. **The CFG "7" is reproducible** under the stated filter (`configuration.md` env block `:6-33` names the var, `.env.example` mentions it nowhere including comments) — the plan's "22" used an unstated narrower filter. The 7 are named above; the `WEEKLY_BUDGET_*` set is in, not out.
5. **SD env count is stated, not inherited.** 92 unique `process.env` matches all-source, 43 undocumented under whole-word matching. That is **39** after excluding `SD_` and `TMPDIR` (comment-only matches, not a template-literal prefix), `UV_THREADPOOL_SIZE` (platform) and `SD_TEST_GIT_PROBE_MODE` (test fixture). The 85-var non-test set has **40** undocumented, which is the same 39 plus `UV_THREADPOOL_SIZE`. `CI` is never read (comment-only, and its rule is documented at `simple-dispatcher/docs/testing-and-ci.md:27`). See CFG.
6. **The catalog is not "kept in sync" with the long-form guide** — it is co-edited only sometimes: 8 of the catalog's last 15 non-merge commits did not touch `docs/proxy-integration.md`; genuine co-edits cite **LIN-2818, LIN-3025, LIN-2934, LIN-2974 (×2), LIN-2975, LIN-2886**. Reverse drift (`includeResolved`, `stampLoopId`) follows from this, folded into H1.
7. **`source-map.md`'s churn is per-feature single-entry inflation**, not paper-archive churn — a correction that strengthens H6 rather than weakening it.
8. **H3's file-local line list moved** with the area-doc split; this report carries HEAD line numbers, not the old `CLAUDE.md` ones.
9. **`tests/unit/docs-architecture-anchor-resolver.test.js` covers incoming citations into `docs/architecture/*.md` only** — not links *inside* area docs and not out to `docs/*.md` targets (`docs/view-tiers.md`, `docs/prompt-change-validation.md`). This is why N1's four links have no guard.

---

# Minted / not-minted

| finding | severity | disposition |
| -- | -- | -- |
| **H13** halt "pending LIN-2995" copy (~26 non-test sites, LinearViewer only) | HIGH | **existing: LIN-3074 — comment** (found by the adversarial second-read; not re-minted) |
| **N1** — 4 broken relative links in `docs/architecture/` | LOW | **minted: LIN-3117** (related to LIN-3102) |
| **N2** — template-count guard hole (`lib/render-landing.js:339`, `docs/executive-summary.md:34,55,132`) | MED | **minted: LIN-3115**; cross-link **LIN-1653** (same guard class, other surfaces) and **LIN-2392** |
| **DC-dispatch-fields + post-split route citations** | MED | **minted: LIN-3116** (widened: 3 fields + 4 doc citations + 10 inline comments + 8 test); cross-link **LIN-2601**, **LIN-914** |
| **H1** served-catalog gaps + reverse drift | MED | **existing: LIN-2390 — commented 2026-09-26** |
| **H3** residual Linear-only framing | HIGH | **existing: LIN-2391 — commented 2026-09-26** |
| **H4** public landing copy | HIGH | **existing: LIN-2392 — commented 2026-09-26** |
| **F2** `view-tiers.md` 7 of 9 | MED | **existing: LIN-1856 — commented 2026-09-26** |
| **effort** absent from catalog | MED | **existing: LIN-2656 — commented 2026-09-26** (cite both routes) |
| **LIN-2255** llms.txt read-only/logout copy | LOW | **existing: LIN-2255 — commented 2026-09-26** |
| **LIN-2177** SD docs items (3) | LOW | **existing — commented 2026-09-26** |
| **LIN-2465 / LIN-2482** SD terminal doc/guard | LOW | **existing — carried** (no comment needed; report carries the measurement) |
| **LIN-687 / LIN-1233** | LOW | **existing — close recommended** (commented 2026-09-26; no re-flag) |
| **H6** `source-map.md` inflation | MED | **human-decision** (generate vs pin; measurements above) |
| **CFG** code-vs-doc env drift, both repos | MED-LOW | **record only** (not minted) |
| **H5 / H7 / H8** archive, modules-in-no-doc, discoverability | MED-LOW | **record only** (not minted) |
| **SD-H7** `simple-dispatcher` area docs: `module-map.md` omits 12 root modules (8 in no SD doc); `session-lifecycle.md:26` 8→9 phases; `substrate.md:14` drivers/harness; `testing-and-ci.md` 2 of 4 macOS-only suites; `deployment.md` dangling "above" ×2 | MED-LOW | **record only** (not minted: cap spent, no owning ticket) |
| **CI-doc twin** `docs/architecture/ci.md:46` omits `secret-scan` | LOW-MED | **record only** (not minted) |
| **H9 / H10 / H11 / H12** | LOW | **record only** (not minted) |

The ~3-new cap is spent on **N2 → LIN-3115**, **DC-dispatch-fields → LIN-3116**, **N1 → LIN-3117**, each left in its default state and `related`-linked back to LIN-3102. H13 (found after minting, by the adversarial second-read) already has an owner, **LIN-3074**, so it is commented, not minted. Duplicate search before minting (`/api/proxy/search`, 2–3 phrasings each) found *overlapping* but not *owning* tickets and was resolved by cross-linking, not re-minting: LIN-1653/LIN-2302 (N2's count class), LIN-2601 (split hygiene, different surface), LIN-914 (`waitForFollowUps` removal — flagged inside LIN-3116). The highest-severity items (H1/H3/H4/F2/effort) already have tickets and were cross-linked/commented, not duplicated.

---

# Sibling seams — cross-linked, not duplicated

| owner | seam | disposition |
| -- | -- | -- |
| **Code Quality** | `lib/proxy-instructions.js` as code **bulk** | H1 is its **content** — this review's; bulk is theirs. |
| **API Quality** | contract **behaviour** of `/api/proxy/*` | This review owns whether the **doc** of it is true; behaviour is theirs. |
| **Drift & Coherence** | hand-maintained-mirror **convention** as a cause | H6's cause touches their remit; the measurement is this review's; no convention change proposed. |
| **Comprehension-Debt** | module-altitude rationale | H12 and LIN-2177 item 1 are per-comment accuracy — theirs at altitude. |
| **Onboarding & Cold-Start** | entry-path walking | H8/H9 are doc absence, not a walk failure. |
| **Design & Interface** | how `content/*.md` renders | H4's **counts** are this review's; rendering is theirs. |
| **Prompt-twin owners (LIN-1443 / LIN-2295 / LIN-2204 / LIN-1320)** | `docs/*-prompt.md` ↔ `lib/prompts/*.js` instances | Class assessed here (guard inventory below); instances stay theirs. |

---

# Guard inventory and prompt-twin coverage

*Rewritten after review `447ab1b1-2e9f-4c05-bdfc-6a83fcdb4407` (item 4; binding verdicts `a41d3cfe` #4 and `cdb29489` #4). The earlier text claimed 21 tests via "16 + 3 + 2". That sum counted `landing-content` and `proxy-instructions` twice, and the literal-path query both over- and under-matched.*

**Definition.** A test **pins** a doc when one of its assertions checks content that comes from a doc surface: `*.md`, `public/llms.txt`, `lib/proxy-instructions.js` or `content/*.md`. A drift in that doc's text can then fail the test. The test may read the file directly, go through a parser or generator whose output is the doc text, or fetch a route that serves it. The following are **not** pins:
- a doc named only in a comment or a fixture URL;
- a doc used as opaque input whose content the test is built to survive, such as hash/title stamping equality;
- a check that a route's output equals its generator's output;
- a test that pins the code side of a documented contract without reading the doc.

**Queries.**
1. **Literal.** A test file containing `readFileSync` plus a quoted `.md` / `llms.txt` / `proxy-instructions.js` / `content/` path.
2. **Generator.** A test importing one of the modules that read a doc at runtime. `git grep readFileSync -- lib routes server.js` finds them:
   - `lib/parse-landing.js`
   - `lib/north-star-resolver.js`
   - `lib/prompts/{autopilot-manual,passage-planner-kickoff,passage-runner-kickoff,worker-lane-kickoff}.js`
   - plus `lib/proxy-instructions.js` itself
3. **Route.** A test fetching `/api/proxy/instructions`, `/llms.txt`, or a landing-data route (`/swipe`, `/swim`).
4. **simple-dispatcher.** Every `test/**` file that reads `README.md`, `CLAUDE.md` or `docs/`.

**Confirmed doc-pinning tests: 26 = 24 `LinearViewer` + 2 `simple-dispatcher`.**

| # | test | doc(s) pinned | mechanism | asserts | drift it misses |
| -- | -- | -- | -- | -- | -- |
| 1 | `tests/unit/autopilot-kickoff.test.js` | `docs/autopilot-kickoff.md` (+ the operating manual inlined by `buildAutopilotKickoff`) | direct read | the doc twin's "pause for the human" bullet cites "The human's edge, and how to hand back" and carries no second rubric | the rest of the twin doc vs the generator |
| 2 | `tests/unit/claude-md-line-budget.test.js` | `CLAUDE.md` | direct read | ≤110 lines / ≤12,000 bytes | content accuracy (H3's `CLAUDE.md:60,94`); does not bound `source-map.md` (H6) |
| 3 | `tests/unit/claude-md-scheduler-jobs-census.test.js` | `docs/architecture/source-map.md` (scheduler entry) | direct read | roster sentence = `server.js` `scheduler.register` sites | every other `source-map.md` entry (H6, H7) |
| 4 | `tests/unit/docs-architecture-anchor-resolver.test.js` | `CLAUDE.md` "Where the detail lives" + every incoming `docs/architecture/*.md` citation | direct read | citations **into** area docs resolve; index = docs that exist; pinned headings; residual `CLAUDE.md` line anchors | links **inside** area docs and out to `docs/*.md` (N1) |
| 5 | `tests/unit/flight-companion-kickoff.test.js` | `public/llms.txt`, `CLAUDE.md`, `docs/architecture/source-map.md` | direct read | none of them calls the kickoff a "separate, older" mechanism (negative regex) | any other stale Flight Companion claim |
| 6 | `tests/unit/north-star-resolver.test.js` | `docs/north-star.md` | direct read | title shape `^North star — v\d+, ` (+ hash of the normalised text) | body content (the hash is recomputed, so any edit passes) |
| 7 | `tests/unit/passage-runner-contract-drift.test.js` | `docs/passage-runner-prompt.md`, `docs/proxy-integration.md`, `lib/proxy-instructions.js` | direct read | exact `DUPLICATE_DISPATCH` counts (2 / 4) and status-enum prose counts; the preamble no longer says "no generator yet" | any contract term it does not count; count-preserving rewording |
| 8 | `tests/unit/prompt-templates.test.js` | `public/llms.txt`, `docs/architecture/source-map.md`, `docs/executive-summary.md` | direct read | count = 17 at the llms.txt header, per-kind bullets, "All N templates above", the source-map count, `executive-summary.md:161` | `executive-summary.md:34,55,132` and `lib/render-landing.js:339` (N2); `content/landing.md:18` is excluded by design (LIN-2392) |
| 9 | `tests/unit/proxy-kickoff-goal-length.test.js` | `docs/passage-planner-prompt.md` | direct read | the "exactly this text" fenced goal template exists and the route accepts it | the rest of the Planner doc |
| 10 | `tests/unit/rulings-resolution-contract-drift.test.js` | `lib/proxy-instructions.js`, `docs/autopilot-operating-manual.md` | direct read | deploy-witness union verbatim; `withdrawn` + `reason` documented; no-re-raise literal counts | `docs/proxy-integration.md`'s rulings prose (not read) |
| 11 | `tests/unit/trashed-signal.test.js` | `lib/proxy-instructions.js` + `docs/proxy-integration.md` (concatenated with route source) | direct read | Trashed / 409 mentions exist somewhere in the union | which file carries them: one doc can drop them while another still passes the test (the H1 quick-reference gap) |
| 12 | `tests/unit/worker-lane-prompt-ticket-marker-relay.test.js` | `docs/worker-lane-prompt.md` (via `buildWorkerLaneKickoff`), `docs/dispatch-integration.md` (direct) | direct read + generator | the Step 5 example is relayable; no marker in a fenced block; every documented state is accepted by the guard | everything outside the `[ticket]`-marker shape |
| 13 | `tests/unit/landing-content.test.js` | `content/landing.md` | generator (`parseLandingPage`) | no in-tree Login section; ends with the Harbour OS section → os.harbour.cat | H4 (`:13` 3-of-5 backends, `:18` "14") |
| 14 | `tests/unit/passage-planner-kickoff.test.js` | `docs/passage-planner-prompt.md` | generator (`buildPassagePlannerKickoff`) | preamble cut at `---`; body markers; no retired witness gate; LIN-1857 self-check | body-vs-contract drift |
| 15 | `tests/unit/proxy-instructions.test.js` | `lib/proxy-instructions.js` | generator (`buildInstructions`) | scope gates Write Endpoints / Shell Tip; baseUrl embedding; declared-provider wording | H1 (409 quick-ref, 2 gate codes, 2 endpoints, `includeResolved`/`stampLoopId`), `effort` (LIN-2656), DC fields |
| 16 | `tests/unit/passage-runner-kickoff.test.js` | `docs/passage-runner-prompt.md` | generator (`buildPassageRunnerKickoff`) | preamble excluded; required leg-block heading present | all other body content |
| 17 | `tests/unit/worker-lane-kickoff.test.js` | `docs/worker-lane-prompt.md` | generator (`buildWorkerLaneKickoff`) | preamble excluded; re-grounding mandate, refusal licence, `[ticket]` marker, Step 3 scope rule (LIN-3006/3033) | all other body content |
| 18 | `tests/unit/autopilot-manual.test.js` | `docs/autopilot-operating-manual.md` | generator (`buildAutopilotManual`, `extractPrincipleZeroSection`) | handbook title; Principle 0 section anchor, order and boundaries | manual prose outside Principle 0 |
| 19 | `tests/unit/scan.test.js` | `docs/autopilot-operating-manual.md` (Principle 0 section) | generator (`extractPrincipleZeroSection`) | a real extraction exists and is embedded verbatim (fail-closed) | everything but the section's extractability |
| 20 | `tests/unit/lin-2354-instructions-provider-identity.test.js` | `lib/proxy-instructions.js` | served catalog (`GET /api/proxy/instructions`) | provider-identity wording per backend; Linear-only claims absent; field-support tables untouched | everything but provider framing |
| 21 | `tests/unit/lin-2253-instructions-cost-gate-prose.test.js` | `lib/proxy-instructions.js` (`/cost` entry) | served catalog | served prose names `noLineage`; `lib/task-cost.js` still has exactly the 4 documented conditions | every other endpoint's prose |
| 22 | `tests/e2e/proxy.spec.js` | `lib/proxy-instructions.js` | served catalog | contains 'Workspace API Proxy', `/me`, `/teams`, `view=digest`, 'Write Endpoints', LIN-1557 refuse/drop wording, `/cycles` forms, the label sample | presence-only strings (its `docs/north-star.md` read is input-only, not a pin) |
| 23 | `tests/e2e/landing-swipe.spec.js` | `content/landing.md` | landing data (`/swipe`) | `LV-N` identifiers; "/ 14" non-completed cards (16 issues, 2 done); >1 project filter | landing prose / headline claims (H4) |
| 24 | `tests/e2e/landing-swim.spec.js` | `content/landing.md` | landing data (`/swim`) | `LV-N` identifiers | everything else |
| 25 | `simple-dispatcher/test/claude-md-line-budget.test.js` | SD `CLAUDE.md` | direct read | ≤90 lines / ≤7,000 bytes (bytes binding) | content accuracy |
| 26 | `simple-dispatcher/test/claude-md-anchor-resolver.test.js` | SD `CLAUDE.md` + its 5 "Where the detail lives" targets + repo-wide `CLAUDE.md` anchors | direct read | anchors and pointers resolve; point-in-time docs excluded | area-doc **content** (the SD-H7 drifts below: module-map completeness, phase count, driver list) |

**Arithmetic, corrected.**
- **Old:** "21 = 19 LV + 2 SD", built as "16 + 3 + 2". The "+2" were `landing-content` and `proxy-instructions`, which are already two of the "+3".
- **New:**
  - Start from the plan's 16 and remove its 3 false positives: 13 true literal matches.
  - Add the 3 named parser/generator tests: 16.
  - Add 8 found by the generator and route queries: 24 LV.
    - `passage-runner-kickoff`, `worker-lane-kickoff`, `autopilot-manual`, `scan`
    - `lin-2354-instructions-provider-identity`, `lin-2253-instructions-cost-gate-prose`
    - `landing-swipe`, `landing-swim`
  - Add 2 SD: **26**.

**Excluded from the plan's 16 (not pins):**
- `tests/unit/collective-participant-characterization.test.js` reads `tests/fixtures/collective-participant/*`. `llms.txt` appears only as a fixture URL.
- `tests/unit/recommendation-context-fetch.test.js` reads route and provider **source**. `.md` appears only inside fixture URLs.
- `tests/unit/workspace-api-roadmap-north-star-write.test.js` pastes `docs/north-star.md` as opaque input. It asserts the stamp equals the resolver's own hash/title, so any doc edit passes.

**Also checked, not pins:**
- `proxy-north-star-route`: same pattern as the north-star write test.
- `passage-runner-prompt-route`: asserts route text === generator output.
- `render.test.js`: pins the HTML side of the llms.txt selector contract and never reads llms.txt.
- `proxy-endpoint-inventory-witness`: checks status 200 only.
- These name `/api/proxy/instructions` only as a URL string:
  - `proxy-preamble`
  - e2e `flight-companion-proxy-copy`, `passage-planner-proxy-copy`, `proxy-toggle-copy`, `next-run`, `periodicals`
- `landing.spec.js`: asserts `content/landing.md` is **not** rendered on `/`.
- `bash-tool`, `observation-render`: temp `.txt` and `.js` source reads.

**Prompt-twin class.** The glob `docs/*-prompt.md` + `docs/autopilot-*.md` yields **10 unique docs**.
- **5 are pinned**, by **10 tests** (rows 1, 7, 9, 10, 12, 14, 16, 17, 18, 19):
  - `docs/autopilot-kickoff.md`
  - `docs/passage-runner-prompt.md`
  - `docs/worker-lane-prompt.md`
  - `docs/passage-planner-prompt.md`
  - `docs/autopilot-operating-manual.md`
- **Unpinned 5**, named so the next run can pick them up:
  - `autopilot-experiment`
  - `autopilot-operating-manual-research`
  - `autopilot-operating-manual-v2`
  - `autopilot-orchestrator-prompt`
  - `plan-LIN-180-dispatch-custom-prompt`

Cross-link LIN-1443/2295/2204/1320 rather than re-mint. The six tests verdict `a41d3cfe` #4 added are rows 1, 7, 12, 10, 9 and 5: `autopilot-kickoff`, `passage-runner-contract-drift`, `worker-lane-prompt-ticket-marker-relay`, `rulings-resolution-contract-drift`, `proxy-kickoff-goal-length`, `flight-companion-kickoff`.

---

# Trend ledger — carried forward from 2026-08-29

| item | 08-29 | 09-26 | movement |
| -- | -- | -- | -- |
| `proxy-instructions-blob-409-drift` (H1) | MED; quick-ref table 1 of 3 causes + 2 gate codes + 2 endpoints absent | **unchanged**; additionally documents `includeResolved`/`stampLoopId` that the long doc lacks (reverse drift) | **unchanged, widened; LIN-2390 owns** |
| `halt-pending-LIN-2995-copy` (H13) | not examined by this run until the adversarial second-read | **new**: ~26 non-test LinearViewer sites still say the runner ignores a halt, though LIN-2995/2994/3045 are Done and simple-dispatcher enforces halts | **new, high; existing LIN-3074 owns — commented** |
| `claude-md-jira-readonly-claim` (H2) | HIGH | **resolved-in-split** (false prose dropped, not moved) | **resolved** |
| `claude-md-linear-only-framing` (H3) | HIGH | **unchanged**; residual now spread across `CLAUDE.md`, `docs/architecture/auth.md`, `lib/feature-defaults.js`, `docs/architecture/source-map.md`, `routes/proxy.js:2`, and 7 `docs/executive-summary.md` lines, incl. the false `:147` | **unchanged, re-bounded; LIN-2391 owns** |
| readme-provider-drift / simple-dispatcher-broker-env / llms-txt-linear-only-framing (F1/F3/F4) | resolved (LIN-2248/2249/2250 Done) | not re-flagged | **resolved — carried** |
| `landing-md-backend-template-drift` (H4) | MED-HIGH | **unchanged**; LIN-2392 Todo | **unchanged; LIN-2392 owns** |
| `view-tiers-experimental-list` (F2) | 7 of 9; LIN-1856 owns | **still 7 of 9**; `docs/architecture/views.md:5` remains the correct representation | **unchanged; LIN-1856 owns** |
| `claude-md-routes-map-drift` (H6/F5) | relocated to `source-map.md`, 103,596 B, not minted | **re-measured**: 103,596 B / 248 l / 23 lines >1k / max 9,007 / 5 per-ticket rewrites of `:211` | **re-drifted; still human-decision** |
| `direction-layer-proposal-stale-cli-transport` (H10/F6) | fourth run recorded | **fifth run recorded**, unchanged | **unchanged** |
| `periodicals-stale-rationale-counts` (LIN-687) | fixed in code, ticket open | **still fixed in code; ticket still open** | **stable; recommend close** |
| `simple-dispatcher-docs-cleanup` (LIN-2177) | three items open | **all three still hold at HEAD** | **unchanged; cross-linked** |
| `provider-framing-production-sites` (LIN-2354) | ticket Done; 2 sites still unconditional | not re-audited this run (out of the corrected scope) | **carried** |
| `relocation-link-relative-paths` (N1) | not previously tracked | **new**: 4 broken links in `docs/architecture/`, resolver-verified; guard covers incoming only | **new, low; minted LIN-3117** |
| `asymmetric-propagation` (N2) | new this run | guard reads one count site per file; 4 stale sites survive | **new, med; minted LIN-3115 (LIN-1653 cross-link)** |
| `post-split-route-citations` (DC) | not previously tracked | **new**: 4 doc citations + 10 inline comments name the pre-split `routes/proxy.js` | **new, med; minted LIN-3116** |
| `per-feature-single-entry-inflation` (H6 cause) | not previously tracked | 5 of 8 post-split commits rewrite one `source-map.md` line | **new; strengthens H6, human-decision** |
| `documentation-review-second-repo-coverage` | extended to `simple-dispatcher` in 08-23 | first assessment of SD's 5 LIN-2897 area docs: 16 claims hold, 5 drift (SD-H7). `module-map.md` omits 12 of 35 non-e2e root modules (8 in no SD doc); 39 runtime env vars undocumented (CFG). No SD-only HIGH; SD still link-clean | **re-drifted: the verbatim-moved area docs carry stale enumerations, so SD is no longer "comparatively clean"; record only** |

---

# H6 · human-decision item

`docs/architecture/source-map.md` is an unguarded, hand-maintained exhaustive map at **103,596 bytes / 248 lines**, with **23 lines over 1,000 chars** (max **9,007** at `:50`) and repeated per-feature single-line growth at `:211` (five rewrites). The `CLAUDE.md` size guard was transferred around, not satisfied. The remedy is a **human worth/direction call**: *generate* the map from the tree, or *pin* selected entries mechanically (as `claude-md-scheduler-jobs-census` and `prompt-templates` already do) — not a third manual backfill (the previous two, LIN-601 and LIN-664, both re-drifted). Recorded here, **not minted**; no mechanical backfill ticket.

---

## Adversarial Second-Read

**Tier:** Tier 1 — a wholly separate dispatched session with no memory of this run. Reader dispatch id `0aa7fdef-52e3-41be-bdac-ee74e654d198` (`POST /api/proxy/dispatch`, `kind: "custom"`, `target: "cli"`, `issueIdentifier: LIN-3102`, no `sessionId`, no `followUpTo`), status `done`, completed 2026-09-26. The prompt pointed the reader at this report on the PR branch (PR #1594) and both repos at `origin/main`, stated the remit in two lines, and instructed it not to edit files, open PRs, create tickets or comment on tickets.

**Question asked (verbatim):** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's answer (full, from its final dispatch feedback entry):**

> DONE: The read-only Tier-1 second-read of LIN-3102 is finished and verified against source. The largest miss is 21 Harbour sites that still say the runner ignores a halt, although simple-dispatcher obeys halts since LIN-2995 (Done 2026-09-26). This differs from the report's top finding, H3. Nothing was edited, posted or run: there is no PR, commit, test or CI run for this remit.

*(The reader's answer reached the owning session as a single final dispatch feedback entry; its supporting working notes are not separately serialized in `feedback[]`. The central claim was independently re-derived by this session and is recorded in full above as H13: `LIN-2995`/`LIN-2994`/`LIN-3045` are Done, `simple-dispatcher/README.md:231` documents halt enforcement, and ~26 non-test line occurrences across 5 Harbour docs and 5 Harbour code files still assert the pending/unbuilt framing.)*

**Disposition.** *Fixed in place.* The missed class was added to the report as **H13** (ranked HIGH and promoted to the top of the findings), the minted/not-minted table and trend ledger were updated, and the owning existing ticket **LIN-3074** was commented with the exact site enumeration it asks for. No new ticket was minted (LIN-3074 already owns the fix). The reader's item differed from the prior top finding (H3).

```
Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
```
