/**
 * The client world (LIN-4246, LIN-4265): one fake DOM document (`fake-dom.js`) and one vm sandbox, with whichever `public/`
 * scripts a suite names run in it, in order. `question-cards.js` must be named in the same vm as `prompt-section.js` when
 * the test depends on the keep: `keepsPlace` is always false without `window.QuestionCards`.
 *
 * This layer is generic. What a suite's `/api/…` calls return is the suite's own, passed in as `window`. The container is a
 * real element in the world's document; `click` and `key` are the only shims over it, and `clickOn(element)` is the one
 * element-level click (its own listeners, no bubbling; LIN-4279). `click(dataset)` gives the drawn button
 * with those data attributes to the click listeners, and `key(k)` sends the key to the focused element, as a browser does.
 *
 * `window` is the global object, as in a browser (LIN-4307): `world.window === world.sandbox`. A script's `window.X = …` is
 * the bare `X` a later script reads, and a stub passed as `window` is a global too. A suite that stubs a name a loaded
 * script also defines (common.js's `escapeHtml`, `relativeTime`) sets its stub after that script runs, as a browser
 * page's later script would.
 *
 * Usage: `const world = loadWorld({ window: { api }, scripts: ['question-cards.js', 'prompt-section.js'], timers });`
 * `world.PromptSection`, `world.document`, `world.window`, `world.makeContainer()`, `world.run(code)` (LIN-4280: a snippet in
 * the world's script scope, for the `let` bindings a context object cannot reach). `timers`, when given, collects the client's
 * `setTimeout`s instead of running them (each `{ fn, ms, cancelled, fired }`), so a test fires a poll itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createFakeDom } from './fake-dom.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public');

/**
 * Gives a click to `element`'s own click listeners, with `{ type: 'click', target }`. `target` is what the event reports as
 * its target and defaults to `element`. The fake does not bubble, so a listener on an ancestor is given a click on a
 * descendant by naming both: `clickOn(run, proposal)` (LIN-4307). There is no bubbling, and `dispatchEvent` stays inert,
 * so this is the one way a test clicks in the world. Piece 5 uses it in place of `element.click()` (LIN-4279).
 * The event carries the no-op `preventDefault` and `stopPropagation` a browser's does, as `clickDelegated`'s does: the
 * answer, option and dismiss handlers of the question card call `preventDefault` (LIN-4309).
 */
export async function clickOn(element, target = element) {
  const event = { type: 'click', target, preventDefault() {}, stopPropagation() {} };
  for (const fn of element.listenersOf('click')) await fn(event);
  return event;
}

/**
 * A click on `target` as the page's document-level listeners see it (LIN-4307). app.js binds one click listener on
 * `document` for every control, so the event goes to `document`'s listeners, not the target's own. The event carries the
 * methods a browser's does, so a handler may call `stopPropagation()` or `preventDefault()`.
 */
export async function clickDelegated(target) {
  const event = { type: 'click', target, stopPropagation() {}, preventDefault() {} };
  for (const fn of target.ownerDocument.listenersOf('click')) await fn(event);
  return event;
}

/**
 * Runs the `DOMContentLoaded` listeners a script registered on `document`, once the page is parsed (LIN-4307). A suite
 * parses its markup, runs the script with `world.run`, then calls this, so the script's init sees the page.
 */
export async function fireDOMContentLoaded(document) {
  const event = { type: 'DOMContentLoaded', target: document };
  for (const fn of document.listenersOf('DOMContentLoaded')) await fn(event);
  return event;
}

/**
 * @param {{window?: object, scripts?: string[], timers?: Array|null, globals?: object}} options
 *   `window` are the stubs the client calls on `window`; `scripts` are file names under `public/`; `globals` are extra sandbox
 *   globals (for example `CustomEvent`, `localStorage`) that a suite needs and the default set does not have.
 *
 *   `window` and `globals` are copied by property descriptor, never spread, so a getter that throws (a blocked
 *   `localStorage`) is not read at copy time (LIN-4279): a spread would read every getter. Both are defined on the global,
 *   which is `window` (LIN-4307), `globals` last; a `window` stub of a default's name (a `fetch` stub) is the one a bare
 *   `fetch` reads, as in a browser.
 *
 *   Routes to `common.js` (LIN-4279). loadWorld runs a `public/` file as written and does not apply `withHarnessModels`:
 *   `common.js` throws at load unless `window.__HARNESS_MODELS__` is set. Either pass
 *   `window: { __HARNESS_MODELS__: harnessModelsBlock() }` with `scripts: ['common.js']`, or pass `scripts: []` and run
 *   `withHarnessModels(source)` yourself on `world.sandbox`. The surface is here, not in the header, because the choice is
 *   made per suite, in its call.
 *
 *   Live-console suites (`public/live-console.js`, piece 6) pass these stubs themselves (LIN-4279):
 *   - `requestAnimationFrame` as a no-op. The default calls back synchronously, which overflows the stack once the
 *     interval stubs exist.
 *   - `setInterval`, `clearInterval`, `cancelAnimationFrame` and `module` stubs.
 *   - `localStorage` on both `window` and the global. The client reads `window.localStorage` (live-console.js:1519), and a
 *     bare `localStorage` in the sandbox needs the global too.
 *   - `api: () => new Promise(() => {})`, a call that never resolves, not `fetch`. A `fetch` stub resolves at once and
 *     runs the response path before the test has set anything up.
 */
export function loadWorld({ window: windowStubs = {}, scripts = ['prompt-section.js'], timers = null, globals = {} } = {}) {
  const dom = createFakeDom();
  const { document } = dom;
  const sandbox = {
    AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => {
      if (timers) { const t = { fn, ms, cancelled: false, fired: false }; timers.push(t); return t; }
      const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t;
    },
    clearTimeout: (t) => { if (timers) { if (t) t.cancelled = true; return; } clearTimeout(t); },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  Object.defineProperties(sandbox, Object.getOwnPropertyDescriptors(windowStubs));
  Object.defineProperties(sandbox, Object.getOwnPropertyDescriptors(globals));
  // The global object is the window, as in a browser (LIN-4307).
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of scripts) vm.runInContext(readFileSync(join(PUBLIC_DIR, name), 'utf8'), sandbox, { filename: name });

  const makeContainer = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.click = async (dataset) => {
      const attrs = Object.entries(dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"]`).join('');
      const btn = container.querySelector(`button${attrs}`);
      if (!btn) throw new Error(`no button ${JSON.stringify(dataset)} is drawn in the container`);
      for (const fn of container.listenersOf('click')) await fn({ target: btn });
      return btn;
    };
    container.key = async (k) => {
      const event = { key: k, target: document.activeElement, preventDefault() {} };
      for (const fn of container.listenersOf('keydown')) await fn(event);
    };
    return container;
  };
  // Evaluates a snippet in the world's script scope (LIN-4280). Top-level `let` and `const` bindings of the loaded
  // scripts live there, not on the context object, so `sandbox` cannot reach them: `world.run('currentView = "rulings"')`
  // sets one, and `world.run('currentView')` reads it. Bindings persist across calls in the same world.
  const run = (code) => vm.runInContext(code, sandbox);

  return { PromptSection: sandbox.PromptSection, document, window: sandbox, sandbox, makeContainer, run };
}
