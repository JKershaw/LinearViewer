# Operator execution trace — LIN-3204

**Drop the six old indexes left by LIN-3157 (never the `email-magic-links` TTL).**

This is an audit record, not application code. LIN-3204 is an operator task: the
deliverable is the verified execution trace. No repository code changed.

- **Ticket:** LIN-3204. Approval: John delegated the yes to the Flight Companion
  for exactly the six indexes named in LIN-3157 comment `ac02bb86` (delegation
  `8123aab3`); re-affirmed `8859eacd`.
- **Executed by:** implementation/operator session, 2026-10-01T15:49:45.146Z (UTC).
- **Checkout:** `LinearViewer` @ `542f28cb662713cd67830af58ace88251683ddd3`
  (>= the `3bc00a37` LIN-3164 merge required by the ticket; script unchanged at HEAD).
- **Target:** production Railway service `MongoDB-harbour`, database `linear-viewer`.
- **Result:** all six vestigial indexes dropped, one at a time, in table order;
  every replacement present; `email-magic-links` TTL untouched; paged-list
  planner verdicts unchanged (all PASS before and after).

## Production route

The host's linked Railway CLI is authenticated (John Kershaw). This fresh
dispatch checkout is not link-stateful, so the project/environment were pinned
explicitly — the **same service, environment, and credential path** as the
ticket's `railway run -s MongoDB-harbour` form:

```sh
HOME=/Users/work railway run -p fc7abe0d-2c3b-403d-88a3-d61c470729a7 \
  -e production -s MongoDB-harbour -- \
  sh -c 'MONGODB_URI="$MONGO_PUBLIC_URL" node scripts/retention-lifetime-pass-lin3157.js'
```

`MONGODB_URI` is taken from the service's `MONGO_PUBLIC_URL` inside the
`railway run` child, so the script targets production (`linear-viewer`), not
the local dev store.

## Gate — dry run BEFORE any drop (PASS)

Command (default mode is a read-only dry run):

```sh
HOME=/Users/work railway run -p fc7abe0d-2c3b-403d-88a3-d61c470729a7 \
  -e production -s MongoDB-harbour -- \
  sh -c 'MONGODB_URI="$MONGO_PUBLIC_URL" node scripts/retention-lifetime-pass-lin3157.js'
```

Gate criteria: exactly the six approved candidates, `Withheld: none`, no stray
TTL index. All three held, so the drops proceeded.

```
# Retention-lifetime pass — DRY RUN (LIN-3157 C / LIN-3164)

Run at: 2026-10-01T15:46:54.021Z
HEAD: 542f28cb662713cd67830af58ace88251683ddd3

## Per-collection counts (each store's own stamp / time field)

  collection                      total  stamped   past  oldest
  dispatch-history                11088        0      0  2026-08-31T16:31:27.161Z   [stamp=historyExpiresAt, time=dispatchedAt]
  prompt-traces                    7639        0      0  2026-06-21T11:00:04.449Z   [stamp=expiresAt, time=timestamp]
  foreman-status                     16        0      0  2026-09-02T23:24:04.643Z   [stamp=expiresAt, time=timestamp]
  llm-call-log                    18656        0      0  2026-06-15T20:48:37.832Z   [stamp=expiresAt, time=timestamp]
  proxy-events                   148432        0      0  2026-08-31T16:31:22.104Z   [stamp=expiresAt, time=timestamp]
  credential-lifecycle-events     26887        0      0  2026-08-23T12:35:32.299Z   [stamp=expiresAt, time=at]

  stamped = rows still carrying the vestigial stamp; past = rows whose stamp is already past.
  For credential-lifecycle-events the oldest is on `at`; for dispatch-history on `dispatchedAt`.

## Stray TTL indexes (`expireAfterSeconds` outside email-magic-links)

  The only legitimate TTL is email-magic-links.expiresAt; it is never a stray and is never dropped.
  none — no stray TTL index found on the six evidence collections or observation-sessions.

## Drop candidates (exact replacement index present — safe to recommend)

  dispatch-history:historyExpiresAt_1  key={"historyExpiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index dispatch-history:historyExpiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

  prompt-traces:urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index prompt-traces:urlKey_1_expiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

  foreman-status:urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index foreman-status:urlKey_1_expiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

  llm-call-log:urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index llm-call-log:urlKey_1_expiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

  llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1  key={"urlKey":1,"issueIdentifier":1,"expiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

  proxy-events:urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    node scripts/retention-lifetime-pass-lin3157.js --drop-index proxy-events:urlKey_1_expiresAt_1
    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)

## Withheld (replacement missing or wrong shape — do NOT drop)

  none.

Dry run — nothing was written. Re-run with --execute to unset the stamps (after John's recorded yes, LIN-3164 comment 5d3433ad).
```

