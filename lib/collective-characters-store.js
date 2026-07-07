/**
 * Collective characters store (LIN-1048).
 *
 * Persists the personas ("characters") a user chooses for the experimental
 * Collective discussion (routes/collective.js). It is the single source of
 * character data for the picker — there is no second representation; the
 * `character` param of `buildCollectiveParticipantPrompt` is its only consumer.
 *
 * Modelled directly on lib/custom-prompts-store.js (Mongo/Mango collection,
 * `crypto.randomUUID()` `_id`, per-`urlKey` partition, count cap that throws on
 * overflow) with one identity dimension the mirror doesn't have: a character
 * carries its own repo binding (`workspaceUrlKey`) that may point at a DIFFERENT
 * connected workspace than the anchor `urlKey` it is partitioned under. The
 * binding is re-validated against `session.workspaces` at dispatch time
 * (routes/collective.js `/start`), not here.
 *
 * Two kinds share the collection, distinguished by `kind`:
 *   - `custom` — explicitly saved by the user. Capped at MAX_CUSTOM_CHARACTERS
 *     (throws on overflow, mirroring custom-prompts' MAX_CUSTOM_PROMPTS).
 *   - `recent` — auto-recorded on each successful `/start` dispatch. A small
 *     rolling window (MAX_RECENT_CHARACTERS); inserting past the window evicts
 *     the oldest. `recordRecent` NEVER throws — a failure to remember a recent
 *     must never break a dispatch.
 *
 * Identity is the repo binding plus the five persona fields. Saving a `recent`
 * whose identity already exists flips that record's `kind` to `custom` in place
 * (no double-list); recording a `recent` whose identity already exists (custom
 * or recent) just touches it rather than inserting a duplicate.
 *
 * NO proxy token is stored — grounding is the `workspaceUrlKey` binding; the
 * readWrite token stays minted best-effort per fan-out. Storing a standing token
 * would be new security debt (see the research write-up on LIN-1048).
 *
 * Schema (one document per character):
 * {
 *   _id:             string,   // UUID
 *   urlKey:          string,   // partition = the anchor workspace the picker lives under
 *   workspaceUrlKey: string,   // the connected workspace/repo this character speaks for
 *   workspaceName:   string,   // cached for display; re-validated vs session.workspaces at dispatch
 *   role, lens, objective, value, disposition, // the FIVE CHARACTER_FIELDS
 *   kind:            'custom' | 'recent',
 *   name:            string,   // display label (<= MAX_NAME_LENGTH)
 *   createdAt:       string,   // ISO
 *   updatedAt:       string,   // ISO
 *   seq:             number    // per-process monotonic tiebreaker for same-ms sorts
 * }
 */

import crypto from 'crypto';
import { CHARACTER_FIELDS } from './prompts/collective-participant.js';

const MAX_CUSTOM_CHARACTERS = 20;   // mirrors custom-prompts' MAX_CUSTOM_PROMPTS
const MAX_RECENT_CHARACTERS = 10;   // rolling window for auto-recorded recents
const MAX_NAME_LENGTH = 50;         // mirrors custom-prompts' MAX_PROMPT_NAME_LENGTH

/** Trim + coerce the five persona fields off arbitrary input (missing → ''). */
function pickPersona(data = {}) {
  const out = {};
  for (const f of CHARACTER_FIELDS) {
    out[f] = typeof data[f] === 'string' ? data[f].trim() : '';
  }
  return out;
}

/** Identity = repo binding + the five persona fields. */
function sameIdentity(doc, ref) {
  if (doc.workspaceUrlKey !== ref.workspaceUrlKey) return false;
  return CHARACTER_FIELDS.every(f => (doc[f] || '') === (ref[f] || ''));
}

