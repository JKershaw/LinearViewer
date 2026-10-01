// LIN-3156: build the population (last 100 Done tickets that went through code review) from the ticket cache and both repos' git history, with each ticket's leg-labelled comments, commits by file class, and rule-signature matches; write a git-ignored timeline and per-ticket reading digests.
// Usage: node scripts/survey-rules-timeline.mjs [tickets=data/survey/rules-tickets.json] [--sd ../simple-dispatcher] [--out data/survey/rules-timeline.json] [--digests data/survey/rules-digests] [--n 100]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { DISTINCT } from './survey-rules-census.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const sdPath = opt('--sd', '../simple-dispatcher');
const outPath = opt('--out', 'data/survey/rules-timeline.json');
const digestDir = opt('--digests', 'data/survey/rules-digests');
const N = Number(opt('--n', 100));
const ticketsPath = argv[0] || 'data/survey/rules-tickets.json';

// ---- git: every commit on origin/main of each repo, with the ticket ids it names and its lines by file class
export const CLASSIFY = {
  LinearViewer: (f) => /^tests?\//.test(f) || /\.(test|spec)\.[cm]?js$/.test(f) ? 'test'
    : /^(lib|routes|public)\//.test(f) || f === 'server.js' ? 'prod'
    : /\.md$/.test(f) || /^docs\//.test(f) ? 'docs' : 'other',
  'simple-dispatcher': (f) => /^test\//.test(f) || /\.test\.[cm]?js$/.test(f) || /^e2e-/.test(f) ? 'test'
    : /^[^/]+\.(m?js|sh)$/.test(f) ? 'prod'
    : /\.md$/.test(f) || /^docs\//.test(f) ? 'docs' : 'other',
};
export const idsIn = (s) => [...new Set((s.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];

export function gitCommits(repo, dir) {
  const raw = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--no-merges', '--numstat', '--format=%x1e%H%x1f%aI%x1f%s%x1f%b%x1f'],
    { encoding: 'utf8', maxBuffer: 1 << 30 });
  const merges = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--merges', '--format=%H%x1f%cI%x1f%s%x1f%b%x1e'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  for (const rec of raw.split('\x1e').slice(1)) {
    const [sha, at, subject, body, rest] = rec.split('\x1f');
    const lines = { prod: 0, test: 0, docs: 0, other: 0 };
    const files = [];
    for (const l of (rest || '').split('\n')) {
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const cls = CLASSIFY[repo](m[3]);
      lines[cls] += (Number(m[1]) || 0) + (Number(m[2]) || 0);
      files.push(m[3]);
    }
    out.push({ repo, sha: sha.slice(0, 8), at, subject, ids: idsIn(`${subject}\n${body}`), lines, files });
  }
  // A branch commit that names no ticket inherits the ids of the PR merge that brought it in.
  const mergeIds = new Map();
  for (const rec of merges.split('\x1e')) {
    const [sha, at, subject, body] = rec.trim().split('\x1f');
    if (!sha) continue;
    const ids = idsIn(`${subject}\n${body || ''}`);
    if (!ids.length) continue;
    const side = execFileSync('git', ['-C', dir, 'rev-list', `${sha}^1..${sha}^2`], { encoding: 'utf8' }).trim().split('\n');
    for (const s of side) if (s) mergeIds.set(s.slice(0, 8), { ids, mergeAt: at, pr: (subject.match(/#(\d+)/) || [])[1] || null });
  }
  for (const c of out) { const m = mergeIds.get(c.sha); if (m) { if (!c.ids.length) c.ids = m.ids; c.mergeAt = m.mergeAt; c.pr = m.pr; } }
  return out;
}

// ---- comments: which leg wrote each one, from its heading, and the verdict it states
export function legOf(body) {
  const h = body.split('\n').find((l) => l.trim())?.toLowerCase() || '';
  if (/plan[- ]review/.test(h)) return 'plan-review';
  if (/autopilot|stepper|run summary|^\W*ruling\b|routing note|passage runner|runner leg/.test(h)) return 'orchestrator';
  if (/code (re-?)?review|re-review|review verdict|independent (implementation |code )?review|fresh (independent )?review|^\W*review\b(?! fixes| f\d)/.test(h)
    && !/review fixes|discharge|plan-vs-code|\bfixes\b/.test(h)) return 'review';
  if (/close-?out|closed out|closing out/.test(h)) return 'close-out';
  if (/\bplan\b|breakdown/.test(h)) return 'plan';
  if (/research|design decision/.test(h)) return 'research';
  return 'implementation';
}
export function verdictOf(body) {
  const t = body.replace(/[*_`]/g, '');
  const tail = t.slice(-2500);
  const probe = (s) => /verdict[^\n]{0,40}request changes|^\s*#*\s*request changes\b/im.test(s) ? 'request-changes'
    : /verdict[^\n]{0,40}needs discussion/i.test(s) ? 'needs-discussion'
    : /approve\s*[—–-]+\s*conditional/i.test(s) ? 'approve-conditional'
    : /verdict[^\n]{0,40}approve|^\s*#*\s*approve\b/im.test(s) ? 'approve' : null;
  return probe(tail) || probe(t.slice(0, 1500)) || null;
}

// ---- signatures: a phrase an agent obeying the rule writes. A match shows the rule was exercised, never that it caught anything.
export const SIGNATURES = {
  requirements: /acceptance criteri|\bAC\s?\d|requirement/i,
  'scope-drift': /scope (drift|creep|overrun)|plan overrun|out of scope|beyond (the )?(plan|scope)|stale (plan|grounding)/i,
  'regression-history': /git log|previously fixed|reintroduc|re-?appl(y|ies) .*revert|regression/i,
  'class-check': /class check|\bisolated\b|bounded class|unhandled (sibling|instance)|\bone of a class\b|same class/i,
  'inside-outside': /\b(inside|outside)\b[^\n]{0,40}(item|mark|class|scope)|marked (inside|outside)|\((inside|outside)\)|\*\*(inside|outside)\*\*/i,
  'search-before-filing': /search(ed)? (relations|for an existing)|no existing ticket|existing ticket|already filed|duplicate of|link(ed)? instead/i,
  'rulings-check': /rulings?\b.*(includeResolved|resolved)|includeResolved|existing ruling|no ruling covers/i,
  'test-adequacy': /\be2e\b|end-to-end|integration test|test level|low-level tests?/i,
  'mutation-check': /mutation|mutat(ed|e)\b|went red|confirm(ed)? red|reverted.*(green|red)/i,
  'quality-checklist': /security|error handling|performance|code style/i,
  'direct-verification': /side-by-side|screenshot|mockup|human testing|visual(ly)? (verif|check)|loaded the page|in the browser/i,
  ledger: /What CI Did Not Prove|ledger empty|\bledger\b/i,
  'risk-lanes': /monitor:|rollback:|post-merge observation|named monitor|named rollback|hard gate|risk lane|risk surface/i,
  verdict: /\bverdict\b|\*\*approve|request changes|needs discussion/i,
  'ci-green-exact-commit': /CI (is )?green|ci-success|match-head-commit|exact commit|head sha|substitute run|CI red/i,
  'role-separation': /review does not merge|not merg(ed|ing)[^\n]{0,40}(review|close-out)|hand(ing|ed)? (off )?to close-out|close-out owns|write-only/i,
  'trivial-edit-bound': /trivial|before\s*→\s*after|verbatim from (the )?review|review-named|self-authored|2 files|three hunks|3 hunks/i,
  'cannot-close': /cannot-close|cannot close|hold(ing)? the merge|merge held|routed? back|next action|blocks relation|\bblocked by\b/i,
  authorization: /recorded approve|approve (is )?on record|authori[sz]ation|no fresh (human )?go-ahead/i,
  'ledger-discharge': /discharg|explicit(ly)? drop|accepted by|precondition/i,
  'verify-landed': /landed commit|verified on (the )?(landed|merge)|on origin\/main|post-merge verif/i,
  'summary-comment': /final CI|ledger resolution|what merged|merge commit/i,
  'archive-prune': /prune|pre-prune|snapshot|stage artifact|archiv/i,
  'follow-up-filing': /follow-?up|priorityLevel|priority \d|type label|filed LIN-|filed as LIN-/i,
};
for (const d of DISTINCT) if (!SIGNATURES[d.id]) throw new Error(`no signature for ${d.id}`);
const words = (s) => (s.match(/\S+/g) || []).length;
// Paragraph units: blank-line blocks, list items and table rows. A unit's words count toward every rule whose signature it matches.
export const units = (body) => body.split(/\n\s*\n|\n(?=\s*(?:[-*+] |\d+\. |\|))/).map((s) => s.trim()).filter(Boolean);

function main() {
  const cache = JSON.parse(readFileSync(ticketsPath, 'utf8'));
  const commits = [...gitCommits('LinearViewer', '.'), ...gitCommits('simple-dispatcher', sdPath)];
  const byId = new Map();
  for (const c of commits) for (const id of c.ids) (byId.get(id) || byId.set(id, []).get(id)).push(c);

  const tickets = [];
  for (const [id, d] of Object.entries(cache.details)) {
    if (!d || d.missing || d.state?.type !== 'completed') continue;
    const comments = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c, i) => {
      const leg = legOf(c.body);
      return { i, at: c.createdAt, leg, words: words(c.body), verdict: leg === 'review' ? verdictOf(c.body) : null, head: c.body.split('\n')[0].slice(0, 140) };
    });
    const cs = (byId.get(id) || []).sort((a, b) => a.at.localeCompare(b.at));
    const reviews = comments.filter((c) => c.leg === 'review');
    const hasCode = cs.some((c) => c.lines.prod + c.lines.test > 0);
    tickets.push({
      id, title: d.title, completedAt: d.completedAt, labels: d.labels, reviewed: reviews.length > 0 && hasCode,
      repos: [...new Set(cs.map((c) => c.repo))], comments, commits: cs.map(({ files, ...c }) => ({ ...c, nfiles: files.length })),
    });
  }
  const pop = tickets.filter((t) => t.reviewed).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, N);
  const popIds = new Set(pop.map((t) => t.id));

  // rule signature matches over review and close-out comments of the population
  for (const t of pop) {
    const d = cache.details[t.id];
    const sorted = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    t.rules = {};
    for (const c of t.comments) {
      if (c.leg !== 'review' && c.leg !== 'close-out') continue;
      const body = sorted[c.i].body;
      for (const [rule, re] of Object.entries(SIGNATURES)) {
        const hit = units(body).filter((u) => re.test(u));
        if (!hit.length) continue;
        const r = t.rules[rule] || (t.rules[rule] = { comments: 0, words: 0 });
        r.comments++; r.words += hit.reduce((s, u) => s + words(u), 0);
      }
    }
    // filed follow-ups: ticket ids a close-out names that were created after this ticket
    t.followUps = [];
    for (const c of t.comments) if (c.leg === 'close-out') for (const x of idsIn(sorted[c.i].body)) if (Number(x.split('-')[1]) > Number(t.id.split('-')[1]) && !t.followUps.includes(x)) t.followUps.push(x);
  }

  // What happened after the first review: commits authored later, send-back verdicts, close-out holds. A ticket with none of these is coded
  // "changed nothing downstream" without reading; the rest get a reading digest that starts at the first review.
  const TRUNC = { review: 9000, 'close-out': 6000, implementation: 4000 };
  mkdirSync(digestDir, { recursive: true });
  for (const t of pop) {
    const d = cache.details[t.id];
    const sorted = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = t.comments.find((c) => c.leg === 'review').at;
    const toMs = (s) => new Date(s).getTime();
    t.postReviewCommits = t.commits.filter((c) => toMs(c.at) > toMs(first)).map((c) => c.sha);
    t.sendBacks = t.comments.filter((c) => c.verdict === 'request-changes' || c.verdict === 'needs-discussion').length;
    t.holds = t.comments.filter((c) => c.leg === 'close-out' && /cannot close|not merged|blocked|hold|routed? back|not closed/i.test(c.head)).length;
    t.reviewRounds = t.comments.filter((c) => c.leg === 'review' && c.verdict).length;
    t.active = t.postReviewCommits.length > 0 || t.sendBacks > 0 || t.holds > 0;
    if (!t.active) continue;
    const events = [
      ...t.comments.filter((c) => toMs(c.at) >= toMs(first) && TRUNC[c.leg]).map((c) => {
        const b = sorted[c.i].body, n = TRUNC[c.leg];
        return { at: c.at, text: `### comment ${c.i} · ${c.at} · leg=${c.leg}${c.verdict ? ` · verdict=${c.verdict}` : ''} · ${c.words} words\n\n${b.length > n ? `${b.slice(0, n)}\n…[truncated at ${n} chars of ${b.length}]` : b}` };
      }),
      ...t.comments.filter((c) => toMs(c.at) >= toMs(first) && !TRUNC[c.leg]).map((c) => ({ at: c.at, text: `### comment ${c.i} · ${c.at} · leg=${c.leg} (not shown) · ${c.head}` })),
      ...t.commits.map((c) => ({ at: c.at, text: `### commit ${c.repo} ${c.sha} · ${c.at}${toMs(c.at) > toMs(first) ? ' · AFTER FIRST REVIEW' : ''} · prod ${c.lines.prod} / test ${c.lines.test} / docs ${c.lines.docs} / other ${c.lines.other} lines${c.pr ? ` · PR #${c.pr}` : ''}\n${c.subject}` })),
    ].sort((a, b) => toMs(a.at) - toMs(b.at));
    writeFileSync(`${digestDir}/${t.id}.md`, `# ${t.id} — ${t.title}\ncompleted ${t.completedAt} · repos ${t.repos.join(', ')} · first review ${first}\n\n${events.map((e) => e.text).join('\n\n')}\n`);
  }
  writeFileSync(outPath, JSON.stringify({ builtAt: new Date().toISOString(), ticketsFetchedAt: cache.fetchedAt, candidates: tickets.length, population: pop, done: tickets.map(({ id, completedAt, reviewed }) => ({ id, completedAt, reviewed, inPop: popIds.has(id) })) }));
  const legs = {}; for (const t of pop) for (const c of t.comments) legs[c.leg] = (legs[c.leg] || 0) + 1;
  const verdicts = {}; for (const t of pop) for (const c of t.comments) if (c.verdict) verdicts[c.verdict] = (verdicts[c.verdict] || 0) + 1;
  console.log(`completed tickets with detail: ${tickets.length}; reviewed with code: ${tickets.filter((t) => t.reviewed).length}; population: ${pop.length}`);
  console.log(`population completedAt ${pop.at(-1)?.completedAt} .. ${pop[0]?.completedAt}; repos`, pop.reduce((m, t) => { for (const r of t.repos) m[r] = (m[r] || 0) + 1; return m; }, {}));
  console.log('comment legs', legs, 'verdicts', verdicts);
  console.log(`active (post-review commit, send-back or hold): ${pop.filter((t) => t.active).length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
