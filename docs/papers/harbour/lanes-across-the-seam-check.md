---
title: Does "Can parallel lanes coordinate with each other" (version 1) hold up?
kind: check
version: 1
date: 2026-11-14
authors: [an independent reviewer sent by the survey session (LIN-4480); written up by Claude (LIN-4480, version 2 session)]
model: "The review: an agent session sent by the survey session that drives LIN-4480, independent of the paper's author; its model and effort are not recorded in the relay. This write-up: claude-opus-5-5 (Opus 5.5), Claude Code CLI, Harbour dispatch 5806367e (custom), the session that revised the paper to version 2. The findings below are the reviewer's, quoted or closely paraphrased from LIN-4480 comment c5605fc9. The dispositions and the extra checks are the reviser's own, so they are not independent."
grounded_at: 42f8284e4 (the paper's version 1, PR #2453), read against fb358dbda (LinearViewer origin/main) and 06a7da871 (LIN-4448's close-out)
cites:
  - "LIN-4480 comment c5605fc9 (independent review, 14 Nov 2026 11:01Z)"
  - "docs/papers/harbour/lanes-across-the-seam.md@42f8284e4 (version 1) and its version 2 in the same PR"
  - "LIN-4448 comments 72406236, 0860f7b8, 83e69cd5, 7fcd63b2, 5cfdaa1e; LIN-4468 comments 732e3364, 24e376c1; LIN-4469 comment ec59bd26"
  - "PR #2433 (merge commit e666c4b60), PR #2441 (dc12ca51b), PR #2443 (b937237a4), PR #2457 (06a7da871)"
  - "lib/stage-router.js@fb358dbda:29; lib/run-trail.js@fb358dbda:216-225; lib/openrouter.js@fb358dbda:724-740; docs/proxy-integration.md@fb358dbda:116-122; docs/papers/harbour/wake-inventory.md@fb358dbda:110-111"
  - "Mauerer et al. 2021, doi:10.1109/TSE.2021.3082074; arXiv:2607.04697 and arXiv:2603.21489 abstracts, read 14 Nov 2026"
---

# Does "Can parallel lanes coordinate with each other" (version 1) hold up?

