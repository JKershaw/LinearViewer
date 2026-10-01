// LIN-3189: the pre-registered selection for the small-work replay — small, low-risk Done changes merged 1 Aug–24 Sep in both repos, a systematic sample stratified by repo plus every replayable change with a known escape or named fix.
// Usage: node scripts/survey-replay-select.mjs [--scorecard data/survey/scorecard.json] [--features data/survey-replay/features.json] [--tracker data/survey/reliability-tracker.json] [--sd ../simple-dispatcher] [--state ~/development/simple-dispatcher/state] [--projects ~/.claude/projects] [--out data/survey-replay/selection.json]
// Committed with the pre-registration, before any replay. Eligible: Done in the scorecard (cut 30 Sep); last merge 1 Aug–24 Sep (the
// cheap-tier implementer step was 25 Sep); M3-light under survey-proportional-classifiers.mjs (≤49 production lines in ≤3 files, no
// risky, invariant or process-text path) with at least one production line; exactly one first-parent merge, so one parent to replay
// from. Escape stratum: eligible changes the scorecard marks escaped or named-fixed, less those proportional-process-backtest-codes.json
// reads as finder rows, mentions or unclear. Clean stratum: the rest, restricted to changes whose every runner session left a transcript
// (so whole-life tokens exist), sampled systematically by last-merge order within each repo: 6 Harbour and 2 runner (the runner's whole clean pool). September positives
// the backtest never read are read here, before any replay, against its rubric (READINGS). No proxy calls.
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const scorecard = JSON.parse(readFileSync(arg('--scorecard', 'data/survey/scorecard.json'), 'utf8'));
const features = JSON.parse(readFileSync(arg('--features', 'data/survey-replay/features.json'), 'utf8'));
const tracker = JSON.parse(readFileSync(arg('--tracker', 'data/survey/reliability-tracker.json'), 'utf8'));
const codes = JSON.parse(readFileSync('docs/papers/harbour/proportional-process-backtest-codes.json', 'utf8'));
const sdRepo = arg('--sd', '../simple-dispatcher');
const state = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));
const projects = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-replay/selection.json');

const FROM = '2026-08-01', TO = '2026-09-24T23:59:59Z';
const QUOTA = { LinearViewer: 6, 'simple-dispatcher': 2 };
const repoDir = { LinearViewer: '.', 'simple-dispatcher': sdRepo };

