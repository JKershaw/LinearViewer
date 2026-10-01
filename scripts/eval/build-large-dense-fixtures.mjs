#!/usr/bin/env node
/**
 * Build the committed LARGE / DENSE context-bundle fixtures for the recommendation
 * eval (LIN-1693). Rebuilt 2026-10-01 from the surviving beat-2 report after the
 * original worker clone (branch `lin-1693-dense-fixtures` @ 30d2094c) was reaped
 * before it was ever pushed.
 *
 * Why these exist: every pre-existing fixture is small/trimmed (<= ~5k context
 * chars). The LIN-1693 ticket is that the recommender degrades as a ticket's
 * assembled context gets dense. This builder freezes the FULL, untrimmed context
 * of ten real, currently-dense tickets (plus the node's descent target) so the
 * sweep measures large context, not a toy.
 *
 * Shape is deliberately identical to the existing harness fixtures so
 * `scripts/eval-recommend-baseline.mjs` / `scripts/eval/eval-dense.mjs` load them
 * unchanged:
 *   { name, note, targets: [{ id, role, expect, descentExpect }], bundles: { <key>: <contextBundle> } }
 * where each contextBundle is the exact object getRecommendation consumes:
 *   { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild }
 *
 * Capture is READ-ONLY from the workspace proxy; it needs no OpenRouter key and
 * makes no paid LLM calls. The captured text is committed under
 * `fixtures/recommend/_source/large-dense.json`, so the harness runs token-free on
 * a fresh clone. To refresh from live data:
 *
 *   REFRESH=1 PROXY_TOKEN=<workspace read token> \
 *     PROXY_BASE=https://harbour.cat/api/proxy \
 *     node scripts/eval/build-large-dense-fixtures.mjs
 *
 * Without REFRESH it re-derives the committed fixture from `_source/` only.
 *
 * Label provenance (re-derived at HEAD, 2026-10-01 — live state has moved since
 * the beat-2 report of 2026-09-29; changed labels are marked `live` and carry the
 * reason inline). The dense targets are graded as LEAF-ONLY (children elided,
 * focusedChild null) so the descent terminates immediately at the target and the
 * terminal action is the ticket's own next action. The single exception is
 * LIN-2149, a healthy container whose honest next action is `defer`: its bundle
 * carries the real children + a focusedChild of LIN-3125, and the descent is
 * graded on LIN-3125's terminal action.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatIssueContext, SIBLING_CAP } from '../../lib/openrouter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures', 'recommend');
const SOURCE_DIR = join(OUT_DIR, '_source');
const SOURCE_FILE = 'large-dense.json';
const OUT_FILE = 'large-dense.json';
const STARTED = { name: 'In Progress', type: 'started' };

/**
 * The dense fixture roster (LIN-1693 beat 2). `expect` is the acceptable terminal
 * action set; `descentExpect` defaults to the target's own identifier (leaf-only).
 * `labelSource` is `hand` (carried from beat 2) or `live` (re-derived 2026-10-01).
 * `changed` records whether the live state moved the label off beat 2's call.
 */
