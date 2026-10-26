/**
 * LIN-3952 item 6: the No job suggestion on the Dispatch page. The stored value and reader are unchanged (the
 * dispatch-prefill tests pin them); this pins the section: its own testid, the same save with back=dispatch, the
 * named fields the save reads, the refusal words, and that it renders for a member too (the audience kept from Models).
 *
 * Run with: node --test tests/unit/dispatch-no-job.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noJobBody, noJobNoticeOf, NO_JOB_NOTE } from '../../lib/components/dispatch-no-job.js';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { emptyTable, applyChangesToTable } from '../../lib/model-routing.js';
import { REFUSAL_MESSAGES } from '../../lib/model-routing-edit.js';
import { SURFACES } from '../../lib/llm-jobs.js';

const AGENT = SURFACES.AGENT_SESSION;
const stored = applyChangesToTable(emptyTable(), [
  { scope: 'default', surface: AGENT, key: 'default', field: 'model', to: 'anthropic/claude-sonnet-5' },
  { scope: 'default', surface: AGENT, key: 'default', field: 'harness', to: 'claude-code' }
]);

describe('the No job section body', () => {
  test('it is one self-contained block with its own testid, and says what it is for', () => {
    const html = noJobBody({ urlKey: 'acme', table: emptyTable() });
    assert.match(html, /data-testid="dispatch-no-job"/);
    assert.ok(html.includes(NO_JOB_NOTE));
  });

  test('it posts the same save as Models, back to Dispatch, with the table version it was rendered from', () => {
    const table = applyChangesToTable(emptyTable(), []);
    const html = noJobBody({ urlKey: 'acme', table });
    assert.match(html, /<form action="\/workspace\/acme\/settings\/models\/changes" method="POST"/);
    assert.match(html, new RegExp(`<input type="hidden" name="version" value="${table.version}">`));
    assert.match(html, /<input type="hidden" name="back" value="dispatch">/);
  });

  test('the fields it posts are the default row\'s, which is the stored value the prefill reads', () => {
    const html = noJobBody({ urlKey: 'acme', table: stored });
    for (const f of ['harness', 'model', 'effort']) assert.match(html, new RegExp(`name="c__default__agent-session__default__${f}"`));
  });

  test('the stored value shows as the current choice', () => {
    const html = noJobBody({ urlKey: 'acme', table: stored });
    assert.match(html, /<option value="claude-code" selected>/);
    assert.match(html, /value="anthropic\/claude-sonnet-5"/);
  });

  test('the reason is one line and required', () => {
    const html = noJobBody({ urlKey: 'acme', table: emptyTable() });
    assert.match(html, /<input type="text" name="reason" required maxlength="500"/);
  });
});

describe('the words a save returns with', () => {
  test('a refusal reads the store\'s own words for it', () => {
    assert.deepEqual(noJobNoticeOf({ no_job_error: 'CONFLICT' }), { tone: 'bad', text: REFUSAL_MESSAGES.CONFLICT });
  });

  test('an unknown refusal reads as a plain failure, and the query is never reflected as text', () => {
    const notice = noJobNoticeOf({ no_job_error: '<script>x</script>' });
    assert.equal(notice.tone, 'bad');
    assert.ok(!notice.text.includes('<script>'));
  });

  test('a saved and an unchanged return read as words, and nothing else reads as a notice', () => {
    assert.deepEqual(noJobNoticeOf({ no_job: 'saved' }), { tone: 'ok', text: 'Saved.' });
    assert.deepEqual(noJobNoticeOf({ no_job: 'nothing' }), { tone: 'ok', text: 'Nothing to change.' });
    assert.equal(noJobNoticeOf({}), null);
    assert.equal(noJobNoticeOf({ no_job: 'anything-else' }), null);
  });
});

describe('the Dispatch page carries the section (LIN-3952 item 6)', () => {
  const body = noJobBody({ urlKey: 'acme', table: emptyTable() });

  test('for an owner and for a member alike, the section and the decision-panel script are on the page', () => {
    for (const featureFlags of [{ runControls: true }, {}]) {
      const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags, noJobHtml: body });
      assert.match(html, /data-testid="dispatch-section-no-job"/);
      assert.match(html, /data-testid="dispatch-no-job"/);
      assert.match(html, /<script src="\/decision-panel\.js"><\/script>/);
    }
  });

  test('without the section body, the page renders with no No job section and no error', () => {
    const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags: {} });
    assert.doesNotMatch(html, /data-testid="dispatch-no-job"/);
  });
});
