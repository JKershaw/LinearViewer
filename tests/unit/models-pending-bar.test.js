/**
 * LIN-3952 items 4 and 9: a staged change stays in view. The pending bar is the one place a save is made, it carries
 * the count, the reason, Save and Discard, and it is sticky (public/settings.css). A staged row has a slot for its
 * pending value, the client fills it. After a save the page marks the rows it saved and offers one Undo for them all.
 *
 * Run with: node --test tests/unit/models-pending-bar.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelsBody, savedRowIds } from '../../lib/render-settings-models.js';
import { emptyTable, effectiveTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';

function body(extra = {}) {
  const table = emptyTable();
  return modelsBody({
    urlKey: 'acme', table, effective: effectiveTable(table, { defaultModel: DEFAULT_MODEL }),
    agentSpend: agentSpendByJob([], { jobs: AGENT_JOB_IDS }),
    harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS }),
    presets: [], log: [], catalog: [], availableModels: [], hasRunner: true,
    ...extra
  });
}

const entry = {
  _id: 'entry-1', kind: 'change', reason: 'cheaper bugs', at: new Date().toISOString(),
  actor: { via: 'page', id: 'acct-1', name: 'Ada' },
  changes: [
    { scope: 'job', surface: 'agent-session', key: 'bug', field: 'model', to: 'haiku', from: null },
    { scope: 'group', surface: 'agent-session', key: 'make', field: 'model', to: 'sonnet', from: null }
  ]
};

describe('the pending bar (LIN-3952 item 4)', () => {
  test('the bar is the one save point: it carries the count, the reason, Save and Discard', () => {
    const html = body();
    const bar = html.slice(html.indexOf('data-testid="models-bar"'), html.indexOf('</form>'));
    assert.match(bar, /data-testid="models-staged"/);
    assert.match(bar, /name="reason"/);
    assert.match(bar, /data-testid="models-save"/);
    assert.match(bar, /data-testid="models-discard"/);
  });

  test('Discard is a link back to the page, so it works without the script', () => {
    assert.match(body(), /<a class="btn--quiet" href="\/workspace\/acme\/settings\/models" data-models-discard data-testid="models-discard">Discard<\/a>/);
  });

  test('the reason is one line, not a textarea, so the bar stays short on a phone', () => {
    const form = body().slice(body().indexOf('data-testid="models-changes-form"'), body().indexOf('data-testid="models-preset-save-form"'));
    assert.doesNotMatch(form, /<textarea name="reason"/);
    assert.match(form, /<input type="text" name="reason"/);
  });

  test('a staged row has a slot for its pending value, hidden until the client fills it', () => {
    const html = body();
    assert.match(html, /data-testid="models-job-bug"[\s\S]*?<span class="models-row-pending" data-models-pending hidden><\/span>/);
    assert.match(html, /data-testid="models-group-agent-session-make"[\s\S]*?<span class="models-row-pending" data-models-pending hidden><\/span>/);
  });

  test('the sticky bar and its phone spacing are in the stylesheet', () => {
    const css = readFileSync(new URL('../../public/settings.css', import.meta.url), 'utf8');
    assert.match(css, /\.models-save \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*z-index: 61;/s);
    assert.match(css, /\.models-save\.is-idle \{\s*display: none;/);
  });
});

describe('after a save (LIN-3952 item 9)', () => {
  test('the saved rows are marked, and the notice says how many rows, with one Undo for all of them', () => {
    const html = body({ savedEntry: entry });
    assert.match(html, /data-testid="models-saved"/);
    assert.match(html, /Saved 2 rows\./);
    assert.match(html, /data-testid="models-saved-undo-entry-1"/);
    assert.match(html, /Undo this save \(2 rows\)/);
    assert.match(html, /data-testid="models-job-bug"[^>]*data-saved="true"/);
    assert.match(html, /data-testid="models-group-agent-session-make"[^>]*data-saved="true"/);
  });

  test('the Undo is the change log\'s own undo, and says it goes back to Models', () => {
    const html = body({ savedEntry: entry });
    assert.match(html, /action="\/workspace\/acme\/settings\/change-log\/model\/entry-1\/undo"/);
    assert.match(html, /name="back" value="models"/);
  });

  test('a save the log does not hold reads as a plain "Saved." and marks nothing', () => {
    const html = body({ notice: 'Saved.' });
    assert.doesNotMatch(html, /data-saved="true"/);
    assert.match(html, /data-testid="models-notice"/);
  });

  test('savedRowIds names the rows a change touched, one per job or group', () => {
    assert.deepEqual([...savedRowIds(entry)].sort(), ['models-group-agent-session-make', 'models-job-bug']);
    assert.equal(savedRowIds(null).size, 0);
  });

  test('a saved job is marked wherever it sits, folded or not', () => {
    const html = body({ savedEntry: { ...entry, changes: [{ scope: 'job', surface: 'agent-session', key: 'design', field: 'model', to: 'opus' }] } });
    assert.match(html, /data-testid="models-job-design"[^>]*data-saved="true"/);
  });
});
