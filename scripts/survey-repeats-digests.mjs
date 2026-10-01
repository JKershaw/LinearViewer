// LIN-3174: one reading digest per sampled repeat leg (the ticket's leg timeline, its comments by leg and verdict, its commits by file class in both repos, and the repeat's launch prompt), into git-ignored files for blind coding.
// Usage: node scripts/survey-repeats-digests.mjs [--sample data/survey-repeats/sample.json] [--census data/survey-repeats/census.json] [--proxy data/survey-repeats/proxy.json] [--sd ../simple-dispatcher] [--dir data/survey-repeats/digests]
// Run survey-repeats-fetch.mjs --detail first. Comments and commits inside the window that matters to the repeat (from the previous
// leg of its kind to the next leg of the same kind, or to Done) are printed whole up to 3,000 characters; outside it, the first
// 300. Each digest is named by its sample index only, so a coder sees nothing of the other coder's work.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { gitCommits, legOf, verdictOf } from './survey-rules-timeline.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sample = read(arg('--sample', 'data/survey-repeats/sample.json'));
const census = read(arg('--census', 'data/survey-repeats/census.json'));
const proxy = read(arg('--proxy', 'data/survey-repeats/proxy.json'));
const dir = arg('--dir', 'data/survey-repeats/digests');
const commits = [...gitCommits('LinearViewer', resolve('.')), ...gitCommits('simple-dispatcher', resolve(arg('--sd', '../simple-dispatcher')))];
const tickets = new Map(census.tickets.map((t) => [t.issue, t]));
const ms = (s) => new Date(s).getTime();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)} …[${s.length - n} more chars]` : s);
mkdirSync(dir, { recursive: true });

sample.legs.forEach((leg, i) => {
  const t = tickets.get(leg.issue); const d = proxy.details[leg.issue];
  const next = t.timeline.find(([at, kind]) => kind === leg.kind && at > leg.at);
  const lo = ms(leg.prevAt || leg.at) - 36e5; const hi = next ? ms(next[0]) : Infinity;
  const inWin = (at) => ms(at) >= lo && ms(at) <= hi;
  const p = proxy.prompts[leg.item];
  const ev = [
    ...t.timeline.map(([at, kind, id]) => ({ at, text: `### LEG ${kind} launched · ${at} · item ${id}${id === leg.item.slice(0, 8) ? '  <<< THE REPEAT BEING CODED' : ''}${id === (leg.prevItem || '').slice(0, 8) ? '  <<< the previous leg of this kind' : ''}` })),
    ...(d?.comments || []).map((c) => ({ at: c.createdAt, text: `### comment · ${c.createdAt} · heading reads as: ${legOf(c.body)} · verdict: ${verdictOf(c.body) || 'none'}\n${clip(c.body, inWin(c.createdAt) ? 3000 : 300)}` })),
    ...commits.filter((c) => c.ids.includes(leg.issue)).map((c) => ({ at: c.at, text: `### commit ${c.repo} ${c.sha} · ${c.at} · prod ${c.lines.prod} / test ${c.lines.test} / docs ${c.lines.docs} / other ${c.lines.other} lines${c.pr ? ` · PR #${c.pr}` : ''}\n${c.subject}` })),
  ].sort((a, b) => ms(a.at) - ms(b.at));
  const body = [
    `# Digest ${String(i + 1).padStart(2, '0')}: ${leg.issue} · ${d?.title || '(title not fetched)'}`,
    `Repeat being coded: a ${leg.kind} leg, round ${leg.round} of its kind on this ticket, launched ${leg.at} (item ${leg.item.slice(0, 8)}). The previous ${leg.kind} leg launched ${leg.prevAt} (item ${(leg.prevItem || '').slice(0, 8)}). Next ${leg.kind} leg: ${next ? next[0] : 'none'}.`,
    `Repo(s) whose merges name the ticket: ${t.repo}. Production lines changed over the ticket: ${t.prodLines ?? 'no merge'}.`,
    `## The repeat's launch prompt${p ? ` (promptName: ${p.promptName}; kind: ${p.kind})` : ' (not fetched)'}\n${p?.prompt ? clip(p.prompt, 4000) : ''}`,
    `## Ticket description (first 1,500 characters)\n${clip(d?.description || '', 1500)}`,
    `## Timeline: legs, comments and commits in time order`,
    ...ev.map((e) => e.text),
  ].join('\n\n');
  writeFileSync(`${dir}/${String(i + 1).padStart(2, '0')}.digest`, body); // not .md: the docs anchor sweep walks every .md on disk, git-ignored or not
});
console.log(`digests=${sample.legs.length} dir=${dir}`);
