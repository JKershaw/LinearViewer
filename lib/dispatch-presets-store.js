/**
 * Dispatch presets store (LIN-1390 S1).
 *
 * Persists named, workspace-scoped, reusable dispatch routing configs — a
 * dispatch preset is shaped exactly like the existing workspace
 * `dispatchDefaults` (top-level `model`/`harness` plus optional `byKind`
 * overrides; see lib/workspace-preferences.js), so the same pure
 * `resolveRoutingFromConfig(config, kind)` resolver applies to either. This
 * store is storage/CRUD only — it does not resolve routing or know about
 * dispatch items; lib/dispatch-factory.js is the consumer that applies a
 * selected preset's `config` at dispatch time.
 *
 * Modelled directly on lib/collective-presets-store.js (Mongo/Mango
 * collection, `crypto.randomUUID()` `_id`, per-`urlKey` partition, `seq`
 * same-ms tiebreaker, a MAX_CUSTOM_PRESETS cap that throws on overflow), with
 * two deliberate deltas:
 *   - NO `builtin:*` half — there are no default dispatch presets in scope,
 *     so `list`/`get`/`delete` only ever see custom rows.
 *   - ADD `update` — dispatch presets must be editable in place (the
 *     collective preset store's presets are not), following the same
 *     validate -> point-write-by-`{_id,urlKey}` -> return-record shape as
 *     `createCustom`.
 *
 * Snapshot semantics live in the CONSUMER (dispatch-factory.js), not here:
 * this store's `config` is the live, editable value — a dispatch item stamps
 * a deep COPY of it at dispatch time, so updating or deleting a preset here
 * never reaches an already-dispatched item.
 *
 * Schema (one document per preset):
 * {
 *   _id:       string,   // UUID
 *   urlKey:    string,   // partition = the workspace the preset belongs to
 *   name:      string,   // display label (<= MAX_PRESET_NAME_LENGTH)
 *   config:    Object,   // { model?, harness?, byKind?: { [kind]: { model?, harness? } } }
 *   createdAt: string,   // ISO
 *   updatedAt: string,   // ISO
 *   seq:       number    // per-process monotonic tiebreaker for same-ms sorts
 * }
 */

import crypto from 'crypto';

const MAX_CUSTOM_PRESETS = 20;   // mirrors collective-presets' MAX_CUSTOM_PRESETS
const MAX_PRESET_NAME_LENGTH = 50;

function toRecord(doc) {
  if (!doc) return null;
  const { _id, urlKey: _uk, seq: _seq, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * Validates a preset's `name` + `config`. `config` is optional (defaults to
 * `{}` — whether an empty config is meaningful is left to the caller/
 * resolver, not this store); when present it must be a plain object whose
 * `model`/`harness`/`effort` (if present) are strings and whose `byKind` (if
 * present) is a plain object. Mirrors the shape `resolveRoutingFromConfig`
 * expects.
 *
 * @param {Object} data - { name, config }
 * @returns {{name: string, config: Object}} the normalized, validated fields
 * @throws {Error} on validation failure
 */
function validatePresetInput({ name, config } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) throw new Error('Name is required');
  if (trimmedName.length > MAX_PRESET_NAME_LENGTH) {
    throw new Error(`Name must be ${MAX_PRESET_NAME_LENGTH} characters or less`);
  }

  const normalizedConfig = config === undefined || config === null ? {} : config;
  if (typeof normalizedConfig !== 'object' || Array.isArray(normalizedConfig)) {
    throw new Error('config must be an object');
  }
  if (normalizedConfig.model !== undefined && typeof normalizedConfig.model !== 'string') {
    throw new Error('config.model must be a string');
  }
  if (normalizedConfig.harness !== undefined && typeof normalizedConfig.harness !== 'string') {
    throw new Error('config.harness must be a string');
  }
  if (normalizedConfig.effort !== undefined && typeof normalizedConfig.effort !== 'string') {
    throw new Error('config.effort must be a string');
  }
  if (
    normalizedConfig.byKind !== undefined &&
    (typeof normalizedConfig.byKind !== 'object' || Array.isArray(normalizedConfig.byKind) || normalizedConfig.byKind === null)
  ) {
    throw new Error('config.byKind must be an object');
  }

  return { name: trimmedName, config: normalizedConfig };
}

