---
version: 2
date: 2026-09-11
authors: [Claude, John Kershaw]
grounded_at: 5b9664c
cites: [docs/reviews/, lib/periodical-report-gate.js, docs/north-star.md]
---

# A papers archive for Harbour

Harbour already writes papers. The reviews directory holds 42 of them: grounded at a commit,
citing earlier editions, correcting themselves in place, saying what they could not measure.
What is missing is small. Nothing identifies a paper except its path, nothing lists them, and
nothing says which edition of a document is current.

## Proposal

Start a `docs/papers/` folder. A paper is a markdown file with a short header like the one
above: version, date, authors, the commit it was grounded at, and what it cites. That is the
whole contract for now.

Two rules.

1. The files are the record. Any index, graph or number about the archive is derived from the
   files at HEAD, never stored beside them. Harbour has already been bitten twice by a stored
   reading drifting from the document it described, and the fix both times was to derive from
   HEAD.
2. A paper is checked by a second paper, not by its author. The next paper in this folder
   should re-read this one and say what it got wrong.

## How it grows

Papers are written the way reviews are: a task on the stack, picked up by a session, landed as
a PR. Bigger ideas arrive as later papers. A catalogue, a search tool, versioning and
supersession rules, a concept index, new prompt kinds, a separate repository, a Harbour surface
over the proxy. Each is adopted when a paper argues for it and a second paper agrees, not
before.

Version 1 of this paper is in git history and carries the full evidence, queries and
limitations. It was too much for the idea. Cutting it is the first revision the archive has.

## Next

A second paper that checks this one, and moves one existing review into this folder to see
what the header cannot hold.
