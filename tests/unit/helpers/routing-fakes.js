/**
 * In-memory stand-ins for the three model-routing collections and the preferences
 * collection (LIN-3853), shared by the routing tests. Equality filters only, which is all
 * the store uses; a duplicate `_id` (or `urlKey`+`seq` on the log) fails with code 11000
 * as the real unique indexes do, so the store's duplicate handling is exercised.
 */
import { ModelRoutingStore } from '../../../lib/model-routing-store.js';
import { WorkspacePreferencesStore } from '../../../lib/workspace-preferences.js';

export function memoryCollection({ unique = [] } = {}) {
  const docs = [];
  const matches = (doc, query = {}) => Object.entries(query).every(([k, v]) => doc[k] === v);
  const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  const cursor = (rows) => {
    let out = rows;
    const c = {
      sort(spec) {
        const [[key, dir]] = Object.entries(spec);
        out = [...out].sort((a, b) => (a[key] - b[key]) * dir);
        return c;
      },
      limit(n) { out = out.slice(0, n); return c; },
      async toArray() { return out.map((d) => structuredClone(d)); }
    };
    return c;
  };
  return {
    _docs: docs,
    async findOne(query) { const d = docs.find((x) => matches(x, query)); return d ? structuredClone(d) : null; },
    find(query) { return cursor(docs.filter((d) => matches(d, query))); },
    async countDocuments(query) { return docs.filter((d) => matches(d, query)).length; },
    async insertOne(doc) {
      if (docs.some((d) => d._id === doc._id)) throw dup();
      for (const keys of unique) if (docs.some((d) => keys.every((k) => d[k] === doc[k]))) throw dup();
      docs.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find((d) => matches(d, query));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, structuredClone(update.$set || {}));
      return { matchedCount: 1 };
    },
    async deleteOne(query) {
      const i = docs.findIndex((d) => matches(d, query));
      if (i >= 0) docs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async deleteMany(query) {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], query)) { docs.splice(i, 1); n++; }
      return { deletedCount: n };
    }
  };
}

/** A real WorkspacePreferencesStore wired to a real ModelRoutingStore over memory collections. */
export function routingFixture(options = {}) {
  const prefs = memoryCollection();
  const collections = {
    routing: memoryCollection(),
    log: memoryCollection({ unique: [['urlKey', 'seq']] }),
    presets: memoryCollection()
  };
  const preferencesStore = new WorkspacePreferencesStore({ collection: prefs });
  const routingStore = new ModelRoutingStore({
    collection: collections.routing,
    logCollection: collections.log,
    presetsCollection: collections.presets,
    getPreferences: (urlKey) => preferencesStore.getWorkspacePreferences(urlKey),
    ...options
  });
  preferencesStore.routingStore = routingStore;
  return { prefs, collections, preferencesStore, routingStore };
}
