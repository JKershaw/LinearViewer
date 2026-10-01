// LIN-3188: the periodicals' record since June — runs per template, the review tickets they minted, those tickets' follow-ups, which concerned a cross-session failure pattern (P1–P8), the adversarial second reads, and the September batch's cost.
// Usage: node scripts/survey-hides-periodicals.mjs [--data data/survey-hides] [--projects ~/.claude/projects] [--fetch]
// Inputs: docs/reviews/<template>-review-YYYY-MM-DD.md (each persisted periodical report; git); <data>/issues.json (scripts/survey-hides-tracker.mjs,
// list rows with title, description, parent and state); <data>/sessions.jsonl (scripts/survey-hides-transcripts.mjs, weighted units per
// session); <data>/periodicals-raw.json, GET /api/proxy/periodicals (one call, made only with --fetch or when the file is missing).
// A run ticket: a title that opens with a template's name (not "Add/New/Improve/Harden/Expand/Fix/Periodical:") or a description carrying
// the harbour-periodical-gate marker. A follow-up: any other ticket whose description names a run ticket filed before it, or a report's
// file name. Pattern links (P1 healed errors, P2 circular/orphaned waits, P3 retry-only passes, P4 quiet wakes, P5 lost wakes, P6 stalled
// sessions, P7 duplicated work, P8 loops) are hand-read from the keyword hits of PATTERN_RE over title + description and the reports'
// own text; each is listed in READINGS with what it was. role: 'aggregated' (the periodical clustered instances others had already
// filed), 'response' (a follow-up built because of such a cluster), 'gap-flag' (named a missing detector, no instance), 'self-miss'
// (the periodical missed a cluster), 'instance' (the periodical's own run found an instance first).
// Cost: weighted units (survey-wake-extract.mjs weights) of sessions whose launch issue is a run ticket or a child of one (stage 2), plus
// Stage-1 mint sessions (no issue; a delivered item whose prompt opens "# Periodical: "). Transcripts exist from 31 August only.
// Flight Companion (written to <data>/fc.json): GET /api/proxy/flight-companion/transcripts (one call, cached as fc-transcripts-raw.json;
// a token with no owner gets an empty list, and the in-page companion's chats are stored only there); tickets whose description says the
// Flight Companion filed, found or flagged them (FC_RE), hand-read in FC_READINGS for pattern and who noticed first; dispatched sessions
// whose delivered prompt is the companion kickoff ("# You're the Flight Companion" in a user turn, not merely a task about the companion);
// and the operator's own local sessions (~/.claude/projects/-Users-work-development-harbour*), counted.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const data = arg('--data', 'data/survey-hides');
const projects = arg('--projects', join(homedir(), '.claude', 'projects'));
const rawPath = join(data, 'periodicals-raw.json');
if (process.argv.includes('--fetch') || !existsSync(rawPath)) {
  const base = process.env.HARBOUR_LOCAL_BASE; if (!base) throw new Error('HARBOUR_LOCAL_BASE unset');
  writeFileSync(rawPath, execFileSync('curl', ['-s', '-m', '30', `${base}/api/proxy/periodicals`], { encoding: 'utf8' }));
}
const registry = JSON.parse(readFileSync(rawPath, 'utf8')).periodicals || [];

const TEMPLATES = ['api-quality', 'code-quality', 'comprehension-debt', 'dependency-supply-chain', 'design-interface', 'documentation', 'drift-coherence', 'integration-surface-maturity', 'onboarding-cold-start', 'recent-headwinds', 'security', 'stability', 'test-coverage-gap', 'performance-scale', 'data-fetch-architecture'];
const NAMES = /^(Documentation Review|Test Coverage Gap|Security Review|API Quality Review|Code Quality Review|Drift & Coherence Review|Comprehension-Debt Review|Stability Review|Dependency & Supply-Chain Review|Recent Headwinds|Design & Interface Review|Performance \/ Scale Review|Data & Fetch Architecture|Integration & Surface Maturity|Onboarding & Cold-Start Review)/;
const PATTERN_RE = /credential|\b401\b|\b503\b|transient|heal|circular|deadlock|orphan|mutual wait|flak|wake|stall|wedge|went silent|stuck|liveness|duplicate (?:dispatch|session)|double[- ]dispatch|DUPLICATE_DISPATCH|runaway|self-loop/i;

