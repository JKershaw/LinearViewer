/**
 * LIN-4351, LIN-4501: the asker's words reach a step unchanged. The brief model paraphrases;
 * code quotes the task's `asked` (the words the task took from the ticket when it was made,
 * immutable after), byte for byte, ahead of the model's four sections, so every brief reader
 * (proxy route, session route, task page) gets them verbatim, fresh and cached. Since LIN-4501
 * the words come from the records store (lib/brief-quote.js attachAsked), never from the
 * ticket description: a ticket with no task yet gets the model's brief alone, even when its
 * description holds a sealed block.
 *
 * The model is a stub at the one network seam, `fetch` to openrouter.ai (the
 * pattern tests/unit/feedback-title.test.js uses), so the REAL generateBrief runs
 * inside the REAL routes. Every comparison here is on raw bytes: none goes
 * through normalizeEscaping, so the Linear-escaped case proves the escapes are
 * kept, not merely tolerated.
 *
 * Run with: node --test tests/unit/as-asked-brief.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { quoteAsked } from '../../lib/brief-quote.js';
import { composeBrief, briefQuoteEnd, attachAsked } from '../../lib/brief-quote.js';
import { generateBrief, DEFAULT_BRIEF_MODEL } from '../../lib/brief.js';
import { briefCurrentSection, briefWithoutCurrent } from '../../lib/task-page-loader.js';
import { toStackHeadline } from '../../lib/task-stack.js';
import { buildMockBrief } from '../../lib/workspace-api-mocks.js';
import { InMemoryBriefCacheStore } from '../../lib/brief-cache.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { testMockData } from '../../lib/sample-data/mock-data.js';

// The person's words: a `## Current` heading of their own, and a phrase the stub
// model will thin out ("a full guide" → "a short guide").
const ASK = 'Please write a full guide on how to properly configure the proxy.\n\n## Current\nMy setup: two workspaces, one token.';
// The same ask as Linear stores it: markdown punctuation backslash-escaped.
const LINEAR_ASK = 'Write a \\*full\\* guide on how to properly configure it\\.\n\n\\#\\# Current\nTwo workspaces\\.';
const LINEAR_SEALED = `\\#\\# As asked\n\n${LINEAR_ASK}\n\n\\*End of what was asked\\. Steps write below this line; nothing above it changes\\.\\*`;

const MODEL_CURRENT = 'Write a short guide to the proxy.';
const MODEL_BRIEF = `## Current\n${MODEL_CURRENT}\n\n## Constraints\n- _None._\n\n## Open questions\n- _None._\n\n## Changelog\n- _None._`;

/** The brief must open with the quoted block: heading, blank, the words' exact bytes, blank. */
function assertQuoted(brief, words) {
  const head = `## As asked\n\n${words}\n\n`;
  assert.ok(typeof brief === 'string' && brief.startsWith(head), `brief must start with the quoted words byte for byte; got:\n${String(brief).slice(0, 300)}`);
}

