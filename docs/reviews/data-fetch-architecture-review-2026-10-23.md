# Data & Fetch Architecture Review — 2026-10-23 (baseline)

**Task:** LIN-3810 (periodical `data-fetch-architecture`, remit `generateDataFetchArchitecturePrompt`
in `lib/periodicals.js`, set by LIN-1039). **Type:** review-only. No code, config, secrets or docs
were changed apart from this report.
**Pinned HEADs (after a fresh `git fetch` of both repos):** LinearViewer `a896f183` (`origin/main`);
simple-dispatcher `1798790` (`origin/main`, read-only). Neither repo has a commit since the ticket was
minted (2026-10-23T16:24Z), so the seeded leads were re-read at the same HEAD they were written against.

**Baseline.** This is the **first run** of this periodical. There is no `docs/reviews/data-fetch-*`
file and no `simple-dispatcher/docs/reports/*data*|*fetch*` file, and Linear has no earlier run in this
series. Its sibling **Performance / Scale** has never run either, so there is no measured-symptom
report to borrow from. Every finding below is a first measurement, and the trend ledger marks each
one `new (baseline)`. The next run should measure against this file.

**Method.** I read the data layer statically: `lib/db-indexes.js`, `lib/read-horizon.js`,
`lib/dispatch-store.js`, `lib/pipeline-loops.js`, `lib/task-page-loader.js`, `lib/task-run-facts.js`,
`routes/proxy-dispatch.js`, `routes/dispatch.js`, `lib/digest-feedback.js`, and simple-dispatcher's
`queue.js`/`config.js`. Three fresh-context readers each took one axis, and the decisive claims were
re-read at source by the author before they went into this report:
(a) a census of every `find`/`aggregate`/`distinct`/`countDocuments` call in `lib/`, `routes/` and
`server.js`, classified HOT or COLD by tracing callers;
(b) the store-vs-provider boundary on every hot path and client poller;
(c) a census of every Mongo-backed and in-process cache.
The repo's own conventions are the reference: the LIN-3163 index/sort lockstep rule, the LIN-623
lean-feed projection, the LIN-2996 `feedbackDigest` read-model and the `observation-sessions`
materializer. No outside ideal is applied.

**Scope widened beyond the seed list.** The seed list did not name the following, and each one is in
the remit:
- the dispatch page's history route (`routes/dispatch.js:586`);
- the `/api/proxy/dispatch/:id` watch long-poll (`routes/proxy-dispatch.js:642`);
- `lib/task-run-facts.js`;
- the Observation materializer's per-write discovery read;
- the rulings badge poll and its three stores;
- the unindexed `dispatchedAt` window;
- the boot-blocking index rollout;
- `liveness-alarm-store`, `task-mode-store`, `close-out-events-store`;
- multi-replica cache coherence.

**Headline.** The paged evidence lists are disciplined: their sorts match their indexes, they page
in the database, and they are bounded per page. The defects sit in three seams that the paged-list
work never reached:

1. **The 30-day read window has no index.** LIN-3161 moved every windowed history read onto
   `dispatchedAt >= horizon`. LIN-3163 made history lifetime-retained. But the `{urlKey, dispatchedAt}`
   index is deliberately kept out of `INDEX_SPECS` because the boot-time index build blocks deploys.
   As a result, every "30-day" read on the 5-second polls and the 60-second sweeps walks the
   workspace's whole lifetime history, and that history grows forever.
2. **Dispatch rows are read in full by default.** The `feedbackDigest` read-model already exists and is
   kept current at write time (LIN-2996). Using it is a per-caller opt-in (`lean`, `projection`), so the
   task page's 10-second poll, the watch long-poll, the run-facts read and the dispatch history page
   still move every prompt and the whole `feedback[]` history. The worst member reads the workspace's
   entire lifetime history, prompts included, on every dispatch-page load.
3. **Tracker reads have no read-through layer.** Routes call providers directly, and the provider layer
   has no cache. LIN-446 already owns this class. This run confirms it and adds members.

---

## Severity-ranked findings

### 🔴 HIGH

#### H1 — The 30-day read horizon is an unindexed predicate on a lifetime-retained collection (`dispatch-history-window-unindexed`)

**What.** `listHistory` turns `since` into `query.dispatchedAt = { $gte: since }`
(`lib/dispatch-store.js:1180`). For `dispatch-history`, `INDEX_SPECS` declares only:
- `{urlKey}`, `{urlKey, issueIdentifier}`, `{urlKey, resolvedAt:-1}` and the
  `{urlKey, sessionId|sessionGroupId|rootItemId|followUpTo|producingItemId}` family;
- `{dispatchedBy, dispatchedAt}` (`lib/db-indexes.js:128-200`).

None of these supports a range on `dispatchedAt` under a `urlKey` equality. The gap is deliberate:
`ROLLUP_HISTORY_INDEX = {urlKey:1, dispatchedAt:1}` is "the index the backfill needs and `INDEX_SPECS`
deliberately does not carry", because "Boot awaits every spec before `app.listen` … a build over the
whole of `dispatch-history` would hold the deploy". It is created by hand from a runbook
(`lib/kpi-daily-rollup.js:55-64`; `server.js:288` `await ensureIndexes(db)`).

