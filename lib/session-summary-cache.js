/**
 * Session summary cache: keyed lookup for AI-generated autopilot session summaries
 * (LIN-592).
 *
 * Mirrors lib/run-summary-cache.js, but the cache unit is a *session* (an
 * orchestrator dispatch plus its worker dispatches — lib/pipeline-loops.js
 * getSessionsForWorkspace), not a single run. A summary is keyed on
 * `${workspaceId}:${sessionId}`.
 *
 * A session is only summarised once it is terminal (callers gate on this — see
 * routes/dashboard.js), at which point its constituent loops are immutable. The
 * `inputHash` over the ordered child Loop hashes + tasksTouched is stored as
 * defence-in-depth: if a session is somehow summarised before it settled, a later
 * hash mismatch is treated as a cache miss, so any child change re-rolls the
 * session summary.
 *
 * Retention is 30 days, matching the Loop lookback window (lib/pipeline-loops.js)
 * and the run-summary cache — once a session ages out of the loop reads, its
 * cached summary ages out too.
 *
 * Schema:
 * {
 *   _id:         string,  // `${workspaceId}:${sessionId}`
 *   workspaceId: string,  // workspace urlKey
 *   sessionId:   string,
 *   inputHash:   string,  // sha256 hex over ordered child loop hashes + tasksTouched
 *   summary:     { outcome, statusLine, highlights },
 *   model:       string,
 *   generatedAt: Date
 * }
 */

import crypto from 'crypto';
import { stableStringify, hashLoop } from './run-summary-cache.js';

/**
 * Hash the summary-relevant slice of a session: the ordered per-loop hashes
 * (each of which already folds in that loop's agentSummary/feedback, so the
 * orchestrator's narration is included) plus the distinct tasks touched. Any
 * change to any child run, or to the set of tasks, invalidates the rollup.
 *
 * @param {Object} session - A session record from getSessionsForWorkspace.
 * @returns {string} SHA-256 hex digest.
 */
export function hashSession(session) {
  const loops = (session && Array.isArray(session.loops)) ? session.loops : [];
  const slice = {
    sessionId: session?.sessionId || null,
    tasksTouched: Array.isArray(session?.tasksTouched) ? session.tasksTouched : [],
    loops: loops.map(hashLoop)
  };
  return crypto.createHash('sha256').update(stableStringify(slice)).digest('hex');
}

/**
 * MongoDB/MangoDB-backed session-summary cache store.
 */
export class SessionSummaryCacheStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.ttl=2592000] - Retention TTL in seconds (default 30 days).
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60;
  }

  static key(workspaceId, sessionId) {
    return `${workspaceId}:${sessionId}`;
  }

  async get(workspaceId, sessionId) {
    if (!this.collection) return null;
    const doc = await this.collection.findOne({ _id: SessionSummaryCacheStore.key(workspaceId, sessionId) });
    if (!doc) return null;
    if (doc.generatedAt && (Date.now() - new Date(doc.generatedAt).getTime()) / 1000 > this.ttl) {
      await this.delete(workspaceId, sessionId);
      return null;
    }
    return {
      workspaceId: doc.workspaceId,
      sessionId: doc.sessionId,
      inputHash: doc.inputHash,
      summary: doc.summary,
      model: doc.model,
      generatedAt: doc.generatedAt
    };
  }

  async put(workspaceId, sessionId, { inputHash, summary, model }) {
    if (!this.collection) return;
    const doc = {
      workspaceId,
      sessionId,
      inputHash,
      summary,
      model,
      generatedAt: new Date()
    };
    await this.collection.updateOne(
      { _id: SessionSummaryCacheStore.key(workspaceId, sessionId) },
      { $set: doc },
      { upsert: true }
    );
  }

  async delete(workspaceId, sessionId) {
    if (!this.collection) return;
    await this.collection.deleteOne({ _id: SessionSummaryCacheStore.key(workspaceId, sessionId) });
  }
}

/**
 * In-memory fallback for tests or dev without a Mongo/MangoDB collection.
 */
export class InMemorySessionSummaryCacheStore {
  constructor() {
    this._map = new Map();
  }

  async get(workspaceId, sessionId) {
    return this._map.get(SessionSummaryCacheStore.key(workspaceId, sessionId)) || null;
  }

  async put(workspaceId, sessionId, { inputHash, summary, model }) {
    this._map.set(SessionSummaryCacheStore.key(workspaceId, sessionId), {
      workspaceId,
      sessionId,
      inputHash,
      summary,
      model,
      generatedAt: new Date()
    });
  }

  async delete(workspaceId, sessionId) {
    this._map.delete(SessionSummaryCacheStore.key(workspaceId, sessionId));
  }
}
