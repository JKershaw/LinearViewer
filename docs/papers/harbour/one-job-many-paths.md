---
title: Why does Harbour keep several paths for one job?
kind: paper
version: 1
date: 2026-10-07
authors: [GitHub Copilot]
model: "GitHub Copilot cloud agent, with three read-only research subagents; the parent model and effort are not reported in the task record."
grounded_at: a052a5ddfa4122d415e8c79cd0b400b470c0afe3
cites:
  - "tests/unit/lin-3278-connection-credential-single-source.test.js@1290ef75:186-203"
  - "server.js@a052a5dd:2532-2549"
  - "lib/workspace.js@a052a5dd:1333-1340"
  - "lib/periodicals.js@a052a5dd:218-228,356-375"
  - "19d7198a (2026-10-04, LIN-3300)"
  - "PR #1765, comment 6042698757 (2026-10-07T17:02:14Z; unmerged work)"
  - "docs/papers/harbour/like-a-skilled-developer.md@a052a5dd:36-115"
  - "docs/papers/harbour/how-process-changes-land.md@a052a5dd:98-159"
  - "Further source anchors in Evidence below."
---

# Why does Harbour keep several paths for one job?

Harbour repeatedly makes one decision in several places because a new task adds a way
through the system without retiring the old way. Compatibility, independently assembled
results and context passed beside an identifier then become obligations for every later
change. **The useful unit of consolidation is not the file or the endpoint, but the
decision: one authority, reached by every caller.** The strongest remedy is already in
Harbour's history: remove a competing implementation, preserve its necessary behaviour
in the survivor, and test the real entry paths against that survivor. More permission to
refactor, another architecture review, or another list of cleanup tickets would mostly
repeat machinery Harbour already has.

## Findings

### 1. The four examples are real, but they are not four outstanding defects

**Distinguish multiple entrances from multiple answers.** A browser session and a proxy
token need different authentication. Linear and Jira need different adapters. Neither
requires different rules for choosing the task's source. A wrapper that delegates a
decision is not a second authority; a copied rule or independently maintained fact is.
That distinction changes the reading of the motivating cases:

| Job | How the paths arose and what went wrong | Position at the grounding commit |
|---|---|---|
| Choose a connection's credential — LIN-3275 | The September 29 connection migration wrote the owner record before its mirror. Normal reads trusted the mirror while recovery read the record. A stale legacy row could also divert selection back to the old path. The October 3 fix history records alternating 401/200 responses. | LIN-3278 and LIN-3282 repaired these cases. Refresh-token connection readers now use the authoritative-record overlay. Legacy acquisition remains; this is not evidence of a fresh incident. [1] |
| Report a usable owner's login — LIN-3323 | Connection, cache, session and refresh branches built success responses separately. The connection response omitted `reason: 'ok'`; a consumer called a valid read `refresh_error`, while a subsequent cache hit could succeed. | October 6 introduced the shared `grant` constructor. This was divergent success classification, not independently failed authentication. The share feature that exposed it was subsequently removed. [2] |
| Address a task — LIN-3332 | Provider provenance arrived in June; support for multiple sources of the same kind added `bindingScope` in October. IDs, source kinds and scopes then travelled through pages, requests, dispatch records and wakes. Earlier repairs include foreign-source detail reads returning 404 and senders omitting the required pair. | The admission rule now permits one source per kind, but the old pair plumbing remains. Removing it is an ongoing simplification, not an accomplished one. [3] |
| Choose a binding through proxy or session — LIN-3335 | The grounding tree already shares `selectIssueBinding` between both lanes. The first revision of the removal PR deleted kind-only routing from the proxy while retaining it for sessions. | This is an **unmerged branch regression**, not current baseline duplication. The October 7 response records a fix sharing the smaller selector and bypassing the default cache for source-bearing reads. [4] |

**Task identity is expensive to carry, but its source is not redundant.** At this commit,
`bindingScope` or `issueBindingScope` occurs in **44 JavaScript files** under the application
directories. This counts a propagation footprint, including comments, not 44 independent
decisions. GitHub's native issue ID is an issue number; removing its provider kind cannot
make it globally identifiable. One source *per kind* still allows Linear and Jira together.
The removable distinction is between two sources of the *same* kind, under the newly
chosen product rule. Provider call scopes and credential boundaries still matter. [3]

