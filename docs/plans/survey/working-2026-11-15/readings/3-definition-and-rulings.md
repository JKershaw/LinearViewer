# 3. What Harbour says it is, and what waits on John (raw material, read 14 Nov 2026)

**Citations.** Product files are in the main checkout (`wt-main`, head `6f6c5d2e2`, 14 Nov): `NS` = `docs/north-star.md`, `NSP` = `docs/north-star-v4-proposal.md`, `v1` = `docs/v1.md`, `README`, `CLAUDE` = `CLAUDE.md`, `hero` = `lib/components/landing-hero.js`, `landing` = `lib/render-landing.js`, `llms` = `public/llms.txt`, `views` = `docs/architecture/views.md`, `proxy` = `docs/proxy-integration.md`, `ladder` = `docs/ladder.md`, `cleaner` and `shape` = the two papers under `docs/papers/harbour/`. Survey files are in `/home/user/LinearViewer/docs/plans/survey/`: `log`, `disc` = `discussion.md`, `asks`, `gate` = `gate-2026-11-14.md`, `course` = `course-2026-11-14.md`. `PtC` = `scratchpad/course/tmpA/plotting-the-course.txt`. `A` = `scratchpad/course/A-decisions.md`.

**Reading rule.** Quotation marks with "John:" are his words as the record keeps them. "Session wording" means an agent wrote it; where John approved it, his reply is given. The checkout's history is shallow (it starts 3 Nov), so "by 3 Nov" means "no later than".

---

## Job 1. What Harbour says it is

### 1.1 Every statement, side by side

