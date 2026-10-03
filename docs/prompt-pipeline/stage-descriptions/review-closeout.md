# Review and close-out: from rules to briefs

Read at the working tree in `/home/user/LinearViewer` on 2026-10-03 (no git checkout, so no sha).
Sources read in full:

- `review` `generate()` at `lib/prompt-template-defs.js:997-1128` and `close-out` `generate()` at
  `lib/prompt-template-defs.js:1141-1229`
- the formatters they call, in `lib/prompt-formatters.js`: `formatHeader`,
  `formatReadOnlyWorkflow`, `formatSection` and friends, `formatDiscussionReference`,
  `formatAttachmentPerceptionCheck`, `formatCiGateCheck`
- the meta-prompt's quality rules ("Review prompts", line 308, 11.6 KB; "Close-out prompts",
  line 309, 12.0 KB) and the routing lines that mention review and close-out (143, 144, 145, 147,
  149, 193, 194), all in `lib/prompts/meta-prompt-template.js`
- `COMPLETION_SIGNALS['review']` and `['close-out']` at `lib/completion-signals.js:175-200`
- every runtime reader of the review comment and the description markers (section 3)

Today each template is about 20 KB of source. Add the meta-prompt rule and you get roughly 32 KB of
instruction for each stage, restated in at least five places (see 5.3).

---

## A. Review

### A1. What it's for

Before the work lands, a second pair of eyes checks that it actually solves the problem, at its
cause, and that the evidence it works is real. The reviewer then writes down what green CI didn't
prove, so the person landing it knows what's still open.

### A2. The ideal brief

> Placeholders in `{braces}` are filled by the mechanical layer. The writing layer adapts the prose
> to the task, but it keeps the intent and the four floors marked ★. The machine appendix (A3) is
> added by code after the prose, and the writing layer never paraphrases it.

---

**Review {identifier}: {title}**

{task facts: project, parent, siblings, labels, PR link and head sha, CI status if already read,
the bounded classes research/plan recorded, attachments list}

This task's work is built and has a PR. Before it lands, look at it the way a senior colleague
would. Does it solve the problem the task is about, at the place the problem starts? And is the
evidence that it works real? Read the task's description and comments first. They're the record,
and they may have moved on since this brief was written. Then read the diff.

What's worth your attention:

- **The cause, not just the symptom.** Check whether the change fixes the problem where it starts
  or only where it shows up. If the cause sits underneath, that's part of this work. The same goes
  for the same mistake living in a parallel path, under another name, or on the other side of the
  server/client line. None of that belongs to a neighbouring ticket. Search for the pattern, not
  only the file the task names. If the change really is isolated, say so; that's a fine answer.
- **The plan, and departures from it.** Going past the plan to fix the cause, or refactoring
  because it made the code simpler, is good work. Ask about departures nobody explained.
- **History.** Run `git log` on the files touched. Is this putting back something that was fixed
  or reverted before?
- **Tests that mean it.** Do the tests sit at the level the behaviour lives? A user-facing or
  cross-module change wants an end-to-end or integration test; a pure function wants a unit test.
  Do the important ones actually fail when the code is wrong? Take out the code path each key test
  claims to cover, check that it goes red, put it back, and say what you tried. ★ A test that stays
  green with its own code removed is passing for some other reason.
- **The real thing.** For anything visual or behavioural, look at the result yourself. If there's a
  mockup, compare the two side by side. Leave for a person only what you genuinely can't check,
  and say exactly what they should try.
  {if attachments: Look at every attachment, images included, before you judge, and name each
  one you looked at. If one won't open, stop and say which one rather than reviewing on a partial
  read.}

**CI.** Check once whether the repo has CI and what it shows on the PR head. If no checks have
registered yet, allow one short settle, but don't set up a watch on checks you haven't seen exist.
Red CI means the work isn't done. If there's genuinely no CI, run the suite yourself on the branch
and on base, and compare which tests fail by name, not by count.

**What CI didn't prove.** List every claim this change depends on that the green run doesn't
actually exercise. That includes an external API, a producer that must send what this now consumes,
a path no test drives, or anything only a person can see. For each one, say whether it's part of
solving this problem or a different problem, and how anyone will know it holds:

- a check or a repro that someone can run, naming the exact condition that tells right from wrong;
- if it truly can't be shown before production, the thing that would fire if it's wrong (a log
  line, a metric, a loud failure), plus one line on why nothing short of production could show it.
  A claim a test could have proven isn't unprovable. It's untested;
