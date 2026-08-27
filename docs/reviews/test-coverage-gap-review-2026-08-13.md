# Test Coverage Gap Review — 2026-08-13

*Advisory, review-only. Periodical: **Test Coverage Gap Review** (origin LIN-351); review task: LIN-616.
No code, config, or docs outside this report were changed. Findings are handed forward as a small,
bounded set of follow-up tasks.*

**Grounding:** audited at HEAD = `30427bf6` ("LIN-2033: preserve Jira `fetchTeams()` truncated flag",
2026-08-13), clean working tree. Every finding below was re-read from live source at HEAD and is cited
to `file:line`. Nothing is carried forward on the strength of the prior report's prose.

**Prior run:** `docs/reviews/test-coverage-gap-2026-06-25.md` (the baseline, at HEAD `8de7da5`). This is
the **second** run under this periodical, so the ledger at the bottom diffs against that baseline. Note
the filename convention shifted this cycle — the baseline is `test-coverage-gap-<date>.md`, this run is
`test-coverage-gap-review-<date>.md` per LIN-616's instruction. A future run globbing
`docs/reviews/test-coverage-*` finds both.

**Method.** Ground truth is Node's built-in coverage, no new dependency:

```
node --test --experimental-test-coverage tests/unit/*.test.js
```

Suite result at HEAD: **6833 unit tests, 1194 suites, 0 fail** (32.7s). Overall **90.79% line /
82.84% branch / 88.51% function**. Gaps are weighted by *defect cost* (auth/token, money/rate-limit,
error handling, data integrity), never by percentage.

---

## Headline

**The suite got substantially better; the specific gaps this periodical exists to catch did not move.**

Coverage rose from 82.80% → 90.79% line and the test count nearly tripled (2430 → 6833). Of the 91
`lib/`+`routes/` modules added since the baseline, almost all ship at 90–100%, and the new
auth/token/money modules in particular — `lib/owner-credential-store.js` (95.19%),
`lib/workspace-token-resolver.js` (100%), `lib/ownerless-token-policy.js` (100%),
`lib/openrouter-key-resolver.js` (100%), `lib/model-pricing.js` (100%), `lib/task-cost.js` (100%) — are
covered as they land. New code is not the problem.

**All three baseline findings are still open**, and their three follow-up tasks (LIN-689, LIN-690,
LIN-691) have sat in Backlog for seven weeks without being picked up. Worse, re-grounding shows the
baseline mis-scoped one of them: LIN-691's target is **dead code with zero callers** (Finding 4), so
executing that task as written would spend a session testing something that should be deleted.

The highest-cost item is unchanged and unfixed: the free-tier **global hourly cap is still not
enforced**, still has **no test of any kind** (unit *or* E2E), and its blast radius has grown from
2 call sites to **14** (Finding 1). The two genuinely new gaps are both zero-coverage auth boundaries
that landed before the baseline and were never noticed because a module with zero executed lines is
*absent from the coverage table* rather than shown as a 0% row (Findings 2 and 5).

---

## Grounding traps — how each was handled

**Trap 1 — zero-coverage modules are absent from the table, not shown as 0%.** The table's module list
was diffed programmatically against the live `lib/` and `routes/` trees (228 files). **18** are absent
entirely, i.e. zero executed lines under the unit suite:

```
lib/custom-prompts-store.js      lib/render-audit.js            routes/flight-companion.js
lib/free-tier-store.js           lib/render-custom-prompts.js   routes/legacy-redirects.js
lib/harbour-feedback-tokens.js   lib/render-legal.js            routes/next-run.js
lib/session-store.js             lib/render-prompts.js          routes/openrouter-auth.js
lib/render-templates.js          lib/render-proxy.js            routes/passage-planner.js
                                                                routes/ship-journey.js
                                                                routes/test.js
                                                                server.js
```

Three of those are the real findings below (`free-tier-store`, `harbour-feedback-tokens`,
`session-store`). The rest are dispositioned under Trap 2.

