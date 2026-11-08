# LIN-3960: /styleguide: the anatomy text puts an unescaped <workspace> in the page HTML

State: Todo
Labels: none

## Description

## As asked

Found in the LIN-3958 review (PR #2144) as an out-of-scope finding.

`lib/render-styleguide.js:129` (the Settings piece anatomy for the group note, `purpose`) holds the string `“For everyone in <workspace>”`. The anatomy text is written into the page as HTML without escaping, so `<workspace>` is parsed as an unknown element and the text reads “For everyone in ”.

This happens on base too (it predates LIN-3958). Fix: escape the anatomy text, or write the placeholder as `&lt;workspace&gt;`, and add a unit test that the rendered `/styleguide` contains the literal text “For everyone in <workspace>”.

Found by: review of LIN-3958.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Comments (oldest first)

### 2026-10-25T16:39:40.235Z (posted with the ticket)

Priority Low: one placeholder in the /styleguide anatomy copy renders as "For everyone in ."; it is cosmetic, on an internal reference page, predates LIN-3958 and does not recur. Type: Bug (rendered text is wrong). Related: LIN-3958 (found in its review).

### (Survey, survey-task, posted before work began)

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

### (Survey, survey-place, posted before work began)

## Survey global: LIN-3960 @ 9da9bc2ba

**Where it lands.** All of it is in `lib/render-styleguide.js`. The fix goes in `settingsPieceSection` (lines 191-202), which writes `piece.name/purpose/parts/sizes/states/theme` straight into `<h4>`/`<dd>`. The test belongs in `tests/unit/lin-3890-styleguide-settings-anatomy.test.js`, which already loops over every piece and every anatomy key. I checked all ten pieces, and only one string contains `<`, `>` or `&`: `group-title.purpose` at line 129. `role="switch"` in `switch-row.parts` renders correctly either way.

The area is getting better. LIN-3890 and LIN-3950 replaced hand-drawn samples with output from the real builders (`SETTINGS_SAMPLES`), and tests now pin the samples and keep the page byte-stable. The one thing that hasn't caught up is the house rule that every other builder follows: plain text goes through `escapeHtml` (`lib/utils/html.js`), and only `*Html` props are trusted markup. The `settings-group.js` builders that this anatomy describes escape their `title`. The styleguide's own template escapes nothing and doesn't import `escapeHtml`. Every other interpolation in it is a constant token name or value, so this is the first piece of prose in the file that the lack of escaping actually breaks.

**Done the obvious way.** There are two obvious fixes, and one is worse.
- Writing `&lt;workspace&gt;` into the data fixes one string and puts HTML into `SETTINGS_PIECES`. That array is exported and read as plain text by two test files. The next placeholder anyone writes breaks again.
- Wrapping the six fields in `escapeHtml(...)` and importing it from `utils/html.js` fixes the whole class. Don't write a local `esc` helper; that would make a second copy of something the codebase already has.

**The test trap.** The ticket's test, "the rendered page contains the literal text `For everyone in <workspace>`", passes on the buggy base if it's written as `html.includes(...)` on the raw string, because the raw HTML already contains `<workspace>`. The assertion has to check the escaped form (`For everyone in &lt;workspace&gt;`). Better still, assert `html.includes(escapeHtml(piece[key]))` for every piece and key in the existing loop. That covers every anatomy string, now and later.

Nothing needs updating in a registry or doc. The `source-map.md` entry (line 131) is generic. `tests/screenshots/pages/styleguide-*.png` are output from non-asserting generators, so only a person comparing them would notice. The judge page list (`tests/judge/pages.mjs:57`) needs no change.

**Better, at a cost this task can carry.** Escape at render as described, and put the escaping rule in the `SETTINGS_PIECES` comment (lines 67-70): anatomy fields are plain text and the template escapes them. Optionally, make the `group-title` sample (line 175) draw a second `group({ title: 'For everyone in <workspace>' })`. The live builder would then show the same placeholder, escaped by the code the Settings pages actually use.

**Better still, not this task's.** `render-styleguide.js` (626 lines) is a trusted-markup template written in raw template literals. Every page renderer has to remember to call `escapeHtml` at each text interpolation, and nothing checks that it does. A tagged-template or text/`Html` split enforced across `lib/render-*.js` would close the gap behind this symptom. That's a separate sweep, not a styleguide fix.
