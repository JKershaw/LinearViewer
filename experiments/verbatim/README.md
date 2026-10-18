# Verbatim share (rebuilt vs edited)

`verbatim.mjs` measured twelve Harbour rebuild tickets and wrote `verbatim.md`; the ticket list
and the default repo path are written into it.

A generic version, `scripts/code-shape/verbatim.mjs <repo> <oldCommit> <newCommit>`, takes any two
commits, scopes files by regex, and adds a per-region table (area from `--areas`, else top-level
directory) in place of the ticket list. For the LIN-3556 row of `verbatim.md` it gives the same
numbers (246, 259, 202, 82.1%, run 121). See `scripts/code-shape/README.md`.
