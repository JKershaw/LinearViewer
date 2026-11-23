/**
 * LIN-4535: a test's person comments, read the way the ticket reads them. A person's comment is a finding by `person:<id>`
 * (lib/comment-ingest.js); a fixture marks its person comments with `person: true`, and this helper gives each one the
 * fixed id the ingest would have written and returns the findings the entrance hands the selector and look-first.
 */
import { personFindingsOf } from '../../../lib/comment-ingest.js';
import { fixedIdOf } from '../../../lib/records/refs.js';

/**
 * The comments with a commentId on each person comment, and the person findings they make.
 * @param {Array<{body: string, createdAt: string, person?: boolean, commentId?: string}>} comments
 * @param {string} [accountId]
 * @returns {{comments: Array<object>, personFindings: Array<object>}}
 */
export function withPersonFindings(comments, accountId = 'john') {
  const marked = comments.map((c, i) => (c.person ? { ...c, commentId: c.commentId || `c-${i}` } : c));
  const findings = marked.filter((c) => c.person).map((c) => ({
    id: fixedIdOf('finding', 'comment', c.commentId),
    by: `person:${accountId}`,
    via: 'comment',
    at: c.createdAt,
    fields: { says: c.body }
  }));
  return { comments: marked, personFindings: personFindingsOf(findings) };
}
