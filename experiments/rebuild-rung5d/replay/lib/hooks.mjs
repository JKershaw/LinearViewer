// Loader hook (registered inside each worker): a module imported from a side
// tree as `…/lib/pipeline-loops.js?inst=<id>` passes the same `?inst=<id>` to
// every module it imports from INSIDE that side tree, so a rebuild's helper
// modules get a fresh instance (fresh module-level state) per scenario, just
// like the main file. Repo modules outside the side trees stay shared.
let roots = [];
export async function initialize(data) { roots = data.roots || []; }
export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  const parent = context.parentURL || '';
  const q = parent.match(/\?inst=[^&#]+/);
  if (q && r.url.startsWith('file:') && !r.url.includes('?') && roots.some(root => r.url.startsWith(root))) {
    return { ...r, url: r.url + q[0] };
  }
  return r;
}
