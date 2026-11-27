# Log sweep F: log.md 3872–4332 (14–18 Nov)

Gaps only. Files called "working" are `docs/plans/survey/working-2026-11-15/`, which is not on the kept list.

## Decisions and preferences

- **[decision]** The picture John confirmed ("Yes exactly! Please make a note of this"): "My gut says if Harbour bends the curve and tidied itself as it runs, knowing importantly the maths has changed, we can arrive at a genuinely correct codebase, correctly arranged. Polished for users, easy to use, and most importantly fully working in a meaningful way." No rescue project or big-bang V2: V1 becomes V2 piece by piece. The one number that decides which loop we're in is new work made per piece of work finished. `log.md:4080` (also 4081–4083). *missing*
- **[decision]** Ideas John raised to keep: a V1 milestone after which Harbour mostly runs other projects and gathers feedback, with the codebase "A* quality, through and through"; open to large rebuilds and to cutting features "if the cost to keep them is genuinely high enough"; cross-session communication; the shape layer "on par with tasks and code". `log.md:4085`. *missing* (only the layer idea survives, via layer/design.md)
- **[decision]** Readiness means work lands clean and right, not how often John clicks: "If I need to click ok a few times, but all the work lands clean and right, that's a great place to be in." He was "less confident ... when we will be simply running work which opens Harbour for business without needing hand holding." `log.md:4026-4027`. *missing*
- **[decision]** John's correction on who drives: "a human like me will control Harbour via an agent like you". The agent stays as the person's way in. What goes is an agent holding the loop together by hand. `log.md:4170`, `4177`. *missing*
- **[decision]** Standing rules: "many of these are fine, many of them are there for a reason, and many of them will later become optional configuration properties, such as how a typical user of Harbor wants the session to end, how it deploys … that will come much, much later." `log.md:4278`. *missing* (layer/design.md:136 has a different part of the same message)
- **[decision]** Why trackers-as-sync, and removing Jira and both GitHub trackers, was set aside. John: "idea 2 is appealing because the site is slow, but that's unrelated to moving the remaining parts of the loop into Harbour so it can be handled more deterministically." His earlier order ("remove Jira and the two GitHub integrations ... Linear as a first class synced provider, then add the others back. A bit of a Theseus move") is the shape to return to. `log.md:4142`, `4151`. *partly captured in spikes/0-ledger.md #20, #82*: the reason and his proposed order are missing.

## Lessons

- **[lesson]** Don't send John round planning loops. One day held six versions of a plan, a doc rebuilt four or five times and a dozen sub-agents. "I want out this loooooop!" and "Why would we continue when we don't yet _have a plan_?" `log.md:4164-4165`, `4195`. *partly captured in journey.md:58*: the planning-loop failure isn't named.
- **[lesson]** Check each next step against John's outline and the agreed plan, not against the last sitting's closing suggestion. John: "This feels like jumping too far ahead? Surely mapping it all out and verifying what the design becomes is next". `log.md:4254`. *missing*
- **[lesson]** When a test turns out bad, fix it and run a good one; don't report your own mistake as a result. John: "If it was a bad test, why didn't you just run a good test? We're building, not pedantically following a fixed loop and stopping at our own mistakes as if that's a valid conclusion?" A related one: "Autopilot is an agent given the "autopilot" prompt - a good example of where a subagent doing a little bit if research would avoid assumptions." `log.md:4292`, `4284`. *partly captured in journey.md:40*: the drift is recorded, John's rule isn't.
- **[lesson]** Four sub-agent findings were relayed in one day in stronger words than the code supported. Example: "no area has a written purpose", when 570 of 585 source files open with a purpose comment and `docs/architecture/source-map.md` has a line per module. Only the area notes lack an area purpose line. `log.md:4133`, `4163`. *partly captured in journey.md:146*: the rule is there, the fact about header comments and the source map isn't.
- **[lesson]** A shallow clone made a "commits in 14 days" column an 11-day window. Use full history for commit-window stats. `log.md:4113`. *missing*
- **[lesson]** A safeguard false positive stopped sub-agent stages. The trigger was instruction framing like "what you really wrote … verbatim"; rewording fixed it. `log.md:4304`. *missing*
- **[lesson]** The watcher doesn't treat a custom writer's report as a hand-back, so a finished fix sat unseen for 40 minutes. Poll the dispatch itself. `log.md:4055`. *missing*

## Facts

