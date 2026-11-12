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

  for (const kind of ['review', 'close-out']) {
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
];

// retrospective-audit is piece B (LIN-4432): its own filing sentence changes with its notes PR,
// so it is exempt from this part and nothing else.
const PIECE_B = new Set(['retrospective-audit']);

function assertNoRetired(text, label) {
  for (const phrase of RETIRED) {
    assert.ok(!text.includes(phrase), `${label} still says "${phrase}"`);
  }
}

describe('(iii) no rendered stage prompt, kickoff prompt or close-out completion signal carries the retired phrases', () => {
  for (const key of Object.keys(PROMPT_TEMPLATES)) {
    if (PIECE_B.has(key)) continue;
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
});

describe('(iv) Follow-up Triage still tells close-out to file a gate ticket (the guard the old filing was for)', () => {
  test('the Triage section renders the gate and states that close-out files the gate\'s tickets there', () => {
    const triage = section(render('close-out'), 'Follow-up Triage');
    assert.ok(triage.includes(CONSEQUENCE_TEST), 'Triage renders the consequence test exactly as the leaf states it');
    assert.match(triage, /Only the gate's tickets are filed here/, 'Triage files only the gate\'s tickets');
  });
});

describe('(v) the wording around the gate, held where no other part reads it', () => {
  test('the gate states the provider fallback, the unmapped fallback and "Never both"', () => {
    assert.match(CONSEQUENCE_TEST, /where the provider cannot create tickets, the summary comment/);
    assert.match(CONSEQUENCE_TEST, /An unmapped path .* citing a file there first/);
    assert.match(CONSEQUENCE_TEST, /Never both\./);
  });

  test('the leftover prompt tells the builder to write each note-bound outside find into its area\'s note, and its answer form says any area\'s note', () => {
    const prompt = leftoverPrompt({ issueIdentifier: 'LIN-9401', prUrl: 'https://github.com/example/repo/pull/1' });
    assert.ok(prompt.includes("Write each note-bound outside find into its area's note; for close-out, list only ticket-bound ones."), 'the note-bound rule');
    assert.ok(prompt.includes("(tidied / noted, any area's note / for close-out, a ticket only)"), 'the answer form');
  });

  test('review names each outside find\'s home under the gate', () => {
    const scope = section(render('review'), "Inside or Outside the Ticket's Scope");
    assert.match(scope, /Name its home under the gate below \(an area slug with the entry worded ready to write, or "ticket" and why\)/);
  });

  test('close-out\'s Make the Fixes writes a note-bound outside find it notices itself before the merge, once', () => {
    const fixes = section(render('close-out'), 'Make the Fixes Review Asked For');
    assert.equal(occurrences(fixes, 'and any note-bound outside find you notice yourself'), 1);
    assert.match(fixes, /any note-bound outside find you notice yourself, in its own area or another, into that area's `docs\/areas\/<slug>\.md` on the PR branch the same way, before the merge\./);
  });

  for (const [label, text] of [
    ['review\'s "Inside or Outside the Ticket\'s Scope"', () => section(render('review'), "Inside or Outside the Ticket's Scope")],
    ['close-out\'s "Follow-up Triage"', () => section(render('close-out'), 'Follow-up Triage')],
  ]) {
    test(`${label} offers "file" only for an outside item the gate sends to a ticket`, () => {
      assert.ok(text().includes('"file" is offered only for an outside item the gate sends to a ticket'));
    });
  }
});
