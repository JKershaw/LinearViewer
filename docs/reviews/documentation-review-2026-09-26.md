# Documentation Review — 2026-09-26 (periodical run, drift-first, post-CLAUDE.md area-doc split)

*Review-only: no code, docs, config or secrets changed except this report artifact. Severity-ranked, uncapped; follow-ups capped at ~3.*

**HEAD audited.** `LinearViewer` @ `b5c528c4807acc2222f4afd6fe2b87ded41fdf89` (= `origin/main`) · `simple-dispatcher` @ `3b1e734b5496941ef5a7ecfb9497741f275d67fa` (= `origin/main`), re-fetched and re-verified immediately before writing. **Drift since the plan-review grounding (`b5c528c4`/`3b1e734`): 0 commits in either repo.** Drift since the ticket's own seed SHAs (`6e8bf424`/`3b1e734`): `LinearViewer` 2 commits (`b5c528c4`, `207c1e71`, both LIN-3097), touching only `scripts/eval/jev-spike*` — **no doc-relevant files**. The ruling's warning that "the tree has moved tonight" did not materialise at fetch time; every plan-time line number reproduced.

**Scope.** Both repos in this workspace (`LinearViewer` = Harbour, `simple-dispatcher`), for an audience of developers **and** AI agents: root entry docs (`README.md`, `CLAUDE.md`) and the area docs both repos moved to in LIN-2887/2896/2897 (`LinearViewer/docs/architecture/*.md`; `simple-dispatcher/docs/*.md`); the agent-audience `public/llms.txt`; the runtime-served catalog `lib/proxy-instructions.js` (its **content** is this review's; its **bulk** is Code Quality's); public copy (`content/landing.md`, `lib/render-landing.js` lede, `docs/executive-summary.md`); config commentary (`.env.example`, `docs/architecture/configuration.md`, and `process.env` reads both repos); CI-doc twins; prompt-twin docs; and inline comments both repos.

**Method.** Drift-first: every doc claim was located against the concrete thing it asserts at HEAD. Counts and enumerations were verified by **executing** the source (`lib/prompt-template-defs.js` → 17; `lib/feature-defaults.js` `EXPERIMENTAL_VIEWS` → 9; `lib/providers/` → 5; `lib/periodicals.js` `PERIODICALS` → 15; `simple-dispatcher/terminal-driver.js` `TERMINAL_DRIVERS` → 4), never by grep alone. Every class query is stated inline with its finding; the query residues that are point-in-time artifacts are named and excluded explicitly.

**Ruling / process note.** Plan-review looped twice. Both verdicts — `a41d3cfe-3c7d-4b92-839e-380a55a6946e` (9 corrections) and `cdb29489-e07f-4c45-b412-032dad0e5893` (8 corrections) — are **binding**, and their finding lists are a **floor, not a ceiling**. The delegated Con ruling `9d5b7c86-c466-48db-ac57-4ab70fa5100b` ("option a — write the report now", verb override `c128261f-29d0-4641-8e10-98b88569e4f8`) waived plan approval for this ticket only; research is `003e0676-d72f-4424-94f4-4cd9910e32f6`, plan `7bbcd520-786c-409d-84d0-75f34f34b78b`, revision `90ea268f-4db0-45cf-a639-193fd3672d49`, hand-back `9fad9e30-5c97-4b30-8a43-e4ae598467c7`. This report re-ran every class query at HEAD and treats the verdict member lists as the floor it was asked to be. The PR still goes through normal review and CI. **Follow-ups minted this run:** LIN-3115 (N2), LIN-3116 (DC-dispatch-fields + route citations), LIN-3117 (N1), each `related` to this ticket; existing-ticket measurements were posted as comments on LIN-2390/2391/2392/1856/2656/2255/2177/687/1233 and a cross-link on LIN-1653.

---

# Findings, severity-ranked

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

Non-test inline comments (11): handler-named — `lib/dispatch-store.js:523` (`GET /api/proxy/dispatch/:id`), `lib/dispatch-validation.js:139` (`POST /api/proxy/dispatch`), `lib/issue-write-validation.js:6` (`POST /api/proxy/issues`), `lib/periodical-report-gate.js:61` (`PATCH /api/proxy/issues/:id`), `lib/providers/linear/index.js:1636` (`PATCH /api/proxy/issues/:id`), `routes/workspace-api.js:1488` (`POST /api/proxy/issues/:issueId/comments`); line-cites past the end of the file — `lib/plan-review-round-trips.js:54` (`:6007`), `lib/workspace.js:854` (`:2477`), `routes/proxy-reads.js:28` (`:1745`), `routes/workspace-api.js:3388` (`:2477`); cross-repo — `simple-dispatcher/hook.js:1058` (the dispatch prompt is served at `routes/proxy-dispatch.js:1715`).

