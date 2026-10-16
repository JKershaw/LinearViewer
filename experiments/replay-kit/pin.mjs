#!/usr/bin/env node
// node pin.mjs <sha> <lib/file.js> <outDir> [snapshotDir]
// Pins lib/<file> at <sha> into <outDir>, imports rewritten to the snapshot.
import path from 'node:path';
import { pinCopy, ensureSnapshot } from './lib/sides.mjs';
const [sha, rel, outDir, snapArg] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const snapshotDir = snapArg || path.join(here, 'snapshots', sha.slice(0, 8));
ensureSnapshot({ sha, dir: snapshotDir });
const r = pinCopy({ sha, relPath: rel, outDir, snapshotDir });
console.log(JSON.stringify({ pinned: path.join(outDir, path.basename(rel)), lines: r.lines, rewrites: r.rewrites.length, snapshotDir }));
