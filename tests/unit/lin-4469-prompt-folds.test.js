/**
 * LIN-4469 (piece 5 of LIN-4448): the prompt folds, one re-pin. Two things are pinned here.
 *
 * 1. The retired spellings are gone. Each phrase below was a duplicate of a rule that now has one home
 *    (the area lookup, the notes pull request, the committed-tool search, "cut") or a tracker clause the
 *    proxy's write guard refuses (lib/stage-writes.js, LIN-4468). A retired phrase must appear in no
 *    rendered prompt: not in a stage template, not in a Periodical reading, not in the dispatch preamble.
 *    Each is asserted to occur zero times: a phrase left in even one prompt fails.
 * 2. The mandates the guard now enforces say what the stage is told about its token, and nothing the
 *    guard refuses: each non-work preamble is checked for the tracker words it used to restate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PROMPT_TEMPLATES, generatePrompt } from '../../lib/prompt-templates.js';
import { getPeriodicals, withAutopilotTail } from '../../lib/periodicals.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { WRITES_VALUES } from '../../lib/stage-writes.js';
import { MODES } from '../fixtures/lin-4467-witness.js';

// The spellings that were folded or restated. Literal, so a drift back to any of them fails here.
const RETIRED = [
  'post nothing to Linear unless the person asks',
  'do not change code, branches, pull requests, tickets or Linear state',
  'do not change code, branches, pull requests, tickets or tracker state',
  'do not rewrite its description, do not create tickets or subtasks',
  'one docs-only notes pull request',
  'Don\'t change code, branches, pull requests, tickets or Linear state',
  'Don\'t change code, branches, pull requests, tickets or tracker state',
  'rebase it onto main and get it green under the notes guard',
  'search for the repo\'s committed code-shape census-review tool',
  'search the repo for a committed change-coupling tool (it reads',
  'naming any narrowing',
  'is a narrowing, which only',
];

const ISSUE = {
  id: 'LIN-900', identifier: 'LIN-900', title: 'Witness ticket for the stage-kind record',
  description: '## As asked\n\nWitness ask.\n\n## Implementation Plan\n\nWitness plan.\n\nfits one session.',
  url: 'https://linear.app/witness/issue/LIN-900', state: { name: 'In Progress', type: 'started' },
  labels: ['Bug'], priority: 2, priorityLabel: 'High', assignee: { name: 'Ada' },
  createdAt: '2026-11-01T10:00:00.000Z', estimate: null, project: { name: 'Witness project' }
};

/** Every rendered prompt this change can touch: each stage (fresh and fix round), each Periodical (plain and Mint + Autopilot), each preamble. */
function renderedPrompts() {
  const out = {};
  for (const kind of Object.keys(PROMPT_TEMPLATES)) {
    for (const [mode, context] of Object.entries(MODES)) out[`stage:${kind}:${mode}`] = generatePrompt(kind, ISSUE, context).prompt;
  }
  for (const template of getPeriodicals()) {
    const plain = template.generatePrompt();
    out[`periodical:${template.id}`] = plain;
    out[`periodical:${template.id}:autopilot`] = withAutopilotTail(plain);
  }
  for (const writes of WRITES_VALUES) {
    out[`preamble:${writes}`] = buildProxyContextPreamble({ baseUrl: 'https://h', token: 'TOKEN', issueIdentifier: 'LIN-900', writes });
  }
  return out;
}

describe('LIN-4469: the folded spellings appear in no rendered prompt', () => {
  const prompts = renderedPrompts();

  for (const phrase of RETIRED) {
    test(`"${phrase}" is in no rendered prompt`, () => {
      const where = Object.entries(prompts).filter(([, text]) => text.includes(phrase)).map(([name]) => name);
      assert.equal(where.length, 0, `retired spelling appears in ${where.length} prompts: ${where.join(', ')}`);
    });
  }
});

describe('LIN-4469: the shared clauses render where the folded rules were', () => {
  const prompts = renderedPrompts();

  test('the area lookup says the registry and first match, once per rendered area pointer', () => {
    assert.ok(prompts['stage:bug:fresh'].includes('(`docs/areas/areas.json`, first match wins; no notes file means nothing known yet)'));
  });

  test('the notes pull request is the one shared clause, in periodical readings and the retrospective audit', () => {
    const clause = 'one docs-only pull request off main, green under the notes guard and required checks';
    assert.ok(prompts['periodical:seams-tangles'].includes(clause));
    assert.ok(prompts['stage:retrospective-audit:fresh'].includes(clause));
  });

  test('the blind read keeps its own area sentence, as piloted (LIN-4437)', () => {
    assert.ok(prompts['stage:blind-read:fresh'].includes('A file\'s area is the first area in `docs/areas/areas.json` with a pattern that matches its repo-relative path.'));
  });
});

describe('LIN-4469: the mandates say only what the stage is told about its token', () => {
  // Tracker clauses the write guard refuses (lib/stage-writes.js) must not be restated as prose.
  const GUARDED_CLAUSES = [
    /tickets or (Linear|tracker) state/,
    /post nothing to Linear/,
    /rewrite its description/,
    /do not create tickets or subtasks/,
  ];
  for (const writes of WRITES_VALUES.filter(value => value !== 'work')) {
    test(`${writes}: the preamble restates no guarded tracker clause`, () => {
      const text = renderedPrompts()[`preamble:${writes}`];
      for (const clause of GUARDED_CLAUSES) assert.doesNotMatch(text, clause, `${writes} restates ${clause}`);
    });
  }

  test('the code, branch and PR prohibitions stay in words: the guard has no backstop for them', () => {
    for (const writes of ['none', 'one-comment', 'blind-comment', 'ticket-fields']) {
      assert.match(renderedPrompts()[`preamble:${writes}`], /[Dd]o not change code, branches or pull requests/, writes);
    }
  });
});
