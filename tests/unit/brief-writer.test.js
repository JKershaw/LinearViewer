/**
 * LIN-3292/LIN-3293: the writing layer's contract, not its wording.
 *
 * With the switch on, the meta call only routes; code assembles the stage's rules
 * bundle (its template body), a second call writes the brief, and code appends the
 * contract and grounding. These pin what must hold whatever the writer writes:
 *   - every machine-read format is present, and grounding is appended once;
 *   - defer skips the writer;
 *   - with the switch off, output is byte-identical to the handwritten/meta paths;
 *   - a writer failure, truncation or timeout ships the unwritten bundle.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRecommendation,
  getRecommendationStream,
  writeStagePrompt,
  writeBrief,
  composeRoutedRecommendation,
  setFetchImpl,
  setLlmCallRecorder,
  setPromptTraceRecorder,
  BRIEF_WRITER_FEATURE
} from '../../lib/openrouter.js';
import { generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { appendGroundingSections } from '../../lib/prompt-formatters.js';
import { buildBriefWriterPrompt, STAGE_IDEALS } from '../../lib/prompts/brief-writer.js';
import { isBriefWriterEnabled, resolveBriefWriter, BRIEF_WRITER_OP_KIND } from '../../lib/brief-writer.js';
import { AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { AI_OPERATION_LABELS } from '../../lib/render-settings.js';

const ISSUE = {
  id: 'issue-w', identifier: 'LIN-3293', title: 'Writer fixture', description: 'Make the thing work.',
  url: 'https://linear.app/test/issue/LIN-3293', createdAt: '2026-03-01T00:00:00.000Z',
  state: { name: 'In Progress', type: 'started' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const BRIEF = '# Review LIN-3293: Writer fixture\n\nA plain brief, written for a colleague.';
const GROUNDING_HEAD = '## Re-ground the Ticket (staleness check)';
const count = (text, needle) => text.split(needle).length - 1;

const json = (content, { finishReason = 'stop' } = {}) => ({
  ok: true,
  json: async () => ({ model: 'm', choices: [{ message: { content }, finish_reason: finishReason }], usage: { completion_tokens: 5, cost: 0.001 } })
});
const routing = (action, extra = '') => `## Reasoning\n**Assessment:**\n- Ready: ✓ Yes - built\n→ **${action}**\n${extra}**Next:** close-out`;

/** A transport that answers the routing call and then the writer call, recording both. */
function transport({ route, write }) {
  const calls = [];
  setFetchImpl(async (url, opts) => {
    const body = JSON.parse(opts.body);
    const content = body.messages[0].content;
    const isWriter = content.startsWith('You are writing the brief');
    calls.push({ isWriter, body, content });
    if (!isWriter) {
      if (body.stream) return sse(route);
      return json(route);
    }
    return typeof write === 'function' ? write(opts) : json(write);
  });
  return calls;
}
function sse(text) {
  const enc = new TextEncoder();
  const pieces = [text.slice(0, 20), text.slice(20)];
  const blocks = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
  blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n');
  return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
}

