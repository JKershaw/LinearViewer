# Test Coverage Gap Review — 2026-06-25 (BASELINE)

*Advisory, review-only. Periodical: **Test Coverage Gap Review**; review task: LIN-672. This report
mints product-code changes for nobody — it produces a severity-ranked, uncovered-line audit of the
high-cost paths and hands the actionable items forward as a small set of bounded follow-up tasks.*

**Grounding:** audited at HEAD = `8de7da5` (LIN-666 merge, 2026-06-25). Every finding is grounded
against current source at HEAD and cited to `file:line` from a fresh read, not to prior prose or the
ticket's description.

**Baseline confirmation:** at minting time **no** `test-coverage-*` / `coverage-gap-*` report existed
in `docs/reviews/` or `docs/` (`ls docs/reviews/` → no match). This is therefore the **baseline** run
under this periodical; the trend ledger at the bottom is what the next run diffs against.

**Method.** Objective ground truth is Node's built-in coverage (no new dependency):

```
node --test --experimental-test-coverage tests/unit/*.test.js
```

Suite result at HEAD: **2430 unit tests, 0 fail**; overall line coverage **82.80%**, branch
**79.18%**, function **84.30%**. Gaps below are weighted by *defect cost in this codebase*
(auth/token, money/rate-limit, error/failure, data-integrity), **not** by raw percentage. Two
grounding traps were handled explicitly:

- **Trap 1 — zero-coverage modules are absent from the table, not shown as a 0% row.** The two
  headline findings (`free-tier-store.js`, `dispatch-tokens.js`) are *missing entirely* from the
  coverage table — confirmed against the source tree. A high-cost module missing from the table is a
  stronger signal than a low percentage. (`tests/unit/periodicals.test.js` string-matches both names,
  but the coverage table confirms **zero executed lines** in either module — the match is incidental,
  not real exercise.)
- **Trap 2 — unit coverage undercounts route/render modules driven through Playwright E2E.** Low
  unit-percentages on `routes/proxy.js` (41%), `routes/auth.js` (25%), `routes/workspace-api.js`
  (32%) are **not** treated as gaps on percentage alone — those are exercised through the browser
  suite (`tests/e2e/`). Findings are confined to logic that a unit-only run can and should assert.

**Anti-coverage-theater.** Every proposed test below asserts a **behavioral** outcome — a return
value, a thrown error, or an observable store mutation. No assertion-free or test-the-mock tests, and
no "raise the percentage" make-work. Where a finding names a concrete defect, the test is the one that
would catch it.

---

## Headline

The highest-cost gap is not a low number — it is a **live, shipped defect that zero unit coverage
allowed to exist**: the free-tier **global hourly rate limit (50/hour across all workspaces) is never
enforced** because `tryUse()` increments a double-prefixed Mongo `_id` that the enforcing read never
looks at (Finding 1). That single module sits on the money/abuse boundary and has **no unit test at
all**. The other two promoted findings are the dispatch consumer-auth token store (Finding 2, zero
coverage on an auth boundary) and the Observation-feed grouping logic (Finding 3, data-integrity
aggregation, entirely untested). Everything else found is recorded below the fold and **not**
promoted — the queue is better served by three real fixes than by a swamp of percentage chasing.

---

### 1. `free-tier-global-hourly-cap-unenforced` — **Critical** — *new (baseline)*

**Module:** `lib/free-tier-store.js` — **0% unit coverage (absent from the coverage table).**
**Boundary:** money / rate-limit / abuse prevention.

`tryUse()` is the production enforcement path (called at `routes/proxy.js:2674` and
`routes/next-run.js:166`; `recordUsage()` is test-helper-only and is not on any request path). Inside
`tryUse()`:

- The **read** that enforces the global hourly cap uses key `hourKey = `global:${this._getHourKey()}``
  → `global:2026-06-25T11` (`lib/free-tier-store.js:148-149`).
- The **write** that increments the global hourly counter uses `globalId = `global:${hourKey}`` →
  `global:global:2026-06-25T11` (**double `global:` prefix**, `lib/free-tier-store.js:197-198`).

The increment lands on a key the read never inspects, so the read at line 149 sees count `0` on every
request. **The global hourly limit therefore never trips** — only the per-workspace daily counter
(which uses the un-prefixed `docId`, lines 163-177) actually works. `canUse()` (the read-only status
endpoint) reads the same single-prefix key, so the UI also always reports the hourly pool as healthy.

**Realistic defect already shipped:** the documented "Global hourly limit: 50 prompts across all
workspaces" protection (CLAUDE.md) is inoperative. A single free-tier key can be drained well past 50
prompts/hour across workspaces, spending real OpenRouter money the cap exists to bound.

