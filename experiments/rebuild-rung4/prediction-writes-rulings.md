# Rung 4: design-first informed rebuild of routes/proxy-writes.js + routes/proxy-rulings.js, prediction (written before launch)

**Baseline** (`06ec62b7`): see `arm/` (kit `shape.mjs`). `proxy-writes` has 693 code lines and a worst function of 39; `proxy-rulings` has 236 and 21. 15 URL forms in all, and 10 test files read the two as text.

**Run**
- Merges: about 70%. Done without a ruling: about 45%. It's the biggest and most constrained ticket so far, and plan review may hit its bound again.
- 70–150 minutes.

**Result**
- Combined 760–900 code lines (a 3–18% cut). Writes are dense with distinct provider calls, so there's less to share than in the read routes.
- Decision points down 15–30%. Worst function at most 25: about 60%.
- A shared helper module is added: about 40%. The files share little.
- Source-text conversions: 0–4, all within the allowed set (about 90%).
- My independent replay finds no agent-visible regression on writes or rulings: about 75%. A regression ships: about 20%, most likely in dedupe or `logEvent` details.

**Risk:** this is a writes boundary, where a wrong argument is a real-world change to a ticket. The replay compares every provider write's arguments, so a regression would show; the question is whether the worker's fakes and mine both reach the rare paths (partial writes, ref resolution).
