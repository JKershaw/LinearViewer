/**
 * One path for every recommendation (LIN-3300): one routing call picks the stage and
 * code assembles its prompt, which is generatePrompt for that stage (its fixed Goal lead,
 * STAGE_LEADS; Scope and Authority; its process; the contract; grounding). These pin
 * what must hold on that path:
 *   - the routing call carries no prompt-writing blocks and asks for no body;
 *   - every routable stage's recommended prompt is generatePrompt, byte for byte, with
 *     every machine-read format once and the grounding once;
 *   - Scope and Authority is code's, once, after the Goal's lead (LIN-3299);
 *   - defer has no body; an action that names no stage is an invalid reply;
 *   - the stream sends the reasoning live and the finished prompt as one delta.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRecommendation,
  getRecommendationStream,
  composeRoutedRecommendation,
  setFetchImpl,
  setLlmCallRecorder,
  setPromptTraceRecorder
} from '../../lib/openrouter.js';
import { generatePrompt, PROMPT_TEMPLATES, STAGE_LEADS, EXCLUDED_FROM_AI_RECOMMENDATION } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { appendGroundingSections } from '../../lib/prompt-formatters.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';
import { AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { WORKSPACE_FEATURE_KEYS } from '../../lib/feature-defaults.js';
import { AI_OPERATION_LABELS } from '../../lib/render-settings.js';

const ISSUE = {
  id: 'issue-w', identifier: 'LIN-3300', title: 'One-path fixture', description: 'Make the thing work.',
  url: 'https://linear.app/test/issue/LIN-3300', createdAt: '2026-03-01T00:00:00.000Z',
  state: { name: 'In Progress', type: 'started' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const GROUNDING_HEAD = '## Re-ground the Ticket (staleness check)';
const count = (text, needle) => text.split(needle).length - 1;
const ROUTABLE = Object.entries(PROMPT_TEMPLATES).filter(([kind]) => !EXCLUDED_FROM_AI_RECOMMENDATION.has(kind));

const json = (content, { finishReason = 'stop' } = {}) => ({
  ok: true,
  json: async () => ({ model: 'm', choices: [{ message: { content }, finish_reason: finishReason }], usage: { completion_tokens: 5, cost: 0.001 } })
});
const routing = (action, extra = '') => `## Reasoning\n**Assessment:**\n- Ready: ✓ Yes - built\n→ **${action}**\n${extra}**Next:** close-out`;

/** A transport that answers every call with the routing reply, recording each. */
function transport(route) {
  const calls = [];
  setFetchImpl(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ body, content: body.messages[0].content });
    return body.stream ? sse(route) : json(route);
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

describe('the deleted experiment leaves nothing behind', () => {
  test('no briefWriter workspace feature, no recommend-write model role', () => {
    assert.ok(!WORKSPACE_FEATURE_KEYS.includes('briefWriter'));
    assert.ok(!AI_OPERATION_KINDS.includes('recommend-write'));
    assert.ok(!('recommend-write' in AI_OPERATION_LABELS));
  });

  test('a workspace with the old option still set gets the one path: the option is ignored', async () => {
    const calls = transport(routing('review'));
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', briefWriter: { model: 'x/w' } });
    assert.equal(calls.length, 1);
    assert.equal(rec.prompt, generatePrompt('review', ISSUE, CONTEXT).prompt);
  });
});

