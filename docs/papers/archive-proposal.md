---
version: 3
date: 2026-09-12
authors: [Claude, John Kershaw]
model: claude-opus-5, effort high, harness null in lineage (dispatcher default claude-code)
grounded_at: 46c155cf
cites: [docs/reviews/@46c155cf, lib/periodical-report-gate.js@46c155cf:6-14, docs/north-star.md@46c155cf:1-19, docs/papers/archive-check.md]
---

# A papers archive for Harbour

Harbour already writes papers. The reviews directory holds 42 of them: grounded at a commit,
citing earlier editions, correcting themselves in place, saying what they could not measure.
What is missing is small. Nothing identifies a paper except its path, nothing lists them, and
nothing says which edition of a document is current.

## Proposal

Start a `docs/papers/` folder. A paper is a markdown file with a short header like the one
above: version, date, authors, the model that wrote it, the commit it was grounded at, and
what it cites. That is the whole contract for now.

`model` is the model, harness and effort the run's dispatch lineage reports
(`GET /api/proxy/issues/{id}/cost`); where it reports null, name the dispatcher default. A
paper written by hand says so. `authors` is who is responsible, a different question.

Every `cites` entry carries a locator: `path@sha:line`; `LIN-nnn` or a PR number with the
date of the comment meant; the bare path for a file added in the same change. A citation a
reader cannot land on is not one.

Three rules.

1. The files are the record. Any index, graph or number about the archive is derived from the
   files at HEAD, never stored beside them. Harbour has already been bitten twice by a stored
   reading drifting from the document it described, and the fix both times was to derive from
   HEAD.
2. A paper is checked by a second paper, not by its author. The next paper in this folder
   should re-read this one and say what it got wrong.
3. Every paper ends with a Next section, and that section adds at least one line to
   `proposals.md` in the same PR. A paper that proposes nothing ends the loop instead of
   feeding it.

## How it grows

Papers are written the way reviews are: a task on the stack, picked up by a session, landed as
a PR. Bigger ideas arrive as later papers. A catalogue, a search tool, versioning and
supersession rules, a concept index, new prompt kinds, a separate repository, a Harbour surface
over the proxy. Each is adopted when a paper argues for it and a second paper agrees, not
before.

Version 1 of this paper is in git history and carries the full evidence, queries and
limitations. It was too much for the idea. Cutting it is the first revision the archive has.

Version 3 adds the model field, the locators and rule 3, nothing else. Each is here because
`archive-check.md` found four papers doing without it: the `authors` line was queried at the
second paper and unfixed at the fourth, PR #1454's checker wrote out the locators the paper
omitted, and three papers landed proposing nothing. Remove any of the
three if that evidence later looks thin.

## Next

A paper that checks this version.
