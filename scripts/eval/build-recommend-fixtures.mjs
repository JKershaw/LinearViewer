#!/usr/bin/env node
/**
 * Build the committed context-bundle fixtures for the recommendation baseline eval.
 *
 * LIN-587 froze the descent targets to `started` but kept the FULL, untrimmed comment
 * trails — so every leaf still carried completion evidence ("PR merged / CI green /
 * approved / closed"). A `started` task whose trail says it is done correctly routes to
 * `review`, so every target collapsed to the same answer (40/42 runs `review` at K=6) and
 * the eval stopped discriminating next-action quality.
 *
 * LIN-596 re-freezes the fixtures at KEY HISTORICAL IN-PROGRESS MOMENTS so the eval
 * exercises a spread of next-actions. The recipe (mirroring build-routing-fixtures.mjs):
 * keep each node's first `keep` comments (oldest-first) — the decision moment, before the
 * close-out — so `state` AND the trimmed trail are mutually consistent. Two underlying
 * causes are addressed:
 *
 *   1. Untrimmed trails (LIN-587) → trim each node's `comments` to its `keep`.
 *   2. STRUCTURAL single-leaf convergence: both chains descend to the SAME leaf
 *      (…→HAR-616, …→LIN-428), so only two distinct leaves are ever graded — trimming
 *      alone tops out at two expected actions. We re-use one real leaf at several decision
 *      moments as distinct GRADED leaf-only targets (the ticket's explicit allowance),
 *      reaching ≥3 distinct expected next-actions.
 *
 * Re-grounding note (LIN-596): HAR-616's and LIN-428's DESCRIPTIONS are themselves
 * plan-seeded (they embed a finalized plan), so they are poor `plan`/`research` sources —
 * trimming comments cannot undo a plan baked into the description. LIN-385's description is
 * a broad multi-spec migration epic with a scope checklist and NO plan, so it is the clean
 * `plan`/`breakdown` source; LIN-428 is the clean `implement`/`review` source.
 *
 * Two kinds of target:
 *   • DESCENT CHAINS  — epic→mid→leaf, every node trimmed to a coherent pre-close arc.
 *     Graded on descent-correctness (did the descent reach `descentExpect`?) + the leaf's
 *     terminal action. Each non-leaf carries `children` + `focusedChild` so the descent
 *     resolves; the leaf has neither, so the descent ends there.
 *   • GRADED LEAF-ONLY — one real leaf re-used at several decision moments (distinct bundle
 *     keys like `LIN-385@plan`). No `focusedChild`/`children`, so they stay trivially
 *     self-consistent and `started`, and the descent terminates immediately at the leaf
 *     (terminal id == the leaf's own identifier). Graded on terminal action.
 *
 * Cross-cutting trim seam: a chain node appears BOTH as its own bundle and as its parent's
 * `focusedChild`. Both copies must use the IDENTICAL `keep` (keyed by node id) or the
 * parent's context contradicts the child. `trimComments(sort-oldest-first → slice(0,keep))`
 * is the single seam applied in both places.
 *
 * Source of truth: the committed full-trail captures under `fixtures/recommend/_source/`.
 * They hold the real, untrimmed text, so this builder (and the eval) run token-free on a
 * fresh clone. To REFRESH the captures from the live proxy (the only step that needs a
 * token), run with REFRESH_SOURCE=1 and the proxy read tokens — it rewrites `_source/*`
 * in the same bundle shape, then the trim/freeze pass below runs over the fresh capture.
 *
 * Output shape (one file per workspace) matches the harness's fixtures loader:
 *   { name, note, targets: [{ id, role, expect, descentExpect }], bundles: { <key>: <contextBundle> } }
 * where each contextBundle is the exact object getRecommendation consumes:
 *   { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild }
 *
 * Usage:
 *   node scripts/eval/build-recommend-fixtures.mjs                 # token-free: trim from _source
 *   REFRESH_SOURCE=1 PROXY_TOKEN=<lv read> HARBOUR_PROXY_TOKEN=<harbour read> \
 *     node scripts/eval/build-recommend-fixtures.mjs               # refresh _source from the proxy, then trim
 *
 * Env knobs:
 *   REFRESH_SOURCE       when set, re-capture _source/* from the proxy before trimming
 *   PROXY_TOKEN          LinearViewer proxy READ token   (refresh only)
 *   PROXY_BASE           LinearViewer proxy base URL     (default https://projects.jkershaw.com/api/proxy)
 *   HARBOUR_PROXY_TOKEN  Harbour proxy READ token        (refresh only)
 *   HARBOUR_PROXY_BASE   Harbour proxy base URL          (default https://projects.jkershaw.com/api/proxy)
 *   ONLY                 substring filter on workspace name (e.g. ONLY=Harbour)
 *
 * Context hygiene: prints only a metadata table (no body text) to stdout — the bulk
 * task text lives in the fixture files only.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SIBLING_CAP } from '../../lib/openrouter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures', 'recommend');
const SOURCE_DIR = join(OUT_DIR, '_source');
const ONLY = process.env.ONLY;
const REFRESH_SOURCE = !!process.env.REFRESH_SOURCE;
const STARTED = { name: 'In Progress', type: 'started' };

/**
 * Workspace freeze config (LIN-596).
 *
 * `chain`        the epic→mid→leaf descent order (descent-coverage targets).
 * `keep`         per-node count of OLDEST comments to retain at the frozen moment.
 *                Applied to a node's own `comments` AND its copy as a parent's
 *                `focusedChild` (the shared trim seam).
 * `descentExpect`the leaf the chain should descend to (terminal id the grader checks).
 * `chainExpect`  acceptable terminal action(s) at that leaf (given its trimmed trail).
 * `gradedLeaves` leaf-only targets re-using a real leaf at several decision moments.
 *                Each: { key, source, keep, expect, role }.
 */
