/**
 * Unit tests for render-settings.js — AI usage KPI block (LIN-418)
 *
 * Run with: node --test tests/unit/render-settings.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { AVAILABLE_MODELS } from '../../lib/openrouter.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-template-defs.js';

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

describe('renderSettingsPage — Dispatch defaults section (LIN-1095)', () => {
  test('always renders the section header as a sibling of the AI section', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-dispatch-defaults"/);
    assert.match(html, />Dispatch defaults</);
    // Two independent <section> blocks, not one nested inside the other.
    const aiIdx = html.indexOf('data-testid="settings-section-ai"');
    const ddIdx = html.indexOf('data-testid="settings-section-dispatch-defaults"');
    const aiSectionEnd = html.indexOf('</section>', aiIdx);
    assert.ok(aiIdx > -1 && ddIdx > -1 && aiSectionEnd > -1);
    assert.ok(ddIdx > aiSectionEnd, 'dispatch-defaults section must not be nested inside the AI section');
  });

  test('renders one row for the workspace-wide default plus one per live PROMPT_TEMPLATES key', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="dispatch-default-row-default"/);
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      assert.match(html, new RegExp(`data-testid="dispatch-default-row-${kind}"`), `missing row for kind "${kind}"`);
    }
    // 15 live keys today (LIN-1095's own correction: `bug` is easy to omit).
    assert.ok('bug' in PROMPT_TEMPLATES);
    assert.equal(Object.keys(PROMPT_TEMPLATES).length, 15);
  });

  test('populates the workspace-wide row from dispatchDefaults.model/harness', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });
    assert.match(html, /name="defaultModel"[^>]*value="anthropic\/claude-opus-4\.8"/);
    assert.match(html, /name="defaultHarnessSelect"[^>]*>[\s\S]*?<option value="opencode" selected>/);
  });

  test('a custom (non-suggested) harness value renders in the custom text input, not the select', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { harness: 'my-bespoke-harness' }
    });
    assert.match(html, /name="defaultHarnessCustom"[^>]*value="my-bespoke-harness"/);
    assert.doesNotMatch(html, /<option value="my-bespoke-harness"/);
  });

  test('populates a per-kind override row from dispatchDefaults.byKind', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: {
        byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
      }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 1200);
    assert.match(row, /name="kind__implementation__Model"[^>]*value="anthropic\/claude-sonnet-5"/);
    assert.match(row, /<option value="claude-code" selected>/);
  });

  test('a kind with no override renders blank (inherits workspace default)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', byKind: {} }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 1200);
    assert.match(row, /name="kind__implementation__Model"[^>]*value=""/);
  });

  describe('claude-code default + model suggestions (LIN-1111)', () => {
    test('the workspace-wide row pre-selects claude-code when no harness is configured', () => {
      const html = renderSettingsPage('Acme', BASE);
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 1200);
      assert.match(row, /<option value="claude-code" selected>/);
      assert.doesNotMatch(row, /<option value=""[^>]* selected>/);
    });

    test('an explicitly configured non-default workspace harness still wins over the pre-select', () => {
      const html = renderSettingsPage('Acme', { ...BASE, dispatchDefaults: { harness: 'opencode' } });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 1200);
      assert.match(row, /<option value="opencode" selected>/);
      assert.doesNotMatch(row, /<option value="claude-code" selected>/);
    });

    test('per-kind override rows do NOT pre-select claude-code when blank (blank must keep meaning "inherit")', () => {
      const html = renderSettingsPage('Acme', BASE);
      const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
      const row = html.slice(rowStart, rowStart + 1200);
      assert.doesNotMatch(row, /<option value="claude-code" selected>/);
      assert.match(row, /<option value=""[^>]* selected>/);
    });

    test('renders a shared recommended-models datalist referenced by every model input', () => {
      const html = renderSettingsPage('Acme', BASE);
      assert.match(html, /<datalist id="dispatch-model-suggestions">/);
      assert.match(html, /name="defaultModel"[^>]*list="dispatch-model-suggestions"/);
      assert.match(html, /name="kind__implementation__Model"[^>]*list="dispatch-model-suggestions"/);
    });
  });

  describe('per-type overrides progressive disclosure (LIN-1111)', () => {
    test('collapses the 15 per-kind rows behind a closed <details> when none are configured', () => {
      const html = renderSettingsPage('Acme', BASE);
      const detailsIdx = html.indexOf('<details class="dispatch-kind-overrides">');
      assert.ok(detailsIdx > -1, 'expected a closed <details class="dispatch-kind-overrides">');
      assert.match(html, /data-testid="dispatch-kind-overrides-toggle"/);
    });

    test('auto-expands the <details> when at least one per-kind override is configured', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: { byKind: { implementation: { harness: 'claude-code' } } }
      });
      assert.match(html, /<details class="dispatch-kind-overrides" open>/);
    });
  });

  test('escapes a validation error message when dispatchDefaultsError is set', () => {
    const html = renderSettingsPage('Acme', { ...BASE, dispatchDefaultsError: 'invalid-field' });
    assert.match(html, /1000 characters or less/);
  });

  test('does not render an error line when dispatchDefaultsError is absent', () => {
    const html = renderSettingsPage('Acme', BASE);
    const ddIdx = html.indexOf('data-testid="settings-section-dispatch-defaults"');
    const section = html.slice(ddIdx, ddIdx + 400);
    assert.doesNotMatch(section, /settings-value error/);
  });

  test('the section submits through a single form to the dispatch-defaults route', () => {
    const html = renderSettingsPage('Acme', BASE);
    const formCount = (html.match(/class="settings-form dispatch-defaults-form"/g) || []).length;
    assert.equal(formCount, 1);
    assert.match(html, /action="\/workspace\/acme\/settings\/dispatch-defaults" method="POST"/);
  });

  test('does not throw when dispatchDefaults is omitted', () => {
    assert.doesNotThrow(() => renderSettingsPage('Acme', BASE));
  });
});