Every windowed read therefore resolves to the `{urlKey}` index and then fetches and filters **every
history row the workspace has ever had**. These are the members (bound: every `listHistory`/aggregate/
`distinct` call that passes `since` or `dispatchedAt` without an `issueIdentifier`/`sessionId`/
`rootItemId` equality, found by grepping `listHistory(` and `dispatchedAt` across `lib/`, `routes/` and
`server.js`):

| Member | Cadence | Cite |
|---|---|---|
| `getLoopsForWorkspace` / `getSessionsForWorkspace` (`_fetchWorkspaceData`, `since = now − LOOKBACK_MS`) | rulings badge poll every 5 s on every navbar (`public/common.js:3102`) through `dashboard.js:1952`, behind a 5 s stale-while-revalidate feed cache, so at most once per 5 s per workspace set rather than per tab (`routes/dashboard.js:1944-1946`, `lib/sessions-feed-cache.js:27`); live console every 5 s (`routes/live-console.js:204`); sessions `?live` (`routes/dashboard.js:925`); swipe page (`server.js:3447`); dashboard loops (`routes/dashboard.js:653`); task chat | `lib/pipeline-loops.js:835-856` |
| Observer, CI-wake and liveness sweeps (the same workspace-loops read) | 60 s / 5 min / 10 min per workspace | `lib/observer-sweep.js:475`; `lib/ci-wake-sweep.js:275`; `lib/liveness-alarm-sweep.js:113` |
| `listObservedWorkspaceKeys`: `distinct('urlKey', {dispatchedAt ≥ horizon})` with **no** urlKey prefix, so a scan of the whole collection across every workspace | every observer sweep (60 s), CI-wake (5 min), liveness (10 min), observer-pass (15 min) | `lib/dispatch-store.js:1985-2031` |
| Workspace `/kpis`: aggregate `$match {urlKey, dispatchedAt ≥}`, uncached | each page load | `routes/workspace-kpis.js:29` → `lib/workspace-kpi-stats.js:145` → `lib/kpi-stats.js:492` |

**Structural cost.** LIN-3163 states the rule that keeps lifetime retention affordable: "each paged
list's index key must match that list's sort key EXACTLY" (`lib/db-indexes.js:21-35`). That rule was
applied to the four paged lists and to `{urlKey, resolvedAt:-1}`. It was never applied to the one
predicate that LIN-3161 put on almost every windowed read. The read is correct but costs
O(lifetime rows of the workspace), and for the `distinct`, O(lifetime rows of the instance). The cost
grows by one row per dispatch, forever, and the 5-second polls and per-minute sweeps multiply it.
MangoDB has no query planner, so dev never shows the difference (`lib/db-indexes.js:43-45`).

The cause is not a forgotten index. The deploy mechanism makes any index on a large collection a held
operator decision. Two other indexes the data needs are held for the same reason:
- the `owner-credentials` `{urlKey}` index (`lib/db-indexes.js:51-56`, LIN-2954);
- the `ROLLUP_HISTORY_INDEX` itself.

Whether production carries the hand-applied index today cannot be bounded from source (see *Classes*).
Even if it does, it does not serve the urlKey-less `distinct`.

**Design improvement.**
1. Separate index rollout from boot. Keep `ensureIndexes` blocking only for the small and unique
   correctness indexes. Build the rest after `listen`, or in a declared out-of-band step whose
   pending or built state is logged and readable. Adding a needed index then stops being a held
   decision.
2. Declare the window index in `INDEX_SPECS` like any other: `{urlKey:1, dispatchedAt:-1}` on history
   and queue. Add a `dispatchedAt`-led index (or a tiny "workspaces active since" read-model) for
   `listObservedWorkspaceKeys`.
3. Extend the LIN-3163 lockstep rule from *sort keys* to *window predicates*. The horizon is a shared
   predicate (`lib/read-horizon.js`), so its index belongs in the same lockstep.

**Existing tickets.** None names this. LIN-3164 audited production indexes but did not add this one.
LIN-2143 and LIN-3206 are adjacent index-hygiene tickets. **Minted: LIN-3811.**
**Sibling seam.** Performance / Scale would own the measured latency, but it has never run.

---

#### H2 — Dispatch rows are read as whole evidence documents by default; the persisted digest is opt-in (`dispatch-row-full-read-default`)

**What.** A `dispatch-history` row is both the lifetime evidence (a `prompt` of about 8–30 KB, which can
reach several MB; `routes/proxy-dispatch.js:396-401`) and an unbounded `$push`-grown `feedback[]`
(`lib/dispatch-store.js:2364`). It is also the record every reader derives state from. LIN-2996 built
the right read-model, `feedbackDigest`, which writers keep current under a `feedbackVersion` CAS
(`lib/digest-feedback.js`; `lib/dispatch-store.js:2364`). The workspace-wide views use it through
`lean: true` (`lib/pipeline-loops.js:840`).

But the store's default read shape is still the whole document. `lean` and `projection` are
per-caller options that a new reader has to know about, and most per-issue and per-item readers never
adopted them. These are the members (bound: every `listHistory`, `listItems`, `getItemStatus`, `getLoopsForIssue`,
`getLoopsForWorkspace` and `getSessionsForWorkspace` caller, from a grep across `lib/`, `routes/` and
`server.js`, each checked for `projection`/`lean`; the last two were added after the adversarial
second-read found them missing):

