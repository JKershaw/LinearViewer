// Seams & Tangles run 12 (LIN-4444): the landing split on an agent note. Run from the repo root:
//   node docs/reviews/_evidence-2026-11-13-run12/landing-agent-note-repro.mjs
// Fixture shape copied from tests/unit/lin-4438-blind-read-gate.test.js (review, summary).
import { readFileSync } from 'node:fs';
import { assembleTrailFacts } from '../../../lib/recommendation-facts.js';
import { landingPrUrls } from '../../../lib/run-ledger.js';
import { blindReadStep } from '../../../lib/recommendation-blind-read.js';
const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const REVIEWED = 'aaaaaaa1111111';
const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one | In | CI |\n\nVerdict: **${verdict}**`);
const summary = (n) => c(n, `Implementation done: ${PR1}, CI green.`);
const cases = {
  autopilotNote: [summary(1), review(2), c(3, `autopilot: fix pushed, see ${PR1}`)],
  plainNote: [summary(1), review(2), c(3, `Fixed the nits, see ${PR1}`)],
  noNote: [summary(1), review(2)],
};
for (const [name, comments] of Object.entries(cases)) {
  const facts = assembleTrailFacts(comments, '', { leaf: false });
  const step = blindReadStep({ state: { type: 'started' } }, { comments });
  console.log(name.padEnd(12), 'workAfterReview=', String(facts.workAfterReview).padEnd(5), 'landing=', landingPrUrls(comments).length, 'blindReadStep=', step ? step.step : null);
}
