/**
 * Each Survey's comment heading, before its `: <ticket> @ <base>` tail (LIN-4248, LIN-4369). LIN-4520: the
 * Survey templates and scoping no longer render it (a Survey is a dispatched run, and its report is the run's
 * own account), so the one reader left is lib/run-trail.js `COMMENT_KINDS`, which still reads a headed
 * Survey comment on older tickets. Moved here from lib/prompt-template-defs.js by LIN-4437 so the trail
 * readers can read it: a LEAF, it imports nothing (lesson LIN-4376).
 */
export const SURVEY_HEADINGS = Object.freeze({ 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' });