**Trap 2 — unit coverage undercounts route/render modules driven through Playwright.** Every absent or
low-percentage route/render module was checked against `tests/e2e/` before being considered. All of the
following have a dedicated E2E spec and are **not** treated as gaps: `routes/next-run.js`
(`next-run.spec.js`), `routes/openrouter-auth.js` (`openrouter-auth.spec.js`), `routes/ship-journey.js`
(`ship-journey.spec.js`), `routes/passage-planner.js` (`passage-planner-proxy-copy.spec.js`),
`routes/flight-companion.js` (`flight-companion-proxy-copy.spec.js`), `lib/render-audit.js`
(`audit.spec.js`), `lib/render-legal.js` (`legal.spec.js`), `lib/render-prompts.js`
(`prompts-page.spec.js`), `lib/render-proxy.js` (`proxy.spec.js`), `lib/render-custom-prompts.js` +
`lib/custom-prompts-store.js` (`custom-prompts.spec.js`). Likewise `routes/ship-biscuit.js` (64.62%
line) has `ship-biscuit.spec.js`, `routes/task-chat.js` (38.99%) has `task-chat.spec.js`, and
`routes/proxy.js` / `routes/auth.js` / `routes/workspace-api.js` (75.61% / 75.70% / 52.17%) are driven
through the browser suite exactly as the baseline noted. **`routes/test.js` and `server.js` are
test-harness and composition-root respectively and are out of scope for a unit-coverage judgement.**

The trap was applied *against* a finding too, not just for it: the free-tier gap (Finding 1) survives
only because `grep -rn "Service busy\|hourlyLimit\|HOURLY_LIMIT" tests/` returns **zero hits across the
whole test tree** — `tests/e2e/free-tier.spec.js` exists and covers the *daily* limit (429 at
`free-tier.spec.js:80-93`) but never the hourly one.

**Trap 3 — full line coverage can hide an unasserted branch or a test that asserts nothing.** A
mechanical scan of all 318 unit test files for `test()` bodies containing no
`assert`/`.throws`/`.rejects`/`expect` flagged 24 candidates; **all 24 were read and all 24 are false
positives** — they delegate to shared assertion helpers (`assertDeclined` at
`tests/unit/proxy-route-internal-read-backstop.test.js:119-125`, `assertCrossCuttingRules` in
`tests/unit/roadmap-pipeline-prompts.test.js`) or the match was a string literal inside a helper.
**No assertion-free unit test was found.** That is a genuine clean result and is recorded as such.

One *test-the-mock* pattern was found, and it is the reason Finding 2 was invisible: see below.

**Measurement validity.** Native unit coverage tracks defect risk well for `lib/` (pure logic and
stores) and poorly for `routes/` (browser-driven). The one thing it does *not* track at all is the
class of module that is absent from the table — which is precisely where 3 of the 5 findings live. The
percentage is therefore not the instrument; the module-list diff and the caller check are. Two findings
below (1 and 5) name defect classes that **no E2E can reach by construction** — one needs a 51st
request inside one clock hour, the other needs a session older than 30 days — so raising the E2E count
would not close them.

---

## Findings (severity-ranked)

### 1. `free-tier-global-hourly-cap-unenforced` — **Critical** — *carried, unchanged, blast radius grew*

**Module:** `lib/free-tier-store.js` — **absent from the coverage table (zero executed lines).**
**Boundary:** money / rate-limit / abuse prevention. **Already ticketed: LIN-689 (Backlog, unstarted).**

Unchanged at HEAD — `git log --since=<LIN-616 creation> -- lib/free-tier-store.js` returns **nothing**;
the file has not been touched since the baseline named it.

The enforcement read and the enforcement write still use different keys:

- Read: `const hourKey = \`global:${this._getHourKey()}\`` → `global:2026-08-13T18`
  (`lib/free-tier-store.js:148`), checked against `this.hourlyLimit` at `:152-160`.
