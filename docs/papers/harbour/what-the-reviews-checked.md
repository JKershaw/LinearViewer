---
title: What did the reviews behind the thirteen later-found misses check, and what would have caught each one?
version: 1
date: 2026-09-18
authors: [Claude]
model: claude-opus-5, Claude Code CLI, effort default; the dispatch lineage for this item (kind `research`, dispatch `0bd35d13`) carries no model or harness field, so the model is named from the session
grounded_at: bf718323 (LinearViewer); d0e809e3 (simple-dispatcher)
cites: [lib/flight-companion-gate.js@bf718323:593, lib/effort-readout.js@bf718323:597, lib/openrouter.js@bf718323:1179, lib/openrouter.js@bf718323:988, lib/providers/linear/index.js@bf718323:1710, public/flight-companion.js@bf718323:503, terminal-driver.js@d0e809e3:840 (simple-dispatcher), docs/papers/harbour/ticket-record-and-quality.md@249a432d, LIN-2515 (9fddcbca, b5df723c, 2026-09-05), LIN-2516 (08261320, e5b61dc2, 2026-09-04), LIN-2527 (0b19c466, 2026-09-04), LIN-2618 (75471b2b, 8d6dd357, 2026-09-05), LIN-2619 (1304c883, f011f504, 2026-09-05), LIN-2621 (8a74433f, 781497ee, 2026-09-05), LIN-2631 (426683fb, a8c39e55, 2026-09-05), LIN-2637 (e8b2645e, fb2f8c6c, 2026-09-13), LIN-2641 (884159f9, 46149d84, 2026-09-05), LIN-2645 (21c797ed, 9fd985ae, 2026-09-13), LIN-2773 (ca46f62f, 2026-09-11), LIN-2775 (2e43b5c9, 2026-09-11), LIN-2787 (description, 2026-09-11), PR #1400, PR #1403, PR #1405, PR #1407, PR #1420, PR #1441, PR #1443, PR #1479, PR #1486]
---

# What did the reviews behind the thirteen later-found misses check, and what would have caught each one?

They checked a great deal, and in six of the thirteen pairs they checked the very thing the
later Bug names — the bug ticket is the review's own output, filed from its ledger, and the
tracker labels it so. Of the seven genuine misses, not one would have been caught by another
review round: two were outside every class any review bounded and visible only on the running
page, two were inside a class a review named and stopped short of enumerating, one was a
ledger item discharged by filing a witness instead of running it, and two were claims a
close-out wrote after the last reviewer had gone. The fixes are all cheaper than the rounds
already spent: a five-minute host witness, a finished grep, one page load, one reader for the
close-out. Twenty review and plan-review sessions on these tickets cost $99.81, a median
$4.59 a round.

## Findings

**Six of the thirteen later bugs are what the review produced, not what it missed.** LIN-2637's
review named `getRecommendationStream` as the live, unfixed second instance of its own class
(`e8b2645e`, "INSIDE"); close-out dropped it in terms — *"the `getRecommendationStream` bug is
real, live-reachable today, and is being left undone by this ticket"* — and filed LIN-2854
(`fb2f8c6c`). LIN-2645's review named the seed-turn gate as one unhandled instance "marked
OUTSIDE" (`21c797ed`, L3); close-out filed LIN-2849 (`9fd985ae`). LIN-2631's close-out ticked
the hop-usage criterion as *"Met at the seam; inert in production, and the docblock now says
so"* (`426683fb`), its round-2 review carried it as ledger item 3 (`a8c39e55`), and LIN-2621's
review made it hard gate item 2 with John accepting V1 on the record (`8a74433f`, `781497ee`)
— LIN-2705 is that acceptance's standing condition. LIN-2522/2523 and LIN-2527 had no review
of their own; their gate was the parent's, and it caught both — F5 became LIN-2553 and F2
became LIN-2551 (`08261320`, routed at `e5b61dc2`). Five of the ten bug tickets carry the label
`kind:review-residue` and four `kind:follow-up`. Counting nine reviewed tickets as nine review
failures, as `ticket-record-and-quality.md@249a432d` does by construction, overstates by half.

**LIN-2527's defect was declared before it shipped, by the ticket that shipped it.** Its
close-out posted a correction the same hour: the 4-item row *"genuinely wraps at 360-430px"*,
fixing it needs `public/style.css` outside the lane's carve, and *"not reopening this ticket"*
(`0b19c466`). The parent review then measured the same overflow at four widths. This is a
priced decision, not a miss.

**The one genuinely invisible inert shipment had its check written on the ledger and filed
instead of run.** LIN-2515's third review named it as ledger item 1 — the acceptance criterion
is a real logged-out host, *"inherently unprovable pre-merge"*, with the five-step procedure
and `SILENT_START_CAPTURE_MS=0` as the rollback (`9fddcbca`). Close-out recorded it
"Discharged (a) — routed to LIN-2595" (`b5df723c`). The witness has never been run; LIN-2595 is
open, and `terminal-driver.js@d0e809e3:840` is still `capture() { return null; }`, which is
what makes the whole blocked-startup allow-list dead under `SD_TERMINAL=terminal` (LIN-2611,
still Backlog). The review's own class check swept for *other handlers of these dialogs* and
found none; it never asked whether each driver could produce a capture at all. The check that
would have caught it is either the witness, on the driver the host actually runs, or one grep
for `capture()` across the drivers — against $18.99 and three rounds of review (`984cebc9`,
`92dbf7f6`, `9fddcbca`) and a 19-mutation ledger that caught 18.

**Two misses were outside every class named, and both were only visible on the running page.**
LIN-2618 passed a plan review (`75471b2b`) and two implementation rounds that checked shared
sections rendering exactly once, section order by monotonic cursor, a claims blacklist, and
four files of stale prose (`8d6dd357`) — all of it text against text. What shipped was a brief
telling the model to answer with a numbered list onto a bubble that sets `textContent`, so it
rendered as raw `#` and `*`; John found it by looking (LIN-2670). Repairing it cost **$79.51**
through the full gated pipeline. LIN-2621's review did open a real browser at 390×844 and read
computed colours in both themes (`8a74433f`) — so "look at the page" was already happening; it
looked at the affordance it was asked about. `parseDecisionsResult`
(`public/flight-companion.js@bf718323:503`) discards the `count` and `truncated` the tool
returns, so a withheld decision has no card and no line (LIN-2722, found by a sibling's review
five days later). The cure is a question, not a session: *what does the page do with every
field the tool returns?*

**Two misses sat inside a class the review named and swept incompletely.** LIN-2619's review
named it precisely — consumers reading the fossil-filtered attention list as the whole
population — grepped `lib/` and `routes/`, reported three starved readers and routed them to
LIN-2645 (`1304c883`, ledger 2). The fourth reader sits in the file that review had just
approved: `lib/flight-companion-gate.js@bf718323:593`, `surface = currentSnapshot.attentionCount
> 0`. It surfaced eight days later in LIN-2645's review for $2.88 and is still open. LIN-2641's
R1 was the caption-honesty finding, re-proved against this workspace's real telemetry
(`884159f9`); it checked the caption's numeric claim and not the ticket-state claim in the same
sentence. `lib/effort-readout.js@bf718323:597` still reads *"LIN-2567, tracked separately, in
progress"* — false since 2026-09-05T16:11Z, and the ticket that owns it (LIN-2683) is Backlog a
fortnight on. Both fixes are finishing the sweep the review started: enumerate every reader,
every claim in the string.

**The two false record claims were made after the last reviewer had gone, and nothing reads a
close-out.** LIN-2773's close-out records *"this workspace's catalog (`GET /api/proxy/labels`)
offers only `small-model-candidate`, `scoping`, `in-research` — none is a type label"*
(`ca46f62f`); LIN-2775's repeats it (`2e43b5c9`). Both called the endpoint with `?teamId=`,
which the instruction does not say, and which dropped every workspace-level label — `Bug`,
`Feature`, `Improvement` among them. Review precedes close-out by construction, so a close-out
claim has no reader at all; the disproof was free and same-day, since LIN-2774's close-out
applied `Bug` in the same run (LIN-2787). Repair cost **$2.84** (`lib/providers/linear/index.js@bf718323:1710`).
The check is one reader for the close-out, or a close-out that re-runs the literal call its
instruction names.

**Extra rounds are the expensive thing and bought none of these.** The twenty review and
plan-review sessions on the nine gated tickets cost $99.81, median $4.59, max $7.99. LIN-2641
spent five plan-review rounds ($24.74) and two implementation rounds ($11.52) on a 1,957-line
PR and its later fault is one sentence of caption. Four of the nine misses came after three
rounds. Every fix priced here is under one round: the host witness is minutes, the class sweep
is a grep, the page load is a look, and a second reader for a close-out prices at about one
review session if dispatched — against a $79.51 repair when the look does not happen.

| Miss class | Pairs | The one check | Its price |
|---|---|---|---|
| Not a miss — review named it and routed it | 6 | none needed | — |
| Outside every named class (page-level) | 2 | one production read, one field-by-field question | minutes; vs $79.51 repaired |
| Inside a named class, sweep stopped short | 2 | finish the enumeration in the review that named the class | one grep; vs $2.88 to re-find |
| Ledger item discharged by filing, not by a witness | 1 | run the named witness on the driver in use | minutes; vs $18.99 of review |
| Record claim never read by anyone | 2 | a reader for the close-out, or re-run the literal call | ~$4.6 if dispatched; vs $2.84 repaired |

## Method

The thirteen pairs and their kinds are taken from `ticket-record-and-quality.md@249a432d`'s
hand-read. For each Done ticket, every review, plan-review and close-out comment was read in
full through `GET /api/proxy/issues/LIN-n` at no more than one call a second, in this order
before the bug was opened: which classes the review named and bounded; whether the later fault
is inside one; whether a `### What CI Did Not Prove` item covered it and how it was discharged
(evidence, accepted, named monitor, filed); and what the claim was verified against — a unit
test, a mock, CI, a production read, nothing. The miss was then classified as (1) outside every
named class, (2) inside a named class not swept, (3) a ledger item discharged against a mock,
CI or a filing rather than a witness, or (4) a record claim never checked; a fifth verdict,
*named and routed*, was added during the read because six pairs demanded it — the Bug ticket
cites the review comment that found it. Costs are `GET /api/proxy/issues/LIN-n/cost`, summed
over sessions of kind `review` and `plan-review`. PR sizes are `git diff --shortstat` on the
landed squashes of PR #1400, #1403, #1405, #1407, #1420, #1441, #1443, #1479 and #1486. Every
still-live code claim was re-read at `bf718323` (LinearViewer) or `d0e809e3`
(simple-dispatcher).

## Limits

Thirteen is small, and it is what one cohort exposed in eighteen days: a defect nobody filed a
Bug for, or filed without naming the ticket, is not here, and the bias runs toward faults that
a *review* was articulate about, since those get filed with a citation. The *named and routed*
verdict rests on the bug ticket's own provenance line, which is the filing session's account of
itself; in four of the six the review comment states the finding independently, in two
(LIN-2551, LIN-2553) the lane tickets had no review of their own and the parent's stands in.
Four of the thirteen Done tickets carry no priced lineage: LIN-2522, LIN-2523 and LIN-2527,
whose gate was the parent's own review, and LIN-2618, whose plan review and two implementation
rounds were in-lane fresh-context sub-agent reviews recorded inside its own close-out
(`8d6dd357`) rather than dispatched review sessions. So the $99.81 across twenty review and
plan-review sessions prices nine gated tickets, not all ten reviewed ones. Pricing a fix at
"one grep" is an estimate of the work, not a measured session. Nothing here says whether the
reviews' many *caught* findings were worth their rounds; only that the rounds did not produce
these seven.

## Next

Count the residue: sweep every `kind:review-residue` and `kind:follow-up` Bug filed in the
cohort and report how many are still open, how long they wait, and whether a review naming a
fault makes it more or less likely to be fixed than a fault found by a user. Give the close-out
a reader — dispatch one cheap pass over ten close-outs whose only job is to re-run the literal
calls their claims rest on, and count false claims found per dollar. Make the class check
terminal: require a review that names a class to list every member with a line citation, and
re-measure the class-2 misses a month later.

One line goes into `proposals.md` with this paper.
