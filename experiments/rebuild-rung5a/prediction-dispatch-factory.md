# Rung 5a: design-first rebuild of lib/dispatch-factory.js + lib/dispatch-validation.js, prediction (written before launch)

**Baseline** (`f4749b91`, kit `shape.mjs`):
- `dispatch-factory.js`: 545 code lines, 208 decision points. The worst function, `createDispatchItem`, has 181 and 451 code lines: the codebase's worst.
- `dispatch-validation.js`: 182 code lines, 77 decision points; worst 42.
- Six source-text tests pin the factory (mint census, redaction census, enqueue census, call-site pin, duplicate-code drift, no `req.session`). The ticket says "This is one PR. Don't split it into child tickets."

**Run**
- Harbour doesn't split it: about 75%.
- Merges: about 75%. Done without a ruling: about 40%. The census pins make plan review likely to raise questions.
- 60–150 minutes.

**Result**
- Combined 560–700 code lines (a 4–23% cut). The guards are distinct, so little code is shared.
- The worst function drops below 60: about 75%. Below 30: about 40%. `createDispatchItem` becomes a pipeline of named guards.
- Decision points down 10–30%.
- My replay (14,193 inputs including 6,354 test-captured calls, 100% line coverage of both old files) finds no regression: about 65%. If one ships, it's most likely in how store failures surface (sync throw vs rejection) or the anchor cache.
- At least one class-(a) fix (store-failure consistency, the null `dispatchedAt` duplicate refusal): about 60%.
