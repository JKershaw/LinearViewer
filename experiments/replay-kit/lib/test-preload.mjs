// --import preload for one test child process (test tier): the hermetic setup
// (pinned TZ/env, frozen clock, seeded Math.random/randomUUID, non-loopback
// network tripwire) plus the resolve hook that hands every importer of the
// snapshot's target file this side's recording shim.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { pinEnv, installNetworkGuard, freezeClock, seedRandom, installSeededUUID } from './hermetic.mjs';

const cfg = JSON.parse(process.env.REPLAY_CHILD_JSON);
pinEnv();
installNetworkGuard();
if (cfg.freeze !== false) freezeClock(cfg.now);
installSeededUUID();
seedRandom(cfg.seed || 1);
const here = path.dirname(new URL(import.meta.url).pathname);
register(pathToFileURL(path.join(here, 'hooks.mjs')).href, { data: { roots: cfg.roots, redirect: cfg.redirect } });
