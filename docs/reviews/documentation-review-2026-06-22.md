# Documentation Review — run of 2026-06-22 (BASELINE under the current report contract)

**Grounding:** reviewed at HEAD = `238b7b9` (LIN-599 merge, 2026-06-22). Every finding below is re-grounded against current source at HEAD, cited to `file:line`, not to prior prose.

**Baseline confirmation:** at minting time **no** `documentation-review-*.md` report existed in `docs/reviews/` — confirmed at HEAD (`ls docs/reviews/documentation-review-*` → no matches). This is therefore the **baseline** Documentation Review under the current report contract; the trend ledger at the bottom is what the next run diffs against. The earlier Documentation Review tasks LIN-347/LIN-348 predate this contract (they *edited* docs rather than producing a report), so there is no prior report to build on. The sibling reports used for house format: `drift-coherence-review-2026-06-11.md`, `design-interface-review-2026-06-20.md`.

**Headline:** documentation is broadly accurate where it has been actively maintained (the prompt-system seams, auth routes, CLI catalog, most of the proxy contract), but **drift concentrates in two places**: (1) the **consumer wire contracts** — `proxy-integration.md` and `dispatch-integration.md` have fallen behind the served `/api/proxy/instructions` text and the code on three real, callable fields/conventions, and `llms.txt` advertises a prompt template that was deleted; (2) the **CLAUDE.md source-tree map**, which references a renamed file, omits ~11 substantive modules, and is entirely silent on a whole new **GitHub provider** (374 LoC) and the **task-chat** view that its own view-tier section names. Severity is led by the consumer-contract drift because it misleads external callers/agents into broken or incomplete calls; the map drift is high-value but degrades orientation rather than breaking a specific call. Nothing here requires a structural/code change — every finding lands cleanly as a doc edit (see Surface Assessment).

---

### 1. `proxy-contract-behind-served-instructions` — High — *new (baseline)*

`docs/proxy-integration.md` is the stated **source of truth** for the proxy wire contract, but on the dispatch/autopilot surface it has fallen behind both the live served `/api/proxy/instructions` text **and** `routes/proxy.js`. The served text and the code agree with each other; the integration guide is the stale artifact. Three callable things are missing from the guide:

- **`/autopilot/manual` is entirely absent from the guide.** Route exists at `routes/proxy.js:3348`; served instructions document it (instructions text §183-185). A consumer reading only the guide never learns the endpoint exists.
- **Dispatch `kind` field undocumented in the guide's `POST /api/proxy/dispatch`.** Validated against `DISPATCH_KINDS` at `routes/proxy.js:3385-3386` and always emitted in dispatch responses via `formatDispatchWatch` (`routes/proxy.js:494`); served instructions carry it on both request and response. The guide's enqueue body (`docs/proxy-integration.md:957`), its `201` response (`:972`), and the watch/list examples (`:1063-1080`, `:1096`) all omit it.
- **Dispatch `followUpTo` field undocumented in the guide's enqueue body.** Accepted and scope-checked (cli/web only) at `routes/proxy.js:3437-3446`, returned at `:498`, documented in the served instructions. The guide's enqueue body table (`docs/proxy-integration.md:960-968`) omits it, so session-resume is undiscoverable from the canonical request shape (it appears only in unrelated top-level prose).

**Concrete cost:** an external agent integrating against the guide cannot set `kind` or `followUpTo`, will not expect `kind` in responses, and never discovers `/autopilot/manual` — three real capabilities silently lost. Promoted (folded with Finding 2).

### 2. `dispatch-contract-target-and-terminal-markers` — High — *new (baseline)*

`docs/dispatch-integration.md` is the dispatch consumer contract and drifts from `routes/dispatch.js` / `lib/dispatch-store.js` / `lib/dispatch-terminal.js` on two items that can break a *correct* integration:

- **`local` target missing from the contract.** Code accepts four targets — `VALID_TARGETS = ['cli', 'web', 'dash', 'local']` (`routes/dispatch.js:206`; mirrored in `lib/dispatch-store.js:19,92`). The guide says only "`cli`, `web`, or `dash`" in its overview, target table, and routing section (`docs/dispatch-integration.md:14,257,337-341,356`), then *internally contradicts itself* by naming `local` only in the follow-up rejection rules (`:282`). The target-filter example (`:351-353`) silently drops `local` items that genuinely appear in poll results.
- **Terminal-marker completion convention undocumented.** The only way a consumer signals completion is feedback text markers `[done]`/`[complete]`/`[failed]`/`[aborted]`, parsed by `lib/dispatch-terminal.js:19-20` — these statuses are *derived*, never stored. The stored lifecycle is only `queued`/`taken`/`expired`/`cancelled` (`lib/dispatch-store.js:303,260,341,386`). The guide documents feedback as append-only (`docs/dispatch-integration.md:174-177`) but never mentions the marker convention, so a consumer that finishes work has no documented way to say so.

Secondary drift in the same file (medium, fold into the same fix): feedback rate-limit is per-**IP** not per-token (`routes/dispatch.js:51-59` default keyer vs `docs/dispatch-integration.md:177,392`); the `repo` response field is implemented-but-undocumented (`routes/dispatch.js:198,240,299`, `lib/dispatch-store.js:119,409,496,595` vs the schema table at `docs/dispatch-integration.md:247-263`); the `kind` vocabulary is hard-coded in the guide (`:368-371`) instead of pointing at `DISPATCH_KINDS`, a maintenance hazard; and the "timing-safe comparison" claim (`:533`) is contradicted by the code's own reasoning that it does a hash-lookup and timing-safety is N/A (`lib/dispatch-tokens.js:94-97`). Promoted (folded with Finding 1).

### 3. `llms-txt-removed-template-and-stale-quota` — High — *new (baseline)*

`public/llms.txt` is AI-agent navigation guidance; two claims are stale enough to cause a wrong call:

- **Advertises a deleted prompt template.** `llms.txt:184` lists `` `code-review` `` as a standalone template. That key was consolidated into `review` in LIN-523 and no longer exists in `lib/prompt-template-defs.js`; two in-code comments confirm the removal (`lib/prompt-templates.js:350`, `lib/prompt-formatters.js:319`). An agent following `llms.txt` requests a template the renderer never emits. (The "14 total" count is coincidentally still 14 because `code-review` occupies a slot that should belong to a live template.)
- **Stale free-tier quota.** `llms.txt:116` and Common Workflow #9 (`llms.txt:360`) state the free tier as **5/day**; actual is **20/day** (`public/app.js:1515` renders `(${remaining}/${limit})`, `lib/free-tier-store.js:36` `dailyLimit || 20`; CLAUDE.md:74 also says 20). The DOM selectors `llms.txt` documents are otherwise correct.

**Concrete cost:** the removed-template claim makes an agent call a button that does not exist; the quota number misinforms but does not break. Promoted.

### 4. `claude-md-source-tree-map-drift` — Medium-high — *new (baseline)*

CLAUDE.md's source-tree map is the densest, most authoritative orientation surface and the ticket's flagged highest-drift-risk doc. At HEAD it is materially behind the tree:

- **Stale renamed file.** `CLAUDE.md:103` lists `foreman-store.js`; the file is now `lib/agent-status-store.js` (the proxy endpoint was likewise renamed `/foreman/status` → `/agent/status`). The map points at a path that does not exist.
- **A whole new provider is undocumented.** `lib/providers/github/` (`index.js` 374 LoC + `client.js` + `fake-client.js`) is the abstraction's first *foreign* backend (LIN-178), self-described at `lib/providers/github/index.js:1-20` as the proof the canonical model is real. The provider map (`CLAUDE.md:46-48`) lists only `linear/index.js` and `local/index.js`, and the prose at `CLAUDE.md:185,338` still frames GitHub as a *hypothetical* future provider. This is the highest-value piece of this finding: a headline architecture concept gained a real third adapter that the doc denies exists.
- **An entire view is missing.** Task-chat — `routes/task-chat.js` (274), `lib/render-task-chat.js` (92), `lib/prompts/task-chat-template.js`, `public/task-chat.{js,css}` — is absent from the map even though CLAUDE.md:191 names the `taskChat` flag in its view-tier list. The styleguide view (`lib/render-styleguide.js`, `public/styleguide.css`) is likewise unmapped.
- **~9 substantive `lib/` modules unmapped** (not "small helpers"): `proxy-wire.js` (98 — the source-neutral wire contract central to the LIN-310 work CLAUDE.md:338 describes), `proxy-dedupe.js` (86 — the documented comment-dedupe behavior), `trashed-signal.js` (49 — the documented trashed-issue behavior), `description-edit.js` (157 — backs the proxy append/replace endpoints), `session-summary.js`/`session-summary-cache.js` (206 — sibling of run-summary), `prompt-trace-store.js` (192), `linear-fetch.js` (235).

