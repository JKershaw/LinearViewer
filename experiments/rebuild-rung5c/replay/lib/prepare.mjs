// Resolve `--old/--new <dirOrFiles>` into one source file per router slot and
// lay out a side's private work tree.
import { writeFileSync, mkdirSync, statSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SLOT_FILES = {
  session: { file: 'dispatch.js', factory: 'createDispatchRoutes' },
  proxyDispatch: { file: 'proxy-dispatch.js', factory: 'createDispatchRoutes' },
  kickoff: { file: 'proxy-kickoff.js', factory: 'createKickoffRoutes' },
};

/** @returns {{srcDirs: string[], files: Record<string,string>, missing: string[]}} */
export function resolveSide(spec) {
  const parts = spec.split(',').map(s => path.resolve(s.trim())).filter(Boolean);
  const candidates = [];
  const srcDirs = [];
  for (const p of parts) {
    let st;
    try { st = statSync(p); } catch { throw new Error(`no such file or folder: ${p}`); }
    if (st.isDirectory()) {
      srcDirs.push(p);
      candidates.push(...readdirSync(p).filter(f => /\.m?js$/.test(f)).map(f => path.join(p, f)));
    } else {
      if (!srcDirs.includes(path.dirname(p))) srcDirs.push(path.dirname(p));
      candidates.push(p);
    }
  }
  const files = {};
  const missing = [];
  for (const [slot, def] of Object.entries(SLOT_FILES)) {
    // by canonical file name (also .mjs); kickoff alone may also be found by its unique factory export
    let found = candidates.find(c => path.basename(c) === def.file || path.basename(c) === def.file.replace(/\.js$/, '.mjs'));
    if (!found && slot === 'kickoff') found = candidates.find(c => { try { return /export\s+(async\s+)?function\s+createKickoffRoutes\b/.test(readFileSync(c, 'utf8')); } catch { return false; } });
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
    const dest = path.join(routes, SLOT_FILES[slot].file);
    copyFileSync(src, dest);
    copies[slot] = { src, dest, url: pathToFileURL(dest).href };
  }
  return { label, workRootUrl: pathToFileURL(root + path.sep).href, workRoutesPath: routes, srcDirs: side.srcDirs, copies };
}
