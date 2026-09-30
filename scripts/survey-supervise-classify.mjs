// LIN-3150: code every supervisor step into one action class by fixed rules over what woke it, the tools it called and the text it wrote (the census coder).
// Usage: node scripts/survey-supervise-classify.mjs [--in data/survey-supervise/steps.jsonl] [--out data/survey-supervise/coded.jsonl]
// Classes are defined before coding (see CLASSES). A step with several actions takes the first class in PRIORITY that any of them matches.
// The hand-coded double sample in docs/papers/harbour/what-supervisors-do-codes.json is the check on these rules (survey-supervise-analyse.mjs).
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inp = arg('--in', 'data/survey-supervise/steps.jsonl'); const out = arg('--out', 'data/survey-supervise/coded.jsonl');

export const CLASSES = {
  orient: 're-ground or orient: the bootstrap summary, reading the repo, docs, instructions or its own notes to find its bearings',
  read: 'read tracker or dispatch state: fetch the wake prompt, an issue, brief, relations, rulings, a child\'s feedback or transcript',
  poll: 'wait or poll: CI, PR state, child status; acknowledging a progress-only wake that changes nothing',
  judge: 'judge a worker\'s report: spot-check its claims against the repo or tracker, accept, route back or escalate it',
  decide: 'decide the next task or design question: ask the engine what is next, weigh options, choose',
  dispatch: 'dispatch the next phase or beat: write the worker prompt and send it',
  relay: 'relay a ruling or escalation: put a decision request to John, or pass a ruling or verdict to another session',
  rearm: 're-arm a wake: answer the completion gate with a PENDING sentinel, schedule a wake, arm a monitor',
  restate: 'restate or summarise state: a progress report to the operator, a status comment, a note in its own state file',
  land: 'act on the record: set status or labels, merge a PR, mark Done',
  work: 'do a worker\'s job itself: edit code, docs or tests in the repo, commit or push (leaves altitude)',
  recover: 'recover from an error: retry or work around a failed call',
};
export const PRIORITY = ['land', 'work', 'dispatch', 'relay', 'rearm', 'recover', 'judge', 'decide', 'poll', 'read', 'restate', 'orient'];

const GATE = /Before this task is marked complete, confirm its true state|went silent while its completion|re-confirm its completion/;
const WAKE = /Your task \(dispatch item [0-9a-f-]+\) is ready|resumed to handle a follow-up|child session reached a terminal outcome|<task-notification>/;
const SENTINEL = /^\s*(PENDING-EXTERNAL|PENDING-INTERNAL|DONE|FAILED|BLOCKED|DECISION)\b/;
const PROGRESS_ONLY = /progress-only|no change|nothing (?:new|changed|to do)|still (?:running|in progress|going|waiting)|no action/i;