- if the change is low-risk and fully reversible, the exact revert: the commit, or the flag and its
  safe value. This doesn't apply to anything touching stored data, security or an external
  contract;
- if it's a different problem, a follow-up written so someone who never saw this task can act on
  it.

★ Green CI never settles an item on this list, because CI is why the item is on the list. A
follow-up ticket isn't a monitor, because a ticket doesn't fire. If CI genuinely covers
everything, say so in one line and don't invent doubt. If you stood in for missing CI, its limits
go on the list too: no clean environment, and nothing after this commit.

**The verdict.**

- **Approve**: the problem is solved and nothing is left to prove.
- **Approve, conditional on close-out**: close-out can settle what's left without writing anything
  new. That means a check to run, a monitor or revert you named, a follow-up for a different
  problem, or a small edit you spell out word for word. ★ If you can't quote the edit exactly,
  it's not close-out's to make.
- **Request Changes**: something still needs building, whether that's the cause underneath, a
  test, or a code change. It goes back to implementation with what you found and where. A bigger
  problem that the fix exposed is still this work, so send it back (to `plan` if it needs
  rethinking) rather than splitting it off.
- **Needs Discussion**: the right fix is something John would want to hear about before it
  happens. That covers a change to how the product behaves, a published contract, stored data,
  another repo's interface, or anything hard to undo. Lay out the choice and what you'd recommend.
  Before you raise it, check it hasn't already been asked or answered.

You don't change the code, merge, set Done or file follow-ups yourself. ★ The person who writes a
fix can't also be the one who checks it, and close-out owns the irreversible part. Your Approve is
what lets close-out go ahead, so only give it when you mean it.

Finish with one comment on the task. It should say what you checked, list what CI didn't prove,
give the CI state and the verdict, and name the next step.

{machine appendix — A3}

---

That's about 5.5 KB against today's ~32 KB across both paths.

### A3. What machines rely on (append by code, verbatim)

Every string below is read by code or by a later stage. I grepped `lib/`, `routes/` and `scripts/`
for each one. The appendix should state them as a format, not as prose rules.

