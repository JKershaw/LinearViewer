#!/usr/bin/env node
// The Stability Review's measures over one window of landings (LIN-4399; the repository reads, LIN-4420; the tracker
// reads, LIN-4421; the blind-read sample and the person's seat, LIN-4422).
// Usage: node scripts/stability-measures.mjs <repo> <base> <head> [--runner <dir>] [--api <base>] [--lookback-days <n>]
//          [--blind <signs.json>]
//   → JSON on stdout; the ordered opening table on stderr.
// Reads: git objects of <repo> (lines through the code-shape kit's counter, first-parent churn, Waiting entries), `gh`
// for CI runs (run from <repo>, so its GitHub remote decides the repository), and the runner checkout's git objects
// for its Waiting entries. Every read that fails becomes `not measured: <reason>` in its row; nothing is zero-filled.
// --api (default $HARBOUR_LOCAL_BASE/api/proxy) is the workspace proxy for finished tasks, speed, cost and tickets
// minted (scripts/stability-measures-tracker.mjs: paced, honours 429 Retry-After). Finished tasks may have landed
// before base, so the landings of the --lookback-days (default 3) before base are read for their tickets too. The same
// proxy reads the person's seat over those finished tasks (scripts/stability-measures-seat.mjs: loop rulings only;
// person origin not measured; the operator-free share an upper bound).
// Measure 1 needs no proxy: the sample of ordinary landings comes from git (scripts/stability-measures-blind.mjs).
// Without --blind the tally reads `pending blind reads`; --blind <signs.json> (full sha → that reader's Balance cell,
// verbatim) gives the neutral-or-better share, the number read worse and the mean sign.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_EXCLUDE, UsageError, commitDateOf, compileScope, emitJson, git, listBlobs, loadCore, parseArgs, readBlobs, readCommit,
  resolveCommit, runCli,
} from './code-shape/code-shape-lib.mjs';
import { NOTES_DIR, countWaiting } from '../lib/prompts/area-note-format.js';
import {
  SCOPE_INCLUDE, buildReading, churnRow, ciRow, formatTable, linesRow, notMeasured, parseLandingLog, parseNumstat, waitingRows,
} from './stability-measures-core.mjs';
import { createProxyClient, firstLine, readSeat, readTracker, trackerNotMeasured } from './stability-measures-tracker.mjs';
import { blindRow, sampleRow } from './stability-measures-blind.mjs';

const USAGE = 'usage: node scripts/stability-measures.mjs <repo> <base> <head> [--runner <dir>] [--api <base>] [--lookback-days <n>] [--blind <signs.json>]';
const DEFAULT_LOOKBACK_DAYS = 3;
const LANDING_FORMAT = '--format=%H%x1f%cI%x1f%s%x1f%b%x1e';
const GH_LIMIT = 1000;

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
async function readTrackerRows(repo, api, window, lookbackDays, windowLog) {
  const lookback = { days: lookbackDays, since: new Date(new Date(window.baseDate).getTime() - lookbackDays * 86400e3).toISOString() };
  if (!api) return { lookback, rows: trackerNotMeasured('no --api given and HARBOUR_LOCAL_BASE unset') };
  if (windowLog.reason) return { lookback, rows: trackerNotMeasured(`landing log unreadable: ${windowLog.reason}`) };
  let priorLandings;
  try {
    priorLandings = parseLandingLog(git(repo, ['log', '--first-parent', LANDING_FORMAT, `--since=${lookback.since}`, window.base]));
  } catch (e) {
    return { lookback, rows: trackerNotMeasured(`landing log unreadable: ${firstLine(e)}`) };
  }
  const client = createProxyClient({ base: api });
  const tracker = await readTracker({ client, windowLandings: windowLog.landings, priorLandings, window, lookback });
  if (!tracker.selection) return { lookback, rows: tracker.rows, stats: tracker.stats, priorLandings: priorLandings.length };
  const seat = await readSeat({ client, finished: tracker.selection.finished, tasks: tracker.tasks });
  return { lookback, rows: { ...tracker.rows, seat: seat.rows }, stats: client.stats, priorLandings: priorLandings.length };
}

