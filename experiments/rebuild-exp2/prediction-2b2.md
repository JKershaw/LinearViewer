# Experiment 2b, part 2 (clean room on the strengthened contract): prediction (written before launch)

**Baseline, today's code** (`c2bc9a65`, kit `shape.mjs`): 318 code lines, 80 functions, 129 decision points, worst function 12. LIN-3564's inline-code fix added 34 code lines and about 19 decision points to 2a's 284 and 110. The contract is 200 tests, against 2a's 133, and the spec now covers display.

**Run**
- Room, launch and audit go without a hitch (0 violations): about 85% likely.
- Merges without John: about 65%. Done without a ruling: about 60%. The ticket says no live check is needed, but close-out asked for one twice before.
- 45–100 minutes to merge.

**Raw clean-room output**
- Passes all 200 tests: about 60%. There are more and stricter tests, and the display tests go through `marked`.
- 250–340 code lines; 95–140 decision points; worst function at most 15 (about 70%).
- Replay against today: 20–120 groups, fewer than 2a raw's 140, because more is pinned.
- The bracket-link regression doesn't recur: about 85% (it is pinned now).
- The inline-code behaviour is kept: about 75% (the spec describes it in detail and tests pin it).

**Pipeline**
- 1–5 regressions found by the replay, and fixed or dropped as edge cases.
- At least one regression is found by review rather than implementation: about 40%.
- A user-visible regression ships and is found later by my private replay or display check: about 20%. It was 100% in 2a.

**Final code**
- Cleaner than today on both code lines and decision points: about 60%.
- Planted-fault score with the 200 tests: 85–92%.

**Main risk:** the 200-test contract is now stricter than any earlier clean room faced. The sub-agent may burn time on display-test edge cases, or bend the structure to fit them, which would make it less flat than 2a.
