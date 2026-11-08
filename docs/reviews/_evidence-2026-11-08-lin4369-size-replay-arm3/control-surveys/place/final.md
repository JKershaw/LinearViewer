I did the LIN-3960 survey as a read-only pass at 9da9bc2ba. The comment, under 500 words, is in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm3/runs/s3960-place/output/comment.md`. I changed nothing in `code/`.

What it says:
- **Where it lands:** `settingsPieceSection` in `lib/render-styleguide.js` puts all six anatomy fields into the page without escaping. Only one string contains HTML characters: `group-title.purpose`, line 129.
- **The deeper gap:** everywhere else, plain text goes through `escapeHtml` (`lib/utils/html.js`) and only `*Html` props are trusted. The `settings-group.js` builders that this anatomy describes follow that rule. The styleguide template never imports `escapeHtml`, and this is the first piece of prose where that breaks anything.
- **Recommended fix:** escape the fields when the page is rendered, using the existing `escapeHtml`. Writing `&lt;workspace&gt;` into the data would put HTML into an exported array that tests read as plain text. A local helper would be a second copy of `escapeHtml`.
- **Test trap:** the test the ticket asks for, written as a raw `html.includes('For everyone in <workspace>')`, passes on the buggy base, because the raw HTML already contains `<workspace>`. It has to check for `&lt;workspace&gt;`. Better still, assert `escapeHtml(piece[key])` for every piece and field inside the existing loop in `tests/unit/lin-3890-styleguide-settings-anatomy.test.js`.
- **No knock-on updates:** no registry or doc needs to change. The committed styleguide screenshots come from generators that don't assert, so only a person comparing them would notice the extra word.
- **Bigger, not this task's:** none of the page renderers check that text interpolations are escaped, so the same mistake can recur anywhere. Closing that is a separate sweep across `lib/render-*.js`.

DONE: Survey comment for LIN-3960 @ 9da9bc2ba written to output/comment.md; key point is that the requested test passes on the buggy base if it checks the raw string
