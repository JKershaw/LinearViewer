#!/usr/bin/env node
/**
 * Build the committed context-bundle fixtures for the recommendation baseline eval.
 *
 * LIN-587: eval-recommend-baseline.mjs no longer talks to the proxy at all — it runs
 * purely on committed fixtures. This is the reproducible, text-free recipe that
 * regenerates those fixtures from the live proxy; the script holds no task body text
 * itself (only ids + the descent/state overrides), matching build-har697-red.mjs.
 *
 * Why overrides: the original baseline targets were epic→mid→leaf DESCENT chains, but
 * the real tasks have since closed (HAR-149→545→616 and LIN-385→389→428 are now Done).
 * To keep the realistic descent coverage the eval is for, we capture the real text at
 * HEAD and force the chain nodes back to `started` — our best estimate of how the tree
 * appeared when it was live work. The edit is encoded here as code (forceStarted +
 * the chain definition) so it is reproducible, not a hand-edit lost on regeneration.
 *
 * Output shape (one file per workspace) matches the harness's fixtures loader:
 *   { name, targets: [{ id, role }], bundles: { <identifier>: <contextBundle> } }
 * where each contextBundle is the exact object getRecommendation consumes:
 *   { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild }
 *
 * Usage:
 *   PROXY_TOKEN=<linearviewer read token> HARBOUR_PROXY_TOKEN=<harbour read token> \
 *     node scripts/eval/build-recommend-fixtures.mjs
 *
 * Env knobs:
 *   PROXY_TOKEN          LinearViewer proxy READ token   (skips LinearViewer if absent)
 *   PROXY_BASE           LinearViewer proxy base URL     (default https://projects.jkershaw.com/api/proxy)
 *   HARBOUR_PROXY_TOKEN  Harbour proxy READ token        (skips Harbour if absent)
 *   HARBOUR_PROXY_BASE   Harbour proxy base URL          (default https://projects.jkershaw.com/api/proxy)
 *   ONLY                 substring filter on workspace name (e.g. ONLY=Harbour)
 *
 * Context hygiene: prints only a metadata table (no body text) to stdout — the bulk
 * task text goes to the fixture files only.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SIBLING_CAP } from '../../lib/openrouter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures', 'recommend');
const ONLY = process.env.ONLY;
const STARTED = { name: 'In Progress', type: 'started' };

/**
 * Workspace config — ids + descent chains + the baseline-reconstruction override.
 * `chain` is the epic→mid→leaf descent order; `forceStarted` flips every chain node
 * (and its appearance in the parent's children list) back to `started`, and the last
 * chain node is frozen as a leaf (no children / no focusedChild) so the descent ends
 * there. roles are descriptive (carried into the fixture's targets list).
 */