let modelCalls = 0;
let restoreFetch = null;
function installModelStub(text = MODEL_BRIEF) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) {
      modelCalls++;
      async function* gen() {
        yield new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n`);
        yield new TextEncoder().encode('data: [DONE]\n\n');
      }
      return { ok: true, status: 200, body: gen(), text: async () => '', json: async () => ({}) };
    }
    return realFetch(url, options);
  };
  restoreFetch = () => { globalThis.fetch = realFetch; };
}

// With a proxy configured, streamChat routes through an https-proxy-agent instead of
// global fetch, so the stub would be bypassed (CI's hermetic:proxy arm sets
// HTTPS_PROXY). Clear the proxy vars per test and restore them after, as
// tests/unit/feedback-title.test.js does.
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
let savedProxy = {};
beforeEach(() => {
  modelCalls = 0;
  savedProxy = Object.fromEntries(PROXY_VARS.map(k => [k, process.env[k]]));
  for (const k of PROXY_VARS) delete process.env[k];
});
afterEach(() => {
  if (restoreFetch) restoreFetch();
  restoreFetch = null;
  for (const [k, v] of Object.entries(savedProxy)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const issueOf = (description) => ({ id: 'uuid-4351', identifier: 'ENG-4351', title: 'Proxy guide', description, state: { type: 'started' }, labels: [] });
// `asked` is the ticket's task words, as attachAsked puts them on a fetched context; null is a ticket with no task yet.
const contextOf = (description, asked = null) => ({ issue: issueOf(description), comments: [], children: [], parent: null, focusedChild: null, asked: { self: asked, parent: null } });
/** A records store holding only the tasks' words, by ticket (lib/records-store.js askedForTickets). */
const recordsWith = (words = {}) => ({
  askedForTickets: async (_urlKey, tickets) => new Map(tickets.filter((t) => typeof words[t] === 'string').map((t) => [t, words[t]]))
});

describe('generateBrief quotes the task\'s asked ahead of a paraphrasing model', () => {
  test('the brief starts with ## As asked and the words\' exact bytes; the model\'s sections follow', async () => {
    installModelStub();
    const { brief, model } = await generateBrief(issueOf(quoteAsked(ASK)), contextOf(quoteAsked(ASK), ASK), { apiKey: 'sk-test' });
    assertQuoted(brief, ASK);
    assert.ok(brief.endsWith(MODEL_BRIEF), 'the model\'s four sections follow the quote unchanged');
    assert.equal(model, 'openai/gpt-5.4-mini', 'the brief model stays gpt-5.4-mini');
    assert.equal(DEFAULT_BRIEF_MODEL, 'openai/gpt-5.4-mini');
  });

  test('briefCurrentSection returns the model\'s ## Current, not the person\'s', async () => {
    installModelStub();
    const { brief } = await generateBrief(issueOf(quoteAsked(ASK)), contextOf(quoteAsked(ASK), ASK), { apiKey: 'sk-test' });
    assert.equal(briefCurrentSection(brief), MODEL_CURRENT);
    const panel = briefWithoutCurrent(brief);
    assertQuoted(panel, ASK);
    assert.ok(!panel.includes(MODEL_CURRENT), 'the panel drops the model\'s Current (the header shows it)');
    assert.ok(panel.includes('My setup: two workspaces, one token.'), 'the person\'s own ## Current text stays in the quote');
  });

  test('a Linear-escaped ask keeps its backslash escapes, byte for byte against what the task holds', async () => {
    installModelStub();
    const { brief } = await generateBrief(issueOf(LINEAR_SEALED), contextOf(LINEAR_SEALED, LINEAR_ASK), { apiKey: 'sk-test' });
    // Raw comparison on purpose: the words are the STORED bytes, escapes included.
    assertQuoted(brief, LINEAR_ASK);
    assert.equal(briefCurrentSection(brief), MODEL_CURRENT, 'an escaped `\\#\\# Current` in the ask is not the brief\'s Current');
  });

  test('an unsealed ticket\'s task words are quoted too: the quote follows the task, not the block', async () => {
    installModelStub();
    const { brief } = await generateBrief(issueOf(ASK), contextOf(ASK, ASK), { apiKey: 'sk-test' });
    assertQuoted(brief, ASK);
  });

  test('a ticket with no task yet gets the model\'s output alone, even when its description is sealed', async () => {
    installModelStub();
    const { brief } = await generateBrief(issueOf(quoteAsked(ASK)), contextOf(quoteAsked(ASK), null), { apiKey: 'sk-test' });
    assert.equal(brief, MODEL_BRIEF, 'the description is never quoted in the task\'s place');
  });

  test('the system prompt says code quotes the words and the model must not restate them', async () => {
    const { buildBriefMessages } = await import('../../lib/brief.js');
    const system = buildBriefMessages(issueOf(ASK), contextOf(ASK))[0].content;
    assert.match(system, /As asked/);
    assert.match(system, /not restate/i);
    assert.match(system, /Open questions/);
  });

  // LIN-4353: on LIN-4357 (sealed, nothing yet but the ask) the model's sections re-quoted a
  // phrase of the ask twice and paraphrased it in Constraints. The sections now cover what the
  // rest of the source adds; with nothing added, Current says so in one line.
  test('the sections cover what the source adds beyond the words, and a fresh ticket does not retell the ask', async () => {
    const { buildBriefMessages } = await import('../../lib/brief.js');
    const system = buildBriefMessages(issueOf(ASK), contextOf(ASK))[0].content;
    assert.match(system, /do not restate, quote or paraphrase them/);
    assert.match(system, /covering what the rest of the source adds/);
    assert.match(system, /Where nothing has been added yet, `## Current` says so in one line rather than retelling the ask/);
  });
});

