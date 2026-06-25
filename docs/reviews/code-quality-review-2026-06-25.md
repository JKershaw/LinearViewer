# Code Quality Review — 2026-06-25 (LIN-667)

**Altitude.** Code-level **complexity, duplication, and maintainability cost** at HEAD
(`d9c51da`). This is *not* doc drift (Documentation Review owns that), *not*
dependency-direction/canonical-module drift (Drift & Coherence), *not* interface shape
(Design & Interface), *not* reader comprehension (Comprehension-Debt). Where this review
would overlap a sibling, it defers and says so.

**Method.** Reasoned from the source and lightweight built-in signals — file/function
length, nesting depth, fan-out, and `git log` churn (90-day window) — calibrated against
this repo's own well-factored modules (`lib/tree.js`, `lib/graph-features.js`,
`lib/recommendation-facts.js`, `lib/recommend-recurse.js`, the provider adapters), not an
external rulebook or a metrics tool. No new tooling introduced. Each finding names a
concrete maintainability cost (where a change is risky or a bug is likely) weighted by
risk × churn; aesthetic-only observations are excluded by design.

**Baseline note.** There is no prior committed `code-quality-review-*` report — this is the
(re-)baseline. LIN-655 (Canceled) never landed one; LIN-359/360 predate the convention.
The old `docs/code-health-review-LIN-19.md` is stale (it sizes `server.js` at 810 lines;
HEAD is 2088). Its findings were re-checked against HEAD and are noted inline where they
recurred or migrated.

---

## Risk × churn map (90-day churn, current LOC)

| File | LOC | 90-day commits | Note |
|------|-----|----------------|------|
| `routes/proxy.js` | 4497 | 85 | busiest file in the tree; single closure |
| `server.js` | 2088 | 68 | route + middleware host |
| `routes/workspace-api.js` | 3019 | 55 | second single mega-closure |
| `lib/prompts/meta-prompt-template.js` | 332 | 45 | high churn, modest size (healthy) |
| `lib/render.js` | 928 | 28 | renderer |

The two route mega-files are simultaneously the **largest** and the **most-churned**
non-test source in the repo — the highest risk × churn quadrant. Findings are ranked with
that weighting.

---

## Findings (severity-ranked)

### F1 — `routes/proxy.js` is a 4497-line single closure carrying ~40 endpoints — **HIGH** (complexity / maintainability)
**Location:** `routes/proxy.js` — `createProxyRoutes({...})` at `:573`, `return router` at
`:4496`. ~40 `router.*` handlers and 14 injected dependencies live in one lexical scope.
**Class:** complexity / maintainability.
**Concrete cost:** This is the single busiest file in the repo (85 commits/90 days) and the
largest. Every change — a new endpoint, a tweak to one handler — means navigating and
re-reading a 4500-line function whose handlers all close over the same 14-dep scope, so
nothing is unit-testable in isolation (you must construct the whole closure). Merge
conflicts concentrate here precisely because churn is concentrated here. The handlers also
span three distinct concerns that already group cleanly in the integration docs — **read**
(me/teams/projects/issues/search/relations/cycles/labels/attachments), **write**
(`requireWriteScope` create/update/comment/relation/label), and **task-automation**
(stack/prompt/recommend/recap/brief/status/kickoff/dispatch).
**Risk × churn:** highest in the repo.
**Call (explicitly deferred to this review by `recent-headwinds-review-2026-06-18.md` H2):**
Yes — this file warrants a structural split. Suggested minimal direction: extract the three
endpoint groups into sibling modules (e.g. `routes/proxy/read.js`, `.../write.js`,
`.../tasks.js`) that receive the shared deps + helpers (`logEvent`, `authenticateProxyToken`,
`armKeepalive`, the error helpers) from a small `createProxyRoutes` composer that mounts
them on one router. This is mechanical relocation, not a behavior change; the wire contract
and tests are unaffected. Promoted as a follow-up (see F1 task), naming F3 as its sibling.

