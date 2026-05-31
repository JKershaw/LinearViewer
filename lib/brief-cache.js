/**
 * Brief cache: hash-based lookup for AI-generated task briefs.
 *
 * Mirrors lib/recap-cache.js — one document per (workspace, issue) pair, keyed
 * on a SHA-256 of the recap-relevant slice of the Linear context. The brief
 * depends on exactly the same inputs as the recap, so the freshness hash is
 * shared (re-exported from recap-cache) rather than reimplemented; only the
 * stored payload differs (a Markdown `brief` string instead of a recap object).
 *
 * Schema:
 * {
 *   _id:         string,  // `${workspaceId}:${issueId}`
 *   workspaceId: string,
 *   issueId:     string,  // Linear issue UUID
 *   inputHash:   string,  // sha256 hex
 *   brief:       string,  // Markdown
 *   model:       string,
 *   generatedAt: Date
 * }
 */

export { hashContext, stableStringify } from './recap-cache.js';

/**
 * MongoDB/MangoDB-backed brief cache store.
 */
export class BriefCacheStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.ttl=604800] - Retention TTL in seconds (default 7 days).
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 7 * 24 * 60 * 60;
  }

  static key(workspaceId, issueId) {
    return `${workspaceId}:${issueId}`;
  }

  async get(workspaceId, issueId) {
    if (!this.collection) return null;
    const doc = await this.collection.findOne({ _id: BriefCacheStore.key(workspaceId, issueId) });
    if (!doc) return null;
    if (doc.generatedAt && (Date.now() - new Date(doc.generatedAt).getTime()) / 1000 > this.ttl) {
      await this.delete(workspaceId, issueId);
      return null;
    }
    return {
      workspaceId: doc.workspaceId,
      issueId: doc.issueId,
      inputHash: doc.inputHash,
      brief: doc.brief,
      model: doc.model,
      generatedAt: doc.generatedAt
    };
  }

  async put(workspaceId, issueId, { inputHash, brief, model }) {
    if (!this.collection) return;
    const doc = {
      workspaceId,
      issueId,
      inputHash,
      brief,
      model,
      generatedAt: new Date()
    };
    await this.collection.updateOne(
      { _id: BriefCacheStore.key(workspaceId, issueId) },
      { $set: doc },
      { upsert: true }
    );
  }

  async delete(workspaceId, issueId) {
    if (!this.collection) return;
    await this.collection.deleteOne({ _id: BriefCacheStore.key(workspaceId, issueId) });
  }
}

/**
 * In-memory fallback for tests or dev without a Mongo/MangoDB collection.
 */
export class InMemoryBriefCacheStore {
  constructor() {
    this._map = new Map();
  }

  async get(workspaceId, issueId) {
    return this._map.get(BriefCacheStore.key(workspaceId, issueId)) || null;
  }

  async put(workspaceId, issueId, { inputHash, brief, model }) {
    this._map.set(BriefCacheStore.key(workspaceId, issueId), {
      workspaceId,
      issueId,
      inputHash,
      brief,
      model,
      generatedAt: new Date()
    });
  }

  async delete(workspaceId, issueId) {
    this._map.delete(BriefCacheStore.key(workspaceId, issueId));
  }
}
