// Module-resolution hook (loader thread) for router replays.
// From rung5c/replay/lib/hooks.mjs, generalised (sub-folder, seams).
//
// Each side (old/new) is a private work tree `work/<run>/<side>/<subdir>/`
// holding copies of that side's target file(s). For an import made FROM a
// side's work tree:
//   1. a relative specifier that exists in the work tree resolves there;
//   2. else, if the same relative path exists in the side's SOURCE folder(s)
//      (a rebuild's new helper, any name), it is copied in and resolved there;
//   3. else it resolves as if the importer sat in <lib>/<subdir>/ — `../lib/x.js`,
//      `./sibling.js`, `express`, … — and a file under <lib> (not node_modules)
//      gets the query `?side=<label>`. That query is propagated to everything
//      those modules import, so each side owns a PRIVATE instance of the whole
//      repo lib graph: module state never leaks from one side into the other.
//
// Seams: `seams[<lib-relative path>]` names modules whose side instances are
// replaced by a generated shim (`seamShims[label][path]`, written by the
// harness) that re-exports the real module (imported with `&seamreal=1`) and
// swaps the named exports for recorders. Every importer inside the side —
// the target AND lib modules — gets the shim, so a fake model/upstream call is
// one boundary however the target reaches it.
//
// Bare specifiers that <lib> cannot resolve fall back to the default repo.
// Every resolution is reported for the census.
import { statSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let sides = [];
let libRoot = null;
let fallbackRoot = null;
let port = null;
let subdir = 'routes';
let seamShims = {};

export async function initialize(data) {
  sides = data.sides;
  libRoot = data.libRoot;
  fallbackRoot = data.fallbackRoot;
  port = data.port;
  subdir = data.subdir || 'routes';
  seamShims = data.seamShims || {};
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const stripQuery = (u) => u.replace(/[?#].*$/, '');
const sideOfQuery = (u) => { const m = /[?&]side=([^&#]+)/.exec(u || ''); return m ? m[1] : null; };

function tag(url, label) {
  if (!label || !url.startsWith('file:')) return url;
  if (/[?&]seamreal=1/.test(url)) return url;
  const p = fileURLToPath(stripQuery(url));
  const rel = path.relative(libRoot, p);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) return url;
  const shim = seamShims[label]?.[rel.split(path.sep).join('/')];
  if (shim) return `${shim}?side=${label}`;
  return `${stripQuery(url)}?side=${label}`;
}

async function resolveWithFallback(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (fallbackRoot && fallbackRoot !== libRoot && !specifier.startsWith('.') && !specifier.startsWith('/') && !/^(node:|file:|data:)/.test(specifier)) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(fallbackRoot, 'server.js')).href });
    }
    throw e;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  const side = sides.find(s => parent.startsWith(s.workRootUrl));
  const qSide = sideOfQuery(parent);
  let r;
  let via = 'direct';
  if (/[?&]seamreal=1/.test(specifier)) {
    r = { url: specifier, shortCircuit: true, format: 'module' };
    via = 'seam-real';
  } else if (side && !/^(node:|data:)/.test(specifier)) {
    const parentPath = fileURLToPath(stripQuery(parent));
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = path.resolve(path.dirname(parentPath), specifier);
      const rel = path.relative(side.workDirPath, target);
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
      const relParent = path.relative(side.workDirPath, parentPath);
      const mapped = pathToFileURL(path.join(libRoot, subdir, relParent.startsWith('..') ? '__side__.js' : relParent)).href;
      const base = specifier.startsWith('file:') ? await nextResolve(specifier, context) : await resolveWithFallback(specifier, { ...context, parentURL: mapped }, nextResolve);
      r = { ...base, url: tag(base.url, side.label) };
      via = 'lib';
    }
  } else if (qSide) {
    const realParent = stripQuery(parent);
    const base = await resolveWithFallback(specifier, { ...context, parentURL: realParent }, nextResolve);
    r = { ...base, url: tag(base.url, qSide) };
    via = 'lib';
  } else {
    r = await nextResolve(specifier, context);
  }
  port?.postMessage({ parent, specifier, url: r.url, via, side: side?.label ?? qSide ?? null });
  return r;
}
