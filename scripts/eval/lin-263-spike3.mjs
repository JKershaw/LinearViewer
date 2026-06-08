#!/usr/bin/env node
/**
 * LIN-263 spike 3 — K=3 confirmation on the HARD end, cheap models only.
 *
 * Confirms whether the cheap candidates that matched Opus in spike 2 hold up at K=3 on
 * the most complex shapes, including REAL large tickets:
 *   A) SYN-12      — synthetic dense embedded-plan leaf (the known Haiku cliff). gold=breakdown
 *   B) LIN-177     — REAL epic as a NODE (focusedChild=LIN-334) → the defer-routing path,
 *                    the most complex meta-prompt. 10.4k-char desc, 6 children. gold=defer→LIN-334
 *   C) LIN-344     — REAL large dense leaf (7.4k desc, 5 comments). no hard gold → compare to Opus.
 *
 * Cost discipline (per the brief: "avoid the pricey models"): Opus 4.8 runs K=1 as the
 * reference anchor; the cheap candidates run K=3. temp 0 (provider nondeterminism still
 * flips routing run-to-run, which is what K=3 measures here).
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike3.mjs
 *
 * Real tickets are snapshotted in lin-263-spike3-out/fixtures/ for repeatability.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatIssueContext } from '../../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { isTerminalState } from '../../lib/tree.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike3-out');
const FIX = join(OUT, 'fixtures');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const REFERENCE = 'anthropic/claude-opus-4.8';
const CHEAP = ['openai/gpt-5.4-mini', 'google/gemini-3.5-flash', 'deepseek/deepseek-v4-flash', 'anthropic/claude-haiku-4.5'];
const K = 3;

const loadFix = id => JSON.parse(readFileSync(join(FIX, `${id}.json`), 'utf8'));
const mapKids = nodes => (nodes || []).map(k => ({ id: k.id, identifier: k.identifier, title: k.title, state: k.state }));
const mapComments = nodes => (nodes || []).map(c => ({ user: c.user?.name || 'user', createdAt: c.createdAt, body: c.body }));
const issueFrom = j => ({ identifier: j.identifier, title: j.title, description: j.description, state: j.state,
  labels: (j.labels?.nodes || []).map(l => l.name), createdAt: j.createdAt });

// Faithful reconstruction of lib/openrouter.js buildMetaPrompt() for an arbitrary context.
function buildMeta(issue, context) {
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [], ...context };
  const children = ctx.children || [];
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length;
  const inProgressCount = children.filter(c => c.state?.type === 'started').length;
  return buildMetaPromptTemplate({
    issueContext: formatIssueContext(issue, ctx),
    identifier: issue.identifier,
    hasSubtasks: children.length > 0,
    subtaskCount: children.length,
    completedCount, inProgressCount,
    remainingCount: children.length - completedCount,
    hasComments: (ctx.comments?.length || 0) > 0,
    commentCount: ctx.comments?.length || 0,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId: ctx.focusedChild?.issue?.identifier || null,
    featureFlags: {}
  });
}

// ---- tasks ----
const inProgress = { name: 'In Progress', type: 'started' };
const SYN12 = {
  id: 'A_SYN-12_leaf', label: 'synthetic dense leaf', expect: ['breakdown'],
  build: () => buildMeta({
    identifier: 'SYN-12', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
    title: 'Migrate session storage from file-based MangoDB to MongoDB',
    description: `## Plan
Surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Arrows: server wiring depends on the store rewrite; migration depends on both.
## Scope
Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.` }, {})
};

const lin177 = loadFix('LIN-177');
const kids177 = mapKids(lin177.children.nodes);
const focused177 = kids177.find(k => k.identifier === 'LIN-334'); // S2 — next ready child (S0/S1 done)
const NODE = {
  id: 'B_LIN-177_node', label: 'REAL epic node (defer path)', expect: ['defer'], deferGold: 'LIN-334',
  build: () => buildMeta(issueFrom(lin177), { children: kids177, comments: mapComments(lin177.comments.nodes), focusedChild: { issue: focused177 } })
};

const lin344 = loadFix('LIN-344');
const LEAF = {
  id: 'C_LIN-344_leaf', label: 'REAL large dense leaf', expect: null, // compare to Opus
  build: () => buildMeta(issueFrom(lin344), { children: mapKids(lin344.children.nodes), comments: mapComments(lin344.comments.nodes) })
};

const TASKS = [SYN12, NODE, LEAF];

const action = s => { const m = s.match(/→\s*\*\*(.+?)\*\*/); return m ? m[1].toLowerCase().trim() : '(none)'; };
const deferTo = s => { const m = s.match(/DeferTo:\s*\*{0,2}\s*([A-Za-z]+-\d+)/); return m ? m[1] : null; };
const promptBody = s => { const i = s.indexOf('## Prompt'); return i >= 0 ? s.slice(i + 9).trim() : s.trim(); };
const wc = s => (s.trim().match(/\S+/g) || []).length;
const majority = arr => { const d = {}; for (const a of arr) d[a] = (d[a] || 0) + 1; return Object.entries(d).sort((a, b) => b[1] - a[1]); };

