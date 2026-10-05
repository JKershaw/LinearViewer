# Research, scoping, spike: from rules to briefs

Read at the working tree of `/home/user/LinearViewer` on 2026-10-03. Line numbers are
`lib/prompt-template-defs.js` unless another file is named. No code was changed.

## Findings that apply to all three

1. **No production code parses anything these three stages write.** I grepped `lib/`,
   `routes/`, `server.js` and `public/` for every verdict word and heading they emit
   (`Surface Assessment`, `refactor required`, `lands cleanly`, `improvement noticed`,
   `Audit the Layers`, `Name the Classes`, `In Scope`, `Out of Scope`, `Success Criteria`,
   `Open Questions`, `go/no-go`, `Define scope for`). The only hits outside the templates
   are other *prompts* that an LLM reads (plan, review, close-out), measurement scripts,
   one eval harness, and unit tests that pin wording. What code really depends on is the
   **generic scaffold**: the `## Workflow` block, the literal `Linear`, the
   `status to "In Progress"` phrase and the `**Existing Subtasks:**` block. The capability
   post-pass (`lib/prompt-formatters.js:1102 applyPromptCapabilities`) rewrites these for
   non-Linear providers. That scaffold is exactly what the mechanical layer should own.
2. **The research output contract is between LLM stages, not between code paths.** The plan
   brief (`:227`, `:289`), review (`:1046`) and close-out (`:1221-1222`) refer to research's
   Surface Assessment, its class list and the scoping description by name. If the research
   and scoping briefs change, those parts of the downstream briefs have to change with them,
   in the same rewrite.
3. **On the meta path, scoping and spike have no quality rule at all.** The meta-prompt
   (`lib/prompts/meta-prompt-template.js:298-311`) has a Research-prompts rule (`:302`, about
   5 KB in one bullet) but nothing for scoping or spike. On that path the model writes those
   briefs from the `aiHint` (`:644-650`, `:751-757`) and the one-line completion signal alone.
   So the AI path already writes a plainer version of those two, for better or worse.
4. **The meta-prompt ties every generated brief to the ticket's own framing.**
   `meta-prompt-template.js:117`: "Research, design, and verification are the consumer's
   responsibility — your job is to route to the right action and **faithfully restate the
   ticket**." The Grounding Rule at `:115` ("must only contain information explicitly present
   in the Task Context") was written to stop invented facts, and it should stay. But
   "faithfully restate the ticket" also hands the ticket's framing of the problem straight to
   the stage. In the new writing layer it should read: *carry the ticket's facts, frame the
   brief around the problem.*

---

## 1. Research

### What it's for

We don't yet know enough to do this well. Go and find out how this part of the system really
works, what has been tried before, and what the right fix is, then come back with a
recommendation the next person can build on without redoing the work.

### The ideal version

> # Research {id}: {title}
>
> {task facts: project, parent, related tasks, labels, and the prior research on the task if any}
>
> We don't know enough yet to do this well. Your job is to find out how this part of the
> system actually works today, what has been tried before, and what approach would fix the
> problem properly. Then write it up so whoever plans or builds next can rely on it without
> repeating your reading. {If there is prior research: build on what is already there; don't
> start over.}
>
> Start from the problem, not the ticket's wording. A ticket names a symptom or a symbol. What
> matters is the behaviour behind it, and that behaviour usually lives in more than one place:
> a parallel path, a server copy and a client copy, a sibling provider, or a contract someone
> else reads. Search for the concept, not just the name, and keep going until you can say why
> you think you've found all of it: what you searched for, and what came back empty. When the
> change touches a whole family of things (every caller, every lane, every shape), name the
> family and say how you know where it ends. If the code can't tell you where it ends, say so
> plainly; that happens when the members don't exist yet or are production data. Don't invent
> a boundary.
>
> Read before you believe. Point every claim about the code at the file, line, doc or commit
> you read it in. Check the history as well: the git log for the area, and earlier tickets
> and investigations of the same subsystem. The last attempt often shows what this one will
> run into. If an approach is unproven, try it in a small experiment before you recommend it.
> If the work will be judged by a test or a metric, check that the signal really tracks the
> outcome.
>
> Aim the recommendation at the cause. If the honest fix is structural, recommend the refactor
> as part of the approach. Two signs that it is: the current shape forces workarounds, or the
> obvious approach would add a second copy of something the system already models. Say what
> the refactor makes simpler, and what it costs any other code that uses the same piece.
> Don't propose seams that nothing will call. Engineering choices are yours to make. Bring a
> question to John only when it's a change he'd want to tell the team about before it
> happened, such as a change to product behaviour, a published contract, stored data or
> another repo's interface. Even then, say what you would do and why.
>
> Match the depth to the problem. A one-file change needs a few lines: the file, the fix and
> why. But a short ticket isn't always a small change. Renames and "everywhere" changes fan
> out across the codebase.
>
> When you finish, put your working in a comment: what you read, what you tried, and the
> evidence. Then update the description with what the next stage needs: the findings, the
> families of things the change touches and their members, and the approach you recommend,
> including any structural change it depends on.

