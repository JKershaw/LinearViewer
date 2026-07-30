/**
 * Minimal in-memory mock of the MongoDB/MangoDB collection surface, shared by
 * store unit tests. Supports the operators the local-store relies on:
 * insertOne, findOne, find().toArray(), updateOne ($set + $push + $addToSet +
 * upsert), findOneAndUpdate ($push + returnDocument), deleteOne, deleteMany,
 * findOneAndDelete, countDocuments. Query matching is top-level field equality,
 * plus `{ $gt/$gte/$lt/$lte: value }` and `{ $ne: value }` operators (used by
 * the dispatch store's expiresAt filter and LIN-1357's terminalWakeItems
 * per-item once-only guard) — enough for the scope/kind/_id/identifier/parentId
 * filters the stores use. `$ne` on an array-valued field is array-membership
 * (mirrors Mongo: matches unless some element equals the value), used by
 * LIN-1357's `terminalWakeItems: { $ne: doc._id }` CAS filter.
 *
 * `find()` returns a chainable cursor supporting `.sort()/.skip()/.limit()`
 * before `.toArray()`, applied in Mongo's documented order (sort → skip → limit →
 * projection). This mirrors the real driver closely enough for the bounded
 * history read (LIN-1030) to be exercised in unit tests.
 *
 * Also supports `{ $in: [...] }` (used by the Observation materializer's
 * followUpTo BFS batch lookups, LIN-1307).
 *
 * `$set` supports dot-path keys (e.g. `"wakeWitnessMeta.<id>.mintedWakeId"`),
 * writing/creating only the named leaf without clobbering sibling keys under
 * the same parent object — mirrors Mongo/MangoDB's dot-notation `$set`, used
 * by LIN-1698's durable wake witness.
 *
 * This mock's single-body-per-call design means every op below is atomic BY
 * CONSTRUCTION — it cannot reproduce the interleavings a real engine can
 * (see LIN-1343: concurrency pins for `addFeedback` run against a real
 * MangoDB tmpdir instance instead, since a mock would pass vacuously).
 */
