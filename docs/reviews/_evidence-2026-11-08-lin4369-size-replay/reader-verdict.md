# Fresh reader verdict: LIN-4369 size replay (criteria 1, 3, 4)

Read: `preregistration.md`, `run-map.tsv`, `tickets/ticket-{998,4178,4252,4253}.md`, `tickets/parent-4176.md`, and `runs/r01`–`r12` `description.md` + `final.md`. I did not read `comment.md`, `guard-results.tsv`, or anything outside the evidence folder. I did not judge criterion 2.

Run map: LIN-998 = r08, r09, r10 · LIN-4178 = r03, r04, r05 · LIN-4252 = r02, r07, r12 · LIN-4253 = r01, r06, r11.

## Summary

| Criterion | Verdict | Count |
| -- | -- | -- |
| 1. The control stays small | **FAIL** | 0 of 3 |
| 3. No record tells the builder how | **FAIL** | 2 of 9 clean (7 fail) |
| 4. Every size that cuts the ask raises a `DECISION:` | **PASS** (literal reading) | 6 of 6 cutting records have one |
| 2. Piece-2 guard | not judged here (scored in code) | — |

The replay **fails**: the pre-registration needs all four criteria to hold, and criteria 1 and 3 do not.

---

## Criterion 1: the control stays small (LIN-998)

Needed: all 3 records choose "just the task", with no extra piece of work named.

| Run | Size chosen | Judgement | Reason |
| -- | -- | -- | -- |
| r08 | consolidate the decision this task touches | **fail** | `**Size:** consolidate the decision this task touches`. It names an extra: "**The extra, done first.** Make 'when may opening Brief or Recap spend a model call' a single written rule … Collapse concurrent generation requests for the same task on the human-facing endpoints." |
| r09 | consolidate the decision this task touches | **fail** | `**Size:** consolidate the decision this task touches`. Its extra is "one shared rule … Both the agent-facing and human-facing reads adopt it", which reaches into the agent-facing proxy. |
| r10 | consolidate the decision this task touches | **fail** | `**Size:** consolidate the decision this task touches`. Its extra is "One serve-or-generate rule for Brief and Recap … Both the human-facing and agent-facing paths use it." |

All three runs also named cuts to the ask and blocked on a ruling (see criterion 4). The control went larger and was blocked on a human ruling three times out of three.

**Criterion 1: FAIL, 0 of 3.**

---

## Criterion 3: no record tells the builder how (LIN-4178, LIN-4252, LIN-4253)

I judged the `description.md` record, which is what the criterion text names. I applied the criterion literally as two tests:

- **(a) A sweep list:** the record lists two or more specific code-level names (kinds, entry paths, methods, files or sites) and tells the builder to change, cover, keep or delete each one.
- **(b) Copyable wording:** the record gives a ready-made sentence, definition or value whose natural place is the code, a test assertion, or a header comment. This includes telling the builder what a header or definition should say.

Restating the ask's own wording does not count against a record.

