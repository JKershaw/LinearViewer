# Walk 2: what the design predicts, written before looking

*Written 17 Nov from `design.md` round 2 (`79acac747`), before the round 2 model is in use, the parent is seeded, or any stage is replayed. Each line is a prediction [my reading]; afterwards each is marked **held**, **failed** or **can't tell**, with why. Expectations for LIN-4472 and LIN-4455 are written after LIN-4450 has been reviewed.*

## LIN-4450 (the control)

### Walk 1's breaks, now

1. **W1.1** Review's and blind read's verdicts hold their reasoning, and their outcomes fit the declared sets without forcing (review approve-with-notes or approve; blind read better).
2. **W1.2** The survey's live probe ends `handed-on` to review's or close-out's checks, not `declined`.
3. **W1.3** Close-out's fixes after approval give the `change` a new head, so review's and blind read's verdicts show as resting on a moved version in close-out's `show`. *The gap trace 1 named ("nobody re-reads these") becomes visible.* A **break** if nothing flags it.
4. **W1.4** Implementation's departures become a new version of piece 1 only. Plan review's verdict on piece 1 shows stale; its verdicts on pieces 2 and 3 do not. The breakdown's decision, if it rests on piece 1's verdict, is flagged.
5. **W1.5** Every brief opens with LIN-4445's ask (1,254 characters), including John's "Settle engineering questions yourself".
6. **W1.6** Only survey-place's brief carries the areas' open findings (the test-token entry among them). Implementation's carries none. Whether survey-place takes the test-token entry on (as the real `Retires:` line did) shows as a recorded re-address, or doesn't happen.
7. **W1.7** Briefs count as open only hand-offs. Close-out's open count falls from walk 1's 20 to 10 or fewer.

### Routing, now written by the stages

8. **Every hand-off gets an addressee from its writer;** none is guessed. At least 80% of hand-offs reach a reader that later sees them in a brief and ends or hands them on.
9. **Survey findings go mostly to `implementation`,** not to the task; "better still, not this task's" goes to the providers area.
10. **Rule 1 forces close-out to deal with everything addressed to the task** before it closes: a refusal or two, then ends or hand-ons. That is the rule working, not a break.

### What each stage was given

11. **Briefs grow across the task but stay below the child ticket from scoping on.** Each is larger than in walk 1 by about the parent's ask. Against the snapshots (5,424 at survey-task to 29,856 at close-out): survey-task's brief about the same as its ticket, close-out's under half.
12. **Each stage names at most two things its real output relied on that its brief didn't carry.** The likeliest: the code itself (outside, not a break); the parent's design reasoning beyond piece 1 (a break if the build's departures depended on it); for review, the PR's diff (outside).

### Refusals in motion

13. **A few refusals, each corrected by the stage:** a missing `to`, an undeclared kind.
14. **The leftover follow-up has no declared stage** (§3.2's table lacks it). Its records are refused, or folded into implementation's run. A **break** in the stage table, small, if refused.

### What would count as a break

As `design.md` §5, each with why: a stage that can't place what it found; a brief missing what its real output relied on, or carrying what it didn't need; routing that sends a thing nowhere or to the wrong reader; a brief growing with history rather than with what is open; a rule refusing something right.
