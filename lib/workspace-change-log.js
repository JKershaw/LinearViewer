/**
 * Workspace change log (LIN-3846): the log of settings changes that affect
 * everyone in a workspace, other than model routing.
 *
 * Collection `workspace-change-log`, one doc per change. Outside Models the
 * workspace-wide settings are the periodic reviews switch (`periodicals`) and
 * agents-can-change-models switch (`modelRoutingProxyWrites`, LIN-3854) and the run halt
 * (`halt`: none | pause | stop). `model-routing-log` is NOT reused
 * for these: its `seq` is the routing table's version (`seq = version + 1`),
 * which a halt or a switch has no part in. The Change log page shows both,
 * merged by `at` (`mergeChangeLog`).
 *
 * Entry: { _id, urlKey, at, actor: { via: 'page'|'proxy'|'system', id? },
 *          setting, kind: 'change'|'undo', reason, from, to, undoes? }
 *
 * No person's name is stored: ids only, the name is resolved at read time and
 * an erased or unknown id reads "former member" (as ModelRoutingStore does).
 *
 * Undo writes a new `kind:'undo'` entry and refuses when the current value no
 * longer equals the entry's `to` (CONFLICT), when the entry was already undone,
 * or when `from` is `unknown` (a halt whose previous value could not be read:
 * there is nothing to restore, and guessing "resume" could lift a stop).
 *
 * The write itself is the caller's: `undo` takes it as an `apply` callback.
 * Halt is a request the runner honours and its writers are owner-gated and
 * pinned by tests/unit/lin-3383-runner-enqueue-census.test.js, so the halt
 * sinks stay in routes/ where that census can see them; this file holds none.
 * It imports nothing from the runs area (no HALT_MODES) so it adds no area pair.
 */
import { randomUUID } from 'node:crypto';
import { MAX_REASON_LENGTH } from './model-routing.js';

export const SETTINGS = ['periodicals', 'modelRoutingProxyWrites', 'halt'];
const VIAS = ['page', 'proxy', 'system'];
const FORMER_MEMBER = 'former member';
export const OUTSIDE_SETTINGS_REASON = 'Changed outside Settings (Dispatch page or API)';
export const UNKNOWN_VALUE = 'unknown';

export class ChangeLogError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ChangeLogError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function checkReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ChangeLogError('REASON_REQUIRED', 'a change needs a reason');
  if (text.length > MAX_REASON_LENGTH) throw new ChangeLogError('REASON_REQUIRED', `a reason is at most ${MAX_REASON_LENGTH} characters`);
  return text;
}

function checkActor(actor) {
  if (!actor || !VIAS.includes(actor.via)) throw new ChangeLogError('INVALID', 'a change needs an actor (page, proxy, system)');
  return { via: actor.via, ...(actor.id ? { id: actor.id } : {}) };
}

export class WorkspaceChangeLogStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - `workspace-change-log`
   * @param {(accountId: string) => Promise<string|null>} [options.resolveActorName]
   * @param {string} [options.erasedAccountId]
   */
  constructor({ collection, resolveActorName = async () => null, erasedAccountId = null } = {}) {
    this.collection = collection;
    this.resolveActorName = resolveActorName;
    this.erasedAccountId = erasedAccountId;
  }

  /** Append one `change` entry. Does not write the setting. */
  async record({ urlKey, setting, reason, actor, from, to }) {
    if (!urlKey) throw new ChangeLogError('INVALID', 'a change needs a workspace');
    if (!SETTINGS.includes(setting)) throw new ChangeLogError('INVALID', `unknown setting "${setting}"`);
    const entry = {
      _id: randomUUID(), urlKey, at: new Date(), actor: checkActor(actor),
      setting, kind: 'change', reason: checkReason(reason), from, to
    };
    await this.collection.insertOne(entry);
    return entry;
  }

  /** Newest first, actor names resolved now. */
  async getLog(urlKey, { limit = 100 } = {}) {
    const rows = await this.collection.find({ urlKey }).sort({ at: -1 }).limit(limit).toArray();
    const out = [];
    for (const row of rows) out.push({ ...row, actor: { ...row.actor, name: await this._actorName(row.actor) } });
    return out;
  }

  async getEntry(urlKey, entryId) {
    return this.collection.findOne({ _id: entryId, urlKey });
  }

  async _actorName(actor = {}) {
    if (actor.via === 'system') return 'Harbour';
    if (!actor.id || actor.id === this.erasedAccountId) return FORMER_MEMBER;
    return (await this.resolveActorName(actor.id)) || FORMER_MEMBER;
  }

  /**
   * Undo `entryId`. `readCurrent()` returns the setting's value now; `apply(value)`
   * writes the restored value. `apply` runs only after every check has passed.
   */
  async undo(entryId, { urlKey, reason, actor, readCurrent, apply }) {
    const text = checkReason(reason);
    const who = checkActor(actor);
    const entry = await this.collection.findOne({ _id: entryId, urlKey });
    if (!entry) throw new ChangeLogError('NOT_FOUND', 'no such log entry');
    if (entry.kind !== 'change') throw new ChangeLogError('NOT_UNDOABLE', 'only a change can be undone');
    if (entry.from === UNKNOWN_VALUE) throw new ChangeLogError('NOT_UNDOABLE', 'the value before this change is unknown, so there is nothing to restore');
    if (await this.collection.findOne({ urlKey, undoes: entryId })) throw new ChangeLogError('ALREADY_UNDONE', 'this change was already undone');
    const current = await readCurrent();
    if (current !== entry.to) {
      throw new ChangeLogError('CONFLICT', 'the setting has changed since; undo would overwrite it', { expected: entry.to, current });
    }
    await apply(entry.from, entry);
    const undoEntry = {
      _id: randomUUID(), urlKey, at: new Date(), actor: who,
      setting: entry.setting, kind: 'undo', reason: text, from: entry.to, to: entry.from, undoes: entryId
    };
    await this.collection.insertOne(undoEntry);
    return undoEntry;
  }

  /** Remove a workspace's entries (e2e reset). Erasure goes through the inventory. */
  async deleteWorkspace(urlKey) {
    await this.collection.deleteMany({ urlKey });
  }
}

