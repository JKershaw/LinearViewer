#!/usr/bin/env node
// The Stability Review's measures over one window of landings (LIN-4399; the repository reads, LIN-4420; the tracker
// reads, LIN-4421; the person's seat, LIN-4422; measure 1 from the blind-read ledger, LIN-4439).
// Usage: node scripts/stability-measures.mjs <repo> <base> <head> [--runner <dir>] [--api <base>] [--lookback-days <n>]
//          [--reference <file> | --as-reference <label>]
//   → JSON on stdout; the ordered opening table on stderr.
// Reads: git objects of <repo> (lines through the code-shape kit's counter, first-parent churn, Waiting entries), `gh`
// for CI runs (run from <repo>, so its GitHub remote decides the repository), and the runner checkout's git objects
// for its Waiting entries. Every read that fails becomes `not measured: <reason>` in its row; nothing is zero-filled.
// --api (default $HARBOUR_LOCAL_BASE/api/proxy) is the workspace proxy for finished tasks, speed, cost and tickets
// minted (scripts/stability-measures-tracker.mjs: paced, honours 429 Retry-After). Finished tasks may have landed
// before base, so the landings of the --lookback-days (default 3) before base are read for their tickets too. The same
// proxy reads the person's seat over those finished tasks (scripts/stability-measures-seat.mjs: loop rulings only;
// person origin not measured; the operator-free share an upper bound).
// Measure 1 (scripts/stability-measures-blind.mjs) counts the window's landings that have a `## Blind read` naming their
// PR posted before their merge, with its verdict, and the unread by named reason. It reads the tickets' comments
// through the same proxy client (the tracker's own issue reads first, so a ticket costs one call); without --api it is
// `not measured`. It replaced LIN-4422's sample and its hand-scored signs file (LIN-4439): one source.
// LIN-4423, the reference: --as-reference <label> writes a reference reading of an earlier window. Its blind-read and
// seat rows read `no <label> reading; the first reading sets it` (the seat is not read, saving its ~1,700 calls), and
// the session-local diagnostics that would differ on a re-run are left out (the runner tip and freshness check's
// upstream sha, and the proxy call counts), so re-running it gives the same bytes apart from the live rows the
// declaration names. --reference <file> reads a committed reference reading back and prints each of its rows under the
// live row with the same key; the file must count lines on this tool's scope. The declaration that says which
// reference a review uses, and how a review picks its window, is docs/reviews/stability-measures/README.md.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_EXCLUDE, UsageError, commitDateOf, compileScope, emitJson, git, listBlobs, loadCore, parseArgs, readBlobs, readCommit,
  resolveCommit, runCli,
} from './code-shape/code-shape-lib.mjs';
import { NOTES_DIR, countWaiting } from '../lib/prompts/area-note-format.js';
import {
  NO_REFERENCE_KEYS, NO_REFERENCE_ROWS, SCOPE_INCLUDE, buildReading, churnRow, ciRow, formatTable, linesRow, noReferenceReading,
  notMeasured, parseLandingLog, parseNumstat, referencesFrom, waitingRows,
} from './stability-measures-core.mjs';
import { createProxyClient, firstLine, readSeat, readTracker, readTrails, trackerNotMeasured } from './stability-measures-tracker.mjs';
import { blindRow, repoSlugOf, ticketsToRead } from './stability-measures-blind.mjs';

const USAGE = 'usage: node scripts/stability-measures.mjs <repo> <base> <head> [--runner <dir>] [--api <base>] [--lookback-days <n>] [--reference <file> | --as-reference <label>]';
const DEFAULT_LOOKBACK_DAYS = 3;
const LANDING_FORMAT = '--format=%H%x1f%cI%x1f%s%x1f%b%x1e';
const GH_LIMIT = 1000;
const NO_API = 'no --api given and HARBOUR_LOCAL_BASE unset';

// Waiting entries at one commit, from git objects: the notes directly inside docs/areas/. A readable commit with no
// such directory has none (0); a git failure is the caller's `not measured`.
const waitingAt = (repo, sha) => {
  const entries = listBlobs(repo, sha).filter((e) => e.path.startsWith(`${NOTES_DIR}/`) && !e.path.slice(NOTES_DIR.length + 1).includes('/'));
  const byPath = readBlobs(repo, entries);
  return countWaiting(Object.fromEntries(Object.entries(byPath).map(([p, text]) => [p.slice(NOTES_DIR.length + 1), text])));
};

