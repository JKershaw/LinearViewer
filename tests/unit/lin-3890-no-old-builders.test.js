// LIN-3890 outcome 1: every area except Models is built from the shared rows. The old builders
// (the tree/node/line/field markup, the provider form, the `field` value spans) are gone from every
// non-Models area, so no area can render two row vocabularies again.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { AREAS } from '../../lib/settings-areas.js';
import '../../lib/providers/index.js';

const OLD = [
  /class="tree"/, /class="node"/, /class="line\b/, /class="field-label"/, /class="field-value/,
  /class="[^"]*\bprovider-form\b/, /class="[^"]*\bkv\b/
];

const BASE = {
  urlKey: 'acme', workspaces: [], currentModel: 'openai/gpt-5.4-mini', availableModels: [],
  providerBindings: [
    { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
    { provider: 'github', scope: 'owner/repo', displayName: 'GitHub', token: 'ccccdddd', active: false }
  ],
  llmStats: { totalCalls: 2, totalCost: 0.01, totalTokens: 100, byFeature: [{ feature: 'recommend', calls: 2, cost: 0.01 }] },
  providerContextSummary: { traces: 3, untracedContext: 1, divergent: 0, benign: 1, newestUntracedContextAt: null, expectedDisplayName: 'Linear', basis: 'x' }
};

describe('no old builder markup in a non-Models area (LIN-3890)', () => {
  for (const area of AREAS.filter(a => a.id !== 'models').map(a => a.id)) {
    test(`${area}`, () => {
      const html = renderSettingsPage('Acme', { ...BASE, area, keys: [], changeLogRows: [] });
      const shell = html.slice(html.indexOf('<main class="settings-main">'), html.indexOf('</main>'));
      for (const re of OLD) assert.doesNotMatch(shell, re, `${area} still renders ${re}`);
    });
  }
});
