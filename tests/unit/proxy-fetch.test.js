import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableError, isGraphQLMutation } from '../../lib/proxy-fetch.js';

test('isRetryableError matches transient TLS/connection errors', () => {
  assert.equal(isRetryableError(new Error('socket hang up')), true);
  assert.equal(isRetryableError(new Error('read ECONNRESET')), true);
  assert.equal(isRetryableError(new Error('connect ETIMEDOUT')), true);
  assert.equal(isRetryableError(new Error('CERTIFICATE_VERIFY_FAILED')), true);
  assert.equal(isRetryableError(new Error('TLS handshake failed')), true);
});

test('isRetryableError does not match unrelated errors', () => {
  assert.equal(isRetryableError(new Error('The operation was aborted')), false);
  assert.equal(isRetryableError(new Error('Bad Request')), false);
  assert.equal(isRetryableError({}), false);
});

test('isGraphQLMutation detects a mutation body', () => {
  const body = JSON.stringify({
    query: 'mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }',
    variables: { input: { issueId: 'x', body: 'hi' } }
  });
  assert.equal(isGraphQLMutation({ body }), true);
});

test('isGraphQLMutation treats queries (and ambiguity) as non-mutation', () => {
  // Leading whitespace before the keyword still counts as a mutation.
  assert.equal(isGraphQLMutation({ body: JSON.stringify({ query: '\n  mutation Foo { a }' }) }), true);

  // Named/anonymous queries are not mutations — they stay retryable.
  assert.equal(isGraphQLMutation({ body: JSON.stringify({ query: 'query Issues { issues { id } }' }) }), false);
  assert.equal(isGraphQLMutation({ body: JSON.stringify({ query: '{ issues { id } }' }) }), false);

  // A field merely named "mutation..." must not trip the prefix check.
  assert.equal(isGraphQLMutation({ body: JSON.stringify({ query: 'query { mutationLog { id } }' }) }), false);

  // Parse failures / missing body default to false (preserve read resilience).
  assert.equal(isGraphQLMutation({ body: 'not json' }), false);
  assert.equal(isGraphQLMutation({}), false);
  assert.equal(isGraphQLMutation({ body: JSON.stringify({ variables: {} }) }), false);
});
