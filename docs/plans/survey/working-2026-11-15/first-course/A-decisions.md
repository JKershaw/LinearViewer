# A. What is already decided and plotted (read 14 Nov 2026)

Citations, by line: **L** `course/survey-log.md`; **D** `discussion.md`; **A** `asks.md`; **G13/G14** the gate files; **NS** `docs/north-star.md`; **NSP** `north-star-v4-proposal.md`; **PtC** `course/tmpA/plotting-the-course.txt` (the stripped page); **PtC-run** text the page's script renders at its defaults; **LoH** `artifacts/land-on-the-horizon.html`.

## 1. Standing decisions and rulings by John

**Frame**
- Goal: "Harbour brings codebases toward settled, including its own. Settled is a balance, not smallness" ("Agreed, perfect", D58-59). Plan in four-week stretches worked backwards (D60). Measures in clash order: no new mess, the curve, speed, his seat, cost (D64-69). No targets yet (D70).
- No rescue project or big-bang V2: V1 becomes V2 piece by piece through ordinary work ("Yes exactly!", L4080).
- John writes or approves every ask word for word; the session is "an agent, not a script" and acts lightly (D124-131). Asks "avoid describing the 'how'" (L3164).
- Readiness means "all the work lands clean and right", not fewer clicks (L4027).

**Loop and product rules**
- Outside-area finds go to area notes; a ticket only if it breaks, blocks or touches safety (D174). Rulings stay as they are (D248). Task size is a ruling; a setting "must make sense to a new user" (D284-286). Both Surveys on code tasks (D314). No Periodical per task by default (A138-140). No big backlog sort (D477-480).
- "If I choose to do something, Harbour is a passenger" (L3609; NS13).
- Front end: "no build step, no framework" stays, read as native browser imports (D443); pages become ES modules (L3715). No view retired by default (D545-547). Later: open to cutting features "if the cost to keep them is genuinely high enough"; big shape changes "require humans to rule" (L4085, L4039).
- Held merges are delegated unless the reason is his call (L3773).

**Said no to**
- The stall alarm: "this seems more complex than necessary… Let's retire" (L3573).
- A drain mechanism (D362, D519); a capped worker key and a model-by-kind layer (D400-401); a conditional one-look (D317); a surface census (D545); a scheduled Periodical floor (L3347, L3350); testing every Node version (L3493).
- Bypassing cut rulings: "we don't want to fight the system" (L3799). Pacing the budget (L3592). Refreshing Plotting the Course "for now" (L3619).
- The area-read gate and its file sample (L3853); changes to Harbour before the discussion (L3975).
- New rules as the fix: "We want all this looser, not tighter" (L3855).

**Method preferences**
- Rules: "The risk is the prompts becoming lists, rules added" (L1409). Scaffolding is fine: "We just need to plan their removal" (L3964). Use what exists (NS23).
- Measuring: Periodicals plus the curve, reported, never gating (L3876, L3862); per piece of work, not weekly (D630); "mixed results is actually fine" (L3590).
- Cost: "happy for pricing to go up… The pricing limit need not become a red herring" (L3590); "We're cheap enough as is" (L3604).
- Models: stage defaults since the switch (L3604-3608); a cheaper, better same-family model just becomes the default (D399). Opus for papers; essays "written by opus, but designed/reasoned with by fable" (L4025).
- Budget: $3,500 a week at list prices (L3178, D63); "a fine somewhat informal limit… helps frame prioritisation" (L3590). Read as a percentage, reset Thursday 07:00, stop starting work near 80% (L3741-3745). 51% at midday 14 Nov (L4043).

## 2. What "open for business" has meant so far

