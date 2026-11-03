/**
 * lib/cost-format.js: the one USD formatter for a cost figure (LIN-4177, plan LIN-4176 "one formatter").
 *
 *  - Cents by default: `$12.40`.
 *  - A nonzero amount under half a cent reads `<$0.01`, so it is never shown as `$0.00`.
 *  - `fine`: four decimals under $1 (per-call surfaces, where the cents hide the cost): `$0.0421`.
 *    A nonzero amount under half a ten-thousandth reads `<$0.0001`.
 *  - A complete zero is a real `$0.00` (or `$0.0000` with `fine`).
 *  - `null`, `undefined` or a non-finite value returns null: the caller says what it means
 *    ("no data", "not priced"). It never becomes `$0.00`.
 *
 * Pure. The browser copies are replaced by this file's parity with the server copy (LIN-4177 piece 3).
 *
 * @param {number|null|undefined} value
 * @param {{fine?: boolean}} [options]
 * @returns {string|null}
 */
export function formatUsd(value, { fine = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return fine ? '$0.0000' : '$0.00';
  if (fine && magnitude < 1) {
    if (magnitude < 0.00005) return `${sign}<$0.0001`;
    return `${sign}$${magnitude.toFixed(4)}`;
  }
  if (magnitude < 0.005) return `${sign}<$0.01`;
  return `${sign}$${magnitude.toFixed(2)}`;
}
