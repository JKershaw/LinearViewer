/**
 * LIN-4542 (LIN-4529 P8, plan D7): scoping records the size of the move as a plain `decision` record on the task, and
 * asks only to cut part of the ask or call it the wrong work.
 *
 * Was LIN-4369's size record test: a `## Size of the move` section of four fixed lines in the description, held by a
 * proxy guard. That section, its list of sizes, its guard and its vocabulary module (lib/size-of-move.js) are retired.
 * What stays from LIN-4369: scoping reads the Surveys and the filed findings, weighs from just the task upward, keeps the
 * definition of "binds", applies the built-in standing policy (err larger, LIN-4393), which never decides a cut, says
 * what and why, never how, and posts no comment.
 *
 * Witness (no model calls, per the standing answers): the prompt sends a size inside the ask to one decision and no
 * question, and a smaller-than-asked size or wrong work to one question and `BLOCKED:` with no decision; the completion
 * signals check the same. The records side (the decision is what the selector and look-first read) is pinned in
 * tests/unit/lin-4370-look-first-route.test.js and tests/unit/recommendation-input.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { CUT } from '../../lib/prompts/stage-kinds.js';
import { STANDING_SIZE_POLICY } from '../../lib/prompt-template-defs.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { ASKED_HEADING } from '../../lib/records/words.js';

const ISSUE = {
  id: 'i-4542', identifier: 'LIN-4542', title: 'Size fixture',
  description: 'Make Brief and Recap populate on open.',
  url: 'https://linear.app/test/issue/LIN-4542', createdAt: '2026-11-24T00:00:00.000Z',
  state: { name: 'Todo', type: 'unstarted' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const render = (context = CONTEXT) => generatePrompt('scoping', ISSUE, context).prompt;
const count = (text, needle) => text.split(needle).length - 1;
const processOf = (prompt) => prompt.slice(prompt.indexOf('## Process'));

describe('scoping writes the size as one decision record (LIN-4542)', () => {
  test('a size inside the ask is one `decision` on the task: the size as its answer, one sentence of why, and nothing else written', () => {
    const p = processOf(render());
    assert.ok(p.includes("Write the size as one `decision` record: `POST /api/proxy/records` with `kind` decision, `in` this ticket, `scope` this task's id (the `task-` id your brief opens with), `answer` the size in a few words, `why` one sentence saying what this size delivers and why, and your `run`."));
    assert.ok(p.includes('That record is all you write: no description edit and no comment; your reasoning goes in your final message.'));
    assert.match(render(), /4\. \*\*Record\*\*: Write the size of the move as one `decision` record on the task/);
  });

  test('a smaller-than-asked size or wrong work is a cut: one question, no decision, the run ends BLOCKED: and the work waits', () => {
    const p = processOf(render());
    assert.ok(p.includes('A size smaller than the ask, or judging the ticket the wrong work, is a cut, and the standing policy never decides one: write no decision and raise it as the Scope and Authority section says. The work waits for the answer, which resumes you to write the decision.'));
    // CUT says how a cut is raised (one `question` record, then `BLOCKED:`); it is rendered exactly once, in the Scope and Authority section.
    const full = render();
    assert.equal(count(full, CUT), 1);
    assert.ok(CUT.includes('raise them as one `question` record') && CUT.includes('Then end `BLOCKED:`.'));
    assert.ok(full.indexOf(CUT) < full.indexOf('## Process'), 'the Scope and Authority section the cut line points at comes before it');
  });

  test('the size section, its fixed lines, its list of sizes and its guard are gone from the prompt', () => {
    const p = render();
    for (const gone of ['## Size of the move', '**Size:**', '**Cuts:**', '**Decided by:**', 'pending a ruling', 'consolidate the decision this task touches', 'the proxy refuses any other line', 'size record', 'into the description']) {
      assert.ok(!p.includes(gone), `scoping no longer renders "${gone}"`);
    }
  });

  test('just the task is as easy to recommend as any, and is the answer when the Surveys find nothing it binds on', () => {
    assert.match(processOf(render()), /Just the task is as easy to recommend as any, and is the answer when the Surveys find nothing this task binds on\./);
  });

  // Arm 2 (LIN-4369 ruling efde8688): such findings stay in the Surveys.
  test('a finding binds only when the asked change would not work, or would leave its problem in place, without it', () => {
    const p = processOf(render());
    assert.match(p, /A finding binds on this task only when the asked change would not work, or would leave the problem it fixes in place, without it;/);
    assert.match(p, /a finding that is nearby, deeper or merely worth doing does not, and stays in the Surveys\./);
  });

  test('what and why, never how', () => {
    assert.match(processOf(render()), /The why says what and why, never how: name an extra by the behaviour it changes, with no backticks, paths or code names\./);
  });

  test('scoping\'s lead settles the size of the move', () => {
    const p = render();
    const lead = p.slice(p.indexOf('## Goal') + '## Goal'.length, p.indexOf('## Scope and Authority')).trim();
    assert.equal(lead, 'Settle how big a move this ticket makes, and why: what, never how. Read the code first.');
  });

  test('it reads both Surveys\' reports, the filed findings, a subtask\'s parent decision, and takes a person\'s word on the size as their ruling', () => {
    const p = processOf(render());
    assert.match(p, /the two Surveys' reports \(the `account` on each of their run records, `survey-task` and `survey-place`: `GET \/api\/proxy\/records\?kind=run&in=<this ticket>`\)/);
    assert.match(p, /the findings filed with the ticket/);
    assert.match(p, /for a subtask its parent's size decision \(`GET \/api\/proxy\/records\?kind=decision&in=<parent ticket>`\)/);
    assert.match(p, /A person's word on the size is their ruling: follow it and say so in the why\./);
  });

  test('each Survey template reports the base it read at, with no headed comment (LIN-4520)', () => {
    for (const kind of ['survey-task', 'survey-place']) {
      const p = generatePrompt(kind, ISSUE, CONTEXT).prompt;
      assert.ok(p.includes('names the base you read at as {BASE}'), kind);
      assert.ok(!p.includes('## Survey'), `${kind}: no Survey heading`);
    }
  });
});

// LIN-4393: the policy is built in, word for word as it was in the retired module.
describe('the built-in policy (LIN-4393, kept by LIN-4542)', () => {
  test('the err-larger line is rendered and scoping is told to apply it and say so', () => {
    const p = render();
    assert.ok(p.includes(`\n${STANDING_SIZE_POLICY}\n`));
    assert.equal(STANDING_SIZE_POLICY, '**Standing size policy:** err larger: take the larger move when the look shows it pays, and when in doubt; it does not mean inflating every ticket, and a small, clear ticket stays just the task.');
    assert.match(processOf(p), /\nApply the standing policy and say so: it weighs the sizes a binding finding opens, and never makes a finding bind\./);
  });

  test('a stale context field from the retired setting changes nothing', () => {
    assert.equal(render({ ...CONTEXT, sizePolicy: { value: 'ask' } }), render());
  });
});

describe('scoping\'s completion signals (LIN-4542)', () => {
  const { coreOutcome, signals, readinessCheck } = COMPLETION_SIGNALS.scoping;

  test('they check the decision, and a question for a cut, never a description section', () => {
    assert.equal(coreOutcome, 'The size of the move, and why, recorded as a decision on the task');
    assert.ok(signals.includes('One `decision` record on the task: the size as its answer, one sentence of why'));
    assert.ok(signals.includes('A cut to the `' + ASKED_HEADING + '` block, or wrong work, raised instead of a decision, the run ending `BLOCKED:`'));
    assert.ok(signals.includes('Settled by a person\'s ruling or the standing policy'));
    assert.ok(signals.some(s => /The two Surveys' reports/.test(s)), 'Surveys read');
    assert.ok(!signals.some(s => /Size of the move|description/.test(s)), 'no description section');
    assert.match(readinessCheck, /Does the decision say plainly/);
  });
});
