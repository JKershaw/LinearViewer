// LIN-3143: production vs test lines, comment density, ticket and plan-label citations in production comments, and pin-style test files, at the last first-parent commit of each month.
// Usage: node scripts/steady-base-code.mjs [rev=HEAD] [--json]
import { execFileSync } from 'child_process';

const rev = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD';
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, input, stdio: ['pipe', 'pipe', 'ignore'] });

const isProd = (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p)));
const isTest = (p) => /^tests\/.*\.(js|mjs)$/.test(p) && !/^tests\/fixtures\//.test(p);
// Test files named for pinning an inventory rather than a behaviour.
const isPinFile = (p) => /census|inventory|witness|allow-?list|pin|parity|byte-identical/i.test(p.split('/').pop());
const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const TICKET = /\bLIN-\d+\b/;
// Plan-label citations (decision/fidelity/ledger/N-item labels such as D7, F4, L2, N1) inside comments.
const PLAN_LABEL = /\b[DFLN]\d{1,2}[a-z]?\b/;

function monthEnds() {
  const seen = new Map();
  for (const l of git(['log', '--first-parent', '--format=%H %cs', rev]).trim().split('\n')) {
    const [sha, day] = l.split(' ');
    const m = day.slice(0, 7);
    if (!seen.has(m)) seen.set(m, sha); // newest first → last commit of the month
  }
  return [...seen.entries()].reverse();
}

function readBlobs(sha, paths) {
  // One cat-file --batch call per snapshot; parse "<oid> blob <size>\n<content>\n" records.
  const buf = execFileSync('git', ['cat-file', '--batch'], { input: paths.map((p) => `${sha}:${p}`).join('\n') + '\n', maxBuffer: 1 << 30 });
  const out = []; let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(10, i); const header = buf.slice(i, nl).toString(); const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) { i = nl + 1; out.push(''); continue; }
    out.push(buf.slice(nl + 1, nl + 1 + size).toString('utf8')); i = nl + 1 + size + 1;
  }
  return out;
}

const rows = [];
for (const [month, sha] of monthEnds()) {
  const files = git(['ls-tree', '-r', '--name-only', sha]).trim().split('\n');
  const prod = files.filter(isProd), tests = files.filter(isTest);
  const r = { month, sha: sha.slice(0, 8), prodFiles: prod.length, testFiles: tests.length, prodLines: 0, prodCommentLines: 0, prodTicketCommentLines: 0, prodPlanLabelCommentLines: 0, testLines: 0, pinFiles: tests.filter(isPinFile).length };
  for (const text of readBlobs(sha, prod)) for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    r.prodLines++;
    if (COMMENT.test(line)) { r.prodCommentLines++; if (TICKET.test(line)) r.prodTicketCommentLines++; if (PLAN_LABEL.test(line)) r.prodPlanLabelCommentLines++; }
  }
  for (const text of readBlobs(sha, tests)) for (const line of text.split('\n')) if (line.trim()) r.testLines++;
  r.testToProd = +(r.testLines / Math.max(1, r.prodLines)).toFixed(2);
  r.commentShare = +(r.prodCommentLines / Math.max(1, r.prodLines)).toFixed(3);
  rows.push(r);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else {
  console.log('month   sha       prodLines  testLines  test:prod  comment%  ticketCmtLines  planLabelCmtLines  testFiles  pinFiles');
  for (const r of rows) console.log(`${r.month} ${r.sha} ${String(r.prodLines).padStart(9)} ${String(r.testLines).padStart(10)} ${String(r.testToProd).padStart(9)} ${(100 * r.commentShare).toFixed(1).padStart(8)} ${String(r.prodTicketCommentLines).padStart(15)} ${String(r.prodPlanLabelCommentLines).padStart(18)} ${String(r.testFiles).padStart(10)} ${String(r.pinFiles).padStart(9)}`);
}
