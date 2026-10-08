# Pre-registration: second round of coherence-as-it-grows

Written 2026-10-08, before any of the measures below were computed. Grounded at d61903f3.

## The contest

Harbour's archive records a decline from June to the later months: correct, complete changes a week 95 → 47; correct share 84% → 72%; product lines a week 4,290 → 2,880; dispatches per correct change 7.6 → 20; raw escaped defects per 100 PRs 5.4 → 13.7. The steady-base expedition attributes it to process around the change (supervision, wakes, re-finding, gates) with quality held. John's hypothesis attributes some or all of it to the code: decisions held in several places, so each change lands in more places, takes longer, and leaves a sibling unfixed. Version 1 of the paper inherited the first attribution. This round sets the two against each other.

## Measures, named in advance

M1. **Share of escaped defects whose cause is an unreconciled decision.** Every row in `reliability-baseline-defects.json` (265; 190 escaped, 11 escaped-test) coded blind by a reader who has not seen version 1's finding 3 or `codes.json`, against the codebook in `coherence-as-it-grows-codebook-escapes.md`. Reported by month of the introducing change, and split by whether the row is a finder row (`residueLabel`). Prediction if John is right: the coherence share is material (a fifth or more) and rises across July–September. Prediction if the expedition is right: under a tenth and flat. Agreement with version 1's 15 reported as a count, not a target.

M2. **Decision-level exposure.** A PR is exposed when it changes a line within a site of a known multi-site decision (the 33 twins' sites and the 11 named decisions' sites, as of the snapshot before its month), not merely a file holding one. Reported: exposed share by month; pooled and per-band comparison of send-backs, review legs, sessions, hours (Sept–Oct only), escapes; **size as an outcome** (production lines and files, exposed vs not) as well as a control. Prediction if John is right: exposed PRs are larger and cost more pooled, and the size gap is itself part of the cost. If the expedition is right: no pooled gap once size is held, and size is not larger.

M3. **Inconsistent changes.** For each multi-site decision, every PR since June that touched a strict subset of its sites. Of those, the share followed within 30 days by a PR touching a sibling site with a fix or sibling reference. This is Juergens's measure on Harbour. Prediction if John is right: subset edits are common and a material share are followed by a sibling fix. Reported as counts with the list of cases.

M4. **Share of review send-backs that cite unreconciled code.** Every send-back comment (Request Changes / Needs Discussion heads) on the 176 tickets with send-backs and 136 with plan send-backs, coded blind against `coherence-as-it-grows-codebook-sendbacks.md`: does at least one finding say an existing path, helper, copy or sibling was missed, duplicated or diverged from? Reported by month and size band. Protocol dates (first Request Changes head, plan-review start) recorded from the data so the June–August rise can be split into protocol and content. Prediction if John is right: a material share (a fifth or more) and rising. If the expedition is right: small and flat while the rate rises.

M5. **Second blind reading of version 1's hand codes.** The 126 admission lines and 33 twins re-coded by a reader who has the classes but not the codes. Agreement reported as counts and κ; any twin the second reader rejects is removed from M2 and M3 unless a third reading restores it.

M6. **Literature spot-check.** Fifteen load-bearing sources read at the primary; every number version 1 attributes to them checked. Misreadings corrected in the paper and listed.

## What would change the answer

- M1 ≥ 20% or M4 ≥ 20%: the strong form has support in Harbour's record and the answer paragraph says so.
- M1 and M4 both < 10% and M3 rare: the strong form is tested and not supported, and the answer says tested, not untested.
- Anything between: reported as between, with the counts.

## What this round cannot do

Working hours before September do not exist in this container (they live in the runner's oplog on the host). The June → July halving cannot be re-split here. Hours comparisons stay within September–October.