const TARGETS = [
  {
    id: 'LIN-2149', role: 'node (defer → LIN-3125)', expect: ['implement', 'implementation'],
    descentExpect: 'LIN-3125', labelSource: 'live', changed: true,
    note: 'Healthy container with open children (LIN-3125 in progress, LIN-3126 todo, LIN-2819 backlog). '
      + 'Beat 2 deferred to LIN-3124; LIN-3124 is now Done, so the actionable frontier child is LIN-3125. '
      + 'Beat-3 re-score: accept-set widened to the existing fixture convention ["implement","implementation"].'
  },
  {
    id: 'LIN-1892', role: 'dense leaf', expect: ['implement', 'implementation', 'blocked'],
    labelSource: 'live', changed: true,
    note: 'Beat 2 said close-out (S1-S3 merged). Live: S3 merged AND deployed, ticket stays In Progress; '
      + 'the latest rulings (29 Sep 19:26-19:28) settle owner backfill and point at a concrete next build. '
      + 'Beat-3 adjudication: the ticket\'s own review ledger (L5/L6) gates its Done on POST-DEPLOY OPERATOR steps '
      + '(production owner-population check, owner-index exists in prod, Resend key/sending-domain/EMAIL_FROM), '
      + 'so `blocked` is defensible alongside the remaining S3 implement round: accept-set = implement|implementation|blocked.'
  },
  {
    id: 'LIN-2944', role: 'dense leaf', expect: ['implement', 'implementation'],
    labelSource: 'live', changed: true,
    note: 'Beat 2 said breakdown. Live: P0 merged; the trail records "next action implementation for P1" and a '
      + 'ruling "Dispatch implement for N4+T1". Beat-3 re-score: accept-set widened to the existing fixture convention.'
  },
  {
    id: 'LIN-3059', role: 'dense leaf', expect: ['blocked'],
    labelSource: 'hand', changed: false,
    note: 'All code slices landed; only W (the hosted witness) remains and needs John, held by ruling '
      + '`lin3059-hosted-witness` = after-3098.'
  },
  {
    id: 'LIN-3098', role: 'dense leaf', expect: ['implement', 'implementation'],
    labelSource: 'hand', changed: false,
    note: 'S4 merged; S5 (hosted-witness runbook) is the next implementation slice; S6 waits on LIN-3136. '
      + 'Beat-3 re-score: accept-set widened to the existing fixture convention.'
  },
  {
    id: 'LIN-3107', role: 'dense leaf', expect: ['retrospective-audit'],
    labelSource: 'hand', changed: false,
    note: 'Research task merged, reviewed (Approve), close-out run, Done.'
  },
  {
    id: 'LIN-3124', role: 'dense leaf', expect: ['retrospective-audit'],
    labelSource: 'live', changed: true,
    note: 'Beat 2 said blocked (held for acceptance). Live: John accepted all five items, final close-out set it '
      + 'Done. Done + merged + reviewed ⇒ retrospective-audit.'
  },
  {
    id: 'LIN-3135', role: 'dense leaf', expect: ['implement', 'implementation', 'blocked'],
    labelSource: 'hand', changed: false,
    note: 'PR #1616 (R2, LinearViewer S1/S2/S4) merged after John\'s ruling; ticket stays In Progress only for the '
      + 'Simple Dispatcher item (L2/S3), which the leg constraint says is an explicit open item and blocks Done. '
      + 'Beat-3 adjudication: `close-out` is NOT defensible here — close-out owns merge+Done, the merge already '
      + 'happened and Done is explicitly withheld, so a close-out prompt is a no-op; the remaining scope is an '
      + 'implement (S3). `blocked` IS defensible — the ticket text names S3 as "an explicit open item for the SD '
      + 'owner", an external hand-off that gates Done — so accept-set = implement|implementation|blocked.'
  },
  {
    id: 'LIN-2403', role: 'dense leaf', expect: ['retrospective-audit'],
    labelSource: 'hand', changed: false,
    note: 'Bug split-out; implementation merged, reviewed, close-out (`ready-for-Done`), Done.'
  },
  {
    id: 'LIN-2882', role: 'dense leaf', expect: ['retrospective-audit'],
    labelSource: 'hand', changed: false,
    note: 'Merged and Done; review verdicts on the trail.'
  }
];

/** Extra real leaves captured only as descent targets (graded via a node target). */
const EXTRA_SOURCES = ['LIN-3125'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    state: raw.state || STARTED,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    labels: Array.isArray(raw.labels) ? raw.labels : []
  };
}

/** All comments, oldest-first, full text. */
function rawComments(raw) {
  return (raw.comments || [])
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: (c.user && c.user.name) || 'Unknown' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function childSlice(raw) {
  return (raw.children || []).map(c => ({
    id: c.id, identifier: c.identifier, title: c.title, state: c.state
  }));
}

async function captureParent(proxyGet, raw, selfId) {
  if (!raw.parent) return { parent: null, siblings: [], siblingsTotal: 0 };
  const parent = { id: raw.parent.id, identifier: raw.parent.identifier, title: raw.parent.title, state: raw.parent.state };
  const parentRaw = await proxyGet(raw.parent.identifier);
  const all = (parentRaw.children || [])
    .filter(c => c.id !== selfId)
    .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }));
  return { parent, siblings: all.slice(0, SIBLING_CAP), siblingsTotal: all.length };
}

function projectOf(raw) {
  return raw.project ? { name: raw.project.name, description: raw.project.content || raw.project.description || null } : null;
}

/** Capture one leaf bundle (no descent) — children elided, focusedChild null. */
async function captureLeaf(proxyGet, id) {
  const raw = await proxyGet(id);
  const issue = reshapeIssue(raw);
  const { parent, siblings, siblingsTotal } = await captureParent(proxyGet, raw, issue.id);
  return { issue, parent, siblings, siblingsTotal, project: projectOf(raw), children: [], comments: rawComments(raw), focusedChild: null };
}

/** Capture the one node bundle (LIN-2149): real children + focusedChild = descent target. */
async function captureNode(proxyGet, id, focusId) {
  const raw = await proxyGet(id);
  const issue = reshapeIssue(raw);
  const { parent, siblings, siblingsTotal } = await captureParent(proxyGet, raw, issue.id);
  const children = childSlice(raw);
  const focusRaw = await proxyGet(focusId);
  return {
    issue, parent, siblings, siblingsTotal, project: projectOf(raw), children,
    comments: rawComments(raw),
    focusedChild: { issue: reshapeIssue(focusRaw), comments: rawComments(focusRaw) }
  };
}

