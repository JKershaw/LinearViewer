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
import { mergeAncestorAttachments } from '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// LIN-330: the Linear fetchers + FOCUSED_CHILD_QUERY moved out of lib/linear.js
// (now a thin shim) into the Linear provider. The LIN-300 leanness guardrails
// pinned here now live at their new home, so we read the provider source.
const linearSource = readFileSync(join(__dirname, '../../lib/providers/linear/index.js'), 'utf8');
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
      'FOCUSED_CHILD_QUERY must exist in the Linear provider');
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

// =============================================================================
// LIN-772: attachments threaded through the context fetch. ISSUE_DETAIL_QUERY
// must select the formal attachments connection, and fetchIssueContext must feed
// the description + those nodes through the shared collector (collectIssueAttachments)
// and return the result as a top-level context.attachments. Source-pinned (this
// path runs real GraphQL, which the e2e suite mocks away), mirroring the LIN-300
// guardrails above.
// =============================================================================
describe('attachments threaded through context fetch (LIN-772)', () => {
  test('ISSUE_DETAIL_QUERY selects the formal attachments connection', () => {
    const q = extractQuery(linearSource, 'ISSUE_DETAIL_QUERY');
    assert.match(q, /attachments\(first:\s*50\)\s*\{\s*nodes\s*\{\s*id\s+title\s+url/,
      'must select attachments { nodes { id title url } } so the collector can build handles');
  });

  test('fetchIssueContext builds context.attachments via the shared collector', () => {
    assert.match(linearSource, /import\s*\{\s*collectIssueAttachments\s*\}\s*from\s*'\.\.\/\.\.\/proxy-wire\.js'/,
      'must reuse the shared collector, not a per-surface attachment gather');
    assert.match(linearSource,
      /collectIssueAttachments\(\{\s*description:\s*issue\.description,\s*formalAttachmentNodes:\s*issue\.attachments\s*\}\)/,
      'must feed description + formal nodes through the collector (issue-level set, matching the wire contract)');
    assert.match(linearSource, /\n\s*attachments\n\s*\}\n\s*\}/,
      'fetchIssueContext must return attachments as a top-level context field');
  });
});

