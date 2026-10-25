/**
 * LIN-2254 — lib/north-star-resolver.js
 *
 * Run with: node --test tests/unit/north-star-resolver.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getWorkspaceNorthStar,
  getWorkspaceNorthStarDocVersion,
  getNorthStarDocVersion,
  normalizeNorthStarText,
  resolveRoadmapNarrative,
  resolveNorthStarSignal,
  classifyReportFreshness,
  ROADMAP_REPORT_MAX_AGE_DAYS,
} from '../../lib/north-star-resolver.js';

const DOC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'north-star.md');

describe('getWorkspaceNorthStar', () => {
  test('resolves the creator-scoped, workspace-scoped stored value', async () => {
    const store = {
      getUserPreferences: async (id) =>
        id === 'creator-1' ? { northStarByWorkspace: { acme: 'Ship a self-serve onboarding flow by Q3.' } } : {}
    };
    const result = await getWorkspaceNorthStar(store, 'acme', 'creator-1');
    assert.equal(result, 'Ship a self-serve onboarding flow by Q3.');
  });

  test('is generic per-workspace, per-account free text — unrelated to docs/north-star.md', async () => {
    // Two different workspaces under the same creator can hold two
    // unrelated, independently hand-typed strings; neither has anything to
    // do with Harbour's own docs/north-star.md. LIN-2254's fix must not
    // collapse this multi-tenant behavior into always serving the doc.
    const store = {
      getUserPreferences: async () => ({
        northStarByWorkspace: { a: 'star one', b: 'star two' }
      })
    };
    assert.equal(await getWorkspaceNorthStar(store, 'a', 'c1'), 'star one');
    assert.equal(await getWorkspaceNorthStar(store, 'b', 'c1'), 'star two');
  });

  test('fails closed with no creatorId', async () => {
    const store = { getUserPreferences: async () => ({ northStarByWorkspace: { acme: 'x' } }) };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', null), '');
  });

  test('fails closed with no urlKey', async () => {
    const store = { getUserPreferences: async () => ({ northStarByWorkspace: { acme: 'x' } }) };
    assert.equal(await getWorkspaceNorthStar(store, null, 'creator-1'), '');
  });

  test('returns "" when the creator has no stored preferences at all', async () => {
    const store = { getUserPreferences: async () => ({}) };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', 'creator-1'), '');
  });

  test('returns "" and does not throw when the store rejects', async () => {
    const store = { getUserPreferences: async () => { throw new Error('store down'); } };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', 'creator-1'), '');
  });
});

describe('getWorkspaceNorthStarDocVersion', () => {
  test('resolves the creator-scoped, workspace-scoped stored stamp', async () => {
    const stamp = { hash: 'abc123', title: 'North star — v2, the self-funding loop' };
    const store = {
      getUserPreferences: async (id) =>
        id === 'creator-1' ? { northStarDocVersionByWorkspace: { acme: stamp } } : {}
    };
    const result = await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1');
    assert.deepEqual(result, stamp);
  });

  test('returns null when no stamp is stored for this workspace', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: {} }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('returns null when the creator has no stored preferences at all', async () => {
    const store = { getUserPreferences: async () => ({}) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('fails closed with no creatorId', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: { acme: { hash: 'x', title: 'y' } } }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', null), null);
  });

  test('fails closed with no urlKey', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: { acme: { hash: 'x', title: 'y' } } }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, null, 'creator-1'), null);
  });

  test('returns null and does not throw when the store rejects', async () => {
    const store = { getUserPreferences: async () => { throw new Error('store down'); } };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('two workspaces under the same creator hold independent stamps', async () => {
    const stampA = { hash: 'hash-a', title: 'title-a' };
    const stampB = { hash: 'hash-b', title: 'title-b' };
    const store = {
      getUserPreferences: async () => ({
        northStarDocVersionByWorkspace: { a: stampA, b: stampB }
      })
    };
    assert.deepEqual(await getWorkspaceNorthStarDocVersion(store, 'a', 'c1'), stampA);
    assert.deepEqual(await getWorkspaceNorthStarDocVersion(store, 'b', 'c1'), stampB);
  });
});

describe('getNorthStarDocVersion', () => {
  test('hashes the real docs/north-star.md content (normalised) and reads its title', () => {
    const raw = readFileSync(DOC_PATH, 'utf-8');
    const expectedHash = createHash('sha256').update(normalizeNorthStarText(raw)).digest('hex');
    const { hash, title } = getNorthStarDocVersion();
    assert.equal(hash, expectedHash);
    // The title is the doc's own first heading, not a pinned version label:
    // the north star is revised by the human, and a version bump in the doc
    // must not need a test edit to stay green. The shape is still pinned.
    const expectedTitle = raw.split('\n')[0].replace(/^#\s*/, '').trim();
    assert.equal(title, expectedTitle);
    assert.match(title, /^North star — v\d+, /);
  });

  test('is stable across repeated calls (cached for the process)', () => {
    const first = getNorthStarDocVersion();
    const second = getNorthStarDocVersion();
    assert.equal(first.hash, second.hash);
    assert.equal(first.title, second.title);
  });

  test('returns { hash: null, title: null } without throwing when the doc cannot be read', () => {
    // Real production reads always hit the real, committed doc — this
    // exercises the fail-closed branch via the test-only docPath override,
    // since the default path always resolves at HEAD.
    const result = getNorthStarDocVersion('/nonexistent/does-not-exist-north-star.md');
    assert.deepEqual(result, { hash: null, title: null });
    // Must not have poisoned the default-path cache for subsequent callers.
    const real = getNorthStarDocVersion();
    assert.notEqual(real.hash, null);
  });

  test('pins the v2/v1 distinction: the hash does not match the superseded v1 payload', () => {
    // The old v1 six-clause payload — distinct from the v2 doc committed at
    // 619366bc. A resolver-side divergence check must be able to tell these
    // apart; this pins that the hash is content-derived, not a version label
    // a stale caller could still satisfy by accident.
    const staleV1Payload = [
      'Harbour exists to keep human intent in command of AI-accelerated execution.',
      'As agents make producing work cheap, the scarce act is no longer doing the work.',
      'Forward work builds or sharpens instruments that surface drift at every altitude.',
      'Necessary maintenance is work that keeps the workbench running.',
      'Drift is capability added without serving intent-legibility.',
      'This is a v1.'
    ].join('\n');
    const staleHash = createHash('sha256').update(staleV1Payload).digest('hex');
    const { hash } = getNorthStarDocVersion();
    assert.notEqual(hash, staleHash);
  });
});

