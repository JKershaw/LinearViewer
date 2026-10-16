// Capture the renderRoadmapPage inputs used by the existing unit tests by
// running each (pinned, from git) test file under the hermetic preload with the
// renderer swapped for a recording shim. Output: work/captured-<now>.v8
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { execFileSync, spawnSync } from 'node:child_process';
import { rewriteImports } from './load.mjs';

export const REPO = '/home/user/LinearViewer';
export const PIN = 'c2bc9a65';
export const TEST_FILES = [
  'tests/unit/roadmap-integration.test.js',
  'tests/unit/roadmap-model-override.test.js',
  'tests/unit/page-title-primitive.test.js',
  'tests/unit/render-team-selector-threading.test.js'
];

const here = path.dirname(new URL(import.meta.url).pathname);

export function capturePath(workDir, now) {
  return path.join(workDir, `captured-${now.replace(/[:.]/g, '')}.v8`);
}

export function runCapture({ workDir, now, lib, log = console.log }) {
  workDir = path.resolve(workDir);
  const testDir = path.join(workDir, 'tests');
  fs.mkdirSync(testDir, { recursive: true });
  const all = { now, pin: PIN, files: [] };
  for (const rel of TEST_FILES) {
    const src = execFileSync('git', ['-C', REPO, 'show', `${PIN}:${rel}`], { encoding: 'utf8' });
    const { out, missing } = rewriteImports(src, path.join(REPO, path.dirname(rel)));
    if (missing.length) throw new Error(`${rel}: unresolved imports ${missing.join(', ')}`);
    const base = path.basename(rel).replace(/\.js$/, '.mjs');
    const testCopy = path.join(testDir, base);
    fs.writeFileSync(testCopy, out);
    const outFile = path.join(testDir, base + '.v8');
    fs.rmSync(outFile, { force: true });
    const r = spawnSync(process.execPath, ['--import', path.join(here, 'capture-preload.mjs'), testCopy], {
      cwd: REPO,
      env: { ...process.env, TZ: 'UTC', REPLAY_NOW: now, REPLAY_LIB: lib, REPLAY_CAPTURE_OUT: outFile },
      encoding: 'utf8'
    });
    const pass = Number((r.stdout.match(/^# pass (\d+)/m) || [])[1] ?? NaN);
    const fail = Number((r.stdout.match(/^# fail (\d+)/m) || [])[1] ?? NaN);
    const passM = r.stdout.match(/ℹ pass (\d+)/); const failM = r.stdout.match(/ℹ fail (\d+)/);
    const testsPass = Number.isNaN(pass) ? Number(passM?.[1]) : pass;
    const testsFail = Number.isNaN(fail) ? Number(failM?.[1]) : fail;
    if (!fs.existsSync(outFile)) {
      throw new Error(`capture of ${rel} produced no output (exit ${r.status}):\n${r.stderr.slice(-2000)}`);
    }
    const records = v8.deserialize(fs.readFileSync(outFile));
    all.files.push({ file: rel, exit: r.status, testsPass, testsFail, records });
    log(`  captured ${String(records.length).padStart(3)} renderRoadmapPage calls from ${rel} (tests pass ${testsPass}, fail ${testsFail}, exit ${r.status})`);
  }
  const dest = capturePath(workDir, now);
  fs.writeFileSync(dest, v8.serialize(all));
  return all;
}

export function loadCapture({ workDir, now, lib, recapture = false, log }) {
  const p = capturePath(workDir, now);
  if (!recapture && fs.existsSync(p)) return v8.deserialize(fs.readFileSync(p));
  log?.(`capturing test inputs (pinned ${PIN}, clock ${now})`);
  return runCapture({ workDir, now, lib, log });
}
