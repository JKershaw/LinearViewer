// Module-resolution hook (loader thread), full-tree sides (#4b).
//
// Each side (old/new) is a COMPLETE source tree (routes/ + lib/ + server.js),
// pinned from one commit into its own folder (pin-side.mjs). The harness imports
// a side's three routers as `<root>/routes/<file>?side=<label>`. For any import
// made from a module carrying `?side=<label>`:
//   - the specifier resolves as Node would from the importer's real path;
//   - a result inside that side's root (not node_modules) gets `?side=<label>`.
// So each side owns a PRIVATE instance of its OWN lib graph (the new side's
// lib/dispatch-entrance.js, factory caches, provider registry, limiter memory):
// nothing leaks between sides, and a side that adds or changes lib files is
// replayed with exactly those files. Bare packages a tree cannot resolve fall
// back to the default repo's node_modules. Every resolution is reported.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let roots = {};        // label -> absolute root
let fallbackRoot = null;
let port = null;

export async function initialize(data) {
  roots = data.roots;
  fallbackRoot = data.fallbackRoot;
  port = data.port;
}

const stripQuery = (u) => u.replace(/[?#].*$/, '');
const sideOfQuery = (u) => { const m = /[?&]side=([^&#]+)/.exec(u || ''); return m ? m[1] : null; };

function tag(url, label) {
  if (!label || !url.startsWith('file:') || !roots[label]) return url;
  const p = fileURLToPath(stripQuery(url));
  const rel = path.relative(roots[label], p);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('node_modules')) return url;
  return `${stripQuery(url)}?side=${label}`;
}

async function resolveWithFallback(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (fallbackRoot && !specifier.startsWith('.') && !specifier.startsWith('/') && !/^(node:|file:|data:)/.test(specifier)) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(fallbackRoot, 'routes', 'proxy.js')).href });
    }
    throw e;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  const qSide = sideOfQuery(parent);
  let r;
  let via = 'direct';
  if (qSide && !/^(node:|data:)/.test(specifier)) {
    const base = await resolveWithFallback(specifier, { ...context, parentURL: stripQuery(parent) }, nextResolve);
    r = { ...base, url: tag(base.url, qSide) };
    via = 'side';
  } else {
    r = await nextResolve(specifier, context);
  }
  port?.postMessage({ parent, specifier, url: r.url, via, side: qSide ?? null });
  return r;
}