| String / shape | Who reads it | Where |
|---|---|---|
| The summary comment's **first heading line** contains the word `review`, doesn't contain `plan review` / `plan-review`, and doesn't start with `close-out` / `autopilot` | `isReviewSummary`: decides which comment is "the latest review" | `lib/run-ledger.js:37-41, 49-56` (`TITLE_LINE`, `TITLE_NON_REVIEW = /^(?:close-?out\|autopilot)\b/i`, `TITLE_PLAN_REVIEW = /plan[-\s]+review/i`, `TITLE_NAMES_REVIEW = /\breview\b/i`). **Today's template never asks for this title.** It works only because agents tend to write one. |
| The body carries a verdict word or the ledger heading | `isReviewSummary` | `lib/run-ledger.js:41` `VERDICT_WORD = /\b(?:approve[sd]?\|request(?:ed)?\s+changes?\|needs?\s+discussion)\b/i` |
| `### What CI Did Not Prove` at the **start of a line** | ledger parser; follow-on-ratio diagnostic; the recommender's "has a review run?" test; the autopilot handoff | `lib/run-ledger.js:22` `/^###\s*What CI Did Not Prove\b[^\n]*/im`; `lib/follow-on-ratio.js:161` `REVIEW_LEDGER_MARKER = /###\s*What CI Did Not Prove/i`; meta-prompt lines 143, 147, 194 (LLM reads it as evidence); `lib/prompts/autopilot-kickoff.js:438, 575` |
| The ledger section ends at the next h1–h3 heading, or at a `**Verdict` / `### Verdict` line | ledger section boundary | `lib/run-ledger.js:100` |
| Ledger items are a markdown list (`-`, `*`, `+`, `1.`) or a table whose header names `#`/`id`, `claim`/`item`/`finding`, `scope`/`inside`/`class`, `discharge`/`status` | item parser | `lib/run-ledger.js:58, 195-243, 245-270` |
| Each item carries the word `inside` or `outside` (a table cell may read `In` / `Out`) | `extractScope`; then `countOpenLedgerItems` at merge, then `close-out-events-store` `openItems{inside,outside,unknown}` | `lib/run-ledger.js:126-136`; `routes/workspace-api.js:4437-4446`; `lib/close-out-events-store.js` schema |
| The word `discharged` marks an item as settled | `buildItem` → `discharged: /\bdischarged\b/i` | `lib/run-ledger.js:181`. **Bug, see 5.4**: today's template tells review to state "how it can be discharged", so "can be discharged by …" parses as already discharged. |
| Empty ledger: `CI covers the deliverable; ledger empty` (the parser also accepts `none…`, `ledger (is) empty`, `no unproven/unresolved/open/items`) | `isEmptyStatement` | `lib/run-ledger.js:106-111`; `lib/render-run-evidence.js:114` |
| Verdict line in one of these forms: `**Verdict: X**`, `Verdict: **X**`, `### Verdict` then X on the next line, or `Verdict: X` | `findVerdictText` | `lib/run-ledger.js:273-283` |
| Verdict words, matched in this order: `Request Changes`, `Needs Discussion`, `Approve … conditional` (canonical: `Approve — conditional on close-out discharging the ledger`), `Approve` | `classifyVerdict` → `isApprovedReview` accepts `approve` and `approve-conditional`, and gates the close-out box "ready" state and the R1 Done predicate `closeOutSetsDone` | `lib/run-ledger.js:59-64`; `lib/run-closeout-state.js:40, 83-85, 153, 360`. Also read by the recommender (meta-prompt 143-147, 194) and the autopilot (`autopilot-kickoff.js:436, 584`). |
| A CI line: a non-heading line containing `CI` and one of `green/red/success/fail/failed/passed/absent/run/checked/headSha` | `findCiLine` | `lib/run-ledger.js:292-301` |
| The reviewed head commit as a backticked sha, ideally labelled `head` | `findSha` → `review.sha`, compared with the PR head to flag `headMoved` | `lib/run-ledger.js:304-316`; `lib/run-closeout-state.js` `entryFor`. **Today's template doesn't ask for the sha.** |
| `### Plan Review Verdict` is plan-review's header, so review must not use it | disambiguator for the recommender and the parser | meta-prompt 147, 194; `lib/run-ledger.js:39` |
| `DECISION:` block (when raising a question for John) | rulings pipeline; format defined in the proxy preamble, not here | `lib/proxy-instructions.js:576, 601`; dedupe `lib/dismissal-suggestions-store.js:77` |
| API reads used before raising a question or a follow-up: `GET /api/proxy/rulings?issueIdentifier=<anchor>&includeResolved=true`, `GET /api/proxy/issues/{id}/relations`, `GET /api/proxy/search` | proxy routes | `routes/proxy-rulings.js:246`; `routes/proxy-reads.js:513, 347` |
| Next-action names: `implementation`, `plan`, `bug`, `blocked`, `review`, `close-out`; relation type `blocks` | the recommender and the dispatch kinds (LLM-read from the trail, not regex-parsed) | meta-prompt routing; `DISPATCH_KINDS` |

A suggested appendix, as code would emit it:

```
### Format (read by Harbour — keep exactly)
- Title your summary comment with a first heading containing "Review" (e.g. "## Review — {identifier}").
- Name the reviewed head as: Reviewed head: `{sha}`
- One line giving CI state, starting "CI:" (green / red / absent — substitute run: …).
- The ledger under the heading `### What CI Did Not Prove`, one list item per claim, each containing
  the word inside or outside. Use "settled by" / "route:" for how it will be shown; write
  "discharged" only for an item that already is. If empty: "CI covers the deliverable; ledger empty".
- Then `### Verdict` with exactly one of: Approve · Approve — conditional on close-out discharging
  the ledger · Request Changes · Needs Discussion — and a one-line reason.
