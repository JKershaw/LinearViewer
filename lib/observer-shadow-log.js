/**
 * lib/observer-shadow-log.js
 *
 * Read-only shadow action log (LIN-2132, P1-5 of the LIN-2114 observer-harness
 * epic). Computes what P1-3's sweep (`lib/observer-sweep.js`) WOULD have
 * relayed for each attention row of one tick's diagnosis, in the SAME marker
 * + Linear-comment vocabulary the incumbent already speaks (dispatch
 * `feedback[]`, matched by `WAKE_FEEDBACK_REGEX`/`isWakeEvent`
 * (`lib/dispatch-terminal.js`) and parsed by `lib/session-telemetry.js`; a
 * Linear comment, `{body}`, via `lib/providers/linear/index.js`'s
 * `createComment`) — so LIN-2133's later comparison and LIN-2139's later
 * write can consume this store's entries without translation — and persists
 * that computation to its OWN store.
 *
 * P1 invariant (see `lib/observer-sweep.js`'s own header and the LIN-2132/
 * LIN-2139 scope-cut ruling this module exists to honor): ZERO writes into
 * the live dispatch pipeline. Nothing in this module calls
 * `AgentStatusStore#recordStatus`, `DispatchQueueStore#addFeedback`, or
 * `createComment` (`lib/providers/linear/index.js`) — it imports none of
 * those modules (pinned by this module's own static-import test) and every
 * write here targets only this file's own store.
 *
 * ## Vocabulary mapping — why only `blocked` produces a would-be action
 *
 * `buildSweepPayload`'s own `attention` array is exhaustively `silent` or
 * `blocked` (see its header: "Only `silent` and `blocked`... are surfaced").
 * Of those two, only `blocked` is mapped here:
 *
 *  - lane `blocked` -> marker `blocked`. This is the one concrete example
 *    both LIN-2132's own ticket body and LIN-2139's inherited open question
 *    #5 name: "an observer writing `[blocked]`..." is the real write
 *    LIN-2139 will eventually make. `[blocked]` carries no payload beyond
 *    the leading marker (`WAKE_FEEDBACK_REGEX` matches on the prefix alone),
 *    so a synthesized message is recognized by the SAME parser real feedback
 *    uses — genuinely comparable, not merely similarly-shaped.
 *  - lane `silent` -> deliberately NOT mapped. The vocabulary's other two
 *    markers both carry structured data this diagnosis payload does not
 *    have: `[working]` is a tool-call heartbeat
 *    (`lib/session-telemetry.js`'s `parseHeartbeat` requires a tool count —
 *    `HEARTBEAT_HINT`/`TOOL_COUNT_RE` — which only the SUBJECT session's own
 *    runner can honestly report about itself) and `[evidence]` relays an
 *    artifact URL (`EVIDENCE_PREFIX`/`EVIDENCE_LABEL_RE`), which P1-3's
 *    attention rows do not carry (`{loopId, issue, lane, stage, since}`
 *    only — see `buildSweepPayload`). Fabricating either would produce a
 *    string the real parsers do NOT recognize as the thing it claims to be
 *    (a heartbeat with no tool count is not a heartbeat), which is the
 *    opposite of this ticket's "matches the existing marker/comment
 *    vocabulary field-for-field" requirement, not a way to satisfy it. A
 *    later ticket that threads artifact-URL or tool-telemetry signal into
 *    the diagnosis payload can extend `computeWouldBeAction` to cover it.
 */

import crypto from 'crypto';

// Per-workspace count cap on retained shadow-log entries — same shape as
// lib/task-snapshot-store.js's per-task MAX_SNAPSHOTS_PER_TASK cap.
export const MAX_ENTRIES_PER_WORKSPACE = 200;

// cleanup() eviction window, matching P1-2's RETENTION_IDLE_MS
// (lib/observer-state-store.js) — same house-rule posture: no TTL index
// (lib/db-indexes.js:11-15), `.cleanup()` stays the sole evictor.
export const RETENTION_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const MAX_FIELD_CHARS = 500;

function clampField(value) {
  return value == null ? '' : String(value).slice(0, MAX_FIELD_CHARS);
}

/**
 * Pure: derive the would-be relay action for one attention row of a P1-3
 * diagnosis tick, or `null` when this module has no vocabulary mapping for
 * the row's lane (currently only `blocked` — see the module header).
 * Exhaustive over its own mapping rather than assuming its caller's
 * contract, so a future lane added to `buildSweepPayload`'s attention array
 * degrades to "no action" here instead of throwing.
 *
 * @param {Object} row - one `buildSweepPayload().attention[]` entry:
 *   `{loopId, issue, lane, stage, since}`
 * @returns {Object|null}
 */
