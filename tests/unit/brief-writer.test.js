/**
 * LIN-3292/LIN-3293: the writing layer's contract, not its wording.
 *
 * With the switch on, the meta call only routes; code assembles the stage's rules
 * bundle (its template body), a second call writes the brief, and code appends the
 * contract and grounding. These pin what must hold whatever the writer writes:
 *   - every machine-read format is present, and grounding is appended once;
 *   - defer skips the writer;
 *   - with the switch (the briefWriter workspace feature) off, output is byte-identical;
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
  splitStageBody,
  setFetchImpl,
  setLlmCallRecorder,
  setPromptTraceRecorder,
  BRIEF_WRITER_FEATURE
} from '../../lib/openrouter.js';
import { generatePrompt, finishStagePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { appendGroundingSections } from '../../lib/prompt-formatters.js';
import { buildBriefWriterPrompt, STAGE_IDEALS, STAGE_INTENT, formatStageIntent } from '../../lib/prompts/brief-writer.js';
import { isBriefWriterEnabled, resolveBriefWriter, BRIEF_WRITER_OP_KIND } from '../../lib/brief-writer.js';
import { AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { WORKSPACE_FEATURES, WORKSPACE_FEATURE_DEFAULTS, WORKSPACE_FEATURE_LABELS, WORKSPACE_FEATURE_DESCRIPTIONS, isValidWorkspaceFeatureKey, isValidFeatureKey } from '../../lib/feature-defaults.js';
import { AI_OPERATION_LABELS } from '../../lib/render-settings.js';

const ISSUE = {
  id: 'issue-w', identifier: 'LIN-3293', title: 'Writer fixture', description: 'Make the thing work.',
  url: 'https://linear.app/test/issue/LIN-3293', createdAt: '2026-03-01T00:00:00.000Z',
  state: { name: 'In Progress', type: 'started' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const BRIEF = '## Goal\n\nA plain brief, written for a colleague.';
/** What the writer path ships for a stage: code's blocks around the written Goal, the intent lines, the finish. */
const expected = (kind, goal = BRIEF) => {
  const { before, after } = splitStageBody(PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {}));
  const body = `${before}${goal}${after.trim() ? `\n\n${after.trim()}` : ''}${formatStageIntent(kind)}`;
  return finishStagePrompt(body, kind, ISSUE, CONTEXT, {}, null);
};
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