function toolClasses(t, ctx) {
  const c = t.input; const n = t.name; const k = new Set();
  if (/ScheduleWakeup|CronCreate/.test(n)) k.add('rearm');
  if (/Monitor|TaskOutput/.test(n)) k.add('poll');
  if (/^(Agent|Task)$/.test(n)) k.add(ctx.dispatched ? 'judge' : 'orient');
  if (/^(Write|Edit|NotebookEdit)$/.test(n)) k.add(/state|notes|log|RUN/i.test(c) ? 'restate' : /beat|prompt|brief/i.test(c) ? 'dispatch' : /scratchpad|\/tmp\//.test(c) ? 'restate' : 'work');
  if (/ToolSearch|Skill/.test(n)) k.add('orient');
  if (/^(Read|Grep|Glob)$/.test(n)) k.add(/scratchpad\/.*(feedback|recap|result|wake|b\d|verdict)/i.test(c) ? 'read' : /scratchpad\/.*(prompt|rec|instr)/i.test(c) ? 'orient' : ctx.dispatched ? 'judge' : 'orient');
  if (n !== 'Bash') return k;
  if (/gh pr merge|state[\"']?\s*:\s*[\"']?(Done|Canceled)|\/issues\/[^ ]*\/(state|status|labels)|-X (PATCH|PUT)[^|]*\/issues\/|--data[^|]*"(stateId|state|labelIds|labels)"/.test(c)) k.add('land');
  if (/-X POST[^|]*\/(dispatch|autopilot\/kickoff|recommend-and-dispatch)\b|\/(recommend-and-dispatch|autopilot\/kickoff)\b[^|]*-X POST|curl[^|]*(-d|--data)[^|]*\/api\/proxy\/dispatch\b|api\/proxy\/dispatch"?\s[^|]*(-d|--data)/.test(c) || /\/recommend-and-dispatch/.test(c)) k.add('dispatch');
  if (/cat > [^ ]*(beat|prompt|brief|wake|leg|child|task)[^ ]*\.(md|txt|json|py)/i.test(c) || (/prompt\s*=\s*(f?"""|`|\[)|"promptName"|\bbeat \d+ ?(\/|of) ?\d/i.test(c) && /cat >|<<|prompt\s*=/.test(c))) k.add('dispatch');
  if (/git (commit|push|add)\b|gh pr create|open\(['"][^'"]*(lib|routes|tests?|public)\/[^'"]*['"],\s*['"]w/.test(c)) k.add('work');
  if (/\/comments?\b[^|]*(-d|--data|-X POST)|(-d|--data)[^|]*\/comments?\b|"body"\s*:|body\s*=\s*(f?"""|\[|`)|mkcomment|comment[^ ]*\.(md|json)'? ?<</.test(c)) k.add(/escalat|DECISION|ruling|John|BLOCKED|needs? (a |your )?(call|decision)/i.test(c) ? 'relay' : 'restate');
  if (/\/rulings[^|]*-X POST|-X POST[^|]*\/rulings/.test(c)) k.add('relay');
  if (/gh pr checks|check-runs|gh run (watch|view|list)|gh pr view[^|]*(state|mergeable|statusCheck|checks)|\bsleep \d|until |while |--watch|\/dispatch\?[^ ]*status/.test(c)) k.add('poll');
  if (/(echo|printf) [^|]*>> ?[^ ]*(state|notes|log|RUN)|cat >> ?[^ ]*(state|notes|log|RUN)|cat > [^ ]*(state|notes|log|RUN|c\d+)[^ ]*\.md|p\s*=\s*["'][^"']*(RUN|STATE|state)[^"']*\.md/i.test(c)) k.add('restate');
  if (/\/recommend\/LIN-|\/stack\b|\/next-run|\/north-star/.test(c)) k.add('decide');
  if (/\/dispatch\/[0-9a-f-]{8,}[^ ]*\/prompt|\/dispatch\/[0-9a-f-]{8,}\b|\$B\/dispatch\/\$|\/issues\/|\/brief\/|\/relations\/|\/rulings|\/cost\b|\/dispatch\?|~\/\.claude\/projects|\/ledger|\/me\b/.test(c) || /(json\.load|JSON\.parse|require\()[^)]*(issue|iss\d|brief|rec|dispatch|d-|b\d|feedback|done|spike|r0_|rel|wake|child|leg)[^)]*\.json/i.test(c)) k.add('read');
  if (/git (diff|show|log|grep|blame)|grep |sed -n|\bawk |node --test|npm (run )?test|wc -l|head -|find |\bls\b|\bcat [^>]/.test(c)) k.add(ctx.dispatched ? 'judge' : 'orient');
  if (/\/instructions|README|CLAUDE\.md|git fetch|git status|git rev-parse|git branch|git checkout|git pull|\bpwd\b|summar/i.test(c)) k.add('orient');
  return k;
}

export function classify(step, prev, ctx) {
  if (step.preTask) return { cls: 'orient', rule: 'before the task arrived (bootstrap)' };
  const text = step.text || ''; const trig = step.trigger || '';
  const k = new Set(); for (const t of step.tools) for (const x of toolClasses(t, ctx)) k.add(x);
  if (!step.tools.length) {
    if (!GATE.test(trig) && ctx.sinceWake <= 2 && PROGRESS_ONLY.test(text.slice(0, 300))) return { cls: 'poll', rule: 'acknowledges a progress-only wake' };
    if (GATE.test(trig) || SENTINEL.test(text)) {
      if (/^\s*(BLOCKED|DECISION)/.test(text)) return { cls: 'relay', rule: 'gate reply escalates to a human' };
      return { cls: 'rearm', rule: 'completion-gate sentinel' };
    }
    if (/DECISION|escalat|needs John|John's call|for John/i.test(text)) return { cls: 'relay', rule: 'text escalates' };
    if (/Request Changes|route[sd]? (it )?back|accepted|passed my (spot-)?checks|held up|verdict|approve[sd]?\b/i.test(text) && ctx.sinceWake <= 4) return { cls: 'judge', rule: 'text weighs a worker result' };
    return { cls: 'restate', rule: 'text-only report' };
  }
  if (prev && prev.errors > 0 && prev.session === step.session && /retry|again|fail|error|instead|didn't|did not|broke|wrong|fix|timed? ?out|403|404|500/i.test(text + ' ' + (prev.results || []).join(' ').slice(0, 300))) k.add('recover');
  if (k.has('read') && WAKE.test(trig) && step.tools.every((t) => /\/dispatch\/[0-9a-f-]+\/prompt/.test(t.input))) return { cls: 'read', rule: 'takes delivery of a wake' };
  for (const c of PRIORITY) if (k.has(c)) return { cls: c, rule: 'tool pattern' };
  return { cls: ctx.dispatched ? 'judge' : 'orient', rule: 'fallback: unmatched tool' };
}

if (process.argv[1]?.endsWith('survey-supervise-classify.mjs')) {
  const steps = readFileSync(inp, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const outL = []; let prev = null; let ctx = null;
  for (const s of steps) {
    if (!prev || prev.session !== s.session) ctx = { dispatched: false, sinceWake: 99 };
    if (s.trigger && /Your task \(dispatch item|resumed to handle a follow-up|<task-notification>|child session reached/.test(s.trigger)) ctx.sinceWake = 0; else ctx.sinceWake++;
    const r = classify(s, prev, ctx);
    if (r.cls === 'dispatch') ctx.dispatched = true;
    outL.push({ session: s.session, n: s.n, layer: s.layer, issue: s.issue, t: s.t, units: s.units, genMs: s.genMs, toolMs: s.toolMs, blockMs: s.blockMs, parkedAfterMs: s.parkedAfterMs, cls: r.cls, rule: r.rule });
    prev = s;
  }
  writeFileSync(out, outL.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const tot = outL.reduce((a, x) => a + x.units, 0); const by = {};
  for (const x of outL) { const b = (by[x.cls] ||= { n: 0, u: 0, ms: 0 }); b.n++; b.u += x.units; b.ms += x.genMs + x.toolMs; }
  console.log(`coded ${outL.length} steps`); console.log('class\tsteps\tunit%\tactive-h');
  for (const [c, b] of Object.entries(by).sort((a, b) => b[1].u - a[1].u)) console.log([c, b.n, (100 * b.u / tot).toFixed(1), (b.ms / 36e5).toFixed(1)].join('\t'));
  const rules = {}; for (const x of outL) rules[x.rule] = (rules[x.rule] || 0) + 1; console.log(rules);
}
