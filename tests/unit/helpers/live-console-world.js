/**
 * LIN-4285 — the Live Console suites' shared loader and lane fixture. Used by lin-4035-live-console-client.test.js and
 * live-console-client-facts.test.js.
 *
 * This is a loader and a fixture, not a fake DOM. The DOM is the shared one (fake-dom.js) and the vm is loadWorld's.
 * What lives here: the server's page as the client boots over (pageBody), the lane markup laneNode builds
 * (LANE_CONTENTS, makeLaneNode), and the source pin that ties that markup to the client (pinLaneMarkupToClient).
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

// The lane markup laneNode builds (live-console.js, `function laneNode`), with its initial `hidden` attributes removed
// so updateLaneNode's writes are what a test sees. laneNode is not exported, and it only runs once a feed resolves,
// which the pending feed keeps out of reach, so the suites supply the lane through makeLaneNode.
export const LANE_CONTENTS = `
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <span class="lc-lane-head">
          <a class="lc-lane-task" data-testid="live-console-lane-task" href="#"></a>
          <span class="lc-lane-title-sep" aria-hidden="true">·</span>
          <span class="lc-lane-title" data-testid="live-console-lane-title"></span>
          <a class="lc-lane-run" data-testid="live-console-lane-run" href="#">open run ↗</a>
          <span class="lc-lane-ws"></span>
        </span>
        <span class="lc-lane-stage-row">
          <span class="lc-lane-stage" data-testid="live-console-lane-stage"></span>
          <span class="lc-lane-since" data-testid="live-console-lane-since"></span>
          <span class="lc-lane-action" data-testid="live-console-lane-action"></span>
          <span class="lc-lane-tickets" data-testid="live-console-lane-tickets"></span>
        </span>
        <span class="lc-lane-mid">
          <span class="lc-lane-cred" data-testid="live-console-lane-credential"></span>
          <span class="lc-lane-hb" data-testid="live-console-heartbeat"></span>
          <span class="lc-lane-summary"></span>
        </span>`;

// A lane `li` in `world`, without the pulse class: the class on the node is the client's write, not the fixture's.
export function makeLaneNode(world) {
  const li = world.document.createElement('li');
  li.setAttribute('class', 'lc-lane');
  li.innerHTML = LANE_CONTENTS;
  return li;
}

// The lane's classes and anchors, pinned to laneNode and to updateLaneNode's own selectors. A class that laneNode drops,
// or that updateLaneNode queries and the fixture lacks, fails here. The anchor count also fails if laneNode emits a
// second task link: laneNode has exactly two anchors, the task link and the run link.
export function pinLaneMarkupToClient() {
  const start = CLIENT_SRC.indexOf('function laneNode(lane)');
  const template = CLIENT_SRC.slice(start, CLIENT_SRC.indexOf('updateLaneNode(li, lane);', start));
  assert.ok(template.includes('<li class="lc-lane'), 'laneNode still builds the lane the fixture mirrors');
  assert.equal((template.match(/<a class=/g) || []).length, 2, 'laneNode emits one task link and one run link, nothing else');
  const queried = [...CLIENT_SRC.matchAll(/li\.querySelector\('\.([a-z-]+)'\)/g)].map(m => m[1]);
  assert.ok(queried.length > 0, 'updateLaneNode queries its lane parts');
  for (const cls of queried) {
    assert.ok(template.includes(`class="${cls}"`), `laneNode builds .${cls}`);
    assert.ok(LANE_CONTENTS.includes(`class="${cls}"`), `the lane fixture carries .${cls}`);
  }
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
