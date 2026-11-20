/**
 * LIN-4503: an in-memory tracker for the records outward half: the TrackerPort lib/records/writes.js takes (childrenOf with
 * its `capped` answer, createChild, comment, canParentLink) and the ticket read (readTicket), over one set of issues.
 * Provider-independent: a test sets its knobs to the situation it witnesses (a capped children read, a failed create,
 * a provider that cannot parent-link), and reads back what the writes did (created, comments, attempts).
 *
 * `knobs` is read at call time, so a test flips it between writes. `issues` is the tracker's own state, by identifier.
 */
export function createFakeTracker({ tickets = [] } = {}) {
  const issues = new Map(tickets.map((t) => [t.identifier, { description: '', parent: null, state: { name: 'Todo', type: 'unstarted' }, ...t }]));
  const created = [];
  const comments = [];
  const attempts = { childrenOf: 0, createChild: 0, comment: 0 };
  const knobs = {
    canParentLink: true,
    /** true, false, or null: null is a tracker that does not say whether its children read is whole */
    childrenCapped: false,
    /** 'ok' or 'throws' */
    childrenRead: 'ok',
    /** a refusal message the create answers with, or null to create */
    createFails: null,
    commentFails: false
  };
  let seq = 100;

  const port = {
    canParentLink: () => knobs.canParentLink,
    async childrenOf(parentRef) {
      attempts.childrenOf += 1;
      if (knobs.childrenRead === 'throws') throw new Error('children read failed');
      const children = [...issues.values()].filter((t) => t.parent?.identifier === parentRef).map((t) => t.identifier);
      return { children, capped: knobs.childrenCapped };
    },
    async createChild(parentRef, { title, description }) {
      attempts.createChild += 1;
      if (knobs.createFails) return { error: knobs.createFails, retryable: true };
      seq += 1;
      const identifier = `LIN-${seq}`;
      issues.set(identifier, { identifier, title, description, parent: { identifier: parentRef }, state: { name: 'Todo', type: 'unstarted' } });
      created.push({ identifier, parentRef, title, description });
      return { identifier };
    },
    async comment(ref, body) {
      attempts.comment += 1;
      if (knobs.commentFails) throw new Error('the comment was refused');
      comments.push({ ref, body });
    }
  };

  return {
    port,
    knobs,
    issues,
    created,
    comments,
    attempts,
    /** The pipeline's `tracker(ctx)`: every request, dispatch or session gets this one tracker. */
    tracker: () => port,
    /** The pipeline's `readTicket(ctx, ref)`. */
    readTicket: async (_ctx, ref) => issues.get(ref) ?? null
  };
}