describe('the switch: the experimental briefWriter workspace feature', () => {
  const store = ({ features = {}, byKind = {}, modelId = null } = {}) => ({ getWorkspacePreferences: async () => ({ modelId, features, aiModelOverrides: { byKind } }) });
  const ON = { [WORKSPACE_FEATURES.BRIEF_WRITER]: true };

  test('a Settings toggle: experimental, off by default, labelled and described', () => {
    assert.equal(WORKSPACE_FEATURES.BRIEF_WRITER, 'briefWriter');
    assert.equal(WORKSPACE_FEATURE_DEFAULTS.briefWriter, false);
    assert.match(WORKSPACE_FEATURE_LABELS.briefWriter, /experimental/i);
    assert.ok(WORKSPACE_FEATURE_DESCRIPTIONS.briefWriter);
    assert.ok(isValidWorkspaceFeatureKey('briefWriter'));
    assert.equal(isValidFeatureKey('briefWriter'), false, 'workspace-scoped: per-user flags never reach the proxy path');
  });

  test('off unless the workspace turned it on; off without a workspace or store', async () => {
    assert.equal(await isBriefWriterEnabled({ urlKey: 'acme', workspacePreferencesStore: store() }), false);
    assert.equal(await isBriefWriterEnabled({ urlKey: 'acme', workspacePreferencesStore: store({ features: { briefWriter: false } }) }), false);
    assert.equal(await isBriefWriterEnabled({ urlKey: 'acme', workspacePreferencesStore: store({ features: ON }) }), true);
    assert.equal(await isBriefWriterEnabled({ urlKey: null, workspacePreferencesStore: store({ features: ON }) }), false);
    assert.equal(await isBriefWriterEnabled({ urlKey: 'acme', workspacePreferencesStore: null }), false);
  });

  test('no environment variable turns it on any more', async () => {
    assert.equal(await resolveBriefWriter({ urlKey: 'acme', workspacePreferencesStore: store(), env: { HARBOUR_BRIEF_WRITER: 'on' } }), null);
  });

  test('the writer\'s model is a per-operation setting like the others: a kind with a label', () => {
    assert.ok(AI_OPERATION_KINDS.includes(BRIEF_WRITER_OP_KIND), 'saved and rendered by the per-operation overrides');
    assert.ok(AI_OPERATION_LABELS[BRIEF_WRITER_OP_KIND]);
  });

  test('model: env, then the workspace recommend-write override, then the router\'s model; free tier clamps', async () => {
    const on = (byKind) => store({ features: ON, byKind });
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({}), env: { HARBOUR_BRIEF_WRITER_MODEL: 'x/writer' } }), { model: 'x/writer' });
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({ [BRIEF_WRITER_OP_KIND]: { model: 'x/own' }, recommend: { model: 'x/rec' } }), env: {} }), { model: 'x/own' });
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({ recommend: { model: 'x/rec' } }), env: {} }), { model: 'x/rec' });
    const free = await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({ [BRIEF_WRITER_OP_KIND]: { model: 'x/own' } }), isFreeTier: true, env: {} });
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

  test('the writer rewrites the Goal alone, sees what code adds, and gets the router\'s reasoning, on its own model', async () => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/writer' } });
    const writer = calls.find(c => c.isWriter);
    const { before, goal } = splitStageBody(PROMPT_TEMPLATES.review.generate(ISSUE, CONTEXT, {}));
    assert.equal(writer.body.model, 'x/writer');
    const bundle = writer.content.match(/<bundle>\n([\s\S]*)\n<\/bundle>/)[1];
    assert.equal(bundle, goal, 'the bundle is the template\'s Goal section');
    const added = writer.content.match(/<added>\n([\s\S]*)\n<\/added>/)[1];
    assert.ok(added.includes(before) && added.includes(formatStageIntent('review')) && added.includes('## Formats Later Steps Read'),
      'shown what code adds, so it does not restate it');
    assert.ok(writer.content.includes(STAGE_IDEALS.review));
    assert.match(writer.content, /→ \*\*review\*\*/);
    assert.doesNotMatch(writer.content, /<task>/, 'the agent reads the live ticket itself; the writer is not handed it');
  });

  test('code owns the title, workflow and facts blocks: a writer that drops or rewrites them changes nothing there', async () => {
    const careless = '# Something else\n\n## Workflow\n\n1. Just do it\n\n## Goal\n\nA plain brief, written for a colleague.';
    transport({ route: routing('review'), write: careless });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.prompt, expected('review'));
    assert.equal(count(rec.prompt, '## Workflow'), 1);
    assert.match(rec.prompt, /\*\*Update Linear\*\*: Add findings as a comment on LIN-3293/);
  });

  test('on a read-only tracker the code-owned workflow still loses its write steps', async () => {
    const ui = { write: false, subtasks: false, displayName: 'Jira', fixedStates: false };
    transport({ route: routing('implement'), write: BRIEF });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' }, providerUi: ui });
    assert.match(rec.prompt, /## Workflow/);
    assert.doesNotMatch(rec.prompt, /\*\*Start\*\*|status to "In Progress"/);
  });

  test('the scope and authority lines are code\'s, verbatim, for every stage; never on the switch-off path', async () => {
    assert.deepEqual(Object.keys(STAGE_INTENT).sort(), Object.keys(PROMPT_TEMPLATES).sort());
    for (const [kind, template] of Object.entries(PROMPT_TEMPLATES)) {
      transport({ route: routing(template.name), write: '## Goal\n\nInside means this ticket\'s own unfinished scope.' });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      for (const line of STAGE_INTENT[kind]) assert.ok(rec.prompt.includes(`- ${line}`), `${kind}: ${line.slice(0, 40)}`);
      assert.ok(!generatePrompt(kind, ISSUE, CONTEXT).prompt.includes('## Scope and Authority'), `${kind}: switch-off unchanged`);
    }
    assert.match(STAGE_INTENT.review.join(' '), /its cause included, wherever it lives/);
  });

  test('a reply with no Goal text left ships the unwritten bundle', async () => {
    transport({ route: routing('review'), write: '# Title only\n\n## Goal\n' });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.prompt, generatePrompt('review', ISSUE, CONTEXT).prompt);
    assert.equal(rec.writerReason, 'empty');
  });

  test('every machine-read format is present and the grounding is appended once, for every stage', async () => {
    for (const [kind, template] of Object.entries(PROMPT_TEMPLATES)) {
      transport({ route: routing(template.name), write: BRIEF });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      assert.equal(rec.prompt, expected(kind), kind);
      const contract = formatStageContract(kind, ISSUE.identifier);
      if (contract) assert.equal(count(rec.prompt, contract), 1, `${kind}: contract once`);
      assert.ok(rec.prompt.includes(contract + appendGroundingSections('', ISSUE, CONTEXT, kind)), `${kind}: contract then grounding`);
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
    assert.equal(rec.prompt, expected('review'));
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

  test('the tone standard: the writer and every stage shape address the agent directly, without persona or scars', () => {
    const text = [buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' }), ...Object.values(STAGE_IDEALS), ...Object.values(STAGE_INTENT).flat()].join('\n');
    for (const bad of [/\bwe\b/i, /\bsomeone\b/i, /pair of (eyes|hands)/i, /\bhonestly\b/i, /skilled lead/i, /\bLIN-\d+/]) {
      const hits = text.split('\n').filter(l => bad.test(l) && !/No "we"/.test(l));
      assert.deepEqual(hits, [], String(bad));
    }
    assert.match(STAGE_INTENT.review.join(' '), /one clear question with your recommendation/, 'escalation is a decision point');
  });

  test('every stage has an ideal shape for the writer', () => {
    assert.deepEqual(Object.keys(STAGE_IDEALS).sort(), Object.keys(PROMPT_TEMPLATES).sort());
  });

  test('the writer prompt carries the reasoning only when there is one', () => {
    assert.doesNotMatch(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' }), /Why this stage was chosen/);
    assert.match(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B', reasoning: 'R' }), /Why this stage was chosen\n\nR/);
  });
});
