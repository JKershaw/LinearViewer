# retro and retrospective-audit: from rules to briefs

Sources read: `lib/prompt-template-defs.js:1232-1355` (both `generate()`s), the formatters they
call (`lib/prompt-formatters.js`: `formatHeader`, `formatReadOnlyWorkflow`,
`formatInformOnlyWorkflow`, `formatSection`/`formatMultiLineSection`, `formatProject`,
`formatParent`, `formatSiblings`, `formatChildren`, `formatLabels`, `formatDiscussionReference`,
plus the post-passes `appendGroundingSections` and `applyPromptCapabilities` that
`generatePrompt()` runs on every template), `lib/completion-signals.js:203-224`, the meta-prompt
(`lib/prompts/meta-prompt-template.js:140-150, 311`), `lib/prompt-templates.js:431-440`, and the
history behind the audit (`docs/reviews/lane-run-review-2026-08-23.md:480-600`,
`docs/reviews/proposal-red-team-2026-09-18.md:60-80`, `docs/papers/harbour/prompt-kinds.md`,
`efficiency-levers.md:50`, `like-a-skilled-developer.md`). I rendered both prompts for a Done,
bug-labelled task to see what an agent actually receives.

## Three things that matter most

1. **The audit's own origin story says it must own its filing, and the shipped template forbids
   it.** The sweep that created `retrospective-audit` (LIN-2261) found 8 real defects in 50
   landed tickets: three fixes that changed nothing, a guard the comments claimed but the code
   didn't have, a metric that measured its own instrument. Its written lesson was: "`review`'s
   rule that filing belongs to close-out breaks down on landed work, because no close-out is
   coming. Wave 1's reviewers deferred and their findings sat inert as comments; wave 2's filed
   six real tickets. The retrospective template must own its own filing"
   (`lane-run-review-2026-08-23.md:595-598`). The template then shipped with "do not file
   follow-up tickets — if a finding warrants one, name it in your findings comment and leave the
   decision to the reader" (`prompt-template-defs.js:1286`). That is the "noted and left" outcome
   (46% of off-frame findings, per `like-a-skilled-developer.md` §2) written in as a rule. The
   same review asked for mutation checks to be **mandated** ("rather than hope for them"); the
   template says "where feasible, reason about whether a real regression ... would make the test
   fail" (`:1278`), which is reasoning in place of doing the check.

2. **Code appends instructions that contradict both templates.** `generatePrompt()` runs
   `appendGroundingSections()` on every template. On a Done task (the normal case for both of
   these) it appends `## Task Already Complete`, which says "Treat this as a review/verification
   pass: confirm the finished work holds up against the goal, capture anything genuinely missing
   as a follow-up, and close out" (`prompt-formatters.js:682`). That contradicts the audit's "never
   re-verify overall correctness" and "do not file follow-up tickets", and the retro's "do not
   write them back". On a `bug`-labelled task with comments it also appends `## Prior Investigation
   On Record — Don't Loop`, which ends with "then move to implementing the fix" (`:754`). I
   confirmed both are there in the rendered output. The meta path applies the same post-pass to the
   LLM's prompt (`applyGroundingToRecommendation`). In the two-layer design, the mechanical layer
   has to know which facts apply to which kind, rather than appending the same notes to every
   prompt.

3. **The retrospective is where the noted-and-left pile should come back, and neither template
   looks for it.** Review's ledger lets an item be discharged by a *named monitor* ("discharges
   through normal post-merge observation", meta `:308`), close-out may *drop* an inside item and
   record it in the summary, outside items get filed, and more than half of those are never worked.
   Nothing ever reads any of these again. The audit's "Ownership Orphans" section is one narrow
   case of this (a hazard each ticket defers to the other). The ideal briefs below make looking at
   these loose ends a main part of the work: did the monitor fire, did the filed follow-up move,
   does the dropped item still matter. They also say what to do with one that still matters.

Also worth knowing: `retro` has **never been dispatched** and `retrospective-audit` only twice in
the measured window (`prompt-kinds.md:72-74`), apart from the 50-ticket sweep, which used `review`
with a kind override. `retro` is kept out of AI recommendation on purpose
(`prompt-templates.js:431-440`), so it only reaches an agent through the handwritten path (UI copy
or a `kind` override). It has no meta-prompt quality rule.

---

## retro

### 1. What it's for