**Behavioral tests that would catch it (and would have):**
- Seed a mock collection; call `tryUse()` `hourlyLimit + 1` times across *several distinct* `urlKey`s
  (each under its own daily limit); assert the `(hourlyLimit+1)`th returns
  `{ allowed: false, reason: 'Service busy, try again later' }`. **Fails today.**
- Per-workspace daily rollback: call `tryUse()` `dailyLimit + 1` times for one workspace; assert the
  last is denied with `'Daily limit reached…'` **and** the stored `count` is exactly `dailyLimit`
  (the over-increment was rolled back, lines 182-194).
- Fail-closed: make `collection.findOne` throw; assert `tryUse()` resolves
  `{ allowed: false, reason: 'Unable to verify usage limits…' }` rather than rejecting (lines 219-223).

> **Scope note (review-only):** the key-prefix bug is named here as the *defect the missing test would
> catch*. Fixing it is the follow-up task's job, not this review's. The minimal fix is to increment the
> same key the read uses — but that decision belongs to the fix task with its test.

---

### 2. `dispatch-token-store-untested-auth-boundary` — **High** — *new (baseline)*

**Module:** `lib/dispatch-tokens.js` — **0% unit coverage (absent from the coverage table).**
**Boundary:** auth / token — dispatch consumer authentication.

This store mints and validates the Bearer tokens that external consumers use to drain a workspace's
dispatch queue (`createToken`, `validateToken`, `revokeToken`). The logic reads correct at HEAD, but
**no unit test exercises it**, so a regression on the isolation invariants would ship silently:

- `validateToken(token)` hashes then looks up by `tokenHash` and returns `{ urlKey, label }`
  (`lib/dispatch-tokens.js:85-117`). A change that returned the wrong workspace's `urlKey`, or matched
  on something other than the hash, would cross workspace boundaries undetected.
- `revokeToken(urlKey, tokenId)` deletes only on `{ _id: tokenId, urlKey }` (lines 153-168) — the
  `urlKey` in the filter is the **cross-workspace-revocation guard**. Dropping it would let any
  workspace revoke any token, with no test to notice.

**Behavioral tests that would catch a regression:**
- `createToken` → `validateToken(plain)` returns the same `urlKey`/`label`; a tampered or unknown
  token returns `null`; empty/`undefined` token returns `null` (lines 86-88).
- Round-trip isolation: a token minted for workspace A does **not** validate to workspace B's `urlKey`.
- `revokeToken('workspace-B', idFromA)` returns `false` and leaves the token valid; `revokeToken` with
  the matching `urlKey` returns `true` and subsequent `validateToken` returns `null`.
- `listTokens` returns metadata only and **never** the `tokenHash` (lines 134-139).

---

### 3. `agent-status-grouping-untested-data-integrity` — **High** — *new (baseline)*

**Module:** `lib/agent-status-store.js` — 63% line / 61% function. Uncovered: `listSessions`
(207-265) and `listTaskThreads` (277-330) are **entirely** untested.
**Boundary:** data-integrity — these two reducers power the first-class Observation page's
session/task grouping.

Both methods fold the append-only status log into grouped views with non-trivial, edge-case-laden
logic that is pure enough to unit-test directly:

- `listSessions` groups by `tokenId`, rolls `tokenId`-less entries into a synthetic
  `__unattributed__` session, tracks `firstSeen`/`lastSeen` via min/max, **refreshes the label from
  the most recent entry** (handles a token rename, line 242), and sorts by `lastSeen` desc.
- `listTaskThreads` groups by `taskIdentifier`, supports an optional `tokenId` filter including the
  `'__unattributed__'` special case (lines 286-287), and applies the same first/last-seen bookkeeping.

**Realistic defect:** an off-by-one in the min/max comparison, a broken `__unattributed__` rollup, or
a wrong `lastEntry` selection silently corrupts the Observation feed's session/task grouping — wrong
counts, stale labels, or mis-attributed tasks — with no test to catch it.

**Behavioral tests that would catch it:**
- Mixed entries (two `tokenId`s + some with none) → assert two real sessions plus one
  `__unattributed__`, correct `itemCount`, and `lastSeen` matching the latest timestamp per group.
- Token-rename: two entries, same `tokenId`, differing `tokenLabel`, later timestamp wins → assert the
  session `label` is the newer one (line 242).
- `listTaskThreads({ tokenId: '__unattributed__' })` returns only entries with no `tokenId`; a
  concrete `tokenId` filter excludes other sessions' tasks.
