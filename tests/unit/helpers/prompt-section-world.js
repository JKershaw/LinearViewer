/**
 * The PromptSection world (LIN-4463 piece 5): `public/prompt-section.js` imported as the native module it is, over the
 * fake DOM, with the same inert defaults `loadWorld` gave it, so a suite that ran it classic changes how it loads the
 * component and not what it asserts.
 *
 *   const world = await promptSectionWorld(t, { window: { api, escapeHtml }, timers, classic: ['question-cards.js'] });
 *   const handle = world.PromptSection.init(world.makeContainer(), opts);
 *
 * - `window` and `globals` are globals, by descriptor (importWorld). `PromptSection` is the module's namespace: a fresh
 *   instance per world, so its prompt cache and remembered labels are the world's own. It is not a global any more.
 * - Defaults, each overridable: `fetch` answers `{}`, `requestAnimationFrame` runs its callback at once, `navigator` has a
 *   clipboard, and `console` is the real one.
 * - `timers`, when given, collects `setTimeout` (a test fires a poll itself). Without it, timers are real, and any still
 *   pending when the world is restored are cleared, so a late poll never runs against a restored global.
 * - `classic` runs named classic scripts first, in the page's order: the IIFE siblings (question-cards.js, which the
 *   component reads as window.QuestionCards; close-out.js), or common.js for the real dispatch disclosure
 *   (real-dispatch-disclosure.js), which makes the suite a classic one in the census.
 * - `makeContainer()` is the container both worlds share (containerMaker, client-world.js).
 * `restore()` runs in t.after when `t` is given; pass null to call `world.restore()` yourself. Worlds made in one test are
 * restored newest first: each world's snapshot is the globals as the one before it left them, so restoring the oldest
 * first and then a newer one would put the older world's globals back for the next test.
 */
import { importWorld } from './import-world.js';
import { containerMaker } from './client-world.js';

const restoresByTest = new WeakMap();

/** Registers `restore` to run after test `t`, after every restore registered later for the same test (newest first). */
function afterNewestFirst(t, restore) {
  let stack = restoresByTest.get(t);
  if (!stack) {
    stack = [];
    restoresByTest.set(t, stack);
    t.after(() => { while (stack.length) stack.pop()(); });
  }
  stack.push(restore);
}

export async function promptSectionWorld(t, { window: windowStubs = {}, globals = {}, timers = null, classic = [] } = {}) {
  const pending = new Set();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const trackedTimers = timers ? {} : {
    setTimeout: (fn, ms, ...args) => {
      const handle = realSetTimeout(() => { pending.delete(handle); fn(...args); }, ms);
      pending.add(handle);
      return handle;
    },
    clearTimeout: (handle) => { pending.delete(handle); realClearTimeout(handle); },
  };
  const defaults = {
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    requestAnimationFrame: (cb) => { cb(); return 1; },
  };
  const world = importWorld({
    window: Object.defineProperties({ ...defaults }, Object.getOwnPropertyDescriptors(windowStubs)),
    globals: Object.defineProperties({ navigator: { clipboard: { writeText: async () => {} } }, ...trackedTimers }, Object.getOwnPropertyDescriptors(globals)),
    timers,
  });
  const restore = () => {
    for (const handle of pending) realClearTimeout(handle);
    pending.clear();
    world.restore();
  };
  if (t) afterNewestFirst(t, restore);
  try {
    for (const name of classic) world.runClassic(name);
    const PromptSection = await world.importPage('prompt-section.js');
    return { PromptSection, document: world.document, window: world.window, makeContainer: containerMaker(world.document), restore, world };
  } catch (err) {
    restore();
    throw err;
  }
}
