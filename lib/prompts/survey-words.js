/**
 * Each Survey's comment heading, before its `: <ticket> @ <base>` tail (LIN-4248, LIN-4369). LIN-4520: the
 * Survey templates and scoping no longer render it (a Survey still posts its report as one comment, with no
 * heading format). LIN-4535: who wrote a comment is decided by tracker author id (lib/comment-ingest.js), not by its
 * words, so nothing in production reads this any more; only tests import it, to build a headed Survey comment. Moved here from lib/prompt-template-defs.js by
 * LIN-4437: a LEAF, it imports nothing (lesson LIN-4376).
 */
export const SURVEY_HEADINGS = Object.freeze({ 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' });
