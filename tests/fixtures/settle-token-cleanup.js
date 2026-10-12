/**
 * LIN-3528: let ProxyTokenStore's fire-and-forget cleanup settle before a
 * MangoDB tmpdir is removed.
 *
 * `ProxyTokenStore#mint` starts `this.cleanup()` without awaiting it (an
 * opportunistic prune; lib/proxy-tokens.js). On the in-memory fake that finished
 * in a microtask. On MangoDB it is several file operations, so a test that ends
 * right after minting lets `harness.close()` remove the directory while the prune
 * is still writing, which logs `Error cleaning up proxy tokens: ENOENT ...`.
 *
 * This wraps `cleanup` on the class prototype (test-side only, production
 * untouched) to remember each in-flight promise; `settle()` awaits them.
 *
 * Usage:
 *   const tokenCleanup = trackTokenStoreCleanup(ProxyTokenStore);
 *   after(async () => { await tokenCleanup.settle(); await harness.close(); });
 */
export function trackTokenStoreCleanup(StoreClass) {
  const pending = new Set();
  const original = StoreClass.prototype.cleanup;
  StoreClass.prototype.cleanup = function trackedCleanup(...args) {
    const promise = original.apply(this, args);
    pending.add(promise);
    const forget = () => pending.delete(promise);
    promise.then(forget, forget);
    return promise;
  };
  return {
    async settle() {
      while (pending.size) await Promise.allSettled([...pending]);
    }
  };
}
