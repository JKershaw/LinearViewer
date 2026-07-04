/**
 * Unit tests for render-settings.js — AI usage KPI block (LIN-418)
 *
 * Run with: node --test tests/unit/render-settings.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { AVAILABLE_MODELS } from '../../lib/openrouter.js';

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

describe('renderSettingsPage — model pricing hint (LIN-993)', () => {
  test('renders a pricing hint line for the current model, not inside option text', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      currentModel: 'openai/gpt-5.4-mini',
      availableModels: AVAILABLE_MODELS
    });
    // Hint host present, showing the selected model's rate.
    assert.match(html, /pricing:/);
    assert.match(html, /\$0\.75 in \/ \$4\.50 out per 1M tokens/);
    // Pricing rides as a data-attribute, never as visible <option> text.
    assert.match(html, /<option value="openai\/gpt-5\.4-mini"[^>]*data-pricing="[^"]+"[^>]*>GPT-5\.4 Mini<\/option>/);
    assert.doesNotMatch(html, /<option[^>]*>[^<]*per 1M tokens[^<]*<\/option>/);
  });

  test('degrades to a placeholder when the current model is a custom/unknown id', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      currentModel: 'some-provider/unknown-model',
      availableModels: AVAILABLE_MODELS
    });
    assert.match(html, /pricing:/);
    assert.match(html, /unknown \/ custom model/);
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

  test('offers a "make active" switch on inactive bindings only (LIN-717)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
        { provider: 'github', scope: 'owner/repo', displayName: 'GitHub', token: 'ccccdddd', active: false },
      ],
    });
    // Exactly one activate button — on the inactive (GitHub) row, not the active one.
    const activateCount = (html.match(/settings-provider-activate/g) || []).length;
    assert.strictEqual(activateCount, 1);
    assert.match(html, /\/settings\/providers\/switch/);
    // The active binding carries the ● marker, the inactive one the switch.
    const ghRow = html.slice(html.indexOf('data-provider="github"'));
    assert.match(ghRow.slice(0, 600), /settings-provider-activate/);
  });

  test('no "make active" switch when the only binding is already active (LIN-717)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
      ],
    });
    assert.doesNotMatch(html, /settings-provider-activate/);
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

  test('offers a working add affordance for GitHub (unblocked, LIN-541)', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.doesNotMatch(html, /blocked on LIN-541/);
  });

  test('offers a working add affordance for GitHub Projects (unblocked, LIN-560)', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-provider-add-github-projects"/);
    assert.match(html, /GitHub Projects/);
    assert.doesNotMatch(html, /blocked on LIN-560/);
  });

  test('GitHub add affordances default to enabled when githubEnabled is omitted (LIN-761)', () => {
    // Backward-compatible default: omitting the flag keeps the live add buttons,
    // so existing callers/output are unchanged.
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /GitHub is not configured on this server/);
  });

  test('disables BOTH GitHub add affordances with an honest reason when githubEnabled is false (LIN-761)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: false });
    // Both rows still render (data-testid preserved) but as blocked affordances,
    // not live add buttons — one shared flag gates Issues + Projects, so the honest
    // reason appears exactly twice (once per GitHub row).
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.match(html, /data-testid="settings-provider-add-github-projects"/);
    const reasonCount = (html.match(/GitHub is not configured on this server/g) || []).length;
    assert.strictEqual(reasonCount, 2);
    // Each GitHub row uses the blocked presentation, and NEITHER offers a live add
    // button (the add button only renders on unblocked rows; Linear is separately
    // blocked on LIN-544, so with GitHub disabled there is no live add button left).
    assert.doesNotMatch(html, /settings-provider-add-btn/);
    // Honest reason, not a stale ticket-blocked message.
    assert.doesNotMatch(html, /blocked on LIN-541/);
  });

  test('keeps the GitHub add affordances live when githubEnabled is true (LIN-761)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /GitHub is not configured on this server/);
  });

  test('disables the Linear add affordance as a stopgap until per-workspace binding lands (LIN-735/LIN-544)', () => {
    const html = renderSettingsPage('Acme', BASE);
    // The row still renders, but as a blocked affordance naming LIN-544 — not a
    // live "add" button that would silently create/switch to a separate workspace.
    assert.match(html, /data-testid="settings-provider-add-linear"/);
    assert.match(html, /blocked on LIN-544/);
    assert.match(html, /provider-add-blocked/);
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