Gate verdict: **PASS** — the six candidates were exactly
`dispatch-history:historyExpiresAt_1`, `prompt-traces:urlKey_1_expiresAt_1`,
`foreman-status:urlKey_1_expiresAt_1`, `llm-call-log:urlKey_1_expiresAt_1`,
`llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1`,
`proxy-events:urlKey_1_expiresAt_1`; withheld none; no stray TTL
(`email-magic-links.expiresAt` TTL never listed).

## Before-number

The ticket does not define the metric; recorded locally as the four paged-list
winning plans from `scripts/explain-paged-lists-lin3163.js` plus per-collection
`collStats` index count / `totalIndexSize`.

Explain (before) — `[lin3163] OVERALL: PASS`:

```
[lin3163] urlKey=linearviewer

shape                                                verdict  reasons
index present: proxy-events urlKey_1_timestamp_-1__id_-1 PASS     
index present: foreman-status urlKey_1_timestamp_-1__id_-1 PASS     
index present: llm-call-log urlKey_1_timestamp_-1__id_-1 PASS     
index present: prompt-traces urlKey_1_timestamp_-1__seq_-1__id_-1 PASS     
proxy-events page 1 (limit 50)                       PASS     
proxy-events deep page (skip 5000, limit 50)         PASS     
prompt-traces page 1 (limit 50)                      PASS     
llm-call-log page 1 (limit 50)                       PASS     
foreman-status page 1 (limit 20)                     PASS     
foreman-status task=LIN-2397 (limit 20)              PASS     
foreman-status live-console range (limit 20)         PASS     
proxy-events countDocuments({urlKey})                PASS     

[lin3163] OVERALL: PASS
```

`collStats` / index inventory (before):

```
### dispatch-history
  count=11089 size=116806119 nIndexes=10 totalIndexSize=2392064
    _id_  key={"_id":1}
    urlKey_1  key={"urlKey":1}
    historyExpiresAt_1  key={"historyExpiresAt":1}
    urlKey_1_issueIdentifier_1  key={"urlKey":1,"issueIdentifier":1}
    urlKey_1_sessionId_1  key={"urlKey":1,"sessionId":1}
    urlKey_1_resolvedAt_-1  key={"urlKey":1,"resolvedAt":-1}
    urlKey_1_followUpTo_1  key={"urlKey":1,"followUpTo":1}
    urlKey_1_sessionGroupId_1  key={"urlKey":1,"sessionGroupId":1}
    urlKey_1_rootItemId_1  key={"urlKey":1,"rootItemId":1}
    urlKey_1_producingItemId_1_producingItemAttempt_-1  key={"urlKey":1,"producingItemId":1,"producingItemAttempt":-1}
### prompt-traces
  count=7639 size=964716717 nIndexes=4 totalIndexSize=1245184
    _id_  key={"_id":1}
    urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__seq_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_seq":-1,"_id":-1}
### foreman-status
  count=16 size=11841 nIndexes=6 totalIndexSize=188416
    _id_  key={"_id":1}
    urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    urlKey_1_taskIdentifier_1  key={"urlKey":1,"taskIdentifier":1}
    urlKey_1_dispatchId_1  key={"urlKey":1,"dispatchId":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### llm-call-log
  count=18657 size=5727813 nIndexes=6 totalIndexSize=3637248
    _id_  key={"_id":1}
    urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    urlKey_1_issueIdentifier_1_expiresAt_1  key={"urlKey":1,"issueIdentifier":1,"expiresAt":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_issueIdentifier_1_timestamp_-1  key={"urlKey":1,"issueIdentifier":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### proxy-events
  count=148446 size=45470458 nIndexes=4 totalIndexSize=22540288
    _id_  key={"_id":1}
    urlKey_1_expiresAt_1  key={"urlKey":1,"expiresAt":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### credential-lifecycle-events
  count=26887 size=10193743 nIndexes=1 totalIndexSize=1552384
    _id_  key={"_id":1}
### observation-sessions
  count=306 size=66641093 nIndexes=3 totalIndexSize=143360
    _id_  key={"_id":1}
    urlKey_1  key={"urlKey":1}
    historyExpiresAt_1  key={"historyExpiresAt":1}
### email-magic-links
  count=0 size=0 nIndexes=3 totalIndexSize=12288
    _id_  key={"_id":1}
    emailNorm_1_createdAt_-1  key={"emailNorm":1,"createdAt":-1}
    expiresAt_1  key={"expiresAt":1} TTL=86400
```