Test members (8, recorded not ranked): `tests/unit/dispatch-route-periodical-id.test.js:9`, `tests/unit/lin-2239-canonical-priority-scale.test.js:17`, `tests/unit/lin-2353-recommend-llm-provider-ui.test.js:3`, `tests/unit/quota-isolation.test.js:15`; past-end — `tests/unit/dispatch-wake.test.js:758` (`:5818`), `tests/unit/image-proxy.test.js:127` (`:2477`), `tests/unit/proxy-credential-fingerprint-stamping.test.js:21` (`:2072`), `tests/unit/proxy-openrouter-principal-hop.test.js:317` (`:4296`).

**Checked and correctly cited (not members):** `docs/runbooks/harbour-degraded.md:55` (`routes/proxy.js:527` sits inside `authenticateProxyToken`); `docs/architecture/source-map.md:50` (`resolveProviderAccess (routes/proxy.js)`, genuinely defined at `:657`); `docs/architecture/prompt-system.md:32` (historical LIN-308/309 narrative). Dated research / design docs excluded as point-in-time, same class as the prompt-count guard's dated audit reports: `docs/autopilot-experiment.md`, `docs/autopilot-operating-manual-research.md`, `docs/lin-367-research-notes.md`, `docs/lin-418-llm-tracking-research.md`, `docs/pipeline-hierarchy.md`, `docs/pipeline-design-history.md`, `docs/passage-planner-session-2026-08-03.md`, `docs/recommender-structural-drift.md`, `simple-dispatcher/docs/fleet-design.md`, `simple-dispatcher/docs/control-plane-split-research.md`.

**Class.** API / interface documentation + inline comments. **Confidence:** verified at HEAD. **Owner:** new. Bound: **4 doc citations + 11 non-test inline comments (+8 test)**.

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

**What (SD).** Query `grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*" --include="*.js" .` (excluding `node_modules`) → **92 unique vars**; **43 undocumented** in `README.md`/`CLAUDE.md`/`docs/*.md` under whole-word matching. Exclusions to state so the count is reproducible: `SD_` (a template-literal prefix, not a var), `TMPDIR`/`UV_THREADPOOL_SIZE` (platform), `SD_TEST_GIT_PROBE_MODE` (test-only). Excluding `test/` (with `experiments/`, `scratchpad/`) gives **85 unique** — the gap to the all-source count is the test/experiment folders, not Node built-ins. Feature flags confirmed undocumented: `SD_OPLOG`, `SD_LAUNCH_BREAKER_ENABLED`, `SD_TICKET_MARKER_RELAY`.

**Class.** Config commentary. **Confidence:** verified at HEAD. **Disposition:** recorded here; not minted.

---

## H5 / H7 / H8 · **MED-LOW** — carried structural finds, re-verified — **not minted**

- **H5 (archive)** — largely **resolved-in-split**: `docs/architecture/source-map.md:231` now documents `docs/archive/1.html`–`7.html` accurately, including `#4`. `lib/render-landing.js:398` still hard-codes `/archive/2`, but with no false "latest edition" comment any more. Residual: `tests/e2e/archive.spec.js` exercises `/archive/1,2,3,5,6,7` but **skips `/4`** — a test-coverage gap, not doc drift.
- **H7 (modules in no doc)** — 5 of the 6 modules named in 08-29 are still zero-hit in non-review docs: `lib/periodical-report-gate.js`, `lib/proxy-credential-trail.js`, `lib/account-conflict.js`, `routes/workspace-api-prompts.js`, `routes/workspace-api-roadmap.js`. `routes/account-merge.js` now appears once (source-map) — partially resolved.
- **H8 (discoverability)** — `CLAUDE.md`'s "Where the detail lives" indexes 8 `docs/architecture/*` docs, not the **56** top-level `docs/*.md`; `charter/`, `roadmaps/`, `incidents/`, `observation-mockups/` are unreferenced; there is no `docs/README.md` index; and the seven overlapping `docs/autopilot*.md` documents carry no in-force/supersession marker (`autopilot-operating-manual-v2.md` shares the live manual's title). `docs/charter/*.md`'s `> **Status: DRAFT, not adopted.**` header is the in-repo precedent for the fix.

