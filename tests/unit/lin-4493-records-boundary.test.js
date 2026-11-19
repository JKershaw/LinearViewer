/**
 * LIN-4493 (piece 2): Records imports only Platform. Every import in lib/records/** and lib/records-store.js is a
 * Node built-in or a sibling inside lib/records/ (for the store, the records modules it reads). The router, the tracker
 * read, askedText, STAGE_KINDS and the workspace-person reader are injected by their callers (routes/proxy.js,
 * server.js), so no edge runs from Records into Agent API, Runs & dispatch, LLM & prompts or the tracker.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  ...readdirSync(join(ROOT, 'lib/records')).filter((f) => f.endsWith('.js')).map((f) => `lib/records/${f}`),
  'lib/records-store.js'
];

function importsOf(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const specs = [];
  for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  return specs;
}

describe('LIN-4493: the Records leaf imports only Platform (built-ins and its own modules)', () => {
  test('lib/records/** and lib/records-store.js are the files under test', () => {
    assert.ok(FILES.includes('lib/records/check.js') && FILES.includes('lib/records-store.js'));
  });

  for (const rel of FILES) {
    test(`${rel} imports only node built-ins and Records' own modules`, () => {
      for (const spec of importsOf(rel)) {
        const ok = spec.startsWith('node:')
          || (rel.startsWith('lib/records/') && /^\.\/[\w.-]+\.js$/.test(spec))
          || (rel === 'lib/records-store.js' && /^\.\/records\/[\w.-]+\.js$/.test(spec));
        assert.ok(ok, `${rel} imports '${spec}': Records imports only Platform; inject it instead`);
      }
    });
  }

  test('the router, the run seam and the callers stay outside the leaf (they import Records, never the reverse)', () => {
    for (const rel of FILES) {
      for (const spec of importsOf(rel)) assert.ok(!/routes\/|run-records|dispatch-|proxy-|as-asked|stage-writes|prompts\//.test(spec), `${rel} -> ${spec}`);
    }
  });
});
