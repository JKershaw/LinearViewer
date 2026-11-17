# Walk 2 material

Read 17 Nov through Harbour's read-only workspace proxy (harbour.cat) and GitHub. Fixed: every step of walk 2 works from these copies. Model names are reduced to their tier (`<model:opus>` etc.) because this session does not push model identifiers.

- `LIN-4455.json` (child) and `LIN-4447.json` (parent); `LIN-4472.json` (child) and `LIN-4463.json` (parent): tickets as the proxy returns them, description and comments with times. The parents run beyond the children; only what touches the child is in scope.
- `<child>-cost.json`: the child's cost record: each stage session with its dispatch time.
- `<child>-snapshots.json`: the child ticket as Harbour captured it, about 30 seconds after each stage's dispatch, so what each stage saw on the ticket at its start, including the description before close-out pruned it.
- `<id>-rulings.json`: decisions raised to the operator on that issue, resolved ones included (`includeResolved=true`).
- `PR-2427.md` (LIN-4455) and `PR-2436.md` (LIN-4472): each PR's title and body, verbatim.

LIN-4450's snapshots and rulings (walk 2's control task) are in `walks/1/material/`.
