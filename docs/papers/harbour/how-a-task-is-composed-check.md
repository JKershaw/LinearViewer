---
title: Does "how a task is composed" (version 1) hold up?
kind: check
version: 1
date: 2026-10-11
authors: [Claude (LIN-3489)]
model: claude-sonnet-5-5, claude-code, effort medium, one dispatch session (LIN-3489, kind implementation), a different lineage from both the paper's research and writing sessions (LIN-3463). It read the LIN-3489 research comment (a separate research lineage, which had seen the study's codes and had already re-run the scripts) and re-ran everything it relies on. The blind re-code was done by one fresh subagent (claude-sonnet-5-5, general-purpose) that was given only a folder of blind ticket files and `composition/RUBRIC.md`.
grounded_at: b5be7535 (LinearViewer origin/main); evidence at research/lin-3463-composition@b2ed3a35; code cited by the paper at 15990905
cites: [docs/papers/harbour/how-a-task-is-composed.md@b5be7535 (version 1), research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/agreement.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/fidelity_summary.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/analyse.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/analyse2.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/sizebands.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/model.py, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/composition/RUBRIC.md, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/fidelity/propagation.json, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/fidelity/index.json, lib/brief.js@15990905:21, lib/brief.js@15990905:32, lib/brief.js@15990905:38, lib/recap-cache.js@15990905:44-86, docs/papers/harbour/ticket-record-and-quality.md@15990905:35, docs/papers/harbour/replay-small-work.md@15990905:50-59, docs/papers/harbour/survey-check-11.md@15990905:52-54, docs/archive/9.html@15990905:235-238, docs/archive/8.html@15990905:201, docs/papers/standard.md@b5be7535, LIN-3489 (research comment, 2026-10-11), LIN-3489 (review comment, 2026-10-11), LIN-3463, LIN-3453]
---

# Does "how a task is composed" (version 1) hold up?

*Prepared for John Kershaw | October 2026*

**The numbers hold; the reason the paper gives for its central caution does not, and one
table is half-shown.** Every figure I could recompute reproduces exactly, and a fresh blind
coder agrees with the study on "behaviour open" at κ 0.79, higher than the study's own second
coder (0.52). But the paper says that once PR size is in the model "only size clears zero".
That is mostly an artefact of putting two near-identical codes (r = 0.90) in the same model.
With one of them, behaviour open clears zero; with breakdown origin added it sits on the line.
So the right reason for "cannot be separated" is that the effect is fragile to how the model
is written and rests on 32 tickets, not that size absorbs it. That is no licence for a
stronger claim: "consistent with" is exactly as strong as the evidence allows, and the
four-question bar is correctly called a sketch. The second table, as the paper prints it, is
true but picks the two bands where breakdown children look worse; in the small band the
direction reverses. The wording errors found are listed below with replacement text.

## Findings

### 1. Every committed figure reproduces