**Class.** Discoverability / entry-point quality. **Confidence:** verified at HEAD. **Sibling:** Onboarding & Cold-Start (entry-path walking is theirs).

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
5. **SD env count is stated, not inherited.** 92 unique `process.env` reads all-source; 43 undocumented under whole-word matching; 85 unique excluding `test/`/`experiments/`/`scratchpad/`; exclusions `SD_`, `TMPDIR`, `UV_THREADPOOL_SIZE`, `SD_TEST_GIT_PROBE_MODE` called out so the count is reproducible.
6. **The catalog is not "kept in sync" with the long-form guide** — it is co-edited only sometimes: 8 of the catalog's last 15 non-merge commits did not touch `docs/proxy-integration.md`; genuine co-edits cite **LIN-2818, LIN-3025, LIN-2934, LIN-2974 (×2), LIN-2975, LIN-2886**. Reverse drift (`includeResolved`, `stampLoopId`) follows from this, folded into H1.
7. **`source-map.md`'s churn is per-feature single-entry inflation**, not paper-archive churn — a correction that strengthens H6 rather than weakening it.
8. **H3's file-local line list moved** with the area-doc split; this report carries HEAD line numbers, not the old `CLAUDE.md` ones.
9. **`tests/unit/docs-architecture-anchor-resolver.test.js` covers incoming citations into `docs/architecture/*.md` only** — not links *inside* area docs and not out to `docs/*.md` targets (`docs/view-tiers.md`, `docs/prompt-change-validation.md`). This is why N1's four links have no guard.

---

# Minted / not-minted

| finding | severity | disposition |
| -- | -- | -- |
| **N1** — 4 broken relative links in `docs/architecture/` | LOW | **minted: LIN-3117** (related to LIN-3102) |
| **N2** — template-count guard hole (`lib/render-landing.js:339`, `docs/executive-summary.md:34,55,132`) | MED | **minted: LIN-3115**; cross-link **LIN-1653** (same guard class, other surfaces) and **LIN-2392** |
| **DC-dispatch-fields + post-split route citations** | MED | **minted: LIN-3116** (widened: 3 fields + 4 doc citations + 11 inline comments + 8 test); cross-link **LIN-2601**, **LIN-914** |
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
| **CI-doc twin** `docs/architecture/ci.md:46` omits `secret-scan` | LOW-MED | **record only** (not minted) |
| **H9 / H10 / H11 / H12** | LOW | **record only** (not minted) |