- Write: `const globalId = \`global:${hourKey}\`` → `global:global:2026-08-13T18`
  (`lib/free-tier-store.js:197`) — `hourKey` is *already* prefixed, so this double-prefixes.

The increment lands on a key the read never inspects. `hourCount` at `:150` is therefore `0` on every
request and **the global hourly limit never trips**. `canUse()` reads the same single-prefix key
(`:84-85`), so the status endpoint and the footer also always report the hourly pool as healthy.

Note the asymmetry, which is itself diagnostic: `recordUsage()` — the *test-helper* path — builds the
key correctly from the bare hour (`:238`, `:258`). Only the production path is wrong.

**Blast radius has grown since the baseline.** The baseline cited 2 call sites; at HEAD `tryUse()` is
the spend gate on **14**: `routes/workspace-api.js:792, 813, 1049, 1066, 1663, 1905, 3217, 3702`,
`routes/dashboard.js:1387, 1576`, `routes/next-run.js:196`, `routes/task-chat.js:379`,
`routes/ship-biscuit.js:196`, plus `routes/test.js:745`. Each is an OpenRouter call billed to the
operator's shared free-tier key. The documented "Global hourly limit: 50 prompts across all workspaces"
(CLAUDE.md) is inoperative across all of them.

**No test of any kind exists.** `grep -rn "Service busy\|hourlyLimit\|HOURLY_LIMIT" tests/` → 0 hits.
The only occurrences of `free-tier-store` under `tests/` are a *negative* string assertion in
`tests/unit/periodicals.test.js:298` (incidental — the module is never imported or executed) and a
fixture description in `scripts/eval-review-closeout.mjs:64`, which is an eval harness, not a test.

**Behavioral tests that would catch it (and would have):**
- Seed a mock collection; call `tryUse()` `hourlyLimit + 1` times across *distinct* `urlKey`s (each
  under its own daily limit); assert the `(hourlyLimit+1)`th returns
  `{ allowed: false, reason: 'Service busy, try again later' }`. **Fails today.**
- Daily rollback: call `tryUse()` `dailyLimit + 1` times for one workspace; assert the last is denied
  with `'Daily limit reached…'` **and** the stored `count` is exactly `dailyLimit` (`:182-194`).
- Fail-closed: make `collection.findOne` throw; assert `tryUse()` *resolves*
  `{ allowed: false, reason: 'Unable to verify usage limits…' }` rather than rejecting (`:219-223`).

> **Scope note (review-only):** the key-prefix bug is named as the defect the missing test would catch.
> Fixing it belongs to LIN-689 along with its test, not to this review.

**Disposition:** **not re-minted** — LIN-689 already exists and states exactly this. It has not been
picked up in seven weeks; the growth from 2 → 14 spend paths is new evidence for prioritising it.

---

### 2. `harbour-feedback-token-store-zero-coverage` — **High** — *new*

**Module:** `lib/harbour-feedback-tokens.js` — **absent from the coverage table (zero executed lines).**
**Boundary:** auth / token — the dispatch feedback endpoint's *first* credential check.
**Not previously ticketed.** → **Promoted.**

`HarbourFeedbackTokenStore` mints short-lived, single-use Bearer tokens bound to one dispatch item, so
that a repo-level Claude Code hook can POST feedback without holding a workspace-scoped credential. It
is production-wired: minted at `routes/dispatch.js:571`, and consumed at `routes/dispatch.js:199`
inside `authenticateFeedbackToken` (`routes/dispatch.js:187-212`) — which tries it **before** the
workspace-scoped dispatch token, precisely because it is the more constrained credential. On success
the request is authorised with `req.dispatchUrlKey = result.urlKey` (`:201`).

Three invariants carry that constraint, and **none is executed by any test**:

- **Single-use.** The claim query carries `used: false` (`lib/harbour-feedback-tokens.js:92`) and the
  update flips it in the same atomic `findOneAndUpdate` (`:100-101`). Drop either half and one leaked
  token replays forever.
- **Hard expiry.** `expiresAt: { $gt: now }` (`:93`). Drop it and a 1-hour token never dies —
  `cleanup()` (`:118-126`) only sweeps, it does not gate.
- **Item binding.** `if (expectedItemId) query.itemId = expectedItemId` (`:95-97`) is the anti-replay
  guard the module's own docblock names ("a token leaked from one Harbour OS session cannot be replayed
  against another", `:6-7`). If `expectedItemId` stopped being threaded from `req.params.itemId`, a
  token minted for item A would authorise feedback on item B — silently, with no test to notice.

**Why it was invisible — the one test-the-mock instance found in this review.** The only place any test
touches this seam is `tests/unit/dispatch-wake-credential-provisioning.test.js:144-149`, which injects a
**stub**: `validateAndConsume: async (token, itemId) => …`. That stub is legitimate *for that test* — it
is testing wake behaviour, not the token store — but it means the real store's query is never executed,
while the file name and the passing test both read like the lane is covered. `tests/e2e/dispatch.spec.js`
does exercise `POST /api/dispatch/feedback/:itemId` (`:1789-1804`), but with a **consumer dispatch
token** (`:1792-1797`), i.e. the fallback branch at `routes/dispatch.js:211` — never the harbour branch.
So neither Trap-2 nor the mock rescues this one.

**Behavioral tests that would catch a regression:**
- `mintToken(itemA, wsX)` → `validateAndConsume(token, itemA)` returns `{ urlKey: 'wsX', itemId: itemA }`;
  a **second** call with the same token returns `null` (single-use consumed).
- Cross-item replay: `mintToken(itemA, wsX)` then `validateAndConsume(token, itemB)` returns `null`,
  **and** the token still validates for `itemA` afterwards (a refused call must not consume it).
- Expiry: `mintToken(itemA, wsX, { ttlSeconds: -1 })` → `validateAndConsume` returns `null`.
- Unknown/empty token returns `null` (`:84`); a throwing collection returns `null`, never rejects
  (`:106-109`).
- `cleanup()` removes expired tokens and **retains** used-but-unexpired ones (the audit trail contract
  at `:112-114`).

---

### 3. `dispatch-token-revoke-untested-isolation-guard` — **High** — *carried, partially closed, scope narrowed*

**Module:** `lib/dispatch-tokens.js` — 78.45% line / 50.00% branch / 60.00% function.
**Boundary:** auth / token — dispatch consumer authentication.
**Already ticketed: LIN-690 (Backlog, unstarted).**

The baseline flagged this module at **0%**. It is now partially covered — but *incidentally*, by tests
written for other tickets. `tests/unit/dispatch-tokens.test.js` (97 lines, added by LIN-1397 and
LIN-1448 per `git log`) asserts `createdBy` plumbing and `listTokens`' `hasOwner` flag
(`tests/unit/dispatch-tokens.test.js:43-96`). It asserts **nothing** about workspace isolation.

What remains uncovered is the half that carries the security invariant:

- **`revokeToken` (`lib/dispatch-tokens.js:169-184`) is entirely uncovered.** The `urlKey` in the
  `deleteOne` filter (`:175-178`) *is* the cross-workspace-revocation guard. Drop it and any workspace
  could revoke any other workspace's consumer token — draining a competitor's dispatch queue lane — and
  no test would fail.
- `validateToken`'s empty-token and error branches (`:97-98`, `:111-112`, `:119`, `:124-126`).
- `countTokens` (`:193-204`) and `clear` (`:213-220`) error paths — low value, noted for completeness.

**Behavioral tests that would catch a regression:**
- `revokeToken('workspace-B', idMintedForA)` returns `false` **and** `validateToken(plainA)` still
  resolves to workspace A afterwards.
