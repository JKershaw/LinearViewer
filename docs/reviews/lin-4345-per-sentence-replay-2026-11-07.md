# Per-sentence accounting, replayed on two narrowed tickets (7 November 2026)

LIN-4345's remaining done-when, carried from LIN-4353 under John's `merge-carry` ruling: "If
LIN-4085's request for 'a full guide' were replayed through this change, its review would judge
against those words, not against the plan." The first replay
(`docs/reviews/lin-4353-lin4085-review-replay-2026-11-07.md`) failed in every arm. Its arm A3,
the shipped wording, asked the verdict for "one line … quoted from the block", and the reviewer
quoted selectively, cutting at an ellipsis just before the narrowed clause. This attempt makes
the verdict account for every sentence of the block. It was replayed on LIN-4085 and on a
second ticket with a known narrowing, LIN-1596, with three runs per arm.

This is evidence for review, not a CI result. A model's judgement is not something CI can test.

**Result: the done-when is still not met. The new wording changed no verdict.**

| Ticket | Old wording (`cdc324bc`) | New wording (`53f476b3`) |
| -- | -- | -- |
| LIN-4085 (thin guide) | 0 of 3 pass, all Approve (conditional) | 0 of 3 pass, all Approve (conditional) |
| LIN-1596 (split-out KPI parts) | 3 of 3 pass, all Needs Discussion | 3 of 3 pass, all Needs Discussion |

Per-sentence accounting did what it was written to do. Every new-wording verdict on LIN-4085 went
through the block sentence by sentence and quoted the full-guide sentence whole. Every
old-wording verdict quoted the block selectively and stopped before it, as arm A3 did. But all
three reviewers then judged that sentence **met** by the 577-word guide. The miss has moved a
fourth time: first the plan was read as agreement (A), then the reviewer summarised the ask (A2),
then it quoted selectively (A3), and now it **judges sufficiency**. Even with the whole sentence in
front of it, the reviewer reads "a full guide on how to properly configure Harper for whatever
your situation is" as met by a guide that covers each situation in a line and hands the rest to
other pages.

LIN-1596 cannot tell the arms apart: both caught it every time. Its narrowing is written out in
the description, under scoping's own heading "Out of scope — split out". The table shows what a
reviewer can and cannot see:

- **An explicit narrowing is caught without help.** When a stage writes the narrowing down as
  such, every reviewer under either wording named it as unagreed and asked the person.
- **An implicit narrowing is missed with help.** LIN-4085's narrowing was never written down.
  Scoping turned "full guide" into "sequence the human's few clicks", and the plan added a size
  budget. Neither said it was cutting anything. Even reading the person's sentence whole, a
  reviewer judged the result sufficient.

## What each run said on the narrowed sentence (verbatim)

**LIN-4085, old wording.** Each verdict quotes the ask no further than "walks an agent through
onboarding" (old-1 continues to "… project and the user to Harbour") and stops there.
- old-1: "The change ships exactly that … I name no narrowing."
- old-2: "That is delivered in full and not narrowed".
- old-3: "Nothing is narrowed".

**LIN-4085, new wording.** Each verdict quotes "essentially a full guide on how to properly
configure Harbour for whatever your situation is" in its sentence list.
- new-1: "**Met, on my reading.** The guide covers each situation an agent can act on … then hands
  configuration to the existing agent surfaces". It adds that self-hosting gets only a README
  pointer: "If the requester meant self-host setup too, that's for them to say." It still
  approves.
- new-2: "Met. The guide routes each situation … It hands off to the existing agent-facing
  surfaces rather than duplicating them." Then: "Nothing in the ask is narrowed."
- new-3: "Met once fix 1 lands. Each situation gets a path". Fix 1 is an email-door correction.

**LIN-1596, both wordings.** Every run returned Needs Discussion and named the zero-touch rate
and the links on the other cards as narrowed by scoping without the person's agreement.
- The old runs did it in prose. For example, old-1: "The work is narrowed in two places no person
  has agreed to: zero-touch merges, and evidence links on the other headline numbers."
- The new runs did it in a sentence-by-sentence list. For example, new-2: "Sentences 3, 5 and 6
  are narrowed by the scoping stage. No comment from the person and no answered ruling agrees to
  that narrowing".

Every run in both arms also found real defects. On LIN-4085: an untested route wiring, a wrong
step for the email door, a 320px test that cannot fail, and the Host overclaim. On LIN-1596: the
aggregate-path tests pass through the `find` fallback, the projection guard tests a copy of the
pipeline, and the e2e click never runs. The wording change did not cost the reviews their catch
of real defects.

## Reading

- **Accounting for each sentence fixes visibility, not judgement.** The selective quote is gone,
  and that is the only thing the new wording reliably changed. On the one ticket where it matters,
  the reviewer still decided the thin deliverable was enough.
