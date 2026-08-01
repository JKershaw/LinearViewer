/**
 * Observation sessions read-model store (LIN-623).
 *
 * A durable, materialized projection of the autopilot *sessions* the Observation
 * feed renders — a CQRS read-model. The hot `/api/dashboard/sessions` poll used
 * to reconstruct the entire 30-day session model from the raw append-only
 * dispatch + agent-status logs on EVERY poll (an O(all events in 30 days) replay
 * that cost 25–51s cold and that the in-process SWR cache only hid once warm and
 * reset on every deploy). This collection stores the already-reconstructed lean
 * session objects so the poll becomes a cheap per-workspace `find({urlKey})` of a
 * handful of small docs — and, crucially, it SURVIVES deploys, which is the actual
 * cold-start cure.
 *
 * Schema — one doc per (urlKey, sessionId):
 * {
 *   _id: `${urlKey}:${sessionId}`,   // upsert key → backfill ⨯ live-write idempotent
 *   type: 'session',
 *   urlKey, sessionId,
 *   session: { … },                  // the LEAN `getSessionsForWorkspace` output for
 *                                    //   this session (feedback-free, prompt-free).
 *                                    //   Fed UNCHANGED to the route's buildSessionPayload,
 *                                    //   which derives the now-relative status/stale/
 *                                    //   statusLine at READ time — so they never freeze.
 *   builderVersion,                  // bump invalidates stale-shape docs (read filters them out)
 *   updatedAt,
 *   historyExpiresAt                 // = session's last activity + 30d; evicted by the
 *                                    //   existing hourly cleanup loop (no TTL index, per LIN-610)
 * }
 *
 * Plus one meta doc per workspace, `_id: `${urlKey}:__meta__``, `type: 'meta'`,
 * carrying `backfilledAt` so a genuinely-empty workspace is distinguishable from a
 * not-yet-backfilled one (otherwise an idle workspace re-fans to the live path on
 * every poll forever).
 *
 * Read shape is per-workspace `find({urlKey})` — NEVER `$in` (MangoDB has no query
 * planner and the codebase uses `$in` nowhere); the existing per-workspace fan-out
 * is preserved, now cheap.
 */

// Bump when the lean session-object shape (getSessionsForWorkspace output, or
// anything buildSessionPayload reads off it) changes, so in-flight stored docs
// written by an older build are treated as a read-miss and rebuilt rather than
// rendered with a drifted shape. The read-miss live fallback + 30-day churn are
// the backstops.
// v2 (LIN-1005): loops now carry pre-derived `wakeMarker`/`waitingMessage`, and
// buildSessionPayload reads them to roll up a session-level `waiting` state. A v1
// doc's lean loops lack those fields (and dropped raw feedback), so a genuinely
// waiting session would render as in-progress until 30-day churn — bump so those
// docs read-miss and rebuild with the waiting fields present.
// v3 (LIN-1341): follow-up grouping now prefers the durable `sessionGroupId`
// stitch over the followUpTo chain-walk, and `deriveSessionWaiting` rolls up
// over the group's tail loop instead of any loop. A v2 doc may have grouped (and
// rolled up waiting) differently under the old rules — bump so those docs
// read-miss and rebuild under the new grouping.
// v4 (LIN-1487): the Observation feed now folds a lineage at render time from
// the loop's `lineageId`. LIN-1477 added `lineageId` to the stored lean shape
// WITHOUT bumping, so pre-LIN-1477 v3 docs still match and are served with
// `lineageId === undefined` on every loop — the fold degrades them to a
// lineage-of-one (via the client's `?? loopId` fallback) and silently no-ops on
// exactly the write-quiet archive population where the fold matters most. Bump
// so those docs read-miss and rebuild WITH `lineageId` present. This is an
// efficacy lever, not a safety lever: the fold is already correct on a stale
// doc; the bump only makes it reach the archive.
// v5 (LIN-1495): `telemetry.usage.costUsd` is now DERIVED at build time for the
// harness that reports no native cost (claude-code), rather than being stored as
// a permanent null. This changes a value inside an existing field rather than
// adding a key, so a v4 doc still matches the shape — and would therefore serve
// `costUsd: null` forever, exactly the "—" the derivation exists to replace. Bump
// so those docs read-miss and rebuild with a priced cost. Same character as v4: an
// efficacy lever, not a safety lever — a stale doc is not wrong, just unpriced.
// v6 (LIN-1766): `telemetry.usage.lane` is now parsed (subscription | api |
// openrouter | null). Unlike v4/v5, this genuinely ADDS A KEY rather than
// changing a value inside an existing field, so a v5 doc no longer matches the
// new shape — it is a real shape change, not another efficacy lever over a doc
// that was stale-but-not-wrong. Bump so those docs read-miss and rebuild with
// `lane` present.
export const BUILDER_VERSION = 6;

