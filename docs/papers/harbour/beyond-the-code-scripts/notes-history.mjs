#!/usr/bin/env node
// The life of every area-note entry on a branch's first-parent history (LIN-4479).
//
//   node notes-history.mjs <repo> <ref> [threshold=0.5] > out.json
//
// For each first-parent commit on <ref> that touches docs/areas/, oldest first, it reads every note
// (docs/areas/*.md except README.md), splits it into Lessons and Waiting entries (one per top-level
// "- " bullet, continuation lines joined, the way lib/prompts/area-note-format.js parseNote reads
// Waiting), and follows each entry from commit to commit.
//
// Identity: an entry at commit N is the same entry as one at commit N-1 when their word sets overlap
// by Jaccard >= 0.5, searched across every note and both sections (so a move between notes, or a
// Waiting entry promoted to a Lesson, is a move, not a removal plus an addition). Unmatched entries
// at N are additions; unmatched entries at N-1 are removals. A removal is "with code" when its
// commit also changed a file outside docs/, and "docs only" otherwise.
//
// Output: { ref, head, commits: [{ sha, date, subject, notes: { slug: { lessons, waiting, lessonsBytes,
// waitingBytes } }, added, removed, removedWithCode, moved, edited }], entries: [...] }.
import { execFileSync } from 'node:child_process';

const [repo, ref = 'origin/main', thresholdArg = '0.5'] = process.argv.slice(2);
const THRESHOLD = Number(thresholdArg);
if (!repo) { console.error('usage: notes-history.mjs <repo> <ref>'); process.exit(2); }
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

const head = git('rev-parse', ref).trim();
const shas = git('log', '--first-parent', '--reverse', '--format=%H', ref, '--', 'docs/areas/')
  .trim().split('\n').filter(Boolean);

function parse(text) {
  const out = { Lessons: [], Waiting: [] };
  let section = null;
  for (const line of text.split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (!out[section]) continue;
    if (line.startsWith('- ')) out[section].push(line.slice(2));
    else if (/^\s+\S/.test(line) && out[section].length) out[section][out[section].length - 1] += ` ${line.trim()}`;
  }
  return out;
}
const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9_.\-/]+/g) ?? []);
function jaccard(a, b) {
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i || 1);
}

let prev = []; // [{ id, slug, section, text, w }]
let nextId = 1;
const entries = new Map(); // id -> lifecycle
const commits = [];
for (const sha of shas) {
  const [date, ...subj] = git('show', '-s', '--format=%ad%x09%s', '--date=iso-strict', sha).trim().split('\t');
  const changed = git('diff-tree', '--no-commit-id', '-r', '--name-only', '-m', '--first-parent', sha).trim().split('\n');
  const touchesCode = changed.some((p) => p && !p.startsWith('docs/'));
  const files = git('ls-tree', '--name-only', `${sha}:docs/areas`).trim().split('\n')
    .filter((f) => f.endsWith('.md') && f !== 'README.md');
  const cur = [];
  const notes = {};
  for (const f of files) {
    const slug = f.slice(0, -3);
    const text = git('show', `${sha}:docs/areas/${f}`);
    const p = parse(text);
    notes[slug] = {
      lessons: p.Lessons.length, waiting: p.Waiting.length,
      lessonsBytes: Buffer.byteLength(p.Lessons.join('\n')), waitingBytes: Buffer.byteLength(p.Waiting.join('\n')),
    };
    for (const section of ['Lessons', 'Waiting']) for (const t of p[section]) cur.push({ slug, section, text: t, w: words(t) });
  }
  // Greedy best-first matching between prev and cur.
  const pairs = [];
  for (let i = 0; i < prev.length; i++) for (let j = 0; j < cur.length; j++) {
    const s = prev[i].text === cur[j].text ? 1 : jaccard(prev[i].w, cur[j].w);
    if (s >= THRESHOLD) pairs.push([s, i, j]);
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const usedP = new Set(); const usedC = new Set();
  let moved = 0; let edited = 0;
  for (const [s, i, j] of pairs) {
    if (usedP.has(i) || usedC.has(j)) continue;
    usedP.add(i); usedC.add(j);
    cur[j].id = prev[i].id;
    const e = entries.get(cur[j].id);
    if (prev[i].slug !== cur[j].slug || prev[i].section !== cur[j].section) {
      moved++; e.moves.push({ sha: sha.slice(0, 9), from: `${prev[i].slug}/${prev[i].section}`, to: `${cur[j].slug}/${cur[j].section}` });
    }
    if (s < 1) { edited++; e.edits++; }
    e.last = { slug: cur[j].slug, section: cur[j].section, text: cur[j].text };
  }
  let added = 0;
  for (let j = 0; j < cur.length; j++) if (!usedC.has(j)) {
    added++;
    cur[j].id = nextId++;
    entries.set(cur[j].id, { id: cur[j].id, born: { sha: sha.slice(0, 9), date, subject: subj.join('\t') },
      first: { slug: cur[j].slug, section: cur[j].section }, moves: [], edits: 0,
      last: { slug: cur[j].slug, section: cur[j].section, text: cur[j].text }, died: null });
  }
  let removed = 0; let removedWithCode = 0;
  for (let i = 0; i < prev.length; i++) if (!usedP.has(i)) {
    removed++; if (touchesCode) removedWithCode++;
    entries.get(prev[i].id).died = { sha: sha.slice(0, 9), date, subject: subj.join('\t'), withCode: touchesCode };
  }
  commits.push({ sha: sha.slice(0, 9), date, subject: subj.join('\t'), touchesCode, notes, added, removed, removedWithCode, moved, edited });
  prev = cur;
}
process.stdout.write(JSON.stringify({ ref, head, commits, entries: [...entries.values()] }, null, 1));
