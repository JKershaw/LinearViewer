# LIN-385 — Migrate remaining mock-backed E2E specs onto the local provider; retire orphaned `testMockData` branches

**Role:** technical planner. **Status:** plan (no implementation). Follow-on to **LIN-378** (PRs #389/#391) which landed the reusable harness `tests/fixtures/local-harness.js` and migrated dashboard / swim / ship / interactions.

## Staleness check (re-grounded at HEAD `49364ae`)

Ticket created 2026-06-10; `git log --since="2026-06-10" -- server.js routes/{pipeline,proxy,workspace-api,test}.js tests/fixtures/{local-harness,mock-data}.js` shows **no commits after the LIN-378 merges** that the ticket already accounts for. The harness header at HEAD enumerates the exact same remaining `testMockData` consumers the ticket names. **Ticket is not stale** — its description matches the code.

## What the local provider actually models (capability floor)

From `lib/providers/local/index.js`: `fetchProjects`, `fetchProjectsList`, `fetchIssueContext`, `fetchIssueComments`, `search`, `states`, `labels`, plus all writes (`createIssue/updateIssue/createComment/createRelation/add|removeLabel`). `ui = { write, comments, subtasks, estimates:false, displayName:'Local' }`. **Off:** teams (`fetchTeams`→[]), estimates, cycles. The seeding route (`/test/set-local-session`, POST) already accepts custom `{projects, issues}` **and** a whitelist-validated `features` object — but **not** `freeTierEnabled` / `openRouterConnected` / multi-workspace, and it seeds a **single** workspace.

## The four mock sites and their deletion gates (cross-cutting)

| Site | Serves | Deletable when… |
|------|--------|-----------------|
| `server.js` dashboard (`459`, `1155`, `1309`) | **every** authed-page render (navbar/footer too) | **all** candidate specs below migrate — the long pole, falls **last** |
| `routes/pipeline.js:55` (`fetchProjects = testMockData`) | `/pipeline` page only | `{pipeline, pipeline-scenarios}` migrate |
| `routes/workspace-api.js` (~20 `testMockData` sites) | recap / brief / recommend / audit / comments / images / prompt endpoints | recap+brief+recommend+streaming+audit+prompts+custom-prompts+workspace-model(UI) migrate |
| `routes/proxy.js:37-43` | Linear API proxy contract | **never (boundary)** — keeps `mock-data.js` alive |

**Corollary:** `tests/fixtures/mock-data.js` and the `swimSample`/`shipSample` flags + `swim-sample-data.js` / `ship-dense-sample-data.js` are pinned by `proxy.spec` (boundary) **and** `tests/visual/*` (byte-stable screenshots). They are **not fully retireable** — only the three migratable *branches* above get deleted; the fixture file stays. The harness header should be updated to record this as the final boundary.

## Strategy framing (cost-of-doing-now vs cost-of-not)

Doing it: removes a load-bearing `test-token` invariant threaded through 4 files, decouples E2E from Linear's GraphQL shape, and exercises the genuine provider read seam (the original local-first rationale). Not doing it: the mock stays indefinitely, every new spec re-picks mock-vs-local, and the abstraction's seams stay unexercised. As a convergence follow-on, **default is to close the gap** unless a surface genuinely needs un-modeled capabilities.

Cheaper routes that route around a gap (gap named per the planning rule):
- **free-tier** — keeping it on `test-token` routes around *"`set-local-session` doesn't pass `freeTierEnabled`/`openRouterConnected`"*. Gap **not separately tracked → none identified**; it is in-scope harness work here. **Close it** (cheap: a few session flags) so the dashboard branch can die.
- **workspace** multi-workspace switching/removal/limit routes around *"the local harness seeds a single workspace."* Gap **not tracked → none identified**, but the surface is **session/workspace management, not Linear data**, adjacent to the excluded OAuth/PAT bootstrap. **Route around** (keep on `test-token`) and extend the harness boundary list — matches the ticket's "leave on test-token where the provider doesn't model it."
- **teams** (error-handling team filtering) — local declares teams off; that's the tracked **LIN-178 / LIN-275** epic. Stays.

## Scope assessment (every `set-session` spec classified)

**A — Migrate; fully modeled (default seed, or custom seed where assertions need specific data).** `*` = also mocks OpenRouter — that AI mock stays, only the Linear-data layer migrates.

| Spec | Seed | Notes |
|------|------|-------|
| `search` | custom | `LocalProvider.search()` exists; seed searchable titles |
| `swipe` | default/custom | plain issues/tree (its "pipeline" mention is a comment, not a `/pipeline` load) |
| `settings` | default + `features` | workspace + AI-status surface |
| `prompts`*, `prompts-page`, `custom-prompts` | custom | prompt catalog/generation reads issue context; custom store is its own |
| `brief`, `recap` | custom | `fetchIssueContext`; AI handled via cache / existing mock |
| `recommend`/`streaming`* | custom | recommend endpoint; AI mock stays |
| `roadmap`* | custom + `features` | projects/issues + velocity from `completedAt` (modeled); narrative mock stays |
| `audit` | custom | `lib/audit` via provider; seed specific states for findings |
| `periodicals` | default | periodicals registry |
| `dispatch-page` | default | dispatch store is separate; page just needs a real workspace |
| `pipeline`*, `pipeline-scenarios`* | custom | only true `pipeline.js:55` consumers |
| `feature-toggles`, `workspace-features` | default + `features` | `features` path already supported |
| `foreman` | custom *(verify)* | foreman-store + provider stack; confirm no proxy/stack-only coupling |
| `landing-swim`, `landing-swipe` | n/a | unauthenticated (render `landing.md`); only the "authed user redirected" test needs a session → swap to `seedLocalWorkspace` |

**B — Migrate after a named harness extension.** `free-tier` — extend `set-local-session` to accept `freeTierEnabled` / `openRouterConnected` (close the gap).

**C — Partial; the bulk stays on `test-token`.**
- `error-handling` — *Session State* + input-validation can migrate; **Team Filtering** (teams off) and **OAuth Error Handling** (auth boundary) stay. Net: mostly stays; optional split.
- `workspace` — only "single workspace shows in selector" migrates; **multi-workspace** switch/remove/limit stay (route-around).
- `workspace-model` — **UI-path** test (dashboard recap uses seeded model) migrates; the **Proxy-path** test rides the proxy contract → stays.

**D — Excluded (boundary, unchanged from LIN-378).** `auth`, `pat-auth`, `openrouter-auth` (OAuth/PAT); `proxy`, `proxy-toggle-copy` (proxy contract); `tests/visual/*` (screenshot stability).

## Cross-cutting concerns

1. **`server.js` dashboard branch is the long pole** — nearly every candidate renders navbar/footer, so it can only be deleted after the *union* of migrations. Don't attempt its deletion early.
2. **Shared `features` session path** (`set-local-session` whitelist) backs feature-toggles / workspace-features / settings / roadmap / ship-orientation(done). Re-seed per `beforeEach` (`workers:1`, shared `local-workspace` partition — safe per ticket note).
3. **Shared `workspace-api` block** must stay until its *whole* endpoint cluster migrates; migrating one endpoint-spec doesn't unlock deletion.
4. **OpenRouter mocking is orthogonal** — migration swaps only the Linear-data layer; `page.route('**/openrouter**')` mocks are untouched (prompts/streaming/roadmap/pipeline/free-tier).
5. **`mock-data.js` + sample flags are co-owned** by the proxy boundary and visual specs → never deleted; only branches are.

## Session-fit answer

**Does not fit one session.** ~26 candidate specs, 4 gated deletions, one long-pole. Break into **4 sessions ordered by deletion gate** (specs *within* a session are independent — `workers:1`, per-`beforeEach` re-seed — so order inside a session is free; only the branch deletion is gated):

```
S1 (pipeline cluster):   migrate pipeline, pipeline-scenarios ─▶ delete routes/pipeline.js:55
S2 (workspace-api cluster): migrate recap, brief, recommend, streaming, audit,
                             prompts, prompts-page, custom-prompts, periodicals,
                             workspace-model(UI-path) ─▶ delete workspace-api.js testMockData block
S3 (light surfaces + gap): migrate search, swipe, settings, feature-toggles,
                             workspace-features, dispatch-page, foreman,
                             landing-swim, landing-swipe;
                             extend set-local-session (freeTierEnabled/openRouterConnected) ─▶ migrate free-tier;
                             resolve workspace(single only) + error-handling(Session-State only) boundary
S4 (long pole):          once S1–S3 union complete ─▶ delete server.js dashboard branches
                             (459/1155/1309); update harness header to the final boundary
                             (proxy + visual keep mock-data.js / sample flags)
```

Dependency arrows: `pipeline.js` deletion ← S1; `workspace-api` deletion ← S2; `server.js` dashboard deletion ← **S1 ∪ S2 ∪ S3** (every authed-page spec); `mock-data.js` retire ← *never* (proxy + visual). S1/S2/S3 are mutually independent and can run in any order or in parallel branches; **S4 strictly last.**

## Out of scope (explicit)

Foreign-schema validation of the abstraction (subtasks/estimates absent, repos-not-teams) is **not** this ticket — it lands with the GitHub/Jira provider epics **LIN-178 / LIN-275**. OAuth/PAT bootstrap, the proxy contract, cycle/team/estimate flows, and `tests/visual/*` remain on `test-token`.
