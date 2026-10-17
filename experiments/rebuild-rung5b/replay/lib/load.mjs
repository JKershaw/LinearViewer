// Make one "side" (old or new version of the four renderer modules) importable.
//
// A side is a directory (holding render.js, render-session.js, render-swipe.js,
// render-settings.js — directly or under lib/) or a comma list of files. Each
// target is copied into work/copies/<label>-<hash>/ with every RELATIVE import
// rewritten in place (line count preserved, so V8 coverage line numbers equal
// the source file's). Resolution of a relative specifier, taken relative to the
// side root as if it were lib/:
//   1. a target module (render*.js of the cluster)        -> this side's copy
//   2. a file that exists in the side but not in --lib     -> this side's copy
//      (a NEW helper module the rebuild added; recursively rewritten too)
//   3. a file that exists in both                          -> --lib (shared
//      instance with the other side), unless --prefer-side
//   4. otherwise                                           -> error, name the spec
// Absolute file:// specifiers (the pinned copies) and node: builtins are kept.
// Bare package specifiers resolve through a node_modules symlink to the repo's.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const REPO = '/home/user/LinearViewer';
export const DEFAULT_LIB = path.join(REPO, 'lib');
export const TARGETS = {
  render: 'render.js',
  session: 'render-session.js',
  swipe: 'render-swipe.js',
  settings: 'render-settings.js'
};
const TARGET_FILES = new Set(Object.values(TARGETS));

const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

function findTargets(spec) {
  const out = {};
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 1 && fs.existsSync(parts[0]) && fs.statSync(parts[0]).isDirectory()) {
    const dir = path.resolve(parts[0]);
    for (const [key, name] of Object.entries(TARGETS)) {
      for (const cand of [path.join(dir, name), path.join(dir, 'lib', name), path.join(dir, name.replace(/\.js$/, '.mjs'))]) {
        if (fs.existsSync(cand)) { out[key] = cand; break; }
      }
    }
    const root = out.render && path.dirname(out.render) !== dir && fs.existsSync(path.join(dir, 'lib')) ? path.join(dir, 'lib') : dir;
    return { root, files: out };
  }
  for (const p of parts) {
    const abs = path.resolve(p);
    const base = path.basename(abs).replace(/\.mjs$/, '.js');
    const key = Object.entries(TARGETS).find(([, n]) => n === base)?.[0];
    if (!key) throw new Error(`${p}: not one of ${[...TARGET_FILES].join(', ')}`);
    out[key] = abs;
  }
  const roots = new Set(Object.values(out).map(f => path.dirname(f)));
  if (roots.size !== 1) throw new Error('files given as a list must share one directory');
  return { root: [...roots][0], files: out };
}

export function prepareSide(spec, { label, workDir, libDir = DEFAULT_LIB, preferSide = false, onlyTargets = null }) {
  const { root, files } = findTargets(spec);
  const want = onlyTargets || Object.keys(TARGETS);
  const missingTargets = want.filter(k => !files[k]);
  if (missingTargets.length) throw new Error(`${label}: ${spec} lacks ${missingTargets.map(k => TARGETS[k]).join(', ')}`);

  // First pass: read + rewrite every reachable side file (to compute the hash
  // before choosing the output directory).
  const plan = new Map(); // abs src -> { rel, src, rewrittenTemplate, deps }
  const resolutions = [];
  const queue = want.map(k => files[k]);
  const missing = [];
  while (queue.length) {
    const abs = queue.shift();
    if (plan.has(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(root, abs);
    const parts = [];
    let last = 0;
    for (const m of src.matchAll(SPEC_RE)) {
      const [whole, lead, q, s] = m;
      const relTarget = path.normalize(path.join(path.dirname(rel), s));
      const sideCand = path.join(root, relTarget);
      const libCand = path.join(libDir, relTarget);
      const sideHas = fs.existsSync(sideCand) && fs.statSync(sideCand).isFile();
      const libHas = fs.existsSync(libCand) && fs.statSync(libCand).isFile();
      let to;
      if (sideHas && (TARGET_FILES.has(relTarget) || !libHas || preferSide)) {
        to = { kind: 'side', abs: sideCand, rel: relTarget };
        queue.push(sideCand);
      } else if (libHas) {
        to = { kind: 'lib', url: pathToFileURL(libCand).href };
      } else {
        missing.push(`${rel}: '${s}'`);
        to = { kind: 'missing', url: s };
      }
      resolutions.push({ from: rel, spec: s, via: to.kind === 'side' ? (TARGET_FILES.has(relTarget) ? 'side-target' : (libHas ? 'side-preferred' : 'side-helper')) : to.kind, to: to.rel || to.url });
      parts.push(src.slice(last, m.index), { lead, q, to });
      last = m.index + whole.length;
    }
    parts.push(src.slice(last));
    plan.set(abs, { rel, src, parts });
  }
  if (missing.length) throw new Error(`${label}: relative imports resolve neither in the side nor under ${libDir}: ${missing.join('; ')} (pass --${label}-lib <dir>)`);

  const hash = crypto.createHash('sha256');
  for (const [abs, p] of [...plan].sort((a, b) => a[1].rel.localeCompare(b[1].rel))) hash.update(p.rel + '\0' + p.src + '\0' + libDir + '\0');
  const h = hash.digest('hex').slice(0, 12);
  const outRoot = path.join(workDir, `${label}-${h}`);
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'package.json'), '{"type":"module"}\n');
  const nm = path.join(outRoot, 'node_modules');
  if (!fs.existsSync(nm)) { try { fs.symlinkSync(path.join(path.dirname(libDir), 'node_modules'), nm, 'dir'); } catch { /* best effort */ } }

  const out = { label, spec, root, libDir, outRoot, hash: h, targets: {}, files: [], resolutions };
  for (const [abs, p] of plan) {
    const dest = path.join(outRoot, p.rel);
    let text = '';
    for (const part of p.parts) {
      if (typeof part === 'string') { text += part; continue; }
      const url = part.to.kind === 'side' ? pathToFileURL(path.join(outRoot, part.to.rel)).href : part.to.url;
      text += `${part.lead}${part.q}${url}${part.q}`;
    }
    if (text.split('\n').length !== p.src.split('\n').length) throw new Error(`rewrite changed line count of ${p.rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    const rec = { src: abs, rel: p.rel, dest, url: pathToFileURL(dest).href, target: TARGET_FILES.has(p.rel) };
    out.files.push(rec);
    const key = Object.entries(TARGETS).find(([, n]) => n === p.rel)?.[0];
    if (key && want.includes(key)) out.targets[key] = rec;
  }
  return out;
}

export async function importSide(prep) {
  const mods = {};
  for (const [key, rec] of Object.entries(prep.targets)) mods[key] = await import(rec.url);
  return mods;
}

/** Rewrite relative imports of one file to absolute file:// URLs (for pinning). */
export function pinRewrite(src, libDir = DEFAULT_LIB) {
  const out = src.replace(SPEC_RE, (m, lead, q, s) => `${lead}${q}${pathToFileURL(path.resolve(libDir, s)).href}${q}`);
  if (out.split('\n').length !== src.split('\n').length) throw new Error('line count changed');
  return out;
}
