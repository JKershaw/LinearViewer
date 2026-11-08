/**
 * LIN-4369 (LIN-4346 piece 3): scoping's output becomes the size record.
 *
 * Scoping no longer writes an In / Out / Assumptions / Success block. It reads the Surveys and
 * the trail, weighs the sizes from "just the task" to "wrong work", recommends one, and writes
 * one `## Size of the move` section of four lines (arm 3), whose words and shape come from
 * lib/size-of-move.js and whose shape the proxy guard holds. With a standing
 * policy (rendered by code) it applies it; without one the size is pending a ruling and raised as
 * a `DECISION:`. A size that cuts the ask is a cut under CUT, which stays rendered once.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { SURVEY_HEADINGS } from '../../lib/prompt-template-defs.js';
import { CUT } from '../../lib/prompts/stage-intent.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { AS_ASKED_HEADING } from '../../lib/as-asked.js';
import {
  SIZE_OF_MOVE_HEADING, SIZES, DECIDED_BY, SIZE_LABEL, WHY_LABEL, CUTS_LABEL, DECIDED_BY_LABEL, RECORD_LINES, NO_CUTS, WRONG_WORK,
  readSizeRecord, checkSizeRecord, recordShape
} from '../../lib/size-of-move.js';

const END = '*End of what was asked. Steps write below this line; nothing above it changes.*';
const ISSUE = {
  id: 'i-4369', identifier: 'LIN-4369', title: 'Size fixture',
  description: `${AS_ASKED_HEADING}\n\nMake Brief and Recap populate on open.\n\n${END}`,
  url: 'https://linear.app/test/issue/LIN-4369', createdAt: '2026-11-08T00:00:00.000Z',
  state: { name: 'Todo', type: 'unstarted' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const ERR_LARGER = { value: 'err-larger', setAt: '2026-11-07T22:18:14.300Z' };
const render = (sizePolicy) => generatePrompt('scoping', ISSUE, { ...CONTEXT, sizePolicy }).prompt;
const count = (text, needle) => text.split(needle).length - 1;
const processOf = (prompt) => prompt.slice(prompt.indexOf('## Process'));

describe('scoping writes the size record (LIN-4369)', () => {
  test('the In / Out / Assumptions / Success block is gone', () => {
    const p = render();
    for (const old of ['**In Scope**', '**Out of Scope**', '**Assumptions**', '**Success Criteria**', '**Open Questions**']) {
      assert.ok(!p.includes(old), `scoping no longer renders ${old}`);
    }
  });

  test('it writes one size section, in the record\'s shape rendered from the module, every size and decided-by value in it', () => {
    const p = processOf(render());
    assert.equal(count(p, `\`${SIZE_OF_MOVE_HEADING}\``), 1, 'names the one section it writes');
    const lines = p.split('\n');
    const at = lines.indexOf(recordShape()[0]);
    assert.ok(at > 0, 'the shape is rendered line for line');
    assert.deepEqual(lines.slice(at, at + RECORD_LINES.length), recordShape(), 'the four lines, in order, each on its own line');
    assert.ok(p.includes(SIZES.join(' / ')), 'lays out every size, smallest first');
    assert.ok(p.includes(`**${DECIDED_BY_LABEL}:** ${Object.values(DECIDED_BY).join(' / ')}`), 'every decided-by value');
  });

  test('the template keeps no second spelling of the sizes or decided-by values', () => {
    const src = readFileSync(new URL('../../lib/prompt-template-defs.js', import.meta.url), 'utf8');
    for (const word of [...SIZES.slice(1), DECIDED_BY.pending, DECIDED_BY.policy]) {
      assert.ok(!src.includes(word), `lib/prompt-template-defs.js spells "${word}" itself; read it from lib/size-of-move.js`);
    }
  });

  test('a record written with the lines the prompt names reads back through the parser and passes the guard', () => {
    const record = [
      SIZE_OF_MOVE_HEADING, '',
      `**${SIZE_LABEL}:** ${SIZES[0]}`,
      `**${WHY_LABEL}:** The Surveys find nothing this task binds on, so doing it as asked delivers what was asked.`,
      `**${CUTS_LABEL}:** ${NO_CUTS}`,
      `**${DECIDED_BY_LABEL}:** ${DECIDED_BY.policy} (err larger)`
    ].join('\n');
    const next = `${ISSUE.description}\n\n${record}`;
    assert.deepEqual(checkSizeRecord(ISSUE.description, next), { ok: true });
    const read = readSizeRecord(next);
    assert.equal(read.size, SIZES[0]);
    assert.equal(read.decidedBy, 'policy');
  });

  test('"just the task" is as easy to recommend as any, and is the answer when the Surveys find nothing it binds on', () => {
    const p = processOf(render());
    assert.match(p, new RegExp(`"${SIZES[0]}" is as easy to recommend as any, and is the answer when the Surveys find nothing this task binds on`));
  });

  // Arm 2 (LIN-4369 ruling efde8688): the first replay's control sized up on Survey findings that
  // were deeper or nearby. Arm 3 keeps the definition of "binds"; such findings stay in the Surveys.
  test('a finding binds only when the asked change would not work, or would leave its problem in place, without it', () => {
    const p = processOf(render());
    assert.match(p, /A finding binds on this task only when the asked change would not work, or would leave the problem it fixes in place, without it;/);
    assert.match(p, /a finding that is nearby, deeper or merely worth doing does not, and stays in the Surveys\./);
  });

  test('arm 2: the standing policy weighs the sizes a binding finding opens and never makes a finding bind', () => {
    assert.match(processOf(render(ERR_LARGER)), /apply it and say so: it weighs the sizes a binding finding opens, and never makes a finding bind\./);
  });

  // Arm 3 (John's structural ruling, decision lin4346-size-after-arm2): the record is four lines and
  // nothing else. The proxy guard holds the shape (tests/unit/size-of-move.test.js); this pins what
  // the prompt tells scoping about it.
  test('arm 3: the record is its four lines and nothing else, and the prompt says the proxy refuses any other line', () => {
    const p = processOf(render());
    assert.ok(p.includes(`Write one \`${SIZE_OF_MOVE_HEADING}\` section (append it, or replace your own) of these four lines and nothing else: the proxy refuses any other line, so no sizes weighed, plan, definitions or open questions.`));
    assert.match(p, /The why says what and why, never how: name an extra by the behaviour it changes, with no backticks, paths or code names\./);
    for (const gone of ['under 200 words', 'It is not a plan', 'open questions as a possible ticket', 'Code reads two lines']) {
      assert.ok(!p.includes(gone), `arm 2's "${gone}" is gone`);
    }
  });

  test('arm 3: a record of the lines the prompt asks for is accepted, and a line it rules out is refused', () => {
    const base = `${ISSUE.description}\n\n${SIZE_OF_MOVE_HEADING}\n\n`;
    const four = [`**${SIZE_LABEL}:** ${SIZES[1]}`, `**${WHY_LABEL}:** A small tidy first lets the asked change land on one home.`, `**${CUTS_LABEL}:** ${NO_CUTS}`, `**${DECIDED_BY_LABEL}:** ${DECIDED_BY.pending}`];
    assert.deepEqual(checkSizeRecord(ISSUE.description, base + four.join('\n')), { ok: true });
    for (const ruledOut of [`- ${SIZES[0]}: delivers the ask.`, 'Open questions: none.', 'Done means both sections fill on open.']) {
      assert.equal(checkSizeRecord(ISSUE.description, `${base}${four.join('\n')}\n${ruledOut}`).code, 'SIZE_RECORD_SHAPE', ruledOut);
    }
  });

  test('arm 2: scoping\'s lead settles the size of the move, not "what done means"', () => {
    const p = render();
    const lead = p.slice(p.indexOf('## Goal') + '## Goal'.length, p.indexOf('## Scope and Authority')).trim();
    assert.equal(lead, 'Settle how big a move this ticket makes, and why: what, never how. Read the code first.');
    assert.ok(!p.includes('what done means. Read the code first'), 'the old lead is gone');
  });

  test('it reads both Survey comments by their headings, the filing comments, and a subtask\'s parent record', () => {
    const p = processOf(render());
    assert.ok(p.includes(`\`${SURVEY_HEADINGS['survey-task']}\``) && p.includes(`\`${SURVEY_HEADINGS['survey-place']}\``));
    assert.match(p, /the comments filed with the ticket/);
    assert.match(p, /for a subtask its parent's size record/);
    assert.match(p, new RegExp(`A person's size comment on the trail is their ruling: record it as decided by ${DECIDED_BY.ruling}\\.`));
  });

  test('each Survey template opens its comment with the heading scoping reads', () => {
    for (const kind of ['survey-task', 'survey-place']) {
      const p = generatePrompt(kind, ISSUE, CONTEXT).prompt;
      assert.ok(p.includes(`\`${SURVEY_HEADINGS[kind]}: ${ISSUE.identifier} @ {BASE}\``), kind);
    }
  });
});

describe('policy and no-policy rendering (LIN-4369)', () => {
  test('with err-larger: the policy line is rendered and scoping is told to apply it and say so', () => {
    const p = render(ERR_LARGER);
    assert.match(p, /\*\*Standing size policy:\*\* err larger: take the larger move when the look shows it pays/);
    assert.match(processOf(p), /With a standing policy, apply it and say so:/);
  });

  test('with no policy: "no standing policy" is rendered, and the size is pending a ruling raised as a `DECISION:`', () => {
    for (const policy of [undefined, { value: 'ask' }]) {
      const p = render(policy);
      assert.match(p, /\*\*Standing size policy:\*\* no standing policy/);
      assert.ok(processOf(p).includes(`Without one, the size is ${DECIDED_BY.pending}: raise it as a \`DECISION:\`.`));
    }
  });

  test('the policy never decides a cut: a size smaller than the ask, or wrong work, is a cut', () => {
    assert.ok(processOf(render(ERR_LARGER)).includes(`A size smaller than the ask, or ${WRONG_WORK}, is a cut; the standing policy never decides one.`));
  });

  test('CUT is still rendered exactly once, with and without a policy', () => {
    assert.equal(count(render(), CUT), 1);
    assert.equal(count(render(ERR_LARGER), CUT), 1);
  });

  test('the policy changes only the policy line', () => {
    const strip = (p) => p.split('\n').filter(l => !l.startsWith('**Standing size policy:**')).join('\n');
    assert.equal(strip(render()), strip(render(ERR_LARGER)));
  });
});

describe('scoping\'s completion signals (LIN-4369)', () => {
  const { coreOutcome, signals } = COMPLETION_SIGNALS.scoping;

  test('they check the size record, not the old block', () => {
    assert.match(coreOutcome, /size of the move/i);
    assert.ok(signals.some(s => s.includes(SIZE_OF_MOVE_HEADING) && s.includes(`only the record's ${RECORD_LINES.length} lines`)), 'one section, holding only its lines');
    assert.ok(signals.some(s => s.includes(SIZES[0]) && s.includes(WRONG_WORK)), 'sizes weighed from just the task to wrong work');
    assert.ok(signals.some(s => /standing policy/.test(s) && s.includes('`DECISION:`')), 'policy, or pending with a DECISION:');
    assert.ok(signals.some(s => /Survey comments/.test(s)), 'Surveys read');
    for (const old of [/In scope items/, /Out of scope items/, /Assumptions stated/, /Success criteria defined/]) {
      assert.ok(!signals.some(s => old.test(s)), `no ${old}`);
    }
  });
});
