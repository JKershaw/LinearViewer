/**
 * LIN-4374 (piece 3 of LIN-4347): review reads the leftovers, close-out writes the notes; reshaped by
 * LIN-4438 (piece 3 of LIN-4396), which retired review's edges read to the blind read.
 *
 * - Review no longer reads what the change left at its edges (the blind read does, before close-out).
 *   It keeps one sentence: the builder's `Retires:` line names a waiting entry this diff removes, a
 *   check the blind reader cannot make, since it never sees the leftovers.
 * - Close-out takes over the builder's hand-off: Follow-up Triage takes the `### Leftovers` lines
 *   marked for close-out through the gate, in the leaf's one spelling of that mark (`FOR_CLOSE_OUT`),
 *   which the leftover prompt asks for in the same words.
 * - Close-out writes review's note entries into `docs/areas/<slug>.md` on the PR branch before
 *   the merge, stays the only filer, and states the one-home rule in Follow-up Triage.
 * - The heading and where a leftover goes have one spelling each, in the leaf
 *   `lib/prompts/leftover-words.js` (LIN-4376), rendered verbatim by the leftover prompt and close-out.
 * - The two post-merge readers (`retrospective-audit`, `retro`) are left as they were.
 *
 * Run with: node --test tests/unit/lin-4374-review-leftover-read.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePrompt } from '../../lib/prompt-templates.js';
import { LEFTOVERS_HEADING, LEFTOVER_RULE, CONSEQUENCE_TEST, RETIRES_LABEL, RETIRES_NONE, FOR_CLOSE_OUT } from '../../lib/prompts/leftover-words.js';
import * as dispatchFields from '../../lib/dispatch-fields.js';
import * as dispatchLeftover from '../../lib/dispatch-leftover.js';
import { leftoverPrompt } from '../../lib/dispatch-leftover.js';
import { SIZE_OF_MOVE_HEADING } from '../../lib/size-of-move.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const ISSUE = {
  id: 'issue-4374', identifier: 'LIN-9001', title: 'Leftover read fixture', description: 'Some work',
  url: 'https://linear.app/test/issue/LIN-9001', state: { name: 'In Progress', type: 'started' },
  labels: [], createdAt: '2026-11-01T00:00:00.000Z'
};
const CONTEXT = { parent: null, siblings: [], project: null, children: [], comments: [] };

const render = (kind) => {
  const out = generatePrompt(kind, ISSUE, CONTEXT, {});
  return typeof out === 'string' ? out : out.prompt;
};

/** The text from a `### ` heading to the next `### ` or `## ` heading. */
function section(prompt, heading) {
  const start = prompt.indexOf(`### ${heading}`);
  assert.ok(start >= 0, `the prompt has a "### ${heading}" section`);
  const rest = prompt.slice(start + 4 + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('review keeps its retirement check and no longer reads the edges (LIN-4438)', () => {
  const review = render('review');

  test('review keeps its Retires: sentence, in the leaf\'s words', () => {
    assert.ok(review.includes('Check that the `' + RETIRES_LABEL + '` line of the builder\'s `' + LEFTOVERS_HEADING + '` comment names a waiting entry this diff removes.'), 'the one sentence');
  });

  test('review no longer reads the edges', () => {
    assert.ok(!review.includes('What the change left at its edges'), 'the edges paragraph is gone');
    assert.ok(!review.includes(LEFTOVER_RULE), 'review renders no leftover rule');
    assert.doesNotMatch(review, /Read the diff against the builder's/);
    assert.doesNotMatch(review, /A leftover alone is never Request Changes/);
  });
});

describe('close-out takes the builder\'s hand-off (LIN-4438)', () => {
  test('Follow-up Triage takes the lines marked for close-out through the gate, in the shared label', () => {
    const triage = section(render('close-out'), 'Follow-up Triage');
    assert.ok(triage.includes('Take the builder\'s `' + LEFTOVERS_HEADING + '` lines marked ' + FOR_CLOSE_OUT + ' through it too.'), triage);
    assert.ok(triage.indexOf(CONSEQUENCE_TEST) < triage.indexOf(FOR_CLOSE_OUT + ' through it'), 'beside the gate it goes through');
  });

  test('the leftover prompt renders the same label, from the leaf, in both places', () => {
    const PROMPT = leftoverPrompt({ issueIdentifier: 'LIN-9001', prUrl: 'https://github.com/o/r/pull/1' });
    assert.equal(FOR_CLOSE_OUT, 'for close-out');
    assert.ok(PROMPT.includes(`note; ${FOR_CLOSE_OUT}, list only ticket-bound ones`));
    assert.ok(PROMPT.includes(`any area's note / ${FOR_CLOSE_OUT}, a ticket only`));
    const src = readFileSync(join(ROOT, 'lib/dispatch-leftover.js'), 'utf8');
    assert.ok(!src.includes(FOR_CLOSE_OUT), 'lib/dispatch-leftover.js renders the label, never retypes it');
  });
});

describe('close-out: writes review\'s note entries and states the one-home rule (LIN-4374)', () => {
  const prompt = render('close-out');

  test('the note entries are written on the PR branch before the merge, alongside the fixes', () => {
    const fixes = section(prompt, 'Make the Fixes Review Asked For');
    assert.match(fixes, /Write each note entry review named, and any note-bound outside find you notice yourself, in its own area or another, into that area's `docs\/areas\/<slug>\.md` on the PR branch the same way, before the merge\./);
    assert.match(prompt, /Make the fixes and write every note entry review named/, 'Workflow step 2 names them');
  });

  test('Follow-up Triage states the one-home rule in the shared words, and close-out stays the only filer', () => {
    const triage = section(prompt, 'Follow-up Triage');
    assert.ok(triage.includes(LEFTOVER_RULE), 'renders LEFTOVER_RULE verbatim');
    assert.match(triage, /Only the gate's tickets are filed here/);
  });

  test('the prune still keeps the size record word for word (LIN-4368)', () => {
    assert.ok(prompt.includes('Keep the `' + SIZE_OF_MOVE_HEADING + '` section verbatim'), 'the prune line is unchanged');
  });
});

describe('the leftover heading and rule have one spelling each (LIN-4374, LIN-4376)', () => {
  const OWNER = 'lib/prompts/leftover-words.js';
  const PROMPT = leftoverPrompt({ issueIdentifier: 'LIN-9001', prUrl: 'https://github.com/o/r/pull/1' });

  test('the leftover prompt and close-out each render the heading and rule from the leaf', () => {
    assert.ok(PROMPT.includes('`' + LEFTOVERS_HEADING + '`'), 'leftover prompt: the heading');
    assert.ok(PROMPT.includes(LEFTOVER_RULE), 'leftover prompt: the rule');
    assert.ok(render('close-out').includes('`' + LEFTOVERS_HEADING + '`'), 'close-out: the heading');
    assert.ok(render('close-out').includes(LEFTOVER_RULE), 'close-out: the rule');
  });

  test('the heading has left lib/dispatch-fields.js and is not re-exported by lib/dispatch-leftover.js', () => {
    assert.equal(dispatchFields.LEFTOVERS_HEADING, undefined);
    assert.equal(dispatchLeftover.LEFTOVERS_HEADING, undefined);
  });

  // LIN-4414: the leftover answer's retirement line, asked by the prompt and checked at the proxy.
  test('the leftover prompt asks for an answer that starts with the heading and names one retirement in the leaf\'s words', () => {
    assert.ok(PROMPT.includes('that starts with the line `' + LEFTOVERS_HEADING + '`'), 'the answer opens with the heading');
    for (const words of [RETIRES_LABEL, RETIRES_NONE.noWaiting, RETIRES_NONE.nothingFixSized]) {
      assert.ok(PROMPT.includes('`' + words + '`'), `renders ${words} from the leaf`);
    }
    const settle = PROMPT.indexOf('settle one waiting entry');
    assert.ok(settle > 0, 'asks the builder to settle one waiting entry');
    assert.ok(settle < PROMPT.indexOf('Push, let CI settle'), 'before the push, so the restated head SHA carries the retirement');
    assert.match(PROMPT, /else try your other touched areas/, 'nothing fix-sized means no touched area has one');
  });

  // Distinctive pieces of the rule, and the retirement words (LIN-4414): a file that retypes any of them restates it.
  // The gate's body without its header: retyping it under another header is still a restatement (LIN-4401).
  const CONSEQUENCE_HEADER = 'Consequence test for an outside find: ';
  const CONSEQUENCE_BODY = CONSEQUENCE_TEST.slice(CONSEQUENCE_HEADER.length);
  const RULE_PIECES = [LEFTOVER_RULE, 'a note is known but not scheduled', 'or a ticket the consequence test sends', CONSEQUENCE_TEST, CONSEQUENCE_BODY, 'Consequence test for an outside find:', RETIRES_LABEL, RETIRES_NONE.noWaiting, RETIRES_NONE.nothingFixSized];

  test('the gate\'s body is the constant less its header', () => {
    assert.ok(CONSEQUENCE_TEST.startsWith(CONSEQUENCE_HEADER), 'the header is the constant\'s opening');
    assert.ok(!CONSEQUENCE_BODY.includes(CONSEQUENCE_HEADER) && CONSEQUENCE_BODY.length > 300, 'the body is the rest');
  });

  test('no other file in lib/ or routes/ spells the heading, the rule or the retirement words', () => {
    const offenders = [];
    for (const dir of ['lib', 'routes']) {
      const walk = (rel) => {
        for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
          const path = `${rel}/${ent.name}`;
          if (ent.isDirectory()) walk(path);
          else if (ent.name.endsWith('.js') && path !== OWNER) {
            const text = readFileSync(join(ROOT, path), 'utf8');
            if (text.includes(LEFTOVERS_HEADING) || RULE_PIECES.some((piece) => text.includes(piece))) offenders.push(path);
          }
        }
      };
      walk(dir);
    }
    assert.deepEqual(offenders, [], `import LEFTOVERS_HEADING, LEFTOVER_RULE, CONSEQUENCE_TEST, RETIRES_LABEL and RETIRES_NONE from ${OWNER} instead of retyping them`);
  });
});

describe('the post-merge readers are left as they were (LIN-4374)', () => {
  test('retro carries neither the leftover read nor the one-home sentence', () => {
    const prompt = render('retro');
    assert.ok(!prompt.includes(LEFTOVERS_HEADING));
    assert.ok(!prompt.includes('One home for each leftover'));
  });

  // LIN-4432 (piece B, verdict note / D5): the audit gains the gate, and only the gate.
  test('retrospective-audit renders the consequence test once, and still neither the leftover read nor the one-home sentence', () => {
    const prompt = render('retrospective-audit');
    assert.equal(prompt.split(CONSEQUENCE_TEST).length - 1, 1, 'the audit renders CONSEQUENCE_TEST exactly once');
    assert.ok(!prompt.includes(LEFTOVERS_HEADING));
    assert.ok(!prompt.includes('One home for each leftover'));
  });
});