describe('normalizeNorthStarText (LIN-2838)', () => {
  test('folds CRLF and a lone CR to LF', () => {
    assert.equal(normalizeNorthStarText('a\r\nb\r\nc'), 'a\nb\nc');
    assert.equal(normalizeNorthStarText('a\rb\rc'), 'a\nb\nc');
  });

  test('strips a trailing newline (the byte the UI paste path loses)', () => {
    assert.equal(normalizeNorthStarText('line\n'), 'line');
    assert.equal(normalizeNorthStarText('line'), 'line');
  });

  test('collapses a trailing run of blank lines / whitespace', () => {
    assert.equal(normalizeNorthStarText('line\n\n\n  \n'), 'line');
  });

  test('strips trailing spaces/tabs on interior lines without touching their text', () => {
    assert.equal(normalizeNorthStarText('a  \nb\t\nc'), 'a\nb\nc');
    assert.equal(normalizeNorthStarText('a  b\nc'), 'a  b\nc');
  });

  test('does not otherwise loosen the match: interior and case differences survive', () => {
    assert.notEqual(normalizeNorthStarText('The Star'), normalizeNorthStarText('the star'));
    assert.notEqual(normalizeNorthStarText('one two'), normalizeNorthStarText('one  two'));
    assert.notEqual(normalizeNorthStarText('abc'), normalizeNorthStarText('abd'));
  });

  test('is idempotent and non-string-safe', () => {
    const once = normalizeNorthStarText('a \r\n\r\n');
    assert.equal(normalizeNorthStarText(once), once);
    assert.equal(normalizeNorthStarText(null), '');
    assert.equal(normalizeNorthStarText(undefined), '');
  });

  test('the real doc hashes the same with or without its trailing newline / with CRLF', () => {
    const raw = readFileSync(DOC_PATH, 'utf-8');
    const { hash } = getNorthStarDocVersion();
    const noTrailingNewline = raw.replace(/\n$/, '');
    const crlf = raw.replace(/\n/g, '\r\n');
    const hashOf = (t) => createHash('sha256').update(normalizeNorthStarText(t)).digest('hex');
    assert.equal(hash, hashOf(noTrailingNewline));
    assert.equal(hash, hashOf(crlf));
  });
});