This is the first consolidation to finish, rather than commission again. Complete the
existing server and client cutover; keep the remaining task address together through links,
reads, dispatches and follow-ups; make all entrances delegate source selection. Do not
replace the sidecar fields with a new global ID registry unless a demonstrated consumer
requires one. The admission rule alone neither migrates old workspaces nor proves that
their data allows deletion.

### 2. The pattern extends beyond the reported incidents

**Provider write support has the strongest current inconsistency found.** GitHub inherits
`ui.priority: true`; its edit form offers priority, the session route accepts it, and
the adapter constructs an update without it. This is a source-traced ineffective write,
not a browser reproduction. Capability decisions accumulated separately: July fixed
an analogous dropped state update; August 9 made session creation work without teams;
August 30 separately repaired the proxy's team requirement. [15]

The high-priority consolidation is an operation-aware provider field contract: forms
derive an exposed subset, routes validate support, adapters implement it. Do not simply
merge `createFields` and `apiWriteFields`: the API intentionally offers fields the form
does not, and create and update need not accept the same fields. Replacing silent dropping
with refusal is an observable contract change, not a behaviour-preserving extraction.

**“Waiting for a person” has three presentation-owned derivations.** The session banner,
step-row flag and header clock independently choose evidence and precedence. July's
removal of `[pending]` as a human-wait signal needed mirrored changes; August's row fix
recorded blocked runs hidden by trailing usage entries; October's header clock added
another scan. Today the banner accepts the agent-status waiting channel as well as
feedback, while the clock reads feedback. Whether that channel should start a clock
needs a decision, not an accidental difference. [16]

This is the other high-priority refactor: derive per-loop human-waiting facts once,
including reason and available start time, then let the banner roll them up and the row
and clock display them. Preserve terminal precedence and supersession. A parent wake,
a completed worker and a request for human input are different events; simplifying must
not collapse them.

**One prompt assembler still receives four independently prepared evidence objects.**
Buffered UI recommendation, streaming descent, streaming leaf and the proxy's shared
recommendation function each project fetched context into a reduced object. June's
attachment repair changed all four after an earlier deterministic-path fix missed them;
August repaired omitted provider capabilities, and October threaded recent runs through
the entrances. The inspected fields agree now. The continuing cost is an N-place change
whenever recommendation evidence grows, not an outstanding attachment defect. A shared
input-preparation seam would remove those projections while leaving SSE, cancellation,
authentication and endpoint-specific flags at their appropriate boundaries. [17]

**A parity test preserved four copies, then a fifth arrived outside it.**
`isDecisionLifecycleStampEntry` distinguishes bookkeeping from transcript/activity
evidence. Five further membership definitions sit in browser dispatch, browser session,
session telemetry, wall-clock summary and run view. The September 25 drift test lists
the first four; the October 2 run-view addition is not in that list. Their membership
currently agrees. The demonstrated gap is incomplete protection, not a newly observed
misclassification. Extracting a dependency-free classifier, available to both runtimes,
would retire five definitions and their synchronization obligation; merely adding the
fifth to the parity list would preserve the arrangement. [18]

**The credential-ranking rule is deliberately copied to avoid changing protected code.**
Both `workspace-token-resolver.js` and `connection-access.js` decide that a real finite
expiry outranks a sentinel expiry, then prefer the later expiry within a tier. The latter
explicitly says it mirrors the rule because the original resolver was hash-pinned at zero
diff. That is a concrete mechanism: a protection against changing one implementation
creates another implementation to maintain. No new ranking failure was demonstrated in
this research. The opportunity is to share the comparison, with each caller retaining its
different eligibility and authorization filters—not to merge all credential acquisition
into one indiscriminate search. [5]

### 3. The decisive failure can be visible and still excluded from success

