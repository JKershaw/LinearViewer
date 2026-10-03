# Implementation, bug, look-into: from rules to briefs

Read at the working tree in `/home/user/LinearViewer` on 2026-10-03. Sources:

- `lib/prompt-template-defs.js`: `bug` at 118–170, `look-into` at 331–371, `implementation` at 919–985.
- `lib/prompt-formatters.js`: every formatter these call, plus the post-passes `appendGroundingSections` (787), `formatAttachmentsSection` (859) and `applyPromptCapabilities` (1102).
- `lib/prompt-templates.js` `generatePrompt()` (248), which does the assembly.
- `lib/prompts/meta-prompt-template.js`: the Bug-prompts rule (301), the Implementation-prompts rule (306), the label instruction (336), and the shared Grounding / Scale / Prompt Structure blocks (113–126, 241–295). There is no look-into quality rule.
- The consumers in `lib/run-evidence.js`, `lib/file-pointer.js`, `lib/dispatch-factory.js`, `lib/openrouter.js`, and `/home/user/simple-dispatcher/hook.js`.

## What code already adds around every one of these briefs

`generatePrompt()` wraps each template body in deterministic post-passes, and the meta path does the same through `applyGroundingToRecommendation`. The new mechanical layer keeps all of this, and none of it needs to live in the writer's brief:

- **Staleness check** (`formatStalenessCheck`, formatters 543): "Re-ground the Ticket", which runs `git log --since=<createdAt>`.
- **Terminal-state and all-children-complete notes** (672, 705).
- **Bug-already-investigated note** (`formatBugInvestigatedNote`, 745). It is gated on a `bug` label plus at least one comment, and it applies to *any* template with that label, including implementation.
- **Attachments section** (859). It appears only when attachments exist.
- **Git, self-review, CI/CD and PR-review appendices.** These depend on feature flags, and the code-review ones go to `implementation` only (`IMPLEMENTATION_TEMPLATES`, prompt-templates.js:26).
- **Capability post-pass** (`applyPromptCapabilities`). It renames "Linear", strips " in Linear", removes tracker-write steps on read-only providers, rewrites state names, and strips subtask sections.
- **At dispatch:** `finalizePrompt` appends the proxy context and credential (dispatch-factory), and on alternate implementation dispatches the file pointer is **prepended** (`[file-pointer v1]`, file-pointer.js:66, 254).
- **At the Stop boundary**, Simple Dispatcher asks for the completion sentinel itself (`SELF_CHECK_PROMPT`, hook.js:415), so no brief has to teach that format.

---

## 1. Implementation

### What it's for

"The plan's done. Go build it properly, prove it works, and put up a PR that review can approve."

### The ideal version

> You're building {identifier}, "{title}". {task facts: project, parent, sibling and subtask one-liners; where the plan lives (the `## Implementation Plan` section of the description); where the research is}. The ticket, its plan and its comment thread in {tracker} are the source of truth and may have moved on since this was written, so read them first. Read the research the plan was drawn from as well as the plan. A plan is a summary, and summaries lose things. Where the plan drops a caution the research raised or disagrees with it, go with the research's reasoning and say so.
>
> The goal is the problem solved well. Ticking off the plan's steps is not the goal. If the code has moved since the plan was written, adapt. If the approach itself no longer holds, stop and say why rather than build something you don't believe in. If you find the problem has a cause beneath the one the plan addresses, fix it there. If a refactor makes the change simpler or leaves the code calmer, do it. If the same flaw sits elsewhere, it's the same problem, so fix it too.
>
> Before changing anything shared, find out who depends on it. If you change behaviour other code relies on, do it on purpose. Write down what the old code actually did (its checks, its errors, its edge cases), pin it with a test before you start, and call out every difference in your summary. A "pure refactor" that quietly changes behaviour is a bug even when the new behaviour is better.
>
> There's one limit on your judgement. A change John would want to hear about before it happens goes to him first: product behaviour users would notice, a published API or contract, stored data, another repo's interface, or anything hard to undo. Describe the choice and what you'd recommend, then carry on with whatever doesn't depend on it. Everything else is yours to decide. Record what you decided and why.
>
> Prove it works. Test what you changed on purpose and what it might have changed by accident, cleanup and teardown included, not only the happy path. Watch every new test fail against the old code before you trust it. A test you've never seen fail may not be testing anything. If a test can't fail (for example, it pins existing behaviour), break the behaviour briefly to watch it go red, or say why that isn't possible.
>
> Land it as one pull request: a branch off main, commits that mention {identifier}, and a PR into main. Then check CI once. See whether the repo has CI and whether checks have registered on the PR, giving them a moment after the push. If they exist, get them green. If the repo has no CI, say so and run the suite on your branch and on main, comparing failing tests by name, and record that instead. Never wait on checks you haven't seen exist. Merging isn't yours: review comes next.
>
> Finish with one comment on {identifier}. Give the PR link, what you changed and why, anything a reviewer should look at closely, and anything you found and deliberately left, with the reason.
>
> If you get stuck, try to clear it yourself first. If you're waiting on whoever dispatched you, you're waiting, not blocked. You're only blocked when a person has to decide something. Then say what's done, what's needed and who has to act. {Principle 0 test sentence, from the manual}

