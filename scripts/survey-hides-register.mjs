// LIN-3188: find the tracker tickets since 1 June that may record an instance of a cross-session failure pattern (P1–P8), and summarise the hand-coded register of those kept.
// Usage: node scripts/survey-hides-register.mjs [--in data/survey-hides] [--register docs/papers/harbour/what-hides-between-sessions-register.json] [--candidates]
// Window: LIN-300 onward (the first ticket numbers dated 29 May–4 June by their first commit mention; list rows carry no dates).
// A candidate is a ticket whose title carries a failure word (FAIL below) and whose title matches a pattern's title regex or whose
// title+description match the pattern's body regex. Regexes (case-insensitive):
//   FAIL  /\b(bug|fix|broken|fail|failed|fails|failing|stuck|never|lost|dropp|wedg|stall|hang|loop|storm|duplicate|double|twice|silent|swallow|mask|hid|orphan|deadlock|circular|flak|stale|leak|spin|race|regress|wrong|not woken|missed|rca|incident|outage|503|401|dead)/
//   P1 healed/masked errors: title /(503|502|401|403|retry|retried|transient|swallow|mask|silent(ly)?|heal|rate.?limit|429|dead (credential|token)|expired|revoked)/ ; body /(retr(y|ied|ies)|transient|swallow|masked|heal|re-?select|fallback|silently)/
//   P2 circular/orphaned waits: title /(circular|deadlock|orphan|waits? on|waiting on|pending.?external|never (resum|unblock)|blocked forever|wait.*(stuck|never))/ ; body /(circular|deadlock|orphan|waits? on .* waits? on|pending.?external)/
//   P3 retry-only passes: title /(flak|retry.*pass|passes on retry|intermittent(ly)? (fail|red)|timing.?dependent|race in .*test|test.*race)/ ; body /(flak|on retry|retries: ?[12]|intermittent)/
//   P4 quiet wakes: title /(no.?op wake|quiet wake|wake.*(nothing|noise|spam|redundant|unnecessary)|redundant (wake|beat|follow)|re-?arm.*(wake|relay))/ ; body /(wakes? that change nothing|no-op wake|quiet wake|redundant wake)/
//   P5 lost wakes: title /(wake|follow-?up|signal|terminal result|\[done\]|resume).*(lost|never|missed|dropp|not (deliver|woken|fire|sent)|swallow|severed)|(lost|missed|dropped|never) (wake|follow-?up|signal)|not woken|never woke/ ; body /(lost wake|never woke|wake was (lost|dropped)|not re-?invoked)/
//   P6 stalled sessions: title /(stall|wedg|hung|hang|stuck|silent for|idle for|zombie|never (finish|complet|exit)|frozen|unresponsive|limbo|parked forever)/ ; body /(stall|wedged|went silent|silence clock|stuck in)/
//   P7 duplicated work: title /(duplicat|double.?dispatch|dispatched twice|twice|two (sessions|autopilots|orchestrators|PRs|implementations)|re-?dispatch.*(same|already)|already (done|merged|landed|fixed)|redundant (session|pr|dispatch|ticket))/ ; body /(duplicate (dispatch|session|PR|work)|dispatched twice|same issue and kind|two sessions)/
//   P8 loops/storms: title /(loop|storm|runaway|self-?wake|ping-?pong|re-?fire.*(repeat|loop)|infinite|cascade|thrash|spin)/ ; body /(loop(ed|ing)|storm|runaway|self-?loop|re-?fir)/
// Reads <in>/issues.json (scripts/survey-hides-tracker.mjs). --candidates writes <in>/candidates.json (id, title, patterns, first 1,500 chars).
// Otherwise reads the register and the fetched details, adds createdAt and the first merge date naming the ticket in either repo's git log,
// and writes <in>/register-summary.json. Times are in hours: discovery = filed − onset (or the record's own discoveredAfterMinutes),
// fix = the first non-docs commit on main naming the ticket at or after filing. No proxy calls.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--in', 'data/survey-hides');
const regPath = arg('--register', 'docs/papers/harbour/what-hides-between-sessions-register.json');
const num = (id) => Number(id.split('-')[1]);