const WORKSPACES = [
  {
    name: 'LinearViewer', file: 'linearviewer.json',
    chain: ['LIN-385', 'LIN-389', 'LIN-428'],
    keep: { 'LIN-385': 1, 'LIN-389': 2, 'LIN-428': 1 },
    roles: { 'LIN-385': 'epic', 'LIN-389': 'mid', 'LIN-428': 'leaf' },
    descentExpect: 'LIN-428',
    // LIN-428 keep=1: one-session impl plan in the description + comment[0] "Plan ready",
    // no code landed yet → the honest next action at the leaf is implement.
    chainExpect: ['implement'],
    gradedLeaves: [
      {
        key: 'LIN-385@plan', source: 'LIN-385', keep: 0, expect: ['plan', 'research'],
        role: 'leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research'
      },
      {
        key: 'LIN-385@breakdown', source: 'LIN-385', keep: 1, expect: ['breakdown'],
        role: 'leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown'
      },
      {
        key: 'LIN-428@implement', source: 'LIN-428', keep: 1, expect: ['implement'],
        role: 'leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement'
      },
      {
        key: 'LIN-428@review', source: 'LIN-428', keep: 2, expect: ['review'],
        role: 'leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review'
      }
    ]
  },
  {
    name: 'Harbour', file: 'harbour.json',
    chain: ['HAR-149', 'HAR-545', 'HAR-616'],
    // Trim the epic/mid to a pre-close arc (drop the 2026-06-14 staleness/paused and
    // HAR-545 close-out comments) so the whole chain reads as one coherent in-progress
    // arc. The leaf is frozen at keep=8: through comment[7] ("blocker RESOLVED, route to
    // next action" on the still-actionable child #2 / HAR-623), BEFORE comment[8] (the
    // review that verifies it complete). With the blocker cleared and work still owed on
    // #2, the honest next action is to proceed — implement — NOT review (review is the
    // dropped comment[8]; freezing before it is the whole point). Verified from the trail,
    // not assumed: do not overfit `expect` toward the comment we deliberately trimmed off.
    keep: { 'HAR-149': 11, 'HAR-545': 2, 'HAR-616': 8 },
    roles: { 'HAR-149': 'epic', 'HAR-545': 'mid', 'HAR-616': 'leaf' },
    descentExpect: 'HAR-616',
    chainExpect: ['implement'],
    // HAR-616's description is plan-finalized + decomposed, so it is not a clean
    // plan/research/breakdown source — kept as a descent-coverage chain only. The
    // LinearViewer leaves already supply 4 distinct graded actions.
    gradedLeaves: []
  }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- trim seam (LIN-596) ----------------------------------------------------------
/** Sort oldest-first, then keep the first `keep` comments (the frozen decision moment). */
function trimComments(comments, keep) {
  return (comments || [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, keep);
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- proxy refresh (optional; the only token-needing step) ------------------------
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
function reshapeIssue(raw) {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    url: raw.url,
    state: STARTED, // captures are always forced `started` (the real tasks have since closed)
    createdAt: raw.createdAt,
    labels: Array.isArray(raw.labels) ? raw.labels : []
  };
}

const DONE = { name: 'Done', type: 'completed' };
/** Present an unambiguous descent frontier: the chain child `started`, every other `completed`. */
function mapChildren(raw, focusId) {
  return (raw.children || []).map(c => ({
    id: c.id, identifier: c.identifier, title: c.title,
    state: focusId && c.identifier === focusId ? STARTED : DONE
  }));
}

/** All comments, oldest-first (untrimmed — trimming happens in the freeze pass). */
function rawComments(raw) {
  return (raw.comments || [])
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: (c.user && c.user.name) || 'Unknown' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Capture a workspace's full-trail bundles from the proxy → _source/<file>. */
async function refreshSource(ws) {
  const proxyGet = makeProxyGet(ws.base, ws.token);
  const bundles = {};
  for (let i = 0; i < ws.chain.length; i++) {
    const id = ws.chain[i];
    const nextId = ws.chain[i + 1] || null;
    const raw = await proxyGet(id);
    const issue = reshapeIssue(raw);
    const project = raw.project ? { name: raw.project.name, description: raw.project.content || raw.project.description || null } : null;
    const comments = rawComments(raw);

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

    let children = [], focusedChild = null;
    if (nextId) {
      children = mapChildren(raw, nextId);
      const nextRaw = await proxyGet(nextId);
      focusedChild = { issue: reshapeIssue(nextRaw), comments: rawComments(nextRaw) };
    }
    bundles[id] = { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild };
  }
  const out = { name: ws.name, bundles };
  mkdirSync(SOURCE_DIR, { recursive: true });
  writeFileSync(join(SOURCE_DIR, ws.file), JSON.stringify(out, null, 2) + '\n');
  console.log(`[${ws.name}] refreshed _source/${ws.file} (${ws.chain.length} nodes)`);
}

// ---- freeze pass (always) ---------------------------------------------------------
function loadSource(ws) {
  const p = join(SOURCE_DIR, ws.file);
  if (!existsSync(p)) {
    throw new Error(`missing source capture ${p} — run with REFRESH_SOURCE=1 + proxy tokens to create it`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Build the trimmed, frozen harness fixture for one workspace from its _source capture. */
function buildWorkspace(ws) {
  const src = loadSource(ws);
  const bundles = {};
  const targets = [];
  const meta = [];

  // 1) Descent chains — every node trimmed to its `keep`; the focusedChild copy of the
  //    NEXT chain node trimmed to that node's `keep` (the shared trim seam).
  for (let i = 0; i < ws.chain.length; i++) {
    const id = ws.chain[i];
    const nextId = ws.chain[i + 1] || null;
    const b = clone(src.bundles[id]);
    b.comments = trimComments(b.comments, ws.keep[id]);
    if (b.focusedChild && nextId) {
      b.focusedChild.comments = trimComments(b.focusedChild.comments, ws.keep[nextId]);
    }
    bundles[id] = b;
    targets.push({ id, role: `${ws.roles[id]} (descent → ${ws.descentExpect})`, expect: ws.chainExpect, descentExpect: ws.descentExpect });
    meta.push({ id, role: ws.roles[id], keep: ws.keep[id], kept: b.comments.length, expect: ws.chainExpect.join('|'), descent: ws.descentExpect });
  }

  // 2) Graded leaf-only targets — one real leaf re-used at several moments. No
  //    focusedChild/children, so they stay self-consistent and the descent terminates
  //    immediately (terminal id == the leaf's own identifier). descentExpect is the
  //    leaf's real identifier (so terminal == descentExpect for a clean leaf).
  for (const g of ws.gradedLeaves) {
    const s = src.bundles[g.source];
    if (!s) throw new Error(`graded leaf ${g.key} references unknown source ${g.source}`);
    bundles[g.key] = {
      issue: clone(s.issue),
      parent: null,
      siblings: [],
      siblingsTotal: 0,
      project: s.project ? clone(s.project) : null,
      children: [],
      comments: trimComments(s.comments, g.keep),
      focusedChild: null
    };
    targets.push({ id: g.key, role: g.role, expect: g.expect, descentExpect: s.issue.identifier });
    meta.push({ id: g.key, role: g.source, keep: g.keep, kept: bundles[g.key].comments.length, expect: g.expect.join('|'), descent: s.issue.identifier });
  }

  const fixture = {
    name: ws.name,
    note: 'Committed context-bundle fixtures for eval-recommend-baseline.mjs (LIN-596 re-freeze). '
      + 'Real task text captured at HEAD (see _source/), frozen at key historical IN-PROGRESS moments: '
      + 'each node keeps its first `keep` comments (oldest-first), before the close-out, so `state` and the '
      + 'trimmed trail are mutually consistent. Descent chains (epic→mid→leaf) grade descent-correctness + '
      + 'leaf terminal action; graded leaf-only targets re-use one real leaf at several decision moments to '
      + 'cover a spread of next-actions. Regenerate with scripts/eval/build-recommend-fixtures.mjs.',
    targets,
    bundles
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, ws.file);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  return { path, meta };
}

// ---- main -------------------------------------------------------------------------
const selected = WORKSPACES.filter(w => !ONLY || w.name.includes(ONLY));

if (REFRESH_SOURCE) {
  for (const ws of selected) {
    ws.base = ws.name === 'Harbour'
      ? (process.env.HARBOUR_PROXY_BASE || 'https://projects.jkershaw.com/api/proxy')
      : (process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy');
    ws.token = ws.name === 'Harbour' ? process.env.HARBOUR_PROXY_TOKEN : process.env.PROXY_TOKEN;
    if (!ws.token) { console.log(`[${ws.name}] REFRESH SKIPPED — no token (set ${ws.name === 'Harbour' ? 'HARBOUR_PROXY_TOKEN' : 'PROXY_TOKEN'})`); continue; }
    await refreshSource(ws);
  }
}

for (const ws of selected) {
  const { path, meta } = buildWorkspace(ws);
  console.log(`\n[${ws.name}] wrote ${path}`);
  console.log('  target              source/keep  kept  expect                 descentExpect');
  for (const m of meta) {
    console.log(`  ${m.id.padEnd(19)} ${(`keep=${m.keep}`).padEnd(11)} ${String(m.kept).padStart(4)}  ${m.expect.padEnd(22)} ${m.descent}`);
  }
}
console.log('\nDone. Fixtures are committed (trimmed real text); harness runs token-free.');
