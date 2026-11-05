// LIN-4248: the Survey kinds ("survey-task", "survey-place") are read-only. Their
// dispatched prompt's "Workspace API access" block must not invite PRs, commits or
// ticket edits; it asks for the one comment on the surveyed ticket instead. Every
// other kind keeps the historical block byte-identical.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachProxyContext,
  buildProxyContextPreamble,
  SURVEY_KINDS
} from '../../lib/proxy-preamble.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';

const BASE_URL = 'https://host';
const ISSUE = 'LIN-42';
const SURVEY_KINDS_UNDER_TEST = ['survey-task', 'survey-place'];

// The exact sentences the gate swaps. Literal copies so a drift in the constant
// text fails here rather than passing silently.
const REVERSIBLE_MANDATE = 'Being dispatched here is your mandate for the reversible work — investigate, edit, open PRs, comment: do not hold your first call, or any call, waiting for a live reply before you start.';
const SURVEY_MANDATE = 'Being dispatched here is a read-only forecast: investigate and read freely, but do not change code, branches, pull requests, tickets or Linear state; your only write is the one comment on the surveyed ticket named in your task, and do not hold your first call, or any call, waiting for a live reply before you start.';
const REVERSIBLE_CLOSING = [
  'Your runner reports back automatically when this session stops — you do not',
  'need to curl anything to phone home. Just END with a concise summary that',
  'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
  'report carries proof rather than a bare "done".',
  ''
].join('\n');
const SURVEY_CLOSING = [
  'Your runner reports back automatically when this session stops — you do not',
  'need to curl anything to phone home. Just END with the link to the one comment you',
  'posted on the surveyed ticket, so the report carries proof rather than a bare "done".',
  ''
].join('\n');

function build(over = {}) {
  return buildProxyContextPreamble({
    baseUrl: BASE_URL,
    token: 'BOOT_TOK',
    issueIdentifier: ISSUE,
    ...over
  });
}

// A token store stub mirroring proxyTokenStore.createToken's shape (see
// tests/unit/proxy-preamble.test.js fakeStore).
function fakeStore(token = 'BOOT_TOK') {
  const calls = [];
  return {
    calls,
    async createToken(urlKey, options) {
      calls.push({ urlKey, options });
      return { token, scope: options?.scope };
    }
  };
}

describe('LIN-4248 — SURVEY_KINDS', () => {
  test('is exactly the two read-only survey kinds', () => {
    assert.deepEqual([...SURVEY_KINDS], SURVEY_KINDS_UNDER_TEST);
  });
});

describe('LIN-4248 — non-Survey kinds are byte-identical', () => {
  const NON_SURVEY = [null, undefined, 'implementation', 'review', 'retro', 'triage', 'custom', 'autopilot'];

  for (const kind of NON_SURVEY) {
    test(`kind ${JSON.stringify(kind)}: output equals the no-kind output in both delivery modes`, () => {
      for (const tokenDelivery of ['prose', 'mcp']) {
        const without = build({ tokenDelivery });
        const withKind = build({ tokenDelivery, kind });
        assert.equal(withKind, without);
      }
    });
  }

  test('representative non-Survey kinds keep "open PRs" and "PR link" in the block', () => {
    for (const kind of ['implementation', 'review', 'retro', 'triage']) {
      const block = build({ kind });
      assert.ok(block.includes('open PRs'), `${kind} keeps the open-PRs mandate`);
      assert.ok(block.includes('PR link'), `${kind} keeps the PR-link closing`);
      assert.ok(block.includes('commit SHA'), `${kind} keeps the commit-SHA closing`);
      assert.ok(block.includes(REVERSIBLE_MANDATE), `${kind} keeps the reversible mandate`);
      assert.ok(block.endsWith(REVERSIBLE_CLOSING), `${kind} keeps the evidence closing`);
    }
  });
});