describe('resolveRoadmapNarrative (LIN-742)', () => {
  const NOW = Date.UTC(2026, 5, 27); // fixed clock for deterministic ages
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const report = (overrides = {}) => ({
    generatedAt: iso(2),
    narrative: { digest: 'Digest synthesis.', trajectory: 'Trajectory reading.' },
    ...overrides,
  });

  test('returns the digest + age for a fresh report (digest preferred)', () => {
    const out = resolveRoadmapNarrative(report(), { now: NOW });
    assert.equal(out.text, 'Digest synthesis.');
    assert.equal(out.ageDays, 2);
  });

  test('falls back to trajectory when there is no digest', () => {
    const out = resolveRoadmapNarrative(report({ narrative: { trajectory: 'Only trajectory.' } }), { now: NOW });
    assert.equal(out.text, 'Only trajectory.');
  });

  test('omits (null) a report older than the freshness window', () => {
    const out = resolveRoadmapNarrative(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS + 1) }), { now: NOW });
    assert.equal(out, null);
  });

  test('keeps a report exactly at the window boundary', () => {
    const out = resolveRoadmapNarrative(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS) }), { now: NOW });
    assert.ok(out);
    assert.equal(out.ageDays, ROADMAP_REPORT_MAX_AGE_DAYS);
  });

  test('respects a custom maxAgeDays override', () => {
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 3 }), null);
    assert.ok(resolveRoadmapNarrative(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 7 }));
  });

  test('returns null for absent report, missing/invalid date, no prose, or future date', () => {
    assert.equal(resolveRoadmapNarrative(null, { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative({}, { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: 'not-a-date' }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ narrative: {} }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ narrative: { digest: '   ' } }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: iso(-1) }), { now: NOW }), null);
  });

  test('truncates an oversized narrative to keep the prompt lean', () => {
    const out = resolveRoadmapNarrative(report({ narrative: { digest: 'x'.repeat(10000) } }), { now: NOW });
    assert.ok(out.text.length <= 4000);
  });
});