// First-parent commits on each repo's head, credited exactly as survey-effort-git.mjs credits them: to the LIN-id the subject
// (branch) names first, else the first one the merged commits' subjects name.
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const merges = new Map();
for (const [repo, head] of Object.entries(features.heads)) {
  for (const line of git(repoDir[repo], ['log', head, '--first-parent', '--since=2026-07-15', '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n')) {
    const [sha, parents, date, subject] = line.split('\t');
    const ps = parents.split(' ');
    let text = subject;
    if (ps.length > 1) text += '\n' + git(repoDir[repo], ['log', '--format=%s', `${ps[0]}..${ps[1]}`]);
    const branchIds = subject.match(/\blin-\d+\b/gi);
    const id = (branchIds ? branchIds[0] : text.match(/\blin-\d+\b/i)?.[0])?.toUpperCase();
    if (!id) continue;
    const l = merges.get(id) || []; l.push({ repo, sha, parent: ps[0], date, subject }); merges.set(id, l);
  }
}

// Runner sessions per ticket, and whether each left a transcript.
const sessions = new Map();
for (const f of readdirSync(state).filter((x) => /^dispatcher\.run-\d{8}-\d{6}\.log$/.test(x)).sort()) {
  let issue = null;
  for (const line of readFileSync(join(state, f), 'utf8').split('\n')) {
    let m;
    if (/^Found dispatch item: /.test(line)) { issue = null; continue; }
    if ((m = line.match(/^\s+Issue: (LIN-\d+)/))) { issue = m[1]; continue; }
    if ((m = line.match(/^Claimed item .*creating session: ([0-9a-f-]{36})/)) && issue) {
      const l = sessions.get(issue) || []; l.push(m[1]); sessions.set(issue, l);
    }
  }
}
const hasTranscript = (sid) => existsSync(join(projects, `-Users-work-development-simple-dispatcher-workspaces-${sid}`, `${sid}.jsonl`));

const feat = new Map(features.rows.map((r) => [r.id, r]));
const desc = new Map(tracker.list.map((t) => [t.identifier, t]));
const notBlame = new Set(codes.namedFixes.filter((n) => n.code !== 'blames').map((n) => n.id));
const finder = new Set(['LIN-2037', 'LIN-2291', 'LIN-2331']); // proportional-process-backtest.md's finder rows on M3
// Positives after the backtest's cut, read against its rubric before selection (the Bug's reason, or the fix commit's body).
export const READINGS = {
  'LIN-2563': { code: 'finder', why: 'LIN-2657: "pre-existing, recorded out of scope in LIN-2563 review"' },
  'LIN-2980': { code: 'blames', why: 'LIN-2983: "older code made stream-aborting by LIN-2980"; LIN-2984 is a finder row (older sites excluded)' },
  'LIN-2414': { code: 'blames', why: 'fix LIN-2468 (SD 2ef854b): the lapsed BLOCKED-hold re-park LIN-2414 added dropped an undelivered pendingFollowUp; 2468 keeps the re-park only when none is pending' },
};

const eligible = [];
for (const c of scorecard.changes) {
  const f = feat.get(c.id);
  if (!c.done || !f?.light.M3 || !(c.prodLines >= 1)) continue;
  const at = new Date(c.lastMerge).toISOString();
  if (at < FROM || at > TO) continue;
  const m = (merges.get(c.id) || []).filter((x) => c.repos.includes(x.repo));
  const ss = sessions.get(c.id) || [];
  eligible.push({
    id: c.id, repo: c.repos.length === 1 ? c.repos[0] : c.repos.join('+'), lastMerge: c.lastMerge, prodLines: c.prodLines, testLines: c.testLines,
    merges: m.length, merge: m.length === 1 ? m[0] : null, escapes: c.escapes, namedFix: c.namedFix,
    sessions: ss.length, transcripts: ss.filter(hasTranscript).length, dispatches: c.dispatches, workH: c.workH,
    title: desc.get(c.id)?.title ?? null, descriptionChars: desc.get(c.id)?.description?.length ?? 0,
  });
}
eligible.sort((a, b) => a.lastMerge.localeCompare(b.lastMerge));
const replayable = eligible.filter((e) => e.merges === 1 && e.repo !== 'LinearViewer+simple-dispatcher' && e.descriptionChars > 0);

const positive = (e) => (e.escapes > 0 || e.namedFix) && !finder.has(e.id) && !notBlame.has(e.id) && (READINGS[e.id]?.code ?? 'blames') === 'blames';
const escapeStratum = replayable.filter(positive);
const clean = replayable.filter((e) => !(e.escapes > 0 || e.namedFix) && e.sessions > 0 && e.transcripts === e.sessions);
const sample = [];
for (const [repo, n] of Object.entries(QUOTA)) {
  const pool = clean.filter((e) => e.repo === repo);
  const k = pool.length / n;
  for (let i = 0; i < n && i < pool.length; i++) sample.push({ ...pool[Math.floor(k * i + k / 2)], stratum: 'clean', poolSize: pool.length });
}
const selected = [...escapeStratum.map((e) => ({ ...e, stratum: 'escape', reading: READINGS[e.id] ?? null })), ...sample];

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), heads: features.heads, window: [FROM, TO], quota: QUOTA,
  counts: { eligible: eligible.length, replayable: replayable.length, escapeStratum: escapeStratum.length, cleanPool: clean.length,
    cleanPoolByRepo: Object.fromEntries(Object.keys(QUOTA).map((r) => [r, clean.filter((e) => e.repo === r).length])) },
  selected, eligible }, null, 1));
console.log(JSON.stringify({ eligible: eligible.length, replayable: replayable.length, escapeStratum: escapeStratum.length, clean: clean.length }));
for (const s of selected) console.log([s.stratum, s.id, s.repo, s.lastMerge.slice(0, 10), `${s.prodLines}p/${s.testLines}t`, s.merge.sha.slice(0, 8), `esc${s.escapes} fix${s.namedFix}`, `tx ${s.transcripts}/${s.sessions}`, s.title].join('\t'));
