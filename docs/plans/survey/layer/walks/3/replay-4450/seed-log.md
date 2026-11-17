# Seed log: replay-4450

The store before 2026-11-13T13:44:54Z. `seed.sh` was run once from empty: `check` reports no problems and nothing stale, and the last write is at 13:44:23.511Z.

**Ids:** parent LIN-4445 `task-53`. LIN-4450 `task-60`, piece `plan-54`. LIN-4451 `task-61` / `plan-55`. LIN-4452 `task-62` / `plan-56`.

## Written

- **Areas** (Harbour, at the `4b5001ddf` commit time): `providers` `area-1` (no note), `llm-and-prompts` `area-2` (17 lessons, 26 Waiting findings), `other-features` `area-46` (1 lesson, 5 findings).
  - Paths come from `areas.json`. Exact files are kept whole. `prompt-*`, `openrouter*`, `recommend*`, `brief*`, `recap*` and `model-routing*` became prefixes.
  - `openrouter` also catches the auth area's key resolver. `graph-features` was dropped because task-model matches it first.
  - Other features is `lib/` (the registry's `^lib/`). With no first-match rule in the layer, it matches every `lib/` task. LIN-4450 touches the homeless `lib/as-asked-seal.js`.
- **Lessons:** paths are the paths each one cites. Three cite none and take their area's paths.
- **Parent** (John via driving-session, at `createdAt`): `asked` is byte-exact (checked). Its paths are the union of its pieces' paths.
- **Pieces** (design, 13:31:05–07): plan Sessions 1–3, verbatim.
- **Plan review** (13:40:55): each piece's v2 appends its assigned review notes (2/3/6, 4/5, 1). One verdict per piece: `approve`, `on` v2.
- **Breakdown:** the children (LIN-4450 at 13:43:57.706Z; the 4451 and 4452 times are guessed). One decision per child: in the child, `about` its piece, `on` its verdict.

## Refusals

`plan-review` revising each piece: `{"rule":"6","msg":"plan-review may not revise plan-54"}`, and the same for 55 and 56. They were written instead `--by Harbour --via plan-review`.

## Not placed

- The done-when and paths of LIN-4451 and LIN-4452 come from the parent's plan; their tickets were not read.
- Not written, because not asked for: the Size record, the Surveys, the Design choice, the runs.
