/**
 * Durable, append-only log of account merges (LIN-2233, L2.2 of the LIN-2231
 * design). A merge is rare and high-consequence — `canonicalId` permanently
 * absorbs `mergedId` — so its record must outlive Railway's rolling ~7-day
 * log window (the LIN-2231 incident's own evidence-destruction lesson), not
 * ride along as a `console.log`. Mirrors the append-only shape of
 * lib/proxy-events.js / lib/agent-status-store.js: class + constructor({collection}),
 * one document per event, write failures caught and logged (fire-and-forget),
 * never thrown into the merge that rode in on it.
 *
 * Deliberately narrow: this is the one event AccountStore.mergeAccounts needs
 * durably recorded, not the design's full `credential-lifecycle-events`
 * vocabulary (`refresh_skip`/`refresh_fail`/…, L5.1) — that store, and whether
 * this collection folds into it, is Ticket D's (LIN-2236) call.
 *
 * Schema:
 * {
 *   _id: string,            // UUID
 *   canonicalId: string,    // the account that absorbed mergedId
 *   mergedId: string,       // the account that was merged in (aliased via mergedInto)
 *   workspaceIds: string[], // workspace edges re-bound onto canonicalId by this merge
 *   at: Date
 * }
 */

import crypto from 'crypto';

export class AccountMergeLogStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('account-merge-events')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Records a merge event.
   * @param {Object} event
   * @param {string} event.canonicalId
   * @param {string} event.mergedId
   * @param {string[]} [event.workspaceIds]
   * @returns {Promise<Object>} the recorded event
   */
  async recordMerge({ canonicalId, mergedId, workspaceIds = [] }) {
    const doc = {
      _id: crypto.randomUUID(),
      canonicalId,
      mergedId,
      workspaceIds,
      at: new Date()
    };
    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      console.error('Error recording account merge event:', err);
    }
    return doc;
  }
}
