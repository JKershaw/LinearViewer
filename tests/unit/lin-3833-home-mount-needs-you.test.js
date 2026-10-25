/**
 * LIN-3833 — the subtask "needs you" line reaches the opened task on any Home row, not only the top task
 * (review 1b874ec6, finding 3). This drives the real `mountHomePromptSections` from `public/app.js` over a
 * Home fragment with two opened rows: the top task (nothing waiting) and a row below it (a child waiting).
 * The line must reach the row's own PromptSection through `app.js`'s lookup by node key.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');

// The function's source, cut from its declaration to its closing brace at column 0.
function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is declared in public/app.js`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

// A placeholder as the server emits it: identity on data attributes, one per opened task.
const placeholder = (nodeKey, issueId) => ({
  dataset: { issueId, identifier: `LIN-${issueId}`, title: `Task ${issueId}`, url: '', source: 'linear', stateType: 'started', nodeKey, instanceKey: nodeKey },
  closest: () => null,
});

describe('LIN-3833 — the needs-you line is passed to each mounted opened task by its node key', () => {
  test('a row below the top task gets its own waiting child; the top task gets none', () => {
    const top = placeholder('linear:top', '1');
    const row = placeholder('linear:row-b', '2');
    const inits = [];
    const window = {
      __HOME_PROMPT_OPTS__: {
        topTaskId: 'linear:top',
        subtaskNeedsYouById: { 'linear:row-b': { identifier: 'LIN-22', title: 'Waiting child', href: '/workspace/acme/task/LIN-22' } },
        defaultPromptKeys: [], morePromptKeys: [],
      },
      PromptSection: { init: (el, opts) => { inits.push({ el, opts }); return {}; } },
    };
    const root = { querySelectorAll: () => [top, row] };
    const sandbox = { window, document: {} };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mountHomePromptSections')}\nthis.mountHomePromptSections = mountHomePromptSections;`, sandbox);
    sandbox.mountHomePromptSections(root);

    assert.equal(inits.length, 2);
    const byNode = (key) => inits.find((i) => i.el.dataset.nodeKey === key).opts;
    assert.deepEqual(byNode('linear:row-b').subtaskNeedsYou, { identifier: 'LIN-22', title: 'Waiting child', href: '/workspace/acme/task/LIN-22' });
    assert.equal(byNode('linear:top').subtaskNeedsYou, null);
  });
});
