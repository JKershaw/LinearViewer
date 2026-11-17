# What this stage really wrote

## Comment on LIN-4446 at 13:14:03

## Survey open-0: LIN-4446 @ 4b5001ddf

**Why this will be hard**

1. **"Allow the browser to import" doesn't turn imports on.** `server.js:1228` serves only `public/`, so the server modules a browser file restates (`lib/cost-format.js` etc.) have no URL. Sharing needs a served place for pure modules that both `lib/` and the browser import, plus a rule for it (no Node built-ins, no DOM at load). Without the rule, someone will import a module that pulls in `node:fs`. CSP `script-src 'self'` already allows module scripts loaded from a file.

2. **Every page is classic scripts talking through globals.** `lib/components/page.js` writes ordered `<script src>` tags, and files read `window.X` and top-level bindings from `common.js` (3,309 lines, on 29 pages). A classic script can't use static `import`. Making a view `type="module"` makes it deferred, strict and module-scoped, so its globals vanish for later scripts. "One view at a time" is blocked until what views read from `common.js` is reachable another way.

3. **The test harness assumes classic scripts.** 130 unit test files load `public/*.js` through `vm` (`tests/unit/helpers/client-world.js`, plus `runInNewContext` in the parity tests). None use `vm.SourceTextModule`. A browser file that gains an `import` line breaks all of them. That cost isn't in the ticket.

4. **"Lighter" is easy to fake.** About 1,985 of `observation.js`'s 5,019 lines are comments (ticket history, retuning stories), and 1,456 of `common.js`'s 3,309. Cutting comments passes a line count without sharing anything. The why-so-large check (68 commits on `observation.js`) should count logic and commentary separately.

5. **The ticket is a symptom, and the repo already says so.** `docs/papers/harbour/the-second-copy.md` §9–10 traces the copies to the no-build-step rule read as "no sharing". It shows that parity tests and helpers nobody was required to adopt kept the copies alive, and that only deleting the old copy ever finished a consolidation. A slice that adds a shared module and keeps the old copy or its parity test repeats that pattern.

**What I'd do first**

Write the reading of the rule into `CLAUDE.md:43` and `docs/areas/front-end-browser.md`, then take **cost-format** as the first slice:
- `lib/cost-format.js` (46 lines, no imports) becomes the one served shared module and stays importable by `lib/render-*.js`.
- **Retire** `public/cost-format.js` (a self-declared "restatement") and `tests/unit/cost-format-parity.test.js`.
- Its 4 consumers (`flight-companion`, `prompt-section`, `observation`, `workspace-kpis`) call `window.CostFormat` only inside handlers and render functions, never at load. A small module shim that sets `window.CostFormat` therefore runs early enough (module scripts run before `DOMContentLoaded`), and no view has to become a module yet.
- Update `cost-read-census.test.js:85` and the vm suites that name `cost-format.js`.

This settles where shared modules are served, the purity rule and the test path on a pure function before any view is touched. View size and `common.js`'s globals stay out of the slice and go into the area note. John's read of the first slice should be scheduled as a real pause.