- John's phrase appears once: he is unsure "when we will be simply running work which opens Harbour for business without needing hand holding" (L4026). A definition or a date: not found.
- **First door:** "a small outside team on Jira, who already use agents, can hand Harbour real tasks on their own runner" (D61). Team not named (D447). They are on subscriptions, so Costs waits; John sets up the runner himself (D442).
- **Then strangers, three milestones (PtC542-547):** M1 sign in, connect, copy a grounded prompt; M2 hand over one task on their own logins and model key, one approval click, cost shown; M3 hosted accounts, billing behind the hardening gate, free tier, governance and licence. North-star bar: "Login → connected → first evidence-verified merge, without talking to the operator" (NS25).
- **Needs, Jira team:** create issues and hold the sealed ask (A157-169); LIN-2805, real-site checks, boards (D82); a shared team workspace, since each Jira sign-in makes a private one (L3354; A301-322); the safety list closed in code (134 confirmed tickets, A227); a check on what Harbour keeps of a company's code (PtC149).
- **Needs, strangers:** fresh clone and secrets per task, own model key, tenants kept apart, a threat model (PtC545).
- **Gates:** "boring before busy" (the switch): the running agent only files, starts, reads and records for a week (PtC105-110, D62); John declared it passed on 13 Nov (L3590). Floor: a week of real use (PtC-run). A second gate (papers, Periodicals, essays, then discussion) was reached on 14 Nov (L4034, L4077).
- **Week counts from 8 Nov:** M1 about week 3.2, M2 about 4.8, the team tries it about week 5, about $1,600 a week (PtC-run; D76). Unpushed road: weeks 7, 16, 18 (L3196-3198). Calendar dates: not found.
- **14 Nov ideas, not rulings:** V1 is "A* quality, through and through", after which Harbour mostly runs other projects (L4085); "a small outside project before V1" as a judge (LoH, "The course from here").

## 3. The 8 Nov course, stage by stage (PtC-run)

- **Make it boring, weeks 1–2, two in flight: done early** (end of week 1, G13:27). Blind read before merge done (LIN-4396, L3560); sessions on one clock done (LIN-4395); measures as a Periodical done (LIN-4399, L3572). Rulings hop and one-look dropped (D251, D317); stall alarm retired (L3573). The drain became LIN-4414, yet Waiting went 66 → 118 (G14:51-52). The backlog sort became a safety pass, done (LIN-4400). Jira asks filed 13 Nov (L3628).
- **Open the door, weeks 3–5, four in flight: partly.** Lanes started 13 Nov (L3632, L3647).
  - Jira create and seal: built, merged, deployed; the check on John's Jira waits on his credentials (L3785-3789).
  - Theseus lanes LIN-4447 and LIN-4448: Done; area reads inconclusive (L3929, L3997-3998).
  - Front end: slice 1 plus three views as modules; LIN-4463 paused for budget (L3813).
  - Runner packaging and the Costs page: dropped as tasks (D442).
  - Not started: workspace sharing LIN-4449, side rail LIN-4342, sweep LIN-4343, most of safety LIN-4416 (L3806); A9 held (L3603).
- **They try it, about week 5: not started.** "Open the door hasn't started" (G13:27); 69 of 115 landings since 7 Nov were loop-building, clean-up, measuring or papers (L4086).

## 4. North star v4 (accepted 13 Nov, NS29)

No numbered goals. Headline, verbatim (NS5): "Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, brings codebases toward settled, its own included, funds itself doing it — and proves every word."

Its one ranked list (NS9): no new mess; the curve; speed; the person's seat; cost per finished task. Principle heads, in order (NS7-27): settled is a balance; verified beats claimed; one contributor among several; cost "measured, not optimised, for now"; operator minutes are scarce; gates buy evidence, never delay; leave it better, finish transitions before starting capabilities; use what exists; meet a developer at the saved prompt, make the next step safe before it is visible; every claim reachable from its evidence.

## 5. Open questions waiting on John

1. Seven safety findings living only in area notes: tickets, or into LIN-4416? (G14:25, L4071)
2. The 14 scaffolding structures: stays, goes, or planned removal (G14:45-64).
3. The notes format, and the notes spike (L3977, G14:74).
4. Jira live check: his token, site and keys (L3789).
5. LIN-4463: when to resume; its pass figure is "TBD" (L3793).
6. An ask to fix the cut rule (L3799); when the parked work starts (L3806).
7. The survey record's docs-only PR, after a privacy check (L3624, L4045).
8. LIN-4210's ruling (D481): answer not found.
9. The proposed bare-session baseline, and what V1 is (L4078, L4085): no ruling found.

## 6. Contradictions

- **North star measures.** NSP7 and NSP103 say the five measures were cut as "in the weeds"; the applied text has them (NS9), and the log ties "in the weeds" to "mixed readings are fine" (L3623).
- **Plotting the Course is stale:** it still models the runner and Costs as tasks, two dropped hops, a hard sort and four retirements (PtC-run against D442, D369, D485, D545).
- **D8** keeps a change only if "the blind read and the cost agree" (D364). Later, cost is no target and measures never gate (L3590, L3876); the blind-read gate remains in code (G14:54).
- **G14:62** lists "Opus at every stage" as current; lanes have run on defaults since 13 Nov (L3632).
- **D17** says two Linear projects (D678); the log settled on a tag (L3630).
- **Order of the door:** D1 puts an outside team at about week 5; LoH puts V1 first, with outside work after it.