## Drop sequence (table order, one index per call)

Each call is a separate invocation; the sequence stops at the first non-zero
exit. All six returned exit 0.

```sh
node scripts/retention-lifetime-pass-lin3157.js --drop-index dispatch-history:historyExpiresAt_1
node scripts/retention-lifetime-pass-lin3157.js --drop-index prompt-traces:urlKey_1_expiresAt_1
node scripts/retention-lifetime-pass-lin3157.js --drop-index foreman-status:urlKey_1_expiresAt_1
node scripts/retention-lifetime-pass-lin3157.js --drop-index llm-call-log:urlKey_1_expiresAt_1
node scripts/retention-lifetime-pass-lin3157.js --drop-index llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1
node scripts/retention-lifetime-pass-lin3157.js --drop-index proxy-events:urlKey_1_expiresAt_1
```

Evidence lines (per-call `[retention-pass] dropped …` plus wall-clock stamps):

```
===== DROP 1: dispatch-history:historyExpiresAt_1 prompt-traces:urlKey_1_expiresAt_1 foreman-status:urlKey_1_expiresAt_1 llm-call-log:urlKey_1_expiresAt_1 llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1 proxy-events:urlKey_1_expiresAt_1 at 2026-10-01T15:48:03Z =====
[retention-pass] dropped dispatch-history:historyExpiresAt_1
----- exit=0 at 2026-10-01T15:48:08Z -----
===== DROP 2: prompt-traces:urlKey_1_expiresAt_1 at 2026-10-01T15:48:14Z =====
[retention-pass] dropped prompt-traces:urlKey_1_expiresAt_1
----- exit=0 at 2026-10-01T15:48:20Z -----
===== DROP 3: foreman-status:urlKey_1_expiresAt_1 at 2026-10-01T15:48:20Z =====
[retention-pass] dropped foreman-status:urlKey_1_expiresAt_1
----- exit=0 at 2026-10-01T15:48:30Z -----
===== DROP 4: llm-call-log:urlKey_1_expiresAt_1 at 2026-10-01T15:48:30Z =====
[retention-pass] dropped llm-call-log:urlKey_1_expiresAt_1
----- exit=0 at 2026-10-01T15:48:35Z -----
===== DROP 5: llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1 at 2026-10-01T15:48:35Z =====
[retention-pass] dropped llm-call-log:urlKey_1_issueIdentifier_1_expiresAt_1
----- exit=0 at 2026-10-01T15:48:43Z -----
===== DROP 6: proxy-events:urlKey_1_expiresAt_1 at 2026-10-01T15:48:43Z =====
[retention-pass] dropped proxy-events:urlKey_1_expiresAt_1
----- exit=0 at 2026-10-01T15:48:57Z -----
```

## After-state verification (PASS)

Dry run AFTER the drops — `Drop candidates: none`, `Withheld: none`, no stray TTL:

```
# Retention-lifetime pass — DRY RUN (LIN-3157 C / LIN-3164)

Run at: 2026-10-01T15:49:04.955Z
HEAD: 542f28cb662713cd67830af58ace88251683ddd3

## Per-collection counts (each store's own stamp / time field)

  collection                      total  stamped   past  oldest
  dispatch-history                11094        0      0  2026-08-31T16:31:27.161Z   [stamp=historyExpiresAt, time=dispatchedAt]
  prompt-traces                    7641        0      0  2026-06-21T11:00:04.449Z   [stamp=expiresAt, time=timestamp]
  foreman-status                     16        0      0  2026-09-02T23:24:04.643Z   [stamp=expiresAt, time=timestamp]
  llm-call-log                    18661        0      0  2026-06-15T20:48:37.832Z   [stamp=expiresAt, time=timestamp]
  proxy-events                   148480        0      0  2026-08-31T16:31:22.104Z   [stamp=expiresAt, time=timestamp]
  credential-lifecycle-events     26887        0      0  2026-08-23T12:35:32.299Z   [stamp=expiresAt, time=at]

  stamped = rows still carrying the vestigial stamp; past = rows whose stamp is already past.
  For credential-lifecycle-events the oldest is on `at`; for dispatch-history on `dispatchedAt`.

## Stray TTL indexes (`expireAfterSeconds` outside email-magic-links)

  The only legitimate TTL is email-magic-links.expiresAt; it is never a stray and is never dropped.
  none — no stray TTL index found on the six evidence collections or observation-sessions.

## Drop candidates (exact replacement index present — safe to recommend)

  none.
## Withheld (replacement missing or wrong shape — do NOT drop)

  none.

Dry run — nothing was written. Re-run with --execute to unset the stamps (after John's recorded yes, LIN-3164 comment 5d3433ad).
```

Explain (after) — still `[lin3163] OVERALL: PASS`; every replacement present and
every paged-list plan still wins the extended index with no blocking SORT:

```
[lin3163] urlKey=linearviewer

shape                                                verdict  reasons
index present: proxy-events urlKey_1_timestamp_-1__id_-1 PASS     
index present: foreman-status urlKey_1_timestamp_-1__id_-1 PASS     
index present: llm-call-log urlKey_1_timestamp_-1__id_-1 PASS     
index present: prompt-traces urlKey_1_timestamp_-1__seq_-1__id_-1 PASS     
proxy-events page 1 (limit 50)                       PASS     
proxy-events deep page (skip 5000, limit 50)         PASS     
prompt-traces page 1 (limit 50)                      PASS     
llm-call-log page 1 (limit 50)                       PASS     
foreman-status page 1 (limit 20)                     PASS     
foreman-status task=LIN-1220 (limit 20)              PASS     
foreman-status live-console range (limit 20)         PASS     
proxy-events countDocuments({urlKey})                PASS     

[lin3163] OVERALL: PASS
```

`collStats` / index inventory (after):

