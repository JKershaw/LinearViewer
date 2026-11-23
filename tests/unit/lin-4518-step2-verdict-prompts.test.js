/**
 * LIN-4518 step 2 (writers and prompts): the stage contracts and the blind read's prompt tell each judge to write its
 * verdict as a record, pinned to the head it read, and the blind read is handed the change records it judges. Also the
 * three cleanups finding-43b8c886 names in the records area (unused import, a third spelling of the audit stage, a dead
 * re-export).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatStageContract } from '../../lib/prompt-contract.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { promptContextOf } from '../../lib/prompts/prompt-context.js';
import { attachLandingChanges } from '../../lib/change-records.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';
import { AUDIT_STAGE, REVIEW_JUDGEMENT, CLOSE_OUT_STAGE } from '../../lib/records/words.js';
import * as taskStanding from '../../lib/task-standing.js';

const ISSUE = { identifier: 'LIN-1', title: 't', description: 'd', state: { name: 'In Progress', type: 'started' }, labels: [] };
const COMMENTS = [{ body: 'Implementation: https://github.com/acme/widget/pull/7', createdAt: '2026-01-02T00:00:00.000Z' }];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');

describe('the review contract asks for a verdict record on the change it read, and conditions as findings first', () => {
  const contract = formatStageContract('review', 'LIN-1');

  test('the verdict record names its judgement, the change ids it is on, and the head it pins each to', () => {
    assert.match(contract, /"kind": "verdict"/);
    assert.match(contract, /"judgement": "review"/);
    assert.match(contract, /"on"` the change record of each PR you read/);
    assert.match(contract, /"heads"` naming the head sha you read for each, as `\{"<change id>": "<sha>"\}`/);
  });

  test('an Approve with conditions is an Approve plus one close-out finding per condition, written before the approval', () => {
    const line = contract.split('\n').find((l) => l.includes('An Approve with conditions'));
    assert.ok(line, 'the conditional-approval line is in the contract');
    assert.match(line, /"to": "close-out"/);
    // finding-53f10ec3: the close-out gate reads findings by their task (`in`), and a condition names the check that settles it (`how`).
    assert.match(line, /"in": "LIN-1"/);
    assert.match(line, /"how"` the check that settles it/);
    assert.match(line, /Write them before the approval record/);
  });

  test('the contract ends on the conditional-approval record line; no comment verdict form follows it (LIN-4520)', () => {
    const lines = contract.split('\n').filter((l) => l.startsWith('- '));
    assert.match(lines[lines.length - 1], /^- An Approve with conditions/);
    assert.doesNotMatch(contract, /### Verdict/);
  });
});

describe('the plan-review contract writes each blocking finding as a record, before its verdict record', () => {
  const contract = formatStageContract('plan-review', 'LIN-1');

  test('a blocking finding is to the plan, about the plan, and written before the verdict', () => {
    const line = contract.split('\n').find((l) => l.includes('Write each blocking finding as a record'));
    assert.ok(line, 'the blocking-finding line is in the contract');
    assert.match(line, /"kind": "finding"/);
    assert.match(line, /"to": "plan"/);
    assert.match(line, /"about": "<the plan id>"/);
    assert.match(line, /before the verdict/);
  });

  test('the verdict record is judged plan-review and on the plan', () => {
    assert.match(contract, /"judgement": "plan-review"/);
    assert.match(contract, /"on": \["<the plan id>"\]/);
  });
});

describe('the blind read is handed the change records it judges, and writes its verdict on them', () => {
  const prompt = (landingChanges) => generatePrompt('blind-read', ISSUE, { comments: COMMENTS, landingChanges }).prompt;

  test('with the landing handed in: its verdict record is on those ids, with heads pinned per change', () => {
    const p = prompt([{ id: 'change-abc123', ref: 'https://github.com/acme/widget/pull/7', head: 'H1' }]);
    assert.match(p, /"judgement": "blind-read"/);
    assert.match(p, /"on"` the change records below/);
    assert.match(p, /"heads"` naming the \{HEAD\} you read for each, as `\{"<change id>": "<sha>"\}`/);
    assert.match(p, /`change-abc123` is the change record for https:\/\/github\.com\/acme\/widget\/pull\/7\./);
    // finding-53f10ec3 (4): a space after the comma that ends the clause.
    assert.match(p, /`"in": "LIN-1"`, `"reasoning"` the Read line, then the reason in one line/);
  });

  // LIN-4518 step 3: the prompt reads the landing from its change records (finding 75b33054). With none handed in
  // (not read), it says the landing could not be read, and names no id or verdict record.
  test('with no landing handed in: the prompt says the landing could not be read, and names no id', () => {
    const p = prompt(null);
    assert.match(p, /\*\*The landing could not be read\.\*\*/);
    assert.doesNotMatch(p, /"judgement": "blind-read"/);
    assert.doesNotMatch(p, /change record is for/);
  });

  test('no comment is written: the verdict record carries the Read line (LIN-4533)', () => {
    const p = prompt([{ id: 'change-abc123', ref: 'https://github.com/acme/widget/pull/7', head: 'H1' }]);
    assert.match(p, /You post no comment on LIN-1/);
    assert.doesNotMatch(p, /## Blind read/);
  });
});

