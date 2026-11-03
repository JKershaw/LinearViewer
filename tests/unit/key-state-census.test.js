/**
 * LIN-4168 census: every in-memory container that could hold per-key state is classified, so a holder added later cannot
 * slip past the one per-key reset.
 *
 * tests/fixtures/key-state-scan.js finds the containers (four shapes, documented there). tests/fixtures/key-state-census.json
 * says what each one is: `registered` (a holder the reset clears), `global-only` (an exception, with the reason and what
 * clears it), `delegated` (its state lives in another listed container), `database-backed` (a durable store, out of scope),
 * or `not-state` (with the reason). A hit that is not listed fails this test and names file:line. A listed entry whose hit
 * has gone fails too, so the census cannot rot.
 *
 * Run with: node --test tests/unit/key-state-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo, scanText } from '../fixtures/key-state-scan.js';
import { buildKeyStateInstances, buildRegistry } from '../fixtures/key-state-instances.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CENSUS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/key-state-census.json'), 'utf8'));
const DISPOSITIONS = new Set(['registered', 'global-only', 'delegated', 'database-backed', 'not-state']);

/**
 * Everything the census can object to, as readable strings. Pure, so the synthetic cases below can drive it.
 * @param {{hits: Array<{key: string, file?: string, line?: number, shape?: string}>, census: Object, holderNames: string[], exceptionNames: string[]}} input
 * @returns {string[]}
 */
export function censusProblems({ hits, census, holderNames, exceptionNames }) {
  const problems = [];
  const hitKeys = new Set(hits.map((h) => h.key));
  for (const h of hits) {
    if (!census[h.key]) {
      problems.push(`unlisted ${h.shape ? `(shape ${h.shape}) ` : ''}container ${h.key}${h.file ? ` at ${h.file}:${h.line}` : ''}: classify it in tests/fixtures/key-state-census.json (registered, global-only, delegated, database-backed or not-state)`);
    }
  }
  for (const key of Object.keys(census)) {
    if (!hitKeys.has(key)) problems.push(`stale census entry ${key}: no container by that name is found; remove it`);
  }
  const usedHolders = new Set();
  const usedExceptions = new Set();
  for (const [key, entry] of Object.entries(census)) {
    if (!DISPOSITIONS.has(entry.disposition)) { problems.push(`${key}: unknown disposition "${entry.disposition}"`); continue; }
    if (entry.disposition === 'registered') {
      if (!holderNames.includes(entry.holder)) problems.push(`${key}: holder "${entry.holder}" is not registered in lib/key-state-holders.js`);
      else usedHolders.add(entry.holder);
    } else if (entry.disposition === 'global-only') {
      if (!exceptionNames.includes(entry.exception)) problems.push(`${key}: exception "${entry.exception}" is not registered in lib/key-state-holders.js`);
      else usedExceptions.add(entry.exception);
    } else if (entry.disposition === 'delegated') {
      const target = census[entry.to];
      if (!target) problems.push(`${key}: delegated to ${entry.to}, which is not in the census`);
      else if (target.disposition === 'delegated') problems.push(`${key}: delegated to ${entry.to}, which is itself delegated`);
    } else if (!entry.why || !entry.why.trim()) {
      problems.push(`${key}: a ${entry.disposition} entry needs a why`);
    }
  }
  for (const name of holderNames) if (!usedHolders.has(name)) problems.push(`registered holder "${name}" is not used by any census entry`);
  for (const name of exceptionNames) if (!usedExceptions.has(name)) problems.push(`registered exception "${name}" is not used by any census entry`);
  return problems;
}

const registry = buildRegistry(buildKeyStateInstances());
const registryInput = { census: CENSUS, holderNames: registry.holderNames(), exceptionNames: registry.exceptionNames() };

describe('the census of per-key containers (LIN-4168)', () => {
  test('every in-memory container in lib/, routes/ and server.js is classified, and nothing listed is stale', () => {
    const problems = censusProblems({ ...registryInput, hits: scanRepo(REPO) });
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('a container added without a census entry is reported with its file and line (the tripwire)', () => {
    const synthetic = scanText('lib/new-feature.js', [
      'export function createNewFeature() {',
      '  const seenByWorkspace = new Map();',
      '  return { record(urlKey) { seenByWorkspace.set(urlKey, true); } };',
      '}',
      '',
    ].join('\n')).map((h) => ({ ...h, file: 'lib/new-feature.js' }));
    const problems = censusProblems({ ...registryInput, hits: [...scanRepo(REPO), ...synthetic] });
    assert.equal(synthetic.length, 1);
    assert.ok(
      problems.some((p) => p.includes('lib/new-feature.js::seenByWorkspace') && p.includes('lib/new-feature.js:2')),
      `expected the new container at lib/new-feature.js:2 to be reported, got:\n${problems.join('\n')}`,
    );
  });

  test('a module-scope map and a class field are found too, and a factory instance is its own decision', () => {
    const moduleScope = scanText('lib/a.js', 'const cache = new Map();\n');
    const field = scanText('lib/b.js', 'class X {\n  constructor() {\n    this.entries = new Map();\n  }\n}\n');
    const instance = scanText('server.js', 'const widgetCache = createWidgetCache({ ttlMs: 1 });\n');
    assert.deepEqual(moduleScope.map((h) => [h.shape, h.key]), [['a', 'lib/a.js::cache']]);
    assert.deepEqual(field.map((h) => [h.shape, h.key]), [['b', 'lib/b.js::entries']]);
    assert.deepEqual(instance.map((h) => [h.shape, h.key]), [['d', 'server.js::widgetCache']]);
  });

  test('a populated constant (a lookup table) is not a container', () => {
    assert.deepEqual(scanText('lib/c.js', 'const KINDS = new Set([\'a\', \'b\']);\n'), []);
  });

  test('a two-space map inside a non-factory function is a temporary, not a container', () => {
    const hits = scanText('lib/d.js', 'function helper() {\n  const seen = new Map();\n  return seen;\n}\n');
    assert.deepEqual(hits, []);
  });

  test('a registered holder that the census does not use, or an entry that names no holder, is reported', () => {
    const problems = censusProblems({
      hits: [{ key: 'lib/x.js::m' }],
      census: { 'lib/x.js::m': { disposition: 'registered', holder: 'nope' } },
      holderNames: ['task-facts'],
      exceptionNames: [],
    });
    assert.ok(problems.some((p) => p.includes('holder "nope" is not registered')));
    assert.ok(problems.some((p) => p.includes('"task-facts" is not used')));
  });

  test('a delegated entry must point at a listed container that is not itself delegated', () => {
    const census = {
      'lib/x.js::a': { disposition: 'delegated', to: 'lib/x.js::b' },
      'lib/x.js::b': { disposition: 'delegated', to: 'lib/x.js::c' },
      'lib/x.js::c': { disposition: 'not-state', why: 'x' },
    };
    const hits = Object.keys(census).map((key) => ({ key }));
    const problems = censusProblems({ hits, census, holderNames: [], exceptionNames: [] });
    assert.ok(problems.some((p) => p.includes('lib/x.js::b, which is itself delegated')));
  });
});