```
### dispatch-history
  count=11094 size=116854592 nIndexes=9 totalIndexSize=2220032
    _id_  key={"_id":1}
    urlKey_1  key={"urlKey":1}
    urlKey_1_issueIdentifier_1  key={"urlKey":1,"issueIdentifier":1}
    urlKey_1_sessionId_1  key={"urlKey":1,"sessionId":1}
    urlKey_1_resolvedAt_-1  key={"urlKey":1,"resolvedAt":-1}
    urlKey_1_followUpTo_1  key={"urlKey":1,"followUpTo":1}
    urlKey_1_sessionGroupId_1  key={"urlKey":1,"sessionGroupId":1}
    urlKey_1_rootItemId_1  key={"urlKey":1,"rootItemId":1}
    urlKey_1_producingItemId_1_producingItemAttempt_-1  key={"urlKey":1,"producingItemId":1,"producingItemAttempt":-1}
### prompt-traces
  count=7641 size=965004674 nIndexes=3 totalIndexSize=1085440
    _id_  key={"_id":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__seq_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_seq":-1,"_id":-1}
### foreman-status
  count=16 size=11841 nIndexes=5 totalIndexSize=151552
    _id_  key={"_id":1}
    urlKey_1_taskIdentifier_1  key={"urlKey":1,"taskIdentifier":1}
    urlKey_1_dispatchId_1  key={"urlKey":1,"dispatchId":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### llm-call-log
  count=18661 size=5729061 nIndexes=4 totalIndexSize=2748416
    _id_  key={"_id":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_issueIdentifier_1_timestamp_-1  key={"urlKey":1,"issueIdentifier":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### proxy-events
  count=148480 size=45480981 nIndexes=3 totalIndexSize=20152320
    _id_  key={"_id":1}
    urlKey_1_timestamp_-1  key={"urlKey":1,"timestamp":-1}
    urlKey_1_timestamp_-1__id_-1  key={"urlKey":1,"timestamp":-1,"_id":-1}
### credential-lifecycle-events
  count=26887 size=10193743 nIndexes=1 totalIndexSize=1552384
    _id_  key={"_id":1}
### observation-sessions
  count=306 size=66656120 nIndexes=3 totalIndexSize=143360
    _id_  key={"_id":1}
    urlKey_1  key={"urlKey":1}
    historyExpiresAt_1  key={"historyExpiresAt":1}
### email-magic-links
  count=0 size=0 nIndexes=3 totalIndexSize=12288
    _id_  key={"_id":1}
    emailNorm_1_createdAt_-1  key={"emailNorm":1,"createdAt":-1}
    expiresAt_1  key={"expiresAt":1} TTL=86400
```

Index-count delta — exactly six removed, nothing else:

| collection | before | after | dropped |
| --- | ---: | ---: | --- |
| dispatch-history | 10 | 9 | `historyExpiresAt_1` |
| prompt-traces | 4 | 3 | `urlKey_1_expiresAt_1` |
| foreman-status | 6 | 5 | `urlKey_1_expiresAt_1` |
| llm-call-log | 6 | 4 | `urlKey_1_expiresAt_1`, `urlKey_1_issueIdentifier_1_expiresAt_1` |
| proxy-events | 4 | 3 | `urlKey_1_expiresAt_1` |
| credential-lifecycle-events | 1 | 1 | — |
| observation-sessions | 3 | 3 | — (live `historyExpiresAt_1` kept) |
| email-magic-links | 3 | 3 | — (`expiresAt_1` TTL=86400 kept) |

## Side-effect and dependent checks

- **`email-magic-links` TTL untouched:** still `expiresAt_1` with
  `TTL=86400` after the drops. Never a candidate, never a target.
- **No other index changed:** the six evidence collections each lost exactly
  their approved index(es); `credential-lifecycle-events` (1),
  `observation-sessions` (3, incl. the live `historyExpiresAt_1`) and
  `email-magic-links` (3) are byte-for-byte the same index sets as before.
- **No runtime consumer of the dropped names:** `git grep` for
  `historyExpiresAt_1` / `urlKey_1_expiresAt_1` /
  `urlKey_1_issueIdentifier_1_expiresAt_1` finds matches only in
  `scripts/retention-lifetime-pass-lin3157.js`, its unit test, and the LIN-3163
  explain test fixture — **none in `lib/`, `routes/`, or `server.js`.**
- **Replacements are the declared ones:** `lib/db-indexes.js` declares
  `{urlKey:1,resolvedAt:-1}` (dispatch-history), `{urlKey:1,timestamp:-1,_id:-1}`
  (proxy-events, foreman-status, llm-call-log),
  `{urlKey:1,issueIdentifier:1,timestamp:-1}` (llm-call-log), and
  `{urlKey:1,timestamp:-1,_seq:-1,_id:-1}` (prompt-traces). All four extended
  index names are present in the after-state `collStats`, and the after-state
  explain confirms the paged-list reads win them with no SORT.

## Outstanding / hand-back

- **After-number:** the ticket asks for an after-number four weeks after merge;
  not due in this session. The before-number is recorded here and on the ticket.
- **Merge:** deliberately not performed. Merging is close-out work.