// Hand readings of every keyword hit that concerns a runtime cross-session pattern (the rest were code, docs or UI findings: an
// install step matching "stall", duplicated code, the GitHub re-auth page, a DUPLICATE_DISPATCH documentation gap).
const READINGS = [
  { id: 'LIN-896', report: 'recent-headwinds-review-2026-07-02', patterns: ['P5', 'P6', 'P8'], role: 'aggregated', note: 'H1 autopilot-reliability-cluster: LIN-768/778/790/831/881, each filed and fixed before the run; the first 07-01 draft missed it' },
  { id: 'LIN-899', report: 'recent-headwinds-review-2026-07-02', patterns: ['P5', 'P6', 'P8'], role: 'self-miss', note: 'Harden Recent Headwinds: its 07-01 run folded the five-bug liveness cluster into forward work' },
  { id: 'LIN-1166', report: 'recent-headwinds-review-2026-07-09', patterns: ['P5', 'P6', 'P8'], role: 'aggregated', note: 'cluster carried: LIN-924/946/1059/1165 (a wake self-loop), all filed before the run' },
  { id: 'LIN-1169', report: 'recent-headwinds-review-2026-07-09', patterns: ['P5', 'P6'], role: 'response', note: 'characterisation test pinning wake/hold/close invariants' },
  { id: 'LIN-1490', report: 'recent-headwinds-review-2026-07-09', patterns: ['P5', 'P6'], role: 'response', note: 'full-system hermetic suite for the Harbour + runner stack' },
  { id: null, report: 'integration-surface-maturity-review-2026-07-17', patterns: ['P6', 'P2'], role: 'gap-flag', note: 'no stuck-session detection at the Harbour layer for a taken item with no feedback; advisory, nothing minted' },
  { id: 'LIN-2383', report: 'integration-surface-maturity-review-2026-08-29', patterns: ['P6', 'P2'], role: 'gap-flag', note: 'the same gap, repeated; LIN-2079 had added a silentSince read on 16 Aug, no detector reads it' },
  { id: 'LIN-2364', report: 'recent-headwinds-review-2026-08-29', patterns: ['P5', 'P8'], role: 'aggregated', note: 'H5 a fix-induced chain in wake/resume, from filed tickets' },
  { id: 'LIN-3104', report: 'recent-headwinds-review-2026-09-26', patterns: ['P6'], role: 'instance', note: "H1 periodical-cadence: the periodicals' own layer ran nothing for ~4 weeks (08-30 to 09-26); found when the batch resumed" },
  { id: 'LIN-3105', report: 'integration-surface-maturity-review-2026-09-26', patterns: ['P6', 'P2'], role: 'gap-flag', note: 'the same gap, a third time' },
];

const reportsDir = 'docs/reviews';
const reports = readdirSync(reportsDir).filter((f) => /-2026-\d\d-\d\d(?:-[a-z0-9]+)?\.md$/.test(f) && TEMPLATES.some((t) => f.startsWith(t)) && f >= '' )
  .map((f) => {
    const date = f.match(/(2026-\d\d-\d\d)/)[1]; const template = TEMPLATES.find((t) => f.startsWith(t));
    const text = readFileSync(join(reportsDir, f), 'utf8');
    const verdicts = [...text.matchAll(/Adversarial second-read verdict:\s*\**\s*(AGREE|DISAGREE)\b/g)].map((m) => m[1]);
    return { file: f, template, date, bytes: Buffer.byteLength(text), patternLines: text.split('\n').filter((l) => PATTERN_RE.test(l)).length, secondRead: verdicts.length ? (verdicts.includes('DISAGREE') ? 'DISAGREE' : 'AGREE') : null };
  }).filter((r) => r.date >= '2026-06-01').sort((a, b) => a.date.localeCompare(b.date));