const tryCount = (fn) => { try { return { count: fn() }; } catch (e) { return { reason: firstLine(e) }; } };

// The runner's endpoints: the last first-parent commits on its checked-out branch at or before each repository
// endpoint's commit time. A tip older than the head endpoint is either a stale checkout or a current branch that has
// had no commit since; origin tells them apart. The checkout is current when origin's branch tip is its own tip or
// already contained in it; otherwise it cannot show what the runner had at head.
function readRunner(dir, window) {
  const source = { dir };
  if (!dir) return { source, reading: { reason: 'no --runner given' } };
  if (!existsSync(dir)) return { source, reading: { reason: `runner checkout not found at ${dir}` } };
  try {
    source.branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    source.tip = resolveCommit(dir, 'HEAD');
    source.tipDate = commitDateOf(dir, source.tip);
    if (new Date(source.tipDate) < new Date(window.headDate)) {
      let remoteSha;
      try {
        remoteSha = git(dir, ['ls-remote', 'origin', `refs/heads/${source.branch}`]).trim().split(/\s+/)[0];
        if (!remoteSha) throw new Error(`origin has no refs/heads/${source.branch}`);
      } catch (e) {
        return { source, reading: { reason: `runner freshness unreadable: ${firstLine(e)}` } };
      }
      // Exit 0: origin's tip is in the checkout. Any other exit (not an ancestor, or an object never fetched): stale.
      const contained = remoteSha === source.tip
        || spawnSync('git', ['-C', dir, 'merge-base', '--is-ancestor', remoteSha, 'HEAD'], { stdio: 'ignore' }).status === 0;
      if (!contained) {
        return { source, reading: { reason: `runner checkout older than head (${source.branch} tip ${source.tipDate} < ${window.headDate})` } };
      }
      source.upstreamSha = remoteSha;
    }
    const at = (date) => git(dir, ['rev-list', '-1', '--first-parent', `--before=${date}`, 'HEAD']).trim();
    source.baseSha = at(window.baseDate) || null;
    source.headSha = at(window.headDate) || null;
  } catch (e) {
    return { source, reading: { reason: `runner: ${firstLine(e)}` } };
  }
  const endpointRead = (sha, which) => (sha ? tryCount(() => waitingAt(dir, sha)) : { reason: `runner has no commit on ${source.branch} at or before the ${which} endpoint` });
  return {
    source,
    reading: { base: endpointRead(source.baseSha, 'base'), head: endpointRead(source.headSha, 'head'), detail: { branch: source.branch, baseSha: source.baseSha, headSha: source.headSha } },
  };
}

// Successful test.yml runs on main created inside the window (the head's day included, since a landing's run starts
// after it lands). The --created bound keeps the listing from sliding off its 1,000-row page as the window ages.
function readCiRuns(repo, window) {
  const until = new Date(new Date(window.headDate).getTime() + 86400e3).toISOString().slice(0, 10);
  const created = `${window.baseDate.slice(0, 10)}..${until}`;
  const args = ['run', 'list', '--workflow', 'test.yml', '--branch', 'main', '--status', 'success', '--created', created,
    '--limit', String(GH_LIMIT), '--json', 'databaseId,headSha,startedAt,updatedAt,conclusion'];
  const r = spawnSync('gh', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) return { runs: null, reason: `gh unreadable: ${firstLine(r.error)}` };
  if (r.status !== 0) return { runs: null, reason: `gh run list failed: ${firstLine(r.stderr || `exit ${r.status}`)}` };
  try {
    const runs = JSON.parse(r.stdout);
    if (!Array.isArray(runs)) throw new Error('not a list');
    return { runs, created, listingCapped: runs.length >= GH_LIMIT };
  } catch (e) {
    return { runs: null, reason: `gh run list output unreadable: ${firstLine(e)}` };
  }
}

