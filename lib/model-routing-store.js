/**
 * The model-routing store (LIN-3853, step 2 of LIN-3820): the one place a job's harness,
 * model and effort live, per workspace, with the log of every change and the table
 * presets. The pure part (shape, migration, resolution, diff) is lib/model-routing.js.
 *
 * Three collections, one class:
 * - `model-routing`: one doc per workspace, `_id` = urlKey. The table plus `version`.
 *   Read and written by `_id` only, and NEVER cached in-process: the e2e reset route and
 *   a second instance must be seen by the very next resolve.
 * - `model-routing-log`: one doc per change, ordered by `seq` (the table's `version` after
 *   the change), not by `at` (the seeded entry carries a backdated time).
 * - `model-routing-presets`: named snapshots of the whole table.
 *
 * Every write takes a reason (required, at most 500 characters) and an actor, and appends
 * exactly one log entry. Undo is a new entry that restores the earlier value, and refuses
 * if a later edit has changed any of the fields since (it never overwrites silently).
 *
 * No person's name is stored. `actor.id` is an account id (page) or the token's
 * attribution (proxy); the display name is resolved at READ time, and an id that is the
 * erased id, or no longer resolves, reads as "former member". Account erasure rewrites
 * ids only, so a stored name would outlive a Full wipe in a shared workspace.
 *
 * Write protocol: MangoDB has no transactions. Read the doc, compute, `updateOne` filtered
 * on the `version` read and retry from the read when nothing matched (three tries, then
 * CONFLICT), then insert the log entry with `seq = version + 1`. A log insert that fails
 * after the table write is retried and, finally, throws LOG_WRITE_FAILED (never silent);
 * `getLog` flags the seq gap. That window is an accepted limitation.
 */
import { randomUUID } from 'node:crypto';
import {
  RoutingError, MAX_REASON_LENGTH, SEEDED_ENTRY, emptyTable, tableFromPreferences, effectiveTable,
  applyChangesToTable, diffTables, currentValue, snapshotOf, tableFromSnapshot, projectLegacy,
  harbourModelTable, dispatchDefaultsTable, aiOverridesTable
} from './model-routing.js';
import { getJob } from './llm-jobs.js';

export { RoutingError };

const PRESET_LIMIT = 20;
const CAS_TRIES = 3;
const LOG_TRIES = 3;
const VIAS = ['page', 'proxy', 'migration'];
const FORMER_MEMBER = 'former member';

const isDuplicateKey = (err) => err?.code === 11000;

/** The table out of a stored doc (the doc also carries `_id`, `migratedAt`, `updatedAt`). */
function toTable(doc) {
  const base = emptyTable();
  return {
    version: doc.version ?? 0,
    jobs: doc.jobs || {},
    groups: { ...base.groups, ...(doc.groups || {}) },
    defaults: { ...base.defaults, ...(doc.defaults || {}) }
  };
}

