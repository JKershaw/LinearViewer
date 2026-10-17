#!/usr/bin/env node
// Per-caller replay of the "waiting on a person" decision: each caller's outsider-visible
// output, old tree vs new tree, on captured unit-test inputs plus seeded generated inputs.
//
//   node replay.mjs --old <treeDir> --new <treeDir> [--n 3000] [--seed 1] [--out report.json]
//                   [--captured captured.jsonl] [--only <callerId>] [--coverage] [--quiet]
//
// A tree is a checkout (or `pin-side.mjs` folder) with lib/ and routes/ and a node_modules
// it can resolve. Exit 0 = no differences, 1 = differences (or a caller missing on one side),
// 2 = tool failure. Frozen clock, TZ=UTC, seeded Math.random, no network.
process.env.TZ = 'UTC';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from 'node:inspector/promises';
import net from 'node:net';
import dns from 'node:dns';
import { toTagged, fromTagged, canon } from './codec.mjs';
import { CALLERS, FIXED_NOW_MS, rngFor } from './callers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const OLD = opt('old'); const NEW = opt('new');
if (!OLD || !NEW) { console.error('usage: replay.mjs --old <treeDir> --new <treeDir> [--n 3000] [--seed 1] [--out f] [--only id] [--coverage]'); process.exit(2); }
const N = Number(opt('n', '3000')); const SEED = opt('seed', '1');
const ONLY = opt('only', null); const OUT = opt('out', null);
const CAPTURED = opt('captured', join(HERE, 'captured.jsonl'));
const COVERAGE = flag('coverage'); const QUIET = flag('quiet');

// ── hermetic: no network, frozen clock ──
let netAttempts = 0;
const deny = (name) => function () { netAttempts++; throw new Error(`replay: network blocked (${name})`); };
net.connect = deny('net.connect'); net.createConnection = deny('net.createConnection');
dns.lookup = deny('dns.lookup');
globalThis.fetch = async () => { netAttempts++; throw new Error('replay: fetch blocked'); };
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED_NOW_MS); else super(...a); }
  static now() { return FIXED_NOW_MS; }
}
globalThis.Date = FrozenDate;
const realRandom = Math.random;

// ── coverage (optional) ──
let session = null;
if (COVERAGE) {
  session = new Session(); session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

for (const [label, dir] of [['old', OLD], ['new', NEW]]) {
  for (const need of ['lib', 'routes']) if (!existsSync(join(dir, need))) { console.error(`${label} tree ${dir} has no ${need}/`); process.exit(2); }
}

const silence = () => { const saved = {}; for (const k of ['log', 'info', 'warn', 'error', 'debug']) { saved[k] = console[k]; console[k] = () => {}; } return () => Object.assign(console, saved); };

async function load(dir, file) {
  const restore = silence();
  try { return { mod: await import(pathToFileURL(resolve(dir, file)).href) }; } catch (err) { return { err: `${err.name}: ${err.message}` }; } finally { restore(); }
}
const resolvePath = (mod, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), mod);

async function invoke(fn, tagged, seedKey) {
  const args = fromTagged(tagged);
  const r = rngFor(SEED, 'random', seedKey); Math.random = r.next;
  const restore = silence();
  let out;
  try {
    let v = fn(...args);
    if (v && typeof v.then === 'function') v = await v;
    out = { ok: canon(v) };
  } catch (err) {
    out = { throw: `${err?.name}: ${err?.message}` };
  } finally { restore(); Math.random = realRandom; }
  out.argsAfter = canon(args);
  return out;
}

const captured = new Map();
if (existsSync(CAPTURED)) {
  for (const line of readFileSync(CAPTURED, 'utf8').split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (!captured.has(rec.id)) captured.set(rec.id, []);
    captured.get(rec.id).push(rec.args);
  }
}

