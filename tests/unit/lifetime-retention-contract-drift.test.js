/**
 * LIN-3163 (LIN-3157 D): contract/doc/comment consistency for the lifetime
 * retention flip. Evidence is retained for the life of the project; window
 * figures (/cost, /kpis, periodicals, summaries) still read a fixed 30-day
 * READ horizon. This is a source-text guard so the published contract and docs
 * cannot drift back to the old "30-day retention" language.
 *
 * Run with: node --test tests/unit/lifetime-retention-contract-drift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Collapse whitespace so a phrase split across a line wrap still matches.
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8').replace(/\s+/g, ' ');

const INSTRUCTIONS = read('lib/proxy-instructions.js');
const INTEGRATION = read('docs/proxy-integration.md');
const ARCH = read('docs/architecture/dispatch-and-proxy.md');
const FOSSIL_SCRIPT = read('scripts/fossil-pass-lin2633.js');
const FOSSIL_DOC = read('docs/fossil-bookkeeping-pass.md');
const AGENT_STORE = read('lib/agent-status-store.js');
const AGENT_ROUTE = read('routes/proxy-agent-status.js');
const STEADY_BASE = read('docs/steady-base.md');
const EFFORT = read('docs/papers/harbour/where-the-effort-goes.md');
const THROUGHPUT = read('docs/papers/harbour/measuring-throughput.md');

describe('lifetime-retention contract language (LIN-3163)', () => {
  test('the published instructions state lifetime retention and drop the old retention phrasing', () => {
    assert.match(INSTRUCTIONS, /retained for the life of the project/);
    assert.match(INSTRUCTIONS, /no evidence in the 30-day read window/i);
    assert.doesNotMatch(INSTRUCTIONS, /default 30-day retention/, 'the old app-call retention claim is gone');
    assert.doesNotMatch(INSTRUCTIONS, /configures "historyTtl"/, 'the stale historyTtl mention is gone');
  });

  test('docs/proxy-integration.md states lifetime retention and drops the 30-day retention/TTL claims', () => {
    assert.match(INTEGRATION, /retained for the life of the project/);
    assert.doesNotMatch(INTEGRATION, /30-day retention/, 'no surface claims 30-day retention');
    assert.doesNotMatch(INTEGRATION, /30-day TTL/, 'no surface claims a 30-day TTL');
  });

  test('docs/architecture/dispatch-and-proxy.md states lifetime retention and drops the 30-day TTL claims', () => {
    assert.match(ARCH, /retained for the life of the project/);
    assert.doesNotMatch(ARCH, /30-day history TTL/);
    assert.doesNotMatch(ARCH, /30-day TTL/);
  });

  test('the four agent-status surfaces say the read pages over the full retained history', () => {
    for (const [label, src] of [
      ['store', AGENT_STORE],
      ['contract', INSTRUCTIONS],
      ['route', AGENT_ROUTE],
      ['doc', INTEGRATION]
    ]) {
      assert.match(src, /full retained history/, `${label} must describe paging over the full retained history`);
    }
  });

  test('the fossil pass no longer claims history is pruned by a 30-day TTL', () => {
    assert.match(FOSSIL_SCRIPT, /lifetime-retained/, 'the script explains retention is now lifetime');
    assert.doesNotMatch(FOSSIL_SCRIPT, /history TTL \(`historyTtl`/, 'the stale history-TTL rationale is gone');
    assert.doesNotMatch(FOSSIL_DOC, /already pruned/, 'the doc no longer says >30d rows are already pruned');
  });

  test('docs/steady-base.md and the two papers carry the landed ruling', () => {
    assert.match(STEADY_BASE, /LIN-3163/);
    assert.match(EFFORT, /LIN-3163/);
    assert.match(THROUGHPUT, /LIN-3163/);
  });
});