// ---- display ---------------------------------------------------------------

const HALT_WORDS = { none: 'running', pause: 'paused', stop: 'stopped', [UNKNOWN_VALUE]: 'unknown' };

/** One line saying what changed. */
export function summarizeWorkspaceEntry(entry) {
  if (entry.setting === 'periodicals') {
    return `Periodic reviews turned ${entry.to ? 'on' : 'off'}`;
  }
  if (entry.setting === 'modelRoutingProxyWrites') {
    return `Agents ${entry.to ? 'can' : 'can no longer'} change models`;
  }
  if (entry.setting === 'halt') {
    const to = HALT_WORDS[entry.to] || entry.to;
    return entry.to === 'none' ? `Runs resumed (were ${HALT_WORDS[entry.from] || entry.from})` : `Runs ${to}`;
  }
  return `${entry.setting} changed`;
}

function summarizeModelEntry(entry) {
  const n = entry.changes?.length || 0;
  if (entry.kind === 'undo') return `Undid a model routing change (${n} ${n === 1 ? 'field' : 'fields'})`;
  if (entry.kind === 'preset-save') return 'Saved a model routing preset';
  if (entry.kind === 'preset-apply') return 'Applied a model routing preset';
  return `Model routing: ${n} ${n === 1 ? 'change' : 'changes'}`;
}

/**
 * One list, newest first by `at` (not `seq`: the routing log's seeded entry
 * carries a backdated time, and the two logs' sequences are unrelated).
 * Each row: { source, id, at, summary, reason, actorName, actorId, actorVia,
 * kind, setting?, undoable, undone }. `actorId` is compared with the viewer's
 * account id to say "You"; it is never written into the markup (LIN-3890).
 */
export function mergeChangeLog(workspaceRows = [], modelRows = []) {
  const undoneWorkspace = new Set(workspaceRows.filter(r => r.undoes).map(r => r.undoes));
  const undoneModel = new Set(modelRows.filter(r => r.undoes).map(r => r.undoes));
  const rows = [
    ...workspaceRows.map(r => ({
      source: 'workspace', id: r._id, at: r.at, summary: summarizeWorkspaceEntry(r), reason: r.reason,
      actorName: r.actor?.name || FORMER_MEMBER, actorId: r.actor?.id || null, actorVia: r.actor?.via || null,
      kind: r.kind, setting: r.setting,
      undone: undoneWorkspace.has(r._id),
      undoable: r.kind === 'change' && r.from !== UNKNOWN_VALUE && !undoneWorkspace.has(r._id)
    })),
    ...modelRows.map(r => ({
      source: 'model', id: r._id, at: r.at, summary: summarizeModelEntry(r), reason: r.reason,
      actorName: r.actor?.name || FORMER_MEMBER, actorId: r.actor?.id || null, actorVia: r.actor?.via || null,
      kind: r.kind, setting: 'model-routing',
      undone: undoneModel.has(r._id),
      undoable: !['undo', 'preset-save'].includes(r.kind) && (r.changes?.length || 0) > 0 && !undoneModel.has(r._id)
    }))
  ];
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