| # | Exact words | Where | Date, author |
|---|---|---|---|
| 1 | "Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, brings codebases toward settled, its own included, funds itself doing it — and proves every word." | NS:5 | v4, accepted by John 13 Nov (NS:29). "brings codebases toward settled, its own included" is new in v4; the rest is v3, 19 Sep (NSP:58-59) |
| 2 | Title: "North star — v4, the self-funding loop, one step at a time" | NS:1 | 13 Nov; subtitle kept from v3 |
| 3 | "Harbour's goal is simple code, and healthy growth is fine. Harbour converges work, even if slowly, and resists spiralling out into more work unless that work is tidying." | NS:7 | 13 Nov, from John's words of 8 and 10 Nov (NSP:87-88) |
| 4 | "Harbour is often one contributor among several. Many real projects aren't changed only through Harbour; when a person chooses to act, Harbour rides along." | NS:13 | 13 Nov, session wording, John: "I like it, much nicer." (NSP:90) |
| 5 | "Harbour meets them at the saved prompt, where the grounded next prompt is the whole product: log in, connect a tracker and a repo, click a task, copy, go." | NS:25 | v3 text, kept (19 Sep) |
| 6 | "Login → connected → first evidence-verified merge, without talking to the operator, is that step's bar." | NS:25 | v3 text, kept |
| 7 | "Verified beats claimed. Work counts only when its evidence chain closes: CI green, merged, ledger discharged. done is a claim; the artifact is the fact." | NS:11 | v3 text, kept |
| 8 | "Harbour v1: one person, one task, one proven merge" | v1:1 | accepted by John 19 Sep (v1:141) |
| 9 | "Harbour's first sentence is that it keeps human intent in command of AI execution and proves every word. … So v1 is not a cut-down Harbour; it is Harbour at the scale of one decision." | v1:13 | 19 Sep, session draft, accepted |
| 10 | "A developer with a backlog in GitHub, Jira or Linear who wants one task done and proven. They may be hands-on today, saving the prompts that work, or they may arrive expecting to hand a task over." | v1:37 | 19 Sep, revised 26 Sep |
| 11 | John: "what I'm currently doing is building my ideal product, whereas now I want to make it so that other people can start using it; that's where Harbour really gets interesting." | v1:7 | 19 Sep |
| 12 | John: "Harbour's first parlour trick is essentially giving them those prompts. They log in, they get their prompt, off they go. That is the core of Harbour, and everything else nearby exists to accelerate that: that's the autopilot, that's the automatic dispatch system." | ladder:30 | 19 Sep |
| 13 | "Harbour exists to keep human intent in command of AI execution, so it has to model the human." | ladder:9 | 19 Sep, session wording |
| 14 | "A minimal, CLI-aesthetic web app — a provider-agnostic control plane for AI-augmented software development. It started as a read-only Linear projects/issues tree viewer and grew into a cockpit that reads any issue backend, generates grounded prompts, dispatches them to AI agents, and verifies the work on real evidence." | CLAUDE:3-6 | by 3 Nov |
| 15 | "A minimal, CLI-aesthetic web app that displays your projects and issues as a collapsible tree — backed by Linear, GitHub, GitHub Projects, Jira, or a local store — plus a growing set of focused views and an API surface for AI agents." | README:3 | by 3 Nov |
| 16 | "A minimal web app that displays your task tracker's projects and issues as a collapsible tree with a CLI aesthetic. Backed by Linear, GitHub, GitHub Projects, Jira, or a local store." | llms:3 | by 3 Nov |
| 17 | "Keep human intent in command of AI execution" (tagline; also the page title, landing:333) | hero:134 | by 3 Nov |
| 18 | "Harbour reads your backlog, writes the next prompt, runs it on your coding agents, and checks the result against real evidence." (the "plain definition", LIN-3980; "Drafted by the builder", hero:52-55) | hero:58 | by 3 Nov, agent-drafted |
| 19 | "One human, steering a fleet of agents" / "AI made writing code cheap — it didn't make knowing what to build any faster. Harbour keeps human intent in command of AI execution, one turn of the loop at a time." | landing:406-407 | by 3 Nov |
| 20 | Loop steps: "Read the backlog", "Write the next prompt", "Run it on an agent" ("A coding agent picks it up and runs it, or a whole batch goes out at once. One person, many agents at work."), "Check the result" ("Work counts when it has real proof behind it: CI results, merged changes, diffs. Not the agent's say-so.") | landing:77-93 | by 8 Nov |
| 21 | "Harbour decides what work to do; Harbour OS is the in-browser workstation where the agent sessions run." (section badged "experimental", landing:477) | landing:479 | by 8 Nov |
| 22 | "You pay OpenRouter a few cents; Harbour charges nothing." | landing:202 | by 8 Nov |
| 23 | "…through the Linear Viewer proxy API." / "Workspaces may be backed by Linear, GitHub, Jira, or a Local provider" | proxy:3, proxy:9 | by 13 Nov (old name still in use) |
| 24 | "Harbour is a tool that hands software work to AI agents. Each piece of work is a ticket; a fresh agent session reads it, does the job and leaves. Harbour is built this way too" | shape:16 | 14 Nov, essay for John |
| 25 | "*Harbour* is the product whose codebase this is; LinearViewer is its repository, and simple-dispatcher is the second repository the loop touched." | cleaner:40 | 6 Nov |
| 26 | Goal, session wording: "Harbour brings codebases toward settled, including its own. Settled is a balance, not smallness." John: "Agreed, perfect" | disc:58-59 | 8 Nov |
| 27 | John: "Harbour's goal is to be simple code … let's not swing far in the other way." | log:3001 | 8 Nov |
| 28 | John: "Yeah, if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour." | log:3609 | 13 Nov |
| 29 | John: "I'm confident our new approach beats our old one. I'm less confident our scaffolding is now fit for purpose, or when we will be simply running work which opens Harbour for business without needing hand holding." | log:4026 | 14 Nov |
| 30 | John: "If I need to click ok a few times, but all the work lands clean and right, that's a great place to be in." | log:4027 | 14 Nov |
| 31 | John: "It feels like we are close to be being able to make some large simple improvements, some Theseus'ing, and some removal/simplification. Getting us a textbook quality codebase, settled." | log:4078 | 14 Nov |
| 32 | John: "My gut says if Harbour bends the curve and tidied itself as it runs, knowing importantly the maths has changed, we can arrive at a genuinely correct codebase, correctly arranged. Polished for users, easy to use, and most importantly fully working in a meaningful way." | log:4080 | 14 Nov |
| 33 | Session's report of John's ideas "to keep": a V1 milestone after which Harbour mostly runs other projects and gathers feedback, with the whole codebase "A* quality, through and through"; Harbour holding a project's shape as "a first class data layer (on par with tasks and code)". Only the quoted phrases are his. | log:4085 | 14 Nov |
| 34 | Session proposals, not John's: "one promise … (a person hands over a task, gets a verified merge, stays in command)"; "The research result is the product. The promise is a verified merge with the person in command, and the place left cleaner than it was found." | log:4090, log:4098 | 14 Nov, "proposed, nothing decided" |

