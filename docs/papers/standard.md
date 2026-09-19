# How a paper is written

A paper answers one question with evidence. It can be about anything and take whatever
shape the question needs. What every paper shares is the header and the order of its parts,
so that papers can cite each other and a reader always knows where to look.

## Header

```
---
title: The question, as a question
version: 1
date: 2026-09-12
authors: [who is responsible for it]
model: model, harness and effort as the dispatch lineage reports them; "by hand" if a person wrote it
grounded_at: the commit the evidence was read at
cites: [path@sha:line, LIN-nnn (comment date), PR #n (date)]
---
```

A citation a reader cannot land on is not one.

## Order

1. **The answer.** The question as the title, the answer in the first paragraph.
2. **Findings.** Each one a bold lead sentence and the evidence for it. Numbers only where
   they change the conclusion.
3. **Method.** Enough to re-run it: the population, the classes, the queries.
4. **Limits.** What the method cannot see, and which way that bias runs.
5. **Next.** What to study now that this is known. At least one line goes into
   `proposals.md` in the same PR.

A paper is as long as its findings need. A page is the usual size.

## Rules

1. **The files are the record.** Nothing about the archive is stored beside it. Git holds
   every earlier version, so a paper is revised by rewriting it, never by adding a
   correction to the body.
2. **A paper is checked by a second paper**, not by its author.
3. **Every paper ends with Next**, and Next feeds `proposals.md`.

## Where a paper lives

- `harbour/` for a question about Harbour: its code, its tracker, its sessions, its cost — and
  about the people it serves, where the answer changes what Harbour should build.
- `process/` for a question about how we write papers.
- The root holds only this file, the index in `README.md`, and `proposals.md`.

Writing one is a normal task: mint a ticket from a line in `proposals.md`, land the paper as a
PR, remove the line.
