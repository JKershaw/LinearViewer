/**
 * LIN-4085 — the agent prompt block on `/` (lib/render-landing.js), its copy script,
 * and the llms.txt entry that names the guide.
 *
 * Witnesses:
 *   - the block sits directly under the hero's sign-in buttons, before the setup notice and
 *     the rest of the showcase (an equal second way in, per the 17:43 ruling);
 *   - its <pre> holds the origin-filled prompt, selectable without JS;
 *   - the server-rendered HTML has no button, so no dead control exists without JS;
 *   - the copy script is a static file on the page, not an inline script (no CSP hash change);
 *   - without a request origin the block is left out rather than guessed;
 *   - llms.txt names /getting-started.md above the Library section.
 *
 * Run with: node --test tests/unit/landing-agent-prompt.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderLandingPage } from '../../lib/render-landing.js';
import { scanText } from '../../lib/secret-scan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://harbour.example';

const block = (html) => {
  const start = html.indexOf('<section class="lx-section lx-agent"');
  assert.notEqual(start, -1, 'the agent prompt section is rendered');
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
};

describe('the agent prompt block on /', () => {
  test('sits directly under the hero sign-in buttons, before the setup notice and the loop', () => {
    const html = renderLandingPage({ agentOrigin: ORIGIN, setupNotice: 'setup' });
    const heroEnd = html.indexOf('</header>');
    const agent = html.indexOf('data-testid="landing-agent-prompt"');
    assert.ok(html.indexOf('data-testid="landing-cta-linear"') < heroEnd, 'the Linear CTA is in the hero');
    assert.ok(heroEnd < agent, 'the block comes after the hero');
    assert.ok(agent < html.indexOf('class="setup-notice"'), 'the block comes before the setup notice');
    assert.ok(agent < html.indexOf('data-testid="landing-loop"'), 'the block comes before the loop');
  });

  test('its pre holds the origin-filled prompt, which names the guide', () => {
    const html = renderLandingPage({ agentOrigin: ORIGIN });
    const pre = block(html).match(/<pre[^>]*data-testid="landing-agent-prompt-text"[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(pre, 'the prompt is in a pre');
    assert.ok(pre[1].includes(`${ORIGIN}/getting-started.md`));
    assert.equal(pre[1].includes('{{'), false);
  });

  test('the server-rendered block has no button, so there is no dead control without JS', () => {
    assert.equal(/<button/.test(block(renderLandingPage({ agentOrigin: ORIGIN }))), false);
  });

  test('the copy script is a static file on the page, and the block adds no inline script', () => {
    const withBlock = renderLandingPage({ agentOrigin: ORIGIN });
    assert.ok(withBlock.includes('<script src="/landing-copy.js"></script>'));
    // Inline = a <script> with no src. The block must add none, so the CSP hash list stays as it is.
    const inlineCount = (html) => [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].length;
    assert.equal(inlineCount(withBlock), inlineCount(renderLandingPage({})));
  });

  test('the block carries its own hooks, not the app prompt-copy classes', () => {
    const b = block(renderLandingPage({ agentOrigin: ORIGIN }));
    for (const cls of ['prompt-copy', 'prompt-container', 'prompt-text']) {
      const onClass = new RegExp(`class="[^"]*\\b${cls}\\b`);
      assert.equal(onClass.test(b), false, `no ${cls} class: app.js binds it and that handler mints tokens`);
    }
  });

  test('without a request origin the block is left out', () => {
    assert.equal(renderLandingPage({}).includes('data-testid="landing-agent-prompt"'), false);
  });

  test('the block text carries no secret the public-page scan would flag', () => {
    const b = block(renderLandingPage({ agentOrigin: ORIGIN }));
    assert.deepEqual(scanText(b, { filePath: 'landing' }), []);
  });
});

describe('llms.txt names the guide', () => {
  const llms = readFileSync(join(ROOT, 'public', 'llms.txt'), 'utf8');

  test('the getting-started section is above Library and points at the .md guide', () => {
    const gs = llms.indexOf('## Getting started');
    const lib = llms.indexOf('## Library');
    assert.ok(gs !== -1 && lib !== -1 && gs < lib, 'the section comes before Library');
    assert.ok(llms.slice(gs, lib).includes('/getting-started.md'));
  });
});