I rebuilt `table.json` from `outcomes.json` (with `desc0` empty) and `autofeatures.json` from
`outcomes[*].auto`, and ran the scripts on the committed data alone. `agreement.py`,
`fidelity_summary.py`, `sizebands.py`, `model.py`, `analyse.py` and `analyse2.py` each produce
output **byte-identical** to the file under `results/`. Against the paper: κ 0.46, 0.52, 0.50,
0.69, 0.95; brief fidelity 27 material, 29 minor, 4 faithful; second coder 3 against 5 and
13 of 15; 21% of acceptance units dropped, 13% altered; why dropped 32%; open items never
dropped; 35, 13, 10, 5 additions; the model's R² 0.317, size ×1.31, open ×1.20 with
[−0.784, +1.501], how ×0.91; origins 6/168/141/39/11/9/2 (370 of 376 = 98%); read order
59/35/4%, 93–96% by stage, 97% since 5 October against 40–59% before; propagation 25/1/1.
Three counts the scripts do not print I recomputed from the codes: 25 pairs with an
acceptance unit dropped, 32 dropped or altered, 23 with a settled item turned open. The
population is LIN-2572 to LIN-3462, first dispatched 11 September to 11 October, and all 376
have a first snapshot. (The branch README still says LIN-2800; the paper's range is right.)
Not re-run: `autofeatures.py`, `fetch.py`, `transcripts.py` and `readorder.py` need raw ticket
text or transcripts that are not committed, so `auto-features.txt` and `read-order.txt` were
read, not regenerated.

### 2. The two unprinted tables: Table 1's settled rows hold; the second table is half-shown

I re-joined `outcomes.json` and `composition/` (analyse.py's join, `pr_lines` from
`outcomes[*].auto`, sizebands.py's banding; n = 184, bands 2–197, 201–602, 613–30,891).

| Band | Settled (n, median, split, plan-review ≥ 2) | Paper |
|---|---|---|
| small | 53, 6, 2%, 8% | same |
| mid | 52, 7, 8%, 27% | same |
| large | 47, 11, 26%, 47% | same |

"Not open" and `== 'no'` are the same set. The open rows (8/9/15 tickets) match
`results/size-bands.txt`.

The ticket that asked for this check called the second table "plan-review ≥ 2". It is not:
47% / 71% against 29% / 38% is **code review ≥ 2**, which is what the paper says. The ticket
was wrong and the paper right. The full split, which neither prints:

| Band | Breakdown children: n, median, plan-review ≥ 2, code review ≥ 2, split | Authored: same |
|---|---|---|
| small | 28, 5, 11%, **11%**, 4% | 33, 7, 12%, **33%**, 3% |
| mid | 30, 6.5, 13%, **47%**, 3% | 31, 9, 42%, **29%**, 19% |
| large | 38, 10, 37%, **71%**, 11% | 24, 22.5, 79%, **38%**, 58% |

So "they go back through code review more often" is true in two bands of three; in the small
band authored tickets go back more (33% against 11%). On plan-review, breakdown children go
round *less* (13% and 37% against 42% and 79%) and split far less in the large band. "It moves
the cost" is a fair headline for this pattern, but the paper showed only the side that
supports it. The paper also leaves out that the groups differ by band: the authored large
group has a median of 22.5 sessions against 10.

### 3. The central caution is right, its stated reason is not (the model)

`model.py` enters both `open_behaviour` and `not_settled` (`what_decided < 2`). In the 184
they are 32 and 29 tickets, 28 of them in both; r = 0.90. Each term's interval is inflated by
the other. With the same population, seed (3463) and 2,000 bootstraps (`model_alt.py`, in the
research comment's appendix):

| Model | Behaviour open, log coefficient and 95% interval |
|---|---|
| the paper's (open + not_settled + five others + size + origin) | +0.181 [−0.784, +1.501] |
| open + log size | +0.446 (×1.56) [+0.167, +0.743] |
| open + log size + breakdown | +0.302 (×1.35) [−0.025, +0.655] |
| not_settled + log size | +0.469 (×1.60) [+0.222, +0.739] |

The breakdown term in the third row is itself negative with an interval that excludes zero
(×0.73, [−0.557, −0.093]). I take three things from this and no more. "Only size clears zero"
describes one specification and should not stand as a finding. The interval for behaviour open
depends on whether a near-duplicate code is in the model and whether origin is. And no
version of this is evidence of a cause: it is 32 tickets, observational, with codes the
second coder only moderately reproduced. The paper's conclusion ("consistent with … does not
show that settling it is what made it run better") survives; its mechanism sentence does not.

### 4. Coding reliability: a fresh coder lands higher on "behaviour open", in the same place on "what decided"

I drew 48 of the 376 with `random.Random(20261011)` (12 from the oldest third, C253 and up,
which the study's second coder never saw; 5 inside the study's 28; LIN-3453 not drawn). For
each I fetched the earliest snapshot from `GET /issues/LIN-n/snapshots` and asserted that its
`capturedAt` equals `first_snapshot_at` and its word count equals `desc0_words` in
`outcomes.json` (all 48 passed). I wrote files holding a fresh id, the title, whether it has a
parent, and the description, nothing else, and gave a fresh subagent that folder plus
`RUBRIC.md` and no repository path, outcomes or existing codes. Joined afterwards:

| Code | Agreement | κ (95% interval, 2,000 bootstraps) | Study's second coder, κ |
|---|---|---|---|
| origin | 85% | 0.78 | 0.95 |
| what decided | 77% | 0.41 (0.14–0.65) | 0.46 |
| **behaviour open** | **94%** | **0.79 (0.49–1.00)** | 0.52 |
| how prescribed | 58% | 0.41 | 0.69 |
| decisions | 62% | 0.50 | 0.50 |
| asserted facts | 90% | 0.80 | 0.86 |
| acceptance | 92% | 0.83 | 0.64 |
| work type | 98% | 0.97 | 0.90 |

On behaviour open there are three disagreements in 48: the study coded 9 open, the fresh coder
8 (two the study called open the fresh coder called settled, one the other way). Unlike the
study's second coder, who called 3 more open than the primary and no fewer, this coder shows
no direction. On "what decided" the fresh coder is stricter in 10 of 11 disagreements
(the study's second coder was also stricter), and its 0.41 sits where the study's 0.46 did.
So the main claim's dependence on "behaviour open" is better supported by this sample than the
paper's limit says, and the paper's "what decided" caution stands as written. Two reservations:
the interval on open runs from 0.49 to 1.00 with only 8–9 positives, and the coder is the same
model family as the study's coders, so shared habits would raise agreement without making either
right. The study's own pattern is also real: its second coder called 5 open on 28 where the
primary called 2, all three disagreements in one direction. Two coders landed at 0.52 and 0.79
on different samples; I would report the range, not a single figure. The paper's "may be larger
or smaller than shown" is fair for the fresh coder and too even-handed for the study's second
coder, whose misses all went one way (primary under-coded open, which would attenuate the gap).

### 5. Cites: seven of nine resolve; two have a flaw

| Cite | Result |
|---|---|
| `lib/brief.js:21`, `:38` | verbatim |
| `lib/brief.js:32` | **misquote.** Source: "contradictions in the source (surface them — do not smooth them into false tidiness)". The paper's "surface contradictions … do not smooth them into false tidiness" reorders words inside quotation marks |
| `lib/recap-cache.js:44-86` | holds: `extractHashableContext` hashes the issue, comments, children, parent and focused child. `formatIssueContext` (`lib/openrouter.js`) also renders project, siblings, blockers and attachments, and none of those is hashed. Cousins are rendered too |
| `ticket-record-and-quality.md:35` | lead sentence, as quoted |
| `replay-small-work.md:50-59` | "two of them as its description directed", as claimed |
| `survey-check-11.md:52-54` | resolves, but supports "each replay that could reproduce its ticket's known fault … did so", not "as directed"; the "as directed" rests on `replay-small-work.md` alone |
| `docs/archive/9.html:235-238` | verbatim; the retrospective and John's words |
| `docs/archive/8.html:201` | verbatim. It is the Flight Companion's text ("my own briefs"), not John's; the paper calls both "the two older cases you named" |

One more: the paper sets LIN-3453's text in quotation marks as a single sentence, "returns
`null` on junk; callers that relied on `0` or `NaN` convert at the call site". The ticket has
these as two separate "Done when" bullets. The words are right; the join is the paper's.

### 6. Wording slips

1. "the 119 terminal tickets that John or a companion wrote (breakdown children left out)":
   `analyse2.py`'s authored group is every non-breakdown origin (companion, follow-up,
   periodical, other-agent, john, unclear). The numbers are right, the label wrong.
2. "132 of the 136 sampled tickets were from September" (twice): nothing on the branch gives
   136. `fidelity/index.json` holds 60 pairs: 58 September, 1 August, 1 October, none after
   4 October. 136 is probably the eligible pool, which is not committed. As written it is
   unsourced; the 4 October point is supported by the dates.
3. "About 11 of the 25 were stepper beats whose coordinator prompt put the dropped content
   back." A per-row read of the 25 `followed-source` notes: in 8 rows the note says the
   stepper's beat prompts carried the dropped content (F08, F22, F25, F31, F32, F33, F34, F43),
   and in 2 more (F23, F29) it says they carried it *as well as* the raw issue. That is
   **8, or 10 counting the two "also"**, so "about 11" is a little high. The paper's
   conclusion ("the 1-in-27 may flatter the brief") stands.
4. "File anchors, line anchors, … show no gradient either": true of median sessions. On split,
   file anchors run 17%, 4%, 6% from low to high and a plan embedded in the text 11% against 3%
   (`results/auto-features.txt`). The sentence is about sessions and should say so.

### 7. The wording of the claim: supported at its strength and no more

"Consistent with" is right. Three things would make it too strong and the paper avoids them:
it says the data "cannot settle it", it says the batch-2 improvement is credited to nothing
beyond the behaviour line and "one batch is not a test", and it calls the bar "a sketch and
not validated policy" that "should not be enforced until a forward trial says whether it
helps". I would not strengthen any of these on this evidence. Two places could be read more
confidently than they should be and I would soften them: "in every band" (finding 2: open
bands hold 8, 9 and 15 tickets, and the small-band split is 1 ticket of 8) and "the record
supports the first most" (it rests on the authorship count, 98% by agents, and on the
unreplicated composition effect). Neither needs more than a clause.

## Corrections, with replacement text

For a revision to version 2. Each replaces the quoted sentence.

1. **Answer, and the model paragraph.** Replace "and once PR size is in the model only size
   clears zero" with "and the model cannot tell them apart (see below)". Replace the paragraph's
   regression sentences from "In a regression" to "spanning zero" with: "In a regression of
   log sessions on the codes plus log PR lines and origin (n = 184, 2,000 bootstraps, R² 0.32),
   change size is the only term whose interval excludes zero: ×1.31 sessions per e-fold of
   lines. Behaviour open is ×1.20 with an interval of −0.78 to +1.50, but that model enters
   'behaviour open' and 'not settled' together (r = 0.90, 28 of 32 open tickets are in both), and
   each widens the other. With behaviour open and size alone it is ×1.56 [+0.17, +0.74]; add
   breakdown origin and it is ×1.35 [−0.03, +0.66]. So the effect is there if the model is
   simple and on the line once origin is allowed for. It rests on 32 tickets and is fragile to
   specification (`results/model.txt`; the variants are in the LIN-3489 check)."
2. **Second table.** Replace "They also go back through code review more often: two or more
   reviews in 47% (mid) and 71% (large) of breakdown children against 29% and 38% of authored
   tickets (same recomputed join as Table 1)" with: "They also go back through code review
   more often in two bands of three: two or more reviews in 47% (mid) and 71% (large) of
   breakdown children against 29% and 38% of authored tickets; in the small band it is 11%
   against 33%. Plan-review runs the other way: 13% and 37% against 42% and 79% in mid and
   large (same recomputed join as Table 1)."
3. **Authored label.** Replace "that John or a companion wrote (breakdown children left out)" with
   "that anyone but a plan breakdown wrote (companion, follow-up, periodical, other-agent and
   John)".
4. **Unsourced 132 of 136.** Replace "(132 of the 136 sampled tickets were from September)" with
   "(58 of the 60 were from September, one from August and one from October, all before the
   4 October prompt change)", and in Limits replace "The brief sample is 132 of 136 September
   tickets, before the 4 October prompt change" with "The brief sample is 60 pairs, 58 of them
   from September, all before the 4 October prompt change".
