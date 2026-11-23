**Title:** A change lands after one blind read, and close-out fixes only what shouldn't land as it is

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Since 22 Nov (#2496), close-out's own commits go back to review, so nothing merges unreviewed. That stays. But each re-review also calls for a fresh blind read ("no blind read on record since the review"). A fresh reader can always name one more small thing, and close-out fixes every fix-sized find before merge, so each fix is a commit that starts the round again. LIN-4531 (under LIN-4529) was approved at 08:09 on 23 Nov and went round five more times. Review approved every time. Close-out wrote itself 9, 4, 2 and 1 fix-ups (duplicated helpers, stale comments, a repeated error body), and it merged about an hour and 12 sessions later than it would have before 22 Nov. LIN-4530 went round twice. John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work."

**What we want:**
1. **One blind read per change.** A re-review of close-out's own commits does not call for another blind read. The re-review after close-out's changes stays.
2. **Close-out fixes only what shouldn't land as it is.** Before merge, close-out makes the fixes review asked for, and fixes a blind-read or leftover find only when landing without it would be a mistake: it is wrong, misleading, or a trap for the next change. Smaller shape points (a second copy, a stale comment, a repeated block) are filed to project with one line on why they can wait, or dropped. Close-out does no tidying pass of its own. The agents judge which is which; the prompts give them that bar and the permission to use it, rather than a rule that every inside find is fixed.
3. **The blind read's hand-off says the same.** It sends close-out only finds that clear that bar; the rest go to project as now.

So a change lands after one review, one blind read and, when close-out commits, one re-review.

**Not in this ticket:** moving the blind read before review, so the builder fixes its finds while warm (the 5 Nov "after inside the lineage" idea, for later); an owner for the findings to project that nothing reads yet (95 from blind reads, all open), which goes to the clean-up ticket.

**This ticket lands under the gate it changes.** If it starts to loop, close-out merges at the approved head and files the rest to project.

**Witness:** the next LIN-4529 piece to reach close-out after this deploys lands without a second blind read. **Reading** (reported after, never a gate): rounds per piece before and after (LIN-4530: 2; LIN-4531: 5).

**Done when** items 1–3 hold, the witness is recorded, and Harbour works throughout.

**Standing answers (John):**
- Retire what this replaces; don't keep slimmer versions.
- Tests move to the new shape in the same piece.
- No evals with real model calls.
- Settle engineering questions yourself; only John's calls go to him as rulings.
