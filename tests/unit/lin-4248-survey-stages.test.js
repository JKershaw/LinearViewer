/**
 * LIN-4248: the Survey as two hand-triggered, read-only stage templates (`survey-task`,
 * `survey-place`). These pin what the plan promised: the templates render the hand-tuned
 * wording and nothing that makes a forecast change things; neither kind is routed, and the
 * router, the "Another step" list and the stage selector all refuse or hide them; and the
 * notebook keeps one live copy of the text, in the templates.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  PROMPT_TEMPLATES, STAGE_LEADS, EXCLUDED_FROM_AI_RECOMMENDATION, generatePrompt,
  getSelectableStages, formatStageOptions, isValidDispatchKind, deriveDispatchKind, DISPATCH_KINDS
} from '../../lib/prompt-templates.js';
import { routeStage, parseRouteDecision } from '../../lib/stage-router.js';
import { sessionSummaryOf } from '../../lib/task-page-loader.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { BUCKET_OF_KIND } from '../../lib/wall-clock-summary.js';

const SURVEYS = ['survey-task', 'survey-place'];
const FIXTURE_ISSUE = {
  id: 'issue-4248', identifier: 'LIN-1', title: 'A fixture ticket', description: 'Its description, as it reads now.',
  url: 'https://linear.app/example/issue/LIN-1', state: { name: 'Backlog', type: 'backlog' }, labels: [],
  createdAt: '2026-01-01T00:00:00.000Z'
};
const FIXTURE_CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8');

describe('LIN-4248 Survey templates: registry and routing', () => {
  test('both Surveys are templates with a lead, a completion signal, scope lines and a bucket', () => {
    for (const kind of SURVEYS) {
      assert.ok(PROMPT_TEMPLATES[kind], `${kind} is a template`);
      assert.ok(STAGE_LEADS[kind], `${kind} has a Goal lead`);
      assert.ok(COMPLETION_SIGNALS[kind], `${kind} has a completion signal`);
      assert.deepEqual(STAGE_INTENT[kind], [STAGE_INTENT.retro[0]], `${kind} has the reading-pass scope line`);
      assert.equal(BUCKET_OF_KIND[kind], 'before', `${kind} runs before work starts`);
      assert.ok(PROMPT_TEMPLATES[kind].description.includes('never routed'), `${kind} says it is never routed`);
    }
  });

  test('neither Survey has a route, so the stage selector never lists it', () => {
    for (const kind of SURVEYS) assert.equal(PROMPT_TEMPLATES[kind].route, undefined, kind);
    const keys = getSelectableStages().map(s => s.key);
    for (const kind of SURVEYS) assert.ok(!keys.includes(kind), `${kind} is not a selectable stage`);
    assert.ok(!formatStageOptions().includes('survey-'), 'the selector options name neither Survey');
  });

  test('both Surveys are excluded from recommendation, and the router refuses them', () => {
    for (const kind of SURVEYS) assert.ok(EXCLUDED_FROM_AI_RECOMMENDATION.has(kind), kind);
    for (const kind of SURVEYS) {
      assert.throws(() => routeStage(`## Reasoning\n→ **${kind}**`, 'stop', 3), /cannot be recommended/, kind);
      assert.throws(() => parseRouteDecision(`## Reasoning\n→ **${kind}**`), /cannot be recommended/, kind);
    }
  });

  test('the "Another step" summary lists both Surveys as excluded', () => {
    const { excluded } = sessionSummaryOf({ sessions: [], guesses: [] });
    for (const kind of SURVEYS) assert.ok(excluded.includes(kind), kind);
  });

  test('both Surveys are hand-triggerable dispatch kinds, not derived from anything else', () => {
    for (const kind of SURVEYS) {
      assert.ok(DISPATCH_KINDS.includes(kind), kind);
      assert.ok(isValidDispatchKind(kind), kind);
      assert.equal(deriveDispatchKind(kind), kind, `${kind} resolves to itself`);
    }
  });
});

describe('LIN-4248 Survey prompts: the hand-tuned wording, with only the fill-ins', () => {
  const task = () => generatePrompt('survey-task', FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt;
  const place = () => generatePrompt('survey-place', FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt;

  test('each renders its heading at the base, the surveyed ticket, and the ticket text as it reads now', () => {
    assert.ok(task().includes('## Survey open-0: LIN-1 @ {BASE}'), 'task heading names the surveyed ticket and the base');
    assert.ok(place().includes('## Survey global: LIN-1 @ {BASE}'), 'place heading names the surveyed ticket and the base');
    for (const p of [task(), place()]) {
      assert.ok(p.includes('A fixture ticket\n\nIts description, as it reads now.'), 'the ticket title and description');
      assert.ok(p.includes('Your only output is one comment on LIN-1'), 'the one comment goes on the surveyed ticket');
    }
  });

  test('the base is resolved by the session from origin/main, not by the server', () => {
    for (const p of [task(), place()]) {
      assert.match(p, /Run `git fetch origin` and resolve `origin\/main` to its commit\./);
      assert.match(p, /first 9 characters as \{BASE\}/);
    }
  });

  test('the hard-coded record ticket and the {RECORD} brace are gone', () => {
    const all = task() + place();
    assert.ok(!all.includes('LIN-4150'), 'no hard-coded LIN-4150');
    assert.ok(!all.includes('{RECORD}'), 'no {RECORD} brace');
    assert.ok(!all.includes('{TICKET}'), 'every {TICKET} is filled');
  });

  test('each has the Goal/Process frame, and the lead is the first paragraph of its prompt', () => {
    for (const kind of SURVEYS) {
      const p = generatePrompt(kind, FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt;
      assert.ok(p.startsWith(`## Goal\n${STAGE_LEADS[kind]}`), `${kind}: the stage's fixed lead opens the Goal`);
      assert.match(p, /## Scope and Authority\n\n- This is a reading pass\./, `${kind}: its scope line`);
      assert.ok(p.includes('## Process\n\n**This is read-only.**'), `${kind}: read-only process opens the Process`);
    }
  });

  test('neither prompt tells the session to change code, open a PR, or end with a PR link', () => {
    const forbidden = /open (a |the )?PRs?\b|\bPR link\b|commit SHA|Re-ground|implement the fix|Task Already Complete|All Subtasks Complete|Prior Investigation|## Workflow|Set status|In Progress/i;
    for (const p of [task(), place()]) assert.doesNotMatch(p, forbidden);
  });

  test('the place prompt keeps its three questions and its reading list, verbatim', () => {
    const p = place();
    assert.match(p, /1\. Where in the codebase will this task land, and what is that part of the place like now\?/);
    assert.match(p, /3\. What would leave the place better than it is now, at a cost this task could carry\?/);
    assert.match(p, /Don't read reviews, audits or other reports written about the codebase's shape/);
  });
});

describe('LIN-4248 notebook: one live copy of the Survey text, in the templates', () => {
  const DOCS = ['docs/plans/survey/prompt.md', 'docs/plans/survey/global-offshoot-prompt-v2-code.md'];

  test('the notebook paths landed on main, and the two prompt docs point at the templates', () => {
    for (const rel of ['docs/plans/survey.md', 'docs/plans/survey/notes-2026-11-05.md', 'experiments/place-change/place-change.mjs']) {
      assert.ok(read(rel).length > 0, `${rel} is on main`);
    }
    for (const rel of DOCS) assert.match(read(rel), /survey-(task|place)` template in `lib\/prompt-template-defs\.js`/, `${rel} points at its template`);
  });

  test('no long line of either rendered Survey body is repeated in the two prompt docs', () => {
    for (const kind of SURVEYS) {
      const body = generatePrompt(kind, FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt.split('\n');
      const longLines = body.filter(l => l.length > 40 && !l.includes('A fixture ticket') && !l.includes('Its description'));
      for (const rel of DOCS) {
        const text = read(rel);
        for (const line of longLines) assert.ok(!text.includes(line), `${kind}: "${line.slice(0, 50)}..." is copied into ${rel}`);
      }
    }
  });
});
