/**
 * LIN-4401 A (LIN-4431): where an outside find goes is one shared gate, `CONSEQUENCE_TEST`,
 * in the leaf `lib/prompts/leftover-words.js`, rendered verbatim by each route that files one.
 *
 * Part (i): review, close-out and the leftover prompt each contain the gate exactly once.
 * Part (ii): the gate names what makes a find a ticket (breaks, blocks, touches safety) and the
 *   four kinds of safety it names (authentication, secrets, data loss, irreversible writes).
 *
 * Both assertions compare the rendered text against the constant's own text, so a route that
 * retypes the gate in its own words fails here rather than passing on a near-match.
 *
 * Run with: node --test tests/unit/lin-4401-outside-find-home.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as words from '../../lib/prompts/leftover-words.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { leftoverPrompt } from '../../lib/dispatch-leftover.js';

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