"Look back at this piece of work honestly. Did it solve the problem it was for, what happened
because of it, and what's still loose? Tell me what we should do about it." It also works
mid-flight: "this feels like it's going wrong. Step back and tell me where we are."

### 2. The ideal version

> **Look back at {identifier}: {title}**
>
> {task facts: project; parent and siblings with states; subtasks with states; current state;
> created {createdAt}; completed {completedAt or "still in flight"}}
>
> I'd like an honest look back at {identifier}. Start with its description and comment thread,
> which are the source of truth. Then rebuild what actually happened from the record: the
> ticket's history, its subtasks and relations, and its commits (`git log --grep={identifier}`,
> and the files it touched since {createdAt}).
>
> The question that matters most is whether the work solved the problem it was for. If it has
> shipped, look at what came after {completedAt}: later commits that fix, revert or work around
> it, follow-up tickets, reopened work, bugs that trace back here. If the problem is still
> happening, find out why. The real cause is often somewhere the ticket never pointed. If the
> work is still in flight, the same look shows where it's drifting and what will probably need
> redoing.
>
> Then gather the loose ends. Each stage along the way noticed things it didn't act on: findings
> left as notes, items close-out dropped, follow-ups filed and never picked up, monitors review
> said would catch a problem after merge, hazards handed to another ticket. Check each one against
> the code and the other ticket as they are now. Some will have resolved and some won't matter
> any more. The ones that still matter are the most useful thing a retro can bring back. For
> each, say what it is, why it still matters, and what fixing it at the cause would involve.
>
> Keep a lesson only if it changes something. A lesson about the code is best turned into a fix
> or a test. A lesson about how the work went deserves a sentence on what to do differently next
> time. Drop lessons that only restate what happened. This isn't about blame. If the original
> approach was wrong, say so plainly.
>
> Match the depth to the work. A small change gets a short retro. For an epic, look across all
> its children (what shipped, what slipped, where the churn was) instead of writing a retro for
> each child.
>
> {delivery}

`{delivery}` is set by code from how the retro was started:
- *Run by a person (the normal case):* "Tell me what you found, starting with anything still
  broken or still loose. Don't write it back to the ticket; I'll decide what to keep. If a fix is
  clear and you'd make it yourself, offer to."
- *Dispatched with no one waiting:* "Post what you found as one comment on {identifier}. For each
  loose end that still matters, file one ticket that states the problem and its cause clearly
  enough for someone without this context, after checking it isn't already filed, and link it to
  {identifier}. Anything that would change product behaviour, a published contract, stored data
  or another repo's interface goes to John instead."

### 3. What machines rely on

The agent's **output** is not parsed by anything: it goes to the user, and no code reads a retro
comment. Everything machine-facing is in the assembled prompt or the routing metadata.

| String | Producer | Where it's read |
|---|---|---|
| Template key `'retro'` | `prompt-template-defs.js:1293` | `workflow-config.js:39` (`RETRO: 'retro'`); `prompt-templates.js:440` (`EXCLUDED_FROM_AI_RECOMMENDATION = new Set(['retro'])`); `wall-clock-summary.js:47` (`retro: 'after'`); `completion-signals.js:214`; listed as an override `kind` in `proxy-instructions.js:826`; download filename via `buildPromptFilename(identifier, 'retro')` → `lin-316-retro.md` |
| `## Workflow` heading and numbered steps `1. **Fetch details**: Get full issue details for ${identifier} in Linear` / `2. **Analyze**: Complete the goal below` / `3. **Summarize**: Present your findings to the user` | `formatInformOnlyWorkflow` (`prompt-formatters.js:390-399`) | `gateWorkflowWrites` (`prompt-formatters.js:993-1022`) matches `/^##\s+Workflow\b/`, `/^\d+\.\s+(.*)$/`, and drops a step matching `/\*\*(Start|Commit|Complete|Update[^*]*)\*\*/` or `/\bSet\b[^\n]*status to/i` for read-only providers. `**Summarize**` survives, which is why retro is safe on read-only trackers. |
| `**Subtasks:**` on its own line followed by `- ID: "title" (State)` lines | `formatMultiLineSection('Subtasks', formatChildren(...))` | `stripSubtaskSections` (`prompt-formatters.js:1077`): `/^\*\*(Existing Subtasks|Subtasks):\*\*$/` removes the block for providers without subtasks |
| The literal `Linear` and the suffix ` in Linear` | workflow steps, `formatDiscussionReference`, goal prose | `applyPromptCapabilities` (`prompt-formatters.js:1108-1113`): `out.replace(/\bLinear\b/g, caps.displayName)` and strips `' in ' + displayName`. Any brief prose has to use the literal `Linear` (or a `{tracker}` slot filled before this pass) for the rename to work. |
| Absence of `status to "` | none | `shapeWorkflowStateWording` (`:1046`) only touches `status to "…"`. Tests assert retro never contains `status to "In Progress"` (`tests/unit/prompt-templates.test.js:1401`). |
| Header `# Retro ${identifier}: ${title}` | `formatHeader('Retro', issue)` | Not parsed by runtime code (the filename uses the template name). |

