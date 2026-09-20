---
title: What should an agent leave behind?
version: 1
date: 2026-09-20
authors: [Codex]
model: "Codex, ChatGPT Work interactive session; exact model identifier and effort not exposed. Evidence audits used separate Codex subagents. No Harbour dispatch lineage for authorship. Tracked as LIN-2961."
grounded_at: "LinearViewer 4b28d25c234b011ccd7c6fa795645e13598623e6; cross-repository snapshots and historical run revisions listed in what-should-an-agent-leave-behind-evidence.md"
cites:
  - "what-should-an-agent-leave-behind-evidence.md (evidence register, this change)"
  - "docs/papers/harbour/review-consumption.md@4b28d25c234b011ccd7c6fa795645e13598623e6"
  - "docs/reviews/context-efficiency-ceiling-review-2026-08-15.md@4b28d25c234b011ccd7c6fa795645e13598623e6"
  - "docs/papers/harbour/ticket-record-and-quality.md@4b28d25c234b011ccd7c6fa795645e13598623e6"
  - "LIN-2689 (description read 2026-09-20)"
---

# What should an agent leave behind?

The evidence supports prioritising a handoff that lets the next worker find the relevant source, understand what remains unresolved, and distinguish a finding from its supporting evidence. It does not yet establish a generally optimal format or a net saving from maintaining a wiki. Across CodeWiki, Pith, TAG, Tangle and Harbour, producing a persistent artifact, having it consumed, and improving subsequent work are separate achievements. The useful next test is whether a deliberately retained artifact reduces the total cost of later work at comparable quality.

## Findings

