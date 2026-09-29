// LIN-3143: fetch a ticket sample (descriptions, comments) and dispatched prompts over the local proxy into a cache file, then report per-month and per-kind sizes from it.
// Usage: node scripts/steady-base-tracker.mjs fetch <cache.json>   (≈15 min; paced under the proxy's 60/min cap)
//        node scripts/steady-base-tracker.mjs report <cache.json> [--json]
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PROMPT_TEMPLATES, generatePrompt } from '../lib/prompt-templates.js';

const [mode, cachePath] = process.argv.slice(2);
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The sample: every 15th identifier across the whole history (trend), plus a
// census of the most recent ~190 (the window the dispatch history still covers).
export const TREND = Array.from({ length: 196 }, (_, i) => 15 * (i + 1)); // LIN-15 … LIN-2940
export const CENSUS = Array.from({ length: 190 }, (_, i) => 2951 + i);   // LIN-2951 … LIN-3140
// Dispatched prompts: every 3rd census ticket, first row of each kind.
export const PROMPT_TICKETS = CENSUS.filter((n) => n % 3 === 0);

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(1100);
    const res = await fetch(`${B}${path}`);
    if (res.status === 429) { await sleep(20000); continue; }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

async function fetchAll() {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { issues: {}, prompts: {} };
  const save = () => writeFileSync(cachePath, JSON.stringify(cache));
  for (const n of [...TREND, ...CENSUS]) {
    const key = `LIN-${n}`;
    if (cache.issues[key] !== undefined) continue;
    const d = await get(`/issues/${key}`);
    cache.issues[key] = d && {
      createdAt: d.createdAt, completedAt: d.completedAt, state: d.state?.type,
      description: d.description || '', comments: (d.comments || []).map((c) => ({ body: c.body || '', createdAt: c.createdAt })),
    };
    save();
  }
  for (const n of PROMPT_TICKETS) {
    const key = `LIN-${n}`;
    if (cache.prompts[key] !== undefined) continue;
    const list = await get(`/dispatch?issueIdentifier=${key}&limit=100`);
    const firstOfKind = new Map();
    for (const it of (list?.items || []).slice().reverse()) if (!firstOfKind.has(it.kind)) firstOfKind.set(it.kind, it);
    cache.prompts[key] = [];
    for (const it of firstOfKind.values()) {
      const p = await get(`/dispatch/${it.id}/prompt`);
      if (p?.prompt) cache.prompts[key].push({ kind: it.kind, dispatchedAt: it.dispatchedAt, followUpTo: p.followUpTo, prompt: p.prompt });
    }
    save();
  }
}