const savedProxy = {};
beforeEach(() => {
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) { savedProxy[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  setFetchImpl(null); setLlmCallRecorder(null); setPromptTraceRecorder(null);
  for (const [k, v] of Object.entries(savedProxy)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('the switch', () => {
  test('off by default and for every off spelling; on for every on spelling', () => {
    for (const v of [undefined, '', '0', 'false', 'OFF', 'no']) assert.equal(isBriefWriterEnabled('acme', { HARBOUR_BRIEF_WRITER: v }), false, String(v));
    for (const v of ['1', 'true', 'ON', 'yes']) assert.equal(isBriefWriterEnabled('acme', { HARBOUR_BRIEF_WRITER: v }), true, v);
  });

  test('a list of workspace urlKeys turns it on for those workspaces only', () => {
    const env = { HARBOUR_BRIEF_WRITER: 'acme, beta' };
    assert.equal(isBriefWriterEnabled('acme', env), true);
    assert.equal(isBriefWriterEnabled('beta', env), true);
    assert.equal(isBriefWriterEnabled('gamma', env), false);
    assert.equal(isBriefWriterEnabled(null, env), false);
  });

  test('the writer\'s model is a per-operation setting like the others: a kind with a label', () => {
    assert.ok(AI_OPERATION_KINDS.includes(BRIEF_WRITER_OP_KIND), 'saved and rendered by the per-operation overrides');
    assert.ok(AI_OPERATION_LABELS[BRIEF_WRITER_OP_KIND]);
  });

  test('model: env, then the workspace recommend-write override, then the router\'s model; free tier clamps', async () => {
    const store = (byKind, modelId = null) => ({ getWorkspacePreferences: async () => ({ modelId, aiModelOverrides: { byKind } }) });
    const on = { HARBOUR_BRIEF_WRITER: 'on' };
    assert.equal(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: store({}), env: { HARBOUR_BRIEF_WRITER: 'off' } }), null);
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: store({}), env: { ...on, HARBOUR_BRIEF_WRITER_MODEL: 'x/writer' } }), { model: 'x/writer' });
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: store({ [BRIEF_WRITER_OP_KIND]: { model: 'x/own' }, recommend: { model: 'x/rec' } }), env: on }), { model: 'x/own' });
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: store({ recommend: { model: 'x/rec' } }), env: on }), { model: 'x/rec' });
    const free = await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: store({ [BRIEF_WRITER_OP_KIND]: { model: 'x/own' } }), isFreeTier: true, env: on });
    assert.notEqual(free.model, 'x/own', 'free tier never bills a workspace-chosen model');
  });
});

describe('switch off: byte-identical', () => {
  test('writeStagePrompt with no writer IS generatePrompt, for every stage', async () => {
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      const out = await writeStagePrompt(kind, ISSUE, CONTEXT, {}, null, null);
      assert.equal(out.prompt, generatePrompt(kind, ISSUE, CONTEXT).prompt, kind);
      assert.equal(out.written, false);
    }
  });

  test('getRecommendation without briefWriter makes one call and asks for a prompt body', async () => {
    const calls = transport({ route: `${routing('review')}\n\n## Prompt\nBODY` });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].content, /## Prompt Structure/);
    assert.ok(rec.prompt.startsWith('BODY' + formatStageContract('review', ISSUE.identifier)));
  });
});

describe('switch on: the meta call routes, code assembles, the writer writes', () => {
  test('the routing call asks for no body and carries no stage rules', async () => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/writer' } });
    const meta = calls.find(c => !c.isWriter).content;
    assert.doesNotMatch(meta, /## Prompt Structure|Quality rules for generated prompts|\n## Prompt\n/);
    assert.match(meta, /## CRITICAL: Sequential Workflow Decision/);
    assert.match(meta, /→ \*\*<action>\*\*/);
  });

  test('the writer gets the stage bundle, its ideal shape and the router\'s reasoning, on its own model', async () => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/writer' } });
    const writer = calls.find(c => c.isWriter);
    assert.equal(writer.body.model, 'x/writer');
    assert.ok(writer.content.includes(PROMPT_TEMPLATES.review.generate(ISSUE, CONTEXT, {})), 'the bundle is the template body');
    assert.ok(writer.content.includes(STAGE_IDEALS.review));
    assert.match(writer.content, /→ \*\*review\*\*/);
    assert.ok(!writer.content.includes('## Formats Later Steps Read'), 'the writer never sees the contract');
  });

  test('every machine-read format is present and the grounding is appended once, for every stage', async () => {
    for (const [kind, template] of Object.entries(PROMPT_TEMPLATES)) {
      transport({ route: routing(template.name), write: BRIEF });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      const tail = formatStageContract(kind, ISSUE.identifier) + appendGroundingSections('', ISSUE, CONTEXT, kind);
      assert.equal(rec.prompt, BRIEF + tail, kind);
      assert.equal(count(rec.prompt, GROUNDING_HEAD), kind === 'triage' ? 0 : 1, kind);
      assert.equal(rec.written, true);
    }
  });

  test('the writer\'s call is recorded under its own feature tag', async () => {
    const records = [];
    setLlmCallRecorder(r => records.push(r));
    transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' }, callMeta: { urlKey: 'acme', feature: 'recommend' } });
    assert.deepEqual(records.map(r => r.feature), ['recommend', BRIEF_WRITER_FEATURE]);
    assert.equal(records[1].urlKey, 'acme');
  });

  test('the trace records the writer\'s model and whether its brief shipped', async () => {
    const traces = [];
    setPromptTraceRecorder(t => traces.push(t));
    transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.deepEqual(traces[0].briefWriter, { model: 'x/w', written: true, reason: null });
  });

  test('defer skips the writer: one call, no body', async () => {
    const calls = transport({ route: routing('defer', '**DeferTo:** LIN-9\n'), write: BRIEF });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(calls.length, 1);
    assert.equal(rec.prompt, null);
    assert.equal(rec.deferTo, 'LIN-9');
  });

  test('an action that names no stage is an invalid reply, not a body-less dispatch', async () => {
    transport({ route: routing('frobnicate'), write: BRIEF });
    await assert.rejects(getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } }), /names no stage/);
  });
});

