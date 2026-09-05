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
 * record silently erases history that the escalation KPIs need. Here that
 * history is specifically "how often does a proposed dismissal turn out to be
 * one the human agrees with" — the calibration signal for whether proposing is
 * worth anyone's attention at all. Withdrawn suggestions are retained (not
 * deleted) for the same reason.
 *
 * Schema (one document per (urlKey, decisionId) — a re-suggest overwrites in
 * place, since only the CURRENT standing suggestion matters):
 * {
 *   _id:           string,       // `${urlKey}::${decisionId}`
 *   urlKey:        string,
 *   decisionId:    string,
 *   reason:        string,       // required, non-empty — never a silent proposal
 *   suggestedBy:   string,       // attribution: who is proposing this
 *   suggestedAt:   Date,
 *   withdrawn:     boolean,      // a "Keep" — the human declined the suggestion
 *   withdrawnAt:   Date|null
 * }
 */

function toRecord(doc) {
  if (!doc) return null;
  return {
    urlKey: doc.urlKey,
    decisionId: doc.decisionId,
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
   * @param {string} entry.reason - non-empty; why this ruling can go
   * @param {string} entry.suggestedBy - non-empty; who is proposing it
   * @param {Date} [entry.now] - injected clock; defaults to `new Date()`
   * @returns {Promise<Object|null>} the stored record, or null on bad input/error
   */
  async suggest({ urlKey, decisionId, reason, suggestedBy, now } = {}) {
    if (!this.collection || !urlKey || !decisionId) return null;
    if (typeof reason !== 'string' || !reason.trim()) return null;
    if (typeof suggestedBy !== 'string' || !suggestedBy.trim()) return null;

    try {
      const nowDate = now instanceof Date ? now : new Date();
      const _id = `${urlKey}::${decisionId}`;
      const doc = {
        _id,
        urlKey,
        decisionId,
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
   * @param {Date} [entry.now]
   * @returns {Promise<Object|null>} the updated record, or null if absent/bad input/error
   */
  async withdraw({ urlKey, decisionId, now } = {}) {
    if (!this.collection || !urlKey || !decisionId) return null;
    try {
      const _id = `${urlKey}::${decisionId}`;
      const existing = await this.collection.findOne({ _id });
      if (!existing) return null;
      if (existing.withdrawn) return toRecord(existing); // first withdrawal wins; idempotent

      const withdrawnAt = now instanceof Date ? now : new Date();
      await this.collection.updateOne({ _id }, { $set: { withdrawn: true, withdrawnAt } });
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

  /** Delete every suggestion row for a workspace (test-harness only; see routes/test.js). */
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