(About 520 words. Today's rendered research body is 1,719 words, or 10.3 KB, before the
shared post-pass, measured with an empty context.)

### What machines rely on

**Runtime, read by code. The mechanical layer must emit these:**

| String | Where it is read |
|---|---|
| `# Research {identifier}: {title}` (from `formatHeader('Research', issue)`, `:518`; `prompt-formatters.js:308-310`) | Nothing found parses it. It's a convention; keep it for humans and for `scripts/steady-base-tracker.mjs`'s fixed-line path classifier, which compares rendered template lines with dispatched prompts. |
| `## Workflow` followed by numbered steps whose bold labels are `**Start**`, `**Fetch details**`, `**Analyze**`, `**Update Linear**` (`:520-525`, hand-rolled) | `prompt-formatters.js` `gateWorkflowWrites`: `/^##\s+Workflow\b/`, steps `/^\d+\.\s+(.*)$/`, and write steps dropped when the provider is read-only via `/\*\*(Start\|Commit\|Complete\|Update[^*]*)\*\*/` or `/\bSet\b[^\n]*status to/i`. |
| `status to "In Progress"` | `shapeWorkflowStateWording`: `/status to "([^"]+)"/g` with the map `{ 'In Progress': 'started', 'Done': 'completed' }`. |
| The literal word `Linear`, and the suffix ` in Linear` | `applyPromptCapabilities`: `/\bLinear\b/g` becomes the provider's `displayName`, and `' in ' + displayName` is stripped when `includeTracker` is false. |
| Template `name: 'research'` (`:507`) | `deriveDispatchKind` (`lib/prompt-templates.js:228`) gives the dispatch `kind`. The recommender's `→ **research**` is parsed by `parseRecommendedAction` `/→\s*\*\*(.+?)\*\*/` (`lib/openrouter.js:1675`). Both are metadata, not brief text. |
| Shared post-pass, already appended by code: `## Re-ground the Ticket (staleness check)`, the terminal-state, children-complete and bug-investigated notes (`appendGroundingSections`, `prompt-formatters.js:787`), and `## Attachments` (`formatAttachmentsSection`, `:859`) | Already mechanical, so no change is needed. |

**Read by a later stage's LLM, by instruments or by tests. Not parsed at runtime, but they break if the wording changes:**

- **The Surface Assessment verdict line.** Today's exact format (`:620`):
  `Surface Assessment: [lands cleanly]` /
  `Surface Assessment: [refactor required: <minimal scoped change> — consumer: <where this task calls it>]` /
  `Surface Assessment: [improvement noticed, not required: <land it inline/scoped, or note it — no separate subtask>]`.
  It is read by the plan brief at `:227`: "If a Surface Assessment in prior research comments
  declares `refactor required` and names the line in this task that consumes it, encode it as
  a separate blocking subtask". It is counted by `scripts/steady-base-tracker.mjs:67`
  (`'Surface Assessment': /Surface Assessment/i`) and by the comment classifier quoted in
  `docs/papers/harbour/plain-language.md` (`/Surface Assessment|Audit the Layers|Name the Classes|exploration notes/i`
  → research; OUTCOME `Surface Assessment:`).
  **Recommendation:** if the instruments should keep working, have code append one plain
  line: *"End your write-up with one line starting `Surface Assessment:` that says whether the
  approach needs structural change, and what."* Drop the three bracketed verdicts. The plan
  brief should then read the recommendation itself rather than key on `refactor required`.