const report = { old: resolve(OLD), new: resolve(NEW), n: N, seed: SEED, frozenNow: new RealDate(FIXED_NOW_MS).toISOString(), callers: {}, totals: { inputs: 0, diffs: 0, missing: 0 } };
const t0 = RealDate.now();
for (const c of CALLERS) {
  if (ONLY && c.id !== ONLY) continue;
  const o = await load(OLD, c.file); const n = await load(NEW, c.file);
  const fo = o.mod && resolvePath(o.mod, c.path); const fn = n.mod && resolvePath(n.mod, c.path);
  const entry = { file: c.file, export: c.path.join('.'), sites: c.sites, captured: 0, generated: 0, diffs: 0, diffKinds: {}, examples: [] };
  report.callers[c.id] = entry;
  if (typeof fo !== 'function' || typeof fn !== 'function') {
    entry.missing = { old: typeof fo === 'function' ? null : (o.err || 'export missing'), new: typeof fn === 'function' ? null : (n.err || 'export missing') };
    report.totals.missing++; continue;
  }
  const inputs = [];
  for (const a of captured.get(c.id) || []) inputs.push({ src: 'test', tagged: a });
  entry.captured = inputs.length;
  for (let i = 0; i < N; i++) inputs.push({ src: `gen#${i}`, tagged: toTagged(c.gen(rngFor(SEED, c.id, i))) });
  entry.generated = N;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const a = await invoke(fo, inp.tagged, `${c.id}#${i}`);
    const b = await invoke(fn, inp.tagged, `${c.id}#${i}`);
    const kinds = [];
    if ((a.ok === undefined) !== (b.ok === undefined)) kinds.push('outcome');
    else if (a.ok !== undefined && a.ok !== b.ok) kinds.push('return');
    else if (a.throw !== b.throw) kinds.push('error');
    if (a.argsAfter !== b.argsAfter) kinds.push('input-mutation');
    if (kinds.length) {
      entry.diffs++;
      for (const k of kinds) entry.diffKinds[k] = (entry.diffKinds[k] || 0) + 1;
      if (entry.examples.length < 5) entry.examples.push({ input: inp.src, kinds, args: JSON.stringify(inp.tagged).slice(0, 1500), old: (a.ok ?? a.throw).slice(0, 1500), new: (b.ok ?? b.throw).slice(0, 1500) });
    }
  }
  report.totals.inputs += inputs.length; report.totals.diffs += entry.diffs;
  if (!QUIET) console.log(`${entry.diffs ? 'DIFF' : 'same'}  ${c.id.padEnd(50)} inputs ${String(inputs.length).padStart(5)} (test ${entry.captured})  diffs ${entry.diffs}${entry.diffs ? ' ' + JSON.stringify(entry.diffKinds) : ''}`);
}
report.totals.ms = RealDate.now() - t0;
report.totals.networkAttempts = netAttempts;

// Line coverage of the touched functions (the functions holding a site), per side.
const TOUCHED = {
  'lib/digest-feedback.js': ['deriveLoopFacingFacts'], 'lib/render-run-steps.js': ['runIsWaiting'],
  'routes/dashboard.js': ['loopIsWaiting', 'deriveSessionWaiting'], 'lib/run-view.js': ['waitingClock'],
  'lib/task-page-loader.js': ['sessionMessage'], 'lib/dispatch-terminal.js': ['deriveBlockedStatus', 'deriveLifecycleStatus', 'deriveWireStatus', 'isWaitingWakeMarker'],
  'lib/unanswered-decisions.js': ['resolveDisposition'], 'lib/observer-sweep.js': ['classifyLoop'], 'lib/recent-runs.js': ['recentRuns'],
  'lib/pipeline-loops.js': ['_deriveAgentState'], 'lib/live-console.js': ['statusToKind'],
  'lib/observer-efficacy-signal.js': ['findFirstBlockedMarker', 'computeIncumbentSignal'], 'lib/dispatch-wake.js': ['classifyWake'],
  'lib/render-session.js': ['renderTranscript'],
};
if (session) {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  report.coverage = {};
  for (const [label, dir] of [['old', OLD], ['new', NEW]]) {
    for (const [file, fns] of Object.entries(TOUCHED)) {
      const url = pathToFileURL(resolve(dir, file)).href;
      const script = result.find(s => s.url === url);
      if (!script) continue;
      const src = readFileSync(resolve(dir, file), 'utf8');
      for (const name of fns) {
        const f = script.functions.find(x => x.functionName === name);
        if (!f) continue;
        const [whole, ...inner] = f.ranges;
        const countAt = (off) => { let best = whole; for (const r of inner) if (off >= r.startOffset && off < r.endOffset && (r.endOffset - r.startOffset) <= (best.endOffset - best.startOffset)) best = r; return best.count; };
        let total = 0, covered = 0; const missed = [];
        let off = whole.startOffset; const lineStart = src.lastIndexOf('\n', off) + 1; off = lineStart;
        let lineNo = src.slice(0, lineStart).split('\n').length;
        while (off < whole.endOffset) {
          const nl = src.indexOf('\n', off); const end = nl === -1 ? src.length : nl;
          const text = src.slice(off, end); const lead = text.search(/\S/);
          if (lead !== -1 && !/^\s*(\/\/|\*|\/\*|[}\])]+;?\s*$)/.test(text)) {
            const p = Math.max(off + lead, whole.startOffset);
            total++; if (countAt(p) > 0) covered++; else missed.push(lineNo);
          }
          off = end + 1; lineNo++;
        }
        report.coverage[`${label}:${file}:${name}`] = { lines: total, covered, pct: total ? Math.round(1000 * covered / total) / 10 : null, missed };
      }
    }
  }
  if (!QUIET) for (const [k, v] of Object.entries(report.coverage)) if (k.startsWith('new:')) console.log(`cov ${k.slice(4).padEnd(60)} ${v.covered}/${v.lines} (${v.pct}%)${v.missed.length ? ' missed ' + v.missed.join(',') : ''}`);
}
console.log(`TOTAL inputs ${report.totals.inputs} diffs ${report.totals.diffs} missing ${report.totals.missing} network ${netAttempts} in ${report.totals.ms} ms`);
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
process.exit(report.totals.missing || report.totals.diffs ? 1 : 0);