```

### A4. Rules that tie scope to the ticket

| Line | Quote | Why it ties scope to the ticket |
|---|---|---|
| `prompt-template-defs.js:1013` | "Your role is to verify against requirements, not to add new requirements." | A finding that the cause sits underneath reads as "a new requirement". |
| `:1015` | "If implementation overran the plan's surfaces or the plan is stale, flag this as a review finding rather than pressing on." | A fix at the cause that went past the plan gets treated as a defect. |
| `:1042` | "…mark each unhandled instance **inside** or **outside** the ticket's bounded classes … — review itself does not fix it." | Measures scope against the classes this ticket bounded, not against the problem. |
| `:1046` | "**Outside**: a genuinely different kind of problem — no bounded class covers it. It may be filed as its own follow-up…" | The cause beneath a symptom is almost always "a different kind of problem" from the symptom's class, so it gets filed. This is the line the essay's [7:1175] mirrors. |
| `:1046` | "an inside item's options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item" | Good for inside items. But scope is still "the ticket's bounded classes", fixed at research/plan time. |
| `:1048` | "If one exists, link it (a `related` relation) and record it in your summary instead of raising a ruling or filing a new one." | Linking an existing ticket counts as handling the finding. |
| `:1086` | "An **outside** item … by a routed follow-up ticket that states the problem on its own terms." | Filing is the discharge. |
| `:1088` | "otherwise it stays an outside-scope follow-up, not a ledger item." | A sibling the change doesn't depend on drops out of the gate entirely. |
| `:1115-1118` | "verifying it surfaced a hidden blocker (a second, larger bug the fix exposed…) … Create a new Linear ticket for the surfaced work … as a `blocks` relation" | The deeper bug the fix exposed becomes a separate ticket. It doesn't close the parent, but it moves ownership of the cause to a new ticket. |
| meta-prompt `:143` | "capture anything genuinely missing as a follow-up" | The routing description of review sets it up as a filer. |
| meta-prompt `:308` (5a), (6) | the same inside/outside and "outside item by a routed follow-up ticket" text, restated | Same as above, on the AI path. |
| `completion-signals.js:184` | "closure blocker filed/linked as `blocks` and named as the next action" | The completion check rewards filing. |

### A5. How today's version differs

**Rule-shaped, should become guidance**

- Regression check, gap analysis, test-level check, mutation check and the 14-item checklist
  (`:1025-1075`) are five overlapping lists. The checklist repeats the sections above it and adds
  generic items ("Code style consistent", "No performance regressions", "Code is ready for
  production") that no agent skips because they're missing. All of this folds into "what's worth
  your attention".
- The ledger's proportional lanes (`:1090-1095`, about 2.5 KB) carry the right intent and say it
  three times: "naming is the price", "Naming the monitor is the price of the lane, not a
  formality", "Widening the lane never widens the *ledger*". One sentence per lane does the job.
- The verdict section (`:1105`) and the handoff (`:1109-1113`) restate the write-only rule four
  times and the CI precondition twice.
- "Isolated, or One of a Class?" and "Inside or Outside" (`:1040-1046`) carry the LIN-313 lesson
  ("widen the model, don't patch the witness"), but frame it as a classification exercise against
  bounded classes. The ideal keeps the lesson (search for the pattern, find the siblings) and drops
  the framing.

**Scar tissue, or restated elsewhere, could go**

- The ticket citations inline in prose: "John Kershaw's ruling on LIN-2825", LIN-1871, LIN-2274,
  LIN-2991/LIN-3022, LIN-3033. They belong in docs and the change log, not in the agent's brief.
- "Keep this closure blocker distinct from a plan-phase prerequisite-refactor subtask" (`:1120`)
  is about another template's vocabulary, and the agent doesn't need it.
- The "Misfire guard — write the line … The guard is a step, not a caveat" paragraph is a scar from
  monitors being named for claims a test could have proven. The ideal keeps the substance in one
  sentence: say why only production could show it, because a claim a test could prove is untested.
- `formatCiGateCheck` "never arm a Monitor or other background watch" is a scar from an unbounded
  wait. It's worth keeping in one clause. A stronger fix belongs in code: the mechanical layer
  could read `statusCheckRollup` itself and put the result in {task facts}.
- The existing-ticket and no-re-raise API recipes (`:1048-1050`) are tool knowledge. The dedupe
  belongs in code (the create-issue and ruling routes could flag near-duplicates). The brief keeps
  only "check it hasn't already been asked".
- Restatements: `aiHint` (`:992-996`), `COMPLETION_SIGNALS['review']`, meta-prompt rule 308 (a
  numbered 11.6 KB paraphrase of the same template), the autopilot kickoff, and
  `docs/architecture/prompt-system.md`. In the two-layer design the meta-prompt's quality rule for
  review should simply *be* the A2 brief plus the A3 appendix, so there is one source.

**What today's version gets right and the ideal keeps**

- The independence floor: review doesn't edit, merge, set Done or file. The ideal keeps it, with
  the reason ("the person who writes a fix can't also check it") rather than as a scope rule.
- Green CI never settles a ledger item, and a ticket isn't a monitor.
- "Cheap when empty": don't invent doubt. This is measured in `scripts/eval-review-closeout.mjs`.
- The mutation check (LIN-2274), with the reason: "a test that stays green with its own claimed
  code path removed passes for a reason other than the one it names." It's one of the best lessons
  in the file.
- The conditional Approve is reserved for what close-out can settle without authoring (LIN-3056).
  That stops close-out bouncing back to implementation.
- The substitute for absent CI: diff failure *names* on branch vs base, and record what the
  substitute can't prove.
- Attachment perception with a hard stop on partial reads.
- The departure from today: a bigger problem underneath goes back to implementation as part of
  this work, not into a new `blocks` ticket. The new escalation edge is the "John would want to
  hear first" list (product behaviour, published contract, stored data, another repo's interface,
  irreversible). That's LIN-3288's candidate definition of "large", which is still John's to
  settle.

---

## B. Close-out

### B1. What it's for

Land the approved work: settle what review said CI couldn't prove, merge, confirm it on what
actually landed, mark it Done and leave the task tidy. It's the last check before something
becomes hard to undo, so "settled" has to mean settled.

### B2. The ideal brief

---

**Close out {identifier}: {title}**

{task facts: PR link and head sha, the latest review comment (id, time, verdict, reviewed sha),
the parsed ledger items with their inside/outside marks, CI status on head if already read}

Review has approved this work. Your job is to land it. Settle whatever review said CI couldn't
prove, merge, check the change on what actually landed, mark it Done, and leave the task tidy.
You're the last pair of hands before this becomes hard to undo, so the bar is that every item is
actually settled, not that it looks settled.

Start from the latest *review* comment. A plan-review approves a plan, not built work. ★ If no
review has recorded a verdict, the work isn't ready: leave the task open and name `review` as the
next step. If review approved but didn't say what CI left unproven, ask review for it rather than
deciding yourself that there's nothing. A recorded Approve plus a settled ledger is your authority
to finish, and you don't need a fresh go-ahead from anyone.

**Settling the ledger.** For each item review wrote down:

- **Part of this problem.** It's settled when it's done: a check you ran, or a repro that hit the
  exact condition review named. Cite what you saw.
- **Review named a monitor**, with its line on why nothing before production could show the claim,
  **or an exact revert.** Cite that name and move on. ★ You can't supply the name yourself. "We'll
  notice" or "it can be reverted", with nothing named, isn't settled, and a ticket isn't a monitor.
- **A different problem.** File it as a follow-up that someone who's never seen this task can act
  on.
- **Accepted by a person.** This only counts when they say what they actually checked.

★ Green CI never settles an item. Filing a ticket never settles something that's part of this
problem. If the ledger is explicitly empty, there's nothing to settle, so don't invent doubt.

**What you may write yourself.** If an item that's part of this problem isn't done, it goes back
to be done. ★ Write it yourself only when review spelled out the exact edit, word for word, and
it's small enough that nobody would need to look at it again: a sentence of prose or a couple of
lines of code, with no new logic and no new or changed test. Anything else isn't yours. That
includes a fix you spotted yourself and any merge conflict where you'd have to choose or write a
hunk. Hold the merge, leave the task open, and name `implementation`, then `review`. A clean
merge or rebase is just mechanics. If leaving part of the problem undone seems right, say plainly
what's being left and why. If that changes what the task promised, it's John's call to make before
you close.

**Landing it.** Check CI once on the exact commit you'll merge: one settle if checks haven't
registered yet, and no watching for checks you haven't seen. If you made an edit, wait for CI to go
green on the new head, and merge pinned to it. Then merge, check the change on the landed commit,
and set Done in this same session. Don't leave the task open for a later "confirm it works", and
don't file a ticket for one. Something that can only show up over time belongs on a named monitor,
not an open task.

**Afterwards:**

- Post a summary: what merged, how each ledger item was settled (for any edit you made, the commit
  and the review sentence it came from), and the final CI state.
- Tidy the description. Replace the plan, research and design sections with a short stub: what
  shipped, the PR, whether the plan held or how it changed, and a note that the full history is in
  the task snapshots and comments. Keep the problem statement, acceptance criteria, repro steps,
  scope, and anything a follow-up points to. If you can't confirm the snapshot was taken, skip the
  tidy and say so. The task is still Done.
- File the follow-ups for different problems that review named, after checking they don't already
  exist. Give each a priority that reflects how bad it would be and how likely (with a line of
  reasoning), and a type label from the workspace's own list.

If anything stops you closing, leave the task open and name the next step: `review` for a verdict,
or the `bug` / `plan` / `implementation` that resolves the blocking item.

{machine appendix — B3}

---

That's about 4.3 KB against today's ~32 KB across both paths.

### B3. What machines rely on (append by code, verbatim)

| String / shape | Who reads it | Where |
|---|---|---|
| Close-out's own summary comment title **starts with** `Close-out` (or `Closeout`) | `TITLE_NON_REVIEW` keeps it from being read as "the latest review". A close-out summary titled e.g. "Ledger discharge review" that carries verdict words would become the latest review and change the parsed verdict and ledger | `lib/run-ledger.js:38`. **Today's template doesn't ask for this title.** |
| Inputs it reads: the review comment as parsed in A3 (verdict words, `### What CI Did Not Prove`, `inside`/`outside`, reviewed sha) | close-out box state, R1 Done predicate, open-item counts at merge | `lib/run-closeout-state.js:83-85, 340-370`; `routes/workspace-api.js:4437-4446, 4549-4612` |
| Merge pinned to the head: `gh pr merge … --match-head-commit <sha>` | gh CLI | `prompt-template-defs.js:1174` |
| Archive before editing: `GET /api/proxy/issues/{identifier}/brief?noRefresh=1`, then verify with `GET /api/proxy/issues/{identifier}/snapshots`; edit with `PATCH /api/proxy/issues/:id` | proxy routes | `routes/proxy-compute.js:1025-1100` (`noRefresh`), `:558` (snapshots) |
| Description literals that **must survive the prune verbatim**: `fits one session` / `needs multiple sessions`, and a `## Implementation Plan` heading | session-fit reader; follow-on-ratio plan marker; file-pointer pilot | `lib/recommendation-facts.js:49-50` (`/needs?\s+multiple\s+sessions/i`, `/fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session/i`); `lib/follow-on-ratio.js:149` `PLAN_MARKER = /#{1,4}\s*implementation plan\b\|\bfits one session\b\|\bneeds multiple sessions\b/i`; `lib/file-pointer.js:150` `/^##[ \t]+Implementation Plan\b[^\n]*$/gm` |
| `plan-review due: yes` in the description | `GATE_DUE_MARKER` current-snapshot read for the effort readout | `lib/plan-review-round-trips.js:168, 440`. **Not on today's preserve list, see 5.4.** |
| Follow-up metadata: `priorityLevel` (ascending, 4 = highest); type label from `GET /api/proxy/labels`; dedupe via `GET /api/proxy/issues/{id}/relations` and `GET /api/proxy/search`; link with a `related` relation | proxy routes | `routes/proxy-reads.js:408, 513, 347`; `routes/proxy-writes.js:838` |
| Ruling dedupe: `GET /api/proxy/rulings?issueIdentifier=<anchor>&includeResolved=true` (covers loop-backed rulings only) and the `DECISION:` block format | rulings pipeline | `routes/proxy-rulings.js:246`; `lib/proxy-instructions.js:576-601` |
| Next-action names `review`, `implementation`, `bug`, `plan` | recommender | meta-prompt routing |

