/**
 * LIN-4353: the LIN-4085 replay, the deterministic part. On 1 November LIN-4085 asked for "a full guide on how to
 * properly configure" Harbour; scoping thinned it, the plan budgeted it, and review
 * approved the thin guide because "the deliverable meets the plan"
 * (docs/papers/harbour/one-feature-twice.md). Replayed through the As-asked change,
 * the filed words must reach the judging step unchanged, and review must start
 * from them before it reads the plan.
 *
 * The fixture is the request exactly as filed (tests/fixtures/lin-4085-filed-request.txt,
 * copied from docs/reviews/lin-4085-ab-run-2026-11-01.md, slips kept). The test does
 * not read that record: the fixture is its input, and the record is a doc that may
 * move, so the provenance lives here and is not re-checked at run time.
 *
 * LIN-4536: the brief a stage reads is the records brief (lib/records/brief.js). No model writes it, so the words
 * reach review as the task's `asked`, under `## As asked`, byte for byte, whatever a stage later wrote into the
 * description (here, the plan that narrowed the ask). Whether a model then catches the thin guide is not a CI
 * question; it is the hand-run replay recorded in the LIN-4353 PR.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/as-asked-lin4085-replay.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBrief } from '../../lib/records/brief.js';
import { index } from '../../lib/records/views.js';
import { ASKED_HEADING } from '../../lib/records/words.js';
import { generatePrompt } from '../../lib/prompt-templates.js';

const FILED = fs.readFileSync(new URL('../fixtures/lin-4085-filed-request.txt', import.meta.url), 'utf8');
const PHRASE = 'a full guide on how to properly configure';

// What LIN-4085's description looked like once worked: the filed words, then the stages' writing below them,
// including the plan that narrowed the ask.
const DESCRIPTION = `${FILED}\n\n## Implementation Plan\n\nAdd a homepage prompt and a short /getting-started page that sequences the human's few clicks, within a size budget of about 4.5 KB.\n\nfits one session\n\nplan-review due: no`;
const ISSUE = { id: 'i-4085', identifier: 'LIN-4085', title: 'Homepage getting-started prompt for agents', description: DESCRIPTION, labels: [], comments: [] };
const CONTEXT = { parent: null, siblings: [], project: { name: 'Harbour' }, children: [], comments: [] };

// The task made when the request was filed: its `asked` is the request as filed, fixed once written.
const TASK = { id: 'task-4085', v: 1, at: '2026-11-01T09:00:00.000Z', kind: 'task', state: 'open', by: 'harbour', links: {}, fields: { asked: FILED, ref: 'LIN-4085' } };

/** The review prompt's Process section: from `## Process` to the first `### ` subsection. */
function processOf(prompt) {
  const start = prompt.indexOf('## Process');
  assert.ok(start > -1, 'the review prompt has a Process section');
  const rest = prompt.slice(start);
  const end = rest.indexOf('\n### ');
  return end > -1 ? rest.slice(0, end) : rest;
}

describe('the LIN-4085 replay, deterministic part (LIN-4353)', () => {
  test('the fixture carries the phrase the run lost', () => {
    assert.ok(FILED.includes(PHRASE), 'the filed request carries the phrase the run lost');
  });

  test('review\'s brief carries the filed words verbatim under `## As asked`, whatever the description later says', () => {
    const { text } = buildBrief({ actor: 'review', taskId: TASK.id, idx: index([TASK]) });
    const part1 = text.slice(text.indexOf(`${ASKED_HEADING}\n`), text.indexOf('\n## 2 Its plan'));
    assert.ok(part1.includes(`\n${FILED}`), 'part 1 holds the filed words, byte for byte');
    assert.ok(part1.includes(PHRASE), `the brief carries "${PHRASE}" verbatim`);
    assert.ok(!text.includes('size budget of about 4.5 KB'), 'the plan a stage wrote into the description is not in part 1');
  });

  // The review prompt points at the block; it does not quote it. Stage prompts never
  // copy the description (formatDiscussionReference, PR #369), and a quote would be the
  // extra copy LIN-4345 decided against. The words reach review through the brief's part 1; review must read them first.
  test('review\'s Process starts from the As asked block, before the plan and the implementation notes', () => {
    const { prompt } = generatePrompt('review', ISSUE, CONTEXT);
    assert.ok(!prompt.includes(PHRASE), 'the review prompt points at the block rather than copying it (#369)');
    const process = processOf(prompt);
    const askedAt = process.indexOf(`\`${ASKED_HEADING}\``);
    const planAt = process.search(/\bthe plan\b/i);
    const notesAt = process.search(/implementation notes/i);
    assert.ok(askedAt > -1, `review's Process names the \`${ASKED_HEADING}\` block; got:\n${process}`);
    assert.ok(planAt > -1 && notesAt > -1, 'review\'s Process still reads the plan and the implementation notes');
    assert.ok(askedAt < planAt && askedAt < notesAt, `the block comes before the plan and the notes; got:\n${process}`);
  });

  // LIN-4345: arm A3's one quoted line cut at an ellipsis before the narrowed clause, so the
  // verdict now accounts for every sentence of the block. Whether a model then catches the
  // thin guide is the hand-run replay (docs/reviews/lin-4345-per-sentence-replay-2026-11-07.md).
  test('review\'s verdict must account for each sentence of the block, none skipped or cut short', () => {
    const { prompt } = generatePrompt('review', ISSUE, CONTEXT);
    const each = prompt.split(/\n/).some(s => /what was asked/i.test(s) && /each sentence of the block/i.test(s) && /none skipped or cut short/i.test(s) && /\bmee?ts?\b|\bmet\b/i.test(s));
    assert.ok(each, 'review\'s verdict takes each sentence of the block and says where the work meets it');
  });
});
