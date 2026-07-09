/**
 * Ship's Biscuit edition-history store: durable per-workspace newspaper editions
 * (LIN-818, V1). One document per generated edition, workspace-scoped by urlKey,
 * bounded by a per-workspace cap (newest N kept). Filtering/sorting happens in JS so
 * MongoDB and file-based MangoDB behave identically.
 *
 * Modelled directly on lib/report-history-store.js (same durable-artifact posture):
 * NO TTL — a saved edition is a durable artifact a reader can come back to, not a
 * cache or audit log. The cap bounds storage. save/list/get/getLatest/clear mirror
 * ReportHistoryStore so the wiring and tests transfer.
 *
 * §A note (deferred to V2): article bodies are NOT stored here yet. When the V2
 * on-demand article pass lands, caching a generated body will mutate a persisted
 * edition — this store has no partial-update method (matching ReportHistoryStore),
 * so V2 must add `updateArticleBody` or a sibling keyed cache. V1 stores the front
 * page + index (stubs with by-value sourceRefs) only.
 *
 * Schema (one document per edition):
 * {
 *   _id:          string,   // edition UUID
 *   urlKey:       string,   // workspace URL key (indexed)
 *   generatedAt:  Date,     // when the edition was generated
 *   model:        string,   // resolved model id used ('mock'/'quiet' for the no-LLM paths)
 *   window:       string,   // 'day' | 'week' | 'month'
 *   since:        string,   // ISO window start
 *   workspaceName:string,
 *   isQuiet:      boolean,  // honest slow-news-day marker
 *   frontPage:    { lede: string },
 *   index:        Array<ArticleStub>,   // { id, section, headline, dek, weight, sourceRefs[] }
 *   weather:      Object|null           // by-the-numbers snapshot (or null)
 * }
 */

import crypto from 'crypto';

const MAX_EDITIONS_PER_WORKSPACE = 20;
const MAX_LEDE_CHARS = 8000;
const MAX_HEADLINE_CHARS = 300;
const MAX_DEK_CHARS = 800;
const MAX_STUBS = 20;
const MAX_SNAPSHOT_CHARS = 20000; // JSON-stringified sourceRefs cap per stub

/** Sanitize one article stub into a stable stored shape. */
function normalizeStub(stub, i) {
  const src = stub && typeof stub === 'object' ? stub : {};
  let sourceRefs = Array.isArray(src.sourceRefs) ? src.sourceRefs : [];
  // Guard runaway snapshot size without dropping grounding: cap the count, and each
  // snapshot is already trimmed upstream (lib/ship-biscuit.js).
  sourceRefs = sourceRefs.slice(0, 12).map(ref => {
    const r = ref && typeof ref === 'object' ? ref : {};
    let snapshot = r.snapshot ?? null;
    try {
      if (snapshot && JSON.stringify(snapshot).length > MAX_SNAPSHOT_CHARS) {
        snapshot = { truncated: true };
      }
    } catch {
      snapshot = null;
    }
    return {
      id: String(r.id || ''),
      kind: String(r.kind || ''),
      headline: String(r.headline || '').slice(0, MAX_HEADLINE_CHARS),
      snapshot
    };
  });
  return {
    id: String(src.id || `art-${i + 1}`),
    section: String(src.section || 'The Wire').slice(0, 40),
    headline: String(src.headline || '').slice(0, MAX_HEADLINE_CHARS),
    dek: String(src.dek || '').slice(0, MAX_DEK_CHARS),
    weight: Number.isFinite(Number(src.weight)) ? Number(src.weight) : 3,
    sourceRefs
  };
}

/** Convert a stored document into the public EditionRecord shape. */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    generatedAt: doc.generatedAt?.toISOString?.() || doc.generatedAt,
    model: doc.model,
    window: doc.window,
    since: doc.since,
    workspaceName: doc.workspaceName,
    isQuiet: doc.isQuiet === true,
    frontPage: doc.frontPage || { lede: '' },
    index: Array.isArray(doc.index) ? doc.index : [],
    weather: doc.weather || null
  };
}