- `revokeToken('workspace-A', idMintedForA)` returns `true` and `validateToken(plainA)` then returns
  `null`.
- Round-trip isolation: a token minted for A never validates to B's `urlKey`.
- `listTokens` never returns `tokenHash`.

**Disposition:** **not re-minted** — LIN-690 covers it. Its scope has legitimately narrowed since it was
written (create/validate happy paths are now covered), and the revoke isolation assertions are what is
actually left to do.

---

### 4. `agent-status-grouping-is-dead-code-not-a-coverage-gap` — **Medium** — *carried, RE-GROUNDED: baseline premise was wrong*

**Module:** `lib/agent-status-store.js` — 64.66% line / 69.57% branch / 61.54% function. Uncovered
ranges `225-282` and `295-347` map exactly to `listSessions` (`:224`) and `listTaskThreads` (`:294`).
**Already ticketed: LIN-691 (Backlog, unstarted) — but on a false premise.**

The baseline described these two reducers as powering "the first-class Observation page's session/task
grouping" and asked for grouping tests. **That is not true at HEAD, and was not true when the baseline
was written.** A repo-wide search excluding `node_modules`, `.git`, and the store's own definition finds
**zero callers** — no `server.js`, no `routes/`, no `lib/`, no `tests/`. The only other hits in the
entire tree are the six references inside the baseline report itself.

`git log -S"listSessions"` shows the callers were removed by **`a0ad7310` — "LIN-451: retire Foreman
observer page + playbook surfaces"**, which predates the 2026-06-25 baseline. The Observation page reads
through `lib/observation-sessions-materializer.js` / `lib/observation-sessions-store.js` instead. The
next commit `git log -S` reports touching `listSessions` is `fb669e37`/`c964d344` — the baseline report
being committed.

So the honest finding is not "untested grouping logic" but **~120 lines of unreachable code in a live
store**, which is why it shows as a coverage hole. Writing the tests LIN-691 asks for would pin the
behaviour of code nothing calls — coverage theater by the definition this review is meant to apply.

**Recommendation:** re-scope LIN-691 from "unit-test `listSessions`/`listTaskThreads`" to "delete
`listSessions`/`listTaskThreads`, or wire them to a real consumer" — a decision task, not a test task.
If they are deleted, this ledger row closes and the module's percentage rises with no test written.
Deliberately **not** promoted as a new task: LIN-691 already holds the slot, and creating a second
ticket for the same lines would be exactly the queue-swamping this periodical is told to avoid.

---

### 5. `session-store-expiry-branch-zero-coverage` — **Medium** — *new*

**Module:** `lib/session-store.js` — **absent from the coverage table (zero executed lines).**
**Boundary:** auth / data integrity — express-session persistence for every authenticated request.
**Not previously ticketed.** → **Promoted.**

`MongoSessionStore` backs every session in the app (`server.js:23`). Its whole surface — `get`, `set`,
`destroy`, `touch`, `cleanup` — is unit-untested. E2E exercises `set`/`get`/`destroy` implicitly on
every authenticated page load, so those are not the concern.

The concern is the one branch E2E **cannot** reach: the expiry check in `get()`
(`lib/session-store.js:44-47`). When a stored doc's `expires` is in the past the store destroys it and
calls back `(null, null)`. Invert that comparison, or drop the branch, and **every expired session is
honoured indefinitely** — the documented 30-day TTL becomes unbounded, and logout-by-expiry silently
stops working. No E2E ages a session past 30 days, and the module is absent from the coverage table, so
the regression would be invisible on both instruments simultaneously. That combination is what lifts
this above the other absent-module rows.

`cleanup()` (`:110-116`) — the periodic sweep called from the OAuth routes — is likewise unexercised.

**Behavioral tests that would catch it** (all cheap; the store takes an injected collection):
- Seed a doc with `expires` in the past → `get(sid, cb)` calls back `(null, null)` **and** the doc is
  deleted from the collection (assert the observable deletion, not just the callback).