The ~3-new cap is spent on **N2 → LIN-3115**, **DC-dispatch-fields → LIN-3116**, **N1 → LIN-3117**, each left in its default state and `related`-linked back to LIN-3102. Duplicate search before minting (`/api/proxy/search`, 2–3 phrasings each) found *overlapping* but not *owning* tickets and was resolved by cross-linking, not re-minting: LIN-1653/LIN-2302 (N2's count class), LIN-2601 (split hygiene, different surface), LIN-914 (`waitForFollowUps` removal — flagged inside LIN-3116). The highest-severity items (H1/H3/H4/F2/effort) already have tickets and were cross-linked/commented, not duplicated.

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

**Query.** Files under `tests/unit`+`tests/e2e` (`LinearViewer`) / `test` (`simple-dispatcher`) containing `readFileSync` **and** a quoted path ending `.md` / `llms.txt` / `proxy-instructions.js`. **Blind spot**, stated: this literal-path query misses tests that pin a doc through a parser or generator. Added:
- `tests/unit/landing-content.test.js` (`content/landing.md` via `parseLandingPage`)
- `tests/unit/passage-planner-kickoff.test.js` (`docs/passage-planner-prompt.md` via `buildPassagePlannerKickoff`)
- `tests/unit/proxy-instructions.test.js` (catalog content via `buildInstructions`)

**Confirmed doc-pinning tests (21):** 19 `LinearViewer` + 2 `simple-dispatcher` (`test/claude-md-anchor-resolver.test.js`, `test/claude-md-line-budget.test.js`). The 16 `LinearViewer` named in the plan plus the 3 parser/generator additions, plus 2 that the research pass had already listed. The broad literal-path query's two extra matches (`tests/unit/bash-tool.test.js`, `tests/unit/observation-render.test.js`) are false positives — temp `.txt` files and a `.js` source read, not docs.

**Prompt-twin class.** The glob `docs/*-prompt.md` + `docs/autopilot-*.md` yields **10 unique docs**; **5 are pinned** by dedicated guards — `docs/autopilot-kickoff.md`, `docs/passage-runner-prompt.md`, `docs/worker-lane-prompt.md`, `docs/passage-planner-prompt.md`, `docs/autopilot-operating-manual.md` (a 6th test, `passage-planner-kickoff`, covers one twin directly). **Unpinned 5**, named so the next run can pick them up: `autopilot-experiment`, `autopilot-operating-manual-research`, `autopilot-operating-manual-v2`, `autopilot-orchestrator-prompt`, `plan-LIN-180-dispatch-custom-prompt`. Cross-link LIN-1443/2295/2204/1320 rather than re-mint.

---

# Trend ledger — carried forward from 2026-08-29

| item | 08-29 | 09-26 | movement |
| -- | -- | -- | -- |
| `proxy-instructions-blob-409-drift` (H1) | MED; quick-ref table 1 of 3 causes + 2 gate codes + 2 endpoints absent | **unchanged**; additionally documents `includeResolved`/`stampLoopId` that the long doc lacks (reverse drift) | **unchanged, widened; LIN-2390 owns** |
| `claude-md-jira-readonly-claim` (H2) | HIGH | **resolved-in-split** (false prose dropped, not moved) | **resolved** |
| `claude-md-linear-only-framing` (H3) | HIGH | **unchanged**; residual now spread across `CLAUDE.md`, `docs/architecture/auth.md`, `lib/feature-defaults.js`, `docs/architecture/source-map.md`, `routes/proxy.js:2`, and 7 `docs/executive-summary.md` lines, incl. the false `:147` | **unchanged, re-bounded; LIN-2391 owns** |
| `landing-md-backend-template-drift` (H4) | MED-HIGH | **unchanged**; LIN-2392 Todo | **unchanged; LIN-2392 owns** |
| `view-tiers-experimental-list` (F2) | 7 of 9; LIN-1856 owns | **still 7 of 9**; `docs/architecture/views.md:5` remains the correct representation | **unchanged; LIN-1856 owns** |
| `claude-md-routes-map-drift` (H6/F5) | relocated to `source-map.md`, 103,596 B, not minted | **re-measured**: 103,596 B / 248 l / 23 lines >1k / max 9,007 / 5 per-ticket rewrites of `:211` | **re-drifted; still human-decision** |
| `direction-layer-proposal-stale-cli-transport` (H10/F6) | fourth run recorded | **fifth run recorded**, unchanged | **unchanged** |
| `periodicals-stale-rationale-counts` (LIN-687) | fixed in code, ticket open | **still fixed in code; ticket still open** | **stable; recommend close** |
| `simple-dispatcher-docs-cleanup` (LIN-2177) | three items open | **all three still hold at HEAD** | **unchanged; cross-linked** |
| `provider-framing-production-sites` (LIN-2354) | ticket Done; 2 sites still unconditional | not re-audited this run (out of the corrected scope) | **carried** |
| `relocation-link-relative-paths` (N1) | not previously tracked | **new**: 4 broken links in `docs/architecture/`, resolver-verified; guard covers incoming only | **new, low; minted LIN-3117** |
| `asymmetric-propagation` (N2) | new this run | guard reads one count site per file; 4 stale sites survive | **new, med; minted LIN-3115 (LIN-1653 cross-link)** |
| `post-split-route-citations` (DC) | not previously tracked | **new**: 4 doc citations + 11 inline comments name the pre-split `routes/proxy.js` | **new, med; minted LIN-3116** |
| `per-feature-single-entry-inflation` (H6 cause) | not previously tracked | 5 of 8 post-split commits rewrite one `source-map.md` line | **new; strengthens H6, human-decision** |
| `documentation-review-second-repo-coverage` | extended to `simple-dispatcher` in 08-23 | no new SD-only high-severity finding; SD link-clean | **stable — SD's doc surface remains comparatively clean** |

---

# H6 · human-decision item

`docs/architecture/source-map.md` is an unguarded, hand-maintained exhaustive map at **103,596 bytes / 248 lines**, with **23 lines over 1,000 chars** (max **9,007** at `:50`) and repeated per-feature single-line growth at `:211` (five rewrites). The `CLAUDE.md` size guard was transferred around, not satisfied. The remedy is a **human worth/direction call**: *generate* the map from the tree, or *pin* selected entries mechanically (as `claude-md-scheduler-jobs-census` and `prompt-templates` already do) — not a third manual backfill (the previous two, LIN-601 and LIN-664, both re-drifted). Recorded here, **not minted**; no mechanical backfill ticket.

---

## Adversarial Second-Read

*pending — Tier-1, filled after the PR exists.*