describe('attachLandingChanges hands the landing to a blind read only', () => {
  const store = {
    taskForTicket: async (urlKey, ticket) => (urlKey === 'acme' && ticket === 'LIN-1' ? 'task-1' : null),
    current: async () => null,
    find: async (urlKey, q) => (q.kind === 'change' ? [{ id: 'change-x', state: 'open', fields: { ref: 'https://github.com/acme/widget/pull/7', head: 'H1' } }] : []),
    versionsOf: async () => [],
    run: async () => null,
  };

  test('a non-blind-read kind passes its context through, with no landing key', async () => {
    const ctx = { comments: [] };
    const out = await attachLandingChanges(ctx, { kind: 'review', urlKey: 'acme', recordsStore: store, ticket: 'LIN-1' });
    assert.equal(out, ctx);
    assert.equal('landingChanges' in promptContextOf(out), false);
  });

  test('a blind read with a store gets the change records of the landing it judges', async () => {
    const out = await attachLandingChanges({ comments: [] }, { kind: BLIND_READ_KIND, urlKey: 'acme', recordsStore: store, ticket: 'LIN-1' });
    assert.deepEqual(out.landingChanges, [{ id: 'change-x', ref: 'https://github.com/acme/widget/pull/7', head: 'H1' }]);
    assert.deepEqual(promptContextOf(out).landingChanges, out.landingChanges, 'the projection the prompts read carries it');
  });

  test('a records fault leaves the landing as not read (null), never a guessed id', async () => {
    const broken = { ...store, find: async () => { throw new Error('records down'); } };
    const logged = [];
    const out = await attachLandingChanges({ comments: [] }, { kind: BLIND_READ_KIND, urlKey: 'acme', recordsStore: broken, ticket: 'LIN-1', log: (m) => logged.push(m) });
    assert.equal(out.landingChanges, null);
    assert.equal(logged.length, 1);
  });
});

describe('finding-43b8c886: the records-area leftovers are gone', () => {
  test('standing.js no longer imports viewOf, and spells the audit stage once, in words.js', () => {
    const standing = read('lib/records/standing.js');
    assert.doesNotMatch(standing, /import \{[^}]*\bviewOf\b[^}]*\} from '\.\/views\.js'/);
    assert.doesNotMatch(standing, /const AUDIT = /);
    assert.match(standing, /AUDIT_STAGE/);
    assert.equal(AUDIT_STAGE, 'retrospective-audit');
  });

  test('words.js owns AUDIT_STAGE beside CLOSE_OUT_STAGE, and REVIEW_JUDGEMENT is still its one spelling', () => {
    const words = read('lib/records/words.js');
    assert.match(words, /export const AUDIT_STAGE = 'retrospective-audit'/);
    assert.equal(CLOSE_OUT_STAGE, 'close-out');
    assert.equal(REVIEW_JUDGEMENT, 'review');
  });

  test('task-standing.js no longer re-exports REVIEW_JUDGEMENT (no caller imported it there)', () => {
    assert.equal('REVIEW_JUDGEMENT' in taskStanding, false);
    assert.doesNotMatch(read('lib/task-standing.js'), /export \{ REVIEW_JUDGEMENT \}/);
  });
});
