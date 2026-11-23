**Title:** One blind read per change

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Since 12 Nov (A1, LIN-4396), a change is read blind before it merges, and close-out fixes what the read finds while the work is fresh. Since 22 Nov (#2496), close-out's own commits go back to review, so nothing merges unreviewed. Both stay. But close-out's gate asks for a blind read "since the review", so each re-review calls for a fresh blind read. A fresh reader always names one more small thing, close-out fixes it, and the round starts again. LIN-4531 (under LIN-4529) was approved at 08:09 on 23 Nov and went round five more times, with review approving every time. It merged about an hour and 12 sessions later than it would have before 22 Nov. LIN-4530 went round twice. John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work."

**What we want:** one blind read per change. Once a change has had its blind read, a re-review of close-out's own commits doesn't call for another. Close-out fixes what that one read found, the re-review checks those fixes, and the change merges. Do it by simplifying the existing gate, not by adding a counter or new machinery.

**Not in this ticket:** moving the blind read before review (for later); an owner for the findings to project that nothing reads yet, which goes to the clean-up ticket.

**This ticket lands under the gate it changes.** If it starts to loop, close-out merges at the approved head and files the rest to project.

**Witness:** the next LIN-4529 piece to reach close-out after this deploys lands after one blind read. **Reading** (reported after, never a gate): rounds per piece before and after (LIN-4530: 2; LIN-4531: 5).

**Done when** a change gets one blind read, the witness is recorded, and Harbour works throughout.

**Standing answers (John):**
- Retire what this replaces; don't keep slimmer versions.
- Tests move to the new shape in the same piece.
- No evals with real model calls.
- Settle engineering questions yourself; only John's calls go to him as rulings.