### What machines rely on

| What | Exact string or shape | Where it's read |
|---|---|---|
| Dispatch kind | template key `'implementation'`, display `name: 'implement'`. Both are aliases in `_DISPATCH_KIND_BY_ALIAS` | `deriveDispatchKind`, prompt-templates.js:228. The kind gates the file-pointer pilot (`effectiveKind === 'implementation'`, dispatch-factory.js:1074; `isPilotEligible`, file-pointer.js:278), `SPINE` (run-view.js:29), effort readouts (effort-readout.js:445, 497) and the code-review appendices (`IMPLEMENTATION_TEMPLATES`, prompt-templates.js:26) |
| PR link in a tracker comment | a full URL matching `/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/g`. There must be **exactly one distinct PR**: none gives `'no-pr'` and two or more give `'multiple-prs'` ("more than one PR: close each out…") | `extractPrUrls`/`deriveState`, run-evidence.js:17, 64–98. The repo must also be on the workspace allowlist. `github-pr-files.js:36` reads the same URL shape (`PR_URL_RE`) for the file pointer |
| Plan location (input, written by plan) | description heading `/^##[ \t]+Implementation Plan\b[^\n]*$/gm`, matched by prefix, last one wins | `extractPlanSection`, file-pointer.js:150 |
| File pointer prepended above the brief | `[file-pointer v1] Starting points from this ticket's plan and earlier PRs — not the scope; re-read before trusting:` | `prependFilePointer`, file-pointer.js:254. The brief must not assume it is the first text, and it must not contain this marker itself, because a present marker suppresses the prepend |
| Workflow shape for the capability post-pass | a `## Workflow` heading, numbered `^\d+\.\s+` steps, and write steps recognised by `/\*\*(Start\|Commit\|Complete\|Update[^*]*)\*\*/` or `/\bSet\b[^\n]*status to/i` | `gateWorkflowWrites`, formatters 993, 1009–1010 (read-only providers only). Today `**Commit & push**` does *not* match `**Commit**`, so it survives on read-only providers, which is correct because it's git |
| State wording | `status to "In Progress"` / `status to "Done"` | `shapeWorkflowStateWording`, formatters 1046 (fixed-state providers such as GitHub) |
| Tracker name | the literal word `Linear`, and the suffix ` in Linear` | `applyPromptCapabilities`, formatters 1107–1112 (renamed to `displayName`, or stripped when the tracker is off) |
| Subtasks list | a line that is exactly `**Subtasks:**` followed by its list | `stripSubtaskSections`, formatters 1076 |
| Completion sentinel (from the agent, not the brief) | `DONE:` `FAILED:` `BLOCKED:` `PENDING-INTERNAL:` `PENDING-EXTERNAL:` (and legacy `PENDING:`) at the start of a line | `parseCompletionSentinel`, simple-dispatcher/hook.js:474. Simple Dispatcher asks for it itself (hook.js:415–428), so the brief only needs the *meaning* of blocked versus waiting |
| Endpoints the agent calls (in appended sections) | `GET /api/proxy/attachments/<id>`, `att:`/`md:` handles, `ATTACHMENT_HOST_NOT_ALLOWED`, `GET /api/proxy/autopilot/manual` | the attachments section (formatters 859) and `formatIfBlocked` (906) |
| Meta-path reply (recommender, not the brief) | `## Reasoning`, `→ **<action>**`, `**DeferTo:** <id>`, `## Prompt` | openrouter.js:1677 (`/→\s*\*\*(.+?)\*\*/`), 1696, 1721–1722 |

