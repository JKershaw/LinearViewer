// LIN-3177: one reading digest per sampled ticket (every session cycle on it, labelled, with role, tier, cost, what it did and wrote; its comments; its commits in both repos), plus a machine-readable cycle table for the cost analysis.
// Usage: node scripts/survey-judgement-digests.mjs [--sample data/survey-judgement/sample.json] [--issues data/survey-judgement/issues.json] [--wake data/survey-wake] [--runner data/survey-doubling/runner.json] [--projects ~/.claude/projects] [--sd ../simple-dispatcher] [--out data/survey-judgement]
// Run survey-wake-extract.mjs, survey-doubling-runner.mjs, survey-judgement-sample.mjs and survey-judgement-fetch.mjs first. A cycle is
// survey-wake-extract.mjs's: it opens at a delivered turn (launch, wake, gate, nudge, task notification) and runs to the next. A
// cycle is on a ticket if it is in a session of that ticket (charged to the session entered) or if the item or wake it was handed
// names the ticket (charged to the child the log names); the digest shows both, and cycles.json records which rule claims each.
// Tier is read from each step's own model field: frontier (opus, fable), mid (sonnet), cheap (haiku); opencode sessions leave no
// Claude transcript and are listed from the runner log only. Units weight as survey-wake-extract.mjs. No proxy calls.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const outDir = arg('--out', 'data/survey-judgement');
const sample = JSON.parse(readFileSync(arg('--sample', join(outDir, 'sample.json')), 'utf8')).sample;
const issues = JSON.parse(readFileSync(arg('--issues', join(outDir, 'issues.json')), 'utf8'));
const wakeDir = arg('--wake', 'data/survey-wake');
const runner = JSON.parse(readFileSync(arg('--runner', 'data/survey-doubling/runner.json'), 'utf8'));
const root = arg('--projects', join(homedir(), '.claude/projects'));
const sd = arg('--sd', '../simple-dispatcher');
mkdirSync(join(outDir, 'digests'), { recursive: true });