The map's own disclaimer ("a handful of small helpers may not be listed individually") legitimately covers the `lib/components/` shortfall (Finding 8) but not a 374-LoC provider, a full view, or the wire-contract module. Promoted.

### 5. `claude-md-missing-free-tier-env-vars` — Medium — *new (baseline)*

The `## Environment Variables` block (`CLAUDE.md:265-278`) presents itself as the full list, ending at `YAP_PASSWORD`, but omits two operator-tunable knobs read in code: `FREE_TIER_DAILY_LIMIT` and `FREE_TIER_HOURLY_LIMIT` (`server.js:236-237` → `lib/free-tier-store.js:36-37`; defaults 20/50 match the Free Tier prose). Not consumer-facing, so medium not high. Recorded; folds into the Finding 4 CLAUDE.md refresh. (`HTTP_PROXY`/`HTTPS_PROXY`/`NODE_ENV` are also read but are ambient conventions — low, noted only.)

### 6. `periodicals-stale-rationale-counts` — Medium — *new (baseline)*

`lib/periodicals.js:42-47` header comment is good WHY-rationale but carries stale numbers: it says "the **seven** code-surface reviews are corrective" and "the Stability Review (LIN-453) is the **first** advisory entry"; the registry now holds **9 corrective** and **2 advisory** (`recent-headwinds` joined `stability-review`, `lib/periodicals.js:497,513`). The "eleven prompt builders" / `PERIODICALS.length` claim at `:51` is still accurate. A present-but-wrong embedded count is exactly the inline-rationale drift this review owns. Recorded, not promoted (single-file, low blast radius).

### 7. `proxy-504-undocumented-both-references` — Medium — *new (baseline)*

`graphqlErrorStatus` returns **504** on timeout (`routes/proxy.js:693`), reachable from `/me`, `/issues`, `/stack`, `/recommend`, etc. Neither the guide's error table (`docs/proxy-integration.md:1101-1111`, lists 400/401/403/404/409/429/503/500) **nor** the served instructions error list documents it. The only doc class where *both* references miss the same code. Recorded; folds into the Finding 1 proxy fix.

### 8. `claude-md-components-undercount` — Low (informational) — *new (baseline)*

`CLAUDE.md:122-124` lists only `navbar.js` and `footer.js` under `lib/components/`; nine exist (`card`, `empty-state`, `field`, `page-header`, `page`, `section`, `status-pill` also). Legitimately within the map's "small helpers may not be listed" disclaimer, but `page.js`/`section.js`/`card.js` are structural enough that a one-line "+ small card/section/page/field/status-pill primitives" would help. Recorded, not promoted.

### 9. `readme-omits-view-tiers` — Low — *new (baseline)*

`README.md:23-28` presents Tree/Swipe/Swim/Roadmap/Ship/Pipeline as flat "Views"; per `docs/view-tiers.md` and CLAUDE.md, Roadmap/Pipeline are flag-gated power-user and Ship is experimental, so a newcomer can't reach them on first run. Not wrong, mildly misleading. All README `npm` commands verify against `package.json`; setup steps are accurate and orient fast. Recorded, not promoted.

---

## Surface Assessment (necessity gate)

Every finding above is a **doc-only edit** — fix the prose to match the code. None demands a structural/code change: the code behaviors (the `kind`/`followUpTo` fields, `local` target, terminal markers, 504, the GitHub provider, the renamed store) are already correct and shipped; only their documentation lags. No consumer in this task calls for a new seam, and no bystander pays a refactor tax. Verdict: **no refactor required — all findings land cleanly as documentation edits.** (One adjacent *improvement noticed, not required*: the dispatch `kind` vocabulary being hard-typed in the guide rather than generated from `DISPATCH_KINDS` is a recurring-drift hazard; a generated catalog would prevent re-drift but is not demanded by any finding here.)

---

## Clean results (re-checked; no drift)

