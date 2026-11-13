/**
 * The task page's world (LIN-4472): `public/task-page.js` imported as the native module it is, over the fake DOM, with
 * the window stubs a poll or an init needs. The suites that run the page's init share this one set of defaults, so each
 * one states only what it tests.
 *
 *   const { document, page, timers } = await pageWorld(t, { window: { api }, classic: ['close-out.js'] });
 *
 * - `window` stubs are globals (importWorld); `addEventListener`, `fetch`, `setInterval` and `clearInterval` default to
 *   inert stubs, and `requestAnimationFrame` runs its callback at once. `navigator` gets a clipboard (share copy).
 * - `timers` collects `setTimeout`, so a test fires a poll itself (`timers.shift().fn()`).
 * - `classic` runs the named classic siblings first, in the order the page's SCRIPTS list runs them (close-out.js is
 *   the one a page reads), so their DOMContentLoaded listeners register before the page's.
 * - `page` is a fresh instance of the module; the page's DOMContentLoaded listener is on `document`, so a test fires it
 *   with fireDOMContentLoaded (client-world.js).
 * `restore()` runs in t.after, so the globals are put back after each test.
 */
import { importWorld } from './import-world.js';

export async function pageWorld(t, { window = {}, timers = [], classic = [] } = {}) {
  const world = importWorld({
    window: {
      addEventListener() {},
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      requestAnimationFrame: (cb) => { cb(); return 1; },
      setInterval: () => 0,
      clearInterval() {},
      ...window,
    },
    globals: { navigator: { clipboard: { writeText: async () => {} } } },
    timers,
  });
  t.after(() => world.restore());
  for (const name of classic) world.runClassic(name);
  const page = await world.importPage('task-page.js');
  return { world, page, document: world.document, timers };
}
