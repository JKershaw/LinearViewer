// --import preload for one unit-test file during capture: pinned TZ, cleared
// provider/email env, loopback-only network, optional frozen clock, and the
// resolve hook that swaps the four targets for recording shims.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PINNED_PREFIXES, installNetworkGuard, freezeClock } from './hermetic.mjs';

for (const k of Object.keys(process.env)) if (PINNED_PREFIXES.some(p => k.startsWith(p))) delete process.env[k];
process.env.TZ = 'UTC';
installNetworkGuard({ allowLoopback: true });
if (process.env.REPLAY_FREEZE === '1') freezeClock(process.env.REPLAY_NOW);
const here = path.dirname(new URL(import.meta.url).pathname);
register(pathToFileURL(path.join(here, 'capture-hooks.mjs')).href, { data: { map: JSON.parse(process.env.REPLAY_SHIM_MAP) } });
