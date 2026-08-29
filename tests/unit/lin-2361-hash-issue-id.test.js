/**
 * LIN-2361 Item 2 — `#`-prefixed GitHub issue identifiers.
 *
 * Every Harbour surface RENDERS a GitHub issue as `#55` (see fetchIssueContext's
 * `identifier: \`#${gh.number}\``), but the shared validator (`ISSUE_ID_REGEX`,
 * lib/workspace.js) rejected the `#`, and even once accepted, a literal `#` reaching
 * client.js's REST URL interpolation would silently hit a DIFFERENT endpoint (a `#`
 * is a URL fragment delimiter), not a 404. Two independent fixes, tested independently
 * here: (1) the shared validator now accepts an optional leading `#` and other providers
 * are unaffected; (2) the GitHub provider strips it internally before ever reaching the
 * client, so a caller can pass either form and reach the identical issue.
 *
 * Run with: node --test tests/unit/lin-2361-hash-issue-id.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ISSUE_ID_REGEX, isValidIssueId } from '../../lib/workspace.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';

const REPO = 'octocat/hello-world';

function seededProvider() {
  return new GitHubProvider({
    client: createFakeGitHubClient({
      [REPO]: {
        issues: [
          {
            number: 55, title: 'A real open issue', body: 'residual boundary', state: 'open',
            html_url: `https://github.com/${REPO}/issues/55`, created_at: '2026-01-01T00:00:00Z',
            user: { login: 'alice' }, labels: [{ name: 'bug' }],
            comments: [{ id: 1, body: 'hi', created_at: '2026-01-02T00:00:00Z', user: { login: 'bob' } }],
          },
        ],
        labels: [{ name: 'bug', color: 'd73a4a' }],
      },
    }),
    repo: REPO,
  });
}

describe('ISSUE_ID_REGEX / isValidIssueId — accepts an optional leading # (LIN-2361)', () => {
  test('accepts a #-prefixed GitHub-style identifier', () => {
    assert.equal(isValidIssueId('#55'), true);
    assert.match('#55', ISSUE_ID_REGEX);
  });

  test('still accepts bare identifiers and UUID-shaped ids (no regression)', () => {
    assert.equal(isValidIssueId('55'), true);
    assert.equal(isValidIssueId('LIN-123'), true);
    assert.equal(isValidIssueId('WEB2-7'), true);
    assert.equal(isValidIssueId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
  });

  test('still rejects the obviously malformed', () => {
    assert.equal(isValidIssueId(''), false);
    assert.equal(isValidIssueId('##55'), false);
    assert.equal(isValidIssueId('55#'), false);
    assert.equal(isValidIssueId('LIN 123'), false);
    assert.equal(isValidIssueId(null), false);
    assert.equal(isValidIssueId(undefined), false);
  });
});

describe('GitHubProvider strips the leading # before reaching the REST client (LIN-2361)', () => {
  test('fetchIssueFields("#55") reaches the identical issue as fetchIssueFields("55")', async () => {
    const provider = seededProvider();
    const withHash = await provider.fetchIssueFields(REPO, '#55');
    const bare = await provider.fetchIssueFields(REPO, '55');
    assert.deepEqual(withHash, bare);
    assert.equal(withHash.id, '55');
  });

  test('fetchIssueContext("#55") reaches the identical issue as fetchIssueContext("55"), including nested comments', async () => {
    const provider = seededProvider();
    const withHash = await provider.fetchIssueContext(REPO, '#55');
    const bare = await provider.fetchIssueContext(REPO, '55');
    assert.deepEqual(withHash, bare);
    assert.equal(withHash.issue.identifier, '#55'); // rendering is unaffected — # comes back out
    assert.equal(withHash.comments.length, 1);
  });

  test('fetchRecommendationContext("#55") delegates through the same strip', async () => {
    const provider = seededProvider();
    const ctx = await provider.fetchRecommendationContext(REPO, '#55');
    assert.equal(ctx.issue.id, '55');
  });

  test('fetchIssueComments("#55") reaches the identical comments as "55"', async () => {
    const provider = seededProvider();
    const withHash = await provider.fetchIssueComments(REPO, '#55');
    const bare = await provider.fetchIssueComments(REPO, '55');
    assert.deepEqual(withHash, bare);
    assert.equal(withHash.length, 1);
  });

  test('write paths (updateIssue, createComment, addLabel/removeLabel) also strip', async () => {
    const provider = seededProvider();
    const updated = await provider.updateIssue(REPO, '#55', { title: 'renamed' });
    assert.equal(updated.title, 'renamed');

    const comment = await provider.createComment(REPO, '#55', 'a new comment');
    assert.equal(comment.body, 'a new comment');

    assert.equal(await provider.addLabel(REPO, '#55', 'enhancement'), true);
    const labels = await provider.issueLabels(REPO, '#55');
    assert.ok(labels.labels.nodes.some(l => l.name === 'enhancement'));
    assert.equal(await provider.removeLabel(REPO, '#55', 'enhancement'), true);
  });

  test('issueWriteGuard / issueDescription / updateIssueLabels also strip (the route-internal guard reads)', async () => {
    const provider = seededProvider();
    assert.equal((await provider.issueWriteGuard(REPO, '#55')).id, '55');
    assert.equal((await provider.issueDescription(REPO, '#55')).description, 'residual boundary');
    const result = await provider.updateIssueLabels(REPO, '#55', ['bug']);
    assert.equal(result.success, true);
  });

  test('without the strip, a literal # would silently miss (the hazard this fix closes)', async () => {
    // Regression guard on the FAKE CLIENT'S OWN behavior, proving stripping is load-bearing:
    // getIssue compares String(i.number) === String(number), so an unstripped '#55' simply
    // does not match '55' and the issue is "not found" — the in-memory analogue of the real
    // REST client silently hitting a different endpoint on an unstripped '#'.
    const provider = seededProvider();
    const { client, repo } = provider._clientFor(REPO);
    const raw = await client.getIssue(repo, '#55'); // no stripping — simulates the pre-fix path
    assert.equal(raw, null);
  });
});