async function refreshSource() {
  const base = process.env.PROXY_BASE || 'https://harbour.cat/api/proxy';
  const token = process.env.PROXY_TOKEN || process.env.HARBOUR_LOCAL_TOKEN;
  if (!token) {
    console.error('REFRESH=1 needs PROXY_TOKEN');
    process.exit(1);
  }
  const proxyGet = makeProxyGet(base, token);
  const bundles = {};
  for (const t of TARGETS) {
    if (t.descentExpect && t.descentExpect !== t.id) {
      bundles[t.id] = await captureNode(proxyGet, t.id, t.descentExpect);
      console.log(`[large-dense] captured node ${t.id} → ${t.descentExpect}`);
    } else {
      bundles[t.id] = await captureLeaf(proxyGet, t.id);
      console.log(`[large-dense] captured leaf ${t.id}`);
    }
  }
  for (const id of EXTRA_SOURCES) {
    bundles[id] = await captureLeaf(proxyGet, id);
    console.log(`[large-dense] captured extra leaf ${id}`);
  }
  mkdirSync(SOURCE_DIR, { recursive: true });
  writeFileSync(join(SOURCE_DIR, SOURCE_FILE), JSON.stringify({ name: 'LargeDense', bundles }, null, 2) + '\n');
  console.log(`[large-dense] wrote _source/${SOURCE_FILE} (${Object.keys(bundles).length} bundles)`);
}

/** Approx token heuristic — 4 chars/token, matching the beat-2 report. */
const approxTokens = (chars) => Math.round(chars / 4);

function loadSource() {
  const p = join(SOURCE_DIR, SOURCE_FILE);
  if (!existsSync(p)) throw new Error(`missing source capture ${p} — run with REFRESH=1 + PROXY_TOKEN`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function build() {
  const src = loadSource();
  const bundles = {};
  const targets = [];
  const meta = [];

  for (const t of TARGETS) {
    const b = src.bundles[t.id];
    if (!b) throw new Error(`missing source bundle for ${t.id}`);
    bundles[t.id] = b;
    const descentExpect = t.descentExpect || t.id;
    targets.push({ id: t.id, role: t.role, expect: t.expect, descentExpect, note: t.note, labelSource: t.labelSource, changed: t.changed });
    const chars = formatIssueContext(b.issue, {
      parent: b.parent, siblings: b.siblings, siblingsTotal: b.siblingsTotal,
      project: b.project, children: b.children, comments: b.comments, focusedChild: b.focusedChild
    }).length;
    meta.push({ id: t.id, chars, tokens: approxTokens(chars), comments: (b.comments || []).length, children: (b.children || []).length, expect: t.expect.join('|'), descent: descentExpect, label: t.labelSource + (t.changed ? '*' : '') });
  }

  // Extra descent-target leaves (not graded targets themselves).
  for (const id of EXTRA_SOURCES) {
    if (src.bundles[id]) bundles[id] = src.bundles[id];
  }

  const fixture = {
    name: 'LargeDense',
    note: 'Large/dense real-ticket context bundles for LIN-1693. Captured from the live tracker at HEAD (see '
      + '_source/large-dense.json); full untrimmed comment trails and descriptions so assembled context is 35k-128k '
      + 'tokens. Targets are leaf-only except LIN-2149, a container graded via its descent to LIN-3125. Labels are '
      + 'hand-derived at 2026-10-01; `changed` marks where the live state moved off the beat-2 (2026-09-29) call. '
      + 'Regenerate with scripts/eval/build-large-dense-fixtures.mjs.',
    targets,
    bundles
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, OUT_FILE), JSON.stringify(fixture, null, 2) + '\n');
  return { path: join(OUT_DIR, OUT_FILE), meta };
}

if (process.env.REFRESH) {
  await refreshSource();
}

const { path, meta } = build();
console.log(`\n[large-dense] wrote ${path}`);
console.log('  target              expect                  descent      chars     ~tokens  cmts  kids  label');
for (const m of meta) {
  console.log(`  ${m.id.padEnd(19)} ${m.expect.padEnd(22)} ${m.descent.padEnd(12)} ${String(m.chars).padStart(7)}  ${String(m.tokens).padStart(7)}  ${String(m.comments).padStart(4)}  ${String(m.children).padStart(4)}  ${m.label}`);
}
console.log('\nDone. Fixture is committed (full real text); harness runs token-free.');
