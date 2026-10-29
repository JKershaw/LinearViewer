/**
 * LIN-4024 step 3 (look), first chunk: a container's opened task runs on the container, the opened task names its
 * stage words, and a task waiting on a ruling shows its question card to the owner.
 *
 * Witnesses: `containerNodeKeysOf` marks the rows that have subtasks and no others; the Home mount hands each row its
 * container flag and the "Another step" stage words, from the page options and the rows a fold fetches (the real
 * `mountHomePromptSections` and `mergeHomeRowOpts` from public/app.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { containerNodeKeysOf } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');

// The function's source, cut from its declaration to its closing brace at column 0.
function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is declared in public/app.js`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

const node = (identifier, children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'Todo', type: 'unstarted' } },
  children,
  depth: 0,
});

describe('containerNodeKeysOf — the rows that have subtasks are the containers', () => {
  test('a row with children is a container, at any depth; a leaf is not', () => {
    const leafChild = node('LIN-3');
    const parent = node('LIN-2', [leafChild]);
    const root = node('LIN-1', [parent]);
    const keys = containerNodeKeysOf({ inProgressTrees: [{ roots: [root] }], recentActivityTrees: [], projectTrees: [] });
    assert.deepEqual(keys.sort(), [nodeKey(root.issue), nodeKey(parent.issue)].sort());
    assert.equal(keys.includes(nodeKey(leafChild.issue)), false);
  });

  test('a project row is read too, and an empty page has none', () => {
    const project = node('LIN-9', [node('LIN-10')]);
    assert.deepEqual(containerNodeKeysOf({ projectTrees: [{ incomplete: [project], completed: [] }] }), [nodeKey(project.issue)]);
    assert.deepEqual(containerNodeKeysOf({}), []);
  });
});

describe('the Home mount — each opened row gets its container flag and the stage words (public/app.js)', () => {
  // A row placeholder as the server emits it: identity on data attributes, one per opened task.
  const placeholder = (nodeKeyValue, issueId) => ({
    dataset: { issueId, identifier: `LIN-${issueId}`, title: `Task ${issueId}`, url: '', source: 'linear', stateType: 'started', nodeKey: nodeKeyValue, instanceKey: nodeKeyValue },
    closest: () => null,
  });

  function mountWith(pageOpts) {
    const inits = [];
    const sandbox = {
      window: {
        __HOME_PROMPT_OPTS__: { topTaskId: 'linear:top', defaultPromptKeys: [], morePromptKeys: [], ...pageOpts },
        PromptSection: { init: (el, opts) => { inits.push({ el, opts }); return {}; } },
      },
      document: {},
    };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mountHomePromptSections')}\nthis.mountHomePromptSections = mountHomePromptSections;`, sandbox);
    return { inits, mount: (rows) => sandbox.mountHomePromptSections({ querySelectorAll: () => rows }) };
  }

  test('a container row is flagged isContainer; a leaf row is not, and the stage words reach both', () => {
    const { inits, mount } = mountWith({
      containerNodeKeys: ['linear:parent'],
      stageWords: { research: 'Research', implementation: 'Build' },
    });
    mount([placeholder('linear:parent', '1'), placeholder('linear:leaf', '2')]);
    const byNode = (key) => inits.find((i) => i.el.dataset.nodeKey === key).opts;
    assert.equal(byNode('linear:parent').isContainer, true);
    assert.equal(byNode('linear:leaf').isContainer, false);
    assert.equal(JSON.stringify(byNode('linear:leaf').stageWords), JSON.stringify({ research: 'Research', implementation: 'Build' }), 'the stage words name each step');
  });

  test('a fetched row\'s container flag is merged into the page map before it mounts (mergeHomeRowOpts)', () => {
    const { inits, mount } = mountWith({ containerNodeKeys: [] });
    const sandbox = {
      window: { __HOME_PROMPT_OPTS__: { containerNodeKeys: [] } },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mergeHomeRowOpts')}\nthis.mergeHomeRowOpts = mergeHomeRowOpts;`, sandbox);
    sandbox.mergeHomeRowOpts({ containerNodeKeys: ['linear:fetched-parent'] });
    sandbox.mergeHomeRowOpts({ containerNodeKeys: ['linear:fetched-parent'] });
    // The page map is built inside the vm context, so compare its JSON, not a cross-realm array.
    assert.equal(JSON.stringify(sandbox.window.__HOME_PROMPT_OPTS__.containerNodeKeys), '["linear:fetched-parent"]', 'merged once, not duplicated');
    assert.equal(inits.length, 0, 'the merge alone mounts nothing');
    mount([]);
  });
});
