// Lay out a side (old/new) as a private work tree and rewrite its imports.
//   - `--old/--new` take a folder (holding pipeline-loops.js) or a file.
//   - The main file and every relative import that exists inside the side's
//     SOURCE folder are copied to work/<run>/<label>/lib/ (relative specifier
//     kept), so a rebuild's own helper modules are part of the side and get a
//     fresh instance per scenario (see hooks.mjs).
//   - Any other relative import is rewritten IN PLACE (line-preserving) to an
//     absolute file:// URL into the repo's lib/, so both sides share one
//     instance of every unchanged repo module.
//   - Already-absolute file:// specifiers (the pinned copy) are kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO = '/home/user/LinearViewer';
export const REPO_LIB = path.join(REPO, 'lib');
export const MAIN = 'pipeline-loops.js';

const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])([^'"]+)\2/g;

export function resolveSideMain(spec) {
  const p = path.resolve(spec);
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const n of [MAIN, MAIN.replace(/\.js$/, '.mjs')]) if (fs.existsSync(path.join(p, n))) return { srcDir: p, main: path.join(p, n) };
    throw new Error(`${p}: no ${MAIN} in folder`);
  }
  return { srcDir: path.dirname(p), main: p };
}

export function layoutSide(label, spec, workDir) {
  const { srcDir, main } = resolveSideMain(spec);
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
    const dest = path.join(libOut, srcFile === main ? MAIN : rel);
    done.set(srcFile, dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const src = fs.readFileSync(srcFile, 'utf8');
    const repoDirForThis = path.join(REPO_LIB, path.dirname(srcFile === main ? MAIN : rel));
    const out = src.replace(SPEC_RE, (m, lead, q, spec) => {
      if (/^(node:|file:|data:)/.test(spec)) return m;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const inSide = path.resolve(path.dirname(srcFile), spec);
        const relInside = path.relative(srcDir, inSide);
        const inside = relInside && !relInside.startsWith('..') && !path.isAbsolute(relInside);
        if (inside && fs.existsSync(inSide) && fs.statSync(inSide).isFile()) {
          copy(inSide);
          rewrites.push({ file: rel, spec, to: 'side' });
          return m; // relative within the side tree; hook adds the instance query
        }
        const abs = path.resolve(repoDirForThis, spec);
        if (!fs.existsSync(abs)) throw new Error(`${label}: import '${spec}' in ${rel} resolves neither inside ${srcDir} nor under ${REPO_LIB}`);
        rewrites.push({ file: rel, spec, to: pathToFileURL(abs).href });
        return `${lead}${q}${pathToFileURL(abs).href}${q}`;
      }
      // bare package specifier: resolve from the repo
      try {
        const req = createRequire(path.join(REPO_LIB, 'x.js'));
        const abs = req.resolve(spec);
        rewrites.push({ file: rel, spec, to: pathToFileURL(abs).href });
        return `${lead}${q}${pathToFileURL(abs).href}${q}`;
      } catch {
        rewrites.push({ file: rel, spec, to: 'unresolved-bare' });
        return m;
      }
    });
    if (out.split('\n').length !== src.split('\n').length) throw new Error('import rewrite changed the line count');
    fs.writeFileSync(dest, out);
    files.push({ src: srcFile, dest, url: pathToFileURL(dest).href, sha: crypto.createHash('sha256').update(src).digest('hex').slice(0, 12), lines: src.split('\n').length });
    return dest;
  };
  copy(main);
  return {
    label,
    spec: path.resolve(spec),
    srcDir,
    main,
    mainUrl: pathToFileURL(path.join(libOut, MAIN)).href,
    workRootUrl: pathToFileURL(root + path.sep).href,
    files,
    rewrites,
  };
}

export function fileOfUrl(u) { return fileURLToPath(u.split('?')[0]); }