export class ModelRoutingStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - `model-routing`
   * @param {Object} options.logCollection - `model-routing-log`
   * @param {Object} options.presetsCollection - `model-routing-presets`
   * @param {(urlKey: string) => Promise<Object>} options.getPreferences - the old preference
   *   fields, read once per workspace by the lazy migration
   * @param {(id: string) => Promise<string|null>} [options.resolveActorName] - read-time name lookup
   * @param {string} [options.erasedAccountId] - the id account erasure writes over a person. Defaults to
   *   ERASED_ACCOUNT_ID's value; lib/account-erasure.js is operator-script-only and server code must not
   *   import it (a test pins that the default equals the constant).
   * @param {Object} [options.seededEntry] - see SEEDED_ENTRY; tests inject fixture values
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.logCollection = options.logCollection;
    this.presetsCollection = options.presetsCollection;
    this.getPreferences = options.getPreferences || (async () => ({}));
    this.resolveActorName = options.resolveActorName || (async () => null);
    this.erasedAccountId = options.erasedAccountId ?? 'erased';
    this.seededEntry = options.seededEntry || SEEDED_ENTRY;
  }

  // ---- reads ---------------------------------------------------------------

  /** The workspace's table, migrating it from the old preference fields on first access. */
  async getTable(urlKey) {
    const doc = await this.collection.findOne({ _id: urlKey });
    if (doc) return toTable(doc);
    return this.ensureMigrated(urlKey);
  }

  /**
   * Lazy and idempotent: insert the doc with `_id: urlKey`; a duplicate-key loser re-reads.
   * The old preference fields are left in place and unread, for rollback.
   */
  async ensureMigrated(urlKey, { seededEntry = this.seededEntry } = {}) {
    const existing = await this.collection.findOne({ _id: urlKey });
    if (existing) return toTable(existing);

    const table = tableFromPreferences(await this.getPreferences(urlKey));
    // Gated on the workspace AND the value: see SEEDED_ENTRY. Fails closed when unset.
    const seed = Boolean(seededEntry?.urlKey && seededEntry.urlKey === urlKey && seededEntry.to
      && table.jobs.autopilot?.model === seededEntry.to);
    table.version = seed ? 1 : 0;
    // Log first: a crash between the two leaves an entry the next attempt finds as a
    // duplicate and skips, whereas the reverse order would lose entry 1 for good.
    if (seed) {
      try {
        await this.logCollection.insertOne({
          _id: randomUUID(),
          urlKey,
          seq: 1,
          at: new Date(seededEntry.at),
          actor: { via: 'migration', label: seededEntry.label },
          kind: 'migration',
          reason: seededEntry.reason,
          changes: [{ scope: 'job', surface: 'agent-session', key: 'autopilot', field: 'model', from: seededEntry.from, to: seededEntry.to }]
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }
    }
    try {
      await this.collection.insertOne({ _id: urlKey, ...table, migratedAt: new Date() });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return toTable(await this.collection.findOne({ _id: urlKey }));
    }
    return table;
  }

  /** The one read: each job's effective setting and where each field came from. */
  async getEffectiveTable(urlKey, { defaultModel }) {
    return effectiveTable(await this.getTable(urlKey), { defaultModel });
  }

  /** The table in the old preference shape, for the Settings sections that still render it. */
  async getLegacyView(urlKey) {
    return projectLegacy(await this.getTable(urlKey));
  }

  /** Newest first, with the actor's display name resolved now. A `gap` marks a missing seq. */
  async getLog(urlKey, { limit = 100 } = {}) {
    const rows = await this.logCollection.find({ urlKey }).sort({ seq: -1 }).limit(limit).toArray();
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const next = rows[i + 1];
      out.push({ ...row, actor: { ...row.actor, name: await this._actorName(row.actor) }, gap: next ? row.seq - next.seq > 1 : row.seq > 1 && rows.length < limit });
    }
    return out;
  }

  async _actorName(actor = {}) {
    if (actor.via === 'migration') return actor.label || null;
    if (!actor.id || actor.id === this.erasedAccountId) return actor.via === 'proxy' && actor.label ? actor.label : FORMER_MEMBER;
    const name = await this.resolveActorName(actor.id);
    if (name) return name;
    return actor.via === 'proxy' ? (actor.label || actor.id) : FORMER_MEMBER;
  }

  async listPresets(urlKey) {
    return this.presetsCollection.find({ urlKey }).toArray();
  }

  // ---- writes --------------------------------------------------------------

  /** Set or clear fields on one job. `patch` is `{ harness?, model?, effort? }`; null clears. */
  changeJob(jobId, patch, ctx) {
    const job = getJob(jobId);
    if (!job) return this._refuse(ctx, 'INVALID', `no job "${jobId}"`);
    return this._commit(ctx, 'change', (table) => applyChangesToTable(table, this._patchChanges('job', job.surface, jobId, patch)));
  }

  /** Set or clear fields on one group's default. */
  changeGroup(surface, group, patch, ctx) {
    return this._commit(ctx, 'change', (table) => applyChangesToTable(table, this._patchChanges('group', surface, group, patch)));
  }

  /** Set or clear the workspace-wide value the old forms and job-less callers read. */
  changeDefault(surface, patch, ctx) {
    return this._commit(ctx, 'change', (table) => applyChangesToTable(table, this._patchChanges('default', surface, 'default', patch)));
  }

  /** Several changes as one logged change. Each is `{ scope, surface, key, field, to }`. */
  applyChanges(changes, ctx) {
    return this._commit(ctx, 'change', (table) => applyChangesToTable(table, changes));
  }

  /**
   * Replace the table with a transform's result, as one logged change. This is what the old
   * forms use: the pure builders in model-routing.js compute the whole new table.
   */
  applyTable(transform, ctx, kind = 'change') {
    return this._commit(ctx, kind, transform);
  }

  /** The three old Settings forms, through the table (each is exactly one log entry). */
  saveHarbourModel(modelId, ctx) {
    return this._commit(ctx, 'legacy-form', (table) => harbourModelTable(table, modelId));
  }

  saveDispatchDefaults(top, byKind, ctx) {
    return this._commit(ctx, 'legacy-form', (table) => dispatchDefaultsTable(table, top, byKind));
  }

  saveAiOverrides(byKind, ctx) {
    return this._commit(ctx, 'legacy-form', (table) => aiOverridesTable(table, byKind));
  }

  /** Save the current table as a named preset. One log entry; the table does not change. */
  async savePreset(name, ctx) {
    this._checkContext(ctx);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 80) throw new RoutingError('INVALID', 'a preset needs a name of 1 to 80 characters');
    if (await this.presetsCollection.countDocuments({ urlKey: ctx.urlKey }) >= PRESET_LIMIT) {
      throw new RoutingError('PRESET_LIMIT', `a workspace keeps at most ${PRESET_LIMIT} presets`);
    }
    const table = await this.getTable(ctx.urlKey);
    const preset = { _id: randomUUID(), urlKey: ctx.urlKey, name: trimmed, snapshot: snapshotOf(table), createdAt: new Date(), createdBy: ctx.actor.id ?? null };
    await this.presetsCollection.insertOne(preset);
    try {
      const entry = await this._commit(ctx, 'preset-save', (t) => t, { presetId: preset._id });
      return { preset, entry };
    } catch (err) {
      await this.presetsCollection.deleteOne({ _id: preset._id });
      throw err;
    }
  }

  /** Make the table equal a preset's snapshot, as one logged change (also when nothing differs). */
  async applyPreset(presetId, ctx) {
    this._checkContext(ctx);
    const preset = await this.presetsCollection.findOne({ _id: presetId, urlKey: ctx.urlKey });
    if (!preset) throw new RoutingError('NOT_FOUND', 'no such preset');
    return this._commit(ctx, 'preset-apply', (table) => tableFromSnapshot(table.version, preset.snapshot), { presetId });
  }

  /**
   * Undo an entry with a new entry that sets each change back to its `from`. Refused with
   * CONFLICT (and the fields) when any current value differs from the entry's `to`.
   */
  async undo(entryId, ctx) {
    this._checkContext(ctx);
    const entry = await this.logCollection.findOne({ _id: entryId, urlKey: ctx.urlKey });
    if (!entry) throw new RoutingError('NOT_FOUND', 'no such log entry');
    if (entry.kind === 'preset-save' || !entry.changes?.length) throw new RoutingError('NOT_UNDOABLE', 'this entry changed nothing to restore');
    return this._commit(ctx, 'undo', (table) => {
      const conflicts = entry.changes
        .filter((c) => currentValue(table, c) !== c.to)
        .map((c) => ({ scope: c.scope, surface: c.surface, key: c.key, field: c.field, expected: c.to, current: currentValue(table, c) }));
      if (conflicts.length) throw new RoutingError('CONFLICT', 'a later change touched these fields; undo would overwrite it', { conflicts });
      return applyChangesToTable(table, entry.changes.map((c) => ({ ...c, from: c.to, to: c.from })));
    }, { undoes: entryId });
  }

  /** Remove a workspace's table, log and presets. The e2e reset route only; erasure goes through the inventory. */
  async deleteWorkspace(urlKey) {
    await this.collection.deleteOne({ _id: urlKey });
    await this.logCollection.deleteMany({ urlKey });
    await this.presetsCollection.deleteMany({ urlKey });
  }

  // ---- internals -----------------------------------------------------------

  _patchChanges(scope, surface, key, patch) {
    if (!patch || typeof patch !== 'object') throw new RoutingError('INVALID', 'a change needs fields to set');
    return Object.entries(patch).filter(([, v]) => v !== undefined).map(([field, to]) => ({ scope, surface, key, field, to }));
  }

  _checkContext(ctx) {
    const reason = typeof ctx?.reason === 'string' ? ctx.reason.trim() : '';
    if (!reason) throw new RoutingError('REASON_REQUIRED', 'a change needs a reason');
    if (reason.length > MAX_REASON_LENGTH) throw new RoutingError('REASON_REQUIRED', `a reason is at most ${MAX_REASON_LENGTH} characters`);
    if (!ctx.urlKey) throw new RoutingError('INVALID', 'a change needs a workspace');
    if (!ctx.actor || !VIAS.includes(ctx.actor.via)) throw new RoutingError('INVALID', 'a change needs an actor (page, proxy)');
    return reason;
  }

  async _refuse(ctx, code, message) {
    this._checkContext(ctx);
    throw new RoutingError(code, message);
  }

  async _commit(ctx, kind, transform, extra = {}) {
    const reason = this._checkContext(ctx);
    const { urlKey, actor } = ctx;
    for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
      const table = await this.getTable(urlKey);
      const next = transform(table);
      const changes = diffTables(table, next);
      const version = table.version;
      const res = await this.collection.updateOne(
        { _id: urlKey, version },
        { $set: { jobs: next.jobs, groups: next.groups, defaults: next.defaults, version: version + 1, updatedAt: new Date() } }
      );
      if (!res || res.matchedCount === 0) continue;
      const entry = {
        _id: randomUUID(),
        urlKey,
        seq: version + 1,
        at: new Date(),
        // Ids and labels only, never a name (see the header).
        actor: { via: actor.via, ...(actor.id ? { id: actor.id } : {}), ...(actor.label ? { label: actor.label } : {}) },
        kind,
        reason,
        changes,
        ...extra
      };
      await this._appendLog(entry);
      return entry;
    }
    throw new RoutingError('CONFLICT', 'the routing table kept changing; try again');
  }

  async _appendLog(entry) {
    let last;
    for (let i = 0; i < LOG_TRIES; i++) {
      try {
        await this.logCollection.insertOne(entry);
        return;
      } catch (err) {
        last = err;
      }
    }
    console.error('model-routing: the table changed but its log entry could not be written', last);
    throw new RoutingError('LOG_WRITE_FAILED', `the change was saved but its log entry (seq ${entry.seq}) was not`);
  }
}