### F2 — recap/brief route orchestration duplicated 4× in `proxy.js` (and paralleled 4× in `workspace-api.js`) — **MEDIUM-HIGH** (duplication)
**Location:** `routes/proxy.js` recap GET `:3028`, recap POST `:3172`, brief GET `:3301`,
brief POST `:3444`; paralleled in `routes/workspace-api.js` recap GET `:1442`, recap POST
`:1502`, brief GET `:1668`, brief POST `:1728`.
**Class:** duplication (a single rule implemented in many places that can drift —
distinct from coincidental similarity).
**Evidence:** The four `proxy.js` handlers are near-identical line-for-line for ~33 lines
of preamble (access resolution → cache-store-configured guard → `isValidIssueId` →
`noRefresh` parse → `isTestMode` → `armKeepalive` → mock-context branch → generate → cache
→ respond); only the noun (`recap`/`brief`) and the cache store change. The recap.js and
brief.js *libraries* are deliberately mirrored (CLAUDE.md says so) — that is **not** the
finding. The finding is that the **route-level orchestration** of the cache-and-generate
dance is copy-pasted, and it has **already begun to diverge**: the proxy copies resolve a
per-workspace token via `resolveWorkspaceAccess`, while the workspace-api copies read
`req.workspace.accessToken` from the session, and the two families guard slightly
differently. A change to the shared semantics (cache key, `noRefresh` contract, the
H12 keepalive guard, test-mode mocking) must be made in up to 8 places and is easy to
apply to some and miss in others.
**Concrete cost:** correctness drift across endpoints that are supposed to behave
identically; the per-endpoint divergence is exactly the bug class that hides until one
surface is touched.
**Risk × churn:** medium-high — both host files are top-3 churn.
**Direction:** factor a single `cacheBackedGenerate({ store, generate, buildContext,
isTestMode, keepalive })` helper that both route families call; keep the recap/brief libs
as-is. Start with the tightest, same-auth set (the 4 `proxy.js` copies). Promoted as a
follow-up (see F2 task).

### F3 — `routes/workspace-api.js` is a 3019-line single closure — **MEDIUM** (complexity / maintainability)
**Location:** `routes/workspace-api.js` — `createWorkspaceApiRoutes({...})` at `:254`,
spanning ~33 handlers (prompts, recommend, recap/brief, roadmap generate/chat, feedback,
images, custom prompts).
**Class:** same structural class as F1 — named here as the **sibling instance** so the
class is recorded, not re-promoted on its own. The roadmap-generate (`:2767`) and
roadmap-chat (`:2938`) handlers and the streaming recommend (`:916`) are its heaviest
sub-units.
**Concrete cost:** identical to F1 (one un-decomposable scope, no isolated handler tests),
at lower churn. **Not promoted** — folding it into the F1 split task's scope note is
deliberate: do one route-file split well first, then apply the same recipe here.

### F4 — roadmap page route has no test-mode mock arm; committed visual baselines are misleading — **MEDIUM** (maintainability / test quality)
**Location:** `server.js:1457` (`GET /workspace/:urlKey/roadmap`). It calls
`getProviderForWorkspace(workspace).fetchProjects(getWorkspaceToken(workspace), teamId)`
with no `test-token`/local-provider branch (compare the dashboard/main route, which has
mock handling). Under the Linear provider a `test-token` 401s →
`handleUnauthorizedError` → redirect, so the page never renders in visual tests.
**Class:** maintainability / test quality (explicitly handed to Code Quality by
`design-interface-review-2026-06-20.md` and `-lin568.md`).
**Concrete cost:** the committed `tests/screenshots/pages/roadmap-*.png` baselines capture
the **landing page**, not the roadmap, so the visual-regression suite gives *false
confidence* — a real roadmap regression would pass. This is the worst kind of test gap:
green where it should be red.
**Direction:** route the roadmap page through the local-provider seeding harness in test
(`tests/fixtures/local-harness.js`, the seam `pipeline` already uses), then regenerate the
baselines. Promoted as a follow-up (see F4 task).