**Conventions only, not parsed in this repo:**

- The branch name (`feat/<id>-…`).
- The identifier in commits and PR titles. It is probably what lets the tracker's GitHub integration link the PR, and the retrospective-audit stage uses `git log --grep=<identifier>`. I have not verified the tracker side.

**Tests that pin today's wording** (these move with a rewrite):

- `prompt-templates.test.js:4252–4254`: `Re-ground the Plan`.
- `prompt-templates.test.js:4535–4543`: slices between `### Implementation Guidelines` and `### Shared Boundaries`, then checks `/observe it fail/`.
- `prompt-templates.test.js:4576` and `openrouter.test.js:1641`: `/observe it fail/` in the meta bullet.
- `prompt-templates.test.js:4711`: `/Establish CI \(or Its Substitute\)/`.
- The Principle 0 sentence, verbatim.
- The rendered byte budget in `prompt-size-budget.test.js`.

### Rules that tie scope to the ticket

| Line | Quote |
|---|---|
| defs 956 (Role) | "You have authority to implement code and tests **within the defined scope; flag scope expansion for approval rather than absorbing it**." |
| defs 958 | "If something has drifted, **stop and recommend re-planning before implementing**." (Any drift, however small, stops the work.) |
| defs 973 | "7. **Keep changes minimal and focused on the task**" |
| defs 974 | "A silent behavioral change on a shared path is a defect **even if the new behavior is arguably better; surface it**." (Sound as stated, but read beside 973 it pushes toward not touching anything.) |
| defs 978 | "When multiple behaviors converge on the same function, component, or state, **ensure each behavior stays isolated**" |
| defs 964 / formatters 594 | "**flag the conflict rather than silently picking one**" / "trust the research's intent and **flag the discrepancy**". The agent is told to report the conflict, not resolve it. |
| meta 306 (7) | "surface the discrepancy rather than silently picking one" |
| meta 306 (8) | "surfacing any silent behavioral change on a shared path as a defect even if the new behavior is arguably better" |
| meta 117 (all prompts) | "your job is to route to the right action and faithfully restate the ticket" |
| meta 132 (all prompts) | "Keep the generated prompt inside the single action you recommended" |

### How today's version differs

**Rule-shaped text that should become guidance:**

- The nine-step Workflow plus the eight numbered "Implementation Guidelines" plus a separate "Shared Boundaries" section plus a separate "Re-ground the Plan (fidelity check)" with its own three numbered steps. These form one paragraph of intent ("read the research, not just the plan; build the real fix; prove it"), spread over four headings.
- Guideline 2, "specify both the behavior **and** its cleanup/teardown contract", is a plan-authoring instruction sitting in the build stage. It survives in the ideal as "cleanup included" when testing.
- Guideline 3, "For new dependencies… verify all required setup beyond just API calls", and the meta rule's conditional "**if the ticket names a new dependency**". This is what anyone integrating a library does, so it can go.
- `formatCiGateCheck` (formatters 475–486) is a paragraph of CI epistemics ("allowing one settle… never arm a Monitor… independent clean environment, an author-independent run, future-commit coverage, flake/regression separation — is residue to record"). The two sentences that matter are "check once and don't wait on checks you haven't seen exist" and "no CI: run both branches and compare failures by name". The rest is review's ledger concern restated in the build stage.
- `formatIfBlocked` (906–921) gives three numbered steps, then a PENDING-EXTERNAL versus BLOCKED taxonomy, then a pointer to the manual. Simple Dispatcher's own Stop prompt already teaches the sentinel. The brief needs only the distinction "waiting on your dispatcher is not blocked" plus the Principle 0 sentence.