/**
 * MongoDB/MangoDB-backed store for dispatch presets, partitioned by workspace
 * `urlKey`. There are no built-in presets — every row is a user-saved custom
 * preset.
 */
export class DispatchPresetsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxCustom=20] - Cap on saved presets per workspace.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxCustom = options.maxCustom || MAX_CUSTOM_PRESETS;
    // SECONDARY sort key only: breaks ties when two records share the same
    // createdAt millisecond. createdAt stays primary, so ordering survives a
    // restart (where the counter resets to 0).
    this._seq = 0;
  }

  /**
   * List every preset for a workspace.
   * @param {string} urlKey - Workspace URL key (partition).
   * @returns {Promise<Array>}
   */
  async list(urlKey) {
    if (!urlKey) return [];
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing dispatch presets:', err);
      return [];
    }
  }

  /**
   * Get a single preset by id.
   * @param {string} urlKey
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async get(urlKey, id) {
    if (!urlKey || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting dispatch preset:', err);
      return null;
    }
  }

  /**
   * Save a new custom preset. Validates `name`/`config` via
   * `validatePresetInput`. Caps at `maxCustom` (throws on overflow, mirroring
   * custom-prompts/collective-presets).
   *
   * @param {string} urlKey - Workspace URL key (partition).
   * @param {Object} data - { name, config }
   * @returns {Promise<Object>} the created record
   * @throws {Error} on validation failure or when the custom cap is reached
   */
  async createCustom(urlKey, data = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    const { name, config } = validatePresetInput(data);

    const existing = await this.collection.find({ urlKey }).toArray();
    if (existing.length >= this.maxCustom) {
      throw new Error(`You have reached the maximum of ${this.maxCustom} saved presets`);
    }

    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      name,
      config,
      createdAt: now,
      updatedAt: now,
      seq: this._seq++,
    };
    await this.collection.insertOne(doc);
    return toRecord(doc);
  }

  /**
   * Update an existing preset in place: validate -> point-write by
   * `{_id, urlKey}` -> return the updated record. `data` fields are optional;
   * an omitted field leaves the stored value unchanged (`name`/`config` are
   * independently updatable). Returns `null` when the preset doesn't exist
   * for this workspace.
   *
   * @param {string} urlKey - Workspace URL key (partition).
   * @param {string} id - Preset id.
   * @param {Object} data - { name?, config? }
   * @returns {Promise<Object|null>} the updated record, or null if not found
   * @throws {Error} on validation failure
   */
  async update(urlKey, id, data = {}) {
    if (!urlKey || !id) return null;

    const existing = await this.get(urlKey, id);
    if (!existing) return null;

    const { name, config } = validatePresetInput({
      name: data.name !== undefined ? data.name : existing.name,
      config: data.config !== undefined ? data.config : existing.config,
    });

    await this.collection.updateOne(
      { _id: id, urlKey },
      { $set: { name, config, updatedAt: new Date().toISOString() } }
    );

    return this.get(urlKey, id);
  }

  /**
   * Delete a preset by id.
   * @returns {Promise<boolean>}
   */
  async delete(urlKey, id) {
    if (!urlKey || !id) return false;
    try {
      const result = await this.collection.deleteOne({ _id: id, urlKey });
      return (result.deletedCount || 0) > 0;
    } catch (err) {
      console.error('Error deleting dispatch preset:', err);
      return false;
    }
  }

  /**
   * Delete every preset for a workspace. Used in tests.
   * @returns {Promise<boolean>}
   */
  async deleteAll(urlKey) {
    if (!urlKey) return false;
    try {
      await this.collection.deleteMany({ urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting all dispatch presets:', err);
      return false;
    }
  }
}
