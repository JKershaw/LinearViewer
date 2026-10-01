// LIN-3179: merge the blind readers' codes for the overlap and value digests, compute their agreement (Cohen's kappa) and the tallies, and write docs/papers/harbour/step-overlap-codes.json.
// Usage: node scripts/survey-overlap-codes.mjs [--codes data/survey-overlap/codes] [--out docs/papers/harbour/step-overlap-codes.json]
// Reader A's files are A*.json and reader B's B*.json (each reader split across sessions); the value readers' are VA*.json and VB*.json.
// No adjudication: a tally is given for each reader and for the units both readers coded alike, so a reader can see the spread.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--codes', 'data/survey-overlap/codes');
const outPath = arg('--out', 'docs/papers/harbour/step-overlap-codes.json');
const load = (re) => readdirSync(dir).filter((f) => re.test(f)).sort().flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).digests.map((d) => ({ ...d, file: f })));
const index = JSON.parse(readFileSync('data/survey-overlap/digests/index.json', 'utf8')).index;
const issueOf = Object.fromEntries(index.map((x) => [x.digest, x.issue]));

function kappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const cats = [...new Set(pairs.flat())]; const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return { n, agree: +po.toFixed(3), kappa: pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(3) };
}
const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});

// ---- Overlap digests.
const A = load(/^A\d*\.json$/); const B = load(/^B\d*\.json$/);
const byD = (rs) => Object.fromEntries(rs.map((d) => [d.digest, d]));
const a = byD(A); const b = byD(B);
const fam = { P: [], V: [], I: [], R: [] }; const units = [];
for (const dg of Object.keys(a).filter((k) => b[k]).sort()) {
  for (const [field, get] of [['codes', (d) => d.codes || {}], ['use', (d) => d.use || {}]]) {
    const ua = get(a[dg]); const ub = get(b[dg]);
    for (const u of Object.keys({ ...ua, ...ub })) {
      const f = u[0]; const rec = { digest: dg, issue: issueOf[dg], unit: u, A: ua[u] || null, B: ub[u] || null };
      units.push(rec); if (rec.A && rec.B) fam[f].push([rec.A, rec.B]);
    }
  }
}
const summary = { overlap: {} };
for (const [f, pairs] of Object.entries(fam)) {
  summary.overlap[f] = { units: pairs.length, agreement: kappa(pairs), readerA: tally(pairs.map((p) => p[0])), readerB: tally(pairs.map((p) => p[1])), bothAgree: tally(pairs.filter(([x, y]) => x === y).map((p) => p[0])) };
}
// Per-ticket shares, averaged over both readers, so one long ticket does not dominate.
const perTicket = {};
for (const r of units) { if (!r.A || !r.B) continue; const k = `${r.issue}:${r.unit[0]}`; (perTicket[k] ||= []).push(r); }
const share = (f, codes) => { const vals = Object.entries(perTicket).filter(([k]) => k.endsWith(`:${f}`)).map(([, rs]) => (rs.filter((r) => codes.includes(r.A)).length + rs.filter((r) => codes.includes(r.B)).length) / (2 * rs.length)); vals.sort((x, y) => x - y); return { tickets: vals.length, mean: +(vals.reduce((s, x) => s + x, 0) / (vals.length || 1)).toFixed(3), median: vals.length ? +vals[vals.length >> 1].toFixed(3) : null }; };
summary.overlap.shares = {
  planRestatesOrReverifies: share('P', ['RESTATE', 'REVERIFY']), planRestates: share('P', ['RESTATE']), planReverifies: share('P', ['REVERIFY']), planExtendsOrNew: share('P', ['EXTEND', 'NEW']), planContra: share('P', ['CONTRA']),
  reviewChecks: share('V', ['CHECK']), reviewReverifies: share('V', ['REVERIFY']), reviewNew: share('V', ['NEW']), reviewProcess: share('V', ['PROCESS']),
  implRestatesOrReverifies: share('I', ['RESTATE', 'REVERIFY']), implExtendsOrNew: share('I', ['EXTEND', 'NEW']), implContra: share('I', ['CONTRA']),
  researchUsed: share('R', ['CITED', 'FOLLOWED']), researchCited: share('R', ['CITED']), researchFollowed: share('R', ['FOLLOWED']), researchContradicted: share('R', ['CONTRADICTED']), researchIgnored: share('R', ['IGNORED']), researchBackground: share('R', ['BACKGROUND']),
};

// ---- Value digests.
const VA = load(/^VA\d*\.json$/); const VB = load(/^VB\d*\.json$/);
const va = byD(VA); const vb = byD(VB); const findings = [];
for (const dg of Object.keys({ ...va, ...vb }).sort()) {
  const fa = va[dg]?.findings || {}; const fb = vb[dg]?.findings || {};
  for (const id of Object.keys({ ...fa, ...fb })) findings.push({ digest: dg, issue: issueOf[dg], finding: id, source: id.includes('#f') ? 'review-fault' : 'plan-review-find', A: fa[id] || null, B: fb[id] || null });
}
const vpairs = findings.filter((f) => f.A && f.B);
const flagged = (x) => x && x.flaggedIn && x.flaggedIn !== 'NONE';
summary.value = {};
for (const src of ['review-fault', 'plan-review-find']) {
  const fs = vpairs.filter((f) => f.source === src);
  summary.value[src] = {
    findings: fs.length, tickets: new Set(fs.map((f) => f.issue)).size,
    agreementFlagged: kappa(fs.map((f) => [flagged(f.A) ? 'y' : 'n', flagged(f.B) ? 'y' : 'n'])), agreementWhere: kappa(fs.map((f) => [f.A.flaggedIn, f.B.flaggedIn])),
    readerA: tally(fs.map((f) => f.A.flaggedIn)), readerB: tally(fs.map((f) => f.B.flaggedIn)),
    flaggedBoth: fs.filter((f) => flagged(f.A) && flagged(f.B)).length, flaggedEither: fs.filter((f) => flagged(f.A) || flagged(f.B)).length,
    flaggedBothFromComment: fs.filter((f) => flagged(f.A) && flagged(f.B) && f.A.quoteSource === 'comment' && f.B.quoteSource === 'comment').length,
    inResearchBoth: fs.filter((f) => ['RESEARCH', 'BOTH'].includes(f.A.flaggedIn) && ['RESEARCH', 'BOTH'].includes(f.B.flaggedIn)).length,
    noPriorText: fs.filter((f) => f.A.priorText === false && f.B.priorText === false).length,
  };
}

const rubric = readFileSync('data/survey-overlap/rubric.md', 'utf8');
writeFileSync(outPath, JSON.stringify({ ticket: 'LIN-3179', codedAt: new Date().toISOString().slice(0, 10), method: 'Overlap: every 3rd ticket of the four-step census by number (13 digests), units cut by survey-overlap-lib.mjs and capped by survey-overlap-digests.mjs. Value: every ticket with a real review fault in which-rules-pay-codes.json, and every real plan-review find in why-legs-repeat-codes.json and survey-check-6-codes.json. Two readers, A (digests in order) and B (in reverse), each an in-session subagent of the frontier tier split across sessions, blind to each other and to this analysis. Not adjudicated.', rubric, digests: index, summary, units, findings }, null, 1));
console.log(JSON.stringify(summary, null, 1));
