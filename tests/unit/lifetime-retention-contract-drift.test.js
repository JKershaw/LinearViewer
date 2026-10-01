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
const LLM_CALL_LOG = read('lib/llm-call-log.js');
const PROXY_EVENTS = read('lib/proxy-events.js');
const PERIODICAL_RUNS = read('lib/periodical-runs.js');
const SHIP_BISCUIT = read('lib/ship-biscuit.js');
const SHIP_EDITOR = read('lib/prompts/ship-biscuit-editor.js');
const DISPATCH_STORE = read('lib/dispatch-store.js');
const READ_HORIZON = read('lib/read-horizon.js');
const PASSAGE_PROMPT = read('docs/passage-runner-prompt.md');
const KPI_STATS = read('lib/kpi-stats.js');

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

/**
 * Review Finding 1 (ledger row 1): the stale retention language D missed
 * across 7 files / ~14 sites. Each site is inside D's bounded stale-comment
 * class — a comment/doc string that still describes evidence as expiring
 * ("non-expired", a store retention window / TTL, or rows that "age out")
 * instead of lifetime-retained with a fixed 30-day READ horizon. Guarding it
 * here keeps the same class from drifting back.
 */
describe('lifetime-retention stale-language reconciliation (LIN-3163 Finding 1)', () => {
  test('agent-status-store listStatus no longer calls retained rows "non-expired"', () => {
    assert.doesNotMatch(AGENT_STORE, /non-expired/,
      'status is retained for the life of the project; the list is not bounded by expiry');
    assert.match(AGENT_STORE, /every retained entry/,
      'the no-limit read returns the full retained set');
  });

  test('llm-call-log summarize names the 30-day read window, not a non-expired window', () => {
    assert.doesNotMatch(LLM_CALL_LOG, /non-expired/,
      'the call log is lifetime-retained; the aggregate reads a fixed 30-day horizon');
    assert.match(LLM_CALL_LOG, /30-day read window/,
      'the summarize window is a READ horizon, not a retention bound');
  });

  test('proxy-events listEvents comment no longer claims an in-memory non-expired read', () => {
    assert.doesNotMatch(PROXY_EVENTS, /non-expired/,
      'events are lifetime-retained; listEvents is not filtered on expiry');
    assert.match(PROXY_EVENTS, /full retained history/,
      'listEvents pages over the full retained history in the database');
  });

  test('periodical-runs documents historyTtlMs as a read window and the TypeError says so', () => {
    assert.doesNotMatch(PERIODICAL_RUNS, /store's retention window/,
      'historyTtlMs is a READ window input, not the store retention window');
    assert.doesNotMatch(PERIODICAL_RUNS, /store's own TTL/,
      'dispatch-history carries no TTL to cap against');
    assert.doesNotMatch(PERIODICAL_RUNS, /store's historyTtl/,
      'the TypeError must not call the input the store\'s historyTtl');
    assert.doesNotMatch(PERIODICAL_RUNS, /full window the store can still hold/,
      'the `never` gloss is bounded by the 30-day read window, not by store capacity');
    assert.match(PERIODICAL_RUNS, /read-horizon input, in ms/,
      'the required-input TypeError names the read-horizon input');
    assert.match(PERIODICAL_RUNS, /lifetime-retained/);
  });

  test('ship-biscuit grounds from the pinned snapshot, not a false all-sources lifetime claim', () => {
    // The old false claim: every source row is lifetime-retained. Only the six evidence
    // stores are; the observation-sessions read-model still ages out and the snapshot /
    // report stores are capacity-capped.
    assert.doesNotMatch(SHIP_BISCUIT, /source rows are lifetime-retained/,
      'not all sources are lifetime-retained: observation-sessions still ages out at 30 days, and task snapshots / report history are capacity-capped');
    assert.match(SHIP_BISCUIT, /from the snapshot itself/,
      'the pinned snapshot is the grounding guarantee, independent of any later store read');
    assert.match(SHIP_BISCUIT, /lifetime-retained \(LIN-3163\)/,
      'the six evidence stores are lifetime-retained (LIN-3163)');
    assert.match(SHIP_BISCUIT, /observation-sessions read-model still ages/,
      'the observation-sessions read-model keeps its 30-day TTL (out of scope)');
    assert.match(SHIP_BISCUIT, /report-history is capacity-capped/,
      'the roadmap/report-history site names the capped store it reads from');

    assert.doesNotMatch(SHIP_EDITOR, /source rows are lifetime-retained|all source rows are lifetime/,
      'the editor prompt must not claim every source is lifetime-retained');
    assert.match(SHIP_EDITOR, /grounding from the pinned snapshot/,
      'the durable edition stays grounded from the pinned snapshot');
    assert.match(SHIP_EDITOR, /lifetime-retained \(LIN-3163\)/);
    assert.match(SHIP_EDITOR, /observation-sessions read-model still ages/,
      'the editor keeps the observation-sessions qualifier the ship-biscuit grounds carry');
  });

  test('dispatch-store records the flip as done, not as "moving to lifetime retention"', () => {
    assert.doesNotMatch(DISPATCH_STORE, /moving to lifetime retention/,
      'dispatch-history has moved; the note must state it is retained');
    assert.match(DISPATCH_STORE, /now lifetime-retained/);
  });

  test('read-horizon records the flip as done, not as "moving to lifetime retention"', () => {
    assert.doesNotMatch(READ_HORIZON, /moving to lifetime retention/);
    assert.match(READ_HORIZON, /retained for the life of the project/);
  });

  test('the passage-runner prompt calls the /cost gap a 30-day read window, not retention', () => {
    assert.doesNotMatch(PASSAGE_PROMPT, /30-day app-call retention window/,
      '/cost reads a fixed 30-day horizon; app-call evidence is lifetime-retained');
    assert.match(PASSAGE_PROMPT, /30-day app-call read window/);
  });

  test('the published /kpis workspace basis names the 30-day read window, not retention', () => {
    // C1: the workspace count is built from readHorizonStart()-bounded reads, so a
    // dormant workspace with retained activity older than 30 days is retained but
    // not counted. "retained activity" is false on deploy — the basis describes the
    // 30-day READ window, not store retention.
    assert.doesNotMatch(KPI_STATS, /≤30d-TTL|30-day history retention|with retained activity/,
      '/kpis reads the fixed 30-day horizon; evidence is lifetime-retained, so the basis cannot say "retained activity"');
    assert.match(KPI_STATS, /activity in the 30-day read window/,
      'the workspace-count basis describes activity in the 30-day read window');
  });
});
