/**
 * LIN-4285 — the Live Console suites' shared loader and lane fixture. Used by lin-4035-live-console-client.test.js and
 * live-console-client-facts.test.js.
 *
 * This is a loader and a fixture, not a fake DOM. The DOM is the shared one (fake-dom.js) and the vm is loadWorld's.
 * What lives here: the server's page as the client boots over (pageBody), the lane the client builds
 * (makeLaneNode, over window.LiveConsoleLane), and the source pin on that builder (pinLaneMarkupToClient). LIN-4310: the
 * lane is the client's own laneNode, not a copy of its markup.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadWorld } from './client-world.js';
import { harnessModelsBlock } from '../../../lib/model-routing-harnesses.js';
import { renderLiveConsolePage } from '../../../lib/render-live-console.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CLIENT_SRC = readFileSync(join(ROOT, 'public/live-console.js'), 'utf8');

// The server's page, body only. The fake parser rejects `<!doctype …>`, so the doctype is removed first. Every
// `hidden` and `aria-expanded="false"` the server ships is removed too, so each hidden or collapsed value a test reads
// is the client's write, not the server's markup.
export function pageBody() {
  const html = renderLiveConsolePage({ urlKey: 'ws' }).replace(/<!doctype[^>]*>/i, '');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  return body.replace(/<[^>]*>/g, (tag) => tag.replace(/\shidden(?=[\s>])/g, '').replace(/\saria-expanded="false"/g, ''));
}

// The lane is the client's own builder (LIN-4310): `window.LiveConsoleLane.laneNode`, which live-console.js exports for
// this purpose. This file used to hold a copy of its markup (LANE_CONTENTS), and that copy is gone. laneNode paints the
// lane once with updateLaneNode, so a suite gets a lane in the state the client leaves it in.
export function makeLaneNode(world, lane = {}) {
  return world.window.LiveConsoleLane.laneNode(lane);
}

// The lane's parts and anchors, pinned to the client source. laneNode builds every part that updateLaneNode queries, and
// it has exactly two anchors, the task link and the run link. A class updateLaneNode queries that laneNode does not build
// fails here. (LIN-4310: this used to check a copied fixture against laneNode; with the copy gone, it checks laneNode.)
export function pinLaneMarkupToClient() {
  const start = CLIENT_SRC.indexOf('function laneNode(lane)');
  const template = CLIENT_SRC.slice(start, CLIENT_SRC.indexOf('updateLaneNode(li, lane);', start));
  assert.ok(template.includes('<li class="lc-lane'), 'laneNode still builds the lane');
  assert.equal((template.match(/<a class=/g) || []).length, 2, 'laneNode emits one task link and one run link, nothing else');
  const queried = [...CLIENT_SRC.matchAll(/li\.querySelector\('\.([a-z-]+)'\)/g)].map(m => m[1]);
  assert.ok(queried.length > 0, 'updateLaneNode queries its lane parts');
  for (const cls of queried) assert.ok(template.includes(`class="${cls}"`), `laneNode builds .${cls}`);
}

/**
 * Loads the real common.js, then the real live-console.js, into one world over the server's page. Returns the client's
 * own exports (`api`), a lookup by id (`el`), and the world. `storage` backs `localStorage` on the window and the
 * global; `throwingGetter` makes that getter throw.
 *
 * The pending feed: window.api never resolves, so poll() never reaches applyFeed. applyFeed's `style` writes
 * (live-console.js:338-340, :408, :482, :489, :516-519) stay out of reach. A test that resolves this feed has hit that
 * stop: it must not add `style` to the fake. See LIN-4271.
 */
export function loadLiveConsole({ storage = { getItem: () => null, setItem() {} }, throwingGetter = false } = {}) {
  // Both are accessor properties, so a throwing getter is not read at copy time (LIN-4279).
  const storageProps = {};
  Object.defineProperty(storageProps, 'localStorage', {
    enumerable: true,
    configurable: true,
    get() {
      if (throwingGetter) throw new Error('storage denied');
      return storage;
    },
  });
  const world = loadWorld({
    window: Object.defineProperties({
      __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
      __HARNESS_MODELS__: harnessModelsBlock(),
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      api: () => new Promise(() => {}),
    }, Object.getOwnPropertyDescriptors(storageProps)),
    scripts: ['common.js'],
    // The client's setTimeout calls are collected, not run, so no timer outlives the test.
    timers: [],
    globals: Object.defineProperties({
      module: { exports: {} },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      setInterval: () => 0,
      clearInterval() {},
    }, Object.getOwnPropertyDescriptors(storageProps)),
  });
  // The page is in place before the client boots, so every id it looks up at load is a real element.
  world.document.body.innerHTML = pageBody();
  world.run(CLIENT_SRC);
  const el = (id) => world.document.getElementById(id.replace(/^#/, ''));
  return { api: world.sandbox.module.exports, el, world };
}
