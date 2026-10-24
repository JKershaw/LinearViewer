// Read-trace hook for the move probe (LIN-3861). Preloaded with `--import` (the probe passes it
// through NODE_OPTIONS, so every per-file `node --test` child inherits it). It wraps `readFileSync`,
// `readFile` and `promises.readFile` on `fs`, and for each read whose normalised path (doubled
// slashes collapsed) matches the pattern appends one `<reading test file>\t<unit file>` line to the
// output file.
//   MOVE_PROBE_TRACE_PATTERN  regex source matched against the normalised path
//   MOVE_PROBE_TRACE_OUT      file the lines are appended to
// The reading test file is the nearest `tests/` frame in the stack. A read whose stack goes through
// the module loader (`node:internal/modules`) is the loader importing the file, not a test reading
// its text, and is skipped.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const pattern = process.env.MOVE_PROBE_TRACE_PATTERN ? new RegExp(process.env.MOVE_PROBE_TRACE_PATTERN) : null;
const out = process.env.MOVE_PROBE_TRACE_OUT;
const append = fs.appendFileSync;
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
  const stack = new Error().stack ?? '';
  if (stack.includes('node:internal/modules')) return;
  const frame = stack.split('\n').map((l) => TESTS_FRAME.exec(l)).find(Boolean);
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
