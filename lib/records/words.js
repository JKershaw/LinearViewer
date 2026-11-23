/**
 * LIN-4518 (finding 398df7e5): the records words that the landing (lib/records/landing.js) and the standing
 * (lib/records/standing.js) both read, spelled once. If the landing and the standing spelled a word apart, changing it in
 * one would split the round they cut: the landing's cut would read a different review from the standing's. Lib/records/
 * imports only Platform, so the verdict vocabulary that is not a records word stays injected (lib/prompts/blind-read-words.js).
 */

/** The verdict judgement of a review (lib/records/kinds.json outcome sets). */
export const REVIEW_JUDGEMENT = 'review';

/** LIN-4533: the judgement of a periodical's adversarial second read (lib/records/kinds.json outcome set: agree | disagree). */
export const ADVERSARIAL_READ_JUDGEMENT = 'adversarial-read';

/** The stage kind a close-out run is filed under. */
export const CLOSE_OUT_STAGE = 'close-out';

/** The stage kind an audit run is filed under (lib/prompts/stage-kinds.js). */
export const AUDIT_STAGE = 'retrospective-audit';
