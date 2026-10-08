/**
 * Durable, append-only log of task-mode events (LIN-2942): which way a person
 * took a task off the ladder on the opened task — copy the next prompt, run
 * this step, or run the whole task — recorded per account per task so the
 * milestone-5 funnel (LIN-2952) can read the entry rung.
 *
 * An event log rather than a field on the dispatch row: a copy, and a press on
 * a "○ set up ›" rung, have no run to write to, and those are the presses the
 * entry hypothesis turns on. The mode is linked to the run (`dispatchId`) when
 * the press creates one.
 *
 * Mirrors this repo's append-only-log pattern (lib/proxy-events.js,
 * lib/credential-lifecycle-events.js, lib/llm-call-log.js): class +
 * constructor({collection}), one document per event, writes never throw. No
 * TTL and no evictor — volume is human presses, and evidence stores are
 * lifetime-retained (LIN-3163). Holds no content: identifiers and app-defined
 * labels only.
 *
 * Two write sites, both through `record()`: the session dispatch route
 * (`act: 'dispatch'`, after `createDispatchItem` succeeds) and the client's
 * fire-and-forget POST for presses with no server call (copy, set-up presses,
 * the run-task press). The client never records a dispatch.
 *
 * NOT a gate: these are self-reported measurements. Run limits count dispatch
 * rows (`dispatchedBy`), never mode events.
 *
 * Schema:
 * {
 *   _id:             string,       // UUID
 *   accountId:       string,       // req.session.accountId as written (queries span the merge group)
 *   urlKey:          string,
 *   issueId:         string|null,
 *   issueIdentifier: string,
 *   rung:            'copy' | 'run-step' | 'run-task',
 *   ready:           boolean,      // false = pressed while "○ set up ›"
 *   needs:           null | 'prompt' | 'dispatch' | 'proxy',  // set iff !ready
 *   act:             'press' | 'copy' | 'dispatch',
 *   dispatchId:      string|null,  // set iff act === 'dispatch'
 *   surface:         'swipe' | 'home' | null,
 *   at:              Date,
 * }
 */

import crypto from 'crypto';

// The vocabulary. RUNGS is in ladder order (lowest first) — `furthest` reads
// it as such. RUNGS and NEEDS are pinned to the `data-rung` /
// `data-setup-needs` values `renderGo` and `renderLadder` in
// public/prompt-section.js emit.
export const RUNGS = Object.freeze(['copy', 'run-step', 'run-task']);
export const ACTS = Object.freeze(['press', 'copy', 'dispatch']);
export const NEEDS = Object.freeze(['prompt', 'dispatch', 'proxy']);
export const SURFACES = Object.freeze(['swipe', 'home']);

// Which acts each rung can carry (the design's rung mapping):
// - copy:     copying/downloading a non-autopilot result, or a set-up press.
// - run-step: dispatching a non-autopilot result, or a set-up press.
// - run-task: the autopilot press, then copying or dispatching that result.
export const RUNG_ACTS = Object.freeze({
  'copy': Object.freeze(['copy', 'press']),
  'run-step': Object.freeze(['dispatch', 'press']),
  'run-task': Object.freeze(['press', 'copy', 'dispatch']),
});

// Surfaces the shared PromptSection is mounted on today. P1 moved Home onto the
// component (LIN-2944), so both `swipe` and `home` are instrumented; the legacy
// Home renderer is gone. Disclosed on every query (instruments disclose their
// own coverage, LIN-2325).
export const INSTRUMENTED_SURFACES = Object.freeze(['swipe', 'home']);

// Bound on any client-supplied identifier stored verbatim, and the full C0 set
// (identifiers never carry tabs or newlines).
const MAX_ID_LENGTH = 200;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !CONTROL_CHARS_REGEX.test(value);
}

// The rungs whose act can create a run — the vocabulary the session dispatch
// route's `entryRung` is checked against.
export const DISPATCH_RUNGS = Object.freeze(RUNGS.filter(rung => RUNG_ACTS[rung].includes('dispatch')));

// The acts a client may record. The client never records a dispatch: the
// dispatch route records it after the item exists, so a press is never counted
// twice.
export const CLIENT_ACTS = Object.freeze(ACTS.filter(act => act !== 'dispatch'));

function isOptionalId(value) {
  return value == null || isId(value);
}

/**
 * Check a task-mode event against the vocabulary and its invariants.
 * Pure; shared by `record()` and the routes that accept an event body.
 *
 * @param {Object} event
 * @returns {string|null} why the event is invalid, or null when it is valid
 */