function toMillis(value) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function toRecord(doc) {
  if (!doc) return null;
  const { _id, urlKey: _uk, seq: _seq, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * MongoDB/MangoDB-backed store for Collective characters, partitioned by the
 * anchor workspace `urlKey`.
 */
export class CollectiveCharactersStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxCustom=20] - Cap on saved `custom` characters.
   * @param {number} [options.maxRecent=10] - Rolling window for `recent` characters.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxCustom = options.maxCustom || MAX_CUSTOM_CHARACTERS;
    this.maxRecent = options.maxRecent || MAX_RECENT_CHARACTERS;
    // SECONDARY sort key only: breaks ties when two records share the same
    // createdAt millisecond. createdAt stays primary, so ordering survives a
    // restart (where the counter resets to 0).
    this._seq = 0;
  }

  /**
   * List every character (custom + recent) for a workspace.
   * @param {string} urlKey - Anchor workspace URL key (partition).
   * @returns {Promise<Array>}
   */
  async list(urlKey) {
    if (!urlKey) return [];
    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing collective characters:', err);
      return [];
    }
  }

  /**
   * Get a single character by id.
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
      console.error('Error getting collective character:', err);
      return null;
    }
  }

  /**
   * Explicitly save a `custom` character. Caps at maxCustom (throws on overflow,
   * mirroring custom-prompts). If a record with the same identity already exists
   * (a `recent` the user is now saving, or an existing `custom`), it is promoted
   * to `custom` in place instead of double-listing.
   *
   * @param {string} urlKey - Anchor workspace URL key (partition).
   * @param {Object} data - { workspaceUrlKey, workspaceName?, name?, role, lens, objective, value, disposition }
   * @returns {Promise<Object>} the created (or promoted) record
   * @throws {Error} on validation failure or when the custom cap is reached
   */
  async createCustom(urlKey, data = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!data.workspaceUrlKey || typeof data.workspaceUrlKey !== 'string') {
      throw new Error('workspaceUrlKey is required');
    }
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Name must be ${MAX_NAME_LENGTH} characters or less`);
    }
    const persona = pickPersona(data);
    const ref = { workspaceUrlKey: data.workspaceUrlKey, ...persona };

    const existing = await this.collection.find({ urlKey }).toArray();

    // Promote a matching record (recent → custom, or re-save a custom) in place.
    const twin = existing.find(d => sameIdentity(d, ref));
    if (twin) {
      const updates = { kind: 'custom', updatedAt: new Date().toISOString() };
      if (name) updates.name = name;
      if (data.workspaceName) updates.workspaceName = data.workspaceName;
      await this.collection.updateOne({ _id: twin._id, urlKey }, { $set: updates });
      return this.get(urlKey, twin._id);
    }

    const customCount = existing.filter(d => d.kind === 'custom').length;
    if (customCount >= this.maxCustom) {
      throw new Error(`You have reached the maximum of ${this.maxCustom} saved characters`);
    }

    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      workspaceUrlKey: data.workspaceUrlKey,
      workspaceName: data.workspaceName || '',
      ...persona,
      kind: 'custom',
      name,
      createdAt: now,
      updatedAt: now,
      seq: this._seq++,
    };
    await this.collection.insertOne(doc);
    return toRecord(doc);
  }

  /**
   * Auto-record a dispatched character in the rolling `recent` window. NEVER
   * throws — a failure to remember a recent must not break a dispatch. If a
   * record with the same identity already exists (custom or recent) it is just
   * touched, so a dispatched saved character is not duplicated as a recent.
   * After inserting a new recent, evicts the oldest recents beyond maxRecent.
   *
   * @param {string} urlKey - Anchor workspace URL key (partition).
   * @param {Object} data - same shape as createCustom's data.
   * @returns {Promise<Object|null>}
   */
  async recordRecent(urlKey, data = {}) {
    try {
      if (!urlKey) return null;
      if (!data.workspaceUrlKey || typeof data.workspaceUrlKey !== 'string') return null;
      const persona = pickPersona(data);
      const ref = { workspaceUrlKey: data.workspaceUrlKey, ...persona };

      const existing = await this.collection.find({ urlKey }).toArray();
      const twin = existing.find(d => sameIdentity(d, ref));
      if (twin) {
        await this.collection.updateOne(
          { _id: twin._id, urlKey },
          { $set: { updatedAt: new Date().toISOString() } }
        );
        return this.get(urlKey, twin._id);
      }

      const now = new Date().toISOString();
      const name = typeof data.name === 'string' ? data.name.trim().slice(0, MAX_NAME_LENGTH) : '';
      const doc = {
        _id: crypto.randomUUID(),
        urlKey,
        workspaceUrlKey: data.workspaceUrlKey,
        workspaceName: data.workspaceName || '',
        ...persona,
        kind: 'recent',
        name,
        createdAt: now,
        updatedAt: now,
        seq: this._seq++,
      };
      await this.collection.insertOne(doc);
      await this._evictRecent(urlKey);
      return toRecord(doc);
    } catch (err) {
      console.error('Error recording recent collective character:', err);
      return null;
    }
  }

  /**
   * Delete a character by id.
   * @returns {Promise<boolean>}
   */
  async delete(urlKey, id) {
    if (!urlKey || !id) return false;
    try {
      const result = await this.collection.deleteOne({ _id: id, urlKey });
      return (result.deletedCount || 0) > 0;
    } catch (err) {
      console.error('Error deleting collective character:', err);
      return false;
    }
  }

  /**
   * Delete every character for a workspace. Used in tests.
   * @returns {Promise<boolean>}
   */
  async deleteAll(urlKey) {
    if (!urlKey) return false;
    try {
      await this.collection.deleteMany({ urlKey });
      return true;
    } catch (err) {
      console.error('Error deleting all collective characters:', err);
      return false;
    }
  }

  /** Delete recents beyond the newest maxRecent (createdAt primary, seq to break same-ms ties). */
  async _evictRecent(urlKey) {
    const docs = await this.collection.find({ urlKey }).toArray();
    const recents = docs
      .filter(d => d.kind === 'recent')
      .sort((a, b) => (toMillis(b.createdAt) - toMillis(a.createdAt)) || ((b.seq || 0) - (a.seq || 0)));
    for (const doc of recents.slice(this.maxRecent)) {
      await this.collection.deleteOne({ _id: doc._id, urlKey });
    }
  }
}
