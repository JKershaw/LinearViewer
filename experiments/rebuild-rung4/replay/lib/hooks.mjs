// Module-resolution hook (runs on the loader thread).
//
// Each side (old/new) is a private work tree `work/<run>/<side>/routes/`
// holding copies of that side's router files (plus `package.json` with
// "type":"module"). For an import made FROM a side's work tree:
//   1. a relative specifier that already exists in the work tree resolves there;
//   2. else, if the same relative path exists in the side's SOURCE folder(s)
//      (any name — e.g. a rebuild's new helper `routes/write-guards.js`), it is
//      copied into the work tree on demand and resolved there;
//   3. else it resolves as if the importer sat in <repo>/routes/ (so
//      '../lib/x.js', './dashboard.js', 'express' share the repo's single
//      module instances across both sides).
// Every resolution is reported to the main thread for the import census.
import { existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let sides = [];
let repoRoutes = null;
let port = null;

export async function initialize(data) {
  sides = data.sides;
  repoRoutes = data.repoRoutes;
  port = data.port;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  const side = sides.find(s => parent.startsWith(s.workRootUrl));
  let r;
  let via = 'direct';
  if (side && !/^(node:|file:|data:)/.test(specifier)) {
    const parentPath = fileURLToPath(parent);
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = path.resolve(path.dirname(parentPath), specifier);
      const rel = path.relative(side.workRoutesPath, target);
      const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      if (inside && isFile(target)) {
        r = { url: pathToFileURL(target).href, shortCircuit: true };
        via = 'side';
      } else if (inside) {
        const src = side.srcDirs.map(d => path.join(d, rel)).find(isFile);
        if (src) {
          mkdirSync(path.dirname(target), { recursive: true });
          copyFileSync(src, target);
          r = { url: pathToFileURL(target).href, shortCircuit: true };
          via = 'side-copied';
        }
      }
    }
    if (!r) {
      const relParent = path.relative(side.workRoutesPath, parentPath);
      const mapped = pathToFileURL(path.join(repoRoutes, relParent.startsWith('..') ? 'proxy.js' : relParent)).href;
      r = await nextResolve(specifier, { ...context, parentURL: mapped });
      via = 'repo';
    }
  } else {
    r = await nextResolve(specifier, context);
  }
  port?.postMessage({ parent, specifier, url: r.url, via, side: side?.label ?? null });
  return r;
}

void existsSync;