| Member | Shape | Cadence | Cite |
|---|---|---|---|
| Dispatch page history | `listHistory(urlKey, {limit, offset})`. The client never sends `limit` (`public/dispatch.js:1138`), so this is the **unlimited** branch with no `since` and no projection: **the workspace's entire lifetime history, prompts included**, sorted and sliced in JS (`lib/dispatch-store.js:1211-1221`), and every row is sent to the browser | every dispatch page open and refresh | `routes/dispatch.js:583-586` |
| Task page state poll | `getLoopsForIssue(…, {horizon:'all'})`, never lean, so every lifetime row of the issue with `prompt` and `feedback`. The task page never reads `promptText` | every 10 s while running, 45 s otherwise (`public/task-page.js:36-37`) | `lib/task-page-loader.js:810`; `lib/pipeline-loops.js:836-841` |
| Task/run facts | `listHistory(urlKey, {issueIdentifier})`: unlimited and unprojected, lifetime, to derive **two scalars** (`stopAt`, `variant`), then a `getItemStatus` per distinct `sessionId` | task page and run page load, close-out check | `lib/task-run-facts.js:59-90` |
| Watch long-poll | `getItemStatus(…, {includeGroupFeedback:true})` re-reads the full row (`findOne`, no projection) plus every lineage sibling's `feedback`, **every 1.5 s** for the whole hold, only to detect a change. `feedbackVersion` is the scalar that would answer that | each orchestrator watch (LIN-392/794 long-poll) | `routes/proxy-dispatch.js:32,642`; `lib/dispatch-store.js:515-527,736-741` |
| Proxy dispatch list | prompt projected out, but 200 rows plus up to 2,000 lineage siblings with full `feedback[]`, to derive `status`/`completedAt`/`feedbackCount`. Because `status` is derived and not stored, `?status=` can only filter the newest-200 window | each agent list call | `routes/proxy-dispatch.js:406-407,463-468,481-484`; LIN-2120 |
| Observation materializer discovery | `listHistory({issueIdentifier, since})` and `listItems` unprojected, reading prompts to look at `kind`/`sessionId`/`followUpTo` | **every dispatch write** (`onWrite`) | `lib/observation-sessions-materializer.js:224-226` (also `:281,:301,:320`) |
| Sweep lineage reads | `listHistory({rootItemId, since})`, unprojected | per lineage per sweep tick | `lib/liveness-alarm-sweep.js:198`; `lib/ci-wake-sweep.js:243` |
| Other non-lean issue reads | `getLoopsForIssue` without `lean` | per request | `routes/dashboard.js:1774`; `routes/workspace-api.js:2026` |
| Queue badge count | `countItems` = `find().toArray().length`, so every queued row, prompts included | **every 1 s** per open tab (`public/app.js:1320`) | `lib/dispatch-store.js:822-838` |
| **One session by id via a full workspace rebuild** *(added by the second read)* | `getSessionsForWorkspace` **without `lean`**: every 30-day history row with `prompt` and `feedback[]` (on the H1 unindexed window), to `.find()` or `.some()` one `sessionId` | each run-scoped task-chat turn; each proposed follow-up; the `get_session`, `list_active_sessions` and `send_follow_up` LLM tools (also used by the flight companion, `routes/flight-companion.js:616,775`, `routes/proxy-flight-companion.js:285`); session follow-up dispatch (`routes/flight-companion.js:848`, `routes/dashboard.js:1452`) | `routes/task-chat.js:487,501`; `lib/chat-tools.js:1616,1663,1816`; `lib/follow-up-dispatch.js:147` |

**Structural cost.** Every one of these reads costs O(rows × (prompt + feedback history)), when the
fact it needs is a few scalars that are already materialised. Two of them are multiplied by a poll
(10 s, 1.5 s). The dispatch-page member has no bound at all: it is the LIN-1030 shape ("a limit applied
as an in-memory slice after a full read") on a collection that LIN-3163 made lifetime-retained. The
store's comment says its unlimited path is for "callers that legitimately need the whole (already
`since`-windowed) set" (`lib/dispatch-store.js:1189-1195`), but nothing enforces that, and this caller
passes no window. Each past fix (LIN-623, LIN-1030, LIN-2996) patched the readers it was raised
against, so the default stayed heavy and the next reader inherited it.

The point read these callers need already exists, but it lives in route code:
- `pointReadSession` (`routes/dashboard.js:1719`, LIN-1022);
- `observationSessionsStore.getSession` (`lib/observation-sessions-store.js:338`, LIN-632).

Because both sit inside the dashboard routes, the chat, tool and follow-up paths never picked them up.

**Design improvement.** Invert the default at the store seam:
1. `listItems`/`listHistory`/`getItemStatus` return the **lean shape** (scalars plus the fresh
   `feedbackDigest`, self-healed as `_selfHealLeanHistory` already does) unless the caller names a full
   read. Prompt and raw feedback move behind explicit methods (`getPrompt`, `getFeedback`), which the
   prompt endpoint and the run-detail view already are in effect.
2. `listHistory` refuses a call with neither `limit` nor `since` nor an equality key (a store-level
   bound, instead of a comment).
3. Lift `pointReadSession` into `lib/` as the one shared session-by-id read, so no caller rebuilds a
   workspace to find one session.