describe('resolveNorthStarSignal (LIN-779)', () => {
  const NOW = Date.UTC(2026, 5, 27);
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const report = (overrides = {}) => ({
    generatedAt: iso(2),
    narrative: { northStarReading: 'On course — WIP aligns with intent.', gap: 'Auth flow lags the intent.' },
    ...overrides,
  });

  test('returns the live north star with no report (always-current, no age)', () => {
    const out = resolveNorthStarSignal('Ship a self-serve onboarding.', null, { now: NOW });
    assert.equal(out.northStar, 'Ship a self-serve onboarding.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('folds reading + gap from a fresh report and dates them', () => {
    const out = resolveNorthStarSignal('Intent text.', report(), { now: NOW });
    assert.equal(out.northStar, 'Intent text.');
    assert.equal(out.reading, 'On course — WIP aligns with intent.');
    assert.equal(out.gap, 'Auth flow lags the intent.');
    assert.equal(out.ageDays, 2);
  });

  test('drops a stale report reading but keeps the live north star', () => {
    const out = resolveNorthStarSignal('Intent text.', report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS + 1) }), { now: NOW });
    assert.equal(out.northStar, 'Intent text.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('keeps a report exactly at the freshness boundary', () => {
    const out = resolveNorthStarSignal('Intent.', report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS) }), { now: NOW });
    assert.equal(out.ageDays, ROADMAP_REPORT_MAX_AGE_DAYS);
    assert.equal(out.reading, 'On course — WIP aligns with intent.');
  });

  test('ignores a future-dated report for the reading/gap but keeps the live text', () => {
    const out = resolveNorthStarSignal('Intent.', report({ generatedAt: iso(-1) }), { now: NOW });
    assert.equal(out.northStar, 'Intent.');
    assert.equal(out.ageDays, null);
    assert.equal(out.reading, '');
  });

  test('ignores an unparseable generatedAt for the reading/gap but keeps the live text', () => {
    // The computeAgeDays sibling of the future-dated case above. Pinned for
    // resolveRoadmapNarrative since LIN-742 but never for this resolver — a
    // pre-existing characterization gap the LIN-1810 refactor made worth
    // closing, since both now share one age helper (close-out, ledger item 6).
    const out = resolveNorthStarSignal('Intent.', report({ generatedAt: 'not-a-date' }), { now: NOW });
    assert.equal(out.northStar, 'Intent.');
    assert.equal(out.ageDays, null);
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
  });

  test('returns null for an empty / whitespace / non-string north star (path unchanged)', () => {
    assert.equal(resolveNorthStarSignal('', report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal('   ', report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal(null, report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal(undefined, report(), { now: NOW }), null);
  });

  test('trims the live north star and tolerates a report with no reading/gap', () => {
    const out = resolveNorthStarSignal('  Padded intent.  ', report({ narrative: { digest: 'only digest' } }), { now: NOW });
    assert.equal(out.northStar, 'Padded intent.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('respects a custom maxAgeDays override', () => {
    assert.equal(resolveNorthStarSignal('Intent.', report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 3 }).reading, '');
    assert.ok(resolveNorthStarSignal('Intent.', report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 7 }).reading);
  });
});

describe('classifyReportFreshness (LIN-1810)', () => {
  const NOW = Date.UTC(2026, 5, 27);
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const report = (overrides = {}) => ({ generatedAt: iso(2), narrative: {}, ...overrides });

  test('returns "absent" for no report, no generatedAt, or an invalid date', () => {
    assert.equal(classifyReportFreshness(null, { now: NOW }), 'absent');
    assert.equal(classifyReportFreshness({}, { now: NOW }), 'absent');
    assert.equal(classifyReportFreshness(report({ generatedAt: 'not-a-date' }), { now: NOW }), 'absent');
  });

  test('returns "stale" for a report older than maxAgeDays', () => {
    assert.equal(classifyReportFreshness(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS + 1) }), { now: NOW }), 'stale');
  });

  test('returns "stale" for a future-dated report (clock skew), not "fresh"', () => {
    assert.equal(classifyReportFreshness(report({ generatedAt: iso(-1) }), { now: NOW }), 'stale');
  });

  test('returns "fresh" for a report exactly at the freshness boundary', () => {
    assert.equal(classifyReportFreshness(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS) }), { now: NOW }), 'fresh');
  });

  test('returns "fresh" regardless of narrative content — freshness is report-level only', () => {
    assert.equal(classifyReportFreshness(report({ narrative: null }), { now: NOW }), 'fresh');
    assert.equal(classifyReportFreshness(report({ narrative: {} }), { now: NOW }), 'fresh');
  });

  test('respects a custom maxAgeDays override', () => {
    assert.equal(classifyReportFreshness(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 3 }), 'stale');
    assert.equal(classifyReportFreshness(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 7 }), 'fresh');
  });
});