- Seed a doc with `expires` in the future → `get` calls back the stored `session` object.
- Unknown sid → `(null, null)`; a rejecting collection → the callback receives the error (`:51`).
- `touch(sid)` extends `expires` on an existing doc and does **not** upsert a doc for an unknown sid
  (`:94-102` uses `updateOne` without `upsert` — that is the intended behaviour and worth pinning).
- `cleanup()` removes only docs whose `expires` is past.

---

## Recorded, not promoted

Real but lower-cost. Listed so nothing is lost and the next run can promote what still matters.

| Module | Coverage | Uncovered (high-value) | Why not promoted |
|---|---|---|---|
| `lib/proxy-fetch.js` | 43.22% line / 50% func | `16-18`, `58-69`, `103-198` | Egress path only live when `HTTP_PROXY` is set; awkward to unit-test, low day-to-day blast radius. Unchanged from baseline. |
| `lib/harbour-spawn.js` | 54.82% line / **0% func** | `43-52`, `61-65`, `75-79`, `110-119`, `156-228` | Harbour OS OSC-escape spawn; no function executed at all. Experimental `local` dispatch target, not a request-path boundary. **New row** — worth watching. |
| `lib/brief-cache.js` / `lib/recap-cache.js` | 66.06% / 72.83% line | `43-80` / `109-155` | Hash-keyed LLM response caches. A miss costs one regenerated call, not correctness. |
| `lib/proxy-tokens.js` | 91.44% line / 71.43% func | `405-407`, `419-420`, `429-431`, `441-452`, `461-468` | **Security core stays covered** — mint, expiry, single-use consume, atomic exchange, and `revokeToken`'s happy path all have tests. Only management-function error branches remain. Improved since baseline (81.6% → 91.44%). |
| `lib/llm-call-log.js` | 89.93% line | `185-187`, `233-235`, `243-251`, `259-267` | Money-*adjacent* (cost reporting, not spend enforcement); the append path is covered. Unchanged from baseline. |
| `lib/token-refresh.js` | 96.59% line | `168-174` | Auth boundary but improved since baseline (93% → 96.59%); only a small failure branch left. |
| `lib/linear-fetch.js` | 95.32% line | `42-44`, `93`, `150-157` | Retry-exhaustion / timeout edges. Unchanged from baseline. |
| `lib/dispatch-store.js` | 94.28% line | scattered error branches | Substantially improved since baseline (83.5% → 94.28%). |
| `lib/proxy-events.js` | 92.58% line | `220-222`, `337-347`, `356-363` | Was **0%** at baseline — now well covered. Effectively closed. |
| `lib/custom-prompts-store.js` | absent (0% unit) | whole module | Per-workspace prompt CRUD; no auth/money surface, driven through `custom-prompts.spec.js`. Unchanged from baseline. |
| `lib/render-templates.js` | absent (0% unit) | whole module | Renderer, single consumer at `server.js:99`. Presentation only. |
| `lib/providers/github-projects/client.js` | 91.18% line / **43.18% branch** | — | Read-only V1 provider; low branch coverage on a non-writing client. |
| `lib/render-live-console.js` | 100% line / **42.86% branch** | — | Shell renderer; all behaviour is client-side in `public/live-console.js`, driven by `live-console.spec.js`. Illustrates Trap 3's converse: 100% line, weak branches, low cost. |
| `routes/proxy.js` / `routes/auth.js` / `routes/workspace-api.js` / `routes/task-chat.js` / `routes/ship-biscuit.js` | 75.61% / 75.70% / 52.17% / 38.99% / 64.62% | many | **Trap 2** — browser-driven; each has a dedicated E2E spec. Not gaps on percentage alone. |

---

## Follow-up tasks minted

Two, both new and previously unticketed. Deliberately under the cap of three: the two highest-cost
items (Findings 1 and 3) already have open tickets — LIN-689 and LIN-690 — and re-minting them would
duplicate work already queued.

