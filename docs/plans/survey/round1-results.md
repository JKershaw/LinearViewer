# Round 1 results: Harbour carries the loop

LIN-4344, 7–8 November 2026. A short note for the discussion. The full record is in `log.md`.

## What Harbour now carries

At the start of the round, a person (John, or this session for him) did each of these by hand.

| Then (by hand) | Now (in Harbour) | Ticket |
|---|---|---|
| Keeping the person's words intact through every stage | An "As asked" block that only code writes, read by every step. Cuts are named and go to the person. A hand-written block is refused, as happened live on LIN-4393. | LIN-4345 |
| Deciding how big a move is, then running Surveys and scoping in order | Scoping writes a size record on the ticket, and code runs the look-first sequence (Surveys, then scoping) at both recommendation seams. The standing-policy setting was removed (LIN-4393): Harbour runs hands-off and errs larger. | LIN-4346 |
| Remembering what a change left behind in its area | The builder is asked what its change left behind. Review reads that, and close-out writes it to `docs/areas/*.md` in both repos. The next change in the area reads those notes. One deferred note was picked up this way on LIN-4346's close-out. | LIN-4347 |
| Keeping lists of model facts by hand | Model facts come from the OpenRouter catalogue. A cut-off reply is never stored as if it were complete. | LIN-4358 |
| Noticing that one session had used up everyone's rate limit | Each credential gets its own budget, and an agent over its limit gets a 429 with a wait time and backs off. | LIN-4378 (incident) |
| Minting Periodicals, and triaging the tickets they produced | Periodicals feed the area notes and mint nothing. Landed work makes their lanes due. Autopilot's order of work is written once, and it ranks this work below real work. Live today: autopilot picked the Stability Review by that order and explained why. | LIN-4349 |

Parked: LIN-4348 (choosing the contractor) and LIN-4350 (folding repeated rules into one).

## Did the areas end better?

These are blind reads of each area's code: two readers on Opus at high effort, with no ticket text.

| Area | First read | After tidy | Tidies | Cost (USD, API-equivalent) |
|---|---|---|---|---|
| LIN-4345 words sealed | better, better (read with its tidy) | n/a | 1 (LIN-4354) | 282 |
| LIN-4347 leftovers and notes | mixed, mixed | better, better | 2 (LIN-4376, LIN-4377) | 180 |
| LIN-4378 rate limit | mixed, mixed | better, better | 1 (rode the close-out) | 24 |
| LIN-4358 models from catalogue | better, better | n/a | 0 | 60 |
| LIN-4349 Periodicals | slightly better, slightly better | n/a | 0 | 83 |
| LIN-4346 size of the move | mixed, mixed | mixed, mixed | 1 (LIN-4393) | 211+ |

**Five areas ended better and one ended mixed.** The total is about $857 across 36 tickets, including pieces, tidies and two Periodicals. The blind reads themselves aren't counted.

Patterns:
- **Size and result move in opposite directions.** LIN-4378, kept small on purpose, was the cheapest area and read better. LIN-4346 was the largest move (four pieces plus a pre-registered replay; the replay alone cost $111) and the only area that ended mixed.
- **One leftover appeared in every read:** ticket and ruling history written into code comments. It's the loop's own habit, and it comes back after each cleanup.
- **The leftovers that remain are recorded,** as Waiting entries in the area notes, not as tickets.

## The spiral, and how it was reined in

- **What happened.** Six tickets became about seventeen by 10:00 on 8 November. Almost all of the growth came from this session filing every find as a ticket. The one part of the loop Harbour doesn't regiment is the part that spiralled.
- **The counterweights, from 10:25:**
  - nothing new unless it blocks or tidies;
  - one tidy per area;
  - leftovers go to the notes;
  - a check that fails twice goes to John;
  - "err larger" means one fuller change, not more tickets;
  - LIN-4348 and LIN-4350 parked.
- **After that,** every tidy rode its own ticket's close-out or a single ticket. Three Periodicals ran under the new contract (LIN-4387, LIN-4391, LIN-4394) and none minted a ticket.
- **What still leaked:** Harbour's own close-outs filed four tickets during the round (LIN-4388, 4389, 4390, 4392). The counterweights lived in this session's briefs, not in the product, so stages that never read those briefs still filed finds as tickets.

## How Harbour came to ship an unusable setting

1. This session's brief for LIN-4346 turned John's standing answer, "err larger", into a mechanism nobody had asked for: "a setting a person makes once".
2. The Surveys made it concrete, and the size call made it a requirement. The parrot passed it twice, because the words were John's.
3. Harbour built it faithfully, every test passed, and it shipped.
4. John met it as an unexplained mandatory question: "obviously wrong and a mistake".
5. This session then compounded the mistake twice: first by calling it a Harbour gap that needed another check, then by steering a running session.

The root is the same as the spiral's: the operator stepped down to "how" and acted fast.

The fix went through the loop. A ticket carried John's words. The parrot was told to look for "how", and it cut how out of both the brief and the size call. The setting was removed 45 minutes after John's call, with less code than before.

## Questions to step back on

1. **Roles.** What do John, the operator session and Harbour each do? Which parts that can go wrong become formal features?
2. **Where the counterweights live.** "Leftovers go to the notes, not tickets" held where this session's briefs reached, but not in Harbour's own close-outs. Should it become product behaviour?
3. **One tidy per area.** Should an area be allowed to end mixed (LIN-4346), or does the limit want a different shape, such as a size cap up front?
4. **Settings in general**, and what becomes of the size record now that its policy is fixed.
5. **Model defaults:** stay on mini or move to Luna, which needs evidence. Should worker stages get a capped key? That wall came up twice.
6. **Evidence in git.** Two Periodicals today committed about 87k and 118k lines of raw evidence; `docs/reviews/` is 77 MB of a 210 MB tree.
7. **Engineering calls raised as rulings,** and rulings asked more than once about one blocker (three deploy rulings).
8. **The four session-filed tickets** (LIN-4388, 4389, 4390, 4392): run them, fold them into the notes, or let them wait?
9. **Does a Survey pair earn its cost on every ticket,** or would one look do for small moves?
