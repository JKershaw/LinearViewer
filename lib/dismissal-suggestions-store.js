/**
 * Dismissal-suggestions store (LIN-2444) — an operator or agent session may
 * PROPOSE that a ruling be dismissed; it may never dismiss one.
 *
 * John's ruling on this ticket, verbatim:
 *
 *   "We don't want an agent to actually dismiss a ruling, but perhaps it could
 *    recommend a dismiss and it's easy for me/a user to agree."
 *
 * So a suggestion is a **VIEW operation only**: it records that someone thinks
 * a ruling can go, and it never touches the underlying loop or task-decision
 * row. The decision stays exactly as unanswered as it was before. Agreeing is
 * a separate, human, session-authed act that goes through the EXISTING dismiss
 * routes — this store is not on that path and writes no `decision-answer`
 * stamp. `decision-answer` remains absent from `FEEDBACK_ENTRY_KINDS`
 * (`lib/dispatch-store.js:61`), so a dispatch-consumer token still cannot
 * discharge the question it asked (LIN-1728), and this store does not
 * weaken that: it adds a way to *ask*, not a way to *answer*.
 *
 * Modelled on `lib/shelved-rulings-store.js`, which is the same shape of thing
 * — a `(urlKey, decisionId)`-keyed, durable, no-TTL record that annotates a
 * ruling without mutating it. Extending that vocabulary is deliberate
 * (LIN-1727 asks disposal semantics to be extended rather than forked), and it
 * carries the reason rule with it: a shelve refuses an empty reason because
 * silent muting is forbidden (`docs/escalation-philosophy.md` §6). A dismissal
 * proposed with no stated reason is that same failure wearing a different hat
 * — the operator would be asked to agree to something nobody justified — so it
 * is refused identically.
 *
 * Durable, no TTL, for the reason `lib/task-decisions-store.js` and
 * `lib/shelved-rulings-store.js` both give: a TTL on an operator-disposition
 * record silently erases history that the escalation KPIs need. What this
 * schema can testify to is narrower than it might look, so state it exactly:
 * it records that a dismissal was PROPOSED, and that a human DECLINED it
 * (`withdrawn`). It does NOT record agreement — the session dismiss path
 * (`markDecisionAnswered`) never touches this row, so "agreed" and "never
 * acted on" are indistinguishable here. Retaining withdrawn rows therefore
 * buys the false-proposal half of the calibration signal only; the agreed half
 * needs an `agreed` stamp written at the dismiss seam, which is deliberately
 * not this ticket's scope (that seam is the human's, and widening it is what
 * John's ruling was guarding against).
 *
 * Schema (LIN-2756: one document per (urlKey, decisionLoopId, decisionId) —
 * a re-suggest overwrites in place, since only the CURRENT standing
 * suggestion matters):
 * {
 *   _id:           string,       // `${urlKey}::${decisionLoopId}::${decisionId}`
 *                                 // — or `${urlKey}::${decisionId}` (LEGACY,
 *                                 // two-segment) when `decisionLoopId` is
 *                                 // omitted, see below
 *   urlKey:        string,
 *   decisionId:    string,
 *   decisionLoopId: string|null, // LIN-2756: the loop/task-decision id this
 *                                 // proposal targets — `anchor.loopId ??
 *                                 // anchor.taskDecisionId` from the ruling
 *                                 // row being proposed against. `null` on a
 *                                 // legacy or deliberately workspace-wide row.
 *   reason:        string,       // required, non-empty — never a silent proposal
 *   suggestedBy:   string,       // attribution: who is proposing this
 *   suggestedAt:   Date,
 *   withdrawn:     boolean,      // a "Keep" — the human declined the suggestion
 *   withdrawnAt:   Date|null
 * }
 *
 * LIN-2756 — per-loop identity, and the back-compat decision made explicit.
 * `decision_id` is not unique within one workspace either: an agent session
 * that re-emits the same `DECISION:` block from two different loops produces
 * two loops sharing one `decision_id`, and a suggestion keyed only on
 * `(urlKey, decisionId)` would silently apply to BOTH — the exact bug this
 * ticket fixes on the client (`public/observation.js`'s `rulingKey`) now
 * fixed here too, on the write side that client key was always meant to
 * agree with.
 *
 * `decisionLoopId` is OPTIONAL, deliberately: a caller that supplies it gets
 * a suggestion scoped to exactly that one loop's row (a three-segment `_id`).
 * A caller that omits it gets the OLD, wider behaviour — a two-segment `_id`
 * that "applies to every loop carrying that id" — documented, not silently
 * inherited. This is what makes a `decisionId`-only write still work: no
 * existing caller (this store's own pre-LIN-2756 tests, or an agent
 * integration that hasn't upgraded) starts failing or silently narrowing.
 *
 * What about documents already persisted under the OLD two-segment `_id`,
 * from before this beat? They are not migrated — there is no migration
 * tooling in this codebase for a Mongo/Mango collection, and a live rewrite
 * of every historical suggestion row is unwarranted for a durable-but-
 * disposable view annotation (the underlying decision's answer state is
 * untouched either way). Instead they are read as exactly what their shape
 * already means: a workspace-wide suggestion with no loop segment, i.e. the
 * SAME "applies to every loop carrying that id" semantics a fresh
 * `decisionLoopId`-omitted write gets today. `listForWorkspaces` still
 * returns raw rows; the caller (routes/proxy-rulings.js, routes/
 * dashboard.js) does the two-tier match — a row's own loop segment first,
 * falling back to the workspace-wide (legacy-shaped) suggestion — so an old
 * row is never invisible, only exactly as wide as it always was.
 */

