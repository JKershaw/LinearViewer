# Experiment 2b, part 1 (test review): prediction (written before launch)

- **Merges without John:** about 75% likely. 1–2 review rounds; 6–12 dispatches; 40–90 minutes.
- **Bracket display:** fixed with a 1–3 line change to the href escaping, about 90% likely.
- **The 46 gap rows:** 25–40 covered by tests, 3–12 marked "equivalent", 2–10 "edge case dropped".
- **Tests added:** 40–150 lines, mostly table-driven.
- **Other behaviour fixes found** (beyond brackets): 0–3.
- **Planted-fault score on today's code** with the new tests: rises from 83% to 90–95%. Output-changing survivors fall from 46 to 5–15.
- **Risk:** scope creep into a rewrite, or a pile of near-duplicate tests (the "life of their own" pattern). Expected to be held off by the gap list's bounded scope.
