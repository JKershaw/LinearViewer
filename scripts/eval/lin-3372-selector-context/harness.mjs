// LIN-3372 replay harness: rebuild the stage selector's prompt at a past decision point
// from live ticket data (comments and runs cut at the decision time), measure its parts,
// and replay it against the router model. Research scratch, not repo code.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
// LV: the checkout whose lib/ builds the prompt (a worktree with fixes-experiment.patch applied, for the FIX runs).
const LV = process.env.LV || join(HERE, '..', '..', '..');
export const { formatSelectorView, buildSelectorArgs } = await import(`${LV}/lib/openrouter.js`);
const { buildRouterPrompt, routeStage } = await import(`${LV}/lib/stage-router.js`);
const facts = await import(`${LV}/lib/recommendation-facts.js`);
const { formatRecentRuns } = await import(`${LV}/lib/recent-runs.js`);
const { selectFocusSubtask } = await import(`${LV}/lib/tree.js`);
const { getStateOrder } = await import(`${LV}/lib/providers/state-map.js`);

// Proxy reads are cached here (git-ignored): tickets, dispatch rows and task-history snapshots.
export const S = join(HERE, '.cache');
const BASE = process.env.PROXY_BASE || `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const AUTH = process.env.PROXY_TOKEN ? { Authorization: `Bearer ${process.env.PROXY_TOKEN}` } : {};
for (const d of ['issues', 'dispatch', 'snaps']) mkdirSync(join(S, d), { recursive: true });

async function cached(dir, id, path) {
  const f = join(S, dir, `${id}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const r = await fetch(`${BASE}${path}`, { headers: AUTH });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  const j = await r.json();
  writeFileSync(f, JSON.stringify(j));
  return j;
}
export const getIssue = (id) => cached('issues', id, `/issues/${id}`);
export const getRuns = (id) => cached('dispatch', id, `/dispatch?issueIdentifier=${id}&limit=50`);

const byStateOrder = (a, b) => (getStateOrder(a.state?.type) ?? 2) - (getStateOrder(b.state?.type) ?? 2);
const at = (iso) => Date.parse(iso);

/**
 * The getRecommendation inputs for `id` as they stood at `cutoff`.
 * `states` overrides {identifier: {name,type}} for issue/children/parent/siblings at that time
 * (the proxy only has today's states). The description is today's (no history via the proxy).
 */
export async function bundleAt(id, cutoff, states = {}) {
  const T = at(cutoff);
  // The task-history snapshot taken at the next dispatch holds the description, state and
  // child states the selector saw just before it (GET /issues/:id/snapshots).
  const snaps = ((await cached('snaps', id, `/issues/${id}/snapshots`)).snapshots || [])
    .filter(s => at(s.capturedAt) >= T).sort((a, b) => at(a.capturedAt) - at(b.capturedAt));
  if (!snaps.length) {
    const before = ((await cached('snaps', id, `/issues/${id}/snapshots`)).snapshots || []).filter(s => at(s.capturedAt) < T).sort((a, b) => at(b.capturedAt) - at(a.capturedAt));
    if (before.length) snaps.push(before[0]);
  }
  const snap = snaps[0]?.snapshot || null;
  states = { ...states };
  if (snap) {
    states[id] = snap.state;
    for (const c of snap.children || []) states[c.identifier] = c.state;
  }
  const st = (i) => states[i.identifier] || i.state;
  const raw = await getIssue(id);
  const issue = {
    id: raw.id, identifier: raw.identifier, title: raw.title, description: snap ? snap.description : raw.description,
    snapshotAt: snaps[0]?.capturedAt || null,
    state: st(raw), createdAt: raw.createdAt, labels: (raw.labels || []).map(l => l.name || l),
    blockedBy: (raw.inverseRelations || []).filter(r => r.type === 'blocks').map(r => r.issue || r.relatedIssue).filter(Boolean)
  };
  const comments = (raw.comments || []).filter(c => at(c.createdAt) <= T)
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
  const children = [];
  for (const c of raw.children || []) {
    const full = await getIssue(c.identifier);
    if (at(full.createdAt) <= T) children.push({ id: c.id, identifier: c.identifier, title: c.title, state: st(c) });
  }
  children.sort(byStateOrder);
  let parent = null, siblings = [], siblingsTotal = 0;
  if (raw.parent) {
    const p = await getIssue(raw.parent.identifier);
    const psnaps = ((await cached('snaps', p.identifier, `/issues/${p.identifier}/snapshots`)).snapshots || []).filter(s => at(s.capturedAt) <= T).sort((a, b) => at(b.capturedAt) - at(a.capturedAt));
    parent = { id: p.id, identifier: p.identifier, title: p.title, state: st(p), description: psnaps[0]?.snapshot?.description ?? p.description };
    const all = [];
    for (const c of p.children || []) {
      if (c.id === raw.id) continue;
      const full = await getIssue(c.identifier);
      if (at(full.createdAt) <= T) all.push({ id: c.id, identifier: c.identifier, title: c.title, state: st(c) });
    }
    all.sort(byStateOrder);
    siblingsTotal = all.length;
    siblings = all.slice(0, 5);
  }
  let focusedChild = null;
  if (children.length) {
    const focus = selectFocusSubtask(children);
    if (focus) {
      const fr = await getIssue(focus.identifier);
      focusedChild = { issue: { id: fr.id, identifier: fr.identifier, title: fr.title, description: fr.description, state: st(fr), labels: [] },
        comments: (fr.comments || []).filter(c => at(c.createdAt) <= T).map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name })) };
    }
  }
  const rows = (await getRuns(id)).items || [];
  for (const r of rows) {
    if (r.status !== 'blocked') continue;
    const d = await cached('dispatch', `detail-${r.id}`, `/dispatch/${r.id}`);
    r.blockedAts = (d.feedback || []).filter(f => /^\[blocked\]/.test(f.message)).map(f => f.timestamp);
  }
  const runs = rows.filter(r => at(r.dispatchedAt) <= T).map(r => {
    const blockedAt = (r.blockedAts || []).filter(t => at(t) <= T).pop();
    if (blockedAt) return { stage: r.kind, at: blockedAt, outcome: 'waiting on a person' };
    const end = r.completedAt || r.closedAt;
    if (end && at(end) <= T) return { stage: r.kind, at: end, outcome: r.status === 'closed' ? 'closed' : r.status };
    return { stage: r.kind, at: r.dispatchedAt, outcome: 'running' };
  }).sort((a, b) => at(a.at) - at(b.at)).slice(-5);
  const project = raw.project ? { name: raw.project.name } : null;
  return { issue, context: { parent, siblings, siblingsTotal, project, children, comments, focusedChild, attachments: [], runs } };
}