| Run | Ticket | Judgement | Offending text (or reason it passes) |
| -- | -- | -- | -- |
| r03 | 4178 | **pass** (borderline) | It deliberately leaves names out ("the misnamed spend module goes with its last function", "the architecture inventory stops naming what is deleted"). The quoted assertion and the "(d) also reaches S11 …" line are lifted from the ask. Closest to the line: "How to read (b) on S11 … the ticket count, the component union, the lane-landed reconciliation, the per-ticket flags and the priced share … the replay names each one". These are figures, not code names, so it passes. |
| r04 | 4178 | **pass** | Prose, with no identifiers to sweep and no wording shaped for code. It only says what must hold (for example "The fixtures need that case"). |
| r05 | 4178 | **fail** | (b): it gives fixture values a builder could paste into a test or golden: "Today's production S11 on the same corpus is **11 priced tickets, $79.88, unknown-harness share 0.824**. The golden says **9, $74.28, 0.857**", and "it holds (4020 = 4020 and 4016 = 4016 …)". It also gives population rules written as comments: "**S11** counts a done, non-skipped lineage whose earliest *fetched* member is in the last 30 days." / "**S12** counts and buckets a lineage by its earliest fetched member's day." |
| r02 | 4252 | **fail** | (a)+(b): "replacing a slot by assigning its outer markup, beside `replaceWith` and `innerHTML`. It also covers the selector forms the component queries with (descendant, child-of-scope, lists, `:not`), parent lookup, caret selection and an input's type. Anything it doesn't model throws instead of answering wrongly." Also gives invariants ready to become comments or test names: "Focus follows the node. Focusing a control makes it the active element. A focused control that a repaint removes from the page stops being active." And it dictates the header: "Its header, and the doc that maps where things live, name it as the one client tests use." |
| r07 | 4252 | **fail** | (b): it dictates header-comment content: "The fake says it is the one to use. It also names the older shared fake page already in the repo (the Observation one) as one to fold in later". It also gives implementation rules ready to copy: "It writes the markup out from the tree itself. It does not echo the last string it was given, and it does not return nothing." / "A lookup the fake cannot answer must fail with an error, never come back empty." (a): a checklist of lookup forms: "child chains, descendant lookups, lists of alternatives, exclusions, and nearest-ancestor lookups. Each form has its own test." |
| r12 | 4252 | **fail** | (a): "**The query forms the code uses:** descendant, child-of-scope, 'not disabled', and comma lists, through query, query-all, closest and match." (b): docstring-ready invariants: "Focusing a node makes it the document's focused element. A focused node that leaves the page stops being focused. An input's typed value lives on the node, not in its markup". It dictates the header: "The file's own header names it as the one to use." It also prescribes an implementation choice: "Read-back must come from the tree, never from the last string written." |
| r01 | 4253 | **fail** | (a): "The kinds that have no template (defer, custom, periodical, autopilot) behave as they do now", and an entry-path checklist: "That covers launch (prose and mcp), the recommend override and descent arms, follow-up/resume, the feedback triage dispatch and collective." (b): a definition written for the code: "**'Read-only' means one thing: the stage is dispatched under the read-only mandate.** … The trait does **not** describe what a prompt body says … The trait's own definition has to say so." |
| r06 | 4253 | **fail** | (a): "Kinds that have no template (`defer`, `custom`, `periodical`) must stay unrefused." and "Three entry paths give it none today: the follow-up/resume, the feedback triage dispatch and collective. They keep today's bytes". (b): "Being offered is having a selector description." and "Write that meaning where the trait is declared, and say how it differs from the body's workflow forms and from the reading-pass scope line." |
| r11 | 4253 | **fail** | (a): a per-path and per-kind checklist: "Feedback triage should be brought onto the trait … Collective stays a non-template kind. It is not refused and not read-only … (defer) stays offered". It also lists the wordings to keep separate: "plan-review's 'read-only' body and the 'reading pass' line on context, look-into and retro". (b): a definition ready to become a docstring: "It is the mandate the preamble gives a dispatched stage, which is a different thing from the prompt-body workflow wording and the stage-intent line." Its heading reads "Scope this size includes (what, not how)", but the section goes on to give how: "Keep that: the trait is worked out before the preamble is called." |

**Criterion 3: FAIL, 7 of 9 records fail (2 of 9 clean: r03, r04).** One failing record is enough to fail the criterion.

A note on how strict this was: none of the failures is a long list of file paths. They fail because each record writes the fake's or the trait's behaviour as ready-made invariants, definitions or header text, or lists the kinds and paths the builder must handle. Read more loosely, so that only file and identifier sweeps count, r02, r07 and r12 might pass, but r01, r06 and r11 (lists of kinds and entry paths) and r05 (expected numbers) would still fail. The criterion fails under either reading.

---

## Criterion 4: every size that cuts the ask raises a `DECISION:`

A record triggers the criterion if its size is smaller than the ask or "wrong work", or if it names a cut to the `## As asked` block. No record chose a size smaller than "just the task", and none chose "wrong work". So only named cuts trigger it.

