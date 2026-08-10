/**
 * Local issue store (LIN-356).
 *
 * A first-party, writable backend for the Local provider. Mirrors the storage
 * pattern every other store uses — a `class XStore { constructor({ collection }) }`
 * injected with a `db.collection()` (MangoDB file-store in dev, MongoDB in prod)
 * — NOT the express-session-specific MongoSessionStore.
 *
 * One collection (`local-issues`) holds both projects and issues, discriminated
 * by a `kind` field and partitioned by `scope` (the workspace urlKey). This is
 * the natural mirror of dispatch-store.js's single-collection / urlKey-scoped
 * shape.
 *
 * `scope` is part of the document IDENTITY, not just a read filter: EVERY
 * write — create/upsert, partial update, comment/label/relation mutation — keys
 * its `updateOne` on `{ _id, scope }`, never `{ _id }` alone (LIN-802). In
 * production `_id`s are globally unique (real UUIDs / urlKey-prefixed starter
 * seeds), so the extra `scope` clause is a no-op. But the E2E fixtures
 * deliberately reuse the SAME hardcoded `_id`s across every per-worker scope
 * (workspaceApiLocalSeed et al.), and MangoDB does NOT enforce a unique `_id`
 * index — so a bare `{ _id }` upsert from one parallel worker's seed would
 * overwrite another scope's doc (flipping its `scope`), and the victim's
 * `listIssues(scope)` would then miss it. Scoping the write filter lets the same
 * `_id` coexist as one document per scope, which is what kills the cross-worker
 * seed-collision flake (e.g. prompts.spec's Promptable-Labels assertions). It
 * also disambiguates the post-read mutators: with duplicate `_id`s live, an
 * unscoped `updateOne({ _id })` could hit the wrong scope's row.
 *
 * Array fields (labels, comments, relations) are mutated read-modify-write with
 * `$set` rather than `$push`, matching dispatch-store.js's feedback handling —
 * the only update operator the codebase relies on across Mango/Mongo is `$set`.
 *
 * Issue document schema (kind: 'issue'):
 * {
 *   _id: string,            // issue UUID (canonical `id`)
 *   scope: string,          // workspace partition key (urlKey)
 *   kind: 'issue',
 *   identifier: string,     // e.g. "LOCAL-1"
 *   title, description: string,
 *   priority, estimate, sortOrder: number|null,
 *   createdAt, dueDate, completedAt: string|null (ISO),
 *   parentId: string|null,
 *   projectId: string|null,
 *   state: { name: string, type: string },   // canonical state.type
 *   assignee: { name: string }|null,
 *   labels: string[],
 *   comments: Array<{ id, body, createdAt, user }>,
 *   relations: Array<{ id, type, relatedIssueId }>,
 *   url: string|null
 * }
 *
 * Project document schema (kind: 'project'):
 * { _id, scope, kind: 'project', name, content, url, sortOrder }
 */

import crypto from 'crypto';

const DEFAULT_STATE = { name: 'Backlog', type: 'backlog' };