5. **Stepper count.** Replace "About 11 of the 25" with "In 8 of the 25, and in 2 more alongside
   the raw issue,".
6. **Cite for the brief's wording.** Replace "surface contradictions … do not smooth them into
   false tidiness" with "contradictions in the source (surface them — do not smooth them into
   false tidiness)", and replace "returns `null` on junk; callers that relied on `0` or `NaN`
   convert at the call site" with "returns `null` on junk" and "callers that relied on `0` or
   `NaN` convert at the call site" as two quotations.
7. **Coder agreement.** Replace the first Limit with: "Coder agreement is moderate on the codes
   that matter, and was re-tested. On 28 tickets the study's second coder agreed with the first at κ 0.46
   on what was decided and 0.52 on behaviour open (decisions 0.50, how-prescribed 0.69, origin
   0.95; `results/composition-agreement.txt`); it was stricter on 'decided', and all three of its
   disagreements on 'open' had it calling a ticket open that the primary had not. A fresh blind
   coder on 48 tickets (12 from the oldest third, which had no second coder) gave κ 0.41 on what
   was decided and 0.79 on behaviour open (interval 0.49–1.00; 8–9 open tickets), with no
   direction on open (`how-a-task-is-composed-check.md`). Misses are therefore not random on
   'decided', where coders drift stricter, and the open-versus-settled gap may be larger than shown."
