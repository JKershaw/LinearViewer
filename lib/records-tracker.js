/**
 * LIN-4503 (P3): the tracker port the records writes use for their outward steps (lib/records/writes.js TrackerPort), over
 * one provider and the scope its calls take (a token for a proxy or dispatch credential, a call scope for a session).
 *
 * Lives outside lib/records/ on purpose: the records leaf imports only Platform, and this file is where it meets a provider.
 * Each method answers in the port's terms, so the leaf never sees a provider's shape:
 *   - canParentLink: whether the provider can file a ticket under a parent (`parentId` is in its write contract). Jira and
 *     GitHub cannot, so no child ticket is made on them: an unlinked ticket could not be found again on retry.
 *   - childrenOf: the parent's children, with `capped` exactly as the provider says it (true/false), or null when it says
 *     nothing. The leaf treats null as not read whole. Linear caps its children read and reports it; local reads all.
 *   - createChild: the ticket made under the parent. A failure is an answer `{error, retryable}`, never a throw, and a
 *     PartialWriteError keeps its own retry rule (lib/partial-write-error.js partialWriteEnvelope).
 *   - comment: a comment on the ticket, by its identifier, in the workspace `urlKey` (the ledger's key). It throws on failure;
 *     the leaf names the failure.
 */
import { PartialWriteError, partialWriteEnvelope } from './partial-write-error.js';
import { createRecordWrites } from './records/writes.js';
import { isTerminalState } from './providers/state-map.js';
import { postHarbourComment } from './harbour-comment-post.js';

/**
 * @param {Object} deps
 * @param {Object} deps.provider - an issue provider (lib/providers/*)
 * @param {*} deps.scope - the first argument the provider's calls take: a token, or a session's call scope
 * @returns {import('./records/writes.js').TrackerPort}
 */
export function trackerPortOf({ provider, scope }) {
  return {
    canParentLink() {
      return typeof provider.apiWriteFields === 'function' && provider.apiWriteFields().includes('parentId');
    },

    async childrenOf(parentRef) {
      const context = await provider.fetchRecommendationContext(scope, parentRef, { noDescend: true });
      const children = (context?.children ?? []).map((c) => c?.identifier).filter((x) => typeof x === 'string' && x);
      const capped = typeof context?.childrenCapped === 'boolean' ? context.childrenCapped : null;
      return { children, capped };
    },

    async createChild(parentRef, { title, description }) {
      try {
        const parent = await provider.issueDetail(scope, parentRef);
        if (!parent?.id) return { error: `${parentRef} could not be read for its id, so no child is made`, retryable: true };
        const input = { title, description, parentId: parent.id };
        if (provider.createFields().includes('teamId')) {
          const teamId = parent.teamId ?? parent.team?.id ?? null;
          if (!teamId) return { error: `${parentRef} names no team, so no child can be filed in it`, retryable: false };
          input.teamId = teamId;
        }
        const created = await provider.createIssue(scope, input);
        if (created?.success === false) return { error: 'the tracker refused the child ticket', retryable: true };
        const identifier = (created?.issue ?? created)?.identifier;
        if (!identifier) return { error: 'the tracker made a child but did not name it', retryable: true };
        return { identifier };
      } catch (err) {
        if (err instanceof PartialWriteError) {
          const { message, extra } = partialWriteEnvelope(err);
          return { error: message, retryable: extra.retryable };
        }
        return { error: err?.message || 'the child ticket was not made', retryable: true };
      }
    },

    async comment(ref, body, urlKey) {
      const issue = await provider.issueDetail(scope, ref);
      if (!issue?.id) throw new Error(`${ref} could not be read to comment on it`);
      // LIN-4535 (D4): a Harbour summary is Harbour's own post, so it is recorded in the ledger (lib/harbour-comment-post.js).
      const posted = await postHarbourComment({ urlKey, post: () => provider.createComment(scope, issue.id, body) });
      if (posted?.success === false) throw new Error('the tracker refused the comment');
    }
  };
}

/**
 * LIN-4503: the retry on each fresh dispatch of a parent ticket (lib/dispatch-factory.js). The dispatch's own issue access
 * (`{provider, token}`) is the tracker for it, so the retry runs under the credential the dispatch already holds. Returns
 * `(urlKey, parentRef, access) => Promise<answer per child task tried>`; an answer names each child that still has no ticket.
 * @param {Object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 */
export function childTicketRetryOf({ recordsStore }) {
  const writes = createRecordWrites({
    recordsStore,
    isTerminalState,
    readTicket: (access, ref) => access.provider.issueDetail(access.token, ref),
    tracker: (access) => trackerPortOf({ provider: access.provider, scope: access.token })
  });
  return (urlKey, parentRef, access) => writes.retryChildTickets({ ctx: access, urlKey, parentRef });
}
