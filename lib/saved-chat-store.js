/**
 * Saved-chat store: durable snapshots of task-chat transcripts (LIN-1008).
 *
 * The experimental task-chat feature (routes/task-chat.js) is fully ephemeral —
 * each turn replays a client-held history array and the server forgets it. This
 * store adds durable, resumable saved chats: a user explicitly saves the current
 * transcript, later lists/views it, and "resumes" by re-hydrating the stored
 * turns into the client and continuing through the SAME replay-each-turn model
 * (there is no live server session to reconnect to — see the ticket grounding).
 *
 * Composition (three existing patterns, no new substrate):
 *   - lib/custom-prompts-store.js — the CRUD lifecycle (create/list/get/delete,
 *     UUID `_id`, per-scope count check).
 *   - lib/task-snapshot-store.js  — durability + count-cap mechanics
 *     (_pruneToCapacity, `seq` same-ms tiebreaker) and NO TTL: saved chats are a
 *     durable user artifact and must not silently expire.
 *   - lib/prompt-trace-store.js   — the privacy posture. A transcript is
 *     content-bearing, so this store is session-auth only: it is NEVER wired into
 *     the proxy/token-auth surface (routes/proxy.js) or /kpis (lib/kpi-stats.js).
 *
 * Identity dimension (the piece none of the siblings had): saved chats are keyed
 * by `{ urlKey, accountId }` and are PRIVATE to that user within the
 * workspace. `taskIdentifier` is metadata, not part of the identity key — a user
 * has many saved chats, spanning many tasks. The caller (routes/task-chat.js)
 * owns the identity gate: `req.session.accountId` is the only accepted
 * identity, and when it is absent saved chats are unavailable (no fallback id).
 *
 * Schema (one document per saved chat):
 * {
 *   _id:            string,   // UUID
 *   urlKey:         string,   // workspace URL key (indexed)
 *   accountId:      string,   // owning user (indexed)
 *   taskIdentifier: string,   // the task the chat was about (metadata)
 *   title:          string,   // auto-derived from the first user turn
 *   transcript:     Array<{role:'user'|'assistant', content:string}>,
 *   createdAt:      string,   // ISO timestamp
 *   updatedAt:      string,   // ISO timestamp
 *   seq:            number    // per-process monotonic tiebreaker for same-ms sorts
 * }
 */

import crypto from 'crypto';
import { filterChatTurns } from './chat-transcript.js';

const MAX_SAVED_CHATS_PER_USER = 50;   // mirrors task-snapshot's MAX_SNAPSHOTS_PER_TASK
const MAX_TRANSCRIPT_TURNS = 200;      // generous vs the client's 40-turn live cap
const MAX_CONTENT_CHARS = 100000;      // per-turn text clamp (matches task-snapshot)
const MAX_TITLE_CHARS = 120;
const MAX_TASK_IDENTIFIER_CHARS = 64;

function clampText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * Sanitize a transcript to the durable `{role, content}` shape — the SAME shape
 * the turn endpoint replays (routes/task-chat.js `sanitizeHistory`), so a stored
 * transcript re-hydrates and replays identically. This is also what keeps tool
 * breadcrumbs, model settings, and token/cost accounting out of the payload:
 * anything that is not a user/assistant string turn is dropped.
 */
function sanitizeTranscript(transcript) {
  return filterChatTurns(transcript)
    .slice(0, MAX_TRANSCRIPT_TURNS)
    .map(t => ({ role: t.role, content: clampText(t.content, MAX_CONTENT_CHARS) }));
}

/**
 * Derive a saved-chat title from the first user turn. Content is single-lined and
 * clamped; falls back to the task identifier (or a generic label) when there is
 * no user turn to draw on.
 */
function deriveTitle(transcript, taskIdentifier) {
  const firstUser = transcript.find(t => t.role === 'user');
  const raw = firstUser ? firstUser.content.replace(/\s+/g, ' ').trim() : '';
  if (raw) return raw.slice(0, MAX_TITLE_CHARS);
  return taskIdentifier ? `Chat about ${taskIdentifier}` : 'Saved chat';
}