8. **Not independently checked.** Replace with: "**Checked** by `how-a-task-is-composed-check.md`
   (of version 1): the figures reproduce, and the corrections above are made in this version.
   What that check could not do is listed in its limits."
9. **Recompute and re-run.** In the Next section, replace "Have someone other than this paper's
   author check it from the branch, re-running `agreement.py` and `fidelity_summary.py`." with
   nothing; it has been done.
10. **Anchors, sessions only.** In the paper's "The surface of the text predicts nothing", replace
    "show no gradient either" with "show no gradient in median sessions either (on split, file
    anchors run 17%, 4% and 6% from low to high, and an embedded plan 11% against 3%)".
11. **Open rows are small.** After "changed." in the Table 1 lead paragraph, add "The open rows
    are small: 8, 9 and 15 tickets."
12. **First direction.** After "the record supports the first most (fix the ticket where it is
    written)", add "on the authorship count and on a composition effect that rests on 32
    tickets".

## Method

I extracted `scripts/eval/lin-3463-composition/` from `research/lin-3463-composition@b2ed3a35`
into a scratch directory and ran six scripts on `outcomes.json`, `composition/` and `fidelity/`,
diffing each against its `results/` file. I re-joined the 184 for the two tables with a new
`recompute.py` (analyse.py's join, sizebands.py's banding) and re-ran the model with three
variants (`model_alt.py`; the two analysis scripts are reproduced in the LIN-3489 research comment, and the blind sample script, key, fresh codes and comparison are in the LIN-3489 review comment, which preserved them after the session scratch was gone). For the
blind re-code a script drew the sample, fetched each earliest snapshot, asserted it matched
`outcomes.json`, and wrote only the blind files; the coder was one fresh subagent given those
files and the rubric; a second script compared its codes with the study's after the fact and
bootstrapped κ. Cites were resolved with `git show 15990905:<path>` and read against the quoted
text. The propagation claim was checked by reading each of the 25 followed-source notes.

