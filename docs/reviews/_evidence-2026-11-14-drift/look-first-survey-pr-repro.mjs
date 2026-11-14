// Run 8 (LIN-4481) spike: a survey-task report that cites a PR turns the look-first route off as "has a PR",
// while the one landing (readTrail().landing) holds no PR. Usage (repo root): node docs/reviews/_evidence-2026-11-14-drift/look-first-survey-pr-repro.mjs
import { lookFirstOff, lookFirstStep } from '../../../lib/recommendation-look-first.js';
import { readTrail } from '../../../lib/run-trail.js';
import { sealAsAsked } from '../../../lib/as-asked.js';

const description = sealAsAsked('Make the widget faster.');
const issue = { identifier: 'T-1', description, state: { type: 'unstarted' } };
const survey = { body: '## Survey open-0\n\nThe slow path was added in https://github.com/acme/app/pull/41; start there.', createdAt: '2026-11-14T09:00:00Z' };
const plainSurvey = { body: '## Survey open-0\n\nThe slow path lives in lib/widget.js; start there.', createdAt: '2026-11-14T09:00:00Z' };
const runs = [{ stage: 'survey-task', outcome: 'closed', sentAt: '2026-11-14T08:50:00Z' }];
for (const [name, c] of [['survey cites a PR', survey], ['survey cites no PR', plainSurvey]]) {
  const context = { comments: [c], allRuns: runs, children: [] };
  const trail = readTrail([c]);
  console.log(name, '| landing:', JSON.stringify(trail.landing ?? null), '| lookFirstOff:', JSON.stringify(lookFirstOff(issue, context)), '| lookFirstStep:', JSON.stringify(lookFirstStep(issue, context)?.kind ?? lookFirstStep(issue, context)));
}
