# Costs prototype

`prototype.dc.html` is the desktop board of the Settings › Costs prototype that `docs/plans/costs.md` describes. It was built in a design canvas, and it does not run here, because it needs that canvas's runtime (`support.js`).

Read it as source:

- **Markup** (top of the file) gives the layout, section order, copy and how each chart is built. It has no `data-testid`s; production adds them.
- **`renderVals()`** (the `class Component` script at the bottom) holds the sample data and the rules: how the ways of paying apply in order (`applied`), the waterfall, the tiles, the day-by-day series (`TREND`, the ratio-of-sums 7-day figure), the Worth a look rules and the empty and Phase 1 states.

The phone board is the same file at 390px wide; the layout changes only through the stylesheet's `max-width: 760px` rules.

Sample data is Harbour's own workspace from 26 Sep to 24 Oct 2026, read through the proxy on 25 Oct. Figures are illustrative, not a test fixture. The fonts load from Google Fonts here; production self-hosts them (`public/fonts/`). Colours are the prototype's, chosen to match `public/style.css` tokens; production uses the tokens.
