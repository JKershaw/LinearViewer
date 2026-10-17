// Module resolve hook (capture phase): any import of one of the four target
// modules — from a test, a route, server.js or another lib module — is handed
// the recording shim instead. The shim's own import of the real file is not
// redirected (its parent is the shim).
let map = new Map();
let shims = new Set();
export async function initialize(data) {
  map = new Map(Object.entries(data.map));
  shims = new Set(Object.values(data.map));
}
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  const shim = map.get(r.url);
  if (shim && !shims.has(context.parentURL)) return { url: shim, shortCircuit: true, format: 'module' };
  return r;
}
