/**
 * Time Utility Functions
 *
 * Shared timestamp parsing for the whole of lib/ (LIN-3453): one place decides
 * how "a Date, a date string, or junk" becomes epoch milliseconds.
 */

/**
 * Parses a Date, a date string or a number to epoch milliseconds.
 *
 * Returns `null` (never `NaN`) for anything that is not a usable time:
 * null/undefined, '', unparseable strings, Invalid Date, booleans, objects,
 * and numbers that are non-finite or outside the Date range (±8.64e15).
 * `0` is a valid epoch and is returned as `0`. Callers must treat `null` as
 * missing: it coerces to `0` in `<`, `<=` and `Math.min`, so guard with
 * `!= null` before comparing.
 *
 * @param {Date|string|number|null|undefined} value - Value to parse
 * @returns {number|null} Epoch milliseconds, or null when unusable
 */
export function toEpochMs(value) {
  const ms = value instanceof Date ? value.getTime()
    : (typeof value === 'string' || typeof value === 'number') ? new Date(value).getTime()
    : NaN;
  return Number.isFinite(ms) ? ms : null;
}