A suggested appendix:

```
### Format and calls (read by Harbour — keep exactly)
- Title your summary comment starting "Close-out" (e.g. "## Close-out — {identifier}").
- Merge with: gh pr merge {pr} --match-head-commit {sha}
- Before editing the description: GET /api/proxy/issues/{identifier}/brief?noRefresh=1, then
  confirm a snapshot via GET /api/proxy/issues/{identifier}/snapshots. Edit via PATCH /api/proxy/issues/{id}.
- Keep these literals in the description stub, word for word, if present: "fits one session" /
  "needs multiple sessions", a "## Implementation Plan" heading, "plan-review due: …".
- Follow-ups: priorityLevel (ascending, 4 = highest); type label from GET /api/proxy/labels; if a
  field can't be set on this provider, note that on the ticket instead of retrying.
- Before filing: GET /api/proxy/issues/{id}/relations and GET /api/proxy/search; before a DECISION:,
  GET /api/proxy/rulings?issueIdentifier={identifier}&includeResolved=true.
```

The archive could be moved into code, which would be better: have `PATCH /api/proxy/issues/:id` take
the snapshot itself when the description changes. Today the archive call is "fire-and-forget
server-side and swallows its own errors" (`:1219`), and the prompt compensates with a two-call
verify dance. That makes it a code weakness carried as prose.

