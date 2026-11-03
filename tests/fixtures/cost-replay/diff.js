/**
 * LIN-4177: the replay's diff. Walks two JSON-stable replay outputs and lists every leaf path that
 * differs, as dotted paths (`S1.LIN-42.body.totalUsd`). A key present in only one side is a difference
 * at that path.
 *
 * A list whose items each have a distinct key compares BY KEY, not by position: a lineage that joins a
 * list shifts every later index, and that is not a difference in any lineage's figure. The key is the
 * item's `rootItemId` (lineage sessions), else its `id` (job rows), else its `kind` (per-kind rows), else
 * its `model`. The path names the key (`S1.LIN-42.body.workerSessions.P.costUsd`); a repeated key in one
 * list is named by its occurrence (`<key>#2`). Any other array compares by index.
 */

const KEY_FIELDS = ['rootItemId', 'id', 'kind', 'model'];

/** The key an item is listed under, or null when it has none. */
function keyOf(item) {
  for (const field of KEY_FIELDS) {
    if (item && typeof item === 'object' && typeof item[field] === 'string') return item[field];
  }
  return null;
}

/** Whether a value is a non-empty list whose every item has a key. */
const isKeyedList = (value) => Array.isArray(value) && value.length > 0
  && value.every(item => item && typeof item === 'object' && keyOf(item) !== null);

/** A keyed list as an object (see the header). */
function byKey(list) {
  const out = {};
  const seen = new Map();
  for (const item of list) {
    const base = keyOf(item);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    out[count === 1 ? base : `${base}#${count}`] = item;
  }
  return out;
}

function walk(a, b, path, out) {
  if (a === b) return;
  if (isKeyedList(a) || isKeyedList(b)) {
    walk(Array.isArray(a) ? byKey(a) : a, Array.isArray(b) ? byKey(b) : b, path, out);
    return;
  }
  const aObj = a !== null && typeof a === 'object';
  const bObj = b !== null && typeof b === 'object';
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const next = path ? `${path}.${key}` : key;
    if (!(key in a) || !(key in b)) out.push(next);
    else walk(a[key], b[key], next, out);
  }
}

/** Every differing path between two replay outputs, in key order. */
export function diffReplay(golden, current) {
  const out = [];
  walk(golden, current, '', out);
  return out;
}
