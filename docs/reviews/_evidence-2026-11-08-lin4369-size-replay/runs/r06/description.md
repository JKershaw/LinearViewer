## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**The chosen size.** Consolidate. First settle what "read-only" means, as one written meaning carried by the trait the dispatch mandate reads. Then declare both traits once, on the template, so that nothing keeps a second list. Every rendered prompt stays byte-identical, as asked.

**Why.** Checked at `29f14bf6e`, which is HEAD. Nothing has landed on these paths since the ticket and both Surveys were written. What the ticket says about the code holds. Its goal is only half clear:

- **"Offered" is already declared once.** The templates with no selector description (no `route`) are exactly `retro` and the two Surveys, which is what the hand-kept list holds, in the same order. This half is a deletion. Being offered is having a selector description. A separate "offered" flag would just be a second copy, and one that disagreed with it would render a broken option into the selector. Kinds that have no template (`defer`, `custom`, `periodical`) must stay unrefused.
- **"Read-only" has no single meaning, and that is what this ticket is really aimed at.** The second list doesn't gate "read-only" in general. It gates Survey wording ("a read-only forecast… your only write is the one comment on the surveyed ticket"). The repo says read-only in four other, different ways: the reading-pass scope line (context, look-into, retro, both Surveys), the comment-only workflow form (context, plan-review, review, retrospective-audit; review approves PRs), the inform-only form (look-into, retro), and the grounding table's comment. A plain read-only flag would be a fifth meaning. LIN-4251 is about to set it on four stages, including triage, a filing stage that changes tracker state. It would then be choosing between five meanings. The tidy pays only if the trait has one meaning before LIN-4251 builds on it. Both Surveys reached this independently. Under the standing policy (err larger when the look shows it pays) the move is to consolidate, not just do the task.

**Sizes weighed.**
- *Just the task:* delete both lists, add a read-only flag on the two Surveys. Same bytes, but a fifth meaning of read-only that LIN-4251 inherits unsettled.
- *A small tidy:* the same, plus correcting the stale docstrings that call the list the source. Cleaner, but still leaves the meaning open.
- *Consolidate the decision this task touches (chosen):* read-only gets one written meaning on the trait, and every other place that says read-only either reads the trait or is named for what it actually says. LIN-4251 then has one switch with one meaning.
- *Rebuild the area:* fold all the per-kind tables (leads, scope lines, grounding, completion signals, labels, buckets, jobs) into the template. The ticket rules this out ("Not this ticket"). It is a report item, not work.
- *Wrong work:* no. The duplication is real, and LIN-4251 is waiting on it.

**The extra, done first.** Settle what read-only means: what a read-only stage may and may not change, and that the dispatch mandate is what reads it. Write that meaning where the trait is declared, and say how it differs from the body's workflow forms and from the reading-pass scope line. Each of those other places then either reads the trait or is plainly a different thing. *It may stop* once read-only has one written meaning and the other places are named as different things. It doesn't need to merge them when merging would change a prompt byte. Today the reading-pass stages are not dispatched read-only, so they can't share the trait without a behaviour change, and that change is LIN-4251's.

**What done means.**
- Both traits are declared on every template, and a template that doesn't declare one fails a test. Hand-only is declared explicitly, not just left out.
- No code list of stage names remains for either trait. The selector, the router's refusal, the "Another step" list and the dispatch preamble all read the template.
- Before and after, every kind's rendered prompt, with its dispatch preamble, is byte-identical in prose and mcp mode, on every entry path, including a Survey follow-up. The router's byte-pinned fixtures are unchanged. No existing test covers every kind on every path, so a capture taken before the change is the proof.
- The report says where each trait lives, who reads it, what was deleted, and what folding the remaining per-kind tables would take.

**Cuts to the ask (pending one ruling).**
1. "No hand-kept list of stage names remains for 'offered' or 'read-only'" and "the copied literals in tests read the traits": the tests keep **one** pinned expected set of the read-only (and hand-only) stages. Without it, a test that loops over the derived set goes empty when a Survey loses its trait, and stays green. The pin is an expectation the code never reads. The literals copied into the three LIN-4248 test files are removed.
2. "Everything that asks reads that one declaration: … the dispatch preamble": the preamble reads the trait wherever it is given a kind. Three entry paths give it none today: the follow-up/resume, the feedback triage dispatch and collective. They keep today's bytes, because the ask also requires byte-identical prompts on every entry path. So a Survey follow-up still gets the reversible-work block, as it does now.

**Open questions.**
- For LIN-4251, not this ticket: triage mostly enters by the feedback route, which gives the preamble no kind. Making triage read-only there needs that path to carry its kind. Whether triage is read-only at all under the meaning settled here is LIN-4251's call to make.

**Who decided.** The size: the standing policy (err larger, set 2026-11-07). The two cuts: pending a ruling.
