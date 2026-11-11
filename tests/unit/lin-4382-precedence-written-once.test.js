/**
 * LIN-4382 (piece 4 of LIN-4349): Autopilot's order is written once, with `landed` ranked
 * under real work.
 *
 * - `AUTOPILOT_PRECEDENCE` (lib/prompts/autopilot-precedence.js) is the one spelling of the
 *   ranks. No other file in lib/ or routes/ spells them out, and the docs that used to
 *   restate the order name the constant instead.
 * - The kickoff renders it exactly once, in every mode, with no second order beside it.
 * - LIN-4415: a scoped run stops once its task is complete. The completion Periodical
 *   LIN-4382 gave it (the tail), the tail's LIN-4349 budget branch and its chain guard are
 *   retired; a census below fails if their wording comes back in lib/, routes/ or the live
 *   docs. A Periodical is still started on purpose: by a person (the mint routes) or by a
 *   goal that asks (rank 1, carried on the scoped goal block).
 *
 * Run with: node --test tests/unit/lin-4382-precedence-written-once.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTOPILOT_PRECEDENCE } from '../../lib/prompts/autopilot-precedence.js';
import { buildAutopilotKickoff } from '../../lib/prompts/autopilot-kickoff.js';
import { buildPeriodicalGateMarker, getPeriodicals } from '../../lib/periodicals.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER = 'lib/prompts/autopilot-precedence.js';
const BASE_URL = 'https://example.com';

/**
 * Ways a file spells out the ranks, old and new. Whitespace is collapsed before matching, so
 * a rewrap does not hide one. Pointers ("walk the stack under the precedence policy") and the
 * ~40 unrelated uses of the word "precedence" in lib/ match none of these.
 */
const RANK_PATTERNS = [
  // The old two- and three-level lists: "(1) an explicit goal from the human, else (2) ...".
  /\(1\)\**\s*an? (explicit )?goal from the human,? else/i,
  /overdue periodical/i,
  /past its cadence threshold/i,
  /supersedes the Orient/i,
  // The new order's own distinctive clauses.
  /no stack work can move now/i,
  /a Periodical lane reading `due`, the weekly floor/i
];

const squash = (text) => text.replace(/\s+/g, ' ');

