/**
 * LIN-4505: the Waiting rows read the committed series and the records store, and the frozen reader is gone.
 *
 * What these pin:
 *  - the committed series (docs/reviews/stability-measures/waiting-series.json) reproduces the 8 November reference's
 *    Waiting rows, so the data is the reading the reference was taken from (Harbour 0 → 56; runner 0 → 10 at 5d8489e);
 *  - a commit the series does not hold is `not measured` with a reason naming it, never 0;
 *  - from the first imported record on, the Harbour row reads the open hand-offs to the project as of the commit's time,
 *    counting findings and questions, through the proxy (a stub client here, so no socket opens);
 *  - the gap between the LIN-4495 cutover and the import has no reading in either source, and the row says so;
 *  - the runner's lists are not read after the Harbour cutover (the LIN-4505 ruling): every later runner commit is a reason.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERIES_URL, harbourEndpointAt, loadWaitingSeries, recordsReadingAt, runnerEndpointAt, seriesReadingAt,
} from '../../scripts/stability-measures-waiting.mjs';
import { STATUS, waitingRows } from '../../scripts/stability-measures-core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REFERENCE = JSON.parse(readFileSync(join(ROOT, 'docs/reviews/stability-measures/reference-2026-11-08.json'), 'utf8'));
const series = loadWaitingSeries();
const COVERED_FROM = series.records.coveredFrom;

/** A stub proxy client: records each path asked, answers with `body`. It never opens a socket. */
function stubClient(body, { ok = true, reason = 'HTTP 500' } = {}) {
  const paths = [];
  return {
    paths,
    get: async (path) => {
      paths.push(path);
      return ok ? { ok: true, status: 200, body } : { ok: false, status: 500, reason };
    },
  };
}

describe('the committed series reproduces the 8 November reference', () => {
  test('Harbour base and head at the reference\'s own endpoints: 0 and 56, read from the series, not from git', () => {
    const { base, head } = REFERENCE.window;
    assert.deepStrictEqual(seriesReadingAt(series.harbour, base), { count: 0 });
    assert.deepStrictEqual(seriesReadingAt(series.harbour, head), { count: 56 });
    assert.deepStrictEqual(REFERENCE.measures.flatMap((m) => m.rows).find((r) => r.key === 'waiting.harbour').value.head, 56);
  });

  test('the runner at its reference endpoints: 0 and 10', () => {
    const { baseSha, headSha } = REFERENCE.sources.runner;
    assert.deepStrictEqual(runnerEndpointAt({ series, sha: baseSha }), { count: 0 });
    assert.deepStrictEqual(runnerEndpointAt({ series, sha: headSha }), { count: 10 });
  });
});

