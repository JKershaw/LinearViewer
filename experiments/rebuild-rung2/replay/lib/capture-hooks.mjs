// Module resolve hook: when a test file imports lib/render-roadmap.js, hand it
// the recording shim instead. The shim's own import of the real file is not
// redirected (its parent is not a test file).
let target = null;
let shim = null;

export async function initialize(data) {
  target = data.target;
  shim = data.shim;
}

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url === target && context.parentURL && context.parentURL.includes('/tests/')) {
    return { url: shim, shortCircuit: true, format: 'module' };
  }
  return r;
}