/**
 * Lightweight projection for list views: enough to render a history row without
 * shipping the full index/snapshots.
 */
function toSummary(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    generatedAt: doc.generatedAt?.toISOString?.() || doc.generatedAt,
    model: doc.model,
    window: doc.window,
    isQuiet: doc.isQuiet === true,
    articleCount: Array.isArray(doc.index) ? doc.index.length : 0
  };
}

function toMillis(date) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/**
 * MongoDB/MangoDB-backed edition-history store.
 */
export class ShipBiscuitHistoryStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxEditions=20] - Per-workspace cap on retained editions.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxEditions = options.maxEditions || MAX_EDITIONS_PER_WORKSPACE;
  }

  /**
   * Persist a generated edition. Assigns id/generatedAt, normalizes the body, and
   * prunes the workspace back down to the cap.
   *
   * @param {string} urlKey
   * @param {Object} data
   * @param {string} [data.model] - Resolved model id ('mock'/'quiet' allowed).
   * @param {string} [data.window]
   * @param {string} [data.since] - ISO window start.
   * @param {string} [data.workspaceName]
   * @param {boolean} [data.isQuiet]
   * @param {{lede: string}} [data.frontPage]
   * @param {Array} [data.index] - Article stubs.
   * @param {Object|null} [data.weather]
   * @returns {Promise<Object|null>}
   */
  async save(urlKey, { model, window, since, workspaceName, isQuiet, frontPage, index, weather } = {}) {
    if (!this.collection || !urlKey) return null;

    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      generatedAt: new Date(),
      model: String(model || ''),
      window: String(window || ''),
      since: String(since || ''),
      workspaceName: String(workspaceName || '').slice(0, 200),
      isQuiet: isQuiet === true,
      frontPage: { lede: String(frontPage?.lede || '').slice(0, MAX_LEDE_CHARS) },
      index: (Array.isArray(index) ? index : []).slice(0, MAX_STUBS).map(normalizeStub),
      weather: weather && typeof weather === 'object' ? weather : null
    };

    await this.collection.insertOne(doc);
    await this._pruneToCapacity(urlKey);
    return toRecord(doc);
  }

  /**
   * List edition summaries for a workspace, newest-first (no bodies).
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<{items: Array, total: number}>}
   */
  async list(urlKey, { limit } = {}) {
    if (!this.collection || !urlKey) return { items: [], total: 0 };
    try {
      const docs = await this._docsSorted(urlKey);
      const total = docs.length;
      const sliced = limit ? docs.slice(0, limit) : docs;
      return { items: sliced.map(toSummary), total };
    } catch (err) {
      console.error('Error listing edition history:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Fetch a single full edition by id.
   * @returns {Promise<Object|null>}
   */
  async get(urlKey, id) {
    if (!this.collection || !urlKey || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting edition:', err);
      return null;
    }
  }

  /**
   * Fetch the newest full edition for a workspace, or null if none exist.
   * @returns {Promise<Object|null>}
   */
  async getLatest(urlKey) {
    if (!this.collection || !urlKey) return null;
    try {
      const docs = await this._docsSorted(urlKey);
      return docs.length ? toRecord(docs[0]) : null;
    } catch (err) {
      console.error('Error getting latest edition:', err);
      return null;
    }
  }

  /** Remove all entries for a workspace (used in tests). @returns {Promise<number>} */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing edition history:', err);
      return 0;
    }
  }

  /** Docs for a workspace, sorted newest-first. */
  async _docsSorted(urlKey) {
    const docs = await this.collection.find({ urlKey }).toArray();
    docs.sort((a, b) => toMillis(b.generatedAt) - toMillis(a.generatedAt));
    return docs;
  }

  /** Delete anything beyond the newest `maxEditions` for a workspace. */
  async _pruneToCapacity(urlKey) {
    try {
      const docs = await this._docsSorted(urlKey);
      for (const doc of docs.slice(this.maxEditions)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning edition history:', err);
    }
  }
}
