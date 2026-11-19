# API review: how intuitive the record calls are for agents

*19 Nov. A fresh read-only reviewer read the agents' own step notes from walks 7 and 8 (`notes.md`, `queries.json` per step), the models they were shown, and the round 9 model (not walked). Its counts are [checked] from those files; I re-checked two claims myself: round 9 refuses `--into` on any end but handed-on and superseded (`walks/9/model/layer.mjs:139`), and no kind's field shares a name with a link type (`walks/9/model/kinds.json`) [checked]. Below: what it found, what I took, and the one proposal I didn't.*

## What it found

Almost all the friction was the write body's shape.
1. **Links beside fields: 19 refusals, one in each of 19 steps.** Fields go flat but links go nested, so agents wrote links flat too; walk 8's usage example showed no `links`, walk 7's did and had none of these. Four were `about` on `add run`, which Harbour does itself. Every agent recovered on the next try, 8 of them by re-sending without links and calling `link`.
2. **Pinning versions:** 11 `get change-*` calls in 10 steps just to learn the version to pin in `on`; one re-pin after a readdress bumped the version.
3. **Ending a record already ended:** 2 dead ends.
4. **Ended records left out of the brief:** 1 case, partly a replay timing artifact, solved by one `find`.
5. **Plans have no "implemented" end; a verdict's `to` can't be discharged:** both harmless. `kept` and `stands` are standing states, not open ones, and the task's `done` says the plan was carried out.
6. **Round 9 is stricter than walk 8** in ways walk 8's agents relied on: `on` must be `id@v`, `--into` is refused on ends like answered and done (walk 8 accepted 9 of 121 ends that way), a single id where a list is expected is refused.
7. **CLI-only troubles** (shell quoting, ticket-to-task lookup) go away over HTTP with ticket-id resolution.

What works and stays: `to` checked with the alternatives named (no `to` refusals in walks 7–8, against 23 in walk 5); `judgement`; fields flat; specific refusals; a separate `link` call; `find --text` (195 searches, used to link rather than restate); part 5's counts; the stale flag; free-text fields absorbing what has no field.

## Taken

Into the routes (integration §2), as input encoding; the store still holds what §3 says:
1. **Links accepted flat beside fields,** or under `links`; a single id or a list.
2. **`on` accepts a bare id,** pinned to the current version (a change's head sha as §4 says).
3. **Ending a record already in that end returns it unchanged;** any other refusal says who ended it, when and into what.
4. **A refusal names every problem at once,** each with what would work.
5. Readdress bumping the version, ended records out of the brief, and no plan end: left as they are.

Into the layer page (§3.1, §3.3), two clarifications:
6. **`into` may name the record that took over on any end;** it is required only on handed-on and superseded.
7. **Links only add:** a revise that names links adds them, as `link` does.

## Not taken

- **`run` taken from the token by default.** simple-dispatcher keeps a held session on its first token, while a signalled follow-up is a new run carrying its own id (§2; `sd:harbour-token-mcp-server.js:124-140`, `sd:dispatcher.js:371`). A token default would write a follow-up's records under the first run, silently. `run` stays explicit, and a write without it is refused with the run id to send, which the preamble gives.