Related findings that bear on the claims: "tasks on average: not shown" (whether a task finishes with the code cleaner; cleaner:38, 6 Nov). "No usage evidence exists for any feature, and no area has a written purpose." (course:11).

### 1.2 Where the statements disagree

- **What kind of thing it is.** A tree viewer (README:3, llms:3; proxy:3 still says "Linear Viewer"); a "control plane"/"cockpit" (CLAUDE:3-6); a four-verb loop (hero:58); a tool that "hands software work to AI agents" (shape:16); something that also "brings codebases toward settled" (NS:5, new on 13 Nov). The README and llms.txt never mention running or verifying work in their first line.
- **What the core is.** "the grounded next prompt is the whole product" (NS:25) and John's "That is the core of Harbour" about prompts (ladder:30), against the landing's four verbs ending in run and check (hero:58), against the 14 Nov proposal that the promise is "a verified merge" (log:4090, session wording).
- **Who the user is.** "a developer" (NS:5, v1:37) at the saved prompt (NS:25); "One human, steering a fleet of agents" and "a whole batch goes out at once" on the landing (landing:406, landing:88), which is the operator's rung, while v1 says passages and the standing loop "stay the operator's" (v1:89); a "solo operator" sets the cost bar (NS:5); the first outside user chosen on 8 Nov is a team (disc:61), while v1 puts "organisations and colleagues beyond the share link" out (v1:89). v1 itself notes the backlog served one user, "two thirds of it at rungs 5 and 6" (v1:23).
- **What comes first on the screen.** v1 step 4 quotes John's "great big button that basically says Go" (v1:46) and then says "the prompt comes first" (v1:52); the entry hypothesis records that "The draft of 19 September held the opposite" (v1:97).
- **What "done" means.** A task: "CI green, merged, ledger discharged" (NS:11). v1: "done at the dress rehearsal" (v1:31), with fresh account or fresh workspace, and eight steps or nine, both undecided (v1:132). The stretch: an outside Jira team hands over real tasks (disc:61). 14 Nov: codebase "A* quality, through and through" (log:4085) and "all the work lands clean and right" (log:4027). The course proposes a five-property "V1 exam" (course:50; not ruled).
- **"Funds itself" and "proves every word".** NS:5 says Harbour "funds itself"; there is "no payments code" (v1:117), the landing says "Harbour charges nothing" (landing:202), and billing is "after the dress rehearsal" (v1:117). NS:5 says it "brings codebases toward settled … and proves every word"; the paper's headline is "tasks on average: not shown" (cleaner:38).
- **Free tier.** "the free tier is a published, ring-fenced line item" (NS:25); "no page publishes it yet" (v1:116). CLAUDE:77 gives a default of 10 runs a day.
- **Trackers.** Five backends (README:3, llms:3: Linear, GitHub, GitHub Projects, Jira, local); "GitHub, Jira or Linear" (v1:37); four, without GitHub Projects (proxy:9), though the same guide lists it at proxy:2921; "any issue backend" (CLAUDE:5). On Jira the loop could not create issues until 13 Nov; it is built and deployed but the check on John's Jira has not run (log:3785, log:3789). Boards and sprints are not modelled (disc:82).
- **Runners.** "A runner that serves people who are not the operator is out of v1's scope" (v1:91); the first stretch has the team "on their own runner" (disc:61); the runner is "Not tasks for now" because John sets it up (disc:442); the landing presents Harbour OS as "where the agent sessions run" (landing:479) while v1 puts Harbour OS out (v1:89); v1's hypothesis is the person's own Claude Code session (v1:99); the course's last phase needs "A runner a stranger can install" (course:48).
- **First-class or experimental.** views:5 names six first-class views (dashboard, observation, swipe, swim, settings, kpis), seven experimental, three flagged (roadmap, dispatch, proxy), and a "roadmap tier" for Live Console that is not one of its three tiers. README:23-28 lists Roadmap and Ship as plain "Views" with no tier. llms:30 puts `proxy` in the always-on view switcher. CLAUDE:78 calls `/kpis` "intentionally unlinked" while views:5 lists kpis as an always-on tab (possibly two different pages; the record does not say). views:5 says `/ship` is "not a retirement candidate"; the course proposes cutting all seven experimental views (course:26).
- **Look.** "monospace font, CLI aesthetic" (README:215) against "CLI/terminal *character*, not pure monospace" (CLAUDE:39).
- **Order of the doors.** Outside team first, about week 5 (disc:61, A:41); the course keeps Door 1 before V1 (course:17-18); the last answer of the log proposes "shape ahead of the outside team" (log:4103); John's 14 Nov idea has outside projects mostly after V1 (log:4085).

