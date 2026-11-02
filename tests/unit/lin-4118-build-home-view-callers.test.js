/**
 * LIN-4118 (S3a-1) W6 (a): `buildHomeView(` has exactly two production callers.
 *
 * The shared pipeline (lib/home-pipeline.js) and lib/home-rows.js are the only production call sites. This is a source
 * scan with no imports from lib/, so it runs on any tree shape: it is the witness that fails on the pre-extraction code.
 * It scans server.js, lib/ and routes/ (never tests), and skips comment lines so a doc mention is not counted as a call.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

/** Production JS: server.js at the root, plus lib/ and routes/ recursively. Tests and public/ are not production here. */
function productionSources(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (dir === ROOT && name !== 'lib' && name !== 'routes') continue;
      productionSources(full, out);
    } else if (name.endsWith('.js') && (dir === ROOT ? name === 'server.js' : true)) {
      out.push(rel);
    }
  }
  return out;
}

/** The code lines of a file: comment lines (// and block-comment bodies) removed, so only executable text is scanned. */
function codeLinesOf(source) {
  let inBlock = false;
  return source.split('\n').filter((line) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return false; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return false; }
    return !t.startsWith('//') && !t.startsWith('*');
  }).join('\n');
}

describe('W6 (a): buildHomeView is imported only by the same two files (an alias cannot route around the call check)', () => {
  test('the import sites of buildHomeView are the shared pipeline and home-rows.js, and nothing else', () => {
    const importers = [];
    for (const rel of productionSources()) {
      const code = codeLinesOf(readFileSync(join(ROOT, rel), 'utf8'));
      // A named import that brings in buildHomeView, under any alias: `import { ..., buildHomeView, ... } from '...'`.
      if (/import\s*\{[^}]*\bbuildHomeView\b[^}]*\}\s*from/.test(code)) importers.push(rel);
    }
    assert.deepEqual(
      importers.sort(),
      ['lib/home-pipeline.js', 'lib/home-rows.js'],
      `only the shared pipeline and home-rows.js may import buildHomeView; found: ${JSON.stringify(importers)}`,
    );
  });
});

describe('W6 (a): buildHomeView( has exactly two production callers', () => {
  test('the callers are lib/home-pipeline.js and lib/home-rows.js, one call each, and nothing else', () => {
    const callers = [];
    for (const rel of productionSources()) {
      const code = codeLinesOf(readFileSync(join(ROOT, rel), 'utf8'));
      // A definition (`function buildHomeView(`) is not a call; a call is a bare `buildHomeView(` in code.
      const hits = code.match(/(?<!function\s)\bbuildHomeView\(/g) || [];
      for (let i = 0; i < hits.length; i++) callers.push(rel);
    }
    assert.deepEqual(
      callers.sort(),
      ['lib/home-pipeline.js', 'lib/home-rows.js'],
      `buildHomeView( must be called only by the shared pipeline and home-rows.js; found: ${JSON.stringify(callers)}`,
    );
  });
});

describe('W6 (c): /api/home-rows gathers inputs only (homeRowsFor builds its view once)', () => {
  test('the home-rows route calls gatherHomeInputs and never gatherHomePage', () => {
    const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
    const start = server.indexOf("app.get('/workspace/:urlKey/api/home-rows'");
    assert.ok(start >= 0, 'the /api/home-rows route must exist in server.js');
    const next = server.indexOf('app.get(', start + 1);
    const route = codeLinesOf(server.slice(start, next === -1 ? undefined : next));
    assert.match(route, /gatherHomeInputs\(homePipelineDeps\(\)/, '/api/home-rows must gather through gatherHomeInputs');
    assert.doesNotMatch(route, /gatherHomePage\(/, '/api/home-rows must not use gatherHomePage: it would build the Home view a second time per fold');
  });
});