// The tracker rows. The window's landings own its tickets; the lookback's landings own tickets merged just before base
// and marked Done after it (close-out runs after the merge), which finish in this window (LIN-4421 ruling). Older
// landings are not read: a ticket whose only landings predate the lookback and that finished here is not counted.
// The seat is read over the same finished tasks with the same client, so its calls share the one pacing budget.
// With readSeatRows false (a reference reading) the seat is not read and `rows.seat` is left to the caller. `trails` are
// the issue reads' comment trails, handed to measure 1 so a ticket is read once.
async function readTrackerRows(repo, client, window, lookbackDays, windowLog, { references = {}, readSeatRows = true } = {}) {
  const lookback = { days: lookbackDays, since: new Date(new Date(window.baseDate).getTime() - lookbackDays * 86400e3).toISOString() };
  if (!client) return { lookback, rows: trackerNotMeasured(NO_API, references) };
  if (windowLog.reason) return { lookback, rows: trackerNotMeasured(`landing log unreadable: ${windowLog.reason}`, references) };
  let priorLandings;
  try {
    priorLandings = parseLandingLog(git(repo, ['log', '--first-parent', LANDING_FORMAT, `--since=${lookback.since}`, window.base]));
  } catch (e) {
    return { lookback, rows: trackerNotMeasured(`landing log unreadable: ${firstLine(e)}`, references) };
  }
  const tracker = await readTracker({ client, windowLandings: windowLog.landings, priorLandings, window, lookback, references });
  if (!tracker.selection) return { lookback, rows: tracker.rows, stats: tracker.stats, priorLandings: priorLandings.length };
  const done = { lookback, stats: client.stats, priorLandings: priorLandings.length, trails: tracker.trails };
  if (!readSeatRows) return { ...done, rows: tracker.rows };
  const seat = await readSeat({ client, finished: tracker.selection.finished, tasks: tracker.tasks, references });
  return { ...done, rows: { ...tracker.rows, seat: seat.rows } };
}

// Measure 1: the comments of the tickets its landings need (ticketsToRead: ordinary landings after the gate), reusing
// the tracker's trails, then the row. `repo` narrows a PR number to this repository's URLs; null when origin is not a
// GitHub remote (the number alone is matched).
async function readBlindRow(repo, client, windowLog, numstat, known, reference) {
  if (!client) return notMeasured('blind', NO_API, { reference });
  if (windowLog.reason) return notMeasured('blind', `landing log unreadable: ${windowLog.reason}`, { reference });
  let slug = null;
  try { slug = repoSlugOf(git(repo, ['remote', 'get-url', 'origin'])); } catch { slug = null; }
  const tickets = ticketsToRead({ landings: windowLog.landings, numstat });
  const { trails } = await readTrails({ client, tickets, known: known ?? new Map() });
  return blindRow({ landings: windowLog.landings, numstat, trails, repo: slug, reference });
}

