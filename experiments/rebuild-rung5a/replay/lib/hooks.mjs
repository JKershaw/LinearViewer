// Module-resolution hook (loader thread).
//
// Each side (old/new) is a private work tree `work/run-<pid>/<side>/lib/`
// holding copies of that side's two target files. For an import made FROM a
// side's work tree:
//   1. a relative specifier that already exists in the work tree resolves there
//      (so `./dispatch-validation.js` from the side's factory is the SAME side's
//      validation);
//   2. else, if the same relative path exists in the side's SOURCE folder but
//      NOT in the repo's lib/ (a rebuild's new helper, e.g.
//      `lib/dispatch-guards.js`), it is copied into the work tree on demand and
//      resolved there (REPLAY_SIDE_LIB_ALL=1: also for files the repo has);
//   3. else it resolves as if the importer sat in <repo>/lib/, so every other
//      lib module and every package is ONE shared instance across both sides.
// Test tier only: `redirect` maps a repo target URL (lib/dispatch-factory.js,
// lib/dispatch-validation.js) to this side's recording shim for every importer
// except the shim itself.
import { statSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let sides = [];
let repoLib = null;
let redirect = {};
let port = null;

export async function initialize(data) {
  sides = data.sides || [];
  repoLib = data.repoLib;
  redirect = data.redirect || {};
  port = data.port || null;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  const side = sides.find(s => parent.startsWith(s.workLibUrl));
  let r;
  let via = 'direct';
  if (side && !/^(node:|data:)/.test(specifier)) {
    const parentPath = fileURLToPath(parent);
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = path.resolve(path.dirname(parentPath), specifier);
      const rel = path.relative(side.workLib, target);
      const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      if (inside && isFile(target)) {
        r = { url: pathToFileURL(target).href, shortCircuit: true, format: 'module' };
        via = 'side';
      } else if (inside && isFile(path.join(side.srcLib, rel)) && (!isFile(path.join(repoLib, rel)) || process.env.REPLAY_SIDE_LIB_ALL === '1')) {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(side.srcLib, rel), target);
        r = { url: pathToFileURL(target).href, shortCircuit: true, format: 'module' };
        via = 'side-copied';
      } else if (inside) {
        r = await nextResolve(pathToFileURL(path.join(repoLib, rel)).href, context);
        via = 'repo';
      }
    }
    if (!r) {
      if (specifier.startsWith('file:')) {
        r = await nextResolve(specifier, context);
        via = 'absolute';
      } else {
        const relParent = path.relative(side.workLib, parentPath);
        const mapped = pathToFileURL(path.join(repoLib, relParent)).href;
        r = await nextResolve(specifier, { ...context, parentURL: mapped });
        via = 'repo';
      }
    }
  } else {
    r = await nextResolve(specifier, context);
  }
  const shim = redirect[r.url];
  if (shim && !parent.startsWith(shim.shimDirUrl) && !sides.some(s => parent.startsWith(s.workLibUrl))) {
    r = { url: shim.url, shortCircuit: true, format: 'module' };
    via = 'shim';
  }
  if (port && side) port.postMessage({ parent, specifier, url: r.url, via, side: side.label });
  return r;
}
