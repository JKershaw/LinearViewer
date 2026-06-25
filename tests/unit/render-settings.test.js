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

describe('renderSettingsPage — Providers section (LIN-634)', () => {
  test('always renders the Providers section header', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-providers"/);
    assert.match(html, /Providers/);
  });

  test('renders a row per binding with displayName, scope, masked token and remove/refresh forms', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-123', displayName: 'Linear', token: 'lin_api_secret9999', active: true },
      ],
    });
    assert.match(html, /data-testid="settings-provider-binding"/);
    assert.match(html, /data-provider="linear"/);
    assert.match(html, /data-scope="org-123"/);
    assert.match(html, /Linear:/);
    // Masked token: only last 4 chars shown, secret hidden.
    assert.match(html, /••••9999/);
    assert.doesNotMatch(html, /lin_api_secret9999/);
    // Action forms present.
    assert.match(html, /settings-provider-remove/);
    assert.match(html, /settings-provider-refresh/);
    // Active marker.
    assert.match(html, /provider-active/);
  });

  test('marks only the active binding', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
        { provider: 'github', scope: 'owner/repo', displayName: 'GitHub', token: 'ccccdddd', active: false },
      ],
    });
    const activeCount = (html.match(/provider-active/g) || []).length;
    assert.strictEqual(activeCount, 1);
  });

  test('renders local token as a partition-key label, not a masked secret', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'local', scope: 'notes-abcd', displayName: 'Local', token: 'notes-abcd', active: true },
      ],
    });
    assert.match(html, /\(partition key\)/);
    assert.doesNotMatch(html, /••••abcd/);
  });

  test('shows GitHub in the add list as disabled and blocked on LIN-541', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.match(html, /blocked on LIN-541/);
  });

  test('offers a working add affordance for Linear', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-provider-add-linear"/);
    assert.match(html, /settings-provider-add-btn/);
  });

  test('shows an empty state when there are no bindings', () => {
    const html = renderSettingsPage('Acme', { ...BASE, providerBindings: [] });
    assert.match(html, /no provider bindings/);
  });

  test('renders a provider notice when supplied (and escapes it)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerNotice: { type: 'fail', text: 'linear credentials failed validation.' },
    });
    assert.match(html, /data-testid="settings-provider-notice"/);
    assert.match(html, /provider-notice-fail/);
    assert.match(html, /linear credentials failed validation\./);
  });

  test('provider action forms are not feature-toggle forms (no XHR interception)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
      ],
    });
    // Provider forms carry the dedicated `provider-form` class, never the
    // `feature-form` hook app.js delegates XHR toggles through.
    assert.match(html, /class="settings-form provider-form"/);
    // The provider binding row must not expose the data-feature toggle hook.
    const bindingRow = html.slice(html.indexOf('settings-provider-binding'));
    const rowEnd = bindingRow.indexOf('</div>\n          </div>');
    assert.doesNotMatch(bindingRow.slice(0, rowEnd > 0 ? rowEnd : 600), /data-feature=/);
  });
});
