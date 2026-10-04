/**
 * LIN-3292/LIN-3293: the writing layer's contract, not its wording.
 *
 * With the switch on, the meta call only routes; code assembles the stage's body (its
 * template), a second call rewrites its Goal lead (LIN-3299: never its process), and code
 * appends the contract and grounding. These pin what must hold whatever the writer writes:
 *   - every machine-read format is present, and grounding is appended once;
 *   - defer skips the writer;
 *   - with the switch (the briefWriter workspace feature) off, output is byte-identical;
 *   - a writer failure, truncation or timeout ships the unwritten bundle;
 *   - Scope and Authority is code's on every path, once, after the Goal's lead (LIN-3299).
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
  routerFocus,
  briefFault,
  setFetchImpl,
  setLlmCallRecorder,
  setPromptTraceRecorder,
  BRIEF_WRITER_FEATURE,
  BRIEF_WRITER_PROSE_TOKENS,
  briefWriterBudget,
  resolveReasoningBudget,
  REASONING_MAX_TOKENS,
  isReasoningModel,
  DEFAULT_MODEL
} from '../../lib/openrouter.js';
import { generatePrompt, finishStagePrompt, PROMPT_TEMPLATES, STAGE_LEADS } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { appendGroundingSections } from '../../lib/prompt-formatters.js';
import { buildBriefWriterPrompt, STAGE_INTENT, PROCESS_ONLY, formatStageIntent } from '../../lib/prompts/brief-writer.js';
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
/** What the writer path ships for a stage: code's blocks around the written lead, then code's process, then the finish (which puts the scope lines after the lead). */
const expected = (kind, goal = BRIEF) => {
  const { before, after } = splitStageBody(PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {}));
  const body = `${before}${goal}${after.trim() ? `\n\n${after.trim()}` : ''}`;
  return finishStagePrompt(body, kind, ISSUE, CONTEXT, {}, null);
};
const GROUNDING_HEAD ='## Re-ground the Ticket (staleness check)';
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

  test('model: the workspace recommend-write setting, then the env default, then the router\'s model; free tier clamps', async () => {
    const on = (byKind) => store({ features: ON, byKind });
    const ENV = { HARBOUR_BRIEF_WRITER_MODEL: 'x/writer' };
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({ [BRIEF_WRITER_OP_KIND]: { model: 'x/own' } }), env: ENV }), { model: 'x/own' },
      'a model chosen in Settings wins over the instance default');
    assert.deepEqual(await resolveBriefWriter({ urlKey: 'a', workspacePreferencesStore: on({ recommend: { model: 'x/rec' } }), env: ENV }), { model: 'x/writer' });
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
    assert.ok(rec.prompt.startsWith('BODY' + formatStageIntent('review') + formatStageContract('review', ISSUE.identifier)));
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

  test('the writer rewrites the Goal\'s lead alone, on its own model, told what code adds and where the router points', async () => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/writer' } });
    const writer = calls.find(c => c.isWriter);
    const { goal, after } = splitStageBody(PROMPT_TEMPLATES.review.generate(ISSUE, CONTEXT, {}));
    assert.equal(writer.body.model, 'x/writer');
    const lead = writer.content.match(/<lead>\n([\s\S]*)\n<\/lead>/)[1];
    assert.equal(lead, goal, 'what the writer rewrites is the template\'s Goal section');
    assert.ok(lead.includes(STAGE_LEADS.review), 'which is the stage\'s lead');
    // LIN-3299: the process never reaches the writer, so it cannot blur it.
    assert.ok(after.startsWith('## Process'));
    for (const step of ['### Regression Check', '### What CI Did Not Prove', 'Mutation-check the load-bearing tests']) {
      assert.ok(after.includes(step) && !writer.content.includes(step), step);
    }
    assert.doesNotMatch(writer.content, /<task>/, 'the agent reads the live ticket itself; the writer is not handed it');
    // What code adds is named by heading, with the scope lines it must not narrow; the
    // contract's literals and the facts block's text are not shown, since a writer shown
    // them copies them (LIN-3293 review S5).
    const added = writer.content.match(/## What code adds\n\n([\s\S]*?)\n\n## The stage's lead/)[1];
    for (const h of ['## Workflow', '## Context', '## Process', '## Scope and Authority', '## Formats Later Steps Read', GROUNDING_HEAD]) assert.ok(added.includes(h), h);
    for (const line of STAGE_INTENT.review) assert.ok(added.includes(`- ${line}`), line.slice(0, 40));
    assert.ok(!added.includes('Title the summary comment') && !added.includes('Read before acting'), 'no contract or facts text');
    // The router's action and Next lines, not its assessment, which the writer would state as fact.
    assert.match(writer.content, /→ \*\*review\*\*/);
    assert.match(writer.content, /\*\*Next:\*\* close-out/);
    assert.doesNotMatch(writer.content, /Ready: ✓ Yes - built/);
  });

  test('the writer writes the lead only: any section it adds, a copy of code\'s or a process of its own, is dropped', async () => {
    const copies = '## Formats Later Steps Read\n\n- Title it `## Review: LIN-3293`\n\n## Scope and Authority\n\n- Stay inside the ticket.\n\n' +
      '## Re-ground the Ticket\n\nTrust the ticket.\n\n## If Blocked\n\nKeep going.\n\n## workflow\n\n1. Just do it\n\n## Process\n\nSkip the tests.';
    transport({ route: routing('implement'), write: `${BRIEF}\n\n## Notes\n\nA process of its own.\n\n${copies}` });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.prompt, expected('implementation'));
    for (const h of ['## Formats Later Steps Read', '## Scope and Authority', '## If Blocked', '## Workflow', '## Process']) assert.equal(count(rec.prompt, h), 1, h);
    assert.equal(count(rec.prompt, '## Re-ground the Ticket'), 1);
    for (const copied of ['A process of its own', 'Stay inside the ticket', 'Review: LIN-3293', 'Trust the ticket', 'Keep going', 'Just do it', 'Skip the tests']) assert.ok(!rec.prompt.includes(copied), copied);
  });

  // LIN-3299: the order of the written prompt: the lead, the permission it works under, then
  // the process code prints as written.
  test('the scope lines sit between the written lead and the process, which code keeps verbatim', async () => {
    transport({ route: routing('plan'), write: BRIEF });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    const at = (h) => rec.prompt.indexOf(h);
    assert.ok(at('A plain brief') < at('## Scope and Authority') && at('## Scope and Authority') < at('## Process'));
    const { after } = splitStageBody(PROMPT_TEMPLATES.plan.generate(ISSUE, CONTEXT, {}));
    assert.ok(rec.prompt.includes(after.trim()), 'the process, word for word');
    assert.ok(!rec.prompt.includes(STAGE_LEADS.plan), 'the static lead gives way to the written one');
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

  // LIN-3299: Scope and Authority is code's on every path, as the contract is: written or
  // not, a fallback, a process-only stage, and the meta path with the switch off. Before,
  // only a written lead carried it, so the switch-off path had no permission lines at all.
  test('Scope and Authority: every stage, every path, once, between the Goal\'s lead and the process', async () => {
    assert.deepEqual(Object.keys(STAGE_INTENT).sort(), Object.keys(PROMPT_TEMPLATES).sort());
    const placed = (prompt, kind, path) => {
      assert.equal(count(prompt, '## Scope and Authority'), 1, `${kind}, ${path}: once`);
      for (const line of STAGE_INTENT[kind]) assert.ok(prompt.includes(`- ${line}`), `${kind}, ${path}: ${line.slice(0, 40)}`);
      const at = prompt.indexOf('## Scope and Authority');
      assert.ok(prompt.indexOf('## Goal') < at && at < prompt.indexOf('## Process'), `${kind}, ${path}: after the lead, before the process`);
    };
    const meta = '# T\n\n## Workflow\n\n1. Go\n\n## Goal\n\nWhat it is for.\n\n## Process\n\nThe steps.';
    for (const [kind, { name }] of Object.entries(PROMPT_TEMPLATES)) {
      placed(generatePrompt(kind, ISSUE, CONTEXT).prompt, kind, 'writer off');
      // `retro` is excluded from the AI recommendation path (LIN-3309), so the
      // routing reply can never name it; the template still renders writer-off.
      if (kind === 'retro') continue;
      transport({ route: routing(name), write: BRIEF });
      placed((await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } })).prompt, kind, 'writer on');
      transport({ route: routing(name), write: () => json('', { finishReason: 'length' }) });
      placed((await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } })).prompt, kind, 'writer fallback');
      transport({ route: `${routing(name)}\n\n## Prompt\n${meta}` });
      placed((await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' })).prompt, kind, 'meta, switch off');
    }
  });

  test('meta: a generated prompt with no Goal still gets Scope and Authority once, before the contract', async () => {
    transport({ route: `${routing('plan')}\n\n## Prompt\nJust do it.` });
    const { prompt } = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    assert.ok(prompt.startsWith(`Just do it.${formatStageIntent('plan')}${formatStageContract('plan', ISSUE.identifier)}`));
    assert.equal(count(prompt, '## Scope and Authority'), 1);
  });

  // The safety floors review rests on are code's on every path: the process states them,
  // printed as written, and the one it does not (green CI never settles a ledger item) is a
  // scope line, so a writer that drops them from its lead cannot drop them from the prompt
  // (LIN-3293 review S1). Close-out has no writer (LIN-3299); its floors are its process.
  test('review keeps its safety floors whatever the writer writes; close-out is never written', async () => {
    const floors = [/green CI never settles a ledger item/i, /never a bare Approve/i,
      /name the specific monitor/i, /write one line naming why no check short of production could prove the claim/i,
      /you name the rollback/i, /state the exact change/i, /You do NOT merge, mark the task Done, or file follow-ups/];
    transport({ route: routing('review'), write: '## Goal\n\nLand it.' });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.written, true);
    const rest = rec.prompt.slice(rec.prompt.indexOf('## Scope and Authority'));
    for (const floor of floors) assert.match(rest, floor, String(floor));
    const calls = transport({ route: routing('close-out'), write: '## Goal\n\nLand it.' });
    const closeOut = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(closeOut.prompt, generatePrompt('close-out', ISSUE, CONTEXT).prompt);
    assert.equal(calls.filter(c => c.isWriter).length, 0);
  });

  // Judging and investigating stages change no code, so they are not handed a licence to
  // fix; the stages that choose or build are (LIN-3293 review S2).
  test('only the stages that choose or build are told fixing at the cause is theirs', () => {
    const licence = /fixing at the cause and refactoring included, are yours/;
    for (const kind of ['plan-review', 'bug', 'review', 'close-out', 'retrospective-audit']) {
      assert.ok(!STAGE_INTENT[kind].some(l => licence.test(l)), kind);
      assert.match(STAGE_INTENT[kind][0], /one clear question with your recommendation/, kind);
    }
    for (const kind of ['triage', 'context', 'look-into', 'retro']) assert.ok(!STAGE_INTENT[kind].some(l => licence.test(l)), kind);
    for (const kind of ['research', 'scoping', 'design', 'spike', 'plan', 'breakdown', 'implementation', 'blocked']) {
      assert.match(STAGE_INTENT[kind][0], licence, kind);
    }
  });

  // Research, design and plan also serve features, evaluations and migrations, so their
  // leads and the cause line do not assume a defect (LIN-3293 review S6).
  test('the stage leads and the cause line do not assume every task is a defect', () => {
    for (const kind of ['research', 'design', 'plan']) {
      assert.doesNotMatch(STAGE_LEADS[kind], /recommend a fix|^[^,(]*\bthe problem and its cause\b|right fix/i, kind);
    }
    for (const lines of Object.values(STAGE_INTENT)) {
      for (const l of lines) assert.doesNotMatch(l, /^This task's problem includes its cause|removes this task's cause/, l.slice(0, 40));
    }
  });

  test('a reply with no Goal text left ships the unwritten bundle', async () => {
    transport({ route: routing('review'), write: '# Title only\n\n## Goal\n' });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.prompt, generatePrompt('review', ISSUE, CONTEXT).prompt);
    assert.equal(rec.writerReason, 'empty');
  });

  test('every machine-read format is present and the grounding is appended once, for every stage', async () => {
    for (const [kind, template] of Object.entries(PROMPT_TEMPLATES)) {
      // `retro` is excluded from the AI recommendation path (LIN-3309), so it is not
      // reachable through the routing reply this test drives; its formats are still
      // pinned through generatePrompt elsewhere.
      if (kind === 'retro') continue;
      transport({ route: routing(template.name), write: BRIEF });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      const written = !PROCESS_ONLY.includes(kind);
      assert.equal(rec.prompt, written ? expected(kind) : generatePrompt(kind, ISSUE, CONTEXT).prompt, kind);
      const contract = formatStageContract(kind, ISSUE.identifier);
      if (contract) assert.equal(count(rec.prompt, contract), 1, `${kind}: contract once`);
      assert.ok(rec.prompt.includes(contract + appendGroundingSections('', ISSUE, CONTEXT, kind)), `${kind}: contract then grounding`);
      assert.equal(count(rec.prompt, GROUNDING_HEAD), kind === 'triage' ? 0 : 1, kind);
      assert.equal(count(rec.prompt, '## Process'), 1, `${kind}: the process once`);
      assert.equal(rec.written, written, kind);
    }
  });

  // LIN-3299: these stages are near-pure process; a written lead adds little and a call costs
  // time, so the writer is not called and the template ships, which is generatePrompt.
  test('process-only stages never call the writer: the template ships, and the trace says why', async () => {
    assert.deepEqual([...PROCESS_ONLY].sort(), ['breakdown', 'close-out', 'context', 'look-into', 'triage']);
    for (const kind of PROCESS_ONLY) {
      const traces = [];
      setPromptTraceRecorder(t => traces.push(t));
      const calls = transport({ route: routing(PROMPT_TEMPLATES[kind].name), write: BRIEF });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      assert.equal(calls.filter(c => c.isWriter).length, 0, kind);
      assert.equal(rec.prompt, generatePrompt(kind, ISSUE, CONTEXT).prompt, kind);
      assert.equal(rec.writerReason, 'process-only', kind);
      assert.deepEqual(traces[0].briefWriter, { model: 'x/w', written: false, reason: 'process-only' }, kind);
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

// LIN-3294: a reasoning model spends hidden reasoning inside max_tokens, so a flat cap
// let it think its way out of room and fall back on long stages.
describe('the writer\'s token budget and unfinished replies', () => {
  const bundle = (kind) => generatePrompt(kind, ISSUE, CONTEXT).prompt;
  const writerBody = async (model) => {
    const calls = transport({ route: routing('review'), write: BRIEF });
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model } });
    return calls.find(c => c.isWriter).body;
  };

  // Every writer gets a full reasoning allowance (REASONING_MAX_TOKENS, the most the shared
  // split ever grants) in max_tokens on top of the lead's budget, which costs nothing unless
  // used: the models that fell back in the comparison reason by default and are not on the
  // shared prefix list. A lead's small prose budget must not shrink the headroom with it
  // (LIN-3299 review: it fell to 2000). The `reasoning` field goes only to the listed
  // models. Outside the list it is not ignored: on a hybrid model it switches thinking on.
  const HEADROOM = BRIEF_WRITER_PROSE_TOKENS + REASONING_MAX_TOKENS;

  test('the headroom is a full reasoning allowance, not one scaled to the lead', () => {
    assert.ok(REASONING_MAX_TOKENS >= 8000, String(REASONING_MAX_TOKENS));
    for (const model of [DEFAULT_MODEL, 'x/w']) {
      assert.ok(briefWriterBudget(model).maxTokens - BRIEF_WRITER_PROSE_TOKENS >= REASONING_MAX_TOKENS, model);
    }
  });

  test('a listed reasoning model gets the LIN-1000 split: a full reasoning bound and the whole prose budget on top', async () => {
    assert.ok(isReasoningModel(DEFAULT_MODEL));
    const body = await writerBody(DEFAULT_MODEL);
    const { reasoning, maxTokens } = resolveReasoningBudget({ model: DEFAULT_MODEL, proseTokens: BRIEF_WRITER_PROSE_TOKENS, reasoningTokens: REASONING_MAX_TOKENS });
    assert.deepEqual(body.reasoning, reasoning);
    assert.equal(body.reasoning.max_tokens, REASONING_MAX_TOKENS);
    assert.equal(body.max_tokens, maxTokens);
    assert.equal(body.max_tokens, HEADROOM);
    assert.equal(body.max_tokens, BRIEF_WRITER_PROSE_TOKENS + body.reasoning.max_tokens, 'the prose budget survives the reasoning run');
    assert.deepEqual(briefWriterBudget(DEFAULT_MODEL), { reasoning, maxTokens });
  });

  for (const model of ['google/gemini-3.8-flash', 'deepseek/deepseek-v4-flash', 'openai/gpt-6.1-sol', 'anthropic/claude-opus-5.5', 'x/w']) {
    test(`a model off the prefix list (${model}) still gets the headroom, and no reasoning field`, async () => {
      assert.equal(isReasoningModel(model), false, 'the shared list is unchanged');
      const body = await writerBody(model);
      assert.equal(body.max_tokens, HEADROOM);
      assert.ok(body.max_tokens > BRIEF_WRITER_PROSE_TOKENS, 'room to think and still write the whole brief');
      assert.equal('reasoning' in body, false);
      assert.deepEqual(briefWriterBudget(model), { reasoning: undefined, maxTokens: HEADROOM });
    });
  }

  const unfinished = {
    'reasoning spent the whole budget: no content, cut at the limit': [{ content: '', finishReason: 'length' }, 'truncated'],
    'a null content cut at the limit': [{ content: null, finishReason: 'length' }, 'truncated'],
    'an upstream error mid-reply': [{ content: '## Goal\n\nHalf a', finishReason: 'error' }, 'unfinished-error'],
    'no finish reason at all': [{ content: '## Goal\n\nHalf a', finishReason: null }, 'unfinished-none']
  };
  for (const [name, [reply, reason]] of Object.entries(unfinished)) {
    test(`${name}: recognised, the bundle ships, and the trace says why`, async () => {
      const traces = [];
      const records = [];
      setPromptTraceRecorder(t => traces.push(t));
      setLlmCallRecorder(r => records.push(r));
      transport({ route: routing('review'), write: () => json(reply.content, { finishReason: reply.finishReason }) });
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
      assert.equal(rec.prompt, bundle('review'));
      assert.equal(rec.written, false);
      assert.equal(rec.writerReason, reason);
      assert.deepEqual(traces[0].briefWriter, { model: 'x/w', written: false, reason });
      const writerCall = records.find(r => r.feature === BRIEF_WRITER_FEATURE);
      assert.ok(writerCall, 'the spent call is still in the cost log');
      assert.equal(writerCall.finishReason, reply.finishReason);
    });
  }
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

  // LIN-3309 D1: the section parser only starts on `## Reasoning\n`, so a
  // `**Reasoning**` or headerless routing reply streams nothing on its own. The
  // stream now emits the parsed reasoning as one catch-up delta, exactly once.
  for (const [label, route] of [
    ['**Reasoning**', '**Reasoning**\n**Assessment:**\n→ **review**\n**Next:** close-out'],
    ['headerless', '→ **review**\n**Next:** close-out'],
  ]) {
    test(`a ${label} routing reply still streams its reasoning (D1)`, async () => {
      transport({ route, write: BRIEF });
      const events = [];
      const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } }, (type, data) => events.push({ type, data }));
      const reasoning = events.filter(e => e.type === 'delta' && e.data.section === 'reasoning').map(e => e.data.content).join('');
      assert.ok(reasoning.length > 0, 'reasoning is not blank');
      assert.equal(reasoning, rec.reasoning, 'the parsed reasoning is streamed exactly once — no catch-up duplicate');
    });
  }
});