## Limits

- **Not independent in model.** The paper's writer and this checker are both claude-sonnet-5-5,
  and the study's coders are the same family. The blind coder was a fresh context, not a
  different model; shared habits would raise agreement. A human second coding is the only fix.
- **One coder, one sample, few positives.** Open agreement rests on 8 and 9 open tickets in 48.
  The interval is wide (0.49–1.00). It says a fresh coder did not do worse than the study's
  second coder, not that κ is 0.79.
- **I did not see the study's codes before coding but did see the research comment.** It
  reported aggregates, LIN-3453's codes and the second-coder disagreement pattern. None of the
  48 was LIN-3453, and the coder saw none of it.
- **Not regenerated.** `autofeatures.py`, `readorder.py`, `transcripts.py` and `fetch.py` need
  data that is not committed; the read-order and auto-features figures were checked against
  their result files only. The brief-fidelity pair coding (60 pairs) was not re-coded; I
  checked its counts and the propagation notes, not its verdicts. The ticket text is not
  committed, so the 376 first-dispatch texts come back only from the snapshot store.
- **The model finding is a specification check, not a model.** I changed which terms were in;
  I did not fit an ordinal or count model or look at interactions.
- **The wording judgement is mine.** Whether "consistent with" is the right strength is a
  reading, not a measurement.

## Next

- Have a second coder, ideally a person, code behaviour open and what decided on all 184 tickets
  in Table 1, blind to outcome, and re-fit the open-plus-size model with the codes it produces
  (a proposal line).
- Re-read the small-band reversal (breakdown 11% against authored 33% on code review) on the
  tickets themselves, to see whether the cost the breakdown children save in planning shows up
  later or elsewhere (a proposal line).
