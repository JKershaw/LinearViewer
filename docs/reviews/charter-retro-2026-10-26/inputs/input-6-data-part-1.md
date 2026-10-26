**Input 6: data. Ticket index and work durations.** Fetched through the Harbour proxy on 26 Oct at about 07:45Z, for every ticket created or closed since 23 Oct. `priced_usd` is a floor: Haiku implementation runs are unpriced. `run_kinds` counts pipeline runs by stage, without wakes. The durations are from the Charter Tracker dashboard (another session's): hours from a ticket's first comment to its close, sized S (a move), M (a consolidation) or L (a page build). The `gap` rows are idle time between moves in one lane.

Part 1 of 2: the ticket index, first half.

```csv
id,state,parent,created,completed,priority,desc_chars,comments,comment_chars,runs,run_kinds,priced_usd,title
LIN-2246,Done,,2026-08-23T17:37,2026-10-24T21:30,High,15207,12,20898,0,,0,"Decompose routes/workspace-api.js (4,388 lines, 36 endpoints, 24 in-cl"
LIN-3279,Done,,2026-10-03T08:44,2026-10-23T11:06,Medium,3981,7,28860,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,5.16,Research: agent-filed tickets arrive with the fix decided; how do we g
LIN-3554,Done,,2026-10-13T08:03,2026-10-23T23:14,Medium,13672,6,24845,5,autopilot:1 close-out:1 custom:1 implementation:1 review:1,5.1,Seams: move task ordering out of lib/render-swipe.js into lib/task-ord
LIN-3754,Done,LIN-3613,2026-10-21T06:13,2026-10-24T21:30,High,2000,5,17050,0,,0,UI flank: tidy the seams around the page layer before the UI overhaul
LIN-3755,Done,LIN-3613,2026-10-21T06:13,2026-10-24T00:35,High,17399,6,33449,6,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 review:1,6.4,Seams: page renderers receive the route's workspace instead of looking
LIN-3756,Done,LIN-3613,2026-10-21T06:13,2026-10-24T09:23,High,8632,4,27544,8,autopilot:1 close-out:1 custom:2 design:1 implementation:1 plan:1 review:1,7.95,Pipeline merges record their own PR opened/merged times (time-to-merge
LIN-3759,Done,LIN-3613,2026-10-21T06:30,2026-10-23T12:20,High,38367,14,68463,12,autopilot:1 close-out:1 design:1 implementation:1 plan:3 plan-review:4 review:1,21.08,SD: a child's PENDING-EXTERNAL report should reach its parked parent (
LIN-3761,Done,,2026-10-21T08:34,2026-10-23T13:31,High,4660,4,10098,6,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 review:1,4.47,Library: wide tables are clipped and unreachable at 390/320 on 70 of 1
LIN-3762,Done,,2026-10-21T08:34,2026-10-23T13:36,High,4403,3,8909,5,autopilot:1 close-out:1 custom:1 implementation:1 review:1,3.79,"Archives 1-9: the muted text tier (sign-offs, figure labels, chips) is"
LIN-3763,Done,,2026-10-21T08:34,2026-10-23T14:05,Medium,4828,3,9089,7,autopilot:1 close-out:1 custom:2 implementation:1 plan:1 review:1,4.32,Dark theme: UA-blue links (1.89:1) and white native controls on the Ji
LIN-3765,Done,,2026-10-21T10:22,2026-10-23T10:18,Medium,60996,6,42082,7,autopilot:2 breakdown:1 plan:2 plan-review:1 research:1,14.07,"Integration & Surface Maturity Review (periodical run, fourth) — trend"
LIN-3766,Done,LIN-3765,2026-10-21T10:57,2026-10-23T10:18,Medium,28406,6,30849,19,autopilot:1 close-out:1 custom:1 implementation:4 plan:4 plan-review:7 review:1,41.94,"Integration & Surface Maturity run 4: report production (evidence, sco"
LIN-3767,Done,LIN-3765,2026-10-21T10:57,2026-10-23T10:18,Medium,2267,2,6691,1,review:1,5.61,Integration & Surface Maturity run 4: fresh-eyes PR review of the repo
LIN-3768,Done,LIN-3765,2026-10-21T10:57,2026-10-23T10:18,Medium,2201,2,2903,1,close-out:1,3.07,"Integration & Surface Maturity run 4: close-out (gate comments, merge,"
LIN-3771,Done,LIN-3613,2026-10-22T06:37,2026-10-23T10:37,High,4289,8,36464,10,autopilot:1 blocked:1 close-out:1 custom:3 design:1 implementation:1 plan:1 review:1,10.51,Email sign-in is being used by a form-spam bot: rate-limit and challen
LIN-3772,Done,LIN-3613,2026-10-23T08:40,2026-10-24T07:09,High,4535,22,103620,25,autopilot:1 blocked:2 close-out:2 custom:6 implementation:2 plan:4 plan-review:5 research:1 review:2,32.46,Give harbour-cat its own least-privileged MongoDB user instead of root
LIN-3773,Done,LIN-3490,2026-10-23T09:47,2026-10-23T10:03,High,1116,2,9535,1,custom:1,2.28,Incident: the GitHub integration errors on harbour.cat after the 23 Oc
LIN-3774,Done,LIN-3490,2026-10-23T10:03,2026-10-23T11:32,Urgent,8522,9,40192,11,autopilot:1 close-out:1 custom:1 implementation:1 plan:3 plan-review:3 review:1,17.86,"A Linear-primary workspace's GitHub binding is never re-minted, so its"
LIN-3775,Done,LIN-3490,2026-10-23T10:03,2026-10-23T12:53,Urgent,7082,9,53378,11,autopilot:1 close-out:1 custom:2 implementation:1 plan:2 plan-review:2 research:1 review:1,14.55,"Error pages say what failed: the source, the status and a reference to"
LIN-3776,Done,,2026-10-23T10:22,2026-10-23T11:04,No priority,14324,4,34629,5,autopilot:1 close-out:1 implementation:1 research:1 review:1,6.35,Security Review (periodical run): delta vs 2026-10-18 — verify the LIN
LIN-3777,Backlog,,2026-10-23T10:36,,Low,1404,1,445,0,,0,Count of refused email-sign-in sends on an ops surface (follow-up to L
LIN-3778,Backlog,,2026-10-23T10:44,,No priority,663,0,0,0,,0,Security [Med]: runner-kit token (take+dispatch) is readable by the di
LIN-3779,Done,,2026-10-23T10:44,2026-10-23T14:25,No priority,2655,4,9379,8,autopilot:1 close-out:1 custom:4 implementation:1 review:1,5.6,Security [Med]: Flight Companion remember stays on in auto-wake/boot t
LIN-3780,Done,,2026-10-23T10:44,2026-10-23T11:54,No priority,3846,5,15537,9,autopilot:1 close-out:1 custom:2 implementation:2 plan:1 review:2,6.67,Security [Med]: lib/secret-scan.js lacks the Railway incident secret t
LIN-3781,Backlog,,2026-10-23T11:02,,Medium,1336,1,445,0,,0,Harbour: §5 wake matrix does not bubble a child's [pending] on a termi
LIN-3782,Backlog,,2026-10-23T11:02,,Medium,1265,1,445,0,,0,Close-out prompt: a sibling-held joint gate is not the child's own PEN
LIN-3783,Backlog,,2026-10-23T11:02,,Medium,1445,1,445,0,,0,SD: a shielded RESUMING parent that never boots gets no LIN-2510 boots
LIN-3784,Backlog,,2026-10-23T11:02,,Low,1034,1,445,0,,0,"SD: no marker when the pending-child relay hits its cap of 3, after wh"
LIN-3785,Backlog,,2026-10-23T11:05,,Medium,2053,1,445,0,,0,Measure selector routes to implementation with no research or plan on 
LIN-3786,Done,,2026-10-23T11:07,2026-10-23T11:36,No priority,12335,5,31878,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,7.34,Dependency & Supply-Chain Review (periodical run): delta vs 2026-06-25
LIN-3787,Done,,2026-10-23T11:23,2026-10-23T19:20,Medium,3860,4,24604,7,autopilot:1 close-out:1 custom:1 design:1 implementation:1 plan:1 review:1,6.01,Vendored DOMPurify 3.2.4 → 3.4.17 and put vendored client libs under a
LIN-3788,Done,,2026-10-23T11:23,2026-10-23T20:14,Medium,3562,4,27039,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,6.03,Pin the Node runtime and move CI off EOL Node 20
LIN-3789,Done,LIN-3490,2026-10-23T11:30,2026-10-23T12:10,Urgent,4825,5,14498,8,autopilot:1 close-out:1 custom:2 implementation:1 plan:1 plan-review:1 review:1,5.65,Email sign-in: remove the site-wide send ceiling (it silently blocks r
LIN-3790,Done,,2026-10-23T11:32,2026-10-23T19:13,Medium,22851,11,39374,11,autopilot:1 close-out:1 custom:2 implementation:1 plan:1 plan-review:1 research:1 retrospective-audit:1 review:1 triage:1,16.4,Legacy and refresh-token-kind secondary bindings still 503 the dashboa
LIN-3791,Done,,2026-10-23T11:40,2026-10-23T12:14,Medium,18396,3,7235,2,autopilot:1 research:1,7.29,Onboarding & Cold-Start Review — periodical run #3 (trend vs 2026-09-2
LIN-3792,Backlog,,2026-10-23T11:53,,Low,742,1,445,0,,0,Route error pages name Linear for a GitHub source failure: make the fi
LIN-3793,Backlog,,2026-10-23T11:53,,Low,1089,1,445,0,,0,classifyUpstreamError / isAuthError treat every 403 as auth and emit L
LIN-3794,Done,,2026-10-23T11:54,2026-10-23T18:22,Medium,4345,6,21721,8,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 plan-review:1 research:1 review:1,6.85,"Secret scan: compare the Resend, Atlassian and Mongo rules against the"
LIN-3795,Done,,2026-10-23T11:54,2026-10-23T17:26,High,4629,11,48286,13,autopilot:1 close-out:1 custom:2 implementation:1 plan:3 plan-review:3 research:1 review:1,14.65,Public /t/ pages: mask Harbour's own unprefixed 32-byte base64url toke
LIN-3796,Done,,2026-10-23T11:54,2026-10-23T18:35,Medium,4631,7,27327,9,autopilot:1 close-out:1 custom:1 implementation:2 plan:1 research:1 review:2,9.01,Public /t/ pages: a PEM split across <br>-separated text nodes is not 
LIN-3797,Done,,2026-10-23T12:17,2026-10-23T13:17,No priority,14585,5,28887,5,autopilot:1 close-out:1 implementation:1 research:1 review:1,9.49,Test Coverage Gap Review (periodical run): delta vs 2026-06-25 baselin
LIN-3798,Done,,2026-10-23T12:51,2026-10-23T17:29,Urgent,2699,5,12839,5,autopilot:1 bug:1 close-out:1 custom:1 review:1,11.19,Retry-hidden e2e failures: make Dispatch API stray-queue-item and coll
LIN-3799,Backlog,,2026-10-23T12:51,,Medium,559,2,719,0,,0,CI must prove the real-Mongo suites ran (skipped suites are not counte
LIN-3800,Backlog,,2026-10-23T12:57,,Low,1977,1,445,0,,0,Inline comments still name the deleted meta-prompt (LIN-3300)
LIN-3801,Done,,2026-10-23T13:21,2026-10-23T14:05,No priority,13715,6,42311,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,8.22,"API Quality Review (periodical run, second): delta vs the 2026-06-25 b"
LIN-3802,Backlog,,2026-10-23T13:30,,Medium,2692,1,445,0,,0,Rendered Markdown in issue descriptions and comments has no table scro
LIN-3803,Backlog,,2026-10-23T13:36,,Medium,2775,1,445,0,,0,"Archives 5, 6, 7, 8, 9: non-muted text (amber accent, blue link/code, "
LIN-3804,Done,LIN-3490,2026-10-23T13:37,2026-10-23T14:14,Medium,4192,4,23043,5,autopilot:1 close-out:1 implementation:1 research:1 review:1,6.79,"docs/v1.md: bring the ""What exists and what is missing"" table up to da"
LIN-3805,Done,,2026-10-23T13:41,2026-10-23T19:33,High,5045,12,52305,15,autopilot:1 close-out:1 custom:3 implementation:2 plan:3 plan-review:3 review:2,23.31,"Dispatch/runner lane: a store fault must answer a retryable 503, never"
LIN-3806,Backlog,,2026-10-23T13:41,,Medium,1407,3,1340,0,,0,Dispatch take and terminal feedback are not retry-safe: re-take answer
LIN-3807,Backlog,,2026-10-23T13:41,,Medium,1848,2,649,0,,0,Proxy create and PATCH: refuse unknown or malformed fields with 400 as
LIN-3808,Done,,2026-10-23T14:12,2026-10-23T17:44,Medium,4197,6,12082,7,autopilot:1 close-out:1 custom:1 implementation:2 review:2,4.05,docs/v1.md owner prose has four stale facts (LIN-3213 and LIN-3080 are
LIN-3809,Done,,2026-10-23T14:25,2026-10-23T21:01,Medium,15566,12,29770,11,autopilot:1 close-out:1 custom:2 implementation:1 plan:2 plan-review:2 research:1 review:1,8.78,SD: re-copy Harbour's runner-kit contract.json (LIN-3699 auth rows) an
LIN-3810,Done,,2026-10-23T16:24,2026-10-23T16:57,No priority,13927,5,10438,4,autopilot:1 close-out:1 research:1 review:1,8.05,"Data & Fetch Architecture Review (periodical run, baseline): store-vs-"
LIN-3811,Done,,2026-10-23T16:39,2026-10-23T21:54,High,24882,15,56260,16,autopilot:1 blocked:1 close-out:1 custom:4 design:1 implementation:1 plan:3 plan-review:3 review:1,19.9,dispatch-history: the 30-day read window has no index — split index ro
LIN-3812,Done,,2026-10-23T16:39,2026-10-24T00:28,High,6395,12,55537,14,autopilot:1 close-out:1 custom:2 implementation:2 plan:3 plan-review:3 review:2,34.05,Dispatch store: make the lean/digest shape the default read and persis
LIN-3813,Backlog,,2026-10-23T16:39,,Medium,1643,2,672,0,,0,One in-process cache primitive (TTL + capacity + credential key) and a
LIN-3814,Done,,2026-10-23T17:01,2026-10-23T20:16,No priority,14870,5,34117,6,autopilot:1 close-out:1 implementation:1 research:2 review:1,8.88,"Performance / Scale Review (periodical run, baseline): measured page/e"
LIN-3815,Backlog,,2026-10-23T17:22,,Medium,2893,1,445,0,,0,E2E server still makes live egress calls: OpenRouter model catalog and
LIN-3816,Backlog,,2026-10-23T17:23,,Low,1879,1,445,0,,0,Decide: should test-mode Linear answer `test-token` with mock data so 
LIN-3817,Backlog,,2026-10-23T17:26,,Medium,2062,1,445,0,,0,Check Harbour OS for assumptions about the old 43-char Harbour token s
LIN-3818,Done,,2026-10-23T18:35,2026-10-23T21:48,High,5333,13,66005,17,autopilot:1 close-out:1 custom:2 implementation:2 plan:4 plan-review:4 research:1 review:2,18.94,Public /t/ pages: a truncated PEM followed by trailing text is served 
LIN-3819,Backlog,,2026-10-23T18:35,,Low,1762,1,445,0,,0,Masker: a PEM split by block elements or per-line inline wrappers is n
LIN-3820,Todo,,2026-10-23T18:46,,High,14151,8,42581,1,design:1,2.79,"Every LLM use, classed and routed from one place: design the model, th"
LIN-3821,Backlog,,2026-10-23T18:46,,High,3802,2,1130,0,,0,"Spend the Max 20x API credit through OpenRouter BYOK, and price the mo"
LIN-3822,Backlog,,2026-10-23T19:08,,Medium,4605,2,1006,0,,0,Settings provider list shows no active binding on a legacy workspace w
LIN-3823,Backlog,,2026-10-23T19:26,,Medium,1683,1,445,0,,0,SD: re-copy Harbour's runner-kit contract.json again (LIN-3805 `store`
LIN-3824,Backlog,,2026-10-23T20:04,,Medium,1360,0,0,0,,0,secret-scan: private-key-block lazy body is O(k*n) on repeated BEGIN m
LIN-3825,Done,,2026-10-23T20:19,2026-10-23T21:20,No priority,13885,6,38042,8,autopilot:1 close-out:1 custom:2 implementation:1 plan:1 research:1 review:1,8.79,"Comprehension-Debt Review (periodical run 4, first since 2026-07-01): "
LIN-3826,Backlog,,2026-10-23T20:36,,Low,4852,0,0,0,,0,Legacy GitHub/Linear/Jira-OAuth secondary bindings degrade on every lo
LIN-3827,Done,,2026-10-23T20:42,2026-10-25T16:04,Medium,4335,12,49335,13,autopilot:2 close-out:1 implementation:1 plan:4 plan-review:4 review:1,17.24,"Retire stale landing-status comments (""INERT"", ""no production caller"","
LIN-3828,Backlog,,2026-10-23T20:42,,Medium,1551,0,0,0,,0,Name the [working] heartbeat grammar at both ends and make the documen
LIN-3829,Done,,2026-10-23T20:42,2026-10-25T11:51,Medium,4134,3,8864,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,3.22,Add a dropped-reference retention check to the rebuild kit (scripts/co
LIN-3830,Done,,2026-10-23T20:43,2026-10-24T00:38,High,13903,4,10906,6,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 review:1,4.67,Cold resumes and stall re-fires continue on the session's own model an
LIN-3831,Done,,2026-10-23T20:57,2026-10-23T22:10,No priority,23117,7,38922,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,13.74,Drift & Coherence Review (trend vs 2026-10-19): verify LIN-3672/3673/3
LIN-3832,Done,,2026-10-23T21:04,2026-10-23T22:40,No priority,14530,4,21876,6,autopilot:1 close-out:1 custom:1 implementation:1 research:1 review:1,6.32,"Seams & Tangles Review (periodical run): area knots, dependency direct"
LIN-3833,Done,LIN-3757,2026-10-23T21:35,2026-10-25T17:51,Medium,15194,44,149631,34,autopilot:1 blocked:2 close-out:1 custom:10 implementation:5 plan:5 plan-review:5 research:1 review:4,50.86,"Home: the opened task leads with its state and has one run control, wi"
LIN-3834,Backlog,,2026-10-23T21:40,,Medium,2109,0,0,0,,0,CI: add an auth-enabled mongod witness that ensureIndexes succeeds wit
LIN-3835,Backlog,,2026-10-23T21:45,,Medium,3125,0,0,0,,0,One token-auth failure answer: 401 rejected / retryable 503 store fail
LIN-3836,Backlog,,2026-10-23T21:45,,Medium,2616,0,0,0,,0,Workspace-removal token revocation covers merged-alias accounts: accou
LIN-3837,Done,LIN-3490,2026-10-23T23:34,2026-10-24T00:03,High,10221,5,12626,6,autopilot:1 close-out:1 custom:2 implementation:1 review:1,3.02,Seams: move stepKindWord and STEP_KIND_WORDS from lib/render-run-steps
LIN-3838,Backlog,,2026-10-24T00:28,,Medium,1995,0,0,0,,0,list_active_sessions rebuilds the whole workspace's sessions on every 
LIN-3839,Backlog,,2026-10-24T00:28,,Low,1755,0,0,0,,0,Observer sweeps derive from raw feedback; decide whether they should u
LIN-3840,Done,LIN-3490,2026-10-24T00:38,2026-10-24T01:51,High,27451,8,34768,7,autopilot:1 close-out:1 implementation:1 plan:1 plan-review:2 review:1,16.04,Free the seam: turn the source-text pins on routes/dashboard.js (run p
LIN-3841,Done,,2026-10-24T01:50,2026-10-25T09:22,Medium,6015,6,21881,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,5.57,"free-tier-model-clamp-wiring FILES census is stale: flight-companion, "
LIN-3842,Done,LIN-2246,2026-10-24T06:11,2026-10-24T08:15,High,24302,7,29752,9,autopilot:1 close-out:1 custom:2 implementation:2 plan:1 review:2,8.33,"Move: the prompt-generation routes (GET /api/prompt, both GET /api/aut"
LIN-3843,Backlog,,2026-10-24T07:08,,Low,1685,0,0,0,,0,Rulings live-on-anchor predicate is duplicated in routes/proxy-rulings
LIN-3844,Backlog,,2026-10-24T07:08,,Medium,1569,0,0,0,,0,Decide two kept dashboard oddities: answer/shelve/keep store fault ans
LIN-3845,Backlog,,2026-10-24T07:09,,High,2799,0,0,0,,0,Production cutover: switch harbour-cat from MongoDB root to its own re
LIN-3846,Done,LIN-3757,2026-10-24T07:42,2026-10-24T17:59,Medium,67465,14,42008,14,autopilot:1 close-out:2 custom:4 implementation:2 plan:2 plan-review:2 review:1,47.64,"Settings: one page per area, built from three kinds of row, with Model"
LIN-3847,Done,LIN-3490,2026-10-24T07:59,2026-10-24T08:27,Medium,5253,3,7752,4,autopilot:1 close-out:1 implementation:1 review:1,2.34,"Method: the verbatim share is a prompt for a question, not a gate (doc"
LIN-3848,Done,LIN-3846,2026-10-24T08:01,2026-10-24T08:56,Medium,6106,3,11788,6,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 review:1,8.16,Settings: remove the nine switches that do nothing or are superseded (
LIN-3849,Done,LIN-3846,2026-10-24T08:01,2026-10-24T11:15,Medium,9736,10,50310,13,autopilot:1 close-out:1 custom:1 implementation:1 plan:4 plan-review:4 review:1,38.1,"Settings: run controls and key tools follow rules, not the dispatch an"
LIN-3850,Done,,2026-10-24T08:15,2026-10-25T08:28,Medium,4888,4,6730,4,autopilot:1 close-out:1 implementation:1 review:1,1.78,Unit carriers for two replay-only prompt-route guards: /api/prompt ?so
LIN-3851,Done,LIN-3490,2026-10-24T08:32,2026-10-24T08:56,Medium,4865,3,7642,5,autopilot:1 close-out:1 custom:1 implementation:1 review:1,2.67,Replay kit: virtual-clock pump fires timers before queued setImmediate
LIN-3852,Done,LIN-3820,2026-10-24T08:36,2026-10-24T09:27,High,6654,11,29599,10,autopilot:1 close-out:2 custom:2 implementation:1 plan:1 plan-review:1 retrospective-audit:1 review:1,12.11,"Model routing · 1 — Jobs: one registry of every LLM use, each with a g"
LIN-3853,Done,LIN-3820,2026-10-24T08:36,2026-10-24T12:29,High,10196,13,42978,13,autopilot:1 close-out:1 custom:2 implementation:2 plan:3 plan-review:3 review:1,24.13,"Model routing · 2 — One settings store for every job (job settings, gr"
LIN-3854,Done,LIN-3820,2026-10-24T08:36,2026-10-24T15:31,High,7816,8,23416,11,autopilot:1 close-out:1 custom:2 implementation:3 plan:1 plan-review:1 review:2,11.17,Model routing · 3 — Proxy: read the model table; write it behind one w
LIN-3855,Done,LIN-3820,2026-10-24T08:36,2026-10-25T12:42,High,27277,24,105665,16,autopilot:1 close-out:1 custom:2 implementation:3 plan:3 plan-review:3 research:1 review:2,22.47,"Model routing · 4 — Settings › Models: every job, its spend and its mo"
LIN-3856,Done,LIN-3820,2026-10-24T08:36,2026-10-24T13:17,High,5271,9,28554,9,autopilot:1 close-out:2 implementation:1 plan:2 plan-review:2 review:1,9.26,Model routing · D2 — The session-summary precompute and the run paragr
LIN-3857,Done,LIN-3820,2026-10-24T08:36,2026-10-24T17:55,High,6257,10,42418,16,autopilot:1 blocked:1 close-out:2 custom:4 implementation:3 plan:2 plan-review:2 review:1,17.34,"Model routing · D3 — Effort is never dropped silently (opencode, runne"
LIN-3858,Done,LIN-3820,2026-10-24T08:36,2026-10-24T09:51,Low,3103,3,9198,4,autopilot:1 close-out:1 implementation:1 review:1,2.91,Model routing · D4 — Proxy instructions: `/dispatch` does fill a blank
LIN-3859,Todo,LIN-3820,2026-10-24T08:36,,Low,1611,0,0,0,,0,Model routing · D5 — Count subagent tokens in SD sessions; price a lin
LIN-3860,Done,LIN-3490,2026-10-24T08:39,2026-10-24T09:21,Medium,8435,3,11830,7,autopilot:1 close-out:1 custom:2 implementation:1 plan:1 review:1,5.1,Seams & Tangles also reads change coupling: which areas keep changing 
LIN-3861,Done,LIN-2246,2026-10-24T08:48,2026-10-24T10:33,High,35749,12,51822,14,autopilot:1 breakdown:1 close-out:1 custom:3 implementation:2 plan:2 plan-review:2 review:2,21.9,Free the seam: turn the source-text pins on the workspace-API unit (ro
LIN-3862,Done,,2026-10-24T09:21,2026-10-25T14:20,Low,3427,4,8671,5,autopilot:1 close-out:1 implementation:2 review:1,2.16,"Docs: Seams & Tangles is still described as ""the import map"" in the im"
LIN-3863,Done,,2026-10-24T09:23,2026-10-25T14:03,Medium,4976,4,24206,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,5.16,Task page: a person setting Done does not record the merged close-out 
LIN-3864,Done,,2026-10-24T09:26,2026-10-25T13:21,Low,3837,3,8528,4,autopilot:1 close-out:1 implementation:1 review:1,2.3,LLM call log: session-summary precompute rows are indistinguishable fr
LIN-3865,Done,LIN-3811,2026-10-24T09:31,2026-10-24T10:29,High,10258,5,37057,8,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 plan-review:1 research:1 review:1,9.24,"Deferred indexes: build them in production now, then let the server bu"
LIN-3866,Done,,2026-10-24T09:51,2026-10-25T13:52,Low,4699,3,9790,4,autopilot:1 close-out:1 implementation:1 review:1,2.47,docs/dispatch-integration.md still says a blank model/harness keeps th
LIN-3867,Done,,2026-10-24T10:33,2026-10-25T09:00,Medium,4181,3,9492,4,autopilot:1 close-out:1 implementation:1 review:1,2.22,llm-jobs-census does not see a model call imported under an alias
LIN-3868,Done,,2026-10-24T10:33,2026-10-25T11:12,Low,3604,3,7567,4,autopilot:1 close-out:1 implementation:1 review:1,1.8,Egress census pins a comment: the raw runAudit( count breaks when comm
LIN-3869,Done,,2026-10-24T10:33,2026-10-25T14:24,Low,3168,3,4469,4,autopilot:1 close-out:1 implementation:1 review:1,1.45,Stale comment in free-tier-model-clamp-wiring: DISPLAY_ONLY entry name
LIN-3870,Done,,2026-10-24T11:13,2026-10-25T09:36,Medium,7137,5,12760,6,autopilot:2 blocked:1 close-out:1 implementation:1 review:1,3.61,"llm-jobs census passes a model call with no feature, and any non-liter"
LIN-3871,Done,LIN-3861,2026-10-24T11:21,2026-10-24T11:39,Medium,3036,3,6839,4,autopilot:1 close-out:1 implementation:1 review:1,2.0,move-probe.test.js: withLayout deletes its temp directory before the a
LIN-3872,Done,LIN-2246,2026-10-24T11:36,2026-10-24T12:10,High,20132,5,27127,5,autopilot:1 close-out:1 custom:1 implementation:1 review:1,4.43,"Move: the issue-read routes (GET /api/comments/:issueId, GET /api/deta"
LIN-3873,Done,,2026-10-24T12:00,2026-10-25T08:43,Medium,4689,7,15556,6,autopilot:1 close-out:1 custom:1 implementation:1 review:2,3.44,"Pin /api/image's missing-url, https-only, `..`, unparsable-URL, redire"
LIN-3874,Backlog,,2026-10-24T12:29,,Low,3475,0,0,0,,0,"Model routing: retire the old model preference fields (modelId, aiMode"
LIN-3875,Done,,2026-10-24T13:14,2026-10-24T13:54,High,5739,4,24331,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,5.64,Session precompute spends the shared free-tier key without the hourly 
LIN-3876,Done,LIN-2246,2026-10-24T13:22,2026-10-24T14:23,High,36616,5,36499,6,autopilot:1 close-out:1 custom:2 implementation:1 review:1,6.05,"Move: the issue-write routes (POST /api/comments/:issueId, POST /api/i"
LIN-3877,Done,LIN-2246,2026-10-24T15:18,2026-10-24T17:06,High,35631,7,38648,8,autopilot:1 close-out:3 custom:1 implementation:1 plan-review:1 review:1,9.57,"Move: the scan routes (GET and POST /api/scan/:issueId, POST /api/scan"
LIN-3878,Backlog,,2026-10-24T15:30,,Low,2105,0,0,0,,0,Role check for workspace feature toggles (any member can enable agent 
LIN-3879,Done,,2026-10-24T16:02,2026-10-25T08:01,Medium,4951,3,6771,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,2.63,Scan routes: three guards have no unit test that fails when the guard 
LIN-3880,Done,,2026-10-24T16:02,2026-10-25T10:51,High,5493,3,11494,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,4.68,Replay kit rung7 fakes are stale against LIN-3853: an unpatched run is
```
