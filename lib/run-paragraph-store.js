/**
 * Run paragraph store (LIN-3253, LIN-2948 S3): the durable home for the one
 * AI-generated, plain-language paragraph that says how a run went, keyed
 * `${urlKey}:${runId}`.
 *
 * Modelled on lib/session-summary-cache.js but with **no TTL**. Dispatch
 * evidence is lifetime-retained (LIN-3163), so the paragraph must outlive the
 * 7- and 30-day caches the sibling stores carry; there is deliberately no
 * expiry index and no eviction path. The pair `${urlKey}:${runId}` is enforced
 * unique by a declared `{ urlKey: 1, runId: 1 }` unique index (lib/db-indexes.js)
 * — the automatic `_id_` index alone does not enforce uniqueness on the dev
 * MangoDB engine, so the constraint is made explicit and testable.
 *
 * Schema:
 * {
 *   urlKey:      string,  // workspace urlKey
 *   runId:       string,  // the session id
 *   inputHash:   string,  // hash of the buildRunView input — the cache gate
 *   paragraph:   string,
 *   model:       string,  // realised model; the tier is resolved at render time
 *   generatedAt: Date,
 *   final:       boolean  // true once the run is terminal (close-out)
 * }
 */

/**
 * MongoDB/MangoDB-backed durable run-paragraph store.
 */
export class RunParagraphStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  static key(urlKey, runId) {
    return `${urlKey}:${runId}`;
  }

  async get(urlKey, runId) {
    if (!this.collection) return null;
    const doc = await this.collection.findOne({ urlKey, runId });
    if (!doc) return null;
    return {
      urlKey: doc.urlKey,
      runId: doc.runId,
      inputHash: doc.inputHash,
      paragraph: doc.paragraph,
      model: doc.model,
      generatedAt: doc.generatedAt,
      final: doc.final
    };
  }

  async put(urlKey, runId, { inputHash, paragraph, model, final = false }) {
    if (!this.collection) return;
    const doc = {
      urlKey,
      runId,
      inputHash,
      paragraph,
      model,
      generatedAt: new Date(),
      final
    };
    await this.collection.updateOne(
      { urlKey, runId },
      { $set: doc },
      { upsert: true }
    );
  }
}

/**
 * In-memory fallback for tests or dev without a Mongo/MangoDB collection.
 */
export class InMemoryRunParagraphStore {
  constructor() {
    this._map = new Map();
  }

  async get(urlKey, runId) {
    return this._map.get(RunParagraphStore.key(urlKey, runId)) || null;
  }

  async put(urlKey, runId, { inputHash, paragraph, model, final = false }) {
    this._map.set(RunParagraphStore.key(urlKey, runId), {
      urlKey,
      runId,
      inputHash,
      paragraph,
      model,
      generatedAt: new Date(),
      final
    });
  }
}