// LIN-2756: the composite id, shared by every write below. `decisionLoopId`
// falsy (omitted/null/undefined) composes the LEGACY, workspace-wide
// two-segment shape on purpose — see the back-compat note in the module
// docstring.
function suggestionId(urlKey, decisionLoopId, decisionId) {
  return decisionLoopId ? `${urlKey}::${decisionLoopId}::${decisionId}` : `${urlKey}::${decisionId}`;
}

// LIN-2756/LIN-2766/F3: the ONE precedence rule for choosing between a
// loop-scoped and a legacy/workspace-wide document for the same decision —
// shared by the read side (`attachStandingSuggestions`, below) and the
// write side (`withdraw`, below), so a Keep can never be pressed against a
// different document than the one the banner it was pressed on actually
// displayed. A withdrawn document is never "standing": prefer whichever of
// the two is still standing, scoped first (a specific, live proposal beats
// a wide one); only when NEITHER is standing (both withdrawn, or one/both
// absent) fall back to whichever exists, scoped first, so a caller with a
// real row to act on (e.g. `withdraw`'s idempotent branch) still gets one.
function pickStandingDoc(scoped, legacy) {
  if (scoped && !scoped.withdrawn) return scoped;
  if (legacy && !legacy.withdrawn) return legacy;
  return scoped || legacy || null;
}

function toRecord(doc) {
  if (!doc) return null;
  return {
    urlKey: doc.urlKey,
    decisionId: doc.decisionId,
    decisionLoopId: doc.decisionLoopId || null,
    reason: doc.reason,
    suggestedBy: doc.suggestedBy,
    suggestedAt: doc.suggestedAt?.toISOString?.() || doc.suggestedAt,
    withdrawn: !!doc.withdrawn,
    withdrawnAt: doc.withdrawnAt?.toISOString?.() || doc.withdrawnAt || null
  };
}