describe('one routing call, then code assembles the stage prompt', () => {
  test('the routing call asks for no body and carries no prompt-writing blocks', async () => {
    const calls = transport(routing('review'));
    await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].content, /## Prompt Structure|Quality rules for generated prompts|\n## Prompt\n|Generate a tailored prompt/);
    assert.match(calls[0].content, /## CRITICAL: Sequential Workflow Decision/);
    assert.match(calls[0].content, /→ \*\*<action>\*\*/);
  });

  test('every routable stage: the prompt is generatePrompt, every format once, grounding once', async () => {
    for (const [kind, template] of ROUTABLE) {
      transport(routing(template.name));
      const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
      assert.equal(rec.prompt, generatePrompt(kind, ISSUE, CONTEXT).prompt, kind);
      const contract = formatStageContract(kind, ISSUE.identifier);
      if (contract) assert.equal(count(rec.prompt, contract), 1, `${kind}: contract once`);
      assert.ok(rec.prompt.includes(contract + appendGroundingSections('', ISSUE, CONTEXT, kind)), `${kind}: contract then grounding`);
      assert.equal(count(rec.prompt, GROUNDING_HEAD), kind === 'triage' ? 0 : 1, kind);
      assert.equal(count(rec.prompt, '## Process'), 1, `${kind}: the process once`);
      assert.ok(rec.prompt.includes(`## Goal\n${STAGE_LEADS[kind]}`), `${kind}: the stage's fixed lead`);
    }
  });

  // LIN-3299: Scope and Authority is code's, once, after the Goal's lead.
  test('Scope and Authority: every stage, once, between the Goal\'s lead and the process', async () => {
    assert.deepEqual(Object.keys(STAGE_INTENT).sort(), Object.keys(PROMPT_TEMPLATES).sort());
    const placed = (prompt, kind, path) => {
      assert.equal(count(prompt, '## Scope and Authority'), 1, `${kind}, ${path}: once`);
      for (const line of STAGE_INTENT[kind]) assert.ok(prompt.includes(`- ${line}`), `${kind}, ${path}: ${line.slice(0, 40)}`);
      const at = prompt.indexOf('## Scope and Authority');
      assert.ok(prompt.indexOf('## Goal') < at && at < prompt.indexOf('## Process'), `${kind}, ${path}: after the lead, before the process`);
    };
    for (const [kind, { name }] of Object.entries(PROMPT_TEMPLATES)) {
      placed(generatePrompt(kind, ISSUE, CONTEXT).prompt, kind, 'pinned');
      if (EXCLUDED_FROM_AI_RECOMMENDATION.has(kind)) continue;
      transport(routing(name));
      placed((await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' })).prompt, kind, 'routed');
    }
  });

  // The safety floors review rests on are in its process, printed as written, plus the
  // one scope line it does not state (LIN-3293 review S1).
  test('review keeps its safety floors', async () => {
    const floors = [/green CI never settles a ledger item/i, /never a bare Approve/i,
      /name the specific monitor/i, /write one line naming why no check short of production could prove the claim/i,
      /you name the rollback/i, /state the exact change/i, /You do NOT merge, mark the task Done, or file follow-ups/];
    transport(routing('review'));
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    const rest = rec.prompt.slice(rec.prompt.indexOf('## Scope and Authority'));
    for (const floor of floors) assert.match(rest, floor, String(floor));
  });

  test('the routing call is recorded under the caller\'s feature; the trace carries the routing and final prompts', async () => {
    const records = [];
    const traces = [];
    setLlmCallRecorder(r => records.push(r));
    setPromptTraceRecorder(t => traces.push(t));
    const calls = transport(routing('review'));
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k', callMeta: { urlKey: 'acme', feature: 'recommend' } });
    assert.deepEqual(records.map(r => r.feature), ['recommend']);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].metaPrompt, calls[0].content);
    assert.equal(traces[0].finalPrompt, rec.prompt);
    assert.equal(traces[0].prompt, null, 'the routing reply carries no body');
    assert.equal('briefWriter' in traces[0], false);
  });

  test('defer: one call, no body', async () => {
    const calls = transport(routing('defer', '**DeferTo:** LIN-9\n'));
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    assert.equal(calls.length, 1);
    assert.equal(rec.prompt, null);
    assert.equal(rec.deferTo, 'LIN-9');
  });

  test('an action that names no stage is an invalid reply, not a body-less dispatch', async () => {
    transport(routing('frobnicate'));
    await assert.rejects(getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' }), /names no stage/);
  });

  test('a body the router emits anyway is ignored: code assembles the prompt', async () => {
    transport(`${routing('review')}\n\n## Prompt\nA BODY THAT MUST NOT SHIP`);
    const rec = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'k' });
    assert.equal(rec.prompt, generatePrompt('review', ISSUE, CONTEXT).prompt);
  });
});

