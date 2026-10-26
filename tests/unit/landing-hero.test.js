import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingHero } from '../../lib/components/landing-hero.js';

test('landing hero renders the brand lockup as the page <h1>', () => {
  const html = renderLandingHero({ githubEnabled: false });
  // Lowercase wordmark is the single page heading (S3 treatment, mono not serif).
  assert.match(html, /<h1 class="landing-wordmark">harbour<span class="landing-wordmark-accent" aria-hidden="true">.cat<\/span><\/h1>/);
  assert.ok(html.includes('data-testid="landing-hero"'));
  // Anchor mark (S1) is present as an inline, themeable SVG.
  assert.ok(html.includes('<svg'), 'anchor mark SVG present');
  // No serif typography anywhere in the brand markup.
  assert.ok(!/serif/i.test(html), 'no serif font referenced');
});

test('landing hero always offers the Linear CTA', () => {
  const html = renderLandingHero({ githubEnabled: false });
  assert.ok(html.includes('href="/auth/linear"'));
  assert.ok(html.includes('data-testid="landing-cta-linear"'));
});

test('GitHub CTA appears only when the GitHub App is configured', () => {
  const enabled = renderLandingHero({ githubEnabled: true });
  assert.ok(enabled.includes('href="/auth/github"'));
  assert.ok(enabled.includes('data-testid="landing-cta-github"'));

  const disabled = renderLandingHero({ githubEnabled: false });
  assert.ok(!disabled.includes('/auth/github'), 'no GitHub link when unconfigured');
  assert.ok(!disabled.includes('landing-cta-github'), 'no GitHub CTA when unconfigured');
});

test('defaults to GitHub disabled when no options passed', () => {
  const html = renderLandingHero();
  assert.ok(!html.includes('/auth/github'));
});

// LIN-3980 outcome 1: a plain definition of Harbour sits under the tagline, in
// the first screen, before the sign-in buttons.
test('the hero states what Harbour does, plainly, between the tagline and the sign-in buttons', async () => {
  const { renderLandingHero, HARBOUR_PLAIN_SENTENCE } = await import('../../lib/components/landing-hero.js');
  const html = renderLandingHero({ githubEnabled: true });
  const tagline = html.indexOf('landing-tagline');
  const plain = html.indexOf('data-testid="landing-plain"');
  const ctas = html.indexOf('class="landing-ctas"');
  assert.ok(tagline !== -1 && tagline < plain && plain < ctas, 'tagline, then plain sentence, then sign-in row');
  assert.ok(html.includes(HARBOUR_PLAIN_SENTENCE));
  assert.match(HARBOUR_PLAIN_SENTENCE, /reads your backlog.*writes the next prompt.*runs it on your coding agents.*checks the result against real evidence/);
});
