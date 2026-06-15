/**
 * Unit tests for render-settings.js — AI usage KPI block (LIN-418)
 *
 * Run with: node --test tests/unit/render-settings.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderSettingsPage } from '../../lib/render-settings.js';

const BASE = { urlKey: 'acme', workspaces: [], currentModel: 'openai/gpt-5.4-mini', availableModels: [] };

describe('renderSettingsPage — AI usage section', () => {
  test('always renders the AI usage section header', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /AI usage/);
  });

  test('shows an empty state when no calls are recorded', () => {
    const html = renderSettingsPage('Acme', { ...BASE, llmStats: { totalCalls: 0 } });
    assert.match(html, /none recorded yet/);
  });

  test('renders totals, formatted cost, tokens, and per-feature breakdown', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      llmStats: {
        totalCalls: 3,
        totalCost: 0.035,
        totalTokens: 12345,
        lastCallAt: '2026-06-15T20:00:00.000Z',
        byFeature: [
          { feature: 'recommend', calls: 2, cost: 0.03 },
          { feature: 'brief', calls: 1, cost: 0.005 }
        ]
      }
    });
    assert.match(html, /\$0\.0350/);          // small total → 4 decimals
    assert.match(html, /12,345/);             // tokens with thousands separator
    assert.match(html, /recommend:/);
    assert.match(html, /2 calls · \$0\.0300/);
    assert.match(html, /brief:/);
    assert.match(html, /1 call · \$0\.0050/); // singular "call"
    assert.match(html, /2026-06-15T20:00:00/);
  });

  test('formats totals over $1 with 2 decimals', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      llmStats: { totalCalls: 1, totalCost: 2.5, totalTokens: 0, byFeature: [{ feature: 'recap', calls: 1, cost: 2.5 }] }
    });
    assert.match(html, /\$2\.50/);
  });

  test('does not throw when llmStats is omitted', () => {
    assert.doesNotThrow(() => renderSettingsPage('Acme', BASE));
  });
});
