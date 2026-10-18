/**
 * LIN-3420 — structural witness for the app CSP.
 *
 * Every inline executable surface the renderers emit must be accounted for by
 * `APP_CSP`: each inline `<script>` body hashed into `script-src`, and no
 * `on*=` handler attribute anywhere (a CSP without `unsafe-inline` silently
 * disables them).
 *
 * Run with: node --test tests/unit/inline-script-policy.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CSP } from '../../lib/security-headers.js';
import { renderPage, scriptBodyHash } from '../../lib/components/page.js';
import { renderGitHubRepoSelectPage } from '../../lib/render-pages.js';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { AVAILABLE_MODELS } from '../../lib/openrouter.js';
import { renderEscalationKpisPage } from '../../lib/render-escalation-kpis.js';
import * as emailAuth from '../../lib/render-email-auth.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Executable inline script bodies (JSON data blocks are never executed). */
function inlineScriptBodies(html) {
  const bodies = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs)) continue;
    if (/type="application\/json"/.test(attrs)) continue;
    bodies.push(m[2]);
  }
  return bodies;
}

function assertCovered(label, html) {
  const src = APP_CSP.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
  assert.ok(!src.includes('unsafe-inline'));
  const bodies = inlineScriptBodies(html);
  assert.ok(bodies.length > 0 || !/<script>/.test(html), `${label}: scan found the scripts`);
  for (const body of bodies) {
    assert.ok(src.includes(`'${scriptBodyHash(body)}'`), `${label}: inline script not in script-src: ${body.slice(0, 60)}`);
  }
  const handlers = html.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
  assert.deepEqual(handlers, [], `${label}: inline event handlers are blocked by the policy`);
}

function sources(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
}

describe('rendered inline code is covered by APP_CSP', () => {
  test('page shell: theme script, and embeddedData as JSON block + loader', () => {
    assertCovered('shell', renderPage({ title: 't' }));
    const html = renderPage({ title: 't', embeddedData: { globalVar: '__X__', value: { s: '</script><script>alert(1)' } } });
    assertCovered('embeddedData', html);
    assert.ok(!html.includes('</script><script>alert(1)'), 'payload stays escaped');
    assert.match(html, /<script type="application\/json" data-global="__X__">/);
  });

  test('embeddedData rejects a globalVar that is not a plain identifier', () => {
    assert.throws(() => renderPage({ title: 't', embeddedData: { globalVar: 'x"><script>', value: 1 } }), /invalid embeddedData\.globalVar/);
  });

  test('repo picker above the filter threshold', () => {
    const repos = Array.from({ length: 60 }, (_, i) => ({ fullName: `o/r${i}`, name: `r${i}`, owner: 'o', private: false }));
    const html = renderGitHubRepoSelectPage(repos, { installationId: '1' });
    assert.ok(html.includes('repo-picker-filter'));
    assert.ok(inlineScriptBodies(html).some(b => b.includes('repo-picker-filter')), 'filter script rendered');
    assertCovered('repo picker', html);
  });

  test('settings page: the model-pricing listener is hashed', () => {
    const html = renderSettingsPage('Acme', {
      urlKey: 'acme', workspaces: [], currentModel: AVAILABLE_MODELS[0].id, availableModels: AVAILABLE_MODELS,
    });
    assert.ok(inlineScriptBodies(html).some(b => b.includes('data-model-price')), 'pricing script rendered');
    assertCovered('settings', html);
  });

  test('escalation KPIs: no onchange, autosubmit script loaded', () => {
    const kpis = {
      escalationRate: { raisedInWindow: 5, perDay: 0.17, targetPerDay: null, overTarget: null },
      timeToResponse: { count: 3, medianMs: 3600000, maxMs: 7200000 },
      falseEscalation: { dismissed: 1, answered: 2, total: 3, rate: 1 / 3 },
      unansweredAge: { count: 2, staleCount: 1, maxAgeMs: 90000000, staleThresholdMs: 86400000 },
    };
    const html = renderEscalationKpisPage('Acme', { urlKey: 'ws', kpis, windowDays: 30 });
    assertCovered('escalation kpis', html);
    assert.match(html, /<select[^>]*data-autosubmit/);
    assert.ok(html.includes('src="/form-behaviours.js"'));
  });

  test('email-auth forms: no onsubmit, each page loads form-behaviours.js', () => {
    const renders = {
      signin: emailAuth.renderEmailSignInPage({ nonce: 'n' }),
      register: emailAuth.renderEmailRegisterPage({ nonce: 'n' }),
      linkConfirm: emailAuth.renderEmailLinkConfirmPage({ email: 'a@b.co', token: 't', nonce: 'n' }),
      reproof: emailAuth.renderEmailReproofPage({ email: 'a@b.co', nonce: 'n' }),
      confirm: emailAuth.renderEmailConfirmPage({ email: 'a@b.co', token: 't', nonce: 'n' }),
    };
    for (const [name, html] of Object.entries(renders)) {
      assertCovered(name, html);
      assert.match(html, /<form[^>]*data-submit-once/);
      assert.ok(html.includes('src="/form-behaviours.js"'));
    }
  });
});

describe('verbatim archive HTML served by /archive/:n', () => {
  // The route sendFile's docs/archive/*.html as text/html, so APP_CSP applies:
  // every inline script in them must be pinned or the browser blocks it.
  const dir = join(ROOT, 'docs/archive');
  const files = readdirSync(dir).filter(n => n.endsWith('.html'));

  test('there are archives to check', () => {
    assert.ok(files.length >= 9);
  });

  for (const name of files) {
    test(`archive ${name}: every inline script is in script-src, no on*= handler`, () => {
      assertCovered(`archive ${name}`, readFileSync(join(dir, name), 'utf8'));
    });
  }
});

describe('source sweep (no unaccounted inline code)', () => {
  const ALLOWED_INLINE_SCRIPT_FILES = new Map([
    ['lib/components/page.js', 'theme pre-paint + data loader'],
    ['lib/render-pages.js', 'repo-picker filter'],
    ['lib/render-settings.js', 'model-pricing listener'],
  ]);

  test('inline <script> markup only appears in the allow-listed files', () => {
    for (const file of [...sources('lib'), ...sources('routes'), 'server.js']) {
      const src = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Markup only: a regex that parses scripts (`<script\b(…)>`) has regex
      // metacharacters in the tag and is not emitted HTML.
      const inline = /<script(?:\s[^>\\()[\]]*)?>/.test(src.replace(/<script[^>]*\bsrc=[^>]*>/g, '').replace(/<script[^>]*type="application\/json"[^>]*>/g, ''));
      if (inline) assert.ok(ALLOWED_INLINE_SCRIPT_FILES.has(file), `${file} emits an inline <script>: hash it in lib/security-headers.js and allow-list it here`);
    }
  });

  test('no renderer emits an on*= handler attribute', () => {
    for (const file of [...sources('lib'), ...sources('routes')]) {
      const src = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!/<[a-z][^>]*\son(change|click|submit|load|input|error|focus|blur|key\w+|mouse\w+)=/i.test(src), `${file} has an inline event handler`);
    }
  });
});
