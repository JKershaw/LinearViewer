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
 * Pure, and a leaf: it is also served to the browser as /shared/cost-format.js (LIN-4446), so it imports nothing and touches no global at load.
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

/**
 * The words for a sum with its coverage (plan "the figure rule", LIN-4179): the figure a surface shows for
 * `readCalls` (or any priced/unpriced count). Complete is the USD figure; a partly priced sum names its gap
 * ("$0.33, 2 not priced"); a sum with nothing priced reads "not priced"; no inputs reads "no data". Never a dollar
 * figure for an unknown, and a complete zero stays "$0.00".
 *
 * @param {{usd: number, priced: number, unpriced: number}} figure  the priced sum and the counts behind it
 * @param {{fine?: boolean}} [options]
 * @returns {string}
 */
export function sumWords({ usd, priced, unpriced }, { fine = false } = {}) {
  if (priced + unpriced === 0) return 'no data';
  if (unpriced === 0) return formatUsd(usd, { fine }) ?? 'not priced';
  if (priced === 0) return 'not priced';
  return `${formatUsd(usd, { fine })}, ${unpriced} not priced`;
}
