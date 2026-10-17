/**
 * LIN-3129 S1 step 1 — source pin for the five A2 sites.
 *
 * The plan's invariant is "one vocabulary": the three enforcement/validation
 * sites and the two hard-coded runner mint values must import the shared
 * module rather than re-spell a `readWrite` literal. This is a source-text pin
 * because the sites differ in shape (a comparison, two array-membership checks
 * and two object literals) and a runtime probe of each would need five
 * different harnesses; the pin is the cheap, total guard the plan asks for.
 *
 * Mutation witness (recorded in the beat report): reverting any single site's
 * import/usage makes the corresponding assertion below fail; restoring it
 * returns green.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = (rel) => readFileSync(join(__dirname, '../../', rel), 'utf8');

const SITES = [
  {
    path: 'routes/proxy.js',
    specifier: '../lib/proxy-scopes.js',
    imports: ['READ_WRITE'],
    usage: 'req.proxyTokenScope !== READ_WRITE',
  },
  {
    path: 'lib/proxy-tokens.js',
    specifier: './proxy-scopes.js',
    imports: ['SCOPES'],
    usage: 'SCOPES.includes(scope)',
  },
  {
    path: 'routes/proxy-tokens-admin.js',
    specifier: '../lib/proxy-scopes.js',
    imports: ['SCOPES'],
    usage: 'SCOPES.includes(scope)',
  },
  {
    // LIN-3601: the refire broker's inline mint (`scope: READ_WRITE`) sits in the
    // dispatch entrances, which are one unit: routes/dispatch.js today, but it may move
    // to any of these. `'readWrite'` and READ_WRITE are the same value, so no
    // behaviour test can tell the constant from a literal; this stays a source pin,
    // now over the unit (at least one entrance file must import the module and use the
    // constant), not over one file.
    path: 'routes/dispatch.js',
    unit: [
      { path: 'routes/dispatch.js', specifier: '../lib/proxy-scopes.js' },
      { path: 'routes/proxy-dispatch.js', specifier: '../lib/proxy-scopes.js' },
      { path: 'routes/proxy-kickoff.js', specifier: '../lib/proxy-scopes.js' },
      { path: 'lib/dispatch-entrance.js', specifier: './proxy-scopes.js' },
    ],
    imports: ['READ_WRITE'],
    usage: 'scope: READ_WRITE',
  },
  {
    path: 'lib/proxy-preamble.js',
    specifier: './proxy-scopes.js',
    imports: ['READ_WRITE'],
    usage: 'scope: READ_WRITE',
  },
];

describe('LIN-3129 — the five A2 sites import the shared scope/grant vocabulary', () => {
  for (const site of SITES) {
    if (site.unit) {
      test(`the dispatch entrances import the shared scope module and use the constant (${site.usage})`, () => {
        // Judged as a unit: some entrance file imports the shared module and references
        // each name, and some entrance file uses the constant. The import and the use
        // need not sit in the same file as they do today, so a move of the broker's
        // inline mint into another entrance file (with its import) is not a failure.
        const sources = site.unit.map((member) => ({ ...member, src: source(member.path) }));
        assert.ok(
          sources.some((m) => m.src.includes(`from '${m.specifier}'`)),
          `at least one of ${site.unit.map((m) => m.path).join(', ')} must import the shared module`
        );
        for (const name of site.imports) {
          assert.ok(
            sources.some((m) => m.src.includes(`from '${m.specifier}'`) && new RegExp(`\\b${name}\\b`).test(m.src)),
            `an entrance file must import and reference ${name}`
          );
        }
        assert.ok(
          sources.some((m) => m.src.includes(site.usage)),
          `at least one of ${site.unit.map((m) => m.path).join(', ')} must use the shared constant: expected "${site.usage}"`
        );
      });
      continue;
    }
    test(`${site.path} imports from ${site.specifier} and uses the constant`, () => {
      const src = source(site.path);
      assert.ok(
        src.includes(`from '${site.specifier}'`),
        `${site.path} must import the shared module (from '${site.specifier}')`
      );
      for (const name of site.imports) {
        assert.ok(
          new RegExp(`\\b${name}\\b`).test(src),
          `${site.path} must reference ${name}`
        );
      }
      assert.ok(
        src.includes(site.usage),
        `${site.path} must use the shared constant: expected "${site.usage}"`
      );
    });
  }
});