export class LocalStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - Mongo/Mango collection for local-issues.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  /**
   * Create (or upsert by explicit id) a project in `scope`.
   * @returns {Promise<Object>} The stored project document.
   */
  async createProject(scope, data = {}) {
    const doc = {
      _id: data.id || crypto.randomUUID(),
      scope,
      kind: 'project',
      name: data.name || 'Untitled Project',
      content: data.content ?? null,
      url: data.url ?? null,
      sortOrder: data.sortOrder ?? 0,
    };
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: doc }, { upsert: true });
    return doc;
  }

  /** List all projects in `scope`, sorted by sortOrder. */
  async listProjects(scope) {
    const docs = await this.collection.find({ scope, kind: 'project' }).toArray();
    return docs.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  /**
   * Create (or upsert by explicit id) an issue in `scope`.
   * Generates an identifier ("LOCAL-N") when none is supplied.
   * @returns {Promise<Object>} The stored issue document.
   */
  async createIssue(scope, data = {}) {
    let identifier = data.identifier;
    if (!identifier) {
      const count = (await this.listIssues(scope)).length;
      identifier = `LOCAL-${count + 1}`;
    }
    const now = new Date().toISOString();
    const doc = {
      _id: data.id || crypto.randomUUID(),
      scope,
      kind: 'issue',
      identifier,
      title: data.title || 'Untitled',
      description: data.description ?? '',
      priority: data.priority ?? 0,
      estimate: data.estimate ?? null,
      sortOrder: data.sortOrder ?? 0,
      createdAt: data.createdAt || now,
      dueDate: data.dueDate ?? null,
      completedAt: data.completedAt ?? null,
      parentId: data.parentId ?? null,
      projectId: data.projectId ?? null,
      state: data.state || { ...DEFAULT_STATE },
      assignee: data.assignee ?? null,
      labels: Array.isArray(data.labels) ? [...data.labels] : [],
      comments: Array.isArray(data.comments) ? [...data.comments] : [],
      relations: Array.isArray(data.relations) ? [...data.relations] : [],
      url: data.url ?? null,
    };
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: doc }, { upsert: true });
    return doc;
  }

  /**
   * Apply a partial update to an issue (by `_id` or `identifier`).
   * Only known mutable fields are written; `_id`/`scope`/`kind` are immutable.
   * @returns {Promise<Object|null>} The updated document, or null if not found.
   */
  async updateIssue(scope, id, patch = {}) {
    const doc = await this.getIssue(scope, id);
    if (!doc) return null;

    const mutable = [
      'title', 'description', 'priority', 'estimate', 'sortOrder',
      'dueDate', 'completedAt', 'parentId', 'projectId', 'state',
      'assignee', 'url', 'labels',
    ];
    const update = {};
    for (const key of mutable) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) update[key] = patch[key];
    }
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: update });
    return { ...doc, ...update };
  }

  /** Delete an issue (by `_id` or `identifier`). @returns {Promise<boolean>} */
  async deleteIssue(scope, id) {
    const doc = await this.getIssue(scope, id);
    if (!doc) return false;
    const result = await this.collection.deleteOne({ _id: doc._id, scope });
    return (result?.deletedCount ?? 0) > 0;
  }

  /**
   * Resolve an issue by `_id` first, then by `identifier`.
   * @returns {Promise<Object|null>}
   */
  async getIssue(scope, id) {
    if (!scope || !id) return null;
    const byId = await this.collection.findOne({ scope, kind: 'issue', _id: id });
    if (byId) return byId;
    return this.collection.findOne({ scope, kind: 'issue', identifier: id });
  }

  /**
   * List all issues in `scope`, in a deterministic order.
   *
   * Mirrors listProjects: the underlying find().toArray() returns storage-
   * natural order, which is NOT stable across reads (especially under concurrent
   * writes). Consumers render issues in array order (e.g. the ship view places
   * orbit cards in this order), so an unstable order makes those views reload-
   * unstable. Sort by sortOrder, then a stable id tiebreak (identifier, then
   * _id) so the order is determined by the data, never by storage.
   */
  async listIssues(scope) {
    const docs = await this.collection.find({ scope, kind: 'issue' }).toArray();
    return docs.slice().sort((a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      String(a.identifier ?? '').localeCompare(String(b.identifier ?? '')) ||
      String(a._id ?? '').localeCompare(String(b._id ?? ''))
    );
  }

  /** Direct children of `parentId` within `scope`. */
  async getChildren(scope, parentId) {
    if (!parentId) return [];
    return this.collection.find({ scope, kind: 'issue', parentId }).toArray();
  }

  /**
   * Case-insensitive substring search over issue title + description.
   * Filtered in JS (not a Mongo `$regex`) so it works identically on Mango.
   */
  async searchIssues(scope, query) {
    const issues = await this.listIssues(scope);
    if (!query) return issues;
    const q = String(query).toLowerCase();
    return issues.filter(i =>
      (i.title || '').toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q));
  }

  // ---------------------------------------------------------------------------
  // Comments / labels / relations — read-modify-write with $set
  // ---------------------------------------------------------------------------

  /** Append a comment to an issue. @returns {Promise<Object|null>} the comment, or null if issue missing. */
  async addComment(scope, id, body) {
    const doc = await this.getIssue(scope, id);
    if (!doc) return null;
    const comment = {
      id: crypto.randomUUID(),
      body: body ?? '',
      createdAt: new Date().toISOString(),
      user: 'Local',
    };
    const comments = [...(doc.comments || []), comment];
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: { comments } });
    return comment;
  }

  /** Add a label (idempotent). @returns {Promise<boolean>} */
  async addLabel(scope, id, label) {
    const doc = await this.getIssue(scope, id);
    if (!doc || !label) return false;
    const labels = doc.labels || [];
    if (labels.includes(label)) return true;
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: { labels: [...labels, label] } });
    return true;
  }

  /** Remove a label. @returns {Promise<boolean>} */
  async removeLabel(scope, id, label) {
    const doc = await this.getIssue(scope, id);
    if (!doc) return false;
    const labels = (doc.labels || []).filter(l => l !== label);
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: { labels } });
    return true;
  }

  /** Append a relation. @returns {Promise<Object|null>} the relation, or null if issue missing. */
  async addRelation(scope, id, { type, relatedIssueId } = {}) {
    const doc = await this.getIssue(scope, id);
    if (!doc) return null;
    const relation = { id: crypto.randomUUID(), type, relatedIssueId };
    const relations = [...(doc.relations || []), relation];
    await this.collection.updateOne({ _id: doc._id, scope }, { $set: { relations } });
    return relation;
  }

  /**
   * Delete a relation by its own id (the id minted in addRelation, exposed on
   * relation nodes). Relations live only on the source issue, so this scans the
   * partition for the holder and removes the matching entry.
   * @returns {Promise<boolean>} true if a relation was removed.
   */
  async deleteRelation(scope, relationId) {
    if (!relationId) return false;
    const issues = await this.listIssues(scope);
    for (const doc of issues) {
      const relations = doc.relations || [];
      if (relations.some(r => r.id === relationId)) {
        await this.collection.updateOne(
          { _id: doc._id, scope },
          { $set: { relations: relations.filter(r => r.id !== relationId) } });
        return true;
      }
    }
    return false;
  }

  /**
   * Remove a comment by its own id (the id minted in addComment). Comments
   * live only on their issue, so this scans the partition for the holder and
   * removes the matching entry (mirrors deleteRelation).
   * @returns {Promise<boolean>} true if a comment was removed.
   */
  async removeComment(scope, commentId) {
    if (!commentId) return false;
    const issues = await this.listIssues(scope);
    for (const doc of issues) {
      const comments = doc.comments || [];
      if (comments.some(c => c.id === commentId)) {
        await this.collection.updateOne(
          { _id: doc._id, scope },
          { $set: { comments: comments.filter(c => c.id !== commentId) } });
        return true;
      }
    }
    return false;
  }

  /**
   * Update a comment's body by its own id (same partition scan as
   * removeComment/deleteRelation).
   * @returns {Promise<Object|null>} the updated comment, or null if not found.
   */
  async updateComment(scope, commentId, body) {
    if (!commentId) return null;
    const issues = await this.listIssues(scope);
    for (const doc of issues) {
      const comments = doc.comments || [];
      const index = comments.findIndex(c => c.id === commentId);
      if (index !== -1) {
        const updated = { ...comments[index], body };
        const nextComments = [...comments];
        nextComments[index] = updated;
        await this.collection.updateOne(
          { _id: doc._id, scope },
          { $set: { comments: nextComments } });
        return updated;
      }
    }
    return null;
  }

  /** Distinct label names across all issues in `scope`. */
  async listLabels(scope) {
    const issues = await this.listIssues(scope);
    const names = new Set();
    for (const i of issues) for (const l of (i.labels || [])) names.add(l);
    return [...names];
  }

  // ---------------------------------------------------------------------------
  // Bulk lifecycle — for E2E seeding (LIN-356 S2) and test setup
  // ---------------------------------------------------------------------------

  /**
   * Bulk-load projects + issues into `scope`, preserving any explicit ids so
   * callers can reference seeded rows. Returns the stored documents.
   */
  async seed(scope, { projects = [], issues = [] } = {}) {
    const storedProjects = [];
    for (const p of projects) storedProjects.push(await this.createProject(scope, p));
    const storedIssues = [];
    for (const i of issues) storedIssues.push(await this.createIssue(scope, i));
    return { projects: storedProjects, issues: storedIssues };
  }

  /** Remove every project + issue in `scope`. */
  async clear(scope) {
    const result = await this.collection.deleteMany({ scope });
    return result?.deletedCount ?? 0;
  }
}
