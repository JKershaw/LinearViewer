// LIN-3188: the served prompt rules that tell an agent to watch for, or how to handle, each cross-session failure pattern (P1–P8), located at HEAD with size and the commit that introduced each.
// Usage: node scripts/survey-hides-prompts.mjs [--sd ../simple-dispatcher] [--out docs/papers/harbour/what-hides-between-sessions-prompt-rules.json]
// Patterns: P1 healed or masked errors; P2 circular or orphaned waits; P3 tests that pass only on retry; P4 wakes that change nothing;
// P5 lost wakes; P6 stalled sessions; P7 duplicated work; P8 loops and runaway repeats.
// Population: the prompt text a session is actually served — LinearViewer lib/prompts/*.js, lib/periodicals.js, lib/prompt-templates.js,
// lib/proxy-instructions.js (auto-appended to every dispatch), and the five docs the kickoffs read at runtime (autopilot-operating-manual,
// passage-planner-prompt, passage-runner-prompt, runner-prompt, worker-lane-prompt); simple-dispatcher's hook.js and reapers.js injected
// texts. Not served, so not counted: docs/autopilot-kickoff.md (a mirror of the kickoff) and docs/autopilot-orchestrator-prompt.md.
// RULES is a hand-curated list, read from a keyword sweep (SWEEP below, whose hit counts are printed for transparency); each rule's
// anchor is an exact single-line substring. role: 'watch' tells the agent to look for the pattern; 'handle' says what to do once seen
// (often: retry, re-arm or adopt); 'heal' tells it to retry past an error, which is the behaviour that hides P1; 'declare' asks the
// agent to state what it waits on; 'assert-away' says the pattern cannot occur. A rule's bytes are its bullet or paragraph (see START below). Introduction: the oldest commit whose diff adds the anchor (git log -S, following renames).
// No proxy calls; git only.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const LV = process.cwd();
const SD = resolve(arg('--sd', '../simple-dispatcher'));
const out = arg('--out', 'docs/papers/harbour/what-hides-between-sessions-prompt-rules.json');
const ROOT = { LinearViewer: LV, 'simple-dispatcher': SD };

