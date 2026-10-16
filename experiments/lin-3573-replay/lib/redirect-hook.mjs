// Resolve hook (loader thread): the real routes/proxy.js is imported twice, as
// `.../routes/proxy.js?variant=old` and `?variant=new`. Its static imports of
// ./proxy-writes.js and ./proxy-rulings.js are redirected to the variant's
// run-time `.mjs` copies. Every other specifier resolves normally, so both variants
// share one instance of each lib module and differ only in the two routers (and in
// the per-variant module-scope singletons inside proxy.js, e.g. commentDedupe).
let map = {};

export async function initialize(data) {
  map = data.map;
}

export async function resolve(specifier, context, nextResolve) {
  const m = /\/routes\/proxy\.js\?variant=([a-z0-9_-]+)$/i.exec(context.parentURL || '');
  if (m && (specifier === './proxy-writes.js' || specifier === './proxy-rulings.js')) {
    const v = map[m[1]];
    if (!v) throw new Error(`redirect-hook: unknown variant ${m[1]}`);
    return { url: specifier === './proxy-writes.js' ? v.writes : v.rulings, format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
