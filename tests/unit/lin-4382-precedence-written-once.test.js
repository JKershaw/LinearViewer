/**
 * LIN-4382 (piece 4 of LIN-4349): Autopilot's order is written once, with `landed` ranked
 * under real work, and a scoped run takes one Periodical as it finishes.
 *
 * - `AUTOPILOT_PRECEDENCE` (lib/prompts/autopilot-precedence.js) is the one spelling of the
 *   ranks and the tail. No other file in lib/ or routes/ spells them out, and the docs that
 *   used to restate the order name the constant instead.
 * - The kickoff renders it exactly once, in both modes, with no second order beside it.
 * - The tail names the gate marker a Periodical's review task carries, spelled as
 *   lib/periodicals.js spells it, and `POST /autopilot/kickoff` tells a run on such a task
 *   that it takes no tail (so Mint + Autopilot cannot chain readings).
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
  /a Periodical lane reading `due`, the weekly floor/i,
  /a scoped run ends with one Periodical/i
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

describe('the tail skips a Periodical\'s own review task (LIN-4382)', () => {
  test('the marker the policy names is the one lib/periodicals.js writes', () => {
    const marker = buildPeriodicalGateMarker('Seams & Tangles');
    const attr = marker.match(/^<!-- (\S+) /)[1];
    assert.ok(AUTOPILOT_PRECEDENCE.includes('`' + attr + '`'), `the policy names \`${attr}\``);
  });

  test('a kickoff told the task is a Periodical review says it takes no tail; omitted is byte-identical', () => {
    const issue = { identifier: 'LIN-42', title: 'Seams & Tangles review' };
    const bare = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.equal(buildAutopilotKickoff({ baseUrl: BASE_URL, issue, periodicalReview: null }), bare);
    assert.equal(buildAutopilotKickoff({ baseUrl: BASE_URL, issue, periodicalReview: '  ' }), bare);
    const marked = buildAutopilotKickoff({ baseUrl: BASE_URL, issue, periodicalReview: 'seams-tangles' });
    assert.ok(marked.includes('**LIN-42** is the review task of the `seams-tangles` Periodical, so this run takes no tail: stop when it is done.'));
    const general = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.equal(buildAutopilotKickoff({ baseUrl: BASE_URL, periodicalReview: 'seams-tangles' }), general, 'ignored on a general run');
  });

  // The route-level witness: POST /api/proxy/autopilot/kickoff is the path a Mint + Autopilot
  // handoff takes. It reads the issue's description and resolves the marker itself.
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

    async function kickoff(issueIdentifier) {
      const server = app().listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/autopilot/kickoff`, {
          method: 'POST',
          headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueIdentifier, appendProxyContext: false })
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

    test('a gate-marked review task: the kickoff says this run takes no tail', async () => {
      const prompt = await kickoff('TEST-2');
      assert.ok(prompt.includes('**TEST-2** is the review task of the `seams-tangles` Periodical, so this run takes no tail'), 'the no-tail line');
    });

    test('an ordinary task: no such line, the tail stands', async () => {
      const prompt = await kickoff('TEST-1');
      assert.ok(!prompt.includes('so this run takes no tail'));
      assert.ok(prompt.includes("take the policy's tail"));
    });
  });
});

// LIN-4349 correction (parent review b6641b4d, coordinator's call after it): every real
// scoped run declares no `maxTasks`, so `guardBudget` would admit the review task the tail's
// mint opens. The tail drives that review in place (the ruled "one Periodical run, two
// sessions") and keeps Mint + Autopilot only for a run that declares a task budget, where
// the review would be a task past it. The chain guard stays as the backstop.
describe('the tail drives its review in place unless a task budget is declared (LIN-4349)', () => {
  const tailOf = (text) => squash(text.slice(text.indexOf('**The tail: a scoped run ends with one Periodical.**')));
  const issue = { identifier: 'LIN-42', title: 'Some task' };

  test('no budget declared: plain mint, then the run drives the review itself with periodicalId', () => {
    const tail = tailOf(AUTOPILOT_PRECEDENCE);
    assert.ok(tail.includes('Mint it with `POST /periodicals/{id}/mint` (`repo` set for a named lane).'),
      'the mint itself carries no autopilot flag');
    assert.ok(tail.includes('With no task budget declared in your snapshot, drive the review task the mint opens yourself'),
      'the unbudgeted branch drives in place');
    assert.ok(tail.includes('`periodicalId` on the `POST /recommend-and-dispatch` that opens its chain'),
      'the in-place drive stamps periodicalId, so self-exclusion keeps working');
    assert.ok(tail.includes('until it is merged and verified, then stop: that review is the tail and takes no tail of its own'),
      'the in-place review cannot chain another reading');
  });

  test('budget declared: Mint + Autopilot, then stop; never the unconditional handoff', () => {
    const tail = tailOf(AUTOPILOT_PRECEDENCE);
    assert.ok(tail.includes('With a task budget declared, that review would be a task past it (`BUDGET_EXHAUSTED`), so mint with `"autopilot": true` instead, so a run of its own drives the review, then stop.'));
    assert.ok(!tail.includes('Mint it with `POST /periodicals/{id}/mint` and `"autopilot": true`'),
      'the P4 mint-and-stop is no longer the only path');
    const inPlace = tail.indexOf('With no task budget declared');
    const handoff = tail.indexOf('"autopilot": true');
    assert.ok(inPlace >= 0 && handoff > inPlace, 'Mint + Autopilot appears only in the budgeted branch, after the default');
    assert.ok(tail.includes('Nor does a run whose own task is a Periodical\'s review'), 'the chain guard stays');
  });

  test('the budget signal the tail names is the line the kickoff renders for a declared budget, and only then', () => {
    // The kickoff renders the policy indented under its Orient step.
    const rendered = AUTOPILOT_PRECEDENCE.replace(/^(?=.)/gm, '   ');
    const unbudgeted = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    const budgeted = buildAutopilotKickoff({ baseUrl: BASE_URL, issue, maxTasks: 1 });
    assert.ok(unbudgeted.includes(rendered) && budgeted.includes(rendered), 'both render the policy, tail included');
    assert.ok(!/task budget:/i.test(unbudgeted), 'an unbudgeted scoped run states no budget, so the tail drives in place');
    assert.ok(budgeted.includes('**Task budget: up to 1 distinct task this run.**'), 'a budgeted one states it, so the tail hands off');
  });
});
