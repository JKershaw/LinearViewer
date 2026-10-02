/**
 * Durable, append-only log of funnel events (LIN-2952): a milestone step a
 * person witnessed on their account, per account. Today the only step is the
 * merge click — the close-out LIN-2949 owns and will call once it exists —
 * which is why this store exists as its own generic seam rather than a field
 * on a dispatch row (the click has no run to write to, and this ticket owns
 * the write so the funnel never routes around LIN-2949).
 *
 * Mirrors this repo's append-only-log pattern (lib/task-mode-store.js,
 * lib/proxy-events.js, lib/credential-lifecycle-events.js): class +
 * constructor({collection}), one document per event, writes never throw. No TTL
 * and no evictor — volume is human presses, and evidence stores are
 * lifetime-retained (LIN-3163). Holds no content: identifiers and app-defined
 * labels only.
 *
 * Three-state reads are the caller's: a step with no instrument reads as
 * "no signal available", never "not reached". `INSTRUMENTED_STEPS` is the code
 * constant that decides which steps the funnel may honestly report as
 * reached / not-reached; while it is empty, merge-click reads as no-signal.
 * LIN-2949's close-out adds 'merge-clicked' to it in the PR that wires the
 * call. A constant, not a runtime flag.
 *
 * Schema:
 * {
 *   _id:             string,        // UUID
 *   accountId:       string,        // session account as written (queries span the merge group)
 *   urlKey:          string,
 *   issueId:         string|null,
 *   issueIdentifier: string|null,
 *   step:            'merge-clicked',
 *   at:              Date,
 * }
 */

import { randomUUID } from 'crypto';

// The vocabulary. Frozen and generic: LIN-2949 adds its step in the PR that
// calls record(); nothing else may invent a step here.
export const FUNNEL_STEPS = Object.freeze(['merge-clicked']);

// The steps whose write site exists. Empty until LIN-2949's close-out calls
// record('merge-clicked'). Same idiom as INSTRUMENTED_SURFACES in
// lib/task-mode-store.js: the instrument discloses its own coverage, and a step
// outside this set reads as "no signal available", never "not reached"
// (LIN-2325).
export const INSTRUMENTED_STEPS = Object.freeze([]);

// Bound on any client-supplied identifier stored verbatim, and the full C0 set
// (identifiers never carry tabs or newlines).
const MAX_ID_LENGTH = 200;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !CONTROL_CHARS_REGEX.test(value);
}

function isOptionalId(value) {
  return value == null || isId(value);
}

/**
 * Check a funnel event against the vocabulary. Pure; shared by `record()` and
 * any route that will accept an event body (LIN-2949's call site).
 *
 * @param {Object} event
 * @returns {string|null} why the event is invalid, or null when it is valid
 */
export function validateFunnelEvent(event) {
  if (!event || typeof event !== 'object') return 'event must be an object';
  const { accountId, urlKey, issueId, issueIdentifier, step } = event;
  if (!isId(accountId)) return 'accountId is required';
  if (!isId(urlKey)) return 'urlKey is required';
  if (!isOptionalId(issueId)) return 'issueId must be a string';
  if (!isOptionalId(issueIdentifier)) return 'issueIdentifier must be a string';
  if (!FUNNEL_STEPS.includes(step)) return `step must be one of ${FUNNEL_STEPS.join(', ')}`;
  return null;
}

function toIso(value) {
  return value?.toISOString?.() || value;
}

function accountIdList(accountIds) {
  const list = Array.isArray(accountIds) ? accountIds : [accountIds];
  return [...new Set(list.filter(isId))];
}

export class FunnelEventStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('funnel-events')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Records a funnel event. Never throws. An event outside the vocabulary is
   * not stored and returns null; a write failure is logged and the
   * (unpersisted) doc is still returned, like every other append-only store
   * here, so recording never breaks the press that produced it.
   *
   * @param {Object} event - see the schema above (`at` is stamped here)
   * @returns {Promise<Object|null>} the recorded event, or null when rejected
   */
  async record(event) {
    const invalid = validateFunnelEvent(event);
    if (invalid) {
      console.warn(`Ignoring invalid funnel event: ${invalid}`);
      return null;
    }
    const doc = {
      _id: randomUUID(),
      accountId: event.accountId,
      urlKey: event.urlKey,
      issueId: event.issueId ?? null,
      issueIdentifier: event.issueIdentifier ?? null,
      step: event.step,
      at: new Date(),
    };
    if (!this.collection) return doc;
    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      console.error('Error recording funnel event:', err);
    }
    return doc;
  }

  /**
   * The first event per account for one step, oldest first — the read the
   * funnel's step readers consume. Pass `accountIds` to scope to a merge group
   * (the per-account route's whole-group lookup); omit it to read the instance
   * (the cross-account aggregate, which canonicalizes the returned accountIds
   * afterwards). `since` bounds presence in the window, not the "first ever":
   * it filters events before the earliest is taken, so an account whose only
   * in-window event is later still reports that later time.
   *
   * Counts/ids only: accountId, step and the event time — no workspace content.
   *
   * @param {Object} [options]
   * @param {string[]} [options.accountIds] - account group; omitted → all accounts
   * @param {string} options.step - one of FUNNEL_STEPS
   * @param {Date} [options.since] - lower bound on `at`
   * @returns {Promise<Array<{accountId: string, step: string, at: string}>>}
   */
  async firstPerAccount({ accountIds, step, since } = {}) {
    if (!FUNNEL_STEPS.includes(step) || !this.collection) return [];
    const ids = accountIds === undefined ? null : accountIdList(accountIds);
    if (ids && !ids.length) return [];
    const query = { step };
    if (ids) query.accountId = { $in: ids };
    if (since) query.at = { $gte: since };
    try {
      const docs = await this.collection
        .find(query, { projection: { accountId: 1, step: 1, at: 1 } })
        .sort({ at: 1, _id: 1 })
        .toArray();
      const first = new Map();
      for (const doc of docs) {
        if (first.has(doc.accountId)) continue;
        first.set(doc.accountId, { accountId: doc.accountId, step: doc.step, at: toIso(doc.at) });
      }
      return [...first.values()];
    } catch (err) {
      console.error('Error reading funnel events:', err);
      return [];
    }
  }
}