const issues = JSON.parse(readFileSync(join(data, 'issues.json'), 'utf8')).issues;
const num = (id) => +id.split('-')[1];
const stateOf = (i) => (typeof i.state === 'object' ? i.state?.name : i.state);
const runs = issues.filter((i) => (NAMES.test(i.title) || /harbour-periodical-gate id="[a-z]/.test(i.description || '')) && !/^(Add|New|Improve|Harden|Expand|Fix|Periodical:)/.test(i.title));
const runIds = new Set(runs.map((i) => i.identifier));
const reportNames = reports.map((r) => r.file.replace(/\.md$/, ''));
const followUps = [];
for (const i of issues) {
  if (runIds.has(i.identifier)) continue;
  const d = i.description || '';
  const from = [...runIds].filter((r) => num(r) < num(i.identifier) && new RegExp(`\\b${r}\\b`).test(d)).concat(reportNames.filter((n) => d.includes(n)));
  if (from.length) followUps.push({ id: i.identifier, state: stateOf(i), title: i.title.slice(0, 140), from, keywordHit: PATTERN_RE.test(`${i.title} ${d.slice(0, 1500)}`) });
}

// Cost from transcripts (31 August onward).
const sessions = existsSync(join(data, 'sessions.jsonl')) ? readFileSync(join(data, 'sessions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const children = new Set(issues.filter((i) => i.parent && runIds.has(i.parent.identifier || i.parent)).map((i) => i.identifier));
const files = new Map();
for (const d of readdirSync(projects)) { if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue; for (const f of readdirSync(join(projects, d))) if (f.endsWith('.jsonl')) files.set(f.slice(0, 36), join(projects, d, f)); }
const stage1 = (s) => {
  if (s.issue || !files.has(s.id) || (s.items || []).length > 2) return null;
  for (const line of readFileSync(files.get(s.id), 'utf8').split('\n')) {
    if (!line.includes('tool_result')) continue;
    const m = line.match(/# Periodical: ([A-Za-z &\/-]+)/); if (m) return m[1].trim();
  }
  return null;
};
const cost = { stage1: [], stage2: [] };
for (const s of sessions) {
  if (s.issue && (runIds.has(s.issue) || children.has(s.issue))) cost.stage2.push({ id: s.id.slice(0, 8), issue: s.issue, kind: s.kind, first: s.first, units: s.units });
  else { const t = stage1(s); if (t) cost.stage1.push({ id: s.id.slice(0, 8), template: t, first: s.first, units: s.units }); }
}
const sum = (a) => a.reduce((x, y) => x + (y.units || 0), 0);
const fleetSept = sum(sessions.filter((s) => (s.first || '') >= '2026-09-01' && (s.first || '') < '2026-10-01'));

const byTemplate = {};
for (const t of TEMPLATES) byTemplate[t] = { reports: reports.filter((r) => r.template === t).map((r) => r.date), lastDispatched: registry.find((p) => t.startsWith(p.id) || p.id.startsWith(t))?.lastDispatchedAt || null };
const result = {
  about: 'LIN-3188: written by scripts/survey-hides-periodicals.mjs. registry: GET /api/proxy/periodicals (lastDispatchedAt reads a 30-day dispatch horizon). reports: docs/reviews since 1 June. readings: hand-read pattern links.',
  registry: registry.map((p) => ({ id: p.id, mode: p.mode, state: p.state, lastDispatchedAt: p.lastDispatchedAt })),
  reports, byTemplate, runTickets: runs.map((i) => ({ id: i.identifier, state: stateOf(i), title: i.title.slice(0, 120) })).sort((a, b) => num(a.id) - num(b.id)),
  followUps: followUps.sort((a, b) => num(a.id) - num(b.id)), readings: READINGS,
  cost: { ...cost, stage1Units: sum(cost.stage1), stage2Units: sum(cost.stage2), fleetSeptemberUnits: fleetSept },
};
writeFileSync(join(data, 'periodicals.json'), JSON.stringify(result, null, 1) + '\n');

const by = (a, k) => a.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log('reports since June:', reports.length, 'templates with a report:', Object.values(byTemplate).filter((t) => t.reports.length).length, 'of', TEMPLATES.length);
console.log('reports by month:', JSON.stringify(by(reports.map((r) => ({ m: r.date.slice(0, 7) })), 'm')));
console.log('second reads (reports from 2026-08-23):', JSON.stringify(by(reports.filter((r) => r.date >= '2026-08-23').map((r) => ({ v: r.secondRead || 'none' })), 'v')));
console.log('run tickets:', runs.length, ' follow-ups:', followUps.length, ' with a pattern keyword:', followUps.filter((f) => f.keywordHit).length);
console.log('readings by role:', JSON.stringify(by(READINGS, 'role')), ' instance catches:', READINGS.filter((r) => r.role === 'instance').map((r) => r.id).join(','));
console.log('cost (weighted units, transcripts from 31 Aug): stage1', cost.stage1.length, 'sessions', sum(cost.stage1), '| stage2', cost.stage2.length, 'sessions', sum(cost.stage2), '| fleet September', fleetSept, '| share', ((sum(cost.stage1) + sum(cost.stage2)) / fleetSept * 100).toFixed(2) + '%');
console.log('stage2 by issue:', JSON.stringify(cost.stage2.reduce((m, s) => ((m[s.issue] = (m[s.issue] || 0) + s.units), m), {})));

// ---- Flight Companion ----
const fcRawPath = join(data, 'fc-transcripts-raw.json');
if (process.argv.includes('--fetch') || !existsSync(fcRawPath)) {
  const base = process.env.HARBOUR_LOCAL_BASE; if (!base) throw new Error('HARBOUR_LOCAL_BASE unset');
  writeFileSync(fcRawPath, execFileSync('curl', ['-s', '-m', '30', `${base}/api/proxy/flight-companion/transcripts`], { encoding: 'utf8' }));
}
const fcChats = (JSON.parse(readFileSync(fcRawPath, 'utf8')).chats || []).length;
const FC_RE = /(filed|found|spotted|caught|noticed|raised|surfaced|flagged|reported)( by| from)? (the )?Flight Companion|Flight Companion (filed|found|spotted|caught|noticed|flagged|surfaced|broke|diagnosed)|FC (filed|spotted|caught|noticed)/i;
// first: who noticed the instance first, as the ticket states it. 'fc' = the companion from live observation; 'john' = filed at John's
// suggestion or instruction (the companion diagnosed); 'close-out' = carried from a close-out's recommendation.
const FC_READINGS = {
  'LIN-1854': { pattern: 'P1', first: 'fc', note: "a worker read another session's /tmp payload as a proxy fault and self-blocked" },
  'LIN-2216': { pattern: 'P1', first: 'fc', note: 'a transient upstream 401 relayed as an indistinguishable credential failure (22 Aug, live operator evidence)' },
  'LIN-2394': { pattern: 'P1', first: 'john', note: 'proxy-token expiresAt ~7 h ahead of the real 401; the operator session went dark ~7 h' },
  'LIN-3181': { pattern: 'P1', first: 'john', note: 'a dead Linear credential re-selected every 30 s for ~11 h, reported as transient 503s' },
  'LIN-2393': { pattern: 'P6', first: 'close-out', note: 'cold dispatch wedges on folder trust; the watchdog is blind to it under one driver' },
  'LIN-2446': { pattern: 'P6', first: 'fc', note: 'kitty driver wedged an overnight run: every launch failed' },
  'LIN-2456': { pattern: 'P2', first: 'fc', note: 'a held queue head starves every item behind it' },
  'LIN-2457': { pattern: 'P6', first: 'fc', note: 'close-on-DONE missed Terminal.app sessions: idle windows left live' },
  'LIN-3118': { pattern: 'P6', first: 'john', note: 'the runner stopped polling overnight, ~9 h 19 m' },
  'LIN-3122': { pattern: 'P6', first: 'john', note: "an agent's pkill killed the runner's terminal; sessions stayed wedged in EXECUTING" },
};
const fcTickets = issues.filter((i) => FC_RE.test((i.description || '').slice(0, 4000))).map((i) => ({ id: i.identifier, state: stateOf(i), title: i.title.slice(0, 120), ...(FC_READINGS[i.identifier] || { pattern: null }) })).sort((a, b) => num(a.id) - num(b.id));
let fcSessions = 0; const fcMentions = [];
for (const [id, f] of files) {
  const raw = readFileSync(f, 'utf8'); if (!raw.includes("# You're the Flight Companion")) continue;
  let delivered = false;
  for (const line of raw.split('\n')) { if (!line.includes("# You're the Flight Companion")) continue; try { const e = JSON.parse(line); if (e.type === 'user' && !String(line).includes('tool_result')) { delivered = true; break; } } catch {} }
  if (delivered) fcSessions++; else fcMentions.push(id.slice(0, 8));
}
const local = [];
for (const d of readdirSync(projects).filter((x) => x.startsWith('-Users-work-development-harbour'))) for (const f of readdirSync(join(projects, d)).filter((x) => x.endsWith('.jsonl'))) {
  const raw = readFileSync(join(projects, d, f), 'utf8');
  local.push({ dir: d, id: f.slice(0, 8), first: raw.match(/"timestamp":"([^"]+)"/)?.[1] || null, companionKickoff: raw.includes("# You're the Flight Companion"), patternLines: raw.split('\n').filter((l) => /circular|deadlock|dead credential|wedged|stalled|stuck|lost wake|duplicate dispatch|looping/i.test(l)).length });
}
// The one local companion session (30 Jul) read by hand: it caught two sessions stuck EXECUTING in a background wait (45+ and 47 min,
// LIN-1701 and LIN-1698's verify), John correlated them with a runner redeploy, and LIN-1713 and LIN-1714 followed.
const LOCAL_READINGS = [{ id: '73592f8e', date: '2026-07-30', pattern: 'P6', instances: 2, first: 'fc+john', idleMin: [45, 47], tickets: ['LIN-1713', 'LIN-1714'] }];
writeFileSync(join(data, 'fc.json'), JSON.stringify({ about: 'LIN-3188: Flight Companion record, written by scripts/survey-hides-periodicals.mjs', apiChats: fcChats, dispatchedCompanionSessions: fcSessions, sessionsOnlyAboutTheCompanion: fcMentions, local, localReadings: LOCAL_READINGS, tickets: fcTickets }, null, 1) + '\n');
const pat = fcTickets.filter((t) => t.pattern);
console.log('FC: api chats', fcChats, '| dispatched companion sessions', fcSessions, '| local sessions', local.length, '(companion kickoff in', local.filter((l) => l.companionKickoff).length + ')');
console.log('FC tickets:', fcTickets.length, ' on a pattern:', pat.length, JSON.stringify(pat.reduce((m, t) => ((m[t.pattern] = (m[t.pattern] || 0) + 1), m), {})), ' first noticed by:', JSON.stringify(pat.reduce((m, t) => ((m[t.first] = (m[t.first] || 0) + 1), m), {})));