const DEFAULT_HISTORY_TTL = 30 * 24 * 60 * 60; // 30 days in seconds, matches dispatch-history

const META_SUFFIX = '__meta__';

/**
 * Latest activity instant across a session, in ms — used to set `historyExpiresAt`
 * so a derived doc lives exactly as long as the source rows it was built from
 * (which carry their own 30-day TTL from `resolvedAt`/`timestamp`). Scans the
 * session's own timestamps and every loop's; falls back to "now" when a session
 * somehow carries no usable timestamp, so a doc is never written already-expired.
 *
 * @param {Object} session
 * @param {number} nowMs
 * @returns {number}
 */
function _sessionLastActivityMs(session, nowMs) {
  let max = 0;
  const consider = (v) => {
    if (!v) return;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  };
  consider(session?.dispatchedAt);
  consider(session?.completedAt);
  for (const l of Array.isArray(session?.loops) ? session.loops : []) {
    consider(l.dispatchedAt);
    consider(l.resolvedAt);
    consider(l.takenAt);
    consider(l.terminalCompletedAt);
    consider(l.agentTimestamp);
  }
  return max > 0 ? max : nowMs;
}

/**
 * Store for the materialized Observation sessions read-model.
 */
export class ObservationSessionsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection
   * @param {number} [options.historyTtl=2592000] - Derived-doc TTL in seconds (30 days)
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.historyTtl = options.historyTtl || DEFAULT_HISTORY_TTL;
  }

  _sessionDocId(urlKey, sessionId) {
    return `${urlKey}:${sessionId}`;
  }

  _metaDocId(urlKey) {
    return `${urlKey}:${META_SUFFIX}`;
  }

  /**
   * Upsert one session's derived doc. Whole-doc replace keyed by `_id`, so a
   * backfill and a concurrent live write each write a complete, correct doc
   * (last-writer-wins, no partial-update corruption).
   *
   * @param {string} urlKey
   * @param {Object} session - lean session object (must carry `sessionId`)
   * @returns {Promise<boolean>}
   */
  async upsertSession(urlKey, session) {
    if (!urlKey || !this.collection || !session || !session.sessionId) return false;
    try {
      const now = new Date();
      const lastMs = _sessionLastActivityMs(session, now.getTime());
      const doc = {
        _id: this._sessionDocId(urlKey, session.sessionId),
        type: 'session',
        urlKey,
        sessionId: session.sessionId,
        session,
        builderVersion: BUILDER_VERSION,
        updatedAt: now,
        historyExpiresAt: new Date(lastMs + this.historyTtl * 1000)
      };
      await this.collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
      return true;
    } catch (err) {
      console.error('Error upserting observation session:', err);
      return false;
    }
  }

  /**
   * Remove a session's derived doc (the session no longer reconstructs — e.g. its
   * source rows aged out). Idempotent.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async removeSession(urlKey, sessionId) {
    if (!urlKey || !sessionId || !this.collection) return false;
    try {
      await this.collection.deleteOne({ _id: this._sessionDocId(urlKey, sessionId) });
      return true;
    } catch (err) {
      console.error('Error removing observation session:', err);
      return false;
    }
  }

  /**
   * Read every derived session object for a workspace, plus the backfill marker.
   * One `find({urlKey})` — partitions session docs from the meta doc and drops any
   * doc written by a stale `builderVersion` (treated as a miss so it gets rebuilt).
   *
   * @param {string} urlKey
   * @returns {Promise<{sessions: Array<Object>, backfilledAt: Date|null}>}
   */
  async findByWorkspace(urlKey) {
    if (!urlKey || !this.collection) return { sessions: [], backfilledAt: null };
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      const sessions = [];
      let backfilledAt = null;
      for (const doc of docs) {
        if (doc.type === 'meta') {
          backfilledAt = doc.backfilledAt || null;
          continue;
        }
        if (!doc.session) continue;
        if (doc.builderVersion !== BUILDER_VERSION) continue; // stale shape → rebuild
        sessions.push(doc.session);
      }
      return { sessions, backfilledAt };
    } catch (err) {
      console.error('Error reading observation sessions:', err);
      return { sessions: [], backfilledAt: null };
    }
  }

  /**
   * Direct read-model lookup of ONE session by id (LIN-632). Hot drill-in paths
   * (session-context, session-summary) only need a single session, so the `_id`
   * point-read replaces the full 30-day `getSessionsForWorkspace` reconstruction
   * that previously rebuilt the whole workspace just to `find()` one session.
   *
   * Returns the stored lean `session` object only when its `builderVersion`
   * matches the current shape; a stale-shape or absent doc returns null, which
   * callers treat as a miss and degrade to the live reconstruction (the same
   * backstop `findByWorkspace` relies on).
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @returns {Promise<Object|null>}
   */
  async getSession(urlKey, sessionId) {
    if (!urlKey || !sessionId || !this.collection) return null;
    try {
      const doc = await this.collection.findOne({ _id: this._sessionDocId(urlKey, sessionId) });
      if (!doc || doc.type !== 'session' || !doc.session) return null;
      if (doc.builderVersion !== BUILDER_VERSION) return null; // stale shape → miss
      return doc.session;
    } catch (err) {
      console.error('Error reading observation session:', err);
      return null;
    }
  }

  /**
   * Mark a workspace as backfilled (the one-time full build has run). Lets a
   * genuinely-empty workspace stop re-fanning to the live path on every poll.
   *
   * @param {string} urlKey
   * @returns {Promise<boolean>}
   */
  async setBackfillMarker(urlKey) {
    if (!urlKey || !this.collection) return false;
    try {
      const now = new Date();
      const doc = {
        _id: this._metaDocId(urlKey),
        type: 'meta',
        urlKey,
        backfilledAt: now,
        builderVersion: BUILDER_VERSION,
        // Refreshed on every backfill; cleaned up alongside the workspace's docs.
        historyExpiresAt: new Date(now.getTime() + this.historyTtl * 1000)
      };
      await this.collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
      return true;
    } catch (err) {
      console.error('Error setting observation backfill marker:', err);
      return false;
    }
  }

  /**
   * Evict expired derived docs. Mirrors the dispatch-history policy: a plain
   * `historyExpiresAt` range delete driven by the hourly server cleanup loop, no
   * TTL index (LIN-610).
   *
   * @returns {Promise<number>}
   */
  async cleanup() {
    if (!this.collection) return 0;
    try {
      const now = new Date();
      const result = await this.collection.deleteMany({ historyExpiresAt: { $lt: now } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Observation sessions cleanup error:', err);
      return 0;
    }
  }

  /**
   * Clears all docs for a workspace (used in tests).
   *
   * @param {string} urlKey
   * @returns {Promise<number>}
   */
  async clear(urlKey) {
    if (!this.collection) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing observation sessions:', err);
      return 0;
    }
  }
}