describe('pure seams', () => {
  test('composeRoutedRecommendation passes a defer through untouched', async () => {
    const parsed = { reasoning: 'r', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-2' };
    assert.equal(await composeRoutedRecommendation(parsed, ISSUE, CONTEXT, {}, null, { apiKey: 'k' }), parsed);
  });

  test('the tone standard: the writer and every stage lead address the agent directly, without persona or scars', () => {
    const text = [buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' }), ...Object.values(STAGE_LEADS), ...Object.values(STAGE_INTENT).flat()].join('\n');
    for (const bad of [/\bwe\b/i, /\bsomeone\b/i, /pair of (eyes|hands)/i, /\bhonestly\b/i, /skilled lead/i, /\bLIN-\d+/, /\bact as\b/i]) {
      const hits = text.split('\n').filter(l => bad.test(l) && !/No "we"/.test(l));
      assert.deepEqual(hits, [], String(bad));
    }
    assert.match(STAGE_INTENT.review.join(' '), /one clear question with your recommendation/, 'escalation is a decision point');
  });

  // LIN-3299: one intent per stage. The template's role line and the writer's ideal shape
  // were two, and disagreed (blocked's role said the agent cannot decide; its ideal, clear
  // the obstacle when it is yours). The lead is now both: the handwritten Goal and the text
  // the writer rewrites.
  test('one intent source per stage: the lead is the handwritten Goal, with no role line beside it', () => {
    assert.deepEqual(Object.keys(STAGE_LEADS).sort(), Object.keys(PROMPT_TEMPLATES).sort());
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      const body = PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {});
      const { goal, after } = splitStageBody(body);
      assert.equal(goal.replace(/^## Goal\n/, '').trim(), STAGE_LEADS[kind], kind);
      assert.ok(after.startsWith('## Process\n'), `${kind}: the process follows the lead under its own heading`);
      assert.doesNotMatch(body, /\*\*Role\*\*/, kind);
    }
    assert.match(STAGE_LEADS.blocked, /clear it when it is yours to clear/);
    assert.doesNotMatch(STAGE_LEADS.blocked, /cannot unilaterally/);
  });

  // A limit that must survive lives where code prints it as written, not in the lead the
  // writer rewrites (LIN-3299 review): plan's no-code-changes and the audit's no-state-change.
  test('the limits a writer must not lose are in the process, not the lead', () => {
    const process = (kind) => PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {}).split('## Process')[1];
    assert.match(process('plan'), /Make no code changes here/);
    assert.doesNotMatch(STAGE_LEADS.plan, /code changes/);
    assert.match(process('retrospective-audit'), /Do not change status, labels, or any other task state/);
    assert.doesNotMatch(STAGE_LEADS['retrospective-audit'], /change state|authority/);
    assert.match(PROMPT_TEMPLATES.plan.generate(ISSUE, CONTEXT, {}), /\(see Process below\)/);
  });

  // The writer keeps the lead's limits but writes none of code's sections; it is not told
  // not to "repeat" Scope and Authority, which a lead may echo (LIN-3299 review).
  test('the writer is told not to write or narrow code\'s sections, not that it may never echo them', () => {
    const prompt = buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' });
    assert.match(prompt, /do not write or narrow them/);
    assert.doesNotMatch(prompt, /\brepeat\b/);
  });

  test('the writer prompt carries where the router points only when there is a pointer', () => {
    assert.doesNotMatch(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B' }), /Where the router points/);
    assert.match(buildBriefWriterPrompt({ kind: 'plan', bundle: 'B', focus: 'F' }), /## Where the router points[^\n]*\n\nF/);
    assert.equal(routerFocus('**Assessment:**\n- Ready: ✓ Yes\n→ **plan**\n**Next:** write it'), '→ **plan**\n**Next:** write it');
    assert.equal(routerFocus('no pointer here'), null);
  });
});

// A live read of real briefs found the router's Next line passed on as the task ("Evaluate
// the three fallback options…" in a design brief). The writer is told plainly, and code
// checks. (Its other fault, a command keyed to the ticket rewritten in prose, cannot recur:
// since LIN-3299 the commands are in the process, which never reaches the writer.)
describe('what the writer must not pass on: the router\'s specifics', () => {
  const DESIGN_FOCUS = '→ **design**\n**Next:** Evaluate the three fallback options against the stated constraints and upstream authority model, select the preferred approach.';

  test('the router\'s line is emphasis, not the task', () => {
    const prompt = buildBriefWriterPrompt({ kind: 'design', bundle: 'B', focus: 'F' });
    const header = prompt.match(/## Where the router points[^\n]*/)[0];
    assert.match(header, /start from the problem/i);
    assert.match(header, /none of its specifics as fact, task or option/i);
  });

  // LIN-3299: rules that did harm on rules text, and the command check, go with the rules.
  test('the lead-only writer is not told to reshape rules, and commands stay in the process', () => {
    const prompt = buildBriefWriterPrompt({ kind: 'retrospective-audit', bundle: '## Goal\n\nB', focus: null, sections: ['## Process'] });
    assert.doesNotMatch(prompt, /number only what has an order|conditionals that cannot apply/i);
    assert.match(prompt, /one or two short paragraphs/i);
    assert.ok(!PROMPT_TEMPLATES['retrospective-audit'].generate(ISSUE, CONTEXT, {}).split('## Process')[0].includes('git log'),
      'the ticket-keyed command is in the process, not the lead');
  });

  test('the writer\'s visible budget is sized for a lead, with a full reasoning allowance on top', () => {
    assert.ok(BRIEF_WRITER_PROSE_TOKENS <= 1500, String(BRIEF_WRITER_PROSE_TOKENS));
    assert.equal(briefWriterBudget('x/w').maxTokens, BRIEF_WRITER_PROSE_TOKENS + REASONING_MAX_TOKENS);
  });

  test('briefFault: five words in a row from the router\'s line, not in anything else the writer was shown, are its specifics passed on', () => {
    const shown = '## Goal\n\nWeigh the viable approaches against the constraints the task states, and choose one.';
    assert.equal(briefFault('## Goal\n\nEvaluate the three fallback options against the ticket\'s constraints.', { shown, focus: DESIGN_FOCUS }), 'copied-router');
    assert.equal(briefFault('## Goal\n\nStart from what the design is for, then weigh the viable approaches against the constraints the task states.', { shown, focus: DESIGN_FOCUS }), null);
    assert.equal(briefFault('## Goal\n\nEvaluate the three fallback options.', { shown, focus: null }), null, 'no focus, nothing to copy');
    assert.equal(briefFault('## Goal\n\nWeigh the viable approaches against the constraints.', { shown, focus: '**Next:** weigh the viable approaches against the constraints' }), null, 'words the bundle also says are the stage\'s own');
  });

  test('a brief that passes on the router\'s Next line ships the unwritten bundle', async () => {
    const route = `## Reasoning\n**Assessment:**\n- Ready: ✓ Yes\n${DESIGN_FOCUS}`;
    transport({ route, write: '## Goal\n\nEvaluate the three fallback options against the ticket\'s stated constraints and upstream authority model.' });
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(rec.prompt, generatePrompt('design', ISSUE, CONTEXT).prompt);
    assert.equal(rec.writerReason, 'copied-router');
    transport({ route, write: BRIEF });
    assert.equal((await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } })).written, true);
  });
});