function jsFiles(rel) {
  const out = [];
  for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const path = `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...jsFiles(path));
    else if (ent.name.endsWith('.js')) out.push(path);
  }
  return out;
}

describe('AUTOPILOT_PRECEDENCE: the ranks have one spelling (LIN-4382)', () => {
  test('the leaf carries the four ranks in order, `landed` under the stack', () => {
    const text = squash(AUTOPILOT_PRECEDENCE);
    const goal = text.indexOf('1. an explicit goal from the human');
    const due = text.indexOf('2. a Periodical lane reading `due`');
    const stack = text.indexOf('3. the top of the stack');
    const landed = text.indexOf('4. a Periodical lane reading `landed`');
    assert.ok(goal >= 0 && goal < due && due < stack && stack < landed, 'goal, due, stack, landed in that order');
    assert.match(text, /only when no stack work can move now: every remaining task is in Backlog, waiting on a person, blocked or already running/);
    assert.match(text, /Oldest last run first, with only one in flight/);
  });

  test('every pattern the census uses matches the leaf (so the census can see a copy)', () => {
    const text = squash(AUTOPILOT_PRECEDENCE);
    for (const re of RANK_PATTERNS.slice(4)) assert.match(text, re, `the leaf carries ${re}`);
  });

  test('the leaf imports nothing', () => {
    const src = readFileSync(join(ROOT, OWNER), 'utf8');
    assert.doesNotMatch(src, /^\s*import\b/m);
  });

  test('no other file in lib/ or routes/ spells out the ranks', () => {
    const offenders = [];
    for (const path of [...jsFiles('lib'), ...jsFiles('routes')]) {
      if (path === OWNER) continue;
      const text = squash(readFileSync(join(ROOT, path), 'utf8'));
      const hit = RANK_PATTERNS.find((re) => re.test(text));
      if (hit) offenders.push(`${path} (${hit})`);
    }
    assert.deepEqual(offenders, [], `import AUTOPILOT_PRECEDENCE from ${OWNER} instead of restating the order`);
  });

  test('the census fails on a restatement (mutation witness)', () => {
    const restated = 'Pick in this order: (1) an explicit goal from the human, else (2) the top of the stack.';
    assert.ok(RANK_PATTERNS.some((re) => re.test(squash(restated))));
    const pointer = 'none this run — walk the stack under the precedence policy.';
    assert.ok(!RANK_PATTERNS.some((re) => re.test(squash(pointer))), 'a pointer is not a restatement');
  });
});

describe('the docs point at AUTOPILOT_PRECEDENCE instead of restating it (LIN-4382)', () => {
  const POINTER_DOCS = ['docs/autopilot.md', 'docs/autopilot-kickoff.md', 'docs/architecture/source-map.md', 'docs/plans/survey.md'];

  for (const doc of POINTER_DOCS) {
    test(`${doc} names the constant and spells out no ranks`, () => {
      const text = readFileSync(join(ROOT, doc), 'utf8');
      assert.ok(text.includes('AUTOPILOT_PRECEDENCE'), `${doc} names AUTOPILOT_PRECEDENCE`);
      const hit = RANK_PATTERNS.find((re) => re.test(squash(text)));
      assert.equal(hit, undefined, `${doc} restates the order (${hit})`);
    });
  }

  test('the Stage B draft keeps its old order only as marked history, with the pointer', () => {
    const text = readFileSync(join(ROOT, 'docs/autopilot-orchestrator-prompt.md'), 'utf8');
    const at = text.indexOf('past its cadence threshold');
    assert.ok(at >= 0, 'the historical order is left as written');
    const before = text.slice(Math.max(0, at - 1200), at);
    assert.match(before, /historical/i, 'marked historical above the old list');
    assert.ok(before.includes('AUTOPILOT_PRECEDENCE'), 'with a pointer to the constant');
  });
});

describe('the kickoff renders the policy once, in both modes (LIN-4382)', () => {
  const issue = { identifier: 'LIN-42', title: 'Fix the thing' };
  const general = buildAutopilotKickoff({ baseUrl: BASE_URL });
  const scoped = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
  const stepper = buildAutopilotKickoff({ baseUrl: BASE_URL, issue, variant: 'stepper' });
  const FIRST_LINE = AUTOPILOT_PRECEDENCE.split('\n')[0];

  for (const [name, text] of [['general', general], ['scoped', scoped], ['stepper', stepper]]) {
    test(`${name}: the policy appears exactly once, in the Orient step`, () => {
      assert.equal(text.split(FIRST_LINE).length - 1, 1, 'one rendering');
      const orient = text.indexOf('1. **Orient.**');
      const trigger = text.indexOf('2. **Trigger the next step.**');
      const at = text.indexOf(FIRST_LINE);
      assert.ok(orient < at && at < trigger, 'inside step 1');
      for (const line of AUTOPILOT_PRECEDENCE.split('\n').filter(Boolean)) {
        assert.ok(text.includes(`   ${line}`), `renders verbatim (indented into the list item): ${line.slice(0, 50)}`);
      }
    });
  }

  test('neither mode carries a second order, the supersedes clause or P3\'s interim `landed` line', () => {
    for (const text of [general, scoped]) {
      assert.ok(!text.includes('supersedes the Orient'));
      assert.ok(!text.includes('rank it as `recent`'));
      assert.ok(!/\(1\) an explicit goal from the human, else \(2\)/.test(squash(text)));
    }
  });
});

// LIN-4415 retired the completion tail. With no default tail there is nothing for a Periodical's
// review run to chain, so its guard (the policy's gate-marker sentence and the kickoff's
// review-task line) went with it: the review's run is a scoped run with no goal, and it stops.
describe('a scoped run stops once its task is complete (LIN-4415)', () => {
  test('the policy names no gate marker and no tail', () => {
    const marker = buildPeriodicalGateMarker('Seams & Tangles');
    const attr = marker.match(/^<!-- (\S+) /)[1];
    assert.ok(!AUTOPILOT_PRECEDENCE.includes(attr), `the policy no longer names \`${attr}\``);
    assert.ok(!/\btail\b/i.test(AUTOPILOT_PRECEDENCE), 'the policy carries no tail');
    assert.ok(AUTOPILOT_PRECEDENCE.includes('mint the lane with `POST /periodicals/{id}/mint`'),
      'the mint-and-drive instruction stays, for a goal that asks for a Periodical');
  });

  // The route-level witness: POST /api/proxy/autopilot/kickoff is the path a Mint + Autopilot
  // handoff takes (PERIODICAL_AUTOPILOT_TAIL, lib/periodicals.js, passes no goal).
  describe('POST /api/proxy/autopilot/kickoff', () => {
    const TOKEN = 'lin-4382-token';
    const URL_KEY = 'acme';
    const SEAMS = getPeriodicals().find((t) => t.id === 'seams-tangles');
    let provider;
    let queue;
    let store;

    beforeEach(async () => {
      const { store: issues } = createLocalStore();
      await issues.seed(TOKEN, {
        projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
        issues: [
          { id: 'i1', identifier: 'TEST-1', title: 'Ordinary work', description: 'Fix the login bug.', projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
          { id: 'i2', identifier: 'TEST-2', title: 'Seams & Tangles review', description: `${buildPeriodicalGateMarker(SEAMS.title)}\nRead the seams.`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }
        ]
      });
      provider = new LocalProvider({ store: issues });
      queue = createMockCollection();
      store = new DispatchQueueStore({ collection: queue, historyCollection: createMockCollection() });
    });

    function app() {
      const a = express();
      a.use(express.json());
      a.use(createProxyRoutes({
        provider,
        proxyTokenStore: {
          createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
          validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' })
        },
        proxyEventStore: { recordEvent: async () => {} },
        resolveWorkspaceAccess: async () => ({ token: TOKEN, reason: 'ok', provider: 'local', source: 'session-scan', expiresAt: Date.now() + 3600_000 }),
        getWorkspaceAccessToken: async () => TOKEN,
        getWorkspaceOpenRouterKey: async () => null,
        agentStatusStore: {},
        recapCacheStore: { get: async () => null, set: async () => {} },
        briefCacheStore: { get: async () => null, set: async () => {} },
        dispatchQueueStore: store,
        workspaceFromUrl: (req, res, next) => next(),
        workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
        freeTierStore: { tryUse: async () => ({ allowed: true }) }
      }));
      return a;
    }

    async function kickoff(issueIdentifier, extra = {}) {
      const server = app().listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/autopilot/kickoff`, {
          method: 'POST',
          headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueIdentifier, appendProxyContext: false, ...extra })
        });
        const body = await res.json();
        assert.equal(res.status, 201, JSON.stringify(body));
        const rows = await queue.find({}).toArray();
        const row = rows.find((r) => String(r._id) === body.id || r.id === body.id) || rows.at(-1);
        return row.prompt;
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }

    const STOPS = "start no Periodical unless the human's goal asks for\none. Once it is complete, stop;";

    // What the retired guard was there to stop: a review's run chaining the next reading. It is
    // now told to stop like any scoped run, with no review-specific line and no tail to take.
    test('a gate-marked review task: no review-specific line and no tail; the run stops', async () => {
      const prompt = await kickoff('TEST-2');
      assert.ok(!prompt.includes('is the review task of the'), 'no review-specific line');
      assert.ok(!/policy's tail|takes no tail|ends with one Periodical/i.test(prompt), 'no retired tail wording anywhere');
      assert.ok(prompt.includes(STOPS), 'told to stop once its task is complete');
    });

    test('an ordinary task: no tail; the run stops', async () => {
      const prompt = await kickoff('TEST-1');
      assert.ok(!/policy's tail|takes no tail|ends with one Periodical/i.test(prompt));
      assert.ok(prompt.includes(STOPS));
    });

    test('a goal that asks for a Periodical rides on the scoped run, with rank 1 and the mint instruction', async () => {
      const goal = 'then run the Seams & Tangles Periodical';
      const prompt = await kickoff('TEST-1', { goal });
      assert.ok(prompt.includes(`**Additional context from the human:** ${goal}`));
      assert.ok(prompt.includes('1. an explicit goal from the human;'));
      assert.ok(prompt.includes('mint the lane with `POST /periodicals/{id}/mint`'));
    });
  });
});

// LIN-4415 retired-phrase census: the completion tail, its pointers, its LIN-4349 budget branch and
// its chain guard. Any of these in lib/ or routes/ JavaScript, or in the live docs, is stale text
// that tells a scoped run to take a Periodical it was not asked for. Dated records (docs/papers,
// docs/reviews, docs/plans) stay as written. `isPeriodicalReview` (LIN-4398) is a different symbol
// and is not matched: the `periodicalReview` pattern is case-sensitive and word-bounded.
describe('the retired completion tail is gone from code and live docs (LIN-4415)', () => {
  const RETIRED = [
    /policy's tail/i,
    /scoped-run tail/i,
    /scoped run's tail/i,
    /ends with one Periodical/i,
    /takes no tail/i,
    /tail of its own/i,
    /\bperiodicalReview\b/,
    /one Periodical, then stop/i,
    /then the tail/i
  ];

  function liveDocs() {
    const out = [];
    for (const name of readdirSync(join(ROOT, 'docs'))) {
      if (/^autopilot.*\.md$/.test(name) || name === 'proxy-integration.md') out.push(`docs/${name}`);
    }
    const walk = (rel) => {
      for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const path = `${rel}/${ent.name}`;
        if (ent.isDirectory()) walk(path);
        else if (ent.name.endsWith('.md')) out.push(path);
      }
    };
    walk('docs/architecture');
    walk('docs/areas');
    return out;
  }

  const hitsIn = (text) => RETIRED.filter((re) => re.test(squash(text)));

  test('no JavaScript in lib/ or routes/, and no live doc, carries the retired wording', () => {
    const offenders = [];
    for (const path of [...jsFiles('lib'), ...jsFiles('routes'), ...liveDocs()]) {
      const hits = hitsIn(readFileSync(join(ROOT, path), 'utf8'));
      if (hits.length) offenders.push(`${path} (${hits.join(', ')})`);
    }
    assert.deepEqual(offenders, []);
  });

  test('the census sees the retired wording, and spares isPeriodicalReview (mutation witness)', () => {
    assert.ok(hitsIn("Once it is complete, take the policy's tail (one Periodical,\nthen stop)").length >= 2);
    assert.ok(hitsIn('**The tail: a scoped run ends with one Periodical.**').length === 1);
    assert.ok(hitsIn('const { periodicalReview } = st;').length === 1);
    assert.deepEqual(hitsIn('if (isPeriodicalReview(issue)) return;'), []);
    assert.deepEqual(hitsIn('withAutopilotTail(prompt, PERIODICAL_AUTOPILOT_TAIL)'), []);
  });

  test('the live-doc set covers the docs the tail was written into', () => {
    const docs = liveDocs();
    for (const doc of ['docs/autopilot.md', 'docs/autopilot-kickoff.md', 'docs/autopilot-operating-manual.md',
      'docs/autopilot-orchestrator-prompt.md', 'docs/proxy-integration.md', 'docs/architecture/source-map.md',
      'docs/areas/runs-and-dispatch.md']) {
      assert.ok(docs.includes(doc), `${doc} is scanned`);
    }
  });
});