function toMillis(value) {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Full public record (includes the transcript — for get()/resume). */
function toRecord(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    taskIdentifier: doc.taskIdentifier,
    title: doc.title,
    transcript: Array.isArray(doc.transcript) ? doc.transcript : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

/** Metadata-only summary (no transcript — for list(), keeps content off the list). */
function toSummary(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    taskIdentifier: doc.taskIdentifier,
    title: doc.title,
    turnCount: Array.isArray(doc.transcript) ? doc.transcript.length : 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

/**
 * MongoDB/MangoDB-backed durable saved-chat store, private per {urlKey, accountId}.
 */
export class SavedChatStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   * @param {number} [options.maxPerUser=50] - Per-user cap on retained saved chats.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.maxPerUser = options.maxPerUser || MAX_SAVED_CHATS_PER_USER;
    // SECONDARY sort key only: breaks ties when two chats share the same
    // updatedAt millisecond. Wall-clock stays primary, so ordering survives a
    // restart (where the counter resets to 0).
    this._seq = 0;
  }

  /**
   * Save a new chat for a user. Title is auto-derived from the first user turn;
   * the transcript is sanitized to `{role, content}` turns only. Prunes to the
   * per-user cap after insert (oldest-first). Rejects an empty transcript so a
   * throwaway conversation is never persisted.
   *
   * @param {string} urlKey
   * @param {string} accountId
   * @param {Object} data - { taskIdentifier, transcript }
   * @returns {Promise<Object>} the created record (with transcript)
   * @throws {Error} on validation failure
   */
  async create(urlKey, accountId, { taskIdentifier, transcript } = {}) {
    if (!urlKey) throw new Error('urlKey is required');
    if (!accountId) throw new Error('accountId is required');

    const cleanTranscript = sanitizeTranscript(transcript);
    if (cleanTranscript.length === 0) throw new Error('A saved chat needs at least one message');

    const cleanTaskId = clampText(taskIdentifier, MAX_TASK_IDENTIFIER_CHARS).trim();
    const now = new Date().toISOString();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      accountId,
      taskIdentifier: cleanTaskId,
      title: deriveTitle(cleanTranscript, cleanTaskId),
      transcript: cleanTranscript,
      createdAt: now,
      updatedAt: now,
      seq: this._seq++
    };

    await this.collection.insertOne(doc);
    await this._pruneToCapacity(urlKey, accountId);
    return toRecord(doc);
  }

  /**
   * List a user's saved chats, newest-first. Metadata only (no transcript) so the
   * list never ships conversation content.
   *
   * @returns {Promise<Array>} summaries newest-first
   */
  async list(urlKey, accountId) {
    if (!urlKey || !accountId) return [];
    try {
      const docs = await this._docsFor(urlKey, accountId);
      return docs.map(toSummary);
    } catch (err) {
      console.error('Error listing saved chats:', err);
      return [];
    }
  }

  /**
   * Full saved chat (with transcript) for a user, or null. Scoped by
   * `{urlKey, accountId}` so a user can never read another user's chat.
   */
  async get(urlKey, accountId, id) {
    if (!urlKey || !accountId || !id) return null;
    try {
      const doc = await this.collection.findOne({ _id: id, urlKey, accountId });
      return toRecord(doc);
    } catch (err) {
      console.error('Error getting saved chat:', err);
      return null;
    }
  }

  /**
   * Hard-delete a saved chat (no soft-delete/tombstone in V1). Scoped by
   * `{urlKey, accountId}` so a user can only delete their own.
   *
   * @returns {Promise<boolean>} true if a document was removed
   */
  async delete(urlKey, accountId, id) {
    if (!urlKey || !accountId || !id) return false;
    try {
      const result = await this.collection.deleteOne({ _id: id, urlKey, accountId });
      return (result.deletedCount || 0) > 0;
    } catch (err) {
      console.error('Error deleting saved chat:', err);
      return false;
    }
  }

  /** Remove all saved chats for a workspace (used in tests). @returns {Promise<number>} */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing saved chats:', err);
      return 0;
    }
  }

  /** Docs for a user, newest-first (updatedAt primary, seq to break same-ms ties). */
  async _docsFor(urlKey, accountId) {
    const docs = await this.collection.find({ urlKey, accountId }).toArray();
    docs.sort((a, b) => (toMillis(b.updatedAt) - toMillis(a.updatedAt)) || ((b.seq || 0) - (a.seq || 0)));
    return docs;
  }

  /** Delete anything beyond the newest `maxPerUser` saved chats for a user. */
  async _pruneToCapacity(urlKey, accountId) {
    try {
      const docs = await this._docsFor(urlKey, accountId);
      for (const doc of docs.slice(this.maxPerUser)) {
        await this.collection.deleteOne({ _id: doc._id, urlKey, accountId });
      }
    } catch (err) {
      console.error('Error pruning saved chats:', err);
    }
  }
}