- **The class list, in the description.** Plan reads it at `:289` ("work from research's
  classes"). Review reads it at `:1046` ("the classes research or the plan named for this
  ticket and recorded in its issue description (LIN-1871)"). No code reads it. The ideal
  brief keeps it as "the families of things the change touches and their members", in the
  description.
- **Eval harness** `scripts/eval-horizontal-obligations.mjs:182-183` cuts on the exact
  headings and throws when they're absent:
  `HO_BLOCK_RE = /\n### Audit the Layers[\s\S]*?(?=\n### Surface Assessment)/` and
  `DUP_REP_RE = /\nOne shape always counts as demanding a structural change:[^\n]*\n/`.
  This harness becomes obsolete with the rewrite; retire it or re-base it.
- **Unit tests that pin wording.** These need rewriting, not preserving:
  `tests/unit/prompt-templates.test.js` `describe` blocks at `:1083` (LIN-1871 research),
  `:1976` (Surface Assessment), `:2050` (Audit the Layers), `:2174` (Scale to the task) and
  `:4603` (attachment perception). Between them they pin about 35 exact phrases, for example
  `/### Name the Classes/`, `'Consumer test'`, `'Who-pays test'`,
  `'improvement noticed, not required'`, `'Size is not a rejection criterion'`,
  `/\*\*Comment\*\*:[^\n]*Surface Assessment/`, `'SECOND REPRESENTATION'`,
  `/measured by \*coverage\*, not speed/`, `'show the search that would have surfaced'`, and
  heading-order checks between `### Audit the Layers` < `### Name the Classes` <
  `### Surface Assessment`. On the meta path: `tests/unit/openrouter.test.js:1778`
  (`'Research prompts must also require naming the classes the task touches'`), `:2063-2090`
  (Surface Assessment), and the meta-prompt byte-identity baseline in
  `tests/unit/rulings-resolution-contract-drift.test.js`.

### Rules that tie scope to the ticket

- `:537`: "Your role is to gather information and provide recommendations, **not to make final
  decisions on direction**." This withholds the engineering authority that Principle 0
  (`docs/autopilot-operating-manual.md:442-449`) grants at the top.
- `:605`: "The question is not 'would a refactor make this land better?' — on most code
  something could be cleaner — but '**is the feature's shape demanding a structural
  change?**'" This measures refactoring against the feature (the ticket), not against the
  cause or against simplicity.
- `:615`: "**Consumer test:** cite the line in **THIS task's** implementation that calls the
  new seam. If you cannot, the refactor is speculation — **it belongs with its future
  consumer, not ahead of it.**" This is the strongest tie, and the essay quotes it
  (`like-a-skilled-developer.md` §3). A fix at the cause usually has no "line in THIS task"
  to cite, so it comes out as speculation.
- `:616`: "An unjustified bystander tax means the refactor is mis-scoped — **scope it down**."
- `:622`: "An improvement that fails either evidence test still gets named, under the third
  verdict, and is landed inline **or recorded — never spun into blocking work**." In
  practice "recorded" is the note-and-leave path (46% of off-frame findings, per the essay).
- `:596`: "The plan step works from this list: it maps every member you found to **in- or
  out-of-scope**". This is neutral on its own, but it sets up the in/out-of-ticket split that
  review then uses at `:1046` for inside/outside.
- Meta-prompt `:302` restates all of the above for the AI path. It says "refactor required …
  consumer test (cite the line in THIS task's implementation that calls the new seam — no
  citation means speculation, which belongs with its future consumer, not ahead of it)", plus
  who-pays "scope it down".
- Meta-prompt `:117`: "your job is to route to the right action and faithfully restate the
  ticket" (see the general findings above).

### How today's version differs

**Rule-shaped text that should become guidance.**
- The three `###` sections (Audit the Layers `:569-585`, Name the Classes `:590-596`, Surface
  Assessment `:603-622`) are numbered procedures with verdict formats and two "tests" that
  have to be "answered by citing lines". Each carries a good lesson that fits in one or two
  sentences: look for the concept and not the symbol, and show why the set is complete;
  think in families and say how you bounded them; recommend structural change when the shape
  forces it, but not seams nothing calls.
- The list of "seed axes" (`:578-581`) followed by "These four axes are seed examples, not the
  whole set" (`:583`) is a rule that then argues against itself. The lesson (what the change
  must stay consistent with) fits in one clause.
