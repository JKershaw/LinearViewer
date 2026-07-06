/**
 * Custom Collective preset store (LIN-1050, S4).
 *
 * Persists user-saved preset meetings — named, repo-agnostic rosters (<=4
 * seats, exactly one facilitator) + meeting metadata (`objective`,
 * `exitCondition`, `defaultTopic`) that expand into the S1-S3 fan-out at
 * launch time (a later beat).
 *
 * Modelled closely on lib/collective-characters-store.js (Mongo/Mango
 * collection, `crypto.randomUUID()` `_id`, per-anchor-`urlKey` partition,
 * `seq` same-ms tiebreaker, a MAX_CUSTOM_PRESETS cap that throws on
 * overflow) but WITHOUT the character store's `recent`/auto-recording half —
 * a preset is a deliberate saved artifact, never auto-recorded per dispatch.
 *
 * Built-in presets (lib/collective-preset-defs.js) are frozen constants, not
 * rows in this collection. `list()` merges `[...BUILTIN_PRESETS, ...custom]`;
 * `get()` resolves a `builtin:*` id to the constant, else point-reads the
 * partition; `delete()` no-ops (returns false) on a `builtin:*` id — built-ins
 * are neither editable nor deletable.
 *
 * Schema (one document per custom preset):
 * {
 *   _id:           string,   // UUID
 *   urlKey:        string,   // partition = the anchor workspace the picker lives under
 *   name:          string,   // display label (<= MAX_PRESET_NAME_LENGTH)
 *   objective:     string,   // meeting objective
 *   exitCondition: string,   // concrete, checkable exit condition
 *   defaultTopic:  string,
 *   roster:        Array,    // 1..MAX_PRESET_SEATS seats; exactly one isFacilitator; repo-agnostic
 *   kind:          'custom',
 *   createdAt:     string,   // ISO
 *   updatedAt:     string,   // ISO
 *   seq:           number    // per-process monotonic tiebreaker for same-ms sorts
 * }
 */

import crypto from 'crypto';
import { BUILTIN_PRESETS, validatePreset } from './collective-preset-defs.js';

const MAX_CUSTOM_PRESETS = 20;   // mirrors collective-characters' MAX_CUSTOM_CHARACTERS
const MAX_PRESET_NAME_LENGTH = 50;

function toRecord(doc) {
  if (!doc) return null;
  const { _id, urlKey: _uk, seq: _seq, ...rest } = doc;
  return { id: _id, ...rest };
}

function isBuiltinId(id) {
  return typeof id === 'string' && id.startsWith('builtin:');
}

/**
 * MongoDB/MangoDB-backed store for custom Collective presets, partitioned by
 * the anchor workspace `urlKey`. Built-in presets are served from the frozen
 * BUILTIN_PRESETS constants, not this collection.
 */
export class CollectivePresetsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxCustom=20] - Cap on saved custom presets.
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
   * List every preset (built-in + custom) for a workspace.
   * @param {string} urlKey - Anchor workspace URL key (partition).
   * @returns {Promise<Array>}
   */
  async list(urlKey) {
    if (!urlKey) return [...BUILTIN_PRESETS];
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return [...BUILTIN_PRESETS, ...docs.map(toRecord)];
    } catch (err) {
      console.error('Error listing collective presets:', err);
      return [...BUILTIN_PRESETS];
    }
  }

  /**
   * Get a single preset by id — resolves a `builtin:*` slug to its frozen
   * constant, else point-reads the custom partition.
   * @param {string} urlKey
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async get(urlKey, id) {
    if (!id) return null;
    if (isBuiltinId(id)) {
      return BUILTIN_PRESETS.find(p => p.id === id) || null;
    }
    if (!urlKey) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting collective preset:', err);
      return null;
    }
  }

  /**
   * Save a custom preset. Validates the full bundle (name/objective/
   * exitCondition/defaultTopic non-empty, roster 1..4 seats with exactly one
   * facilitator, seats repo-agnostic) via the shared `validatePreset` — the
   * same invariant check the built-ins assert against themselves. Caps at
   * maxCustom (throws on overflow, mirroring custom-prompts/characters).
   *
   * @param {string} urlKey - Anchor workspace URL key (partition).
   * @param {Object} data - { name, objective, exitCondition, defaultTopic, roster }
   * @returns {Promise<Object>} the created record
   * @throws {Error} on validation failure or when the custom cap is reached
   */
  async createCustom(urlKey, data = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name.length > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`Name must be ${MAX_PRESET_NAME_LENGTH} characters or less`);
    }
    validatePreset({ ...data, name });

    const existing = await this.collection.find({ urlKey }).toArray();
    if (existing.length >= this.maxCustom) {
      throw new Error(`You have reached the maximum of ${this.maxCustom} saved presets`);
    }

    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      name,
      objective: data.objective.trim(),
      exitCondition: data.exitCondition.trim(),
      defaultTopic: data.defaultTopic.trim(),
      roster: data.roster,
      kind: 'custom',
      createdAt: now,
      updatedAt: now,
      seq: this._seq++,
    };
    await this.collection.insertOne(doc);
    return toRecord(doc);
  }

  /**
   * Delete a custom preset by id. No-ops (returns false) on a `builtin:*` id
   * — built-ins are neither editable nor deletable.
   * @returns {Promise<boolean>}
   */
  async delete(urlKey, id) {
    if (!urlKey || !id) return false;
    if (isBuiltinId(id)) return false;
    try {
      const result = await this.collection.deleteOne({ _id: id, urlKey });
      return (result.deletedCount || 0) > 0;
    } catch (err) {
      console.error('Error deleting collective preset:', err);
      return false;
    }
  }

  /**
   * Delete every custom preset for a workspace. Used in tests. Never
   * touches BUILTIN_PRESETS (they are not rows in this collection).
   * @returns {Promise<boolean>}
   */
  async deleteAll(urlKey) {
    if (!urlKey) return false;
    try {
      await this.collection.deleteMany({ urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting all collective presets:', err);
      return false;
    }
  }
}
