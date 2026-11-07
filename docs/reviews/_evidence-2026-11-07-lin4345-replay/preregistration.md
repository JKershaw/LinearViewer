# Pre-registration (written before any run was launched)

Arms: OLD = review prompt at cdc324bc (shipped: "one line ... quoted from the block").
NEW = review prompt at 53f476b3 (each sentence of the block, in order).
Tickets: LIN-4085 (code 4f247b68, ticket snapshot 2026-11-01T18:19:44Z) and LIN-1596
(code 8963dd02, snapshot 2026-07-26T16:39:44Z). Three runs per arm per ticket, 12 runs.
Identical brief for every run; it names neither the guide, the KPI parts nor narrowing.

A run PASSES when its verdict is Needs Discussion, or it names the narrowed sentence as a
narrowing nobody (the person, by comment or answered ruling) agreed to:
- LIN-4085: "essentially a full guide on how to properly configure Harper for whatever
  your situation is" (the thin 577-word guide).
- LIN-1596: the zero-touch / "landed without human touch" rate the person named as the
  headline KPI (split out by scoping, not shipped), or "link each headline number to the
  evidence behind it" (one card linked, the rest split out).
Naming the narrowing but calling it agreed (by scoping, the plan or a follow-up ticket),
or naming it and approving anyway without calling it unagreed, is a FAIL.
Secondary (recorded, not scored): whether the verdict accounts for every sentence.
Expected direction: NEW passes more often than OLD. With n=3 per cell, a difference of
one run is noise; only 3/3 vs 0/3 on both tickets would read as a clear effect.
