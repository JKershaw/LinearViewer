// --import preload used by capture.mjs: run one existing unit-test file under
// the same hermetic setup as the replay (pinned env/TZ, frozen clock, network
// tripwire) with lib/render-roadmap.js swapped for a recording shim, so the
// exact (data, options) every test passes to renderRoadmapPage is captured.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { pinEnv, installNetworkGuard, freezeClock } from './hermetic.mjs';

pinEnv();
installNetworkGuard();
freezeClock(process.env.REPLAY_NOW);

const here = path.dirname(new URL(import.meta.url).pathname);
register(pathToFileURL(path.join(here, 'capture-hooks.mjs')).href, {
  data: {
    target: pathToFileURL(path.join(process.env.REPLAY_LIB, 'render-roadmap.js')).href,
    shim: pathToFileURL(path.join(here, 'capture-shim.mjs')).href
  }
});