// Phrases an agent obeying a rule writes into a ticket comment. Matching one shows the rule was exercised, not that it caught anything.
export const SIGNATURES = {
  'review ledger written': /What CI Did Not Prove/i,
  'review: Request Changes': /Request Changes/i,
  'review: conditional Approve': /Approve[^\n]{0,40}conditional/i,
  'inside/outside mark (LIN-2825)': /\*\*(inside|outside)\*\*|\b(INSIDE|OUTSIDE)\b|inside\/outside|\|\s*(inside|outside)\b/i,
  'named monitor or rollback lane (LIN-1579)': /named monitor|rollback lane|post-merge observation/i,
  'close-out held / routed back': /\b(hold(ing)? the merge|merge (is )?held|not merging|routes? back to `?implementation)/i,
  'mutation check (LIN-2274)': /\bmutation/i,
  'Principle 0 (LIN-2202)': /Principle 0/i,
  'Surface Assessment': /Surface Assessment/i,
  'class check / bounded classes (LIN-1871)': /class check|bounded class/i,
};
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const words = (s) => (s.match(/\S+/g) || []).length;

function report() {
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
  const byMonth = {};
  for (const [key, d] of Object.entries(cache.issues)) {
    if (!d) continue;
    const n = Number(key.slice(4));
    if (n % 15 !== 0) continue; // trend rows only (every 15th, census included), so the census does not swamp September
    const m = d.createdAt.slice(0, 7);
    (byMonth[m] ||= { n: 0, desc: [], comments: [], commentWords: [] }).n++;
    byMonth[m].desc.push(words(d.description));
    byMonth[m].comments.push(d.comments.length);
    byMonth[m].commentWords.push(d.comments.reduce((s, c) => s + words(c.body), 0));
  }
  const months = Object.keys(byMonth).sort().map((m) => ({ month: m, n: byMonth[m].n, medianDescWords: median(byMonth[m].desc), medianComments: median(byMonth[m].comments), medianCommentWords: median(byMonth[m].commentWords) }));

  const census = Object.entries(cache.issues).filter(([k, d]) => d && CENSUS.includes(Number(k.slice(4))));
  const done = census.filter(([, d]) => d.state === 'completed');
  const censusSummary = {
    tickets: census.length, done: done.length,
    medianDescWordsDone: median(done.map(([, d]) => words(d.description))),
    medianCommentsDone: median(done.map(([, d]) => d.comments.length)),
    medianCommentWordsDone: median(done.map(([, d]) => d.comments.reduce((s, c) => s + words(c.body), 0))),
    commentsCappedAt50: done.filter(([, d]) => d.comments.length >= 50).length,
  };

  // Which path wrote a dispatched worker prompt: the handwritten template (its long fixed lines appear
  // verbatim) or the AI meta-prompt path (a model-written, task-specific prompt).
  const empty = { identifier: 'LIN-1', title: 'x', description: '', url: '', state: { name: 'Todo', type: 'unstarted' }, priority: 0, labels: [] };
  const fixedLines = (kind) => generatePrompt(kind, empty, { comments: [], siblings: [], children: [], attachments: [] }, {}).prompt
    .split('\n').map((l) => l.trim()).filter((l) => l.length > 60 && !/LIN-1\b/.test(l));
  const paths = {};
  for (const rows of Object.values(cache.prompts)) for (const r of rows) {
    if (!PROMPT_TEMPLATES[r.kind]) continue;
    const lines = fixedLines(r.kind);
    const hit = lines.filter((l) => r.prompt.includes(l.slice(0, 60))).length / Math.max(1, lines.length);
    (paths[r.kind] ||= { handwritten: 0, aiWritten: 0 })[hit > 0.3 ? 'handwritten' : 'aiWritten']++;
  }

  const byKind = {};
  for (const rows of Object.values(cache.prompts)) {
    for (const r of rows) {
      const b = Buffer.byteLength(r.prompt);
      (byKind[r.kind] ||= { n: 0, bytes: [] }).n++;
      byKind[r.kind].bytes.push(b);
    }
  }
  const kinds = Object.entries(byKind).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ kind: k, n: v.n, medianBytes: median(v.bytes), maxBytes: Math.max(...v.bytes) }));

  // How often a rule's signature shows up in the comments of Done census tickets: "invoked", not "caught".
  const reviewed = done.filter(([, d]) => d.comments.some((c) => SIGNATURES['review ledger written'].test(c.body)));
  const fired = Object.fromEntries(Object.entries(SIGNATURES).map(([name, re]) => [name, {
    doneTickets: done.filter(([, d]) => d.comments.some((c) => re.test(c.body))).length,
    reviewedTickets: reviewed.filter(([, d]) => d.comments.some((c) => re.test(c.body))).length,
  }]));
  censusSummary.reviewedDone = reviewed.length;
  // Length of the review comments themselves (the ones carrying the ledger), by month of posting.
  const reviewLen = {};
  for (const [, d] of Object.entries(cache.issues)) for (const c of d?.comments || []) if (SIGNATURES['review ledger written'].test(c.body)) (reviewLen[c.createdAt.slice(0, 7)] ||= []).push(words(c.body));
  const reviewWords = Object.keys(reviewLen).sort().map((m) => ({ month: m, n: reviewLen[m].length, medianWords: median(reviewLen[m]) }));

  const out = { months, censusSummary, kinds, paths, fired, reviewWords };
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log('month   n  medDescWords  medComments  medCommentWords');
  for (const r of months) console.log(`${r.month} ${String(r.n).padStart(3)} ${String(r.medianDescWords).padStart(12)} ${String(r.medianComments).padStart(12)} ${String(r.medianCommentWords).padStart(16)}`);
  console.log('\ncensus LIN-2951..3140:', JSON.stringify(censusSummary));
  console.log('\nkind              n  medianBytes  maxBytes');
  for (const r of kinds) console.log(`${r.kind.padEnd(16)} ${String(r.n).padStart(3)} ${String(r.medianBytes).padStart(12)} ${String(r.maxBytes).padStart(9)}`);
  console.log('\nwriting path per templated kind:', JSON.stringify(paths));
  console.log(`\nrule signatures in comments (Done census tickets = ${censusSummary.done}, of which with a review ledger = ${censusSummary.reviewedDone})`);
  for (const [k, v] of Object.entries(fired)) console.log(`${k.padEnd(44)} done=${v.doneTickets} reviewed=${v.reviewedTickets}`);
  console.log('\nreview-comment words by month'); for (const r of reviewWords) console.log(`${r.month} n=${r.n} median=${r.medianWords}`);
}

if (mode === 'fetch') await fetchAll();
else if (mode === 'report') report();
else { console.error('usage: fetch|report <cache.json>'); process.exit(1); }