export function createMockCollection() {
  const docs = [];

  const fieldMatches = (value, condition) => {
    if (condition && typeof condition === 'object') {
      if ('$gt' in condition || '$gte' in condition || '$lt' in condition || '$lte' in condition) {
        if ('$gt' in condition && !(value > condition.$gt)) return false;
        if ('$gte' in condition && !(value >= condition.$gte)) return false;
        if ('$lt' in condition && !(value < condition.$lt)) return false;
        if ('$lte' in condition && !(value <= condition.$lte)) return false;
        return true;
      }
      if ('$in' in condition) {
        return Array.isArray(condition.$in) && condition.$in.includes(value);
      }
      // $ne: value !== condition — absent-field semantics matter here
      // (LIN-1343's terminalWakeEnqueued was absent-or-true, never false), so
      // `undefined !== true` correctly matches an absent field. For an
      // array-valued field (LIN-1357's terminalWakeItems), Mongo's $ne checks
      // membership across the array rather than comparing the array itself —
      // matches unless SOME element equals the value.
      if ('$ne' in condition) {
        if (Array.isArray(value)) return !value.includes(condition.$ne);
        return value !== condition.$ne;
      }
    }
    return value === condition;
  };

  // Immutable dot-path $set (e.g. "wakeWitnessMeta.<id>.mintedWakeId"), used
  // by LIN-1698's durable wake witness. Mirrors Mongo/MangoDB's dot-notation
  // $set: writes/creates only the named leaf, never clobbering sibling keys
  // under the same parent object.
  const setAtPath = (obj, path, value) => {
    const [head, ...rest] = path.split('.');
    if (rest.length === 0) return { ...obj, [head]: value };
    const child = (obj && typeof obj[head] === 'object' && obj[head] !== null) ? obj[head] : {};
    return { ...obj, [head]: setAtPath(child, rest.join('.'), value) };
  };

  // Applies $set/$push/$addToSet update operators to a doc, returning a NEW
  // object (never mutates the input) so callers holding the pre-update doc
  // (e.g. a findOneAndUpdate caller reading the stored array reference) are
  // unaffected. Shared by updateOne and findOneAndUpdate so both operators
  // behave identically regardless of which method applies them.
  const applyUpdate = (doc, update) => {
    let next = doc;
    if (update.$set) {
      next = { ...next };
      for (const [key, value] of Object.entries(update.$set)) {
        next = key.includes('.') ? setAtPath(next, key, value) : { ...next, [key]: value };
      }
    }
    if (update.$push) {
      next = { ...next };
      for (const [field, value] of Object.entries(update.$push)) {
        const existing = Array.isArray(next[field]) ? next[field] : [];
        next[field] = [...existing, value];
      }
    }
    // $addToSet: like $push, but a value already present is not duplicated
    // (LIN-1357's terminalWakeItems — same producing item re-reporting its
    // terminal must not grow the set).
    if (update.$addToSet) {
      next = { ...next };
      for (const [field, value] of Object.entries(update.$addToSet)) {
        const existing = Array.isArray(next[field]) ? next[field] : [];
        next[field] = existing.includes(value) ? existing : [...existing, value];
      }
    }
    return next;
  };

  const matches = (doc, query) =>
    Object.keys(query).every(key => fieldMatches(doc[key], query[key]));

  return {
    _docs: docs,

    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    },

    async findOneAndDelete(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return null;
      const [removed] = docs.splice(idx, 1);
      return { ...removed };
    },

    async findOne(query) {
      const found = docs.find(d => matches(d, query));
      return found ? { ...found } : null;
    },

    find(query, options = {}) {
      const projection = options && options.projection;
      let sortSpec = null;
      let skipN = 0;
      let limitN = null;
      const cursor = {
        sort(spec) { sortSpec = spec; return cursor; },
        skip(n) { skipN = n; return cursor; },
        limit(n) { limitN = n === 0 ? null : Math.abs(n); return cursor; },
        async toArray() {
          let results = docs.filter(d => matches(d, query)).map(d => ({ ...d }));
          // Sort → skip → limit → projection, matching the driver's documented order.
          if (sortSpec) {
            const entries = Object.entries(sortSpec);
            results.sort((a, b) => {
              for (const [field, dir] of entries) {
                const av = a[field];
                const bv = b[field];
                let cmp = 0;
                if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
                else if (av < bv) cmp = -1;
                else if (av > bv) cmp = 1;
                if (cmp !== 0) return dir === 1 ? cmp : -cmp;
              }
              return 0;
            });
          }
          if (skipN) results = results.slice(skipN);
          if (limitN != null) results = results.slice(0, limitN);
          // Honour exclusion projections (`{ field: 0 }`) — the only form the stores
          // use (the lean feed's `{ prompt: 0 }`, LIN-623). Mirrors MangoDB/Mongo so
          // projection-pushdown tests see fields actually dropped.
          if (projection) {
            const excluded = Object.keys(projection).filter(k => projection[k] === 0);
            if (excluded.length) {
              results = results.map(d => {
                const copy = { ...d };
                for (const k of excluded) delete copy[k];
                return copy;
              });
            }
          }
          return results;
        }
      };
      return cursor;
    },

    async countDocuments(query = {}) {
      return docs.filter(d => matches(d, query)).length;
    },

    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) {
        if (opts.upsert && update.$set) {
          docs.push({ ...query, ...update.$set });
          return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, upsertedCount: 0 };
      }
      docs[idx] = applyUpdate(docs[idx], update);
      return { matchedCount: 1, modifiedCount: 1 };
    },

    // findOneAndUpdate with $push + returnDocument ('before'|'after'), added
    // for LIN-1343's atomic addFeedback append. No upsert support — nothing in
    // this codebase's addFeedback-class callers needs it.
    async findOneAndUpdate(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return null;
      const before = docs[idx];
      const after = applyUpdate(before, update);
      docs[idx] = after;
      return { ...(opts.returnDocument === 'before' ? before : after) };
    },

    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },

    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}
