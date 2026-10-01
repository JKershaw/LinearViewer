/**
 * Unit tests for the LIN-3200 bounded GitHub PR-files read (P2).
 *
 * Every case injects `doFetch`; nothing here touches the network. The owner
 * allowlist is passed explicitly so the tests are independent of the ambient
 * env.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGitHubOwnerAllowlist,
  parseEvidencePrUrls,
  fetchPrFiles,
  collectPrFiles,
  clearPrFilesCache,
  OPEN_PR_CACHE_TTL_MS,
  CLOSED_PR_CACHE_TTL_MS,
  MAX_PRS_PER_DISPATCH,
  GITHUB_OWNERS_ENV
} from '../../lib/github-pr-files.js';

const OWNERS = new Set(['LinearViewer']);

function artifact(url, timestamp = null) {
  return { url, timestamp };
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

function status(code) {
  return { ok: false, status: code, json: async () => ({ message: 'nope' }) };
}

beforeEach(() => clearPrFilesCache());

describe('parseGitHubOwnerAllowlist', () => {
  test('empty/unset ⇒ empty set; splits, trims and validates entries', () => {
    assert.equal(parseGitHubOwnerAllowlist({}).size, 0);
    assert.equal(parseGitHubOwnerAllowlist({ [GITHUB_OWNERS_ENV]: '   ' }).size, 0);
    const set = parseGitHubOwnerAllowlist({ [GITHUB_OWNERS_ENV]: 'LinearViewer, bad/owner ,Other' });
    assert.ok(set.has('LinearViewer'));
    assert.ok(set.has('Other'));
    assert.equal(set.size, 2);
  });
});

describe('parseEvidencePrUrls', () => {
  test('empty allowlist ⇒ [] (no PR files available)', () => {
    assert.deepEqual(parseEvidencePrUrls([artifact('https://github.com/LinearViewer/x/pull/1')], { ownerAllowlist: new Set() }), []);
  });

  test('matches the fixed pattern, strips query/fragment, dedupes, newest first', () => {
    const artifacts = [
      artifact('https://github.com/LinearViewer/repo/pull/1', '2026-09-01T00:00:00Z'),
      artifact('https://github.com/LinearViewer/repo/pull/2?diff=split#x', '2026-09-02T00:00:00Z'),
      artifact('https://github.com/LinearViewer/repo/pull/1', '2026-09-03T00:00:00Z')
    ];
    const prs = parseEvidencePrUrls(artifacts, { ownerAllowlist: OWNERS });
    assert.deepEqual(prs.map(p => `${p.owner}/${p.repo}#${p.number}`), ['LinearViewer/repo#2', 'LinearViewer/repo#1']);
  });

  test('drops non-PR URLs, non-allowlisted owners, and lookalike hosts', () => {
    const artifacts = [
      artifact('https://github.com/evil/repo/pull/1'),
      artifact('https://github.com.evil.com/LinearViewer/repo/pull/1'),
      artifact('https://github.com/LinearViewer/repo/issues/1'),
      artifact('https://linear.app/LinearViewer/issue/LIN-1'),
      artifact('not a url')
    ];
    assert.deepEqual(parseEvidencePrUrls(artifacts, { ownerAllowlist: OWNERS }), []);
  });
});

describe('fetchPrFiles', () => {
  test('reads changed file names and returns {repo, path}', async () => {
    const doFetch = async (url) => {
      if (url.endsWith('/files?per_page=100')) return ok([{ filename: 'lib/a.js' }, { filename: 'routes/b.js' }]);
      return ok({ state: 'open' });
    };
    const files = await fetchPrFiles(doFetch, { owner: 'LinearViewer', repo: 'repo', number: 5, owners: OWNERS, now: 1000 });
    assert.deepEqual(files, [
      { repo: 'repo', path: 'lib/a.js' },
      { repo: 'repo', path: 'routes/b.js' }
    ]);
  });

  test('404, 403 and a non-2xx files read all degrade to []', async () => {
    assert.deepEqual(await fetchPrFiles(async () => status(404), { owner: 'LinearViewer', repo: 'repo', number: 5, owners: OWNERS, now: 1000 }), []);
    clearPrFilesCache();
    assert.deepEqual(await fetchPrFiles(async () => status(403), { owner: 'LinearViewer', repo: 'repo', number: 5, owners: OWNERS, now: 1000 }), []);
    clearPrFilesCache();
    const filesFails = async (url) => url.endsWith('/files?per_page=100') ? status(500) : ok({ state: 'open' });
    assert.deepEqual(await fetchPrFiles(filesFails, { owner: 'LinearViewer', repo: 'repo', number: 5, owners: OWNERS, now: 1000 }), []);
  });

  test('a timeout degrades to [] and never throws', async () => {
    const never = () => new Promise(() => {});
    const files = await fetchPrFiles(never, { owner: 'LinearViewer', repo: 'repo', number: 5, owners: OWNERS, timeoutMs: 5, now: 1000 });
    assert.deepEqual(files, []);
  });

  test('non-allowlisted owner and malformed inputs never fetch', async () => {
    let calls = 0;
    const doFetch = async () => { calls++; return ok([]); };
    assert.deepEqual(await fetchPrFiles(doFetch, { owner: 'evil', repo: 'repo', number: 5, owners: OWNERS }), []);
    assert.deepEqual(await fetchPrFiles(doFetch, { owner: 'LinearViewer', repo: 'repo', number: 'x', owners: OWNERS }), []);
    assert.equal(calls, 0);
  });

  test('cache: open PR refetches after 60s, closed PR stays cached for 24h', async () => {
    let openCalls = 0;
    const openFetch = async (url) => {
      openCalls++;
      return url.endsWith('/files?per_page=100') ? ok([{ filename: 'lib/old.js' }]) : ok({ state: 'open' });
    };
    await fetchPrFiles(openFetch, { owner: 'LinearViewer', repo: 'repo', number: 1, owners: OWNERS, now: 1000 });
    await fetchPrFiles(openFetch, { owner: 'LinearViewer', repo: 'repo', number: 1, owners: OWNERS, now: 1000 + OPEN_PR_CACHE_TTL_MS + 1 });
    assert.equal(openCalls, 4, 'open PR: 2 requests on the first read, 2 on the refetch');

    clearPrFilesCache();
    let closedCalls = 0;
    const closedFetch = async (url) => {
      closedCalls++;
      return url.endsWith('/files?per_page=100') ? ok([{ filename: 'lib/merged.js' }]) : ok({ state: 'closed', merged_at: '2026-01-01' });
    };
    const first = await fetchPrFiles(closedFetch, { owner: 'LinearViewer', repo: 'repo', number: 2, owners: OWNERS, now: 1000 });
    const later = await fetchPrFiles(closedFetch, { owner: 'LinearViewer', repo: 'repo', number: 2, owners: OWNERS, now: 1000 + CLOSED_PR_CACHE_TTL_MS - 1 });
    assert.deepEqual(first, later);
    assert.equal(closedCalls, 2, 'closed PR: served from cache on the second read');
  });
});

describe('collectPrFiles', () => {
  test('newest first, at most MAX_PRS_PER_DISPATCH', async () => {
    const artifacts = Array.from({ length: MAX_PRS_PER_DISPATCH + 2 }, (_, i) =>
      artifact(`https://github.com/LinearViewer/repo/pull/${i + 1}`, `2026-09-0${i + 1}T00:00:00Z`));
    const seen = [];
    const files = await collectPrFiles(async () => ok([]), {
      artifacts,
      ownerAllowlist: OWNERS,
      now: 1000,
      fetchImpl: async (_doFetch, { number }) => { seen.push(number); return [{ repo: 'repo', path: `lib/${number}.js` }]; }
    });
    assert.equal(seen.length, MAX_PRS_PER_DISPATCH);
    assert.deepEqual(seen, [5, 4, 3]);
    assert.equal(files.length, MAX_PRS_PER_DISPATCH);
  });

  test('empty owner list ⇒ nothing fetched', async () => {
    let calls = 0;
    const files = await collectPrFiles(async () => { calls++; return ok([]); }, {
      artifacts: [artifact('https://github.com/LinearViewer/repo/pull/1')],
      ownerAllowlist: new Set(),
      fetchImpl: async () => { calls++; return []; }
    });
    assert.deepEqual(files, []);
    assert.equal(calls, 0);
  });
});