describe('LIN-4248 — Survey kinds get the read-only block', () => {
  for (const kind of SURVEY_KINDS_UNDER_TEST) {
    for (const tokenDelivery of ['prose', 'mcp']) {
      test(`${kind} (${tokenDelivery}): no open-PRs, PR-link or commit-SHA wording`, () => {
        const block = build({ kind, tokenDelivery });
        assert.ok(!block.includes('open PRs'), 'no open-PRs mandate');
        assert.ok(!block.includes('PR link'), 'no PR-link closing');
        assert.ok(!block.includes('commit SHA'), 'no commit-SHA closing');
      });

      test(`${kind} (${tokenDelivery}): read-only wording, brief line and catalog line survive`, () => {
        const block = build({ kind, tokenDelivery });
        assert.ok(block.includes(SURVEY_MANDATE), 'read-only mandate present');
        assert.ok(block.endsWith(SURVEY_CLOSING), 'closing names the one surveyed-ticket comment');
        const apiBase = tokenDelivery === 'mcp' ? '$HARBOUR_LOCAL_BASE' : BASE_URL;
        assert.ok(block.includes(`Start from the distilled brief: GET ${apiBase}/api/proxy/brief/${ISSUE}`), 'brief line');
        assert.ok(block.includes(`Full endpoint catalog: GET ${apiBase}/api/proxy/instructions`), 'endpoint catalog line');
      });
    }

    test(`${kind}: the only differences from the default block are the mandate and closing sentences`, () => {
      const plain = build();
      const survey = build({ kind });
      assert.notEqual(survey, plain);
      assert.equal(
        survey.replace(SURVEY_MANDATE, REVERSIBLE_MANDATE).replace(SURVEY_CLOSING, REVERSIBLE_CLOSING),
        plain
      );
    });
  }
});

describe('LIN-4248 — attachProxyContext threads kind into the block', () => {
  test('kind survey-place emits the Survey variant (prose, token embedded and spent)', async () => {
    const store = fakeStore('BOOT_TOK');
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: BASE_URL,
      issueIdentifier: ISSUE, prompt: 'Survey the place.', harness: null, kind: 'survey-place'
    });
    assert.ok(out.prompt.startsWith('Survey the place.'));
    assert.ok(out.prompt.includes(SURVEY_MANDATE), 'Survey mandate');
    assert.ok(out.prompt.endsWith(SURVEY_CLOSING), 'Survey closing');
    assert.ok(!out.prompt.includes('open PRs'));
    assert.ok(!out.prompt.includes('PR link'));
    assert.ok(!out.prompt.includes('commit SHA'));
    assert.ok(out.prompt.includes('BOOT_TOK'), 'bootstrap still embedded for prose');
    assert.equal(out.bootstrapToken, null);
    assert.equal(store.calls.length, 1, 'exactly one mint');
  });

  test('no kind (every non-Survey caller) keeps the reversible block', async () => {
    const out = await attachProxyContext({
      proxyTokenStore: fakeStore('BOOT_TOK'), urlKey: 'acme', baseUrl: BASE_URL,
      issueIdentifier: ISSUE, prompt: 'Do it.', harness: null
    });
    assert.ok(out.prompt.includes(REVERSIBLE_MANDATE));
    assert.ok(out.prompt.endsWith(REVERSIBLE_CLOSING));
  });
});

describe('LIN-4248 — the factory hands the resolved kind to finalizePrompt', () => {
  function capturingStore() {
    const captured = {};
    return {
      captured,
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'item-1', ...item };
      }
    };
  }

  test('finalizePrompt receives the effective kind as its 2nd argument', async () => {
    const store = capturingStore();
    let seen = null;
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'survey-task',
      finalizePrompt: (resolvedHarness, resolvedKind) => {
        seen = { resolvedHarness, resolvedKind };
        return { prompt: 'p', bootstrapToken: null };
      },
      fields: { target: 'cli' }
    });
    assert.equal(seen.resolvedKind, 'survey-task');
  });
});
