/**
 * LIN-4345: a stage that decides what gets built names each cut to the `## As asked` block and
 * raises one ruling. The rule has one home, `CUT` in lib/prompts/stage-kinds.js (LIN-4467), inside the
 * DECIDE scope line. So every deciding stage renders it once, and no judging, reading or filing
 * stage renders it at all. A template says only where its cuts are written.
 *
 * LIN-4367: the tests read `CUT` and `DECIDE` themselves, so none pins the rule's wording or
 * keeps its own list of deciding stages. The old source scan for a literal copy of the rule could
 * never fire. The LIN-4362 marker census makes any copy interpolate AS_ASKED_HEADING, so the
 * literal is never in source (blind pass BT on LIN-4150 planted a census-compliant copy, and the
 * scan passed). The scan below looks for the part of `CUT` that a copy must still spell out.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';
import { CUT, DECIDE } from '../../lib/prompts/stage-kinds.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { AS_ASKED_HEADING } from '../../lib/as-asked.js';
import { CUTS_LABEL } from '../../lib/size-of-move.js';

const decides = (kind) => Object.hasOwn(STAGE_INTENT, kind) && STAGE_INTENT[kind][0] === DECIDE;
const DECIDING = Object.keys(STAGE_INTENT).filter(decides);

const ISSUE = {
  id: 'issue-cut', identifier: 'LIN-4345', title: 'Cut rule fixture',
  description: `${AS_ASKED_HEADING}\n\nWrite a full guide.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*`,
  url: 'https://linear.app/test/issue/LIN-4345', createdAt: '2026-11-07T00:00:00.000Z',
  state: { name: 'In Progress', type: 'started' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const count = (text, needle) => text.split(needle).length - 1;

/** The longest stretch of `CUT` with no interpolation in it: what a copy has to spell out in its source. */
const CUT_LITERAL = CUT.split(AS_ASKED_HEADING).reduce((a, b) => (b.length > a.length ? b : a));

/** `source` with the cut rule's literal stretch counted, for the scan and its own mutation test. */
const copiesIn = (source) => count(source, CUT_LITERAL);

const libFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? libFiles(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);

describe('the cut rule has one home (LIN-4345)', () => {
  test('the rule lives in DECIDE, and the deciding stages are the ones whose scope line is DECIDE', () => {
    assert.ok(DECIDE.includes(CUT), 'CUT is part of the DECIDE scope line');
    assert.ok(DECIDING.length > 0, 'at least one stage decides, so the tests below are not vacuous');
    for (const [kind, lines] of Object.entries(STAGE_INTENT)) {
      assert.equal(lines.filter(l => l.includes(CUT)).length, decides(kind) ? 1 : 0, kind);
    }
  });

  test('every deciding stage renders the cut rule exactly once; every other stage never', () => {
    const kinds = Object.keys(PROMPT_TEMPLATES);
    assert.ok(DECIDING.every(k => kinds.includes(k)), 'every deciding stage has a template');
    for (const kind of kinds) {
      const { prompt } = generatePrompt(kind, ISSUE, CONTEXT);
      assert.equal(count(prompt, CUT), decides(kind) ? 1 : 0, kind);
    }
  });

  test('the ruling goes through the closing contract: a `DECISION:` before `BLOCKED:`', () => {
    // Harbour records a ruling only from a DECISION: line; a run that ends DONE: with the ruling
    // in its comment raises none (LIN-4345 replay r06, r13, r14). These are tokens code reads.
    const decision = CUT.indexOf('`DECISION:`');
    assert.ok(decision >= 0 && CUT.indexOf('`BLOCKED:`') > decision);
  });

  test('no other lib/ source spells out a copy of the rule', () => {
    assert.ok(CUT_LITERAL.length > 100, 'the stretch scanned for is the rule, not a fragment of it');
    const found = libFiles('lib').filter(f => f !== join('lib', 'prompts', 'stage-kinds.js') && copiesIn(readFileSync(f, 'utf8')) > 0);
    assert.deepEqual(found, []);
  });

  test('the scan catches a census-compliant copy (the copy BT planted)', () => {
    assert.ok(!CUT_LITERAL.includes("'"), 'the planted copy below is a valid single-quoted string');
    const planted = `const COPY = 'Cutting the \`' + AS_ASKED_HEADING + '${CUT_LITERAL}';`;
    assert.equal(copiesIn(planted), 1);
  });
});

describe('a template says only where its cuts go (LIN-4345, LIN-4367)', () => {
  // The words that belong to the rule: what quoting and ruling mean is CUT's to say.
  // A paraphrase restates the rule too (review M6 on LIN-4367), so its other words count.
  const RULE_WORDS = /\bquot|\bruling|not yours|\bagreed\b|DECISION:/i;
  const cutLines = (text) => text.split('\n').filter(l => /\bcuts?\b/i.test(l) && !l.includes(CUT));

  test('scoping and plan each name a place for their cuts', () => {
    const scoping = generatePrompt('scoping', ISSUE, CONTEXT).prompt;
    // LIN-4369: scoping's cuts live in the size record's Cuts line, not an Out of Scope bullet.
    assert.ok(cutLines(scoping).some(l => l.startsWith(`**${CUTS_LABEL}:**`)), 'scoping writes its cuts in the size record');
    assert.ok(cutLines(generatePrompt('plan', ISSUE, CONTEXT).prompt).length > 0, 'plan lists its cuts');
  });

  test('scoping no longer owns what is in and out of scope, and still reads the code first', () => {
    // LIN-4345's regression guards, restored in LIN-4367 close-out: short fragments, not the rule.
    const scoping = generatePrompt('scoping', ISSUE, CONTEXT).prompt;
    assert.doesNotMatch(scoping, /in and out of scope is yours to decide/);
    assert.doesNotMatch(scoping, /flag for the human only product or intent questions/);
    assert.match(scoping, /Read the code first\./);
  });

  test('no deciding stage restates the rule outside its scope line', () => {
    for (const kind of DECIDING) {
      const restated = cutLines(generatePrompt(kind, ISSUE, CONTEXT).prompt).filter(l => RULE_WORDS.test(l));
      assert.deepEqual(restated, [], kind);
    }
  });

  test('the completion signals check that cuts are listed, without restating the rule', () => {
    for (const kind of ['scoping', 'plan']) {
      const signals = COMPLETION_SIGNALS[kind].signals.filter(s => /\bcuts?\b/i.test(s));
      assert.equal(signals.length, 1, kind);
      assert.doesNotMatch(signals[0], RULE_WORDS, kind);
    }
  });
});
