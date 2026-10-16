// Resolve `--old/--new <dirOrFiles>` into one source file per router slot,
// and lay out a side's private work tree.
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exportsFactory = (src, name) => new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(src);

/**
 * @param {string} spec - a folder, or a comma-separated list of files
 * @param {Record<string,{file:string,factory:string}>} slots - the slots wanted
 * @returns {{srcDirs: string[], files: Record<string,string>, missing: string[]}}
 */
export function resolveSide(spec, slots) {
  const parts = spec.split(',').map(s => path.resolve(s.trim())).filter(Boolean);
  let candidates = [];
  const srcDirs = [];
  for (const p of parts) {
    let st;
    try { st = statSync(p); } catch { throw new Error(`no such file or folder: ${p}`); }
    if (st.isDirectory()) {
      srcDirs.push(p);
      candidates.push(...readdirSync(p).filter(f => /\.(m?js)$/.test(f)).map(f => path.join(p, f)));
    } else {
      if (!srcDirs.includes(path.dirname(p))) srcDirs.push(path.dirname(p));
      candidates.push(p);
    }
  }
  candidates = [...new Set(candidates)];
  const files = {};
  const missing = [];
  for (const [slot, def] of Object.entries(slots)) {
    // 1. by the canonical file name (also .mjs); 2. by the exported factory
    const byName = candidates.find(c => path.basename(c) === def.file || path.basename(c) === def.file.replace(/\.js$/, '.mjs'));
    const found = byName || candidates.find(c => { try { return exportsFactory(readFileSync(c, 'utf8'), def.factory); } catch { return false; } });
    if (found) files[slot] = found; else missing.push(slot);
  }
  return { srcDirs, files, missing };
}

/** Create work/<run>/<label>/{package.json, routes/<files>} and return its layout. */
export function layoutSide(label, workDir, side) {
  const root = path.join(workDir, label);
  const routes = path.join(root, 'routes');
  mkdirSync(routes, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  const copies = {};
  for (const [slot, src] of Object.entries(side.files)) {
    const dest = path.join(routes, path.basename(src));
    copyFileSync(src, dest);
    copies[slot] = { src, dest, url: pathToFileURL(dest).href };
  }
  return {
    label,
    workRootUrl: pathToFileURL(root + path.sep).href,
    workRoutesPath: routes,
    srcDirs: side.srcDirs,
    copies,
  };
}
