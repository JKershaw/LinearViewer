// Read-trace hook for the move probe (LIN-3861). Preloaded with `--import` (the probe passes it
// through NODE_OPTIONS, so every per-file `node --test` child inherits it). It wraps `readFileSync`,
// `readFile` and `promises.readFile` on `fs`, and for each read whose normalised path (doubled
// slashes collapsed) matches the pattern appends one `<reading test file>\t<unit file>` line to the
// output file.
//   MOVE_PROBE_TRACE_PATTERN  regex source matched against the normalised path
//   MOVE_PROBE_TRACE_OUT      file the lines are appended to
// The reading test file is the nearest `tests/` frame in the stack. A read with
// the module loader as its immediate caller (`node:internal/modules`) is the loader importing the
// file, not a test reading its text, and is skipped.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const pattern = process.env.MOVE_PROBE_TRACE_PATTERN ? new RegExp(process.env.MOVE_PROBE_TRACE_PATTERN) : null;
const out = process.env.MOVE_PROBE_TRACE_OUT;
const append = fs.appendFileSync;
const HOOK_FILE = 'tests/probes/read-trace-hook.mjs';
const TESTS_FRAME = /(?:file:\/\/)?(\/[^\s():]*?\/(tests\/[^\s():]+?\.(?:m?js|cjs))):\d+:\d+/;

function normalise(p) {
  try {
    if (p instanceof URL) return fileURLToPath(p).replace(/\/{2,}/g, '/');
    if (typeof p === 'string') return p.replace(/^file:\/\//, '').replace(/\/{2,}/g, '/');
    if (Buffer.isBuffer(p)) return p.toString().replace(/\/{2,}/g, '/');
  } catch { /* an unreadable argument is not a path */ }
  return null;
}

function record(p) {
  if (!pattern || !out) return;
  const path = normalise(p);
  if (!path) return;
  const hit = pattern.exec(path);
  if (!hit) return;
  // The default limit (10 frames) can cut the stack off before it reaches the test file.
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  const frames = stack.split('\n').filter((l) => l.trim().startsWith('at ') && !l.includes(HOOK_FILE));
  // The loader's own read has the loader as its immediate caller. A test module that reads at its top
  // level also has the loader somewhere BELOW it (it is being evaluated), so only the caller counts.
  if (frames[0]?.includes('node:internal/modules')) return;
  const frame = frames.map((l) => TESTS_FRAME.exec(l)).find(Boolean);
  if (!frame) return;
  append(out, `${frame[2]}\t${hit[0].replace(/^\//, '')}\n`);
}

for (const name of ['readFileSync', 'readFile']) {
  const real = fs[name];
  fs[name] = function (p, ...rest) { record(p); return real.call(this, p, ...rest); };
}
const realPromisesReadFile = fs.promises.readFile;
fs.promises.readFile = function (p, ...rest) { record(p); return realPromisesReadFile.call(this, p, ...rest); };
syncBuiltinESMExports();