The core case holds; several sentences around it did not. The reviewer checked the proposal,
the agreement and the correction against the record. They also confirmed that all three moves
landed (#2432, #2435, #2438) and that the counts reproduce: 29 PRs, 353 files, 48 shared, 47
minutes, 30 green runs. Their verdict was "merge after fixes". The largest error was the claim
that no person took part at the seam. John ruled on a later crossing that reversed the agreed
boundary. The paper also stopped before LLM's close-out, which changed Runs' side after Runs had
closed. One evidence file named a company. Version 2 fixes all four must-fix items. It takes
ten of the eleven suggestions and declines one in part, with evidence.

## Must-fix

| # | Finding | Disposition in version 2 |
|---|---|---|
| 1 | `issues/LIN-4469.json`, comment ec59bd26, names a company in brackets after the sha `05b592742`. | **Fixed.** `census.py` now replaces a bracketed name after a sha before writing (`redact()`), and the snapshot was regenerated. A search of the paper and every evidence file for the name, for e-mail addresses and for company-style domains finds nothing else. |
| 2 | "No person took part" and "John's rulings … never the seam" are contradicted. LIN-4468's `DECISION:` (0860f7b8) and John's ruling 24e376c1 ("Allow the store change") let LLM edit `releaseHeldWake` in Runs' `lib/dispatch-store.js`, merged in #2443 (b937237a4), after LLM's correction said "We don't touch the runner or `lib/dispatch-store.js`". #2441 also edited `lib/run-trail.js`, which is not on the corrected list. | **Fixed.** The answer and finding 1 now limit "no person" to the first exchange. Finding 5 now covers the boundary changes that came after it. It tells the crossing in order: the `DECISION:`, the autopilot's engineering settlement (732e3364), the seam notice, John's ruling and the merge. It explains #2441: the edit swaps a literal for `BLIND_READ_KIND`. It reached `lib/run-trail.js` because move 1 had put the classifier table there after the 15:55 list was written. |
| 3 | The paper stops before LIN-4448's close-out (#2457, 06a7da871, 10:52Z), which moved `completion-signals` from Runs to LLM in `areas.json` and added a Runs Waiting entry, after Runs closed and with no reply from it. | **Read in.** Finding 5 now covers it, with `areas.json@06a7da871:28,44` and `runs-and-dispatch.md@06a7da871:182-186`. The Method names it as the one event after the census window. The paper also notes that the `completion-signals` move was announced at 15:55Z and the Waiting entry was not. Nothing was posted on LIN-4447. |
| 4 | Citations: the "2021 replication … mostly small" has no source; six `cites` entries go unused (Conway, Parnas, Smith, MetaGPT, A2A, the Rust RFC process); `openrouter.js:724-740` is used but not cited; `wake-inventory.md` has no sha. | **Fixed.** The claim is now sourced and reworded to what the source says. Mauerer et al. 2021 (doi:10.1109/TSE.2021.3082074) studied 25 open-source projects and found congruence "not related to project quality measures — software bugs and churn — in any temporal scenario". The study does not call itself a replication, so "replication" and "mostly small" are gone. The six unused works are removed from `cites`. `openrouter.js@fb358dbda:724-740` and `wake-inventory.md@fb358dbda:110-111` are added. Gray & Cheriton now carries a DOI. |

## Suggestions

| Suggestion | Disposition |
|---|---|
| Finding 4 overstates the seam angle. `15a858eb` is Runs on its own ticket, `isPersonComment` also flags notes within one lane, and the selector's caveat ("unless the facts show an agent acted after it") should be quoted. | **Taken.** A new script (`person-comments.mjs`) runs the classifier over the window. It returns eleven non-ruling comments. One relays John's approved words. Ten are agent notes, nine of them inside one lane, so finding 4 now calls the flaw general. The caveat is quoted. |
| "1 in 5" is a weak baseline. The four unanswered asks were reconfirmations, and the real question was answered. | **Taken, with one qualification.** Finding 3 now says so, and its lead changed. Two of the four also carried new boundary detail (1a2e7cba's census boundary, b564445b's runner-kickoff import), and nobody on the other side is recorded as reading it. Next and `proposals.md` now count real questions and notices apart. |
| "19 PRs … because they agreed who owned what before they started" is unsupported: #2422 merged at 14:54Z, before the agreement at 15:39Z, and git did most of the coordinating. | **Taken.** The causal clause is removed. Finding 9 now says the record does not show it, and gives the reviewer's two reasons. |
| `e102e095a` is a merge of main into the branch, not #2433's merge commit (`e666c4b60`, 19:44Z). | **Taken.** The table row is now at 19:12 for `e102e095a`, the branch merge where the import changed. It adds that #2433 merged at 19:44 as `e666c4b60`, and the header cites both. |
| All three asks named a Runs child, not "two of the asks". | **Taken.** Each asks for the reply on LIN-4458 or LIN-4459, and 0510ffe0 also offers LIN-4447. |
| LIN-4464 and LIN-4465 dispatch times are not in `dispatches.json`. | **Taken.** `census.py` now fetches dispatch rows for every Runs and LLM ticket. The rows confirm 15:56Z and 16:49Z. |
| Move 3 landed as `closeOutDecision().routesRead`. | **Taken.** Finding 1 names it, citing `lib/recommendation-blind-read.js@fb358dbda:58`. |
| Plan review (`72406236`) ran before the breakdown and missed the slip. | **Declined in part.** Plan review did run first (15:49Z, against 15:55Z), but it caught the slip. Its note 7 reads "Correct the seam reply on LIN-4447 before pieces 2–4 start. It says the only Runs file this work edits is `STAGE_LABELS` in `lib/run-view.js`." The breakdown posted the correction on that instruction. Version 1 was still wrong to credit the breakdown with the catch, so finding 2 now credits plan review. What plan review did miss is the `model` agreement claim, which finding 5 already said. |
| The worker-lane quote is about worker lanes without the `dispatch` grant; these lanes were autopilots that hold it. | **Taken.** Finding 7's first fact now says this. The server declares `dispatch` for an owner's Autopilot dispatch, and both lanes had one from 13:13Z. Stage workers lack the grant. For these lanes the barrier is session ids, not the grant. |
| "29% of Harbour's tokens" should be "29% of weighted tokens in dispatched sessions". | **Taken**, in the source's words, with a sha. |
| Housekeeping: add this check or mark the paper unchecked; the "review before merge" wording goes stale; the README finding is much longer than its neighbours. | **Taken.** This document is the check. The header's model line no longer promises a review. The README row is shortened. |

## What the reviewer did not verify, and what the reviser then checked

The reviewer did not check the arXiv preprints, LIN-876's cancellation or other tracker-only
claims. The reviser checked these, which is not an independent check:

- **arXiv:2607.04697** (Xu, Subramanian & Karthik). The abstract gives 41.7% against 19.8% on 747
  co-active pairs, and 0.5% cross-agent. That matches the paper.
- **arXiv:2603.21489** (Geng & Neubig). The abstract gives +25.6 on PaperBench and +14.7 on
  Commit0, and calls branch-and-merge "a central coordination mechanism". That matches the paper.
- **LIN-876** is Canceled with no comments. Version 1 was wrong about what it asked. Its
  description is about autopilots "at different altitudes" (a child and its parent), not lanes.
  Version 2 says so in finding 7 and in Next.
- **The census re-run** at about 11:00Z on 14 November reproduced every count in `census.json`
  and every row of `prs.json`.

## What is still unchecked

The version 2 text has had no second reader. That includes the new finding 5, the classifier
re-count and the reworded finding 3. Thompson, the two Cataldo papers and Mauerer et al. were
confirmed from abstracts and secondary sources, not full text.

## Next

- A second reader for version 2's finding 5 and finding 4 counts, by re-running
  `person-comments.mjs` and reading the LIN-4468 and LIN-4448 comments it cites. The paper's own
  Next lines are in `proposals.md`.
