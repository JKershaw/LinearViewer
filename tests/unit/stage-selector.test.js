/**
 * LIN-3300: the stage selector decides from rules, options and only the context it needs.
 *
 * - The options are generated from the stages' own descriptions (one list, no aiHint,
 *   no completion signals, retro absent, defer present).
 * - The rules are written once, in order, each with its reason; no prompt-writing prose.
 * - The input is the selector view plus the facts computed in code.
 * - The reply is `→ **stage**` and `**Why now:**` (plus `**DeferTo:**` for defer), and
 *   the existing parse contract still holds for its consumers (descent reads action and
 *   deferTo).
 * - The plan-review facts are plain data: no precedence list and no loop count.
 *
 * Run with: node --test tests/unit/stage-selector.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouterPrompt, routeStage, parseWhyNow } from '../../lib/stage-router.js';
import { formatStageOptions, getSelectableStages, STAGE_LEADS } from '../../lib/prompt-templates.js';
import { getRecommendation, setFetchImpl, buildSelectorArgs } from '../../lib/openrouter.js';
import { RULING_MARK } from '../../lib/recommendation-facts.js';

const open = { name: 'In Progress', type: 'started' };
const leaf = (over = {}) => ({ identifier: 'LIN-1', title: 'A task', description: 'Do it.', state: open, labels: [], ...over });
const ctx = (over = {}) => ({ parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, ...over });
const prompt = (issue = leaf(), context = ctx()) => buildRouterPrompt(buildSelectorArgs(issue, context));

describe('the selector prompt (LIN-3300)', () => {
  test('its options are the stages\' own descriptions, in one generated list', () => {
    const p = prompt();
    assert.ok(p.includes(formatStageOptions()), 'the option list is formatStageOptions verbatim');
    const keys = getSelectableStages().map(s => s.key);
    assert.ok(keys.includes('defer') && !keys.includes('retro'), 'defer is offered, retro is not');
    assert.ok(p.includes(`one name from: ${keys.join(', ')}`), 'the reply vocabulary is the stage keys');
  });

  test('no aiHint, no completion signals and no prompt-writing material', () => {
    const p = prompt();
    for (const gone of ['## Action Types Reference', '## Completion Signals', 'Signal Status', 'Workflow:', 'prompt body',
      'prompt type', 'generated prompt', '## Prompt', '**Next:**', 'Assessment']) {
      assert.ok(!p.includes(gone), `drops ${JSON.stringify(gone)}`);
    }
  });

  test('the rules are one ordered list, each with its reason', () => {
    const p = prompt();
    const rules = p.slice(p.indexOf('## How to choose'), p.indexOf('## Reply'));
    const steps = rules.match(/^\d+\. \*\*[^*]+\*\*/gm);
    assert.deepEqual(steps.map(s => s.replace(/^\d+\. /, '')), [
      '**A person\'s word.**', '**Landed work.**', '**Blocked.**', '**Subtasks.**', '**A bug.**', '**Knowledge.**', '**Shape.**', '**Plan.**'
    ]);
    for (const line of rules.split('\n').filter(l => /^\d+\. /.test(l))) {
      assert.match(line, / Why: /, `every rule states its reason: ${line.slice(0, 40)}`);
    }
  });

  // Fix round (PR #1750 check).
  test('rule 2 sends finished, reviewed work to retrospective-audit before the general review sentence', () => {
    const p = prompt();
    const rule2 = p.slice(p.indexOf('2. **Landed work.**'), p.indexOf('3. **Blocked.**'));
    assert.ok(rule2.indexOf('`retrospective-audit`') > -1);
    assert.ok(rule2.indexOf('`retrospective-audit`') < rule2.indexOf('`review`'), 'the specific case comes first');
  });

  test('rule 1 is the ruling mark, decided in code, and no reason names a person', () => {
    const p = prompt();
    const rules = p.slice(p.indexOf('## How to choose'), p.indexOf('## Reply'));
    assert.doesNotMatch(rules, /person's comment among the latest/);
    assert.match(rules, /1\. \*\*A person's word\.\*\* The latest person's comment the trail facts name/);
    assert.doesNotMatch(rules, /John|Flight Companion/);
  });

  test('no dangling step references, and "fix it here" names a stage', () => {
    const landed = [
      { createdAt: '2026-01-01T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict:** Approve.' },
      { createdAt: '2026-01-02T00:00:00Z', body: 'Implementation landed: https://github.com/o/r/pull/9' }
    ];
    const p = prompt(leaf(), ctx({ comments: landed }));
    assert.match(p, /Since the latest plan-review verdict: a person's comment: no; landed work: https:\/\/github\.com\/o\/r\/pull\/9/);
    assert.doesNotMatch(p, /Step \d/, 'the selector has rules, not Steps');
    assert.doesNotMatch(p, /Route on these facts|Route this pass/, 'the facts steer to no stage; the rules read them');
    assert.doesNotMatch(p, /fix it here first|is fixed here/);
    const closeOut = getSelectableStages().find(s => s.key === 'close-out');
    assert.match(closeOut.whenNot, /`implementation`/);
  });

  test('scoping does not claim terse or empty tickets, and a relocated bug cause is not a standing one', () => {
    const stage = (k) => getSelectableStages().find(s => s.key === k);
    assert.doesNotMatch(stage('scoping').when, /vague|empty|what done means/i);
    assert.match(stage('scoping').whenNot, /`research`/);
    assert.match(stage('bug').when, /relocated/);
  });

  test('stage purposes say what the stage is for, without the worker\'s instructions', () => {
    for (const s of getSelectableStages()) {
      assert.doesNotMatch(s.purpose, /yours|your part|make no changes|flag for the human/i, `${s.key}: ${s.purpose}`);
      if (STAGE_LEADS[s.key]) assert.ok(STAGE_LEADS[s.key].startsWith(s.purpose), `${s.key} purpose is its lead's first sentence`);
    }
  });

  test('the fixed text is small: the procedure, the options and the reply contract', () => {
    const fixed = Buffer.byteLength(prompt(leaf({ description: '' }), ctx()));
    assert.ok(fixed < 14000, `selector fixed text is ${fixed} bytes`);
  });

  test('the input is the selector view and the facts, not the whole trail', () => {
    const comments = [1, 2, 3, 4, 5].map(n => ({ user: 'A', createdAt: `2026-10-0${n}T00:00:00Z`, body: `Comment number ${n}.` }));
    const p = prompt(leaf(), ctx({ comments }));
    assert.doesNotMatch(p, /Comment number 1\./);
    assert.match(p, /Comment number 5\./);
    assert.match(p, /TRAIL FACTS \(computed in code from all 5 comments/);
    assert.match(p, /- Implementation plan: none/);
  });

  test('a node sees its subtask facts and the suggested child', () => {
    const children = [{ id: 'c1', identifier: 'LIN-2', title: 'child', state: { name: 'Todo', type: 'unstarted' } }];
    const p = prompt(leaf(), ctx({ children, focusedChild: { issue: children[0] } }));
    assert.match(p, /- Subtasks: 1 \(0 done, 0 in progress, 1 remaining\)/);
    assert.match(p, /Frontier next child[^\n]*LIN-2/);
    assert.doesNotMatch(p, /- Implementation plan:/, 'plan facts are a leaf\'s');
  });

  // LIN-3300 simplify: the plan-review facts are plain data. The selector sees the
  // verdicts by kind, the latest and whether a person or landed work followed it; the
  // guidance lives once, in rule 8, and the loop bound is code's alone.
  test('plan-review verdicts arrive as plain data, with no precedence list and no loop count', () => {
    const rc = (d) => ({ createdAt: `2026-01-0${d}T00:00:00Z`, body: '### Plan Review Verdict\n\n**Verdict: Request Changes.**' });
    const app = { createdAt: '2026-01-01T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict: Approve.**' };
    const p = prompt(leaf(), ctx({ comments: [app, rc(2), rc(3), { createdAt: '2026-01-04T00:00:00Z', body: 'Go on with the narrow revision.' }] }));
    assert.match(p, /- Plan-review verdicts: 3 \(1 approve, 2 request changes\); latest: request changes \(2026-01-03\)/);
    assert.match(p, /- Since the latest plan-review verdict: a person's comment: yes; landed work: none/);
    assert.doesNotMatch(p, /PLAN-REVIEW FACTS|first match wins|since the latest Approve|Count \d|third|escalat/i);
    assert.doesNotMatch(prompt(), /Plan-review verdicts:/, 'no verdict, no line');
  });

  test('rule 8 carries the plan-review guidance once, as judgement with its reason', () => {
    const p = prompt();
    const rule8 = p.slice(p.indexOf('8. **Plan.**'), p.indexOf('## Reply'));
    assert.match(rule8, /The latest plan-review verdict asked for changes or discussion → `plan` for the revision, then `plan-review` once the revision is on the trail/);
    assert.match(rule8, /a verdict is answered before the plan is built on/);
    assert.equal(p.split('plan-review verdict asked for changes').length, 2, 'stated once');
  });

  test('a ruling older than the latest comments still reaches the selector', () => {
    const comments = [
      { user: 'John', createdAt: '2026-10-01T00:00:00Z', body: `Dispatch implement for N4.\n\n${RULING_MARK}` },
      ...[2, 3, 4].map(n => ({ user: 'A', createdAt: `2026-10-0${n}T00:00:00Z`, body: `Note ${n}.` }))
    ];
    assert.match(prompt(leaf(), ctx({ comments })), /Latest ruling recorded via Harbour[^\n]*\n+Dispatch implement for N4\./);
  });
});

describe('the reply contract (LIN-3300)', () => {
  test('→ **stage** and **Why now:** are parsed; the kind derives from the stage key', () => {
    const d = routeStage('## Reasoning\n→ **implementation**\n**Why now:** the review requested changes and nothing has changed since.', 'stop', 9);
    assert.equal(d.action, 'implementation');
    assert.equal(d.kind, 'implementation');
    assert.equal(d.whyNow, 'the review requested changes and nothing has changed since.');
    assert.equal(d.deferTo, null);
  });

  test('defer keeps its DeferTo contract', () => {
    const d = routeStage('→ **defer**\n**DeferTo:** LIN-9\n**Why now:** LIN-9 is the frontier child.', 'stop', 3);
    assert.equal(d.deferTo, 'LIN-9');
    assert.equal(d.whyNow, 'LIN-9 is the frontier child.');
    assert.equal(parseWhyNow('no line'), null);
  });

  test('the routing-only call sends the selector and returns its Why now on the reasoning', async () => {
    const sent = [];
    setFetchImpl(async (url, opts = {}) => {
      sent.push(JSON.parse(opts.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **defer**\n**DeferTo:** LIN-2\n**Why now:** the child holds the work.' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    try {
      const children = [{ id: 'c1', identifier: 'LIN-2', title: 'child', state: { name: 'Todo', type: 'unstarted' } }];
      const rec = await getRecommendation(leaf(), ctx({ children, focusedChild: { issue: children[0] } }), { apiKey: 'stub', model: 'x' });
      assert.equal(rec.recommendedAction, 'defer');
      assert.equal(rec.deferTo, 'LIN-2');
      assert.match(rec.reasoning, /\*\*Why now:\*\* the child holds the work\./);
      assert.match(sent[0], /## How to choose/);
    } finally {
      setFetchImpl(null);
    }
  });
});