### F5 — oversized multi-responsibility handlers in `proxy.js` — **MEDIUM** (complexity)
**Location:** `routes/proxy.js` recommend-and-dispatch `:4024` (297 lines, ~56 control-flow
tokens), prompt `:2612` (237 lines), stack `:2439` (173 lines).
**Class:** complexity. Each handler interleaves access resolution, input validation,
test-mode mock branches, LLM/recommend calls, dispatch writes, and bespoke error mapping in
one body, several levels deep.
**Concrete cost:** these are the most bug-prone change sites in the hottest file — a future
edit must hold ~300 lines of branching in working memory. The repo already prefers small
pure helpers split from I/O (`lib/recommendation-facts.js`, `lib/recommend-recurse.js`);
these handlers predate/ignore that pattern.
**Direction:** extract pure context-assembly and response-shaping helpers (no behavior
change), mirroring the house style. **Not promoted** as its own task — it is best done
*inside* the F1 split (moving a handler is the natural moment to decompose it), so it is
recorded here and referenced from the F1 task scope rather than queued separately.

---

## Recorded but not promoted (lower severity / owned elsewhere)

- **N1 — `/api/proxy/instructions` is a ~404-line inline endpoint-catalog string**
  (`routes/proxy.js:1004`–`1408`). The catalog restates the consumer wire contract that
  also lives in `docs/proxy-integration.md`; the two can drift. **Severity low; owned by
  the Documentation Review** (contract-vs-doc drift is its altitude). Recorded so the next
  run can promote it if the docs/string pair is observed drifting.
- **N2 — `DISPATCH_KINDS` "hard-coded vocabulary" (from the Documentation Review).**
  Re-checked at HEAD: in *code* it is **already generated** —
  `lib/prompt-templates.js:181` derives it from `Object.keys(PROMPT_TEMPLATES)` + meta
  kinds, and `routes/dispatch.js:213` interpolates `DISPATCH_KINDS.join(', ')`. The only
  hard-coding is in `docs/dispatch-integration.md`. **No code finding; owned by
  Documentation Review.** Listed to close the loop, not as work for this stream.

## Deliberately NOT re-flagged (owned by sibling reviews)

Per the dedup pass against the sibling reports, the following are **already owned** and are
not re-reported here: client-helper duplication (`escapeHtml`/`relativeTime`/
`renderMarkdown`/`stripCodeBlockWrapper`/fetch-idiom) and the `lib/errors.js` inline-4xx
envelope fragmentation, the `provider-resolution-incantation`, the `lib/linear-cli.js`
GraphQL parallelism, the `lib/providers/linear/index.js → routes/auth.js` upward import,
and the semicolon-style split — all owned by **Drift & Coherence**
(`drift-coherence-review-2026-06-11.md`, use its corrected counts). The
`lib/proxy-dedupe.js` NUL separator and the `primary*BIG+secondary` composite-sort-key
invariant are owned by **Comprehension-Debt** (`comprehension-debt-review-2026-06-12.md`).

## Calibration — areas judged healthy (no finding)

`lib/periodicals.js`'s eleven intentionally un-DRY prompt scaffolds (header documents the
choice — coincidental resemblance, not a drift-prone single rule). The pure `lib/` helpers
used as the calibration reference remain small, single-responsibility, and well-commented.
The `*-store.js` family is uniform. No import cycles. A clean result in these areas is a
genuine outcome, not an omission.

---

## Follow-up tasks minted (cap: top ~3 by severity)

1. **F1 → split `routes/proxy.js` by endpoint group** (read / write / task-automation),
   folding in F3 (`workspace-api.js`, as a sibling to apply the same recipe to next) and
   F5 (decompose the oversized handlers as they move). Mechanical, behavior-preserving.
2. **F2 → factor a shared `cacheBackedGenerate` helper** for the recap/brief route
   orchestration; collapse the 4 `proxy.js` copies first, then the `workspace-api.js`
   parallel.
3. **F4 → add a test-mode/local-provider mock arm to the roadmap page route** and
   regenerate the misleading visual baselines.

All other findings (F3, F5, N1, N2) are recorded above and intentionally left unqueued so a
future run can promote them if they rise in severity or begin to drift.