**The clearest evidence is a skipped test, not a speculation about agent psychology.**
The first credential fix committed a `KNOWN RESIDUAL` test describing the same alternating
response sequence after the fix. Its comment called the required selection change
“out of the plan's scope”; the test was skipped. The next fix changed selection and
enabled it. The record therefore shows a recognized continuation of the problem surviving
the first task's acceptance boundary. It does not show that nobody noticed, nor that the
residual remains today. [1]

The causal sequence supported by these cases is:

1. A task introduces a new representation or entrance while preserving the old one.
2. Its tests establish the new path's local contract, often with the adjoining seam mocked.
3. A later fix follows one entrance and leaves another producer of the same answer intact.
4. Compatibility and tests make each surviving branch look intentional; retiring it needs
   an explicit decision that no single patch requires.

The cross-seam ruling-reply test documents exactly the testing version: one test used the
real client against a stubbed fetch, another replaced the shared client helper. Both
“real” halves missed the join. The replacement connects the real browser functions to
the real HTTP route and keys the fake provider by credential, not request count. [6]

### 4. Harbour has already demonstrated a better end state

**LIN-3300 removed a competing answer-maker, rather than asking two paths to agree.**
On October 4, `19d7198a` deleted the model-written meta-prompt path and the experimental
brief writer, including their switches and model-setting surface. Routed recommendations
now select a stage, then use the same `generatePrompt` assembly as pinned stages.
Subsequent work moved rules carried only by the deleted path into the surviving templates
and simplified the selector. [7]

The initial deletion changed 27 application files: **236 lines added, 1,248 removed;
net 1,012 removed**, excluding tests, documentation and scripts. This is a reproducible
change-size measurement, not a token-saving estimate or proof of improved agent work.
The more important evidence is structural: all-stage tests compare the result with
`generatePrompt`, cross-route tests cover the UI and proxy entrances, and a stale writer
preference cannot reactivate the deleted path. [7]

Task-page links offer a smaller precedent. LIN-3331 puts server-side construction behind
`taskPageHref`, with a browser counterpart, and checks for new hand-built links.
Its exceptions must explain themselves and still match real code. This is not literally
one implementation across both runtimes; it is a bounded shared contract and a guard
against new independent sites. Not every useful consolidation needs a new service. [8]

### 5. The missing process change is ownership of retirement, not another instruction

**The current stages already ask for most of what the earlier diagnosis wanted.**
Research says to search for the concept across parallel surfaces, not just a symbol;
a second representation demands a refactor. Shared stage intent makes the cause part of
the task and grants engineering authority. These are existing rules, not recommendations
this paper has discovered Harbour lacks. Prompt tests can establish their presence, but
the validation guide explicitly says structural tests prove nothing about behaviour. [9]

**The architectural review also already exists.** Drift & Coherence names duplicated
decisions and N-place maintenance costs, rejects cosmetic uniformity, and reads prior
reports. Its common completion contract, however, ends when the report is written and
the highest-severity follow-up tasks are on the stack. It can succeed while none of the
old implementations disappears. The autopilot likewise recognizes “every move locally
fine, the sequence wrong”, but hands architecture-level findings back. These are useful
role boundaries; they leave retirement needing an execution owner. [10]

There are three different proofs, and Harbour needs the appropriate combination:

- **An instruction is present:** a prompt assertion.
- **A known boundary is respected:** a source guard, preferably tested with a planted bypass.
- **The answers converge:** real callers exercised through the boundary with disagreeing
  stored values, cold and warm caches, and failure/recovery sequences.

The connection guards already provide the second kind. They recognize specified imports,
reads and constructors; they cannot prove that two allowed branches *inside* the seam use
the same authority. The credential matrix and one-path recommendation tests provide
examples of the third. Use these existing patterns instead of installing another general
linting or review layer. [1,7,11]

## Ways out

**At code level, retire independent decisions, not merely duplicate-looking lines.**
Finish the task-address simplification first because it already has a chosen invariant,
live consumers and a deletion in progress. Among new work, put provider write honesty
and human-waiting derivation first: they govern whether work changes a task and whether
a person knows to act. Recommendation-input preparation comes next for its demonstrated
history of omissions; stamp classification is the smaller, bounded removal. Copied
expiry ranking is lower priority because this study found no new divergence there.
Keep the already-fixed credential and success-contract seams intact. A new helper
counts as consolidation only when callers stop making the old decision. This ordering
is engineering judgment about consequence and reach, not a measured savings forecast.

