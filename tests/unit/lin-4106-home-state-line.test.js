/**
 * LIN-4106 (S4, beat 3) — the opened task's state line on Home is the task page's state line.
 *
 * Pinned here (`renderHomeStatus`, the one state line Home's opened box draws):
 *   - one pill and one sentence, and the sentence is the server's own (`model.sentence`), the same words the task
 *     page's status shows. No "No session running." substitution, no separate "Last:" clause;
 *   - a finished task reads its sentence too, as the task page does (no word-only line);
 *   - the Home and task-page lines carry the same sentence for the same task;
 *   - the lines Home withholds stay withheld: a running task (the running box says it) and a parent whose subtask
 *     needs attention (the subtask line says it once).
 *
 * Run with: node --test tests/unit/lin-4106-home-state-line.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderHomeStatus, renderTaskStatus } from '../../lib/render-task-page.js';

const NOW = new Date('2026-10-06T14:30:00.000Z');
const SENTENCE = 'Last run: Plan finished 1 hour ago · the only run';
const AT = '2026-10-06T13:30:00.000Z';

const idleOpened = (over = {}) => ({
  status: 'idle', sentence: SENTENCE, sentenceAt: AT, sessions: [{ kind: 'plan', state: 'done' }], waitingFor: null, ...over,
});
const idleState = { state: 'next', attention: null };

/** The sentence text a status fragment draws, with the moment's own markup removed. */
function sentenceOf(html, testid) {
  // The moment's own markup (the separator and the time) is not the sentence; the sentence text itself has no markup.
  const cleaned = html.replace(/<span class="task-sentence-sep"[^>]*>[^<]*<\/span>/g, '').replace(/<time[^>]*>[^<]*<\/time>/g, '');
  const m = new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`).exec(cleaned);
  return m ? m[1].trim() : null;
}

describe('LIN-4106 — Home\'s idle line is the server\'s sentence, with no "No session running." and no "Last:" clause', () => {
  test('an idle task with sessions says the server\'s sentence, once', () => {
    const html = renderHomeStatus(idleOpened(), { now: NOW, taskState: idleState });
    assert.equal(sentenceOf(html, 'home-task-sentence'), SENTENCE);
    assert.equal(html.includes('No session running'), false, 'the old substitution is gone');
    assert.equal(html.includes('Last:'), false, 'the raw "Last:" clause is gone');
  });

  test('the line is one pill and one sentence, as the task page\'s is', () => {
    const html = renderHomeStatus(idleOpened(), { now: NOW, taskState: idleState });
    assert.equal((html.match(/data-testid="home-task-status-pill"/g) || []).length, 1);
    assert.equal((html.match(/data-testid="home-task-sentence"/g) || []).length, 1);
  });

  test('a finished task reads its sentence on Home, as the task page does (not a word alone)', () => {
    const model = { status: 'done', sentence: 'Finished 1 day ago.', sentenceAt: null, sessions: [{ kind: 'close-out', state: 'done' }], waitingFor: null };
    const html = renderHomeStatus(model, { now: NOW, taskState: { state: 'done', attention: null } });
    assert.equal(sentenceOf(html, 'home-task-sentence'), 'Finished 1 day ago.');
  });

  test('Home and the task page say the same sentence for the same task', () => {
    const model = idleOpened();
    const home = renderHomeStatus(model, { now: NOW, taskState: idleState });
    const task = renderTaskStatus(model, { now: NOW, taskState: idleState });
    assert.equal(sentenceOf(home, 'home-task-sentence'), sentenceOf(task, 'task-page-sentence'));
  });

  test('a running task still has no Home line: the running box says it once', () => {
    assert.equal(renderHomeStatus(idleOpened({ status: 'running' }), { now: NOW, taskState: { state: 'running', attention: null } }), '');
  });

  test('a parent whose subtask needs attention still withholds its own line: the subtask line says it once', () => {
    const html = renderHomeStatus(idleOpened(), { now: NOW, taskState: { state: 'next', attention: { identifier: 'LIN-2', words: 'needs you' } } });
    assert.equal(html, '');
  });
});
