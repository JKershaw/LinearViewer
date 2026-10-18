# Census (consolidation round 1)

`census.mjs` is the one-off script that produced `census-2a07f3ea.json` and `census-HEAD.json`
(Harbour's scope and area map are written into it). `diff.mjs` compares two runs; `validate.mjs`
and `probe-residue.mjs` are specific to this round. `report.md` has the thresholds and their reasons.

A generic version, `scripts/code-shape/census.mjs` (with `census-diff.mjs`), takes the scope as
`--include` / `--exclude` regexes and the area map as `--areas <path>`, and reads one commit from
the git object store. Its output equals `census-2a07f3ea.json` for the same commit and flags (the
one-off `repo` field aside; `--redact` as for the published file). See `scripts/code-shape/README.md`.
`validate.mjs` stays here because it is Harbour-specific.
