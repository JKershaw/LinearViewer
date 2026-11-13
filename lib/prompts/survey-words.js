/**
 * Each Survey's comment heading, before its `: <ticket> @ <base>` tail (LIN-4248, LIN-4369). Scoping
 * and both Survey templates render it; the landing reader and the look-first route read it through
 * the Survey rows of lib/run-trail.js `COMMENT_KINDS` (LIN-4458). Moved here from
 * lib/prompt-template-defs.js by LIN-4437 so the trail readers can read it: a LEAF, it imports
 * nothing (lesson LIN-4376).
 */
export const SURVEY_HEADINGS = Object.freeze({ 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' });
