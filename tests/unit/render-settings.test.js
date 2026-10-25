/**
 * Unit tests for render-settings.js — AI usage KPI block (LIN-418)
 *
 * Run with: node --test tests/unit/render-settings.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderAllAreas as renderSettingsPage } from '../helpers/render-settings-areas.js';
import { AVAILABLE_MODELS } from '../../lib/openrouter.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-template-defs.js';
import { getProvider } from '../../lib/providers/registry.js';
// Side-effect import: registers the real Jira provider (LIN-1885), so the
// displayName test below exercises the actual server.js:2173 derivation
// (`getProvider(b.provider)?.ui?.displayName || b.provider`) against a real
// singleton, not a hand-typed stand-in.
import '../../lib/providers/jira/index.js';

const BASE = { urlKey: 'acme', workspaces: [], currentModel: 'openai/gpt-5.4-mini', availableModels: [] };

describe('renderSettingsPage — AI usage section', () => {
  test('always renders the AI usage section header', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-ai-usage"/);
    assert.match(html, /AI calls/);
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
    assert.match(html, />By feature · recommend</);
    assert.match(html, /2 calls · \$0\.0300/);
    assert.match(html, />By feature · brief</);
    assert.match(html, /1 call · \$0\.0050/); // singular "call"
    assert.match(html, />Last call</);
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

  test('renders latency rows and the SSE/keepalive caveat when latencyByFeatureModel is populated', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      llmStats: {
        totalCalls: 3,
        totalCost: 0.035,
        totalTokens: 12345,
        byFeature: [{ feature: 'recommend', calls: 3, cost: 0.035 }],
        latencyByFeatureModel: [
          { feature: 'recommend', model: 'openai/gpt-5.4-mini', count: 2, p50Ms: 1200, p90Ms: 1800, maxMs: 2000 },
          { feature: 'brief', model: 'anthropic/claude-opus-5', count: 1, p50Ms: 500, p90Ms: 500, maxMs: 500 }
        ]
      }
    });
    assert.match(html, />recommend · openai\/gpt-5\.4-mini</);
    assert.match(html, /2 calls · p50 1200ms · p90 1800ms · max 2000ms/);
    assert.match(html, />brief · anthropic\/claude-opus-5</);
    assert.match(html, /1 call · p50 500ms · p90 500ms · max 500ms/); // singular "call"
    assert.match(html, /end-to-end response time/);
    assert.match(html, /not time-to-first-token/);
    assert.match(html, /SSE lanes/);
  });

  test('renders no latency node or caveat when latencyByFeatureModel is absent or empty', () => {
    const base = {
      totalCalls: 1,
      totalCost: 0.01,
      totalTokens: 100,
      byFeature: [{ feature: 'recommend', calls: 1, cost: 0.01 }]
    };
    const htmlAbsent = renderSettingsPage('Acme', { ...BASE, llmStats: base });
    assert.doesNotMatch(htmlAbsent, /data-testid="settings-health-latency"|not time-to-first-token/);
    assert.doesNotMatch(htmlAbsent, /end-to-end response time/);

    const htmlEmpty = renderSettingsPage('Acme', { ...BASE, llmStats: { ...base, latencyByFeatureModel: [] } });
    assert.doesNotMatch(htmlEmpty, /not time-to-first-token/);
    assert.doesNotMatch(htmlEmpty, /end-to-end response time/);
  });
});

describe('renderSettingsPage — provider context disclosure (LIN-2357)', () => {
  const BASIS = 'recommend-path traces only; deterministic prompt generations (prompt template downloads, kind-override recommend, feedback triage) are not traced';

  test('renders an empty state when providerContextSummary is omitted', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, />Provider context</);
    assert.match(html, /no prompt traces recorded yet/);
  });

  test('renders an empty state for the empty-constant shape (traces: 0)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerContextSummary: { traces: 0, untracedContext: 0, divergent: 0, benign: 0, newestUntracedContextAt: null, expectedDisplayName: null, basis: BASIS }
    });
    assert.match(html, /no prompt traces recorded yet/);
    assert.match(html, new RegExp(BASIS.slice(0, 30)));
  });

  test('a divergent-count render surfaces the divergent number distinctly from benign', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerContextSummary: {
        traces: 10, untracedContext: 3, divergent: 2, benign: 1,
        newestUntracedContextAt: '2026-08-20T12:00:00.000Z',
        expectedDisplayName: 'GitHub Issues', basis: BASIS
      }
    });
    assert.match(html, /3 of 10 traces missing/);
    assert.match(html, /2 divergent/);
    assert.match(html, /1 benign/);
    assert.match(html, />Most recent untraced</);
    assert.doesNotMatch(html, /2026-08-20T12:00:00/, 'a raw UTC stamp is not shown (LIN-3890)');
  });

  test('a benign-only (Linear) render does not read as an alarm: zero divergent, still states the count', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerContextSummary: {
        traces: 5, untracedContext: 5, divergent: 0, benign: 5,
        newestUntracedContextAt: '2026-08-20T12:00:00.000Z',
        expectedDisplayName: 'Linear', basis: BASIS
      }
    });
    assert.match(html, /5 of 5 traces missing/);
    assert.match(html, /0 divergent/);
    assert.match(html, /5 benign/);
  });

  test('newestUntracedContextAt renders only when untracedContext > 0', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerContextSummary: {
        traces: 4, untracedContext: 0, divergent: 0, benign: 0,
        newestUntracedContextAt: null, expectedDisplayName: 'Linear', basis: BASIS
      }
    });
    assert.match(html, /0 of 4 traces missing/);
    assert.doesNotMatch(html, />Most recent untraced</);
  });

  test('does not throw when providerContextSummary is omitted', () => {
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
    // LIN-3846: sources are labelled as yours (they follow the account, not everyone).
    assert.match(html, /Yours/);
    assert.match(html, /Sources are yours/);
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
    assert.match(html, /<span class="settings-row-label">Linear</);
    // Masked token: only last 4 chars shown, secret hidden.
    assert.match(html, /••••9999/);
    assert.doesNotMatch(html, /lin_api_secret9999/);
    // Action forms present.
    assert.match(html, /settings-provider-remove/);
    assert.match(html, /settings-provider-refresh/);
    // Active marker.
    assert.match(html, /data-testid="settings-provider-active"/);
  });

  test('marks only the active binding', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'aaaabbbb', active: true },
        { provider: 'github', scope: 'owner/repo', displayName: 'GitHub', token: 'ccccdddd', active: false },
      ],
    });
    const activeCount = (html.match(/data-testid="settings-provider-active"/g) || []).length;
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
    // The row opens in place (LIN-3890), so the switch sits inside the github row's body.
    assert.match(ghRow.slice(0, ghRow.indexOf('</details>')), /settings-provider-activate/);
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

  test('offers a working add affordance for Jira (unblocked, LIN-1885)', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-provider-add-jira"/);
    assert.match(html, /<span class="settings-row-label">Jira</);
  });

  // LIN-1885 research: server.js:2173 resolves a bound row's displayName via
  // `getProvider(b.provider)?.ui?.displayName || b.provider` — a DIFFERENT
  // source than KNOWN_ADD_PROVIDERS' static displayName above. Without the
  // JiraProvider.ui override (LIN-1885 beat 1), that expression falls back to
  // the bare `b.provider` string and a bound Jira workspace renders lowercase
  // `jira:` instead of `Jira:`. This exercises the REAL registered provider,
  // not a hand-typed displayName, so it would catch the override being
  // removed or the fallback silently kicking in again.
  test('a bound Jira binding row renders "Jira", not lowercase "jira" (the displayName trap)', () => {
    const jiraDisplayName = getProvider('jira')?.ui?.displayName || 'jira';
    assert.equal(jiraDisplayName, 'Jira', 'sanity: the real provider must actually override ui.displayName');

    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerBindings: [
        { provider: 'jira', scope: 'https://acme.atlassian.net', displayName: jiraDisplayName, token: 'fake_jira_api_token1234', active: true },
      ],
    });
    assert.match(html, /<span class="settings-row-label">Jira</);
    assert.doesNotMatch(html, /settings-row-label">jira</, 'must never render the lowercase machine name as the visible label');
  });

  test('GitHub add affordances default to enabled when githubEnabled is omitted (LIN-761)', () => {
    // Backward-compatible default: omitting the flag keeps the live add buttons,
    // so existing callers/output are unchanged.
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /GitHub is not configured on this server/);
  });

  test('lists no GitHub add row when githubEnabled is false, and says nothing about it (LIN-761, LIN-3890 outcome 1)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: false });
    // Sources lists only what this server can add (LIN-3890): an unconfigured GitHub row is absent,
    // not a blocked row. Linear is NOT gated by the GitHub config flag (LIN-1351), so it stays listed.
    assert.doesNotMatch(html, /data-testid="settings-provider-add-github"/);
    assert.doesNotMatch(html, /data-testid="settings-provider-add-github-projects"/);
    assert.doesNotMatch(html, /GitHub is not configured on this server/);
    assert.match(html, /data-testid="settings-provider-add-linear"/);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /blocked on LIN-541/);
  });

  test('keeps the GitHub add affordances live when githubEnabled is true (LIN-761)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    assert.match(html, /data-testid="settings-provider-add-github"/);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /GitHub is not configured on this server/);
  });

  test('renders a LIVE Linear add-source affordance with honest copy (LIN-1351)', () => {
    const html = renderSettingsPage('Acme', BASE);
    // Linear add-source is live: the row renders a real "add" form (POSTing to the
    // providers/add action → /auth/linear?mode=add-source), NOT the LIN-544 stopgap.
    assert.match(html, /data-testid="settings-provider-add-linear"/);
    assert.match(html, /settings-provider-add-btn/);
    assert.doesNotMatch(html, /blocked on LIN-544/);
    // Honest copy: "+ Linear" connects another organization as its own workspace,
    // not a source onto THIS workspace (unlike GitHub).
    assert.match(html, /connects another Linear organization as its own workspace/);
    assert.match(html, /data-testid="settings-provider-add-hint-linear"/);
  });

  // LIN-2803: every unblocked provider that declares an addProvider row gets
  // an honest hint — a SWEEP over the class, not a per-provider pin alone, so
  // a future provider that forgets to declare (or default) one fails this.
  test('every unblocked add-source row renders a non-empty add-hint (LIN-2803 sweep)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    for (const name of ['linear', 'github', 'github-projects', 'jira']) {
      const re = new RegExp(`data-testid="settings-provider-add-hint-${name}">([^<]+)<`);
      const match = html.match(re);
      assert.ok(match, `expected a non-empty add-hint for ${name}`);
      assert.ok(match[1].trim().length > 0, `expected non-empty hint text for ${name}`);
    }
  });

  test('GitHub/GitHub Projects/Jira default to the shared bind-onto-this-workspace hint (LIN-2803)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    const defaultHintCount = (html.match(/adds a source onto this workspace/g) || []).length;
    // github, github-projects, jira — three rows sharing the one default; Linear
    // keeps its own override text and must not pick up the default too.
    assert.strictEqual(defaultHintCount, 3);
    assert.match(html, /data-testid="settings-provider-add-hint-github">adds a source onto this workspace</);
    assert.match(html, /data-testid="settings-provider-add-hint-github-projects">adds a source onto this workspace</);
    assert.match(html, /data-testid="settings-provider-add-hint-jira">adds a source onto this workspace</);
  });

  test('a blocked GitHub row still renders no hint at all (early return, unaffected by the new default)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: false });
    // configBlocked rows return before addHintHtml is computed — no hint span,
    // default or otherwise, ever reaches a blocked row.
    assert.doesNotMatch(html, /data-testid="settings-provider-add-hint-github"/);
  });

  test('the GitHub row offers the "as a new workspace" verb as a plain link, gated honest (LIN-2803)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    assert.match(html, /data-testid="settings-provider-new-workspace-github"/);
    // A link, never a button/form — must not perturb the pinned button counts.
    // LIN-3125 Phase 3 (F1): the explicit "as a new workspace" verb now carries
    // the opt-in held-entry marker (this literal update is the deliberate,
    // approved one named in the plan §1).
    const anchorMatch = html.match(/<a href="\/auth\/github\?heldConnection=1"[^>]*data-testid="settings-provider-new-workspace-github"[^>]*>as a new workspace<\/a>/);
    assert.ok(anchorMatch, 'expected the new-workspace verb anchor to carry the held-entry marker (LIN-3125 F1)');
  });

  test('Jira and Linear never render a new-workspace verb (LIN-2803 — Jira withheld pending LIN-2819, Linear already creates one)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    assert.doesNotMatch(html, /settings-provider-new-workspace-jira/);
    assert.doesNotMatch(html, /settings-provider-new-workspace-linear/);
  });

  test('github-projects (no entryCta) never renders a new-workspace verb', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: true });
    assert.doesNotMatch(html, /settings-provider-new-workspace-github-projects/);
  });

  test('shows an empty state when there are no bindings', () => {
    const html = renderSettingsPage('Acme', { ...BASE, providerBindings: [] });
    assert.match(html, /settings-provider-empty/);
    assert.match(html, /none yet/);
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

  // LIN-2803: the post-bind notice's "make active" affordance reuses the
  // EXACT switchAction POST form every per-binding row already renders — a
  // second, distinct testid so both can coexist without ambiguity when the
  // just-added binding is also the page's one inactive row.
  test('a notice with `activate` renders the reused switch form (LIN-2803)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerNotice: {
        type: 'ok',
        text: 'github credentials are valid.',
        activate: { provider: 'github', scope: 'octo/repo' },
      },
    });
    assert.match(html, /data-testid="settings-provider-notice-activate"/);
    const noticeBlock = html.slice(html.indexOf('data-testid="settings-provider-notice"'));
    const formEnd = noticeBlock.indexOf('</form>');
    const form = noticeBlock.slice(0, formEnd);
    assert.match(form, /action="\/workspace\/acme\/settings\/providers\/switch" method="POST"/);
    assert.match(form, /<input type="hidden" name="provider" value="github">/);
    assert.match(form, /<input type="hidden" name="scope" value="octo\/repo">/);
  });

  test('a notice with no `activate` renders no activate form at all (LIN-2803 — e.g. a Linear-sourced flash)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      providerNotice: { type: 'ok', text: 'linear credentials are valid.' },
    });
    assert.match(html, /data-testid="settings-provider-notice"/);
    assert.doesNotMatch(html, /settings-provider-notice-activate/);
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
    assert.match(html, /class="settings-form settings-row-form"/);
    // The provider binding row must not expose the data-feature toggle hook.
    const bindingRow = html.slice(html.indexOf('settings-provider-binding'));
    const rowEnd = bindingRow.indexOf('</div>\n          </div>');
    assert.doesNotMatch(bindingRow.slice(0, rowEnd > 0 ? rowEnd : 600), /data-feature=/);
  });
});

describe('renderSettingsPage — Dispatch defaults section (LIN-1095)', () => {
  test('always renders the section header as a sibling of the AI Model section', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-dispatch-defaults"/);
    assert.match(html, />Dispatch defaults</);
    // Two independent <section> blocks, not one nested inside the other.
    const aiModelIdx = html.indexOf('data-testid="settings-section-ai-model"');
    const ddIdx = html.indexOf('data-testid="settings-section-dispatch-defaults"');
    const aiModelSectionEnd = html.indexOf('</section>', aiModelIdx);
    assert.ok(aiModelIdx > -1 && ddIdx > -1 && aiModelSectionEnd > -1);
    assert.ok(ddIdx > aiModelSectionEnd, 'dispatch-defaults section must not be nested inside the AI Model section');
  });

  test('renders one row for the workspace-wide default plus one per live PROMPT_TEMPLATES key', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="dispatch-default-row-default"/);
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      assert.match(html, new RegExp(`data-testid="dispatch-default-row-${kind}"`), `missing row for kind "${kind}"`);
    }
    // 17 live keys today (LIN-1095's own correction: `bug` is easy to omit; LIN-2261 added retrospective-audit).
    assert.ok('bug' in PROMPT_TEMPLATES);
    assert.equal(Object.keys(PROMPT_TEMPLATES).length, 17);
  });

  test('renders an autopilot override row (LIN-1278) and populates it from dispatchDefaults.byKind', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: {
        byKind: { autopilot: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
      }
    });
    assert.match(html, /data-testid="dispatch-default-row-autopilot"/, 'expected an autopilot per-type override row');
    const rowStart = html.indexOf('data-testid="dispatch-default-row-autopilot"');
    const row = html.slice(rowStart, rowStart + 3000);
    // The stored model (an OpenCode curated id) isn't in the claude-code row's
    // preset-only option set, so it degrades onto the `other…` escape hatch
    // (HARD RULE 2/3) rather than being silently dropped.
    assert.match(row, /name="kind__autopilot__Model"[^>]*>[\s\S]*?<option value="__other__" selected>/);
    assert.match(row, /class="dispatch-model-input-other"[^>]*value="anthropic\/claude-sonnet-5"/);
    assert.match(row, /<option value="claude-code" selected>/);
  });

  test('populates the workspace-wide row from dispatchDefaults.model/harness', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });
    // A curated OpenCode id, on an opencode row, IS reachable via the select.
    assert.match(html, /name="defaultModel"[^>]*>[\s\S]*?<option value="anthropic\/claude-opus-4\.8" selected>/);
    assert.match(html, /name="defaultHarnessSelect"[^>]*>[\s\S]*?<option value="opencode" selected>/);
  });

  // LIN-2616 G2 — the workspace-wide row is the one row that MAY pre-select
  // (harness only); it must still render a stored effort value like model.
  test('populates the workspace-wide row from dispatchDefaults.effort (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { effort: 'high' }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="defaultEffort"[^>]*value="high"/);
  });

  test('LIN-1282: the free-text custom harness input is gone; only the two-harness select remains', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.doesNotMatch(html, /name="defaultHarnessCustom"/);
    assert.doesNotMatch(html, /class="harness-input"/);
    assert.doesNotMatch(html, /kind__implementation__HarnessCustom/);
    // The select still offers exactly the two real harnesses.
    assert.match(html, /<option value="claude-code"/);
    assert.match(html, /<option value="opencode"/);
  });

  test('LIN-1282: a legacy custom (non-suggested) harness value is dropped — no custom input holds it and no real harness is pre-selected', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { harness: 'my-bespoke-harness' }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
    const row = html.slice(rowStart, rowStart + 3000);
    // The custom value has nowhere to live in the dispatch-defaults control anymore.
    assert.doesNotMatch(row, /my-bespoke-harness/);
    // Neither real harness is marked selected — the select falls to its blank default.
    assert.doesNotMatch(row, /<option value="claude-code" selected>/);
    assert.doesNotMatch(row, /<option value="opencode" selected>/);
  });

  test('populates a per-kind override row from dispatchDefaults.byKind', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: {
        byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
      }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 3000);
    // Same escape-hatch degradation as the autopilot row above.
    assert.match(row, /name="kind__implementation__Model"[^>]*>[\s\S]*?<option value="__other__" selected>/);
    assert.match(row, /class="dispatch-model-input-other"[^>]*value="anthropic\/claude-sonnet-5"/);
    assert.match(row, /<option value="claude-code" selected>/);
  });

  // LIN-2616 (L5) — the per-kind row's own effort input renders a stored
  // byKind effort value, mirroring model/harness.
  test('populates a per-kind override row from dispatchDefaults.byKind effort (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: {
        byKind: { implementation: { effort: 'xhigh' } }
      }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="kind__implementation__Effort"[^>]*value="xhigh"/);
  });

  test('a kind with no override renders blank (inherits workspace default)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', byKind: {} }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="kind__implementation__Model"[^>]*>\s*<option value="" selected>/);
  });

  // LIN-2616 (L5) — blank-by-construction (LIN-1747): a per-kind row's effort
  // control must render blank even when the WORKSPACE-WIDE effort is set —
  // never inherit visually into the per-kind control, which would make the
  // next save write it as an explicit 18-kind override.
  test('a kind with no effort override renders blank even when the workspace-wide effort is set (LIN-2616, LIN-1747)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchDefaults: { effort: 'high', byKind: {} }
    });
    const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="kind__implementation__Effort"[^>]*value=""/);
  });

  describe('claude-code default + model suggestions (LIN-1111)', () => {
    test('the workspace-wide row pre-selects claude-code when no harness is configured', () => {
      const html = renderSettingsPage('Acme', BASE);
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      const harnessSelectStart = row.indexOf('class="harness-select"');
      const harnessSelectEnd = row.indexOf('</select>', harnessSelectStart);
      const harnessSelect = row.slice(harnessSelectStart, harnessSelectEnd);
      assert.match(harnessSelect, /<option value="claude-code" selected>/);
      assert.doesNotMatch(harnessSelect, /<option value=""[^>]* selected>/);
      // The MODEL select is a separate control — HARD RULE 1 (LIN-2719) says
      // it must never pre-select even on this row, only the blank/"— none —"
      // option, unlike the harness select above.
      const modelSelectStart = row.indexOf('class="dispatch-model-input"');
      const modelSelectEnd = row.indexOf('</select>', modelSelectStart);
      const modelSelect = row.slice(modelSelectStart, modelSelectEnd);
      assert.match(modelSelect, /<option value="" selected>— none —<\/option>/);
    });

    test('an explicitly configured non-default workspace harness still wins over the pre-select', () => {
      const html = renderSettingsPage('Acme', { ...BASE, dispatchDefaults: { harness: 'opencode' } });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      assert.match(row, /<option value="opencode" selected>/);
      assert.doesNotMatch(row, /<option value="claude-code" selected>/);
    });

    test('per-kind override rows do NOT pre-select claude-code when blank (blank must keep meaning "inherit")', () => {
      const html = renderSettingsPage('Acme', BASE);
      const rowStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
      const row = html.slice(rowStart, rowStart + 3000);
      assert.doesNotMatch(row, /<option value="claude-code" selected>/);
      assert.match(row, /<option value=""[^>]* selected>/);
    });

    // RETIRE (LIN-2719): "every model input names both datalists via
    // data-model-list-claude/-opencode" had no successor to migrate to — a
    // <select> has no `list` attribute, so there's no id-naming subject left.
    // The BEHAVIOUR it guarded (harness-aware option content) survives via
    // the tests below, which assert the option sets directly.

    // RE-EXPRESS (LIN-2719 migration table #1/#3): the page-level datalists
    // are gone — each row now builds its own inline option set — so this
    // asserts the same harness-scoped content directly on a row's <select>.
    test('a claude-code row offers only its own preset option set; an opencode row offers the curated+catalog one (LIN-1282)', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: {
          harness: 'claude-code',
          byKind: { implementation: { harness: 'opencode' } }
        }
      });
      const defStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const defSelectStart = html.indexOf('class="dispatch-model-input"', defStart);
      const defSelect = html.slice(defSelectStart, html.indexOf('</select>', defSelectStart));
      assert.match(defSelect, /<option value="opus">/);
      assert.doesNotMatch(defSelect, /<option value="openai\/gpt-5\.4-mini">/);

      const implStart = html.indexOf('data-testid="dispatch-default-row-implementation"');
      const implSelectStart = html.indexOf('class="dispatch-model-input"', implStart);
      const implSelect = html.slice(implSelectStart, html.indexOf('</select>', implSelectStart));
      assert.match(implSelect, /<option value="openai\/gpt-5\.4-mini">/);
      assert.doesNotMatch(implSelect, /<option value="opus">/);
    });

    test('LIN-1282/LIN-1763: a claude-code row offers exactly the four presets (haiku/sonnet/opus/fable), no catalog', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchModelCatalog: [{ id: 'mock-provider/catalog-model-one', name: 'Catalog Model One' }]
      });
      // The workspace-default row pre-selects claude-code (LIN-1111) when unconfigured.
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      const selectStart = row.indexOf('class="dispatch-model-input"');
      const selectEnd = row.indexOf('</select>', selectStart);
      const select = row.slice(selectStart, selectEnd);
      // blank + 4 presets + other… = 6 total options — an exact count, not a
      // brittle bare number, backed by the id-specific assertions below.
      assert.equal((select.match(/<option/g) || []).length, 6);
      assert.match(select, /<option value="haiku">/);
      assert.match(select, /<option value="sonnet">/);
      assert.match(select, /<option value="opus">/);
      assert.match(select, /<option value="fable">/);
      // The live catalog is never merged into the Claude option set.
      assert.doesNotMatch(select, /catalog-model-one/);
      assert.doesNotMatch(select, /openai\/gpt-5\.4-mini/);
    });

    test('with no dispatchModelCatalog, an opencode row offers only the 10 curated suggestions (plus blank/other)', () => {
      const html = renderSettingsPage('Acme', { ...BASE, dispatchDefaults: { harness: 'opencode' } });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      const selectStart = row.indexOf('class="dispatch-model-input"');
      const selectEnd = row.indexOf('</select>', selectStart);
      const select = row.slice(selectStart, selectEnd);
      // blank + 10 curated + other… = 12 total options.
      assert.equal((select.match(/<option/g) || []).length, 12);
    });

    test('LIN-1111 Session 2: merges the live OpenRouter catalog into an opencode row\'s model option set', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: { harness: 'opencode' },
        dispatchModelCatalog: [{ id: 'mock-provider/catalog-model-one', name: 'Catalog Model One' }]
      });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      assert.match(row, /<option value="mock-provider\/catalog-model-one"[^>]*>Catalog Model One<\/option>/);
      // Still lists every curated suggestion too — supplement, not replace.
      assert.match(row, /<option value="openai\/gpt-5\.4-mini">/);
    });

    // LIN-2719 S0/S1: a $0-priced catalog entry carries a `data-free` marker
    // into the option (never option text — render-settings.js:1141-1143's
    // ratified convention).
    test('a free catalog model carries a data-free marker on its option', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: { harness: 'opencode' },
        dispatchModelCatalog: [
          { id: 'mock-provider/free-model', name: 'Free Model', pricing: { prompt: '0', completion: '0' } },
          { id: 'mock-provider/priced-model', name: 'Priced Model', pricing: { prompt: '0.00001', completion: '0.00002' } }
        ]
      });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      assert.match(row, /<option value="mock-provider\/free-model" data-free="true">/);
      assert.doesNotMatch(row, /<option value="mock-provider\/priced-model"[^>]*data-free/);
    });

    test('LIN-1111 Session 2: de-dupes a catalog entry that collides with a curated suggestion', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: { harness: 'opencode' },
        dispatchModelCatalog: [{ id: 'openai/gpt-5.4-mini', name: 'duplicate of a curated suggestion' }]
      });
      const rowStart = html.indexOf('data-testid="dispatch-default-row-default"');
      const row = html.slice(rowStart, rowStart + 3000);
      const selectStart = row.indexOf('class="dispatch-model-input"');
      const selectEnd = row.indexOf('</select>', selectStart);
      const select = row.slice(selectStart, selectEnd);
      // Count OPTION tags, not raw substring occurrences — a curated id's
      // label equals its id, so a single <option value="x">x</option> tag
      // legitimately contains the string twice.
      const occurrences = (select.match(/<option value="openai\/gpt-5\.4-mini"/g) || []).length;
      assert.equal(occurrences, 1);
    });
  });

  describe('per-type overrides progressive disclosure (LIN-1111)', () => {
    test('collapses the 17 per-kind rows behind a closed <details> when none are configured', () => {
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

    // LIN-2616 — the widened hasKindOverride gate: an effort-only per-kind
    // override (no model/harness) must still auto-expand the details block,
    // or a saved effort override is silently hidden behind a closed panel.
    test('auto-expands the <details> when the only per-kind override is an effort (LIN-2616)', () => {
      const html = renderSettingsPage('Acme', {
        ...BASE,
        dispatchDefaults: { byKind: { implementation: { effort: 'low' } } }
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

describe('renderSettingsPage — Dispatch presets section (LIN-1391 S7)', () => {
  test('always renders the section header as a sibling of Dispatch defaults, not nested inside it', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-dispatch-presets"/);
    assert.match(html, />Dispatch presets</);
    const ddIdx = html.indexOf('data-testid="settings-section-dispatch-defaults"');
    const ddSectionEnd = html.indexOf('</section>', ddIdx);
    const dpIdx = html.indexOf('data-testid="settings-section-dispatch-presets"');
    assert.ok(ddIdx > -1 && ddSectionEnd > -1 && dpIdx > -1);
    assert.ok(dpIdx > ddSectionEnd, 'dispatch-presets section must not be nested inside dispatch-defaults');
  });

  test('shows an empty state when there are no saved presets', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="dispatch-presets-empty"/);
    assert.match(html, />No saved presets yet</);
  });

  test('renders one row per saved preset, populated from its name/config', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [
        { id: 'p1', name: 'Claude preset', config: { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' } },
        { id: 'p2', name: 'OpenCode preset', config: { harness: 'opencode' } }
      ]
    });
    assert.doesNotMatch(html, /data-testid="dispatch-presets-empty"/);

    const p1Start = html.indexOf('data-testid="dispatch-preset-item-p1"');
    const p1 = html.slice(p1Start, p1Start + 3000);
    assert.match(p1, /class="dispatch-preset-name-input"[^>]*value="Claude preset"/);
    // A curated OpenCode id on a claude-code row isn't in that row's preset-only
    // option set, so it degrades onto the escape hatch (HARD RULE 2/3).
    assert.match(p1, /name="preset__p1__Model"[^>]*>[\s\S]*?<option value="__other__" selected>/);
    assert.match(p1, /class="dispatch-model-input-other"[^>]*value="anthropic\/claude-opus-4\.8"/);
    assert.match(p1, /<option value="claude-code" selected>/);
    assert.match(p1, /data-preset-id="p1"/);

    const p2Start = html.indexOf('data-testid="dispatch-preset-item-p2"');
    const p2 = html.slice(p2Start, p2Start + 3000);
    assert.match(p2, /class="dispatch-preset-name-input"[^>]*value="OpenCode preset"/);
    assert.match(p2, /name="preset__p2__Model"[^>]*>\s*<option value="" selected>/);
    assert.match(p2, /<option value="opencode" selected>/);
  });

  // LIN-2616 (L4/L5) — a preset's stored top-level `effort` must render on
  // its config row, or the value the client posted and the store accepted
  // is invisible on reload.
  test('renders a preset\'s stored top-level effort (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'Effort preset', config: { model: 'm1', effort: 'high' } }]
    });
    const rowStart = html.indexOf('data-testid="dispatch-preset-item-p1"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="preset__p1__Effort"[^>]*value="high"/);
  });

  test('a preset with no stored effort renders the top-level effort input blank (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'No effort', config: { model: 'm1' } }]
    });
    const rowStart = html.indexOf('data-testid="dispatch-preset-item-p1"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.match(row, /name="preset__p1__Effort"[^>]*value=""/);
  });

  test('a preset with a blank harness does NOT pre-select claude-code — blank must stay meaningfully blank', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'Blank harness preset', config: { model: 'anthropic/claude-opus-4.8' } }]
    });
    const rowStart = html.indexOf('data-testid="dispatch-preset-item-p1"');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.doesNotMatch(row, /<option value="claude-code" selected>/);
    assert.doesNotMatch(row, /<option value="opencode" selected>/);
    assert.match(row, /<option value=""[^>]* selected>/);
  });

  test('the "new preset" row never pre-selects claude-code either (LIN-1111 hazard applies here too)', () => {
    const html = renderSettingsPage('Acme', BASE);
    const rowStart = html.indexOf('data-testid="dispatch-preset-new-row"');
    assert.ok(rowStart > -1, 'expected a new-preset config row');
    const row = html.slice(rowStart, rowStart + 3000);
    assert.doesNotMatch(row, /<option value="claude-code" selected>/);
    assert.match(row, /<option value=""[^>]* selected>/);
  });

  // RE-EXPRESS (LIN-2719): no shared page-level datalist any more — the
  // preset row builds its own harness-scoped option set the same way a
  // dispatch-defaults row does.
  test('each preset config row builds its own harness-aware model option set (LIN-1282)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'Claude preset', config: { harness: 'claude-code' } }]
    });
    const rowStart = html.indexOf('data-testid="dispatch-preset-item-p1"');
    const row = html.slice(rowStart, rowStart + 3000);
    const selectStart = row.indexOf('name="preset__p1__Model"');
    const selectEnd = row.indexOf('</select>', selectStart);
    const select = row.slice(selectStart, selectEnd);
    assert.match(select, /<option value="opus">/);
    assert.doesNotMatch(select, /<option value="openai\/gpt-5\.4-mini">/);
  });

  test('loads /settings.js so the preset CRUD handlers are wired', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /<script src="\/settings\.js">/);
  });

  test('does not throw when dispatchPresets is omitted', () => {
    assert.doesNotThrow(() => renderSettingsPage('Acme', BASE));
  });
});

describe('renderSettingsPage — areas and their groups (LIN-3846, replaces the LIN-1399 User/Workspace split)', () => {
  // Where a control lives is per area now: a page per area, grouped in the sidebar as the
  // workspace and "You". The sidebar is on every page.
  const page = (area, extra = {}) => renderSettingsPage('Acme', { ...BASE, area, ...extra });

  test('the sidebar lists every area in two groups on every page (the workspace group is titled with its name, LIN-3890)', () => {
    const html = page('account');
    assert.match(html, />Acme</);
    assert.match(html, />You</);
    for (const id of ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account']) {
      assert.match(html, new RegExp(`data-testid="settings-nav-${id}"`), `nav row for ${id}`);
    }
  });

  test('each surviving section testid lands on its own area page', () => {
    const expectations = {
      'settings-section-providers': 'sources',
      'settings-section-ai-model': 'models',
      'settings-section-dispatch-defaults': 'models',
      'settings-section-dispatch-presets': 'models',
      'settings-section-ai-usage': 'health',
      'settings-section-workspace-features': 'running',
      'settings-section-account': 'account',
      'settings-section-workflow': 'features',
      'settings-section-experimental': 'features',
    };
    for (const [testid, area] of Object.entries(expectations)) {
      assert.match(page(area), new RegExp(`data-testid="${testid}"`), `${testid} on ${area}`);
      const others = ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account'].filter(a => a !== area);
      for (const other of others) {
        assert.doesNotMatch(page(other), new RegExp(`data-testid="${testid}"`), `${testid} must not also be on ${other}`);
      }
    }
  });

  test('the OpenRouter connection control is on Account (account-owned, LIN-1331)', () => {
    assert.match(page('account', { openRouterSource: 'oauth' }), /disconnect/);
    assert.doesNotMatch(page('sources', { openRouterSource: 'oauth' }), /action="\/auth\/openrouter\/disconnect"/);
  });

  test('the roadmap switch is on Features', () => {
    assert.match(page('features'), /data-testid="settings-toggle-roadmap"/);
  });

  test('the proxy model-routing writes setting is on Agent access, off by default, and asks why (LIN-3854, LIN-3846)', () => {
    const off = page('agent-access');
    assert.match(off, /data-testid="settings-toggle-modelRoutingProxyWrites"/);
    assert.match(off, /Agents can change models/);
    assert.match(off, /name="feature" value="modelRoutingProxyWrites"/);
    assert.match(off, /name="enabled" value="true"/);
    assert.match(off, /name="reason"/);
    assert.match(off, /data-testid="settings-modelRoutingProxyWrites-state"[^>]*>[\s\S]*?Off/);
    const on = page('agent-access', { workspaceFeatures: { modelRoutingProxyWrites: true } });
    assert.match(on, /name="enabled" value="false"/);
    assert.match(on, /data-testid="settings-modelRoutingProxyWrites-state"[^>]*>[\s\S]*?On/);
    for (const other of ['sources', 'models', 'running', 'features', 'account']) assert.doesNotMatch(page(other), /settings-toggle-modelRoutingProxyWrites/);
  });

  // RETIRE (LIN-2719 S2, F4): this guard protected a forward id reference —
  // the two page-level `<datalist>`s were emitted inside the Dispatch-defaults
  // section and referenced by `list="…"` (by id) from preset rows rendered
  // later, and HTML resolves `list=` by document id, so source order mattered.
  // Under the select-per-row rewrite each row builds its own inline option
  // set from `dispatchModelOptionSetFor` — there is no shared datalist, no id
  // reference, and therefore no ordering dependency; a test that would pass
  // for either order is not a guard. The coverage that matters is elsewhere:
  // both sections' group membership and presence are already asserted below
  // ("every settings section lands in its correct group") and in the
  // Dispatch presets describe block ("always renders the section header as a
  // sibling of Dispatch defaults, not nested inside it").

  test('does not invent a Theme control on the settings page', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.doesNotMatch(html, /data-testid="settings-(section|toggle)-theme"/i);
  });
});

describe('renderSettingsPage — OpenRouter unattended-use consent (LIN-2412)', () => {
  test('oauth + no consent: shows the not-enabled status and an enable form posting to /auth/openrouter/consent, plus the blast-radius notice', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'oauth', openRouterConsentedAt: null });
    assert.match(html, /data-testid="settings-openrouter-consent-status"[^>]*>○ not enabled/);
    assert.match(html, /action="\/auth\/openrouter\/consent" method="POST"/);
    assert.match(html, /data-testid="settings-openrouter-consent-grant"/);
    assert.match(html, /data-testid="settings-openrouter-consent-notice"/);
    assert.match(html, /unattended work in every workspace/);
  });

  test('oauth + granted consent: shows the enabled status, no grant form, connection status locator stays single-match', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'oauth', openRouterConsentedAt: '2026-08-01T00:00:00.000Z' });
    assert.match(html, /data-testid="settings-openrouter-consent-status"[^>]*>✓ enabled/);
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-grant"/);
    // openrouter-auth.spec.js locates the connection status by its test id alone — the consent
    // badge must never also carry that test id.
    const connectedMatches = html.match(/data-testid="settings-openrouter-status">● connected</g) || [];
    assert.equal(connectedMatches.length, 1, 'exactly one OpenRouter status reads connected — the connection status, not the consent badge');
  });

  test('LIN-3846: granted consent can be turned off without disconnecting, and says what reads it', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'oauth', openRouterConsentedAt: '2026-10-01T00:00:00.000Z' });
    assert.match(html, /action="\/auth\/openrouter\/consent\/clear" method="POST"/);
    assert.match(html, /data-testid="settings-openrouter-consent-clear"/);
    assert.match(html, /15-minute observer pass/);
    // the connection stays: disconnect is a separate form
    assert.match(html, /action="\/auth\/openrouter\/disconnect"/);
  });

  test('LIN-3846: not-yet-granted consent offers the grant, not the clear', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'oauth' });
    assert.doesNotMatch(html, /consent\/clear/);
  });

  test('LIN-3846: the free tier says the limit is on new runs, resets at midnight UTC, and prompts are not limited', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'free' });
    assert.match(html, /new runs per account per UTC day/);
    assert.match(html, /midnight UTC/);
    assert.match(html, /prompts are not limited/);
  });

  test('not connected: connect link is present alongside the blast-radius notice (no consent grant form — there is no key yet)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: null });
    assert.match(html, /data-testid="settings-openrouter-connect"/);
    assert.match(html, /data-testid="settings-openrouter-consent-notice"/);
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-grant"/);
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-status"/);
  });

  test('free tier: connect-for-unlimited link is present alongside the blast-radius notice', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'free' });
    assert.match(html, /connect for unlimited/);
    assert.match(html, /data-testid="settings-openrouter-consent-notice"/);
  });

  test('free tier: the usage slot is the runs-per-day allowance, not a daily prompt quota (LIN-3239)', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'free' });
    // The attribute path is kept (app.js fills it); only the content changed.
    assert.match(html, /data-free-tier-status/);
    assert.match(html, /data-free-tier-usage/);
    assert.match(html, />Runs</, 'the slot is labelled as the run allowance');
    assert.doesNotMatch(html, /daily prompt|prompts remaining/, 'no daily prompt quota wording');
  });

  test('env source: no consent affordance and no blast-radius notice — there is no per-account durable key to consent for', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'env' });
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-status"/);
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-grant"/);
    assert.doesNotMatch(html, /data-testid="settings-openrouter-consent-notice"/);
  });

  test('defaults to not-enabled when openRouterConsentedAt is omitted entirely (a caller that forgets to thread it fails closed, never silently "enabled")', () => {
    const html = renderSettingsPage('Acme', { ...BASE, openRouterSource: 'oauth' });
    assert.match(html, /○ not enabled/);
  });
});

describe('renderSettingsPage — Dispatch preset per-kind (byKind) overrides (LIN-1400)', () => {
  test('the top-level config row is wrapped in a scoping marker distinct from per-kind rows', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'Blend', config: { model: 'top-model' } }]
    });
    assert.match(html, /<div class="dispatch-preset-toplevel-config">[\s\S]{0,700}name="preset__p1__Model"/);
  });

  test('a preset with no byKind renders a collapsed (closed) per-kind block', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{ id: 'p1', name: 'No blend', config: { model: 'top-model' } }]
    });
    assert.match(html, /<details class="dispatch-preset-kind-overrides" data-testid="dispatch-preset-row-p1-kind-overrides">/);
  });

  test('a preset with a byKind entry renders per-kind rows pre-filled and auto-opens the <details>', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{
        id: 'p1',
        name: 'Blend',
        config: { model: 'top-model', byKind: { review: { model: 'opus-model', harness: 'claude-code' } } }
      }]
    });
    assert.match(html, /<details class="dispatch-preset-kind-overrides" open data-testid="dispatch-preset-row-p1-kind-overrides">/);
    // 'opus-model' isn't one of the four claude-code presets, so it degrades
    // onto the escape hatch (HARD RULE 2/3) rather than being silently dropped.
    assert.match(html, /name="preset__p1__kind__review__Model"[^>]*>[\s\S]*?<option value="__other__" selected>/);
    assert.match(html, /name="preset__p1__kind__review__Model"[\s\S]{0,600}class="dispatch-model-input-other"[^>]*value="opus-model"/);
    assert.match(html, /name="preset__p1__kind__review__HarnessSelect"[\s\S]{0,200}<option value="claude-code" selected>/);
  });

  test('per-kind field names are namespaced distinctly from the top-level row', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{
        id: 'p1',
        name: 'Blend',
        config: { model: 'top-model', byKind: { plan: { model: 'plan-model' } } }
      }]
    });
    // Top-level field name has no __kind__ segment; the per-kind row does.
    assert.match(html, /name="preset__p1__Model"/);
    assert.match(html, /name="preset__p1__kind__plan__Model"/);
  });

  test('the "new preset" create block also renders a (collapsed, empty) per-kind editor', () => {
    const html = renderSettingsPage('Acme', BASE);
    const rowStart = html.indexOf('data-testid="dispatch-preset-new-row"');
    assert.ok(rowStart > -1);
    assert.match(html, /name="newDispatchPreset__kind__review__Model"/);
    assert.match(html, /<details class="dispatch-preset-kind-overrides" data-testid="dispatch-preset-new-row-kind-overrides">/);
  });

  // LIN-2616 (L5) — per-kind preset rows get an effort input too, following
  // the same replace-vs-preserve (LIN-1400) byKind shape.
  test('a preset byKind entry populates the per-kind effort input (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{
        id: 'p1',
        name: 'Blend',
        config: { model: 'top-model', byKind: { review: { effort: 'max' } } }
      }]
    });
    assert.match(html, /name="preset__p1__kind__review__Effort"[^>]*value="max"/);
  });

  // LIN-2616 — the widened hasKindOverride gate on the preset side: an
  // effort-only byKind entry (no model/harness) must still auto-open the
  // per-kind <details>, mirroring the workspace-wide-section widening above.
  test('auto-opens the per-kind <details> when the only byKind override is an effort (LIN-2616)', () => {
    const html = renderSettingsPage('Acme', {
      ...BASE,
      dispatchPresets: [{
        id: 'p1',
        name: 'Effort blend',
        config: { byKind: { review: { effort: 'low' } } }
      }]
    });
    assert.match(html, /<details class="dispatch-preset-kind-overrides" open data-testid="dispatch-preset-row-p1-kind-overrides">/);
  });
});