- **The lever is upstream, where the narrowing happens.** Reviewers catch a narrowing that a stage
  wrote down as one, every time. LIN-4085's never was. This matches LIN-4128's finding 6: route a
  narrowing of a person's words to a ruling where it is made, not where it is judged. A next
  attempt would make scoping and plan name each cut to the ask as a cut, and send it for a
  ruling. Review would then be checking a written narrowing, which it already does reliably,
  rather than judging sufficiency, which it does not.
- **Limits.** This is three runs per cell, and both ticket outcomes sit at a ceiling (0/3 and
  3/3), so it cannot measure a small effect. It also tests only review. Plan-review kept its one
  quoted line. A reviewer here saw the ticket file and the code but not the brief, as in the first
  replay. Each run had its own clone. One LIN-1596 run wrote its mutation script into the shared
  `runs/` folder, one level above its own directory. The script uses only relative paths into that
  run's own clone and reads no other run.

The rendered prompts, the ticket files, the pre-registration and all 12 reviews are in
`docs/reviews/_evidence-2026-11-07-lin4345-replay/`.

## The change under test

Review's verdict sentence (`lib/prompt-template-defs.js`, commit `53f476b3` on PR #2348):

- **Old (shipped at `cdc324bc`):** "…with one line on how the work meets what was asked, quoted
  from the block, naming any narrowing; only the person's comment or answered ruling agrees to
  one, not a stage's scope or plan, else **Needs Discussion**."
- **New:** "…with how the work meets what was asked: take each sentence of the block in order,
  none skipped or cut short, and say where the work meets it; a sentence met in part or not at
  all is a narrowing, which only the person's comment or answered ruling agrees to, not a
  stage's scope or plan, else **Needs Discussion**."

Two Gap Analysis restatements were cut to pay for it, so the two rendered prompts differ in
those lines and nothing else. Plan-review is unchanged. The prompt-template change log row,
with expected direction `down`, was committed in `53f476b3` (16:57 UTC), before any run started.

## Setup (identical for every run)

- **The tickets, as review saw them.** Each description comes from Harbour's task snapshot taken
  just before review ran. The filed request (the person's message and its page/browser capture)
  is sealed in an `## As asked` block. The triage-first origin marker, scoping's scope and the
  plan sit below the block. Every comment posted before review is included.
  - **LIN-4085**: the snapshot of 2026-11-01T18:19:44Z (8 comments), as in the first replay.
  - **LIN-1596**: the snapshot of 2026-07-26T16:39:44Z (5 comments; review ran at 16:49).
- **Why LIN-1596.** It came from the feedback widget, so the block holds the person's own words.
  They asked for three things: the share of dispatches ending `[done]` against `[failed]`/`[aborted]`;
  the zero-touch merge rate ("X% of dispatched work landed without human touch, trend up is the KPI
  the whole product exists to move. That's the one I'd put at the top"); and "link each headline
  number to the evidence behind it". Scoping kept the first. It split the zero-touch rate and the
  links on the other 11 cards out to new tickets. No comment from the person and no ruling agreed
  to the split (`GET /rulings?issueIdentifier=LIN-1596&includeResolved=true` returns 0). The
  26 July review approved, conditional on the ledger.
- **The code.** Each run got its own clone, holding history only up to the merged change:
  `4f247b68` (LIN-4085, PR #2221) or `8963dd02` (LIN-1596, PR #1018). `change.diff` is
  `git diff HEAD^ HEAD`. Neither clone can reach a later commit, so a reviewer could not read the
  one-feature-twice essay, the A/B record, LIN-4090 or the first replay. `node_modules` was linked
  from today's checkout.
- **The reviewer.** A fresh Claude Code subagent (Opus 5.5), with no tracker, GitHub or network.
  It was told to read only its run directory, treat CI as green, revert any mutation and post
  nothing. The brief was the same for all 12 runs apart from the directory path. It named
  neither the guide, the KPI parts nor narrowing.
- **The prompt.** `generatePrompt('review', …)` rendered for each ticket, from a worktree at
  `cdc324bc` (old) and at `53f476b3` (new). Neither rendered prompt contains the ticket's words.
  Review points at the block and does not quote it (#369).

## Pass criterion (recorded before the runs)

A run passes when its verdict is **Needs Discussion**, or when it names the narrowed sentence as
a narrowing nobody agreed to. Only the person's comment or an answered ruling counts as agreement.

- **LIN-4085:** "essentially a full guide on how to properly configure Harper for whatever your
  situation is", against the 577-word guide.
- **LIN-1596:** the zero-touch, "landed without human touch" rate, which the person put at the
  top and which did not ship, or "link each headline number to the evidence behind it", where one
  card was linked.

A run fails if it names the narrowing but counts scoping, the plan or a follow-up ticket as
agreement. It also fails if it names the narrowing and approves without calling it unagreed.
Whether the verdict covered every sentence was recorded too, but not scored. Three runs per cell
cannot tell a one-run difference from noise. Only a clean separation would be read as an effect.
