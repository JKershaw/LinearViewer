import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingPage } from '../../lib/render-landing.js';
import { DEFAULT_MODEL, AVAILABLE_MODELS, formatModelPricing } from '../../lib/openrouter.js';
import { START_HERE } from '../../lib/library-metadata.js';
import { escapeHtml } from '../../lib/utils/html.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

test('has an archive section linking the latest Harbour Archive edition', () => {
  const html = renderLandingPage({});
  assert.match(html, /data-testid="landing-archive"/);
  assert.match(html, /href="\/archive\/2"/);
  // Placed at the end of the showcase, after the Harbour OS section.
  assert.ok(html.indexOf('data-testid="landing-os"') < html.indexOf('data-testid="landing-archive"'));
});

// LIN-3345: the Library section — the homepage's discoverability link into the
// Library. It lists the catalogued documents (LIN-3980 moved the Archive item
// out of it); the section sits immediately above the Archive section.
test('has a Library section above the Archive, driven by START_HERE', () => {
  const html = renderLandingPage({});
  const libIdx = html.indexOf('data-testid="landing-library"');
  const archiveIdx = html.indexOf('data-testid="landing-archive"');
  assert.ok(libIdx !== -1, 'has landing-library');
  assert.ok(libIdx < archiveIdx, 'Library sits above the Archive');
  assert.match(html, /<a href="\/library" class="lx-library__cta" data-testid="landing-library-link">/);

  // LIN-3980: the Library lists the catalog documents only; the Archive item is
  // not repeated here, so the landing never leads with the document the Archive
  // section links to.
  const section = html.slice(libIdx, archiveIdx);
  const hrefs = [...section.matchAll(/<a class="lx-library__link" href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, START_HERE.filter(i => i.slug).map(i => `/library/${i.slug}`));
  assert.ok(!hrefs.includes('/archive/2'), 'Library does not lead with the Archive edition');
  for (const item of START_HERE.filter(i => i.slug)) assert.ok(section.includes(escapeHtml(item.note)), `note: ${item.title}`);
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

// LIN-3980 outcome 4: "Try it yourself" offers the same sign-in buttons as the
// hero, under the same configuration rules: Linear always, the rest when set.
function signInLabels(fragment) {
  return [...fragment.matchAll(/<a href="([^"]+)" class="landing-cta[^"]*" data-testid="([^"]+)">([^<]+)<\/a>/g)]
    .map(([, href, , label]) => `${href}|${label}`);
}
const SIGN_IN_CONFIGS = [
  {},
  { githubEnabled: true },
  { jiraEnabled: true },
  { emailEnabled: true },
  { githubEnabled: true, jiraEnabled: true, emailEnabled: true },
];
for (const cfg of SIGN_IN_CONFIGS) {
  test(`the try section has the hero's sign-in buttons, configured as ${JSON.stringify(cfg)}`, () => {
    const html = renderLandingPage(cfg);
    const heroRow = html.slice(html.indexOf('class="landing-ctas"'), html.indexOf('</header>'));
    const tryRow = html.slice(html.indexOf('data-testid="landing-try-ctas"'), html.indexOf('data-testid="landing-providers"'));
    assert.deepEqual(signInLabels(tryRow), signInLabels(heroRow));
    assert.ok(signInLabels(tryRow).length >= 1, 'Linear is always offered');
  });
}

test('the plain definition is on the landing, under the tagline', () => {
  const html = renderLandingPage({});
  assert.match(html, /data-testid="landing-plain"/);
});

// LIN-3980 outcome 2: the glimpses show the product as it is and stay true. No
// model id, no calendar year and no hand-typed stage word may sit inside a
// role="img" glimpse. Stage and model words come from the shared sources.
test('glimpses carry no model ids, no calendar years and no hand-typed stage words (LIN-3980)', () => {
  const html = renderLandingPage({});
  const glimpses = [...html.matchAll(/role="img"[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.equal(glimpses.length, 4, 'observation, swim, prompt and Harbour OS glimpses');
  for (const g of glimpses) {
    assert.doesNotMatch(g, /claude-[a-z0-9.-]+/);
    assert.doesNotMatch(g, /\b20\d{2}\b/);
    assert.doesNotMatch(g, />implement</);
    assert.doesNotMatch(g, /\bimplement\b/);
  }
  assert.match(html, /lx-run__label">Build</, 'the implementation stage reads as STAGE_LABELS sets it');
  assert.match(html, /Opus/, 'a model shows its family name');
});

test('the landing states no template count, so none can drift (LIN-3980)', () => {
  const html = renderLandingPage({});
  assert.doesNotMatch(html, /\b17 deterministic\b/);
  assert.doesNotMatch(html, /\bdeterministic templates\b/);
});

test('the loop and section copy drops the insider words (LIN-3980 outcome 3)', () => {
  const html = renderLandingPage({});
  const copy = html.replace(/<[^>]+>/g, ' ');
  for (const word of ['frontier', 'cohort', 'HEAD', 'grounded', 're-grounded', 'control plane', 'cockpit', 'first foreign backend', 'read-only V1', 'the original backend']) {
    assert.ok(!copy.includes(word), `no insider word: ${word}`);
  }
});

// LIN-3980 outcome 5: the Archive link resolves to a real edition, and the
// Library list does not lead with the document the Archive section links to.
// (Ruling lin3980-archive-library: the literal "the landing and START_HERE[0]
// don't link the same document" cannot hold while the Archive section links
// /archive/2 and START_HERE[0] is /archive/2, so the check reads "Library and
// Archive don't both lead with the same document".)
test('the Archive link target exists, and the Library list does not repeat it', () => {
  const html = renderLandingPage({});
  const archive = html.match(/href="\/archive\/(\d+)" class="lx-archive__link"/);
  assert.ok(archive, 'archive link present');
  assert.ok(existsSync(join(__dirname, '../../docs/archive', `${archive[1]}.html`)), `docs/archive/${archive[1]}.html exists`);
  const libIdx = html.indexOf('data-testid="landing-library"');
  const libSection = html.slice(libIdx, html.indexOf('data-testid="landing-archive"'));
  assert.ok(!libSection.includes(`href="/archive/${archive[1]}"`), 'Library does not lead with the Archive edition');
});
