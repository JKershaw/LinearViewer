## Reasoning
**Assessment:**
- Preparation: ✓ Complete — three comments document verification, plan, and a completed breakdown into 6 subtasks (S0–S5) with `blocked-by` relations encoded.
- Blockers: ✓ None — the original dependency (LIN-176) is confirmed resolved; this node is a healthy container.
- Ready: ✓ Yes — but the actionable work lives in the children, not at this node.

**Signal Status:** `plan` signals met (plan documented with session-fit answer "needs multiple sessions"). `breakdown` signals met (6 subtasks created, arrows copied 1:1 into `blocked-by`). This node is decomposed and healthy — its real next action is in a child.

This is a node task with 6 subtasks (2 done, 4 remaining). It is NOT undecomposed (breakdown is complete), NOT all-complete, and NOT vague/mis-scoped. The honest next action lives in a child. The suggested next is LIN-334 (S2), but per the plan's dependency arrows S2 is **blocked-by S1 (LIN-333)**, which is not yet done — so LIN-334 is not actionable. The two parallelizable roots S0 (LIN-332) and S1 (LIN-333) have no `blocked-by` relations and are immediately actionable. Per the priority rule (first non-blocked todo), descend into a root rather than the blocked LIN-334. LIN-332 (S0) is the highest-priority root — it gates S3/S4/S5 and carries the core design decision.

→ **defer**
**Next:** The recommendation re-enters on LIN-332 (S0), where the terminal actionable prompt (implement) will be generated; S1/LIN-333 can proceed in parallel.
**DeferTo:** LIN-332

## Prompt