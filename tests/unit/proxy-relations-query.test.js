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
 *    `inverseRelations`, so GET /api/proxy/issues/:issueId could not surface
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

  test('RELATIONS_QUERY selects relation id (needed for delete)', () => {
    // Each relation node must expose its own `id` so consumers can discover
    // the relationId to pass to DELETE .../relations/:relationId. Scope the
    // assertion to the node fields BEFORE the nested relatedIssue/issue blocks,
    // so a nested `id` (relatedIssue { id }) can't satisfy it by accident.
    const q = extractQuery('RELATIONS_QUERY');
    const relBlock = q.match(/relations\s*\{\s*nodes\s*\{([^}]*relatedIssue)/s);
    const invBlock = q.match(/inverseRelations\s*\{\s*nodes\s*\{([^}]*issue)/s);
    assert.ok(relBlock, 'outgoing relations node block not found');
    assert.ok(invBlock, 'inverseRelations node block not found');
    assert.match(relBlock[1], /\bid\b/, 'outgoing relation node must select id');
    assert.match(invBlock[1], /\bid\b/, 'inverse relation node must select id');
  });

  test('ISSUE_DETAIL_QUERY includes inverseRelations (blocked-by)', () => {
    const q = extractQuery('ISSUE_DETAIL_QUERY');
    assert.match(q, /relations\s*\{/, 'must fetch outgoing relations');
    assert.match(q, /inverseRelations\s*\{/, 'must fetch inverseRelations so agents can see blockers');
  });

  test('ISSUE_DETAIL_QUERY selects relation id on relation nodes', () => {
    const q = extractQuery('ISSUE_DETAIL_QUERY');
    // Isolate the two relation node blocks (relatedIssue = outgoing,
    // issue-keyed = inverse) and confirm both carry id.
    const relBlock = q.match(/relations\s*\{\s*nodes\s*\{([^}]*relatedIssue)/s);
    const invBlock = q.match(/inverseRelations\s*\{\s*nodes\s*\{([^}]*issue)/s);
    assert.ok(relBlock, 'outgoing relations node block not found');
    assert.ok(invBlock, 'inverseRelations node block not found');
    assert.match(relBlock[1], /\bid\b/, 'outgoing relation node must select id');
    assert.match(invBlock[1], /\bid\b/, 'inverse relation node must select id');
  });

  test('DELETE_RELATION_MUTATION deletes by relation id', () => {
    const q = extractQuery('DELETE_RELATION_MUTATION');
    assert.match(q, /issueRelationDelete\s*\(\s*id:\s*\$id\s*\)/, 'must call issueRelationDelete(id: $id)');
    assert.match(q, /\$id:\s*String!/, 'id must be String!');
  });

  test('DELETE relation handler is registered with write scope', () => {
    // Route exists, keyed on relationId, gated by requireWriteScope, and
    // validates the relation id as a UUID.
    assert.match(
      proxySource,
      /router\.delete\(\s*'\/api\/proxy\/issues\/:issueId\/relations\/:relationId'[^)]*requireWriteScope/s,
      'DELETE relations route must exist and require write scope'
    );
    const handlerStart = proxySource.indexOf("'/api/proxy/issues/:issueId/relations/:relationId'");
    const block = proxySource.slice(handlerStart, handlerStart + 800);
    assert.match(block, /UUID_REGEX\.test\(relationId\)/, 'must validate relationId as UUID');
    assert.match(block, /DELETE_RELATION_MUTATION/, 'must call the delete mutation');
  });

  test('/relations handler returns flat arrays, not the {nodes} shape (LIN-310)', () => {
    // The neutral wire contract returns relations/inverseRelations as plain
    // arrays, matching /issues/{id} and the rest of the read surface after the
    // LIN-310 flatten. Re-wrapping in { nodes: [...] } would reintroduce the
    // source-revealing GraphQL shape the contract neutralization removed.
    const handlerStart = proxySource.indexOf("logEvent(req, '/api/proxy/relations', 200)");
    assert.ok(handlerStart !== -1, '/relations 200 handler not found');
    const block = proxySource.slice(handlerStart, handlerStart + 600);
    assert.match(block, /\.\.\.flattenRelations\(data\.issue\)/, 'must spread the flattened relations payload');
    assert.doesNotMatch(block, /relations:\s*\{\s*nodes:/, 'relations must NOT be wrapped as { nodes: [...] }');
    assert.doesNotMatch(block, /inverseRelations:\s*\{\s*nodes:/, 'inverseRelations must NOT be wrapped as { nodes: [...] }');
  });
});
