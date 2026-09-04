/**
 * Regression tests for the proxy's relationship GraphQL queries.
 *
 * These pin the *shape* of two read queries the e2e suite cannot exercise: in
 * test mode there is no mock Linear server, so consumer read endpoints
 * short-circuit at upstream auth and the GraphQL is never run against a schema.
 * Both bugs below were therefore invisible to e2e:
 *
 *  - RELATIONS_QUERY declared `$issueId: ID!`, but Linear's `issue(id:)`
 *    argument is `String!`. The type mismatch fails validation for every
 *    input, so GET /api/proxy/relations/:issueId 500'd on every call.
 *  - the by-id detail query fetched only `relations` (outgoing), omitting
 *    `inverseRelations`, so GET /api/proxy/issues/:issueId could not surface
 *    blocked-by relationships.
 *
 * LIN-308 re-pointed the read endpoints onto the provider, so these read
 * queries now live in lib/providers/linear/index.js (RELATIONS_QUERY unchanged;
 * the by-id detail query is API_ISSUE_DETAIL_QUERY, relocated verbatim from the
 * route's old ISSUE_DETAIL_QUERY). LIN-309 then re-pointed the write endpoints,
 * relocating the write mutations there too (DELETE_RELATION_MUTATION et al.), so
 * the shape guards follow the code into the provider. The handler-contract
 * assertions still target routes/proxy.js, which now calls provider.* (no gql).
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
// LIN-679 Stage 3a / LIN-2536: the GET /relations handler (group D) moved to
// routes/proxy-reads.js — only the GET test below re-points.
const readsSource = readFileSync(join(__dirname, '../../routes/proxy-reads.js'), 'utf8');
// LIN-679 Stage 3b / LIN-2537: the DELETE relations handler (group E) moved to
// routes/proxy-writes.js — only the DELETE handler test below re-points.
const writesSource = readFileSync(join(__dirname, '../../routes/proxy-writes.js'), 'utf8');
const providerSource = readFileSync(join(__dirname, '../../lib/providers/linear/index.js'), 'utf8');

// Pull a named gql`...` template literal out of a source by its const name.
function extractQuery(name, source = proxySource) {
  const start = source.indexOf(`const ${name} = gql\``);
  assert.ok(start !== -1, `${name} not found in source`);
  const open = source.indexOf('`', start);
  const close = source.indexOf('`', open + 1);
  assert.ok(close !== -1, `Could not find end of ${name} template literal`);
  return source.slice(open + 1, close);
}

describe('proxy relationship queries', () => {
  test('RELATIONS_QUERY types issueId as String! (matches Linear schema)', () => {
    const q = extractQuery('RELATIONS_QUERY', providerSource);
    assert.match(q, /\$issueId:\s*String!/, 'issueId must be String!, not ID!');
    assert.doesNotMatch(q, /\$issueId:\s*ID!/, 'issueId must not be ID!');
  });

  test('RELATIONS_QUERY fetches both directions', () => {
    const q = extractQuery('RELATIONS_QUERY', providerSource);
    assert.match(q, /relations\s*\{/, 'must fetch outgoing relations');
    assert.match(q, /inverseRelations\s*\{/, 'must fetch inverseRelations');
  });

  test('RELATIONS_QUERY selects relation id (needed for delete)', () => {
    // Each relation node must expose its own `id` so consumers can discover
    // the relationId to pass to DELETE .../relations/:relationId. Scope the
    // assertion to the node fields BEFORE the nested relatedIssue/issue blocks,
    // so a nested `id` (relatedIssue { id }) can't satisfy it by accident.
    const q = extractQuery('RELATIONS_QUERY', providerSource);
    const relBlock = q.match(/relations\s*\{\s*nodes\s*\{([^}]*relatedIssue)/s);
    const invBlock = q.match(/inverseRelations\s*\{\s*nodes\s*\{([^}]*issue)/s);
    assert.ok(relBlock, 'outgoing relations node block not found');
    assert.ok(invBlock, 'inverseRelations node block not found');
    assert.match(relBlock[1], /\bid\b/, 'outgoing relation node must select id');
    assert.match(invBlock[1], /\bid\b/, 'inverse relation node must select id');
  });

  test('API_ISSUE_DETAIL_QUERY includes inverseRelations (blocked-by)', () => {
    const q = extractQuery('API_ISSUE_DETAIL_QUERY', providerSource);
    assert.match(q, /relations\s*\{/, 'must fetch outgoing relations');
    assert.match(q, /inverseRelations\s*\{/, 'must fetch inverseRelations so agents can see blockers');
  });

  test('API_ISSUE_DETAIL_QUERY selects relation id on relation nodes', () => {
    const q = extractQuery('API_ISSUE_DETAIL_QUERY', providerSource);
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
    // Relocated to the provider in LIN-309.
    const q = extractQuery('DELETE_RELATION_MUTATION', providerSource);
    assert.match(q, /issueRelationDelete\s*\(\s*id:\s*\$id\s*\)/, 'must call issueRelationDelete(id: $id)');
    assert.match(q, /\$id:\s*String!/, 'id must be String!');
  });

  test('DELETE relation handler is registered with write scope', () => {
    // Route exists, keyed on relationId, gated by requireWriteScope, and
    // validates the relation id as a UUID.
    assert.match(
      writesSource,
      /router\.delete\(\s*'\/api\/proxy\/issues\/:issueId\/relations\/:relationId'[^)]*requireWriteScope/s,
      'DELETE relations route must exist and require write scope'
    );
    const handlerStart = writesSource.indexOf("'/api/proxy/issues/:issueId/relations/:relationId'");
    const block = writesSource.slice(handlerStart, handlerStart + 1100);
    assert.match(block, /UUID_REGEX\.test\(relationId\)/, 'must validate relationId as UUID');
    // Post-LIN-309 the handler calls the provider, capability-gated, instead of
    // owning the delete mutation.
    assert.match(block, /provider\.deleteRelation\(/, 'must call provider.deleteRelation');
    // LIN-583: the gate takes the per-request provider (the workspace the write
    // will actually hit) as its first arg.
    assert.match(block, /denyIfUnsupported\(provider, 'deleteRelation'/, 'must capability-gate the write');
  });

  test('/relations handler returns flat arrays, not the {nodes} shape (LIN-310)', () => {
    // The neutral wire contract returns relations/inverseRelations as plain
    // arrays, matching /issues/{id} and the rest of the read surface after the
    // LIN-310 flatten. Re-wrapping in { nodes: [...] } would reintroduce the
    // source-revealing GraphQL shape the contract neutralization removed.
    const handlerStart = readsSource.indexOf("logEvent(req, '/api/proxy/relations', 200)");
    assert.ok(handlerStart !== -1, '/relations 200 handler not found');
    const block = readsSource.slice(handlerStart, handlerStart + 600);
    assert.match(block, /\.\.\.flattenRelations\(issueRelations\)/, 'must spread the flattened relations payload');
    assert.doesNotMatch(block, /relations:\s*\{\s*nodes:/, 'relations must NOT be wrapped as { nodes: [...] }');
    assert.doesNotMatch(block, /inverseRelations:\s*\{\s*nodes:/, 'inverseRelations must NOT be wrapped as { nodes: [...] }');
  });

  // LIN-679 Stage 3a / LIN-2536 Verification step 5 / ticket item 7: the
  // handler-local absence pin above moved to readsSource with the handler.
  // This complementary pin stays on the FULL, unscoped proxySource text so a
  // future re-introduction of the {nodes:} wrapper ANYWHERE in routes/proxy.js
  // — not just inside the (now-departed) /relations handler — cannot pass
  // silently once the scoped D-local pin no longer reads that file at all.
  test('routes/proxy.js no longer contains the {nodes} relations wrapper anywhere (LIN-310)', () => {
    assert.doesNotMatch(proxySource, /relations:\s*\{\s*nodes:/, 'relations must NOT be wrapped as { nodes: [...] } anywhere in routes/proxy.js');
    assert.doesNotMatch(proxySource, /inverseRelations:\s*\{\s*nodes:/, 'inverseRelations must NOT be wrapped as { nodes: [...] } anywhere in routes/proxy.js');
  });
});