### 1.3 Who comes first

**The outside team on Jira.**
- Session wording, John "Agreed, perfect": "First stretch, 'open the door': a small outside team on Jira, who already use agents, can hand Harbour real tasks on their own runner." (disc:58, disc:61, 8 Nov)
- Session's report of John naming them: "a small team that already uses agents and wants agents building its product. They use Jira, and their setup is like Harbour's." (log:3204). The team is not named (disc:447).
- John: "I've logged in with Harbour on Jira and been using it for a few weeks and it's mostly fine except for the gaps that you've identified. I'm happy to set up either Simple Dispatcher internally in the company… and/or we can use the in-Claude-Code runner; both are fine options. We're on subscriptions so cost is less of an issue and Harbour is already significantly more efficient than the way the company's currently using AI." (disc:447, 9 Nov)
- John: "Jira works. We do have a real test account so agents can test real Jira - I'd wager agents won't know this, and I'm happy to cross that bridge when the first agent gets to it. Sharing workspaces and how that's set up (essentially following a standard Saas/CICD model) feels like one big tidy?" (log:3598, 13 Nov)
- What they need, per the record: Harbour can create Jira issues and hold the sealed ask (asks:157-169; built, live check outstanding, log:3785-3789); a shared workspace, because "a Jira team cannot share a workspace" (log:3354; LIN-4449, Backlog, log:3630); the other Jira gaps LIN-4355, LIN-2805, LIN-2094, LIN-2026, LIN-2170, LIN-2008 (disc:82); the confirmed safety problems closed (LIN-4416, 134 tickets, asks:227); "What Harbour keeps about a company's code … A short check before they start." (PtC:149); the gate "is also exactly what the outside team needs: if we can't run Harbour without doing something clever, neither can they." (PtC:110).
- Limits: "The outside team's needs are known only second-hand." (course:66); "the first customer is a Jira team while John is the only Jira user." (log:4090, session wording).

**The stranger.**
- v1 gate is John himself as a stranger: "as soon as we reach the point where I can sign up a fresh account, go through all the steps and see a result, potentially with a repo that I've not used with Harbour before." (v1:31). Then: "Once I've done a sort of dress rehearsal, then it can start to be shared around, with me inviting other specific people to test it out." (v1:33). "Strangers reaching the bar unaided is the next step's bar, not this one's." (v1:33, document wording).
- John: "we can build this v1 without a single other person and it will still be really, really good." (v1:31)
- Three milestones on the Plotting the Course page (session wording, 8 Nov): M1 "Anyone can sign in and get a good prompt"; M2 "Anyone can hand Harbour one task, and trust what comes back" ("on their own logins and model key, with one approval click before merge, and shows what it cost"; needs "a fresh clone and secrets for every task", "their own model key", "strangers kept apart from each other", "a multi-tenant threat model"); M3 "People keep using it, and it pays its way" ("hosted accounts", "billing behind the hardening gate", "governance and licence") (PtC:542-547).
- State: "no fresh-account run has happened yet" (v1:132); "A fresh-account rehearsal, which has never been run." (course:46).
- 14 Nov proposal, not ruled: walk "a stranger on Linear, then the Jira team sharing a workspace, then a stranger's own runner" (log:4100).

### 1.4 What the record says is out, later, or not built

- Out of v1 "as later steps rather than never": organisations and colleagues beyond the share link; machine and model configuration; passages and the standing loop for users; periodicals for users; Harbour OS; a list of chats and a docked chat pane; email for rulings; an admin view; support access; a merge button with CI/CD integration; a "close out when clean" rung (v1:89).
- A runner for people who are not the operator: out of v1's scope; "nobody else's work on a shared, uncapped key" (v1:91). Runner packaging and the Costs page: "Not tasks for now" (disc:442).
- Billing: "Nothing; there is no payments code" (v1:117); "payments land only behind the hardening gate" (NS:25); the paid number "is decided after the dress rehearsal, not before" (v1:96). Hosted accounts, billing, governance and licence are M3 (PtC:546); the course puts them "Later, separate" (course:19). README:227: "All rights reserved."
- Not built or open: the connect flow as one path (LIN-614, v1:108); the run page for a non-operator (LIN-3349, v1:112); credential-level stop at the PR (LIN-3417, v1:114); publishing the free-tier number (LIN-1645, v1:116); workspaces following a person to a new device (README:116); shared team workspace on Jira (LIN-4449); Jira boards and sprints (LIN-2008, disc:82).
- Experimental and off by default: collective, taskChat, ship, flightCompanion, passagePlanner, shipBiscuit, shipJourney (views:5); Harbour OS is badged experimental (landing:477).
- Out of the north star on purpose: "the outside Jira team, the stretches and lanes, the weekly figure, models per stage, and what is in flight" (NSP:7). A streamlined repo for distribution is "Later" (disc:611).

