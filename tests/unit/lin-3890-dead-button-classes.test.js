// LIN-3890 (button-class gate, decision 4): five button-like class names have no emitter, so their
// rules are deleted. Each name is checked against every production emitter (the server renderers,
// the routes and the client scripts), template literals included, so a deletion cannot take a
// live element's look with it. If one of these gains an emitter again, this fails: restore the rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DEAD = ['btn--teal', 'provider-add-btn', 'provider-remove-btn', 'roadmap-generate-btn', 'ai-btn'];

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const EMITTER_SOURCES = [
  ...files(join(ROOT, 'lib')),
  ...files(join(ROOT, 'routes')),
  ...readdirSync(join(ROOT, 'public')).filter((f) => /\.js$/.test(f) && !f.endsWith('.min.js')).map((f) => join(ROOT, 'public', f)),
  join(ROOT, 'server.js'),
];

for (const name of DEAD) {
  test(`no production code emits the class "${name}"`, () => {
    // A whole class token: not part of a longer name (`settings-provider-add-btn` is a testid, not the class).
    const token = new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}(?![\\w-])`);
    const hits = EMITTER_SOURCES
      .filter((f) => token.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    assert.deepEqual(hits, [], `"${name}" is emitted by ${hits.join(', ')}`);
  });
}