4. Persist the lineage-level wire status, `completedAt` and lineage feedback count on the row at
   feedback-write time, the way `observation-sessions` materialises sessions. The list can then filter
   and page `?status=` in the database (this closes LIN-2120's window blindness), and the watch can
   compare `feedbackVersion` instead of re-reading documents.

**Existing tickets.** LIN-2996 (Done) built the digest and scoped it to the view cache fills. LIN-2120
(window-blind listing) and LIN-2122 (the history page shows the stored status) are downstream symptoms.
LIN-1591 (orchestrator polls re-read context) is the token-side twin of the watch member.
**Minted: LIN-3812.** **Sibling seam.** API Quality owns the `?status=` contract (its L12); this
review owns the read shape behind it.

---

#### H3 — Tracker data has no read-through layer; hot paths re-fetch providers live (`tracker-reads-no-read-through`)

**What.** Routes call `provider.fetchProjects` / `fetchRecommendationContext` / `fetchIssueComments`
directly, and the provider layer has no cache (`lib/providers/linear/index.js:766-797`: one projects
request plus one request per 250 issues, with no page cap). These are the members:
- **whole-workspace on every call:** `GET /api/proxy/stack` (`routes/proxy-compute.js:252`) and the
  `get_stack` chat tool (`lib/chat-tools.js:1571`);
- **whole-workspace per page load:** home, swipe, swim, ship and roadmap through
  `fetchAndPrepareProjects`, with `fetchTeams` per binding (`server.js:1636-1641,3655-3659`);
- **whole-workspace per click:** `/api/context/:issueId` (`routes/workspace-api.js:2198`), which skips
  the existing memo;
- **brief/recap cache validation needs the live read it exists to avoid.** The cache key is a hash of
  the freshly fetched context (`routes/proxy-compute.js:1072-1078`), so a hit still costs a tracker
  read;
- **comments on a poll:** the run page's PR-state poll calls `fetchIssueComments` every 60 s with "no
  run->PR pointer cache" (`routes/dashboard.js:1369-1377`; poll at `public/session.js:362`), and the
  close-out check re-reads comments on every window focus;
- **owned data left unused:** `task-snapshot-store` keeps a durable slice of each issue including
  comments, is written by `/brief` and `/recap`, and is read by no hot path;
- **credential-blind memo:** the one shared memo, `_workspaceIssuesMemo`, is keyed by workspace only
  (`server.js:3030-3052`).

The task page header says an owner load makes three tracker reads (`lib/task-page-loader.js:23-29`).
With the close-out check it is up to four (`public/close-out.js:264-265`).

**Structural cost.** Every one of these grows with the number of issues (1 + N/250 calls) or with poll
ticks, and none is bounded by a cache. The data Harbour already owns (snapshots, dispatch
`evidenceUrls`, PR state) is not used to answer. The one well-designed tracker-side cache,
`pr-state-store` (credential-scoped key, open/closed TTLs, upstream budget, stale-serve), has not been
generalised.

**Design improvement.** Build one credential-scoped tracker read-through layer behind the provider
interface, modelled on `pr-state-store`:
- key by workspace, binding and credential fingerprint;
- coalesce in-flight requests;
- use `task-snapshot-store` as its persistent tier.

Brief and recap then validate against the snapshot's hash, not a live fetch, and a run's PR pointer is
stored once.

**Existing tickets.** **LIN-446** (class owner), **LIN-2101** (credential-blind memo), **LIN-3274** (run
page comments). This run cites them and does not mint. The new members are added as a comment on
LIN-446.

---

### 🟠 MEDIUM

#### M1 — The browser `sessions` collection is the workspace-binding registry, re-parsed by nine full scans (`sessions-blob-as-registry`)

**What.** There are nine `sessionsCollection.find({}).toArray()` reads. Each parses
`session.workspaces[]` into one of three projections of a single fact: the live workspace bindings
(workspaceId, urlKey, provider, connection, owner, token expiry). The reads are:
- **HOT:** `server.js:2808` (`resolveWorkspaceAccess`), on every proxy request that misses the 30 s
  cache, and on **every** request that carries a `source`, since those skip the cache by design
  (`server.js:2740` sets the flag);
- `server.js:2793`, the suspect-fingerprint refresh (`loadSessions`), on a cache hit whose
  fingerprint is suspect;
- `lib/workspace-title-resolver.js:60` (per materializer rebuild with untitled loops);
- `lib/observer-sweep.js:652` (60 s) and `lib/observer-pass.js:506` (15 min);
- `lib/openrouter-key-resolver.js:94` and `lib/ci-wake-sweep.js:138`;
- `lib/credential-invariant-sweep.js:201`;
- `lib/kpi-stats.js:625`.

`workspace-token-resolver.js` and `workspace-token-refresh.js`, named in the seed list, are pure
selectors over the caller's array. They are **stale as readers**.

**Structural cost.** A proxy-auth miss costs O(all live sessions × their workspaces), and each full
session blob (tokens included) is transferred unprojected. The collection is bounded by a 30-day TTL
(`lib/session-store.js:117`), so this grows with active users, not with history. That is why it rates
MEDIUM.

**Design improvement.** This is one missing read-model, not nine acceptable reads. Make the durable
`workspaces` registry (inert today: "constructed but wired to no route", `lib/observer-sweep.js:645`)
the binding read-model, maintained at bind and sign-in time and read by key.

**Existing tickets.** LIN-3394 ("make the durable `workspaces` collection the registry") is the
natural home. **Cited, not minted.** A comment adds the nine readers as its consumer list.

#### M2 — The cache layer is an accretion with no shared TTL, capacity, credential or replica rule (`cache-layer-accretion`)

**What.** There are about 14 in-process caches and 8 Mongo-backed caches or read-models, with at least
six eviction models and four different freshness comparisons. There is no shared helper.
`lib/workspace-token-cache.js:28-29` says it *mirrors* three siblings, so the pattern is copied, not
imported. The concrete costs:
- **Unbounded in-process growth.** `failOpenPrStatusCache` gets a new key per commit sha and is never
  deleted (`lib/github-pr-status.js:295,369-387`). `prStateSharedCache` (`lib/pr-state-store.js:51`),
  `prFilesCache` (`lib/github-pr-files.js:39`) and the task-share loader cache (`routes/task-share.js:117`)
  are never pruned either. The installation resolver's `bound()` (`lib/connection-credential.js:1471-1479`)
  is the only size cap in the codebase.
- **Mongo caches outside the stated eviction rule.** `lib/db-indexes.js:11-14` names hourly
  `.cleanup()` as "the sole, authoritative evictor", but brief, recap, run-summary and session-summary
  are evicted only on read and are absent from `lib/hourly-cleanup.js`.
- **Replica incoherence, latent.** `lib/scheduler.js:2-4` is written to tolerate more than one
  instance. `server.js:2586-2591` says the replica count is recorded nowhere: Railway defaults to 1
  replica unless scaled. Logout eviction of the token cache (`evictWorkspaceToken`, `server.js:2601`)
  and `sessionsFeedCache.clear` reach only the local process. The moment a second replica runs,
  another replica can serve a revoked credential for up to its 30 s TTL, which is the LIN-1507 class.
  No rule says which caches must be shared.
- **Credential-blind keys.** `_workspaceIssuesMemo` (LIN-2101), and the AI caches, which are keyed by
  urlKey only.

**Design improvement.**
1. One in-process cache primitive: TTL with an injected `now`, a capacity cap, and a credential-key
   helper, built from `workspace-token-cache`'s conventions and the resolver's `bound()`. Every `Map`
   cache moves onto it.
2. One Mongo cache base with a `cleanup()` wired into hourly-cleanup.
3. A stated rule for which caches must be shared across replicas (credential and revocation caches)
   versus which may stay per-process.

**Existing tickets.** LIN-3514 (AI-cache eviction, cited) and LIN-2101 (cited). Nothing covers the
in-process primitive or replica coherence. **Minted: LIN-3813.** **Sibling seam.** Drift & Coherence
flagged the copied constructors (its 2026-10-19 report, G0366). Seams & Tangles owns the
`recap-cache`/`brief-cache` hashing back-edges (LIN-3736; nine importers still present at HEAD). This
review owns the policy gap, not the duplication.

#### M3 — The rulings badge poll reads three durable, never-pruned collections in full, two with no index at all (`rulings-poll-unindexed-scans`)

**What.** `public/common.js:3102` polls `/api/dashboard/rulings` every 5 s on every navbar, which reads:
- `task-decisions` `{urlKey $in}` (`lib/task-decisions-store.js:551,587`);
- `shelved-rulings` `{urlKey $in}` (`lib/shelved-rulings-store.js:155`);
- `dismissal-suggestions` `{urlKey $in}` (`lib/dismissal-suggestions-store.js:276`).

The last two have **no index in `INDEX_SPECS`**, and none of the three has an evictor. The newest-per-task
selection is done in JS. The same poll also runs the H1 workspace-loops read.

**Structural cost.** The per-tab cost every 5 s grows with every ruling ever shelved or suggested
across the workspaces in scope. With no index, each read is a full collection scan across every
workspace.

**Design improvement.** Fold this into the read-model direction of H2 and M1. The open-rulings count is
a fact that can be materialised at write time (the `observation-sessions` pattern), so the badge reads
one indexed document. At minimum, the two stores join `INDEX_SPECS` under the LIN-3163 rule.
**Existing tickets.** None found. **Not promoted** (ticket cap). Recorded here for the next run.

#### M4 — The index/sort lockstep rule is enforced by comment only, and three stores have drifted (`index-sort-lockstep-unpinned`)

**What.** `lib/db-indexes.js:146-152` says outright that "nothing in CI pins the query plan". The drifted
sites:
- `liveness-alarm-store.list` sorts `{firedAt:-1, _id:1}` with a limit of 200
  (`lib/liveness-alarm-store.js:247`), against the declared `{urlKey, clearedAt, startedAt:-1}`
  (`lib/db-indexes.js:383`). The field and the `_id` direction differ, and its `cleanup()` is not wired
  into hourly cleanup.
- `task-mode-store.listForAccount` sorts `{at, _id}` across an `{accountId, urlKey, issueIdentifier, at}`
  index it cannot sort from, so it does a blocking sort over the account's lifetime events.
- `close-out-events` sorts `{at, _id}` against indexes without `_id`. These reads are small and keyed.

**Design improvement.** A unit test that checks every store's declared `(filter-equality, sort)` pair
against `INDEX_SPECS`. Each store would export its list-query shape beside its method, which makes
the rule mechanical instead of a comment. **Not promoted.**

### 🟡 LOW

- **L1 — Lifetime evidence scans on `/kpis` (`kpi-lifetime-scans`).** Global `/kpis` aggregates
  `foreman-status`/`proxy-events` on `timestamp` alone with no time-leading index
  (`lib/kpi-stats.js:317,642`). `task-mode-store.countByEntryRung` reads `find({})` and applies `since`
  in JS (`lib/task-mode-store.js:309,321`). Both are cold behind a 60 s cache. The LIN-3591/3724
  whole-collection *fallbacks* are confirmed gone: a failed aggregation rethrows (`lib/kpi-stats.js:327-332`).
- **L2 — Count by materialising (`count-by-materialise`).** `countItems` (`lib/dispatch-store.js:830`)
  and token counts use `find().toArray().length` because "MangoDB may not support countDocuments",
  while `listHistory` already uses `countDocuments` on both engines (`:1203`). This is an H2 member
  because of the 1 s poll. Listed separately because it is a stale engine assumption.
- **L3 — Saved-chat list loads transcripts for summaries (`saved-chat-list-unprojected`).**
  `SavedChatStore.list` reads up to 50 full transcripts to build metadata (`lib/saved-chat-store.js:176`).
  Capped, so LOW.
- **L4 — Six `_pruneToCapacity` clones** read a whole partition and delete one row at a time
  (saved-chat, observer-shadow-log, task-snapshot, report-history, ship-biscuit-history,
  task-decisions). They are capped (20–200), so the reads are bounded. The duplication belongs to
  **Drift & Coherence**. Not this review's finding beyond noting that it is sound in cost.
- **L5 — The task-page header undercounts its tracker reads (`task-page-read-count-doc`).** The header
  says three; the count is up to four (H3). This is doc drift and belongs to the Documentation review.
- **L6 — Paged-evidence `total` is a lifetime `countDocuments` per page.** `listEvents`, `listTraces`,
  `listCalls` and `listStatus` (`lib/proxy-events.js:541`, `lib/prompt-trace-store.js:225`,
  `lib/llm-call-log.js:111`, `lib/agent-status-store.js:189`) run an index-only count that grows O(n).
  Acceptable today and **not** worth a constant-factor patch. Recorded only so the trend is visible.

### Over-engineering check

None found. The heavy comment blocks around projections and indexes (for example
`routes/proxy-dispatch.js:391-401`) are records of decisions, not micro-optimisation of sound code.
The one place a further constant-factor squeeze was on the table (LIN-2996's 17.5 MB versus a 4–6 MB
target) was correctly dropped by the owner. This review does not reopen it: H2's fix is structural
(default shape and persisted status), not more trimming.

### Stale leads and tickets

- **LIN-1618** ("listEvents is unprojected, un-time-bounded"): `listEvents` now pages in the database,
  with its sort matched to `{urlKey, timestamp:-1, _id:-1}` (`lib/proxy-events.js:540-546`).
  "Un-time-bounded" is now the intended lifetime design. **Recommend closing** (residual is L6).
- **LIN-1613** (`loadProxyBins` silent unbounded fallback): fixed by LIN-3002 (`lib/kpi-stats.js:327-332`).
  **Recommend closing.**
- The inline `server.js` `_tokenCache` is gone, replaced by `lib/workspace-token-cache.js` (LIN-1507).
  The drift review's line citations have moved (`server.js:2434` → `:2569`).
- `agent-status-store:307`'s JS `tokenId` filter has no callers (dead code). The `task-snapshot-store`,
  `saved-chat-store`, `collective-presets-store` and `observer-shadow-log` JS sort/slice reads are
  capped and indexed, so they are **sound**.
- The `_workspaceIssuesMemo` comment's "5s observation poll behind it" (`server.js:3026`) no longer
  holds: `public/observation.js:1387` fetches context once per session.

### Sound, and not to be touched

- Token validation by unique `tokenHash` (`lib/proxy-tokens.js:483`, `lib/dispatch-tokens.js:136`,
  `lib/task-share-store.js:127`).
- The four lifetime paged lists, with sorts matched to their indexes (LIN-3163).
- `listHistory`'s limited path with `{urlKey, resolvedAt:-1}`.
- Issue-, session- and lineage-scoped equality reads.
- The **simple-dispatcher runner poll**: `GET /api/dispatch/poll` every 5 s per workspace
  (`simple-dispatcher/config.js:18`, `queue.js:67`) reads only the small, expiring, `{urlKey, expiresAt}`
  indexed queue (`routes/dispatch.js:1135-1147`). SD's poll cadence does **not** drive any history or
  tracker read.
- The `observation-sessions` read-model, the reference pattern.
- `pr-state-store`.
- The task-state poll's store-only boundary (no provider read on a poll).

---

## Classes

| Class | How bounded | Members |
|---|---|---|
| Windowed reads on `dispatchedAt` with no equality key | grep of `listHistory(` / `dispatchedAt` / `distinct(` in `lib/`, `routes/`, `server.js`, each checked for an `issueIdentifier`/`sessionId`/`rootItemId` key | the 4 rows in H1 |
| Dispatch-row readers that don't use the lean/digest shape | every caller of `listItems`/`listHistory`/`getItemStatus`/`getLoopsForIssue`/`getLoopsForWorkspace`/`getSessionsForWorkspace`/`countItems`, checked for `lean`/`projection`. Cold or deliberate non-lean reads, cleared by the second read: `lib/observer-efficacy-signal.js:405` (no callers), `routes/dashboard.js:2299` (on-demand KPI), and the `:1700/:1781/:2823/:2947` guarded fallbacks | the 10 rows in H2 (the session-by-id row was added by the second read). Lean adopters (sound): `routes/dashboard.js:653,925,938`, `routes/live-console.js:204`, `server.js:3447`, `lib/chat-tools.js:1735,1772`, `lib/observer-sweep.js:475`, `lib/ci-wake-sweep.js:275`, `lib/liveness-alarm-sweep.js:113`, `lib/ticket-close-closer.js:252`, `routes/proxy-rulings.js:195`, `lib/observation-sessions-materializer.js:364,412` |
| Non-provider whole-workspace tracker reads | grep of `fetchProjects(` outside `lib/providers/` | `server.js:1641,3048,3659`; `routes/proxy-compute.js:252`; `routes/workspace-api.js:2198`; `routes/workspace-api-roadmap.js:629`; `routes/next-run.js:197`; `lib/chat-tools.js:1571` |
| Full `sessions` scans | grep of `sessionsCollection.find` / `sessions').find` | the 9 sites in M1 (2 in `server.js`: `:2793`, `:2808`) |
| In-process `Map` caches | grep of `new Map(` used with timestamps / TTL | M2 census: workspace-token-cache, `_workspaceIssuesMemo`, sessions-feed-cache, task-done-cache (×2), failOpenPrStatusCache, prStateSharedCache, prFilesCache, chat-tools prStatusCache, installation resolver (×3), openrouter catalog, kpi-page, task-share cache and maskLogged, proxy-dedupe, rejected-credentials |
| **Unbounded: production index state** | not boundable from source (a deployment fact): whether `ROLLUP_HISTORY_INDEX` and the LIN-3206 undeclared siblings exist in prod | — |
| **Unbounded: replica count** | not boundable from source (`server.js:2586-2591` logs a per-process id so it can be counted) | — |

**Closing the set.** To check I had not missed a reader, I re-ran these searches:
- `grep -rn "listHistory(\|getItemStatus(\|getLoopsForIssue(\|getLoopsForWorkspace(\|getSessionsForWorkspace(\|countItems("`
  over `lib/`, `routes/` and `server.js`. Every hit is classified above. The author's first pass
  omitted the last two symbols, and the second read caught that (see below).
- `grep -rn "fetchProjects("` outside `lib/providers/`. Eight sites, all listed.
- The read-discipline census grep over every `find`/`aggregate`/`distinct`/`countDocuments`.

The set would be wrong if a reader reached the collections without going through the store (a raw
`db.collection('dispatch-history')`). The census grep covered `collection(` usage too and found only the
KPI and rollup aggregates (H1 and L1) and the boot and admin scripts.

---

## Trend ledger

| Name | Severity | Delta |
|---|---|---|
| `dispatch-history-window-unindexed` | HIGH | new (baseline) |
| `dispatch-row-full-read-default` | HIGH | new (baseline) |
| `tracker-reads-no-read-through` | HIGH | new (baseline) — LIN-446 |
| `sessions-blob-as-registry` | MEDIUM | new (baseline) — LIN-3394 |
| `cache-layer-accretion` | MEDIUM | new (baseline) |
| `rulings-poll-unindexed-scans` | MEDIUM | new (baseline) |
| `index-sort-lockstep-unpinned` | MEDIUM | new (baseline) |
| `kpi-lifetime-scans` | LOW | new (baseline) |
| `count-by-materialise` | LOW | new (baseline) |
| `saved-chat-list-unprojected` | LOW | new (baseline) |
| `prune-to-capacity-clones` | LOW | new (baseline) — Drift-owned |
| `task-page-read-count-doc` | LOW | new (baseline) — Documentation-owned |
| `paged-evidence-lifetime-count` | LOW | new (baseline) |

## Follow-ups

- **Minted (top 3 by severity):** LIN-3811 (H1), LIN-3812 (H2), LIN-3813 (M2).
- **Cited, not minted:**
  - H3 → LIN-446, with LIN-2101 and LIN-3274;
  - M1 → LIN-3394;
  - M2 also → LIN-3514 and LIN-2101;
  - H2 also → LIN-2120, LIN-2122 and LIN-1591.
- **Recorded only:** M3, M4, L1–L6.
- **Recommend closing as stale:** LIN-1618, LIN-1613.

## Adversarial Second-Read

- **Tier:** 2. A fresh-context sub-agent with no memory of the report-writing turn, given only the
  repo, the report path, the remit and the question. Not a self re-read.
- **Question:** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (in full, lightly reformatted):**

  > **(1) Largest missed item: looking up one session by id rebuilds the whole workspace with full documents.**
  > Several interactive paths need a single session. Each one calls `getSessionsForWorkspace`
  > without `lean`, then picks one result with `.find()`:
  > - `routes/task-chat.js:487`: every run-scoped task-chat turn (POST `/api/task-chat/:issueId`)
  >   only checks whether `rawRunId` exists.
  > - `routes/task-chat.js:501`: `persistProposal` runs the same rebuild again for every proposed
  >   follow-up.
  > - `lib/chat-tools.js:1616` (`get_session`), `:1663` (`list_active_sessions`, which caps output
  >   at 50 rows yet reads full documents) and `:1816` (`send_follow_up`). These are LLM tool calls,
  >   and the same catalog serves the flight companion (`routes/flight-companion.js:616,775`) and its
  >   proxy twin (`routes/proxy-flight-companion.js:285`).
  > - `lib/follow-up-dispatch.js:147` (`dispatchSessionFollowUp`), called from
  >   `routes/flight-companion.js:848` and `routes/dashboard.js:1452`.
  >
  > Without `lean`, `_fetchWorkspaceData` applies no projection. Each call therefore pulls every
  > 30-day history row with its whole `prompt` and `feedback[]`. Because H1 is real (I confirmed no
  > `{urlKey, dispatchedAt}` index in `INDEX_SPECS`; `ROLLUP_HISTORY_INDEX` is hand-applied,
  > `lib/kpi-daily-rollup.js:55-64`), Mongo walks the workspace's whole lifetime history to get
  > there. Each call is the worst cell of H1 × H2: unindexed window, full documents, all to answer
  > an O(1) question.
  >
  > The point read already exists but is stuck in the dashboard. `pointReadSession`
  > (`routes/dashboard.js:1719`, LIN-1022) and `observationSessionsStore.getSession`
  > (`lib/observation-sessions-store.js:338`, LIN-632) were built to stop exactly this pattern.
  > They live inside dashboard route code, so chat, tools and follow-up never picked them up.
  >
  > Why the report misses it: H2's bound only covers callers of `listHistory`, `listItems`,
  > `getItemStatus`, `getLoopsForIssue` and `countItems`. It never lists callers of
  > `getSessionsForWorkspace` or `getLoopsForWorkspace`. H2 states "The workspace-wide views use it
  > through `lean: true`", and the Classes row lists `lib/chat-tools.js:1735,1772` as lean adopters,
  > but it omits the three non-lean siblings in the same file. So "Every hit is classified above"
  > is not true for this class. H1 names "task chat" only as a cadence for the windowed read; it does
  > not flag the read shape or the missing point-read seam.
  >
  > Size: comparable to H2's members, not bigger than H1. It runs per chat turn or tool call, not on
  > a 5 s poll. Inverting the store default as H2 proposes would fix most of it. The separate fix is
  > to move `pointReadSession` into `lib/` as the one shared session-by-id read.
  >
  > **(2) Verdict: AGREE.** H1's citations hold at HEAD: `lib/dispatch-store.js:1180`, the
  > `INDEX_SPECS` dispatch-history entries, and `lib/kpi-daily-rollup.js:55-64`. Nothing structurally
  > bigger was missed. What I found is a whole class of members missing from H2, which leaves H2's
  > census open.
  >
  > **(3) Differs from H1: YES.**
  >
  > **(4) Secondary observations.**
  > 1. **H1's "every 5 s on every navbar" overstates the multiplier.** The rulings poll runs
  >    `mergeLoops` through `sessionsFeedCache.get` (`routes/dashboard.js:1944-1946`), a
  >    stale-while-revalidate cache with a 5 s TTL (`lib/sessions-feed-cache.js:27`). The
  >    workspace-loops read therefore happens at most once per 5 s per workspace set, not once per
  >    tab. The 1 s queue badge read is not cached, so H2's member there stands.
  > 2. **H2's dispatch-page member is confirmed and arguably the single worst read in the report.**
  >    `public/dispatch.js:1138` never sends `limit`, and `routes/dispatch.js:583-586` then takes the
  >    unlimited branch (`lib/dispatch-store.js:1211`), which returns the workspace's whole lifetime
  >    history, prompts included, to the browser. It has no bound of any kind, so it could stand as
  >    its own HIGH rather than one row of H2.
  > 3. **M1's citations need a fix.** `server.js:2740` is the `sourceScoped` flag, not a separate
  >    read: requests carrying a `source` fall through to the same scan at `:2808`. The report misses
  >    the suspect-refresh full scan at `server.js:2793`
  >    (`loadSessions: () => sessionsCollection.find({}).toArray()`), which runs on a cache hit when
  >    the fingerprint is suspect. The other non-lean workspace reads I checked are cold or
  >    deliberate: `lib/observer-efficacy-signal.js:405` has no callers (dead code);
  >    `routes/dashboard.js:2299` is an intentional on-demand KPI read; `:1700`, `:1781`, `:2823`
  >    and `:2947` are guarded fallbacks.
  >
  > Checked and cleared: the Observation feed reads the TTL'd materialized store, indexed on
  > `{urlKey}`; the collective poll is a Yap cursor; flight-companion wakes read the persisted census
  > document; `listStatus` windows on the index `{urlKey, timestamp:-1, _id:-1}`; the task-share guest
  > path goes through a single-flight cache; simple-dispatcher only calls `poll`, `take`,
  > `heartbeat`, `feedback`, `broker-token` and the prompt read, and the feedback write fans into the
  > materializer read that H2 already lists.

- **Adversarial second-read verdict: AGREE**
- **Differed from top finding: YES**
- **Disposition: fixed in place**

**Author's handling.** Every cited line was re-read at source before any change was made.
- (1) is added to H2 as a tenth member. The point-read lift is step 3 of H2's design. H2's bound and
  the Classes row now include `getSessionsForWorkspace`/`getLoopsForWorkspace`. The same members
  were appended to LIN-3812.
- Secondary 1 corrects H1's rulings-poll multiplier.
- Secondary 3 corrects M1's citations, with the nine-site count unchanged.
- Secondary 2 is accepted as emphasis but not as a re-rank. The dispatch-page read is H2's worst
  member, and splitting it out would turn a design finding back into the point patch this review is
  told not to propose. H2's step 2 (`listHistory` refuses an unbounded call) is the structural fix
  for it.
- No ranking changed.