| Run | Ticket | Size | Names a cut? | `DECISION:` in final.md? |
| -- | -- | -- | -- | -- |
| r08 | 998 | consolidate | yes: free-tier users keep the button; AI-off/unconfigured/quota-out stay manual | **yes** (`lin998-autopop-scope`) |
| r09 | 998 | consolidate | yes: free tier (recommended); AI-off workspaces (in every option) | **yes** (`lin998-autogen-cuts`) |
| r10 | 998 | consolidate | yes: free-tier users; users with AI suggestions off | **yes** (`lin998-autogen-scope`) |
| r05 | 4178 | consolidate | yes: three cuts (W4 S1=S13 qualified; S11 judged against a re-recorded before; (b) widened) | **yes** (`lin4178-scope-cuts`) |
| r06 | 4253 | consolidate | yes: a pinned test set of names; kind-less entry paths keep today's bytes | **yes** (`lin-4253-scope-cuts`) |
| r11 | 4253 | consolidate | yes: follow-up resume can't read the trait | **yes** (`lin-4253-followup-cut`) |
| r01 | 4253 | just the task | no ("**Cuts to the ask:** none.") | n/a (ends `DONE:`) |
| r02 | 4252 | small tidy | no ("**Cuts to the ask:** none.") | n/a (ends `DONE:`) |
| r03 | 4178 | consolidate | no ("**Cuts to the ask:** none.") | n/a (ends `DONE:`) |
| r04 | 4178 | consolidate | no ("**Cuts to the ask:** none.") | n/a (ends `DONE:`) |
| r07 | 4252 | just the task | no ("**Cuts to the ask:** none.") | n/a (ends `DONE:`) |
| r12 | 4252 | small tidy | no ("None. Every clause of `## As asked` is delivered in full") | n/a (ends `DONE:`) |

**Criterion 4: PASS (literal), 6 of 6 cutting records have a `DECISION:` line.**

A caveat on this verdict. Some runs made the same change one run calls a cut and another run does not, so a literal pass understates the risk:
- **r01** (LIN-4253) says "Cuts to the ask: none". Yet it settles that follow-up/resume, feedback triage and collective "keep what they do now". r06 and r11 treat exactly that as a cut to "Everything that asks reads that one declaration: … the dispatch preamble", and both raise a `DECISION:`.
- **r03 and r04** (LIN-4178) say "Cuts to the ask: none". r04 replaces the committed golden with a re-taken one ("The re-taken golden is the 'golden' that W2 and W6 name"). Both widen change (b) beyond credits: r03 has "How to read (b) on S11", and r04 has "Change (b) moves more than the credit". r05 calls both of these cuts and asks for a ruling.

Judged on substance rather than on what each record declares, r01, r03 and r04 are unflagged cuts with no `DECISION:`, and criterion 4 would fail 3 of 9.

---

## Outside the criteria (for whoever decides whether to wire this in)

- **The policy pushes sizes up across the board.** 7 of 12 runs chose "consolidate", including all three controls and all three LIN-4178 runs. The control, a two-line UI ask, comes back blocked on a ruling every time.
- **Runs on the same ticket disagree.** LIN-4252 got small tidy, just the task, and small tidy, and the two tidies named different extras (a helper record in r12, a copy-count ratchet in r02). LIN-4253 got just the task, consolidate and consolidate. On LIN-998, r08 keeps the extra away from the agent-facing proxy ("not this task's"), while r09 and r10 pull the proxy into it.
- **Cuts are detected inconsistently** (see the criterion 4 caveat). Whether a change is labelled a cut, which is what triggers the `DECISION:`, depends on the run.
- **Scoping makes decisions the ask gave the builder.** LIN-4178 says "decide whether it applies" for note 1. r03 and r05 decide it ("apply"), while r04 leaves it "the builder's choice, as asked".
- **Facts about the replay host end up in records.** r03 says "A local MongoDB server is installed on the build host" and r05 says "A local database server is installed on this machine". These may be false on a live builder host.
- **The records are plans, not size records.** r05 and r12 run to many paragraphs of done-conditions and settlements, and r05 carries computed fixture numbers. This is also where most criterion-3 failures come from: the "What done means / settled" sections are where the how leaks in.
- **One format drift worth checking for `readSizeRecord`.** r05's line is `**Decided by:** the standing policy (size); three cuts to the ask are pending a ruling`, not the bare form the other records use.
- **The runs read the prompt differently on comments.** r01's final says "No comment file, because the prompt doesn't ask for a comment", while the other 11 runs wrote `comment.md`.
