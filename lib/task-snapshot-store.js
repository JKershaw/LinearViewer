/**
 * Task-snapshot store: append-only historical archive of task state (LIN-598).
 *
 * One document per *observed change* to a task, workspace-scoped and keyed by
 * `{urlKey, taskIdentifier}`. A snapshot is the canonical issue slice that
 * `hashContext` (lib/recap-cache.js) covers — title, description, state, labels,
 * priority, comments, and parent/children state — so the dedupe boundary and the
 * read-time diff boundary are identical.
 *
 * Capture is hash-gated: `captureIfChanged` writes only when the supplied
 * `inputHash` differs from the latest stored snapshot for that task. Because the
 * capture seams already compute that hash for the recap/brief caches, snapshots
 * are rare (one per real change), so a per-task count cap covers a very long
 * task evolution.
 *
 * Modeled on lib/report-history-store.js (durable, full-document-per-run, count
 * capped via _pruneToCapacity — NO TTL) crossed with the `{urlKey,
 * taskIdentifier}` index shape of lib/agent-status-store.js. NO TTL is
 * deliberate: this is a durable analytical artifact ("see how tasks evolve over
 * time"); a TTL would silently drop the early history of long-lived tasks. The
 * cap bounds storage instead.
 *
 * Diffs are NOT stored — `diffSnapshots(a, b)` is a pure read-time field compare
 * of two raw snapshots. No diff dependency is introduced.
 *
 * Schema (one document per captured change):
 * {
 *   _id:            string,   // UUID
 *   urlKey:         string,   // workspace URL key (indexed)
 *   taskIdentifier: string,   // human identifier, e.g. "LIN-598" (indexed)
 *   canonicalId:    string,   // provider canonical id (UUID) — survives renames
 *   inputHash:      string,   // sha256 of the hashContext slice at capture time
 *   capturedAt:     Date,     // when the change was observed
 *   snapshot:       TaskSnapshot   // the canonical issue slice (see snapshotFromContext)
 * }
 *
 * The snapshot slice carries one field that is NOT part of the hashed slice:
 * `headSha` — the worker's self-reported git HEAD at capture time (LIN-1239). It is
 * deliberately kept out of `inputHash`/`hashContext` so a pure code-HEAD move never
 * churns a snapshot; because capture is gated on `inputHash` alone, `snapshot.headSha`
 * records "HEAD at the last observed task-slice change," not "HEAD of the last read."
 */

import crypto from 'crypto';

const MAX_SNAPSHOTS_PER_TASK = 50;
const MAX_TEXT_CHARS = 100000;     // generous: descriptions/comments are bounded upstream
const MAX_FIELD_CHARS = 500;
const MAX_LABELS = 100;
const MAX_COMMENTS = 500;
const MAX_CHILDREN = 500;

function clampText(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS) : '';
}

function clampField(value) {
  return value == null ? '' : String(value).slice(0, MAX_FIELD_CHARS);
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    name: clampField(state.name),
    type: clampField(state.type)
  };
}

/**
 * Build the snapshot slice from a recommendation context (the same object
 * `hashContext` is computed over). Pure; no I/O. Mirrors the hashContext slice
 * so the stored shape and the dedupe boundary stay aligned, with a little extra
 * (state name, comment metadata) to make read-time diffs human-legible.
 *
 * `headSha` is the worker's self-reported git HEAD (LIN-1239) — its own clone's
 * `git rev-parse HEAD`, threaded in from the recap/brief capture seams. It is stored
 * as a separate field and is NOT covered by `hashContext`, so it can never enter the
 * dedupe gate; an absent/malformed report is stored as `null`.
 *
 * @param {Object} context - Output of fetchRecommendationContext().
 * @param {string|null} [headSha] - Worker-reported git HEAD, or null when unreported.
 * @returns {TaskSnapshot}
 *
 * @typedef {Object} TaskSnapshot
 * @property {string}  title
 * @property {string}  description
 * @property {{name:string,type:string}|null} state
 * @property {string[]} labels        Sorted label names.
 * @property {number|null} priority
 * @property {Array<{id:string,body:string,createdAt:*}>} comments
 * @property {{identifier:string,state:object|null}|null} parent
 * @property {Array<{identifier:string,state:object|null}>} children
 * @property {string|null} headSha    Worker-reported git HEAD (LIN-1239); null when absent.
 */