describe('composeBrief, briefQuoteEnd and attachAsked (lib/brief-quote.js)', () => {
  test('the quote ends where the model\'s output begins', () => {
    const brief = composeBrief(ASK, MODEL_BRIEF);
    assert.equal(brief, `${quoteAsked(ASK)}\n\n${MODEL_BRIEF}`);
    assert.equal(brief.slice(briefQuoteEnd(brief)).trimStart(), MODEL_BRIEF);
    assert.equal(briefQuoteEnd(MODEL_BRIEF), 0, 'an unquoted brief has no quote');
  });

  test('no usable model output stays empty (no quote-only brief is cached), and no words add nothing', () => {
    assert.equal(composeBrief(ASK, ''), '');
    assert.equal(composeBrief(null, MODEL_BRIEF), MODEL_BRIEF);
    assert.equal(composeBrief('', MODEL_BRIEF), MODEL_BRIEF);
  });

  test('attachAsked puts the ticket\'s and the parent\'s task words on the context, and null without a task or a store', async () => {
    const context = { issue: { identifier: 'ENG-1' }, parent: { identifier: 'ENG-0' } };
    await attachAsked(context, { recordsStore: recordsWith({ 'ENG-1': 'Child words.', 'ENG-0': 'Parent words.' }), urlKey: 'acme' });
    assert.deepEqual(context.asked, { self: 'Child words.', parent: 'Parent words.' });
    const bare = await attachAsked({ issue: { identifier: 'ENG-1' }, parent: null }, { recordsStore: recordsWith({}), urlKey: 'acme' });
    assert.deepEqual(bare.asked, { self: null, parent: null });
    const noStore = await attachAsked({ issue: { identifier: 'ENG-1' } }, { recordsStore: null, urlKey: 'acme' });
    assert.deepEqual(noStore.asked, { self: null, parent: null });
    const faulty = { askedForTickets: async () => { throw new Error('records down'); } };
    const failed = await attachAsked({ issue: { identifier: 'ENG-1' } }, { recordsStore: faulty, urlKey: 'acme' });
    assert.deepEqual(failed.asked, { self: null, parent: null }, 'a records fault reads as no words, never the description');
  });
});

describe('first-line readers show the person\'s first line from the task', () => {
  test('toStackHeadline takes the task\'s words', () => {
    assert.ok(toStackHeadline(ASK).startsWith('Please write a full guide'));
  });

  test('buildMockBrief (session mock): quotes the task\'s words, and its summary is their first line', () => {
    const brief = buildMockBrief(contextOf(quoteAsked(ASK), ASK));
    assertQuoted(brief, ASK);
    assert.equal(briefCurrentSection(brief), `Proxy guide — ${ASK.split('\n')[0]}`);
  });

  test('no task: no quote, and the mock summary says there are no words on record', () => {
    assert.equal(buildMockBrief(contextOf(quoteAsked(ASK), null)).split('\n').slice(0, 2).join('\n'), '## Current\nProxy guide — No words on record yet.');
  });
});

// ─── The routes, fresh and cached ────────────────────────────────────────────

