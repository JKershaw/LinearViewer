/**
 * Regression tests for the proxy's relationship GraphQL queries.
 *
 * These pin the *shape* of two queries in routes/proxy.js that the e2e suite
 * cannot exercise: in test mode there is no mock Linear server, so consumer
 * read endpoints short-circuit at upstream auth and the GraphQL is never run
 * against a schema. Both bugs below were therefore invisible to e2e:
 *
 *  - RELATIONS_QUERY declared `$issueId: ID!`, but Linear's `issue(id:)`
 *    argument is `String!`. The type mismatch fails validation for every
 *    input, so GET /api/proxy/relations/:issueId 500'd on every call.
 *  - ISSUE_DETAIL_QUERY fetched only `relations` (outgoing), omitting
 *    `inverseRelations`, so GET /api/proxy/issue/:issueId could not surface
 *    blocked-by relationships.
 *
 * Run with: node --test tests/unit/proxy-relations-query.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

// Pull a named gql`...` template literal out of the source by its const name.
function extractQuery(name) {
  const start = proxySource.indexOf(`const ${name} = gql\``);
  assert.ok(start !== -1, `${name} not found in routes/proxy.js`);
  const open = proxySource.indexOf('`', start);
  const close = proxySource.indexOf('`', open + 1);
  assert.ok(close !== -1, `Could not find end of ${name} template literal`);
  return proxySource.slice(open + 1, close);
}

describe('proxy relationship queries', () => {
  test('RELATIONS_QUERY types issueId as String! (matches Linear schema)', () => {
    const q = extractQuery('RELATIONS_QUERY');
    assert.match(q, /\$issueId:\s*String!/, 'issueId must be String!, not ID!');
    assert.doesNotMatch(q, /\$issueId:\s*ID!/, 'issueId must not be ID!');
  });

  test('RELATIONS_QUERY fetches both directions', () => {
    const q = extractQuery('RELATIONS_QUERY');
    assert.match(q, /relations\s*\{/, 'must fetch outgoing relations');
    assert.match(q, /inverseRelations\s*\{/, 'must fetch inverseRelations');
  });

  test('ISSUE_DETAIL_QUERY includes inverseRelations (blocked-by)', () => {
    const q = extractQuery('ISSUE_DETAIL_QUERY');
    assert.match(q, /relations\s*\{/, 'must fetch outgoing relations');
    assert.match(q, /inverseRelations\s*\{/, 'must fetch inverseRelations so agents can see blockers');
  });
});
