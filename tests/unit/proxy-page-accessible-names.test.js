/**
 * The Proxy page names every form control (WCAG 4.1.2; Design & Interface Review, 8 Nov 2026). The Agent Prompt scope
 * select is named by its wrapping <label>; the Tokens form has no label element, so its label input and scope select
 * carry an aria-label (a placeholder is not a name). Settled as LIN-4457's leftover retirement.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/proxy-page-accessible-names.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProxyPage } from '../../lib/render-proxy.js';

describe('Proxy page form controls have accessible names', () => {
  const html = renderProxyPage('Acme', { urlKey: 'acme', workspaces: [], featureFlags: { proxy: true } });
  const form = (html.match(/<form[^>]*id="proxy-create-token-form"[\s\S]*?<\/form>/) || [])[0] || '';

  test('the Tokens form is rendered', () => {
    assert.ok(form, 'the new-token form is on the page');
  });

  test('the token label input is named, not only placeholdered', () => {
    assert.match(form, /<input[^>]*class="token-label-input"[^>]*aria-label="Token label"/);
  });

  test('the token scope select is named', () => {
    assert.match(form, /<select[^>]*name="scope"[^>]*aria-label="Token scope"/);
  });

  test('the Agent Prompt scope select is named by its wrapping label', () => {
    assert.match(html, /<label class="proxy-scope-toggle">\s*<span class="field-label">scope:<\/span>\s*<select class="proxy-scope-select" id="proxy-scope-select">/);
  });
});
