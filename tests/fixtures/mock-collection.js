/**
 * Minimal in-memory mock of the MongoDB/MangoDB collection surface, shared by
 * store unit tests. Supports the operators the local-store relies on:
 * insertOne, findOne, find().toArray(), updateOne ($set + upsert), deleteOne,
 * deleteMany, findOneAndDelete. Query matching is top-level field equality, plus
 * a `{ $gt: value }` operator (used by the dispatch store's expiresAt filter) —
 * enough for the scope/kind/_id/identifier/parentId filters the stores use.
 */
export function createMockCollection() {
  const docs = [];

  const fieldMatches = (value, condition) => {
    if (condition && typeof condition === 'object' &&
        ('$gt' in condition || '$gte' in condition || '$lt' in condition || '$lte' in condition)) {
      if ('$gt' in condition && !(value > condition.$gt)) return false;
      if ('$gte' in condition && !(value >= condition.$gte)) return false;
      if ('$lt' in condition && !(value < condition.$lt)) return false;
      if ('$lte' in condition && !(value <= condition.$lte)) return false;
      return true;
    }
    return value === condition;
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
      let results = docs.filter(d => matches(d, query)).map(d => ({ ...d }));
      // Honour exclusion projections (`{ field: 0 }`) — the only form the stores
      // use (the lean feed's `{ prompt: 0 }`, LIN-623). Mirrors MangoDB/Mongo so
      // projection-pushdown tests see fields actually dropped.
      const projection = options && options.projection;
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
      return { async toArray() { return results; } };
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
      if (update.$set) docs[idx] = { ...docs[idx], ...update.$set };
      return { matchedCount: 1, modifiedCount: 1 };
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
