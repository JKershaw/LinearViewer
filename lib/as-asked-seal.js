/**
 * Sealing the `## As asked` block onto a ticket's description (LIN-4345 plan rev 2,
 * step 6; LIN-4352). lib/as-asked.js owns the block's shape and stays pure and
 * provider-blind; this module adds the two decisions every sealing lane makes the
 * same way, so they cannot drift apart between lanes:
 *
 *   1. Whether the body may be sealed at all. An empty body is not (nothing was
 *      asked in words). A body that already holds a marker line is not: its own
 *      marker would end the block early. That case is filed unsealed with one log
 *      line, never refused, because refusing would block a person's own filing.
 *      (The proxy create refuses a marker body before it gets here: beat 1.)
 *
 *   2. Whether the provider can HOLD the block (`providerHoldsAsAsked`). A provider
 *      that stores markdown verbatim (Local, GitHub) or only backslash-escapes it
 *      (Linear: compared after normalizeEscaping) can. A provider that converts the
 *      body declares the conversion as an optional, pure
 *      `descriptionRoundTrip(markdown) → markdown` method: what the description
 *      reads back as after a write. The seal is kept only when the round trip still
 *      reads back the same block with the same words, so a provider whose
 *      conversion drops the end line OR reformats the person's words is skipped
 *      with its own log line, and the person's text is filed exactly as written —
 *      never silently reformatted. Jira declares its markdown → ADF → markdown
 *      round trip, which turns the end line's `*…*` into `_…_`, so Jira is skipped
 *      today (a review-ledger item for LIN-4352's PR).
 *
 * Why a provider method and not a provider-name list: the check is the provider's
 * real behaviour on the real body, so a provider whose conversion is fixed starts
 * sealing without a code change here, and a new converting provider only has to
 * declare its round trip. The first-dispatch seal (lib/dispatch-factory.js, beat 3)
 * calls the same `sealForFiling`, so "this provider can't hold a block" is decided
 * in one place for every lane.
 *
 * `sealAccessFrom` builds the first-dispatch seal's `{ read, write }` from the
 * provider and token a dispatch lane already holds (lib/dispatch-entrance.js and the
 * feedback route each build theirs from the same resolver as the lane's
 * `readPlanBlock`, so the two cannot drift apart).
 *
 * Logs (one line per unsealed outcome that is not "nothing to seal"):
 *   [as-asked] filed unsealed: the body already holds a marker line (<lane>)
 *   [as-asked] seal skipped: provider <name> cannot hold the block (<lane>)
 */
import { sealAsAsked, checkAsAsked, hasMarkerLine } from './as-asked.js';
import { normalizeWritePayload } from './proxy-graphql-errors.js';

/**
 * Whether `provider` stores `sealed` so that it reads back as the same block with
 * the same words. True for a provider with no declared round trip (it stores the
 * markdown as sent); false when the round trip throws.
 *
 * @param {object} provider
 * @param {string} sealed - a description that holds a block
 * @returns {boolean}
 */
export function providerHoldsAsAsked(provider, sealed) {
  if (typeof provider?.descriptionRoundTrip !== 'function') return true;
  let readBack;
  try {
    readBack = provider.descriptionRoundTrip(sealed);
  } catch {
    return false;
  }
  return checkAsAsked(sealed, readBack).kind === 'kept';
}

/**
 * The description to file: `words` sealed into the block, then `below` after the
 * end line — or, when the seal does not apply, `words` and `below` joined exactly
 * as an unsealed filing always was (`\n\n` between them).
 *
 * @param {object} args
 * @param {object} args.provider - the provider the description will be written through
 * @param {string|null|undefined} args.words - the text as filed (goes inside the block)
 * @param {string} [args.below] - code-written text that belongs after the end line
 * @param {string} args.lane - which lane is filing, for the log line
 * @returns {{ description: string, sealed: boolean, reason?: 'empty'|'marker'|'provider' }}
 */
export function sealForFiling({ provider, words, below = '', lane }) {
  const text = typeof words === 'string' ? words : '';
  const unsealed = [text, below].filter(Boolean).join('\n\n');
  if (!text.trim()) return { description: unsealed, sealed: false, reason: 'empty' };
  if (hasMarkerLine(text)) {
    console.log(`[as-asked] filed unsealed: the body already holds a marker line (${lane})`);
    return { description: unsealed, sealed: false, reason: 'marker' };
  }
  const sealed = below ? `${sealAsAsked(text)}\n\n${below}` : sealAsAsked(text);
  if (!providerHoldsAsAsked(provider, sealed)) {
    console.log(`[as-asked] seal skipped: provider ${provider?.name || 'unknown'} cannot hold the block (${lane})`);
    return { description: unsealed, sealed: false, reason: 'provider' };
  }
  return { description: sealed, sealed: true };
}

/** What `read` answers when the lane's resolver yields no provider or no token. */
export const SEAL_NO_ACCESS = Object.freeze({ noAccess: true });

/**
 * The first-dispatch seal's access, from a lane's own `{ provider, token }`.
 * `resolveAccess` is that lane's resolver (sync or async; its throw or a missing
 * provider/token means no access). Both methods take the identifier the FACTORY
 * passes — `{ urlKey, issueIdentifier }`, as `readPlanBlock` does — and never one
 * captured here: on the recommend descent arm the row names the terminal issue,
 * not the one the caller asked about.
 *
 *   read({ urlKey, issueIdentifier }) → { id, description, provider } | null | SEAL_NO_ACCESS
 *     Reads through `issueDescription` where the provider has it (the read the
 *     proxy guard and description/below make, so the sealed block and the guarded
 *     block come from one read path), else `fetchIssueContext`. A missing or
 *     trashed issue answers null.
 *   write({ urlKey, issueIdentifier, id, description }) → boolean
 *     Writes through the same provider's `updateIssue`, keyed by the id `read`
 *     returned (GitHub and Jira take their own id). True only when the provider
 *     reports the write landed.
 *
 * @param {() => ({provider: object, token: *}|null|Promise<{provider: object, token: *}|null>)} resolveAccess
 * @returns {{ read: Function, write: Function }}
 */
export function sealAccessFrom(resolveAccess) {
  const resolve = async () => {
    try {
      const access = await resolveAccess();
      return access?.provider && access.token ? access : null;
    } catch {
      return null;
    }
  };
  return {
    async read({ issueIdentifier }) {
      const access = await resolve();
      if (!access) return SEAL_NO_ACCESS;
      const { provider, token } = access;
      let issue = null;
      if (typeof provider.issueDescription === 'function') {
        issue = await provider.issueDescription(token, issueIdentifier);
      } else if (typeof provider.fetchIssueContext === 'function') {
        const context = await provider.fetchIssueContext(token, issueIdentifier);
        issue = context?.issue || null;
      } else {
        return SEAL_NO_ACCESS;
      }
      if (!issue || issue.trashed) return null;
      return { id: issue.id ?? issueIdentifier, description: issue.description ?? '', provider };
    },
    async write({ issueIdentifier, id, description }) {
      const access = await resolve();
      if (!access || typeof access.provider.updateIssue !== 'function') return false;
      const result = normalizeWritePayload(await access.provider.updateIssue(access.token, id ?? issueIdentifier, { description }), 'issue');
      return Boolean(result?.success && result.issue);
    }
  };
}