export class DismissalSuggestionsStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection instance.
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Propose a dismissal. `reason` and `suggestedBy` are both required — an
   * unattributed or unexplained proposal is one the operator cannot evaluate,
   * which makes agreeing to it a rubber stamp rather than a decision.
   *
   * Re-suggesting an already-suggested decision overwrites in place and
   * CLEARS a prior withdrawal: a fresh proposal with a fresh reason is a new
   * argument, and leaving it suppressed because the human once said "Keep"
   * would silently swallow it. The prior `withdrawnAt` is not preserved —
   * only the current standing suggestion matters here; the durable record of
   * what was agreed to lives on the dismiss path itself.
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.decisionId
   * @param {string} [entry.decisionLoopId] - LIN-2756: the loop/task-decision
   *   this proposal targets. Omitted → the legacy, workspace-wide shape (see
   *   the module docstring's back-compat note).
   * @param {string} entry.reason - non-empty; why this ruling can go
   * @param {string} entry.suggestedBy - non-empty; who is proposing it
   * @param {Date} [entry.now] - injected clock; defaults to `new Date()`
   * @returns {Promise<Object|null>} the stored record, or null on bad input/error
   */
  async suggest({ urlKey, decisionId, decisionLoopId, reason, suggestedBy, now } = {}) {
    if (!this.collection || !urlKey || !decisionId) return null;
    if (typeof reason !== 'string' || !reason.trim()) return null;
    if (typeof suggestedBy !== 'string' || !suggestedBy.trim()) return null;

    try {
      const nowDate = now instanceof Date ? now : new Date();
      const _id = suggestionId(urlKey, decisionLoopId, decisionId);
      const doc = {
        _id,
        urlKey,
        decisionId,
        decisionLoopId: decisionLoopId || null,
        reason: reason.trim(),
        suggestedBy: suggestedBy.trim(),
        suggestedAt: nowDate,
        withdrawn: false,
        withdrawnAt: null
      };
      await this.collection.updateOne({ _id }, { $set: doc }, { upsert: true });
      return toRecord(doc);
    } catch (err) {
      console.error('Error suggesting ruling dismissal:', err);
      return null;
    }
  }

  /**
   * Withdraw a standing suggestion — the human pressed "Keep". This is NOT a
   * dismissal and NOT an answer: the ruling stays exactly as unanswered as it
   * was, and only the suggestion stops being offered.
   *
   * The row is marked rather than deleted, so "this was proposed and a human
   * declined it" stays visible — the signal that tells you proposals are being
   * made badly, which a delete would erase.
   *
   * @param {Object} entry
   * @param {string} entry.urlKey
   * @param {string} entry.decisionId
   * @param {string} [entry.decisionLoopId] - LIN-2756: the row's own loop/
   *   task-decision id, when the row carries one. NOT required to match how
   *   the standing suggestion happens to be stored — see `pickStandingDoc`
   *   above, the SAME function `attachStandingSuggestions` (the read side)
   *   uses to choose between a loop-scoped and a legacy document, so a Keep
   *   always targets whatever suggestion is currently DISPLAYED on the row,
   *   never a different document reached by a second, independently-written
   *   copy of the same precedence rule (LIN-2766, then re-review F3: a
   *   two-tier lookup that ignored `withdrawn` when choosing between the two
   *   could still pick an already-withdrawn scoped doc over a standing
   *   legacy one).
   * @param {Date} [entry.now]
   * @returns {Promise<Object|null>} the updated record, or null if absent/bad input/error
   */
  async withdraw({ urlKey, decisionId, decisionLoopId, now } = {}) {
    if (!this.collection || !urlKey || !decisionId) return null;
    try {
      const scopedId = decisionLoopId ? suggestionId(urlKey, decisionLoopId, decisionId) : null;
      const legacyId = suggestionId(urlKey, null, decisionId);
      const scoped = scopedId ? await this.collection.findOne({ _id: scopedId }) : null;
      const legacy = await this.collection.findOne({ _id: legacyId });
      const existing = pickStandingDoc(scoped, legacy);
      if (!existing) return null;
      if (existing.withdrawn) return toRecord(existing); // first withdrawal wins; idempotent

      const withdrawnAt = now instanceof Date ? now : new Date();
      await this.collection.updateOne({ _id: existing._id }, { $set: { withdrawn: true, withdrawnAt } });
      return toRecord({ ...existing, withdrawn: true, withdrawnAt });
    } catch (err) {
      console.error('Error withdrawing ruling dismissal suggestion:', err);
      return null;
    }
  }

  /**
   * Every suggestion row across a workspace set — raw rows, including
   * withdrawn ones. The caller decides which are still standing, mirroring the
   * raw-rows convention `ShelvedRulingsStore.listForWorkspaces` and
   * `TaskDecisionsStore`'s list methods already use: the store never dedups or
   * reduces, so there is only ever one place that owns the predicate.
   *
   * @param {Array<string>} urlKeys
   * @returns {Promise<Array<Object>>}
   */
  async listForWorkspaces(urlKeys) {
    if (!this.collection || !Array.isArray(urlKeys) || urlKeys.length === 0) return [];
    try {
      const docs = await this.collection.find({ urlKey: { $in: urlKeys } }).toArray();
      return docs.map(toRecord);
    } catch (err) {
      console.error('Error listing ruling dismissal suggestions:', err);
      return [];
    }
  }

  /**
   * Delete every suggestion row for a workspace (test-harness only; see
   * routes/test.js's /test/clear-dismissal-suggestions, the sibling of
   * /test/clear-task-snapshots). Without this an e2e workspace reset clears
   * shelved rulings but leaks suggestion rows into the next test.
   */
  async clear(urlKey) {
    if (!this.collection || !urlKey) return 0;
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing ruling dismissal suggestions:', err);
      return 0;
    }
  }
}

