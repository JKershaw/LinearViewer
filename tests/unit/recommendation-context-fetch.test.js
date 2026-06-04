/**
 * Regression tests for the recommendation context fetch path (LIN-300).
 *
 * The proxy's /recommend (and sibling /recap, /brief, /status) endpoints 504'd
 * on large parent epics. Two root causes, both invisible to the e2e suite
 * (test mode short-circuits to mock data and never runs the real GraphQL or the
 * proxy timeout race):
 *
 *  1. fetchRecommendationContext re-ran the full ISSUE_DETAIL_QUERY for the
 *     focused subtask, re-traversing the parent's entire sibling/cousin subtree
 *     that the first fetch already loaded — a redundant heavy round-trip. The
 *     recommendation only consumes the child's own fields + comments, so the
 *     second fetch now uses a lean FOCUSED_CHILD_QUERY.
 *  2. The proxy capped that fetch at GRAPHQL_TIMEOUT_MS (25s) — the exact
 *     instant the armed keepalive (http-keepalive.js) flushes and starts
 *     covering for slowness — so healthy large epics 504'd. The fetch now uses
 *     a backstop budget (CONTEXT_FETCH_TIMEOUT_MS) and an AbortSignal so a trip
 *     cancels the underlying request instead of orphaning it.
 *
 * These pin the source shape so the fixes can't silently regress.
 *
 * Run with: node --test tests/unit/recommendation-context-fetch.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const linearSource = readFileSync(join(__dirname, '../../lib/linear.js'), 'utf8');
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

// Pull a named gql`...` template literal out of a source file by its const name.
function extractQuery(source, name) {
  const start = source.indexOf(`const ${name} = gql\``);
  assert.ok(start !== -1, `${name} not found`);
  const open = source.indexOf('`', start);
  const close = source.indexOf('`', open + 1);
  assert.ok(close !== -1, `Could not find end of ${name} template literal`);
  return source.slice(open + 1, close);
}

describe('focused-child fetch is lean (no redundant subtree)', () => {
  test('FOCUSED_CHILD_QUERY exists', () => {
    assert.ok(linearSource.includes('const FOCUSED_CHILD_QUERY = gql`'),
      'FOCUSED_CHILD_QUERY must exist in lib/linear.js');
  });

  test('FOCUSED_CHILD_QUERY does not re-traverse the parent epic', () => {
    const q = extractQuery(linearSource, 'FOCUSED_CHILD_QUERY');
    // The whole point: no upward parent walk, no sibling/grandchild subtree.
    assert.doesNotMatch(q, /\bparent\s*\{/, 'must not fetch the parent (avoids re-traversing siblings)');
    assert.doesNotMatch(q, /\bchildren\s*\{/, 'must not fetch children');
  });

  test('FOCUSED_CHILD_QUERY keeps the fields the recommendation consumes', () => {
    const q = extractQuery(linearSource, 'FOCUSED_CHILD_QUERY');
    // formatIssueContext + hashContext read issue description/labels/state + comments.
    assert.match(q, /\bdescription\b/, 'must select description');
    assert.match(q, /\blabels\s*\{/, 'must select labels');
    assert.match(q, /\bcomments\s*\{/, 'must select comments');
    assert.match(q, /\bstate\s*\{/, 'must select state');
  });

  test('fetchRecommendationContext uses the lean focused-child fetch, not a second full fetch', () => {
    assert.match(linearSource, /fetchFocusedChild\(\s*apiKey,\s*focusChild\.id/,
      'focused subtask must be fetched via fetchFocusedChild');
    assert.doesNotMatch(linearSource, /fetchIssueContext\(\s*apiKey,\s*focusChild\.id/,
      'must not re-run the full ISSUE_DETAIL_QUERY for the focused subtask');
  });

  test('fetchFocusedChild is exported', () => {
    assert.match(linearSource, /export async function fetchFocusedChild\b/,
      'fetchFocusedChild must be exported for direct use/testing');
  });
});

describe('recommendation context fetch stops fighting the keepalive', () => {
  test('CONTEXT_FETCH_TIMEOUT_MS backstop exists and exceeds the keepalive flush (25s)', () => {
    const m = proxySource.match(/const CONTEXT_FETCH_TIMEOUT_MS\s*=\s*([\d_]+)/);
    assert.ok(m, 'CONTEXT_FETCH_TIMEOUT_MS must be defined');
    const ms = Number(m[1].replace(/_/g, ''));
    assert.ok(ms > 25_000, `backstop (${ms}ms) must exceed the 25s keepalive flush`);
  });

  test('recommendation endpoints no longer cap the context fetch at the 25s keepalive boundary', () => {
    assert.doesNotMatch(proxySource, /withTimeout\(\s*fetchRecommendationContext/,
      'the tight GRAPHQL_TIMEOUT_MS cap on fetchRecommendationContext must be gone');
  });

  test('context fetch is abortable (signal threaded) under the backstop budget', () => {
    const calls = proxySource.match(
      /fetchWithTimeout\(\s*\(signal\)\s*=>\s*fetchRecommendationContext\(accessToken,\s*identifier,\s*\{\s*signal\s*\}\),\s*CONTEXT_FETCH_TIMEOUT_MS\)/g
    ) || [];
    // recommend + recap + brief (x2) + status = 5 sites
    assert.strictEqual(calls.length, 5,
      `all 5 recommendation-context fetches must use the abortable backstop helper (found ${calls.length})`);
  });

  test('fetchWithTimeout aborts the request and clears its timer', () => {
    const start = proxySource.indexOf('async function fetchWithTimeout');
    assert.ok(start !== -1, 'fetchWithTimeout helper must exist');
    const block = proxySource.slice(start, start + 600);
    assert.match(block, /new AbortController\(\)/, 'must create an AbortController');
    assert.match(block, /controller\.abort\(\)/, 'must abort on timeout');
    assert.match(block, /clearTimeout\(timer\)/, 'must clear its timer on settle');
    assert.match(block, /'TimeoutError'/, 'must reject with TimeoutError shape (maps to 504)');
  });
});