describe('writer failure ships the unwritten bundle', () => {
  const bundle = (kind) => generatePrompt(kind, ISSUE, CONTEXT).prompt;
  const cases = {
    'an HTTP error': () => ({ ok: false, status: 500, text: async () => 'boom' }),
    'a thrown transport error': () => { throw new Error('socket hang up'); },
    'a truncated reply': () => json('# Half a brief', { finishReason: 'length' }),
    'an empty reply': () => json('   ')
  };
  for (const [name, write] of Object.entries(cases)) {
    test(`${name}`, async () => {
      transport({ route: routing('review'), write });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      assert.equal(rec.prompt, bundle('review'));
      assert.equal(rec.written, false);
    });
  }

  test('a timeout: the hop\'s signal aborts the writer mid-call', async () => {
    const ac = new AbortController();
    transport({
      route: routing('review'),
      write: (opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        setTimeout(() => ac.abort(), 5);
      })
    });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' }, signal: ac.signal });
    assert.equal(rec.prompt, bundle('review'));
    assert.equal(rec.writerReason, 'timeout');
  });

  test('too little time left before the deadline: the writer is not called', async () => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' }, deadline: Date.now() + 2000 });
    assert.equal(calls.filter(c => c.isWriter).length, 0);
    assert.equal(rec.prompt, bundle('review'));
    assert.equal(rec.writerReason, 'no-time');
  });

  test('no key: no call, the bundle ships', async () => {
    const out = await writeBrief('BUNDLE', { kind: 'review', apiKey: null, model: 'x/w' });
    assert.deepEqual(out, { brief: null, reason: 'no-key' });
  });
});

describe('streaming', () => {
  test('reasoning streams live; the finished prompt goes out as one delta after it', async () => {
    transport({ route: routing('review'), write: BRIEF });
    const events = [];
    const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } }, (type, data) => events.push({ type, data }));
    const deltas = events.filter(e => e.type === 'delta');
    const prompt = deltas.filter(e => e.data.section === 'prompt');
    assert.equal(prompt.length, 1);
    assert.equal(prompt[0].data.content, rec.prompt);
    assert.ok(deltas.findIndex(e => e.data.section === 'prompt') > deltas.findIndex(e => e.data.section === 'reasoning'));
    assert.ok(rec.prompt.startsWith(BRIEF + formatStageContract('review', ISSUE.identifier)));
  });

  test('a body the router emits anyway is never streamed: the client only appends', async () => {
    transport({ route: `${routing('review')}\n\n## Prompt\nA BODY THAT MUST NOT SHOW`, write: BRIEF });
    const events = [];
    const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } }, (type, data) => events.push({ type, data }));
    const streamed = events.filter(e => e.type === 'delta' && e.data.section === 'prompt').map(e => e.data.content).join('');
    assert.equal(streamed, rec.prompt);
    assert.ok(!streamed.includes('MUST NOT SHOW'));
  });
});

describe('pure seams', () => {
  test('composeRoutedRecommendation passes a defer through untouched', async () => {
    const parsed = { reasoning: 'r', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-2' };
    assert.equal(await composeRoutedRecommendation(parsed, ISSUE, CONTEXT, {}, null, { apiKey: 'k' }), parsed);
  });

  test('every stage has an ideal shape for the writer', () => {
    assert.deepEqual(Object.keys(STAGE_IDEALS).sort(), Object.keys(PROMPT_TEMPLATES).sort());
  });

  test('the writer prompt carries the reasoning only when there is one', () => {
    assert.doesNotMatch(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' }), /Why this stage was chosen/);
    assert.match(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B', reasoning: 'R' }), /Why this stage was chosen\n\nR/);
  });
});
