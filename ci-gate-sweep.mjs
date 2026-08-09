#!/usr/bin/env node
/**
 * LIN-1455 mechanical enumeration (LIN-1871 shape).
 *
 * Enumerates every LIVE prompt-engine surface that conditions an action on
 * CI/checks being green. Run from the LinearViewer repo root:
 *
 *   node ci-gate-sweep.mjs
 *
 * Two axes, intersected. Neither is hand-listed:
 *   AXIS 1 (lexical)  — the emitted text must NAME the mechanism to impose the
 *                       gate, so the CI vocabulary below is a superset of the class.
 *   AXIS 2 (liveness) — the file must be inside the import-closure of the consumer
 *                       API's prompt-serving routes (routes/proxy.js, routes/dispatch.js),
 *                       plus any .md that closure readFileSync's at runtime.
 *
 * Also emits AXIS 3: for every live hit, the tracked files that quote it VERBATIM
 * (tests / eval harnesses / snapshots) — the set that must move when the wording moves.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['routes/proxy.js', 'routes/dispatch.js'];

// ---- AXIS 1: CI-gate vocabulary -------------------------------------------
const SIG = [
  /\bCI\b/,                                              // "CI is green", "CI green"
  /\bCI\/CD\b/,                                          // "CI/CD pipeline"
  /continuous integration/i,                             // spelled-out variant
  /statusCheckRollup|gh pr checks/,                       // the concrete tool signal
  /\b(checks?|pipeline|build|suite|PR)\b[^\n]{0,40}\b(green|passing|passes)\b/i,
  /\bgreen\b[^\n]{0,40}\b(checks?|pipeline|build|PR|commit)\b/i,
];
const matches = (line) => SIG.some((re) => re.test(line));

// ---- AXIS 2: import-closure of the prompt-serving routes ------------------
const tracked = new Set(
  execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean),
);
const IMPORT_RE = /(?:^|[^\w])(?:import|export)[\s\S]{0,200}?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const MD_RE = /['"`]([\w./-]*[\w-]+\.md)['"`]|['"`]([\w-]+\.md)['"`]/g;

const closure = new Set();
const docs = new Set();
const via = new Map(ROOTS.map((r) => [r, '(root)']));   // file -> importer, for provenance
const queue = [...ROOTS];
while (queue.length) {
  const rel = queue.shift();
  if (closure.has(rel) || !tracked.has(rel)) continue;
  closure.add(rel);
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    let target = normalize(join(dirname(rel), spec));
    if (!tracked.has(target)) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        if (tracked.has(target + ext)) { target += ext; break; }
      }
    }
    if (tracked.has(target)) { if (!via.has(target)) via.set(target, rel); queue.push(target); }
  }
  // runtime-read markdown (docs the closure serves as prompt text).
  // Only files that actually call readFileSync count — a doc merely *named* in a
  // comment is not emitted, and comes back on the verbatim-pin axis instead.
  if (!/readFileSync/.test(src)) continue;
  for (const m of src.matchAll(MD_RE)) {
    const name = m[1] || m[2];
    for (const cand of [name, join('docs', name), normalize(join(dirname(rel), name))]) {
      const c = relative(ROOT, resolve(ROOT, cand));
      if (tracked.has(c)) { docs.add(c); if (!via.has(c)) via.set(c, `${rel} (readFileSync)`); }
    }
  }
}

// ---- Report ---------------------------------------------------------------
const hit = (file) => {
  const out = [];
  const src = readFileSync(join(ROOT, file), 'utf8').split('\n');
  src.forEach((line, i) => { if (matches(line)) out.push({ file, line: i + 1, text: line.trim() }); });
  return out;
};

const liveFiles = [...closure, ...docs].filter((f) => /\.(js|mjs|md)$/.test(f)).sort();
const live = liveFiles.flatMap(hit);

const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(`# LIN-1455 CI-gate sweep @ ${sha}`);
console.log(`# closure: ${closure.size} js files + ${docs.size} runtime-read docs, from roots ${ROOTS.join(', ')}`);
console.log(`# LIVE surfaces: ${live.length} lines in ${new Set(live.map((h) => h.file)).size} files\n`);
for (const h of live) console.log(`${h.file}:${h.line}: ${h.text.slice(0, 150)}`);

console.log('\n# PROVENANCE (why each file is in the closure)');
for (const f of [...new Set(live.map((h) => h.file))].sort()) console.log(`${f}  <- imported by ${via.get(f)}`);

// ---- AXIS 3: verbatim pins (tests / evals / snapshots) --------------------
const liveSet = new Set(live.map((h) => `${h.file}:${h.line}`));
const pins = new Map();
const others = [...tracked].filter((f) => /\.(js|mjs|md|txt|json)$/.test(f) && !liveFiles.includes(f));
const otherSrc = new Map(others.map((f) => {
  try { return [f, readFileSync(join(ROOT, f), 'utf8')]; } catch { return [f, '']; }
}));
for (const h of live) {
  // longest quoted-prose fragment on the line, as the pin probe
  const frag = (h.text.match(/[A-Za-z][^'"`\\]{29,}/g) || []).sort((a, b) => b.length - a.length)[0];
  if (!frag) continue;
  const probe = frag.slice(0, 60);
  for (const [f, s] of otherSrc) if (s.includes(probe)) {
    if (!pins.has(f)) pins.set(f, []);
    pins.get(f).push(`${h.file}:${h.line}`);
  }
}
console.log(`\n# VERBATIM PINS (3a): ${pins.size} tracked files quote a live line (must move with the wording)`);
for (const [f, srcs] of [...pins].sort()) console.log(`${f}  <- ${[...new Set(srcs)].join(', ')}`);

// ---- AXIS 3b: assertion pins — files that import a live surface AND carry CI text
const liveJs = new Set(liveFiles.filter((f) => f.endsWith('.js')));
const asserters = [];
for (const [f, s] of otherSrc) {
  if (!/\.(js|mjs)$/.test(f) || !s.split('\n').some(matches)) continue;
  const imported = new Set();
  for (const m of s.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    let t = normalize(join(dirname(f), spec));
    if (!tracked.has(t)) for (const ext of ['.js', '.mjs', '/index.js']) if (tracked.has(t + ext)) { t += ext; break; }
    if (liveJs.has(t)) imported.add(t);
  }
  if (imported.size) asserters.push([f, [...imported], s.split('\n').filter(matches).length]);
}
console.log(`\n# ASSERTION PINS (3b): ${asserters.length} files import a live surface and carry CI-gate text`);
for (const [f, imp, n] of asserters.sort()) console.log(`${f}  (${n} CI lines)  <- imports ${imp.join(', ')}`);