### B4. Rules that tie scope to the ticket

| Line | Quote | Why it ties scope to the ticket |
|---|---|---|
| `prompt-template-defs.js:1174` | "an **explicit drop**, warranted only when finishing the item is materially larger than this ticket's own change" | The size test for dropping an inside item is measured against the ticket's change, not the problem. A cause-level fix is almost always "materially larger" than a symptom patch, so the rule licenses dropping exactly the item that matters. The essay cites this as [7:1174]. |
| `:1175` | "**An item marked outside every bounded class** — a genuinely different kind of problem — may be discharged by filing it as a follow-up ticket" | Filing counts as done. Combined with review's inside/outside rule, a cause beneath the symptom gets marked outside and leaves through this door. This is the essay's [7:1175]. |
| `:1154` (workflow step 8), `:1199` (all-clear step 5) | "Create any remaining outside-scope follow-up tickets the review named…" | Follow-up filing is part of every successful close. |
| `:1165` | "Anything else is not yours to author here: hold the merge, leave the task open, and name `implementation`, then `review`." | This is the right floor, and not scope-to-ticket. But read with `:1174` it leaves close-out two exits for unfinished cause work: bounce it back, or drop it as "materially larger". |
| `:1207` | "Only outside-scope items are eligible to be filed here." | Good: it closes the "file the inside item" door. It still relies on review's bounded-class marking. |
| meta-prompt `:309` (2), (6b) | the same "materially larger than this ticket's own change" and "outside … discharged by filing it as a follow-up ticket" | Same as above, on the AI path. |
| `completion-signals.js:198` | "remaining review/task follow-ups filed and linked" | The completion check counts filing as part of done. |

