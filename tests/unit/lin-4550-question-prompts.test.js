/**
 * LIN-4550 (LIN-4546 piece 2/7): what an agent is told about writing a question record.
 *
 * Every place an agent learns to write one agrees:
 *   - the question route (lib/prompts/handoff-words.js QUESTION_ROUTE, which the run preamble's hand-off block and the proxy
 *     instructions both carry) asks for `short`: one sentence, read first, at most the cap the records check holds it to
 *     (KINDS.limits.question.short), longer refused, not cut; and says not to mark an option "(Recommended)", since
 *     `recommended` names it and the card marks it;
 *   - the call shape (HANDOFF_CALLS) sends `short`, and says a person's dismissal ends the question `dismissed`, while a run
 *     takes its own question back as `withdrawn` (an agent writing `dismissed` is refused);
 *   - the proxy instructions' Questions section says the same of a dismissal, never that it ends `withdrawn`;
 *   - the If Blocked block (lib/prompt-formatters.js formatIfBlocked) and the autopilot manual no longer tell an agent to put
 *     its recommendation into each option;
 *   - public/llms.txt documents `short` and the person-only `dismissed` end.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUESTION_ROUTE, HANDOFF_BLOCK, HANDOFF_CALLS } from '../../lib/prompts/handoff-words.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { formatIfBlocked } from '../../lib/prompt-formatters.js';
import { KINDS } from '../../lib/records/check.js';

const CAP = KINDS.limits.question.short;
const LLMS = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
const MANUAL = readFileSync(new URL('../../docs/autopilot-operating-manual.md', import.meta.url), 'utf8');

describe('the question route asks for short', () => {
  test('`short` is asked for: one sentence, read first, within the cap the check holds, refused not cut', () => {
    assert.match(QUESTION_ROUTE, /`short` \(/);
    assert.match(QUESTION_ROUTE, /one sentence/);
    assert.match(QUESTION_ROUTE, /read first/);
    assert.ok(QUESTION_ROUTE.includes(`${CAP} characters`), `the cap the route names is the check's (${CAP})`);
    assert.match(QUESTION_ROUTE, /refused, not cut/);
  });

  test('no option is marked "(Recommended)": `recommended` names it and the card marks it', () => {
    assert.match(QUESTION_ROUTE, /no option marked "\(Recommended\)"/);
    assert.match(QUESTION_ROUTE, /the card marks it/);
  });

  test('the run preamble\'s hand-off block carries the route whole', () => {
    assert.ok(HANDOFF_BLOCK.includes(QUESTION_ROUTE));
  });
});

describe('the call shape and the dismissal', () => {
  const questionCall = HANDOFF_CALLS.split('\n').filter((l) => l.includes('"kind":"question"') || l.includes('"kind": "question"'));

  test('the question body sends short', () => {
    assert.ok(questionCall.some((l) => l.includes('"short":"..."')), questionCall.join('\n'));
  });

  test('a person\'s dismissal ends the question dismissed; a run takes its own back as withdrawn; an agent writing dismissed is refused', () => {
    assert.match(HANDOFF_CALLS, /a person's dismissal ends it `dismissed`/);
    assert.match(HANDOFF_CALLS, /take your own question back, end it `withdrawn`/);
    assert.match(HANDOFF_CALLS, /`dismissed` from an agent is refused/);
    assert.doesNotMatch(HANDOFF_CALLS, /dismissal ends the question as withdrawn/);
  });

  test('the proxy instructions say the same, and never that a dismissal ends withdrawn', () => {
    const text = buildInstructions({ baseUrl: 'https://example.test', scope: 'readWrite' });
    const questions = text.slice(text.indexOf('## Questions (asking a person)'));
    assert.match(questions, /A person's dismissal ends the question\s+`dismissed`/);
    assert.doesNotMatch(text, /A dismissal ends the question\s+withdrawn/);
    assert.ok(text.includes(QUESTION_ROUTE), 'the instructions carry the route itself, not a copy');
  });
});

describe('no other guidance asks for the recommendation inside each option', () => {
  test('the If Blocked block: options are the answers, `recommended` names yours', () => {
    const block = formatIfBlocked();
    assert.doesNotMatch(block, /`options` each carry your recommendation/);
    assert.match(block, /`recommended` names yours/);
  });

  test('the autopilot manual: options are worded with their cost, `recommended` names one, none is marked in its text', () => {
    assert.doesNotMatch(MANUAL, /each worded with its cost and your recommendation/);
    assert.match(MANUAL, /`short` is the question in one sentence/);
    assert.match(MANUAL, /no option's text is marked "\(Recommended\)"/);
  });
});

describe('public/llms.txt documents short and the dismissed end', () => {
  test('the rulings feed rows carry short, and a dismissal ends dismissed, a person\'s alone', () => {
    assert.match(LLMS, /GET {2}\/workspace\/\{urlKey\}\/api\/dashboard\/rulings/);
    assert.match(LLMS, /`short` \(the one-line question/);
    assert.match(LLMS, /ends it `dismissed` \(only a person may/);
  });
});