// The reference slots for --reference: a file that cannot be read or is not a matching reference reading stops the run,
// because printing nothing beside the rows would look like a reading with no reference asked for.
function readReferences(file) {
  if (file == null) return {};
  let json;
  try { json = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (e) { throw new UsageError(`--reference ${file}: ${firstLine(e)}`); }
  try { return referencesFrom(json, { file }); } catch (e) { throw new UsageError(`--reference ${firstLine(e)}`); }
}

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), {
    '--runner': 'value', '--api': 'value', '--lookback-days': 'value', '--reference': 'value', '--as-reference': 'value',
  });
  const [repoArg, baseArg, headArg] = positional;
  if (!repoArg || !baseArg || !headArg || positional.length > 3) throw new UsageError(USAGE);
  const repo = resolve(repoArg);
  const runnerDir = flags['--runner'] ? resolve(flags['--runner']) : null;
  const api = flags['--api'] ?? (process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null);
  const lookbackDays = flags['--lookback-days'] == null ? DEFAULT_LOOKBACK_DAYS : Number(flags['--lookback-days']);
  if (!Number.isFinite(lookbackDays) || lookbackDays < 0) throw new UsageError(`--lookback-days must be a number of days, 0 or more\n${USAGE}`);
  const asReference = flags['--as-reference'] ?? null;
  if (asReference != null && !asReference.trim()) throw new UsageError(`--as-reference needs a label, such as '8 Nov'\n${USAGE}`);
  if (asReference != null && flags['--reference'] != null) throw new UsageError(`a reference reading is not read against another reference: give --reference or --as-reference, not both\n${USAGE}`);
  const refs = readReferences(flags['--reference']);
  const noReading = (key) => notMeasured(key, noReferenceReading(asReference), { reference: refs[key] });

  const base = resolveCommit(repo, baseArg);
  const head = resolveCommit(repo, headArg);
  const inScope = compileScope({ include: SCOPE_INCLUDE });

  // Landings and churn: first-parent commits, merge landings diffed against their first parent (passed explicitly:
  // with merge diffs off, the 14 merge landings of the reference window vanish and churn reads 8,590 / 3,055).
  const landings = parseNumstat(git(repo, ['log', '--first-parent', '--diff-merges=first-parent', '--numstat', '--no-renames', '--format=@%H', `${base}..${head}`]));
  const window = { base, head, baseDate: commitDateOf(repo, base), headDate: commitDateOf(repo, head), landings: landings.length };

  // Lines: the code-shape kit's own rollup (measureShape) on the same scope as churn; parse failures are its partial count.
  const { measureShape } = await loadCore(new URL('./code-shape/shape-report.mjs', import.meta.url));
  const shapeAt = (sha) => {
    const report = measureShape({ files: readCommit(repo, sha, inScope).files });
    return { totals: report.totals, parseFailures: report.scope.parseFailures.length };
  };
  let lines;
  try { lines = linesRow({ base: shapeAt(base), head: shapeAt(head), landings: landings.length, reference: refs.lines }); } catch (e) { lines = notMeasured('lines', `shape read failed: ${firstLine(e)}`, { reference: refs.lines }); }

  const ci = readCiRuns(repo, window);
  const runner = readRunner(runnerDir, window);
  const harbour = { base: tryCount(() => waitingAt(repo, base)), head: tryCount(() => waitingAt(repo, head)) };
  // The window's landing log (subjects and bodies), read once: measure 1's landings and the tracker's ticket owners.
  let windowLog;
  try { windowLog = { landings: parseLandingLog(git(repo, ['log', '--first-parent', LANDING_FORMAT, `${base}..${head}`])) }; } catch (e) { windowLog = { reason: firstLine(e) }; }
  // One paced client for the tracker, the seat and measure 1, so all three share the token's budget.
  const client = api ? createProxyClient({ base: api }) : null;
  const tracker = await readTrackerRows(repo, client, window, lookbackDays, windowLog, { references: refs, readSeatRows: asReference == null });
  const seat = asReference != null ? NO_REFERENCE_ROWS.seat.map(noReading) : tracker.rows.seat;
  const noNewMess = asReference != null
    ? NO_REFERENCE_ROWS['no-new-mess'].map(noReading)
    : [await readBlindRow(repo, client, windowLog, landings, tracker.trails, refs.blind)];

  const reading = buildReading({
    window,
    references: refs,
    rows: {
      curve: [
        lines,
        churnRow(landings, inScope, { reference: refs.churn }),
        ciRow({ runs: ci.runs, reason: ci.reason, landingShas: landings.map((l) => l.commit), listingCapped: ci.listingCapped, reference: refs.ci }),
        ...waitingRows({ harbour, runner: runner.reading, landings: landings.length, references: refs }),
        tracker.rows.minted,
      ],
      'no-new-mess': noNewMess,
      speed: [tracker.rows.tasks, tracker.rows.speed],
      seat,
      cost: [tracker.rows.cost],
    },
  });

  // The runner's tip, its date and the freshness check's upstream sha move with every runner commit, and the proxy's
  // call counts and waits with wall-clock pacing: a live reading keeps them, a reference reading leaves them out.
  const { tip, tipDate, upstreamSha, ...runnerEndpoints } = runner.source;

  emitJson({
    tool: 'stability-measures',
    repo: repoArg,
    scope: { include: SCOPE_INCLUDE, exclude: DEFAULT_EXCLUDE },
    ...(asReference != null ? { reference: { label: asReference, noReading: NO_REFERENCE_KEYS } } : {}),
    // Inputs as given: --api's default is recorded as the variable it came from, not the session's local URL.
    inputs: {
      runner: flags['--runner'] ?? null,
      api: flags['--api'] ?? (api ? '$HARBOUR_LOCAL_BASE/api/proxy' : null),
      lookbackDays,
      reference: flags['--reference'] ?? null,
    },
    sources: {
      runner: { ...(asReference != null ? runnerEndpoints : runner.source), dir: flags['--runner'] ?? null },
      ci: { workflow: 'test.yml', branch: 'main', created: ci.created ?? null },
      tracker: {
        // The UTC day the tracker was read: its rows are that day's tracker, whatever the window.
        readOn: api ? new Date().toISOString().slice(0, 10) : null,
        lookback: tracker.lookback,
        priorLandings: tracker.priorLandings ?? null,
        ...(asReference != null ? {} : { calls: client?.stats ?? null }),
      },
    },
    ...reading,
  });
  console.error(formatTable(reading));
});
