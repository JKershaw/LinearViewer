# Step 4: autopilot (LIN-4472, task-28)

## What I tried
1. `find --to John --state open --by autopilot` gave exit 1: `{"error": "queries need --by <declared stage or person>"}`
2. `show --task task-28 --by autopilot` gave exit 1, with the same error.
3. `add decision` (yes, extract the served leaf first, with the real reasoning), `--by autopilot --task task-28 --at 2026-11-13T17:32:59Z`, gave exit 2:
   - `rule 5: decision-97: by autopilot is not a declared stage or person`
   - `rule 5: decision-97: link answers question-UNKNOWN does not resolve`

The second refusal comes from the first: the refused queries never gave me the question's id, so I passed a placeholder. I did not retry as another actor.

## What the record says now
Nothing changed. The store is byte-identical to before (not a retro store, so nothing was logged). The question to John is still open, with no decision linked. In the real history it was settled at 17:32:59.

## What the layer would need
- An identity for the autopilot: a declared actor that can drive stages, not do their work.
- Read access, so it can see what is open before it acts.
- A stated authority to settle questions addressed to John, for example a delegation from John limited to engineering calls (no product, money or authority questions). The decision would record that authority, so a reader can tell it was not settled by John.
