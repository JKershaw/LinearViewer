**Input 6, part 2 of 2:** the ticket index, second half, and the durations.

```csv
id,state,parent,created,completed,priority,desc_chars,comments,comment_chars,runs,run_kinds,priced_usd,title
LIN-3881,Done,,2026-10-24T17:05,2026-10-25T11:33,Low,4132,3,10110,4,autopilot:1 close-out:1 implementation:1 review:1,2.4,Census clone detector pairs live handlers with their pinned replicas u
LIN-3882,Done,LIN-3820,2026-10-24T17:05,2026-10-24T19:06,High,9126,20,69277,16,autopilot:1 close-out:2 custom:5 implementation:1 plan:2 plan-review:2 research:1 review:2,20.56,Model routing · Model capabilities and prices come from the OpenRouter
LIN-3883,Done,LIN-2246,2026-10-24T17:09,2026-10-24T17:47,High,10194,6,28128,6,autopilot:1 close-out:1 custom:1 implementation:1 plan-review:1 review:1,5.61,Move: the audit route (GET /api/audit) out of createWorkspaceApiRoutes
LIN-3884,Backlog,,2026-10-24T17:31,,Low,2127,0,0,0,,0,Report a dropped opencode effort in the responses of the four non-entr
LIN-3885,Done,,2026-10-24T17:46,2026-10-25T07:53,Medium,4568,3,7578,4,autopilot:1 close-out:1 implementation:1 review:1,1.8,audit route: behaviour tests for failureOf notFound:false and the getW
LIN-3886,Done,LIN-3846,2026-10-24T17:49,2026-10-25T08:32,Medium,12892,6,5429,0,,0,Settings polish: untangle and rebuild the shared UI pieces it stands o
LIN-3887,Done,LIN-3886,2026-10-24T18:11,2026-10-24T20:19,High,18631,6,26048,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,11.62,"Settings untangle, 1 of 4 (Own): write down where each shared UI decis"
LIN-3888,Done,LIN-3886,2026-10-24T18:11,2026-10-24T22:58,High,13838,15,106993,14,autopilot:1 close-out:1 custom:1 implementation:2 plan:3 plan-review:3 research:1 review:2,21.88,"Settings untangle, 2 of 4 (Free the seam): move the tests and hooks th"
LIN-3889,Done,LIN-3886,2026-10-24T18:11,2026-10-25T01:33,High,15074,16,81885,10,autopilot:1 close-out:1 implementation:2 plan:2 plan-review:2 review:2,18.99,"Settings untangle, 3 of 4 (Consolidate): one authority for each shared"
LIN-3890,Done,LIN-3886,2026-10-24T18:11,2026-10-25T08:34,High,20838,24,140609,18,autopilot:1 close-out:1 custom:1 implementation:3 plan:4 plan-review:4 research:1 review:3,37.64,"Settings untangle, 4 of 4 (Rebuild): design the Settings pieces in /st"
LIN-3891,Done,LIN-3490,2026-10-24T18:27,2026-10-24T19:20,Medium,7764,4,35558,6,autopilot:1 close-out:1 custom:2 research:1 review:1,14.26,Pipeline churn: find which runs a ticket needs between launch and Done
LIN-3892,Todo,LIN-3490,2026-10-24T18:40,,High,6625,3,4678,0,,0,"UI sweep: bring every kept page onto the shared pieces, one page at a "
LIN-3893,Done,LIN-2246,2026-10-24T18:43,2026-10-24T19:30,High,22959,7,40709,6,autopilot:1 close-out:1 custom:1 implementation:1 plan-review:1 review:1,7.32,Move: the feedback intake route (POST /api/feedback) out of createWork
LIN-3894,Done,LIN-2246,2026-10-24T18:43,2026-10-24T20:11,High,38559,10,42876,7,autopilot:1 blocked:1 close-out:1 implementation:1 plan:1 plan-review:1 review:1,7.92,Move: the sessions route and the run-evidence / close-out routes (GET 
LIN-3895,Backlog,LIN-3490,2026-10-24T19:01,,Medium,3781,0,0,0,,0,Chat pages: the end goal is one combined chat that agents join (design
LIN-3896,Backlog,LIN-3490,2026-10-24T19:01,,Low,1488,0,0,0,,0,"Ship Biscuit: tell the story of tasks moving through the system, not o"
LIN-3897,Canceled,,2026-10-24T19:19,,High,2906,1,169,0,,0,Close-out: a post-deploy check the run cannot do never holds the close
LIN-3898,Canceled,,2026-10-24T19:19,,High,2355,1,169,0,,0,simple-dispatcher: a worker in EXECUTING with no tool activity waits 6
LIN-3899,Canceled,,2026-10-24T19:19,,Medium,2223,1,169,0,,0,CI-wake sweep sends 'CI finished' prompts to autopilots parked on a ch
LIN-3900,Canceled,,2026-10-24T19:19,,Medium,2191,1,169,0,,0,Stage selector: pick implementation after a conditional review Approve
LIN-3901,Canceled,,2026-10-24T19:19,,Low,1958,2,1243,0,,0,"Rulings: ask for every fact a question needs in one ruling, and don't "
LIN-3902,Backlog,,2026-10-24T19:19,,Low,1553,0,0,0,,0,Workspace API: a completed-since read so per-week instruments can list
LIN-3903,Done,LIN-3490,2026-10-24T19:29,2026-10-24T20:14,High,7754,9,24654,8,autopilot:1 close-out:1 implementation:1 plan:2 plan-review:2 review:1,8.47,Close-out: a post-deploy check the run can't do never holds the close 
LIN-3904,Done,LIN-3490,2026-10-24T19:29,2026-10-24T20:53,High,3725,7,10751,6,autopilot:1 close-out:1 custom:2 implementation:1 review:1,4.29,"CI-wake sweep: send ""CI finished"" only to a worker parked on its PR, n"
LIN-3905,Done,LIN-3490,2026-10-24T19:29,2026-10-24T22:34,High,14898,6,18075,6,autopilot:1 implementation:2 plan:1 review:2,5.98,Stall: re-ask a session hung in a tool well before the 60-minute fails
LIN-3906,Done,LIN-3490,2026-10-24T19:29,2026-10-25T20:51,Medium,3655,9,22808,7,autopilot:1 close-out:1 custom:1 implementation:2 review:2,5.06,"Stage selector: an Approve means close-out, and one PR in ordered comm"
LIN-3907,Done,,2026-10-24T19:29,2026-10-25T10:49,Low,4580,4,24513,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,5.33,Feedback intake: the 'image too large' 413 arm is unreachable because 
LIN-3908,Done,,2026-10-24T19:29,2026-10-25T10:00,Low,4111,3,9032,4,autopilot:1 close-out:1 implementation:1 review:1,1.97,Feedback autopilot kickoff is built for http://undefined when the requ
LIN-3909,Backlog,,2026-10-24T19:29,,Low,1732,0,0,0,,0,Move enqueueFeedbackTriage / enqueueFeedbackAutopilot out of routes/wo
LIN-3910,Done,,2026-10-24T19:29,2026-10-25T07:29,Medium,3794,4,6750,4,autopilot:1 close-out:1 implementation:1 review:1,1.66,connection-access-guard's file-named PROTECTED_MODULES list does not c
LIN-3911,Done,,2026-10-24T19:29,2026-10-25T16:29,Low,4370,3,11127,4,autopilot:1 close-out:1 implementation:1 review:1,2.17,Sweep comments that still name routes/workspace-api.js as the home of 
LIN-3912,Done,LIN-3892,2026-10-24T20:07,2026-10-25T02:40,High,19397,8,16751,5,autopilot:1 close-out:1 implementation:2 review:1,3.28,"Sweep prep: delete the Next run page, its `nextRun` flag and job, and "
LIN-3913,Done,,2026-10-24T20:11,2026-10-25T07:28,Medium,4890,3,5464,4,autopilot:1 close-out:1 implementation:1 review:1,1.89,Pin three unwitnessed guards in routes/workspace-api-run-evidence.js: 
LIN-3914,Backlog,LIN-3820,2026-10-24T20:13,,Medium,2279,0,0,0,,0,Model routing · Test brief and recap on Haiku 5.5 and GPT-6 Luna again
LIN-3915,Backlog,LIN-3820,2026-10-24T20:13,,Medium,3164,2,3350,0,,0,Model routing · Test Haiku 5.5 for implementation and close-out inside
LIN-3916,Done,LIN-3821,2026-10-24T20:27,2026-10-24T21:07,High,5933,7,17583,8,autopilot:1 breakdown:1 close-out:1 custom:1 implementation:1 plan:1 plan-review:1 review:1,5.09,"Price rows for Haiku 5.5, DeepSeek V4.1 Flash 1017, GLM-5.3 Flash and "
LIN-3917,Done,LIN-3754,2026-10-24T20:47,2026-10-24T21:23,High,30139,6,33077,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,4.52,Close the UI flank (LIN-3754): page files take run and ordering rules 
LIN-3918,Backlog,,2026-10-24T21:22,,Low,1706,3,1405,0,,0,Flaky hermetic settings tests: 'periodic reviews…' and 'Undo refuses…'
LIN-3919,Backlog,,2026-10-24T22:52,,Medium,2133,1,526,0,,0,public/app.js: Features switches saved over XHR never update aria-chec
LIN-3920,Backlog,,2026-10-24T22:52,,Low,2137,0,0,0,,0,Visual replay judge counts byte-only differences as changes; decide by
LIN-3921,Done,LIN-3490,2026-10-24T23:19,2026-10-24T23:47,Medium,15867,6,21038,4,autopilot:1 close-out:1 implementation:1 review:1,3.18,"Close the ""pages ⇄ Providers"" knot: the Linear, Local and Jira provide"
LIN-3922,Backlog,,2026-10-24T23:47,,Low,2242,1,327,0,,0,Retire the lib/tree.js re-export of the focus-child picker (repoint tw
LIN-3923,Backlog,,2026-10-24T23:47,,Medium,2159,1,332,0,,0,Decide the 'LLM & prompts ⇄ Providers' knot (now 11/4): do the context
LIN-3924,Backlog,,2026-10-25T01:32,,Medium,2249,0,0,0,,0,"Visual replay judge labels a pair ""paint (same size)"" when the page he"
LIN-3925,Backlog,,2026-10-25T06:07,,No priority,1405,0,0,0,,0,Model routing: one Settings move writes one change-log entry (batch id
LIN-3926,Backlog,,2026-10-25T07:52,,Medium,2226,0,0,0,,0,"unretire route: no unit test fails when failureOf(..., { notFound: fal"
LIN-3927,Backlog,,2026-10-25T08:33,,Low,1940,0,0,0,,0,Settings › Account: should OpenRouter Disconnect ask before it acts?
LIN-3928,Backlog,,2026-10-25T09:14,,Low,1902,0,0,0,,0,scripts/proxy-decomposition-tables.mjs: stale note cites a removed bil
LIN-3929,Done,,2026-10-25T09:36,2026-10-25T18:22,Medium,5428,4,15392,5,autopilot:1 close-out:1 design:1 implementation:1 review:1,2.88,llm-jobs census: a passthrough wrapper that spreads the wrong option d
LIN-3930,Backlog,,2026-10-25T09:41,,Medium,4655,0,0,0,,0,"Home copy-first view: say ""says your agent"" after a copied prompt, fro"
LIN-3931,Done,,2026-10-25T10:00,2026-10-25T17:31,Low,5546,6,26342,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,6.68,Run kickoff/callback URLs built from publicOrigin(req) become http://u
LIN-3932,Done,LIN-3490,2026-10-25T10:47,2026-10-25T13:18,No priority,8603,7,30361,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,6.58,"Paper: when a plan keeps failing review, does unwedging (one or two sm"
LIN-3933,Done,,2026-10-25T10:48,2026-10-25T18:06,Low,4583,3,8234,4,autopilot:1 close-out:1 implementation:1 review:1,2.19,Attachments upload route: derive the 14mb parser limit from MAX_ATTACH
LIN-3934,Done,,2026-10-25T10:50,2026-10-25T17:45,High,4371,4,14316,4,autopilot:1 bug:1 close-out:1 review:1,6.9,Replay kit rung7 self-check is red under --lib .: mutant m05 undetecte
LIN-3935,Backlog,,2026-10-25T10:50,,Medium,2339,0,0,0,,0,"Other replay kits (rung5c, rung4, consolidate-4b) may have fakes stale"
LIN-3936,Backlog,LIN-3490,2026-10-25T10:59,,Medium,2187,3,1537,0,,0,Costs: one place for what the work cost and what you paid; tidy the co
LIN-3937,Backlog,LIN-3936,2026-10-25T10:59,,Medium,24673,6,30148,7,autopilot:1 custom:1 implementation:2 plan:1 research:1 review:1,52.33,"Costs untangle, 1 of 4 (Own): write down where each cost decision live"
LIN-3938,Backlog,LIN-3936,2026-10-25T10:59,,Medium,1312,0,0,0,,0,"Costs untangle, 2 of 4 (Free the seam): replace the tests that pin cos"
LIN-3939,Backlog,LIN-3936,2026-10-25T10:59,,Medium,1792,0,0,0,,0,"Costs untangle, 3 of 4 (Consolidate): one cost authority that every su"
LIN-3940,Backlog,LIN-3936,2026-10-25T10:59,,Medium,2206,0,0,0,,0,"Costs untangle, 4 of 4 (Rebuild): the cost read model, with daily hist"
LIN-3941,Backlog,LIN-3936,2026-10-25T10:59,,Medium,654,0,0,0,,0,Costs history: backfill Harbour's workspace since records began (dry r
LIN-3942,Backlog,LIN-3936,2026-10-25T10:59,,Medium,2012,0,0,0,,0,"Settings › Costs: what the work cost at list price, what you paid, and"
LIN-3943,Backlog,LIN-3936,2026-10-25T10:59,,Low,827,0,0,0,,0,"Costs: allowances, discounts, the plan catalogue and offers"
LIN-3944,Done,LIN-3936,2026-10-25T10:59,2026-10-25T12:39,Low,4022,5,41117,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,9.99,"Paper: can model, effort, kind and run time estimate the cost of a ses"
LIN-3945,Backlog,LIN-3936,2026-10-25T10:59,,Low,1005,0,0,0,,0,Pricing: long-context tiers for cumulative claude-code sessions (parke
LIN-3946,Backlog,,2026-10-25T11:26,,Low,2027,0,0,0,,0,Decide whether non-snapshot experiments/ tooling belongs in the defaul
LIN-3947,Backlog,,2026-10-25T11:50,,Low,1599,0,0,0,,0,Decide whether the retention check (scripts/code-shape/retention.mjs) 
LIN-3948,Backlog,,2026-10-25T12:27,,Medium,1770,0,0,0,,0,Runner: post a final cumulative [usage] snapshot at session end and re
LIN-3949,Done,,2026-10-25T12:27,2026-10-25T18:33,Low,4872,6,25730,7,autopilot:1 close-out:1 custom:1 implementation:1 plan:1 research:1 review:1,6.92,Unit tests that pin NOW to late October 2026 will rot as the wall cloc
LIN-3950,Done,LIN-3892,2026-10-25T12:45,2026-10-25T14:09,No priority,7318,7,43963,6,autopilot:1 close-out:1 implementation:1 plan:1 research:1 review:1,10.59,"UI sweep: the Plain page layout, built once from the shared pieces, pr"
LIN-3951,Backlog,,2026-10-25T13:12,,Low,2100,0,0,0,,0,"LLM call log: proxy-lane recap and brief rows carry no via: 'proxy', s"
LIN-3952,In Progress,LIN-3855,2026-10-25T13:16,,Medium,43259,13,58942,10,autopilot:1 implementation:2 plan:2 plan-review:2 research:1 review:2,17.38,"Settings › Models polish: spend in every row, a decision panel, one na"
LIN-3953,Backlog,,2026-10-25T13:52,,Low,1390,0,0,0,,0,public/common.js dispatchPrompt JSDoc says a blank model/harness inher
LIN-3954,Backlog,,2026-10-25T13:52,,Low,1702,0,0,0,,0,docs/dispatch-integration.md: LIN-1094 default-tier bullet predates th
LIN-3955,Backlog,,2026-10-25T14:02,,Low,1772,0,0,0,,0,"Task page says ""after the owner pressed merge"" for a pipeline merge no"
LIN-3956,Done,LIN-3892,2026-10-25T14:09,2026-10-25T20:44,Medium,5573,12,38751,10,autopilot:1 blocked:1 close-out:2 custom:2 implementation:1 plan:1 research:1 review:1,12.93,UI sweep: prove the Plain layout's rows and form kinds on the first re
LIN-3957,Backlog,LIN-3892,2026-10-25T14:09,,Low,1476,0,0,0,,0,"/styleguide: show the Settings piece samples in each theme panel, not "
LIN-3958,Done,LIN-3950,2026-10-25T14:17,2026-10-25T17:02,Medium,8848,8,22460,7,autopilot:1 close-out:1 implementation:2 plan:1 review:2,6.3,"Plain layout polish: heading step, sans prose, list bullets on a phone"
LIN-3959,Done,LIN-3490,2026-10-25T14:51,2026-10-25T15:50,No priority,7913,7,18157,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,5.19,"Rulings: one question, one row, one resume (a worker and its autopilot"
LIN-3960,Backlog,,2026-10-25T15:51,,Low,633,1,255,0,,0,/styleguide: the anatomy text puts an unescaped <workspace> in the pag
LIN-3961,Backlog,,2026-10-25T16:29,,Low,3182,0,0,0,,0,"Sweep the remaining stale routes/workspace-api.js citations in tests, "
LIN-3962,Done,LIN-3952,2026-10-25T17:17,2026-10-25T21:46,No priority,10208,13,65356,11,autopilot:1 close-out:1 custom:1 implementation:3 plan:1 research:1 review:3,14.01,"One decision panel for Models and Home: the job's numbers, labelled ha"
LIN-3963,Backlog,,2026-10-25T17:45,,Medium,1914,0,0,0,,0,Replay kit: selfcheck.mjs without --out overwrites the committed repor
LIN-3964,Backlog,,2026-10-25T17:50,,Low,1867,0,0,0,,0,"Home opened task: a reason-only ""✦ ask Harbour"" that replaces the why "
LIN-3965,Backlog,,2026-10-25T17:50,,Medium,1685,0,0,0,,0,Scan and Context have no task-page home after leaving Home: give them 
LIN-3966,Done,,2026-10-25T17:50,2026-10-25T20:50,High,5335,8,45322,10,autopilot:1 close-out:1 custom:1 implementation:1 plan:2 plan-review:2 research:1 review:1,13.1,Proxy lanes and close-out presses still resolve a crossed harness and 
LIN-3967,Backlog,,2026-10-25T18:00,,Low,2303,0,0,0,,0,Image upload: bound the `filename` in parseFeedbackImage (attachments 
LIN-3968,Done,LIN-3833,2026-10-25T18:01,2026-10-25T22:51,Medium,13262,20,75557,14,autopilot:1 close-out:1 custom:2 implementation:4 plan:1 research:1 review:4,22.84,"Home polish: style the opened task, the right next step after a failur"
LIN-3969,Done,,2026-10-25T18:25,2026-10-25T20:30,High,5815,10,24256,8,autopilot:1 bug:1 close-out:2 custom:2 review:2,17.53,"E2E flake: LIN-3833 specs (detail-nonactive-binding, lin-3833-home-fir"
LIN-3970,Backlog,LIN-3892,2026-10-25T18:30,,No priority,3888,0,0,0,,0,"UI sweep, Plain batch 1: the KPI pages on the Plain layout, with Escal"
LIN-3971,Backlog,LIN-3892,2026-10-25T18:30,,No priority,3661,0,0,0,,0,"UI sweep, Plain batch 2: Templates with the Prompts catalog folded in,"
LIN-3972,Backlog,LIN-3892,2026-10-25T18:30,,No priority,3346,0,0,0,,0,"UI sweep, Plain batch 3: Task edit and create share one form layout; R"
LIN-3973,Backlog,LIN-3892,2026-10-25T18:30,,No priority,3382,3,1588,0,,0,"UI sweep, Plain batch 4: the system pages and email sign-in on the Pla"
LIN-3974,Backlog,,2026-10-25T18:54,,Low,1609,0,0,0,,0,Dispatch preset accepts a padded harness name ('opencode ') that silen
LIN-3975,In Progress,LIN-3892,2026-10-25T19:07,,Medium,70726,24,121363,25,autopilot:1 close-out:1 custom:5 implementation:4 plan:5 plan-review:5 research:1 review:3,36.91,"Task page: move the task on from where you read it, with task chat in "
LIN-3976,Todo,LIN-3892,2026-10-25T19:11,,Medium,15594,1,624,0,,0,"Run page: say what the run is doing, show it as stages, and let it be "
LIN-3977,Done,LIN-3892,2026-10-25T19:17,2026-10-26T02:59,Medium,18503,30,142990,26,autopilot:1 blocked:1 close-out:1 custom:3 implementation:2 plan:7 plan-review:8 research:1 review:2,44.37,"Live Console: keep the delight, and make every lane say what it is doi"
LIN-3978,Todo,LIN-3892,2026-10-25T19:22,,Medium,15345,1,682,0,,0,"Dispatch: lead with what is happening, send in one press, and make hal"
LIN-3979,Backlog,,2026-10-25T19:24,,Medium,2117,0,0,0,,0,One preset system: merge Dispatch presets and Settings › Models routin
LIN-3980,Done,LIN-3892,2026-10-25T19:25,2026-10-26T01:19,Medium,15530,13,55078,9,autopilot:1 close-out:1 implementation:3 plan:1 research:1 review:2,12.97,"Landing: say plainly what Harbour is, keep the glimpses true, and carr"
LIN-3981,Backlog,,2026-10-25T19:30,,Medium,3684,1,483,0,,0,"A public, read-only demo workspace a signed-out visitor can explore"
LIN-3982,Todo,LIN-3892,2026-10-25T19:31,,Medium,13346,3,2443,0,,0,Swipe: each card says where the task is and offers the same next step 
LIN-3983,In Progress,LIN-3892,2026-10-25T19:34,,Medium,69195,25,110207,26,autopilot:1 breakdown:1 close-out:1 custom:4 implementation:3 plan:6 plan-review:6 research:1 review:3,34.99,"Observation: lead with what waits on you, say each run's state once, a"
LIN-3984,Backlog,,2026-10-25T20:50,,Medium,2729,0,0,0,,0,Selector evals: a committed replay helper that rebuilds a decision poi
LIN-3985,Backlog,,2026-10-25T21:46,,Medium,1908,0,0,0,,0,"Unit flake: tests/unit/db-indexes.test.js:771 ""a spec whose key alread"
LIN-3986,Done,LIN-3892,2026-10-25T21:58,2026-10-25T23:04,High,6320,6,15680,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,4.56,"Live Console lanes: one lane per task, chosen by one written rule (pre"
LIN-3987,Done,LIN-3892,2026-10-25T22:05,2026-10-26T00:38,Medium,16484,7,25408,7,autopilot:1 close-out:1 implementation:2 plan:1 review:2,7.42,"Decision panel follow-up: comparable prices on Claude Code, values in "
LIN-3988,Backlog,,2026-10-25T22:51,,Low,2866,0,0,0,,0,Home's run control repeats what the state sentence above it already sa
LIN-3989,Backlog,,2026-10-25T22:51,,Medium,2811,0,0,0,,0,"Go's refusal and setup notices still link ""run on my machine ›"" while "
LIN-3990,Backlog,,2026-10-25T23:03,,Low,1685,0,0,0,,0,"Live Console timeline: fold a reply into its anchor's row, as the lane"
LIN-3991,Done,LIN-3892,2026-10-25T23:05,2026-10-26T01:43,High,12057,10,31287,8,autopilot:1 close-out:1 implementation:1 plan:2 plan-review:2 review:1,13.17,"Home round two: the stages ahead after a failure, a failed pill, the s"
LIN-3992,Done,LIN-3892,2026-10-26T00:49,2026-10-26T02:40,High,10477,7,13385,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,3.17,"Decision panel round three: a pick updates the summary, Models' follow"
LIN-3993,Backlog,,2026-10-26T01:07,,Low,2278,0,0,0,,0,Test seam: /test/set-session without runnerKey keeps an earlier spec's
LIN-3994,Done,,2026-10-26T01:19,2026-10-26T01:35,Low,2713,1,1432,0,,0,"Visual replay judge: home-run-panel-open, home-run-panel-opencode and "
LIN-3995,Done,LIN-3892,2026-10-26T01:29,2026-10-26T02:21,Medium,7116,5,12928,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,3.89,"Landing round two: previews say they are previews, sign-in doors carry"
LIN-3996,Backlog,,2026-10-26T01:35,,Low,2296,0,0,0,,0,Judge unit tests (tests/judge/pages.test.mjs) are not run by test:unit
LIN-3997,Backlog,LIN-3892,2026-10-26T02:21,,Medium,1986,0,0,0,,0,"renderPlainDocument drops followSystemTheme, so /privacy and /terms ig"
LIN-3998,Backlog,,2026-10-26T02:58,,Low,1616,0,0,0,,0,"Live Console stream: should a task closing get its own row (""task clos"
LIN-3999,Backlog,,2026-10-26T02:58,,Low,1440,0,0,0,,0,"Live Console timeline: seeded bars are seconds long, there is no way t"
LIN-4000,Backlog,,2026-10-26T02:58,,Medium,1768,0,0,0,,0,Live Console: a waiting lane that stays silent for an hour leaves the 
LIN-4001,Backlog,,2026-10-26T02:58,,Medium,1634,0,0,0,,0,Live Console: a dead credential on a lane candidate that loses its key
LIN-4002,Todo,LIN-3892,2026-10-26T03:07,,Medium,6028,0,0,0,,0,"Live Console round two: workspace names only when they help, a plain s"
LIN-4003,Done,LIN-3892,2026-10-26T03:59,2026-10-26T04:38,High,6420,5,11454,5,autopilot:1 close-out:1 implementation:1 plan:1 review:1,3.12,"One reader for ""is this question open?"": the rulings builder's cluster"
LIN-4004,Backlog,,2026-10-26T04:38,,Medium,3241,0,0,0,,0,"Census classifyLoop decides 'is this question open?' per loop, without"
LIN-4005,Backlog,,2026-10-26T06:51,,Medium,2159,0,0,0,,0,"Brief says a PR is merged when it is open (LIN-3983 PR #2171), and rea"
```