export function computeWouldBeAction(row) {
  if (!row || row.lane !== 'blocked') return null;

  const loopId = clampField(row.loopId);
  const issue = clampField(row.issue);
  const stage = clampField(row.stage);
  const since = row.since;
  const label = issue || loopId || 'unknown loop';
  const detail = `waiting on human since ${since}${stage ? ` (${stage})` : ''}`;

  return {
    loopId: row.loopId ?? null,
    issue: row.issue ?? null,
    lane: row.lane,
    wouldBeMarker: 'blocked',
    // Same shape as a real dispatch feedback[] entry
    // (lib/dispatch-store.js addFeedback's own {message} field) —
    // recognized by the real WAKE_FEEDBACK_REGEX/isWakeEvent, never
    // actually appended to any feedback[] array.
    wouldBeFeedback: { message: `[blocked] observer (shadow): ${label} ${detail}` },
    // Same shape as a real Linear comment ({body}, lib/providers/linear/
    // index.js's createComment) — never actually posted.
    wouldBeComment: {
      body: `[blocked] Observer harness (shadow — not posted): ${label} appears to be ${detail}. Logged for shadow-run comparison only (LIN-2132); no live comment was created.`
    },
    diagnosis: { lane: row.lane, stage: row.stage ?? null, since }
  };
}

/**
 * Pure: derive the full would-be-action list for one tick's diagnosis
 * payload (`buildSweepPayload`'s return value). Order-preserving over
 * `payload.attention`, which `buildSweepPayload` already sorts
 * deterministically by `loopId`.
 *
 * @param {{attention?: Array<Object>}} payload
 * @returns {Array<Object>}
 */
export function computeWouldBeActions(payload) {
  const attention = Array.isArray(payload?.attention) ? payload.attention : [];
  return attention.map(computeWouldBeAction).filter(Boolean);
}

function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    urlKey: doc.urlKey,
    loopId: doc.loopId,
    issue: doc.issue,
    lane: doc.lane,
    wouldBeMarker: doc.wouldBeMarker,
    wouldBeFeedback: doc.wouldBeFeedback,
    wouldBeComment: doc.wouldBeComment,
    diagnosis: doc.diagnosis,
    recordedAt: doc.recordedAt?.toISOString?.() || doc.recordedAt
  };
}

/**
 * Read-only-relative-to-the-live-pipeline shadow action log. Append-only,
 * one document per would-be action row, per-workspace count-capped (same
 * `_pruneToCapacity` shape as `lib/task-snapshot-store.js`) plus an
 * age-based `cleanup()` keyed on `recordedAt` (matching P1-2's
 * `RETENTION_IDLE_MS` retention posture — no TTL index, `.cleanup()` stays
 * the sole evictor, per `lib/db-indexes.js`'s house rule).
 *
 * Never-throw, swallow-and-neutral writes/reads, matching every store in
 * this codebase (`lib/observer-state-store.js`, `lib/task-snapshot-store.js`).
 */
export class ObserverShadowLogStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('observer-shadow-log')
   * @param {number} [options.maxPerWorkspace] - per-workspace retained-entry cap
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxPerWorkspace = options.maxPerWorkspace || MAX_ENTRIES_PER_WORKSPACE;
  }

  /**
   * Append this tick's would-be actions for one workspace. A no-op (returns
   * 0) for an empty/invalid `actions` list — most ticks have no `blocked`
   * attention row and so produce no shadow-log write at all.
   *
   * @param {string} urlKey
   * @param {Array<Object>} actions - `computeWouldBeActions()` output
   * @param {Date} [recordedAt]
   * @returns {Promise<number>} count actually inserted
   */
  async recordActions(urlKey, actions, recordedAt = new Date()) {
    if (!this.collection || !urlKey || !Array.isArray(actions) || actions.length === 0) return 0;

    try {
      let inserted = 0;
      for (const action of actions) {
        const doc = {
          _id: crypto.randomUUID(),
          urlKey,
          recordedAt,
          ...action
        };
        await this.collection.insertOne(doc);
        inserted++;
      }
      await this._pruneToCapacity(urlKey);
      return inserted;
    } catch (err) {
      console.error('Error recording observer shadow actions:', err);
      return 0;
    }
  }

  /**
   * List a workspace's shadow-log entries, newest first.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<{items: Object[], total: number}>}
   */
  async listByWorkspace(urlKey, { limit } = {}) {
    if (!this.collection || !urlKey) return { items: [], total: 0 };
    try {
      const docs = await this._docsFor(urlKey);
      const total = docs.length;
      const sliced = limit ? docs.slice(0, limit) : docs;
      return { items: sliced.map(toRecord), total };
    } catch (err) {
      console.error('Error listing observer shadow actions:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Evicts entries older than `RETENTION_IDLE_MS`. Swallow-and-neutral
   * posture (`catch` -> `0`) so a cleanup failure never fails an otherwise-
   * good write.
   *
   * @returns {Promise<number>} count of removed documents
   */
  async cleanup() {
    if (!this.collection) return 0;
    try {
      const cutoff = new Date(Date.now() - RETENTION_IDLE_MS);
      const result = await this.collection.deleteMany({ recordedAt: { $lt: cutoff } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Observer shadow log cleanup error:', err);
      return 0;
    }
  }

  /** Entries for a workspace, newest-first (recordedAt descending). */
  async _docsFor(urlKey) {
    const docs = await this.collection.find({ urlKey }).toArray();
    docs.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
    return docs;
  }

  /** Delete anything beyond the newest `maxPerWorkspace` entries for a workspace. */
  async _pruneToCapacity(urlKey) {
    try {
      const docs = await this._docsFor(urlKey);
      for (const doc of docs.slice(this.maxPerWorkspace)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning observer shadow log:', err);
    }
  }
}