/**
 * buildSelectorArgs (lib/openrouter.js) with ablation knobs. With no knobs it is the
 * production function line for line. Knobs:
 *  descMode: 'full' | 'none' | 'head:N' | 'tail:N' | 'crop:N' (first N/2 + last N/2) | 'outsidePlan' (drop every ## Implementation Plan body)
 *  viewComments: number of newest comments shown (production 3); 0 hides all comment bodies
 *  noFacts / noRuns / leafFacts (compute plan facts even on a node) / noNodeFacts
 */
export function selectorArgs(issue, context, k = {}) {
  let description = issue.description || '';
  const m = String(k.descMode || 'full');
  if (m === 'none') description = '';
  else if (m.startsWith('head:')) description = description.slice(0, +m.slice(5));
  else if (m.startsWith('tail:')) description = description.slice(-m.slice(5));
  else if (m.startsWith('crop:')) { const n = +m.slice(5) / 2; if (description.length > 2 * n) description = `${description.slice(0, n)}\n\n[… ${description.length - 2 * n} characters cropped …]\n\n${description.slice(-n)}`; }
  const viewIssue = { ...issue, description };
  let viewContext = k.noDescend ? { ...context, focusedChild: null } : context;
  if (k.viewComments !== undefined) {
    viewContext = { ...viewContext, comments: k.viewComments === 0 ? [] : (context.comments || []).slice(-k.viewComments) };
  }
  const children = context.children || [];
  const comments = context.comments || [];
  const runs = k.noRuns ? '' : formatRecentRuns(context.runs);
  const leaf = k.leafFacts ? true : children.length === 0;
  const trail = facts.formatTrailFactsBlock(facts.assembleTrailFacts(comments, issue.description, { leaf }), comments.length, { runs: !!runs });
  const node = k.noNodeFacts ? '' : facts.formatNodeFactsBlock(facts.assembleNodeFacts(issue, children), children.length);
  const view = formatSelectorView(viewIssue, viewContext);
  return {
    view,
    identifier: issue.identifier,
    facts: k.noFacts ? (runs || '(none)') : [trail, node, runs].filter(Boolean).join('\n'),
    featureFlags: {},
    providerUi: null
  };
}

export function promptOf(args) { return buildRouterPrompt(args); }

/** Byte sizes of each part of the routing prompt. */
export function measure(issue, context, k = {}) {
  const args = selectorArgs(issue, context, k);
  const prompt = promptOf(args);
  const v = args.view;
  const di = v.indexOf('**Description:** ');
  const ci = v.search(/\n\*\*(Latest ruling|Latest person|Comments:)/);
  const descPart = di >= 0 ? v.slice(di, ci > di ? ci : v.length) : '';
  const commentPart = ci >= 0 ? v.slice(ci) : '';
  const stagesStart = prompt.indexOf('## Stages');
  const rulesStart = prompt.indexOf('## How to choose');
  const replyStart = prompt.indexOf('## Reply');
  return {
    total: prompt.length,
    header: di >= 0 ? di : (ci >= 0 ? ci : v.length),
    description: descPart.length,
    rawDescription: (issue.description || '').length,
    comments: commentPart.length,
    commentsAll: (context.comments || []).reduce((n, c) => n + c.body.length, 0),
    commentCount: (context.comments || []).length,
    facts: args.facts.length,
    stages: rulesStart - stagesStart,
    rules: replyStart - rulesStart,
    reply: prompt.length - replyStart
  };
}

const KEY = process.env.OPENROUTER_API_KEY || (() => {
  try { return (readFileSync(join(HERE, '..', '..', '..', '.env'), 'utf8').match(/^OPENROUTER_API_KEY=(.*)$/m) || [])[1]?.trim(); } catch { return undefined; }
})();
export const MODEL = process.env.MODEL || 'openai/gpt-5.6-sol';

/** One routing call, the same body getRecommendation sends. */
export async function route(prompt, model = MODEL) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 8000, usage: { include: true } })
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      const content = d.choices?.[0]?.message?.content || '';
      let action = null, whyNow = null, deferTo = null;
      try { const p = routeStage(content, d.choices?.[0]?.finish_reason); action = p.action; whyNow = p.whyNow; deferTo = p.deferTo; } catch (e) { action = `INVALID`; whyNow = content.slice(0, 200); }
      return { action, deferTo, whyNow, cost: d.usage?.cost || 0, promptTokens: d.usage?.prompt_tokens, provider: d.provider };
    } catch (e) {
      if (attempt === 3) return { action: 'ERROR', whyNow: e.message, cost: 0 };
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** Run fn over items with a concurrency limit. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}
