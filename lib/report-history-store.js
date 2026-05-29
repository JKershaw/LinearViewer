/**
 * Report-history store: durable per-workspace roadmap report runs.
 *
 * One document per report run, workspace-scoped by urlKey, append-only,
 * bounded by BOTH a per-workspace cap (newest N kept) AND a TTL (expiresAt).
 * Mirrors the foreman-store pattern: filtering/sorting happens in JS so
 * MongoDB and file-based MangoDB behave identically, and workspace-scoped
 * result sets are small enough that this is fine.
 *
 * This is intentionally NOT the north-star KV blob (a single tiny string per
 * workspace held in session + user preferences). Reports are many multi-KB
 * records that need list/cap/TTL semantics, so they get their own store.
 *
 * The record shape is a shared interface: the Roadmap page writes it (Step 0),
 * Step 1 (LIN-300) populates the per-task `orientation` field, and Step 2
 * (LIN-301, Ship view) reads it.
 *
 * Schema (one document per run):
 * {
 *   _id:         string,   // run UUID
 *   urlKey:      string,   // workspace URL key (indexed)
 *   generatedAt: Date,     // when the run completed
 *   model:       string,   // resolved model id used for the run
 *   northStar:   string,   // exact north-star text scored against ('' when none)
 *   narrative:   ReportNarrative,        // the five layer outputs (string|null each)
 *   orientation: OrientationBearing[],   // [] at Step 0; populated by Step 1 (LIN-300)
 *   expiresAt:   Date      // TTL for auto-cleanup
 * }
 *
 * @typedef {Object} OrientationBearing
 * @property {string}  identifier   Linear issue identifier (e.g. "LIN-301")
 * @property {string}  bearing      Compass bearing vs the north star (Step 1)
 * @property {string}  reason       Short rationale for the bearing (Step 1)
 * @property {boolean} archived     Whether this task is archived from the orientation view
 *
 * @typedef {Object} ReportNarrative
 * @property {string|null} technical          Layer 1 — technical narrative
 * @property {string|null} product            Layer 2 — product perspective
 * @property {string|null} trajectory         Layer 3a — trajectory reading
 * @property {string|null} northStarReading   Layer 3b — north-star reading (null when no north star)
 * @property {string|null} gap                Layer 4 — gap analysis (null when no north star)
 *
 * @typedef {Object} ReportRecord
 * @property {string} id                       Run UUID
 * @property {string} generatedAt              ISO timestamp
 * @property {string} model                    Resolved model id
 * @property {string} northStar                Exact north-star snapshot ('' when none)
 * @property {ReportNarrative} narrative       The five layer outputs
 * @property {OrientationBearing[]} orientation  Per-task bearings ([] until Step 1)
 * @property {string} expiresAt                ISO timestamp
 */

import crypto from 'crypto';

const MAX_REPORTS_PER_WORKSPACE = 20;
const MAX_NARRATIVE_CHARS = 100000; // generous: layers cap at ~5k tokens (~20k chars)
const MAX_NORTH_STAR_CHARS = 8000;  // matches the north-star KV limit
const MAX_ORIENTATION_FIELD_CHARS = 2000;

const NARRATIVE_LAYERS = ['technical', 'product', 'trajectory', 'northStarReading', 'gap'];

/** Coerce a layer value to a capped string, or null. */
function normalizeLayer(value) {
  if (typeof value !== 'string') return null;
  return value.slice(0, MAX_NARRATIVE_CHARS);
}

/** Build a complete, sanitized narrative object (all five keys present). */
function normalizeNarrative(narrative) {
  const src = narrative && typeof narrative === 'object' ? narrative : {};
  const out = {};
  for (const layer of NARRATIVE_LAYERS) {
    out[layer] = normalizeLayer(src[layer]);
  }
  return out;
}

/**
 * Sanitize the per-task orientation array. Step 0 normally passes [] (or
 * omits it); the shape is enforced here so Step 1 (LIN-300) can write into a
 * stable contract.
 * @returns {OrientationBearing[]}
 */
function normalizeOrientation(orientation) {
  if (!Array.isArray(orientation)) return [];
  return orientation
    .filter(o => o && typeof o === 'object')
    .map(o => ({
      identifier: String(o.identifier || '').slice(0, MAX_ORIENTATION_FIELD_CHARS),
      bearing: String(o.bearing || '').slice(0, MAX_ORIENTATION_FIELD_CHARS),
      reason: String(o.reason || '').slice(0, MAX_ORIENTATION_FIELD_CHARS),
      archived: o.archived === true
    }));
}

/** Convert a stored document into the public ReportRecord shape. */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    generatedAt: doc.generatedAt?.toISOString?.() || doc.generatedAt,
    model: doc.model,
    northStar: doc.northStar,
    narrative: doc.narrative,
    orientation: doc.orientation || [],
    expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
  };
}

