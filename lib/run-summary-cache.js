/**
 * Run summary cache: keyed lookup for AI-generated autopilot run summaries (LIN-509).
 *
 * Mirrors lib/recap-cache.js, but the cache unit is a *run* (a Loop), not a Linear
 * issue. A completed run is immutable, so a summary keyed on `${workspaceId}:${loopId}`
 * never needs to change. An `inputHash` over the summarisable Loop fields is stored as
 * defence-in-depth: if a run was somehow summarised before it reached a terminal state
 * (callers gate on this), a later hash mismatch is treated as a cache miss.
 *
 * Retention is 30 days, matching the Loop lookback window (lib/pipeline-loops.js) —
 * once a run ages out of the loop reads, its cached summary ages out too.
 *
 * Schema:
 * {
 *   _id:         string,  // `${workspaceId}:${loopId}`
 *   workspaceId: string,  // workspace urlKey
 *   loopId:      string,
 *   inputHash:   string,  // sha256 hex over summarisable loop fields
 *   summary:     { outcome, whatHappened, blockers, next },
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
 * Extract only the fields that affect the run-summary output, so unrelated churn
 * (timestamps shifting representation, etc.) doesn't invalidate the cache.
 */
function extractHashableLoop(loop) {
  if (!loop || typeof loop !== 'object') return {};
  return {
    loopId: loop.loopId,
    issueIdentifier: loop.issueIdentifier,
    iteration: loop.iteration,
    promptName: loop.promptName,
    promptText: loop.promptText,
    stage: loop.stage,
    agentState: loop.agentState,
    foremanAction: loop.foremanAction,
    foremanStatus: loop.foremanStatus,
    foremanSummary: loop.foremanSummary,
    feedback: (Array.isArray(loop.feedback) ? loop.feedback : []).map(fb =>
      typeof fb === 'string' ? fb : (fb?.message || ''))
  };
}

/**
 * Hash the summary-relevant slice of a Loop record.
 *
 * @param {Object} loop - A Loop record.
 * @returns {string} SHA-256 hex digest.
 */
export function hashLoop(loop) {
  const slice = extractHashableLoop(loop);
  return crypto.createHash('sha256').update(stableStringify(slice)).digest('hex');
}

/**
 * MongoDB/MangoDB-backed run-summary cache store.
 */
export class RunSummaryCacheStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.ttl=2592000] - Retention TTL in seconds (default 30 days).
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60;
  }

  static key(workspaceId, loopId) {
    return `${workspaceId}:${loopId}`;
  }

  async get(workspaceId, loopId) {
    if (!this.collection) return null;
    const doc = await this.collection.findOne({ _id: RunSummaryCacheStore.key(workspaceId, loopId) });
    if (!doc) return null;
    if (doc.generatedAt && (Date.now() - new Date(doc.generatedAt).getTime()) / 1000 > this.ttl) {
      await this.delete(workspaceId, loopId);
      return null;
    }
    return {
      workspaceId: doc.workspaceId,
      loopId: doc.loopId,
      inputHash: doc.inputHash,
      summary: doc.summary,
      model: doc.model,
      generatedAt: doc.generatedAt
    };
  }

  async put(workspaceId, loopId, { inputHash, summary, model }) {
    if (!this.collection) return;
    const doc = {
      workspaceId,
      loopId,
      inputHash,
      summary,
      model,
      generatedAt: new Date()
    };
    await this.collection.updateOne(
      { _id: RunSummaryCacheStore.key(workspaceId, loopId) },
      { $set: doc },
      { upsert: true }
    );
  }

  async delete(workspaceId, loopId) {
    if (!this.collection) return;
    await this.collection.deleteOne({ _id: RunSummaryCacheStore.key(workspaceId, loopId) });
  }
}

/**
 * In-memory fallback for tests or dev without a Mongo/MangoDB collection.
 */
export class InMemoryRunSummaryCacheStore {
  constructor() {
    this._map = new Map();
  }

  async get(workspaceId, loopId) {
    return this._map.get(RunSummaryCacheStore.key(workspaceId, loopId)) || null;
  }

  async put(workspaceId, loopId, { inputHash, summary, model }) {
    this._map.set(RunSummaryCacheStore.key(workspaceId, loopId), {
      workspaceId,
      loopId,
      inputHash,
      summary,
      model,
      generatedAt: new Date()
    });
  }

  async delete(workspaceId, loopId) {
    this._map.delete(RunSummaryCacheStore.key(workspaceId, loopId));
  }
}