describe('the series is data: keys, values and coverage', () => {
  test('every key is a 12-character hex prefix, and every value is a count or a reason', () => {
    for (const side of [series.harbour, series.runner]) {
      for (const [key, value] of Object.entries(side.commits)) {
        assert.match(key, /^[0-9a-f]{12}$/, key);
        assert.ok(typeof value === 'number' ? Number.isInteger(value) && value >= 0 : typeof value === 'string' && value.length > 20, `${key}: ${value}`);
      }
    }
  });

  test('the Harbour cutover commit reads its reason, not a count: the lists were removed there', () => {
    const reading = seriesReadingAt(series.harbour, '81b5901834a7' + 'f'.repeat(28));
    assert.ok('reason' in reading, JSON.stringify(reading));
    assert.match(reading.reason, /LIN-4495|no ## Waiting section/);
  });

  test('a commit the series does not hold is a reason naming it, never a zero', () => {
    const reading = seriesReadingAt(series.runner, 'deadbeef'.repeat(5));
    assert.deepStrictEqual(Object.keys(reading), ['reason']);
    assert.match(reading.reason, /deadbeefdead is not in the committed Waiting series for simple-dispatcher/);
  });
});

describe('the Harbour row after the cutover reads the records, from the first imported record on', () => {
  test('the records reading counts open findings and questions to the project as of the commit time, and ignores other kinds and other addressees', async () => {
    const client = stubClient({ records: [
      { id: 'finding-a', kind: 'finding', state: 'open', to: 'project' },
      { id: 'question-b', kind: 'question', state: 'open', to: 'project' },
      { id: 'task-c', kind: 'task', state: 'open', to: 'project' },
    ] });
    const reading = await recordsReadingAt(client, '2026-11-25T10:00:00+00:00');
    assert.deepStrictEqual(reading, { count: 2 });
    assert.deepStrictEqual(client.paths, ['/records?to=project&state=open&asOf=2026-11-25T10%3A00%3A00.000Z']);
  });

  test('a failed proxy read is a reason, never a zero', async () => {
    const reading = await recordsReadingAt(stubClient({}, { ok: false, reason: 'proxy unreachable: refused' }), '2026-11-25T10:00:00Z');
    assert.deepStrictEqual(reading, { reason: 'records read: proxy unreachable: refused' });
  });

  test('a commit at or after coveredFrom with a client reads the records', async () => {
    const client = stubClient({ records: [{ id: 'finding-a', kind: 'finding', state: 'open', to: 'project' }] });
    const reading = await harbourEndpointAt({ series, sha: 'f'.repeat(40), date: '2026-11-21T09:00:00+00:00', client });
    assert.deepStrictEqual(reading, { count: 1 });
  });

  test('without --api, a commit after coveredFrom is a reason that names the proxy', async () => {
    const reading = await harbourEndpointAt({ series, sha: 'f'.repeat(40), date: '2026-11-21T09:00:00+00:00', client: null });
    assert.match(reading.reason, /no --api given/);
  });
});

describe('the gap between the cutover and the import has no reading, and the row says so', () => {
  const GAP_SHA = 'e'.repeat(40);
  const GAP_DATE = '2026-11-19T22:00:00+00:00';

  test('a commit after the cutover and before the first imported record is not measured, with the dates in its reason', async () => {
    const reading = await harbourEndpointAt({ series, sha: GAP_SHA, date: GAP_DATE, client: stubClient({ records: [] }) });
    assert.ok('reason' in reading, JSON.stringify(reading));
    assert.match(reading.reason, /LIN-4495 cutover/);
    assert.ok(reading.reason.includes(COVERED_FROM), 'the reason names the coverage start');
  });

  test('the gap is an honest not measured in the Waiting rows: the Harbour row and the total both read not measured', async () => {
    const harbour = {
      base: { count: 56 },
      head: await harbourEndpointAt({ series, sha: GAP_SHA, date: GAP_DATE, client: null }),
    };
    const runner = { base: { count: 10 }, head: { reason: 'after the cutover' } };
    const [h, r, total] = waitingRows({ harbour, runner, landings: 4 });
    assert.equal(h.status, STATUS.NOT_MEASURED);
    assert.equal(r.status, STATUS.NOT_MEASURED);
    assert.equal(total.status, STATUS.NOT_MEASURED, 'a total never sums a half-read window');
  });
});

describe('the runner after the Harbour cutover: its lists are history, not read', () => {
  test('a runner commit after 19 Nov 19:39Z is not in the series, so it is a reason', () => {
    const reading = runnerEndpointAt({ series, sha: 'a'.repeat(40) });
    assert.ok('reason' in reading);
    assert.match(reading.reason, /up to 2026-11-19T19:39:50Z/);
  });

  test('a window endpoint after the cutover reads not measured for the runner, even at a runner commit from before it (the ruling)', () => {
    const lastBefore = '4dc83d1e582f' + '0'.repeat(28);
    assert.deepStrictEqual(runnerEndpointAt({ series, sha: lastBefore, date: '2026-11-14T11:09:44+00:00' }), { count: series.runner.commits['4dc83d1e582f'] });
    const reading = runnerEndpointAt({ series, sha: lastBefore, date: '2026-11-19T19:39:51+00:00' });
    assert.ok('reason' in reading);
    assert.match(reading.reason, /not read after the Harbour cutover/);
  });

  test('waiting.runner and waiting.total read not measured for a window whose head is after the cutover', () => {
    const harbour = { base: { count: 0 }, head: { count: 56 } };
    const runner = { base: { count: 0 }, head: { reason: 'after the cutover' } };
    const [, r, total] = waitingRows({ harbour, runner, landings: 3 });
    assert.equal(r.status, STATUS.NOT_MEASURED);
    assert.equal(total.status, STATUS.NOT_MEASURED);
  });
});

test('the series file is the one the tool reads: its location is beside the stability README', () => {
  assert.equal(SERIES_URL.pathname.endsWith('docs/reviews/stability-measures/waiting-series.json'), true);
});