function toMillis(date) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/**
 * MongoDB/MangoDB-backed report-history store.
 */
export class ReportHistoryStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.ttl=2592000] - Retention TTL in seconds (default 30 days).
   * @param {number} [options.maxReports=20] - Per-workspace cap on retained runs.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.ttl = options.ttl || 30 * 24 * 60 * 60; // 30 days
    this.maxReports = options.maxReports || MAX_REPORTS_PER_WORKSPACE;
  }

  /**
   * Persist a completed report run. Assigns id/generatedAt/expiresAt, defaults
   * orientation to [], and prunes the workspace back down to the cap.
   *
   * @param {string} urlKey
   * @param {Object} data
   * @param {string} data.model - Resolved model id used for the run.
   * @param {string} [data.northStar] - Exact north-star text scored against.
   * @param {ReportNarrative} data.narrative - The five layer outputs.
   * @param {OrientationBearing[]} [data.orientation] - Per-task bearings (Step 1).
   * @returns {Promise<ReportRecord|null>}
   */
  async save(urlKey, { model, northStar, narrative, orientation } = {}) {
    if (!this.collection || !urlKey) return null;

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      generatedAt: now,
      model: String(model || ''),
      northStar: typeof northStar === 'string' ? northStar.slice(0, MAX_NORTH_STAR_CHARS) : '',
      narrative: normalizeNarrative(narrative),
      orientation: normalizeOrientation(orientation),
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    await this.collection.insertOne(doc);
    await this._pruneToCapacity(urlKey);
    return toRecord(doc);
  }

  /**
   * List non-expired reports for a workspace, newest-first.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {number} [options.limit] - Max entries to return (omit for all)
   * @param {number} [options.offset=0]
   * @returns {Promise<{items: ReportRecord[], total: number}>}
   */
  async list(urlKey, { limit, offset = 0 } = {}) {
    if (!this.collection || !urlKey) return { items: [], total: 0 };

    try {
      const docs = await this._liveDocsSorted(urlKey);
      const total = docs.length;
      const sliced = limit ? docs.slice(offset, offset + limit) : docs.slice(offset);
      return { items: sliced.map(toRecord), total };
    } catch (err) {
      console.error('Error listing report history:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Fetch a single report by id. Returns null if missing or expired.
   * @returns {Promise<ReportRecord|null>}
   */
  async get(urlKey, id) {
    if (!this.collection || !urlKey || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      if (!doc) return null;
      if (doc.expiresAt && toMillis(doc.expiresAt) <= Date.now()) {
        await this.collection.deleteOne({ _id: id, urlKey });
        return null;
      }
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting report:', err);
      return null;
    }
  }

  /**
   * Replace the per-task orientation array on an existing report. This is the
   * Step 1 (LIN-300) entry point; defined now so the contract is stable.
   * @returns {Promise<ReportRecord|null>}
   */
  async setOrientation(urlKey, id, orientation) {
    if (!this.collection || !urlKey || !id) return null;
    const existing = await this.collection.findOne({ _id: id, urlKey });
    if (!existing) return null;
    await this.collection.updateOne(
      { _id: id, urlKey },
      { $set: { orientation: normalizeOrientation(orientation) } }
    );
    return this.get(urlKey, id);
  }

  /** Remove expired entries across all workspaces. @returns {Promise<number>} */
  async cleanup() {
    if (!this.collection) return 0;
    try {
      const result = await this.collection.deleteMany({ expiresAt: { $lt: new Date() } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error cleaning up report history:', err);
      return 0;
    }
  }

  /** Remove all entries for a workspace (used in tests). @returns {Promise<number>} */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing report history:', err);
      return 0;
    }
  }

  /** Non-expired docs for a workspace, sorted newest-first. */
  async _liveDocsSorted(urlKey) {
    const now = Date.now();
    const docs = (await this.collection.find({ urlKey }).toArray())
      .filter(doc => !doc.expiresAt || toMillis(doc.expiresAt) > now);
    docs.sort((a, b) => toMillis(b.generatedAt) - toMillis(a.generatedAt));
    return docs;
  }

  /** Delete anything beyond the newest `maxReports` for a workspace. */
  async _pruneToCapacity(urlKey) {
    try {
      // Sort ALL docs (including expired) newest-first so the cap is a hard
      // ceiling on stored rows, independent of the TTL sweep.
      const docs = (await this.collection.find({ urlKey }).toArray())
        .sort((a, b) => toMillis(b.generatedAt) - toMillis(a.generatedAt));
      const overflow = docs.slice(this.maxReports);
      for (const doc of overflow) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning report history:', err);
    }
  }
}
