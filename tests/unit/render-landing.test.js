import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingPage } from '../../lib/render-landing.js';

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

test('consumes D’s shared header nav rather than bespoke chrome', () => {
  const html = renderLandingPage({});
  assert.match(html, /<nav class="nav-bar"/);
  assert.match(html, /class="nav-action login"/); // sign-in action
});

test('features fake-data glimpses of real surfaces', () => {
  const html = renderLandingPage({});
  for (const id of ['landing-loop', 'landing-observation', 'landing-swim', 'landing-prompt', 'landing-providers', 'landing-os']) {
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
