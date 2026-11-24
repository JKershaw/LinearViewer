/**
 * LIN-4492 (plan decision 2): who a records write is filed as. Pure: it reads two run rows and a
 * credential, and decides. It touches no store: the records routes (routes/proxy-records.js, LIN-4493) read the
 * runs from the records store (the open/ended state and the lineage the run record keeps) and call it.
 *
 * There are exactly three outcomes, and nothing falls through to a person:
 *   (i)   the credential is positively a person's: filed as `person:<createdBy>`;
 *   (ii)  the credential is a dispatch credential carrying a run, and the run the write names is open and
 *         shares the token's run lineage: filed as that run's own kind (a stage, `leftover`, `periodical`);
 *   (iii) anything else: refused, with the reason named.
 *
 * Lineage is read through the run's OWN row (`rootItemId`, which a stage or leftover row inherits from its
 * anchor at lib/dispatch-factory.js), never through a wake row's `rootItemId`, which is not its run
 * (lib/dispatch-store.js `runOf`). A row with no `rootItemId` is its own root.
 *
 * Same-lineage writes are allowed (a build's leftover writes as `leftover`); cross-lineage writes are not.
 */

import { TOKEN_ORIGIN } from './stage-writes.js';

/** The reasons a records write is refused. A refusal names one of these, and is never filed as a person. */
export const WRITER_REFUSAL = Object.freeze({
  NO_CREDENTIAL: 'no-credential',
  PREDATES_RUN_IDENTITY: 'predates-run-identity',
  UNKNOWN_ORIGIN: 'unknown-origin',
  PERSON_WITHOUT_OWNER: 'person-without-owner',
  NO_RUN: 'no-run',
  TOKEN_RUN_UNKNOWN: 'token-run-unknown',
  RUN_NOT_NAMED: 'run-not-named',
  RUN_NOT_FOUND: 'run-not-found',
  RUN_ENDED: 'run-ended',
  OTHER_LINEAGE: 'other-lineage'
});

/**
 * The lineage a run belongs to: its row's `rootItemId`, or its own id when it is a root.
 * @param {{id: string, rootItemId?: string|null}} row
 * @returns {string}
 */
export function lineageOfRun(row) {
  return row.rootItemId || row.id;
}

/**
 * Whether a credential is positively a person's own, and whose: `person:<createdBy>`, or null. This is `writerOf`'s
 * branch (i) and nothing else, so the records API and the comment seam (lib/harbour-comment-post.js, LIN-4548) answer
 * "is this a person" by one test: a `person` origin with an owner. A dispatch credential (with a run or without), a
 * person credential with no owner, an unknown origin and a token minted before origin was recorded are all null.
 * @param {{origin?: string|null, createdBy?: string|null}|null} credential
 * @returns {string|null}
 */
export function personOfCredential(credential) {
  if (!credential || credential.origin !== TOKEN_ORIGIN.PERSON || !credential.createdBy) return null;
  return `person:${credential.createdBy}`;
}

/**
 * Decide who a write is filed as.
 * @param {Object} args
 * @param {{origin?: string|null, runRecordId?: string|null, createdBy?: string|null}|null} args.credential
 *   the validated token (lib/proxy-tokens.js `validateToken`): `origin`, `runRecordId`, `createdBy`
 * @param {{id: string, kind: string, open: boolean, rootItemId?: string|null}|null} [args.tokenRun]
 *   the run row the credential carries, when it carries one
 * @param {{id: string, kind: string, open: boolean, rootItemId?: string|null}|null} [args.namedRun]
 *   the run row the write names (`run`), or null when the write names none or no row was found
 * @param {boolean} [args.namedRunGiven=false] whether the write named a run at all
 * @returns {{ok: true, as: 'person', by: string} | {ok: true, as: 'dispatch', by: string, run: string} | {ok: false, reason: string}}
 */
export function writerOf({ credential, tokenRun = null, namedRun = null, namedRunGiven = false }) {
  if (!credential) return { ok: false, reason: WRITER_REFUSAL.NO_CREDENTIAL };
  const { origin } = credential;
  if (origin === undefined || origin === null) return { ok: false, reason: WRITER_REFUSAL.PREDATES_RUN_IDENTITY };
  if (origin === TOKEN_ORIGIN.PERSON) {
    // (i): a person's own credential. It needs an owner, or it is not a person's to speak for.
    const person = personOfCredential(credential);
    if (!person) return { ok: false, reason: WRITER_REFUSAL.PERSON_WITHOUT_OWNER };
    return { ok: true, as: 'person', by: person };
  }
  if (origin !== TOKEN_ORIGIN.DISPATCH) return { ok: false, reason: WRITER_REFUSAL.UNKNOWN_ORIGIN };
  // (ii) and (iii): a dispatch credential.
  if (!credential.runRecordId) return { ok: false, reason: WRITER_REFUSAL.NO_RUN };
  // The row read must be the run the credential carries: a caller that read the wrong token row is refused.
  if (!tokenRun || tokenRun.id !== credential.runRecordId) return { ok: false, reason: WRITER_REFUSAL.TOKEN_RUN_UNKNOWN };
  if (!namedRunGiven || !namedRun) {
    return { ok: false, reason: namedRunGiven ? WRITER_REFUSAL.RUN_NOT_FOUND : WRITER_REFUSAL.RUN_NOT_NAMED };
  }
  if (namedRun.open !== true) return { ok: false, reason: WRITER_REFUSAL.RUN_ENDED };
  if (lineageOfRun(namedRun) !== lineageOfRun(tokenRun)) return { ok: false, reason: WRITER_REFUSAL.OTHER_LINEAGE };
  return { ok: true, as: 'dispatch', by: namedRun.kind, run: namedRun.id };
}
