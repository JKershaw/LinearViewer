/**
 * The native-import world (LIN-4471): a converted page module, `public/x.js` written with `import`, run by Node's own
 * `import()` over the fake DOM installed on the real `globalThis`. Use it for a page that is an ES module, and for its
 * imported lib leaves, which it reaches by a relative specifier. Use `loadWorld` (client-world.js) for a classic script
 * that is still run in a vm, in order, with its `let` bindings reachable through `world.run`. The two do not mix in one
 * suite: a module runs in the main realm, and a classic script it needs goes in through `runClassic`, below.
 *
 *   const world = await importWorld({ window: { __WORKSPACE_KPI_DATA__: data, Chart }, globals: { getComputedStyle } });
 *   world.runClassic('chart-helpers.js');     // a classic sibling the page reads, run in this same realm
 *   const page = await world.importPage('workspace-kpis.js');   // a fresh instance: its module state is its own
 *   // ... assertions over world.document, world.window (=== globalThis) ...
 *   world.restore();                          // in t.after(() => world.restore()) or a finally block
 *
 * What it does, and why each is needed:
 *  - `window === globalThis`, as in a browser. Each `window` stub is a global, copied by property descriptor, never
 *    spread, so a getter that throws (a blocked `localStorage`, `navigator` on Node 25) is not read at copy time.
 *  - `document` is the fake DOM document (fake-dom.js). A page module must not touch `document` at load beyond what
 *    the fake models; the page scripts this helper is for register listeners or draw into the markup and nothing else.
 *  - `timers`, when given, collects `setTimeout`/`clearTimeout` as loadWorld does, so a test fires a poll itself. The
 *    collector replaces the timer the test file itself awaits, so `restore()` must run before the test ends.
 *  - `importPage` imports the file with a fresh query string each call. Node caches a module per URL, so without the
 *    cache-bust a second import returns the first instance's timers and listeners. Pure lib leaves that the page imports
 *    keep their cache, and they are pure, so that is safe.
 *  - `runClassic` runs a `public/` classic script in the main realm with `vm.runInThisContext`. It is the one supported
 *    way to put a classic sibling into the same realm as a module. Use it for `chart-helpers.js` and `close-out.js`,
 *    which are IIFEs and so declare nothing that could collide.
 *  - `restore()` puts back every global it changed, by descriptor: a replaced property gets its old descriptor back, a
 *    new property is deleted. It works from a snapshot taken when the world was made, so a global a test adds by hand
 *    is removed too. Accessor globals are never assigned, because Node 25 exposes some of them getter-only.
 *
 * Its own tests are tests/unit/import-world.test.js: two fresh imports share no state, and every replaced global is
 * restored, including on a throw.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import vm from 'node:vm';
import { createFakeDom } from './fake-dom.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public');

let importSeq = 0;

/** Every own property of the global, as descriptors (reads no getter). */
const snapshotGlobal = () => Object.getOwnPropertyDescriptors(globalThis);

/** Puts the global back to `snapshot`: removes what was added, restores what was changed, by descriptor. */
function restoreGlobal(snapshot) {
  const now = Object.getOwnPropertyDescriptors(globalThis);
  for (const key of Reflect.ownKeys(now)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) Reflect.deleteProperty(globalThis, key);
  }
  for (const key of Reflect.ownKeys(snapshot)) {
    const before = snapshot[key];
    const after = now[key];
    const same = after && after.value === before.value && after.get === before.get && after.set === before.set
      && after.writable === before.writable && after.enumerable === before.enumerable && after.configurable === before.configurable;
    if (!same) Object.defineProperty(globalThis, key, before);
  }
}

/**
 * @param {{window?: object, globals?: object, timers?: Array|null}} [options]
 *   `window`: stubs installed as globals (and `window` itself, which is the global). `globals`: extra globals, by
 *   descriptor, applied after `window` so they win. `timers`: when given, `setTimeout` collects into it.
 */
export function importWorld({ window: windowStubs = {}, globals = {}, timers = null } = {}) {
  const snapshot = snapshotGlobal();
  const dom = createFakeDom();
  const { document } = dom;

  try {
    Object.defineProperty(globalThis, 'document', { value: document, writable: true, configurable: true, enumerable: true });
    Object.defineProperties(globalThis, Object.getOwnPropertyDescriptors(windowStubs));
    Object.defineProperties(globalThis, Object.getOwnPropertyDescriptors(globals));
    Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true, configurable: true, enumerable: true });
    if (timers) {
      Object.defineProperty(globalThis, 'setTimeout', {
        value: (fn, ms) => { const t = { fn, ms, cancelled: false, fired: false }; timers.push(t); return t; },
        writable: true, configurable: true, enumerable: true,
      });
      Object.defineProperty(globalThis, 'clearTimeout', {
        value: (t) => { if (t) t.cancelled = true; },
        writable: true, configurable: true, enumerable: true,
      });
    }
  } catch (err) {
    restoreGlobal(snapshot);
    throw err;
  }

  const fileOf = (name) => (isAbsolute(name) ? name : join(PUBLIC_DIR, name));

  return {
    document,
    window: globalThis,
    /** Runs a classic `public/` script in this realm (vm.runInThisContext). Its globals are restored by `restore()`. */
    runClassic(name) {
      vm.runInThisContext(readFileSync(fileOf(name), 'utf8'), { filename: name });
    },
    /** Imports a `public/` module (or an absolute path) fresh: a new instance of its module state. */
    importPage(name) {
      importSeq += 1;
      return import(`${pathToFileURL(fileOf(name)).href}?world=${importSeq}`);
    },
    /** Puts every global back as it was when the world was made. Safe to call twice. */
    restore() {
      restoreGlobal(snapshot);
    },
  };
}
