# Rung 2: design-first informed rebuild of lib/render-roadmap.js, prediction (written before launch)

**Baseline** (`c2bc9a65`, kit `shape.mjs`): 375 code lines, 87 comment lines. The worst function is `renderRoadmapPage` (34 decision points, 148 code lines); next is `renderProjectCard` (22, 130). About 73 unit tests touch it across 4 files, plus one e2e spec.

**Run**
- Merges: about 75%. Done without a ruling: about 60%.
- 50–120 minutes. 1–2 review rounds.
- The worker builds the replay as asked (≥2,000 generated inputs, fixed clock): about 70%. Most likely shortfall: thin generated coverage of options such as models with pricing, teams and flags.

**Result**
- 230–330 code lines (a 12–40% cut). Worst function at most 15 decision points: about 65%. No function over 60 code lines: about 70%.
- The design departs from today's two-giant-function shape (render per section, small pure helpers): about 80%.
- The replay finds 0–6 behaviour changes. Most likely: whitespace or attribute-order harmless changes, and an escaping difference.
- A user-visible regression ships, found by my own independent replay or the e2e run: about 20%.

**Main risk:** the page's contract is thin. Its tests check selected strings, not the whole page, so the replay is the real safety net, and it's only as good as the inputs the worker generates. My own independent replay after the merge is the check on that.