async function call(meta, model) {
  const t0 = Date.now(); let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 8000, usage: { include: true }, messages: [{ role: 'user', content: meta }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content;
      if (!content) { lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 140); continue; }
      return { ms: Date.now() - t0, content, cost: j.usage?.cost ?? 0 };
    } catch (e) { lastErr = e.message.slice(0, 140); }
  }
  return { err: lastErr, ms: Date.now() - t0 };
}

async function runCell(meta, model, k) {
  const runs = await Promise.all(Array.from({ length: k }, () => call(meta, model)));
  const ok = runs.filter(r => !r.err);
  if (!ok.length) return { err: runs[0].err };
  return {
    actions: ok.map(r => action(r.content)),
    defers: ok.map(r => deferTo(r.content)),
    words: Math.round(ok.reduce((a, r) => a + wc(promptBody(r.content)), 0) / ok.length),
    ms: Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length),
    cost: ok.reduce((a, r) => a + r.cost, 0),
    sample: ok[0].content
  };
}

mkdirSync(OUT, { recursive: true });
const short = m => m.split('/')[1].replace('claude-', '');
console.log(`reference=${REFERENCE} (K=1)   cheap=[${CHEAP.map(short).join(', ')}] (K=${K})\n`);

const results = {};
for (const task of TASKS) {
  const meta = task.build();
  console.log(`\n===== ${task.id} — ${task.label}  (${wc(meta)}-word meta-prompt)${task.expect ? `  gold={${task.expect.join('|')}}` : '  gold=compare-to-Opus'} =====`);
  results[task.id] = {};
  // reference first (K=1)
  const ref = await runCell(meta, REFERENCE, 1);
  const refAction = ref.err ? 'ERR' : ref.actions[0];
  results[task.id][REFERENCE] = ref;
  writeFileSync(join(OUT, `${task.id}__${short(REFERENCE)}.md`), ref.sample || ('ERR ' + ref.err));
  console.log(`  ${short(REFERENCE).padEnd(20)} K=1  → ${refAction}${task.id.includes('node') && ref.defers ? ' ('+ref.defers[0]+')' : ''}  ${ref.words || 0}w  ${ref.ms}ms  $${(ref.cost||0).toFixed(4)}  [REFERENCE]`);

  for (const model of CHEAP) {
    const cell = await runCell(meta, model, K);
    results[task.id][model] = cell;
    if (cell.err) { console.log(`  ${short(model).padEnd(20)} ERR ${cell.err}`); continue; }
    const maj = majority(cell.actions);
    const majAction = maj[0][0];
    const dist = maj.map(([a, n]) => `${a}×${n}`).join(',');
    const gold = task.expect || [refAction];
    const hits = cell.actions.filter(a => gold.includes(a)).length;
    const matchRef = majAction === refAction;
    let tag = task.expect ? `${hits}/${K} gold` : (matchRef ? 'matches Opus' : 'DIVERGES from Opus');
    let extra = '';
    if (task.deferGold) { const dm = majority(cell.defers.filter(Boolean)); extra = `  defer→${dm.length ? dm[0][0] : 'none'}${dm.length && dm[0][0] === task.deferGold ? '✓' : ''}`; }
    writeFileSync(join(OUT, `${task.id}__${short(model)}.md`), cell.sample);
    console.log(`  ${short(model).padEnd(20)} K=${K}  → ${dist.padEnd(22)} [${tag}]${extra}  ${cell.words}w  ${cell.ms}ms  $${cell.cost.toFixed(4)}`);
  }
}

// totals
console.log('\n===== per-model spend (this run) =====');
const spend = {}; const lat = {};
for (const task of TASKS) for (const [m, c] of Object.entries(results[task.id])) { if (c.err) continue; spend[m] = (spend[m] || 0) + c.cost; lat[m] = (lat[m] || []).concat(c.ms); }
for (const m of [REFERENCE, ...CHEAP]) if (spend[m] != null) console.log(`  ${short(m).padEnd(20)} $${spend[m].toFixed(4)}   avg ${Math.round(lat[m].reduce((a, b) => a + b, 0) / lat[m].length)}ms/call`);

writeFileSync(join(OUT, 'spike3.json'), JSON.stringify({ reference: REFERENCE, cheap: CHEAP, K, ranAt: new Date().toISOString(),
  results: Object.fromEntries(Object.entries(results).map(([t, ms]) => [t, Object.fromEntries(Object.entries(ms).map(([m, c]) => [m, c.err ? { err: c.err } : { actions: c.actions, defers: c.defers, words: c.words, ms: c.ms, cost: c.cost }]))])) }, null, 2));
console.log(`\nBodies + spike3.json in ${OUT}/`);
