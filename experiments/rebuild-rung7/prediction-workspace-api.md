# Rung 7: design-first rebuild of routes/workspace-api.js, prediction (written before launch)

**The XL single-file test.**

**Baseline** (`16e7ae77`, kit `shape.mjs`): 2,816 code lines, 113 functions, 769 decision points, 29 functions above 10; worst the feedback handler at 57.

About 8 tests read the file as source text: the free-tier model clamp, the Linear egress census, the OpenRouter chain, the runner enqueue and mint censuses, run-limit gating, the proxy-token store pin, and connection adoption. Security behaviour includes the image proxy, the owner gates, credential handling and the free-tier gate.

The ticket carries the efficiency and comment-retention wording, plus a new Done-when line: report the verbatim-line share, and explain anything above about 60% outside pinned text.

**Run**
- Not split: about 70%. Merges: about 65%. Done without a ruling: about 35%.
- 2–4 hours.

**Result**
- 2,300–2,650 code lines (a 6–18% cut).
- Decision points down 10–25%. Worst function at most 35: about 60%.
- Verbatim share 40–65%: about 65%. Above 65% (an edit, like rung 5c): about 25%.
- My replay (6,592 requests per seed plus a live tier of 5,399 tests per side) finds no regression: about 60%. If one ships, it's most likely in error handling the old code let escape as a plain 500 (a throwing free-tier store, `adoptConnectionCredential`, a repeated `?url=`), or in streaming timeouts.