- **Auth routes — clean.** `/auth/linear`, `/auth/callback`, `/logout` (`routes/auth.js:45,79,231`); `/auth/openrouter[/callback|/disconnect]` (`routes/openrouter-auth.js:52,86,176`).
- **Linear CLI catalog — clean.** All 18 documented commands map to handlers in `lib/linear-cli.js:800-1035`; flags `--stdin`/`--with-images`/`--base64`/`--file` all present; relation-types table and the blocked-by ID-swap note match `lib/linear-cli.js:620,634-635`. (Harmless extra alias `organization` at `:808`.)
- **Proxy scopes / error envelopes — clean.** read vs readWrite enforced by `requireWriteScope` on exactly the documented mutating endpoints; `CAPABILITY_NOT_SUPPORTED` 422 (`routes/proxy.js:644`), description/replace `NOT_FOUND`/`NOT_UNIQUE`+`matchCount` (`:1796`), 409 trashed-write refusal, 404 trashed task-automation refusal, comment dedupe `200`+`deduped:true` (`:1917`), rate limits 60/min + 10/15min — all match the guide.
- **Dispatch core contract — clean.** All three consumer endpoints + user-facing/token endpoints exist; 24h TTL/`expiresAt`, append-only feedback + 30-day TTL, strict token-label ownership, `dispatchId` alias, `sessionId` orthogonality, auth/error strings — all verified against `routes/dispatch.js`/`lib/dispatch-store.js`.
- **llms.txt DOM selectors — clean** (aside from Findings 3). `data-id`/`data-identifier`/`data-parent`/`data-depth`/`data-section`/`data-status`/`data-search-text`, region landmarks, detail-section `data-toggle`/`data-content`, navbar selectors — all present in `lib/render.js`/`lib/components/navbar.js`.
- **Inline rationale (sampled) — clean** except Finding 6. `lib/dispatch-terminal.js`, `lib/recommend-recurse.js`, and the prompt-system seams (`lib/prompt-formatters.js`, `lib/prompt-templates.js`, `lib/openrouter.js`) carry accurate WHY-rationale matching the code beside them.
- **CLAUDE.md dispatch/proxy endpoint *summaries* — clean.** The bullet lists at CLAUDE.md correctly defer the full catalog to the integration guides; the summarized paths exist.

---

## Follow-ups minted this run (top-3 by severity; default state)

1. **Sync the consumer wire contracts with the served instructions + code** — `docs/proxy-integration.md` (`kind`, `followUpTo`, `/autopilot/manual`, 504) + `docs/dispatch-integration.md` (`local` target, terminal-marker completion convention, `repo` field, per-IP rate limit, `kind`-list source, timing-safe phrasing). Findings 1 + 2 + 7. **High.**
2. **Refresh the CLAUDE.md source-tree map + env vars** — `foreman-store.js`→`agent-status-store.js` rename, the undocumented GitHub provider, the task-chat + styleguide views, ~9 unmapped `lib/` modules, and the `FREE_TIER_*` env vars. Findings 4 + 5. **Medium-high.**
3. **Fix `public/llms.txt` drift** — remove the deleted `code-review` template, correct the free-tier quota 5→20/day. Finding 3. **High (cheap).**

Findings 6, 8, 9 are recorded but **not** promoted (below the bar this cycle); the next run can promote what still matters.

---

## Trend ledger

| finding | severity | delta (baseline) |
|---|---|---|
| `proxy-contract-behind-served-instructions` | high | new (baseline) |
| `dispatch-contract-target-and-terminal-markers` | high | new (baseline) |
| `llms-txt-removed-template-and-stale-quota` | high | new (baseline) |
| `claude-md-source-tree-map-drift` | medium-high | new (baseline) |
| `claude-md-missing-free-tier-env-vars` | medium | new (baseline) |
| `periodicals-stale-rationale-counts` | medium | new (baseline) |
| `proxy-504-undocumented-both-references` | medium | new (baseline) |
| `claude-md-components-undercount` | low (informational) | new (baseline) |
| `readme-omits-view-tiers` | low | new (baseline) |
| auth-routes | — | clean |
| linear-cli-catalog | — | clean |
| proxy-scopes-and-error-envelopes | — | clean |
| dispatch-core-contract | — | clean |
| llms-txt-dom-selectors | — | clean |
| inline-rationale-sampled | — | clean |

*Run at HEAD `238b7b9`. Next run: re-ground every row against HEAD and mark `unchanged` / `improved` / `worsened` / `resolved` / `new`. The three promoted follow-ups should resolve rows 1–4 + 5 if landed.*
