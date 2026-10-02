/**
 * Durable, append-only log of close-out events (LIN-3248, P3 of LIN-2949; S16).
 *
 * One document per close-out fact: when the person merges the PR on GitHub
 * themselves (`by: 'person'`, noticed on the page's `check` read) or when they
 * press `[ close out & merge ]` (`by: 'press'`, carrying the `dispatchId` the
 * existing dispatch path returned). The record also stores the open-ledger-item
 * counts at merge, so the audit trail says what "Done" meant.
 *
 * Mirrors this repo's append-only-log pattern (lib/task-mode-store.js,
 * lib/proxy-events.js): class + constructor({ collection }), one document per
 * event, writes never throw. No TTL and no evictor — evidence stores are
 * lifetime-retained (LIN-3163). Holds identifiers and counts only, never
 * ledger content.
 *
 * Recording is IDEMPOTENT on `urlKey + prUrl + headSha + by`: a re-read (page
 * load,
 * tab focus) that sees the same merge again returns the first document rather
 * than writing a second one. "Never throws" means a failed provider write is
 * retried on the next check and never blocks the record.
 *
 * Schema:
 * {
 *   _id:             string,       // UUID
 *   urlKey:          string,
 *   accountId:       string|null,  // the signed-in person's account, when known
 *   issueId:         string|null,
 *   issueIdentifier: string,
 *   by:              'person' | 'press',
 *   dispatchId:      string|null,  // set iff by === 'press'
 *   prUrl:           string,
 *   headSha:         string|null,  // the head the merge was seen at
 *   merged:          boolean,
 *   openItems:       { inside: number, outside: number, unknown: number, total: number },
 *   at:              Date,
 * }
 */

import crypto from 'crypto';

/** How a close-out was sent. */
export const CLOSE_OUT_BY = Object.freeze(['person', 'press']);

// Bound on any caller-supplied identifier stored verbatim, and the full C0 set
// (identifiers never carry tabs or newlines).
const MAX_ID_LENGTH = 200;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !CONTROL_CHARS_REGEX.test(value);
}

