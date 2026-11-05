// LIN-4248, LIN-4253, LIN-4251: a stage's dispatched "Workspace API access" block says what its
// declared `writes` lets it do, and nothing that contradicts it. `work` keeps the historical block
// (its bytes are pinned in lin-4251-writes-entrances.test.js); every other value gets its own mandate
// and closing, and no endpoint hint tells it to update the workspace.
// The tests resolve each kind's writes from its template, as dispatch-entrance does, and loop over
// WRITES_VALUES, so a new value is covered without a new list of stage names here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachProxyContext,
  buildProxyContextPreamble,
  resolveWrites
} from '../../lib/proxy-preamble.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { WRITES, WRITES_VALUES } from '../../lib/stage-writes.js';

const BASE_URL = 'https://host';
const ISSUE = 'LIN-42';
// The kind's writes as its template declares them (dispatch-entrance resolves it the same way).
const writesOf = (kind) => PROMPT_TEMPLATES[kind]?.writes;
const KINDS_BY_WRITES = Object.fromEntries(
  WRITES_VALUES.map(value => [value, Object.keys(PROMPT_TEMPLATES).filter(kind => writesOf(kind) === value)])
);
const NON_WORK = WRITES_VALUES.filter(value => value !== WRITES.WORK);

// The exact sentences each value's block carries. Literal copies, so a drift in the constant text
// fails here rather than passing silently.
const MANDATE = {
  [WRITES.WORK]: 'Being dispatched here is your mandate for the reversible work — investigate, edit, open PRs, comment: do not hold your first call, or any call, waiting for a live reply before you start.',
  [WRITES.NONE]: 'Being dispatched here is a reading pass: investigate and read freely, but do not change code, branches, pull requests, tickets or Linear state, and post nothing to Linear unless the person asks; report your findings in this session, and do not hold your first call, or any call, waiting for a live reply before you start.',
  [WRITES.ONE_COMMENT]: 'Being dispatched here is a read-only stage: investigate and read freely, but do not change code, branches, pull requests, tickets or Linear state; your only write is one comment on the ticket named in your task, and do not hold your first call, or any call, waiting for a live reply before you start.',
  [WRITES.TICKET_FIELDS]: 'Being dispatched here is to triage the ticket named in your task: investigate freely, and you may change its labels, priority, state and project and comment on it. Do not change code, branches or pull requests, do not rewrite its description, do not create tickets or subtasks, and do not hold your first call, or any call, waiting for a live reply before you start.',
};
const CLOSING = {
  [WRITES.WORK]: [
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with a concise summary that',
    'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
    'report carries proof rather than a bare "done".',
    ''
  ].join('\n'),
  [WRITES.NONE]: [
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with your findings and the sources they',
    'came from, so the report carries proof rather than a bare "done".',
    ''
  ].join('\n'),
  [WRITES.ONE_COMMENT]: [
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with the link to the one comment you',
    'posted on the ticket named in your task, so the report carries proof rather than a bare "done".',
    ''
  ].join('\n'),
  [WRITES.TICKET_FIELDS]: [
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with each field change you made (field,',
    'before and after, and the reason), each change you intended but could not apply through the',
    'workspace API, and the link to the comment you posted, if any, so the report carries proof',
    'rather than a bare "done".',
    ''
  ].join('\n'),
};
// What each non-work value must say, and must not, beyond the exact sentences above.
const PHRASES = {
  [WRITES.NONE]: { says: [/report your findings in this session/], closingSays: [/findings/] },
  [WRITES.ONE_COMMENT]: { says: [/your only write is one comment on the ticket named in your task/], closingSays: [/the one comment you/] },
  [WRITES.TICKET_FIELDS]: {
    says: [/labels, priority, state and project/, /[Dd]o not change code, branches or pull requests/, /do not create tickets or subtasks/],
    closingSays: [/could not apply/],
  },
};
// The work hints wrap this clause across lines in some variants, so match across whitespace.
const CLAUSE = /update\s+the\s+workspace\s+as\s+you\s+work/;

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

describe('LIN-4253 — resolveWrites: the one guard the block and attachProxyContext share', () => {
  test('absent (a kind with no template) is the default, work', () => {
    assert.equal(resolveWrites(undefined), WRITES.WORK);
    assert.equal(resolveWrites(null), WRITES.WORK);
  });

  test('each known value passes through', () => {
    for (const value of WRITES_VALUES) assert.equal(resolveWrites(value), value);
  });

  test('an unknown value throws, naming the value and the vocabulary', () => {
    assert.throws(() => resolveWrites('read-only'), /Unknown stage writes "read-only".*one-comment/);
    assert.throws(() => resolveWrites(true), /Unknown stage writes "true"/);
  });

  test('attachProxyContext refuses an unknown value before it mints (no token spent)', async () => {
    const store = fakeStore('BOOT_TOK');
    await assert.rejects(
      () => attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: BASE_URL, prompt: 'x', harness: null, writes: 'read-only' }),
      /Unknown stage writes/
    );
    assert.equal(store.calls.length, 0, 'no mint on a refusal');
  });
});

describe('LIN-4251 — every value has at least one stage, so the loops below are not vacuous', () => {
  for (const value of NON_WORK) {
    test(`${value}: a template declares it`, () => {
      assert.ok(KINDS_BY_WRITES[value].length > 0, `no template declares ${value}`);
    });
  }
});

