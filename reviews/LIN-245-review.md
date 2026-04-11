# Review: LIN-245 — Pipeline: Loop reconstruction library (`lib/pipeline-loops.js`)

**Role**: Code reviewer
**Branch**: `claude/pipeline-loops-library-KCuTT` (merged via PR #235)
**Commit**: `27e9ecf`
**Verdict**: **Approve — ship it.** Implementation faithfully executes the research + plan, test coverage is thorough, and the bonus `dispatchId` plumbing closes the exact-match loop ahead of schedule.

---

## 1. Requirements coverage

Checked against the plan/research in the LIN-245 discussion history:

| Requirement | Status | Location |
|---|---|---|
| Pure `_buildLoops` helper, I/O at a single boundary | ✓ | `lib/pipeline-loops.js:177`, `:338` |
| `getLoopsForIssue(urlKey, id, deps)` public entry | ✓ | `:368` |
| `getLoopsForWorkspace(urlKey, deps)` public entry | ✓ | `:393` |
| Join: exact `dispatchId` when present, else window | ✓ | `:124-157` |
| Window bounds `[dispatchedAt, resolvedAt ?? nextDispatchAt ?? now]` | ✓ | `:256-265` |
| Latest-by-timestamp tie-break inside window | ✓ | `:144-155` |
| `agentState` 8-row truth table, safe fall-through | ✓ | `:69-82` |
| `stage = foremanAction ?? promptName ?? 'unknown'` | ✓ | `:98-100` |
| Per-issue 1-indexed `iteration` spanning live + history | ✓ | `:244-289` |
| 30-day defensive post-filter on `dispatchedAt` | ✓ | `:178`, `:194`, `:215` |
| Malformed-row skip with warn (no crash) | ✓ | `:185-193`, `:206-214` |
| Regression guard: call stores with no `limit` option | ✓ | test `:530-544` |
| Takes/resolvedAt collapse (schema constraint) documented | ✓ | `:293-297` |

No gaps against the plan. Every surface the research called out is represented.

## 2. Correctness checks

- **Live-loop leak prevention** (`tests:378-403`): confirmed — a foreman entry recorded between two back-to-back live loops correctly decorates the earlier one only. The `_upperDate` derivation in `:256-265` uses the next loop's `dispatchedAt` rather than `now`, which is the correct fix.
- **Inclusive window bounds**: `_matchForemanToLoop` uses `<` / `>` for out-of-range checks (`:149-150`), so an entry at exactly `dispatchedAt` or `resolvedAt` is kept. Covered by `tests:214-219`.
- **Same-millisecond determinism**: `loops.sort` falls back to `String(loopId).localeCompare` when timestamps tie (`:247-252`). Covered by `tests:365-376`.
- **Exact-match overrides window** even when the foreman entry is timestamped after `resolvedAt`: `:128-137` short-circuits before the window path, and `tests:221-231` asserts it with an entry outside the window.
- **`agentState` truth table**: all 8 rows are tested individually (`tests:113-149`), plus the unknown free-form status fall-through.
- **Store contract dependency**: the library calls `foremanStore.listStatus(urlKey)` and `dispatchStore.listHistory(urlKey)` without options, relying on both stores' "no limit = everything" contracts. LIN-254 pre-fixed that on the foreman side; `lib/dispatch-store.js:343` confirms the dispatch side was already correct. The regression guard test (`tests:530-544`) pins this contract so a future refactor can't reintroduce silent truncation.
- **Fetch-and-filter strategy**: `_fetchWorkspaceData` pulls the full workspace then `getLoopsForIssue` filters in JS (`:376-378`). For v1 workspace scale this is fine — the surface-assessment in research already acknowledged and accepted the O(n) cost.
- **Error propagation**: `_fetchWorkspaceData` uses `Promise.all` with no `.catch`, so a genuine store throw propagates out. `tests:546-558` documents this contract explicitly. Matches the research recommendation.

## 3. Code quality

- **Separation of concerns**: Pure helpers (`_toDate`, `_deriveAgentState`, `_deriveStage`, `_matchForemanToLoop`, `_buildLoops`) are trivially unit-testable; `_fetchWorkspaceData` is the only function that touches stores. Clean layering.
- **JSDoc**: Every exported and internal function is documented with param/return types and behaviour notes. The truth tables are reproduced in the source as ASCII tables, which is exactly right for something this cross-cutting.
- **Internal test hook**: `__internal` export is clearly marked "not part of the public contract" (`:403-405`). Appropriate escape hatch.
- **Null-handling discipline**: `_toDate` returns `null` rather than throwing on any bad input. Every consumer checks and handles the `null` case. Belt-and-braces but cheap.
- **No new dependencies**: pure JS, no imports beyond the injected store shapes. Matches CLAUDE.md "no frameworks, no build step".
- **Style**: ES modules, 2-space indent, single quotes, semicolons — consistent with repo conventions.

## 4. Test coverage (54 tests, 100% green; full suite 583/583)

Broken down:

- `_toDate` — 5 tests, covers Date passthrough, ISO parse, null/undefined, and both invalid-input paths.
- `_deriveAgentState` — 8 tests, one per row of the truth table plus the free-form fall-through.
- `_deriveStage` — 4 tests, including the empty-string fall-through that `||` catches but `??` would not.
- `_matchForemanToLoop` — 10 tests, covering empty/null input, single in-window, multi-entry latest-wins, out-of-window rejection, inclusive bounds, exact-match override (both single and multiple), and mismatched-dispatchId fall-through.
- `_buildLoops` — 15 fixture scenarios: empty inputs, single live, shuffled history, mixed live+history, completed/expired/cancelled agent state, multi-issue iteration independence, 30-day filter, malformed rows (both shapes), same-ms tie-break, live-to-live foreman leak prevention, exact-match override end-to-end, feedback passthrough, `takenAt`/`resolvedAt` collapse.
- `getLoopsForIssue` / `getLoopsForWorkspace` — 12 tests: missing args, missing-store rejection, issue filtering, empty results, regression guard for no-`limit` contract on both stores, error propagation, empty containers.

**What's covered**: every branch I can see in the library.

**What's not covered** (defensible omissions):
- Behaviour when `_fetchWorkspaceData` receives a store that returns `undefined` rather than an array/container — the defensive `Array.isArray(...) ? ... : []` coercion handles this silently, and the "handles stores that return empty containers" test is adjacent. Not worth a dedicated case.
- Interaction with the live `dispatch-store` / `foreman-store` classes — appropriately deferred to integration/E2E tests in LIN-246 and downstream route tasks. The unit-test boundary is correctly drawn at the injected interfaces.

## 5. Bonus scope: `dispatchId` plumbing in `routes/dispatch.js`

The implementer opportunistically closed the v1 `dispatchId` plumbing gap so the exact-match join branch can light up immediately instead of waiting for a future consumer update:

- `routes/dispatch.js:488` — `POST /api/dispatch/take/:itemId` now returns `{ item, dispatchId: item.id }`. Purely additive — existing consumers destructuring `{ item }` are unaffected. Confirmed by the existing E2E suite passing.
- `docs/dispatch-integration.md` — new "Forwarding `dispatchId` to foreman status" section with a worked Node.js example showing the `take → process → foreman/status` flow threading the field through. The polling-loop template in the same doc is also updated to pass `dispatchId` into `processPrompt()`.

This is within the spirit of LIN-245 (it makes the exact-match branch actually fire) and doesn't touch any store-layer code. Good call to bundle it.

## 6. Observations / nits (non-blocking)

1. **Redundant filter pass in `getLoopsForIssue`** (`:376-378`): the public entry filters `foreman` by `taskIdentifier`, then `_buildLoops` re-groups by `issueIdentifier` into `foremanByIssue` (`:234-240`) and pulls the same slice back out. Functionally identical, just two passes instead of one. Not worth changing — negligible cost on any realistic workspace, and the symmetry between the two public entries is valuable.

2. **`_fetchWorkspaceData` JSDoc vs. behaviour** (`:328-332`): the comment says "Stores already swallow internal errors and return empty arrays, so this function only needs to handle the structural unwrap. Total failure (e.g., DB unreachable for all three) is allowed to propagate." The `tests:546-558` case demonstrates that any single store's reject propagates, not just total failure. Minor doc polish — the code is correct, the comment could be tightened. Consider on the next touch.

3. **`_deriveAgentState` silently converts unknown `historyStatus` values to running via foreman-decorated path**: if `dispatch-store._archiveItem` ever grows a new status value beyond `'taken' | 'expired' | 'cancelled'`, the new value would fall through to the foreman-decorated branch and quietly be reported as `running` (or whatever foreman says). Today the archiver only writes those three values, so this is theoretical, but a defensive `default → 'running'` comment at `:75` would lower the bus factor.

4. **`foremanForIssue` reuse**: `_matchForemanToLoop` is called once per loop with the same `foremanForIssue` array (`:269-272`). For a task with 20 loops and 100 foreman entries this is O(loops × foreman) — still cheap but worth remembering if a later profile shows hot spots. Trivially fixable by sorting once and using binary search, but premature for v1.

5. **`now = new Date()` default in `_buildLoops`** (`:177`): when tests forget to inject `now`, the library reads wall clock. Not a bug (tests do inject it), but worth being aware of for future callers — LIN-246 should thread a consistent `now` through its snapshot builder to avoid off-by-tick drift between the 30d cutoff and the upper-bound derivation.

None of these are defects. Leaving them as-is is a legitimate choice.

## 7. Integration readiness for LIN-246 (snapshot state builder)

The library hands LIN-246 everything it needs:

- Both public entries take an injected `{ dispatchStore, foremanStore }`, so the snapshot builder can share a single `_fetchWorkspaceData` call across many issues — the library's own `getLoopsForIssue` isn't the right shape for a batched snapshot pass, but the exported `__internal._buildLoops` (or a new public `buildLoopsFromRaw`) would let the snapshot builder fetch once and reuse. Worth considering whether `_buildLoops` should be promoted to the public API when LIN-246 lands, or whether a thin `getLoopsFromPreloaded({ live, history, foreman })` wrapper is cleaner. Not a change for this issue — just flagging for the next ticket.
- `Loop` records already include every field the Pipeline Task rollup needs (`currentStage`, `agentState`, `iteration`, `lastActivityAt` can be derived from `dispatchedAt` / `resolvedAt` / `foremanTimestamp` / latest `feedback.timestamp`).
- 30-day lookback and expired-foreman cleanup are handled at the library level, so the snapshot builder won't need to re-implement them.

## 8. Foreman status

```
action:  review
status:  completed
summary: LIN-245 approved. Implementation matches the research + plan exactly;
         54/54 library unit tests pass, full suite 583/583 green. Join logic
         (exact + window), agentState truth table, per-issue 1-indexed
         iteration, 30-day defensive filter, and malformed-row handling are
         all correct and well-tested. Bonus dispatchId plumbing in
         routes/dispatch.js + docs/dispatch-integration.md closes the v1
         exact-match join gap without touching store internals. Five minor
         non-blocking observations logged in the review (doc polish,
         defensive comments, potential _buildLoops promotion for LIN-246).
         Ready for LIN-246 to consume.
```
