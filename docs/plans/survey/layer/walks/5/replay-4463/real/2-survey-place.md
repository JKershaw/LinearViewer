# What this stage really wrote

## Comment on LIN-4463 at 15:47:49

## Survey global: LIN-4463 @ c205190fd

**Where it lands.** `public/`: 44 classic scripts, 35,245 lines. A month ago it was 39 files and 31,909 lines; three months ago 35 and 20,274. `common.js` grew from 1,795 to 3,309 lines and `observation.js` from 1,309 to 5,019. So it's getting bigger fast, but the rules are getting better: one fake DOM and one `loadWorld` under a census check, a leaf-purity check, and an allow-list instead of a served directory. The area already shares in **three ways**: `window.X` globals (about 50 from `common.js`, loaded by 29 renderers); `module.exports` scaffolding in `question-cards.js`, `home-placement.js` and `close-out.js`; and `/shared/` plus its bridge. The bridge has a test twin, `tests/fixtures/browser-cost-format.js`.

**Done the obvious way**, by converting a leaf like `home-placement.js` or `question-cards.js`, the work adds a **fourth** way and a second bridge. Their consumers (`app.js:816`, `prompt-section.js:1030`) are classic scripts reading `window.*`, and modules run after every classic script. That is the symptom under this ticket: converting leaves first makes bridges. **Converting top down doesn't.** A page's entry script (`app.js`, `task-page.js`) made a module runs *after* `common.js`, so it can read any classic global safely and import whatever has been extracted. A leaf becomes a module only once all its consumers are modules. Then the one bridge can only shrink.

**What must learn about it:** 29 renderer `SCRIPTS` lists; `shared-modules.test.js`, which hard-codes the shim, `'window.CostFormat'` and four consumers; the fixture twin; the area lesson "Views and the `vm` test loaders stay classic", which will be false; and `areas.json`, which maps `^public/` but gives a served `lib/` leaf no front-end home, with nothing to notice. About 20 tests grep `public/` source as text and some assert classic shapes.

**Specifier, settled cheaply:** key `SHARED_MODULES` at `/lib/cost-format.js` instead of `/shared/…` and keep views flat in `public/`. `import … from '../lib/cost-format.js'` then resolves identically in the browser (clamped at root to `/lib/…`) and in Node, since `package.json` is `"type": "module"`. That needs no import map and no CSP hash, and tests use plain `import`. A check should keep `public/` flat.

**Better, at this task's cost:** convert one page entry, top down. Retire `cost-format-global.js`, its test twin, and the `module.exports` blocks of what that page imports. Rewrite the stale lesson. Add a shrink-only check over the single bridge's names. Extract `common.js` by concern only as a converted page needs it: escape and format first, then the timeline maths twinning `lib/timeline-zoom.js`. Of the 89 `world.run` accesses, those reaching script-scope `let`s become exports or go.

**Better still, not this task's:** `observation.js`'s size (find out why first), `app.js`'s whole-page `DOMParser`, the `llms.txt` drift and the no-AI Next-step spinner. Defer those four Waiting entries by name rather than folding them in. The `ship-layout` and `prompt-formatters` twins need their `lib` side made a leaf first.