### 1.5 What a one-page definition would have to decide, that the record does not settle

1. One sentence: prompt-writer, task runner with a verified merge, or the thing that brings a codebase toward settled (rows 5, 18, 1, 34).
2. Who it is for first: a solo developer at the saved prompt, an operator steering many agents, or a small team sharing a workspace.
3. The promise, and whether "leaves the place cleaner" is part of it while the paper says "not shown" (cleaner:38).
4. What "open for business" and "V1" mean, and their order with the Jira team (log:4026, log:4085; "has no definition or date in the record", course:10).
5. Which trackers are in for V1 (five listed; Jira unproven live; John is the only Jira user).
6. Which runner paths are in: Simple Dispatcher, the in-Claude-Code runner kit, Harbour OS, a hosted runner.
7. Which views are the product, and the fate of the seven experimental ones (cut, rebuilt, or kept).
8. Whether "funds itself" stays in the headline before any billing exists, and what the free number is.
9. Whether v1's gate is a fresh account or a fresh workspace, eight steps or nine (v1:132).
10. Whether Harbour OS belongs on the landing page while v1 puts it out.
11. What "minimal, CLI-aesthetic" still commits the product to (README:3, CLAUDE:39).
12. What is kept about a customer's code, and what privacy promise the page makes (PtC:149).

---

## Job 2. What is waiting on John

The log ends with three session answers John has not replied to (log:4095 "No answer yet; nothing drafted or filed"; log:4097-4103 "proposed only"). `course` says of itself: "Nothing here is decided." (course:3).

### 2.1 About the product