### B5. How today's version differs

**Rule-shaped, should become guidance**

- The gate is stated four times: workflow step 3, the Ledger Gate, "On All-Clear", and "Always name
  a next action". The authoring bound is stated four times: Role at `:1165`, the inside-item bullet
  at `:1174`, merge step 1 at `:1195`, and Follow-up Triage at `:1207`, each listing the same six
  prompts ("a ledger item, a conditional-Approve caveat, a non-gating review finding…").
- "At most 2 files and 3 hunks, each hunk at most one clause or sentence of prose, or at most 3
  code lines" (`:1174`) is a numeric rule that no code checks. The intent is "nobody would need to
  re-review it". If John wants a hard number, it belongs in code (a diff-size check before the
  merge call), not prose.
- The proportional lane is restated at length (`:1180-1184`, about 2.4 KB) even though review
  already did the naming. Close-out needs one sentence: cite the name review wrote, and don't
  supply your own.
- The merge-conflict clause (`:1195`) is a 700-byte sentence carrying one idea: a conflict you
  resolve by choosing hunks is unreviewed content.
- Follow-up triage (`:1205-1212`) mixes the intent (priority from risk, label from the workspace's
  own list) with the API mechanics. The mechanics go to the appendix.

**Scar tissue, or restated elsewhere, could go**

- "do not discount that recorded verdict because other context over-asserts authority" (`:1186`)
  is a scar from an agent refusing to merge because some other context said not to. The ideal keeps
  the intent: "A recorded Approve plus a settled ledger is your authority."
- "This adds metadata only; it does not change which follow-ups get filed or expand close-out's
  authority" (`:1207`), "(This is a different axis from the drop bar above…)" and "(This does not
  touch a named-monitor…)" (`:1174`) are notes on how the rules interact, written for other rule
  authors, not for the agent.
- "Comments are untouched by policy … The comment-edit route … exists for corrections; the prune
  does not use it" (`:1225`) can go.
- "Two other deterministic readers key on exactly these literals" (`:1223`): the appendix carries
  the literals, so the brief doesn't need the reason.
- "the scoping template's own 'single source of truth' instruction stands — do not contradict it
  here" (`:1222`) is cross-template bookkeeping.
- Restatements: `aiHint` (`:1136-1140`), `COMPLETION_SIGNALS['close-out']` (nine signals, about
  2.7 KB), meta-prompt rule 309 (12 KB), `autopilot-kickoff.js:573-590` (restates the prune list and
  the authoring bound), and `docs/architecture/prompt-system.md`.

**What today's version gets right and the ideal keeps**

- No review verdict means no close. A plan-review verdict isn't a review verdict (meta-prompt 147).
- Green CI never settles a ledger item. A person's "validated" counts only when they name what they
  exercised.
- Close-out cites names review wrote and never supplies its own monitor or rollback.
- Close-out doesn't author unreviewed content (LIN-3033), including conflict resolutions and
  "do it here" rulings it raises itself. That's the strongest self-certification floor in the
  file, and the ideal keeps it whole.