export function validateTaskModeEvent(event) {
  if (!event || typeof event !== 'object') return 'event must be an object';
  const { accountId, urlKey, issueId, issueIdentifier, rung, ready, needs, act, dispatchId, surface } = event;
  if (!isId(accountId)) return 'accountId is required';
  if (!isId(urlKey)) return 'urlKey is required';
  if (!isId(issueIdentifier)) return 'issueIdentifier is required';
  if (!isOptionalId(issueId)) return 'issueId must be a string';
  if (!RUNGS.includes(rung)) return `rung must be one of ${RUNGS.join(', ')}`;
  if (!ACTS.includes(act)) return `act must be one of ${ACTS.join(', ')}`;
  if (!RUNG_ACTS[rung].includes(act)) return `act "${act}" is not valid on rung "${rung}"`;
  if (typeof ready !== 'boolean') return 'ready must be a boolean';
  if (ready) {
    if (needs != null) return 'needs must be null when ready';
  } else {
    if (!NEEDS.includes(needs)) return `needs must be one of ${NEEDS.join(', ')} when not ready`;
    if (act !== 'press') return 'a not-ready rung can only be pressed';
  }
  if (act === 'dispatch') {
    if (!isId(dispatchId)) return 'dispatchId is required for a dispatch';
  } else if (dispatchId != null) {
    return 'dispatchId is only set for a dispatch';
  }
  if (surface != null && !SURFACES.includes(surface)) return `surface must be one of ${SURFACES.join(', ')}`;
  return null;
}

function toIso(value) {
  return value?.toISOString?.() || value;
}