| # | Question | Options in the record | For / against | Blocked until answered | Where |
|---|---|---|---|---|---|
| P1 | What does "open for business" mean, and in what order do the doors open? | Door 1 (Jira team) → V1 (stranger, verified merge, own keys) → later hosted and billing (course:17-19); or shape first, outside team after (log:4103); or John's idea of V1 first, then other projects (log:4085) | For Door 1 first: decided as the first stretch (disc:61). Against: needs known "only second-hand" (course:66). For shape first: "now is the cheapest time because Harbour has one user" (log:4103, session) | The whole course; the first budget week's outcome (log:4094) | course:13-19, log:4103 |
| P2 | Should John mark up a one-page definition and a keep-or-kill list (later reframed as a fate for each of thirteen areas: on the walked path, rebuilt, or cut)? | Session offered to draft; John to mark up | For: "far more surface than one promise needs" (log:4090, session). Against: none recorded | The cut list; ticket triage ("Tickets follow their area's fate", log:4099) | log:4092, log:4095, log:4099 |
| P3 | Are the seven experimental views cut? | Cut (course:26: about 18,500 source and 27,000 test lines); or keep and tidy | John, 9 Nov: "Honestly, I like them all … I'd be sad to get rid, but happy to tidy." (disc:550); decision then: "No surfaces are retired by default … Retiring stays possible … only as John's call" (disc:545-547). John, 14 Nov, as reported: open to cutting features "if the cost to keep them is genuinely high enough" (log:4085). views:5 protects `/ship` | The "cut before fixing" step (course:26, course:45) | course:26 |
| P4 | Does each area get a purpose line from John? | Yes / no | "no area has a written purpose" (course:11); the V1 exam depends on it (course:50) | Phase 0 gate (course:44) | course:44 |
| P5 | Does the v1 gate mean a fresh account or a fresh workspace, and eight steps or nine? | As listed | "Open, the owner's call (LIN-3808)" | Calling v1 done | v1:132 |
| P6 | Take bolder steps (broad clean-ups, rebuilds, a focused loop)? John asked; the answer is proposed only. | Bold with three conditions (a judge first, one broad move per area, sizes step up) | For: a failed large move "costs one revert and about a task's price". Against: "nothing above 2,816 lines has been tried"; does not fix the Jira team's needs | Order of shape and Door 1 | log:4103 |
| P7 | Run a bare-session baseline (a session with CI and John's OK, no loop) before any larger rebuild, and no more papers until an experiment gives a result? | Yes / no | Session's view: "no paper has a baseline". John's reply went to tidying, not this (log:4078) | Whether a whole V2 is ever justified | log:4078 |
| P8 | Will John talk to the Jira team, or watch them try what exists, before the first budget week? | Either | course:66 | Door 1's task list | log:4094 |
| P9 | Which runner will the Jira team use? | Simple Dispatcher set up by John, or the in-Claude-Code runner: "both are fine options" (disc:447) | — | Door 1 | disc:442, disc:447 |
| P10 | Plan by the budget week ("tank"), each starting with a fresh-account walk, split about 70/20/10? First outcome: a fresh account reaches a verified merge on Linear without John. | Accept / change | Proposed to replace the phase table's method (log:4089) | The 19 Nov week | log:4092-4094 |
| P11 | A handful of small product calls shipped without his say when their tickets closed (LIN-3703, LIN-3952, LIN-4113, LIN-3983). Does he want to rule on them? | Leave / review | Session: "nothing of value lost beyond John's say"; suggested leaving as is. No reply recorded | Nothing | log:3614, log:3617 |

### 2.2 About the loop's steps

| # | Question | Options | For / against | Blocked | Where |
|---|---|---|---|---|---|
| L1 | Adopt the lighter loop, chosen by what a change touches? Dropped "on John's ruling": the plan-review loop past one round, the mutation check, close-out filing of follow-ups, the cut rule, prose notes; and look-first and the blind read. | Drop all / some / none | For: look-first and blind read "have no quality evidence on ordinary tasks and cost 23% of a task" (course:31). Against: "no measured quality cost, in either direction" (course:64); blind reads read 20 of 22 better, self-reported (gate:54) | Capacity estimate of 100 landings a week (course:25) | course:27-31 |
| L2 | Fix the cut rule so only narrowing John's own words needs him, and answer options say what happens next? | Go-ahead for one ask, or not | For: four false escalations in one day (log:3797), both lanes idle overnight (log:3844). Session: "It needs his go-ahead." | Rulings volume | log:3799 |
| L3 | Should rulings go ahead on the recommended answer unless they are John's calls, and should he rule in batches at the start of a phase? | Yes / no | For: "about a third of withdrawn rulings were calls the run could settle" (course:33). Against: "a person's Agree discharges a ruling, by design" (log:3799) | — | log:3897, course:33 |
| L4 | What format do the notes take? | John's idea: "simply saving the notes as TS" (log:3966); "each kind where it can't drift"; a near-nothing version (log:3977); or no prose notes (course:31) | Gate: types "check shape and references, not truth"; a JS data module under a census "removes most of the false claims" (gate:43). The spike itself is agreed (log:3973, 3977); the winner is not chosen | The next round | log:3874, gate:74 |
| L5 | LIN-4463 (front end): when does it resume, and what is the pass figure for its paired read? | Candidate: at least 4 of 6 readers prefer "after", control no better than even (log:3795) | Paused for budget on John's agreement (log:3805). Note: John later made measures "reported, never gating" (log:3876), which may make the figure moot; the record does not say | LIN-4463 Done | log:3793, log:3813 |
| L6 | When does the parked work start: LIN-4342, LIN-4343, LIN-4449, the safety work, the Duplicate-state pass? | After Thursday's reset (log:3806), or sooner | John: "I doubt the 'wait for Thursday' is true. It's just me keeping track of my budget." (log:3971) | Door 1 work (LIN-4449) | log:3806 |
| L7 | Task size as a ruling (A9): file it? | File / keep held | Decided in principle 9 Nov (disc:283); "A9 held" 13 Nov (log:3603); never read back (asks:155) | — | asks:198 |
| L8 | Try a cheaper judging model? | Untried; "estimated at half again the capacity" | — | — | course:36 |
| L9 | The Live Console shows little of the lanes' work. | John: "one to look into later" | — | — | log:4050 |

### 2.3 About scaffolding meant to be temporary (the gate's 14 structures)

John's standing words: "extra scaffolding and temporary structures are fine. We just need to plan their removal." (log:3964). Agreed for the discussion: for each structure, "stays, goes, or stays with a planned removal, in John's words" (log:3976). The inventory gives "No recommendations; the calls are John's." (gate:47). All rows are gate:51-64.

| # | Structure | State in the record | John so far |
|---|---|---|---|
| 1 | Area notes (Lessons cap, Waiting) | 89 KB; Waiting 0 → 118 in a week; 13 of 110 claims false | "the notes are mess" (log:3964); format open (L4) |
| 2 | `Retires:` line and 422 refusal (LIN-4414) | Waiting 82 → 118 after it landed | none |
| 3 | Consequence test (LIN-4431) | tickets per landing 1.37 → 1.12; note inflow sped up | none |
| 4 | Blind read and close-out gate (LIN-4438) | +1 session per task; still a gate in code (log:3887) | measures are "reported, never gating" (log:3876); the code gate is not ruled |
| 5 | Frozen area-read kit (LIN-4453) | its after-read ran | **Answered:** "John: drop it" (gate:55, log:3853) |
| 6 | As-asked seal and cut rule | "source of the false escalations"; expensive to remove | bypass declined (2.6); a fix is L2 |
| 7 | Look-first and size record | sessions 5 → 7; "no quality evidence in the repo" | on a run skipping it: "seems minor." (log:3877) |
| 8 | Leftover step and held parent wake | feeds notes | none |
| 9 | Periodicals write notes, not tickets | seven safety finds stranded (2.4) | none |
| 10 | Prompt size budget and reason ledger | "frozen" yet +22% since 1 Nov | "Prompt size isn't a huge issue. That limit is to push against lists if rules. Worth knowing, but not hard and fast." (log:3627) |
| 11 | Stability measures | measuring, not gating | none needed |
| 12 | Opus at every stage | listed as current | **Answered:** back to defaults, 13 Nov (log:3604-3605); the gate row is stale (A:78) |
| 13 | Stage write allowance, census tests, fake-DOM ratchet | ratchet 56 → 6, "ends at empty" | none |
| 14 | simple-dispatcher's prose copy of Harbour's notes rules | unchecked against Harbour | none |

Also listed as never removed: the LIN-2323 "~1-month sunset review" never happened; two "until LIN-" markers name Done tickets (LIN-4015, LIN-3952); LIN-4217's index has no drop tool (gate:68). "Also scaffolding: this survey session itself." (gate:70); the course shrinks it to gates or a Thursday handover (course:35, log:4093); not ruled.

### 2.4 About safety findings (counts and ticket ids only)

- **7** findings from the 10 Nov Security Review exist only in area notes, not re-verified. Question: tickets, or into LIN-4416? "Nothing is filed until John says." (gate:25, log:4071). This is the one item the gate marks as waiting now.
- **134** open tickets with a confirmed safety or blocking problem (LIN-4400's pass), collected as LIN-4416; Done-when allows "or John has ruled it can wait" (asks:227, asks:233). Mostly not started (log:3806). About **570** more are "broken but not blocking", and about **33** review findings "sit in neither a ticket nor a note" (course:7).
- Deferred to LIN-4416 by his ruling of 13 Nov (answered): LIN-3417, LIN-1273 (part), LIN-1372, LIN-1395, LIN-1408 (log:3723, log:3653).
- Named as open in v1: LIN-3386, LIN-3387, LIN-3402, LIN-3417, LIN-3394, LIN-1410, LIN-3273, LIN-3281, LIN-2850 (v1:118). In the workspace-sharing ask: LIN-4215, LIN-3836 (asks:321). Next-in-line lane: LIN-2576, LIN-4215, LIN-690, LIN-4155 (log:3594).
- LIN-4210 "waits for John's ruling" since 9 Nov (disc:481); no answer found (A:70).
- The sub-agent file that lists open findings in detail is kept out of the repository (log:4088) and was not read for this sheet.

### 2.5 Housekeeping

- **Jira live check.** Needs from John: an owner token for the Jira-connected workspace, the site address with a project key and epic key, and a Jira API token through the secure form (log:3789). Blocks LIN-4445 reaching Done.
- **The survey record's docs-only PR**, after a check for session links and private details; two older files on main still carry a company name (log:3624, log:4045, disc:743). John approves and merges.
- **Proxy token** expires 15 Nov 15:48 UTC (log:3731); a fresh one is John's to give.
- **Duplicate-state tickets (51):** a quick pass with "John approving closes by group" (log:3611); parked (log:3806).
- **LIN-4441** stays open for its re-measure (log:3576, log:4096).
- **The Plotting the Course page** is stale (A:76); refresh was declined "for now" (log:3619).
- **Budget:** a reading each morning; stop starting work near 80% (log:3869). Last reading 51% (log:4043).
- **Record contradictions to clear when convenient:** NSP:7 says the five measures were cut, but NS:9 has them (A:75); D8's "kept only if the blind read and the cost agree" (disc:364) against measures that never gate (log:3876); D17's "two Linear projects" (disc:678) against the tag (log:3630).

### 2.6 Already answered: do not ask again

- North star v4: "I like it, much nicer. Please apply it." (log:3624); pasted into the Roadmap box: "Roadmap is updated." (log:3631).
- The switch is passed: "This all reads like we're past the gate" (log:3590).
- Goal, measures in order, first stretch, $3,500 a week: "Agreed, perfect" (disc:58).
- Models: defaults, not Opus everywhere (log:3604). Papers on Opus; essays "Written by opus, but designed/reasoned with by fable" (log:4025).
- Measuring: "We're running Periodicals next so that's likely covered?" — Periodicals plus the curve, reported, never gating (log:3876). The parrot check: "let's leave the parrot as is." (log:3875).
- Held merges: "Unless it's for a reason that actually needs me, I'm happy for you to handle it." (log:3773).
- Front end: "no build step, no framework" stays, read as native imports (disc:443); pages become modules, "Happy for it to be whatever size is natural." (log:3715).
- Rulings on 13–14 Nov: all answered (log:3723, 3768, 3771, 3782, 3798, 3812, 3819, 3905, 3998). No ruling is open at the end of the log (log:4096).
- Tag `stretch:open-the-door` in place of a project (log:3630). Workspace sharing as "one big tidy" (log:3598).
- Safety as "a code collection of tasks to run through the improved loop" (asks:227).
- No rescue project or big-bang V2; V1 becomes V2 through ordinary work: "Yes exactly! Please make a note of this" (log:4080).
- Notes spike as the next round; "no changes to Harbour before the discussion": "Let's start then asap. That all looks good." (log:3973-3977).

### 2.7 What John has said no to (do not propose)

- A stall alarm: "It feels like a complex way to solve an issue that either resolves itself, or is masking a bug? Ha! I'm literally thinking 'this seems more complex than necessary'." / "Let's retire, and switch." (log:3573)
- Bypassing the cut rule with a standing direction: "we don't want to fight the system." (log:3799)
- New rules as the fix: "We want all this looser, not tighter." (log:3855); and: "You propose the only solution is removing things. But then suggested rules, additional complexity, and giving agents authority to change the core parts. I think we're seeing the issue." (log:3961)
- Prompts as lists of rules: "The risk is the prompts becoming lists, rules added" (log:1409); "asking them to follow precise steps undermines their ability to reason" (shape:121).
- A model-by-kind layer or a new key: "Happy to just change the defaults rather than adding a new layer." (disc:404; decision disc:400-401)
- A big system for settings or sizes: "We want to avoid building out some big complex system, and this could simply use rulings?" (disc:290). A setting that "makes zero sense for someone who doesn't know specifics of how Harbour works" (asks:204).
- A big backlog sort up front: "Trying to figure it all out in advance will be a fool's errand" (disc:484, reading confirmed by John).
- Retiring views by default: "I'd be sad to get rid, but happy to tidy." (disc:550). See P3 for his later openness.
- The area-read gate and its fixed file sample: "John: drop it." (log:3853, session's report)
- Pacing the budget: "do everything quick then hit the limit … faster with spare capacity lends itself to more time for talk and test." (log:3592). Treating price as a limit: "The pricing limit need not become a red herring." (log:3590); "We're cheap enough as is." (log:3604)
- Testing every Node version in CI: "likely overkill for our needs." (log:3493)
- Amending the Periodicals with a note: "I'd be tempted not to amend anything and just let it run as normal." (log:3978)
- A scheduled Periodical floor: retired on his ruling (log:3347, log:3350). A drain mechanism: "The drain waits" (disc:362, disc:519, agreed). A Plotting the Course refresh "for now" (log:3619).
- Describing the "how" in asks: "Yes, file (avoid describing the 'how')." (log:3164)
- The five measures spelled out further in the north star: "this feels 'in the weeds' and not at the specificity of a north star." (log:3623)
- Any proposal that reads as a rescue project or whole V2 (log:4080, above).