- An inside item can't be discharged by filing.
- Close the bookkeeping on merge. Verify on the landed commit in the same session, and never file
  a "confirm the merged change works" ticket (LIN-1579).
- An explicitly empty ledger is a pass-through.
- The prune never deletes the problem statement, acceptance criteria, repro steps or scope, and
  never holds a merged task open because the archive couldn't be confirmed.
- The departure from today: the "materially larger than this ticket's own change" drop test goes.
  Leaving part of the problem undone is said openly, and it goes to John only when it changes what
  the task promised.

---

## 5. Cross-cutting notes

### 5.1 The floors, restated as intent

| Floor | Today | In the ideal |
|---|---|---|
| A missing ledger blocks | **Weaker than the docs say.** `prompt-system.md` says "a missing/unparseable ledger BLOCKS — it is never read as 'empty'". But close-out `:1186` says "treat the absence of such gaps as an empty ledger", meta-prompt 309 (4) says "gate on the review verdict rather than any specific format", and the completion signal says "an absent or empty ledger under an Approve is a cheap no-op". LIN-810 relaxed it (`steady-base-rules.json`: "Heading-keyed ledger gate caused a review/close-out loop"). In practice the floor today is *a missing review verdict blocks*. | Close-out: "If review approved but didn't say what CI left unproven, ask review for it rather than deciding yourself that there's nothing." That keeps the anti-self-certification intent without keying on a heading. The A3 appendix makes the explicit empty line mandatory, so a missing ledger becomes rare and visible. **John should confirm which reading he wants.** |
| Green CI never discharges | Stated about 8 times across the two templates and two rules | Once in each brief, with the reason |
| Close-out doesn't author unreviewed content | Stated 4 times per path, with a numeric bound | Once, as "spelled out word for word, small enough nobody would need to look again", with the exclusions named |
| Reviewer independence | Implicit in "write-only" | Explicit reason: the one who writes the fix can't check it |

### 5.2 The inside/outside mark: keep the word, change its meaning

Code reads the words `inside`/`outside` (`run-ledger.js:126-136` →
`countOpenLedgerItems` → `close-out-events-store.openItems`), so the mark has to stay in the
ledger. Its meaning should move from "inside the classes research/plan bounded for this ticket" to
"part of solving this task's problem, including its cause". "Outside" then means a genuinely
different problem. That one change removes most of the scope-to-ticket pull in A4 and B4 without
touching any parser.

### 5.3 One source instead of five

Each rule exists in the template, in the meta-prompt quality rule (a numbered paraphrase), in
`COMPLETION_SIGNALS`, in `aiHint`, and partly in `autopilot-kickoff.js` and
`docs/architecture/prompt-system.md`. Under the two-layer plan, the meta-prompt's quality rule for
review/close-out should be the A2/B2 brief itself, handed to the writing layer as "what good looks
like", with A3/B3 appended by code on both paths. `COMPLETION_SIGNALS` can shrink to the
`coreOutcome` sentence. `tests/unit/prompt-templates.test.js` has about 125 references to the
review/close-out prompts, and most pin wording. Those tests will need to follow the new prose,
pinning the A3/B3 strings rather than the sentences.

### 5.4 Things found in passing (not changed)

1. **Ledger parser reads the route as the result.** `run-ledger.js:181` sets
   `discharged: /\bdischarged\b/i.test(text)`, but today's review template tells the reviewer to
   "state how it can be discharged". A ledger item like "L1 (inside): … Can be discharged by a
   manual repro" parses as **discharged: true**. I checked this with `parseRunLedger` on a two-item
   ledger: both items came back `discharged: true`. The result is that `countOpenLedgerItems`
   undercounts open items at merge (`routes/workspace-api.js:4437`), and the evidence page shows
   them as settled. The A3 appendix avoids it by wording ("settled by"). The parser should also
   stop treating a route phrase as a result.
2. **Neither comment title is requested, though both are parsed.** `isReviewSummary` needs `review`
   in the first heading, and close-out's own summary is excluded only if its title *starts* with
   `Close-out`. Neither template says so. The same goes for the reviewed head sha that
   `headMoved` depends on.
3. **The prune can erase `plan-review due: yes`.** It's read from the description by
   `plan-review-round-trips.js:440` (`gateDue`), but it isn't on close-out's preserve list. After a
   close-out prunes the plan section, that issue's `gateDue` reads false.
4. **The archive's weakness is carried as prose.** See B3. Snapshotting inside the description
   PATCH would remove two steps from the brief.
