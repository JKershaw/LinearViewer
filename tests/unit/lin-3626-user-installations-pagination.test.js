/**
 * LIN-3626: GET /user/installations is walked (bounded), not read as one page of
 * 100, and the walk's truncation truth reaches the callers (re-bind picker,
 * LIN-3404 membership check). No network: every read goes through an injected
 * fetchImpl or the existing provider fakes.
 *
 * Run with: node --test tests/unit/lin-3626-user-installations-pagination.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createGitHubClient } from '../../lib/providers/github/client.js';
import { listUserInstallations } from '../../lib/providers/github/app-auth.js';
import { walkInstallationPages } from '../../lib/providers/github/installation-pages.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { installationIdsOf } from '../../lib/github-install-flow.js';
import { renderGitHubProjectSelectPage } from '../../lib/render-pages.js';

const insts = (from, n) => Array.from({ length: n }, (_, i) => ({ id: from + i, account: { login: `acct${from + i}` } }));

// A fetch stub serving `total` installations 100 per page; `omitTotal` drops the
// envelope's total_count. Records every requested URL.
function pagedFetch({ total, omitTotal = false, failOnPage = null }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page') || 1);
    if (failOnPage === page) {
      return { ok: false, status: 502, statusText: 'Bad Gateway', text: async () => '{"message":"upstream"}' };
    }
    const start = (page - 1) * 100;
    const body = { installations: insts(start + 1, Math.max(0, Math.min(100, total - start))) };
    if (!omitTotal) body.total_count = total;
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

const readers = {
  'Issues client': (fetchImpl, opts) => createGitHubClient({ token: 't', fetchImpl }).listUserInstallations(opts),
  'App-auth reader': (fetchImpl, opts) => listUserInstallations('tok', { fetchImpl, ...opts }),
};

for (const [name, read] of Object.entries(readers)) {
  describe(`${name}: /user/installations pagination`, () => {
    test('exactly 100 with total_count 100 is one request, not truncated', async () => {
      const { calls, fetchImpl } = pagedFetch({ total: 100 });
      const out = await read(fetchImpl);
      assert.equal(out.length, 100);
      assert.equal(calls.length, 1);
      assert.equal(calls[0], 'https://api.github.com/user/installations?per_page=100', 'page 1 URL is byte-identical to the pre-pagination call');
      assert.ok(!('truncated' in out));
    });

    test('101 walks to page 2 and is complete', async () => {
      const { calls, fetchImpl } = pagedFetch({ total: 101 });
      const out = await read(fetchImpl);
      assert.equal(out.length, 101);
      assert.equal(calls.length, 2);
      assert.equal(calls[1], 'https://api.github.com/user/installations?per_page=100&page=2');
      assert.ok(out.some((i) => i.id === 101), 'the page-2 installation is present');
      assert.ok(!('truncated' in out));
    });

    test('a missing total_count with a full page fetches the next page (no false complete at exactly 100)', async () => {
      const { calls, fetchImpl } = pagedFetch({ total: 100, omitTotal: true });
      const out = await read(fetchImpl);
      assert.equal(out.length, 100);
      assert.equal(calls.length, 2, 'a full page with no total_count must be followed by another request');
      assert.ok(!('truncated' in out), 'the empty page 2 proves the read complete');
    });

    test('hitting the cap with more remaining is flagged truncated', async () => {
      const { calls, fetchImpl } = pagedFetch({ total: 1000 });
      const out = await read(fetchImpl, { cap: 200 });
      assert.equal(out.length, 200);
      assert.equal(calls.length, 2);
      assert.equal(out.truncated, true);
    });

    test('a cap that is not a multiple of 100 still flags the clipped read truncated', async () => {
      const { fetchImpl } = pagedFetch({ total: 200 });
      const out = await read(fetchImpl, { cap: 150 });
      assert.equal(out.length, 150);
      assert.equal(out.truncated, true, 'rows were clipped off the last page, so the read is not complete');
    });

    test('the default bound is 500 and flags a larger set truncated', async () => {
      const { fetchImpl } = pagedFetch({ total: 1000 });
      const out = await read(fetchImpl);
      assert.equal(out.length, 500);
      assert.equal(out.truncated, true);
    });

    test('a failure on page 2 throws instead of returning page 1 as complete (LIN-3404 fail closed)', async () => {
      const { fetchImpl } = pagedFetch({ total: 150, failOnPage: 2 });
      await assert.rejects(() => read(fetchImpl));
    });
  });
}

describe('App-auth reader keeps its error wrapping per page', () => {
  test('page-2 failure carries the wrapped message and status', async () => {
    const { fetchImpl } = pagedFetch({ total: 150, failOnPage: 2 });
    await assert.rejects(() => listUserInstallations('tok', { fetchImpl }), (err) => {
      assert.match(err.message, /user-installations lookup failed: upstream/);
      assert.equal(err.status, 502);
      return true;
    });
  });
});

describe('walkInstallationPages edge cases', () => {
  test('duplicates across pages are deduped, order preserved', async () => {
    const pages = [
      { total_count: 101, installations: [...insts(1, 99), { id: 100 }] },
      { total_count: 101, installations: [{ id: 100 }, { id: 101 }] },
    ];
    const out = await walkInstallationPages(async (p) => pages[p - 1]);
    assert.deepEqual(out.map((i) => i.id).slice(98), [99, 100, 101]);
    assert.equal(out.length, 101);
  });

  test('a full page of only duplicates stops and says truncated rather than claiming completeness', async () => {
    const full = insts(1, 100);
    const out = await walkInstallationPages(async () => ({ total_count: 250, installations: full }));
    assert.equal(out.length, 100);
    assert.equal(out.truncated, true);
  });
});

describe('truncation is carried through the providers', () => {
  test('GitHubProvider.listUserInstallations re-attaches .truncated after its map', async () => {
    const provider = new GitHubProvider();
    const raw = insts(1, 2); raw.truncated = true;
    provider._clientForToken = () => ({ listUserInstallations: async () => raw });
    const out = await provider.listUserInstallations('tok');
    assert.deepEqual(out.map((i) => i.id), ['1', '2']);
    assert.equal(out.truncated, true);
  });

  test('GitHubProvider.listUserInstallations stays a plain array when complete', async () => {
    const provider = new GitHubProvider();
    provider._clientForToken = () => ({ listUserInstallations: async () => insts(1, 2) });
    assert.ok(!('truncated' in await provider.listUserInstallations('tok')));
  });

  test('GitHubProvider.listReboundableRepos is truncated when only the installation list was', async () => {
    const provider = new GitHubProvider();
    const raw = insts(1, 1); raw.truncated = true;
    provider._clientForToken = () => ({
      listUserInstallations: async () => raw,
      listUserInstallationRepos: async () => [{ full_name: 'o/r', private: false }],
    });
    const out = await provider.listReboundableRepos('tok');
    assert.equal(out.length, 1);
    assert.equal(out.truncated, true);
  });

  test('GitHubProjectsProvider.listReboundableBoards sets .truncated from the installation list', async () => {
    const provider = new GitHubProjectsProvider();
    const raw = insts(1, 1); raw.truncated = true;
    provider._listUserInstallations = async () => raw;
    provider._clientForToken = () => ({ listBoards: async (login) => [{ login, number: 1, title: 'B', closed: false }] });
    const out = await provider.listReboundableBoards('tok');
    assert.equal(out.length, 1);
    assert.equal(out.truncated, true);
  });

  test('GitHubProjectsProvider.listReboundableBoards stays a plain array when complete', async () => {
    const provider = new GitHubProjectsProvider();
    provider._listUserInstallations = async () => insts(1, 1);
    provider._clientForToken = () => ({ listBoards: async (login) => [{ login, number: 1, closed: false }] });
    assert.ok(!('truncated' in await provider.listReboundableBoards('tok')));
  });

  test('installationIdsOf stringifies ids and carries .truncated', () => {
    const raw = insts(1, 2); raw.truncated = true;
    const ids = installationIdsOf(raw);
    assert.deepEqual([...ids], ['1', '2']);
    assert.equal(ids.truncated, true);
    assert.ok(!('truncated' in installationIdsOf(insts(1, 2))));
  });
});

describe('Projects board picker truncated note', () => {
  const boards = [{ login: 'acme', number: 1, title: 'B' }];
  test('shown only when truncated', () => {
    assert.match(renderGitHubProjectSelectPage(boards, { truncated: true }), /repo-picker-truncated-note/);
    assert.doesNotMatch(renderGitHubProjectSelectPage(boards, {}), /truncated-note/);
  });
});
