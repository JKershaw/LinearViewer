I've sized LIN-4178 as **consolidate the decision this task touches**. That was decided by the standing size policy, and nothing in the ask is cut.

**Why it binds.** The shared cost read (`lib/cost-read.js`) only prices rows that carry their full `feedback`. Wiring the three surfaces in as asked would make all of them show nothing priced in production, while the replay test stays green:
- **Public and workspace KPI pages:** in production they get projected rows (`usageEntry`, `terminalEntry`, no `feedback`), from the aggregation in `lib/kpi-stats.js`. The replay never sees this because its fake collection has no `aggregate`.
- **Run page:** real loop records have no `status` or `rootItemId`, so none of them count as lineage members. The replay's hand-built loops hide this too.

LIN-4176's plan said the read would handle both row shapes. Piece 1 (LIN-4177) did not deliver that.

**The extra work, done first:** the read gives a lineage the same figure whatever shape its rows arrive in, and the replay runs on the shapes production actually sends. This is shown before any surface is rewired. It stops and says why if the goldens don't hold on those shapes at the starting commit.

**Open questions:**
- Moving a straddler to its founder's issue may shift the public coverage shares, not just its credits. LIN-4176's change list doesn't name that.
- Timing the founder lookup on a seeded store needs a `mongod`, which the session may not have.

The size record, comment and status change ("In Progress") are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a15/output/`. The code clone is unchanged.

DONE: LIN-4178 sized as "consolidate the decision this task touches" (standing policy, no cuts); the read must price production row shapes, proven by the replay, before S11/S12/S13 move onto it.