describe('LIN-4248 / LIN-4251 — a stage that declares work gets the historical block, byte-identical', () => {
  // Every kind's template is read, not named: any template declaring work must match the no-kind block.
  for (const kind of KINDS_BY_WRITES[WRITES.WORK]) {
    for (const tokenDelivery of ['prose', 'mcp']) {
      test(`${kind} (${tokenDelivery}): output equals the no-writes output`, () => {
        assert.equal(build({ tokenDelivery, writes: writesOf(kind) }), build({ tokenDelivery }));
      });
    }
  }

  for (const kind of [null, undefined, 'custom', 'autopilot']) {
    test(`kind ${JSON.stringify(kind)} (no template): the work block`, () => {
      for (const tokenDelivery of ['prose', 'mcp']) {
        assert.equal(build({ tokenDelivery, writes: writesOf(kind) }), build({ tokenDelivery }));
      }
    });
  }

  test('the work block keeps the PR mandate and the PR-evidence closing', () => {
    const block = build();
    assert.ok(block.includes(MANDATE[WRITES.WORK]));
    assert.ok(block.endsWith(CLOSING[WRITES.WORK]));
    assert.ok(CLAUSE.test(block), 'work keeps the update clause');
  });
});

describe('LIN-4251 — each non-work value gets its own mandate and closing, in both delivery modes', () => {
  for (const value of NON_WORK) {
    for (const tokenDelivery of ['prose', 'mcp']) {
      test(`${value} (${tokenDelivery}): mandate, closing, brief and catalog lines; no PR wording; no update clause`, () => {
        const block = build({ writes: value, tokenDelivery });
        assert.ok(block.includes(MANDATE[value]), 'its mandate');
        assert.ok(block.endsWith(CLOSING[value]), 'its closing');
        assert.ok(!block.includes('open PRs'), 'no open-PRs mandate');
        assert.ok(!block.includes('PR link'), 'no PR-link closing');
        assert.ok(!block.includes('commit SHA'), 'no commit-SHA closing');
        assert.ok(!CLAUSE.test(block), 'the update-the-workspace clause is work\'s alone');
        const apiBase = tokenDelivery === 'mcp' ? '$HARBOUR_LOCAL_BASE' : BASE_URL;
        assert.ok(block.includes(`Start from the distilled brief: GET ${apiBase}/api/proxy/brief/${ISSUE}`), 'brief line');
        assert.ok(block.includes(`Full endpoint catalog: GET ${apiBase}/api/proxy/instructions`), 'endpoint catalog line');
      });
    }

    test(`${value}: the phrases its mandate and closing must carry, and the ones it must not`, () => {
      const block = build({ writes: value });
      for (const phrase of PHRASES[value].says) assert.match(MANDATE[value], phrase);
      for (const phrase of PHRASES[value].closingSays) assert.match(CLOSING[value], phrase);
      // Nothing in the block may say a non-work stage will open or merge a PR, or forecast the ticket.
      assert.doesNotMatch(block, /open PRs|PR link|commit SHA/);
      assert.doesNotMatch(block, /forecast|surveyed/i);
    });
  }

  test('ticket-fields names what triage may change, so its mandate cannot forbid its own job', () => {
    for (const field of ['labels', 'priority', 'state', 'project']) {
      assert.match(MANDATE[WRITES.TICKET_FIELDS], new RegExp(field));
    }
  });
});

describe('LIN-4251 — the update clause is gated on writes, in every endpoint-hint variant', () => {
  // The eight hint variants: issue or not, and the three provider flags that pick the hint text.
  const variants = [];
  for (const issueIdentifier of [ISSUE, undefined]) {
    for (const issueDetail of [true, false]) {
      for (const relations of [true, false]) {
        for (const search of [true, false]) {
          variants.push({ issueIdentifier, providerUi: { issueDetail, relations, search } });
        }
      }
    }
  }
  for (const tokenDelivery of ['prose', 'mcp']) {
    for (const variant of variants) {
      const label = `${variant.issueIdentifier ?? 'no issue'} ${JSON.stringify(variant.providerUi)} (${tokenDelivery})`;
      test(`${label}: the clause is present for work and absent for every other value`, () => {
        const work = build({ ...variant, tokenDelivery, writes: WRITES.WORK });
        assert.ok(CLAUSE.test(work), 'work keeps the clause');
        for (const value of NON_WORK) {
          const block = build({ ...variant, tokenDelivery, writes: value });
          assert.ok(!CLAUSE.test(block), `${value} drops the clause`);
          assert.ok(!/\n\s*\n\s*\n/.test(block), `${value}: no stray blank lines from the drop`);
        }
      });
    }
  }
});

describe('LIN-4248 / LIN-4251 — attachProxyContext threads each stage\'s writes into the block', () => {
  for (const value of NON_WORK) {
    for (const kind of KINDS_BY_WRITES[value]) {
      test(`${kind} (${value}): the attached block is the one the block builder gives, and one mint is spent`, async () => {
        const store = fakeStore('BOOT_TOK');
        const out = await attachProxyContext({
          proxyTokenStore: store, urlKey: 'acme', baseUrl: BASE_URL,
          issueIdentifier: ISSUE, prompt: 'Do the stage.', harness: null, writes: writesOf(kind)
        });
        assert.ok(out.prompt.startsWith('Do the stage.'));
        assert.equal(out.prompt, 'Do the stage.' + build({ writes: value, token: 'BOOT_TOK' }));
        assert.ok(out.prompt.includes('BOOT_TOK'), 'bootstrap still embedded for prose');
        assert.equal(out.bootstrapToken, null);
        assert.equal(store.calls.length, 1, 'exactly one mint');
      });
    }
  }

  test('no writes (every caller with no template) keeps the work block', async () => {
    const out = await attachProxyContext({
      proxyTokenStore: fakeStore('BOOT_TOK'), urlKey: 'acme', baseUrl: BASE_URL,
      issueIdentifier: ISSUE, prompt: 'Do it.', harness: null
    });
    assert.ok(out.prompt.includes(MANDATE[WRITES.WORK]));
    assert.ok(out.prompt.endsWith(CLOSING[WRITES.WORK]));
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
