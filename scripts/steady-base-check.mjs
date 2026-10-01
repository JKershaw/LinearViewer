// LIN-3145: the independent check's own measures of docs/papers/harbour/steady-base.md (paths, promptnames, carry-rules, claude-md, cuts, inventory, sample, agreement).
// Usage: node scripts/steady-base-check.mjs <measure> [args]   (see the dispatch table at the bottom; each measure prints JSON)
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const root = new URL('../', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
const rulesFile = new URL('docs/papers/harbour/steady-base-rules.json', root);
const codesFile = new URL('docs/papers/harbour/steady-base-check-codes.json', root);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [measure, ...args] = process.argv.slice(2);

// The server-side writing paths name a dispatch row after the action (recommend-and-dispatch,
// routes/proxy-dispatch.js) or the kind; a raw POST /dispatch keeps the caller's own promptName.
const ACTIONS = new Set(['blocked', 'bug', 'plan', 'look into', 'triage', 'breakdown', 'research', 'scoping', 'design', 'spike', 'context', 'plan-review', 'implement', 'review', 'close-out', 'retrospective-audit']);
const writer = (name, kind) => (ACTIONS.has(name) || name === kind ? 'server-named' : name === 'Prompt' ? 'unnamed' : /beat/i.test(name) ? 'orchestrator beat' : 'other caller');

// promptnames <out.json>: the promptName of the same rows steady-base-tracker.mjs samples (first dispatch of each kind, every 3rd ticket LIN-2951..3140).
async function promptnames(out) {
  const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`; const res = {};
  for (let n = 2951; n <= 3140; n++) {
    if (n % 3) continue;
    let list = null;
    for (let a = 0; a < 4 && !list; a++) { await sleep(3000); const r = await fetch(`${B}/dispatch?issueIdentifier=LIN-${n}&limit=100`); if (r.status === 429) { await sleep(20000); continue; } list = r.ok ? await r.json() : {}; }
    const first = new Map();
    for (const it of (list?.items || []).slice().reverse()) if (!first.has(it.kind)) first.set(it.kind, { id: it.id, promptName: it.promptName, dispatchedAt: it.dispatchedAt });
    res[`LIN-${n}`] = Object.fromEntries(first); writeFileSync(out, JSON.stringify(res));
  }
}

// paths <tracker-cache.json> [promptnames.json]: the tracker's handwritten-path score under other cut-offs and line lengths, and who wrote each prompt.
async function paths(cachePath, namesPath) {
  const { PROMPT_TEMPLATES, generatePrompt } = await import(new URL('lib/prompt-templates.js', root).href);
  const cache = JSON.parse(readFileSync(cachePath, 'utf8')); const names = namesPath ? JSON.parse(readFileSync(namesPath, 'utf8')) : {};
  const empty = { identifier: 'LIN-1', title: 'x', description: '', url: '', state: { name: 'Todo', type: 'unstarted' }, priority: 0, labels: [] };
  const fixed = (kind, min) => generatePrompt(kind, empty, { comments: [], siblings: [], children: [], attachments: [] }, {}).prompt.split('\n').map((l) => l.trim()).filter((l) => l.length > min && !/LIN-1\b/.test(l));
  const rows = [];
  for (const [t, rs] of Object.entries(cache.prompts)) for (const r of rs) {
    if (!PROMPT_TEMPLATES[r.kind]) continue;
    const score = (min) => { const ls = fixed(r.kind, min); return ls.filter((l) => r.prompt.includes(l.slice(0, min))).length / Math.max(1, ls.length); };
    const name = names[t]?.[r.kind]?.dispatchedAt === r.dispatchedAt ? names[t][r.kind].promptName : null;
    rows.push({ t, kind: r.kind, s40: score(40), s60: score(60), s100: score(100), who: name == null ? 'unknown' : writer(name, r.kind),
      quotesEngineBrief: /(engine|server)[- ]generated|quoted below|engine.s brief|brief is (quoted|below)/i.test(r.prompt) });
  }
  const s60 = rows.map((r) => r.s60).sort((a, b) => a - b);
  const sweep = Object.fromEntries([0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5].map((th) => [th, { s40: rows.filter((r) => r.s40 > th).length, s60: rows.filter((r) => r.s60 > th).length, s100: rows.filter((r) => r.s100 > th).length }]));
  const cross = {};
  for (const r of rows) { const k = `${r.who} | ${r.s60 > 0.3 ? 'handwritten' : 'not handwritten'}`; cross[k] = (cross[k] || 0) + 1; }
  const beats = rows.filter((r) => r.who === 'orchestrator beat');
  console.log(JSON.stringify({ prompts: rows.length, gapAt30: [Math.max(...s60.filter((s) => s <= 0.3)), Math.min(...s60.filter((s) => s > 0.3))], sweep, cross,
    beats: beats.length, beatsQuotingEngineBrief: beats.filter((r) => r.quotesEngineBrief).length }, null, 1));
}

// carry-rules [--since] [--until]: rule-bearing text steady-base-carry.mjs files under other categories (the proxy /instructions catalogue, CLAUDE.md reads), same carry weighting.
function carryRules() {
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const since = new Date(arg('--since', '2026-09-24')); const until = new Date(arg('--until', '2026-09-29T20:00:00Z'));
  const proj = join(homedir(), '.claude', 'projects'); const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : '')).join('') : '');
  const agg = { total: 0, 'dispatched prompt': 0, 'proxy instructions': 0, 'CLAUDE.md reads': 0 }; const per = []; let n = 0, readInstr = 0;
  for (const d of readdirSync(proj)) {
    if (!d.includes('simple-dispatcher-workspaces')) continue;
    for (const f of readdirSync(join(proj, d))) {
      const p = join(proj, d, f); if (!f.endsWith('.jsonl')) continue; const t = statSync(p).mtime; if (t < since || t >= until) continue;
      const tool = new Map(); const seen = new Set(); const ev = []; let kind = null;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (!e || e.isSidechain || !e.message) continue; const m = e.message;
        if (e.type === 'assistant') {
          for (const b of m.content || []) if (b.type === 'tool_use') tool.set(b.id, b);
          if (m.usage && !seen.has(m.id)) { seen.add(m.id); const u = m.usage; ev.push(['turn', (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)]); }
        } else if (e.type === 'user') for (const b of Array.isArray(m.content) ? m.content : []) {
          if (b.type !== 'tool_result') continue;
          const body = text(b.content); const use = tool.get(b.tool_use_id); const cmd = use?.input?.command || ''; let cat = null;
          if (/\/api\/proxy\/dispatch\/[0-9a-f-]+\/prompt/.test(cmd) && /"promptName"/.test(body)) { cat = 'dispatched prompt'; if (!kind) kind = body.match(/"kind"\s*:\s*"([a-z-]+)"/)?.[1] || null; }
          else if (/\/api\/proxy\/instructions/.test(cmd)) cat = 'proxy instructions';
          else if (/CLAUDE\.md/.test(use?.input?.file_path || '') || /\bCLAUDE\.md\b/.test(cmd)) cat = 'CLAUDE.md reads';
          if (cat) ev.push([cat, Buffer.byteLength(body)]);
        }
      }
      const turns = ev.filter((x) => x[0] === 'turn'); if (!kind || turns.length < 3) continue;
      n++; const tot = turns.reduce((s, x) => s + x[1], 0); let after = turns.length; const c = {};
      for (const [k, v] of ev) { if (k === 'turn') { after--; continue; } c[k] = (c[k] || 0) + (v / 4) * after; }
      agg.total += tot; for (const k of ['dispatched prompt', 'proxy instructions', 'CLAUDE.md reads']) agg[k] += c[k] || 0;
      if (c['proxy instructions']) readInstr++;
      per.push(((c['dispatched prompt'] || 0) + (c['proxy instructions'] || 0) + (c['CLAUDE.md reads'] || 0)) / tot);
    }
  }
  const pct = (x) => +(100 * x / agg.total).toFixed(2);
  console.log(JSON.stringify({ sessions: n, sessionsReadingInstructions: readInstr, pooledPct: { 'dispatched prompt': pct(agg['dispatched prompt']), 'proxy instructions': pct(agg['proxy instructions']), 'CLAUDE.md reads': pct(agg['CLAUDE.md reads']) },
    medianSessionPctAllThree: +(100 * median(per)).toFixed(2) }, null, 1));
}

// claude-md: was the LIN-2896 split a verbatim move, and where did docs/architecture grow since (d4f749c1 → 8f5fe4aa)?
function claudeMd() {
  const old = git('show', 'd4f749c1^1:CLAUDE.md').split('\n').map((l) => l.trim()).filter((l) => l.length > 30);
  const arch = git('ls-tree', '-r', '--name-only', 'd4f749c1', 'docs/architecture').trim().split('\n');
  const next = new Set([...arch.flatMap((f) => git('show', `d4f749c1:${f}`).split('\n')), ...git('show', 'd4f749c1:CLAUDE.md').split('\n')].map((l) => l.trim()));
  const sizes = (rev) => Object.fromEntries(git('ls-tree', '-r', '-l', rev, 'docs/architecture').trim().split('\n').map((l) => l.split(/\s+/)).map((p) => [p[4], +p[3]]));
  const a = sizes('d4f749c1'), b = sizes('8f5fe4aa');
  console.log(JSON.stringify({ oldLongLines: old.length, foundVerbatimAfterSplit: old.filter((l) => next.has(l)).length,
    growthByFile: Object.fromEntries(Object.keys(b).map((f) => [f, b[f] - (a[f] || 0)])), totals: [Object.values(a).reduce((s, x) => s + x, 0), Object.values(b).reduce((s, x) => s + x, 0)],
    claudeMdBytes: { before: +git('cat-file', '-s', 'd4f749c1^1:CLAUDE.md').trim(), after: +git('cat-file', '-s', 'd4f749c1:CLAUDE.md').trim(), at8f5fe4aa: +git('cat-file', '-s', '8f5fe4aa:CLAUDE.md').trim() } }, null, 1));
}

// cuts: the two large deliberate prompt cuts and what the files weighed after them (#462 and LIN-1850).
function cuts() {
  const size = (rev, files) => files.reduce((s, f) => { try { return s + +git('cat-file', '-s', `${rev}:${f}`).trim(); } catch { return s; } }, 0);
  const at = (day) => git('rev-list', '-1', '--first-parent', `--before=${day} 23:59:59`, '8f5fe4aa').trim();
  const ak = ['lib/prompts/autopilot-kickoff.js', 'lib/prompts/autopilot-manual.js', 'docs/autopilot-operating-manual.md'];
  const pp = ['docs/passage-planner-prompt.md'];
  console.log(JSON.stringify({
    '#462 (1403655c) autopilot kickoff + handbook': { before: size('1403655c^1', ak), after: size('1403655c', ak), '2026-06-21': size(at('2026-06-21'), ak), '2026-07-05': size(at('2026-07-05'), ak) },
    'LIN-1850 (31fcf36b) passage planner prompt': { before: size('31fcf36b^1', pp), after: size('31fcf36b', pp), '2026-08-10': size(at('2026-08-10'), pp), '2026-08-31': size(at('2026-08-31'), pp), '8f5fe4aa': size('8f5fe4aa', pp) },
  }, null, 1));
}

// inventory: bookkeeping in steady-base-rules.json — restatements that name only the rule's own source or the human mirror doc, and kickoff rules restated in the handbook the kickoff inlines.
function inventory() {
  const { rules } = JSON.parse(readFileSync(rulesFile, 'utf8')); const census = rules.filter((r) => !r.sampled);
  const own = (r, v) => v === 'self' || v === r.source; const mirror = 'docs/autopilot-kickoff.md'; // keep-in-sync doc for people, not rendered to an agent
  const ak = census.filter((r) => r.source === 'autopilot-kickoff' && r.duplicated_in.includes('docs/autopilot-operating-manual.md'));
  console.log(JSON.stringify({ censusRestated: census.filter((r) => r.duplicated_in.length).length,
    restatedOutsideOwnSource: census.filter((r) => r.duplicated_in.some((v) => !own(r, v))).length,
    restatedInAnotherPromptSource: census.filter((r) => r.duplicated_in.some((v) => !own(r, v) && v !== mirror)).length,
    kickoffRulesRestatedInInlinedHandbook: ak.length, ofWhichClassedRetire: ak.filter((r) => r.class === 'retire').length }, null, 1));
}

// sample: the 45 census rules the blind coders were given (seed 3145; Python's generator, so the draw is Python's).
function sample() {
  const { rules } = JSON.parse(readFileSync(rulesFile, 'utf8')); const census = rules.map((r, i) => [r, i]).filter(([r]) => !r.sampled);
  const pick = JSON.parse(execFileSync('python3', ['-c', `import random,json; print(json.dumps(sorted(random.Random(3145).sample(range(${census.length}), 45))))`], { encoding: 'utf8' }));
  console.log(JSON.stringify(pick.map((j, k) => ({ n: k + 1, idx: census[j][1], source: census[j][0].source, line: census[j][0].line, bytes: census[j][0].bytes, signature: census[j][0].signature }))));
}

// agreement: blind codes (steady-base-check-codes.json) against the paper's labels, per field, with Cohen's kappa.
function agreement() {
  const { rules } = JSON.parse(readFileSync(rulesFile, 'utf8')); const { codes } = JSON.parse(readFileSync(codesFile, 'utf8'));
  const fields = { enforcement: (r) => r.enforcement, restated: (r) => (r.duplicated_in.length ? 'yes' : 'no'), class: (r) => r.class };
  const out = { n: codes.length, fields: {}, disagreements: [] };
  for (const [f, paper] of Object.entries(fields)) {
    const pairs = codes.map((c) => [c[f], paper(rules[c.idx])]); const n = pairs.length; const po = pairs.filter(([a, b]) => a === b).length / n;
    const ca = {}, cb = {}; for (const [a, b] of pairs) { ca[a] = (ca[a] || 0) + 1; cb[b] = (cb[b] || 0) + 1; }
    const pe = Object.keys({ ...ca, ...cb }).reduce((s, k) => s + (ca[k] || 0) * (cb[k] || 0), 0) / n / n;
    const confusion = {}; for (const [a, b] of pairs) confusion[`check=${a} paper=${b}`] = (confusion[`check=${a} paper=${b}`] || 0) + 1;
    out.fields[f] = { agree: pairs.filter(([a, b]) => a === b).length, of: n, kappa: +((po - pe) / (1 - pe)).toFixed(2), confusion };
  }
  for (const c of codes) { const r = rules[c.idx]; const d = Object.entries(fields).filter(([f, p]) => c[f] !== p(r)).map(([f, p]) => `${f}: check=${c[f]} paper=${p(r)}`); if (d.length) out.disagreements.push({ n: c.n, source: r.source, line: r.line, summary: r.summary, d }); }
  console.log(JSON.stringify(out, null, 1));
}

// A minimal JS lexer: bytes of code, string-literal text and comments, and the state each line starts in.
function lex(src) {
  const n = src.length; const cls = new Uint8Array(n); const stack = []; let i = 0, depth = 0, last = '', word = '';
  const KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  const regexOk = () => last === '' || (last === 'id' ? KW.has(word) : !['num', 'str', ')', ']', '}'].includes(last));
  const tmpl = () => { while (i < n) { const c = src[i]; if (c === '\\') { cls[i] = cls[i + 1] = 1; i += 2; continue; } if (c === '`') { cls[i++] = 1; last = 'str'; return; } if (c === '$' && src[i + 1] === '{') { i += 2; stack.push(depth++); last = 'punc'; return; } cls[i++] = 1; } };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') cls[i++] = 2; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; while (i < end) cls[i++] = 2; continue; }
    if (c === '"' || c === "'") { cls[i++] = 1; while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') cls[i++] = 1; cls[i++] = 1; } if (i < n) cls[i++] = 1; last = 'str'; continue; }
    if (c === '`') { cls[i++] = 1; tmpl(); continue; }
    if (c === '}') { depth--; if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); i++; tmpl(); continue; } i++; last = '}'; continue; }
    if (c === '{') { depth++; i++; last = 'punc'; continue; }
    if (c === '/' && regexOk()) { cls[i++] = 1; let inCls = false; while (i < n && src[i] !== '\n') { const d = src[i]; if (d === '\\') { cls[i++] = 1; cls[i++] = 1; continue; } if (d === '[') inCls = true; else if (d === ']') inCls = false; else if (d === '/' && !inCls) { cls[i++] = 1; break; } cls[i++] = 1; } while (i < n && /[a-z]/i.test(src[i])) cls[i++] = 1; last = 'str'; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; word = src.slice(i, j); last = 'id'; i = j; continue; }
    if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(src[i])) i++; last = 'num'; continue; }
    if (!/\s/.test(c)) last = c === ')' ? ')' : c === ']' ? ']' : 'punc';
    i++;
  }
  const bytes = { code: 0, string: 0, comment: 0 }; const names = ['code', 'string', 'comment'];
  for (let k = 0; k < n; k++) { // UTF-8 bytes per UTF-16 unit; a surrogate pair counts 4 at its high half
    const c = src.charCodeAt(k); bytes[names[cls[k]]] += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : c >= 0xdc00 && c <= 0xdfff ? 0 : 3;
  }
  const lines = []; let start = 0;
  for (const text of src.split('\n')) { const off = text.search(/\S/); lines.push({ text, state: off < 0 ? 'code' : names[cls[start + off]] }); start += text.length + 1; }
  return { bytes, lines };
}
const WORKER_TEMPLATES = ['lib/prompt-templates.js', 'lib/prompt-template-defs.js', 'lib/prompt-formatters.js'];
const PROMPT_FILES = [...WORKER_TEMPLATES, 'lib/prompts/meta-prompt-template.js', 'lib/prompts/autopilot-kickoff.js', 'lib/prompts/autopilot-manual.js'];
const show = (rev, f) => { try { return git('show', `${rev}:${f}`); } catch { return null; } };
const END_MAY = '05d33f51';

