#!/usr/bin/env node
// Re-record pinned/test-calls.json: every request the origin/main unit tests
// that mount createWorkspaceApiRoutes (directly or via server.js) send to it.
//   node capture-tests.mjs [--repo <snapshot>] [--jobs 6]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureTests } from '../../replay-kit/lib/router/capture.mjs';
const TOOL = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repo = args.includes('--repo') ? path.resolve(args[args.indexOf('--repo') + 1]) : path.join(TOOL, '../../replay-kit/snapshots/16e7ae77');
const jobs = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : 6;
const RE = /createWorkspaceApiRoutes|routes\/workspace-api\.js|from '\.\.\/\.\.\/server\.js'|server\.js'\)/;
const files = readdirSync(path.join(repo, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`)
  .filter(f => RE.test(readFileSync(path.join(repo, f), 'utf8')));
await captureTests({ repo, files, routeKeyModule: path.join(TOOL, 'lib/gen.mjs'), outFile: path.join(TOOL, 'pinned/test-calls.json'), jobs, workDir: path.join(TOOL, 'work') });