const sessions = JSON.parse(readFileSync(join(wakeDir, 'sessions.json'), 'utf8'));
const deliveries = readFileSync(join(wakeDir, 'deliveries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const sessById = Object.fromEntries(sessions.map((s) => [s.id, s]));
const delBySess = {};
for (const d of deliveries) (delBySess[d.session] ||= []).push(d);
const named = (d) => d.itemIssue || d.child?.match(/LIN-\d+/)?.[0] || null;

const tierOf = (m = '') => (/opus|fable/i.test(m) ? 'frontier' : /sonnet/i.test(m) ? 'mid' : /haiku/i.test(m) ? 'cheap' : null);
const weight = { frontier: 1, mid: 0.6, cheap: 0.2 };
const unitsOf = (u, t) => { const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return (weight[t] || 0) * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };

// Transcript files by session id.
const files = {};
for (const d of readdirSync(root)) {
  if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
  for (const f of readdirSync(join(root, d))) if (f.endsWith('.jsonl')) files[f.slice(0, 36)] = join(root, d, f);
}

// Signals a reader should not miss, read from what the session saw and wrote in the cycle.
const SIGNALS = {
  'red-ci': /\bCI (is |went |was )?(red|failing|failed)\b|checks? (have )?failed|failing checks?|conclusion"?:\s*"?failure|\bX\s+ci-success|ci-success.*fail/i,
  conflict: /merge conflict|CONFLICT \(|not mergeable|mergeable(_state)?"?:\s*"?(dirty|CONFLICTING|false)|rebase (onto|on) (origin\/)?main/i,
  'failed-child': /\[failed\]|Outcome: \[failed\]|session (failed|crashed)|exited with code [1-9]/i,
  stall: /went silent|silence|stall(ed)? (failsafe|reaper)|no progress (for|in) \d+|being resumed by a failsafe/i,
  'lost-wake': /lost wake|never (got|received) (a|the) wake|wake (was )?(lost|missed|never)|re-?deliver/i,
  escalation: /escalat|needs (John|a human|the operator)|\bJohn\b.*(rul|decid|approv)|operator (ruling|decision)/i,
  'send-back': /request(ed)? changes|REQUEST_CHANGES|send(ing)? (it )?back|\bHOLD\b|verdict:?\s*\**\s*(hold|request)/i,
};

const cut = (s, n) => (s.length <= n ? s : s.slice(0, Math.ceil(n * 0.6)) + ' […] ' + s.slice(-Math.floor(n * 0.4)));
const oneLine = (s) => s.replace(/\/private\/tmp\/claude-\d+\/[^\s'"]*\/scratchpad/g, '$TMP').replace(/\/Users\/work\/development\/simple-dispatcher-workspaces\/[0-9a-f-]{36}\//g, '~ws/').replace(/\s+/g, ' ').trim();
const resultText = (c) => (Array.isArray(c) ? c.filter((b) => b.type === 'tool_result').map((b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('\n') : '')).join('\n') : '');

// Re-read one session's transcript and attach, to each of its cycles, what it wrote and did. Steps are assigned to the latest
// delivery at or before them.
const detail = {};
function readSession(id) {
  if (detail[id]) return detail[id];
  const ds = (delBySess[id] || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const cyc = ds.map((d) => ({ d, text: [], dispatches: [], writes: [], cmds: [], signals: new Set(), units: 0, steps: 0, tiers: {}, end: d.at }));
  const p = files[id];
  if (p) {
    const seen = new Set();
    const at = (ts) => { let k = -1; for (let i = 0; i < ds.length && ds[i].at <= ts; i++) k = i; return k < 0 ? null : cyc[k]; };
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      if (!e.timestamp) continue;
      const c = at(e.timestamp); if (!c) continue;
      if (e.type === 'user') {
        const t = resultText(e.message?.content);
        if (t) for (const [k, re] of Object.entries(SIGNALS)) if (re.test(t.slice(0, 20000))) c.signals.add(k);
        continue;
      }
      if (e.type !== 'assistant') continue;
      const m = e.message; const tier = tierOf(m?.model); c.end = e.timestamp;
      if (m?.id && !seen.has(m.id)) { seen.add(m.id); c.steps++; if (tier) c.tiers[tier] = (c.tiers[tier] || 0) + 1; if (m.usage) c.units += unitsOf(m.usage, tier); }
      for (const b of m?.content || []) {
        if (b.type === 'text' && b.text) { c.text.push(b.text); for (const [k, re] of Object.entries(SIGNALS)) if (re.test(b.text)) c.signals.add(k); }
        if (b.type !== 'tool_use') continue;
        const cmd = String(b.input?.command || b.input?.prompt || '');
        if (b.name === 'Bash' && /api\/proxy\/dispatch\b[^|]*(-X\s*'?POST|-d\s|--data|--json)|autopilot\/kickoff|recommend-and-dispatch/.test(cmd)) c.dispatches.push(cmd);
        else if (b.name === 'Bash' && /api\/proxy\/issues\/[^\s]*\/comments|X-Harbour-Intent:\s*write/.test(cmd)) c.writes.push(cmd);
        else if (b.name === 'Bash' && /\bgh (pr|run|api)|\bgit (push|merge|rebase|commit|checkout -b|reset)/.test(cmd)) c.cmds.push(oneLine(cmd).slice(0, 160));
        else if (b.name === 'Agent' || b.name === 'Task') c.cmds.push(`[subagent] ${oneLine(String(b.input?.description || ''))}`);
        else if (b.name === 'Write' && /\.md$/.test(String(b.input?.file_path || '')) && /autopilot-state|RUN\.md/.test(String(b.input?.file_path))) c.cmds.push(`[state file] ${b.input.file_path.split('/').pop()}`);
      }
    }
  }
  return (detail[id] = cyc);
}

const roleOf = (s) => (s.layer && s.layer !== 'worker' ? s.layer : s.kind || 'other');
const runnerBySess = {};
for (const r of runner.rows) if (r.session) (runnerBySess[r.session] ||= []).push(r);

const gitLines = (repo, id) => { try { return execFileSync('git', ['-C', repo, 'log', 'origin/main', '--format=%h %ad %s', '--date=format:%m-%d %H:%M', `--grep=${id}\\b`, '-E'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };

const table = [];
for (const t of sample) {
  const T = t.id; const iss = issues[T] || {};
  // Sessions of the ticket, and other sessions with a cycle that names it.
  const own = sessions.filter((s) => s.issue === T);
  const other = sessions.filter((s) => s.issue !== T && (delBySess[s.id] || []).some((d) => named(d) === T));
  const all = [...own, ...other].sort((a, b) => a.first.localeCompare(b.first));
  const label = {}; all.forEach((s, i) => (label[s.id] = `S${i + 1}`));
  const rows = [];
  for (const s of all) {
    const cyc = readSession(s.id);
    const ownS = s.issue === T;
    for (const c of cyc) {
      const nm = named(c.d) || s.issue;
      const childNamed = nm === T; if (!ownS && !childNamed) continue;
      const tier = Object.entries(c.tiers).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      rows.push({ s, c, id: `${label[s.id]}.${c.d.n}`, ownS, childNamed, nm, tier });
      table.push({ ticket: T, cycle: `${label[s.id]}.${c.d.n}`, session: s.id, sessionIssue: s.issue, role: roleOf(s), layer: s.layer, kind: s.kind, tier, at: c.d.at, end: c.end, source: c.d.source, itemKind: c.d.kind || null, named: nm, sessionEntered: ownS, childNamed, units: Math.round(c.units), steps: c.steps, outcome: c.d.outcome, signals: [...c.signals] });
    }
  }
  rows.sort((a, b) => a.c.d.at.localeCompare(b.c.d.at));
  const L = [];
  L.push(`# Digest ${T}: ${iss.title || ''}`);
  L.push(`State now: ${iss.state || '?'}; parent: ${iss.parent || 'none'}; children: ${(iss.children || []).join(', ') || 'none'}; labels: ${(iss.labels || []).join(', ') || 'none'}`);
  L.push(`Size: ${t.prodLines} production lines, ${t.testLines} test lines; risk class ${t.risk}; area ${t.area}; repos ${t.repos.join(' + ')}; last merge ${t.lastMerge}.`);
  L.push('', '## Description (first 2,000 characters)', cut(iss.description || '', 2000));
  L.push('', '## Sessions', 'Role is the session layer (Runner, leg, stepper, autopilot = the ticket\'s own supervisor, wake) or the worker kind. "own" = a session of this ticket; "other" = another ticket\'s session, shown only for cycles that name this ticket.');
  for (const s of all) {
    const rr = runnerBySess[s.id] || [];
    const tiers = {}; for (const c of readSession(s.id)) for (const [k, v] of Object.entries(c.tiers)) tiers[k] = (tiers[k] || 0) + v;
    L.push(`- ${label[s.id]} ${s.issue === T ? 'own' : `other (${s.issue})`} role=${roleOf(s)} kind=${s.kind} tier=${Object.keys(tiers).join('/') || '?'} ${s.first.slice(5, 16)}→${(s.last || '').slice(5, 16)} runner-rows=${rr.length}${(() => { const f = runner.sessions[s.id.slice(0, 8)]?.refires; return f ? ` stall-failsafe=${JSON.stringify(f)}` : ''; })()}`);
  }
  const oc = runner.rows.filter((r) => r.issue === T && r.harness === 'opencode');
  if (oc.length) L.push(`- opencode (cheap tier, no transcript): ${oc.length} dispatches, ${oc.map((r) => r.at.slice(5, 16)).join(', ')}`);
  L.push('', '## Timeline of cycles', 'Each line: cycle id, time (UTC), role, tier, what delivered it [and the fetched item kind or wake outcome], weighted units, outcome class (none/read/act/dispatch), signals. Quiet cycles are one line. Text is what the session wrote (head and tail if long).');
  for (const { s, c, id, ownS, nm, tier } of rows) {
    const d = c.d; const sig = c.signals.size ? ` signals=${[...c.signals].join(',')}` : '';
    const what = d.kind ? `item:${d.kind}${d.wake ? `/${d.wake}` : ''}` : d.source;
    const wake = d.outcomeLine ? ` child=${d.child || ''} outcome="${oneLine(d.outcomeLine).slice(0, 140)}"` : '';
    const charge = ownS ? '' : ` [in ${s.issue}'s session]`;
    const head = `### ${id} ${d.at.slice(5, 16)} ${roleOf(s)} ${tier || '?'} ${what}${wake} ${Math.round(c.units / 1000)}k ${d.outcome}${sig}${charge}`;
    const text = oneLine(c.text.join(' '));
    // The bootstrap summary, gate replies and resume handshakes are one line each; supervisor cycles get a shorter excerpt.
    if (d.source === 'launch' && !d.item) { L.push(`${head.replace(/ signals=\S+/, '')} — (bootstrap summary)`); continue; }
    const quiet = ['completion-gate', 'resume-handshake', 'failsafe-reconfirm', 'silence-refire'].includes(d.source) || ((d.outcome === 'none' || d.outcome === 'read' || d.outcome === 'arm') && !c.dispatches.length && !c.writes.length && text.length < 400);
    if (quiet) { L.push(`${head} — ${text.slice(0, 260)}`); continue; }
    L.push(head);
    const sup = ['Runner', 'leg', 'stepper', 'autopilot', 'wake'].includes(roleOf(s));
    if (text) L.push(cut(text, sup ? 800 : 1200));
    for (const x of c.dispatches.slice(0, 3)) L.push(`  → DISPATCH: ${cut(oneLine(x), sup ? 450 : 300)}`);
    for (const x of c.writes.slice(0, 3)) L.push(`  → WRITE: ${cut(oneLine(x), 300)}`);
    if (c.cmds.length) L.push(`  → ${c.cmds.slice(0, 8).join(' | ')}`);
  }
  L.push('', '## Comments on the ticket (each up to 2,400 characters)');
  for (const c of (iss.comments || []).slice().sort((a, b) => a.at.localeCompare(b.at))) L.push(`### comment ${c.at.slice(5, 16)} by ${c.user || '?'}`, cut(c.body, 2400));
  L.push('', '## Commits on origin/main naming the ticket');
  L.push('LinearViewer:', ...gitLines('.', T).map((x) => `  ${x}`));
  if (existsSync(sd)) L.push('simple-dispatcher:', ...gitLines(sd, T).map((x) => `  ${x}`));
  writeFileSync(join(outDir, 'digests', `${T}.md`), L.join('\n') + '\n');
  console.log(T, `sessions=${all.length} cycles=${rows.length}`, `${Math.round(L.join('\n').length / 1000)}k chars`);
}
writeFileSync(join(outDir, 'cycles.json'), JSON.stringify(table));