```csv
key,size,hours,started
LIN-3837,S,0.48,2026-10-23T23:34Z
LIN-3840,S,1.22,2026-10-24T00:38Z
LIN-3842,S,2.07,2026-10-24T06:11Z
LIN-3861,S,1.75,2026-10-24T08:48Z
LIN-3872,S,0.57,2026-10-24T11:36Z
LIN-3876,S,1.02,2026-10-24T13:22Z
LIN-3877,S,1.8,2026-10-24T15:18Z
LIN-3883,S,0.63,2026-10-24T17:09Z
LIN-3893,S,0.77,2026-10-24T18:44Z
LIN-3894,S,1.45,2026-10-24T18:44Z
LIN-3917,S,0.6,2026-10-24T20:47Z
LIN-3921,S,0.47,2026-10-24T23:19Z
LIN-3887,S,2.13,2026-10-24T18:11Z
LIN-3888,S,2.58,2026-10-24T20:23Z
LIN-3950,S,1.4,2026-10-25T12:45Z
LIN-3958,S,2.75,2026-10-25T14:17Z
LIN-3882,S,1.83,2026-10-24T17:16Z
LIN-3554,M,5.35,2026-10-23T17:53Z
LIN-3755,M,3.88,2026-10-23T20:42Z
LIN-3889,M,5.23,2026-10-24T20:19Z
LIN-3742,M,10.58,2026-10-23T20:42Z
LIN-3846,L,9.95,2026-10-24T08:02Z
LIN-3890,L,12.25,2026-10-24T20:19Z
LIN-3855,L,18.65,2026-10-24T18:03Z
LIN-3833,L,33.97,2026-10-24T07:42Z
LIN-3837 to LIN-3840,gap,0.58,
LIN-3840 to LIN-3842,gap,4.33,
LIN-3842 to LIN-3861,gap,0.55,
LIN-3861 to LIN-3872,gap,1.05,
LIN-3872 to LIN-3876,gap,1.2,
LIN-3876 to LIN-3877,gap,0.92,
LIN-3877 to LIN-3883,gap,0.05,
LIN-3883 to LIN-3893,gap,0.95,
LIN-3894 to LIN-3917,gap,0.6,
LIN-3917 to LIN-3921,gap,1.93,
LIN-3956,S,3.58,2026-10-25T17:09Z
LIN-3986,S,1.08,2026-10-25T21:59Z
LIN-3987,S,1.7,2026-10-25T22:56Z
LIN-3992,S,1.83,2026-10-26T00:50Z
LIN-3995,S,0.87,2026-10-26T01:29Z
LIN-4003,S,0.65,2026-10-26T03:59Z
LIN-3962,M,3.88,2026-10-25T17:53Z
LIN-3968,M,4.82,2026-10-25T18:02Z
LIN-3980,M,5.8,2026-10-25T19:31Z
LIN-3991,M,2.62,2026-10-25T23:06Z
LIN-3977,L,7.67,2026-10-25T19:19Z
```