1. **LIN-2061** (Finding 2, High) — unit-test `lib/harbour-feedback-tokens.js` `validateAndConsume`:
   single-use consumption, hard expiry, and cross-item replay refusal — against the real store, not a
   stub.
2. **LIN-2062** (Finding 5, Medium) — unit-test `lib/session-store.js` `MongoSessionStore.get()`'s
   expiry branch and `cleanup()`, asserting the observable deletion.

Both were left in their default state (Backlog) for normal operations to pick up.

**Carried, not re-minted:** LIN-689 (Finding 1, Critical — now fronting 14 spend paths),
LIN-690 (Finding 3, High — scope narrowed to revoke isolation).
**Re-scope recommended:** LIN-691 (Finding 4 — its target has zero callers; it should become a
delete-or-wire decision, not a test task).

---

## Surface Assessment

**Surface Assessment: lands cleanly — report-only review; no structural code change or refactor is
required.**

---

## Trend Ledger (stable names — next run diffs against this)

| Stable name | Module | Severity | State at 2026-08-13 |
|---|---|---|---|
| `free-tier-global-hourly-cap-unenforced` | `lib/free-tier-store.js` | Critical | **open, unchanged** — LIN-689 Backlog 7 wks; blast radius 2 → 14 call sites; file untouched since baseline |
| `harbour-feedback-token-store-zero-coverage` | `lib/harbour-feedback-tokens.js` | High | **new** — promoted (LIN-2061) |
| `dispatch-token-revoke-untested-isolation-guard` | `lib/dispatch-tokens.js` | High | **open, narrowed** — 0% → 78.45%; `revokeToken` still 0%; LIN-690 Backlog |
| `agent-status-grouping-untested-data-integrity` | `lib/agent-status-store.js` | — | **superseded** by the row below; baseline premise disproved |
| `agent-status-grouping-is-dead-code-not-a-coverage-gap` | `lib/agent-status-store.js` | Medium | **new framing** — zero callers since `a0ad7310` (LIN-451); LIN-691 needs re-scoping |
| `session-store-expiry-branch-zero-coverage` | `lib/session-store.js` | Medium | **new** — promoted (LIN-2062) |
| `harbour-spawn-zero-functions-executed` | `lib/harbour-spawn.js` | Low | **new** — recorded |
| `proxy-tokens-residual-branches` | `lib/proxy-tokens.js` | Low | improved 81.6% → 91.44% — recorded |
| `proxy-events-zero-coverage` | `lib/proxy-events.js` | Low | **effectively closed** — 0% → 92.58% |
| `proxy-fetch-egress-untested` | `lib/proxy-fetch.js` | Low | unchanged 37.6% → 43.22% — recorded |
| `llm-call-log-query-funcs` | `lib/llm-call-log.js` | Low | unchanged — recorded |
| `token-refresh-failure-branch` | `lib/token-refresh.js` | Low | improved 93% → 96.59% — recorded |
| `linear-fetch-retry-exhaustion` | `lib/linear-fetch.js` | Low | unchanged — recorded |
| `dispatch-store-branch-gaps` | `lib/dispatch-store.js` | Low | improved 83.5% → 94.28% — recorded |
| `custom-prompts-store-zero-coverage` | `lib/custom-prompts-store.js` | Low | unchanged — recorded |
| `cache-modules-partial` | `lib/brief-cache.js`, `lib/recap-cache.js` | Low | **new** — recorded |
| `assertion-free-unit-tests` | whole unit suite | — | **checked, clean** — 24 candidates scanned, 24 false positives, 0 real |

**Suite trend:** 2430 → **6833** unit tests (0 fail). Line **82.80% → 90.79%**, branch
**79.18% → 82.84%**, function **84.30% → 88.51%**. Modules absent from the coverage table: **18** of 228
`lib/`+`routes/` files. HEAD `8de7da5` → **`30427bf6`**.