- **[fact]** Ticket coding (142 tickets, LIN-4345–4486, second blind coder, Cohen's κ 0.88): 16–20% caused by complexity already in the code, about 37–39% counting mess the week's own work added. The commit trace (115 landings) found ordinary work left about 0.65 new items per landing, already under one; 1.12 was the raw ticket count. By kind: tidying old code 0.09, loop-building about 1, measuring 2.77. Only 44 of 115 landings were product or code. `log.md:4079`, `4086`. *missing* (the scripts were in the scratchpad `gen/`)
- **[fact]** Cost findings: a 300+ line task costs about 2.9 times a 1–49 line one; look-first plus the blind read cost 23% of a task and have no quality evidence on ordinary tasks; rebuilds are untested above 2,816 lines, and the Runs and LLM core is about 73,000 lines. The budget figure was corrected to $1,785 for 56 landings, but `course-2026-11-14.md:8` still says "$2,800 bought about 88 landings at $32". `log.md:4088`, `4117`. *partly captured in course-2026-11-14.md* (not on the kept list; it carries the wrong figure)
- **[fact]** `docs/v1.md` (accepted 19 Sep) defines v1 as "one person, one task, one proven merge", done at a fresh-account dress rehearsal. That rehearsal has never run: the 10 Oct one used a new workspace under John's existing account. v1's first step is email sign-in. `log.md:4105`, `4112`, `4117`. *partly captured in journey.md:15 and runner-for-strangers.md:182*: that the fresh-account run is still missing isn't stated.
- **[fact]** Gaps on the new-user path, which matter for pet projects and Yap:
  - no test walks it end to end (Linear sign-in, a real runner, chained stages, an actual merge);
  - a GitHub App connection can only be made by binding a GitHub tracker source;
  - a local project with a private repo gets no Harbour PR check (Git itself stays optional);
  - an account's workspaces aren't restored at sign-in (the README says "cross-device restore is follow-up work");
  - the account/workspace split is unfinished (Phases B, D, E in `lib/account-workspace-store.js`);
  - `LIN-123`-shaped ids are hard-coded in four Harbour files and `sd:transcript.js:333`;
  - Linear is the only setup known to reach a proven merge.

  `log.md:4112`, `4154`, `4160-4161`. *partly captured in working/readings/4-local-first.md*. Not re-checked against main after slices 1–4.
- **[fact]** For the provider-sync follow-up:
  - the Local provider implements the full provider surface, and 98 of 142 e2e specs run on it;
  - Harbour keeps about 35 collections of its own;
  - nothing in `lib/` or `routes/` receives webhooks;
  - the three trackers are about 7,200 lines (Jira 4,142, GitHub Issues 2,133, GitHub Projects 923);
  - the GitHub tracker provider is imported by `lib/github-pr-status.js` and the App connection code, so code-host and tracker must be pulled apart before removal;
  - the GitHub Issues provider has no subtasks, estimates or relations, and only open or closed.

  `log.md:4139`, `4141`, `4144`. *missing*
- **[fact]** The System Map, from main `6f6c5d2e2`: 13 areas, 585 source files, 212,226 lines of JS, 72 cross-area import links (routes→runs 95, routes→prompts 92, runs→prompts 60 and back 39; `server.js` imports 207). Its scripts are in `working-2026-11-15/system-map/`. Pages, all private to John:
  - System Map: https://claude.ai/artifact/GwuQ5g3ab5P9hhvhE8rjuQ
  - Land on the Horizon: https://claude.ai/artifact/5WYRkCnes1ShZQSyK5RszY
  - course doc: https://claude.ai/artifact/74Yy6aE8WXur4YDaJQt4t8

  `log.md:4087`, `4104`, `4127-4128`, `4212-4215`, `4230`. *missing*
- **[fact]** Index conflicts when filing papers: each paper adds rows to `docs/papers/README.md` and `tests/fixtures/library-doc-summaries.json`, so papers merge one at a time and each later one bumps the count pin. `log.md:4049`, `4062`, `4075`. *missing*
- **[fact]** Sub-agent readings cost 131k–254k tokens each, about 1.9M for nine (the integration census and checks). `log.md:4331`. *missing*

## Open

- **[open]** The blind read is still a close-out gate in code: `blind-read-missing` at `lib/run-closeout-state.js:81` on main. That runs against the 14 Nov direction "measures report, never gate (remove the code gate too)" and the 15 Nov suggestion to keep it as a report with the gate removed. John never ruled on it. He kept the cut rule (`lib/prompts/stage-kinds.js:27`), with "we don't want to fight the system". `log.md:3894`, `4111`, `4118`. *missing* unsure
- **[open]** Leftovers from the scaffolding inventory:
  - the LIN-2323 sunset review never happened;
  - two "until LIN-" markers name Done tickets (LIN-4015, LIN-3952);
  - simple-dispatcher's prose copy of Harbour's notes rules is unchecked.

  The agreed stays/goes/planned-removal discussion (`log.md:3976`) was never held in that form. `log.md:4073`. *partly captured in gate-2026-11-14.md:60-68* (not on the kept list). unsure: the layer slices may have retired some of this.
- **[open]** Two older files on main still carry a company name (the A17 evidence redaction). Flagged for the survey record's privacy check and not done. `log.md:4045`. *partly captured in working/readings/3-definition-and-rulings.md:179*
- **[open]** Harbour accepts the `fable` model, but its id points to an older Fable version. Noted, not changed. `log.md:3986`. *missing*
- **[open]** No one has traced where the feedback door (`POST /api/feedback`) lands for a workspace that isn't Harbour's own. It matters for John's "drop in feedback as I go" on pet projects. `log.md:4139`. *missing*
- **[open]** The plain-session baseline (the same tasks run by a bare session with CI and John's OK) was proposed several times and never agreed or run. No paper has one. `log.md:4078`, `4117`, `4126`, `4157`. *missing* unsure

Read lines 3872–4332 in full; 27 gaps.
