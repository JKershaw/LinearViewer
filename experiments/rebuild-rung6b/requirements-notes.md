# lib/kpi-stats.js — requirements notes (origin/main 1f8010a0)

598 code lines / 1068 total; `collectKpiStats` cyclomatic 77. The data behind the PUBLIC,
unauthenticated, unlinked `/kpis` page (server.js:2213 `refreshKpiStats`, 60 s stale-while-revalidate
cache; lib/render-kpis.js renders it). **Privacy boundary**: output = counts, UTC day/hour keys,
ratios, USD sums and app-defined labels (dispatch `kind` names, proxy `endpoint` templates,
`dbBackend`) — never urlKeys, ids, prompt/summary/title text, emails, tokens, issue identifiers.

## Exports (9)
- Constants: `ACTIVITY_WINDOW_DAYS=30`, `HOURLY_WINDOW_HOURS=24`, `FREE_TIER_WINDOW_DAYS=7`,
  `OUTCOME_WINDOW_WEEKS=4`, `PROXY_PHASES=['orienting','deciding','acting','watching','reporting']`.
- `categorizeProxyEvent(method, endpoint)` → phase. Non-string method = 'GET'; upper-cased; prefix
  matches on the raw endpoint (no trim): agent/status + foreman/status (GET watching, else
  reporting), foreman/sessions|tasks watching, dispatch* (GET watching, else deciding),
  recommend*/prompt*/autopilot*/foreman/playbook deciding; else GET orienting / other acting.
- `loadDispatchHistory(coll, {since})` → aggregate() path: optional leading `$match {dispatchedAt:
  {$gte: since}}` + one `$project` (urlKey, status, dispatchedAt, resolvedAt, kind, rootItemId,
  followUpTo, abort, abortTo, issueIdentifier, harness, and five derived fields each
  `$cond: [FRESH_DIGEST, '$feedbackDigest.kpi…', <per-row expression>]`: feedbackCount,
  terminalEntry (`$last` of TERMINAL_FEEDBACK_REGEX matches, `{message,timestamp}`), usageEntry
  (`kind:'usage'`), evidenceCount, ticketMarkerEntries (TICKET_PREFIX)). Regex sources come from
  dispatch-terminal / session-telemetry `__internal`. Aggregation failure → console.warn + rethrow
  (never falls back). No aggregate() → `find(since ? {dispatchedAt:{$gte}} : {})` raw rows.
- `collectKpiStats(collections, {now = new Date(), dbBackend = null, milestoneFunnelDeps})` → the
  stats object (see below). Throws `TypeError('collectKpiStats: milestoneFunnelDeps is required
  (LIN-2952)')` when deps are missing.
- `__internal = { FRESH_DIGEST }` (a Mongo `$and` expression; mongo-smoke runs it on real mongod).

## Reads (one call per collection, all in one Promise.all; horizon = now − 30 d via readHorizonStart)
sessions `find({}, {projection:{expires:1}})`; userPreferences/dispatchTokens/proxyTokens/recapCache/
briefCache `countDocuments({})`; localIssues `countDocuments({kind:'issue'})` + `({kind:'project'})`;
workspacePreferences/customPrompts/dispatchQueue/freeTier/reportHistory `find({})`; dispatchHistory
via `loadDispatchHistory(…, {since})`; proxyEvents via aggregate `[$match timestamp ≥ since,
$group by {method, endpoint, status, hour: $dateToString '%Y-%m-%dT%H' UTC} count + $addToSet urlKey]`
(failure: console.error + rethrow) or projected find; agentStatus `find({timestamp:{$gte}},
{projection:{dispatchId,status,timestamp,urlKey}})`; `collectMilestoneFunnel({since, ...deps})`.
Any rejection propagates (server serves stale / 500). scripts/lin3014 + its test pin the read shapes.

## Output (key order is part of the golden-ish surface; reported as info by the replay)
generatedAt; totals {workspaces (distinct urlKeys across prefs `_id`, customPrompts, queue,
history, proxy bins, agentStatus, reports, freeTier), workspacesBasis, users, activeSessions
(expires > now), agentActions, dispatches, autopilotRuns, feedbackNotes, aiSummaries, roadmapReports,
roadmapReportsBasis, customPrompts, localIssues, localProjects, activeTokens}; proxyCategories(+Hourly);
dispatchByDay (top 5 kinds + 'other'); dispatchKinds (top 8, ties alphabetical, trimmed) +
dispatchKindsOtherCount; dispatchOutcomes (lineages via groupDispatchLineages, 30 d window, 4 weekly
buckets, rates 3 dp or null); terminalMarkedTaskCost; weeklyBudgetGauge; funnel (dispatched, taken,
reported, completed, *IsLowerBound:true); milestoneFunnel; stepOutcomes (Object.hasOwn guard against
'constructor'); proxyStatus(+Hourly) (≥500/≥400/≥100, Number() coercion); topEndpoints(+Hourly)
+ OtherCount (Σ distinct − 8); hourOfDay[24]; freeTier {days, counts} (urlKey truthy, 'YYYY-MM-DD');
vanity {busiestDay (first max), readsPerWrite (1 dp, null w/o writes), medianQueueToTakeMinutes, dbBackend}.

## Windows (all derived from the injected `now`; never Date.now() except the default)
"· 30d" cutoff = midnight UTC of activityDays[0] (not now−30d); outcome window = now−30 d (lineage
earliest ≤ now); weekly buckets [now−k·7d, +7d); proxy/day membership by bin day/hour keys.

## Side effects
console.error / console.warn on aggregation failure (then rethrow). No module state, no env reads,
no writes. Mixed timestamp types (Date/ISO/epoch) go through `toEpochMs`.

## Tests that read the file as text
tests/unit/lifetime-retention-contract-drift.test.js (`read('lib/kpi-stats.js')`: must NOT match
/≤30d-TTL|30-day history retention|with retained activity/, MUST match /activity in the 30-day read
window/ — i.e. the `workspacesBasis` string). Also lin3014-capture-kpis (pipeline must contain a
`$project`), mongo-smoke (FRESH_DIGEST parity, skipped offline), generic lib scanners.
