# Rung 5b: design-first rebuild of the page renderer cluster in one PR, prediction (written before launch)

**The Large test.** Four files in one change, about 2.5× rung 4's size: `lib/render.js`, `lib/render-session.js`, `lib/render-swipe.js` and `lib/render-settings.js`.

**Baseline** (`f4749b91`, kit `shape.mjs`):
- Code lines 579 / 435 / 420 / 879 (2,313 in all); decision points 311 / 228 / 184 / 194 (917).
- Worst functions: `renderDetailsContent` 75, `renderSessionPage` 75, `renderSwipePage` 41, `renderSettingsPage` 39.
- The page contract is 424 tokens (78 `data-*`, 99 `data-testid`, 3 ids, 244 classes) used by browser JS, CSS, `llms.txt` or tests.
- `render-session-golden` pins the run page byte for byte.
- The ticket says "This is one PR. Don't split it into child tickets."

**Run**
- Harbour doesn't split it: about 65%. It's the largest ticket yet, so plan review may push for phases.
- Merges: about 65%. Done without a ruling: about 35%.
- 2–5 hours.

**Result**
- Combined 1,750–2,150 code lines (a 7–24% cut). The settings page is mostly copy and markup, and doesn't shrink much.
- Decision points down 15–30%. The two worst functions both below 40: about 55%.
- A shared helper module is added: about 60%. The four files share escaping, badges and row markup.
- My replay (19,856 inputs; coverage at least 99.9% per file) finds no change to the page contract: about 70%.
- Some whitespace-only differences outside the golden-pinned run page: about 50%.
- A visible regression ships: about 25%, most likely in unescaped-by-design values, local-time dates or in-place sort order.
