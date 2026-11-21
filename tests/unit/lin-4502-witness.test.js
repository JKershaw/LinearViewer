/**
 * LIN-4502 (P2) acceptance witnesses, written before any retirement and kept through it. They drive the REAL proxy
 * routes (routes/proxy.js createProxyRoutes, which injects `askedOf` into the records route as production does) over
 * a REAL LocalStore and a real RecordsStore on a MangoDB engine.
 *
 *   (a) a task first named through the proxy takes the ticket's words as `asked`;
 *   (b) rewriting the description through the proxy (the whole body, and a span that used to sit inside the block)
 *       leaves the task's `asked` and brief part 1 unchanged. Before P2 the As-asked guard refused both rewrites
 *       (422, the retired immutable guard); with the guard retired both land (200), and the task's `asked` still holds.
 *   (c) the legacy reader reads the block exactly as the seal wrote it: a literal pre-P2 description, typed out here,
 *       gives askedOf its words. If the brief's quote is ever reworded, this fails until lib/asked-of.js freezes the
 *       old spelling (its exit-condition note).
 *
 * (a) and (b) are asserted on the stored task (RecordsStore.askedForTicket) and on the brief's quote
 * (lib/brief-quote.js composeBrief), never on the description alone.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { quoteAsked, splitQuote, composeBrief } from '../../lib/brief-quote.js';
import { askedOf, outsideAsked } from '../../lib/asked-of.js';
import { adfToMarkdown, markdownToAdf } from '../../lib/providers/jira/adf.js';
import { textBeforePlan } from '../../lib/legacy-plan-text.js';
import { readFileSync } from 'node:fs';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js: resolveProviderAccess then answers with the local provider.
const LOCAL_URL_KEY = 'local-workspace';
const TICKET = 'LOCAL-1';
const PLAIN_TICKET = 'LOCAL-2';

const WORDS = 'Please write a full guide on how to properly configure it.\nCover **both** modes.';
const PLAN = '## Implementation Plan\n\n1. step one';
const MODEL_BRIEF = '## Situation\n\nmodel text';

const harness = createMangoTmpdir('lin-4502-witness-');
let db;
let recordsStore;
let localStore;
let server;
let base;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });

  ({ store: localStore } = createLocalStore());
  await localStore.seed(LOCAL_URL_KEY, {
    projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
    issues: [
      // Sealed: the person's words are a `## As asked` block, then a plan below it (as every ticket filed before P2 is).
      { id: 'i1', identifier: TICKET, title: 'Sealed', description: `${quoteAsked(WORDS)}\n\n${PLAN}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
      // Unsealed: the person's words, then a plan heading (the shape a ticket filed after the seal was retired has).
      { id: 'i2', identifier: PLAIN_TICKET, title: 'Plain', description: `${WORDS}\n\n${PLAN}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
    ],
  });
  localProvider.configure({ store: localStore });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'acc-john', origin: 'person', writes: null, runRecordId: null }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    recordsStore,
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = {};
  try { parsed = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: parsed };
}

const storedDescription = async (id) => (await localStore.getIssue(LOCAL_URL_KEY, id)).description;

describe('LIN-4502 witness (a): a task first named through the proxy takes the ticket\'s words as `asked`', () => {
  test('a sealed ticket: the first record that names it through the proxy makes its task, asked = the sealed words', async () => {
    const r = await call('POST', '/api/proxy/records', { kind: 'finding', to: 'review', says: 'first named', how: 'look', in: TICKET });
    assert.ok(r.status < 300, JSON.stringify(r.body));
    assert.equal(await recordsStore.askedForTicket(LOCAL_URL_KEY, TICKET), WORDS);
  });

  test('an unsealed ticket with a plan heading: asked = the words before the plan, never the plan', async () => {
    const r = await call('POST', '/api/proxy/records', { kind: 'finding', to: 'review', says: 'first named', how: 'look', in: PLAIN_TICKET });
    assert.ok(r.status < 300, JSON.stringify(r.body));
    assert.equal(await recordsStore.askedForTicket(LOCAL_URL_KEY, PLAIN_TICKET), WORDS);
  });
});

describe('LIN-4502 witness (b): rewriting the description through the proxy leaves the task\'s asked and brief part 1 unchanged', () => {
  test('whole body and a span inside the old block, then the brief quote: asked and part 1 are the words as first named', async () => {
    const first = await call('POST', '/api/proxy/records', { kind: 'finding', to: 'review', says: 'first named', how: 'look', in: TICKET });
    assert.ok(first.status < 300, JSON.stringify(first.body));
    const askedBefore = await recordsStore.askedForTicket(LOCAL_URL_KEY, TICKET);
    const partOneBefore = composeBrief(askedBefore, MODEL_BRIEF).slice(0, composeBrief(askedBefore, MODEL_BRIEF).indexOf('## Situation'));

    const original = await storedDescription('i1');
    // A span that used to sit inside the block: one phrase of the words is replaced. (LIN-4504: first, while the old
    // plan section is still there, so the PATCH adds no plan heading; re-adding a dropped one is refused 422.)
    const spanned = original.replace('full guide', 'short guide');
    assert.notEqual(spanned, original, 'the span edit changes the block\'s words');
    const span = await call('PATCH', '/api/proxy/issues/i1', { description: spanned });
    assert.equal(span.status, 200, JSON.stringify(span.body));
    assert.equal(await storedDescription('i1'), spanned);
    // The whole body rewritten through the proxy: no guard refuses it any more (LIN-4502).
    const whole = await call('PATCH', '/api/proxy/issues/i1', { description: 'Entirely new body.\n\nNothing like before.' });
    assert.equal(whole.status, 200, JSON.stringify(whole.body));
    assert.equal(await storedDescription('i1'), 'Entirely new body.\n\nNothing like before.');

    // Whatever the description now holds, the task's asked is written once, at its making, and is not re-derived.
    const second = await call('POST', '/api/proxy/records', { kind: 'finding', to: 'review', says: 'named again', how: 'look', in: TICKET });
    assert.ok(second.status < 300, JSON.stringify(second.body));

    const askedAfter = await recordsStore.askedForTicket(LOCAL_URL_KEY, TICKET);
    const brief = composeBrief(askedAfter, MODEL_BRIEF);
    const partOneAfter = brief.slice(0, brief.indexOf('## Situation'));

    // Witness output recorded for the report: the proxy's answers and the description's state.
    console.log(JSON.stringify({ whole: { status: whole.status, code: whole.body?.code }, span: { status: span.status, code: span.body?.code }, descriptionNowStartsWith: (await storedDescription('i1')).slice(0, 40) }));
    assert.equal(askedAfter, askedBefore, 'the task\'s asked is unchanged');
    assert.equal(askedAfter, WORDS);
    assert.equal(partOneAfter, partOneBefore, 'brief part 1 is unchanged');
    assert.equal(splitQuote(brief)?.words, WORDS, 'the brief quotes the task\'s words');
  });
});

describe('LIN-4502 witness (c): the legacy reader reads the block the seal wrote, literally', () => {
  // Typed out on purpose: the shape tickets filed before P2 carry, as the retired seal wrote it.
  const LEGACY = '## As asked\n\nMake the export button work.\nKeep both formats.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*\n\n## Implementation Plan\n\n1. a step';
  test('askedOf takes the block\'s words, not the plan below it', () => {
    assert.equal(askedOf(LEGACY), 'Make the export button work.\nKeep both formats.');
  });
  test('Linear\'s escaped storage of the same block reads the same words', () => {
    const escaped = LEGACY.replace(/([#*_[\]])/g, '\\$1');
    assert.equal(askedOf(escaped), 'Make the export button work.\nKeep both formats.');
  });
  // finding-684d2e80: a pre-P2 Jira ticket reads back through the codec, which renders the end line's italic as `_…_`.
  test('a Jira ticket written before P2 (read back through the codec, end line in `_…_`) reads the same words', () => {
    const jira = adfToMarkdown(markdownToAdf(LEGACY));
    assert.ok(/^_End of what was asked\./m.test(jira), 'the codec renders the end line with underscores');
    assert.equal(askedOf(jira), 'Make the export button work.\nKeep both formats.');
    assert.equal(outsideAsked(jira).trim(), '## Implementation Plan\n\n1. a step');
    // LIN-4504 retired legacyBlockSpan with its one reader (the selector's plan condensing).
  });
  test('a CRLF Jira block reads the same words', () => {
    const jira = adfToMarkdown(markdownToAdf(LEGACY)).replace(/\n/g, '\r\n');
    assert.equal(askedOf(jira), 'Make the export button work.\r\nKeep both formats.');
  });
  test('an underscore end line with no heading above it is no block', () => {
    const text = 'Some words\n\n_End of what was asked. Steps write below this line; nothing above it changes._';
    assert.equal(askedOf(text), text);
  });
});

describe('LIN-4504: askedOf\'s plan heading is the one recognition rule (lib/legacy-plan-text.js)', () => {
  test('lib/asked-of.js holds no heading of its own and cuts where the shared rule cuts, `#` to `###`', () => {
    const source = readFileSync(new URL('../../lib/asked-of.js', import.meta.url), 'utf8');
    for (const h of ['#', '##', '###']) {
      const text = `Words.\n\n${h} Implementation Plan\n\nplan`;
      assert.equal(askedOf(text), textBeforePlan(text));
      assert.equal(askedOf(text), 'Words.');
    }
  });
});
