// Sides (old/new) and pinned copies. From rung5d/replay/lib/prepare.mjs,
// generalised over the target file name and the "repo lib" the unchanged
// modules resolve into (here: an origin/main SNAPSHOT, so both sides share
// one instance of every unchanged module at the pinned SHA, independent of
// whatever /home/user/LinearViewer has checked out).
//
//   - `--old/--new` take a folder holding <main> (directly or under lib/), or a file.
//   - The main file and every relative import that exists inside the side's
//     SOURCE folder are copied to <workDir>/<label>/lib/ (relative specifier
//     kept), so a rebuild's own helper modules belong to the side and get a
//     fresh instance per scenario (hooks.mjs propagates `?inst=`).
//   - Any other relative import is rewritten IN PLACE (line-preserving) to an
//     absolute file:// URL into the snapshot's lib/ (same relative position).
//   - Bare package specifiers resolve from the snapshot (whose node_modules
//     links to the repo's).
//   - Already-absolute file:// specifiers (the pinned copy) are kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO = '/home/user/LinearViewer';
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])([^'"]+)\2/g;

export function resolveSideMain(spec, main) {
  const p = path.resolve(spec);
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const d of [p, path.join(p, 'lib')]) {
      for (const n of [main, main.replace(/\.js$/, '.mjs')]) if (fs.existsSync(path.join(d, n))) return { srcDir: d, main: path.join(d, n) };
    }
    throw new Error(`${p}: no ${main} in folder (or its lib/)`);
  }
  return { srcDir: path.dirname(p), main: p };
}

/** Rewrite one source's import specifiers (line-preserving). */
export function rewriteImports(src, { srcFile, srcDir, repoDirForThis, repoLib, onSide, label = '?' }) {
  const rewrites = [];
  const out = src.replace(SPEC_RE, (m, lead, q, spec) => {
    if (/^(node:|file:|data:)/.test(spec)) return m;
    if (spec.startsWith('./') || spec.startsWith('../')) {
      if (srcDir && onSide) {
        const inSide = path.resolve(path.dirname(srcFile), spec);
        const relInside = path.relative(srcDir, inSide);
        const inside = relInside && !relInside.startsWith('..') && !path.isAbsolute(relInside);
        if (inside && fs.existsSync(inSide) && fs.statSync(inSide).isFile()) {
          onSide(inSide);
          rewrites.push({ spec, to: 'side' });
          return m;
        }
      }
      const abs = path.resolve(repoDirForThis, spec);
      if (!fs.existsSync(abs)) throw new Error(`${label}: import '${spec}' resolves neither inside the side folder nor under ${repoLib}`);
      rewrites.push({ spec, to: pathToFileURL(abs).href });
      return `${lead}${q}${pathToFileURL(abs).href}${q}`;
    }
    try {
      const req = createRequire(path.join(repoLib, 'x.js'));
      const abs = req.resolve(spec);
      rewrites.push({ spec, to: pathToFileURL(abs).href });
      return `${lead}${q}${pathToFileURL(abs).href}${q}`;
    } catch {
      rewrites.push({ spec, to: 'unresolved-bare' });
      return m;
    }
  });
  if (out.split('\n').length !== src.split('\n').length) throw new Error('import rewrite changed the line count');
  return { out, rewrites };
}

export function layoutSide(label, spec, workDir, { main, repoLib }) {
  const { srcDir, main: mainFile } = resolveSideMain(spec, main);
  const root = path.join(workDir, label);
  const libOut = path.join(root, 'lib');
  fs.mkdirSync(libOut, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  const files = [];
  const rewrites = [];
  const done = new Map();
  const copy = (srcFile) => {
    if (done.has(srcFile)) return done.get(srcFile);
    const rel = path.relative(srcDir, srcFile);
    const dest = path.join(libOut, srcFile === mainFile ? main : rel);
    done.set(srcFile, dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = fs.readFileSync(srcFile, 'utf8');
    const repoDirForThis = path.join(repoLib, path.dirname(srcFile === mainFile ? main : rel));
    const r = rewriteImports(src, { srcFile, srcDir, repoDirForThis, repoLib, onSide: copy, label });
    rewrites.push(...r.rewrites.map(x => ({ file: rel, ...x })));
    fs.writeFileSync(dest, r.out);
    files.push({ src: srcFile, dest, url: pathToFileURL(dest).href, sha: crypto.createHash('sha256').update(src).digest('hex').slice(0, 12), lines: src.split('\n').length });
    return dest;
  };
  copy(mainFile);
  return {
    label,
    spec: path.resolve(spec),
    srcDir,
    main: mainFile,
    mainUrl: pathToFileURL(path.join(libOut, main)).href,
    workRootUrl: pathToFileURL(root + path.sep).href,
    workLib: libOut,
    files,
    rewrites,
  };
}

/**
 * Pin `lib/<file>` at `sha` into `outDir`, every relative import rewritten
 * in place to the snapshot's absolute URL (line-preserving).
 */
export function pinCopy({ sha, relPath, outDir, snapshotDir }) {
  const src = execFileSync('git', ['-C', REPO, 'show', `${sha}:${relPath}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const repoLib = path.join(snapshotDir, 'lib');
  const { out, rewrites } = rewriteImports(src, { repoDirForThis: path.join(snapshotDir, path.dirname(relPath)), repoLib, label: 'pin' });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, path.basename(relPath)), out);
  return { lines: src.split('\n').length, rewrites };
}

/** Snapshot `sha` (lib routes tests public server.js package.json content scripts) once. */
export function ensureSnapshot({ sha, dir, paths = ['lib', 'routes', 'tests', 'public', 'server.js', 'package.json', 'content', 'scripts', 'docs'] }) {
  if (fs.existsSync(path.join(dir, 'SHA')) && fs.readFileSync(path.join(dir, 'SHA'), 'utf8').trim() === sha) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const tar = execFileSync('git', ['-C', REPO, 'archive', sha, ...paths], { maxBuffer: 512 << 20 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  if (!fs.existsSync(path.join(dir, 'node_modules'))) fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'SHA'), sha + '\n');
  return dir;
}

export function fileOfUrl(u) { return fileURLToPath(u.split('?')[0]); }
