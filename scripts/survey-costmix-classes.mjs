// LIN-3180: class every change since June by the production paths it touched (credentials/auth/migration/security, proxy/dispatch/fleet machinery, simple-dispatcher, UI, other, docs/tests only), with its size band, from first-parent merges in both repos.
// Usage: node scripts/survey-costmix-classes.mjs [--since 2026-06-01] [--sd ../simple-dispatcher] [--out data/survey-costmix/classes.json]
// A ticket's change is survey-effort-git.mjs's: the union of every first-parent merge on origin/main whose branch name or merged
// subjects carry its LIN-id (a merge naming several is credited to the first its subject names); test, doc and noise paths are
// that script's too, except that survey-paper scripts count as docs. The class is the first rule below that any production path matches, fixed before any cost or outcome was
// joined. A change touching production code in both repos is classed by its LinearViewer paths. Size bands are the scorecard's.
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-06-01');
const out = arg('--out', 'data/survey-costmix/classes.json');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// Path kinds, as survey-effort-git.mjs.
const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
// One departure: the survey papers' own scripts (scripts/survey-*, scripts/steady-base-*) count as docs, so a paper is docs/tests only.
const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p) || /^scripts\/(survey|steady-base)-/.test(p);
const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);

// Classes, first match wins. CRED is survey-effort-git.mjs's high-risk regex unchanged, in either repo.
export const CRED = /(auth|credential|token|oauth|secret|crypto|security|permission|grant|session-store|connection|migrat|encrypt|revoke|refresh|login|account)/i;
// Fleet machinery in LinearViewer: the proxy, dispatch and runner routes; dispatch, wake, autopilot and scheduler code; the
// worker and orchestrator prompts and their process text; and the fleet's cost and observation telemetry.
export const FLEET = /^(routes\/(proxy|dispatch|runner|passage|next-run)|lib\/(proxy|dispatch|wake|harbour-spawn|scheduler|periodical|completion-signals|follow-on|pipeline-loops|plan-review-round|loop-supersede|poll-halt|workspace-halt|queue-config|next-run|observer|observation|session-telemetry|sessions-|task-cost|terminal-marked|transcript-spend|agent-status|agent-turn|runner-kit|prompt|prompts\/|workflow-config|recommend|brief|recap|effort-readout|weekly-budget|model-pricing|pricing-|llm-call-log|consumer-poll|escalation-kpis|run-summary|session-summary|flight-companion|task-decisions|unanswered-decisions|shelved-rulings|digest-feedback|dismissal-suggestions|wall-clock))/;
export const UI = /^(public\/|lib\/components\/|lib\/render[^/]*\.js$|views\/)|\.css$/;
export const CLASSES = ['credentials/auth', 'fleet machinery', 'simple-dispatcher', 'UI', 'other', 'docs/tests only'];
export function classOf(lv, sd) {
  if (!lv.length && !sd.length) return 'docs/tests only';
  if ([...lv, ...sd].some((p) => CRED.test(p))) return 'credentials/auth';
  if (!lv.length) return 'simple-dispatcher';
  if (lv.some((p) => FLEET.test(p))) return 'fleet machinery';
  if (lv.every((p) => UI.test(p))) return 'UI';
  return 'other';
}
export const bandOf = (n) => (n === 0 ? '0' : n < 50 ? '1-49' : n < 300 ? '50-299' : '300+');

const tickets = new Map();
for (const [repo, cwd] of Object.entries(repos)) {
  const log = git(cwd, ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, parents, date, subject] = line.split('\t');
    const ps = parents.split(' ');
    let text = subject;
    if (ps.length > 1) text += '\n' + git(cwd, ['log', '--format=%s', `${ps[0]}..${ps[1]}`]);
    const ids = [...new Set((text.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
    const branchIds = subject.match(/\blin-\d+\b/gi);
    const id = (branchIds ? branchIds[0] : ids[0])?.toUpperCase();
    if (!id) continue;
    const t = tickets.get(id) || { id, merges: [], prod: 0, test: 0, doc: 0, lv: new Set(), sd: new Set(), prodByRepo: {} };
    t.merges.push({ repo, sha: sha.slice(0, 8), date });
    for (const n of git(cwd, ['diff', '--numstat', ps[0], sha]).trim().split('\n').filter(Boolean)) {
      const [a, d, p] = n.split('\t');
      if (a === '-' || isNoise(p)) continue;
      const lines = +a + +d;
      if (/^docs\/papers\//.test(p)) t.paper = true;
      if (isTest(p)) t.test += lines;
      else if (isDoc(p)) t.doc += lines;
      else { t.prod += lines; (repo === 'LinearViewer' ? t.lv : t.sd).add(p); t.prodByRepo[repo] = (t.prodByRepo[repo] || 0) + lines; }
    }
    tickets.set(id, t);
  }
}

const rows = [...tickets.values()].map((t) => {
  const lastMerge = t.merges.map((m) => m.date).sort().at(-1);
  return {
    id: t.id, repos: [...new Set(t.merges.map((m) => m.repo))], merges: t.merges.length, lastMerge, month: lastMerge.slice(0, 7),
    prodLines: t.prod, testLines: t.test, docLines: t.doc, prodByRepo: t.prodByRepo, band: bandOf(t.prod),
    cls: classOf([...t.lv], [...t.sd]), paper: t.paper, lvPaths: [...t.lv], sdPaths: [...t.sd],
  };
}).sort((a, b) => +a.id.slice(4) - +b.id.slice(4));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ since, generatedAt: new Date().toISOString(), heads: Object.fromEntries(Object.entries(repos).map(([r, c]) => [r, git(c, ['rev-parse', '--short=8', 'origin/main']).trim()])), rows }, null, 1));
const tab = {}; for (const r of rows) { const x = (tab[r.cls] ||= {}); x[r.month] = (x[r.month] || 0) + 1; }
console.log(`changes=${rows.length} since ${since}`); for (const c of CLASSES) console.log(c.padEnd(18), JSON.stringify(tab[c] || {}));
