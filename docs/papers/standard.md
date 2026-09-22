# How a paper is written

The archive holds two kinds of document.

A **paper** answers one question with evidence. It is the default, and most of the archive
is papers.

An **essay** argues a position from sources. Its contribution is the argument and what the
argument rests on, not a measurement: it is the right shape when the useful thing to say is
*how to think about* something — a distinction, a mechanism borrowed from another field, a
reading of what several sources do and do not support together. An essay that could have
been a paper should have been one. Evidence Harbour can go and gather belongs in a paper.

Either can be about anything and take whatever shape the subject needs. What every document
shares is the header and a declared kind, so that documents can cite each other and a reader
always knows where to look. A document with no `kind:` line is a paper.

## Header

A paper:

```
---
title: The question, as a question
kind: paper
version: 1
date: 2026-09-12
authors: [who is responsible for it]
model: model, harness and effort as the dispatch lineage reports them; "by hand" if a person wrote it
grounded_at: the commit the evidence was read at
cites: [path@sha:line, LIN-nnn (comment date), PR #n (date)]
---
```

An essay:

```
---
title: The essay's title
kind: essay
argument: The position, in one sentence
version: 1
date: 2026-09-21
authors: [who is responsible for it]
model: model, harness and effort as the dispatch lineage reports them; "by hand" if a person wrote it
sources: [each one a reader can land on: a DOI, a URL, or path@sha:line]
---
```

An essay has `argument` and `sources` where a paper has `grounded_at` and `cites`: it is not
grounded at a commit, because its material is mostly outside the repository. Where it does
lean on repository material, that source carries a sha like any other citation.

A citation a reader cannot land on is not one.

## Order

A paper:

1. **The answer.** The question as the title, the answer in the first paragraph.
2. **Findings.** Each one a bold lead sentence and the evidence for it. Numbers only where
   they change the conclusion.
3. **Method.** Enough to re-run it: the population, the classes, the queries.
4. **Limits.** What the method cannot see, and which way that bias runs.
5. **Next.** What to study now that this is known. At least one line goes into
   `proposals.md` in the same PR.

An essay:

1. **The argument.** The first paragraph makes it; the header states it in one sentence.
2. **The body.** Sections in whatever order the argument needs. Every claim taken from a
   source carries a marker into the reading list.
3. **Annotated reading list.** One entry per source: the reference, what it supports, and
   what it does not. A source from another field or another century says so — an analogy is
   a mechanism to consider, never an estimate.
4. **Next.** As above, and on the same terms: at least one line into `proposals.md` in the
   same PR.

An essay has no Method and Limits section because it has no method of its own to re-run;
the limits are per-source and live in the reading list, where the source does.

A document is as long as its findings need. A page is the usual size.

## Rules

1. **The files are the record.** Nothing about the archive is stored beside it. Git holds
   every earlier version, so a document is revised by rewriting it, never by adding a
   correction to the body.
2. **A paper is checked by a second document**, not by its author. Its findings are
   measurements a reader cannot redo from the page, so someone else has to.

   **An essay is held to transparency instead.** Its reader can weigh an argument directly,
   so a check is welcome but not owed, and a checker may go on to revise the essay as a
   named co-author. Three things make that safe, and the relaxation holds only while all
   three do: every author is on the byline; every revision that lands carries a version bump,
   in commits that show who changed what; and an unchecked version says so, as does a check
   that covers only an earlier one. One thing is not relaxed: a figure in an essay is read
   at its source, not taken second-hand from another document.
3. **Every document ends with Next**, and Next feeds `proposals.md`.

## Where a document lives

Directories are by subject, not by kind — a paper and an essay about the same thing sit
together, and the index lists them separately.

- `harbour/` for a question about Harbour: its code, its tracker, its sessions, its cost — and
  about the people it serves, where the answer changes what Harbour should build.
- `process/` for a question about how we write papers.
- The root holds only this file, the index in `README.md`, and `proposals.md`.

Writing one is a normal task: mint a ticket from a line in `proposals.md`, land the document as
a PR, remove the line.
