/**
 * Each Survey's comment heading, before its `: <ticket> @ <base>` tail (LIN-4248, LIN-4369). LIN-4520: the
 * Survey templates and scoping no longer render it (a Survey still posts its report as one comment, with no
 * heading format), so the one reader left is lib/run-trail.js, whose authorship text rule still knows a headed
 * Survey comment on older tickets as a report, not landed work. Moved here from lib/prompt-template-defs.js by
 * LIN-4437: a LEAF, it imports nothing (lesson LIN-4376).
 */
export const SURVEY_HEADINGS = Object.freeze({ 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' });
