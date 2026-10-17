// --import preload for one test child process (test tier). Same hermetic
// setup as the in-process tiers, except loopback sockets are allowed (route
// tests bind 127.0.0.1 servers). Every import of the repo's
// lib/dispatch-factory.js / lib/dispatch-validation.js — from tests, routes,
// lib or server.js — is redirected to this side's recording shim, which
// re-exports the SIDE's copy wrapped by lib/test-record.mjs.
import { pinEnv, installNetworkGuard, freezeClock, installSeededRandom } from './hermetic.mjs';
import { registerHooks } from './sides.mjs';

const side = JSON.parse(process.env.REPLAY_SIDE_JSON);
pinEnv();
installNetworkGuard({ allowLoopback: true });
if (process.env.REPLAY_FREEZE !== '0') freezeClock(process.env.REPLAY_NOW);
installSeededRandom(Number(process.env.REPLAY_SEED || 1));
registerHooks([side], { redirect: side.redirect });
