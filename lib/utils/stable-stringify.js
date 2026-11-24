/**
 * A stable JSON string for any value: object keys sorted at every depth, so two logically-equal inputs hash the same.
 * Array order is kept. Pure; imports nothing.
 *
 * LIN-4537: the one copy. It lived twice, in the recap cache (retired with the model-written recap) and
 * lib/run-summary-cache.js; every hash over a canonical form imports it from here.
 *
 * @param {*} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(v => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k]));
  return '{' + parts.join(',') + '}';
}