function toMillis(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function emptyTaskMode() {
  return { entry: null, taken: null, furthest: null, events: [], coverage: { surfaces: [...INSTRUMENTED_SURFACES] } };
}

/**
 * Fold one task's events, already in time order, into the mode.
 *
 * - `entry`:    the first event — the rung the person entered on (the headline mode).
 * - `taken`:    the first copy/dispatch act, or null if nothing was taken yet.
 * - `furthest`: the highest rung pressed, in ladder order.
 *
 * @param {Array<Object>} docs - stored events, oldest first
 */
export function foldTaskMode(docs) {
  const mode = emptyTaskMode();
  let furthestIndex = -1;
  for (const doc of docs || []) {
    const event = {
      rung: doc.rung,
      ready: doc.ready,
      needs: doc.needs ?? null,
      act: doc.act,
      dispatchId: doc.dispatchId ?? null,
      surface: doc.surface ?? null,
      at: toIso(doc.at),
    };
    mode.events.push(event);
    if (!mode.entry) mode.entry = { rung: event.rung, ready: event.ready, at: event.at };
    if (!mode.taken && (event.act === 'copy' || event.act === 'dispatch')) {
      mode.taken = { rung: event.rung, at: event.at, dispatchId: event.dispatchId };
    }
    const index = RUNGS.indexOf(event.rung);
    if (index > furthestIndex) furthestIndex = index;
  }
  mode.furthest = furthestIndex >= 0 ? RUNGS[furthestIndex] : null;
  return mode;
}

function accountIdList(accountIds) {
  const list = Array.isArray(accountIds) ? accountIds : [accountIds];
  return [...new Set(list.filter(isId))];
}

export class TaskModeStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('task-mode-events')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Records a task-mode event. Never throws. An event outside the vocabulary
   * is not stored and returns null; a write failure is logged and the
   * (unpersisted) doc is still returned, like every other append-only store
   * here, so recording never breaks the press or dispatch that produced it.
   *
   * @param {Object} event - see the schema above (`at` is stamped here)
   * @returns {Promise<Object|null>} the recorded event, or null when rejected
   */
  async record(event) {
    const invalid = validateTaskModeEvent(event);
    if (invalid) {
      console.warn(`Ignoring invalid task-mode event: ${invalid}`);
      return null;
    }
    const doc = {
      _id: crypto.randomUUID(),
      accountId: event.accountId,
      urlKey: event.urlKey,
      issueId: event.issueId ?? null,
      issueIdentifier: event.issueIdentifier,
      rung: event.rung,
      ready: event.ready,
      needs: event.needs ?? null,
      act: event.act,
      dispatchId: event.dispatchId ?? null,
      surface: event.surface ?? null,
      at: new Date(),
    };
    if (!this.collection) return doc;
    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      console.error('Error recording task-mode event:', err);
    }
    return doc;
  }

  /**
   * The mode one account (across its merge group) took a task in.
   *
   * @param {Object} query
   * @param {string[]} query.accountIds - the canonical account and every account merged into it
   * @param {string} query.urlKey
   * @param {string} query.issueIdentifier
   * @returns {Promise<{entry, taken, furthest, events, coverage}>}
   */
  async getTaskMode({ accountIds, urlKey, issueIdentifier } = {}) {
    const ids = accountIdList(accountIds);
    if (!ids.length || !isId(urlKey) || !isId(issueIdentifier) || !this.collection) return emptyTaskMode();
    try {
      const docs = await this.collection
        .find({ accountId: { $in: ids }, urlKey, issueIdentifier })
        .sort({ at: 1, _id: 1 })
        .toArray();
      return foldTaskMode(docs);
    } catch (err) {
      console.error('Error reading task mode:', err);
      return emptyTaskMode();
    }
  }

  /**
   * Every event one account (across its merge group) recorded, oldest first —
   * LIN-2952's per-account join. The account's own data, so it carries the
   * task identifiers.
   *
   * @param {string[]} accountIds
   * @param {Object} [options]
   * @param {Date} [options.since] - lower bound on `at`; omitted → all history
   * @returns {Promise<Array<Object>>}
   */
  async listForAccount(accountIds, { since } = {}) {
    const ids = accountIdList(accountIds);
    if (!ids.length || !this.collection) return [];
    try {
      const query = { accountId: { $in: ids } };
      if (since) query.at = { $gte: since };
      const docs = await this.collection.find(query).sort({ at: 1, _id: 1 }).toArray();
      return docs.map(doc => ({
        accountId: doc.accountId,
        urlKey: doc.urlKey,
        issueId: doc.issueId ?? null,
        issueIdentifier: doc.issueIdentifier,
        rung: doc.rung,
        ready: doc.ready,
        needs: doc.needs ?? null,
        act: doc.act,
        dispatchId: doc.dispatchId ?? null,
        surface: doc.surface ?? null,
        at: toIso(doc.at),
      }));
    } catch (err) {
      console.error('Error listing task-mode events for account:', err);
      return [];
    }
  }

  /**
   * Instance-wide count of entry rungs: for each (account, workspace, task),
   * its first event, counted by rung. Counts and labels only — no urlKey,
   * account or issue identifier leaves this method (the lib/kpi-stats.js
   * boundary).
   *
   * `since` bounds the ENTRY, not the read: a task whose first event predates
   * `since` is not counted, rather than counted at a later, non-entry rung.
   * So every event is read; volume is human presses, so that is small.
   *
   * Grouping is by the account as recorded by default. `canonicalByAccountId`
   * (LIN-2952) folds a merged person's recorded ids onto one canonical id first,
   * so a person is counted once; it is a pre-resolved map (see
   * `lib/milestone-funnel.js` `buildCanonicalMap`) and defaults to identity, so
   * existing callers are unchanged. Per-id fallback on a corrupt chain is the
   * map-builder's job; a missing id here falls back to the recorded id.
   *
   * @param {Object} [options]
   * @param {Date} [options.since] - count only entries at or after this time
   * @param {Map<string, string>} [options.canonicalByAccountId] - recorded id -> canonical id; omitted → identity
   * @returns {Promise<{total: number, byRung: Array<{rung: string, entries: number, notReady: number}>, coverage: {surfaces: string[]}}>}
   */
  async countByEntryRung({ since, canonicalByAccountId } = {}) {
    const byRung = RUNGS.map(rung => ({ rung, entries: 0, notReady: 0 }));
    const result = { total: 0, byRung, coverage: { surfaces: [...INSTRUMENTED_SURFACES] } };
    if (!this.collection) return result;
    try {
      const docs = await this.collection
        .find({}, { projection: { accountId: 1, urlKey: 1, issueIdentifier: 1, rung: 1, ready: 1, at: 1 } })
        .sort({ at: 1, _id: 1 })
        .toArray();
      const sinceMs = since ? toMillis(since) : null;
      const canonicalize = (accountId) => canonicalByAccountId?.get(accountId) ?? accountId;
      const seen = new Set();
      for (const doc of docs) {
        const key = JSON.stringify([canonicalize(doc.accountId), doc.urlKey, doc.issueIdentifier]);
        if (seen.has(key)) continue;
        seen.add(key);
        const index = RUNGS.indexOf(doc.rung);
        if (index < 0) continue;
        if (sinceMs != null && !(toMillis(doc.at) >= sinceMs)) continue;
        byRung[index].entries += 1;
        if (doc.ready === false) byRung[index].notReady += 1;
        result.total += 1;
      }
      return result;
    } catch (err) {
      console.error('Error counting task-mode entry rungs:', err);
      return { total: 0, byRung: RUNGS.map(rung => ({ rung, entries: 0, notReady: 0 })), coverage: result.coverage };
    }
  }

  /**
   * Deletes a workspace's events. Test-only seam (the /test/clear-task-mode-events
   * route), like the sibling stores' clear(urlKey).
   *
   * @param {string} urlKey
   * @returns {Promise<number>} the number of events deleted
   */
  async clear(urlKey) {
    if (!isId(urlKey) || !this.collection) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing task-mode events:', err);
      return 0;
    }
  }
}