const RULES = [
  // P1 healed or masked errors
  ['P1', 'heal', 'LinearViewer', 'lib/proxy-instructions.js', "**Don't park on one 401.**", 'Provider-lane 401s are transient OAuth windows: retry over 10–15 minutes before concluding the credential is disconnected'],
  ['P1', 'heal', 'LinearViewer', 'lib/proxy-instructions.js', 'client-side network flakiness, not a proxy error. Safe to retry once for', 'An empty or non-JSON body is network flakiness: retry a read once'],
  ['P1', 'heal', 'LinearViewer', 'docs/runner-prompt.md', 'Harbour answered the poll with an error (a 429, a 5xx during a deploy): just re-arm', "A 429 or 5xx on the runner's poll: re-arm and carry on"],
  ['P1', 'watch', 'LinearViewer', 'docs/runner-prompt.md', 'credential was **rejected (expired or revoked)** means it is dead', 'Only an explicit rejection means the runner credential is dead; anything else is transient'],
  ['P1', 'watch', 'LinearViewer', 'lib/proxy-instructions.js', "provider-lane 401 (the workspace's own stored credential rejected upstream)", "GET /credential-health reports this token's provider-credential 401s over a window"],
  ['P1', 'watch', 'LinearViewer', 'docs/passage-planner-prompt.md', 'An all-`never` board can also mean a transient store failure', 'An empty board may be a transient store failure: hold the reading lightly'],
  // P2 circular or orphaned waits
  ['P2', 'declare', 'simple-dispatcher', 'hook.js', 'PENDING-EXTERNAL: <you are waiting on ANOTHER session', 'At the completion gate, name the other session you wait on and what you expect back'],
  ['P2', 'declare', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'wait on the layer above you, not a hand-back to the human', 'A child waiting on its parent emits PENDING-EXTERNAL, not BLOCKED'],
  ['P2', 'assert-away', 'LinearViewer', 'docs/autopilot-operating-manual.md', "deadlock trap doesn't apply under push", 'Under push a subscribed child has no mutual wait with its parent, so the hold is safe'],
  ['P2', 'watch', 'LinearViewer', 'lib/prompts/meta-prompt-template.js', 'detect this from the blocking relationship', 'The recommender reads Blocked from an incomplete blocks/blocked-by relation'],
  // P3 tests that pass only on retry
  ['P3', 'watch', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', 'flake or real regression — name the failing specs', 'Brief a sub-agent to say flake or regression, and whether the specs also fail on main'],
  ['P3', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'this a flake?", "is this really done?"', "Re-derive 'is this a flake?' from evidence each time, not from the last answer"],
  ['P3', 'watch', 'LinearViewer', 'lib/periodicals.js', '**Fold in reliability signal — capability-gated, discovery-style.**', 'The Test Coverage Gap periodical reads CI history for flaky or unreliable tests'],
  // P4 wakes that change nothing
  ['P4', 'handle', 'LinearViewer', 'docs/runner-prompt.md', '`cap` → nothing happened: just re-arm.', 'A wait that ends at its cap with nothing new: re-arm'],
  ['P4', 'handle', 'LinearViewer', 'lib/prompts/flight-companion-brief.js', 'if there is no new decision, no stall and no landing, say nothing at all', 'Flight Companion brief: no new decision, stall or landing means say nothing'],
  ['P4', 'handle', 'LinearViewer', 'lib/prompts/flight-companion-brief.js', 'Never restate counts as news', 'An unchanged picture is not news'],
  // P5 lost wakes
  ['P5', 'watch', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', 'Never sit waiting on a wake that may never come', 'Do not wait indefinitely on a push wake; the ~30-minute silence clock applies'],
  ['P5', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'Never sit waiting on a wake that', 'Do not wait indefinitely on a push wake'],
  ['P5', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'terminating emits none, so a one-off watch (or a `followUpTo` nudge) on a suspected-wedged worker is still', 'A worker silent without terminating sends no wake; probe it yourself'],
  // P6 stalled sessions
  ['P6', 'watch', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', 'pass with zero new activity', 'After ~30 minutes with no activity, send a liveness nudge, then re-dispatch fresh'],
  ['P6', 'handle', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', '(last tool: Bash)\\`** with no new tool calls is *usually one long command running*', 'A [stalled?] line on Bash is usually a long command: check before re-dispatching'],
  ['P6', 'watch', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', '~30 min with zero new activity is a wedged', '~30 minutes with zero activity is a wedged session: nudge then re-dispatch'],
  ['P6', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'a long silence is a session that may be wedged or dead', 'A long silence may be a wedged or dead session: probe it'],
  ['P6', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'long with no wake gets a one-line `followUpTo` liveness nudge', 'A child silent too long gets a liveness nudge, then a fresh re-dispatch'],
  ['P6', 'handle', 'LinearViewer', 'docs/runner-prompt.md', 'When `wait` exits with `stall`, stop each subagent marked', "The runner kit's watchdog flags silent subagents; stop those it marks"],
  ['P6', 'handle', 'LinearViewer', 'lib/prompts/flight-companion-kickoff.js', 'never report them as stalled or dead', 'A [blocked] session is parked on a human, never report it as stalled'],
  ['P6', 'handle', 'LinearViewer', 'lib/prompts/flight-companion-brief.js', 'say it has gone quiet, not that it is stuck or dead', 'Without evidence, say a session has gone quiet, not that it is stuck'],
  ['P6', 'handle', 'simple-dispatcher', 'reapers.js', 'went silent while its completion was still unconfirmed', 'Code detects 60 minutes of silence and asks the session to re-confirm its state'],
  // P7 duplicated work
  ['P7', 'handle', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', 'means someone else already started this exact step', 'A 409 DUPLICATE_DISPATCH: adopt the live dispatch, do not retry or re-word'],
  ['P7', 'handle', 'LinearViewer', 'lib/proxy-instructions.js', 'DUPLICATE GUARD — a FRESH dispatch for an issue+kind', 'Code refuses a fresh dispatch of the same issue and kind within five minutes'],
  ['P7', 'handle', 'LinearViewer', 'docs/passage-runner-prompt.md', 'Treat a `409 DUPLICATE_DISPATCH` the way', 'The passage Runner adopts the refused duplicate instead of re-dispatching'],
  ['P7', 'handle', 'LinearViewer', 'docs/passage-planner-prompt.md', '5-minute scoped-duplicate window', 'The planner reports a duplicate refusal and stops; never retries'],
  ['P7', 'watch', 'LinearViewer', 'lib/proxy-instructions.js', 'blind-retry on an empty/lost response', 'Do not blind-retry a write on a lost response; re-read to confirm first'],
  // P8 loops and runaway repeats
  ['P8', 'watch', 'LinearViewer', 'lib/prompts/autopilot-kickoff.js', 'the same kind repeating is **looping**', 'The same step kind repeating is looping; a second plan round-trip escalates'],
  ['P8', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'The same move repeating is', 'The same move repeating is looping; the bound says escalate'],
  ['P8', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', '**A repeated failure met with a repeated explanation.**', 'The same failure waved off the same way twice is the tell nobody zoomed out'],
  ['P8', 'watch', 'LinearViewer', 'docs/autopilot-operating-manual.md', 'Sometimes the task itself keeps stalling', 'A task failing the same way twice is a task problem: change something first'],
  ['P8', 'watch', 'LinearViewer', 'lib/prompts/meta-prompt-template.js', '**A SECOND Request Changes / Needs Discussion on the same task**', 'A second Request Changes on one task: recommend blocked and escalate'],
];

const SWEEP = {
  P1: /credential|\b50[23]\b|\b401\b|transient|backoff|back off|retry/i,
  P2: /circular|deadlock|mutual(ly)? wait|waiting on each other|blocked-by|PENDING-EXTERNAL/i,
  P3: /flak|on retry|re-?run/i,
  P4: /quiet wake|nothing happened|re-?arm|no new decision/i,
  P5: /lost wake|missed wake|wake that may never|never woke/i,
  P6: /stall|wedged|went silent|liveness|stuck|zero new activity/i,
  P7: /duplicat|DUPLICATE_DISPATCH|already started|blind-retry/i,
  P8: /looping|runaway|repeated failure|keeps stalling|SECOND Request Changes/i,
};
const SERVED = {
  LinearViewer: ['lib/prompts', 'lib/periodicals.js', 'lib/prompt-templates.js', 'lib/proxy-instructions.js', 'docs/autopilot-operating-manual.md', 'docs/passage-planner-prompt.md', 'docs/passage-runner-prompt.md', 'docs/runner-prompt.md', 'docs/worker-lane-prompt.md'],
  'simple-dispatcher': ['hook.js', 'reapers.js'],
};

const git = (repo, args) => { try { return execFileSync('git', ['-C', ROOT[repo], ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim(); } catch { return ''; } };
// A rule's text starts at a bullet, an arrow, a numbered step or a heading, and ends at the next one or a blank line (at most 12 lines either way).
const START = /^\s*(?:[-*] |→|\d+\. |#|\* |['`]?- )/;
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

const rules = [];
for (const [pattern, role, repo, file, anchor, paraphrase] of RULES) {
  const p = join(ROOT[repo], file);
  if (!existsSync(p)) { rules.push({ pattern, role, repo, file, anchor, paraphrase, missing: true }); continue; }
  const lines = readFileSync(p, 'utf8').split('\n');
  const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) { rules.push({ pattern, role, repo, file, anchor, paraphrase, missing: true }); continue; }
  let bytes = 0;
  for (const h of hits) {
    let a = h; while (a > 0 && h - a < 12 && !START.test(lines[a]) && lines[a - 1].trim() !== '') a--;
    let b = h; while (b < lines.length - 1 && b - h < 12 && lines[b + 1].trim() !== '' && !START.test(lines[b + 1])) b++;
    bytes += Buffer.byteLength(lines.slice(a, b + 1).join('\n'));
  }
  const intro = git(repo, ['log', '--reverse', '--follow', '--date=short', '--format=%h|%ad|%s', '-S', anchor, '--', file]).split('\n')[0] || '';
  const [sha, date, subject] = intro.split('|');
  const ticket = (subject || '').match(/\b(LIN-\d+)\b/)?.[1] || null;
  rules.push({ pattern, role, repo, at: `${file}:${hits.map((h) => h + 1).join(',')}`, copies: hits.length, paraphrase, bytes, introduced: sha ? { sha, date, ticket, subject: subject.slice(0, 120) } : null });
}

const sweep = {};
for (const [pat, re] of Object.entries(SWEEP)) {
  sweep[pat] = 0;
  for (const [repo, paths] of Object.entries(SERVED)) for (const rel of paths) {
    const files = git(repo, ['ls-files', '--', rel]).split('\n').filter(Boolean);
    for (const f of files) for (const l of readFileSync(join(ROOT[repo], f), 'utf8').split('\n')) if (!isComment(l) && re.test(l)) sweep[pat]++;
  }
}

const heads = { LinearViewer: git('LinearViewer', ['rev-parse', '--short', 'HEAD']), 'simple-dispatcher': git('simple-dispatcher', ['rev-parse', '--short', 'HEAD']) };
const byPattern = {};
for (const r of rules) {
  const b = (byPattern[r.pattern] ||= { rules: 0, copies: 0, bytes: 0, roles: {}, earliest: null, repos: {} });
  b.rules++; b.copies += r.copies || 0; b.bytes += r.bytes || 0; b.roles[r.role] = (b.roles[r.role] || 0) + 1; b.repos[r.repo] = (b.repos[r.repo] || 0) + 1;
  if (r.introduced && (!b.earliest || r.introduced.date < b.earliest)) b.earliest = r.introduced.date;
}
writeFileSync(out, JSON.stringify({ about: 'LIN-3188: served prompt rules per cross-session failure pattern, written by scripts/survey-hides-prompts.mjs. at is path:line at the heads below; bytes is the containing paragraph(s); introduced is the oldest commit adding the anchor; for lib/proxy-instructions.js it is an upper bound, since the catalog moved there from routes/ on 3 Sep (LIN-2245).', heads, byPattern, sweepCandidateLines: sweep, rules }, null, 1) + '\n');
console.log('heads', heads);
console.log('pattern rules copies bytes earliest roles | sweep candidate lines');
for (const k of Object.keys(SWEEP)) { const b = byPattern[k] || {}; console.log(k, b.rules || 0, b.copies || 0, b.bytes || 0, b.earliest, JSON.stringify(b.roles || {}), '|', sweep[k]); }
const miss = rules.filter((r) => r.missing); if (miss.length) console.log('MISSING anchors:', miss.map((r) => `${r.file}: ${r.anchor}`));
