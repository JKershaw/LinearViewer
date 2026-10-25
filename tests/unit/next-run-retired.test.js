/**
 * LIN-3912 — the Next run surface is retired: its page, API, flag and LLM job
 * are gone, and its files are deleted. The retired URLs are unmounted, so they
 * fall through to Express's default 404 (LIN-877 precedent).
 *
 * Run with: node --test tests/unit/next-run-retired.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FEATURES, FEATURE_DEFAULTS, FEATURE_LABELS, EXPERIMENTAL_VIEWS, getFeatureFlags } from '../../lib/feature-defaults.js';
import { JOB_IDS } from '../../lib/llm-jobs.js';
import { AI_OPERATION_KINDS } from '../../lib/model-routing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('LIN-3912 — the nextRun feature flag is gone', () => {
  test('nextRun is not in FEATURES, FEATURE_DEFAULTS, FEATURE_LABELS or EXPERIMENTAL_VIEWS', () => {
    assert.ok(!Object.values(FEATURES).includes('nextRun'));
    assert.ok(!('nextRun' in FEATURE_DEFAULTS));
    assert.ok(!('nextRun' in FEATURE_LABELS));
    assert.ok(!EXPERIMENTAL_VIEWS.some(v => v.flag === 'nextRun' || v.path === 'next-run'));
  });

  test('a stale stored features.nextRun is dropped, not honoured', () => {
    const flags = getFeatureFlags({ features: { nextRun: true } });
    assert.ok(!('nextRun' in flags));
  });
});

describe('LIN-3912 — the next-run LLM job is gone', () => {
  test('next-run is not a Harbour-call job or an AI operation kind', () => {
    assert.ok(!JOB_IDS.includes('next-run'));
    assert.ok(!AI_OPERATION_KINDS.includes('next-run'));
  });
});

describe('LIN-3912 — the Next run files are deleted', () => {
  for (const rel of [
    'routes/next-run.js',
    'lib/next-run.js',
    'lib/render-next-run.js',
    'public/next-run.js',
    'public/next-run.css',
    'tests/unit/next-run.test.js',
    'tests/unit/render-next-run-budget-dial.test.js',
    'tests/e2e/next-run.spec.js',
    'prototypes',
  ]) {
    test(`${rel} does not exist`, () => {
      assert.equal(existsSync(join(ROOT, rel)), false);
    });
  }
});

describe('LIN-3912 — no route is mounted under next-run', () => {
  const ROUTE_CALL = /\b(?:router|app)\.(?:get|post|put|patch|delete|use)\(\s*['"`][^'"`]*next-run/;

  const sources = [
    join(ROOT, 'server.js'),
    ...readdirSync(join(ROOT, 'routes'))
      .filter(f => f.endsWith('.js'))
      .map(f => join(ROOT, 'routes', f)),
  ];

  for (const file of sources) {
    test(`${file.slice(ROOT.length + 1)} registers no next-run path`, () => {
      assert.doesNotMatch(readFileSync(file, 'utf8'), ROUTE_CALL);
    });
  }
});