**Scar tissue, restated elsewhere, or broken:**

- "The research's reasoning wins" is said **three times**: guideline 1 (defs 964), `formatPlanFidelityCheck` (594), and meta (7). It should be said once.
- The source comment at defs 969–971 and meta 39–42 says the canonical witness wording is at `lib/prompt-template-defs.js:127`. It is at **153** now. This is a stale line pointer in a comment.
- Guideline 6 spends about 100 words on "observe it fail" and then explains that it "extends the acceptance-witness discipline the bug/investigate template already requires". Cross-template lineage is for maintainers, not agents.
- Two places say merging is not this stage's job: Workflow step 8 and meta (6) "Merging is NOT part of this step… after `review` approves". Workflow step 8 also restates the whole CI gate inline before pointing to the CI section.
- The meta Implementation rule (306) is about 620 words of "(1)…(10)". Items (2) and (5) are conditional template logic ("if the ticket names X, include Y; otherwise…"). This is the clearest case of a prompt written as code.
- `COMPLETION_SIGNALS.implementation` (completion-signals.js:165) still says "Code changes committed" and "Summary comment added", with no PR and no CI. That is out of step with the aiHint and the Workflow, which make the open PR "the deliverable". The mechanical layer should fix the signal rather than the brief working around it.

**What today gets right and the ideal keeps:**

- The plan is a lossy summary of the research. Read upstream, and where they conflict the research wins (LIN-698).
- Watch a new test fail before trusting it, or use the mutation equivalent (LIN-2219).
- Don't trust a "refactor" or "behaviour-preserving" label: enumerate the old behaviours and pin them first. A skilled developer refactors *more* under the new intent, so this matters more, not less.
- One PR as the deliverable. CI checked once and boundedly, with the no-CI substitute (LIN-1358/1455). Merging belongs to the next stage.
- Read the live ticket rather than a copy (`formatDiscussionReference`).
- The Principle 0 gate on parking.

---

## 2. Bug

### What it's for

"Something's behaving wrong. Find out why, for certain, and fix it where it starts, not where it shows."

(Today it is a *diagnosis-only* stage. The Goal is to "Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach" and the Role says to "propose fixes". The recommender then routes to `implementation` once the cause is confirmed (meta 184). The ideal below lets the bug stage fix at the cause when the fix is clear. That is a pipeline choice for John; see the note at the end of this section.)

### The ideal version