Tests that pin today's prose and will need to follow the rewrite (`tests/unit/prompt-templates.test.js:1399-1435`):
`'Present your findings to the user'`, absence of `'Add findings as a comment'`,
`'Do not write them back to Linear'`, `'in-flight'`/`'in-progress'`, `'risk'`,
`'git log --grep=TEST-R1'`, `'Downstream'`, `'## Goal'`, `'hindsight'`, `'Lessons'`; and the
absence of `'reorient'`/`**retro**` in the meta-prompt hints. Size ceiling
`retro: 4114` bytes (`tests/unit/prompt-size-budget.test.js:80`).

The **dispatch preamble** (heartbeats, `DECISION:` blocks parsed by `parseDecision` in
`lib/session-telemetry.js:674`) is added by the dispatch layer to every dispatched prompt. It is
not part of this template, but it is how "goes to John" actually reaches him in a headless run.

### 4. Rules that tie scope to the ticket

- `prompt-template-defs.js:1320`: "Your role is to give an honest account and surface useful
  lessons, not to assign blame or re-litigate decisions." Not blaming is right. "Not re-litigate
  decisions" stops the retro from saying the approach was wrong, and that is often the lesson.
- `:1349`: "These are findings for the user to act on — share them directly. Do not write them
  back to Linear or save them anywhere unless asked; the user decides what happens next." This is
  fine when a person ran it. Under a `kind` override with no one watching, the findings go
  nowhere. That is the same "noted and left" ending, only through a different channel.
- `:1328` and `:1333`: downstream effects are searched only in "<files the task touched>" /
  "<files this task changed>". A cause that sits outside those files cannot show up as a
  downstream effect, which is exactly the two-path incident pattern in
  `like-a-skilled-developer.md` §1.
- `formatInformOnlyWorkflow` (`prompt-formatters.js:398`): "3. **Summarize**: Present your
  findings to the user". Reporting is the only possible ending. Nothing lets the retro act on, or
  even file, a loose end.