class FakeContextProvider extends ProviderInterface {
  constructor(name, description) {
    super();
    this.name = name;
    this.description = description;
  }
  async fetchRecommendationContext() { return { ...contextOf(this.description), asked: undefined }; }
}

async function call(app, method, path, body) {
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (...args) => realSetTimeout(...args).unref?.();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  } finally {
    global.setTimeout = realSetTimeout;
    await new Promise(resolve => server.close(resolve));
  }
}

function proxyApp({ provider, token = 'real-token', briefCacheStore, words = {} }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason: 'ok' }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => 'sk-test',
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore,
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: null,
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    recordsStore: recordsWith(words),
    provider,
  }));
  return app;
}

function sessionApp({ providerName, briefCacheStore, token = 'real-token', words = {} }) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { accessToken: token, urlKey: 'acme', provider: providerName };
      req.session = { features: {}, openRouterApiKey: 'sk-test' };
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: null,
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore,
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
    recordsStore: recordsWith(words),
  }));
  return app;
}

describe('the proxy brief route serves the quoted brief, fresh and cached', () => {
  test('a ticket with a task: fresh, then cached without a second model call', async () => {
    installModelStub();
    const provider = new FakeContextProvider('as-asked-proxy', quoteAsked(ASK));
    const app = proxyApp({ provider, briefCacheStore: new InMemoryBriefCacheStore(), words: { 'ENG-4351': ASK } });
    const fresh = await call(app, 'GET', '/api/proxy/issues/ENG-4351/brief');
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assertQuoted(fresh.body.brief, ASK);
    assert.equal(modelCalls, 1);
    const cached = await call(app, 'GET', '/api/proxy/issues/ENG-4351/brief');
    assert.equal(cached.status, 200);
    assert.equal(modelCalls, 1, 'served from the cache');
    assert.equal(cached.body.brief, fresh.body.brief);
    assertQuoted(cached.body.brief, ASK);
  });

  test('the forced POST regenerate quotes the task\'s words too', async () => {
    installModelStub();
    const provider = new FakeContextProvider('as-asked-proxy-post', ASK);
    const { status, body } = await call(proxyApp({ provider, briefCacheStore: new InMemoryBriefCacheStore(), words: { 'ENG-4351': ASK } }), 'POST', '/api/proxy/brief/ENG-4351');
    assert.equal(status, 200, JSON.stringify(body));
    assertQuoted(body.brief, ASK);
  });

  test('test mode (the proxy\'s own mock builder) quotes a fixture\'s task words', async () => {
    const fixture = testMockData.issues.find(i => i.identifier);
    const app = proxyApp({ provider: new FakeContextProvider('as-asked-proxy-mock', ''), token: 'test-token', briefCacheStore: new InMemoryBriefCacheStore(), words: { [fixture.identifier]: ASK } });
    const { status, body } = await call(app, 'GET', `/api/proxy/issues/${fixture.identifier}/brief`);
    assert.equal(status, 200, JSON.stringify(body));
    assertQuoted(body.brief, ASK);
    assert.ok(briefCurrentSection(body.brief).endsWith(`— ${ASK.split('\n')[0]}`), 'the mock summary is the words\' first line');
  });

  test('no task: the brief is the model\'s, unchanged, though the description is sealed', async () => {
    installModelStub();
    const provider = new FakeContextProvider('as-asked-proxy-plain', quoteAsked(ASK));
    const { body } = await call(proxyApp({ provider, briefCacheStore: new InMemoryBriefCacheStore() }), 'GET', '/api/proxy/issues/ENG-4351/brief');
    assert.equal(body.brief, MODEL_BRIEF);
  });
});