const WORKSPACES = [
  {
    name: 'LinearViewer', file: 'linearviewer.json',
    base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN,
    chain: ['LIN-385', 'LIN-389', 'LIN-428'],
    roles: { 'LIN-385': 'epic', 'LIN-389': 'mid', 'LIN-428': 'leaf (direct cross-check)' },
    forceStarted: true
  },
  {
    name: 'Harbour', file: 'harbour.json',
    base: process.env.HARBOUR_PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.HARBOUR_PROXY_TOKEN,
    chain: ['HAR-149', 'HAR-545', 'HAR-616'],
    roles: { 'HAR-149': 'epic', 'HAR-545': 'mid', 'HAR-616': 'leaf' },
    forceStarted: true
  }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Proxy GET with cache + 429/5xx backoff (the 60/min limiter must not fail a run). */
function makeProxyGet(base, token) {
  const cache = new Map();
  return async function proxyGet(identifier) {
    if (cache.has(identifier)) return cache.get(identifier);
    let lastErr = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const r = await fetch(`${base}/issues/${identifier}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
        if (!r.ok) throw new Error(`proxy ${r.status} on /issues/${identifier}`);
        const j = await r.json();
        cache.set(identifier, j);
        return j;
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(`proxy GET failed (${lastErr}) on /issues/${identifier}`);
  };
}

/** Reshape a flat proxy /issues/{id} payload into the issue slice getRecommendation reads. */
function reshapeIssue(raw, { forceStarted } = {}) {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    url: raw.url,
    state: forceStarted ? STARTED : raw.state,
    createdAt: raw.createdAt,
    // Flat contract: labels are a plain string array (was raw.labels.nodes pre-LIN-306).
    labels: Array.isArray(raw.labels) ? raw.labels : []
  };
}

/**
 * Map flat proxy children → the {id,identifier,title,state} the descent guard reads.
 *
 * Frontier reconstruction: an epic with dozens of real children gives the model many
 * non-chain children to defer into — and those have no frozen bundle, so the descent
 * dead-ends "unresolved". To make the descent deterministic we present an unambiguous
 * frontier: the chain (focus) child is `started`, every other child is frozen terminal
 * (`completed`). Then the descent lands on the chain child whether the model defers to
 * it directly OR defers elsewhere (the LIN-353 terminal-edge guard redirects a terminal
 * deferTo to selectFocusSubtask, which now has exactly one non-terminal pick).
 */
const DONE = { name: 'Done', type: 'completed' };
function mapChildren(raw, { focusId } = {}) {
  return (raw.children || []).map(c => ({
    id: c.id,
    identifier: c.identifier,
    title: c.title,
    state: focusId && c.identifier === focusId ? STARTED : DONE
  }));
}

function mapComments(raw) {
  return (raw.comments || [])
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: (c.user && c.user.name) || 'Unknown' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function buildWorkspace(ws) {
  const proxyGet = makeProxyGet(ws.base, ws.token);
  const bundles = {};
  const meta = [];

  for (let i = 0; i < ws.chain.length; i++) {
    const id = ws.chain[i];
    const nextId = ws.chain[i + 1] || null;
    const isLeaf = !nextId;
    const raw = await proxyGet(id);

    const issue = reshapeIssue(raw, { forceStarted: ws.forceStarted });
    const project = raw.project ? { name: raw.project.name, description: raw.project.content || raw.project.description || null } : null;
    const comments = mapComments(raw);

    // Parent + siblings (the parent is the previous chain node, already reachable).
    let parent = null, siblings = [], siblingsTotal = 0;
    if (raw.parent) {
      parent = { id: raw.parent.id, identifier: raw.parent.identifier, title: raw.parent.title, state: raw.parent.state };
      const parentRaw = await proxyGet(raw.parent.identifier);
      const all = (parentRaw.children || [])
        .filter(c => c.id !== issue.id)
        .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }));
      siblingsTotal = all.length;
      siblings = all.slice(0, SIBLING_CAP);
    }

    // Leaf: frozen with no open frontier so the descent ends here. Node: children carry
    // the next chain node forced started, and focusedChild is that node's detail.
    let children = [];
    let focusedChild = null;
    if (!isLeaf) {
      children = mapChildren(raw, { focusId: nextId });
      const nextRaw = await proxyGet(nextId);
      focusedChild = {
        issue: reshapeIssue(nextRaw, { forceStarted: ws.forceStarted }),
        comments: mapComments(nextRaw)
      };
    }

    bundles[id] = { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild };
    meta.push({ id, role: ws.roles[id], state: issue.state.type, children: children.length, comments: comments.length, descLen: (issue.description || '').length });
  }

  const fixture = {
    name: ws.name,
    note: 'Committed context-bundle fixtures for eval-recommend-baseline.mjs (LIN-587). '
      + 'Real task text captured at HEAD; chain nodes forced to `started` to reconstruct '
      + 'the epic→mid→leaf descent as it appeared when live (the real tasks have since closed). '
      + 'Non-chain siblings are frozen terminal so the descent has one unambiguous frontier '
      + '(the chain child) and resolves deterministically. Regenerate with '
      + 'scripts/eval/build-recommend-fixtures.mjs.',
    targets: ws.chain.map(id => ({ id, role: ws.roles[id] })),
    bundles
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, ws.file);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  return { path, meta };
}

// ---- main ----
const targets = WORKSPACES.filter(w => !ONLY || w.name.includes(ONLY));
for (const ws of targets) {
  if (!ws.token) { console.log(`[${ws.name}] SKIPPED — no token (set ${ws.name === 'Harbour' ? 'HARBOUR_PROXY_TOKEN' : 'PROXY_TOKEN'})`); continue; }
  const { path, meta } = await buildWorkspace(ws);
  console.log(`\n[${ws.name}] wrote ${path}`);
  console.log('  id        role                       state    children comments descLen');
  for (const m of meta) {
    console.log(`  ${m.id.padEnd(9)} ${String(m.role).padEnd(26)} ${m.state.padEnd(8)} ${String(m.children).padStart(8)} ${String(m.comments).padStart(8)} ${String(m.descLen).padStart(7)}`);
  }
}
console.log('\nDone. Fixtures are committed (curated real text); harness runs token-free.');
