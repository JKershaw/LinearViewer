/**
 * public/cost-format.js: the one USD formatter in the browser (LIN-4179, plan LIN-4176 "one formatter").
 *
 * The same rules as lib/cost-format.js `formatUsd`, restated here because a browser IIFE has no module graph to
 * lib/. tests/unit/cost-format-parity.test.js runs one input table through both and fails on any difference, so the
 * two cannot drift. Keep the two in lockstep.
 *
 *  - cents by default ($12.40); a nonzero amount under half a cent reads <$0.01;
 *  - `fine`: four decimals under $1 ($0.0421); a nonzero amount under half a ten-thousandth reads <$0.0001;
 *  - a complete zero is a real $0.00 (or $0.0000 with fine); null, undefined or non-finite returns null, never $0.00.
 *
 * Loaded before the page scripts that format a cost. Exposes window.CostFormat and, for the parity test, module.exports.
 */
(function () {
  'use strict';

  function formatUsd(value, options) {
    var fine = !!(options && options.fine);
    if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) return null;
    var sign = value < 0 ? '-' : '';
    var magnitude = Math.abs(value);
    if (magnitude === 0) return fine ? '$0.0000' : '$0.00';
    if (fine && magnitude < 1) {
      if (magnitude < 0.00005) return sign + '<$0.0001';
      return sign + '$' + magnitude.toFixed(4);
    }
    if (magnitude < 0.005) return sign + '<$0.01';
    return sign + '$' + magnitude.toFixed(2);
  }

  var api = { formatUsd: formatUsd };
  if (typeof window !== 'undefined') window.CostFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
