**Input 5: open items at close,** as of 26 Oct, about 08:00Z, written by the operator. In-flight work may have landed since. The ticket index it mentions is input 6.

---

# Open items at the close of charter LIN-3490

As of 26 Oct, about 08:00Z. Main is at `d3f67854`. The check-in at about 09:17Z updates the "In flight" section.

## In flight (John: "Work in flight will finish.")

| Ticket | What's running | Since |
|---|---|---|
| LIN-3975 task page | PRs 2–3, stacked as #2169 (no CI while stacked). PR 1 merged as `2ab5e675` | implementation from 06:52Z |
| LIN-3983 Observation | PR 2: words and pieces, judge entries, workspace-scope default, selector migration. PR 1 merged as `d3f67854` | implementation from 06:52Z |

Nothing else launches.

## Needs John

1. **LIN-3952, Models polish.**
   - **State:** PR #2165 is green, with a conditional Approve at 05:15Z. It isn't merged, and its autopilot wake is `blocked`.
   - **Its ruling** `lin3952-nojob-dispatch-audience` reads `gone`: no session is waiting to take the answer. Pressing the ruling alone won't finish the ticket; a close-out would have to be sent to it.
   - **The two options on "No job":**
     - **Any member:** today's behaviour, what's built, and the builder's recommendation.
     - **Owner-only:** the operator's pre-fill, against its own rules block.
   - **To decide:** finish the ticket, or park it for the retro.
2. **Rulings to clear.** The seven LIN-3975 and LIN-3983 rulings are all overtaken: the work they asked about has been done or decided. Each has an operator suggestion stored on it, but none has been pressed:
   - `lin3975-pr-count`
   - `lin3975-stack-or-wait`
   - `lin3975-remainder-scope`
   - `lin3983-default-feed-filter`
   - `lin3983-compact-row-rule`
   - `lin3983-breakdown-route`
   - `lin3983-pr1-scope`
3. **Production checks** (the charter's list, with ticket review Q9):
   - LIN-3719 backfill (dry run, then `--write`);
   - LIN-3882's six model pins;
   - LIN-3977's checks (Live Console as runner owner, reduced motion);
   - Home on a phone in light and dark;
   - Landing at 390px, and the preview card;
   - `/account` and the workspace-not-found page on Plain.
4. **Open questions kept at today's behaviour** (ticket review Q6):
   - LIN-3987: Claude Code price;
   - LIN-3992: "From Models" or "As Settings › Models sets it";
   - LIN-3952: stage renames and the fold cutoff;
   - LIN-3970: KPI scope.

## Left for the retro to decide

- **Not started:**
  - LIN-3976 run page
  - LIN-3978 Dispatch
  - LIN-3982 Swipe
  - LIN-4002 Live Console round 2
  - LIN-3970 to LIN-3973, the Plain batches
- **No ticket:** Swim, the feedback widget, the Audit → Health fold, the whole-stylesheet review, the Design & Interface Review re-run.
- **Tickets filed since 23 Oct:** 234 in all. 120 are Done, 5 Canceled, 3 In Progress, and 106 still open:

  | Priority | Open |
  |---|---|
  | High | 4 |
  | Medium | 54 |
  | Low | 42 |
  | No priority | 6 |

  Check any retro follow-up against these before filing it. The list is in `review/tickets-index.csv`.
- **Parents still Todo though their children are Done:** LIN-3757, LIN-3820 and LIN-3892.
- **Todo with no outcome:** LIN-3758 (RCA), LIN-3769 (Railway triage) and LIN-3770.
- **Costs (LIN-3936):** paused. LIN-3937's PR #2136 is open, after a run aborted at $52 priced.
- **The charter ticket (LIN-3490):** a closing note pointing to the retro, once in-flight work lands. Its description is stale ("Running now", as of 25 Oct 11:30Z) and its log stops at 25 Oct 18:31Z.

## Housekeeping

- **The operator's proxy token** lasts until 27 Oct 18:34Z.
- **simple-dispatcher PR #286** (LIN-3827, comment-only) is unmerged. Merging it restarts the dispatcher, so it waits for a quiet window after the in-flight work.
- **The watcher** is still running.
- **Check-in 29** fires at about 09:17Z. It is observe-only, and re-arms once only while work is still running.
- **The read-only checkouts** `review/base` and `review/head` get removed after the retro.
- **Another session's Haiku trial** ("Haiku trial: final check-in and report") reports at 14:30Z today. It's relevant to the retro, because the ticket review couldn't tell whether Haiku implementation raised the number of rounds.
- **The Charter Tracker dashboard**'s budget readings stop at 76% (25 Oct 18:05Z). The later readings are 80% at 19:40Z and 91% at about 07:00Z on 26 Oct.
