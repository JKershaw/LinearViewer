# What this stage really wrote

## Comment on LIN-4463 (the parent) at 17:32:59

### Engineering call: extract the served duration / relative-time leaf first (`lin4472-served-leaf`)

**Settled by autopilot, not escalated.** Scoping asked whether LIN-4472 may extract one small served lib leaf for duration and relative-time wording, given its Session-fit line says "no serving change".

**Decision: yes, extract it first.** The ask on LIN-4463 says shared logic is "imported, not restated" and that "each converted view drops its copies"; the task page restates two copies, so leaving them would contradict the ask. The serving path (`/lib/`, the `SHARED_MODULES` allow-list and its checks) already exists from LIN-4471, so this adds one allow-listed leaf, not a new mechanism. No view is retired, no product, money or authority question is involved, and the size record stays "Cuts: none". The Session-fit phrase predates LIN-4471 landing and is superseded by this note.

**If wrong:** the leaf is one file plus one allow-list entry and is easy to inline back.

