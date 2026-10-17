// --import preload for one existing unit-test file: the replay's hermetic
// setup (pinned TZ/env, frozen clock, non-loopback network tripwire) plus the
// pipeline-loops recording shim.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { pinEnv, installNetworkGuard, freezeClock } from './hermetic.mjs';

pinEnv();
installNetworkGuard();
freezeClock(process.env.REPLAY_NOW);
const here = path.dirname(new URL(import.meta.url).pathname);
const target = pathToFileURL('/home/user/LinearViewer/lib/pipeline-loops.js').href;
process.env.REPLAY_REAL_URL = target + '?real';
register(pathToFileURL(path.join(here, 'capture-hooks.mjs')).href, {
  data: { target, shim: pathToFileURL(path.join(here, 'capture-shim.mjs')).href }
});
