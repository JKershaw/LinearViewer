// LIN-3150: collect supervisor failures on record — tracker tickets that report one (proxy search, paced) and the failure signals in the supervisor transcripts themselves.
// Usage: node scripts/survey-supervise-failures.mjs [--dir data/survey-supervise] [--offline]   (--offline reuses the cached search snapshot)
// Tracker: GET /search?q= for each query below, one call per 4.5 s (the survey's shared 15/min budget); an issue is a candidate when its title or
// description names a supervisor layer and its title a failure word (search rows carry no dates; LIN-2435 is the first September number). The kept tickets are hand-classed in
// docs/papers/harbour/what-supervisors-do-failures.json. Transcripts: counts of the runner's failsafe re-confirms and silence nudges, refused or
// duplicate dispatches, and steps the census coded `work` (a supervisor editing or committing in the repo).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-supervise'); const offline = process.argv.includes('--offline');
const base = process.env.HARBOUR_LOCAL_BASE; const snap = join(dir, 'failure-search.json');
const QUERIES = ['autopilot loop', 'autopilot wake', 'missed wake', 'wake storm', 'stepper', 'passage runner', 'runner leg', 'duplicate dispatch', 'orchestrator', 'autopilot altitude', 'autopilot routed', 'autopilot escalat', 'parent wake', 'progress wake', 'autopilot stalled', 'supervisor'];
const LAYER = /autopilot|stepper|runner|\bleg\b|passage|orchestrat|supervis|parent session|wake/i;
const FAIL = /loop|miss|duplicat|stall|wrong|stuck|lost|silent|never|double|spurious|storm|drift|re-?fire|orphan|mis-?rout|ignored|skipp|over-?reach|altitude|forgot|did not|didn't|fails?\b|bug|broke/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let found = existsSync(snap) && offline ? JSON.parse(readFileSync(snap, 'utf8')) : {};
if (!offline) {
  if (!base) throw new Error('HARBOUR_LOCAL_BASE is not set (or pass --offline)');
  for (const q of QUERIES) {
    const r = await fetch(`${base}/api/proxy/search?q=${encodeURIComponent(q)}`); const j = await r.json();
    for (const i of j.issues || j.results || j.items || []) found[i.identifier] ||= { identifier: i.identifier, title: i.title, createdAt: i.createdAt, state: i.state?.name || i.state, description: (i.description || '').slice(0, 1500), queries: [] }, found[i.identifier].queries.push(q);
    await sleep(4500);
  }
  writeFileSync(snap, JSON.stringify(found, null, 1));
}
const kept = Object.values(found).filter((i) => LAYER.test(i.title + ' ' + i.description) && FAIL.test(i.title)).sort((a, b) => a.identifier.localeCompare(b.identifier, 'en', { numeric: true }));
writeFileSync(join(dir, 'failure-tickets.json'), JSON.stringify(kept, null, 1));
console.log(`tracker: ${Object.keys(found).length} issues from ${QUERIES.length} searches; ${kept.length} candidates, ${kept.filter((i) => +i.identifier.slice(4) >= 2435).length} of them from September`);
for (const i of kept) console.log(`  ${i.identifier}\t${i.state}\t${i.title}`);

// Transcript signals.
const steps = readFileSync(join(dir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const coded = readFileSync(join(dir, 'coded.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sig = { failsafeReconfirm: 0, silenceNudge: 0, duplicateRefused: 0, dispatchHttpError: 0, workSteps: 0, sessionsWithWork: new Set(), gateFailed: 0, gateBlocked: 0 };
steps.forEach((s, i) => {
  if (/resumed by a failsafe to re-confirm/.test(s.trigger)) sig.failsafeReconfirm++;
  if (/went silent while its completion/.test(s.trigger)) sig.silenceNudge++;
  const res = s.results.join(' ');
  if (/DUPLICATE_DISPATCH/.test(res)) sig.duplicateRefused++;
  if (s.tools.some((t) => /\/dispatch\b|kickoff|recommend-and-dispatch/.test(t.input)) && /HTTP (4\d\d|5\d\d)/.test(res) && !/DUPLICATE_DISPATCH/.test(res)) sig.dispatchHttpError++;
  if (coded[i].cls === 'work') { sig.workSteps++; sig.sessionsWithWork.add(s.session); }
  if (/^\s*FAILED:/.test(s.text)) sig.gateFailed++;
  if (/^\s*BLOCKED:/.test(s.text)) sig.gateBlocked++;
});
sig.sessionsWithWork = sig.sessionsWithWork.size;
writeFileSync(join(dir, 'failure-signals.json'), JSON.stringify(sig, null, 1));
console.log('transcript signals:', sig);
