# Front end: server-rendered pages

Area notes for `front-end-pages` in the registry. Format and rules: README.md.

## Lessons

- A control a page renders per row (a select or input in each Settings row) needs its own accessible name: a `<label>`, `aria-label` or `aria-labelledby`. A placeholder or a visible word beside it is not enough. Settings › Models renders 86 unnamed controls, one set per job row (Design & Interface Review, 8 Nov 2026; `lib/render-settings.js`, `docs/reviews/design-interface-review-2026-11-08.md`).

## Waiting

- `lib/render-settings.js`: Settings › Models has 42 unnamed `select.harness-select`, 42 unnamed `input.dispatch-effort-input` (one per job row) and 2 unnamed `input.dispatch-preset-name-input` (WCAG 4.1.2). The other seven areas have none. Lighthouse on Settings ran on the sources area and missed this. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/render-proxy.js`: the Proxy scope `select.proxy-scope-select` has no accessible name, and the token label input `input.token-label-input` has only a placeholder ("Label (optional)"). (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/render-swipe.js`: the viewport meta is `user-scalable=no`, which blocks pinch zoom on a public page (WCAG 1.4.4; Lighthouse `meta-viewport` fails). Run 9 found it too and it was not ticketed. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/render-pages.js`: the Jira site picker, `renderJiraSiteSelectPage`, overflows a 390px viewport by 52px and a 320px one by 122px. The native `select#jira-site-select` has its right edge at 442px. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/components/halt-controls.js`: in the `buttons` presentation (Dispatch) Pause, Stop and Resume compute to the same style, and the tone the component declares (red for Pause and Stop) is not applied. Stop stops running sessions. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/render-library.js`: every Library document renders two `<h1>` (the shell "Harbour" and the document title), 117 of 117. The index renders one. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
- `lib/render-styleguide.js`: in dark theme the swatch captions under `.sg-value` show light-theme values (`#ffffff` for `--bg`, `#1a1a1a` for `--fg`) beside dark swatches. LIN-3957 and LIN-3960 are open on this page and do not cover it. (Design & Interface Review, 8 Nov 2026; `docs/reviews/design-interface-review-2026-11-08.md`.)
