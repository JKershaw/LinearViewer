/**
 * Minimal in-memory mock of the MongoDB/MangoDB collection surface, shared by
 * store unit tests. Supports the operators the local-store relies on:
 * insertOne, findOne, find().toArray(), updateOne ($set + upsert), deleteOne,
 * deleteMany. Query matching is top-level field equality — enough for the
 * scope/kind/_id/identifier/parentId filters the stores use.
 */
export function createMockCollection() {
  const docs = [];

  const matches = (doc, query) =>
    Object.keys(query).every(key => doc[key] === query[key]);

  return {
    _docs: docs,

    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    },

    async findOne(query) {
      const found = docs.find(d => matches(d, query));
      return found ? { ...found } : null;
    },

    find(query) {
      const results = docs.filter(d => matches(d, query)).map(d => ({ ...d }));
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
