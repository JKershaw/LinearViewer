// Capture-phase resolve hook: every import of the repo's lib/pipeline-loops.js
// (from tests, lib/ or routes/) is handed the recording shim instead; the
// shim's own import of the real module carries `?real` and passes through.
let target = null;
let shim = null;
export async function initialize(data) { target = data.target; shim = data.shim; }
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url === target && !(context.parentURL || '').startsWith(shim)) return { url: shim, shortCircuit: true, format: 'module' };
  return r;
}
