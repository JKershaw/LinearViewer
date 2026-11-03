/**
 * LIN-4177: the replay's diff. Walks two JSON-stable replay outputs and lists every leaf path that
 * differs, as dotted paths (`S1.LIN-42.body.totalUsd`). Arrays compare by index; a key present in
 * only one side is a difference at that path.
 */

function walk(a, b, path, out) {
  if (a === b) return;
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
