/**
 * LIN-3949 — shifts the process's wall clock forward by CLOCK_SHIFT_DAYS, so the
 * unit suite can run as if it were days, weeks or years later. A unit test whose
 * fixture dates were pinned against the real clock goes red in a shifted run
 * before the date passes, instead of on `main` after it.
 *
 * Loaded with `--import` via NODE_OPTIONS, so every `node --test` child gets it:
 *   npm run test:clock-shift
 * Unset or 0, it changes nothing.
 *
 * Three properties, each pinned by tests/unit/clock-shift.test.js:
 *   - `new Date()` and `Date()` build real Date instances (same prototype), so
 *     deepStrictEqual against a real Date still holds;
 *   - a test's own `Date.now = () => X` stub is kept, and argless `new Date()`
 *     follows it, as it would against the real clock;
 *   - a `vm` context gets the shifted Date too, so a sandboxed slice and the test
 *     that stamps its fixtures read the same clock.
 *
 * Not shifted, by construction: `performance.*`, file mtimes, and any child
 * process started without NODE_OPTIONS. Server-side time (a MongoDB TTL monitor,
 * `$$NOW`) is in another process and is not shifted either.
 */
const days = Number(process.env.CLOCK_SHIFT_DAYS || 0);
const off = days * 86400000;
if (off) {
  const Real = Date;
  const origNow = Real.now;
  const shiftedNow = () => origNow.call(Real) + off;
  // A test that stubbed Date.now keeps its stub; otherwise the shifted clock.
  const currentNow = () => (Real.now === origNow ? shiftedNow() : Real.now());
  globalThis.Date = new Proxy(Real, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [currentNow()], newTarget === globalThis.Date ? target : newTarget);
    },
    apply() { return new Real(currentNow()).toString(); },
    get(target, prop) {
      if (prop === 'now') return target.now === origNow ? shiftedNow : target.now;
      return Reflect.get(target, prop, target);
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}
// A vm context has its own intrinsic Date, unshifted. Hand it the shifted one so a
// sandboxed slice and the test that stamps its fixtures read the same clock.
if (off) {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const vm = createRequire(import.meta.url)('node:vm');
  const origCreate = vm.createContext;
  vm.createContext = function (ctx = {}, ...rest) {
    if (ctx && typeof ctx === 'object' && !Object.prototype.hasOwnProperty.call(ctx, 'Date')) ctx.Date = globalThis.Date;
    return origCreate.call(this, ctx, ...rest);
  };
  const origRun = vm.runInNewContext;
  vm.runInNewContext = function (code, ctx = {}, ...rest) { return origRun.call(this, code, vm.createContext(ctx), ...rest); };
  syncBuiltinESMExports();
}
