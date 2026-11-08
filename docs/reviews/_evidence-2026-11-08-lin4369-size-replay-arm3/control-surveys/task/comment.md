## Survey open-0: LIN-3960 @ 9da9bc2ba

**Short version:** the fix itself is small. The difficulty is the test the ticket asks for, because the obvious version of it passes on the broken code.

**What's there.** `settingsPieceSection` (`lib/render-styleguide.js:211-221`) writes all five anatomy fields (`purpose`, `parts`, `sizes`, `states`, `theme`) and `piece.name` into the HTML as they are. `SETTINGS_PIECES` is plain prose. Line 129 is the only string with a markup character in it (`<workspace>`). The live Settings builders take the opposite approach: `group()` (`lib/components/settings-group.js:31`) and `groupNote()`/`statusLine()` run `escapeHtml` on their text. So the real "For everyone in ${workspaceName}" title (`lib/render-settings-workspace.js:109,168`) is safe. This bug is confined to the styleguide's own description of the pieces, not the Settings page.

**Why it's harder than it looks.**

1. **The suggested test is a trap.** "The rendered `/styleguide` contains the literal text 'For everyone in <workspace>'" sounds like `html.includes('For everyone in <workspace>')`. That passes today, because the raw bytes are exactly what's wrong. The repo has no HTML parser (no jsdom, linkedom, cheerio or parse5 in `package.json`), so the test can't easily check the text a browser would show. It has to assert on bytes:
   - `html.includes('For everyone in &lt;workspace&gt;')`
   - `!html.includes('<workspace>')`

   Run it against 9da9bc2ba first and confirm it fails there.
2. **Which fix: escape the text, or write `&lt;workspace&gt;` in the string?** Writing `&lt;workspace&gt;` changes only line 129, but the rule that anatomy text is HTML stays in place for the next person who types `<` or `&`. Escaping in `settingsPieceSection` fixes the whole class. It's safe because no anatomy string carries intended markup. The only side effect is that `role="switch"` in the switch-row `parts` becomes `role=&quot;switch&quot;`, which looks the same on screen. I checked the existing tests (`lin-3890-styleguide-settings-anatomy.test.js`, `render-styleguide.test.js`, `styleguide-settings-samples.test.js`) and none matches raw anatomy text, so escaping shouldn't break them. One trap: don't escape the samples. `SETTINGS_SAMPLES` output is builder HTML and must stay raw.
3. **Visual baseline.** The page header calls `/styleguide` "the visual-regression target", and visible text will change (the line gains "<workspace>"). `tests/visual/pages-screenshots.spec.js` only *captures* screenshots with `page.screenshot`, and doesn't compare them. `tests/screenshots/pages/styleguide-*.png` were last touched on 2026-07-04, so nothing will fail. Don't spend time refreshing the baselines unless a reviewer asks.

**Symptom or cause?** It's a mild symptom. The styleguide prints prose as markup, while every component it shows escapes its text. Escaping in `settingsPieceSection` (fields and `name`) deals with the cause at the scale it exists. I wouldn't widen it to a sweep of the whole page: the other interpolations in the page are hard-coded token names and builder output.

**What I'd do first:**
1. Write the byte-level test (escaped form present, raw `<workspace>` absent) in `tests/unit/lin-3890-styleguide-settings-anatomy.test.js`, and watch it fail on 9da9bc2ba.
2. Import `escapeHtml` from `./utils/html.js` and apply it to the five fields and the name in `settingsPieceSection`.
3. Run `npm run test:unit`.
