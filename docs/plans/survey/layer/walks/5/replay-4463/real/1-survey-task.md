# What this stage really wrote

## Comment on LIN-4463 at 15:44:33

## Survey open-0: LIN-4463 @ c205190fd

**Why it will be hard.**

1. **The real hub is `public/common.js`, not the bridge.** It sets 51 `window.*` globals and 29 renderers load it first. A view can't import from it while it stays a classic script. Making it a module in one go pushes all 51 globals through the one allowed bridge, and changes their timing on 28 unconverted pages: module scripts run after every classic script, the same trap the area note records for `window.CostFormat`. So "one view at a time" really means one view plus a step into the hub. In practice the single bridge ends up carrying common.js, not cost-format. Watch for anyone reading "one bridge" as "one bridge per module".

2. **Specifiers have to be settled before any view converts.** `cost-format-global.js` imports `'/shared/cost-format.js'`. In Node that resolves from the filesystem root, so a test can't import a page module that uses it. The choice is an import map (an inline `<script type="importmap">`, which needs a CSP hash, and `page.js` already has `scriptBodyHash`), paired with `package.json` `"imports"` for Node, or relative specifiers with a URL layout that matches the repo. This one decision settles whether "tests get simpler" can hold.

3. **The test seam breaks; it doesn't carry over.** 64 suites load scripts through `tests/unit/helpers/client-world.js` (a classic `vm` sandbox), and there are 85 `world.run` calls that reach script-scope `let` bindings. Module scope removes those, so each one becomes an export or goes. The area note asks for a "module-capable client test loader". I'd question that. `package.json` is already `"type": "module"`, so Node can `import` `public/*.js` directly with a fake-DOM global, provided a module doesn't touch `document` at load. A `vm.SourceTextModule` loader (behind an experimental flag) is the elaborate road the ticket says not to take.

4. **Some Waiting entries have nothing to do with modules.** The `llms.txt` drift, the no-AI "Next step" spinner, and app.js's whole-page `DOMParser` are real but sit outside this work. Close them separately or name them as out of scope. Folding them in makes the slices bigger without making the area cleaner.

**Symptom vs. cause.** The no-build rule is the stated target, but the pain reads as common.js being a 3,309-line pool of globals and "client twins". Modules are the tool for that. They aren't a fix by themselves: converting files without splitting common.js by concern just moves the pool.

**What I'd do first: one design piece, before any view converts.**
- Pick the specifier scheme (import map + `"imports"` vs. relative) and prove it with one page-module test that is a plain `import`.
- Replace `cost-format-global.js` with one general bridge file whose global list is the explicit ramp, plus a ratchet check that the list can only shrink. That settles the bridge Waiting entry and stops a second shim being written.
- Then the first view: a small one that already wants exports. Eleven files carry `typeof module … module.exports` dual exports (`question-cards.js`, `home-placement.js`, `close-out.js` are small). Convert it, rewrite its tests as imports, and name what was retired.
- Save `observation.js` (5,019 lines, about 40% comments by LIN-4446's count) and `common.js` itself for last. Finding out why observation.js is that size is a separate question from making it a module.

The leaf twins `lib/task-page-href.js`, `lib/timeline-zoom.js` and `lib/providers/models.js` import nothing, so they're cheap retirements once the bridge is general. `ship-layout` and `prompt-formatters` import other modules, so they still can't be served as single files.

