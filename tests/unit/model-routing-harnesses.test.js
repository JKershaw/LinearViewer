/**
 * LIN-3855: the one harness list (lib/model-routing-harnesses.js), its runnability rule (SD's launch
 * guard), the page check over a whole table, and the single copy of the list the client reads.
 *
 * Run with: node --test tests/unit/model-routing-harnesses.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISPATCH_HARNESS_SUGGESTIONS, DEFAULT_HARNESS, DISPATCH_CLAUDE_MODEL_SUGGESTIONS, DISPATCH_MODEL_SUGGESTIONS,
  DISPATCH_MODEL_OTHER_VALUE, isModelRunnableOn, harnessInForce, runnabilityProblems, harnessModelsBlock, curatedModelIds
} from '../../lib/model-routing-harnesses.js';
import { emptyTable, applyChangesToTable } from '../../lib/model-routing.js';
import { JOBS, SURFACES } from '../../lib/llm-jobs.js';
import { renderPage } from '../../lib/components/page.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** A table with the given agent-session group changes applied (`{ group: { harness?, model? } }`). */
function withGroup(table, group, patch) {
  return applyChangesToTable(table, Object.entries(patch).map(([field, to]) => ({ scope: 'group', surface: SURFACES.AGENT_SESSION, key: group, field, to })));
}
const agentJobsIn = (group) => JOBS.filter((j) => j.surface === SURFACES.AGENT_SESSION && j.group === group).map((j) => j.id);

describe('the harness list', () => {
  test('the offered lists, the blank sentinel and the default are the ones the Settings page always offered', () => {
    assert.deepEqual(DISPATCH_HARNESS_SUGGESTIONS, ['claude-code', 'opencode']);
    assert.equal(DEFAULT_HARNESS, 'claude-code');
    assert.deepEqual(DISPATCH_CLAUDE_MODEL_SUGGESTIONS, ['haiku', 'sonnet', 'opus', 'fable']);
    assert.equal(DISPATCH_MODEL_SUGGESTIONS.length, 10);
    assert.equal(DISPATCH_MODEL_OTHER_VALUE, '__other__');
  });

  test('Claude Code is offered only Claude presets; OpenCode the OpenRouter list', () => {
    assert.deepEqual(curatedModelIds('claude-code'), DISPATCH_CLAUDE_MODEL_SUGGESTIONS);
    assert.deepEqual(curatedModelIds('opencode'), DISPATCH_MODEL_SUGGESTIONS);
  });

  test('the block the client reads carries the same lists, nothing else', () => {
    const block = harnessModelsBlock();
    assert.deepEqual(block.harnesses, DISPATCH_HARNESS_SUGGESTIONS);
    assert.equal(block.defaultHarness, DEFAULT_HARNESS);
    assert.equal(block.otherValue, DISPATCH_MODEL_OTHER_VALUE);
    assert.deepEqual(block.curated, { 'claude-code': DISPATCH_CLAUDE_MODEL_SUGGESTIONS, opencode: DISPATCH_MODEL_SUGGESTIONS });
    assert.deepEqual(Object.keys(block).sort(), ['curated', 'defaultHarness', 'harnesses', 'otherValue']);
  });
});

describe('isModelRunnableOn (SD launch guard, executors.js)', () => {
  test('claude-code runs a recognised Claude family anywhere in the id, or a bare claude id', () => {
    assert.equal(isModelRunnableOn('claude-code', 'sonnet'), true);
    assert.equal(isModelRunnableOn('claude-code', 'anthropic/claude-3.5-sonnet'), true);
    assert.equal(isModelRunnableOn('claude-code', 'claude-haiku-5-5-20260101'), true);
    assert.equal(isModelRunnableOn('claude-code', 'default'), true);
    assert.equal(isModelRunnableOn('claude-code', 'openai/gpt-6.1-sol'), false);
    assert.equal(isModelRunnableOn('claude-code', 'google/gemini-3'), false);
  });

  test('opencode runs any provider-prefixed id, and refuses a bare alias', () => {
    assert.equal(isModelRunnableOn('opencode', 'openai/gpt-6.1-sol'), true);
    assert.equal(isModelRunnableOn('opencode', 'sonnet'), false);
  });

  test('a blank model, or a harness with no rule, is runnable', () => {
    assert.equal(isModelRunnableOn('claude-code', null), true);
    assert.equal(isModelRunnableOn('opencode', '  '), true);
    assert.equal(isModelRunnableOn('some-other', 'anything'), true);
  });

  test('a null harness is judged as the claude-code it dispatches as, never as "any harness"', () => {
    assert.equal(harnessInForce(null), 'claude-code');
    assert.equal(harnessInForce(''), 'claude-code');
    assert.equal(harnessInForce('opencode'), 'opencode');
    assert.equal(isModelRunnableOn(harnessInForce(null), 'openai/gpt-6.1-sol'), false);
  });
});