export function snapshotFromContext(context, headSha = null) {
  const ctx = context && typeof context === 'object' ? context : {};
  const issue = ctx.issue || {};
  return {
    title: clampField(issue.title),
    description: clampText(issue.description),
    state: normalizeState(issue.state),
    labels: Array.isArray(issue.labels)
      ? [...issue.labels].map(clampField).sort().slice(0, MAX_LABELS)
      : [],
    priority: typeof issue.priority === 'number' ? issue.priority : null,
    comments: (Array.isArray(ctx.comments) ? ctx.comments : [])
      .slice(0, MAX_COMMENTS)
      .map(c => ({
        id: clampField(c?.id),
        body: clampText(c?.body),
        createdAt: c?.createdAt ?? null
      })),
    parent: ctx.parent
      ? { identifier: clampField(ctx.parent.identifier), state: normalizeState(ctx.parent.state) }
      : null,
    children: (Array.isArray(ctx.children) ? ctx.children : [])
      .slice(0, MAX_CHILDREN)
      .map(c => ({ identifier: clampField(c?.identifier), state: normalizeState(c?.state) })),
    // Worker-reported git HEAD (LIN-1239). Separate field, never hashed — see the
    // module header. Stored as a bounded string, or null when unreported.
    headSha: typeof headSha === 'string' && headSha ? clampField(headSha) : null
  };
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
}

/** Field-level equality for a single snapshot field (deep, order-stable). */
function fieldEqual(a, b) {
  return stableJson(a ?? null) === stableJson(b ?? null);
}

const DIFF_FIELDS = ['title', 'description', 'state', 'labels', 'priority', 'comments', 'parent', 'children'];

/**
 * Pure read-time diff of two snapshots (the older `a`, the newer `b`). Returns
 * the list of changed top-level fields with both values, plus a convenience
 * `changed` boolean. No diff library — consecutive-snapshot field compare is
 * sufficient (LIN-598 v1).
 *
 * @param {TaskSnapshot|null} a - earlier snapshot (or null when there is no prior)
 * @param {TaskSnapshot|null} b - later snapshot
 * @returns {{changed: boolean, fields: Array<{field:string, before:*, after:*}>}}
 */