// =============================================================================
// LIN-773 S4: ancestor attachment provenance. A descendant read must surface a
// parent's attachments tagged inherited + owner (the LIN-748 rollback cause), via
// a bounded walk up the parent chain — NOT hardcoded depth-1, and NOT by widening
// the existing depth-1 `parent { … }` relationship selection. The walk + query are
// source-pinned (real GraphQL the e2e suite mocks away); the merge/dedupe/provenance
// is exercised functionally through the exported pure mergeAncestorAttachments.
// =============================================================================
describe('ancestor attachment provenance (LIN-773 S4)', () => {
  test('a dedicated ANCESTOR_QUERY exists, separate from the parent relationship selection', () => {
    assert.ok(linearSource.includes('const ANCESTOR_QUERY = gql`'),
      'a dedicated ANCESTOR_QUERY must own the ancestor-attachment walk');
    const q = extractQuery(linearSource, 'ANCESTOR_QUERY');
    assert.match(q, /attachments\(first:\s*50\)\s*\{\s*nodes\s*\{\s*id\s+title\s+url/,
      'ANCESTOR_QUERY must select each ancestor\'s attachments so the collector can build handles');
    assert.match(q, /parent\s*\{\s*id\s*\}/, 'ANCESTOR_QUERY must select parent { id } so the walk can climb');
  });

  test('the walk depth is a configurable bound, not hardcoded depth-1', () => {
    const m = linearSource.match(/const ANCESTOR_ATTACHMENT_MAX_DEPTH\s*=\s*(\d+)/);
    assert.ok(m, 'a named ANCESTOR_ATTACHMENT_MAX_DEPTH const must bound the walk');
    assert.ok(Number(m[1]) >= 1, 'the bound must allow at least the LIN-748 depth-1 case');
    assert.match(linearSource, /depth\s*<\s*ANCESTOR_ATTACHMENT_MAX_DEPTH/,
      'the walk must stop on the configurable depth bound');
  });

  test('fetchIssueContext climbs the parent chain via the dedicated walk and merges provenance', () => {
    assert.match(linearSource, /fetchAncestorChain\(\s*client,\s*parent\.id/,
      'fetchIssueContext must climb from the parent via the dedicated ancestor walk');
    assert.match(linearSource, /mergeAncestorAttachments\(\s*ownAttachments,\s*ancestors\s*\)/,
      'own + ancestor attachments must merge through the provenance-preserving helper');
    // The S3-pinned own-attachments collector call must survive unchanged.
    assert.match(linearSource,
      /collectIssueAttachments\(\{\s*description:\s*issue\.description,\s*formalAttachmentNodes:\s*issue\.attachments\s*\}\)/,
      'the issue\'s own attachment set is still built by the shared collector');
  });

  test('merge tags inherited items with owner and leaves own items untagged (LIN-748 depth-1)', () => {
    const own = [{ id: 'att:own', title: 'own.png', kind: 'image' }];
    const ancestors = [{
      identifier: 'LIN-748',
      title: 'Parent epic',
      description: 'see ![spec](https://uploads.linear.app/aaaa/spec.md)',
      attachments: { nodes: [{ id: 'formal-1', title: 'design.md', url: 'https://uploads.linear.app/bbbb/design.md' }] }
    }];
    const merged = mergeAncestorAttachments(own, ancestors);
    const ownItem = merged.find(a => a.id === 'att:own');
    assert.ok(!ownItem.inherited && ownItem.owner === undefined, 'own attachment stays untagged');
    const inherited = merged.filter(a => a.inherited);
    assert.ok(inherited.length >= 1, 'a descendant surfaces the parent\'s inherited attachments');
    assert.ok(inherited.every(a => a.owner === 'LIN-748 Parent epic'),
      'each inherited attachment names its owning ancestor (identifier + title)');
  });

  test('dedupe by handle id with the nearest owner winning', () => {
    // Own items are already collector-shaped (att: handles); ancestor formal nodes
    // carry RAW ids that the collector re-encodes to att:<id>, so `shared`→`att:shared`.
    const own = [{ id: 'att:shared', title: 'mine', kind: 'file' }];
    const ancestors = [
      { identifier: 'LIN-700', title: 'Near', description: null,
        attachments: { nodes: [{ id: 'shared', title: 't', url: 'x' }, { id: 'near', title: 'n', url: 'y' }] } },
      { identifier: 'LIN-600', title: 'Far', description: null,
        attachments: { nodes: [{ id: 'near', title: 't', url: 'z' }] } }
    ];
    const merged = mergeAncestorAttachments(own, ancestors);
    // att:shared resolves to the OWN copy (nearest of all), still untagged.
    assert.strictEqual(merged.filter(a => a.id === 'att:shared').length, 1, 'shared handle surfaces once');
    assert.ok(!merged.find(a => a.id === 'att:shared').inherited, 'own copy of a shared handle wins over an ancestor');
    // att:near appears in both ancestors; the nearer (LIN-700) wins.
    const near = merged.filter(a => a.id === 'att:near');
    assert.strictEqual(near.length, 1, 'a handle shared across ancestors surfaces once');
    assert.strictEqual(near[0].owner, 'LIN-700 Near', 'the nearest ancestor owns a shared handle');
  });

  test('no-ancestor-uploads / empty cases pass the own array through unchanged', () => {
    const own = [{ id: 'att:a', title: 'a', kind: 'file' }];
    assert.deepStrictEqual(mergeAncestorAttachments(own, []), own, 'no ancestors → own array unchanged');
    assert.deepStrictEqual(mergeAncestorAttachments(own), own, 'omitted ancestors → own array unchanged');
    assert.deepStrictEqual(
      mergeAncestorAttachments(own, [{ identifier: 'LIN-1', title: 'x', description: null, attachments: { nodes: [] } }]),
      own, 'an ancestor with no uploads adds nothing');
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
    // The recommend site additionally threads `noDescend` (LIN-365) into the options
    // bag; the abortable backstop contract still holds, so allow that optional arg.
    const calls = proxySource.match(
      /fetchWithTimeout\(\s*\(signal\)\s*=>\s*fetchRecommendationContext\(accessToken,\s*identifier,\s*\{\s*signal(?:,\s*noDescend)?\s*\}\),\s*CONTEXT_FETCH_TIMEOUT_MS\)/g
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