> {identifier}, "{title}", reports behaviour that's wrong. {task facts: project, parent, sibling one-liners}. Read the ticket and its whole comment thread in {tracker} first. Earlier investigation may already have found the cause, or a later comment may have overturned it. Go by what still stands at the end of the thread, re-checked against today's code, and carry on from there rather than starting again.
>
> Your job is to find out why this happens, for certain, and then fix it where it starts.
>
> Reproduce it first, and decide how you'll know it's fixed. Make sure that signal really tracks the problem: a test that can pass while the bug is still there is worse than none. Then find the cause. Read the recent history of the code involved, and check whether this was fixed or investigated before. A bug that comes back usually means an earlier fix treated a symptom, and past investigations often name the experiment that settled things last time. Don't stop at a plausible explanation. Find the one experiment that would tell your leading theory apart from the alternatives, and run it. Once you have the cause, ask whether it's a one-off or a pattern. Search for the mechanism, not just the symptom the ticket describes, and treat every instance you find as part of the same problem.
>
> Then fix it at the cause, including the other instances and any refactor that makes the fix simpler and the code sounder. Land it like any change: {landing paragraph shared with implementation, covering one PR, tests watched failing first, and CI checked once}. There are two cases where you stop at the diagnosis and hand it on instead: the right fix is a change John would want to hear about first (product behaviour, a published contract, stored data, another repo's interface, anything hard to undo), or it's clearly more than one session's work.
>
> Either way, write it up as a comment on {identifier}. Say how to reproduce it, what the cause is and which experiment confirmed it, whether it was isolated or a pattern (and where else it appears), and what you fixed or recommend. Leave the `bug` label on: it's the lasting record that this was a bug, and moving the task to Done is what marks it resolved.

### What machines rely on

| What | Exact string or shape | Where it's read |
|---|---|---|
| Template key, label and kind | key `WORK_ISSUE_LABELS.BUG` = `'bug'`, `name: 'bug'`, `category: 'work-issue'`. The template is chosen by the label of the same name | `PROMPT_TEMPLATES` lookup by label; `deriveDispatchKind` alias; meta action vocabulary (meta 67) |
| The `bug` label must stay | label name `bug`, compared case-insensitively | `formatBugInvestigatedNote`, formatters 746 (`String(l).toLowerCase() === WORK_ISSUE_LABELS.BUG`); meta Step 2 routing (181–188); reports (LIN-548). This is why "leave the `bug` label" must survive verbatim in intent (meta 336 requires it on the meta path) |
| Findings comment | **no code parses it.** The next recommender reads it as prose: meta Step 2's "already investigated" check and the divergence veto (184–188) need a stated root cause, the confirming experiment, and a fix direction. The phrase `Root cause CONFIRMED` appears only as an *example* in meta 147/194 and is not matched anywhere | model-read only |
| Workflow shape | `## Workflow`; `1. **Start**: Set {id} status to "In Progress" in Linear`; `4. **Update Linear**: …` | `gateWorkflowWrites` / `shapeWorkflowStateWording`, formatters 1009–1010, 1046 |
| Tracker name | `Linear`, ` in Linear` | `applyPromptCapabilities` |
| If the bug stage starts landing fixes | the same single-PR-URL contract as implementation (run-evidence.js:17, 95–98) | the run-evidence and close-out readers |
| Sentinel and endpoints | as for implementation (Simple Dispatcher asks for the sentinel itself) | hook.js:474 |

**Tests that pin today's wording:**

- `prompt-templates.test.js:524–531` pins the whole Goal block, line for line.
- `prompt-templates.test.js:985`: `/the fix stays minimal/i` ("a found class must not widen the fix").
- `openrouter.test.js:1705`: `'the fix stays minimal'`.

### Rules that tie scope to the ticket

| Line | Quote |
|---|---|
| defs 145 (Role) | "You have authority to reproduce issues, trace root causes, and **propose fixes**, but should not deploy changes without review." |
| defs 149 | "Identify reproduction steps, **hypothesize** likely causes, and **suggest a debugging approach**." (This also contradicts step 5, which requires confirmation.) |
| defs 162 | "7. **Propose fix with minimal scope.** If step 6 found a class, **the fix stays minimal — name the class and list the unhandled instances in your findings comment instead of silently widening the fix**." |
| meta 301 | "If a class exists, **the fix stays minimal — name the class and record the unhandled instances as a comment rather than silently widening the fix**." |
| docs/architecture/prompt-system.md:20 | "The directive never expands scope: a found class is named and its instances recorded… while the fix stays minimal". The doc states the same rule as policy. |
| formatters 343 | "Add findings as a comment and update labels if needed". (This conflicts with "leave the `bug` label" at defs 165.) |

defs 162 and meta 301 are the essay's exact case, "the bug investigation finds the cause and is then told that 'the fix stays minimal'". In both places the class check is followed directly by an order not to act on it.

### How today's version differs

**Rule-shaped text that should become guidance:**

- An eight-step numbered "Investigation process" with sub-bullets. Steps 1, 4 and 8 ("Reproduce", "Debug systematically (add logging, trace execution)", "Verify fix doesn't introduce regressions") tell a debugger how to debug. Steps 2, 5 and 6 carry the real lessons and are each written as gate, verdict and exception ("A witness that genuinely tracks the outcome is a valid answer — state it explicitly", "is NOT done; a genuinely confirmed cause is a valid answer and must be stated explicitly", "A genuinely isolated issue is a valid answer — state it explicitly"). Saying three times that the agent must state a valid answer explicitly is how code handles a null case. A brief doesn't need it.
- Step 3's heuristics: "`git log --oneline -15`… if 3+ commits touch the same file, that signals tight coupling", and "if no results, widen the keyword or skip — absence of results doesn't mean no prior fix". These become "read the recent history and look for earlier fixes".
- Meta 301 is about 330 words of "must include… must also require… must require… And they must search wider".

**Scar tissue, restated elsewhere, or contradictory:**

- The opening line at defs 147 ("Start by reading any prior investigation notes… re-verify") is restated by the appended `formatBugInvestigatedNote` (formatters 754) whenever comments exist, and by the universal staleness check. That's three re-grounding passages in one prompt.
- `formatBugInvestigatedNote` says "the investigation is DONE — confirm the findings still hold… **then move to implementing the fix**". The bug template's own Role says only "propose fixes". Today the same prompt tells the agent both to fix and not to fix. The ideal resolves this by letting the bug stage fix.
- The Workflow's "update labels if needed" (formatters 343) contradicts "**When fixed**: Leave the `bug` label in place" (defs 165).
- "Seed from both the technical lead and the meta-pattern ('this class of bug, last time the decisive experiment was X')" (defs 157) is a good lesson in jargon. The ideal says it plainly.

**What today gets right and the ideal keeps:**

- Validate the acceptance witness before optimising against it.
- Confirm the cause with a decisive experiment, not plausibility.
- Look for prior fixes and investigations, because recurrence means a symptom was treated.
- The class check: search for the mechanism, not the symptom. The ideal keeps the check and drops the order not to act on it.
- Trust what *still stands* at the end of the comment trail (the meta divergence veto, compressed to one sentence).
- Keep the `bug` label.

**Pipeline note.** If the bug stage lands fixes, three things follow:

- It needs the implementation landing contract (one PR URL in a comment, the CI check).
- `COMPLETION_SIGNALS.bug` ("Issue understood well enough to fix", completion-signals.js:42) should change to "fixed at the cause, or diagnosis handed on".
- Meta Step 2 can route a confirmed-and-fixed bug straight to `review` through Step 3's already-landed check, which already works.

If John prefers to keep diagnosis and fix as separate stages, then the bug brief ends at the write-up. Its last paragraph would then say "recommend the fix at the cause, including the other instances", with no "keep it minimal".

---

## 3. Look into

### What it's for

"Before I decide anything, tell me what this ticket is really about, where it stands, and what you'd do next." It is a quick, read-only orientation for a person.

### The ideal version

> Someone wants to understand {identifier}, "{title}", before deciding what to do with it. {task facts: project, parent, sibling and subtask one-liners}. Read the ticket and its comments in {tracker}, and as much of the code or surrounding work as you need to explain it honestly.
>
> Tell them briefly what the task is really asking for and why it matters, how it fits the project and the tasks around it, where it stands now and what's in its way, and what you'd do next and why ({available next steps}). If the ticket is unclear, contradicts itself, is already done, or is aimed at a symptom of something deeper, say so. That's often the most useful thing you can tell them. Don't change anything. This is for understanding, not action.

### What machines rely on

| What | Exact string or shape | Where it's read |
|---|---|---|
| Key and kind | key `VIRTUAL_PROMPTS.LOOK_INTO` = `'look-into'`, `name: 'look into'` (an alias in `_DISPATCH_KIND_BY_ALIAS`) | `deriveDispatchKind`; default buttons `DEFAULT_PROMPT_KEYS` (render.js:115, render-swipe.js:27); `wall-clock-summary.js:43` (`'look-into': 'before'`); dispatchable through verb override (proxy-instructions.js:826) |
| Label filter | `formatLabels(issue.labels, [VIRTUAL_PROMPTS.LOOK_INTO])` | defs 351 (drops its own label from the context line) |
| Workflow | `## Workflow` from `formatInformOnlyWorkflow` (formatters 390). It has no write steps, so `gateWorkflowWrites` is a no-op | formatters 993 |
| Subtasks list | exactly `**Subtasks:**` then the list | `stripSubtaskSections`, formatters 1076 |
| Tracker name | `Linear`, ` in Linear` | `applyPromptCapabilities` |
| Output | **nothing parses it.** It goes "to the user" (formatters 398). When look-into is *dispatched* there is no user watching, and the only durable trace is the agent's `DONE:` line and transcript. Look-into writes no comment by design | none |

There are no tests that pin look-into's Goal text specifically. The rendered byte budget covers it.

### Rules that tie scope to the ticket

| Line | Quote |
|---|---|
| defs 358 (Role) | "Your role is to **summarize and inform, not to make decisions or changes**." |

This fits the purpose: orientation shouldn't act. Nothing in look-into tells it to ignore a deeper cause. Today it simply never invites one. The ideal adds "or is aimed at a symptom of something deeper", which is the one place look-into can serve the fix-at-the-cause intent.

### How today's version differs

- Today's version is already mostly brief-shaped and short. The problems are around it:
  - The universal staleness check (formatters 543) bolts a three-step `git log --since` procedure onto a quick orientation, which is more than an overview needs.
  - A `## Workflow` with "Fetch details / Analyze / Summarize" restates the Goal.
  - "Recommended next action (which prompt type to use next)" asks for a vocabulary the agent is never given. Either the mechanical layer supplies the list of stages ({available next steps}), or the brief asks for a plain-language next step.
- Today's version gets two things right, and the ideal keeps both: it is read-only, and the four-part summary (what it is, how it fits, where it stands, what next) matches its completion signal (completion-signals.js:68).
- There is no meta-prompt quality rule for look-into, so on the meta path it is written freely from the generic Prompt Structure. The same short brief can serve both paths.
- Open question: should a *dispatched* look-into leave a comment? It is the one stage whose output is lost when no one is watching.

---

## Cross-cutting findings

1. **The scope brake at the point of fixing comes in two forms.**
   - The bug stage's "the fix stays minimal" (defs 162, meta 301, and as policy in prompt-system.md:20) turns a found class into a note.
   - Implementation's "Keep changes minimal and focused on the task" (defs 973), together with "flag scope expansion for approval rather than absorbing it" (defs 956) and "stop and recommend re-planning" on any drift (defs 958), turns a found cause into a flag.

   Three tests pin the bug phrase. No test pins the implementation phrases by text. The ideal replaces both with one limit, John's "would he want to hear first" test, and gives engineering authority to the agent.

2. **The same lesson is repeated, and the copies drift.** "Research wins over plan" is said three times in the implementation prompt. Re-ground-before-acting is said three times in the bug prompt. The meta rules restate every template lesson a second time as "must" lists. Comments cite a stale line (`prompt-template-defs.js:127`, now 153). In the two-layer design each lesson lives once, in the rule record, and the writer turns it into prose.

3. **The machine contracts are few and precise.** Code adds them; the writer should neither emit nor paraphrase them:
   - the template keys and `name` aliases (they feed dispatch `kind`, the file pointer and the spine);
   - **exactly one** `https://github.com/<owner>/<repo>/pull/<n>` in a tracker comment from implementation (and from bug, if it lands fixes);
   - keeping the `bug` label;
   - the `## Implementation Plan` heading as an input;
   - the `[file-pointer v1]` prepend.

   There is one structural trap. The capability post-pass is a regex over `## Workflow` numbered steps with `**Start**` / `**Update …**` labels, plus `status to "In Progress"`, plus the literal `Linear` and `**Subtasks:**`. Prose briefs will not match those regexes. The mechanical layer should therefore decide tracker-write sentences *before* writing, from `resolvePromptUi` (write, subtasks, displayName, fixedStates), rather than strip them afterwards.

4. **Completion sentinels need no brief text.** Simple Dispatcher asks for `DONE:`/`FAILED:`/`BLOCKED:`/`PENDING-INTERNAL:`/`PENDING-EXTERNAL:` itself at the Stop boundary (hook.js:415–428, parsed at 474). The brief only needs the *meaning*: waiting on your dispatcher is not blocked, and only a person's decision is.
