/**
 * Each Survey's comment heading, before its `: <ticket> @ <base>` tail (LIN-4248, LIN-4369). Scoping
 * and both Survey templates render it; the landing reader and the look-first route read it through
 * lib/run-ledger.js `isSurveyReport`. Moved here from lib/prompt-template-defs.js by
 * LIN-4437 so lib/run-ledger.js can read it: a LEAF, it imports nothing (lesson LIN-4376).
 */
export const SURVEY_HEADINGS = Object.freeze({ 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' });