describe('runnabilityProblems: the page check over the whole table', () => {
  const MAKE = agentJobsIn('make');

  test('a group move to an OpenRouter-only model with no harness is refused for every follower, as claude-code', () => {
    // The null-harness witness: the stored harness is unset, so the check must judge the claude-code it runs as.
    const before = emptyTable();
    const after = withGroup(before, 'make', { model: 'openai/gpt-6.1-sol' });
    const problems = runnabilityProblems(before, after);
    assert.deepEqual(problems.map((p) => p.job).sort(), [...MAKE].sort());
    assert.ok(problems.every((p) => p.harness === 'claude-code' && p.model === 'openai/gpt-6.1-sol'));
  });

  // LIN-3966: the one observable relaxation of the write guard. A job row stating claude-code over a make
  // group that states opencode + a model used to be refused, because the pair that resolved was the crossed
  // one. The resolver now answers the job's harness with the model dropped (claude-code + null), which runs,
  // so the same write is admitted. Nothing here is weakened: a pair that really runs and cannot is still refused.
  test('a job row that creates the cross over an opencode group is admitted: the pair that runs is claude-code and no model (LIN-3966)', () => {
    const before = withGroup(emptyTable(), 'make', { harness: 'opencode', model: 'deepseek/deepseek-v4-pro' });
    const after = applyChangesToTable(before, [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'close-out', field: 'harness', to: 'claude-code' }]);
    assert.deepEqual(runnabilityProblems(before, after), []);
  });

  test('the same move with opencode named on the group is accepted', () => {
    const before = emptyTable();
    const after = withGroup(before, 'make', { model: 'openai/gpt-6.1-sol', harness: 'opencode' });
    assert.deepEqual(runnabilityProblems(before, after), []);
  });

  test('a change that repairs an incompatibility passes', () => {
    const bad = withGroup(emptyTable(), 'make', { model: 'openai/gpt-6.1-sol' });
    const fixed = withGroup(bad, 'make', { harness: 'opencode' });
    assert.deepEqual(runnabilityProblems(bad, fixed), []);
  });

  test('an incompatibility the write did not create is not reported (a proxy write never blocks an unrelated edit)', () => {
    const bad = withGroup(emptyTable(), 'make', { model: 'openai/gpt-6.1-sol' });
    const unrelated = withGroup(bad, 'sort', { model: 'anthropic/claude-sonnet-5' });
    assert.deepEqual(runnabilityProblems(bad, unrelated), []);
  });

  test('the agent default row is judged too, with job null', () => {
    const after = applyChangesToTable(emptyTable(), [{ scope: 'default', surface: SURFACES.AGENT_SESSION, key: 'default', field: 'model', to: 'openai/gpt-6.1-sol' }]);
    const problems = runnabilityProblems(emptyTable(), after);
    assert.ok(problems.some((p) => p.job === null));
  });

  test('Harbour-call jobs are not judged here (no harness; MODEL_ID_PATTERN at the route)', () => {
    const after = applyChangesToTable(emptyTable(), [{ scope: 'group', surface: SURFACES.HARBOUR_CALL, key: 'make', field: 'model', to: 'openai/gpt-6.1-sol' }]);
    assert.deepEqual(runnabilityProblems(emptyTable(), after), []);
  });
});

describe('one copy of the list (LIN-3855)', () => {
  const SOURCE_DIRS = ['lib', 'public', 'routes'];
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(js|mjs)$/.test(name) ? [path] : [];
  });
  const files = [...SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d))), join(ROOT, 'server.js')];
  const OWNER = join('lib', 'model-routing-harnesses.js');

  for (const name of ['DISPATCH_MODEL_SUGGESTIONS', 'DISPATCH_CLAUDE_MODEL_SUGGESTIONS', 'DISPATCH_HARNESS_SUGGESTIONS', 'DEFAULT_HARNESS', 'DISPATCH_MODEL_OTHER_VALUE']) {
    test(`${name} is declared with a literal in one file only`, () => {
      const declarers = files.filter((f) => new RegExp(`(const|let|var)\\s+${name}\\s*=\\s*(Object\\.freeze\\()?\\s*[\\['"]`).test(readFileSync(f, 'utf8')));
      assert.deepEqual(declarers.map((f) => relative(ROOT, f)), [OWNER]);
    });
  }

  test('the client reads the block rather than declaring a list (public/common.js)', () => {
    const common = readFileSync(join(ROOT, 'public/common.js'), 'utf8');
    assert.match(common, /window\.__HARNESS_MODELS__/);
    assert.doesNotMatch(common, /"haiku",\s*"sonnet"|'haiku',\s*'sonnet'/);
  });
});

describe('renderPage embeds the list once, on pages that load common.js', () => {
  const count = (html, needle) => html.split(needle).length - 1;
  const LOADER = '<script>(function(){document.querySelectorAll';

  test('a page that loads common.js carries the block and one loader', () => {
    const html = renderPage({ title: 't', scripts: ['/common.js'] });
    assert.equal(count(html, 'data-global="__HARNESS_MODELS__"'), 1);
    assert.equal(count(html, LOADER), 1);
  });

  test('a page with embeddedData and common.js has both blocks and still one loader', () => {
    const html = renderPage({ title: 't', scripts: ['/common.js'], embeddedData: { globalVar: 'X', value: { a: 1 } } });
    assert.equal(count(html, 'data-global="X"'), 1);
    assert.equal(count(html, 'data-global="__HARNESS_MODELS__"'), 1);
    assert.equal(count(html, LOADER), 1);
  });

  test('a page with embeddedData and no common.js is unchanged: its block, its loader, no harness list', () => {
    const html = renderPage({ title: 't', scripts: ['/x.js'], embeddedData: { globalVar: 'X', value: 1 } });
    assert.equal(count(html, 'data-global="X"'), 1);
    assert.equal(count(html, 'data-global="__HARNESS_MODELS__"'), 0);
    assert.equal(count(html, LOADER), 1);
  });

  test('a page with neither carries no data block at all', () => {
    const html = renderPage({ title: 't', scripts: ['/x.js'] });
    assert.equal(count(html, 'type="application/json"'), 0);
    assert.equal(count(html, LOADER), 0);
  });
});