- Appended by code: `prompt-formatters.js:682` ("capture anything genuinely missing as a
  follow-up, and close out") and `:754` ("then move to implementing the fix"). These point the
  opposite way: they turn a look-back into a close-out or an implementation.

### 5. How today's version differs

**Rule-shaped, should become guidance**
- The five-bullet output schema ("What happened / What went well / What was missed / Downstream
  impact / Lessons & suggestions", `:1342-1347`). No machine reads it, and it pushes the retro to
  fill every slot. A retro on a clean change should be short, and one that finds a live loose end
  should lead with that. The ideal names what matters most and lets the shape follow.
- The `### Scale to the task` subsection (`:1338-1340`) is good content set out as a section.
  One sentence does the job.
- The "**Role**: Act as a retrospective analyst..." line (`:1320`) is a formula. The opening of
  the ideal sets the stance by saying what's wanted.
- "Build the timeline from evidence, not memory" (`:1326`). The agent has no memory to rely on.
  "From the record" says what is meant.

**Scar tissue or restated elsewhere, could go**
- "Use the task's actual dates from Linear" and the `<createdAt>`/`<completedAt>` placeholders
  the agent has to fill in itself (`:1328`, `:1333`). Code already has `issue.createdAt` (the
  staleness post-pass injects it), and the provider carries the completion date. The mechanical
  layer should put the real dates in.
- The appended `## Re-ground the Ticket (staleness check)` mostly repeats what a retro does
  anyway (compare the ticket against the code since it was written).
- The appended terminal-state and bug-investigated notes contradict the brief (see above). The
  mechanical layer should leave them off for look-back kinds.

**Gets right, and the ideal keeps**
- It works on in-flight work as well as finished work, with risks in place of downstream effects.
  This is a real use ("reorient, or when something feels off").
- It treats later commits to the same code that fix, revert or hotfix it as the signal of whether
  the work held. This is the most concrete piece of hindsight method in the template.
- Epics get one aggregated look rather than a retro per subtask. That works against slices, which
  is what the redesign wants.
- No blame.
- Keeping it out of auto-recommendation (`prompt-templates.js:431-440`) is right: a retro is
  worth running when a person wants one.

**New in the ideal:** "did it solve the problem it was for" as the main question; the loose-ends
sweep (monitors, dropped items, filed-but-unworked follow-ups, handed-off hazards) as the way
noted findings come back; lessons that land as code or tests rather than prose (matching
CLAUDE.md's "a new lesson lands as code or a test first"); and a delivery line chosen by code so a
headless retro still lands somewhere.

---

## retrospective-audit

### 1. What it's for

"This merged and closed. Take a fresh look and tell me whether it actually does what it says,
and whether its tests would notice if it stopped. If something's wrong, make sure it gets dealt
with." It is the independent check after merge, the one that found three shipped no-ops among 50
green, reviewed tickets.

### 2. The ideal version

> **Audit {identifier}: {title} (already landed)**
>
> {task facts: project; parent and siblings with states; labels; landed {completedAt}}
>
> {identifier} has merged and closed. I'd like a fresh pair of eyes on whether it actually does
> what it says. Read the ticket and its comment thread, then find what landed
> (`git log --grep={identifier}`, and the PR).
>
> CI was green, so don't spend time re-running the suite to confirm it. Spend it on what CI
> can't see. Gather what the work claims (in the ticket, the close-out summary, the PR and the
> code comments) and check each claim against the code at HEAD, not against the author's
> account. The most important claim is the one the ticket existed for: does the change actually
> change the outcome? The defects past audits found most often were fixes that changed nothing,
> guards the comments described but the code didn't have, and premises that turned out to be
> false. Every one of them passed its tests. If the premise itself was wrong, say so. That is a
> finding.
>
> For each test that guards one of those claims, find out whether it would notice if the
> behaviour broke. The reliable way is to try it: break or remove the code path the test claims
> to cover, run the test, watch it go red, then put the code back. A test that stays green is a
> finding, and so is a fixture that writes somewhere the code never reads or an assertion that
> can't fail. Where the honest check is to run the thing or measure the result directly, do
> that.
>
> Also check what the work handed off. If the ticket or its review passed a hazard to another
> ticket, or named a monitor that would catch a problem after merge, look at the other side.
> Does that ticket actually own the hazard? Has the monitor fired? A hazard that each side
> thinks the other has can't be seen from inside either ticket.
>
> When you find something, make sure it gets dealt with. If the fix is clear and at the cause,
> make it on its own branch and PR so it's reviewed like any other change. Otherwise file one
> ticket that states the problem and its cause clearly enough for someone without this context,
> after checking it isn't already filed, and link it to {identifier}. Bring to John only what
> he'd need to tell the team about first: a change to product behaviour, a published contract,
> stored data or another repo's interface. Leave {identifier}'s own status alone, since it's
> history; the new work carries the link.
>
> Post your findings as one comment on {identifier}: what you checked, how you checked it, what
> you found, and where each finding went. If everything holds, say so plainly. A clean audit is
> a common and useful result.

(On a read-only tracker the last paragraph becomes "Report your findings", and the filing
sentence becomes "say what should be filed". Code should make that substitution, as the workflow
gate does today.)

### 3. What machines rely on

As with retro, **nothing parses the audit's output**. The findings comment has no required
heading, and no code reads it. (One consequence: the recommender's Step 0 sends any
"reviewed, merged and Done" task to `retrospective-audit` (meta `:145`), and it has no
deterministic way to tell that an audit has already run. If audits become routine, a stable
heading on the findings comment, e.g. `### Retrospective Audit`, plus a Step 0 check for it would
be worth adding. Today there isn't one.)

| String | Producer | Where it's read |
|---|---|---|
| Template key `'retrospective-audit'` | `prompt-template-defs.js:1240` | `workflow-config.js:38` (`RETROSPECTIVE_AUDIT: 'retrospective-audit'`); `wall-clock-summary.js:47` (`'retrospective-audit': 'after'`); `completion-signals.js:203`; `deriveDispatchKind` (`prompt-templates.js:228`) must map it to a non-`custom` kind (test `:2454`) |
| Emitted action `→ **retrospective-audit**` (meta path) | the LLM, constrained by `actionVocabulary` | `parseRecommendedAction` (`openrouter.js:1677`): `/→\s*\*\*(.+?)\*\*/` → `deriveDispatchKind`. This is why the name must be emitted exactly. |
| Step 0 heading `### Step 0: The substantive work here is already complete — recommend \`review\`, \`close-out\`, or \`retrospective-audit\`` and the third bullet `already merged and Done (close-out has already run) → recommend \`retrospective-audit\`` | meta `:140`, `:145` | Pinned by tests `prompt-templates.test.js:2427-2430`. This is routing text for the recommender, not part of the brief. |
| aiHint `situation` / `goal` / `workflow` / `whenNot` / `chooseOver` | `:1245-1251` | `formatAIHintsForMetaPrompt` renders them into the meta-prompt's Action Types Reference. Tests count exactly 4 `When NOT:` and 4 `Choose over:` (`:2499-2500`). This is routing data and belongs in the mechanical layer. |
| `## Workflow` with `1. **Fetch details**: Get full issue details for ${identifier} in Linear` / `2. **Analyze**: Complete the goal below` / `3. **Update Linear**: Add findings as a comment on ${identifier}` | `formatReadOnlyWorkflow` (`prompt-formatters.js:371-380`) | `gateWorkflowWrites` (regexes above): `**Update Linear**` matches `Update[^*]*`, so on a read-only tracker step 3 is **dropped**. Test pins `/Add findings as a comment/i` (`:2559`). |
| The literal `Linear` / ` in Linear` | as above | `applyPromptCapabilities` rename and strip |
| Absence of `status to "` | none | Test `:2539` (`!/status to "In Progress"/i`) |
| Header `# Retrospective audit ${identifier}: ${title}` | `formatHeader` | Not parsed at runtime |

Tests pinning today's prose (`tests/unit/prompt-templates.test.js:2435-2560`):
`/already merged/i`, `/re-verify overall correctness/i`, `/Audit the Claims/i`,
`/Audit Test Integrity/i`, `/Ownership Orphans/i`, `/do not change status, labels/i`,
`/do not merge or mark anything Done/i`, `/do not file follow-up tickets/i`,
`/Add findings as a comment/i`; meta: exactly one `**Retrospective-audit prompts** must`, and
`/audit the claims/i`, `/audit test integrity/i`, `/ownership orphans/i` in it. Several of these
pin exactly the rules the ideal changes (filing), so they will have to move with the new prose.
Size ceiling `'retrospective-audit': 4161` (`prompt-size-budget.test.js:79`).

### 4. Rules that tie scope to the ticket

- `prompt-template-defs.js:1286`: "do not file follow-up tickets — if a finding warrants one,
  name it in your findings comment and leave the decision to the reader." This is the main one.
  On landed work there is no next stage and usually no reader, so the finding stays a note. It
  contradicts the lesson the template was built from (`lane-run-review-2026-08-23.md:595-598`).
  Mirrored in meta `:311` ("forbid filing follow-up tickets (a finding that warrants one is named
  in the comment, left for the reader to act on)"), meta `:145` ("does not change state or file
  follow-ups") and `completion-signals.js:210` ("no follow-up ticket filed").
- `:1268`: "You do not re-litigate whether the change should have been made ... and you have no
  authority to change state." Also `:1247` ("never re-litigate the decision") and meta `:145`
  ("does not re-litigate the decision"). One of the sweep's eight real findings (LIN-2124) was
  that "the specified clause rests on a premise that is provably false". Under this rule that is
  a decision the audit may not question.
- `:1268`, `:1286`: "you have no authority to change state" and "Do not change status, labels,
  or any other task state". Leaving the audited ticket's own status alone is reasonable. As
  written, though, it reads as no authority to act at all, and together with the filing ban the
  audit can only observe.
- `:1270`: "Everything below audits what actually shipped there, not what was proposed or
  planned." Meant to keep the audit on landed code, but it leaves out the plan's promises as a
  source of claims (a planned behaviour that never shipped is a finding).
- `:1278`: "where feasible, reason about whether a real regression ... would actually make the
  test fail". This is softer than the lesson ("mandate execution-based checks ... rather than
  hope for them"), and it lets the check stay inside the agent's head.
- Appended by code: `prompt-formatters.js:682` ("capture anything genuinely missing as a
  follow-up, and close out") contradicts `:1286` in the same prompt, and `:754` ("then move to
  implementing the fix") appears on any bug-labelled ticket.

### 5. How today's version differs

**Rule-shaped, should become guidance**
- Three numbered `###` sub-sections plus a `### Reporting` section of prohibitions. The audit is
  one question ("does it do what it says, and would its tests notice if it didn't?"), with the
  hand-off check after it. The ideal tells it as one line of reasoning.
- The list of test smells (`:1278`) is good knowledge in a checklist. The ideal keeps the smells
  as examples of what to look for and makes the method (break it, watch it go red) the
  instruction.
- The negative list in `### Reporting` ("Do not change status, labels ... do not merge or mark
  anything Done ... do not file") becomes one positive line about what happens to findings and
  one about leaving the ticket's status alone.

**Scar tissue or restated elsewhere, could go**
- "**Start from the fact that this is already merged.** ... this is not a review of pending work,
  and there is no merge to authorize" (`:1270`) and "do not merge or mark anything Done — that
  already happened, and re-confirming it is not this audit's job" (`:1286`). Both are scars from
  the sweep borrowing `review`. With its own verb, one clause ("has merged and closed") is
  enough.
- The class comment above the template (`:1232-1239`), the aiHint `whenNot`/`chooseOver`, and
  meta `:145` and `:311` each restate the same boundaries (not review, not retro, not
  correctness, not state). The routing copy belongs in the mechanical layer for the recommender.
  The agent needs none of it.
- Meta `:311` (about 1.8 KB) is a near-verbatim second copy of the template body for the writing
  model. Under the two-layer design, the writing layer works from the brief plus facts, and this
  rule goes.
- The appended staleness, terminal-state and bug notes. Of these, the staleness check is
  harmless (the audit compares against HEAD anyway), and the other two do harm.

**Gets right, and the ideal keeps**
- Check claims against the code at HEAD, "not against the author's account of it". This is the
  core of the audit.
- Don't re-run the suite to re-prove green CI; spend the effort on what CI can't see. This came
  from real money spent in the sweep.
- Tests are judged by whether they would fail, not by whether they exist or pass, with the
  concrete smells (fixture that dodges the real path, spy never asserted, vacuous assertion).
- The ownership-orphan idea: read the other ticket's current state directly, because the gap
  can't be seen from either side. The ideal widens it to every hand-off, including named
  monitors.
- "A finding-free audit is a valid, common result — state that plainly rather than manufacturing
  doubt." Keep this: it stops a fresh-eyes stage from inventing work.
- Locate the landed change first (`git log --grep`).
- Leave the audited ticket's own status alone (kept in the ideal, but as housekeeping rather
  than a limit on authority).

**A tension to flag for John.** The ideal lets the audit fix a clear defect in its own PR. That
gives up some of the auditor's independence: the auditor now writes code that someone else has
to check. Routing that PR through the normal review keeps a second pair of eyes on it. The
smaller alternative, which only reverses the filing ban, matches the sweep's evidence directly
(wave 2 filed, and its findings got worked). Either way, "leave the decision to the reader" should
go.

---

## Shared notes for the mechanical layer

- **Kind-aware grounding.** `appendGroundingSections` should not append the terminal-state or
  bug-investigated notes to look-back kinds (`retro`, `retrospective-audit`). As things stand they
  tell the agent to close out, file follow-ups, or implement a fix, which reverses the brief.
  Today this happens on both paths.
- **Real dates.** Supply `createdAt` and `completedAt` as facts so the agent never has to fill in
  `<createdAt>`.
- **Loose-ends facts.** The loose-ends sweep in both briefs would be cheaper and more reliable if
  code gathered the candidates up front: the latest review ledger's items and how each was
  discharged (named monitor, drop, filed outside item), follow-ups filed from this ticket with
  their current state (relations), and rulings on this anchor
  (`GET /api/proxy/rulings?issueIdentifier=<id>&includeResolved=true`). The brief then says what
  to do with them, and the facts block lists them.
- **Delivery line.** For `retro`, code chooses between "tell me" and "post and file" based on
  whether a person started it or it was dispatched headless.
- **Option, not a recommendation.** The two templates now share most of their method (did it
  solve the problem; did the hand-offs land). They could become one look-back brief with two
  emphases. They should stay separate kinds because routing, buckets, telemetry and the
  recommendation exclusion all key on the two names, but writing them as siblings would keep them
  from drifting apart.
