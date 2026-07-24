import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingPage } from '../../lib/render-landing.js';
import { DEFAULT_MODEL, AVAILABLE_MODELS, formatModelPricing } from '../../lib/openrouter.js';

// LIN-980: the bespoke Harbour showcase landing. These lock the composition
// contract — the top area, the fake-data glimpses of real surfaces, the distinct
// Harbour OS section, D's shared nav — and that the fake project-tree is gone.

test('renders a complete is-landing document on the shared shell', () => {
  const html = renderLandingPage({ deployInfo: {}, githubEnabled: true });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<body class="is-landing"/);
  assert.match(html, /<\/html>$/);
  // Shared design system + bespoke stylesheet, in order.
  assert.ok(html.indexOf('/style.css') < html.indexOf('/landing.css'), 'style.css precedes landing.css');
});

test('leads with the Harbour brand hero (the settled top area)', () => {
  const html = renderLandingPage({ githubEnabled: true });
  assert.match(html, /data-testid="landing-hero"/);
  assert.match(html, /class="landing-wordmark"/);
  // The hero precedes the showcase body.
  assert.ok(html.indexOf('landing-hero') < html.indexOf('landing-showcase'));
});

test('drops the shared top bar on the homepage — the hero is the sole sign-in path', () => {
  // LIN-1508: the homepage no longer renders the shared landing top bar
  // (projects / local workspace / sign in / GitHub). It was pure duplication of
  // the hero's CTAs. `minimalNav` scopes the removal to the homepage — the same
  // bar is preserved for the swipe/swim/ship previews (their e2e specs pin it as
  // their only sign-in route), so this asserts absence on the homepage only.
  const html = renderLandingPage({ githubEnabled: true });
  assert.ok(!html.includes('class="nav-bar"'), 'no landing top bar on the homepage');
  assert.ok(!html.includes('nav-action login'), 'no top-bar sign-in action on the homepage');
  // The hero still carries a directly-reachable Linear sign-in CTA.
  assert.match(html, /data-testid="landing-cta-linear"/);
  assert.match(html, /href="\/auth\/linear"/);
});

test('features fake-data glimpses of real surfaces', () => {
  const html = renderLandingPage({});
  for (const id of ['landing-loop', 'landing-observation', 'landing-swim', 'landing-prompt', 'landing-try', 'landing-providers', 'landing-os']) {
    assert.match(html, new RegExp(`data-testid="${id}"`), `has ${id}`);
  }
  // Observation glimpse mirrors the real run-status vocabulary.
  assert.match(html, /status-pill--running/);
  assert.match(html, /status-pill--done/);
  assert.match(html, /status-pill--queued/);
  // Swim glimpse shows a blocking dependency edge.
  assert.match(html, /lx-swim-block/);
});

test('has a distinct Harbour OS section linking os.harbour.cat', () => {
  const html = renderLandingPage({});
  assert.match(html, /data-testid="landing-os"/);
  assert.match(html, /Harbour OS/);
  assert.match(html, /href="https:\/\/os\.harbour\.cat"/);
});

test('does NOT render the fake project-tree structure', () => {
  const html = renderLandingPage({});
  assert.ok(!html.includes('project-header'), 'no tree project headers');
  assert.ok(!html.includes('data-default-collapsed'), 'no tree collapse chrome');
  // The old marketing-copy section titles are gone from the home page.
  assert.ok(!html.includes('What Harbour Is'));
});

test('gates the GitHub hero CTA on githubEnabled', () => {
  assert.match(renderLandingPage({ githubEnabled: true }), /landing-cta-github/);
  assert.ok(!renderLandingPage({ githubEnabled: false }).includes('landing-cta-github'));
});

test('shows the localhost setup notice only when requested', () => {
  assert.match(renderLandingPage({ setupNotice: 'setup' }), /Getting started/);
  assert.ok(!renderLandingPage({}).includes('Getting started'));
});

// LIN-1161: "try it for well under $1" — the honest low-cost trial hook. These
// pin the section's placement, that its dollar figure is derived from the
// pricing rate card (never a second hardcoded price), and both branches of the
// free-tier-vs-BYOK copy fork.

test('places the "try it" section after grounded prompts and before providers', () => {
  const html = renderLandingPage({});
  const tryIdx = html.indexOf('data-testid="landing-try"');
  const promptIdx = html.indexOf('data-testid="landing-prompt"');
  const providersIdx = html.indexOf('data-testid="landing-providers"');
  assert.ok(promptIdx < tryIdx && tryIdx < providersIdx, 'landing-try sits between landing-prompt and landing-providers');
});

test('grounds the dollar claim in formatModelPricing(DEFAULT_MODEL), not a second hardcoded price', () => {
  const html = renderLandingPage({});
  const expectedPricing = formatModelPricing(AVAILABLE_MODELS.find((m) => m.id === DEFAULT_MODEL));
  assert.ok(expectedPricing, 'sanity: DEFAULT_MODEL has a known rate card entry');
  assert.ok(html.includes(expectedPricing), 'renders the live pricing hint verbatim');
});

test('scopes the cheap-try claim to AI Generated Prompts, never the whole product', () => {
  const html = renderLandingPage({});
  const section = html.slice(html.indexOf('data-testid="landing-try"'), html.indexOf('data-testid="landing-providers"'));
  assert.match(section, /AI Generated Prompts/);
  assert.match(section, /under \$1/);
  assert.match(section, /pricier model/); // full dispatch/autopilot caveat
  assert.ok(!section.includes('run Harbour for'), 'never implies the whole product runs for under $1');
});

test('freeTierEnabled leads with the free path and never demands payment to try', () => {
  const html = renderLandingPage({ freeTierEnabled: true });
  const section = html.slice(html.indexOf('data-testid="landing-try"'), html.indexOf('data-testid="landing-providers"'));
  assert.match(section, /free/i);
  assert.ok(!/must pay/i.test(section), 'never says a user must pay to try');
});

test('defaults to the BYOK lead line when freeTierEnabled is false', () => {
  const html = renderLandingPage({});
  const section = html.slice(html.indexOf('data-testid="landing-try"'), html.indexOf('data-testid="landing-providers"'));
  assert.match(section, /connect OpenRouter/i);
  assert.match(section, /own OpenRouter tokens/);
});
