/**
 * LIN-4401 A (LIN-4431): where an outside find goes is one shared gate, `CONSEQUENCE_TEST`,
 * in the leaf `lib/prompts/leftover-words.js`, rendered verbatim by each route that files one.
 *
 * Part (i): review, close-out and the leftover prompt each contain the gate exactly once.
 * Part (ii): the gate names what makes a find a ticket (breaks, blocks, touches safety) and the
 *   four kinds of safety it names (authentication, secrets, data loss, irreversible writes).
 * Part (v): the wording around the gate that no other part reads: the gate's fallbacks and "Never
 *   both", the leftover prompt's note-bound rule and answer form, review's "name its home" and the
 *   condition on the "file" option in review and Triage, and close-out's Make the Fixes clause for a
 *   note-bound outside find close-out notices itself (review fix 9).
 *
 * Both assertions compare the rendered text against the constant's own text, so a route that
 * retypes the gate in its own words fails here rather than passing on a near-match.
 *
 * Run with: node --test tests/unit/lin-4401-outside-find-home.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as words from '../../lib/prompts/leftover-words.js';
import { generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { leftoverPrompt } from '../../lib/dispatch-leftover.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { buildAutopilotKickoff } from '../../lib/prompts/autopilot-kickoff.js';

const CONSEQUENCE_TEST = typeof words.CONSEQUENCE_TEST === 'string' ? words.CONSEQUENCE_TEST : '';

const ISSUE = {
  id: 'issue-4401', identifier: 'LIN-9401', title: 'Outside-find home fixture', description: 'Some work',
  url: 'https://linear.app/test/issue/LIN-9401', state: { name: 'In Progress', type: 'started' },
  labels: [], createdAt: '2026-11-12T00:00:00.000Z'
};
const CONTEXT = { parent: null, siblings: [], project: null, children: [], comments: [] };

const render = (kind) => {
  const out = generatePrompt(kind, ISSUE, CONTEXT, {});
  return typeof out === 'string' ? out : out.prompt;
};

const occurrences = (text, needle) => text.split(needle).length - 1;

describe('(i) the consequence test renders exactly once in each route that files an outside find', () => {
  test('the gate is a non-empty string in the leaf', () => {
    assert.ok(CONSEQUENCE_TEST.length > 0, 'lib/prompts/leftover-words.js exports CONSEQUENCE_TEST as a string');
  });

  // LIN-4432 (piece B): the after-merge audit renders the gate too, once.
  for (const kind of ['review', 'close-out', 'retrospective-audit']) {
    test(`${kind} contains the gate exactly once`, () => {
      assert.ok(CONSEQUENCE_TEST.length > 0, 'CONSEQUENCE_TEST is exported');
      const n = occurrences(render(kind), CONSEQUENCE_TEST);
      assert.equal(n, 1, `${kind} renders CONSEQUENCE_TEST ${n} times, expected exactly 1`);
    });
  }

  test('the leftover prompt contains the gate exactly once', () => {
    assert.ok(CONSEQUENCE_TEST.length > 0, 'CONSEQUENCE_TEST is exported');
    const prompt = leftoverPrompt({ issueIdentifier: 'LIN-9401', prUrl: 'https://github.com/example/repo/pull/1' });
    const n = occurrences(prompt, CONSEQUENCE_TEST);
    assert.equal(n, 1, `leftoverPrompt renders CONSEQUENCE_TEST ${n} times, expected exactly 1`);
  });
});

describe('(ii) the gate names what makes a find a ticket, and the four kinds of safety', () => {
  const pieces = [
    ['breaks (behaviour wrong today)', /breaks/i],
    ['blocks (work cannot go ahead)', /blocks/i],
    ['touches safety', /touches safety/i],
    ['safety kind: authentication', /authentication/i],
    ['safety kind: secrets', /secrets/i],
    ['safety kind: data loss', /data loss/i],
    ['safety kind: irreversible writes', /irreversible writes/i],
  ];
  for (const [label, re] of pieces) {
    test(`names ${label}`, () => {
      assert.match(CONSEQUENCE_TEST, re, `CONSEQUENCE_TEST should name: ${label}`);
    });
  }
});

/** The text from a `### ` heading to the next `### ` or `## ` heading. */
function section(prompt, heading) {
  const start = prompt.indexOf(`### ${heading}`);
  assert.ok(start >= 0, `the prompt has a "### ${heading}" section`);
  const rest = prompt.slice(start + 4 + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

// The filing wording the consequence test replaces (LIN-4401 D3). Each phrase must be gone from
// every rendered stage prompt, the kickoff prompt, and close-out's completion signals.
const RETIRED = [
  'file the outside follow-ups',
  'file remaining follow-ups',
  'files the outside follow-ups',
  'file it as a follow-up a reader',
  'close-out files it, after checking',
  'routed follow-up ticket',
  'outside-scope follow-up',
  'file follow-ups',
  'Only outside items are filed here',
  'remaining outside follow-ups',
  'an outside item filed on its own terms',
  'a follow-up only close-out files',
  'and followed-up?',
  // LIN-4432: the audit's filing sentence and signal 5 (no PIECE_B exemption any more).
  'that still matters',
];

function assertNoRetired(text, label) {
  for (const phrase of RETIRED) {
    assert.ok(!text.includes(phrase), `${label} still says "${phrase}"`);
  }
}

describe('(iii) no rendered stage prompt, kickoff prompt or close-out completion signal carries the retired phrases', () => {
  for (const key of Object.keys(PROMPT_TEMPLATES)) {
    test(`${key} carries no retired phrase`, () => {
      assertNoRetired(render(key), `${key} prompt`);
    });
  }

  test('the leftover prompt carries no retired phrase', () => {
    assertNoRetired(leftoverPrompt({ issueIdentifier: 'LIN-9401', prUrl: 'https://github.com/example/repo/pull/1' }), 'leftover prompt');
  });

  test('the kickoff prompt carries no retired phrase', () => {
    const kickoff = buildAutopilotKickoff({ baseUrl: 'https://harbour.example', issue: ISSUE });
    assertNoRetired(typeof kickoff === 'string' ? kickoff : kickoff.prompt, 'kickoff prompt');
  });

  test("close-out's description and completion signals, read directly, carry no retired phrase", () => {
    const t = PROMPT_TEMPLATES['close-out'];
    const sig = COMPLETION_SIGNALS['close-out'];
    assert.ok(t.description && sig.coreOutcome && sig.readinessCheck && sig.signals.length > 0, 'the fields exist');
    assertNoRetired([t.description, sig.coreOutcome, sig.readinessCheck, ...sig.signals].join('\n'), 'close-out description or completion signal');
  });

  test("the audit's completion signals, read directly, carry no retired phrase (LIN-4432 signal 5)", () => {
    const sig = COMPLETION_SIGNALS['retrospective-audit'];
    assert.ok(sig.coreOutcome && sig.readinessCheck && sig.signals.length > 0, 'the fields exist');
    assertNoRetired([sig.coreOutcome, sig.readinessCheck, ...sig.signals].join('\n'), 'retrospective-audit completion signal');
  });
});

// LIN-4495: the consequence test is now a wording rule for a finding's `says` (lib/prompts/leftover-words.js), not a
// ticket gate, so the (iv) Triage and (v) gate-wording pins are retired with the Triage section (their replacement is
// the rendering witness, tests/unit/lin-4495-rendering.test.js).
