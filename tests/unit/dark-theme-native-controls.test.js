/**
 * LIN-3763: dark-theme native controls and bare links in the login/error shells.
 *
 * Pure: reads style.css and calls the pure renderers (no live services). The
 * contrast is computed from the token values the rules resolve to, since a
 * real-browser recapture needs a live server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  renderJiraLinkForm,
  renderJiraSiteSelectPage,
  renderGitHubProjectSelectPage,
  renderGitHubRepoSelectPage,
  renderWorkspaceNotFoundPage
} from '../../lib/render-pages.js';
import { renderEmailSignInPage, renderEmailRegisterPage } from '../../lib/render-email-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `rule not found: ${selector}`);
  return m[1];
}
function token(block, name) {
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `token --${name} missing`);
  return m[1];
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
  assert.match(rule('.theme-dark'), /color-scheme:\s*dark/);
});

test('shared control rule is token-only and carries no layout', () => {
  const body = rule('.login-input,\nselect.github-repo-select');
  assert.match(body, /font-family:\s*var\(--font-content\)/);
  assert.match(body, /color:\s*var\(--fg\)/);
  assert.match(body, /background:\s*var\(--bg\)/);
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(body, /\b(width|display|margin|float|position)\s*:/);
});

test('repo-picker radio is darkened via accent-color, not replaced', () => {
  assert.match(rule('.repo-picker-row input[type="radio"]'), /accent-color:\s*var\(--brand\)/);
});

test('bare shell links use --blue and meet AA in both themes', () => {
  assert.match(rule('.login-container a:not([class]),\n.error-container a:not([class])'), /color:\s*var\(--blue\)/);
  const root = rule(':root');
  const dark = rule('.theme-dark');
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
// which clears AA on the --teal fill in both themes.
test('the hero CTA ink resolves through --on-brand and clears AA on the teal fill', () => {
  const linear = rule('.landing-ctas .landing-cta-linear');
  assert.match(linear, /color:\s*var\(--on-brand\)/);
  assert.doesNotMatch(linear, /color:\s*#/);
  const onBrand = token(rule(':root'), 'on-brand');
  const teal = token(rule(':root'), 'teal');
  assert.ok(contrast(onBrand, teal) >= 4.5, `light: ${contrast(onBrand, teal).toFixed(2)}:1`);
  const tealDark = token(rule('.theme-dark'), 'teal');
  assert.ok(contrast(onBrand, tealDark) >= 4.5, `dark: ${contrast(onBrand, tealDark).toFixed(2)}:1`);
});
