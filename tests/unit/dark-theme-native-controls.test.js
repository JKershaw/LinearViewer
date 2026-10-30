/**
 * LIN-3763: dark-theme native controls and bare links in the login/error shells.
 *
 * Pure: reads style.css and calls the pure renderers (no live services). The
 * contrast is computed from the token values the rules resolve to, since a
 * real-browser recapture needs a live server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, appliedDecls } from '../helpers/css-rules.js';

import {
  renderJiraLinkForm,
  renderJiraSiteSelectPage,
  renderGitHubProjectSelectPage,
  renderGitHubRepoSelectPage,
  renderWorkspaceNotFoundPage
} from '../../lib/render-pages.js';
import { renderEmailSignInPage, renderEmailRegisterPage } from '../../lib/render-email-auth.js';

// The declarations that apply to a selector in style.css (LIN-4015: asked of the helper, not matched as text).
const STYLE = readSheets(['/style.css']);
const applied = (selector, options) => appliedDecls(STYLE, selector, options);
function token(decls, name) {
  const value = decls.get(`--${name}`);
  assert.ok(value, `token --${name} missing`);
  const m = value.match(/^#[0-9a-fA-F]{6}$/);
  assert.ok(m, `token --${name} is not a six-digit hex: ${value}`);
  return value;
}
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the dark path declares color-scheme: dark', () => {
  // LIN-3980: the landing's own dark remap is gone; it reaches `.theme-dark` too.
  assert.equal(applied('.theme-dark').get('color-scheme'), 'dark');
});

test('shared control rule is token-only and carries no layout', () => {
  const body = applied('select.github-repo-select');
  assert.equal(applied('.login-input').get('font-family'), 'var(--font-content)');
  // The colour is the semantic --text or its raw --fg alias (LIN-4015 swapped the uses); either is a token.
  assert.match(applied('.login-input').get('color'), /^var\(--(text|fg)\)$/);
  assert.equal(applied('.login-input').get('background'), 'var(--bg)');
  for (const [prop, value] of [...applied('.login-input'), ...body]) {
    assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}\b/, `${prop} is a token, not a hex`);
    assert.doesNotMatch(prop, /^(width|display|margin|float|position)$/);
  }
});

test('repo-picker radio is darkened via accent-color, not replaced', () => {
  assert.equal(applied('.repo-picker-row input[type="radio"]').get('accent-color'), 'var(--brand)');
});

test('bare shell links use --blue and meet AA in both themes', () => {
  assert.equal(applied('.login-container a:not([class])').get('color'), 'var(--blue)');
  const root = applied(':root');
  const dark = applied('.theme-dark');
  assert.ok(contrast(token(root, 'blue'), token(root, 'bg')) >= 4.5);
  assert.ok(contrast(token(dark, 'blue'), token(dark, 'bg')) >= 4.5);
  // pre-fix UA blue on the dark page
  assert.ok(contrast('#0000ee', token(dark, 'bg')) < 2);
});

test('renderers still emit the hooks the CSS targets', () => {
  const jira = renderJiraLinkForm({ workspaceUrlKey: 'w' });
  assert.equal((jira.match(/<input type="(?:url|email|password)"[^>]*class="login-input"/g) || []).length, 3);
  assert.match(jira, /class="field-hint">[^<]*<a href="https:\/\/id\.atlassian\.com[^"]*"(?![^>]*class=)/);
  assert.match(jira, /login-container/);

  assert.match(renderJiraSiteSelectPage([{ id: 'c', name: 'n', url: 'https://x.atlassian.net' }]), /<select[^>]*class="github-repo-select"/);
  assert.match(renderGitHubProjectSelectPage([{ id: 'b', name: 'B' }]), /<select[^>]*class="github-repo-select"/);

  const nf = renderWorkspaceNotFoundPage('nope', [{ urlKey: 'a', name: 'A' }]);
  assert.match(nf, /error-container/);
  assert.match(nf, /<li><a href="\/workspace\/a\/">/);

  assert.match(renderEmailSignInPage({ nonce: 'n' }), /<input[^>]*class="login-input"/);
  assert.match(renderEmailRegisterPage({ nonce: 'n' }), /<input[^>]*class="login-input"/);

  const picker = renderGitHubRepoSelectPage([{ slug: 'o/r', name: 'r' }]);
  assert.match(picker, /class="repo-picker-row"[^]*?<input type="radio"/);
});

// LIN-3980: the hero's filled CTA used a raw hex ink (#04231f, 4.43:1 on light
// teal, just under AA). Its ink now resolves through the `--on-brand` token,
// which clears AA on the brand fill in both themes (LIN-4009: light --brand is the
// deep teal #0f766e, so the light ink is white; dark keeps #001512 on --teal).
test('the hero CTA ink resolves through --on-brand and clears AA on the teal fill', () => {
  const linear = applied('.landing-ctas .landing-cta-linear');
  assert.equal(linear.get('color'), 'var(--on-brand)');
  const onBrand = token(applied(':root'), 'on-brand');
  const brand = token(applied(':root'), 'brand');
  assert.ok(contrast(onBrand, brand) >= 4.5, `light: ${contrast(onBrand, brand).toFixed(2)}:1`);
  const tealDark = token(applied('.theme-dark'), 'teal');
  const onBrandDark = token(applied('.theme-dark'), 'on-brand');
  assert.ok(contrast(onBrandDark, tealDark) >= 4.5, `dark: ${contrast(onBrandDark, tealDark).toFixed(2)}:1`);
});