describe('the session brief route serves the quoted brief, fresh and cached', () => {
  test('a ticket with a task: POST generates fresh, GET serves the cached brief', async () => {
    installModelStub();
    registerProvider(new FakeContextProvider('as-asked-session', quoteAsked(ASK)));
    const app = sessionApp({ providerName: 'as-asked-session', briefCacheStore: new InMemoryBriefCacheStore(), words: { 'ENG-4351': ASK } });
    const fresh = await call(app, 'POST', '/workspace/acme/api/brief/ENG-4351', {});
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assertQuoted(fresh.body.brief, ASK);
    const cached = await call(app, 'GET', '/workspace/acme/api/brief/ENG-4351');
    assert.equal(cached.status, 200);
    assert.equal(cached.body.status, 'fresh', 'the status read keys the same hash as the generate (asked is not in it)');
    assert.equal(cached.body.brief, fresh.body.brief);
    assert.equal(modelCalls, 1);
  });

  test('no task: the brief is the model\'s, unchanged', async () => {
    installModelStub();
    registerProvider(new FakeContextProvider('as-asked-session-plain', quoteAsked(ASK)));
    const app = sessionApp({ providerName: 'as-asked-session-plain', briefCacheStore: new InMemoryBriefCacheStore() });
    const { body } = await call(app, 'POST', '/workspace/acme/api/brief/ENG-4351', {});
    assert.equal(body.brief, MODEL_BRIEF);
  });
});

// John's ruling on LIN-4345 (whose words count, 7 Nov): the brief also quotes the parent's
// words for breakdown children. A breakdown child's own words may be the agent's slice of the
// plan; the person's words are on the parent. Since LIN-4501 both come from the tasks' `asked`.
describe('a subtask\'s brief also quotes its parent\'s words (LIN-4353, the whose-words ruling)', () => {
  const PARENT_ASK = 'Write a full guide on how to properly configure Harbour.\n\n## Current\nThe parent person\'s own heading.';
  const CHILD_SLICE = 'Piece A of the parent\'s plan: the guide route.';
  const parentOf = (description) => ({ id: 'uuid-p', identifier: 'ENG-4345', title: 'Parent', description, state: { type: 'started' } });
  const childContext = (childDesc, parentDesc, asked = { self: null, parent: null }) => ({ ...contextOf(childDesc), parent: parentOf(parentDesc), asked });
  const PARENT_QUOTE = `## As asked on the parent, ENG-4345\n\n${PARENT_ASK}\n\n*End of what was asked on the parent.*`;

  test('a child with words under a parent with words: the child\'s words, then the parent\'s, then the model', async () => {
    installModelStub();
    const { brief } = await generateBrief(issueOf(CHILD_SLICE), childContext(CHILD_SLICE, PARENT_ASK, { self: CHILD_SLICE, parent: PARENT_ASK }), { apiKey: 'sk-test' });
    assert.equal(brief, `${quoteAsked(CHILD_SLICE)}\n\n${PARENT_QUOTE}\n\n${MODEL_BRIEF}`);
    assert.equal(briefCurrentSection(brief), MODEL_CURRENT, 'the parent\'s own ## Current is not the brief\'s Current');
    assert.equal(brief.slice(briefQuoteEnd(brief)).trimStart(), MODEL_BRIEF, 'the quotes end where the model begins');
  });

  test('a child with no task under a parent with words still gets the parent\'s words', () => {
    const brief = composeBrief(null, MODEL_BRIEF, { identifier: 'ENG-4345', asked: PARENT_ASK });
    assert.equal(brief, `${PARENT_QUOTE}\n\n${MODEL_BRIEF}`);
    assert.equal(briefCurrentSection(brief), MODEL_CURRENT);
  });

  test('a parent with no words adds nothing, and no model output still stays empty', () => {
    assert.equal(composeBrief(CHILD_SLICE, MODEL_BRIEF, { identifier: 'ENG-4345', asked: null }), `${quoteAsked(CHILD_SLICE)}\n\n${MODEL_BRIEF}`);
    assert.equal(composeBrief(CHILD_SLICE, '', { identifier: 'ENG-4345', asked: PARENT_ASK }), '');
  });

  // LIN-4501: the cache key no longer follows the parent's words. The quote is the tasks' `asked`, which is fixed once
  // written, so no edit can make a cached brief stale; the parent's description block (LIN-4353's key) is not read.
  test('the cache key does not read the parent\'s description block, sealed or not', async () => {
    const { hashContext } = await import('../../lib/brief-cache.js');
    const plain = childContext(CHILD_SLICE, PARENT_ASK);
    const sealed = childContext(CHILD_SLICE, quoteAsked(PARENT_ASK));
    const edited = childContext(CHILD_SLICE, quoteAsked(`${PARENT_ASK} Edited.`));
    assert.equal(hashContext(sealed), hashContext(plain));
    assert.equal(hashContext(edited), hashContext(plain));
  });
});

