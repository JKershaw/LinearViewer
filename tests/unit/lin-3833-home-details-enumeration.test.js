/**
 * LIN-3833 step 3, C13: the enumeration of what the Home opened task renders. The test is the inventory:
 * it renders the Home layout for a fixture that has a description, labels, comments, attachments and a
 * provider link, then asserts every `data-toggle` name and every `data-testid` against the verdict table
 * below. A new toggle or testid that nobody has classed fails here, now or later.
 *
 * The verdicts (ticket, "The opened task" and the plan's C13):
 *   - the Details toggle and the Prompts toggle are gone (folded into the Description fold and the state
 *     block); brief, recap, scan and context are gone from Home (they stay on Swipe);
 *   - Sessions, Description, Comments and Attachments are folds;
 *   - the task page, chat and provider links are the one links row;
 *   - the run-on-my-machine line is shown to copy-first viewers only (run controls viewers have a runner).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDetailsContent } from '../../lib/render.js';

const ISSUE = {
  id: 'issue-uuid-1', identifier: 'LIN-42', title: 'Enumerate', url: 'https://linear.app/x/issue/LIN-42',
  description: 'Look at ![shot](https://uploads.linear.app/a/b/shot.png) first.',
  state: { name: 'In Progress', type: 'started' },
  assignee: { name: 'Ada' }, labels: { nodes: [{ name: 'bug' }] }, estimate: 2,
  project: { name: 'Quality' }, updatedAt: '2026-10-24T10:00:00.000Z',
  comments: { nodes: [{ body: 'a comment ![pic](https://uploads.linear.app/a/c/pic.png)', user: { name: 'Bo' } }] },
  children: { nodes: [] }
};

// data-toggle names the Home layout may emit, each with its verdict.
const TOGGLE_VERDICTS = {
  sessions: 'fold: the Sessions fold (SessionsSection), lazy, runControls only',
  description: 'fold: the Description fold, with the meta row and Edit',
  comments: 'fold: the Comments fold, lazy, with the post box',
  attachments: 'fold: the attachments gallery, only when the task has images'
};

// data-testid hooks the Home layout may emit, each with its verdict.
const TESTID_VERDICTS = {
  'opened-task-facts': 'the facts line (ID, project, updated)',
  'issue-description-toggle': 'the Description fold toggle',
  'issue-edit-link': 'Edit, in the Description fold (inline-edit providers only)',
  'issue-task-page-link': 'the Task page link in the links row',
  'issue-chat-link': 'Chat, in the links row (taskChat flag only)',
  'issue-provider-link': 'Open in <provider>, in the links row (renamed from View in, LIN-3833)',
  'sessions-toggle': 'the Sessions fold toggle (runControls only)',
  'attachments-toggle': 'the attachments fold toggle (images only)',
  'attachments-content': 'the attachments fold content (images only)',
  'opened-task-runner-link': 'the quiet runner line for copy-first viewers (renderRunnerLink)'
};

function home(featureFlags, provider = null) {
  return renderDetailsContent(ISSUE, { isLanding: false, urlKey: 'acme', featureFlags, provider, section: 'in-progress', layout: 'home' });
}

const toggles = (html) => [...html.matchAll(/data-toggle="([\w-]+)"/g)].map((m) => m[1]);
const testids = (html) => [...html.matchAll(/data-testid="([\w-]+)"/g)].map((m) => m[1]);

describe('LIN-3833 C13 — every toggle and testid the Home opened task renders has a verdict', () => {
  for (const flags of [{ runControls: true, taskChat: true }, { runControls: false }]) {
    const label = flags.runControls ? 'run-controls viewer' : 'copy-first viewer';
    test(`${label}: no data-toggle outside the verdict table`, () => {
      const html = home(flags);
      for (const name of new Set(toggles(html))) {
        assert.ok(TOGGLE_VERDICTS[name], `data-toggle="${name}" has no verdict in lin-3833-home-details-enumeration`);
      }
    });
    test(`${label}: no data-testid outside the verdict table`, () => {
      const html = home(flags);
      for (const id of new Set(testids(html))) {
        assert.ok(TESTID_VERDICTS[id], `data-testid="${id}" has no verdict in lin-3833-home-details-enumeration`);
      }
    });
  }

  test('the removed toggles do not come back: no Details, Prompts, Brief, Recap, Scan or Context on Home', () => {
    const html = home({ runControls: true, taskChat: true });
    for (const name of ['details', 'prompts', 'brief', 'recap', 'scan', 'context']) {
      assert.equal(toggles(html).includes(name), false, `data-toggle="${name}" was removed from the Home opened task`);
    }
    assert.equal(/Details ▶|Prompts ▶/.test(html), false);
  });

  test('the runner line goes to copy-first viewers only, and keeps its testid', () => {
    assert.equal(testids(home({ runControls: true })).includes('opened-task-runner-link'), false);
    assert.equal(testids(home({ runControls: false })).includes('opened-task-runner-link'), true);
  });

  test('the Sessions fold is for run-controls viewers only', () => {
    assert.equal(toggles(home({ runControls: true })).includes('sessions'), true);
    assert.equal(toggles(home({ runControls: false })).includes('sessions'), false);
  });

  test('the provider link is named "Open in", and carries the testid the specs use', () => {
    const html = home({ runControls: true });
    assert.match(html, /data-testid="issue-provider-link"[^>]*>Open in Linear ↗</);
  });

  test('the facts line leads the fragment, before the mount', () => {
    const html = home({ runControls: true });
    assert.ok(html.indexOf('opened-task-facts') < html.indexOf('data-prompt-mount'), 'the facts come first');
    assert.match(html, /LIN-42 · Quality · updated /);
  });
});
