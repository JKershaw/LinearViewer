// Module resolve hook (registered in each worker / test child).
//   1. Instance propagation (in-process tiers): a module imported from a side
//      tree as `…?inst=<id>` passes the same `?inst=<id>` to every module it
//      imports from INSIDE that side tree, so a rebuild's helper modules get a
//      fresh instance per scenario, like the main file. Snapshot modules
//      outside the side trees stay shared.
//   2. Redirect (test tier): every import of the snapshot's target URL — from
//      tests, lib, routes or server.js — is handed this side's recording shim;
//      the shim's and the side tree's own imports pass through.
let roots = [];
let redirect = {};
export async function initialize(data) { roots = data.roots || []; redirect = data.redirect || {}; }
export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  const parent = context.parentURL || '';
  const shim = redirect[r.url];
  if (shim && !parent.startsWith(shim.shimDirUrl) && !roots.some(root => parent.startsWith(root))) {
    return { url: shim.url, shortCircuit: true, format: 'module' };
  }
  const q = parent.match(/\?inst=[^&#]+/);
  if (q && r.url.startsWith('file:') && !r.url.includes('?') && roots.some(root => r.url.startsWith(root))) {
    return { ...r, url: r.url + q[0] };
  }
  return r;
}
