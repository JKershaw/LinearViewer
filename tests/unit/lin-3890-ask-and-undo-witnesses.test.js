// LIN-3890 review witnesses for the ask in place, the Undo rows and the Features copy. Each
// assertion is one the review found no test for: a mutation of it left the suite green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askInPlace } from '../../lib/components/settings-ask.js';
import { undoRowFor, runningBody, agentAccessBody, changeLogBody } from '../../lib/render-settings-workspace.js';
import { featuresBody } from '../../lib/render-settings-you.js';
import { buildKeyList } from '../../lib/settings-keys.js';

const base = { summary: 'Revoke this key', willHappen: 'Stops working.', confirmLabel: 'Revoke key', tone: 'red', cancelHref: '/workspace/w/settings/agent-access' };

test('an ask in place always has a Cancel, in both transports', () => {
  const form = askInPlace({ ...base, action: '/x', testid: 'a' });
  const script = askInPlace({ ...base, transport: 'script', method: 'DELETE', action: '/x', testid: 'a' });
  for (const html of [form, script]) {
    assert.match(html, /data-settings-ask-cancel/);
    assert.match(html, /href="\/workspace\/w\/settings\/agent-access"/);
    assert.match(html, /data-testid="a-cancel"/);
  }
});

test('the form transport takes only POST: a GET or DELETE is refused, so a write can never fall back to GET', () => {
  assert.throws(() => askInPlace({ ...base, action: '/x', method: 'GET' }), /form transport takes POST/);
  assert.throws(() => askInPlace({ ...base, action: '/x', method: 'DELETE' }), /form transport takes POST/);
  assert.doesNotThrow(() => askInPlace({ ...base, action: '/x', method: 'POST' }));
});

test('the script transport takes only DELETE (key revoke), and its Confirm names the route and method', () => {
  assert.throws(() => askInPlace({ ...base, transport: 'script', method: 'POST', action: '/x' }), /script transport takes DELETE/);
  const html = askInPlace({ ...base, transport: 'script', method: 'DELETE', action: '/api/k', testid: 'a' });
  assert.match(html, /type="button"[^>]*data-settings-ask-route="\/api\/k"[^>]*data-settings-ask-method="DELETE"/);
  assert.doesNotMatch(html, /<form/, 'no form is posted by the script transport');
});

test('a halt Undo is owner-only: a member is offered no Undo row for it', () => {
  const rows = [{ source: 'workspace', setting: 'halt', id: 'h1', undoable: true, summary: 'Runs paused' }];
  assert.equal(undoRowFor(rows, 'halt', { urlKey: 'w', isOwner: false }), '');
  assert.match(undoRowFor(rows, 'halt', { urlKey: 'w', isOwner: true }), /settings-undo-h1/);
});

test('an undo row names the setting it puts back, not "the last change"', () => {
  const rows = [{ source: 'workspace', setting: 'periodicals', id: 'p1', undoable: true, summary: 'Periodic reviews on' }];
  const html = undoRowFor(rows, 'periodicals', { urlKey: 'w', isOwner: true });
  assert.match(html, /Undo: Periodic reviews/);
  assert.doesNotMatch(html, /Undo the last change/);
});

test('a saved change shows no "Saved." bar: the changed row carries its own Undo', () => {
  const changeRows = [{ source: 'workspace', setting: 'periodicals', id: 'p1', undoable: true, summary: 'Periodic reviews on', at: '2026-10-25T11:00:00.000Z', actorName: 'Ann' }];
  const html = runningBody({ urlKey: 'w', isOwner: true, hasRunner: true, periodicals: true, changeRows, now: Date.parse('2026-10-25T12:00:00.000Z') });
  assert.doesNotMatch(html, /Saved\./);
  assert.doesNotMatch(html, /settings-flash/);
  assert.match(html, /Undo: Periodic reviews/);
});

test('the change log shows no "Change undone." bar, and its error keeps the error contract', () => {
  const html = changeLogBody({ urlKey: 'w', rows: [], undone: 'x' });
  assert.doesNotMatch(html, /Change undone/);
  const err = changeLogBody({ urlKey: 'w', rows: [], error: 'Refused.' });
  assert.match(err, /settings-flash settings-flash-error/);
});

test('the non-owner key row has no Confirm and no script route', () => {
  const keys = buildKeyList({
    proxyRows: [{ tokenId: 't', label: 'runner', kind: 'standard', scope: 'readWrite', grants: ['take'], expiresAt: '2026-11-20T00:00:00.000Z', lastUsedAt: null, consumed: false, parentTokenId: null, hasOwner: true }],
    dispatchRows: [], isOwner: false, urlKey: 'w', now: Date.parse('2026-10-25T12:00:00.000Z')
  });
  const html = agentAccessBody({ urlKey: 'w', keys, now: Date.parse('2026-10-25T12:00:00.000Z') });
  assert.match(html, /settings-key-owner-only/);
  assert.doesNotMatch(html, /settings-key-revoke-confirm/);
  assert.doesNotMatch(html, /data-settings-ask-route/);
});

test('"(experimental)" is said once, in the experiments group, never on a row', () => {
  const html = featuresBody({ urlKey: 'w', featureFlags: {}, proxyDefault: true });
  assert.equal((html.match(/\(experimental\)/g) || []).length, 0);
  assert.match(html, /data-testid="settings-section-experimental"/);
  assert.match(html, /Experiments · for you/);
  assert.match(html, /data-testid="settings-section-views"/);
});
