#!/usr/bin/env node
/**
 * LIN-263 spike 4 — validate GPT-5.4-Mini on the OTHER per-task LLM calls (brief, recap).
 *
 * Exercises the REAL production functions (generateBrief / generateRecap) with each model,
 * on real dense tickets, so the test is byte-faithful to what the app does. Captures the
 * deterministic viability signals each artifact must satisfy, plus latency; bodies dumped
 * for a manual quality read vs the Opus reference.
 *
 *   brief  — must emit all 4 fixed sections (## Current / Constraints / Open questions /
 *            Changelog), in order, non-trivial. (A model that can't hold the section
 *            contract is non-viable for this call.)
 *   recap  — must parse to VALID, NON-EMPTY JSON (done/pending/deviations). parseRecap
 *            silently returns an empty recap on malformed output, so "empty" = a real fail.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike4.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateBrief } from '../../lib/brief.js';
import { generateRecap } from '../../lib/recap.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike4-out');
const FIX = join(HERE, 'lin-263-spike3-out', 'fixtures');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const REFERENCE = 'anthropic/claude-opus-4.8';
const MODELS = ['anthropic/claude-opus-4.8', 'openai/gpt-5.4-mini', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-4.5'];
const short = m => m.split('/')[1].replace('claude-', '');

const loadFix = id => JSON.parse(readFileSync(join(FIX, `${id}.json`), 'utf8'));
const mapKids = nodes => (nodes || []).map(k => ({ id: k.id, identifier: k.identifier, title: k.title, state: k.state }));
const mapComments = nodes => (nodes || []).map(c => ({ user: c.user?.name || 'user', createdAt: c.createdAt, body: c.body }));
const issueFrom = j => ({ identifier: j.identifier, title: j.title, description: j.description, state: j.state,
  labels: (j.labels?.nodes || []).map(l => l.name), createdAt: j.createdAt });
function ctxFrom(j) {
  return { project: { name: 'Product' }, parent: null, siblings: [], children: mapKids(j.children?.nodes), comments: mapComments(j.comments?.nodes) };
}

const TASKS = ['LIN-344', 'LIN-177', 'LIN-325'].map(id => { const j = loadFix(id); return { id, issue: issueFrom(j), context: ctxFrom(j) }; });

// ---- viability checks ----
const BRIEF_SECTIONS = ['## Current', '## Constraints', '## Open questions', '## Changelog'];
function briefCheck(brief) {
  const present = BRIEF_SECTIONS.filter(h => brief.includes(h));
  // in-order check
  const idxs = BRIEF_SECTIONS.map(h => brief.indexOf(h));
  const inOrder = idxs.every((v, i) => i === 0 || (v > idxs[i - 1] && idxs[i - 1] !== -1));
  const words = (brief.trim().match(/\S+/g) || []).length;
  return { sections: present.length, inOrder, words, pass: present.length === 4 && inOrder && words > 30 };
}
function recapCheck(recap) {
  const n = recap.done.length + recap.pending.length + recap.deviations.length;
  // grounded = has at least some done/pending content (not just an empty fallback)
  return { done: recap.done.length, pending: recap.pending.length, dev: recap.deviations.length, total: n, pass: n > 0 && (recap.done.length + recap.pending.length) > 0 };
}

mkdirSync(OUT, { recursive: true });
console.log(`reference=${REFERENCE}  models=[${MODELS.map(short).join(', ')}]  tasks=${TASKS.length}\n`);

const results = {};
for (const task of TASKS) {
  console.log(`\n===== ${task.id} =====`);
  results[task.id] = {};
  for (const model of MODELS) {
    // brief
    let t0 = Date.now();
    let briefRes, recapRes;
    try { briefRes = await generateBrief(task.issue, task.context, { apiKey: KEY, model }); } catch (e) { briefRes = { brief: '', err: e.message.slice(0, 80) }; }
    const briefMs = Date.now() - t0;
    const bc = briefCheck(briefRes.brief || '');
    // recap
    t0 = Date.now();
    try { recapRes = await generateRecap(task.issue, task.context, { apiKey: KEY, model }); } catch (e) { recapRes = { recap: { done: [], pending: [], deviations: [] }, err: e.message.slice(0, 80) }; }
    const recapMs = Date.now() - t0;
    const rc = recapCheck(recapRes.recap);
    results[task.id][model] = { brief: bc, recap: rc, briefMs, recapMs };
    writeFileSync(join(OUT, `${task.id}__${short(model)}.md`),
      `# ${task.id} — ${model}\n\n## BRIEF (sections=${bc.sections}/4 inOrder=${bc.inOrder} words=${bc.words} pass=${bc.pass}, ${briefMs}ms)\n\n${briefRes.brief || '(empty) ' + (briefRes.err || '')}\n\n## RECAP (done=${rc.done} pending=${rc.pending} dev=${rc.dev} pass=${rc.pass}, ${recapMs}ms)\n\n\`\`\`json\n${JSON.stringify(recapRes.recap, null, 2)}\n\`\`\`\n`);
    const ref = model === REFERENCE ? ' [REF]' : '';
    console.log(`  ${short(model).padEnd(18)} brief: ${bc.pass ? 'PASS' : 'FAIL'} (${bc.sections}/4 sec, ${bc.words}w, ${briefMs}ms)   recap: ${rc.pass ? 'PASS' : 'FAIL'} (d${rc.done}/p${rc.pending}/x${rc.dev}, ${recapMs}ms)${ref}`);
  }
}

console.log('\n===== viability summary (brief + recap pass rate across tasks) =====');
for (const model of MODELS) {
  let bp = 0, rp = 0;
  for (const task of TASKS) { if (results[task.id][model].brief.pass) bp++; if (results[task.id][model].recap.pass) rp++; }
  console.log(`  ${short(model).padEnd(18)} brief ${bp}/${TASKS.length}   recap ${rp}/${TASKS.length}`);
}
writeFileSync(join(OUT, 'spike4.json'), JSON.stringify({ reference: REFERENCE, models: MODELS, ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\nBodies in ${OUT}/  (read for the manual quality check vs Opus)`);
