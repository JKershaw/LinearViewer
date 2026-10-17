// Module-resolution hook (loader thread).
//
// Each side (old/new) is a private work tree `work/<run>/<side>/routes/`
// holding copies of that side's three router files. For an import made FROM a
// side's work tree:
//   1. a relative specifier that exists in the work tree resolves there;
//   2. else, if the same relative path exists in the side's SOURCE folder(s)
//      (a rebuild's new helper, any name), it is copied in and resolved there;
//   3. else it resolves as if the importer sat in <lib>/routes/ — `../lib/x.js`,
//      `express`, … — and a file under <lib> (not node_modules) gets the query
//      `?side=<label>`. That query is propagated to everything those modules
//      import, so each side owns a PRIVATE instance of the whole repo lib graph
//      (dispatch-factory's task-done cache, the provider registry, …): shared
//      module state can never leak from one side into the other.
// Bare specifiers that <lib> cannot resolve (a checkout without node_modules)
// fall back to the default repo. Every resolution is reported for the census.
import { statSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let sides = [];
let libRoot = null;
let fallbackRoot = null;
let port = null;

export async function initialize(data) {
  sides = data.sides;
  libRoot = data.libRoot;
  fallbackRoot = data.fallbackRoot;
  port = data.port;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const stripQuery = (u) => u.replace(/[?#].*$/, '');
const sideOfQuery = (u) => { const m = /[?&]side=([^&#]+)/.exec(u || ''); return m ? m[1] : null; };

function tag(url, label) {
  if (!label || !url.startsWith('file:')) return url;
  const p = fileURLToPath(stripQuery(url));
  const rel = path.relative(libRoot, p);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) return url;
  return `${stripQuery(url)}?side=${label}`;
}

async function resolveWithFallback(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (fallbackRoot && fallbackRoot !== libRoot && !specifier.startsWith('.') && !specifier.startsWith('/') && !/^(node:|file:|data:)/.test(specifier)) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(fallbackRoot, 'routes', 'proxy.js')).href });
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
  if (side && !/^(node:|data:)/.test(specifier)) {
    const parentPath = fileURLToPath(stripQuery(parent));
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
      const mapped = pathToFileURL(path.join(libRoot, 'routes', relParent.startsWith('..') ? 'proxy.js' : relParent)).href;
      const base = specifier.startsWith('file:') ? await nextResolve(specifier, context) : await resolveWithFallback(specifier, { ...context, parentURL: mapped }, nextResolve);
      r = { ...base, url: tag(base.url, side.label) };
      via = 'lib';
    }
  } else if (qSide) {
    const base = await resolveWithFallback(specifier, { ...context, parentURL: stripQuery(parent) }, nextResolve);
    r = { ...base, url: tag(base.url, qSide) };
    via = 'lib';
  } else {
    r = await nextResolve(specifier, context);
  }
  port?.postMessage({ parent, specifier, url: r.url, via, side: side?.label ?? qSide ?? null });
  return r;
}
