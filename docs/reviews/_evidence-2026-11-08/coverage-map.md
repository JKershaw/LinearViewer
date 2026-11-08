# Coverage map: design & interface review, run 10 (LIN-4391)

Head `c998cf4c5` (main, unchanged by this run). Window `0b4bd287..c998cf4c5`: 419 commits. Server: `boot-3199.mjs`, scratch data dir, `:3199`.
Every number below comes from a JSON file in this folder; the report cites the file, not this map.

## Registry (`registry.json`, built by `capture/build-registry.mjs`)

- Route handlers found by grep: 66 (63 at prior `0b4bd287`, 3 new). Page GET destinations: 55 (52 carried).
- New: `/getting-started` (+ `.md`), `/workspace/:urlKey/backlog`, `/workspace/:urlKey/settings/:area` (8 areas from `lib/settings-areas.js` `AREAS[].id`).
- Removed: `/workspace/:urlKey/next-run` (`routes/next-run.js`, `lib/render-next-run.js` deleted in the window).
- Entries: 157. Differences list: empty (run 9 had 8).
- `EXPERIMENTAL_VIEWS` (7) now equals the tagged routes; `live-console` is no longer tagged experimental (it is not in `EXPERIMENTAL_VIEWS`).
- Renderers `renderPlainPage`, `renderSignInUnavailablePage`, `renderSourceErrorPage` given sample args in `capture/renderer-args.mjs`.

## Census (`census.json`, `capture/census.mjs`, passed)

- 273 registry ids: 220 measured, 47 excluded (with reasons), 0 unlisted, 0 orphans.
- Measured with an unexpected outcome: `account`, `email-register`, `email-reproof` (redirect to `/`, not signed in), `ws-roadmap-local` (redirect), `ws-task-page` (503 on default seed), `ws-task-edit` (500).
- Library: 117 `library-doc:` ids (the `/library` index links only 80 of them; the sweeps below use the census list).

## Captures (`capture/capture.mjs`, `capture/beat3-surfaces.mjs`)

- Full registry pass: 396/396 ok. New surfaces (getting-started, backlog, 8 Settings areas): 40/40 ok.
- Authenticated surfaces (`beat3-surfaces.mjs`): 220 captures, 216 ok in the first pass; the 4 failures were the Observation Scan-due tab selector (`.obs-tab[data-view]` no longer exists; now `[data-testid="obs-tab-due"]`). Re-run `empty` group: 104/104 ok.
- Cells: 1400 and 390 in both themes, plus 320 and 360 for cold surfaces (`archive-*`, `landing`, `err-*`) as the original capture set defines.
- PNGs written: 436 top-level plus the `authenticated/` set. Image-read: 17 (listed in the report, section 6). Trimmed for merge to the 16 evidence PNGs the report cites (report section 8); the rest are reproducible with `capture/`.
- Theme: dark uses the real `theme` cookie with `theme-dark` asserted in the same read (`themeAssertion` in each manifest entry).

## Accessibility and performance

- Lighthouse 12.8.2, cold surfaces (28, `lighthouse/*.json`): mobile emulation, light theme, `beat2.mjs lh`.
- Lighthouse 12.8.2, authenticated (6, `authenticated/lighthouse-*.json`): `beat3-lighthouse.mjs`. Settings was run on its default area (`sources`), not `models`. Several runs carry "page loaded too slowly" warnings (kpis, proxy, settings, tree); treat their scores as provisional.
- Settings and Proxy unnamed-control probe (`remeasure/unnamed-controls.json`): covers all 8 areas and Proxy at 1400.
- Contrast: the census (computed, own-background composited, both themes) is the contrast source. Lighthouse colour-contrast is used as a cross-check only.

## Re-measures (`remeasure/`)

- `lin-3119`, `lin-3120`, `lin-3121-f5`, `lin-3123`, `f4`, `f6`, `a1`, `a3`, `a4`, `a5`, `a10`, `a13-a14`, `hypotheses`, `a-items-routes`: from `capture/remeasure.mjs` (ran with the registry and key fixes; rc 0).
- `library-clip-sweep.json`, `library-table-reach.json`, `library-h1.json`: `capture/library-clip-sweep.mjs`, `capture/library-table-reach.mjs`, `capture/library-h1.mjs`.
- `unnamed-controls.json`: `capture/unnamed-controls.mjs`.
- `styleguide-390-overflow.json`: `capture/styleguide-overflow.mjs` (resolves run 9's `bodyOver: 1` spike).
- `ship-public-type.json`: `capture/ship-public-type.mjs`.

## Not measured this run (named, not faked)

- Sent emails and guest-share links with live data: not sent or rendered live. The email renderers were measured as synthetic production output (census `renderer:*`).
- Non-Linear merge consent: synthetic only (LIN-3760 still open; `/test/set-merge-conflict-session` seeds `linear` only). Not re-verified this run.
- Live KPI populations, real upstream outages, real review bodies: not reachable; seeded or synthetic only.
- Run 9 findings 14–17, 25–28 (copy and candidate items): not re-rendered this run; carried as recorded.
- `capture/verify-report-figures.mjs`: bound to run 9's file paths; not run. Report figures were read directly from the JSON listed in the report.
- Dark at 320/360: not captured (run 9 limit carried; dark measured at 1400 and 390).
- Model picker `<select>` native popup: not opened (headless).