**At operating level, make consolidation part of the affected work's completion.**
These are proposals for John, not changes made by this paper:

- **Make the unit of work a decision and its callers.** Reuse research's existing class
  enumeration to identify the authority, the callers to move and the behaviour to preserve.
  Implementation and review then judge that end state, rather than whether each named
  file received a patch. Do not add a separate consolidation stage or a form to every task.
- **Make divergence hard to reintroduce.** For a concrete seam, retain a behavioural
  witness across real entrances and a narrow guard against bypasses. A fixture in which
  the mirror and record always agree cannot test which one is authoritative. Nor can
  a single provider test prove non-primary-source routing.
- **Keep staged deletion in the same active effort.** If migration cannot be atomic,
  an existing parent/workstream owns compatibility, cutover and removal. Child tasks may
  finish; the consolidation does not finish while the losing policy or switch remains.
  Completion needs evidence about live data and callers, not a cleanup ticket number.
  A rollback branch needs an explicit removal condition; where safe, reverting a commit
  avoids keeping an alternative runtime implementation indefinitely.
- **Use the review Harbour already runs to allocate work, not multiply reports.**
  When a repeated Drift & Coherence finding is selected, reserve its migration and
  retirement within an active effort. New work touching that seam should consume the
  chosen authority, not create another version. Leave unrelated cosmetic similarities
  alone. This changes what work gets finished, not how many agents inspect it.

The test of this proposal is fewer independent implementations of a *named decision*,
with all bounded callers covered and old behaviour either preserved or explicitly
withdrawn. Net lines help describe a change, but rewarding deletion alone would encourage
removing necessary distinctions—the precise mistake caught in LIN-3335.

## Relation to the earlier papers

**This adds an architectural unit to the archive's process diagnosis.**
*Tasks Generate Tasks* measured the production of follow-ups; *Never-Worked Pile*
distinguished genuine new work from a parent's unfinished scope. This paper does not
recount that tracker population. The skipped credential witness shows the latter
mechanism in committed source, and shared-decision retirement gives it a concrete
completion criterion. [12]

*How Process Changes Land* already found unretired alternatives and warned that shadow
trials themselves create second paths. The lesson here is to fund the cutover and
deletion, not start another permanent two-arm experiment. Its September/October census
is not a count of this checkout. *Paid Where Written* rightly locates cost in repeated
work, but “put it in code” is insufficient: code with two authorities also charges every
future change twice. [13]

*Like a Skilled Developer* supplies the cause-level authority argument. Its claim that
no stage grants that authority no longer describes this tree, and its proposed
model-written briefing layer is not the architecture that survived. LIN-3300 deleted
that layer. Authority matters, but the stronger local precedent is **fewer producers of
an answer**, not a more capable extra producer. None of this establishes the behavioural
effect of October's prompt changes. [7,9,14]

## Method

This is a purposive, mechanism-seeking study, not a census or a random sample. Read the
four motivating cases through their implementation history, follow callers into shared
helpers, and inspect related recommendation, dispatch, lifecycle and testing boundaries.
Three read-only subagents investigated the reported cases, further candidates, and the
process; the author read the cited evidence and synthesized the findings.

The baseline is `a052a5ddfa4122d415e8c79cd0b400b470c0afe3`, with full ancestor history
fetched. Use `git log --all --grep=LIN-…`, `git show <commit> -- <path>` and the
line-anchored sources below to retrace a case. Classify each apparent second path as
independent policy, duplicated fact, delegation, or intentionally different semantics;
record fixed, live or in-flight separately. Historical failure accounts are labelled
as such, not represented as experiments run here.

The two new size measurements are reproducible from the checkout:

```sh
cd /home/runner/work/LinearViewer/LinearViewer
git grep -l -E 'issueBindingScope|bindingScope' a052a5dd -- \
  'lib/*.js' 'routes/*.js' 'public/*.js' server.js | wc -l
git show --shortstat --format= 19d7198a -- lib routes public server.js
```