- The Output section (`:630-632`) is a checklist of artifacts ("per-layer audit (one brief
  per layer, with sources cited), the class list …, the exploration process, and the Surface
  Assessment"). That's what makes research comments 3,178 words at the median
  (`plain-language.md:77`).

**Scar tissue, or text restated elsewhere, that could go.**
- The ticket provenance in comments (LIN-740, LIN-697, LIN-1871, LIN-397, LIN-872) doesn't
  reach the agent, but it is the reason each section exists as a separate block. The lessons
  survive without the blocks.
- The two named unboundable shapes ("a destination that does not exist yet in the current
  source tree, or a population that is production data rather than source", `:594`) are a
  scar from LIN-1717 and LIN-1731. Keep one sentence; drop the taxonomy.
- "Size is not a rejection criterion … Effort is cheap" (`:618`) exists only to counter the
  consumer test. Without the consumer test it isn't needed.
- `formatScaleToTask()` (`prompt-formatters.js:898`) and the gate on small changes inside
  Audit the Layers (`:571`) say the same thing twice. Once is enough.
- `formatAttachmentPerceptionCheck` (`prompt-formatters.js:639`) is a numbered three-step
  rule. The mechanical layer already lists the attachments. The writing layer needs one
  sentence: *look at every attachment, images included; if one can't be read, stop and say
  which one.*
- "search wider than nearby code … seed from both the technical lead and the meta-pattern,
  'this class of problem, last time the decisive experiment was X'" (`:550`) is copied from
  the bug template and reads awkwardly. "Check how this was tried before, including earlier
  investigations of the same subsystem" carries it.
- The whole Research-prompts rule at meta `:302` restates the template in one 5 KB bullet.
  Under the two-layer design both paths feed the same writing layer, so the both-paths
  mirror disappears.

**Inconsistency to fix.** `:596` says to record the class list "in the description", while
the Output at `:631` puts it in the **comment**. Plan and review look in the description.
The ideal brief puts it in the description.

**What today gets right, and the ideal keeps.**
- Search for the concept, not the cited symbol. A clean grep for the symbol doesn't prove
  you've found everything (`:575`).
- Cite a source for every claim, and back the claim of completeness with the search that
  came back empty (`:577`, `:585`).
- A second representation of something already modelled is a structural problem, not a
  clean landing (`:612`). This is a real lesson about the cause.
- No speculative seams (the honest core of the consumer test), and say who a refactor costs
  (the honest core of who-pays). Both are now framed as engineering judgement rather than as
  gates.
- Validate the measurement, and prove feasibility before recommending (`:551-552`).
- Scale down for small work, but don't mistake a short ticket for a small change
  (`formatScaleToTask`).
- An unboundable class is a legitimate answer; don't manufacture a bound (`:594`).
- "Read before acting: this prompt is not a copy of the task"
  (`formatDiscussionReference`, `prompt-formatters.js:172`). This stays as a mechanical line.

---

## 2. Scoping

### What it's for

The ticket isn't clear about what we're actually trying to achieve. Pin down the outcome and
what "done" looks like, so the planning and building that follow aim at the right thing.

### The ideal version

> # Define scope for {id}: {title}
>
> {task facts: project, parent, related work, existing subtasks, labels}
>
> This ticket isn't clear enough about what we're trying to achieve. Before anyone plans or
> builds, work out what outcome it is really after and what "done" looks like. Write that in
> the description so it becomes the reference for everything that follows.
>
> Read the ticket and its history, and look at the code and the product enough to understand
> the problem it points at. Scope written without looking tends to fence off the cause.
> Describe the outcome in terms someone could check: what will observably be true when this
> is finished. Then say what the work covers. Scope follows the problem, not the ticket's
> first wording, so if the real cause sits somewhere the ticket didn't mention, it's in.
> Leave something out only when it's genuinely a different problem, and say why, so nobody
> later reads "out of scope" as permission to leave the cause in place.
>
> Note any assumption that would change the shape of the work if it turned out wrong. Answer
> the open questions you can answer by looking; most questions about the code and the
> engineering are yours to settle. Bring to John only the questions that turn on what he
> wants from the product, or a change he'd want to tell the team about first: product
> behaviour, a published contract, stored data, or another repo's interface. Ask each one
> specifically, with the answer you'd recommend.
>
> Keep it as short as the problem allows. Update the description, not a comment, because
> the description is where the next stages look for scope.

(About 270 words, against 212 today. The extra is grounding and authority, which today's
version lacks entirely.)

### What machines rely on

**Runtime, read by code:**

| String | Where it is read |
|---|---|
| `# Define scope for {identifier}: {title}` (`:653`) | Convention only; no parser found. |
| `## Workflow` with `**Start**`, `**Fetch details**`, `**Analyze**`, `**Update Linear**` steps (`:655-660`) | `gateWorkflowWrites` (same regexes as for research). Step 4 is `**Update Linear**: Update issue description with finalized scope`, and it gets dropped for read-only providers. |
| `status to "In Progress"`, `Linear`, ` in Linear` | `shapeWorkflowStateWording` and `applyPromptCapabilities` (as for research). |
| `**Existing Subtasks:**` on its own line, followed by the `- ID: "title" (state)` block (`:667`, via `formatMultiLineSection`) | `stripSubtaskSections`: `/^\*\*(Existing Subtasks\|Subtasks):\*\*$/` removes the block for providers without subtasks. |
| `name: 'scoping'` (`:640`) | `deriveDispatchKind`; the meta action vocabulary (`getAIRecommendationActionNames`, `lib/prompt-templates.js:457`); `→ **scoping**` parsed by `parseRecommendedAction`. |
| Shared post-pass (staleness and others, plus attachments) | Already code-appended. |

**Read by LLMs or tests:**
- The headings `**In Scope**`, `**Out of Scope**`, `**Assumptions**`, `**Success Criteria**`,
  `**Open Questions**` (`:678-682`) aren't parsed anywhere. `COMPLETION_SIGNALS.scoping`
  (`lib/completion-signals.js`) names the same five as "signals", and the meta-prompt
  summarises only its `coreOutcome` and `readinessCheck` (`formatAllSignalsForMetaPrompt`).
  The signals list also renders on the prompts page (`lib/render-prompts.js:32-39`).
- Close-out depends on the wording at `:1222`: "Never prune: … scope (**the scoping
  template's own "single source of truth" instruction** stands — do not contradict it
  here)". If the scoping brief stops saying "single source of truth", that parenthetical
  needs to change with it.