- Sort order: groups are returned `lastSeen` descending.

---

## Recorded, not promoted (next run can promote what still matters)

Real but lower-cost or lower-consequence than the top three. Listed so nothing is lost; **none** were
turned into tasks this cycle (err toward under-creating).

| Module | Coverage | Uncovered (high-value) | Why not promoted |
|---|---|---|---|
| `lib/proxy-tokens.js` | 81.6% line / 54.5% func | `179-180` (single-use race-lost branch), `213-240` listTokens, `261-263` revoke error | **Security core already covered** — expiry (160-162), single-use consumed-check (165-167), atomic consume (173-176), and workspace-scoped revoke happy path (255-259) all have tests in `proxy-tokens.test.js`. Only minor branches/management funcs remain. |
| `lib/proxy-events.js` | 0% (absent) | whole module | Audit/event logging — integrity matters but it is observational, not an enforcement boundary; lower blast radius than 1–3. |
| `lib/proxy-fetch.js` | 37.6% line | `58-69`, `82-177` | Egress-proxy path only active when `HTTP_PROXY` is set; needs an agent harness, awkward to unit-test; low day-to-day blast radius. |
| `lib/llm-call-log.js` | 89.1% line / 80% func | `185-219` (query/aggregation funcs) | Money-*adjacent* (cost reporting, not spend enforcement); core append path is covered. |
| `lib/token-refresh.js` | 93% line | `105-108`, `121-127` (refresh-failure path) | Auth boundary but the failure branch is small; worth a targeted test next cycle if it recurs. |
| `lib/linear-fetch.js` | 95.3% line | `42-44`, `150-157` (retry-exhaustion / timeout branches) | Resilience boundary; happy path + most retries covered; only exhaustion edges remain. |
| `lib/dispatch-store.js` | 83.5% line / 57.6% branch | scattered (122-123, 370-404, 540-549, …) | Append-only data store with substantial coverage already; branch gaps are mostly error/edge paths. |
| `lib/custom-prompts-store.js` | 0% (absent) | whole module | Per-workspace prompt CRUD; low blast radius (no auth/money), exercised indirectly via the prompts E2E. |
| `routes/proxy.js` / `routes/auth.js` / `routes/workspace-api.js` | 41% / 25% / 32% line | many | **Trap 2** — undercounted by unit-only; driven through `tests/e2e/`. Not a gap on percentage alone. |

---

## Follow-up tasks minted (team LIN, default state)

Capped at the top 3 by severity, one per promoted finding:

1. **Finding 1 →** unit-test `lib/free-tier-store.js` `tryUse()` global-hourly enforcement, daily
   rollback, and fail-closed; the global-hourly test exposes the double-prefix key defect at
   `free-tier-store.js:197-198`. *(Highest severity — names a live money/abuse defect.)*
2. **Finding 2 →** unit-test `lib/dispatch-tokens.js` validate/revoke/list with cross-workspace
   isolation assertions.
3. **Finding 3 →** unit-test `lib/agent-status-store.js` `listSessions` / `listTaskThreads` grouping,
   `__unattributed__` rollup, label-refresh, and sort order.

---

## Trend Ledger (stable names — next run diffs against this)

| Stable name | Module | Severity | State |
|---|---|---|---|
| `free-tier-global-hourly-cap-unenforced` | `lib/free-tier-store.js` | Critical | new (baseline) — promoted |
| `dispatch-token-store-untested-auth-boundary` | `lib/dispatch-tokens.js` | High | new (baseline) — promoted |
| `agent-status-grouping-untested-data-integrity` | `lib/agent-status-store.js` | High | new (baseline) — promoted |
| `proxy-tokens-residual-branches` | `lib/proxy-tokens.js` | Low | new — recorded |
| `proxy-events-zero-coverage` | `lib/proxy-events.js` | Medium | new — recorded |
| `proxy-fetch-egress-untested` | `lib/proxy-fetch.js` | Low | new — recorded |
| `llm-call-log-query-funcs` | `lib/llm-call-log.js` | Low | new — recorded |
| `token-refresh-failure-branch` | `lib/token-refresh.js` | Low | new — recorded |
| `linear-fetch-retry-exhaustion` | `lib/linear-fetch.js` | Low | new — recorded |
| `custom-prompts-store-zero-coverage` | `lib/custom-prompts-store.js` | Low | new — recorded |

*Baseline overall coverage for trend tracking: **82.80% line / 79.18% branch / 84.30% function**,
2430 unit tests passing, at HEAD `8de7da5`.*
