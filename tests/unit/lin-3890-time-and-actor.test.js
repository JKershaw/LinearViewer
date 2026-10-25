// LIN-3890: relative times for Settings (one formatter, with a future branch), and
// "You" in the change log, with no account id written into the markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from '../../lib/render.js';
import { changeLogBody } from '../../lib/render-settings-workspace.js';
import { mergeChangeLog, UNNAMED_MEMBER } from '../../lib/workspace-change-log.js';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

test('formatRelativeTime reads a future time as a count, up to 120 days', () => {
  assert.equal(formatRelativeTime(ahead(5 * MIN), NOW), 'in 5m');
  assert.equal(formatRelativeTime(ahead(3 * HOUR), NOW), 'in 3h');
  assert.equal(formatRelativeTime(ahead(2 * DAY), NOW), 'in 2d');
  assert.equal(formatRelativeTime(ahead(89 * DAY), NOW), 'in 89d', 'a 90-day key reads as days, not a date');
  assert.doesNotMatch(formatRelativeTime(ahead(200 * DAY), NOW), /^in \d+[mhd]$/, 'past 120 days it is a date, not a count');
});

test('formatRelativeTime past branch is unchanged', () => {
  assert.equal(formatRelativeTime(ago(10 * MIN), NOW), '10m ago');
  assert.equal(formatRelativeTime(ago(3 * HOUR), NOW), '3h ago');
  assert.equal(formatRelativeTime(ago(1 * DAY), NOW), 'yesterday');
  assert.equal(formatRelativeTime(ago(3 * DAY), NOW), '3d ago');
  assert.equal(formatRelativeTime('', NOW), '');
});

const ACCOUNT_ID = 'acct-7f3c9a1e-viewer';

function renderLog(rows) {
  return changeLogBody({ urlKey: 'w', rows, isOwner: true, viewerAccountId: ACCOUNT_ID });
}

test('the change log says "You" for the viewer’s own change and never prints the account id', () => {
  const merged = mergeChangeLog([
    { _id: 'a', at: new Date(NOW - MIN), actor: { via: 'page', id: ACCOUNT_ID, name: 'Ada' }, setting: 'periodicals', kind: 'change', from: false, to: true }
  ], []);
  const html = renderLog(merged);
  assert.match(html, /You · /);
  assert.ok(!html.includes(ACCOUNT_ID), 'no account id in the markup');
});

test('another member’s change reads by name, and a proxy change with no name reads "via an agent key"', () => {
  const merged = mergeChangeLog([
    { _id: 'b', at: new Date(NOW - MIN), actor: { via: 'page', id: 'someone-else', name: 'Grace' }, setting: 'periodicals', kind: 'change', from: false, to: true }
  ], [
    { _id: 'c', at: new Date(NOW - 2 * MIN), actor: { via: 'proxy', id: 'agent-creator', name: 'a member' }, kind: 'job', changes: [{}], reason: 'r' }
  ]);
  const html = renderLog(merged);
  assert.match(html, /Grace · /);
  assert.match(html, /via an agent key · /);
});

test('mergeChangeLog carries the actor id and via to the renderer', () => {
  const [row] = mergeChangeLog([
    { _id: 'd', at: new Date(NOW), actor: { via: 'page', id: ACCOUNT_ID, name: 'Ada' }, setting: 'periodicals', kind: 'change', from: false, to: true }
  ], []);
  assert.equal(row.actorId, ACCOUNT_ID);
  assert.equal(row.actorVia, 'page');
});

test('a proxy change made with a key the viewer minted reads "You, via an agent key", not plain "You" (review finding 4)', () => {
  const merged = mergeChangeLog([], [
    { _id: 'e', at: new Date(NOW - MIN), actor: { via: 'proxy', id: ACCOUNT_ID, name: 'Ada' }, kind: 'job', changes: [{}], reason: 'r' }
  ]);
  const html = renderLog(merged);
  assert.match(html, /You, via an agent key · /);
  assert.doesNotMatch(html, />[^<]*Ada, via/);
});

test('the unnamed-member fallback is the constant the server writes, so "via an agent key" survives a rename', () => {
  assert.equal(UNNAMED_MEMBER, 'a member');
  const merged = mergeChangeLog([], [
    { _id: 'f', at: new Date(NOW - MIN), actor: { via: 'proxy', id: 'other', name: UNNAMED_MEMBER }, kind: 'job', changes: [{}], reason: 'r' }
  ]);
  assert.match(renderLog(merged), /via an agent key · /);
});