The first returns 44 files; the second the 27-file, +236/−1,248 change. Neither is a
count of semantic decisions. The three waiting derivations, four recommendation
projections and five classifier replicas are the explicitly named sites in findings 2
and evidence 16–18, not whole-repository totals. To retrace the classifier set, search
`decision-withdrawal-reversed` under `lib/` and `public/`, retaining membership predicates
and excluding stamp writers and individual lifecycle transitions. GitHub PR #1765's
response was read separately; it is not part of the grounded tree.

## Limits

Selection started with known failures and expanded around high-change boundaries, so it
favours problematic areas. It establishes recurrence, not how much of Harbour is
duplicated. No production credentials, workspace data or session transcripts were read;
the supplied workspace proxy was not used. No historical reproduction, runtime-saving
estimate or October before/after effectiveness study was performed. The original
LIN-3335 review was not available in the returned GitHub review records; its author's
response and corrective code are evidence of the reported finding, not an independent
reproduction. This paper has not received the archive's separate checking paper.

## Evidence

All unqualified code links below are pinned to the baseline. Historical commits and the
unmerged PR are labelled explicitly.

1. Credential history: [migration](https://github.com/JKershaw/LinearViewer/commit/9426730f),
   [first fix and skipped witness](https://github.com/JKershaw/LinearViewer/blob/1290ef75/tests/unit/lin-3278-connection-credential-single-source.test.js#L186-L203),
   [fallback repair](https://github.com/JKershaw/LinearViewer/commit/2e1aa81d),
   [other readers](https://github.com/JKershaw/LinearViewer/commit/ec17312b);
   current [authoritative overlay](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/connection-credential.js#L617-L644)
   and [acceptance matrix](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/lin-3278-connection-credential-single-source.test.js#L163-L205).
2. Owner-login classification: [fix](https://github.com/JKershaw/LinearViewer/commit/ea6f0c37),
   [shared success constructor](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/server.js#L2532-L2549);
   [later share removal](https://github.com/JKershaw/LinearViewer/commit/65068a26).
3. Task addressing: [source introduction](https://github.com/JKershaw/LinearViewer/commit/1427bf3a),
   [pair selectors](https://github.com/JKershaw/LinearViewer/commit/5692e387),
   [detail fix](https://github.com/JKershaw/LinearViewer/commit/d0734d48),
   [sender repair](https://github.com/JKershaw/LinearViewer/commit/f931c274);
   [native GitHub IDs](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/providers/github/index.js#L244-L246),
   [one-kind admission](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/workspace.js#L543-L577),
   [surviving selection](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/workspace.js#L1290-L1340).
4. Shared selection [before removal](https://github.com/JKershaw/LinearViewer/commit/e05b8103);
   **unmerged** [PR #1765 response, October 7](https://github.com/JKershaw/LinearViewer/pull/1765#issuecomment-6042698757)
   and [corrective commit](https://github.com/JKershaw/LinearViewer/commit/5d6ac40d).
5. Copied ranking: [original](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/workspace-token-resolver.js#L65-L91)
   and [copy with its preservation rationale](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/connection-access.js#L13-L38).
6. [Cross-seam witness and the mocks it replaced](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/lin-2933-cross-seam-witness.test.js#L1-L38).
7. Prompt consolidation: [deletion](https://github.com/JKershaw/LinearViewer/commit/19d7198a),
   [preserving unique rules](https://github.com/JKershaw/LinearViewer/commit/ac99ed28),
   [selector simplification](https://github.com/JKershaw/LinearViewer/commit/0dd3c99e);
   [all-stage and stale-option tests](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/recommend-stage-assembly.test.js#L74-L128),
   [cross-route tests](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/recommend-one-path.test.js#L259-L310).
8. Task links: [builder](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/task-page-href.js#L16-L47)
   and [guard and reasoned exceptions](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/task-page-links.test.js#L19-L88).
9. Existing process: [research and second-representation rule](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/prompt-template-defs.js#L554-L605),
   [cause-level authority](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/prompts/stage-intent.js#L3-L29),
   [what prompt tests prove](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/prompt-change-validation.md#L61-L100).
10. [Drift & Coherence remit](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/periodicals.js#L356-L375),
    [filing and completion](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/periodicals.js#L218-L228),
    [supervisor's architectural boundary](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/autopilot-operating-manual.md#L51-L83).
11. [Connection guard coverage](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/connection-access-guard.test.js#L116-L227)
    and [recognition rules](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/fixtures/connection-access-guards.js#L105-L149).
12. Earlier findings: [Tasks Generate Tasks](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/tasks-generate-tasks.md#L23-L71),
    [Never-Worked Pile](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/never-worked-pile.md#L24-L67),
    [What the Reviews Checked](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/what-the-reviews-checked.md#L26-L58).
13. [How Process Changes Land](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/how-process-changes-land.md#L98-L176)
    and [Paid Where Written](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/paid-where-written.md#L34-L43).
14. [Like a Skilled Developer: diagnosis](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/like-a-skilled-developer.md#L36-L115)
    and [brief-writing proposal](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/docs/papers/harbour/like-a-skilled-developer.md#L230-L264).
15. Write support: [optimistic priority default](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/providers/interface.js#L245-L250),
    [GitHub inherits it](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/providers/github/index.js#L477-L481),
    [form](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/render-task-edit.js#L262-L265),
    [route](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/workspace-api.js#L4362-L4411),
    [adapter](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/providers/github/index.js#L847-L867);
    [state repair](https://github.com/JKershaw/LinearViewer/commit/ebd7b5f0),
    [session create repair](https://github.com/JKershaw/LinearViewer/commit/241ac4c2),
    [proxy create repair](https://github.com/JKershaw/LinearViewer/commit/69cf9791),
    [intentional UI/API distinction](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/providers/interface.js#L375-L404).
16. Waiting: [banner](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/dashboard.js#L326-L356),
    [row](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/render-run-steps.js#L153-L196),
    [header scan](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/run-view.js#L123-L153)
    and [clock](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/run-view.js#L224-L246);
    [July correction](https://github.com/JKershaw/LinearViewer/commit/929a20f2),
    [August repair and its reported production sample](https://github.com/JKershaw/LinearViewer/commit/2e7c9c8d),
    [October addition](https://github.com/JKershaw/LinearViewer/commit/1401907a).
17. Recommendation input: [buffered](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/workspace-api.js#L1019-L1027),
    [stream descent](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/workspace-api.js#L1362-L1369),
    [stream leaf](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/workspace-api.js#L1433-L1445),
    [proxy](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/routes/proxy.js#L1684-L1703);
    [attachment fix](https://github.com/JKershaw/LinearViewer/commit/c13a29f7),
    [capability fix](https://github.com/JKershaw/LinearViewer/commit/03ebfff2),
    [recent runs](https://github.com/JKershaw/LinearViewer/commit/94fc2141).
18. Bookkeeping classification: [canonical](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/digest-feedback.js#L74-L89);
    copies in [dispatch](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/public/dispatch.js#L1126-L1134),
    [session](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/public/session.js#L274-L283),
    [telemetry](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/session-telemetry.js#L53-L62),
    [wall clock](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/wall-clock-summary.js#L60-L66),
    [run view](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/lib/run-view.js#L125-L150);
    [four-copy guard](https://github.com/JKershaw/LinearViewer/blob/a052a5dd/tests/unit/decision-lifecycle-stamp-drift.test.js#L116-L129)
    and its [introduction](https://github.com/JKershaw/LinearViewer/commit/687c0d54).

## Next

Independently check the live candidates and the boundary between necessary adapters and
duplicated decisions before commissioning refactors. Then follow a bounded set of actual
seam-changing tasks under October's existing authority rules: record independent decision
sites before and after, callers migrated, old branches retired, and later recurrences.
Count a filed cleanup as unfinished, not as a benefit. Compare work across the whole
effort, including supervision, so consolidation cannot look cheaper merely by moving its
cost to another ticket. This question is added to `../proposals.md`; this paper creates
no implementation tasks.
