---
title: Codebook: what a review send-back asked for
kind: codebook
version: 1
date: 2026-10-08
authors: [Claude, for John Kershaw]
grounded_at: d61903f39f757ec84f989f541f0552dd86c8b26f (LinearViewer, origin/main, 2026-10-07)
---

# Codebook: what a review send-back asked for

A send-back is a comment whose head is a Request Changes or Needs Discussion verdict (plan review or code review). Code each send-back comment, not each ticket. Record every finding class present; mark the first-listed finding as `lead`.

## Coherence findings (the hypothesis predicts these)

- **S1 reuse-missed**: an existing helper, module, route, predicate or template does the job and the change wrote another.
- **S2 sibling-not-updated**: a second site that holds the same decision (copy, twin, other provider, other view, prompt copy) was not changed to match.
- **S3 wrong-path**: the change used, extended or tested the wrong one of several paths for the job.
- **S4 divergence**: the change makes two sites that should agree disagree, or widens an existing disagreement.
- **S5 consolidate-asked**: the reviewer asks the change to merge or retire a second path as part of the ticket.

## Other findings

- **O1 list-member**: one more item for a list the plan already built (the review-loops paper's class).
- **O2 logic**: a bug in the change itself, no second site.
- **O3 requirement**: scope or acceptance criteria not met or misread.
- **O4 test-evidence**: missing, weak or unrun test or witness.
- **O5 process**: ticket hygiene, ledger format, citation, anchor, CI, formatting.
- **O6 design**: architecture or approach disagreement not about a second site.
- **O0 unclear**.

## Rules

- S-classes need the comment to name the second site or the existing thing. "Consider reusing" with no named thing is O6 with note `near-coherence`.
- Record the comment's date, the ticket, the stage (plan review or code review, from the head), and the head's first 80 chars.
- Also record, per ticket, the first date a Request Changes head appears and the first date a plan-review head appears, so the protocol can be dated from the data.
- Do not read version 1's findings before coding.
