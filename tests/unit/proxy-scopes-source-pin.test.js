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
    path: 'routes/dispatch.js',
    specifier: '../lib/proxy-scopes.js',
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