const FAIL = /\b(bug|fix|broken|fail|failed|fails|failing|stuck|never|lost|dropp|wedg|stall|hang|loop|storm|duplicate|double|twice|silent|swallow|mask|hid|orphan|deadlock|circular|flak|stale|leak|spin|race|regress|wrong|not woken|missed|rca|incident|outage|503|401|dead)/i;
const P = {
  P1: [/(503|502|401|403|retry|retried|transient|swallow|mask|silent(ly)?|heal|rate.?limit|429|dead (credential|token)|expired|revoked)/i, /(retr(y|ied|ies)|transient|swallow|masked|heal|re-?select|fallback|silently)/i],
  P2: [/(circular|deadlock|orphan|waits? on|waiting on|pending.?external|never (resum|unblock)|blocked forever|wait.*(stuck|never))/i, /(circular|deadlock|orphan|waits? on .* waits? on|pending.?external)/i],
  P3: [/(flak|retry.*pass|passes on retry|intermittent(ly)? (fail|red)|timing.?dependent|race in .*test|test.*race)/i, /(flak|on retry|retries: ?[12]|intermittent)/i],
  P4: [/(no.?op wake|quiet wake|wake.*(nothing|noise|spam|redundant|unnecessary)|redundant (wake|beat|follow)|re-?arm.*(wake|relay))/i, /(wakes? that change nothing|no-op wake|quiet wake|redundant wake)/i],
  P5: [/(wake|follow-?up|signal|terminal result|\[done\]|resume).*(lost|never|missed|dropp|not (deliver|woken|fire|sent)|swallow|severed)|(lost|missed|dropped|never) (wake|follow-?up|signal)|not woken|never woke/i, /(lost wake|never woke|wake was (lost|dropped)|not re-?invoked)/i],
  P6: [/(stall|wedg|hung|hang|stuck|silent for|idle for|zombie|never (finish|complet|exit)|frozen|unresponsive|limbo|parked forever)/i, /(stall|wedged|went silent|silence clock|stuck in)/i],
  P7: [/(duplicat|double.?dispatch|dispatched twice|twice|two (sessions|autopilots|orchestrators|PRs|implementations)|re-?dispatch.*(same|already)|already (done|merged|landed|fixed)|redundant (session|pr|dispatch|ticket))/i, /(duplicate (dispatch|session|PR|work)|dispatched twice|same issue and kind|two sessions)/i],
  P8: [/(loop|storm|runaway|self-?wake|ping-?pong|re-?fire.*(repeat|loop)|infinite|cascade|thrash|spin)/i, /(loop(ed|ing)|storm|runaway|self-?loop|re-?fir)/i],
};

const issues = JSON.parse(readFileSync(join(dir, 'issues.json'), 'utf8')).issues.filter((i) => num(i.identifier) >= 300);

if (process.argv.includes('--candidates')) {
  const cands = [];
  for (const i of issues) {
    const t = i.title || ''; const b = `${t}\n${(i.description || '').slice(0, 3000)}`;
    const hit = Object.entries(P).filter(([, [tr, br]]) => FAIL.test(t) && (tr.test(t) || br.test(b))).map(([k]) => k);
    if (hit.length) cands.push({ id: i.identifier, title: t, state: i.state?.name, patterns: hit, text: (i.description || '').slice(0, 1500) });
  }
  cands.sort((a, b) => num(a.id) - num(b.id));
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify(cands, null, 1));
  const by = {}; for (const c of cands) for (const p of c.patterns) by[p] = (by[p] || 0) + 1;
  console.log(`${issues.length} issues from LIN-300; ${cands.length} candidates`, by);
  process.exit(0);
}

// Summary over the hand-coded register.
const reg = JSON.parse(readFileSync(regPath, 'utf8'));
// The first commit on main naming the ticket, at or after filing, that touches anything outside docs/ (a paper citing the id is not a fix).
const gitFirst = (id, after) => {
  let best = null;
  for (const repo of ['.', '../simple-dispatcher']) {
    try {
      const o = execSync(`git -C ${repo} log origin/main --format=%cI -E --grep='${id}([^0-9]|$)' -- . ':!docs' ':!*.md'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
        .map((x) => new Date(x).toISOString()).filter((x) => !after || x >= after).sort();
      if (o[0] && (!best || o[0] < best)) best = o[0];
    } catch { /* repo absent */ }
  }
  return best;
};
const hours = (a, b) => (Date.parse(b) - Date.parse(a)) / 36e5;
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rows = reg.incidents.map((x) => {
  const p = join(dir, 'details', `${x.id}.json`);
  const d = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  const filed = d?.createdAt || x.filed || null;
  const fixed = /^LIN-/.test(x.id) ? gitFirst(x.id, filed) : null;
  const toDiscovery = x.discoveredAfterMinutes != null ? x.discoveredAfterMinutes / 60 : x.onset && filed ? Math.max(0, hours(x.onset, filed)) : null;
  return { ...x, filed, fixed, toDiscoveryHours: toDiscovery, toFixHours: filed && fixed ? Math.max(0, hours(filed, fixed)) : null };
});
const groups = {};
for (const r of rows) for (const key of [`${r.pattern}|${r.repo}`, `${r.pattern}|all`, `all|${r.repo}`, 'all|all']) (groups[key] ||= []).push(r);
const summary = {};
for (const [k, g] of Object.entries(groups).sort()) {
  const disc = {}; for (const r of g) disc[r.detectedBy] = (disc[r.detectedBy] || 0) + 1;
  const td = g.map((r) => r.toDiscoveryHours).filter((x) => x != null); const tf = g.map((r) => r.toFixHours).filter((x) => x != null);
  summary[k] = { incidents: g.length, crossSession: g.filter((r) => r.crossSession).length, detectedBy: disc,
    toDiscoveryHours: { n: td.length, median: med(td), min: td.length ? Math.min(...td) : null, max: td.length ? Math.max(...td) : null },
    toFixHours: { n: tf.length, median: med(tf), min: tf.length ? Math.min(...tf) : null, max: tf.length ? Math.max(...tf) : null } };
}
writeFileSync(join(dir, 'register-summary.json'), JSON.stringify({ rows, summary }, null, 1));
for (const [k, s] of Object.entries(summary)) console.log(k.padEnd(16), JSON.stringify(s));
