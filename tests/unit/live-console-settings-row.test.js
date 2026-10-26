/**
 * LIN-3977 (outcome 11, principle 4): the Settings › Features Live Console row shows the
 * EFFECTIVE state (`liveConsoleOn`), says where it comes from, and is plain-worded.
 *
 * Run with: node --test tests/unit/live-console-settings-row.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featuresBody } from '../../lib/render-settings-you.js';
import { liveConsoleOn } from '../../lib/run-controls.js';
import { FEATURE_DESCRIPTIONS } from '../../lib/feature-defaults.js';

const rowOf = (html) => html.match(/<div class="settings-row settings-row-switch" data-feature="liveConsole"[\s\S]*?<\/form>/)[0];
const body = (stored, runControls) => featuresBody({
  urlKey: 'w', featureFlags: { runControls, liveConsole: liveConsoleOn(stored, runControls) }
});

test('a runner owner with no stored flag sees "on", and pressing it posts an opt-out', () => {
  const row = rowOf(body(undefined, true));
  assert.match(row, /aria-checked="true"/);
  assert.match(row, /● on/);
  assert.match(row, /name="enabled" value="false"/);
});

test('the on row says it is on because the workspace has a runner', () => {
  assert.match(rowOf(body(undefined, true)), /On because this workspace has a runner; turn it off to opt out/);
});

test('a stored false opts out even with a runner: the row reads off, with the plain subtitle', () => {
  const row = rowOf(body(false, true));
  assert.match(row, /aria-checked="false"/);
  assert.match(row, /name="enabled" value="true"/);
  assert.doesNotMatch(row, /On because this workspace has a runner/);
  assert.match(row, /Watch your agents work, live/);
});

test('without a runner and nothing stored the row reads off, with no runner note', () => {
  const row = rowOf(body(undefined, false));
  assert.match(row, /aria-checked="false"/);
  assert.doesNotMatch(row, /On because this workspace has a runner/);
});

test('the user-visible Live Console copy has no "swarm"', () => {
  assert.doesNotMatch(FEATURE_DESCRIPTIONS.liveConsole, /swarm/i);
  assert.doesNotMatch(body(undefined, true), /swarm/i);
  const page = readFileSync(new URL('../../lib/render-live-console.js', import.meta.url), 'utf8');
  const copyLines = page.split('\n').filter((l) => /subtitle:/.test(l));
  assert.ok(copyLines.length > 0);
  for (const l of copyLines) assert.doesNotMatch(l, /swarm/i);
});