function isOptionalId(value) {
  return value == null || isId(value);
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isOpenItems(value) {
  if (!value || typeof value !== 'object') return false;
  return ['inside', 'outside', 'unknown', 'total'].every(key => isCount(value[key] === undefined ? 0 : value[key]));
}

/**
 * Check a close-out event against the vocabulary and its invariants.
 * Pure; shared by `record()` and any route that accepts an event body.
 *
 * @param {Object} event
 * @returns {string|null} why the event is invalid, or null when it is valid
 */
export function validateCloseOutEvent(event) {
  if (!event || typeof event !== 'object') return 'event must be an object';
  const { urlKey, accountId, issueId, issueIdentifier, by, dispatchId, prUrl, headSha, merged, openItems } = event;
  if (!isId(urlKey)) return 'urlKey is required';
  if (!isOptionalId(accountId)) return 'accountId must be a string';
  if (!isOptionalId(issueId)) return 'issueId must be a string';
  if (!isId(issueIdentifier)) return 'issueIdentifier is required';
  if (!CLOSE_OUT_BY.includes(by)) return `by must be one of ${CLOSE_OUT_BY.join(', ')}`;
  if (by === 'press') {
    if (!isId(dispatchId)) return 'dispatchId is required for a press';
  } else if (dispatchId != null) {
    return 'dispatchId is only set for a press';
  }
  if (!isId(prUrl)) return 'prUrl is required';
  if (!isOptionalId(headSha)) return 'headSha must be a string';
  if (typeof merged !== 'boolean') return 'merged must be a boolean';
  if (!isOpenItems(openItems)) return 'openItems must be non-negative integer counts';
  return null;
}

function normalizeOpenItems(openItems) {
  const read = key => (openItems && isCount(openItems[key]) ? openItems[key] : 0);
  return {
    inside: read('inside'),
    outside: read('outside'),
    unknown: read('unknown'),
    total: read('total'),
  };
}

function toIso(value) {
  return value?.toISOString?.() || value;
}

function shape(doc) {
  return {
    _id: doc._id,
    urlKey: doc.urlKey,
    accountId: doc.accountId ?? null,
    issueId: doc.issueId ?? null,
    issueIdentifier: doc.issueIdentifier,
    by: doc.by,
    dispatchId: doc.dispatchId ?? null,
    prUrl: doc.prUrl,
    headSha: doc.headSha ?? null,
    merged: doc.merged === true,
    openItems: normalizeOpenItems(doc.openItems),
    at: toIso(doc.at),
  };
}

export class CloseOutEventsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('close-out-events')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Records a close-out event. Never throws. An event outside the vocabulary is
   * not stored and returns null; an event already recorded for the same
   * `urlKey + prUrl + headSha + by` returns the existing document instead of a
   * second one; a write failure is logged and the (unpersisted) doc is still
   * returned, so recording never breaks the check or press that produced it.
   *
   * `by` is part of the key (LIN-3248 review B2): a press and the person's
   * later merge on the same head are DIFFERENT facts. Without it, the press
   * record shadows the merge, so R1 would set Done with no merge record and no
   * open-item counts.
   *
   * @param {Object} event - see the schema above (`at` is stamped here)
   * @returns {Promise<Object|null>} the recorded event, or null when rejected
   */
  async record(event) {
    const invalid = validateCloseOutEvent(event);
    if (invalid) {
      console.warn(`Ignoring invalid close-out event: ${invalid}`);
      return null;
    }
    const doc = {
      _id: crypto.randomUUID(),
      urlKey: event.urlKey,
      accountId: event.accountId ?? null,
      issueId: event.issueId ?? null,
      issueIdentifier: event.issueIdentifier,
      by: event.by,
      dispatchId: event.dispatchId ?? null,
      prUrl: event.prUrl,
      headSha: event.headSha ?? null,
      merged: event.merged === true,
      openItems: normalizeOpenItems(event.openItems),
      at: new Date(),
    };
    if (!this.collection) return doc;
    try {
      const existing = await this.getByPr({ urlKey: doc.urlKey, prUrl: doc.prUrl, headSha: doc.headSha, by: doc.by });
      if (existing) return existing;
      await this.collection.insertOne(doc);
    } catch (err) {
      // A duplicate-key race on the unique index is the same idempotency case:
      // return whatever landed first rather than a second row.
      try {
        const existing = await this.getByPr({ urlKey: doc.urlKey, prUrl: doc.prUrl, headSha: doc.headSha, by: doc.by });
        if (existing) return existing;
      } catch {
        // fall through to the unpersisted doc
      }
      console.error('Error recording close-out event:', err);
    }
    return doc;
  }

  /**
   * The event recorded for one merge (the idempotency key), or null. Never throws.
   * @param {Object} args
   * @param {string} args.urlKey
   * @param {string} args.prUrl
   * @param {string|null} args.headSha
   * @param {('person'|'press')} args.by - part of the key (B2)
   * @returns {Promise<Object|null>}
   */
  async getByPr({ urlKey, prUrl, headSha, by } = {}) {
    if (!this.collection) return null;
    if (!isId(urlKey) || !isId(prUrl) || !isOptionalId(headSha) || !CLOSE_OUT_BY.includes(by)) return null;
    try {
      const doc = await this.collection.findOne({ urlKey, prUrl, headSha: headSha ?? null, by });
      return doc ? shape(doc) : null;
    } catch (err) {
      console.error('Error reading close-out event:', err);
      return null;
    }
  }

  /**
   * Every close-out event for one task, oldest first. Never throws.
   * @returns {Promise<Array<Object>>}
   */
  async listForIssue({ urlKey, issueIdentifier } = {}) {
    if (!this.collection || !isId(urlKey) || !isId(issueIdentifier)) return [];
    try {
      const docs = await this.collection
        .find({ urlKey, issueIdentifier })
        .sort({ at: 1, _id: 1 })
        .toArray();
      return (docs || []).map(shape);
    } catch (err) {
      console.error('Error listing close-out events:', err);
      return [];
    }
  }

  /**
   * Deletes a workspace's events. Test-only seam, like the sibling stores'
   * clear(urlKey).
   * @param {string} urlKey
   * @returns {Promise<number>} the number of events deleted
   */
  async clear(urlKey) {
    if (!isId(urlKey) || !this.collection) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing close-out events:', err);
      return 0;
    }
  }
}