**Reuse, continuity and decomposition answer different questions.** CodeWiki and Pith retain knowledge across tasks; TAG and tag-two retain state across invocations; Tangle restructures investigation within a task. A graph helping an investigation does not establish that maintaining its findings pays for future tasks. A failed handoff does not establish that repository indexing is ineffective. The projects form a research programme around where understanding should persist, but their scores cannot be pooled into one result. [Evidence and scope](what-should-an-agent-leave-behind-evidence.md#scope-and-selection).

**Harbour already shows that a downstream consumer uses some parts of a record much more than others.** Its review-consumption study marks 181 of 187 ledger units as consumed, against 109 of 429 method/check-narration units. We reproduced these sums from the committed annotations and inspected two cited review/close-out pairs. The consumer is another agent following a template that explicitly requires the ledger. These are visible-use annotations, not a measure of attention, correct resolution, or the effect of deleting the rest. The result supports designing retained material around an identifiable consumer; it does not prove unreferenced prose is worthless. [H1](what-should-an-agent-leave-behind-evidence.md#h1-review-consumption).

**A small pointer can preserve useful work already done.** Harbour's context-efficiency study reports a same-model comparison on one implementation task: with a file/function pointer, three runs cost a median $0.357 and 18 turns; without it, one run cost $0.783 and 51 turns. All passed the same 43-check behaviour verifier. The pointer cost approximately 93 prompt tokens. This is a concrete positive result for retaining a search result, with substantial limits: hindsight supplied the pointer, its acquisition cost was excluded, only one no-pointer run was made, and the verifier did not assess the complete original deliverable. Other tasks in that study did not reproduce the easy success. Automatic construction and repeated-task economics remain open. [H2](what-should-an-agent-leave-behind-evidence.md#h2-pointer-handoff).

**More retained material and more dependable behaviour did not move together reliably.** CodeWiki's December assessment recorded page growth alongside lower answer scores; Pith's January answer benchmark favoured exploration, but did not measure a caller completing tasks with Pith available. TAG-two preserved records while still recording repeated checks and unsupported conclusions. These observations weaken page count and record existence as success measures. They do not establish that documentation or memory caused the failures: parsing, scoring, retrieval and worker judgement remain alternative explanations. [C1–C3](what-should-an-agent-leave-behind-evidence.md#cross-project-evidence).

**Tangle shows conditional gains, including on the API reference models.** Selected MangoDB rows illustrate the range; the appendix includes every archived tool-control comparison in the inspected progress table.

| Model, 42 possible topics | Graph topics / tokens | Conventional tool-control topics / tokens |
|---|---:|---:|
| Qwen3 1.7B | 14 / ~40k | 6 / ~37k |
| Qwen3 8B | 12 / ~53k | 15 / ~15k |
| DeepSeek V3.2 | 13 / ~67k | 8 / ~76k |
| Claude Haiku 4.5 | 25 / ~128k | 20 / ~48k |

The favourable DeepSeek comparison and unfavourable 8B comparison both belong in the account. Coverage is not semantic correctness or completed work, and tokens are not a cross-model price measure. The configurations change selection, sequencing, extraction and stopping as well as graph structure; archived comparisons have one repetition per case. Browser-agent separately shows that deterministic sequencing improved a narrow tool-dispatch endpoint while retaining a shared transcript. Neither result isolates a general advantage from dividing context across a graph. [C5–C7](what-should-an-agent-leave-behind-evidence.md#cross-project-evidence).

**The proposed retention rule is a hypothesis to test.** Preserve the result of expensive discovery with its scope, source revision and evidence; identify the next action or consumer; retain unresolved decisions; and state what would require rechecking. The appropriate artifact might be a pointer, an explanation, a test or a task record. Evidence for retaining it should include later task outcomes and the cost of building, finding, verifying and refreshing it. Human supervision belongs in that accounting, but a reduction in human effort has not been demonstrated by the reviewed comparisons. Harbour's observational record-size study also leaves task difficulty and workflow selection as confounders. [H3](what-should-an-agent-leave-behind-evidence.md#h3-record-size-and-outcomes).

## Method

This is a source-based retrospective, not a new model experiment. A survey of 39 public repositories produced 26 relevance notes. We selected five experiment-bearing projects—CodeWiki, Pith, tag-two, Tangle and Browser-agent—and the directly relevant Harbour studies for the question they measure, retaining counterexamples within those sources. The [evidence register](what-should-an-agent-leave-behind-evidence.md) records revisions, denominators, checks and missing material. We recomputed available numerical aggregates, read selected live tracker records through Harbour's proxy, and distinguished those checks from rerunning models or independently relabelling outcomes.

A bounded prior-work review located different precedents: [MemGPT](https://arxiv.org/html/2310.08560v2) manages external memory, [Reflexion](https://arxiv.org/html/2303.11366v4) retains feedback-derived lessons, [Voyager](https://arxiv.org/html/2305.16291v2) accumulates executable skills, and [Graph of Thoughts](https://arxiv.org/html/2308.09687v4) executes structured reasoning operations. Our implementations, tasks, models and evaluators differ. These records neither replicate nor refute those studies. A [separate checking paper](what-should-an-agent-leave-behind-check.md) audits this synthesis.

## Limits

This is a convenience sample of one developer's projects and one operating environment, selected retrospectively. Internal answer rubrics, topic coverage, command dispatch and accepted software behaviour are different endpoints. Pith's judge treats its control answer as ground truth. Several Tangle runs record uncommitted changes; the archived results are pinned, but their full executable state is not recoverable from the reported commit alone. Some Harbour raw transcripts and probe artifacts remain on another machine. Recomputing annotations verifies arithmetic, not the original labels. No result here establishes long-term wiki-maintenance economics, general graph superiority, or lower human supervision. Preserving failed experiments makes these limits visible; it does not remove them.

## Next

Use the existing **LIN-2689** pointer-index proposal to compare the same caller with ordinary source tools, with a deterministic index, and with that index plus generated explanations. Use unseen tasks and independently checked outcomes, allowing all arms current source access. Count construction, retrieval, caller inference, verification/rework and maintenance, including failed runs; measure human intervention separately. Freeze tasks before building the retained material so hindsight does not supply the answer. Test change over time only after a static benefit appears. The decision is which artifact earns its upkeep, including the possibility that an index suffices or fresh exploration is cheaper.
