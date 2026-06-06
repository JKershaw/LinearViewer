/**
 * Report-history store: durable per-workspace roadmap report runs.
 *
 * One document per report run, workspace-scoped by urlKey, bounded by a
 * per-workspace cap (newest N kept). Filtering/sorting happens in JS so
 * MongoDB and file-based MangoDB behave identically; workspace-scoped result
 * sets are small enough that this is fine.
 *
 * No TTL: a saved report is a durable user artifact (like custom prompts),
 * not a cache or audit log. The cap bounds storage; reports are kept so they
 * can be compared over time. This is intentionally NOT the north-star KV blob
 * (a single tiny string per workspace held in session + user preferences).
 *
 * The record shape is a shared interface: the Roadmap page writes it (Step 0,
 * LIN-299), Step 1 (LIN-300) populates the per-task `orientation` field as
 * part of the same save, and Step 2 (LIN-301, Ship view) reads the latest.
 *
 * Schema (one document per run):
 * {
 *   _id:         string,   // run UUID
 *   urlKey:      string,   // workspace URL key (indexed)
 *   generatedAt: Date,     // when the run completed
 *   model:       string,   // resolved model id used for the run
 *   northStar:   string,   // exact north-star text scored against ('' when none)
 *   narrative:   ReportNarrative,        // the five layer outputs (string|null each)
 *   orientation: OrientationBearing[]    // [] at Step 0; populated by Step 1 (LIN-300)
 * }
 *
 * @typedef {Object} OrientationBearing
 * @property {string}  identifier   Linear issue identifier (e.g. "LIN-301")
 * @property {string}  bearing      Compass bearing vs the north star (Step 1)
 * @property {string}  reason       Short rationale for the bearing (Step 1)
 * @property {boolean} archived     Whether this task is archived from the orientation view
 *
 * @typedef {Object} ReportNarrative
 * @property {string|null} digest             Synthesis — at-a-glance summary (renders first; null on old/failed runs)
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
 */

import crypto from 'crypto';

const MAX_REPORTS_PER_WORKSPACE = 20;
const MAX_NARRATIVE_CHARS = 100000; // generous: layers cap at ~5k tokens (~20k chars)
const MAX_NORTH_STAR_CHARS = 8000;  // matches the north-star KV limit
const MAX_ORIENTATION_FIELD_CHARS = 2000;

const NARRATIVE_LAYERS = ['digest', 'technical', 'product', 'trajectory', 'northStarReading', 'gap'];

/** Build a complete, sanitized narrative object (all five keys present). */
function normalizeNarrative(narrative) {
  const src = narrative && typeof narrative === 'object' ? narrative : {};
  const out = {};
  for (const layer of NARRATIVE_LAYERS) {
    out[layer] = typeof src[layer] === 'string' ? src[layer].slice(0, MAX_NARRATIVE_CHARS) : null;
  }
  return out;
}

/**
 * Sanitize the per-task orientation array. Step 0 normally passes [] (or omits
 * it); the shape is enforced here so Step 1 (LIN-300) writes into a stable
 * contract when it saves narrative + orientation together.
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
    orientation: doc.orientation || []
  };
}

/**
 * Lightweight projection for list views: enough to render and label a history
 * row (timestamp + north-star + model) without shipping the full narratives.
 * @typedef {Object} ReportSummary
 * @property {string} id
 * @property {string} generatedAt   ISO timestamp
 * @property {string} model
 * @property {string} northStar
 */
function toSummary(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    generatedAt: doc.generatedAt?.toISOString?.() || doc.generatedAt,
    model: doc.model,
    northStar: doc.northStar
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
   * @param {number} [options.maxReports=20] - Per-workspace cap on retained runs.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxReports = options.maxReports || MAX_REPORTS_PER_WORKSPACE;
  }

  /**
   * Persist a completed report run. Assigns id/generatedAt, defaults
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

    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      generatedAt: new Date(),
      model: String(model || ''),
      northStar: typeof northStar === 'string' ? northStar.slice(0, MAX_NORTH_STAR_CHARS) : '',
      narrative: normalizeNarrative(narrative),
      orientation: normalizeOrientation(orientation)
    };

    await this.collection.insertOne(doc);
    await this._pruneToCapacity(urlKey);
    return toRecord(doc);
  }

  /**
   * List report summaries for a workspace, newest-first. Returns lightweight
   * projections (no narrative bodies) — fetch the full record with get().
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {number} [options.limit] - Max entries to return (omit for all)
   * @returns {Promise<{items: ReportSummary[], total: number}>}
   */
  async list(urlKey, { limit } = {}) {
    if (!this.collection || !urlKey) return { items: [], total: 0 };

    try {
      const docs = await this._docsSorted(urlKey);
      const total = docs.length;
      const sliced = limit ? docs.slice(0, limit) : docs;
      return { items: sliced.map(toSummary), total };
    } catch (err) {
      console.error('Error listing report history:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Fetch a single full report by id.
   * @returns {Promise<ReportRecord|null>}
   */
  async get(urlKey, id) {
    if (!this.collection || !urlKey || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting report:', err);
      return null;
    }
  }

  /**
   * Fetch the newest full report for a workspace, or null if none exist.
   *
   * Backs the Ship view's orientation mode (LIN-301): a pure read of the latest
   * saved run — no LLM call, no generation. Returns the complete record
   * (including the `orientation` bearings), unlike list() which projects to
   * summaries.
   *
   * @returns {Promise<ReportRecord|null>}
   */
  async getLatest(urlKey) {
    if (!this.collection || !urlKey) return null;
    try {
      const docs = await this._docsSorted(urlKey);
      return docs.length ? toRecord(docs[0]) : null;
    } catch (err) {
      console.error('Error getting latest report:', err);
      return null;
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

  /** Docs for a workspace, sorted newest-first. */
  async _docsSorted(urlKey) {
    const docs = await this.collection.find({ urlKey }).toArray();
    docs.sort((a, b) => toMillis(b.generatedAt) - toMillis(a.generatedAt));
    return docs;
  }

  /** Delete anything beyond the newest `maxReports` for a workspace. */
  async _pruneToCapacity(urlKey) {
    try {
      const docs = await this._docsSorted(urlKey);
      for (const doc of docs.slice(this.maxReports)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning report history:', err);
    }
  }
}
