/**
 * Run-proposals store: durable, NO-TTL proposals a run-scoped chat turn made
 * about one run (LIN-3254 S4).
 *
 * A run-scoped chat turn must propose, never act: this store is where the
 * proposal lands so the run page can show it under its step with Apply /
 * Decline. There is no TTL — a proposal is a durable user artifact and must
 * not silently expire — so, like `lib/saved-chat-store.js`, this borrows the
 * CRUD lifecycle of `lib/custom-prompts-store.js` and the no-TTL collection
 * shape of `lib/task-snapshot-store.js`.
 *
 * Identity: every read and write is scoped by `{ urlKey, runId }`, so a
 * proposal can never be returned across workspaces or across runs. `runId` is
 * the proposal's own sessionId; `stepLoopId` is the lineage the follow-up will
 * land on (resolved by the caller from
 * `deriveFollowUpDispatch(session).followUpTo` at proposal time) — the store
 * only records it.
 *
 * Schema (one document per proposal):
 * {
 *   _id:           string,   // UUID
 *   urlKey:        string,   // workspace URL key (indexed)
 *   runId:         string,   // the run's sessionId (indexed)
 *   stepLoopId:    string|null, // the lineage tail the follow-up will land on
 *   prompt:        string,   // the proposed follow-up text (capped, secret-scanned)
 *   status:        'proposed'|'applied'|'declined',
 *   proposedAt:    string,   // ISO timestamp
 *   decidedAt:     string|null, // ISO timestamp, set when applied/declined
 *   appliedItemId: string|null  // the dispatched item id, set when applied
 * }
 */

import crypto from 'crypto';
import { CHAT_MESSAGE_MAX_LENGTH } from './chat-request.js';
import { scanText } from './secret-scan.js';

/** The chat-surface prompt cap, reused rather than invented (LIN-2970). */
const MAX_PROPOSAL_PROMPT_CHARS = CHAT_MESSAGE_MAX_LENGTH;

function clampText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Full public record. */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    urlKey: doc.urlKey,
    runId: doc.runId,
    stepLoopId: doc.stepLoopId ?? null,
    prompt: doc.prompt,
    status: doc.status,
    proposedAt: doc.proposedAt,
    decidedAt: doc.decidedAt ?? null,
    appliedItemId: doc.appliedItemId ?? null,
  };
}

function toMillis(value) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * MongoDB/MangoDB-backed durable run-proposal store, scoped by {urlKey, runId}.
 */
export class RunProposalsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Create a proposal. The prompt is capped and secret-scanned on write; a
   * prompt that scans as containing a secret is REJECTED (thrown), never
   * silently stored, matching the repo's existing secret-scan posture (a hit
   * fails, it is not redacted into the record).
   *
   * @param {Object} data - { urlKey, runId, stepLoopId, prompt }
   * @returns {Promise<Object>} the created record
   * @throws {Error} on validation or secret-scan failure
   */
  async create({ urlKey, runId, stepLoopId = null, prompt } = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!runId) throw new Error('runId is required');

    const cleanPrompt = clampText(prompt, MAX_PROPOSAL_PROMPT_CHARS).trim();
    if (!cleanPrompt) throw new Error('A proposal needs a non-empty prompt');

    const findings = scanText(cleanPrompt, { filePath: 'run-proposal' });
    if (findings.length > 0) {
      throw new Error(`Proposal prompt looks like a secret (${findings[0].ruleId}); refusing to store it`);
    }

    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      runId,
      stepLoopId: stepLoopId || null,
      prompt: cleanPrompt,
      status: 'proposed',
      proposedAt: new Date().toISOString(),
      decidedAt: null,
      appliedItemId: null,
    };

    await this.collection.insertOne(doc);
    return toRecord(doc);
  }

  /**
   * List a run's proposals, newest-first. Scoped by {urlKey, runId}.
   *
   * @returns {Promise<Array>} records newest-first
   */
  async list(urlKey, runId) {
    if (!urlKey || !runId) return [];
    try {
      const docs = await this.collection.find({ urlKey, runId }).toArray();
      docs.sort((a, b) => toMillis(b.proposedAt) - toMillis(a.proposedAt));
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing run proposals:', err);
      return [];
    }
  }

  /**
   * One proposal scoped by {urlKey, runId, _id}, or null.
   */
  async get(urlKey, runId, id) {
    if (!urlKey || !runId || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey, runId });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting run proposal:', err);
      return null;
    }
  }

  /**
   * Compare-and-set `proposed → applied`, recording `decidedAt` and
   * `appliedItemId`. Atomic on `status: 'proposed'` in the filter, so a second
   * Apply matches nothing and returns null — the caller dispatches only once.
   *
   * @returns {Promise<Object|null>} the updated record, or null if not proposed
   */
  async apply(urlKey, runId, id, appliedItemId) {
    return this._decide(urlKey, runId, id, 'applied', { appliedItemId: appliedItemId ?? null });
  }

  /**
   * Compare-and-set `proposed → declined`, recording `decidedAt`. Dispatches
   * nothing; returns null when the row is no longer `proposed` (e.g. after an
   * Apply).
   *
   * @returns {Promise<Object|null>} the updated record, or null if not proposed
   */
  async decline(urlKey, runId, id) {
    return this._decide(urlKey, runId, id, 'declined', { appliedItemId: null });
  }

  /** Remove all proposals for a workspace (used in tests). @returns {Promise<number>} */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing run proposals:', err);
      return 0;
    }
  }

  /**
   * Shared atomic decision write. The `status: 'proposed'` guard is the CAS:
   * the update matches at most one row, and only while it is still proposed.
   */
  async _decide(urlKey, runId, id, status, extra) {
    if (!urlKey || !runId || !id) return null;
    try {
      const result = await this.collection.updateOne(
        { _id: id, urlKey, runId, status: 'proposed' },
        { $set: { status, decidedAt: new Date().toISOString(), ...extra } }
      );
      const changed = (result.modifiedCount ?? result.matchedCount ?? 0) > 0;
      if (!changed) return null;
      return this.get(urlKey, runId, id);
    } catch (err) {
      console.error('Error deciding run proposal:', err);
      return null;
    }
  }
}