describe('the mock brief builders quote the parent\'s words the same way (LIN-4353)', () => {
  test('buildMockBrief: a subtask whose parent has words opens with both quotes', () => {
    const parent = { id: 'uuid-p', identifier: 'ENG-4345', title: 'Parent', description: 'anything', state: { type: 'started' } };
    const brief = buildMockBrief({ ...contextOf('anything', 'The child\'s slice.'), parent, asked: { self: 'The child\'s slice.', parent: 'The parent\'s ask.' } });
    assert.ok(brief.startsWith(`${quoteAsked('The child\'s slice.')}\n\n## As asked on the parent, ENG-4345\n\nThe parent's ask.\n\n*End of what was asked on the parent.*\n\n## Current`), brief.slice(0, 300));
  });

  // Review mutation M5 (LIN-4345): the proxy's own test-mode builder must hand the parent
  // to composeBrief. Driven through the route, so the fixture context must carry the parent
  // as the live providers do (fixtureParent), not a hard-coded null.
  test('the proxy route in test mode: a fixture subtask whose parent has words opens with both quotes', async () => {
    const child = testMockData.issues.find(i => i.identifier === 'TEST-2');
    const parent = testMockData.issues.find(i => i.id === child.parent.id);
    const words = { 'TEST-2': 'The child\'s slice.', [parent.identifier]: 'The parent\'s ask.' };
    const app = proxyApp({ provider: new FakeContextProvider('as-asked-proxy-mock-parent', ''), token: 'test-token', briefCacheStore: new InMemoryBriefCacheStore(), words });
    const { status, body } = await call(app, 'GET', '/api/proxy/issues/TEST-2/brief');
    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(body.brief.startsWith(`${quoteAsked('The child\'s slice.')}\n\n## As asked on the parent, ${parent.identifier}\n\nThe parent's ask.\n\n*End of what was asked on the parent.*\n\n## Current`), body.brief.slice(0, 300));
  });

  // Review mutation M7 (LIN-4345): the in-app twin. Under a test token the session brief
  // route loads its context from buildMockRecapContext (lib/workspace-api-mocks.js, via
  // loadContext in routes/workspace-api-steps.js), which must carry the fixture's parent
  // as the live providers do. With that builder's parent set to null, this goes red.
  test('the in-app brief route in test mode: a fixture subtask whose parent has words opens with both quotes', async () => {
    const child = testMockData.issues.find(i => i.identifier === 'TEST-2');
    const parent = testMockData.issues.find(i => i.id === child.parent.id);
    const words = { 'TEST-2': 'The child\'s slice.', [parent.identifier]: 'The parent\'s ask.' };
    registerProvider(new FakeContextProvider('as-asked-session-mock-parent', ''));
    const app = sessionApp({ providerName: 'as-asked-session-mock-parent', token: 'test-token', briefCacheStore: new InMemoryBriefCacheStore(), words });
    const { status, body } = await call(app, 'POST', '/workspace/acme/api/brief/TEST-2', {});
    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(body.brief.startsWith(`${quoteAsked('The child\'s slice.')}\n\n## As asked on the parent, ${parent.identifier}\n\nThe parent's ask.\n\n*End of what was asked on the parent.*\n\n## Current`), body.brief.slice(0, 300));
  });
});