// source-split: the worker templates' source bytes split into string text, code and comments, end of May and 8f5fe4aa.
function sourceSplit() {
  const split = (rev) => WORKER_TEMPLATES.reduce((t, f) => { const s = show(rev, f); if (s) { const b = lex(s).bytes; for (const k in t) t[k] += b[k]; } return t; }, { code: 0, string: 0, comment: 0 });
  const a = split(END_MAY), b = split('8f5fe4aa'); const grow = Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]])); const g = Object.values(grow).reduce((s, x) => s + x, 0);
  console.log(JSON.stringify({ endMay: a, at8f5fe4aa: b, growth: grow, growthShare: Object.fromEntries(Object.entries(grow).map(([k, v]) => [k, +(v / g).toFixed(2)])) }, null, 1));
}

// moved-text: long lines new to the prompt files since the end of May, and how many already existed elsewhere in the repo then.
function movedText() {
  const norm = (l) => l.trim().replace(/^[`'"+ ]+|[`'",+ ]+$/g, ''); const long = (s) => (s || '').split('\n').map(norm).filter((l) => l.length >= 50);
  const before = new Set(PROMPT_FILES.flatMap((f) => long(show(END_MAY, f))));
  const elsewhere = new Set(git('ls-tree', '-r', '--name-only', END_MAY).split('\n').filter((f) => /\.(md|js|mjs|txt)$/.test(f) && !PROMPT_FILES.includes(f) && !/node_modules|vendor|\.min\./.test(f)).flatMap((f) => long(show(END_MAY, f))));
  let nb = 0, mb = 0; for (const f of PROMPT_FILES) for (const l of long(show('8f5fe4aa', f))) { if (before.has(l)) continue; nb += Buffer.byteLength(l); if (elsewhere.has(l)) mb += Buffer.byteLength(l); }
  console.log(JSON.stringify({ newLongLineBytes: nb, alreadyElsewhereAtEndMay: mb }));
}

// weekly: from steady-base-growth.mjs, how the worker templates' July–September growth is spread across weeks, and the longest run of weeks each group moved by under 1 KB.
function weekly() {
  const rows = JSON.parse(execFileSync('node', [new URL('scripts/steady-base-growth.mjs', root).pathname, '8f5fe4aa', '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const since = rows.filter((r) => r.week >= '2026-06-01'); const groups = Object.keys(rows[0].groups);
  const gains = (g, rs) => rs.slice(1).map((r, i) => r.groups[g].bytes - rs[i].groups[g].bytes);
  const q3 = rows.filter((r) => r.week >= '2026-06-29'); const wt = gains('worker templates', q3).sort((a, b) => b - a); const tot = wt.reduce((s, x) => s + x, 0);
  // A group counts only from the first week its files exist (before that it reads 0 and would look flat).
  const flat = Object.fromEntries(groups.map((g) => { const live = since.slice(Math.max(0, since.findIndex((r) => r.groups[g].bytes > 0))); let best = 0, run = 0; for (const x of gains(g, live)) { run = Math.abs(x) < 1024 ? run + 1 : 0; best = Math.max(best, run); } return [g, best]; }));
  console.log(JSON.stringify({ workerTemplatesJulSep: { weeks: wt.length, meanKB: +(tot / wt.length / 1024).toFixed(2), medianKB: +(median(wt) / 1024).toFixed(2), top3Share: +(wt.slice(0, 3).reduce((s, x) => s + x, 0) / tot).toFixed(2) }, longestSubKBRunSinceJuneWeeks: flat }, null, 1));
}

// midmonth: review and close-out rendered at the last commit on or before the 15th of each month, as steady-base-render-history.mjs does at month ends.
function midmonth() {
  const out = [];
  for (const day of ['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-14']) {
    const sha = git('rev-list', '-1', '--first-parent', `--before=${day} 23:59:59`, '8f5fe4aa').trim();
    const dir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    try {
      git('worktree', 'add', '--detach', dir, sha); execFileSync('ln', ['-s', new URL('node_modules', root).pathname, join(dir, 'node_modules')]);
      execFileSync('mkdir', ['-p', join(dir, 'scripts')]); execFileSync('cp', [new URL('scripts/steady-base-render.mjs', root).pathname, join(dir, 'scripts')]);
      const s = JSON.parse(execFileSync('node', [join(dir, 'scripts', 'steady-base-render.mjs'), '--json'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NODE_ENV: 'test' } }).trim().split('\n').pop());
      out.push({ day, sha: sha.slice(0, 8), review: s.review, closeOut: s['close-out'], sum: (s.review || 0) + (s['close-out'] || 0) });
    } finally { try { git('worktree', 'remove', '--force', dir); } catch {} }
  }
  console.log(JSON.stringify({ points: out, gains: out.slice(1).map((r, i) => r.sum - out[i].sum) }, null, 1));
}

// comments: at 8f5fe4aa, how many lines the code script's comment regex takes from inside string literals, and the comment share without the prompt files.
function comments() {
  const isProd = (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p)));
  const isPrompt = (p) => /^lib\/prompts\//.test(p) || /^lib\/prompt-template/.test(p) || ['lib/prompt-formatters.js', 'lib/proxy-instructions.js', 'lib/proxy-preamble.js'].includes(p);
  const COMMENT = /^\s*(\/\/|\/\*|\*)/; let lines = 0, cmt = 0, inString = 0, lexCmt = 0, npLines = 0, npCmt = 0;
  for (const f of git('ls-tree', '-r', '--name-only', '8f5fe4aa').trim().split('\n').filter(isProd)) for (const { text, state } of lex(show('8f5fe4aa', f)).lines) {
    if (!text.trim()) continue; const c = COMMENT.test(text); lines++; if (c) cmt++; if (c && state === 'string') inString++; if (state === 'comment') lexCmt++;
    if (!isPrompt(f)) { npLines++; if (c) npCmt++; }
  }
  console.log(JSON.stringify({ commentLines: cmt, ofWhichInsideStrings: inString, sharePct: +(100 * cmt / lines).toFixed(1), lexerSharePct: +(100 * lexCmt / lines).toFixed(1), shareWithoutPromptFilesPct: +(100 * npCmt / npLines).toFixed(1) }));
}

// plan-labels: every k-th of the plan-label comment lines at 8f5fe4aa (40 lines), for reading. pins: the pin-named test files, for reading.
function planLabels() {
  const isProd = (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p)));
  const hits = []; for (const f of git('ls-tree', '-r', '--name-only', '8f5fe4aa').trim().split('\n').filter(isProd)) show('8f5fe4aa', f).split('\n').forEach((l, i) => { if (l.trim() && /^\s*(\/\/|\/\*|\*)/.test(l) && /\b[DFLN]\d{1,2}[a-z]?\b/.test(l)) hits.push(`${f}:${i + 1}  ${l.trim().slice(0, 140)}`); });
  const k = hits.length / 40; console.log(hits.length); for (let j = 0; j < 40; j++) console.log(hits[Math.floor(j * k)]);
}
function pins() {
  for (const f of git('ls-tree', '-r', '--name-only', '8f5fe4aa', 'tests').trim().split('\n')) if (/^tests\/.*\.(js|mjs)$/.test(f) && !/^tests\/fixtures\//.test(f) && /census|inventory|witness|allow-?list|pin|parity|byte-identical/i.test(f.split('/').pop())) console.log(f);
}

// loose-provenance: re-attribute the prompt-only and unattributed cited tickets to ANY first-parent commit whose message names them, and list which then touch runtime code.
function looseProvenance() {
  const { rows } = JSON.parse(execFileSync('node', [new URL('scripts/steady-base-provenance.mjs', root).pathname, '8f5fe4aa', '--json'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const PROMPT = new Set([...PROMPT_FILES, 'docs/autopilot-operating-manual.md', 'docs/worker-lane-prompt.md', 'docs/passage-runner-prompt.md', 'docs/passage-planner-prompt.md', 'docs/runner-prompt.md']);
  const isRuntime = (f) => !PROMPT.has(f) && f !== 'lib/completion-signals.js' && /\.(js|mjs)$/.test(f) && (f === 'server.js' || /^(lib|routes)\//.test(f)) && !/^lib\/prompts\//.test(f);
  const out = {};
  for (const r of rows.filter((x) => x.kind === 'prompt-only' || x.kind === 'no-commit')) {
    const shas = git('log', '8f5fe4aa', '--first-parent', '-i', '-P', `--grep=\\b${r.ticket}\\b`, '--format=%H').trim().split('\n').filter(Boolean);
    const runtime = new Set(); const via = [];
    for (const s of shas) { const fs = git('show', '--format=', '--name-only', '-m', '--first-parent', s).trim().split('\n').filter(isRuntime); if (fs.length) { fs.forEach((f) => runtime.add(f)); via.push(git('log', '-1', '--format=%h %s', s).trim().slice(0, 80)); } }
    if (runtime.size) (out[r.kind] ||= []).push({ ticket: r.ticket, via });
  }
  console.log(JSON.stringify({ gainRuntimeUnderLooseMatch: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), detail: out }, null, 1));
}

const table = { 'loose-provenance': looseProvenance, promptnames: () => promptnames(args[0]), paths: () => paths(args[0], args[1]), 'carry-rules': carryRules, 'claude-md': claudeMd, cuts, inventory, sample, agreement,
  'source-split': sourceSplit, 'moved-text': movedText, weekly, midmonth, comments, 'plan-labels': planLabels, pins };
if (!table[measure]) { console.error(`usage: node scripts/steady-base-check.mjs ${Object.keys(table).join('|')} [args]`); process.exit(1); }
await table[measure]();
