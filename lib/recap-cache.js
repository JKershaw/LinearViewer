/**
 * Recap cache: hash-based lookup for AI-generated task recaps.
 *
 * Stores one document per (workspace, issue) pair. The `inputHash` is a
 * SHA-256 over the deterministically-stringified Linear context used to
 * generate the recap. Callers compare the stored hash to the current
 * context hash to decide whether a cached recap is still fresh.
 *
 * Schema:
 * {
 *   _id:         string,  // `${workspaceId}:${issueId}`
 *   workspaceId: string,
 *   issueId:     string,  // Linear issue UUID
 *   inputHash:   string,  // sha256 hex
 *   recap:       { done: [], pending: [], deviations: [] },
 *   model:       string,
 *   generatedAt: Date
 * }
 */

import crypto from 'crypto';

/**
 * Return a stable JSON string for an arbitrary value. Object keys are
 * sorted at every depth so two logically-equal inputs hash the same.
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

/**
 * Extract only the fields that affect the recap output, so unrelated changes
 * (e.g. Linear re-ordering siblings, minor metadata shifts) don't churn the
 * cache.
 */
function extractHashableContext(context) {
  if (!context || typeof context !== 'object') return {};
  const issue = context.issue || {};
  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state?.type,
      labels: Array.isArray(issue.labels) ? [...issue.labels].sort() : []
    },
    comments: (context.comments || []).map(c => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt
    })),
    children: (context.children || []).map(c => ({
      id: c.id,
      identifier: c.identifier,
      title: c.title,
      state: c.state?.type,
      labels: Array.isArray(c.labels) ? [...c.labels].sort() : []
    })),
    parent: context.parent ? {
      id: context.parent.id,
      identifier: context.parent.identifier,
      state: context.parent.state?.type
    } : null,
    focusedChild: context.focusedChild ? {
      issue: {
        id: context.focusedChild.issue?.id,
        description: context.focusedChild.issue?.description,
        state: context.focusedChild.issue?.state?.type
      },
      comments: (context.focusedChild.comments || []).map(c => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt
      }))
    } : null
  };
}

/**
 * Hash the recap-relevant slice of a Linear context.
 *
 * @param {Object} context - Output of fetchRecommendationContext().
 * @returns {string} SHA-256 hex digest.
 */
export function hashContext(context) {
  const slice = extractHashableContext(context);
  return crypto.createHash('sha256').update(stableStringify(slice)).digest('hex');
}

/**
 * MongoDB/MangoDB-backed recap cache store.
 */
export class RecapCacheStore {
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
    const doc = await this.collection.findOne({ _id: RecapCacheStore.key(workspaceId, issueId) });
    if (!doc) return null;
    if (doc.generatedAt && (Date.now() - new Date(doc.generatedAt).getTime()) / 1000 > this.ttl) {
      await this.delete(workspaceId, issueId);
      return null;
    }
    return {
      workspaceId: doc.workspaceId,
      issueId: doc.issueId,
      inputHash: doc.inputHash,
      recap: doc.recap,
      model: doc.model,
      generatedAt: doc.generatedAt
    };
  }

  async put(workspaceId, issueId, { inputHash, recap, model }) {
    if (!this.collection) return;
    const doc = {
      workspaceId,
      issueId,
      inputHash,
      recap,
      model,
      generatedAt: new Date()
    };
    await this.collection.updateOne(
      { _id: RecapCacheStore.key(workspaceId, issueId) },
      { $set: doc },
      { upsert: true }
    );
  }

  async delete(workspaceId, issueId) {
    if (!this.collection) return;
    await this.collection.deleteOne({ _id: RecapCacheStore.key(workspaceId, issueId) });
  }
}

/**
 * In-memory fallback for tests or dev without a Mongo/MangoDB collection.
 */
export class InMemoryRecapCacheStore {
  constructor() {
    this._map = new Map();
  }

  async get(workspaceId, issueId) {
    return this._map.get(RecapCacheStore.key(workspaceId, issueId)) || null;
  }

  async put(workspaceId, issueId, { inputHash, recap, model }) {
    this._map.set(RecapCacheStore.key(workspaceId, issueId), {
      workspaceId,
      issueId,
      inputHash,
      recap,
      model,
      generatedAt: new Date()
    });
  }

  async delete(workspaceId, issueId) {
    this._map.delete(RecapCacheStore.key(workspaceId, issueId));
  }
}
