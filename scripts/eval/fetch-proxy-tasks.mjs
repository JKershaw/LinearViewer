#!/usr/bin/env node
/**
 * Fetch real tasks from the Linear proxy into on-disk fixtures — WITHOUT pulling
 * their (large) descriptions into anyone's chat context.
 *
 * Walks an epic's descendant tree from the proxy read endpoints and writes, per
 * selected node, a complete context BUNDLE — the exact shape getRecommendation
 * consumes ({issue, parent, siblings, project, children, comments, focusedChild}) —
 * so the scaffold spike (assessment-scaffold-spike.mjs REAL_DIR mode) can build a
 * faithful, full-size prompt per real task. Mirrors the context assembly in
 * scripts/eval-recommend-baseline.mjs (same reshape, same caps, same focus pick).
 *
 * Context hygiene: descriptions/comments go to FILES only. stdout prints a compact
 * metadata table (id · shape · state · #labels · desc-len · #comments) and nothing
 * of the body — so a human (or an agent) skimming the run never ingests the text.
 * A subagent then reads the fixtures and assigns gold labels (gold.json), keeping
 * the bulk text out of the orchestrator's context entirely.
 *
 * Usage:
 *   PROXY_TOKEN=<read token> node scripts/eval/fetch-proxy-tasks.mjs
 *
 * Env knobs:
 *   PROXY_TOKEN   proxy READ token                  (required)
 *   PROXY_BASE    proxy base URL                     (default https://projects.jkershaw.com/api/proxy)
 *   EPIC          root epic identifier               (default LIN-385)
 *   MAX_NODES     cap on fixtures written            (default 40 — respects the 60/min limiter)
 *   OUT_DIR       fixtures dir                       (default scripts/eval/fixtures/<EPIC>)
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SIBLING_CAP } from '../../lib/openrouter.js';
import { selectFocusSubtask, isTerminalState } from '../../lib/tree.js';
import { getStateOrder } from '../../lib/providers/state-map.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.PROXY_TOKEN;
if (!TOKEN) { console.error('Set PROXY_TOKEN (proxy READ token)'); process.exit(1); }
const BASE = process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy';
const EPIC = process.env.EPIC || 'LIN-385';
const MAX_NODES = Number(process.env.MAX_NODES) || 40;
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'fixtures', EPIC);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const byStateOrder = (a, b) => (getStateOrder(a.state?.type) ?? 2) - (getStateOrder(b.state?.type) ?? 2);

const cache = new Map();
async function proxyGet(path) {
  if (cache.has(path)) return cache.get(path);
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      if (r.status === 404) throw new Error(`not found: ${path}`);
      if (!r.ok) throw new Error(`proxy ${r.status} on ${path}`);
      const j = await r.json();
      cache.set(path, j);
      return j;
    } catch (e) {
      if (/not found/i.test(e.message)) throw e;
      lastErr = e.message;
    }
  }
  throw new Error(`proxy GET failed (${lastErr}) on ${path}`);
}

const reshapeIssue = (raw) => ({
  id: raw.id, identifier: raw.identifier, title: raw.title, description: raw.description,
  url: raw.url, state: raw.state, createdAt: raw.createdAt,
  labels: (raw.labels?.nodes || []).map(l => l.name)
});

/** Full context bundle for one node (mirrors eval-recommend-baseline fetchContext). */
async function fetchBundle(identifier) {
  const raw = await proxyGet(`/issues/${identifier}`);
  const issue = reshapeIssue(raw);
  const children = (raw.children?.nodes || [])
    .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }))
    .sort(byStateOrder);
  const comments = (raw.comments?.nodes || [])
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const parent = raw.parent
    ? { id: raw.parent.id, identifier: raw.parent.identifier, title: raw.parent.title, state: raw.parent.state }
    : null;
  const project = raw.project ? { name: raw.project.name, description: raw.project.content } : null;

  let siblings = [], siblingsTotal = 0;
  if (parent) {
    try {
      const parentRaw = await proxyGet(`/issues/${parent.identifier}`);
      const all = (parentRaw.children?.nodes || [])
        .filter(c => c.id !== issue.id)
        .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }))
        .sort(byStateOrder);
      siblingsTotal = all.length;
      siblings = all.slice(0, SIBLING_CAP);
    } catch { /* parent unreadable — leaf-grade context */ }
  }

  let focusedChild = null;
  if (children.length) {
    const focus = selectFocusSubtask(children);
    if (focus) {
      const childRaw = await proxyGet(`/issues/${focus.identifier}`);
      focusedChild = {
        issue: {
          id: childRaw.id, identifier: childRaw.identifier, title: childRaw.title,
          description: childRaw.description, url: childRaw.url, state: childRaw.state,
          labels: (childRaw.labels?.nodes || []).map(l => l.name)
        },
        comments: (childRaw.comments?.nodes || [])
          .map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      };
    }
  }
  return { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild, _raw: { childIds: children.map(c => c.identifier) } };
}

// ---- BFS the epic tree, collecting descendant identifiers (capped) ----
const root = await proxyGet(`/issues/${EPIC}`);
const queue = (root.children?.nodes || []).map(c => c.identifier);
const seen = new Set([EPIC]);
const collected = [EPIC];
while (queue.length && collected.length < MAX_NODES) {
  const id = queue.shift();
  if (seen.has(id)) continue;
  seen.add(id);
  collected.push(id);
  try {
    const raw = await proxyGet(`/issues/${id}`);
    for (const c of (raw.children?.nodes || [])) if (!seen.has(c.identifier)) queue.push(c.identifier);
  } catch { /* skip unreadable */ }
}

mkdirSync(OUT_DIR, { recursive: true });
const table = [];
for (const id of collected) {
  try {
    const bundle = await fetchBundle(id);
    writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(bundle, null, 2));
    const shape = bundle.children.length
      ? (bundle.children.every(c => isTerminalState(c.state?.type)) ? 'node(all-done)' : 'node')
      : (isTerminalState(bundle.issue.state?.type) ? 'leaf(terminal)' : 'leaf');
    table.push({
      id, shape,
      state: bundle.issue.state?.type || '?',
      labels: bundle.issue.labels.length,
      descLen: (bundle.issue.description || '').length,
      comments: bundle.comments.length,
      children: bundle.children.length
    });
    process.stdout.write('.');
  } catch (e) {
    table.push({ id, shape: 'ERROR', state: e.message.slice(0, 30) });
    process.stdout.write('x');
  }
}
process.stdout.write('\n');

// Compact manifest — metadata only, NO body text.
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ epic: EPIC, base: BASE, fetched: table.length, nodes: table }, null, 2));

console.log(`\nepic=${EPIC}  fetched=${table.length}  ->  ${OUT_DIR}`);
console.log('\nid'.padEnd(12) + 'shape'.padEnd(16) + 'state'.padEnd(12) + 'lbl'.padEnd(5) + 'descLen'.padEnd(9) + 'cmt'.padEnd(5) + 'kids');
for (const r of table) {
  console.log(
    String(r.id).padEnd(12) + String(r.shape).padEnd(16) + String(r.state).padEnd(12) +
    String(r.labels ?? '').padEnd(5) + String(r.descLen ?? '').padEnd(9) +
    String(r.comments ?? '').padEnd(5) + String(r.children ?? ''));
}
console.log(`\nfixtures: ${OUT_DIR}/<ID>.json   manifest: ${OUT_DIR}/index.json`);
console.log('Next: subagent reviews fixtures -> writes gold.json {id: {expect:[...], bucket}}, then run the spike in REAL_DIR mode.');
