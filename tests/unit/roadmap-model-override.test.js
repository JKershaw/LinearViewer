// LIN-819: roadmap generation may carry a per-request model override so a user
// can pick a stronger model for a single reading without changing the
// workspace-wide default. resolveRoadmapModelOverride is the pure policy seam
// used by the generate endpoint's resolveRoadmapLLM. Two gates are load-bearing:
//   1. Free tier is clamped — a body-supplied model is ALWAYS ignored so it can
//      never bill an expensive model against the operator's shared key (LIN-513).
//   2. Allow-list — only a curated AVAILABLE_MODELS id is honored; anything else
//      falls back to the already-resolved workspace default, so nothing unchecked
//      reaches OpenRouter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoadmapModelOverride } from '../../routes/workspace-api.js';
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../lib/openrouter.js';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';

// A curated non-default model id (the whole point of the feature) and the
// workspace default the endpoint would otherwise use.
const STRONGER = AVAILABLE_MODELS.find(m => m.id !== DEFAULT_MODEL)?.id;
const WORKSPACE_DEFAULT = 'openai/gpt-5.4-mini';

test('sanity: a curated non-default model exists to override with', () => {
  assert.ok(STRONGER, 'AVAILABLE_MODELS must offer at least one non-default model');
});

test('non-free-tier + valid curated override: uses the override', () => {
  assert.equal(resolveRoadmapModelOverride(STRONGER, WORKSPACE_DEFAULT, false), STRONGER);
});

test('non-free-tier + valid override trims surrounding whitespace', () => {
  assert.equal(resolveRoadmapModelOverride(`  ${STRONGER}  `, WORKSPACE_DEFAULT, false), STRONGER);
});

test('every curated model id is accepted as an override (allow-list is AVAILABLE_MODELS)', () => {
  for (const m of AVAILABLE_MODELS) {
    assert.equal(resolveRoadmapModelOverride(m.id, WORKSPACE_DEFAULT, false), m.id);
  }
});

test('non-free-tier + unknown/uncurated model: falls back to the workspace default (never passed unchecked)', () => {
  assert.equal(resolveRoadmapModelOverride('evil/undisclosed-expensive-model', WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
});

test('non-free-tier + empty / whitespace / missing override: keeps the workspace default', () => {
  assert.equal(resolveRoadmapModelOverride('', WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
  assert.equal(resolveRoadmapModelOverride('   ', WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
  assert.equal(resolveRoadmapModelOverride(undefined, WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
  assert.equal(resolveRoadmapModelOverride(null, WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
});

test('non-free-tier + non-string override (number/object/array): keeps the workspace default', () => {
  assert.equal(resolveRoadmapModelOverride(42, WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
  assert.equal(resolveRoadmapModelOverride({ id: STRONGER }, WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
  assert.equal(resolveRoadmapModelOverride([STRONGER], WORKSPACE_DEFAULT, false), WORKSPACE_DEFAULT);
});

test('free-tier clamp is authoritative: a valid curated override is IGNORED', () => {
  // The workspace default is already DEFAULT_MODEL for free tier (forceDefault
  // won upstream); the override must not resurrect a stronger model.
  assert.equal(resolveRoadmapModelOverride(STRONGER, DEFAULT_MODEL, true), DEFAULT_MODEL);
});

test('free-tier clamp wins regardless of what workspace default was passed', () => {
  // Even if a non-default were somehow threaded in, free tier returns exactly
  // what it was given — it never promotes to the body-supplied model.
  assert.equal(resolveRoadmapModelOverride(STRONGER, WORKSPACE_DEFAULT, true), WORKSPACE_DEFAULT);
});

// --- UI: the model selector renders only when AI is available ---

test('render: model selector appears (with Workspace default + curated options) when AI is connected', () => {
  const html = renderRoadmapPage(
    { roadmapModel: {}, organizationName: 'Test Org' },
    { urlKey: 'test-ws', openRouterSource: 'session', availableModels: AVAILABLE_MODELS }
  );
  assert.ok(html.includes('roadmap-model-select'), 'should render the model select');
  assert.ok(html.includes('>Workspace default<'), 'should offer the workspace-default option');
  assert.ok(html.includes('value=""'), 'workspace-default option carries the empty value');
  for (const m of AVAILABLE_MODELS) {
    assert.ok(html.includes(`value="${m.id}"`), `should offer curated model ${m.id}`);
    assert.ok(html.includes(`>${m.name}<`), `should label curated model ${m.name}`);
  }
});

test('render: no model selector when AI is not connected (no openRouterSource)', () => {
  const html = renderRoadmapPage(
    { roadmapModel: {}, organizationName: 'Test Org' },
    { urlKey: 'test-ws', availableModels: AVAILABLE_MODELS }
  );
  assert.ok(!html.includes('roadmap-model-select'), 'no selector without AI');
});
