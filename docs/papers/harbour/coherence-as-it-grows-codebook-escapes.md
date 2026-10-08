---
title: Codebook: cause of an escaped defect
kind: codebook
version: 1
date: 2026-10-08
authors: [Claude, for John Kershaw]
grounded_at: d61903f39f757ec84f989f541f0552dd86c8b26f (LinearViewer, origin/main, 2026-10-07)
---

# Codebook: cause of an escaped defect

Code every row by what the fault was, from the Bug ticket's description and comments and the introducing ticket's record, not from the row's `reason` alone. One primary class per row. Record the evidence quote (≤ 200 chars) that decided it.

## Coherence classes (the hypothesis predicts these)

- **C1 sibling-unfixed**: the same fault had been fixed at another site (file, function, route, prompt copy) and this site was the copy left behind, or the fix was applied to one of N copies.
- **C2 stale-copy**: a fact, list, constant, schema, state name or rule held in two places, and one was updated while the other was not.
- **C3 wrong-path**: more than one path existed for the job and the change used, called or tested the wrong one, or a caller reached the old path.
- **C4 missed-site**: a change that needed to land in N places landed in fewer, found as a gap (a route, view, provider or template not updated).
- **C5 divergent-semantics**: two implementations of one decision had drifted and the difference was the bug.

## Non-coherence classes

- **N1 logic**: wrong logic inside one place, no second site involved.
- **N2 missing-case**: an input, state or edge not handled, no second site involved.
- **N3 integration**: environment, dependency, CI, config, network, timing, race, flake.
- **N4 requirement**: built the wrong thing or misread the ticket.
- **N5 test-only**: the fault is in a test or fixture, production correct.
- **N6 review-residue**: the row is the review's own ledger filed as a Bug, not a fault found by use.
- **N0 unclear**: cannot tell from the record.

## Rules

- Code C-classes only when the record names or shows the second site. "Should have reused X" with no fault from the duplication is N1 or N2 with note `near-coherence`.
- A fault found by a later review of an older area is coded by its cause like any other; also record `foundLater: true`.
- Do not read version 1's finding 3, `coherence-as-it-grows-codes.json`, or the twins list before coding. Code first, compare after.