/**
 * LIN-2756 — the ONE place that joins a `suggest()`-shaped row onto a ruling
 * row, so `routes/proxy-rulings.js`'s GET and `routes/dashboard.js`'s GET
 * (previously two independent, drifted copies of this join — the proxy route
 * keyed by bare `decisionId`, the dashboard route by `${urlKey}::${decisionId}`,
 * neither loop-aware) can't disagree about which suggestion attaches to which
 * row, and — since `DismissalSuggestionsStore.withdraw` (above) uses the SAME
 * `pickStandingDoc` — so a Keep can never target a different document than
 * the one this join actually displayed (LIN-2766, re-review F3).
 *
 * Same STRUCTURAL two-tier shape as `lib/unanswered-decisions.js`'s
 * `shelfGate` (a row's own loop-scoped key checked first, the legacy/
 * workspace-wide key as fallback) — but NOT the same precedence order, and
 * that axis matters: this function (via `pickStandingDoc`) prefers whichever
 * of the two is still STANDING (not withdrawn), scoped first; `shelfGate`
 * instead picks by PRESENCE first (scoped wins whenever one exists, even a
 * lapsed one) and only then checks activeness. The two do not "mirror
 * exactly" on that axis — see `shelfGate`'s own comment and LIN-2756's F4
 * follow-up for whether they should.
 *
 * @param {Array<Object>} rows - ruling rows (each carrying `anchor`/`decision`), e.g. from collectUnansweredDecisions
 * @param {Array<Object>} suggestions - raw rows from `listForWorkspaces()`, any workspace mix
 * @returns {Array<Object>} rows, each additionally carrying `suggestedDismissal: {reason, suggestedBy, suggestedAt}|null`
 */
export function attachStandingSuggestions(rows, suggestions) {
  const byKey = new Map();
  const byLegacyKey = new Map();
  for (const s of suggestions || []) {
    if (!s.urlKey || !s.decisionId) continue;
    if (s.decisionLoopId) {
      byKey.set(`${s.urlKey}::${s.decisionLoopId}::${s.decisionId}`, s);
    } else {
      byLegacyKey.set(`${s.urlKey}::${s.decisionId}`, s);
    }
  }
  return rows.map(row => {
    const urlKey = row.anchor?.workspaceUrlKey;
    const decisionId = row.decision?.decision_id;
    const loopKey = row.anchor?.loopId ?? row.anchor?.taskDecisionId;
    const scoped = loopKey ? byKey.get(`${urlKey}::${loopKey}::${decisionId}`) : null;
    const legacy = byLegacyKey.get(`${urlKey}::${decisionId}`);
    const picked = pickStandingDoc(scoped, legacy);
    const suggestion = picked && !picked.withdrawn ? picked : null;
    return {
      ...row,
      suggestedDismissal: suggestion
        ? { reason: suggestion.reason, suggestedBy: suggestion.suggestedBy, suggestedAt: suggestion.suggestedAt }
        : null
    };
  });
}