// signs.json for the blind tally: null without --blind (pending), else the parsed object or { reason }.
function readSigns(file) {
  if (file == null) return null;
  try {
    const signs = JSON.parse(readFileSync(resolve(file), 'utf8'));
    if (!signs || typeof signs !== 'object' || Array.isArray(signs)) return { reason: `${file} is not an object keyed by commit sha` };
    if ('reason' in signs) return { reason: `${file} has a "reason" key, not a commit sha` };
    return signs;
  } catch (e) {
    return { reason: `${file}: ${firstLine(e)}` };
  }
}

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), { '--runner': 'value', '--api': 'value', '--lookback-days': 'value', '--blind': 'value' });
  const [repoArg, baseArg, headArg] = positional;
  if (!repoArg || !baseArg || !headArg || positional.length > 3) throw new UsageError(USAGE);
  const repo = resolve(repoArg);
  const runnerDir = flags['--runner'] ? resolve(flags['--runner']) : null;
  const api = flags['--api'] ?? (process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null);
  const lookbackDays = flags['--lookback-days'] == null ? DEFAULT_LOOKBACK_DAYS : Number(flags['--lookback-days']);
  if (!Number.isFinite(lookbackDays) || lookbackDays < 0) throw new UsageError(`--lookback-days must be a number of days, 0 or more\n${USAGE}`);

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
  try { lines = linesRow({ base: shapeAt(base), head: shapeAt(head), landings: landings.length }); } catch (e) { lines = notMeasured('lines', `shape read failed: ${firstLine(e)}`); }

  const ci = readCiRuns(repo, window);
  const runner = readRunner(runnerDir, window);
  const harbour = { base: tryCount(() => waitingAt(repo, base)), head: tryCount(() => waitingAt(repo, head)) };
  // The window's landing log (subjects and bodies), read once: the sample's ticket owners and the tracker's.
  let windowLog;
  try { windowLog = { landings: parseLandingLog(git(repo, ['log', '--first-parent', LANDING_FORMAT, `${base}..${head}`])) }; } catch (e) { windowLog = { reason: firstLine(e) }; }
  const sample = windowLog.reason ? notMeasured('sample', `landing log unreadable: ${windowLog.reason}`) : sampleRow({ landings: windowLog.landings, numstat: landings });
  const blind = blindRow({ sample, signs: readSigns(flags['--blind']) });
  const tracker = await readTrackerRows(repo, api, window, lookbackDays, windowLog);

  const reading = buildReading({
    window,
    rows: {
      curve: [
        lines,
        churnRow(landings, inScope),
        ciRow({ runs: ci.runs, reason: ci.reason, landingShas: landings.map((l) => l.commit), listingCapped: ci.listingCapped }),
        ...waitingRows({ harbour, runner: runner.reading, landings: landings.length }),
        tracker.rows.minted,
      ],
      'no-new-mess': [sample, blind],
      speed: [tracker.rows.tasks, tracker.rows.speed],
      seat: tracker.rows.seat,
      cost: [tracker.rows.cost],
    },
  });

  emitJson({
    tool: 'stability-measures',
    repo: repoArg,
    scope: { include: SCOPE_INCLUDE, exclude: DEFAULT_EXCLUDE },
    inputs: { runner: flags['--runner'] ?? null, api, lookbackDays, blind: flags['--blind'] ?? null },
    sources: {
      runner: { ...runner.source, dir: flags['--runner'] ?? null },
      ci: { workflow: 'test.yml', branch: 'main', created: ci.created ?? null },
      tracker: { lookback: tracker.lookback, priorLandings: tracker.priorLandings ?? null, calls: tracker.stats ?? null },
    },
    ...reading,
  });
  console.error(formatTable(reading));
});
