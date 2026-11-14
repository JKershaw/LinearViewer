/**
 * LIN-4470 (piece 6 of LIN-4448): the hand-built recommendation contexts retire into one builder.
 *
 * Four prompt surfaces built the same six-field object from a fetched context by hand (the pinned dispatch entrance,
 * the proxy's /prompt and /recommend overrides, the workspace API's in-app prompt). The fifth, the proxy's routing input
 * (prepareRecommendationInput), spreads the same builder and adds its own fields. promptContextOf
 * (lib/prompts/prompt-context.js) is the one projection. These tests pin three things:
 * it projects exactly the six fields generatePrompt reads; the four surfaces use it and no longer retype the list; and
 * the routing input carries every one of its fields, so a field added to the projection cannot miss the routing input.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptContextOf } from '../../lib/prompts/prompt-context.js';
import { prepareRecommendationInput } from '../../lib/recommendation-input.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIELDS = ['parent', 'siblings', 'project', 'children', 'comments', 'attachments'];
const RETYPED = /\{\s*parent,\s*siblings,\s*project,\s*children,\s*comments,\s*attachments\s*\}/;
const SITES = [
  'lib/dispatch-entrance.js',
  'routes/proxy-compute.js',
  'routes/workspace-api-prompts.js',
];

describe('LIN-4470 — promptContextOf projects the six fields a stage prompt reads', () => {
  test('a fetched context keeps exactly those six fields, present even when absent upstream', () => {
    const fetched = { issue: { identifier: 'LIN-1' }, parent: { id: 'p' }, siblings: [], project: null, children: [], comments: [], attachments: undefined, focusedChild: { id: 'x' }, extra: 1 };
    const projected = promptContextOf(fetched);
    assert.deepStrictEqual(Object.keys(projected), FIELDS);
    assert.deepStrictEqual(projected, { parent: { id: 'p' }, siblings: [], project: null, children: [], comments: [], attachments: undefined });
  });
});

describe('LIN-4470 — the four prompt surfaces take their context from the builder', () => {
  for (const file of SITES) {
    test(`${file} imports promptContextOf and does not retype the six-field list`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      assert.match(src, /import \{ promptContextOf \} from '[./]+(lib\/)?prompts\/prompt-context\.js'/, `${file} imports the builder`);
      assert.match(src, /promptContextOf\(/, `${file} calls the builder`);
      assert.doesNotMatch(src, RETYPED, `${file} retypes the six-field context`);
    });
  }
});

describe('LIN-4470 — the routing input carries every field the builder projects', () => {
  const store = {
    listItems: async () => [],
    listHistory: async () => ({ items: [] }),
  };
  const ctx = {
    parent: { id: 'p' }, siblings: [{ id: 's' }], project: { id: 'pr' }, children: [{ id: 'c' }],
    comments: [{ body: 'hi' }], focusedChild: { id: 'f' }, attachments: [{ url: 'u' }], siblingsTotal: 9,
  };

  test('prepareRecommendationInput includes each promptContextOf field with the same value', async () => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: store, urlKey: 'acme', identifier: 'LIN-1' });
    for (const key of Object.keys(promptContextOf(ctx))) {
      assert.deepStrictEqual(input[key], promptContextOf(ctx)[key], `routing input carries ${key}`);
    }
    assert.equal(input.focusedChild, ctx.focusedChild, 'the routing input still carries focusedChild');
    assert.equal('siblingsTotal' in input, false, 'siblingsTotal is still not forwarded to the routing prompt');
  });
});