export function diffSnapshots(a, b) {
  const before = a || {};
  const after = b || {};
  const fields = [];
  for (const field of DIFF_FIELDS) {
    if (!fieldEqual(before[field], after[field])) {
      fields.push({ field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  return { changed: fields.length > 0, fields };
}

function toMillis(date) {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

/** Convert a stored document into the public record shape. */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    taskIdentifier: doc.taskIdentifier,
    canonicalId: doc.canonicalId,
    inputHash: doc.inputHash,
    capturedAt: doc.capturedAt?.toISOString?.() || doc.capturedAt,
    snapshot: doc.snapshot
  };
}

/**
 * MongoDB/MangoDB-backed append-only task-snapshot store.
 */
export class TaskSnapshotStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxPerTask=50] - Per-task cap on retained snapshots.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxPerTask = options.maxPerTask || MAX_SNAPSHOTS_PER_TASK;
    // Per-process monotonic counter, used only as a SECONDARY sort key to break
    // ties when two snapshots share the same `capturedAt` millisecond (rapid
    // successive captures). `capturedAt` stays primary, so ordering across a
    // restart — where the counter resets — is still governed by wall-clock time.
    this._seq = 0;
  }

  /**
   * Append a snapshot ONLY when it differs from the latest stored one for the
   * task (gated on `inputHash`). Idempotent on an unchanged read, so it is safe
   * to call fire-and-forget on every read seam.
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.taskIdentifier - human identifier, e.g. "LIN-598"
   * @param {string} entry.canonicalId    - provider canonical id (UUID)
   * @param {string} entry.inputHash      - hashContext digest already computed at the seam
   * @param {TaskSnapshot} entry.snapshot - snapshotFromContext(context)
   * @returns {Promise<Object|null>} the new record, or null when skipped/unchanged.
   */
  async captureIfChanged({ urlKey, taskIdentifier, canonicalId, inputHash, snapshot } = {}) {
    if (!this.collection || !urlKey || !taskIdentifier || !inputHash) return null;

    try {
      const latest = (await this._docsFor(urlKey, taskIdentifier))[0];
      if (latest && latest.inputHash === inputHash) return null; // no observed change

      const doc = {
        _id: crypto.randomUUID(),
        urlKey,
        taskIdentifier: clampField(taskIdentifier),
        canonicalId: clampField(canonicalId || taskIdentifier),
        inputHash: String(inputHash),
        capturedAt: new Date(),
        seq: this._seq++,
        snapshot: snapshot || {}
      };

      await this.collection.insertOne(doc);
      await this._pruneToCapacity(urlKey, taskIdentifier);
      return toRecord(doc);
    } catch (err) {
      console.error('Error capturing task snapshot:', err);
      return null;
    }
  }

  /**
   * List snapshots for a task, newest-first. Accepts either the human identifier
   * or the canonical id (so a caller need not know which was stored).
   *
   * @param {string} urlKey
   * @param {string} taskIdentifier
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<{items: Object[], total: number}>}
   */
  async list(urlKey, taskIdentifier, { limit } = {}) {
    if (!this.collection || !urlKey || !taskIdentifier) return { items: [], total: 0 };
    try {
      const docs = await this._docsFor(urlKey, taskIdentifier);
      const total = docs.length;
      const sliced = limit ? docs.slice(0, limit) : docs;
      return { items: sliced.map(toRecord), total };
    } catch (err) {
      console.error('Error listing task snapshots:', err);
      return { items: [], total: 0 };
    }
  }

  /** Newest snapshot for a task, or null. @returns {Promise<Object|null>} */
  async latest(urlKey, taskIdentifier) {
    if (!this.collection || !urlKey || !taskIdentifier) return null;
    try {
      return toRecord((await this._docsFor(urlKey, taskIdentifier))[0]);
    } catch (err) {
      console.error('Error reading latest task snapshot:', err);
      return null;
    }
  }

  /**
   * Diff the two most recent snapshots for a task (read-time compare). Returns
   * the diff plus the two records it was computed from. `changed: false` with a
   * single (or zero) snapshot means there is nothing to compare yet.
   *
   * @returns {Promise<{changed: boolean, fields: Array, from: Object|null, to: Object|null}>}
   */
  async diffLatest(urlKey, taskIdentifier) {
    const { items } = await this.list(urlKey, taskIdentifier, { limit: 2 });
    const to = items[0] || null;
    const from = items[1] || null;
    // Need two snapshots to have something to compare; one (or none) is "no change yet".
    if (!from || !to) return { changed: false, fields: [], from, to };
    const diff = diffSnapshots(from.snapshot, to.snapshot);
    return { ...diff, from, to };
  }

  /**
   * List ALL snapshots across a workspace whose `capturedAt` is at or after
   * `since` — a workspace-wide window scan, not a per-task read (LIN-1197). This
   * is the feedstock seam for The Ship's Biscuit: it needs "which tasks moved in
   * this window" without knowing the task ids up front, so deriving ids from
   * session/loop/agent-status metadata (which only sees runtime activity) is the
   * wrong path — the window scan surfaces every captured task change directly.
   *
   * Mirrors the single-task reads' collection + query idiom (`{ urlKey, capturedAt:
   * { $gte: since } }`, then a JS sort) and the agent-status log's `{ since }`
   * window contract. Additive: touches no other method.
   *
   * Returns newest-first (capturedAt primary, the monotonic `seq` as a same-ms
   * tie-break) to match every other read in this store; `{ items, total }` mirrors
   * `list()`. `since` is optional — omitting it returns the whole workspace.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {Date} [options.since] - Lower bound (inclusive) on `capturedAt`.
   * @returns {Promise<{items: Object[], total: number}>}
   */
  async listByWorkspace(urlKey, { since } = {}) {
    if (!this.collection || !urlKey) return { items: [], total: 0 };
    try {
      const query = { urlKey };
      if (since) query.capturedAt = { $gte: since };
      const docs = await this.collection.find(query).toArray();
      // Newest-first: capturedAt primary, seq to break same-ms ties (as _docsFor).
      docs.sort((a, b) => (toMillis(b.capturedAt) - toMillis(a.capturedAt)) || ((b.seq || 0) - (a.seq || 0)));
      return { items: docs.map(toRecord), total: docs.length };
    } catch (err) {
      console.error('Error listing task snapshots by workspace:', err);
      return { items: [], total: 0 };
    }
  }

  /** Remove all snapshots for a workspace (used in tests). @returns {Promise<number>} */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing task snapshots:', err);
      return 0;
    }
  }

  /**
   * Docs for a task, newest-first. Matches by taskIdentifier first (the stored
   * key); falls back to canonicalId so a UUID-shaped lookup still resolves.
   */
  async _docsFor(urlKey, taskIdentifier) {
    let docs = await this.collection.find({ urlKey, taskIdentifier }).toArray();
    if (!docs.length) {
      docs = await this.collection.find({ urlKey, canonicalId: taskIdentifier }).toArray();
    }
    // Newest-first: capturedAt primary, then the monotonic seq to break same-ms ties.
    docs.sort((a, b) => (toMillis(b.capturedAt) - toMillis(a.capturedAt)) || ((b.seq || 0) - (a.seq || 0)));
    return docs;
  }

  /** Delete anything beyond the newest `maxPerTask` snapshots for a task. */
  async _pruneToCapacity(urlKey, taskIdentifier) {
    try {
      const docs = await this._docsFor(urlKey, taskIdentifier);
      for (const doc of docs.slice(this.maxPerTask)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey });
      }
    } catch (err) {
      console.error('Error pruning task snapshots:', err);
    }
  }
}