- Triage at `:413` names scoping as the place where scope changes belong ("scope changes
  belong to the scoping, plan, and breakdown steps").
- Tests: only existence (`prompt-templates.test.js:46`, `:104`, `:376`) and the
  completion-signal key lists (`completion-signals.test.js:28`, `:46`). No wording pins.

### Rules that tie scope to the ticket

- `:673`: "You have authority to propose what's in and out of scope, but **open questions
  should be flagged for stakeholder resolution**." Every open question goes to John,
  including engineering questions the agent could settle. That inverts Principle 0.
- `:679`: "**Out of Scope**: What is explicitly excluded". The stage's main output is a list
  of exclusions measured against the ticket, with no test for whether an exclusion is a
  different problem or the cause of this one. Later stages inherit it as the boundary.
  Review's inside/outside at `:1046` and close-out's "materially larger than this ticket's
  own change" both lean on scope that was drawn here.
- `:675`: "Define clear boundaries (in scope vs out of scope)". This frames the job as fencing,
  not as describing the outcome.
- `aiHint.whenNot` (`:648`): "do not scope a task whose boundaries are already known." It's
  fine as routing, but it describes scoping purely as boundary-drawing.

### How today's version differs

**Rule-shaped text that should become guidance.** Today's version is five headed slots to
fill in. It reads as a form, and the agent fills it in without ever looking at the code or
the problem. Nothing tells it to ground the scope in the code or the history, so the scope
gets drawn from the ticket's wording, which is where the ticket-frame problem starts.

**Scar tissue.** There's very little; this template has barely been touched. The "Role" line
is the main thing to replace.

**What's missing that matters.**
- Grounding: look at the problem before drawing lines.
- Authority: settle engineering questions yourself, and send John only product or
  irreversible ones, each with a recommended answer.
- A test for exclusions: out only when it's a different problem, never when it's the cause.

**What today gets right, and the ideal keeps.**
- Success criteria. Saying what "done" looks like is the most valuable thing scoping
  produces, and the ideal makes it observable.
- Assumptions stated explicitly.
- "Update the description (not a comment) so scope is the single source of truth" (`:684`).
  This is right, and close-out depends on it. The ideal keeps the description-not-comment
  rule. Either keep the phrase "single source of truth" or update close-out's parenthetical
  to match.

---

## 3. Spike

### What it's for

We don't know whether an approach can work here. Build the smallest thing that answers the
question for real, and come back with go or no-go and the evidence.

### The ideal version

> # Spike {id}: {title}
>
> {task facts: project, parent, related tasks, labels}
>
> There's a question we can't answer by reading: will {the approach in question} actually
> work here? Your job is to find out by trying it, with the smallest experiment that gives a
> real answer, and to come back with a clear go or no-go.
>
> Start by writing the question as sharply as you can, along with what result would mean yes
> and what would mean no. If it's really several questions, pick the one that decides the
> rest. Then build just enough to answer it, against the real code and the real dependencies
> where you can. A proof of concept that stubs out the hard part doesn't prove anything.
> Keep to {timebox, default: one focused session}. If you reach the limit, stop and report
> what you learned and what is still unknown.
>
> The code is evidence, not the deliverable. Don't land it, but leave it where the next
> person can see it: a branch, or the key snippet in your comment. If the experiment shows
> the problem is somewhere other than where the ticket assumed, say so. That's often the most
> useful thing a spike finds.
>
> Put the answer first: go, no-go, or go with conditions. Then give the evidence (what you
> ran and what happened), the risks you saw, and what's still unknown. Write it as a comment,
> and put the verdict in the description so the next stage sees it.

(About 240 words, against 163 today.)

### What machines rely on

**Runtime, read by code:**

| String | Where it is read |
|---|---|
| `# Spike {identifier}: {title}` (`:760`) | Convention only. |
| `## Workflow` from `formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, …)` (`prompt-formatters.js:320-333`), exactly: `1. **Start**: Set {id} status to "In Progress" in Linear (if not already)` / `2. **Fetch details**: Get full issue details for {id} in Linear` / `3. **Analyze**: Complete the goal below` / `4. **Update Linear**: Add findings as a comment on {id}` | `gateWorkflowWrites`, `shapeWorkflowStateWording`, `applyPromptCapabilities` (as above). |
| `name: 'spike'` (`:747`) | `deriveDispatchKind`, the action vocabulary, `→ **spike**`. |
| Shared post-pass | Already code-appended. |

**Read by LLMs or tests:** the `go/no-go` wording appears in `aiHint.goal` (`:753`) and
`COMPLETION_SIGNALS.spike.coreOutcome` ("Technical questions answered with go/no-go
recommendation"). Nothing parses a go/no-go verdict. Tests check existence only
(`prompt-templates.test.js:48`, `:106`, `:378`) plus `effort-readout.test.js:225`, which
lists the kind. If later code needs the verdict, the mechanical layer could append *"Start
the comment with `Spike verdict: go`, `no-go` or `go with conditions`."* Nothing reads such a
line today, so I'd add it only when a reader exists.

### Rules that tie scope to the ticket

- `:772`: "Your role is to answer specific questions through focused experimentation, **not
  to implement production solutions**." This is a real edge of the stage (spike code is
  throwaway), so it isn't a scope-to-ticket rule as such. The ideal keeps the edge and
  explains why: the code is evidence.
- Nothing else here pushes a minimal fix or puts the cause out of scope. The risk in spike is
  different. It defines its questions from the ticket's framing (`:774`, "Define 3-5 specific
  questions"), so the spike tests the approach the ticket assumed. The ideal adds the line
  inviting it to say when the problem sits elsewhere.

### How today's version differs

**Rule-shaped text, and contradictions.**
- "Define 3-5 specific questions" (`:774`) is a quota, and it contradicts the stage's own
  routing hint: `aiHint.chooseOver` (`:756`) says spike is for "a single, decisive feasibility
  question". The ideal asks for the one question that decides the rest.
- The template says "time-boxed" in its description (`:749`), and the completion signal checks
  "Exploration completed within timebox". But the brief never states a timebox or what to do
  when it's reached. The ideal gives one, or a placeholder for one, and says what to do at the
  limit.
- "Spike deliverables:" (`:776-780`) is a four-item checklist. The ideal turns it into what
  to report and in what order (answer first).

**What's missing.**
- What makes a proof of concept convincing: real dependencies, not stubbed-out hard parts.
- What happens to the code: don't land it, but leave it visible.
- Context: spike renders only Project and Labels (`:766-768`), not Parent or Related Tasks,
  unlike research and scoping. The mechanical layer should give it the same task facts.
- Writing the verdict to the description: today it lives only in a comment. That's workable,
  since the meta-prompt's Step 1 reads comments, but it's out of line with research and
  scoping.

**What today gets right, and the ideal keeps.** It's short. It names a go/no-go answer as the
deliverable. It asks for remaining risks and unknowns. It says spike code isn't production
code.

---

## Notes for whoever writes the mechanical layer

- **The capability post-pass works by regex over the brief.** `gateWorkflowWrites`,
  `shapeWorkflowStateWording` and `stripSubtaskSections` all exist because the templates
  hard-code Linear's wording, and code then rewrites the result. In the two-layer design the
  mechanical layer should generate the workflow and status steps already shaped for the
  provider (from `resolvePromptUi`), and keep them out of the writing layer's hands.
  Otherwise the writing model has to reproduce these exact strings so the regexes still
  match. If they have to stay as post-passes for now, the strings the writing layer must not
  paraphrase are: `## Workflow`, `**Start**`, `**Update …**`, `status to "In Progress"`,
  `Linear`, ` in Linear`, `**Existing Subtasks:**`.
- **Downstream briefs cite these stages' outputs by name.** These are plan `:227` and `:289`,
  review `:1046`, close-out `:1221-1222`, triage `:413`, implementation `:964` ("the
  research's reasoning wins") and meta-prompt Step 1 `:151-173`. Rewrite them in the same
  pass as research and scoping, or the contract between stages breaks silently, because no
  test catches LLM-to-LLM drift.
- **Instruments.** `scripts/steady-base-tracker.mjs:67` counts `Surface Assessment` in
  comments, and the `plain-language.md` classifier recognises a research comment by
  `Surface Assessment|Audit the Layers|Name the Classes|exploration notes`. After the
  rewrite, decide either to keep the one appended `Surface Assessment:` line (cheap, and it
  keeps the trend comparable) or to re-base the instruments.