describe('streaming', () => {
  test('reasoning streams live; the finished prompt goes out as one delta after it', async () => {
    transport(routing('review'));
    const events = [];
    const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k' }, (type, data) => events.push({ type, data }));
    const deltas = events.filter(e => e.type === 'delta');
    const prompt = deltas.filter(e => e.data.section === 'prompt');
    assert.equal(prompt.length, 1);
    assert.equal(prompt[0].data.content, rec.prompt);
    assert.ok(deltas.findIndex(e => e.data.section === 'prompt') > deltas.findIndex(e => e.data.section === 'reasoning'));
    assert.deepEqual(events.filter(e => e.type === 'phase').map(e => e.data.phase), ['reasoning', 'prompt']);
    assert.equal(rec.prompt, generatePrompt('review', ISSUE, CONTEXT).prompt);
  });

  test('a body the router emits anyway is never streamed: the client only appends', async () => {
    transport(`${routing('review')}\n\n## Prompt\nA BODY THAT MUST NOT SHOW`);
    const events = [];
    const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k' }, (type, data) => events.push({ type, data }));
    const streamed = events.filter(e => e.type === 'delta' && e.data.section === 'prompt').map(e => e.data.content).join('');
    assert.equal(streamed, rec.prompt);
    assert.ok(!streamed.includes('MUST NOT SHOW'));
  });

  // LIN-3309 D1: the section parser only starts on `## Reasoning\n`, so a
  // `**Reasoning**` or headerless routing reply streams nothing on its own. The
  // stream emits the parsed reasoning as one catch-up delta, exactly once.
  for (const [label, route] of [
    ['**Reasoning**', '**Reasoning**\n**Assessment:**\n→ **review**\n**Next:** close-out'],
    ['headerless', '→ **review**\n**Next:** close-out'],
  ]) {
    test(`a ${label} routing reply still streams its reasoning (D1)`, async () => {
      transport(route);
      const events = [];
      const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k' }, (type, data) => events.push({ type, data }));
      const reasoning = events.filter(e => e.type === 'delta' && e.data.section === 'reasoning').map(e => e.data.content).join('');
      assert.ok(reasoning.length > 0, 'reasoning is not blank');
      assert.equal(reasoning, rec.reasoning, 'the parsed reasoning is streamed exactly once — no catch-up duplicate');
    });
  }

  test('defer streams reasoning only', async () => {
    transport(routing('defer', '**DeferTo:** LIN-9\n'));
    const events = [];
    const rec = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'k' }, (type, data) => events.push({ type, data }));
    assert.equal(rec.prompt, null);
    assert.equal(events.filter(e => e.type === 'delta' && e.data.section === 'prompt').length, 0);
  });
});

describe('stage leads and scope lines', () => {
  test('composeRoutedRecommendation passes a defer through untouched', () => {
    const parsed = { reasoning: 'r', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-2' };
    assert.equal(composeRoutedRecommendation(parsed, ISSUE, CONTEXT), parsed);
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

  test('the tone standard: every stage lead and scope line addresses the agent directly, without persona or scars', () => {
    const text = [...Object.values(STAGE_LEADS), ...Object.values(STAGE_INTENT).flat()].join('\n');
    for (const bad of [/\bwe\b/i, /\bsomeone\b/i, /pair of (eyes|hands)/i, /\bhonestly\b/i, /skilled lead/i, /\bLIN-\d+/, /\bact as\b/i]) {
      assert.deepEqual(text.split('\n').filter(l => bad.test(l)), [], String(bad));
    }
    assert.match(STAGE_INTENT.review.join(' '), /one clear question with your recommendation/, 'escalation is a decision point');
  });

  // LIN-3299: one intent per stage, the lead, with no role line beside it.
  test('one intent source per stage: the lead is the Goal, with no role line beside it', () => {
    assert.deepEqual(Object.keys(STAGE_LEADS).sort(), Object.keys(PROMPT_TEMPLATES).sort());
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      const body = PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {});
      const m = body.match(/^## Goal\n([\s\S]*?)\n(## Process\n)/m);
      assert.ok(m, `${kind}: a Goal followed by the process under its own heading`);
      assert.equal(m[1].trim(), STAGE_LEADS[kind], kind);
      assert.doesNotMatch(body, /\*\*Role\*\*/, kind);
    }
    assert.match(STAGE_LEADS.blocked, /clear it when it is yours to clear/);
    assert.doesNotMatch(STAGE_LEADS.blocked, /cannot unilaterally/);
  });

  // A limit that must hold lives in the process, not the lead (LIN-3299 review).
  test('the limits a stage must not lose are in the process, not the lead', () => {
    const process = (kind) => PROMPT_TEMPLATES[kind].generate(ISSUE, CONTEXT, {}).split('## Process')[1];
    assert.match(process('plan'), /Make no code changes here/);
    assert.doesNotMatch(STAGE_LEADS.plan, /code changes/);
    assert.match(process('retrospective-audit'), /Do not change status, labels, or any other task state/);
    assert.doesNotMatch(STAGE_LEADS['retrospective-audit'], /change state|authority/);
    assert.match(PROMPT_TEMPLATES.plan.generate(ISSUE, CONTEXT, {}), /\(see Process below\)/);
  });
});
